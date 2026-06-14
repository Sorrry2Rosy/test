文件一risklayer.js
// ===== 建筑火灾风险分级图层 =====
// 从 iServer REST 数据服务获取要素，用 Entity Polygon + CLAMP_TO_3D_TILE 贴合 S3M 模型
// 前提：数据集坐标必须为 WGS84 (EPSG:4326)，否则在 iDesktopX 中投影转换后再发布

var riskLayerConfig = {
  serviceUrl: "http://localhost:8090/iserver/services/qq/rest/data",
  datasourceName: "DataSource_supermap",
  datasetName: "高危图_1",
  colorField: "TOTAL_RISK",
  colors: [
    { min: 0,   max: 30,  hex: "#2ecc71", label: "低风险" },
    { min: 30,  max: 50,  hex: "#f1c40f", label: "中低风险" },
    { min: 50,  max: 70,  hex: "#e67e22", label: "中风险" },
    { min: 70,  max: 85,  hex: "#e74c3c", label: "中高风险" },
    { min: 85,  max: 100, hex: "#8e44ad", label: "高风险" }
  ],
  fillOpacity: 0.55,
  batchSize: 30   // 每批并行请求数
};

var riskEntities = [];
var selectedRiskEntity = null;

function getRiskColor(value) {
  var c = riskLayerConfig.colors;
  for (var i = 0; i < c.length; i++) {
    if (value >= c[i].min && value <= c[i].max) return c[i].hex;
  }
  return "#95a5a6";
}

function getRiskLabel(value) {
  var c = riskLayerConfig.colors;
  for (var i = 0; i < c.length; i++) {
    if (value >= c[i].min && value <= c[i].max) return c[i].label;
  }
  return "未知";
}

// 从 iServer 要素 JSON 中提取属性对象
function buildAttributes(fieldNames, fieldValues) {
  var attrs = {};
  for (var i = 0; i < fieldNames.length; i++) {
    attrs[fieldNames[i]] = fieldValues[i];
  }
  return attrs;
}

// 解析 SuperMap REGION 几何的点数组为 Cesium Cartesian3 数组
// points: [{x: lng, y: lat, m: null}, ...]  — WGS84 转换后 x=经度, y=纬度
function pointsToCartesians(points) {
  var positions = [];
  for (var i = 0; i < points.length; i++) {
    positions.push(SuperMap3D.Cartesian3.fromDegrees(points[i].x, points[i].y));
  }
  return positions;
}

// 从几何对象构建 PolygonHierarchy 数组（处理单面和多面）
function buildPolygonHierarchies(geom) {
  if (!geom || !geom.points || geom.points.length < 3) return null;

  var type = geom.type || "REGION";
  if (type !== "REGION") {
    // 非面类型，跳过
    return null;
  }

  // SuperMap REGION: points 是所有顶点的平铺列表
  // parts: [n1, n2, ...] 表示每部分的顶点数（用于区分外环和洞）
  // partTopo: [...] 拓扑信息（可选）
  var allPoints = geom.points;
  var parts = geom.parts;

  if (!parts || parts.length === 0) {
    // 无 parts 信息，把所有点当作一个环
    return [new SuperMap3D.PolygonHierarchy(pointsToCartesians(allPoints))];
  }

  var hierarchies = [];
  var offset = 0;
  for (var r = 0; r < parts.length; r++) {
    var count = parts[r];
    if (count < 3) { offset += count; continue; }
    var ringPoints = allPoints.slice(offset, offset + count);
    hierarchies.push(new SuperMap3D.PolygonHierarchy(pointsToCartesians(ringPoints)));
    offset += count;
  }

  return hierarchies.length > 0 ? hierarchies : null;
}

// ===== 主流程 =====

function loadRiskLayer() {
  if (!viewer) {
    console.warn("viewer 未就绪，跳过风险图层加载");
    return;
  }

  var config = riskLayerConfig;
  var indexUrl = config.serviceUrl +
    "/datasources/" + encodeURIComponent(config.datasourceName) +
    "/datasets/" + encodeURIComponent(config.datasetName) +
    "/features.json?returnContent=true&fromIndex=0&toIndex=500";

  console.log("风险图层: 获取要素列表...");
  fetch(indexUrl)
    .then(function (resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.json();
    })
    .then(function (data) {
      var urls = data.childUriList || [];
      var total = data.featureCount || urls.length;
      console.log("风险图层: 共 " + total + " 个要素，开始批量获取...");
      if (urls.length === 0) {
        console.warn("风险图层: iServer 未返回任何要素");
        return;
      }
      batchFetchFeatures(urls, 0, [], function (features) {
        console.log("风险图层: 成功获取 " + features.length + " 条要素数据");
        renderRiskEntities(features);
      });
    })
    .catch(function (err) {
      console.error("风险图层: 获取要素列表失败", err);
    });
}

function batchFetchFeatures(urls, startIndex, results, callback) {
  var config = riskLayerConfig;
  var endIndex = Math.min(startIndex + config.batchSize, urls.length);
  var batch = urls.slice(startIndex, endIndex);

  var promises = batch.map(function (url) {
    return fetch(url + ".json")
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });  // 单个失败不中断
  });

  Promise.all(promises).then(function (batchResults) {
    for (var i = 0; i < batchResults.length; i++) {
      if (batchResults[i]) results.push(batchResults[i]);
    }

    var progress = Math.round((endIndex / urls.length) * 100);
    console.log("风险图层: 加载进度 " + progress + "% (" + endIndex + "/" + urls.length + ")");

    if (endIndex < urls.length) {
      batchFetchFeatures(urls, endIndex, results, callback);
    } else {
      callback(results);
    }
  }).catch(function () {
    // 批量失败也继续
    if (endIndex < urls.length) {
      batchFetchFeatures(urls, endIndex, results, callback);
    } else {
      callback(results);
    }
  });
}

function renderRiskEntities(features) {
  clearRiskLayer();
  var rendered = 0;

  for (var i = 0; i < features.length; i++) {
    var f = features[i];
    var attrs = buildAttributes(f.fieldNames || [], f.fieldValues || []);
    var geom = f.geometry;

    var riskValue = parseFloat(attrs[riskLayerConfig.colorField]) || 0;
    var colorHex = getRiskColor(riskValue);
    var color = SuperMap3D.Color.fromCssColorString(colorHex).withAlpha(riskLayerConfig.fillOpacity);
    var outlineColor = SuperMap3D.Color.fromCssColorString(colorHex).withAlpha(1.0);

    var hierarchies = buildPolygonHierarchies(geom);
    if (!hierarchies) continue;

    // 每个环（含洞）创建一个 Entity
    // 第一个是外环，后续是洞 — 通过 PolygonHierarchy 的 holes 参数处理
    // 简化处理：每个环作为独立 Entity
    // 如果有多个 parts，第一个是外环，其余是洞
    try {
      var mainHierarchy = hierarchies[0];
      if (hierarchies.length > 1) {
        mainHierarchy.holes = hierarchies.slice(1);
      }

      var entity = viewer.entities.add({
        polygon: {
          hierarchy: mainHierarchy,
          material: color,
          heightReference: SuperMap3D.HeightReference.CLAMP_TO_3D_TILE,
          outline: true,
          outlineColor: outlineColor,
          outlineWidth: 1.0
        }
      });

      entity._riskData = {
        riskValue: riskValue,
        colorHex: colorHex,
        riskLabel: getRiskLabel(riskValue),
        scoreUse: attrs["SCORE_USE"] || 0,
        scoreFs: attrs["SCORE_FS"] || 0,
        scoreHy: attrs["SCORE_HY"] || 0,
        buildingType: attrs["类型"] || ""
      };

      riskEntities.push(entity);
      rendered++;
    } catch (e) {
      console.warn("跳过无效几何 (索引 " + i + "):", e.message);
    }
  }

  console.log("风险图层已渲染 " + rendered + " 个面 (共 " + features.length + " 条要素)");
  // 默认隐藏，由用户在侧边栏手动开启
  toggleRiskLayer(false);
}

function clearRiskLayer() {
  for (var i = 0; i < riskEntities.length; i++) {
    viewer.entities.remove(riskEntities[i]);
  }
  riskEntities = [];
}

function toggleRiskLayer(show) {
  for (var i = 0; i < riskEntities.length; i++) {
    riskEntities[i].show = show;
  }
}

// ===== 点击选中交互 =====

function selectRiskPrimitive(entity) {
  deselectRiskPrimitive();
  selectedRiskEntity = entity;
  var d = entity._riskData;

  var card = document.getElementById("leftDetailCard");
  if (!card) return;

  card.classList.remove("hidden");
  card.innerHTML =
    '<div class="chart-title">' +
    '<i class="bi bi-info-circle-fill"></i>选中要素详情' +
    '</div>' +
    '<div class="poi-detail-header">' +
    '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + d.colorHex + ';flex-shrink:0"></span>' +
    '<span class="poi-detail-name">' + (d.buildingType || "建筑") + '</span>' +
    '<span class="poi-detail-type-tag" style="background:' + d.colorHex + '">' + d.riskLabel + '</span>' +
    '</div>' +
    '<div class="poi-detail-info" style="font-size:0.82rem;line-height:1.8">' +
    '综合风险分: <b>' + d.riskValue.toFixed(1) + '</b><br>' +
    '用途评分: ' + (d.scoreUse || "-") + '<br>' +
    '消防站距离评分: ' + (d.scoreFs || "-") + '<br>' +
    '消防栓距离评分: ' + (d.scoreHy || "-") +
    '</div>';

  // 确保左侧面板可见
  var leftPanel = document.getElementById("leftPanel");
  if (leftPanel && leftPanel.classList.contains("panel-hidden")) {
    leftPanel.classList.remove("panel-hidden");
  }
}

function deselectRiskPrimitive() {
  selectedRiskEntity = null;
}

function restoreRiskPlaceholder() {
  var card = document.getElementById("leftDetailCard");
  if (card) {
    card.classList.add("hidden");
  }
}



文件二： spread.js
// ===== 火势蔓延与 BIM 火球可视化图层 =====
// 平面蔓延：走 iServer REST Data API → Entity Polygon（复用 riskLayer.js 模式）
// BIM 火球：走 iServer S3M 图层 + SuperMap3D.ParticleSystem 火焰粒子
// BIM 受影响构件：走 iServer REST Data API → Entity 描边高亮

var SPREAD_API = "/api/spread";

// 平面蔓延图层状态
var planarLayerConfig = [];
var planarEntities = [];       // { entity, config }
var planarVisible = false;
var planarModeEnabled = false;

// BIM 火球图层状态
var bimLayerConfig = [];
var bimS3mLayers = [];        // scene.open() 返回的 S3M 图层引用
var bimAffectedEntities = []; // 受影响构件 Entity
var bimVisible = false;
var bimModeEnabled = false;
var fireParticleSystem = null; // SuperMap3D.ParticleSystem 引用

// 当前选中的蔓延/BIM 要素
var selectedSpreadEntity = null;

// ===== 工具函数 =====

function buildAttrs(fieldNames, fieldValues) {
  var attrs = {};
  for (var i = 0; i < fieldNames.length; i++) {
    attrs[fieldNames[i]] = fieldValues[i];
  }
  return attrs;
}

function pointsToCartesians(points) {
  var positions = [];
  for (var i = 0; i < points.length; i++) {
    positions.push(SuperMap3D.Cartesian3.fromDegrees(points[i].x, points[i].y, points[i].z || 0));
  }
  return positions;
}

function buildPolygonHierarchies(geom) {
  if (!geom || !geom.points || geom.points.length < 3) return null;
  var type = geom.type || "REGION";
  if (type !== "REGION") return null;

  var allPoints = geom.points;
  var parts = geom.parts;

  if (!parts || parts.length === 0) {
    return [new SuperMap3D.PolygonHierarchy(pointsToCartesians(allPoints))];
  }

  var hierarchies = [];
  var offset = 0;
  for (var r = 0; r < parts.length; r++) {
    var count = parts[r];
    if (count < 3) { offset += count; continue; }
    var ringPoints = allPoints.slice(offset, offset + count);
    hierarchies.push(new SuperMap3D.PolygonHierarchy(pointsToCartesians(ringPoints)));
    offset += count;
  }
  return hierarchies.length > 0 ? hierarchies : null;
}

// ===== 平面蔓延图层 =====

function loadPlanarLayers() {
  fetch(SPREAD_API + "/planar/layers")
    .then(function (r) { return r.json(); })
    .then(function (layers) {
      planarLayerConfig = layers || [];
      console.log("蔓延图层: 获取到 " + planarLayerConfig.length + " 个平面蔓延图层配置");
      planarLayerConfig.forEach(function (cfg) {
        if (cfg.available && cfg.featureUrl) {
          fetchPlanarFeatures(cfg);
        } else {
          console.log("蔓延图层: " + cfg.label + " 数据集待发布，使用示意范围");
          cfg._fallback = true;
        }
      });
    })
    .catch(function (err) {
      console.error("蔓延图层: 获取配置失败", err);
    });
}

function fetchPlanarFeatures(cfg) {
  if (!cfg.featureUrl) { cfg._fallback = true; return; }
  fetch(cfg.featureUrl)
    .then(function (resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.json();
    })
    .then(function (data) {
      var urls = data.childUriList || [];
      if (urls.length === 0) {
        console.warn("蔓延图层: " + cfg.label + " 无要素数据");
        cfg._fallback = true;
        return;
      }
      batchFetchPlanar(urls, 0, [], function (features) {
        console.log("蔓延图层: " + cfg.label + " 获取 " + features.length + " 条要素");
        cfg._features = features;
        cfg._loaded = true;
        if (planarVisible) {
          renderPlanarLayer(cfg);
        }
      });
    })
    .catch(function (err) {
      console.warn("蔓延图层: " + cfg.label + " iServer 查询失败 (" + err.message + ")，使用示意范围");
      cfg._fallback = true;
    });
}

function batchFetchPlanar(urls, startIndex, results, callback) {
  var endIndex = Math.min(startIndex + 20, urls.length);
  var batch = urls.slice(startIndex, endIndex);
  var promises = batch.map(function (url) {
    return fetch(url + ".json")
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
  });
  Promise.all(promises).then(function (batchResults) {
    for (var i = 0; i < batchResults.length; i++) {
      if (batchResults[i]) results.push(batchResults[i]);
    }
    if (endIndex < urls.length) {
      batchFetchPlanar(urls, endIndex, results, callback);
    } else {
      callback(results);
    }
  });
}

function renderPlanarLayer(cfg) {
  if (!cfg._features) return;
  clearPlanarLayerById(cfg.id);

  var color = SuperMap3D.Color.fromCssColorString(cfg.legendColor).withAlpha(0.45);
  var outlineColor = SuperMap3D.Color.fromCssColorString(cfg.legendColor).withAlpha(0.9);

  for (var i = 0; i < cfg._features.length; i++) {
    var f = cfg._features[i];
    var attrs = buildAttrs(f.fieldNames || [], f.fieldValues || []);
    var geom = f.geometry;
    var hierarchies = buildPolygonHierarchies(geom);
    if (!hierarchies) continue;

    try {
      var mainHierarchy = hierarchies[0];
      if (hierarchies.length > 1) {
        mainHierarchy.holes = hierarchies.slice(1);
      }

      var entity = viewer.entities.add({
        polygon: {
          hierarchy: mainHierarchy,
          material: color,
          heightReference: SuperMap3D.HeightReference.CLAMP_TO_3D_TILE,
          outline: true,
          outlineColor: outlineColor,
          outlineWidth: 1.5
        }
      });

      entity._spreadData = {
        layerId: cfg.id,
        label: cfg.label,
        timeMin: cfg.timeMin,
        legendColor: cfg.legendColor,
        attrs: attrs
      };

      planarEntities.push({ entity: entity, config: cfg });
    } catch (e) {
      console.warn("蔓延图层: 跳过无效几何", e.message);
    }
  }

  console.log("蔓延图层: " + cfg.label + " 已渲染 " + planarEntities.length + " 个面");
}

function renderPlanarFallback(cfg) {
  // iServer 未就绪时，在起火点周围绘制圆形示意范围
  var fireLon = 114.07, fireLat = 22.61;
  var radiusM = cfg.timeMin === 10 ? 1500 : (cfg.timeMin === 30 ? 4000 : 8000);
  var color = SuperMap3D.Color.fromCssColorString(cfg.legendColor).withAlpha(0.35);
  var outlineColor = SuperMap3D.Color.fromCssColorString(cfg.legendColor).withAlpha(0.8);

  var entity = viewer.entities.add({
    position: SuperMap3D.Cartesian3.fromDegrees(fireLon, fireLat, 5),
    ellipse: {
      semiMajorAxis: radiusM,
      semiMinorAxis: radiusM,
      heightReference: SuperMap3D.HeightReference.CLAMP_TO_GROUND,
      material: color,
      outline: true,
      outlineColor: outlineColor,
      outlineWidth: 2
    }
  });

  entity._spreadData = {
    layerId: cfg.id,
    label: cfg.label + "（示意）",
    timeMin: cfg.timeMin,
    legendColor: cfg.legendColor,
    attrs: { areaEstimate: "约 " + (Math.PI * radiusM * radiusM / 1e6).toFixed(2) + " km²" }
  };

  planarEntities.push({ entity: entity, config: cfg });
}

function clearPlanarLayerById(layerId) {
  for (var i = planarEntities.length - 1; i >= 0; i--) {
    if (planarEntities[i].config.id === layerId) {
      viewer.entities.remove(planarEntities[i].entity);
      planarEntities.splice(i, 1);
    }
  }
}

function clearAllPlanarLayers() {
  for (var i = 0; i < planarEntities.length; i++) {
    viewer.entities.remove(planarEntities[i].entity);
  }
  planarEntities = [];
}

function togglePlanarLayer(layerId, show) {
  for (var i = 0; i < planarEntities.length; i++) {
    if (planarEntities[i].config.id === layerId) {
      planarEntities[i].entity.show = show;
    }
  }
}

function toggleAllPlanar(show) {
  planarVisible = show;
  if (show) {
    planarLayerConfig.forEach(function (cfg) {
      if (cfg._loaded && cfg._features) {
        // 检查是否已渲染
        var hasRendered = false;
        for (var i = 0; i < planarEntities.length; i++) {
          if (planarEntities[i].config.id === cfg.id) { hasRendered = true; break; }
        }
        if (!hasRendered) renderPlanarLayer(cfg);
      } else if (cfg._fallback) {
        var hasRendered = false;
        for (var i = 0; i < planarEntities.length; i++) {
          if (planarEntities[i].config.id === cfg.id) { hasRendered = true; break; }
        }
        if (!hasRendered) renderPlanarFallback(cfg);
      }
    });
  }
  for (var i = 0; i < planarEntities.length; i++) {
    planarEntities[i].entity.show = show;
  }
}

// ===== BIM 火球图层 =====

function loadBimLayers() {
  fetch(SPREAD_API + "/bim/layers")
    .then(function (r) { return r.json(); })
    .then(function (layers) {
      bimLayerConfig = layers || [];
      console.log("BIM 火球: 获取到 " + bimLayerConfig.length + " 个图层配置");
      bimLayerConfig.forEach(function (cfg) {
        if (!cfg.available) {
          console.log("BIM 火球: " + cfg.label + " 数据集待发布");
          cfg._fallback = true;
        }
      });
    })
    .catch(function (err) {
      console.error("BIM 火球: 获取配置失败", err);
    });
}

// 加载 BIM 火球 S3M 图层（SuperMap 原生方式）
function loadBimFireballS3M(sceneId) {
  if (!viewer || !viewer.scene) return;

  // 获取 BIM 场景的 S3M 服务地址
  fetch(SPREAD_API + "/bim/scenes")
    .then(function (r) { return r.json(); })
    .then(function (scenes) {
      var scene = null;
      for (var i = 0; i < scenes.length; i++) {
        if (scenes[i].sceneId === sceneId) { scene = scenes[i]; break; }
      }
      if (!scene || !scene.s3mServiceUrl) {
        console.warn("BIM 火球: 未找到 S3M 服务地址，使用 Entity 方式渲染");
        renderBimFireballAsEntities();
        return;
      }

      // 使用 SuperMap scene.open() 加载 BIM S3M 图层
      viewer.scene.open(scene.s3mServiceUrl)
        .then(function (layers) {
          bimS3mLayers = layers || [];
          console.log("BIM 火球: S3M 图层已加载 " + bimS3mLayers.length + " 层");
          // 初始隐藏，由用户控制显隐
          toggleAllBim(false);
        })
        .catch(function (err) {
          console.warn("BIM 火球: S3M 加载失败，使用 Entity 渲染", err);
          renderBimFireballAsEntities();
        });
    })
    .catch(function () {
      renderBimFireballAsEntities();
    });
}

// 降级方案：用 Entity 渲染火球（仅对 available=false 的图层做示意球）
function renderBimFireballAsEntities() {
  clearAllBimEntities();
  bimLayerConfig.forEach(function (cfg) {
    if (cfg.id === "bim_affected") return; // 受灾构件单独处理
    renderBimSphereEntity(cfg);
  });
}

function renderBimSphereEntity(cfg) {
  var fireLon = 114.07, fireLat = 22.61, fireHeight = 15;

  var alpha = cfg.available ? 0.35 : 0.15; // unavailable 的更透明
  var color = SuperMap3D.Color.fromCssColorString(cfg.legendColor).withAlpha(alpha);
  var labelSuffix = cfg.available ? "" : "（待发布）";

  var entity = viewer.entities.add({
    position: SuperMap3D.Cartesian3.fromDegrees(fireLon, fireLat, fireHeight),
    ellipsoid: {
      radii: new SuperMap3D.Cartesian3(cfg.radiusM, cfg.radiusM, cfg.radiusM),
      material: color,
      outline: true,
      outlineColor: SuperMap3D.Color.fromCssColorString(cfg.legendColor).withAlpha(0.7),
      outlineWidth: 1.0
    }
  });

  entity._spreadData = {
    layerId: cfg.id,
    label: cfg.label + labelSuffix,
    radiusM: cfg.radiusM,
    legendColor: cfg.legendColor,
    type: "bim_fireball",
    attrs: {
      radius: cfg.radiusM + "米",
      volume: (4 / 3 * Math.PI * Math.pow(cfg.radiusM, 3)).toFixed(0) + " m³",
      dataStatus: cfg.available ? "已发布" : "待发布"
    }
  };

  bimAffectedEntities.push(entity);
}

function clearAllBimEntities() {
  for (var i = 0; i < bimAffectedEntities.length; i++) {
    viewer.entities.remove(bimAffectedEntities[i]);
  }
  bimAffectedEntities = [];
}

function clearBimS3MLayers() {
  if (bimS3mLayers.length > 0 && viewer && viewer.scene) {
    // S3M 图层通过设置 visible 控制显隐，不从场景移除
    bimS3mLayers = [];
  }
}

function toggleAllBim(show) {
  bimVisible = show;
  // 控制 S3M 图层显隐
  for (var i = 0; i < bimS3mLayers.length; i++) {
    if (bimS3mLayers[i] && bimS3mLayers[i].visible !== undefined) {
      bimS3mLayers[i].visible = show;
    }
  }
  // 控制 Entity 图层显隐
  for (var i = 0; i < bimAffectedEntities.length; i++) {
    bimAffectedEntities[i].show = show;
  }
}

function toggleBimLayer(layerId, show) {
  for (var i = 0; i < bimAffectedEntities.length; i++) {
    if (bimAffectedEntities[i]._spreadData && bimAffectedEntities[i]._spreadData.layerId === layerId) {
      bimAffectedEntities[i].show = show;
    }
  }
}

// ===== 火焰粒子效果（基于 SuperMap3D.ParticleSystem） =====

function createFireParticle(position) {
  if (!viewer || !SuperMap3D.ParticleHelper) return;

  // 构建火焰粒子系统参数
  var particleOptions = {
    image: "../Build/SuperMap3D/Assets/Textures/smoke.png", // 复用 SDK 内置纹理
    startColor: new SuperMap3D.Color(1.0, 0.4, 0.0, 0.8),
    endColor: new SuperMap3D.Color(1.0, 0.0, 0.0, 0.0),
    startScale: 0.5,
    endScale: 4.0,
    minimumParticleLife: 0.8,
    maximumParticleLife: 2.0,
    minimumSpeed: 5.0,
    maximumSpeed: 15.0,
    emissionRate: 60,
    lifetime: 16.0,
    emitter: new SuperMap3D.SphereEmitter(2.0),
    modelMatrix: SuperMap3D.Transforms.eastNorthUpToFixedFrame(position)
  };

  try {
    fireParticleSystem = new SuperMap3D.ParticleSystem(particleOptions);
    viewer.scene.primitives.add(fireParticleSystem);
    console.log("火焰粒子系统已创建");
  } catch (e) {
    console.warn("火焰粒子创建失败:", e.message);
  }
}

function removeFireParticle() {
  if (fireParticleSystem) {
    viewer.scene.primitives.remove(fireParticleSystem);
    fireParticleSystem = null;
  }
}

// ===== 点击选中交互 =====

function setupSpreadClickHandler() {
  if (!viewer) return;
  var handler = new SuperMap3D.ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction(function (click) {
    // 只在蔓延或 BIM 模式下处理
    if (!planarModeEnabled && !bimModeEnabled) return;

    var pickedList = viewer.scene.drillPick
      ? viewer.scene.drillPick(click.position)
      : [viewer.scene.pick(click.position)].filter(SuperMap3D.defined);

    var found = false;
    for (var i = 0; i < pickedList.length; i++) {
      var obj = pickedList[i];
      if (!SuperMap3D.defined(obj)) continue;
      var entity = obj.id;
      if (entity && entity._spreadData) {
        selectSpreadEntity(entity);
        found = true;
        break;
      }
      if (obj.primitive && obj.primitive.id && obj.primitive.id._spreadData) {
        selectSpreadEntity(obj.primitive.id);
        found = true;
        break;
      }
    }
    if (!found) {
      deselectSpreadEntity();
    }
  }, SuperMap3D.ScreenSpaceEventType.LEFT_CLICK);
}

function selectSpreadEntity(entity) {
  deselectSpreadEntity();
  selectedSpreadEntity = entity;
  var d = entity._spreadData;

  var card = document.getElementById("spreadDetailCard");
  if (!card) return;

  card.classList.remove("hidden");

  if (d.type === "bim_fireball") {
    card.innerHTML =
      '<div class="chart-title"><i class="bi bi-fire"></i>火球详情</div>' +
      '<div class="poi-detail-header">' +
      '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + d.legendColor + ';flex-shrink:0"></span>' +
      '<span class="poi-detail-name">' + d.label + '</span>' +
      '<span class="poi-detail-type-tag" style="background:' + d.legendColor + '">BIM 火球</span>' +
      '</div>' +
      '<div class="poi-detail-info" style="font-size:0.82rem;line-height:1.8">' +
      '半径: <b>' + (d.attrs.radius || d.radiusM + "米") + '</b><br>' +
      '体积: ' + (d.attrs.volume || "-") + '<br>' +
      '受影响构件: <b>' + (d.attrs.affectedComponents || "-") + '</b> 个<br>' +
      '涉及楼层: ' + (d.attrs.affectedFloors || "-") +
      '</div>';
  } else {
    // 平面蔓延图层
    card.innerHTML =
      '<div class="chart-title"><i class="bi bi-info-circle-fill"></i>蔓延范围详情</div>' +
      '<div class="poi-detail-header">' +
      '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + d.legendColor + ';flex-shrink:0"></span>' +
      '<span class="poi-detail-name">' + d.label + '</span>' +
      '<span class="poi-detail-type-tag" style="background:' + d.legendColor + '">火势蔓延</span>' +
      '</div>' +
      '<div class="poi-detail-info" style="font-size:0.82rem;line-height:1.8">' +
      '时间: <b>' + d.timeMin + ' 分钟</b><br>' +
      '面积: ' + (d.attrs.areaEstimate || (d.attrs.AREA ? (parseFloat(d.attrs.AREA) / 1e6).toFixed(2) + " km²" : "-")) + '<br>' +
      '受威胁建筑: <b>' + (d.attrs.affectedBuildings || d.attrs.BUILDING_CNT || "-") + '</b> 栋<br>' +
      '关键设施: ' + (d.attrs.criticalFacilities || d.attrs.CRITICAL_CNT || "-") + ' 处' +
      '</div>';
  }

  // 确保右侧面板可见
  var rightPanel = document.getElementById("rightPanel");
  if (rightPanel && rightPanel.classList.contains("panel-hidden")) {
    rightPanel.classList.remove("panel-hidden");
  }
}

function deselectSpreadEntity() {
  selectedSpreadEntity = null;
  var card = document.getElementById("spreadDetailCard");
  if (card) {
    card.classList.add("hidden");
  }
}

// ===== 模式切换 =====

function enablePlanarMode() {
  planarModeEnabled = true;
  bimModeEnabled = false;
  toggleAllBim(false);
  removeFireParticle();
  toggleAllPlanar(true);

  // 关闭其他面板
  document.getElementById("spatialPanel").classList.remove("open");

  // 标签切换
  document.getElementById("tabPlanar").classList.add("active");
  document.getElementById("tabBim").classList.remove("active");

  // 控件显隐
  document.getElementById("spreadTimeSlider").style.display = "flex";
  document.getElementById("spreadPlanarLegend").style.display = "flex";
  document.getElementById("spreadBimControls").style.display = "none";
  document.getElementById("spreadParticleToggle").style.display = "none";
  document.getElementById("spreadPanel").classList.add("open");
}

function enableBimMode() {
  bimModeEnabled = true;
  planarModeEnabled = false;
  toggleAllPlanar(false);
  toggleAllBim(true);

  // 标签切换
  document.getElementById("tabPlanar").classList.remove("active");
  document.getElementById("tabBim").classList.add("active");

  // 控件显隐
  document.getElementById("spreadTimeSlider").style.display = "none";
  document.getElementById("spreadPlanarLegend").style.display = "none";
  document.getElementById("spreadBimControls").style.display = "flex";
  document.getElementById("spreadParticleToggle").style.display = "block";

  // 在起火点位置创建火焰粒子
  var firePos = SuperMap3D.Cartesian3.fromDegrees(114.07, 22.61, 20);
  createFireParticle(firePos);

  document.getElementById("spatialPanel").classList.remove("open");
  document.getElementById("spreadPanel").classList.add("open");

  // 确保有 BIM 火球数据，无 iServer 时用 Entity 降级
  if (bimAffectedEntities.length === 0 && bimS3mLayers.length === 0) {
    renderBimFireballAsEntities();
  }
}

function disableSpreadMode() {
  planarModeEnabled = false;
  bimModeEnabled = false;
  toggleAllPlanar(false);
  toggleAllBim(false);
  removeFireParticle();
  deselectSpreadEntity();

  var panel = document.getElementById("spreadPanel");
  if (panel) panel.classList.remove("open");
}

function toggleSpreadPanel() {
  var panel = document.getElementById("spreadPanel");
  if (!panel) return;

  if (panel.classList.contains("open")) {
    disableSpreadMode();
  } else {
    // 默认先打开平面蔓延模式
    enablePlanarMode();
  }
}

// ===== 时间轴/按钮切换控件 =====

function switchPlanarTime(timeMin) {
  planarLayerConfig.forEach(function (cfg) {
    var show = (cfg.timeMin === timeMin);
    togglePlanarLayer(cfg.id, show);
  });
  // 更新按钮状态
  var btns = document.querySelectorAll(".spread-time-btn");
  btns.forEach(function (btn) {
    btn.classList.toggle("active", parseInt(btn.getAttribute("data-time")) === timeMin);
  });
}

function togglePlanarAll() {
  planarLayerConfig.forEach(function (cfg) {
    togglePlanarLayer(cfg.id, true);
  });
  var btns = document.querySelectorAll(".spread-time-btn");
  btns.forEach(function (btn) { btn.classList.remove("active"); });
}

// ===== 初始化 =====

function initSpreadLayer() {
  loadPlanarLayers();
  loadBimLayers();
  setupSpreadClickHandler();
  console.log("火势蔓延图层模块已初始化");
}
