// ===== SituationAnalysis — 态势综合分析面板 =====
// 深色科技风 · 综合统计 · 编队状态 · 态势小地图
// 挂载到 DroneHud 生命周期

var situationAnalysis = null;

var DRONE_FLEET = [
  { id: 'DJ-001', name: '先锋号', status: 1, alt: 120, spd: 18, batt: 72 },
  { id: 'DJ-002', name: '烈焰号', status: 1, alt: 150, spd: 22, batt: 55 },
  { id: 'DJ-003', name: '守望号', status: 1, alt: 98,  spd: 15, batt: 83 },
  { id: 'DJ-004', name: '追风号', status: 1, alt: 200, spd: 25, batt: 41 },
  { id: 'DJ-005', name: '闪电号', status: 0, alt: 80,  spd: 12, batt: 90 },
  { id: 'DJ-006', name: '雷霆号', status: 0, alt: 65,  spd: 10, batt: 88 },
  { id: 'DJ-007', name: '暴风号', status: 0, alt: 110, spd: 14, batt: 76 },
  { id: 'DJ-008', name: '星火号', status: 0, alt: 95,  spd: 16, batt: 62 },
  { id: 'DJ-009', name: '曙光号', status: 0, alt: 130, spd: 20, batt: 45 },
  { id: 'DJ-010', name: '夜鹰号', status: 3, alt: 180, spd: 8,  batt: 15 },
  { id: 'DJ-011', name: '飞燕号', status: 3, alt: 160, spd: 7,  batt: 22 },
  { id: 'DJ-012', name: '猎隼号', status: 0, alt: 140, spd: 19, batt: 68 }
];

var STATUS_MAP = { 0: ['待命', '#94a3b8', '⚪'], 1: ['任务中', '#3b82f6', '🔵'], 2: ['巡航中', '#22c55e', '🟢'], 3: ['返航中', '#f59e0b', '🟡'] };

class SituationAnalysis {
  constructor() {
    this._visible = false;
    this._panel = null;
    this._miniMapCanvas = null;
    this._echartsDom = null;
    this._echartsInst = null;
    this._fleetTimer = null;
    this._frameId = null;
  }

  // ===== 生命周期挂钩 =====
  onEnter() {
    if (this._visible) return;
    this._visible = true;
    this._ensurePanel();
    if (this._panel) this._panel.style.display = 'block';
    this._startFleetSim();
    this._startMiniMap();
    this._renderStats();
    this._initGauge();
  }

  onExit() {
    this._visible = false;
    if (this._panel) this._panel.style.display = 'none';
    this._stopFleetSim();
    this._stopMiniMap();
  }

  // called every frame by DroneHud.updateFlightData
  onFrame(dronePosition, heading, poiEntitiesRef, riskEntitiesRef) {
    if (!this._visible) return;
    this._dronePosition = dronePosition;
    this._heading = heading;
    this._poiEntities = poiEntitiesRef;
    this._riskEntities = riskEntitiesRef;
  }

  onReset() {
    this._dronePosition = null;
    this._poiEntities = null;
    this._riskEntities = null;
  }

  // ===== 确保面板 DOM =====
  _ensurePanel() {
    if (this._panel) return;
    var panel = document.getElementById('hudSituationPanel');
    if (panel) { this._panel = panel; this._bindDom(); return; }

    // 动态创建
    panel = document.createElement('div');
    panel.id = 'hudSituationPanel';
    panel.className = 'hud-situation-panel';
    panel.innerHTML =
      '<div class="sit-header">📊 态势综合分析</div>' +
      '<div class="sit-stats" id="sitStats"></div>' +
      '<div class="sit-gauge-wrap"><div id="sitGaugeChart" style="width:100%;height:160px"></div></div>' +
      '<div class="sit-fleet-title">🚁 无人机编队实时状态</div>' +
      '<div class="sit-fleet-table-wrap"><table class="sit-fleet-table"><thead><tr>' +
      '<th>编号</th><th>名称</th><th>高度(m)</th><th>速度(m/s)</th><th>电量</th><th>状态</th>' +
      '</tr></thead><tbody id="sitFleetBody"></tbody></table></div>' +
      '<div class="sit-minimap-wrap"><canvas id="sitMiniMap" width="280" height="280"></canvas></div>';
    var hud = document.getElementById('droneHud');
    if (hud) hud.appendChild(panel);
    this._panel = panel;
    this._bindDom();
  }

  _bindDom() {
    this._miniMapCanvas = document.getElementById('sitMiniMap');
    this._echartsDom = document.getElementById('sitGaugeChart');
    this._statsDom = document.getElementById('sitStats');
    this._fleetBody = document.getElementById('sitFleetBody');
  }

  // ===== 统计卡片 =====
  _renderStats() {
    if (!this._statsDom) return;
    var total = DRONE_FLEET.length;
    var online = DRONE_FLEET.filter(function(d) { return d.status === 1 || d.status === 2; }).length;
    var onMission = DRONE_FLEET.filter(function(d) { return d.status === 1; }).length;
    var fireCount = 0, stationCount = 0, riskCount = 0;
    if (typeof poiEntities !== 'undefined') {
      if (poiEntities.firepoint) fireCount = poiEntities.firepoint.length;
      if (poiEntities.firestation) stationCount = poiEntities.firestation.length;
    }
    if (typeof riskEntities !== 'undefined') riskCount = riskEntities.length;

    this._statsDom.innerHTML =
      '<div class="sit-stat-card blue"><div class="sit-stat-val">' + total + '</div><div class="sit-stat-lbl">无人机总数</div></div>' +
      '<div class="sit-stat-card green"><div class="sit-stat-val">' + online + '/' + onMission + '</div><div class="sit-stat-lbl">在线/任务中</div></div>' +
      '<div class="sit-stat-card red"><div class="sit-stat-val">' + fireCount + '</div><div class="sit-stat-lbl">已发现火点</div></div>' +
      '<div class="sit-stat-card orange"><div class="sit-stat-val">' + stationCount + '</div><div class="sit-stat-lbl">消防站覆盖</div></div>' +
      '<div class="sit-stat-card yellow full"><div class="sit-stat-val">' + riskCount + ' 栋</div><div class="sit-stat-lbl">风险建筑监测</div></div>';
  }

  // ===== ECharts 半圆仪表 =====
  _initGauge() {
    if (!this._echartsDom) return;
    var self = this;
    if (typeof echarts === 'undefined') return;
    try {
      if (this._echartsInst) this._echartsInst.dispose();
      this._echartsInst = echarts.init(this._echartsDom);
      this._echartsInst.setOption({
        series: [{
          type: 'gauge',
          startAngle: 180, endAngle: 0,
          center: ['50%', '75%'], radius: '100%',
          min: 0, max: 100,
          splitNumber: 4,
          axisLine: {
            lineStyle: { width: 14, color: [[0.3, '#22c55e'], [0.6, '#f59e0b'], [0.8, '#f97316'], [1, '#ef4444']] }
          },
          pointer: { length: '60%', width: 6, itemStyle: { color: '#00d4ff' } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          detail: {
            formatter: '{value}%',
            offsetCenter: [0, '55%'],
            fontSize: 18,
            fontWeight: 'bold',
            color: '#00d4ff'
          },
          title: { show: false },
          data: [{ value: 72, name: '火情处置率' }]
        }]
      });
    } catch(e) { console.warn('态势仪表初始化失败:', e); }
  }

  updateGauge(val) {
    if (this._echartsInst) {
      try { this._echartsInst.setOption({ series: [{ data: [{ value: Math.round(val) }] }] }); } catch(e) {}
    }
  }

  // ===== 编队实时状态表 =====
  _startFleetSim() {
    var self = this;
    this._updateFleetTable();
    this._fleetTimer = setInterval(function() { self._updateFleetTable(); }, 1000);
  }

  _stopFleetSim() {
    if (this._fleetTimer) { clearInterval(this._fleetTimer); this._fleetTimer = null; }
  }

  _updateFleetTable() {
    if (!this._fleetBody) return;
    // 每秒微调模拟数据
    DRONE_FLEET.forEach(function(d) {
      d.alt = Math.max(30, d.alt + (Math.random() - 0.5) * 10);
      d.spd = Math.max(5, Math.min(30, d.spd + (Math.random() - 0.5) * 4));
      d.batt = Math.max(5, d.batt - Math.random() * 0.3);
    });

    var rows = '';
    DRONE_FLEET.forEach(function(d) {
      var s = STATUS_MAP[d.status] || STATUS_MAP[0];
      var battColor = d.batt > 40 ? '#22c55e' : d.batt > 20 ? '#f59e0b' : '#ef4444';
      rows += '<tr>' +
        '<td>' + d.id + '</td>' +
        '<td>' + d.name + '</td>' +
        '<td>' + d.alt.toFixed(0) + '</td>' +
        '<td>' + d.spd.toFixed(1) + '</td>' +
        '<td style="color:' + battColor + '">' + d.batt.toFixed(0) + '%</td>' +
        '<td>' + s[2] + ' ' + s[0] + '</td>' +
        '</tr>';
    });
    this._fleetBody.innerHTML = rows;
  }

  // ===== Canvas 态势小地图 =====
  _startMiniMap() {
    var self = this;
    var animate = function() {
      if (!self._visible) { self._frameId = null; return; }
      self._drawMiniMap();
      self._frameId = requestAnimationFrame(animate);
    };
    this._frameId = requestAnimationFrame(animate);
  }

  _stopMiniMap() {
    if (this._frameId) { cancelAnimationFrame(this._frameId); this._frameId = null; }
  }

  _drawMiniMap() {
    var canvas = this._miniMapCanvas;
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var cx = w / 2, cy = h / 2;
    var range = 1000; // 1km x 1km
    var scale = (w - 20) / range;

    ctx.clearRect(0, 0, w, h);

    // 背景
    ctx.fillStyle = 'rgba(10,14,23,0.85)';
    ctx.fillRect(0, 0, w, h);

    // 网格
    ctx.strokeStyle = 'rgba(0,180,220,0.08)';
    ctx.lineWidth = 0.5;
    var gridStep = 200;
    for (var gx = 0; gx <= range; gx += gridStep) {
      var px = 10 + gx * scale;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    }
    for (var gy = 0; gy <= range; gy += gridStep) {
      var py = 10 + gy * scale;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    }

    // 绘制POI的函数
    var self = this;
    var drawPoint = function(pos, color, size, label) {
      if (!pos || !self._dronePosition) return;
      try {
        var dCarto = SuperMap3D.Cartographic.fromCartesian(pos);
        var rCarto = SuperMap3D.Cartographic.fromCartesian(self._dronePosition);
        var dx = (dCarto.longitude - rCarto.longitude) * 111320 * Math.cos(rCarto.latitude);
        var dy = (dCarto.latitude - rCarto.latitude) * 111320;
        var px = cx + dx / range * (w - 20);
        var py = cy - dy / range * (h - 20);
        if (Math.abs(dx) > range / 2 || Math.abs(dy) > range / 2) return;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill();
        if (label) {
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '9px "Microsoft YaHei",sans-serif';
          ctx.fillText(label, px + size + 2, py + 3);
        }
      } catch(e) {}
    };

    // 火点
    if (typeof poiEntities !== 'undefined' && poiEntities.firepoint) {
      for (var i = 0; i < poiEntities.firepoint.length; i++) {
        try {
          var p = (typeof safeGetEntityPosition === 'function')
            ? safeGetEntityPosition(poiEntities.firepoint[i])
            : poiEntities.firepoint[i].position.getValue(viewer.clock.currentTime);
          drawPoint(p, '#ef4444', 3);
        } catch(e) {}
      }
    }
    // 消防站
    if (typeof poiEntities !== 'undefined' && poiEntities.firestation) {
      for (var j = 0; j < poiEntities.firestation.length; j++) {
        try {
          var ps = (typeof safeGetEntityPosition === 'function')
            ? safeGetEntityPosition(poiEntities.firestation[j])
            : poiEntities.firestation[j].position.getValue(viewer.clock.currentTime);
          drawPoint(ps, '#f97316', 2.5);
        } catch(e) {}
      }
    }
    // 风险建筑
    if (typeof riskEntities !== 'undefined') {
      for (var k = 0; k < riskEntities.length; k++) {
        try {
          var re = riskEntities[k];
          if (!re.show) continue;
          var hierarchy = re.polygon ? re.polygon.hierarchy.getValue() : null;
          if (hierarchy && hierarchy.positions && hierarchy.positions.length > 0) {
            var posArr = hierarchy.positions;
            var scx = 0, scy = 0, scz = 0;
            for (var pi = 0; pi < posArr.length; pi++) { scx += posArr[pi].x; scy += posArr[pi].y; scz += posArr[pi].z; }
            var center = new SuperMap3D.Cartesian3(scx / posArr.length, scy / posArr.length, scz / posArr.length);
            drawPoint(center, '#eab308', 2);
          }
        } catch(e) {}
      }
    }

    // 本机方向箭头 ▲
    ctx.fillStyle = '#00d4ff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx - 6, cy + 6);
    ctx.lineTo(cx + 6, cy + 6);
    ctx.closePath();
    ctx.fill();

    // 中心点
    ctx.fillStyle = '#00d4ff';
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();

    // 北向标注
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 10px "Microsoft YaHei",sans-serif';
    ctx.fillText('N', 6, 12);

    // 比例尺
    var scaleBarPx = 200 * scale;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, h - 12); ctx.lineTo(10 + scaleBarPx, h - 12); ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.font = '8px "Consolas",monospace';
    ctx.fillText('200m', 10 + scaleBarPx + 4, h - 8);
  }
}

// ===== 初始化 =====
function initSituationAnalysis() {
  if (!situationAnalysis) {
    situationAnalysis = new SituationAnalysis();
    console.log('SituationAnalysis 已初始化');
  }
  return situationAnalysis;
}

// 挂载到 DroneHud
(function patchDroneHud() {
  var origShow = DroneHud.prototype.show;
  var origHide = DroneHud.prototype.hide;
  var origUpdate = DroneHud.prototype.updateFlightData;
  var origReset = DroneHud.prototype._resetAll;

  DroneHud.prototype.show = function() {
    origShow.apply(this, arguments);
    initSituationAnalysis();
    situationAnalysis.onEnter();
    this._sitPatched = true;
  };

  DroneHud.prototype.hide = function() {
    origHide.apply(this, arguments);
    if (situationAnalysis) situationAnalysis.onExit();
    this._sitPatched = false;
  };

  DroneHud.prototype.updateFlightData = function(data) {
    origUpdate.apply(this, arguments);
    if (this._sitPatched && situationAnalysis) {
      situationAnalysis.onFrame(data.position, data.heading);
      // 每2秒更新一次统计（避免频繁DOM操作）
      var now = performance.now();
      if (!this._lastSitUpdate || now - this._lastSitUpdate > 2000) {
        this._lastSitUpdate = now;
        situationAnalysis._renderStats();
        var disposalRate = Math.min(95, 50 + Math.random() * 40);
        situationAnalysis.updateGauge(disposalRate);
      }
    }
  };

  var origResetAll = DroneHud.prototype._resetAll;
  DroneHud.prototype._resetAll = function() {
    origResetAll.apply(this, arguments);
    if (situationAnalysis) situationAnalysis.onReset();
  };
})();
