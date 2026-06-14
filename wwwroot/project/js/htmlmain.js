// ===== 全局变量与 viewer 初始化 =====
var viewer = null;
var initialCameraState = null;

function onload(SuperMap3D) {
  // 获取引擎类型，try-catch + NaN校验防止全盘崩溃
  var EngineType = 2;
  try {
    if (typeof getEngineType === "function") {
      var raw = getEngineType();
      EngineType = (typeof raw === 'number' && !isNaN(raw)) ? raw : 2;
    }
  } catch (e) {
    console.warn('getEngineType() 异常，回退 WebGL2:', e.message);
    EngineType = 2;
  }
  console.log('[诊断] EngineType =', EngineType);

  // Viewer 构造加 try-catch
  try {
    viewer = new SuperMap3D.Viewer("Container", {
      contextOptions: { contextType: Number(EngineType) },
      selectionIndicator: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      homeButton: false,
      geocoder: false,
      fullscreenButton: false,
      baseLayerPicker: false,
      animation: false,
      timeline: false
    });
    console.log('[诊断] Viewer 创建成功');
  } catch (e) {
    console.error('[诊断] Viewer 创建失败:', e.message);
    showViewerError('3D 地球引擎初始化失败：' + e.message);
    return;
  }

  viewer.scenePromise.then(function (scene) {
    console.log('[诊断] scenePromise 兑现，场景就绪');
    viewer.resolutionScale = window.devicePixelRatio;

    // 加载高德底图 //dasd
    viewer.imageryLayers.addImageryProvider(
      new SuperMap3D.UrlTemplateImageryProvider({
        url: "https://webst02.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
        minimumLevel: 3,
        maximumLevel: 18,
        credit: new SuperMap3D.Credit("高德地图")
      })
    );

    // 加载 S3M 服务
    var s3mUrl =
      "http://localhost:8090/iserver/services/1334/rest/realspace";
    Promise.resolve(scene.open(s3mUrl))
      .then(function (layers) {
        if (layers && layers.length > 0) {
          viewer.flyTo(layers[0]);
          setTimeout(function () {
            if (viewer && viewer.camera) {
              initialCameraState = {
                position: viewer.camera.position.clone(),
                direction: viewer.camera.direction.clone(),
                up: viewer.camera.up.clone()
              };
              console.log("初始视角已保存");
            }
          }, 2000);
        }
        // 加载 POI 标记
        loadPoisToMap();
        setupPoiClickHandler();
        // 初始化热力图
        initHeatmap();
        // 加载风险分级图层
        loadRiskLayer();
      })
      .catch(function (error) {
        console.log("三维服务未连接，展示基础地球。");
        initialCameraState = {
          position: SuperMap3D.Cartesian3.fromDegrees(
            116.397,
            39.908,
            100000
          ),
          direction: new SuperMap3D.Cartesian3(0, 0, -1),
          up: new SuperMap3D.Cartesian3(0, 1, 0)
        };
        // 无三维服务时也加载 POI 标记
        loadPoisToMap();
        setupPoiClickHandler();
        // 初始化热力图
        initHeatmap();
        // 加载风险分级图层
        loadRiskLayer();
      });
  }).catch(function (err) {
    console.error('[诊断] scenePromise 拒绝:', err.message || err);
    showViewerError('3D 场景初始化超时或失败：' + (err.message || '未知错误'));
  });
}

// 显示 Viewer 加载失败的红色错误提示
function showViewerError(msg) {
  var el = document.getElementById('viewerErrorOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'viewerErrorOverlay';
    el.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:99999;'
      + 'background:rgba(220,38,38,0.95);color:#fff;padding:14px 28px;border-radius:10px;'
      + 'font-size:0.9rem;font-weight:600;box-shadow:0 4px 20px rgba(220,38,38,0.4);'
      + 'max-width:600px;text-align:center;line-height:1.5;';
    document.body.appendChild(el);
  }
  el.textContent = '⛔ ' + msg;
  setTimeout(function () {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 12000);
}

if (typeof SuperMap3D !== "undefined") {
  window.startupCalled = true;
  onload(SuperMap3D);
} else {
  console.error("未能成功加载 SuperMap3D 库，请检查引入路径！");
}

// ===== 导航按钮事件 =====
document.addEventListener("DOMContentLoaded", function () {
  const navButtons = document.querySelectorAll(".nav-btn");
  const leftPanel = document.getElementById("leftPanel");
  const rightPanel = document.getElementById("rightPanel");

  // 延迟渲染图表，确保在弹出版面后进行绘制
  setTimeout(initECharts, 300);

  // 关闭所有下拉菜单
  function closeAllDropdowns() {
    document.querySelectorAll(".dropdown-menu.show").forEach(function (menu) {
      menu.classList.remove("show");
    });
  }

  // 切换指定下拉菜单
  function toggleDropdown(dropdownId) {
    var menu = document.getElementById(dropdownId);
    if (!menu) return;
    var isOpen = menu.classList.contains("show");
    closeAllDropdowns();
    if (!isOpen) {
      menu.classList.add("show");
    }
  }

  // 点击页面其他区域关闭下拉
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".nav-dropdown")) {
      closeAllDropdowns();
    }
  });

  navButtons.forEach(function (button) {
    button.addEventListener("click", function (e) {
      e.stopPropagation();
      navButtons.forEach((btn) => btn.classList.remove("active"));
      this.classList.add("active");

      const target = this.getAttribute("data-target");

      if (target === "dashboard") {
        closeAllDropdowns();
        leftPanel.classList.remove("panel-hidden");
        rightPanel.classList.remove("panel-hidden");
        rightPanel.style.opacity = "";
        rightPanel.style.pointerEvents = "";
        document.getElementById("spatialPanel").classList.remove("open");
      } else if (target === "reset-view") {
        closeAllDropdowns();
        // 如果无人机模式开启，先退出
        if (droneController && droneController.enabled) {
          droneController.disable();
        }
        leftPanel.classList.add("panel-hidden");
        rightPanel.classList.add("panel-hidden");
        document.getElementById("spatialPanel").classList.remove("open");
        if (initialCameraState && viewer) {
          viewer.camera.flyTo({
            destination: initialCameraState.position,
            orientation: {
              direction: initialCameraState.direction,
              up: initialCameraState.up
            },
            duration: 1.5
          });
        }
      } else if (target === "spatial-query") {
        leftPanel.classList.add("panel-hidden");
        rightPanel.classList.add("panel-hidden");
        rightPanel.style.opacity = "";
        rightPanel.style.pointerEvents = "";
        toggleDropdown("spatialDropdown");
        toggleSpatial();
      } else if (target === "simulation") {
        // 由 onclick="toggleSpreadPanel()" 处理，此处仅收面板
        closeAllDropdowns();
        leftPanel.classList.add("panel-hidden");
        rightPanel.classList.add("panel-hidden");
      } else if (target === "risk-assessment") {
        leftPanel.classList.add("panel-hidden");
        rightPanel.classList.add("panel-hidden");
        toggleDropdown("riskDropdown");
      } else if (target === "flight-plan") {
        // 由 onclick="toggleFlightPlan()" 处理，此处仅收面板
        closeAllDropdowns();
        leftPanel.classList.add("panel-hidden");
        rightPanel.classList.add("panel-hidden");
      } else {
        closeAllDropdowns();
        leftPanel.classList.add("panel-hidden");
        rightPanel.classList.add("panel-hidden");
        rightPanel.style.opacity = "";
        rightPanel.style.pointerEvents = "";
        showToast(this.innerText.trim() + " - 功能开发中");
      }
    });
  });
});
