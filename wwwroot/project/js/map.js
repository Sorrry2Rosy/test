// ===== POI 地图可视化 =====
var POI_API_URL = "/api/pois";
var poiEntities = { hospital: [], mall: [], government: [], firestation: [], firepoint: [] };
var poiIcons = {};

function generatePoiIcon(category) {
  var canvas = document.getElementById("poiIconCanvas");
  var ctx = canvas.getContext("2d");
  var size = 48;
  canvas.width = size;
  canvas.height = size;
  ctx.clearRect(0, 0, size, size);

  var colors = {
    hospital: "#ef4444", mall: "#3b82f6",
    government: "#eab308", firestation: "#f97316",
    firepoint: "#dc2626"
  };
  var color = colors[category] || "#64748b";

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 20, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(size / 2, size / 2 - 1, 19, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  switch (category) {
    case "hospital":
      ctx.font = "bold 24px sans-serif";
      ctx.fillText("+", size / 2, size / 2 - 2);
      break;
    case "mall":
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(16, 17); ctx.lineTo(16, 28); ctx.lineTo(32, 28); ctx.lineTo(32, 17);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(19, 17); ctx.quadraticCurveTo(19, 12, 24, 12);
      ctx.quadraticCurveTo(29, 12, 29, 17);
      ctx.stroke();
      break;
    case "government":
      ctx.font = "bold 22px sans-serif";
      ctx.fillText("▣", size / 2, size / 2 - 2);
      break;
    case "firestation":
      ctx.font = "bold 20px sans-serif";
      ctx.fillText("▲", size / 2, size / 2);
      break;
    case "firepoint":
      ctx.font = "bold 20px sans-serif";
      ctx.fillText("★", size / 2, size / 2 - 1);
      break;
  }

  return canvas.toDataURL("image/png");
}

async function loadPoisToMap() {
  if (!viewer) return;

  ["hospital", "mall", "government", "firestation", "firepoint"].forEach(function (cat) {
    poiIcons[cat] = generatePoiIcon(cat);
  });

  try {
    var resp = await fetch(POI_API_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    var pois = await resp.json();
    if (pois.error) { console.error("POI 数据加载失败:", pois.error); return; }

    pois.forEach(function (p) {
      var entity = viewer.entities.add({
        name: p.name,
        position: SuperMap3D.Cartesian3.fromDegrees(p.lon, p.lat, 60),
        billboard: new SuperMap3D.BillboardGraphics({
          image: poiIcons[p.category],
          width: 64,
          height: 64,
          verticalOrigin: SuperMap3D.VerticalOrigin.BOTTOM,
          heightReference: SuperMap3D.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new SuperMap3D.NearFarScalar(500, 1.0, 5000, 0.4)
        }),
        label: new SuperMap3D.LabelGraphics({
          text: p.name,
          font: "12px 'Microsoft YaHei', sans-serif",
          fillColor: SuperMap3D.Color.WHITE,
          outlineColor: SuperMap3D.Color.fromCssColorString("#1e293b"),
          outlineWidth: 3,
          style: SuperMap3D.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: SuperMap3D.VerticalOrigin.TOP,
          pixelOffset: new SuperMap3D.Cartesian2(0, 38),
          heightReference: SuperMap3D.HeightReference.RELATIVE_TO_GROUND,
          scaleByDistance: new SuperMap3D.NearFarScalar(500, 1.0, 5000, 0.4)
        }),
        _poiData: p
      });
      if (poiEntities[p.category]) poiEntities[p.category].push(entity);
    });

    console.log("已加载 " + pois.length + " 个 POI 到地图");
  } catch (err) {
    console.error("加载 POI 到地图失败:", err);
  }
}

function togglePoiLayer(category, show) {
  (poiEntities[category] || []).forEach(function (e) { e.show = show; });
}

var selectedEntity = null;  // 当前选中的 POI entity

// 生成选中特效图标（向下箭头）
function generateSelectionIcon() {
  var canvas = document.getElementById("poiIconCanvas");
  var ctx = canvas.getContext("2d");
  var size = 48;
  canvas.width = size;
  canvas.height = size;
  ctx.clearRect(0, 0, size, size);

  // 发光圆环
  ctx.shadowColor = "rgba(250,204,21,0.8)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 18, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(250,204,21,0.25)";
  ctx.fill();
  ctx.shadowBlur = 0;

  // V 形箭头朝下
  ctx.strokeStyle = "#facc15";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(size / 2 - 10, size / 2 - 4);
  ctx.lineTo(size / 2, size / 2 + 8);
  ctx.lineTo(size / 2 + 10, size / 2 - 4);
  ctx.stroke();

  return canvas.toDataURL("image/png");
}

function setupPoiClickHandler() {
  if (!viewer) return;
  var handler = new SuperMap3D.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(function (click) {
    var pickedList = viewer.scene.drillPick
      ? viewer.scene.drillPick(click.position)
      : [viewer.scene.pick(click.position)].filter(SuperMap3D.defined);

    var found = false;
    for (var i = 0; i < pickedList.length; i++) {
      var obj = pickedList[i];
      if (!SuperMap3D.defined(obj)) continue;
      var entity = obj.id;
      if (entity && entity._poiData) {
        if (typeof deselectRiskPrimitive === "function") deselectRiskPrimitive();
        selectPoiEntity(entity);
        found = true;
        break;
      }
      if (obj.primitive && obj.primitive.id && obj.primitive.id._poiData) {
        if (typeof deselectRiskPrimitive === "function") deselectRiskPrimitive();
        selectPoiEntity(obj.primitive.id);
        found = true;
        break;
      }
      // 风险图层 Entity 点击检查（v2：Entity Polygon 渲染）
      if (entity && entity._riskData) {
        deselectPoiEntity();
        if (typeof selectRiskPrimitive === "function") {
          selectRiskPrimitive(entity);
        }
        found = true;
        break;
      }
      // 风险图层 GroundPrimitive 点击检查（v1 兼容）
      if (obj.primitive && obj.primitive._riskData) {
        deselectPoiEntity();
        if (typeof selectRiskPrimitive === "function") {
          selectRiskPrimitive(obj.primitive);
        }
        found = true;
        break;
      }
    }
    if (!found) {
      deselectPoiEntity();
      if (typeof deselectRiskPrimitive === "function") {
        deselectRiskPrimitive();
        restoreRiskPlaceholder();
      }
    }
  }, SuperMap3D.ScreenSpaceEventType.LEFT_CLICK);
}

function selectPoiEntity(entity) {
  deselectPoiEntity();
  selectedEntity = entity;
  var poiData = entity._poiData;

  // 选中特效箭头
  entity._selectionBillboard = viewer.entities.add({
    position: entity.position,
    billboard: new SuperMap3D.BillboardGraphics({
      image: generateSelectionIcon(),
      width: 48,
      height: 48,
      verticalOrigin: SuperMap3D.VerticalOrigin.CENTER,
      pixelOffset: new SuperMap3D.Cartesian2(0, -48),
      heightReference: SuperMap3D.HeightReference.RELATIVE_TO_GROUND
    })
  });

  // 渲染 POI 详情到左侧面板
  var card = document.getElementById("leftDetailCard");
  if (!card) return;
  card.classList.remove("hidden");
  var colors = { hospital: "#ef4444", mall: "#3b82f6", government: "#eab308", firestation: "#f97316", firepoint: "#dc2626" };
  var color = colors[poiData.category] || "#94a3b8";
  card.innerHTML =
    '<div class="chart-title">' +
    '<i class="bi bi-info-circle-fill"></i>选中要素详情' +
    '</div>' +
    '<div class="poi-detail-header">' +
    '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0"></span>' +
    '<span class="poi-detail-name">' + poiData.name + '</span>' +
    '<span class="poi-detail-type-tag" style="background:' + color + '">' + poiData.type + '</span>' +
    '</div>' +
    '<div class="poi-detail-info">' +
    (poiData.address || "地址暂无") +
    (poiData.phone ? '<br>' + poiData.phone : "") +
    '</div>';

  // 确保左侧面板可见
  var leftPanel = document.getElementById("leftPanel");
  if (leftPanel && leftPanel.classList.contains("panel-hidden")) {
    leftPanel.classList.remove("panel-hidden");
  }
}

function deselectPoiEntity() {
  if (selectedEntity && selectedEntity._selectionBillboard) {
    viewer.entities.remove(selectedEntity._selectionBillboard);
    selectedEntity._selectionBillboard = null;
  }
  selectedEntity = null;

  // 恢复占位提示（仅在无风险选中时）
  if (typeof selectedRiskEntity === "undefined" || !selectedRiskEntity) {
    var card = document.getElementById("leftDetailCard");
    if (card) {
      card.classList.add("hidden");
    }
  }
}
