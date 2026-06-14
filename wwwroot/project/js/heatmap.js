// ===== POI 密度热力图 =====
// Canvas 2D 热力渲染 + SingleTileImageryProvider 贴地显示
// 数据源：poiEntities 中的全部 POI（医院/商场/政府/消防站/起火点）

var heatmapLayer = null;
var heatmapEnabled = false;
var heatmapCanvas = document.createElement("canvas");
var heatmapCtx = heatmapCanvas.getContext("2d");
heatmapCanvas.width = 1024;
heatmapCanvas.height = 1024;

// 热力图配置
var HEAT_CONFIG = {
  radius: 45,
  maxWeight: 10,
  blurRatio: 0.85
};

// POI 类型 → 权重
var POI_WEIGHT = {
  firepoint: 10,
  hospital: 6,
  firestation: 5,
  government: 3,
  mall: 2
};

// 构建 256 级颜色查找表（蓝→青→绿→黄→橙→红）
function buildColorLUT() {
  var stops = [
    { t: 0.00, c: { r: 0,   g: 0,   b: 255, a: 0.0 } },   // 透明
    { t: 0.15, c: { r: 0,   g: 0,   b: 255, a: 0.5 } },   // 蓝
    { t: 0.35, c: { r: 0,   g: 255, b: 255, a: 0.7 } },   // 青
    { t: 0.50, c: { r: 0,   g: 255, b: 0,   a: 0.8 } },   // 绿
    { t: 0.70, c: { r: 255, g: 255, b: 0,   a: 0.9 } },   // 黄
    { t: 0.85, c: { r: 255, g: 128, b: 0,   a: 1.0 } },   // 橙
    { t: 1.00, c: { r: 255, g: 0,   b: 0,   a: 1.0 } }    // 红
  ];
  var lut = new Array(256);
  for (var i = 0; i < 256; i++) {
    var t = i / 255, lo = 0, hi = stops.length - 1;
    while (lo < hi - 1) { var mid = (lo + hi) >> 1; if (stops[mid].t <= t) lo = mid; else hi = mid; }
    var s0 = stops[lo], s1 = stops[hi];
    var r = s1.t === s0.t ? 0 : (t - s0.t) / (s1.t - s0.t);
    lut[i] = {
      r: Math.round(s0.c.r + (s1.c.r - s0.c.r) * r),
      g: Math.round(s0.c.g + (s1.c.g - s0.c.g) * r),
      b: Math.round(s0.c.b + (s1.c.b - s0.c.b) * r),
      a: Math.round((s0.c.a + (s1.c.a - s0.c.a) * r) * 255)
    };
  }
  return lut;
}
var colorLUT = buildColorLUT();

// 收集所有 POI 为热力数据
function collectHeatPoints() {
  var points = [];
  for (var cat in poiEntities) {
    var w = POI_WEIGHT[cat] || 1;
    (poiEntities[cat] || []).forEach(function(e) {
      if (!e._poiData || !e.position) return;
      var c = SuperMap3D.Cartographic.fromCartesian(e.position);
      points.push({
        lon: SuperMap3D.Math.toDegrees(c.longitude),
        lat: SuperMap3D.Math.toDegrees(c.latitude),
        weight: w,
        type: cat
      });
    });
  }
  return points;
}

// 计算地理边界（加 10% 边距）
function calcBounds(points) {
  if (points.length === 0) return { west: 113.8, south: 22.4, east: 114.1, north: 22.6 };
  var minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  points.forEach(function(p) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  });
  var padLon = (maxLon - minLon) * 0.1 || 0.02;
  var padLat = (maxLat - minLat) * 0.1 || 0.02;
  return { west: minLon - padLon, south: minLat - padLat, east: maxLon + padLon, north: maxLat + padLat };
}

// ===== 主渲染函数 =====

function renderHeatmap() {
  if (!viewer) return;

  var points = collectHeatPoints();
  if (points.length === 0) {
    console.warn("热力图: 无 POI 数据");
    return;
  }

  var bounds = calcBounds(points);
  var W = heatmapCanvas.width, H = heatmapCanvas.height;
  var ctx = heatmapCtx;
  ctx.clearRect(0, 0, W, H);

  var radius = HEAT_CONFIG.radius;

  // 1) 画所有 POI 径向渐变圆（黑色 + alpha = 密度）
  points.forEach(function(p) {
    var px = (p.lon - bounds.west) / (bounds.east - bounds.west) * W;
    var py = (p.lat - bounds.south) / (bounds.north - bounds.south) * H;
    var intensity = Math.min(p.weight / HEAT_CONFIG.maxWeight, 1.0);
    if (intensity < 0.01) return;

    var grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
    grad.addColorStop(0, "rgba(0,0,0," + intensity + ")");
    grad.addColorStop(HEAT_CONFIG.blurRatio, "rgba(0,0,0," + (intensity * 0.4) + ")");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
  });

  // 2) 颜色映射：alpha → 查找表颜色
  var imageData = ctx.getImageData(0, 0, W, H);
  var data = imageData.data;
  for (var i = 0; i < data.length; i += 4) {
    var a = data[i + 3];
    if (a < 3) { data[i + 3] = 0; continue; }
    var idx = a > 255 ? 255 : a;
    var c = colorLUT[idx];
    data[i] = c.r;
    data[i + 1] = c.g;
    data[i + 2] = c.b;
    data[i + 3] = c.a;
  }
  ctx.putImageData(imageData, 0, 0);

  // 3) 叠加到三维场景
  addHeatmapToGlobe(bounds);
}

// 将 canvas 贴到地球
function addHeatmapToGlobe(bounds) {
  // 移除旧图层
  if (heatmapLayer) {
    viewer.imageryLayers.remove(heatmapLayer);
    heatmapLayer = null;
  }

  var url = heatmapCanvas.toDataURL();
  try {
    // ★ 关键：必须指定 rectangle，否则图片默认覆盖全球 → 看不到
    var rect = SuperMap3D.Rectangle.fromDegrees(
      bounds.west, bounds.south, bounds.east, bounds.north
    );
    var provider = new SuperMap3D.SingleTileImageryProvider({
      url: url,
      rectangle: rect
    });
    heatmapLayer = viewer.imageryLayers.addImageryProvider(provider);
    heatmapLayer.alpha = 0.8;
    heatmapLayer.show = heatmapEnabled;
    console.log("热力图已叠加到场景", bounds);
  } catch (e) {
    console.warn("热力图叠加失败:", e.message);
  }
}

// ===== 初始化 =====

function initHeatmap() {
  if (!viewer) { setTimeout(initHeatmap, 500); return; }
  // 预创建 canvas，等待用户开启
  console.log("热力图已就绪");
}

// ===== 外部接口 =====

function toggleHeatmap(show) {
  heatmapEnabled = show;
  if (heatmapLayer) {
    heatmapLayer.show = show;
  }
  if (show) {
    renderHeatmap();
  }
}

// 当 POI 数据更新时调用（如切换起火点后）
function refreshHeatmap() {
  if (heatmapEnabled) {
    // 移除旧图层强制重建
    if (heatmapLayer) {
      viewer.imageryLayers.remove(heatmapLayer);
      heatmapLayer = null;
    }
    renderHeatmap();
  }
}
