// ===== BIM 受灾统计 + 火情蔓延数据查询模块 =====

var BIM_API_URL = "/api/bim/fire-stats";
var SPREAD_API_URL = "/api/spread/data";
var LOSS_API_URL = "/api/loss/estimate";

// 缓存
var bimCache = null;
var spreadCache = null;
var lossCache = null;

// ===== 模块切换 =====

function switchSpatialModule(module) {
  // 隐藏所有面板
  document.getElementById("spatialFilter").style.display = "none";
  document.getElementById("spatialResult").style.display = "none";
  document.getElementById("bimPanel").style.display = "none";
  document.getElementById("spreadModulePanel").style.display = "none";
  document.getElementById("lossPanel").style.display = "none";

  // Tab 高亮
  document.querySelectorAll(".spatial-module-tab").forEach(function(t) {
    t.classList.remove("active");
  });
  var tab = document.querySelector('.spatial-module-tab[data-module="' + module + '"]');
  if (tab) tab.classList.add("active");

  switch (module) {
    case "poi":
      document.getElementById("spatialFilter").style.display = "block";
      document.getElementById("spatialResult").style.display = "block";
      // 如果已有数据则重新应用筛选
      if (SPATIAL_ALL_POIS.length > 0 && currentFireScene) {
        applySpatialFilters();
      }
      break;
    case "bim":
      document.getElementById("bimPanel").style.display = "block";
      loadBimStats();
      break;
    case "spread":
      document.getElementById("spreadModulePanel").style.display = "block";
      loadSpreadData();
      break;
    case "loss":
      document.getElementById("lossPanel").style.display = "block";
      loadLossData();
      break;
  }
}

// ===== BIM 受灾统计 =====

async function loadBimStats() {
  var container = document.getElementById("bimPanel");
  if (bimCache) {
    renderBimData(bimCache);
    return;
  }

  container.innerHTML = '<div class="spatial-loading">正在加载BIM受灾数据...</div>';

  try {
    var resp = await fetch(BIM_API_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    var data = await resp.json();
    if (data.error) throw new Error(data.error);
    bimCache = data;
    renderBimData(data);
  } catch (err) {
    container.innerHTML = '<div class="spatial-loading" style="color:#ef4444">加载失败: ' + err.message + "</div>";
  }
}

function renderBimData(data) {
  var container = document.getElementById("bimPanel");
  var total = data.totalCount || 0;
  var byFloor = data.byFloor || [];

  // 汇总统计条
  var html =
    '<div style="padding:8px 12px;font-size:0.75rem;color:#64748b;background:#f8fafc;border-bottom:1px solid #e2e8f0">' +
    '<i class="bi bi-building-fill me-1" style="color:#8b5cf6"></i>' +
    'BIM受灾构件共计 <strong>' + total + '</strong> 个</div>';

  // 按楼层卡片展示
  byFloor.forEach(function(floorData) {
    var f = floorData.floor;
    var tot = floorData.total;
    var details = floorData.details || [];

    // 楼层颜色映射
    var floorColors = ["#6b7280", "#3b82f6", "#22c55e", "#eab308", "#ef4444"];
    var colorIdx = Math.min(parseInt(f) || 0, floorColors.length - 1);

    html += '<div class="bim-floor-card">' +
      '<div class="bim-floor-header">' +
      '<span class="bim-floor-badge" style="background:' + floorColors[colorIdx] + '">' + f + 'F</span>' +
      '<span class="bim-floor-title">楼层 ' + f + '</span>' +
      '<span class="bim-floor-count">' + tot + ' 个构件</span>' +
      '</div>';

    // 构件类型分布
    html += '<div class="bim-type-list">';
    details.forEach(function(d) {
      // 类型图标
      var iconMap = {
        "wallstandardcase": "bi-bricks",
        "slab": "bi-columns-gap",
        "column": "bi-arrow-up-square",
        "furnishingelement": "bi-lamp",
        "railing": "bi-grid-3x3-gap",
        "openingelement": "bi-window"
      };
      var typeIcon = iconMap[d.type] || "bi-box";
      // 类型中文名
      var typeNameMap = {
        "wallstandardcase": "标准墙",
        "slab": "楼板",
        "column": "柱",
        "furnishingelement": "家具",
        "railing": "栏杆",
        "openingelement": "门窗洞口"
      };
      var typeName = typeNameMap[d.type] || d.type;

      // 百分比条
      var pct = (d.count / tot * 100).toFixed(0);

      html += '<div class="bim-type-row">' +
        '<span class="bim-type-icon"><i class="bi ' + typeIcon + '"></i></span>' +
        '<span class="bim-type-name">' + typeName + '</span>' +
        '<span class="bim-type-count">' + d.count + '</span>' +
        '<div class="bim-type-bar-track"><div class="bim-type-bar" style="width:' + pct + '%"></div></div>' +
        '</div>';
    });
    html += '</div></div>';
  });

  container.innerHTML = html;

  // 更新缓存状态
  if (typeof updateBimStatus === "function") updateBimStatus(total);
}

// ===== 火情蔓延数据 =====

async function loadSpreadData() {
  var container = document.getElementById("spreadModulePanel");
  if (spreadCache) {
    renderSpreadData(spreadCache);
    return;
  }

  container.innerHTML = '<div class="spatial-loading">正在加载蔓延数据...</div>';

  try {
    var resp = await fetch(SPREAD_API_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    var data = await resp.json();
    if (data.error) throw new Error(data.error);
    spreadCache = data;
    renderSpreadData(data);
  } catch (err) {
    container.innerHTML = '<div class="spatial-loading" style="color:#ef4444">加载失败: ' + err.message + "</div>";
  }
}

function renderSpreadData(data) {
  var container = document.getElementById("spreadModulePanel");
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="spatial-loading">暂无蔓延数据</div>';
    return;
  }

  var latest = data[data.length - 1];
  var initial = data[0];

  // 概要统计条
  var html =
    '<div style="padding:8px 12px;font-size:0.75rem;color:#64748b;background:#f8fafc;border-bottom:1px solid #e2e8f0">' +
    '<i class="bi bi-arrow-through-heart-fill me-1" style="color:#ef4444"></i>' +
    '60分钟内可能波及 <strong>' + (latest ? latest.affectedBuildings : 0) + '</strong> 栋建筑' +
    '（总 <strong>' + (latest ? latest.totalBuildings : 0) + '</strong> 栋，占比 ' + (latest ? latest.ratio : 0) + '%）' +
    '，扩散速度 <strong>' + (initial ? initial.speed : 0) + ' m/min</strong></div>';

  // 时间线表格
  html += '<div style="padding:8px 0">' +
    '<table class="spread-table">' +
    '<thead><tr>' +
    '<th>时间(分钟)</th>' +
    '<th>受影响建筑</th>' +
    '<th>总建筑数</th>' +
    '<th>占比</th>' +
    '<th>扩散速度</th>' +
    '</tr></thead><tbody>';

  data.forEach(function(d) {
    // 根据占比决定行颜色
    var rowClass = "";
    if (d.ratio >= 50) rowClass = ' class="spread-row-danger"';
    else if (d.ratio >= 20) rowClass = ' class="spread-row-warn"';

    html += '<tr' + rowClass + '>' +
      '<td>' + d.timeMin + '</td>' +
      '<td><strong>' + d.affectedBuildings + '</strong></td>' +
      '<td>' + d.totalBuildings + '</td>' +
      '<td>' + d.ratio + '%</td>' +
      '<td>' + d.speed + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';

  // 进度可视化条
  html += '<div style="padding:4px 12px 12px">';
  data.forEach(function(d) {
    var barColor = d.ratio >= 50 ? "#ef4444" : d.ratio >= 20 ? "#eab308" : "#22c55e";
    html += '<div class="spread-bar-row">' +
      '<span class="spread-bar-label">' + d.timeMin + 'min</span>' +
      '<div class="spread-bar-track">' +
      '<div class="spread-bar-fill" style="width:' + d.ratio + '%;background:' + barColor + '"></div>' +
      '</div>' +
      '<span class="spread-bar-value">' + d.affectedBuildings + '</span>' +
      '</div>';
  });
  html += '</div>';

  container.innerHTML = html;
}

// ===== 刷新数据（外部调用） =====
function refreshBimSpreadData() {
  bimCache = null;
  spreadCache = null;
  var activeTab = document.querySelector(".spatial-module-tab.active");
  if (activeTab) {
    switchSpatialModule(activeTab.getAttribute("data-module"));
  }
}

// ===== 损失评估图表 =====

async function loadLossData() {
  var chartContainer = document.getElementById("lossChart");
  var infoContainer = document.getElementById("lossInfo");
  if (!chartContainer) return;

  if (lossCache) {
    renderLossChart(lossCache);
    return;
  }

  chartContainer.innerHTML = '<div class="spatial-loading">正在加载损失评估数据...</div>';

  try {
    var resp = await fetch(LOSS_API_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    var data = await resp.json();
    if (data.error) throw new Error(data.error);
    lossCache = data;
    renderLossChart(data);
  } catch (err) {
    chartContainer.innerHTML = '<div class="spatial-loading" style="color:#ef4444">加载失败: ' + err.message + "</div>";
  }
}

function renderLossChart(data) {
  var chartContainer = document.getElementById("lossChart");
  var infoContainer = document.getElementById("lossInfo");
  if (!chartContainer || !data.lossData || data.lossData.length === 0) return;

  // ---- 1) 概要信息 ----
  var last = data.lossData[data.lossData.length - 1];
  infoContainer.innerHTML =
    '<div style="padding:10px;background:linear-gradient(135deg,#fef2f2,#fff);border-radius:8px">' +
    '<div style="font-size:0.78rem;font-weight:600;color:#dc2626;margin-bottom:6px">' +
    '<i class="bi bi-exclamation-triangle-fill me-1"></i>综合损失评估摘要</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">' +
    '<div class="loss-stat-item"><div class="loss-stat-val" style="color:#dc2626">' + last.affectedBuildings + '</div><div class="loss-stat-lbl">受影响建筑(栋)</div></div>' +
    '<div class="loss-stat-item"><div class="loss-stat-val" style="color:#f97316">' + last.estDisplaced + '</div><div class="loss-stat-lbl">需疏散(人)</div></div>' +
    '<div class="loss-stat-item"><div class="loss-stat-val" style="color:#eab308">' + last.estReconstructionCost + '</div><div class="loss-stat-lbl">重建成本(万元)</div></div>' +
    '</div></div>';

  // 销毁旧图表实例
  if (chartContainer._chart) {
    chartContainer._chart.dispose();
    chartContainer._chart = null;
  }

  // ---- 2) 检查 ECharts ----
  if (typeof echarts === "undefined") {
    chartContainer.innerHTML = '<div class="spatial-loading">ECharts 未加载</div>';
    return;
  }

  // ---- 3) 构建数据 ----
  var categories = data.lossData.map(function(d) { return d.timeMin + "分钟"; });
  var bldData = data.lossData.map(function(d) { return d.affectedBuildings; });
  var popData = data.lossData.map(function(d) { return Math.round(d.estDisplaced / 10); });  // 十人
  var costData = data.lossData.map(function(d) { return Math.round(d.estReconstructionCost / 10); });  // 十万元

  var chart = echarts.init(chartContainer);
  chartContainer._chart = chart;

  var option = {
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,0.95)",
      borderColor: "#e2e8f0",
      borderWidth: 1,
      textStyle: { fontSize: 12, color: "#1e293b" },
      formatter: function(params) {
        var timeIdx = params[0].dataIndex;
        var d = data.lossData[timeIdx];
        return '<div style="font-weight:700;margin-bottom:6px;color:#1e293b">' + d.timeMin + ' 分钟时间节点</div>' +
          '<div style="font-size:12px;line-height:1.8">' +
          '🏚 受影响建筑: <b>' + d.affectedBuildings + '</b> 栋 (占' + d.ratio + '%)<br>' +
          '👥 预估影响人口: <b>' + d.estPopulation + '</b> 人<br>' +
          '🚶 需疏散人口: <b>' + d.estDisplaced + '</b> 人<br>' +
          '💰 重建成本: <b>' + d.estReconstructionCost + '</b> 万元<br>' +
          '📊 综合损失指数: <b>' + d.compositeLossIndex + '</b>' +
          '</div>';
      },
      extraCssText: "border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1)"
    },
    legend: {
      data: ["受影响建筑(十栋)", "需疏散人口(百人)", "重建成本(十万元)"],
      top: 0,
      itemWidth: 12,
      itemHeight: 12,
      textStyle: { fontSize: 11, color: "#475569" }
    },
    grid: {
      top: 40, bottom: 10, left: 10, right: 10,
      containLabel: true
    },
    xAxis: {
      type: "category",
      data: categories,
      axisLine: { lineStyle: { color: "#cbd5e1" } },
      axisTick: { alignWithLabel: true },
      axisLabel: { color: "#475569", fontWeight: 600 }
    },
    yAxis: {
      type: "value",
      name: "数量",
      nameTextStyle: { fontSize: 10, color: "#94a3b8" },
      splitLine: { lineStyle: { type: "dashed", color: "#e2e8f0" } },
      axisLabel: { fontSize: 10, color: "#94a3b8" }
    },
    series: [
      {
        name: "受影响建筑(十栋)",
        type: "bar",
        data: bldData.map(function(v) { return Math.round(v / 10); }),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#ef4444" }, { offset: 1, color: "#fca5a5" }
          ]),
          borderRadius: [4, 4, 0, 0]
        },
        barWidth: 16
      },
      {
        name: "需疏散人口(百人)",
        type: "bar",
        data: popData,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#f97316" }, { offset: 1, color: "#fdba74" }
          ]),
          borderRadius: [4, 4, 0, 0]
        },
        barWidth: 16
      },
      {
        name: "重建成本(十万元)",
        type: "bar",
        data: costData,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#eab308" }, { offset: 1, color: "#fde047" }
          ]),
          borderRadius: [4, 4, 0, 0]
        },
        barWidth: 16
      }
    ]
  };

  chart.setOption(option);
  window.addEventListener("resize", function() { chart.resize(); });
}
