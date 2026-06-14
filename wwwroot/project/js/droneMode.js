// ===== DroneController MVP =====
// W/S 前后 | A/D 左右平移 | Space/Shift 升降
// 鼠标控制朝向 | 滚轮切换速度档位
// 已知 SuperMap 坑已规避：clock.onTick + performance.now() + setView

var droneController = null;

class DroneController {
  constructor(viewer) {
    this._viewer = viewer;

    // 速度档位
    this._speedLevels = [1, 5, 20, 50, 200];
    this._speedIndex  = 2;  // 默认 20 m/s

    // 鼠标灵敏度
    this._mouseSensitivity = 0.0025;

    // 输入状态
    this._keys = { w: false, s: false, a: false, d: false, space: false, shift: false };

    // 相机状态
    this._position = null;   // Cartesian3
    this._heading  = 0;
    this._pitch    = 0;

    // 内部
    this._enabled       = false;
    this._pointerLocked = false;
    this._lastTickTime  = 0;
    this._tickErrorCount = 0;

    // V/S 垂直速度
    this._prevAltitude = null;

    // FPS 帧率
    this._fpsFrameCount = 0;
    this._fpsLastCheck  = 0;

    // 火点目标
    this._targetFire = null;

    // 自动飞行状态
    this._autoFlightActive = false;
    this._savedKeys = null;

    // 缓存向量（ENU 局部坐标系 + 中间计算）
    this._scratchEast    = new SuperMap3D.Cartesian3();
    this._scratchNorth   = new SuperMap3D.Cartesian3();
    this._scratchUp      = new SuperMap3D.Cartesian3();
    this._scratchForward = new SuperMap3D.Cartesian3();
    this._scratchRight   = new SuperMap3D.Cartesian3();
    this._scratchStep    = new SuperMap3D.Cartesian3();
    this._scratchCarto   = new SuperMap3D.Cartographic();

    // 绑定
    this._boundKeyDown           = this._onKeyDown.bind(this);
    this._boundKeyUp             = this._onKeyUp.bind(this);
    this._boundMouseMove         = this._onMouseMove.bind(this);
    this._boundWheel             = this._onWheel.bind(this);
    this._boundTick              = this._onTick.bind(this);
    this._boundPointerLockChange = this._onPointerLockChange.bind(this);
  }

  get enabled() { return this._enabled; }
  get speed()   { return this._speedLevels[this._speedIndex]; }

  toggle() { this._enabled ? this.disable() : this.enable(); }

  // ===== 启用 =====
  enable() {
    if (this._enabled) return;


    // 先收起菜单和面板
    var spatialDropdown = document.getElementById('spatialDropdown');
    if (spatialDropdown) spatialDropdown.classList.remove('show');
    var spatialPanel = document.getElementById('spatialPanel');
    if (spatialPanel) spatialPanel.classList.remove('open');
    if (typeof resetSpatialFocus === 'function') resetSpatialFocus();

    var self = this;

    function onFireSelected(fireData) {
      if (fireData) {
        self._targetFire = fireData;
      }
      // 此时在用户点击事件的调用链中，requestPointerLock 不会被浏览器拦截
      self._doEnable();
    }

    // 弹窗选择火点 → 用户确认后再进入飞行（鼠标此时未被锁定，可正常点击弹窗）
    if (droneHud && !this._targetFire) {
      droneHud.selectFirePoint(onFireSelected);
    } else {
      onFireSelected(null);
    }
  }

  _doEnable() {
    if (this._enabled) return;


    var camera = this._viewer.camera;

    // 记录当前状态
    this._position = SuperMap3D.Cartesian3.clone(camera.position);
    this._heading  = camera.heading;
    this._pitch    = camera.pitch;
    this._prevAltitude = null;

    // 禁用默认控制
    var ctrl = this._viewer.scene.screenSpaceCameraController;
    ctrl.enableRotate    = false;
    ctrl.enableZoom      = false;
    ctrl.enableTilt      = false;
    ctrl.enableTranslate = false;

    // 更新循环
    this._viewer.clock.shouldAnimate = true;
    this._viewer.clock.onTick.addEventListener(this._boundTick);

    // 输入监听
    document.addEventListener('keydown',  this._boundKeyDown);
    document.addEventListener('keyup',    this._boundKeyUp);
    document.addEventListener('mousemove', this._boundMouseMove);
    document.addEventListener('wheel',    this._boundWheel, { passive: false });
    document.addEventListener('pointerlockchange', this._boundPointerLockChange);

    // Pointer Lock（鼠标变为视角控制）
    try {
      var canvas = this._viewer.scene.canvas;
      if (canvas) canvas.requestPointerLock();
    } catch (e) {}

    this._enabled = true;
    this._tickErrorCount = 0;
    this._lastTickTime = 0;
    if (droneHud) {
      droneHud.show();
      // 设置用户选择的火点目标
      if (this._targetFire) {
        var foundPos = null;
        console.log('DroneController — 查找用户选中火点:', this._targetFire.fireScene);
        if (typeof poiEntities !== 'undefined' && poiEntities.firepoint) {
          var tf = this._targetFire;
          console.log('DroneController — firepoint 实体数:', poiEntities.firepoint.length);
          poiEntities.firepoint.forEach(function(e) {
            if (e._poiData) {
              console.log('DroneController — 比对实体:', e._poiData.name, 'vs', tf.fireScene, 'match=', e._poiData.name === tf.fireScene);
            }
            if (e._poiData && e._poiData.name === tf.fireScene) {
              try {
                var raw = e.position;
                console.log('DroneController — entity.position 类型:', typeof raw, raw);
                foundPos = raw.getValue ? raw.getValue(viewer.clock.currentTime) : raw;
                console.log('DroneController — foundPos:', foundPos);
              } catch (err) {
                console.warn('DroneController — getValue 失败:', err.message);
              }
            }
          });
        }
        if (!foundPos) {
          console.warn('DroneController — 未找到匹配实体的位置，将通过 setTargetFire 的兜底逻辑查找');
        }
        droneHud.setTargetFire(this._targetFire, foundPos);
      }
      droneHud.autoScanMission(this._position);
    }
    console.log('DroneController MVP — 无人机视角已开启 (速度 ' + this.speed + ' m/s)');
  }

  // ===== 禁用 =====
  disable() {
    if (!this._enabled) return;

    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}

    this._viewer.clock.shouldAnimate = false;
    this._viewer.clock.onTick.removeEventListener(this._boundTick);

    document.removeEventListener('keydown',  this._boundKeyDown);
    document.removeEventListener('keyup',    this._boundKeyUp);
    document.removeEventListener('mousemove', this._boundMouseMove);
    document.removeEventListener('wheel',    this._boundWheel);
    document.removeEventListener('pointerlockchange', this._boundPointerLockChange);

    var ctrl = this._viewer.scene.screenSpaceCameraController;
    ctrl.enableRotate    = true;
    ctrl.enableZoom      = true;
    ctrl.enableTilt      = true;
    ctrl.enableTranslate = true;

    this._keys = { w: false, s: false, a: false, d: false, space: false, shift: false };
    this._enabled       = false;
    this._pointerLocked = false;
    this._targetFire    = null;  // 重置，下次进入重新选择
    if (droneHud) droneHud.hide();
    console.log('DroneController MVP — 无人机视角已退出');
  }

  // ===== 自动飞行挂起/恢复 =====
  suspendForAutoFlight() {
    // 保存当前按键状态，停止手动输入
    this._savedKeys = Object.assign({}, this._keys);
    this._keys = { w: false, s: false, a: false, d: false, space: false, shift: false };
    this._autoFlightActive = true;
    console.log('DroneController — 已挂起手动控制，进入自动飞行');
  }

  resumeFromAutoFlight() {
    this._autoFlightActive = false;
    if (this._savedKeys) {
      this._keys = this._savedKeys;
      this._savedKeys = null;
    }
    console.log('DroneController — 已恢复手动控制');
  }

  // ===== 每帧更新 =====
  _onTick() {
    if (!this._enabled) return;

    try {
      // dt（SuperMap clock.onTick 不带参数，用 performance.now()）
      var now = performance.now();
      if (!this._lastTickTime) this._lastTickTime = now;
      var dt = (now - this._lastTickTime) / 1000;
      this._lastTickTime = now;
      if (dt <= 0 || dt > 0.05) dt = 0.016;

      var camera = this._viewer.camera;

      if (this._autoFlightActive) {
        // 自动飞行模式：从相机读取位置（由 Roaming 控制），跳过WASD移动
        this._position = SuperMap3D.Cartesian3.clone(camera.position);
        this._heading = camera.heading;
        this._pitch = camera.pitch;
      } else {
        // 原有手动飞行逻辑
        var speed  = this.speed;
        var keys   = this._keys;
        var hasMove = keys.w || keys.s || keys.a || keys.d || keys.space || keys.shift;

        if (hasMove) {
          // ---- ENU 局部坐标系：ECEF 坐标不能直接做加减法 ----
          var enuMatrix = SuperMap3D.Transforms.eastNorthUpToFixedFrame(this._position);
          var east  = this._scratchEast;
          var north = this._scratchNorth;
          var up    = this._scratchUp;
          east.x  = enuMatrix[0];  east.y  = enuMatrix[1];  east.z  = enuMatrix[2];
          north.x = enuMatrix[4];  north.y = enuMatrix[5];  north.z = enuMatrix[6];
          up.x    = enuMatrix[8];  up.y   = enuMatrix[9];  up.z   = enuMatrix[10];

          // ---- 水平方向：north/east 按 heading 合成 ----
          var hRad  = this._heading;
          var cosH  = Math.cos(hRad);
          var sinH  = Math.sin(hRad);
          var forward = this._scratchForward;
          var right   = this._scratchRight;
          // forward = north * cos(heading) + east * sin(heading)
          forward.x = north.x * cosH + east.x * sinH;
          forward.y = north.y * cosH + east.y * sinH;
          forward.z = north.z * cosH + east.z * sinH;
          // right = north * cos(heading-π/2) + east * sin(heading-π/2) = north * sin(heading) + east * (-cos(heading))
          right.x = -north.x * sinH + east.x * cosH;
          right.y = -north.y * sinH + east.y * cosH;
          right.z = -north.z * sinH + east.z * cosH;

          // ---- 累加位移（ENU 向量 × step，转为 ECEF 增量） ----
          var pos  = this._position;
          var step = speed * dt;
          var scratch = this._scratchStep;

          if (keys.w) {
            SuperMap3D.Cartesian3.multiplyByScalar(forward,  step, scratch);
            SuperMap3D.Cartesian3.add(pos, scratch, pos);
          }
          if (keys.s) {
            SuperMap3D.Cartesian3.multiplyByScalar(forward, -step, scratch);
            SuperMap3D.Cartesian3.add(pos, scratch, pos);
          }
          if (keys.d) {
            SuperMap3D.Cartesian3.multiplyByScalar(right,   step, scratch);
            SuperMap3D.Cartesian3.add(pos, scratch, pos);
          }
          if (keys.a) {
            SuperMap3D.Cartesian3.multiplyByScalar(right,  -step, scratch);
            SuperMap3D.Cartesian3.add(pos, scratch, pos);
          }
          if (keys.space) {
            SuperMap3D.Cartesian3.multiplyByScalar(up,      step, scratch);
            SuperMap3D.Cartesian3.add(pos, scratch, pos);
          }
          if (keys.shift) {
            SuperMap3D.Cartesian3.multiplyByScalar(up,     -step, scratch);
            SuperMap3D.Cartesian3.add(pos, scratch, pos);
          }

          // ---- 最低高度 2m ----
          var carto = SuperMap3D.Cartographic.fromCartesian(pos, SuperMap3D.Ellipsoid.WGS84, this._scratchCarto);
          if (carto && carto.height < 2) {
            this._position = SuperMap3D.Cartesian3.fromRadians(carto.longitude, carto.latitude, 2);
          }
        }

        // ---- 应用位置 + 旋转（SuperMap heading/pitch 只有 getter，通过 setView 设置） ----
        camera.setView({
          destination: this._position,
          orientation: {
            heading: this._heading,
            pitch:   this._pitch,
            roll:    0
          }
        });
      }

      // ---- V/S 垂直速度计算 ----
      var hudCarto = SuperMap3D.Cartographic.fromCartesian(
        this._position, SuperMap3D.Ellipsoid.WGS84, this._scratchCarto
      );
      var currAlt = hudCarto ? hudCarto.height : 0;
      var vs = 0;
      if (this._prevAltitude != null) {
        vs = (currAlt - this._prevAltitude) / dt;
      }
      this._prevAltitude = currAlt;

      // ---- FPS 帧率（每秒更新一次） ----
      this._fpsFrameCount++;
      if (!this._fpsLastCheck) this._fpsLastCheck = now;
      if (now - this._fpsLastCheck >= 1000) {
        var fps = Math.round(this._fpsFrameCount * 1000 / (now - this._fpsLastCheck));
        this._currentFps = fps;
        this._fpsFrameCount = 0;
        this._fpsLastCheck = now;
      }

      // ---- HUD 数据推送（DroneHud 内部 150ms 节流，不会每帧操作 DOM） ----
      if (droneHud) {
        droneHud.updateFlightData({
          speed:    this.speed,
          altitude: currAlt,
          heading:  this._heading,
          pitch:    this._pitch,
          lng:      hudCarto ? hudCarto.longitude : 0,
          lat:      hudCarto ? hudCarto.latitude  : 0,
          position: this._position,
          vs:       vs,
          fps:      this._currentFps || 0
        });
      }

    } catch (e) {
      console.warn('DroneController tick error:');
      console.warn('  name=' + e.name + ' message=' + (e.message || '(empty)'));
      console.warn('  stack=' + (e.stack || '(no stack)'));
      if (this._position) {
        console.warn('  pos=(' + this._position.x + ',' + this._position.y + ',' + this._position.z + ')');
      } else {
        console.warn('  pos=undefined!');
      }
      console.warn('  heading=' + this._heading + ' pitch=' + this._pitch);
      this._tickErrorCount++;
    }
  }


  // ===== 鼠标移动 =====
  _onMouseMove(e) {
    if (!this._enabled) return;

    if (this._pointerLocked) {
      this._heading += e.movementX * this._mouseSensitivity;
      this._pitch   -= e.movementY * this._mouseSensitivity;
    } else if (e.buttons === 1) {
      // 降级模式：按住左键拖动
      var canvas = this._viewer.scene.canvas;
      var rect = canvas.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right) return;
      if (e.clientY < rect.top  || e.clientY > rect.bottom) return;
      this._heading += e.movementX * this._mouseSensitivity;
      this._pitch   -= e.movementY * this._mouseSensitivity;
    } else {
      return;
    }

    // Pitch 限制 ±85°
    var limit = 85 * Math.PI / 180;
    if (this._pitch >  limit) this._pitch = limit;
    if (this._pitch < -limit) this._pitch = -limit;
  }

  // ===== 滚轮切换速度档位 =====
  _onWheel(e) {
    if (!this._enabled) return;
    e.preventDefault();

    if (e.deltaY > 0) {
      this._speedIndex = (this._speedIndex + 1) % this._speedLevels.length;
    } else {
      this._speedIndex = (this._speedIndex - 1 + this._speedLevels.length) % this._speedLevels.length;
    }
  }

  // ===== Pointer Lock 状态 =====
  _onPointerLockChange() {
    var canvas = this._viewer.scene.canvas;
    this._pointerLocked = (document.pointerLockElement === canvas);
  }

  // ===== 键盘 =====
  _onKeyDown(e) {
    if (!this._enabled) return;

    switch (e.key) {
      case 'w': case 'W': this._keys.w = true; e.preventDefault(); break;
      case 's': case 'S': this._keys.s = true; e.preventDefault(); break;
      case 'a': case 'A': this._keys.a = true; e.preventDefault(); break;
      case 'd': case 'D': this._keys.d = true; e.preventDefault(); break;
      case ' ':           this._keys.space = true; e.preventDefault(); break;
      case 'Shift':       this._keys.shift = true; e.preventDefault(); break;
      case 'Escape':
        e.preventDefault();
        this.disable();
        break;
    }
  }

  _onKeyUp(e) {
    switch (e.key) {
      case 'w': case 'W': this._keys.w = false; break;
      case 's': case 'S': this._keys.s = false; break;
      case 'a': case 'A': this._keys.a = false; break;
      case 'd': case 'D': this._keys.d = false; break;
      case ' ':           this._keys.space = false; break;
      case 'Shift':       this._keys.shift = false; break;
    }
  }

}

// ===== 外部接口 =====
function initDroneController() {
  if (typeof viewer !== 'undefined' && viewer && !droneController) {
    droneController = new DroneController(viewer);
    console.log('DroneController MVP 已初始化');
    return true;
  }
  return false;
}

function toggleDroneMode() {
  if (!droneController && !initDroneController()) {
    console.warn('无人机控制器尚未就绪，请稍后再试');
    return;
  }
  droneController.toggle();
}

(function retryInit() {
  if (!initDroneController()) setTimeout(retryInit, 500);
})();
