# 无人机自由飞行模式 — 开发全程记录

> 项目：无人机救火三维指挥系统  
> 平台：SuperMap3D (Cesium 内核) / ASP.NET Core 8.0 / 原生 JavaScript  
> 时间：2026 年 5 月 30 日（周六）— 6 月 1 日（周一）  
> 作者：无人机 MVP 开发组

---

## 一、需求背景

在三维 GIS 指挥系统中，需要提供一个**无人机自由飞行视角**——操作员可以像驾驶无人机一样在三维场景中自由移动、观察地形和建筑。具体要求：

| 功能 | 描述 |
|------|------|
| WASD 移动 | 相对机头方向前进/后退/左右平移 |
| Space/Shift 升降 | 垂直升降 |
| 鼠标控制朝向 | 移动鼠标改变 heading（航向）和 pitch（俯仰） |
| 滚轮调速 | 5 档速度：1 / 5 / 20 / 50 / 200 m/s |
| HUD 信息 | 实时显示速度、高度、航向、俯仰角 |
| 最低高度限制 | 不低于地面 2m |
| Esc 退出 | 恢复默认地球浏览模式 |

---

## 二、整体架构设计

### 2.1 类结构：`DroneController`

```
DroneController
 ├── 输入状态管理    _keys: {w,s,a,d,space,shift}
 ├── 相机状态        _position (Cartesian3), _heading, _pitch
 ├── 速度档位        _speedLevels: [1,5,20,50,200]
 ├── 缓存向量池      8 个预分配 Cartesian3/Cartographic（避免 GC）
 ├── 事件绑定        keydown/keyup/mousemove/wheel/pointerlockchange
 ├── 更新循环        clock.onTick → _onTick()
 └── HUD             setInterval 200ms 刷新
```

### 2.2 与系统集成

| 文件 | 角色 |
|------|------|
| `wwwroot/project/js/droneMode.js` | 无人机控制器全部逻辑（365 行） |
| `wwwroot/project/js/htmlmain.js` | 初始化 viewer，重置视角按钮联动 |
| `wwwroot/project/index.html` | HUD 的 DOM 结构 + 无人机视角按钮 |
| `wwwroot/project/css/main.css` | HUD 样式（`.drone-hud` 系列） |

---

## 三、核心技术方案

### 3.1 ECEF 坐标系下的 ENU 局部移动

SuperMap3D/Cesium 使用 **ECEF**（地心地固坐标系），简单的 `(x,y,z)` 加减在球面上是错误的——比如在北极附近，"向前"不是 `+z`。

解决方案：每帧基于当前位置构建 **ENU 局部坐标系**（East-North-Up），将 heading 方向分解为 ENU 向量，再累加到 ECEF 位置：

```javascript
// 1. 获取当前位置的 ENU 变换矩阵
var enuMatrix = SuperMap3D.Transforms.eastNorthUpToFixedFrame(this._position);

// 2. 提取 East / North / Up 基向量
east.x = enuMatrix[0];   north.x = enuMatrix[4];   up.x = enuMatrix[8];
east.y = enuMatrix[1];   north.y = enuMatrix[5];   up.y = enuMatrix[9];
east.z = enuMatrix[2];   north.z = enuMatrix[6];   up.z = enuMatrix[10];

// 3. 按 heading 合成 forward / right
forward = north × cos(heading) + east × sin(heading)
right   = north × sin(heading) - east × cos(heading)   // 即 forward 右旋 90°

// 4. 位移 = 方向向量 × 速度 × dt
pos += forward × speed × dt    // W 键
pos -= forward × speed × dt    // S 键
pos += right   × speed × dt    // D 键
pos -= right   × speed × dt    // A 键
pos += up      × speed × dt    // Space
pos -= up      × speed × dt    // Shift
```

### 3.2 向量缓存池

为每帧计算预分配 8 个 Scratch 对象，避免反复 `new Cartesian3()` 导致的 GC 抖动：

```javascript
this._scratchEast    = new SuperMap3D.Cartesian3();
this._scratchNorth   = new SuperMap3D.Cartesian3();
this._scratchUp      = new SuperMap3D.Cartesian3();
this._scratchForward = new SuperMap3D.Cartesian3();
this._scratchRight   = new SuperMap3D.Cartesian3();
this._scratchStep    = new SuperMap3D.Cartesian3();
this._scratchCarto   = new SuperMap3D.Cartographic();
```

### 3.3 相机控制模式切换

进入无人机模式时**完全接管相机**，禁用 SuperMap3D 默认的鼠标/触控交互：

```javascript
// 进入：禁用默认相机控制
ctrl.enableRotate = enableZoom = enableTilt = enableTranslate = false;
// 退出：恢复
ctrl.enableRotate = enableZoom = enableTilt = enableTranslate = true;
```

### 3.4 Pointer Lock API（鼠标锁定）

进入无人机模式时锁定鼠标指针，提供无限旋转的 FPS 式视角控制。降级方案：如果 Pointer Lock 失败（如用户取消），按住左键拖动也可控制朝向。

### 3.5 海拔限制

```javascript
var carto = Cartographic.fromCartesian(pos, Ellipsoid.WGS84, scratchCarto);
if (carto && carto.height < 2) {
    this._position = Cartesian3.fromRadians(carto.longitude, carto.latitude, 2);
}
```

---

## 四、踩坑记录与解决方案

### 坑 1：无人机"一格一格往前跳"（核心问题）

**现象**：按住 W 键，无人机不是平滑飞行，而是每隔几百毫秒向前跳一段距离。松开键后画面才更新。

**踩坑过程**：

#### 尝试 1：`scene.preRender` 方案 ❌

最初怀疑 `clock.onTick` 触发频率不够（它只在场景有动画时触发）。尝试将更新循环绑定到 `scene.preRender`（与 `requestAnimationFrame` 同步，60fps 保证）：

```javascript
// enable() 中
this._viewer.scene.preRender.addEventListener(this._boundTick);
```

**结果**：控制台疯狂报 `DeveloperError`。原因：Cesium 在 `preRender` 阶段锁定了相机状态，不允许外部调用 `camera.setView()`。

**教训**：`preRender` 用于渲染管线内的操作（更新图元、调整材质），不是给相机操控用的。

#### 尝试 2：仅加 `shouldAnimate = true` ❌

退回 `clock.onTick`，但在 `enable()` 中加上 `shouldAnimate = true` 强制渲染循环持续运行：

```javascript
this._viewer.clock.shouldAnimate = true;
```

**结果**：仍然报 `DeveloperError`，照样一格一格跳。

#### 调试定位：增强错误日志 🔍

将 catch 块的简陋日志：
```javascript
console.warn('DroneController tick error:', e);
```

改为完整输出：
```javascript
console.warn('  name=' + e.name + ' message=' + (e.message || '(empty)'));
console.warn('  stack=' + (e.stack || '(no stack)'));
console.warn('  pos=(' + this._position.x + ',' + ... + ')');
```

**关键发现**：
```
message=oneOverRadii is required.
at scaleToGeodeticSurface
at Cartographic.fromCartesian (droneMode.js:200)
```

#### 根因确认：API 参数顺序错误 ✅

`SuperMap3D.Cartographic.fromCartesian` 的完整签名是：
```javascript
Cartographic.fromCartesian(cartesian, ellipsoid, result)
//                          参数1      参数2      参数3
```

但代码中写的是：
```javascript
// 错误！Cartographic 对象被当成了 ellipsoid
var carto = SuperMap3D.Cartographic.fromCartesian(pos, this._scratchCarto);
```

Cesium 内部尝试访问 `ellipsoid.oneOverRadii`，拿到的是 Cartographic 对象上不存在的属性（`undefined`），抛出 `DeveloperError("oneOverRadii is required.")`。

**为什么这会导致"一格一格跳"？**

追踪完整的 tick 流程：

```
Tick N (按键按下):
  ① 位置累加 (pos += forward × step)  ← 成功执行
  ② fromCartesian 抛异常               ← LINE 200 崩溃
  ③ catch 吞掉异常
  ④ camera.setView() 被跳过             ← 相机不更新！

Tick N+1 (按键仍按下):
  ① 位置再次累加                        ← 位置又叠了一层
  ② fromCartesian 又抛异常
  ③ 还是没有 setView

Tick N+K (恰好无按键):
  hasMove = false
  跳过 ① 和 ②
  ③ camera.setView() 用累积的位置一次性瞬移  ← 跳！
```

**修复**：
```javascript
// 正确：明确传入 WGS84 椭球体
var carto = SuperMap3D.Cartographic.fromCartesian(
    pos, SuperMap3D.Ellipsoid.WGS84, this._scratchCarto
);
```

### 坑 2：`shouldAnimate` 未开启

原始代码没有设置 `shouldAnimate`，默认 `false`。SuperMap3D/Cesium 只在场景"脏"了（用户拖拽、数据加载完成）时才渲染。按住 W 不动鼠标 → 场景不脏 → `clock.onTick` 不触发 → 卡顿。

**修复**：
```javascript
// enable()
this._viewer.clock.shouldAnimate = true;

// disable()
this._viewer.clock.shouldAnimate = false;
```

这是保证 tick 以 60fps 稳定触发的必要条件。

### 坑 3：dt 时间步长处理

`clock.onTick` 回调不带参数，无法直接获取 delta time。使用 `performance.now()` 手动计算：

```javascript
var now = performance.now();
var dt = (now - this._lastTickTime) / 1000;
this._lastTickTime = now;
// 安全 clamp：异常大的 dt（如切标签页回来）按 16ms 处理，防止瞬移
if (dt <= 0 || dt > 0.05) dt = 0.016;
```

注意：不要放宽这个上限。曾有人建议把 `0.05` 改成 `0.1`，但在掉帧时会导致单步跳跃 2m（`speed=20 × dt=0.1`），比原来的"一格一格"更严重。

---

## 五、最终实现清单

### 功能矩阵

| 操作 | 效果 | 技术实现 |
|------|------|----------|
| W / S | 前进 / 后退 | ENU forward × speed × dt |
| A / D | 左平移 / 右平移 | ENU right × speed × dt |
| Space / Shift | 上升 / 下降 | ENU up × speed × dt |
| 鼠标移动 | 转向 + 俯仰 | Pointer Lock + movementX/Y |
| 滚轮 | 切换速度 1↔5↔20↔50↔200 m/s | deltaY 方向判断 |
| 最低高度 2m | 防止钻地 | fromCartesian + fromRadians |
| Pitch ±85° | 防止翻转 | 硬限制 |
| Esc | 退出 | disable() + 恢复默认相机控制 |

### 文件大小

- `droneMode.js`：365 行（含注释和空行）
- 核心逻辑 `_onTick()`：约 100 行
- 所有改动集中在 1 个文件

### 性能考量

| 项目 | 策略 |
|------|------|
| 向量计算 | 8 个预分配 scratch 对象，0 GC 分配 |
| 相机更新 | `camera.setView()` 每帧调用（约 60 次/秒） |
| HUD 刷新 | `setInterval` 200ms，避免高频 DOM 操作 |
| 错误处理 | 3 次错误后静默，防止刷屏 |

---

## 六、调试技巧总结

1. **Cesium `DeveloperError` 的 `message` 是核心线索**——不要只打印 `e.name`，要打印 `e.message` + `e.stack`
2. **不要轻易信任 API 参数个数**——SuperMap3D 基于旧版 Cesium，有些 API 签名和新版文档不一致，要以实际报错为准
3. **`camera.setView()` 只能在 `clock.onTick` 里调**，不能在 `preRender`/`postRender` 里调
4. **`shouldAnimate = true` 是 Cesium 持续渲染的开关**，没有它就没有稳定的 60fps
5. **dt clamp 不要放宽**，否则掉帧时大 dt 会产生严重瞬移

---

## 七、时间线

| 日期 | 事件 |
|------|------|
| 5 月 30 日（周六） | 确定需求，设计 DroneController 架构 |
| 5 月 31 日（周日） | 完成 MVP 编码：ENU 移动 + 键盘映射 + 鼠标控制 + HUD，提交 `7e8a44e` |
| 6 月 1 日（周一） | 排查"一格一格跳"问题：尝试 preRender（失败）→ 加 shouldAnimate（仍失败）→ 增强日志 → 定位 fromCartesian 参数错误 → 修复 → 飞行正常 |

---

## 八、参考

- SuperMap3D API（基于 Cesium 1.x 扩展）
- [Cesium `Camera.setView` 文档](https://cesium.com/learn/cesiumjs/ref-doc/Camera.html#setView)
- [Cesium `Cartographic.fromCartesian` 签名](https://cesium.com/learn/cesiumjs/ref-doc/Cartographic.html#.fromCartesian)
- MDN: [Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API)
- ENU 坐标系原理：East-North-Up 局部切平面
