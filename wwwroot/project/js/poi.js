// ===== 空间查询（3 个起火点） =====
var SPATIAL_API_URL = "/api/spatial/pois";
var FIRES_API_URL = "/api/spatial/fires";
var currentFireId = 1;
var fireList = [];
var currentFireScene = "";
var spatialFocusActive = false;
var SPATIAL_ALL_POIS = [];

function toggleSpatial() {
  var panel = document.getElementById("spatialPanel");
  var isOpen = panel.classList.contains("open");
  if (isOpen) {
    panel.classList.remove("open");
    resetSpatialFocus();
  } else {
    panel.classList.add("open");
    if (fireList.length === 0) {
      loadFireTabs().then(function () {
        loadSpatialData(currentFireId);
      });
    } else {
      loadSpatialData(currentFireId);
    }
  }
}

async function loadFireTabs() {
  try {
    var resp = await fetch(FIRES_API_URL);
    if (!resp.ok) throw new Error("服务器错误: " + resp.status);
    fireList = await resp.json();
    if (fireList.error) {
      fireList = [];
      return;
    }
    var tabsHtml = "";
    fireList.forEach(function (f) {
      tabsHtml +=
        '<button class="fire-tab' +
        (f.fireId === currentFireId ? " active" : "") +
        '" onclick="switchFire(' +
        f.fireId +
        ')">' +
        f.fireScene +
        "</button>";
    });
    document.getElementById("fireTabs").innerHTML = tabsHtml;
  } catch (err) {
    document.getElementById("fireTabs").innerHTML =
      '<span style="color:#ef4444;font-size:0.75rem;padding:8px 12px">加载起火点失败</span>';
  }
}

function switchFire(fireId) {
  currentFireId = fireId;
  resetSpatialFocus();
  var tabs = document.querySelectorAll(".fire-tab");
  tabs.forEach(function (t) {
    t.classList.remove("active");
  });
  event.target.classList.add("active");
  // 重置筛选条件
  if (typeof resetFilters === "function") resetFilters();
  loadSpatialData(fireId);
}

// 根据名称查找地图上的 entity
function findEntityByName(name) {
  for (var cat in poiEntities) {
    for (var i = 0; i < poiEntities[cat].length; i++) {
      var e = poiEntities[cat][i];
      if (e._poiData && e._poiData.name === name) return e;
    }
  }
  return null;
}

// 类型到 category 映射
function typeToCategory(type) {
  var map = { "医院": "hospital", "商场": "mall", "政府": "government", "消防站": "firestation", "起火点": "firepoint" };
  return map[type] || "";
}

// 聚焦：只显示指定 POI + 当前起火点
function focusOnSpatialPoi(poiName, poiType) {
  resetSpatialFocus();

  var poiEntity = findEntityByName(poiName);
  // 名字对不上时按类型回退（如 CSV 叫"政府_1"但 MySQL 叫"深圳市南山区人民政府"）
  if (!poiEntity && poiType) {
    var cat = typeToCategory(poiType);
    if (cat && poiEntities[cat] && poiEntities[cat].length > 0) {
      poiEntity = poiEntities[cat][0];
    }
  }
  var fireEntity = findEntityByName(currentFireScene);

  spatialFocusActive = true;

  // 隐藏全部
  for (var cat in poiEntities) {
    poiEntities[cat].forEach(function (e) {
      e._preFocusShow = e.show;
      e.show = false;
    });
  }

  // 只显示选中的 POI 和起火点
  if (poiEntity) poiEntity.show = true;
  if (fireEntity) fireEntity.show = true;

  // 高亮列表中被点击的项
  var items = document.querySelectorAll(".poi-item");
  items.forEach(function (item) {
    item.classList.remove("focused");
  });
  var target = document.querySelector('[data-poi-name="' + poiName.replace(/"/g, '\\"') + '"]');
  if (target) target.classList.add("focused");
}

// 重置焦点：恢复全部可见（按图例开关）
function resetSpatialFocus() {
  if (!spatialFocusActive) return;
  spatialFocusActive = false;

  ["hospital", "mall", "government", "firestation", "firepoint"].forEach(function (cat) {
    var input = document.querySelector('#legend-' + cat + ' input');
    var checked = input ? input.checked : true;
    (poiEntities[cat] || []).forEach(function (e) {
      e.show = checked;
    });
  });

  var items = document.querySelectorAll(".poi-item.focused");
  items.forEach(function (item) { item.classList.remove("focused"); });
}

async function loadSpatialData(fireId) {
  var container = document.getElementById("spatialResult");
  container.innerHTML =
    '<div class="spatial-loading">正在加载距离数据...</div>';

  try {
    var resp = await fetch(SPATIAL_API_URL + "?fireId=" + fireId);
    if (!resp.ok) throw new Error("服务器错误: " + resp.status);
    var pois = await resp.json();
    if (pois.error) throw new Error(pois.error);

    var fireScene = fireList.find(function (f) {
      return f.fireId === fireId;
    });
    var sceneName = fireScene ? fireScene.fireScene : "起火点";
    currentFireScene = sceneName;

    // 缓存全量数据并应用筛选
    SPATIAL_ALL_POIS = pois;
    applySpatialFilters();

    // 联动无人机 HUD：推送任务态势
    if (droneHud) {
      try {
        var stationCount = pois.filter(function(p) { return p.poiType === '消防站'; }).length;
        var hudRiskLabel = '--';
        if (typeof selectedRiskEntity !== 'undefined' && selectedRiskEntity && selectedRiskEntity._riskData) {
          hudRiskLabel = selectedRiskEntity._riskData.riskLabel;
        }
        var spreadMap = { '低风险': '~60 min', '中低风险': '~45 min', '中风险': '~30 min', '中高风险': '~15 min', '高风险': '~5 min' };
        var spreadEstimate = spreadMap[hudRiskLabel] || '--';
        droneHud.setMissionFire(sceneName, hudRiskLabel, spreadEstimate, stationCount);
      } catch (e) {}
    }
  } catch (err) {
    container.innerHTML =
      '<div class="spatial-loading" style="color:#ef4444">加载失败: ' +
      err.message +
      "</div>";
  }
}

// 渲染 POI 列表（接受筛选后的数组）
function renderSpatialList(pois, sceneName) {
  var container = document.getElementById("spatialResult");
  var html =
    '<div style="padding:8px 12px;font-size:0.75rem;color:#64748b;background:#f8fafc;border-bottom:1px solid #e2e8f0">' +
    '<i class="bi bi-geo-alt-fill me-1" style="color:#ef4444"></i>' +
    sceneName +
    " — 共 " +
    pois.length +
    " 个 POI（" +
    pois.filter(function (p) {
      return p.solveStatus === "ok";
    }).length +
    " 个可达）</div>";

  pois.forEach(function (p) {
    var reachable = p.solveStatus === "ok";
    var cls = reachable ? "" : "unreachable";
    var tagCls = reachable ? "ok" : "no";
    var tagText = reachable ? "可达" : "不可达";
    var typeCls =
      p.poiType === "医院"
        ? "hospital"
        : p.poiType === "商场"
        ? "mall"
        : "government";
    var sd = p.straightDistM
      ? (p.straightDistM / 1000).toFixed(2) + " km"
      : "--";
    var nd = p.networkDistM
      ? (p.networkDistM / 1000).toFixed(2) + " km"
      : "--";
    var tt =
      p.travelTimeMin != null ? p.travelTimeMin + " 分钟" : "--";

    html +=
      '<div class="poi-item ' +
      cls +
      '" data-poi-name="' + p.poiName.replace(/"/g, '&quot;') + '"' +
      ' onclick="focusOnSpatialPoi(\'' + p.poiName.replace(/'/g, "\\'") + '\',\'' + p.poiType + '\')"' +
      ' style="cursor:pointer">' +
      '<span class="poi-name">' +
      p.poiName +
      '<span class="poi-type ' +
      typeCls +
      '">' +
      p.poiType +
      "</span></span>" +
      '<span class="reachable-tag ' +
      tagCls +
      '" style="float:right">' +
      tagText +
      "</span>" +
      '<div class="poi-stats">' +
      '<span>直线距离 <span class="val">' +
      sd +
      "</span></span>" +
      '<span>路网距离 <span class="val">' +
      nd +
      "</span></span>" +
      '<span>通行时间 <span class="val">' +
      tt +
      "</span></span>" +
      "</div></div>";
  });
  container.innerHTML = html;
}

// ===== 空间查询筛选逻辑 =====

function applySpatialFilters() {
  if (SPATIAL_ALL_POIS.length === 0) return;
  if (!currentFireScene) return;

  // 1. 读取类型勾选
  var typeChecks = document.querySelectorAll('#spatialFilter .filter-checkbox-item input');
  var enabledTypes = {};
  typeChecks.forEach(function (cb) {
    enabledTypes[cb.getAttribute('data-type')] = cb.checked;
  });

  // 2. 读取距离和时间阈值（用 isNaN 检查，0 也是有效值）
  var distVal = parseFloat(document.getElementById('filterDist').value);
  var maxDistKm = isNaN(distVal) ? 20 : distVal;
  var timeVal = parseFloat(document.getElementById('filterTime').value);
  var maxTimeMin = isNaN(timeVal) ? 30 : timeVal;

  // 3. 读取可达状态
  var reachableVal = 'all';
  var radios = document.getElementsByName('reachable');
  for (var i = 0; i < radios.length; i++) {
    if (radios[i].checked) { reachableVal = radios[i].value; break; }
  }

  // 4. 读取排序方式
  var sortBy = document.getElementById('filterSort').value || 'rankNetwork';

  // 5. 过滤
  var filtered = SPATIAL_ALL_POIS.filter(function (p) {
    // 类型过滤
    if (!enabledTypes[p.poiType]) return false;
    // 直线距离过滤（null 表示无数据，保留它）
    if (p.straightDistM != null && (p.straightDistM / 1000) > maxDistKm) return false;
    // 通行时间过滤
    if (p.travelTimeMin != null && p.travelTimeMin > maxTimeMin) return false;
    // 可达状态过滤
    if (reachableVal === 'ok' && p.solveStatus !== 'ok') return false;
    if (reachableVal === 'unreachable' && p.solveStatus === 'ok') return false;
    return true;
  });

  // 6. 排序
  filtered.sort(function (a, b) {
    switch (sortBy) {
      case 'rankNetwork':
        return (a.rankNetwork || 99) - (b.rankNetwork || 99);
      case 'rankStraight':
        return (a.rankStraight || 99) - (b.rankStraight || 99);
      case 'travelTimeMin':
        return (a.travelTimeMin || 999) - (b.travelTimeMin || 999);
      case 'straightDistM':
        return (b.straightDistM || 0) - (a.straightDistM || 0);
      default:
        return 0;
    }
  });

  // 7. 渲染
  renderSpatialList(filtered, currentFireScene);
}

function resetFilters() {
  // 重置类型复选框为全选
  document.querySelectorAll('#spatialFilter .filter-checkbox-item input').forEach(function (cb) {
    cb.checked = true;
  });
  // 重置滑块
  document.getElementById('filterDist').value = 10;
  document.getElementById('distVal').textContent = '10 km';
  document.getElementById('filterTime').value = 30;
  document.getElementById('timeVal').textContent = '30 分钟';
  // 重置单选框为"全部"
  var radios = document.getElementsByName('reachable');
  for (var i = 0; i < radios.length; i++) {
    radios[i].checked = (radios[i].value === 'all');
  }
  // 重置排序
  document.getElementById('filterSort').value = 'rankNetwork';
  // 重新应用
  applySpatialFilters();
}
