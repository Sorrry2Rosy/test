// ===== DroneHud — 数字孪生消防无人机侦察指挥 HUD =====
// 深色科技风 · 态势感知 · 任务执行 · 决策支持
// 组件：罗盘条 | 人工水平仪 | 雷达 | 状态灯 | 火点选择弹窗

var droneHud = null;

// 通用安全位置提取 — entity.position 可能为 PositionProperty 或纯 Cartesian3
function safeGetEntityPosition(entity) {
  if (!entity || !entity.position) return null;
  var pos = entity.position;
  try {
    // 方式1：标准的 PositionProperty（ConstantPositionProperty / SampledPositionProperty）
    if (typeof pos.getValue === 'function') {
      var val = pos.getValue(viewer.clock.currentTime);
      if (val && typeof val.x === 'number') return val;
    }
  } catch(e) {}
  // 方式2：直接就是 Cartesian3（某些 SuperMap3D 版本的特殊行为）
  if (typeof pos.x === 'number' && typeof pos.y === 'number' && typeof pos.z === 'number') {
    return pos;
  }
  // 方式3：内部 _value 属性
  try {
    if (pos._value && typeof pos._value.x === 'number') {
      return pos._value;
    }
  } catch(e) {}
  return null;
}

class DroneHud {
  constructor() {
    this._visible = false;
    this._lastDomUpdate = 0;
    this._domThrottleMs = 150;
    this._clockTimer = null;
    this._batteryTimer = null;
    this._batteryLevel = 85;
    this._targetPosition = null;   // Cartesian3 | null
    this._dronePosition = null;    // Cartesian3 | null
    this._targetFireData = null;   // { name, position } 用户选中的火点
    this._radarAnimId = null;
    this._radarAngle = 0;
    this._radarLastTime = 0;
    this._prevHeading = 0;
    this._sceneLabels = [];   // 场景中火点距离标注实体
    this._targetFireEntity = null;  // 3D场景中目标火点的标记Entity
    this._targetFireBeacon = null;  // 3D场景中目标火点的光柱Entity

    var $ = function (id) { return document.getElementById(id); };
    this._els = {
      hud:        $('droneHud'),
      time:       $('hudTime'),
      battery:    $('hudBattery'),
      fps:        $('hudFps'),
      gps:        $('hudGps'),
      linkDot:    $('hudLinkDot'),
      lightBatt:  $('hudLightBatt'),
      lightLink:  $('hudLightLink'),
      lightObs:   $('hudLightObs'),
      compass:    $('hudCompass'),
      compStrip:  $('hudCompassStrip'),
      attHorizon: $('hudAttitudeHorizon'),
      radarCanv:  $('hudRadarCanvas'),
      alt:        $('hudAlt'),
      spd:        $('hudSpd'),
      vs:         $('hudVs'),
      hdg:        $('hudHdg'),
      pitch:      $('hudPitch'),
      dist:       $('hudDist'),
      gpsStatus:  $('hudGpsStatus'),
      fire:       $('hudFire'),
      fireDist:   $('hudFireDist'),
      fireDir:    $('hudFireDir'),
      intensity:  $('hudIntensity'),
      spread:     $('hudSpread'),
      wind:       $('hudWind'),
      ambTemp:    $('hudAmbTemp'),
      fireTemp:   $('hudFireTemp'),
      eta:        $('hudEta'),
      bldName:    $('hudBuildingName'),
      bldType:    $('hudBuildingType'),
      bldDist:    $('hudBuildingDist'),
      bldEta:     $('hudBuildingEta'),
      fireModal:  $('hudFireModal'),
      fireBackdrop: $('hudFireBackdrop'),
      fireModalList: $('hudFireModalList'),
      fireModalCancel: $('hudFireModalCancel'),
      fireModalConfirm: $('hudFireModalConfirm')
    };

    this._initRadarCanvas();
  }

  // ===== 显隐 =====
  show() {
    if (this._visible) return;
    this._visible = true;
    if (this._els.hud) this._els.hud.classList.add('active');
    this._startClock();
    this._startBatterySim();
    this._startRadar();
    this._fillSimulated();
    this._createExitButton();
    console.log('DroneHud — 指挥界面已开启');
  }

  hide() {
    if (!this._visible) return;
    this._visible = false;
    if (this._els.hud) this._els.hud.classList.remove('active');
    this._stopClock();
    this._stopBatterySim();
    this._stopRadar();
    this._resetAll();
    this._closeFireModal();
    this._removeExitButton();
    console.log('DroneHud — 指挥界面已关闭');
  }

  _createExitButton() {
    if (document.getElementById('hudExitBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'hudExitBtn';
    btn.textContent = '✕ 退出无人机视角';
    btn.style.cssText = 'position:fixed;top:112px;right:20px;z-index:99999;pointer-events:auto;'
      + 'background:rgba(220,38,38,0.85);color:#fff;border:none;border-radius:8px;'
      + 'padding:8px 18px;font-size:0.82rem;font-weight:700;cursor:pointer;'
      + 'box-shadow:0 2px 12px rgba(220,38,38,0.4);letter-spacing:0.5px;'
      + 'transition:all 0.2s ease;backdrop-filter:blur(8px);';
    btn.onmouseenter = function() { btn.style.background = 'rgba(239,68,68,0.95)'; };
    btn.onmouseleave = function() { btn.style.background = 'rgba(220,38,38,0.85)'; };
    btn.onclick = function() {
      if (droneController && droneController.enabled) {
        droneController.disable();
      }
    };
    document.body.appendChild(btn);
  }

  _removeExitButton() {
    var btn = document.getElementById('hudExitBtn');
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  }

  // ===== 飞行数据更新（由 DroneController._onTick 调用，内部 150ms 节流） =====
  updateFlightData(data) {
    if (!this._visible) return;

    var now = performance.now();

    // FPS（使用 droneMode 计算的真实帧率）
    if (data.fps > 0 && this._els.fps) this._els.fps.textContent = data.fps;

    // 每帧更新位置和航向（雷达绘制需要实时数据，不能受DOM节流影响）
    this._dronePosition = data.position;
    this._prevHeading = data.heading;

    if (now - this._lastDomUpdate < this._domThrottleMs) return;
    this._lastDomUpdate = now;

    // -- 左侧面板 --
    if (this._els.alt)   this._els.alt.textContent   = data.altitude.toFixed(0);
    if (this._els.spd)   this._els.spd.textContent   = data.speed;
    if (this._els.vs) {
      var vsVal = data.vs || 0;
      var vsAbs = Math.abs(vsVal).toFixed(1);
      this._els.vs.textContent = (vsVal >= 0 ? '+' : '-') + vsAbs;
      this._els.vs.parentElement.classList.remove('hud-vs-positive', 'hud-vs-negative');
      if (vsVal > 0.1) this._els.vs.parentElement.classList.add('hud-vs-positive');
      else if (vsVal < -0.1) this._els.vs.parentElement.classList.add('hud-vs-negative');
    }
    if (this._els.hdg)   this._els.hdg.textContent   = (data.heading * 180 / Math.PI % 360).toFixed(0);
    if (this._els.pitch) this._els.pitch.textContent = (data.pitch * 180 / Math.PI).toFixed(1);
    if (this._els.gpsStatus) {
      this._els.gpsStatus.textContent = (typeof HUD_CONFIG !== 'undefined' ? '12 颗' : '12 颗') + ' ✓';
    }

    // -- 罗盘条 --
    this._updateCompass(data.heading);

    // -- 人工水平仪 --
    this._updateAttitude(data.pitch);

    // -- 状态灯 --
    this._updateStatusLights();

    // -- 目标火点距离 + 方位 + ETA --
    this._updateFireTargetInfo();

    // -- 底部卡片距离 + ETA --
    this._updateDistance();

    // -- 场景火点距离标注 --
    this._updateSceneLabels();
  }

  // ===== 火点选择弹窗 =====
  selectFirePoint(callback) {
    var self = this;

    // 安全回调：确保至多调用一次
    var cbFired = false;
    function safeCallback(data) {
      if (cbFired) return;
      cbFired = true;
      if (callback) callback(data);
    }

    var modal = this._els.fireModal;
    var list = this._els.fireModalList;
    if (!modal || !list) {
      safeCallback(null);
      return;
    }

    // 获取火点列表
    var fires = [];
    if (typeof fireList !== 'undefined' && fireList.length > 0) {
      fires = fireList;
    } else if (typeof poiEntities !== 'undefined' && poiEntities.firepoint) {
      poiEntities.firepoint.forEach(function(e) {
        if (e._poiData) fires.push({ fireId: e._poiData.name, fireScene: e._poiData.name });
      });
    }

    if (fires.length === 0) {
      // 无火点数据，直接回调 null（允许进入但不选中）
      safeCallback(null);
      return;
    }

    // 弹窗已打开则先关闭
    this._closeFireModal();
    this._fireModalCallback = safeCallback;
    this._fireModalSelection = fires[0].fireId;

    var html = '';
    fires.forEach(function(f) {
      html += '<div class="hud-fire-modal-item" data-fire-id="' + f.fireId + '" data-fire-scene="' + (f.fireScene || '') + '">' +
        '<span class="fire-radio"></span>' +
        '<span class="fire-name">' + (f.fireScene || ('Fire-' + f.fireId)) + '</span>' +
        '<span class="fire-scene">ID:' + f.fireId + '</span></div>';
    });
    list.innerHTML = html;

    // 默认选中第一个
    var firstItem = list.querySelector('.hud-fire-modal-item');
    if (firstItem) firstItem.classList.add('selected');

    // 点击选中
    list.querySelectorAll('.hud-fire-modal-item').forEach(function(item) {
      item.addEventListener('click', function() {
        list.querySelectorAll('.hud-fire-modal-item').forEach(function(i) { i.classList.remove('selected'); });
        item.classList.add('selected');
        self._fireModalSelection = parseInt(item.getAttribute('data-fire-id'));
      });
    });

    // 确认按钮
    var confirmBtn = self._els.fireModalConfirm;
    var cancelBtn = self._els.fireModalCancel;
    var onConfirm = function() {
      var selId = self._fireModalSelection;
      var selScene = '';
      var selItem = list.querySelector('.hud-fire-modal-item.selected');
      if (selItem) selScene = selItem.getAttribute('data-fire-scene') || '';
      var cb = self._fireModalCallback;  // 先保存，_closeFireModal 会置 null
      self._closeFireModal();
      if (cb) cb({ fireId: selId, fireScene: selScene });
    };
    var onCancel = function() {
      var cb = self._fireModalCallback;
      self._closeFireModal();
      if (cb) cb(null);
    };
    confirmBtn.onclick = onConfirm;
    cancelBtn.onclick = onCancel;

    // 按 Escape 关闭
    var onKey = function(e) {
      if (e.key === 'Escape') { onCancel(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
    self._fireModalKeyHandler = onKey;

    // 显示遮罩 + 弹窗
    if (self._els.fireBackdrop) self._els.fireBackdrop.classList.add('open');
    modal.classList.add('open');
  }

  _closeFireModal() {
    var modal = this._els.fireModal;
    if (modal) modal.classList.remove('open');
    if (this._els.fireBackdrop) this._els.fireBackdrop.classList.remove('open');
    if (this._els.fireModalConfirm) this._els.fireModalConfirm.onclick = null;
    if (this._els.fireModalCancel) this._els.fireModalCancel.onclick = null;
    if (this._fireModalKeyHandler) { document.removeEventListener('keydown', this._fireModalKeyHandler); this._fireModalKeyHandler = null; }
    this._fireModalCallback = null;
  }

  setTargetFire(fireData, firePosition) {
    this._targetFireData = fireData;
    this._targetFirePosition = firePosition || null;
    if (this._els.fire && fireData) {
      this._els.fire.textContent = fireData.fireScene || fireData.name || '--';
    }
    this._updateFireTargetInfo();

    // 在3D实景地图中标注目标火点
    this._updateTargetFireEntity();
  }

  _updateTargetFireEntity() {
    // 先清除旧标记
    this._removeTargetFireEntity();

    if (!viewer) {
      console.warn('DroneHud — viewer 未就绪，无法创建火点标记');
      return;
    }

    // 查找位置：传入位置 → 按名称全局查找 → 回退坐标表
    var pos = this._targetFirePosition;
    if (!pos && this._targetFireData) {
      var name = this._targetFireData.fireScene || this._targetFireData.name;
      console.log('DroneHud — 查找火点位置: ' + name);
      pos = getFirePositionByName(name);
    }
    // 兜底：如果还是没有位置，取 fireList 第一个可用回退坐标
    if (!pos && typeof fireList !== 'undefined' && fireList.length > 0) {
      pos = getFirePositionByName(fireList[0].fireScene);
    }

    if (!pos) {
      console.warn('DroneHud — 无法获取火点位置，跳过3D标记');
      return;
    }

    console.log('DroneHud — 正在创建3D目标火点标记, position=', pos);

    try {
      // 简单粗暴的点标记 — 最可靠，不依赖复杂图形API
      this._targetFireEntity = viewer.entities.add({
        position: pos,
        point: {
          pixelSize: 18,
          color: SuperMap3D.Color.RED,
          outlineColor: SuperMap3D.Color.WHITE,
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: '🎯 目标: ' + (this._targetFireData ? (this._targetFireData.fireScene || this._targetFireData.name || '火点') : '火点'),
          font: 'bold 20px "Microsoft YaHei",sans-serif',
          fillColor: SuperMap3D.Color.RED,
          outlineColor: SuperMap3D.Color.WHITE,
          outlineWidth: 4,
          style: SuperMap3D.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new SuperMap3D.Cartesian2(0, -28),
          horizontalOrigin: SuperMap3D.HorizontalOrigin.CENTER,
          verticalOrigin: SuperMap3D.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scale: 1.0
        }
      });
      console.log('DroneHud — ✅ 3D目标火点标记已创建');
    } catch(e) {
      console.error('DroneHud — 创建目标火点标记失败:', e.message, e.stack);
    }
  }

  _removeTargetFireEntity() {
    if (this._targetFireEntity) {
      try { viewer.entities.remove(this._targetFireEntity); } catch(e) {}
      this._targetFireEntity = null;
    }
    if (this._targetFireBeacon) {
      try { viewer.entities.remove(this._targetFireBeacon); } catch(e) {}
      this._targetFireBeacon = null;
    }
  }

  // ===== 任务态势填充 =====
  setMissionFire(fireName, riskLabel, spreadEstimate, stationCount) {
    var els = this._els;
    if (els.fire && !this._targetFireData) els.fire.textContent = fireName || '--';
    if (els.spread)   els.spread.textContent   = spreadEstimate || '--';
    if (els.stations) els.stations.textContent = stationCount != null ? stationCount + ' 处' : '--';
  }

  // ===== 目标建筑（由 riskLayer.js 点击选中时调用） =====
  setTargetBuilding(name, typeLabel, position) {
    var els = this._els;
    if (els.bldName) els.bldName.textContent = name || '未选中';
    if (els.bldType) els.bldType.textContent = typeLabel || '--';
    this._targetPosition = position || null;
    this._updateDistance();
  }

  // ===== 自动扫描周边（进入无人机模式时调用） =====
  autoScanMission(dronePosition) {
    var searchRadius = 5000;
    var nearbyFirepoints = [];
    var nearbyStations = [];
    var nearbyRisks = [];

    if (typeof poiEntities !== 'undefined') {
      for (var cat in poiEntities) {
        var entities = poiEntities[cat];
        if (!entities) continue;
        for (var i = 0; i < entities.length; i++) {
          var entity = entities[i];
          if (!entity.show) continue;
          try {
            var pos = safeGetEntityPosition(entity);
            if (!pos) continue;
            var dist = SuperMap3D.Cartesian3.distance(dronePosition, pos);
            if (dist <= searchRadius) {
              var item = {
                name: (entity._poiData && entity._poiData.name) || '未知',
                distance: dist,
                position: pos,
                entity: entity
              };
              if (cat === 'firepoint') nearbyFirepoints.push(item);
              else if (cat === 'firestation') nearbyStations.push(item);
            }
          } catch (e) {}
        }
      }
    }

    // MySQL 不可用时，从 fireList + 静态坐标回退表创建虚拟火点
    if (nearbyFirepoints.length === 0 && typeof fireList !== 'undefined' && fireList.length > 0) {
      console.log('DroneHud — poiEntities 为空，使用 FALLBACK 火点数据');
      for (var fi = 0; fi < fireList.length; fi++) {
        var fName = fireList[fi].fireScene;
        var fPos = getFirePositionByName(fName);
        if (!fPos) continue;
        try {
          var fDist = SuperMap3D.Cartesian3.distance(dronePosition, fPos);
          if (fDist <= searchRadius) {
            nearbyFirepoints.push({
              name: fName,
              distance: fDist,
              position: fPos,
              entity: null
            });
          }
        } catch(e) {}
      }
    }

    if (typeof riskEntities !== 'undefined') {
      for (var r = 0; r < riskEntities.length; r++) {
        var re = riskEntities[r];
        if (!re.show) continue;
        try {
          var hierarchy = re.polygon ? re.polygon.hierarchy.getValue() : null;
          if (hierarchy && hierarchy.positions && hierarchy.positions.length > 0) {
            var positions = hierarchy.positions;
            var cx = 0, cy = 0, cz = 0;
            for (var p = 0; p < positions.length; p++) {
              cx += positions[p].x; cy += positions[p].y; cz += positions[p].z;
            }
            var center = new SuperMap3D.Cartesian3(cx / positions.length, cy / positions.length, cz / positions.length);
            var rDist = SuperMap3D.Cartesian3.distance(dronePosition, center);
            if (rDist <= searchRadius) {
              nearbyRisks.push({
                entity: re,
                name: (re._riskData && re._riskData.buildingType) || '建筑',
                riskLabel: (re._riskData && re._riskData.riskLabel) || '未知',
                riskValue: (re._riskData && re._riskData.riskValue) || 0,
                distance: rDist,
                position: center
              });
            }
          }
        } catch (e) {}
      }
    }

    nearbyFirepoints.sort(function (a, b) { return a.distance - b.distance; });
    nearbyStations.sort(function (a, b) { return a.distance - b.distance; });
    nearbyRisks.sort(function (a, b) { return a.distance - b.distance; });

    var nearestFire = nearbyFirepoints[0];
    var nearestRisk = nearbyRisks[0];

    // 右侧面板：任务态势
    this.setMissionFire(
      nearestFire ? nearestFire.name : '未发现',
      nearestRisk ? nearestRisk.riskLabel : '未知',
      this._estimateSpread(nearestRisk),
      nearbyStations.length
    );

    // 自动设置目标火点（仅当用户未手动选择时）
    if (nearestFire && !this._targetFireData) {
      this.setTargetFire(
        { fireId: -1, fireScene: nearestFire.name, name: nearestFire.name },
        nearestFire.position
      );
    }

    // 底部卡片
    if (nearestRisk) {
      this.setTargetBuilding(
        nearestRisk.name,
        nearestRisk.riskLabel + ' (' + nearestRisk.riskValue.toFixed(0) + '分)',
        nearestRisk.position
      );
    } else if (nearestFire) {
      this.setTargetBuilding(nearestFire.name, '火点', nearestFire.position);
    }

    // 将扫描结果缓存供雷达使用
    this._nearbyFirepoints = nearbyFirepoints;
    this._nearbyStations = nearbyStations;
    this._nearbyRisks = nearbyRisks;

    // 创建场景中火点距离标注
    this._createSceneLabels();

    console.log('DroneHud 自动扫描: 火点' + nearbyFirepoints.length + ' | 消防站' + nearbyStations.length + ' | 风险建筑' + nearbyRisks.length);
  }

  // ===== 场景距离标注（直接附加到火点 POI 实体，确保在 S3M 上方可见） =====
  _createSceneLabels() {
    this._removeSceneLabels();

    if (this._nearbyFirepoints) {
      for (var i = 0; i < this._nearbyFirepoints.length; i++) {
        var fp = this._nearbyFirepoints[i];
        if (!fp.entity) continue;
        try {
          // 气泡式信息标注，紧邻火点符号右侧
          fp.entity.label = {
            text: '  ' + Math.round(fp.distance) + 'm  ',
            font: 'bold 13px "Microsoft YaHei",sans-serif',
            fillColor: SuperMap3D.Color.WHITE,
            outlineColor: SuperMap3D.Color.fromCssColorString('#cc0000'),
            outlineWidth: 2,
            style: SuperMap3D.LabelStyle.FILL_AND_OUTLINE,
            backgroundColor: new SuperMap3D.Color(0.13, 0.13, 0.13, 0.85),
            backgroundPadding: new SuperMap3D.Cartesian2(10, 6),
            pixelOffset: new SuperMap3D.Cartesian2(22, -20),
            horizontalOrigin: SuperMap3D.HorizontalOrigin.LEFT,
            verticalOrigin: SuperMap3D.VerticalOrigin.CENTER,
            scaleByDistance: new SuperMap3D.NearFarScalar(100, 1.2, 3000, 0.5),
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          };
          fp.entity._hasDroneLabel = true;
        } catch (e) {}
      }
    }
  }

  _updateSceneLabels() {
    if (!this._dronePosition) return;
    if (this._nearbyFirepoints) {
      for (var i = 0; i < this._nearbyFirepoints.length; i++) {
        var fp = this._nearbyFirepoints[i];
        if (!fp.entity || !fp.entity._hasDroneLabel) continue;
        try {
          var dist = SuperMap3D.Cartesian3.distance(this._dronePosition, fp.position);
          fp.entity.label.text = Math.round(dist) + 'm';
        } catch (e) {}
      }
    }
  }

  _removeSceneLabels() {
    // 清除附加在火点实体上的 label
    if (this._nearbyFirepoints) {
      for (var i = 0; i < this._nearbyFirepoints.length; i++) {
        var fp = this._nearbyFirepoints[i];
        if (fp.entity && fp.entity._hasDroneLabel) {
          try { fp.entity.label = undefined; } catch (e) {}
          fp.entity._hasDroneLabel = false;
        }
      }
    }
    // 同时清理旧版遗留的新建实体（如果有）
    for (var j = 0; j < this._sceneLabels.length; j++) {
      try { viewer.entities.remove(this._sceneLabels[j]); } catch (e) {}
    }
    this._sceneLabels = [];
  }

  // ===== 方向计算 =====
  calculateDirection(fromPos, toPos) {
    if (!fromPos || !toPos) return '--';
    try {
      var cartoFrom = SuperMap3D.Cartographic.fromCartesian(fromPos);
      var cartoTo   = SuperMap3D.Cartographic.fromCartesian(toPos);
      var dLng = cartoTo.longitude - cartoFrom.longitude;
      var dLat = cartoTo.latitude - cartoFrom.latitude;
      var angle = Math.atan2(dLng, dLat) * 180 / Math.PI;
      if (angle < 0) angle += 360;
      var dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
      var idx = Math.round(angle / 45) % 8;
      return dirs[idx];
    } catch (e) { return '--'; }
  }

  calculateETA(distanceM) {
    var cruiseSpeed = (typeof HUD_CONFIG !== 'undefined') ? HUD_CONFIG.cruiseSpeed : 20;
    var seconds = distanceM / cruiseSpeed;
    if (seconds < 60) return Math.round(seconds) + ' 秒';
    return (seconds / 60).toFixed(1) + ' 分';
  }

  // ===== 内部 =====
  _fillSimulated() {
    var els = this._els;
    if (els.intensity) els.intensity.textContent = (typeof HUD_CONFIG !== 'undefined') ? HUD_CONFIG.fireIntensity : 'Ⅱ级';
    if (els.wind)      els.wind.textContent      = (typeof HUD_CONFIG !== 'undefined') ? HUD_CONFIG.windSpeed : '4.2 m/s';
    if (els.spread)    els.spread.textContent    = (typeof HUD_CONFIG !== 'undefined') ? HUD_CONFIG.spreadDirection : '东北';
    if (els.ambTemp)   els.ambTemp.textContent   = (typeof HUD_CONFIG !== 'undefined') ? HUD_CONFIG.ambientTemp : '38 ℃';
    if (els.fireTemp)  els.fireTemp.textContent  = (typeof HUD_CONFIG !== 'undefined') ? HUD_CONFIG.fireSourceTemp : '216 ℃';
  }

  _updateFireTargetInfo() {
    var els = this._els;
    if (this._dronePosition && this._targetFirePosition) {
      var distM = SuperMap3D.Cartesian3.distance(this._dronePosition, this._targetFirePosition);
      if (els.fireDist) els.fireDist.textContent = Math.round(distM);
      if (els.fireDir)  els.fireDir.textContent  = this.calculateDirection(this._dronePosition, this._targetFirePosition);
      if (els.eta)      els.eta.textContent      = this.calculateETA(distM);
    }
  }

  _updateDistance() {
    var els = this._els;
    if (this._dronePosition && this._targetPosition) {
      var distM = SuperMap3D.Cartesian3.distance(this._dronePosition, this._targetPosition);
      if (els.dist)    els.dist.textContent    = Math.round(distM);
      if (els.bldDist) els.bldDist.textContent = Math.round(distM) + ' m';
      if (els.bldEta)  els.bldEta.textContent  = this.calculateETA(distM);
    }
  }

  _updateCompass(heading) {
    var strip = this._els.compStrip;
    if (!strip) return;
    // heading 弧度 → 度，每条刻度 30px 宽，360° = 1080px 总刻度宽度（36条）
    var headingDeg = (heading * 180 / Math.PI) % 360;
    if (headingDeg < 0) headingDeg += 360;
    // 让 N 的偏移对应 heading
    var offset = -(headingDeg / 10) * 30;
    // 取模限制滚动范围
    strip.style.transform = 'translateX(' + offset + 'px)';
  }

  _updateAttitude(pitch) {
    var horizon = this._els.attHorizon;
    if (!horizon) return;
    // pitch 弧度 → 移动水平线（+向上看 → 线往下移）
    var pitchDeg = pitch * 180 / Math.PI;
    var offset = pitchDeg * 2.5; // 每度 2.5px
    offset = Math.max(-70, Math.min(70, offset));
    horizon.style.top = (80 + offset) + 'px'; // 容器高 160px，中点 = 80px
  }

  _updateStatusLights() {
    var batt = this._batteryLevel;
    var lb = this._els.lightBatt;
    var ll = this._els.lightLink;
    var lo = this._els.lightObs;
    if (lb) {
      lb.className = 'hud-status-light ' + (batt <= 10 ? 'red' : batt <= 30 ? 'yellow' : 'green');
    }
    if (ll) ll.className = 'hud-status-light green'; // 通信始终正常
    if (lo) lo.className = 'hud-status-light green'; // 无障碍告警
  }

  // ===== 雷达 =====
  _initRadarCanvas() {
    // canvas 已存在于 HTML，构造函数中不操作
  }

  _startRadar() {
    var self = this;
    this._radarLastTime = performance.now();
    var animate = function(now) {
      if (!self._visible) { self._radarAnimId = null; return; }
      var dt = (now - self._radarLastTime) / 1000;
      self._radarLastTime = now;
      var sweepSpeed = (typeof HUD_CONFIG !== 'undefined') ? HUD_CONFIG.radarSweepSpeed : 2;
      self._radarAngle += (360 / sweepSpeed) * dt;
      if (self._radarAngle > 360) self._radarAngle -= 360;
      self._drawRadar();
      self._radarAnimId = requestAnimationFrame(animate);
    };
    this._radarAnimId = requestAnimationFrame(animate);
  }

  _stopRadar() {
    if (this._radarAnimId) { cancelAnimationFrame(this._radarAnimId); this._radarAnimId = null; }
  }

  _drawRadar() {
    var canvas = this._els.radarCanv;
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    var cx = w / 2;
    var cy = h / 2;
    var maxR = cx - 4;

    ctx.clearRect(0, 0, w, h);

    // 背景
    ctx.fillStyle = 'rgba(10,14,23,0.65)';
    ctx.beginPath(); ctx.arc(cx, cy, maxR, 0, Math.PI * 2); ctx.fill();

    // 同心圆
    for (var r = 1; r <= 3; r++) {
      var rr = maxR * r / 3;
      ctx.strokeStyle = 'rgba(0,180,220,0.12)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    }

    // 十字线
    ctx.strokeStyle = 'rgba(0,180,220,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx, cy - maxR); ctx.lineTo(cx, cy + maxR); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy); ctx.stroke();

    // POI 点（火点=红，消防站=橙，风险建筑=黄）
    var radarRadius = (typeof HUD_CONFIG !== 'undefined') ? HUD_CONFIG.radarRadius : 500;
    var self = this;
    var drawPoints = function(items, color, size) {
      if (!items || !items.length) return;
      if (!self._dronePosition) return;
      items.forEach(function(item) {
        if (!item.position) return;
        try {
          var cartoD = SuperMap3D.Cartographic.fromCartesian(item.position);
          var cartoR = SuperMap3D.Cartographic.fromCartesian(self._dronePosition);
          var dLng = cartoD.longitude - cartoR.longitude;
          var dLat = cartoD.latitude - cartoR.latitude;
          var dist = SuperMap3D.Cartesian3.distance(self._dronePosition, item.position);
          var angle = Math.atan2(dLng, dLat) - self._prevHeading;
          var rPx = (dist / radarRadius) * maxR;
          if (rPx > maxR) rPx = maxR;
          var px = cx + Math.sin(angle) * rPx;
          var py = cy - Math.cos(angle) * rPx;
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill();
        } catch (e) {}
      });
    };
    drawPoints(this._nearbyFirepoints, '#ef4444', 3);
    drawPoints(this._nearbyStations, '#f97316', 3);
    drawPoints(this._nearbyRisks, '#eab308', 2.5);

    // 扫描线
    var sweepRad = this._radarAngle * Math.PI / 180;
    var ex = cx + Math.cos(sweepRad) * maxR;
    var ey = cy + Math.sin(sweepRad) * maxR;
    var grad = ctx.createLinearGradient(cx, cy, ex, ey);
    grad.addColorStop(0, 'rgba(0,255,128,0.4)');
    grad.addColorStop(1, 'rgba(0,255,128,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();

    // 中心点
    ctx.fillStyle = '#00d4ff';
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();

    // 边框
    ctx.strokeStyle = 'rgba(0,180,220,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, maxR, 0, Math.PI * 2); ctx.stroke();
  }

  _estimateSpread(risk) {
    if (!risk) return '--';
    var map = { '低风险': '~60 min', '中低风险': '~45 min', '中风险': '~30 min', '中高风险': '~15 min', '高风险': '~5 min' };
    return map[risk.riskLabel] || '--';
  }

  _startClock() {
    var self = this;
    this._updateClock();
    this._clockTimer = setInterval(function () { self._updateClock(); }, 1000);
  }

  _updateClock() {
    if (this._els.time) {
      var d = new Date();
      this._els.time.textContent =
        ('0' + d.getHours()).slice(-2) + ':' +
        ('0' + d.getMinutes()).slice(-2) + ':' +
        ('0' + d.getSeconds()).slice(-2);
    }
  }

  _stopClock() { clearInterval(this._clockTimer); this._clockTimer = null; }

  _startBatterySim() {
    var self = this;
    if (this._els.battery) this._els.battery.textContent = this._batteryLevel;
    this._batteryTimer = setInterval(function () {
      if (self._batteryLevel > 5) self._batteryLevel -= 1;
      if (self._els.battery) self._els.battery.textContent = self._batteryLevel;
    }, 30000);
  }

  _stopBatterySim() { clearInterval(this._batteryTimer); this._batteryTimer = null; }

  _resetAll() {
    var els = this._els;
    ['alt','spd','vs','hdg','pitch','dist','gpsStatus',
     'fire','fireDist','fireDir','intensity','spread','wind','ambTemp','fireTemp','eta',
     'bldName','bldType','bldDist','bldEta',
     'fps'].forEach(function(k) {
      var el = els[k]; if (el) el.textContent = '--';
    });
    if (els.bldName) els.bldName.textContent = '未选中';
    if (els.battery) els.battery.textContent = this._batteryLevel;
    // 清除场景标注
    this._removeSceneLabels();
    // 清除3D目标火点标记
    this._removeTargetFireEntity();

    // 清除雷达点
    this._nearbyFirepoints = null;
    this._nearbyStations = null;
    this._nearbyRisks = null;
    this._targetPosition = null;
    this._targetFirePosition = null;
    this._targetFireData = null;
    this._dronePosition = null;
  }
}

// ===== 初始化 =====
function initDroneHud() {
  if (!droneHud) {
    droneHud = new DroneHud();
    console.log('DroneHud 已初始化');
  }
  return droneHud;
}

// 等待 DOM 解析完成再初始化（若已解析完成则立即执行）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDroneHud);
} else {
  initDroneHud();
}
