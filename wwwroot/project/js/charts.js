// 绘制 ECharts 图表
function initECharts() {
  if (typeof echarts === "undefined") {
    console.error("ECharts 未加载，请检查网络！");
    return;
  }

  // 左侧：柱状图
  var barChart = echarts.init(document.getElementById("barChart"));
  var barOption = {
    grid: { top: 10, bottom: 20, left: 50, right: 30 },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category",
      data: ["龙岗区", "宝安区", "福田区", "罗湖区", "南山区"],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: "#475569", fontWeight: "bold" }
    },
    series: [
      {
        type: "bar",
        data: [42, 58, 76, 89, 115],
        barWidth: 14,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: "#f59e0b" },
            { offset: 1, color: "#ef4444" }
          ]),
          borderRadius: [0, 7, 7, 0]
        },
        label: {
          show: true,
          position: "right",
          color: "#ef4444",
          fontWeight: "bold"
        }
      }
    ]
  };
  barChart.setOption(barOption);

  // 右侧：折线图
  var lineChart = echarts.init(document.getElementById("lineChart"));
  var lineOption = {
    grid: { top: 30, bottom: 20, left: 40, right: 15 },
    tooltip: { trigger: "axis" },
    legend: {
      data: ["火场面积", "扑灭面积"],
      top: 0,
      itemWidth: 12,
      itemHeight: 12
    },
    xAxis: {
      type: "category",
      data: ["08:00", "12:00", "16:00", "20:00", "00:00", "04:00"],
      axisLine: { lineStyle: { color: "#cbd5e1" } }
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { type: "dashed", color: "#e2e8f0" } }
    },
    series: [
      {
        name: "火场面积",
        type: "line",
        smooth: true,
        data: [200, 450, 800, 600, 300, 100],
        itemStyle: { color: "#ef4444" },
        areaStyle: { color: "rgba(239, 68, 68, 0.1)" }
      },
      {
        name: "扑灭面积",
        type: "line",
        smooth: true,
        data: [0, 100, 350, 700, 850, 950],
        itemStyle: { color: "#3b82f6" },
        areaStyle: { color: "rgba(59, 130, 246, 0.2)" }
      }
    ]
  };
  lineChart.setOption(lineOption);

  // 监听窗口缩放，自适应图表大小
  window.addEventListener("resize", function () {
    barChart.resize();
    lineChart.resize();
  });
}
