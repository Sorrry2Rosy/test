// ===== FlightPlanner + FlightExecutor — 无人机飞行路线规划与自动飞行 =====
// 以无人机当前实时位置为起始点，点击3D地图添加航点 → 设定参数 → 生成路线 → 自动飞行
// 复用 wwwroot/js/roaming.js 的 Roaming 类做路径动画

var flightPlanner = null;
var flightExecutor = null;

// ==================== FlightPlanner — 路线编辑面板 ====================
var FlightPlanner = function() {
  this._active = false;
  this._droneStartPos = null;    // 无人机起始位置（进入路线编辑时的实时位置）
  this._waypoints = [];           // 用户点击的航点 [{position: Cartesian3, lng, lat, alt}]
  this._clickHandler = null;
  this._polylineEntity = null;
  this._markerEntities = [];
  this._planName = '';
  this._params = {
    altitude: 100,   // 飞行高度 m
    speed: 20,       // 巡航速度 m/s
    radius: 300,     // 巡检半径 m
    smoothing: 'smooth'  // 'straight' | 'smooth'
  };
};

// 构建完整路径（起点 + 航点）
FlightPlanner.prototype.getFullPath = function() {
  if (!this._droneStartPos) return [];
  var all = [{
    position: this._droneStartPos.position.clone(),
    lng: this._droneStartPos.lng,
    lat: this._droneStartPos.lat,
    alt: this._droneStartPos.alt
  }];
  for (var i = 0; i < this._waypoints.length; i++) {
    all.push(this._waypoints[i]);
  }
  return all;
};

FlightPlanner.prototype.activate = function() {
  if (this._active) return;
  this._active = true;
  var self = this;
  this._ensurePanel();

  // 自动设置无人机当前位置为起始点
  this._captureDroneStart();

  // 绑定3D地图点击事件（只在非UI区域点击时添加航点）
  this._clickHandler = function(click) {
    if (!self._active) return;
    // 检查是否点击在UI面板上
    var panel = document.getElementById('flightPlanPanel');
    if (panel && panel.contains(click.target)) return;
    var cartesian = viewer.scene.pickPosition(click.position);
    if (!SuperMap3D.defined(cartesian)) return;
    self.addWaypoint(cartesian);
  };
  viewer.screenSpaceEventHandler.setInputAction(this._clickHandler, SuperMap3D.ScreenSpaceEventType.LEFT_CLICK);

  this._refreshPanel();
  console.log('FlightPlanner — 路线编辑已激活，起点=' + (this._droneStartPos ? '已捕获' : '未捕获'));
};

FlightPlanner.prototype.deactivate = function() {
  if (!this._active) return;
  this._active = false;
  if (this._clickHandler) {
    try { viewer.screenSpaceEventHandler.removeInputAction(SuperMap3D.ScreenSpaceEventType.LEFT_CLICK); } catch(e) {}
    this._clickHandler = null;
  }
  this._clearPolyline();
};

// 捕获无人机当前实时位置作为路线起点
FlightPlanner.prototype._captureDroneStart = function() {
  try {
    if (droneController && droneController.enabled && droneController._position) {
      var pos = droneController._position;
      var carto = SuperMap3D.Cartographic.fromCartesian(pos, SuperMap3D.Ellipsoid.WGS84);
      if (!carto) throw new Error('Cartographic 转换失败');
      var lng = SuperMap3D.Math.toDegrees(carto.longitude);
      var lat = SuperMap3D.Math.toDegrees(carto.latitude);
      var alt = (carto.height != null && !isNaN(carto.height)) ? carto.height : this._params.altitude;
      this._droneStartPos = {
        position: SuperMap3D.Cartesian3.clone(pos),
        lng: lng, lat: lat, alt: alt
      };
      console.log('FlightPlanner — 捕获无人机起点: ' + lng.toFixed(6) + ', ' + lat.toFixed(6) + ', alt=' + alt.toFixed(0));
    } else if (typeof viewer !== 'undefined' && viewer && viewer.camera) {
      var camPos = viewer.camera.position;
      var camCarto = SuperMap3D.Cartographic.fromCartesian(camPos, SuperMap3D.Ellipsoid.WGS84);
      if (!camCarto) throw new Error('相机 Cartographic 转换失败');
      var clng = SuperMap3D.Math.toDegrees(camCarto.longitude);
      var clat = SuperMap3D.Math.toDegrees(camCarto.latitude);
      var calt = (camCarto.height != null && !isNaN(camCarto.height)) ? camCarto.height : this._params.altitude;
      this._droneStartPos = {
        position: SuperMap3D.Cartesian3.clone(camPos),
        lng: clng, lat: clat, alt: calt
      };
      console.log('FlightPlanner — 使用相机位置作为起点: ' + clng.toFixed(6) + ', ' + clat.toFixed(6));
    } else {
      console.warn('FlightPlanner — 无法捕获起点: viewer/droneController 未就绪');
    }
  } catch(e) {
    console.error('FlightPlanner — 捕获起点失败:', e.message);
  }
};

FlightPlanner.prototype.refreshStartPoint = function() {
  this._captureDroneStart();
  this._drawPolyline();
  this._refreshPanel();
  this._drawPreviewMinimap();
};

FlightPlanner.prototype.addWaypoint = function(cartesian) {
  var carto = SuperMap3D.Cartographic.fromCartesian(cartesian);
  var lng = SuperMap3D.Math.toDegrees(carto.longitude);
  var lat = SuperMap3D.Math.toDegrees(carto.latitude);
  var alt = this._params.altitude;
  // 使用统一飞行高度
  cartesian = SuperMap3D.Cartesian3.fromDegrees(lng, lat, alt);

  this._waypoints.push({
    position: cartesian.clone(),
    lng: lng, lat: lat, alt: alt
  });

  this._drawPolyline();
  this._refreshPanel();
  this._drawPreviewMinimap();
  console.log('FlightPlanner — 添加航点 #' + this._waypoints.length + ': ' + lng.toFixed(6) + ', ' + lat.toFixed(6));
};

FlightPlanner.prototype.removeWaypoint = function(index) {
  if (index >= 0 && index < this._waypoints.length) {
    this._waypoints.splice(index, 1);
    this._drawPolyline();
    this._refreshPanel();
    this._drawPreviewMinimap();
  }
};

FlightPlanner.prototype.clearWaypoints = function() {
  this._waypoints = [];
  this._clearPolyline();
  this._refreshPanel();
  this._drawPreviewMinimap();
};

// 在3D场景中绘制完整路径（起点→航点1→航点2...）
FlightPlanner.prototype._drawPolyline = function() {
  this._clearPolyline();
  var fullPath = this.getFullPath();
  if (fullPath.length < 2) return;

  var positions = fullPath.map(function(wp) { return wp.position; });

  // 发光折线
  this._polylineEntity = viewer.entities.add({
    polyline: {
      positions: positions,
      material: new SuperMap3D.PolylineGlowMaterialProperty({
        glowPower: 0.35,
        color: SuperMap3D.Color.fromCssColorString('#00d4ff')
      }),
      width: 6,
      clampToGround: false
    }
  });

  // 航点标记（起点绿色，中间蓝色，终点红色）
  var self = this;
  fullPath.forEach(function(wp, i) {
    var isStart = (i === 0);
    var isEnd = (i === fullPath.length - 1);
    var color = isStart ? SuperMap3D.Color.LIME : isEnd ? SuperMap3D.Color.RED : SuperMap3D.Color.DODGERBLUE;
    var label = isStart ? '起' : '' + i;
    var entity = viewer.entities.add({
      position: wp.position,
      point: {
        pixelSize: isStart ? 10 : 8,
        color: color,
        outlineColor: SuperMap3D.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: label,
        font: 'bold 14px "Microsoft YaHei",sans-serif',
        fillColor: SuperMap3D.Color.WHITE,
        outlineColor: SuperMap3D.Color.BLACK,
        outlineWidth: 3,
        pixelOffset: new SuperMap3D.Cartesian2(0, -20),
        horizontalOrigin: SuperMap3D.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    self._markerEntities.push(entity);
  });
};

FlightPlanner.prototype._clearPolyline = function() {
  if (this._polylineEntity) {
    try { viewer.entities.remove(this._polylineEntity); } catch(e) {}
    this._polylineEntity = null;
  }
  for (var i = 0; i < this._markerEntities.length; i++) {
    try { viewer.entities.remove(this._markerEntities[i]); } catch(e) {}
  }
  this._markerEntities = [];
};

FlightPlanner.prototype._calculateStats = function() {
  var fullPath = this.getFullPath();
  if (fullPath.length < 2) return { totalDist: 0, eta: 0, wpCount: fullPath.length };
  var total = 0;
  for (var i = 1; i < fullPath.length; i++) {
    total += SuperMap3D.Cartesian3.distance(fullPath[i].position, fullPath[i - 1].position);
  }
  var etaSec = total / this._params.speed;
  return { totalDist: total, eta: etaSec, wpCount: fullPath.length };
};

FlightPlanner.prototype._drawPreviewMinimap = function() {
  var canvas = document.getElementById('fpMinimap');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(10,14,23,0.85)';
  ctx.fillRect(0, 0, w, h);

  var fullPath = this.getFullPath();
  if (fullPath.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '12px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(fullPath.length === 1 ? '起点已就绪，点击地图添加航点' : '请先进入无人机模式', w/2, h/2);
    ctx.textAlign = 'start';
    return;
  }

  // 计算边界
  var lngs = fullPath.map(function(w) { return w.lng; });
  var lats = fullPath.map(function(w) { return w.lat; });
  var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
  var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
  var pad = Math.max((maxLng - minLng) * 0.15, (maxLat - minLat) * 0.15, 0.0003);
  minLng -= pad; maxLng += pad; minLat -= pad; maxLat += pad;
  var lngRange = maxLng - minLng || 0.001;
  var latRange = maxLat - minLat || 0.001;

  var toX = function(lng) { return 10 + (lng - minLng) / lngRange * (w - 20); };
  var toY = function(lat) { return h - 10 - (lat - minLat) / latRange * (h - 20); };

  // 网格
  ctx.strokeStyle = 'rgba(0,180,220,0.1)';
  ctx.lineWidth = 0.5;
  for (var gx = 0; gx <= w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
  for (var gy = 0; gy <= h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

  // 折线
  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  fullPath.forEach(function(wp, i) {
    var x = toX(wp.lng), y = toY(wp.lat);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 航点标记
  var self = this;
  fullPath.forEach(function(wp, i) {
    var x = toX(wp.lng), y = toY(wp.lat);
    var isStart = (i === 0);
    var isEnd = (i === fullPath.length - 1);
    var color = isStart ? '#22c55e' : isEnd ? '#ef4444' : '#3b82f6';
    var r = isStart ? 5 : 4;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '9px "Consolas",monospace';
    ctx.fillText(isStart ? '起' : ('' + i), x + 6, y + 3);
  });
};

// ===== 面板刷新 =====
FlightPlanner.prototype._ensurePanel = function() {
  var panel = document.getElementById('flightPlanPanel');
  if (panel) { this._panel = panel; }
};

FlightPlanner.prototype._refreshPanel = function() {
  var fullPath = this.getFullPath();
  var stats = this._calculateStats();

  // 起点信息
  var startEl = document.getElementById('fpStartInfo');
  if (startEl && this._droneStartPos) {
    startEl.innerHTML = '<span style="color:#22c55e">●</span> 起点: ' +
      this._droneStartPos.lng.toFixed(4) + ', ' + this._droneStartPos.lat.toFixed(4) +
      ' | alt=' + this._droneStartPos.alt.toFixed(0) + 'm';
  }

  // 航点列表
  var list = document.getElementById('fpWaypointList');
  if (list) {
    if (this._waypoints.length === 0) {
      list.innerHTML = '<div style="color:#94a3b8;font-size:0.78rem;padding:8px;text-align:center">点击3D地图添加航点</div>';
    } else {
      var self = this;
      list.innerHTML = this._waypoints.map(function(wp, i) {
        return '<div class="fp-waypoint-item">' +
          '<span class="fp-wp-idx">' + (i + 1) + '</span>' +
          '<span class="fp-wp-coord">' + wp.lng.toFixed(4) + ', ' + wp.lat.toFixed(4) + '</span>' +
          '<span class="fp-wp-alt">' + wp.alt.toFixed(0) + 'm</span>' +
          '<button class="fp-wp-del" onclick="flightPlanner.removeWaypoint(' + i + ')">✕</button>' +
          '</div>';
      }).join('');
    }
  }

  // 统计
  var distEl = document.getElementById('fpTotalDist');
  var etaEl = document.getElementById('fpEta');
  if (distEl) distEl.textContent = stats.totalDist > 0 ? (stats.totalDist / 1000).toFixed(2) + ' km' : '--';
  if (etaEl) {
    var eta = stats.eta;
    etaEl.textContent = eta > 0 ? (eta < 60 ? Math.round(eta) + ' 秒' : (eta / 60).toFixed(1) + ' 分') : '--';
  }

  // 按钮状态（至少1个航点即可飞行，因为起点已自动设置）
  var flyBtn = document.getElementById('fpStartFlyBtn');
  if (flyBtn) flyBtn.disabled = (this._waypoints.length < 1 || !this._droneStartPos);
};

// ===== 参数更新 =====
FlightPlanner.prototype.updateParam = function(key, value) {
  this._params[key] = value;
  if (key === 'altitude') {
    // 更新所有航点高度
    for (var i = 0; i < this._waypoints.length; i++) {
      var wp = this._waypoints[i];
      wp.alt = Number(value);
      wp.position = SuperMap3D.Cartesian3.fromDegrees(wp.lng, wp.lat, Number(value));
    }
    this._drawPolyline();
  }
  this._refreshPanel();
};

// ===== 持久化 =====
FlightPlanner.prototype.savePlan = function() {
  var name = this._planName || 'plan_' + new Date().toISOString().slice(0, 16).replace('T', '_');
  var plan = {
    name: name,
    timestamp: Date.now(),
    params: Object.assign({}, this._params),
    droneStart: this._droneStartPos ? { lng: this._droneStartPos.lng, lat: this._droneStartPos.lat, alt: this._droneStartPos.alt } : null,
    waypoints: this._waypoints.map(function(wp) { return { lng: wp.lng, lat: wp.lat, alt: wp.alt }; })
  };
  try {
    var plans = JSON.parse(localStorage.getItem('drone_flight_plans') || '[]');
    plans.unshift(plan);
    if (plans.length > 20) plans = plans.slice(0, 20);
    localStorage.setItem('drone_flight_plans', JSON.stringify(plans));
    showToast('路线已保存: ' + name);
  } catch(e) { console.warn('保存路线失败:', e); }
};

FlightPlanner.prototype.loadPlan = function(index) {
  try {
    var plans = JSON.parse(localStorage.getItem('drone_flight_plans') || '[]');
    if (index < 0 || index >= plans.length) return;
    var plan = plans[index];
    this._planName = plan.name;
    this._params = plan.params;
    this.clearWaypoints();
    // 不恢复起点（使用当前无人机位置）
    this._captureDroneStart();
    // 恢复航点
    var self = this;
    plan.waypoints.forEach(function(wp) {
      var cartesian = SuperMap3D.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.alt || self._params.altitude);
      self._waypoints.push({ position: cartesian.clone(), lng: wp.lng, lat: wp.lat, alt: wp.alt || self._params.altitude });
    });
    this._drawPolyline();
    this._refreshPanel();
    this._drawPreviewMinimap();
    showToast('路线已加载: ' + plan.name);
  } catch(e) { console.warn('加载路线失败:', e); }
};

FlightPlanner.prototype.listPlans = function() {
  try { return JSON.parse(localStorage.getItem('drone_flight_plans') || '[]'); } catch(e) { return []; }
};

FlightPlanner.prototype.deletePlan = function(index) {
  try {
    var plans = JSON.parse(localStorage.getItem('drone_flight_plans') || '[]');
    if (index < 0 || index >= plans.length) return;
    var name = plans[index].name;
    plans.splice(index, 1);
    localStorage.setItem('drone_flight_plans', JSON.stringify(plans));
    showToast('已删除: ' + name);
  } catch(e) {}
};

// ╔══════════════════════════════════════════════════════════════════╗
// ║          建筑碰撞检测与路线避障引擎 (Collision Avoidance)        ║
// ║                                                                  ║
// ║  处理流程:                                                       ║
// ║  1. 提取 riskEntities 建筑多边形 → {质心, 半径}[]               ║
// ║  2. 逐段检测路径与建筑的最近距离                                 ║
// ║  3. 碰撞段生成垂直爬升→跨越→下降航点                            ║
// ║  4. 拼合完整安全路线 + 3D可视化                                 ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * 从全局 riskEntities 数组提取建筑简化数据
 *
 * 输入: riskEntities[] — riskLayer.js 加载的建筑风险分级多边形实体
 *       每个实体含 .polygon (PolygonGraphics) 和 ._riskData (风险元数据)
 *
 * 处理: 对每个可见建筑多边形:
 *       1. 读取 hierarchy.positions 得到顶点数组 (Cartesian3[])
 *       2. 计算质心 = 所有顶点坐标的平均值
 *       3. 计算包围半径 = 最远顶点到质心的距离 (用于快速圆形碰撞检测)
 *
 * 输出: [{ centroid: Cartesian3, radius: Number (米),
 *          riskLabel: String, riskValue: Number, entity: Entity }]
 *       按风险值降序排列 (高风险建筑优先)
 */
FlightPlanner.prototype._extractBuildingData = function() {
  var buildings = [];
  // riskEntities 可能在热力图加载后才可用；不可用时返回空数组
  if (typeof riskEntities === 'undefined' || !riskEntities.length) return buildings;

  for (var i = 0; i < riskEntities.length; i++) {
    var re = riskEntities[i];
    // 跳过被图层开关隐藏的建筑
    if (!re.show) continue;
    try {
      // 从 PolygonGraphics 中获取运行时几何数据
      var hierarchy = re.polygon ? re.polygon.hierarchy.getValue() : null;
      // 多边形至少需要3个顶点才能构成有效区域
      if (!hierarchy || !hierarchy.positions || hierarchy.positions.length < 3) continue;
      var positions = hierarchy.positions;

      // ---- 计算多边形质心 (算术平均法) ----
      var cx = 0, cy = 0, cz = 0;
      for (var p = 0; p < positions.length; p++) {
        cx += positions[p].x; cy += positions[p].y; cz += positions[p].z;
      }
      cx /= positions.length; cy /= positions.length; cz /= positions.length;
      var centroid = new SuperMap3D.Cartesian3(cx, cy, cz);

      // ---- 计算包围球半径 (质心到最远顶点的3D距离) ----
      var maxR = 0;
      for (var q = 0; q < positions.length; q++) {
        var d = SuperMap3D.Cartesian3.distance(centroid, positions[q]);
        if (d > maxR) maxR = d;
      }

      // 保留原始风险标签用于避障提示 (如 "高风险" / "中风险")
      buildings.push({
        centroid: centroid,
        radius: maxR,
        riskLabel: (re._riskData && re._riskData.riskLabel) || '未知',
        riskValue: (re._riskData && re._riskData.riskValue) || 0,
        entity: re
      });
    } catch(e) {}
  }
  return buildings;
};

/**
 * 计算点 (px, py) 到线段 AB 的最短距离 (纯2D算法)
 *
 * 数学原理: 参数化线段 P(t) = A + t·(B - A), t∈[0,1]
 *          点到线段距离 = |P - P(t*)|, 其中 t* = clamp((P-A)·(B-A) / |B-A|²)
 *
 * @param {Number} px, py — 待测点坐标
 * @param {Number} ax, ay — 线段起点
 * @param {Number} bx, by — 线段终点
 * @returns {Number} 最短距离 (与输入坐标同单位)
 */
FlightPlanner.prototype._pointToSegmentDist2D = function(px, py, ax, ay, bx, by) {
  // 线段向量 AB
  var dx = bx - ax, dy = by - ay;
  var lenSq = dx * dx + dy * dy;
  // 退化为点: A==B, 直接返回 PA 距离
  if (lenSq === 0) return Math.sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
  // 投影参数 t = (AP·AB) / |AB|², 钳制到 [0,1] 保证最近点在线段上
  var t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  // 线段上最近点坐标
  var nearX = ax + t * dx, nearY = ay + t * dy;
  return Math.sqrt((px - nearX) * (px - nearX) + (py - nearY) * (py - nearY));
};

/**
 * 检测一条路径段 (fromWP → toWP) 是否与建筑碰撞
 *
 * 算法:
 *   1. 将两端点和所有建筑质心从 ECEF 转为经纬度
 *   2. 经纬度差 × 每度米数 → 平面坐标 (小范围近似)
 *   3. 对每个建筑, 计算质心到路径段的2D距离
 *   4. 碰撞条件: 距离 < 建筑包围半径 + 安全巡检半径
 *
 * @param {Object} fromWP — 段起点 {position: Cartesian3, lng, lat, alt}
 * @param {Object} toWP   — 段终点
 * @param {Array} buildings — _extractBuildingData() 输出的建筑数组
 * @param {Number} safeDist — 安全巡检半径 (米, 来自用户参数)
 * @returns {Array} 碰撞列表 [{building, minDist, threshold}], 按距离升序
 */
FlightPlanner.prototype._checkSegmentCollisions = function(fromWP, toWP, buildings, safeDist) {
  var collisions = [];
  if (!buildings.length) return collisions;

  // ---- 坐标系转换: ECEF → WGS84 经纬度 (度) ----
  var fromCarto = SuperMap3D.Cartographic.fromCartesian(fromWP.position);
  var toCarto   = SuperMap3D.Cartographic.fromCartesian(toWP.position);
  var fx = SuperMap3D.Math.toDegrees(fromCarto.longitude);
  var fy = SuperMap3D.Math.toDegrees(fromCarto.latitude);
  var tx = SuperMap3D.Math.toDegrees(toCarto.longitude);
  var ty = SuperMap3D.Math.toDegrees(toCarto.latitude);

  // ---- 经纬度 → 平面米 (纬度余弦修正经度方向) ----
  var latMid = (fy + ty) / 2 * Math.PI / 180;
  var meterPerDegLng = 111320 * Math.cos(latMid);  // 经度每度对应米数
  var meterPerDegLat = 111320;                       // 纬度每度约111.32km

  for (var i = 0; i < buildings.length; i++) {
    var b = buildings[i];
    var bCarto = SuperMap3D.Cartographic.fromCartesian(b.centroid);
    var bx = SuperMap3D.Math.toDegrees(bCarto.longitude);
    var by = SuperMap3D.Math.toDegrees(bCarto.latitude);

    // 点到线段2D距离 (单位: 米)
    var distM = this._pointToSegmentDist2D(
      bx * meterPerDegLng, by * meterPerDegLat,   // 建筑质心 (米)
      fx * meterPerDegLng, fy * meterPerDegLat,   // 线段起点 (米)
      tx * meterPerDegLng, ty * meterPerDegLat    // 线段终点 (米)
    );

    // 碰撞判定: 路径到建筑质心的距离 < 建筑半径 + 安全间距
    var threshold = b.radius + safeDist;
    if (distM < threshold) {
      collisions.push({ building: b, minDist: distM, threshold: threshold });
    }
  }

  // 最近碰撞优先处理
  collisions.sort(function(a, b) { return a.minDist - b.minDist; });
  return collisions;
};

/**
 * 为单个碰撞建筑生成垂直避障航点 (↑爬升 → ↷跨越 → ↓下降)
 *
 * 避障策略 — "垂直跨越":
 *   无人机在建筑前方爬升到安全高度 (建筑半径×1.5 + 50m, 且不低于巡航高度)
 *   → 从建筑正上方飞越 → 在建筑后方降回原巡航高度
 *
 *   选择垂直而非水平绕行的原因:
 *   1. 无人机天然支持高度变化, 比水平绕行更节能
 *   2. 城市建筑密集区水平绕行可能引入新碰撞
 *   3. 视觉上更直观 (橙色避障段 vs 绿色正常段)
 *
 * @param {Object} fromWP — 段起点航点
 * @param {Object} toWP   — 段终点航点
 * @param {Object} collision — 碰撞信息 {building, minDist, threshold}
 * @param {Object} params — 飞行参数 {altitude, speed, radius}
 * @returns {Array} 3个避障航点 [{↑爬升点}, {↷跨越点}, {↓下降点}]
 */
FlightPlanner.prototype._generateAvoidanceForBuilding = function(fromWP, toWP, collision, params) {
  var b = collision.building;

  // ---- 获取建筑质心经纬度 ----
  var bCarto = SuperMap3D.Cartographic.fromCartesian(b.centroid);
  var bLng = SuperMap3D.Math.toDegrees(bCarto.longitude);
  var bLat = SuperMap3D.Math.toDegrees(bCarto.latitude);

  // ---- 计算安全跨越高度 ----
  // 取 max(用户设定巡航高度, 建筑半径×1.5+50m缓冲)
  // 确保即使巡航高度设得很低也能安全越过
  var safeAlt = Math.max(params.altitude, b.radius * 1.5 + 50);

  // ---- 计算建筑在路径段上的投影位置 ----
  var fromLng = fromWP.lng, fromLat = fromWP.lat;
  var toLng   = toWP.lng,   toLat   = toWP.lat;
  var dx = toLng - fromLng, dy = toLat - fromLat;
  var lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return [];  // 起点=终点, 跳过

  // t = 建筑质心在路径上的投影参数 (0~1)
  var t = ((bLng - fromLng) * dx + (bLat - fromLat) * dy) / lenSq;
  t = Math.max(0.1, Math.min(0.9, t));  // 避免贴到起终点

  // ---- 计算避障航点的位置参数 ----
  // 建筑前后各留 1.5倍建筑半径 作为水平安全缓冲
  var marginDeg = (b.radius / 111320) * 1.5;
  var tBefore = Math.max(0.02, t - marginDeg / Math.sqrt(lenSq || 0.000001));
  var tAfter  = Math.min(0.98, t + marginDeg / Math.sqrt(lenSq || 0.000001));

  // 建筑前/后的经纬度坐标
  var beforeLng = fromLng + dx * tBefore;
  var beforeLat = fromLat + dy * tBefore;
  var afterLng  = fromLng + dx * tAfter;
  var afterLat  = fromLat + dy * tAfter;

  var waypoints = [];

  // ① 爬升点: 建筑前方, 爬升到安全高度
  waypoints.push({
    lng: beforeLng, lat: beforeLat, alt: safeAlt,
    position: SuperMap3D.Cartesian3.fromDegrees(beforeLng, beforeLat, safeAlt),
    isAvoidance: true,
    label: '↑避障'  // 3D标注: 爬升开始
  });

  // ② 跨越点: 建筑正上方, 保持安全高度
  waypoints.push({
    lng: bLng, lat: bLat, alt: safeAlt,
    position: SuperMap3D.Cartesian3.fromDegrees(bLng, bLat, safeAlt),
    isAvoidance: true,
    label: '↷跨越 ' + b.riskLabel  // 3D标注: 显示建筑风险等级
  });

  // ③ 下降点: 建筑后方, 降回巡航高度
  waypoints.push({
    lng: afterLng, lat: afterLat, alt: params.altitude,
    position: SuperMap3D.Cartesian3.fromDegrees(afterLng, afterLat, params.altitude),
    isAvoidance: true,
    label: '↓恢复'  // 3D标注: 恢复正常巡航
  });

  return waypoints;
};

/**
 * 生成完整的安全飞行路线
 *
 * 这是避障引擎的主入口, 串联完整流程:
 *   getFullPath() → 逐段检测 → 碰撞段插入避障航点 → 返回 {原始路径, 碰撞详情, 安全路径}
 *
 * @returns {Object} {
 *   path:            原始航点数组 (不含避障点)
 *   collisions:      [{segment: 段号, from, to, collisions: [...]}]
 *   safePath:        插入避障航点后的完整安全路径
 *   buildingCount:   扫描到的建筑总数
 *   avoidedBuildings: 触发避障的建筑数 (0 = 路线完全安全)
 * }
 */
FlightPlanner.prototype.generateSafeRoute = function() {
  var fullPath = this.getFullPath();
  if (fullPath.length < 2) return { path: fullPath, collisions: [], safePath: fullPath };

  // Step 1: 提取建筑数据
  var buildings = this._extractBuildingData();
  if (!buildings.length) {
    return { path: fullPath, collisions: [], safePath: fullPath, msg: '无建筑数据，跳过碰撞检测' };
  }

  // Step 2: 逐段检测碰撞, 构建安全路径
  var safeDist = this._params.radius || 300;   // 安全巡检半径
  var allCollisions = [];                       // 收集所有碰撞段
  var safePath = [fullPath[0]];                 // 安全路径起点 = 原始起点

  for (var i = 1; i < fullPath.length; i++) {
    var fromWP = fullPath[i - 1];  // 段起点
    var toWP   = fullPath[i];      // 段终点

    // 对该段进行碰撞检测
    var segCollisions = this._checkSegmentCollisions(fromWP, toWP, buildings, safeDist);

    if (segCollisions.length === 0) {
      // 无碰撞: 原始航点直接加入安全路径
      safePath.push(toWP);
    } else {
      // 有碰撞: 记录并生成避障航点
      allCollisions.push({ segment: i, from: fromWP, to: toWP, collisions: segCollisions });

      // 只处理最近的碰撞 (一个段上可能有多个建筑, 取距离最近的那个)
      var primaryCollision = segCollisions[0];
      var avoidanceWPs = this._generateAvoidanceForBuilding(fromWP, toWP, primaryCollision, this._params);

      // 插入避障航点: ↑爬升 → ↷跨越 → ↓下降 → 原始目标
      for (var a = 0; a < avoidanceWPs.length; a++) {
        safePath.push(avoidanceWPs[a]);
      }
      safePath.push(toWP);  // 到达原始目标点 (注意: 下降后已在建筑后方)
    }
  }

  return {
    path: fullPath,
    collisions: allCollisions,
    safePath: safePath,
    buildingCount: buildings.length,
    avoidedBuildings: allCollisions.length
  };
};

/**
 * 在3D实景地图上绘制安全路线
 *
 * 视觉效果:
 *   - 有碰撞 → 橙色发光折线 (警示) + 避障航点标注 ↑↷↓
 *   - 无碰撞 → 绿色发光折线 (安全) + 常规航点标注 起/1/2/终
 *   - 避障航点: 橙色小圆点 (6px)
 *   - 正常航点: 起点绿(10px) / 中间蓝(8px) / 终点红(8px)
 *   - 全部航点 disableDepthTestDistance=∞ (不被地形遮挡)
 *
 * @param {Object} safeRoute — generateSafeRoute() 的输出
 */
FlightPlanner.prototype._drawSafeRoute = function(safeRoute) {
  // 先清除上次绘制的路线 (折线 + 标记点)
  this._clearPolyline();

  var fullPath = safeRoute.safePath || safeRoute.path;
  if (fullPath.length < 2) { this._drawPolyline(); return; }

  var self = this;

  // ---- 绘制折线 ----
  // 碰撞段用橙色警示, 安全段用绿色
  var positions = fullPath.map(function(wp) { return wp.position; });
  this._polylineEntity = viewer.entities.add({
    polyline: {
      positions: positions,
      material: new SuperMap3D.PolylineGlowMaterialProperty({
        glowPower: 0.35,
        color: (safeRoute.collisions && safeRoute.collisions.length > 0)
          ? SuperMap3D.Color.ORANGE    // 有碰撞 → 橙色警示线
          : SuperMap3D.Color.LIME       // 无碰撞 → 绿色安全线
      }),
      width: 6,
      clampToGround: false  // 保持在空中, 跟随航点高度
    }
  });

  // ---- 绘制航点标记 ----
  fullPath.forEach(function(wp, i) {
    var isStart     = (i === 0);                      // 路线起点
    var isEnd       = (i === fullPath.length - 1);    // 路线终点
    var isAvoidance = wp.isAvoidance;                  // 避障生成的中间航点

    // 颜色语义: 🟢起点 → 🔵途经 → 🟠避障 → 🔴终点
    var color = isStart     ? SuperMap3D.Color.LIME
      : isEnd       ? SuperMap3D.Color.RED
      : isAvoidance ? SuperMap3D.Color.ORANGE
      : SuperMap3D.Color.DODGERBLUE;

    var size  = isAvoidance ? 6 : (isStart ? 10 : 8);  // 避障点稍小
    var label = wp.label || (isStart ? '起' : isEnd ? '终' : ('' + i));

    var entity = viewer.entities.add({
      position: wp.position,
      point: {
        pixelSize: size,
        color: color,
        outlineColor: SuperMap3D.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY  // 永不遮挡
      },
      label: {
        text: label,
        font: 'bold 12px "Microsoft YaHei",sans-serif',
        fillColor: SuperMap3D.Color.WHITE,
        outlineColor: isAvoidance ? SuperMap3D.Color.ORANGE : SuperMap3D.Color.BLACK,
        outlineWidth: 3,
        pixelOffset: new SuperMap3D.Cartesian2(0, -20),
        horizontalOrigin: SuperMap3D.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    self._markerEntities.push(entity);  // 追踪以便后续清理
  });
};

// ==================== FlightExecutor — 自动飞行执行器 ====================
var FlightExecutor = function() {
  this._roaming = null;
  this._flying = false;
  this._paused = false;
  this._plan = null;
  this._progressTimer = null;
  this._onCompleteCallback = null;
};

FlightExecutor.prototype.start = function(plan, onComplete) {
  // plan = { waypoints: [...], params: {...} }
  if (!plan || !plan.waypoints || plan.waypoints.length < 1) {
    showToast('至少需要1个航点才能启动飞行');
    return;
  }
  if (typeof window.Roaming === 'undefined') {
    showToast('漫游模块未加载，无法执行自动飞行');
    return;
  }

  this._plan = plan;
  this._onCompleteCallback = onComplete || null;

  // 构建完整路径：当前无人机位置→航点
  var fullPath = [];
  if (droneController && droneController.enabled && droneController._position) {
    var startPos = droneController._position;
    var startCarto = SuperMap3D.Cartographic.fromCartesian(startPos);
    fullPath.push([
      SuperMap3D.Math.toDegrees(startCarto.longitude),
      SuperMap3D.Math.toDegrees(startCarto.latitude),
      startCarto.height || plan.params.altitude || 100
    ]);
  } else if (viewer && viewer.camera) {
    var camPos = viewer.camera.position;
    var camCarto = SuperMap3D.Cartographic.fromCartesian(camPos);
    fullPath.push([
      SuperMap3D.Math.toDegrees(camCarto.longitude),
      SuperMap3D.Math.toDegrees(camCarto.latitude),
      camCarto.height || plan.params.altitude || 100
    ]);
  }

  for (var i = 0; i < plan.waypoints.length; i++) {
    fullPath.push([plan.waypoints[i].lng, plan.waypoints[i].lat, plan.waypoints[i].alt || plan.params.altitude]);
  }

  if (fullPath.length < 2) {
    showToast('完整路径不足2个点，无法飞行');
    return;
  }

  console.log('FlightExecutor — 完整路径共 ' + fullPath.length + ' 个点');

  // 使用 Roaming 类做平滑路径动画
  var isInterpolation = !plan.params || plan.params.smoothing !== 'straight';
  var options = {
    data: fullPath,
    model: { url: '' },
    speed: (plan.params && plan.params.speed) || 20,
    isPathShow: true,
    isInterpolation: isInterpolation,
    perspectiveMode: 'FIRST',
    offset: new SuperMap3D.Cartesian3(0, 0, 8),
    multiplier: 1
  };

  try {
    // 先停止之前的漫游
    if (this._roaming) {
      this._roaming.removeRoaming();
      this._roaming = null;
    }

    this._roaming = new window.Roaming(viewer, options);
    this._roaming.createRoaming();

    // 挂起手动控制
    if (droneController && droneController.enabled) {
      droneController.suspendForAutoFlight();
    }

    this._flying = true;
    this._paused = false;
    this._startProgressTracking();
    showToast('自动飞行已启动，共 ' + fullPath.length + ' 个路径点');
    console.log('FlightExecutor — 自动飞行已启动');
  } catch(e) {
    console.error('FlightExecutor — 启动失败:', e);
    showToast('自动飞行启动失败: ' + e.message);
  }
};

FlightExecutor.prototype.pause = function() {
  if (!this._flying) return;
  this._paused = !this._paused;
  if (this._roaming) {
    this._roaming.pauseOrContinue(!this._paused);
    viewer.clock.shouldAnimate = !this._paused;
  }
  showToast(this._paused ? '飞行已暂停' : '飞行已继续');
};

FlightExecutor.prototype.stop = function() {
  if (!this._flying) return;
  this._flying = false;
  this._paused = false;
  this._stopProgressTracking();

  if (this._roaming) {
    this._roaming.removeRoaming();
    this._roaming = null;
  }

  // 恢复手动控制
  if (droneController && droneController.enabled) {
    droneController.resumeFromAutoFlight();
  }

  if (this._onCompleteCallback) {
    try { this._onCompleteCallback(); } catch(e) {}
    this._onCompleteCallback = null;
  }
  showToast('自动飞行已停止');
  console.log('FlightExecutor — 自动飞行已停止');
};

FlightExecutor.prototype._startProgressTracking = function() {
  var self = this;
  this._progressTimer = setInterval(function() {
    if (!self._flying || !viewer || !viewer.clock) return;
    var progBar = document.getElementById('fpProgressBar');
    var progText = document.getElementById('fpProgressText');
    if (!progBar) return;
    try {
      var start = viewer.clock.startTime;
      var stop = viewer.clock.stopTime;
      var now = viewer.clock.currentTime;
      var total = SuperMap3D.JulianDate.secondsDifference(stop, start);
      var elapsed = SuperMap3D.JulianDate.secondsDifference(now, start);
      if (total <= 0) return;
      var pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
      progBar.style.width = pct.toFixed(1) + '%';
      if (progText) progText.textContent = pct.toFixed(0) + '%';
      if (pct >= 99.9) {
        self.stop();
      }
    } catch(e) {}
  }, 200);
};

FlightExecutor.prototype._stopProgressTracking = function() {
  if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; }
  var progBar = document.getElementById('fpProgressBar');
  if (progBar) progBar.style.width = '0%';
  var progText = document.getElementById('fpProgressText');
  if (progText) progText.textContent = '0%';
};

// ===== 全局入口 =====

/**
 * 切换飞行路线面板的显示/隐藏
 *
 * 打开时: 激活 FlightPlanner (绑定3D地图点击事件, 捕获起点, 绘制面板)
 * 关闭时: 取消 FlightPlanner 激活态 (移除点击事件, 清除3D路线)
 */
function toggleFlightPlan() {
  if (!flightPlanner) flightPlanner = new FlightPlanner();
  if (!flightExecutor) flightExecutor = new FlightExecutor();

  var panel = document.getElementById('flightPlanPanel');
  if (!panel) return;

  var isOpen = panel.classList.contains('open');
  if (isOpen) {
    flightPlanner.deactivate();       // 移除地图点击事件 + 清除3D路线
    panel.classList.remove('open');   // 面板滑出
  } else {
    panel.classList.add('open');      // 面板滑入
    flightPlanner.activate();         // 绑定点击事件 + 捕获起始位置
    flightPlanner._refreshPanel();    // 刷新航点列表/统计
    flightPlanner._drawPreviewMinimap();  // 刷新Canvas预览
    refreshSavedPlansList();          // 刷新已保存路线列表
  }
}

/**
 * 启动自动飞行 (核心入口)
 *
 * 执行流程:
 *   1. 检查前置条件 (规划器/执行器已创建, 未在飞行中)
 *   2. 调用 generateSafeRoute() 进行碰撞检测 + 避障航点生成
 *   3. 如有碰撞, 在3D地图上绘制安全路线 (橙色=避障段)
 *   4. 提取安全路径的航点 (跳过起点, 由执行器从无人机实时位置获取)
 *   5. 调用 FlightExecutor.start() 启动漫游飞行
 */
function startAutoFlight() {
  if (!flightPlanner || !flightExecutor) return;
  if (flightExecutor._flying) { showToast('飞行已在进行中'); return; }

  // 前置: 必须有起点+至少1个航点
  var fullPath = flightPlanner.getFullPath();
  if (fullPath.length < 2) {
    showToast('至少需要1个航点才能飞行（起点已自动设置）');
    return;
  }

  // ---- 碰撞检测 + 生成安全路线 ----
  var safeRoute = flightPlanner.generateSafeRoute();
  console.log('安全路线: 建筑数=' + safeRoute.buildingCount
    + ', 碰撞段=' + safeRoute.avoidedBuildings
    + ', 路径点数=' + safeRoute.safePath.length);

  if (safeRoute.avoidedBuildings > 0) {
    showToast('检测到 ' + safeRoute.avoidedBuildings + ' 处建筑碰撞，已自动添加避障航点');
    // 在3D地图上实时渲染安全路线 (橙色避障段 + 绿色安全段)
    flightPlanner._drawSafeRoute(safeRoute);
  }

  // ---- 构建执行器输入 ----
  // 使用安全路径 (如有碰撞则含避障航点, 否则等于原始路径)
  var finalPath = safeRoute.safePath || safeRoute.path;

  // 跳过 index=0 (起点), 执行器会从无人机/相机实时位置获取起点
  var execWaypoints = [];
  for (var w = 1; w < finalPath.length; w++) {
    execWaypoints.push(finalPath[w]);
  }

  // 启动漫游飞行
  flightExecutor.start({
    waypoints: execWaypoints,
    params: flightPlanner._params
  });
}

/**
 * 预览安全路线 (不启动飞行, 仅在3D地图上显示碰撞检测结果)
 *
 * 用户手动点击「🔍 检测碰撞」按钮时调用
 * 功能:
 *   1. 执行碰撞检测算法
 *   2. 在 fpCollisionInfo 区域显示检测结果 (✅安全 / ⚠碰撞 / ⚠无数据)
 *   3. 在3D地图上绘制安全路线
 */
function previewSafeRoute() {
  if (!flightPlanner) return;

  var fullPath = flightPlanner.getFullPath();
  if (fullPath.length < 2) {
    showToast('至少需要1个航点才能检测碰撞');
    return;
  }

  // 执行碰撞检测
  var safeRoute = flightPlanner.generateSafeRoute();

  // ---- 更新面板碰撞信息 ----
  var infoEl = document.getElementById('fpCollisionInfo');
  if (infoEl) {
    if (safeRoute.buildingCount === 0) {
      // 无建筑数据: riskEntities 未加载或为空 (热力图未打开 / MySQL未连)
      infoEl.innerHTML = '<span style="color:#94a3b8">⚠ 无建筑数据（riskEntities未加载）</span>';
    } else if (safeRoute.avoidedBuildings === 0) {
      // 安全: 所有路径段与建筑的最近距离均 > 安全阈值
      infoEl.innerHTML = '<span style="color:#22c55e">✅ 路线安全，' + safeRoute.buildingCount + ' 栋建筑均未碰撞</span>';
    } else {
      // 有碰撞: 已自动添加避障航点 (↑爬升 → ↷跨越 → ↓下降)
      infoEl.innerHTML = '<span style="color:#f59e0b">⚠ 检测到 ' + safeRoute.avoidedBuildings + ' 处碰撞，'
        + '安全路线含 ' + safeRoute.safePath.length + ' 个航点（原始' + safeRoute.path.length + '个）</span>';
    }
  }

  // ---- 3D地图渲染 ----
  // 橙色路线 = 含避障段, 绿色路线 = 完全安全
  flightPlanner._drawSafeRoute(safeRoute);
  showToast(safeRoute.avoidedBuildings > 0
    ? '已生成安全路线，橙色段为避障航点'
    : '路线安全，无碰撞风险');
}

function refreshSavedPlansList() {
  var listEl = document.getElementById('fpSavedPlansList');
  if (!listEl || !flightPlanner) return;
  var plans = flightPlanner.listPlans();
  if (plans.length === 0) {
    listEl.innerHTML = '<div style="color:#94a3b8;font-size:0.75rem;padding:6px">暂无保存的路线</div>';
  } else {
    listEl.innerHTML = plans.map(function(p, i) {
      var d = new Date(p.timestamp);
      return '<div class="fp-saved-item">' +
        '<span class="fp-saved-name">' + (p.name || '未命名') + '</span>' +
        '<span class="fp-saved-date">' + d.toLocaleDateString() + '</span>' +
        '<button class="fp-saved-load" onclick="flightPlanner.loadPlan(' + i + ');refreshSavedPlansList();">加载</button>' +
        '<button class="fp-saved-del" onclick="flightPlanner.deletePlan(' + i + ');refreshSavedPlansList();">删</button>' +
        '</div>';
    }).join('');
  }
}

// 初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    flightPlanner = new FlightPlanner();
    flightExecutor = new FlightExecutor();
  });
} else {
  flightPlanner = new FlightPlanner();
  flightExecutor = new FlightExecutor();
}
