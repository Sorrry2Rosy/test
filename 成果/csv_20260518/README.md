# Fire → POI 距离分析结果

**生成时间**: 2026-05-18 14:42:12
**起火点**: Fire_Points OBJECTID=1（场景：厂房）
**POI 数据**: 政府(1) + 医院(3) + 商场(7) = 共 11 个

---

## 四个 CSV 文件说明

### 1. `fire_poi_distance_all.csv` —— 主表

起火点到每个 POI 的完整距离信息，一行一个 POI，**供数据库导入**。

| 字段 (EN) | 字段 (CN) | 说明 |
|-----------|-----------|------|
| fire_id | 起火点编号 | 固定为 1 |
| fire_scene | 起火场景 | 厂房 |
| poi_id | POI编号 | POI 要素的 OBJECTID |
| poi_type | POI类别 | 政府 / 医院 / 商场 |
| poi_name | POI名称 | 从原始数据读取或自动生成 |
| straight_dist_m | 直线距离(米) | 平面欧氏距离 |
| network_dist_m | 路网距离(米) | 沿路网最短路径距离 |
| travel_time_est_min | 估算通行时间(分钟) | 按 40 km/h 估算 |
| rank_network | 按路网距离排序 | 1=最近（可达POI内比较） |
| rank_straight | 按直线距离排序 | 1=最近（可达POI内比较） |
| solve_status | 求解状态 | ok=可达，unreachable=路网无路径 |
| run_time | 生成时间 | 脚本运行时刻 |

- **行数**: 11 条（含表头 12 行）
- **可达**: 6 条 | **不可达**: 5 条（均为商场）

### 2. `fire_poi_distance_all_publish.csv` —— 发布版

字段和主表**完全一致**，区别在于**第 1 行是英文列名，第 2 行是中文含义**。给不熟悉英文列名的读者查看时更友好，也适合直接出报告。

### 3. `fire_poi_nearest.csv` —— 最近 POI 查询表

只包含**路网可达的 POI**，按 `rank_network` 升序排列（离起火点最近的排第一）。

- **行数**: 6 条（含表头 7 行）
- **最近 POI**: 政府（政府_1），路网距离 4059m（约 6 分钟）
- **最远可达 POI**: 商场（万象前海），路网距离 7921m（约 12 分钟）

### 4. `field_dictionary.csv` —— 字段字典附表

| field_en | field_cn |
|-----------|----------|
| fire_id | 起火点编号 |
| fire_scene | 起火场景 |
| poi_id | POI编号 |
| poi_type | POI类别 |
| poi_name | POI名称 |
| straight_dist_m | 直线距离(米) |
| network_dist_m | 路网距离(米) |
| travel_time_est_min | 估算通行时间(分钟) |
| rank_network | 按路网距离排序 |
| rank_straight | 按直线距离排序 |
| solve_status | 求解状态 |
| run_time | 生成时间 |

---

## 技术说明

- **坐标系**: CGCS2000_3_Degree_GK_CM_114E（投影坐标系，单位米）
- **路网**: 深圳地区 129,805 条路段
- **网络分析**: OD Cost Matrix，阻抗=Length（路网距离，米）
- **通行速度**: 默认 40 km/h（666.67 m/min）
- **不可达原因**: 5 个商场 POI 位于路网孤立段或与起火点之间无连通路径
- **POI 数据源**: D:\超图杯\二维底图shp0517第二版（留仙洞片区局部数据）
