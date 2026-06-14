// ===== HUD_CONFIG — 无人机指挥 HUD 模拟数据常量 =====
// 所有固定/模拟数据集中管理，方便统一修改

var HUD_CONFIG = {
  // ---- 火势相关（无真实数据源，固定展示） ----
  fireIntensity: 'Ⅱ级',
  windSpeed: '4.2 m/s',
  spreadDirection: '东北',
  ambientTemp: '38 ℃',
  fireSourceTemp: '216 ℃',

  // ---- 巡航速度（用于 ETA 计算） ----
  cruiseSpeed: 20,  // m/s

  // ---- 电量告警阈值 ----
  batteryLow: 30,   // ≤30% 低电量警告
  batteryCrit: 10,  // ≤10% 危险

  // ---- 雷达 ----
  radarRadius: 5000,  // 扫描半径（米）
  radarSweepSpeed: 2 // 扫描线旋转周期（秒/圈）
};

// ===== MySQL 不可用时火点坐标回退数据 =====
// key 为 fireScene 名称，value 为 [经度, 纬度]
var FALLBACK_FIRE_POSITIONS = {
  '厂房':       [114.052, 22.621],
  '商业区':     [114.071, 22.612],
  '居民区':     [114.048, 22.625],
  '仓库':       [114.093, 22.603],
  '办公楼':     [114.065, 22.618],
  '学校':       [114.055, 22.615],
  '医院':       [114.059, 22.608],
  '油库':       [114.088, 22.598],
  '市场':       [114.068, 22.620],
  '酒店':       [114.062, 22.610],
  '充电站':     [114.075, 22.606],
  '变电站':     [114.082, 22.613]
};

// 根据名称获取火点位置（先查 poiEntities，再查回退表）
function getFirePositionByName(name) {
  // 1. 优先从 poiEntities 实时查找
  if (typeof poiEntities !== 'undefined') {
    for (var cat in poiEntities) {
      var entities = poiEntities[cat];
      if (!entities) continue;
      for (var i = 0; i < entities.length; i++) {
        if (entities[i]._poiData && entities[i]._poiData.name === name) {
          return safeGetEntityPosition ? safeGetEntityPosition(entities[i]) : null;
        }
      }
    }
  }
  // 2. 回退到静态坐标表
  if (name && FALLBACK_FIRE_POSITIONS[name]) {
    var coord = FALLBACK_FIRE_POSITIONS[name];
    console.log('getFirePositionByName — 使用回退坐标: ' + name + ' [' + coord[0] + ', ' + coord[1] + ']');
    return SuperMap3D.Cartesian3.fromDegrees(coord[0], coord[1], 60);
  }
  // 3. 模糊匹配（名字包含关键字）
  if (name) {
    for (var key in FALLBACK_FIRE_POSITIONS) {
      if (name.indexOf(key) !== -1 || key.indexOf(name) !== -1) {
        var fcoord = FALLBACK_FIRE_POSITIONS[key];
        console.log('getFirePositionByName — 模糊匹配回退: ' + name + ' → ' + key);
        return SuperMap3D.Cartesian3.fromDegrees(fcoord[0], fcoord[1], 60);
      }
    }
  }
  return null;
}
