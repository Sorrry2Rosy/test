// ===== 建筑火灾风险分级图层 =====
// 从 iServer REST 数据服务获取要素，用 Entity Polygon + CLAMP_TO_3D_TILE 贴合 S3M 模型
// 前提：数据集坐标必须为 WGS84 (EPSG:4326)，否则在 iDesktopX 中投影转换后再发布

var riskLayerConfig = {
  serviceUrl: "http://localhost:8090/iserver/services/fire_risk/rest/data",
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

  // 联动无人机 HUD：设置目标建筑
  if (droneHud && entity) {
    try {
      var hierarchy = entity.polygon.hierarchy.getValue();
      var centerPos = null;
      if (hierarchy && hierarchy.positions && hierarchy.positions.length > 0) {
        var positions = hierarchy.positions;
        var cx = 0, cy = 0, cz = 0;
        var count = Math.min(positions.length, 4);
        for (var i = 0; i < count; i++) {
          cx += positions[i].x; cy += positions[i].y; cz += positions[i].z;
        }
        centerPos = new SuperMap3D.Cartesian3(cx / count, cy / count, cz / count);
      }
      droneHud.setTargetBuilding(
        d.buildingType || "未知建筑",
        d.riskLabel + " (" + d.riskValue.toFixed(0) + "分)",
        centerPos
      );
    } catch (e) {}
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
