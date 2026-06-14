-- =============================================
-- 无人机救火三维指挥系统 - 数据库初始化脚本
-- 适用于 MySQL 8.0+
-- 使用方法: mysql -u root -p < Data/init.sql
-- =============================================

CREATE DATABASE IF NOT EXISTS firefighting_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE firefighting_db;

-- =============================================
-- 消防辖区表
-- =============================================
CREATE TABLE IF NOT EXISTS fire_districts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL COMMENT '辖区名称',
  danger_level INT NOT NULL DEFAULT 1 COMMENT '火险等级 1-5',
  incident_count INT NOT NULL DEFAULT 0 COMMENT '当前火场数',
  description VARCHAR(200) DEFAULT NULL COMMENT '备注',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- 火场信息表
-- =============================================
CREATE TABLE IF NOT EXISTS fire_incidents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  district_id INT NOT NULL COMMENT '所属辖区',
  location VARCHAR(200) NOT NULL COMMENT '火场位置',
  fire_level INT NOT NULL DEFAULT 1 COMMENT '火势等级 1-5',
  area_sqkm DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '火场面积(平方公里)',
  contained_area_sqkm DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '已扑灭面积',
  status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态: active/contained/extinguished',
  reported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '报告时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (district_id) REFERENCES fire_districts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- 无人机信息表
-- =============================================
CREATE TABLE IF NOT EXISTS drones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL COMMENT '无人机名称',
  type VARCHAR(30) NOT NULL COMMENT '类型: reconnaissance/firefighting/supply',
  status VARCHAR(20) NOT NULL DEFAULT 'idle' COMMENT '状态: idle/cruising/operation/returning',
  current_incident_id INT DEFAULT NULL COMMENT '当前任务火场',
  battery_level INT NOT NULL DEFAULT 100 COMMENT '电量百分比',
  water_capacity INT NOT NULL DEFAULT 0 COMMENT '载水量(L)',
  last_maintenance DATE DEFAULT NULL COMMENT '最后保养日期',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (current_incident_id) REFERENCES fire_incidents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- 调度记录表
-- =============================================
CREATE TABLE IF NOT EXISTS dispatch_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  incident_id INT NOT NULL COMMENT '关联火场',
  drone_id INT NOT NULL COMMENT '关联无人机',
  action VARCHAR(50) NOT NULL COMMENT '操作: dispatch/return/refill/operation',
  description VARCHAR(200) DEFAULT NULL COMMENT '描述',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (incident_id) REFERENCES fire_incidents(id),
  FOREIGN KEY (drone_id) REFERENCES drones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- 火势趋势记录表（近24小时）
-- =============================================
CREATE TABLE IF NOT EXISTS fire_trends (
  id INT AUTO_INCREMENT PRIMARY KEY,
  incident_id INT NOT NULL,
  recorded_at DATETIME NOT NULL COMMENT '记录时间',
  fire_area_sqkm DECIMAL(10,2) NOT NULL COMMENT '当前火场面积',
  contained_area_sqkm DECIMAL(10,2) NOT NULL COMMENT '已扑灭面积',
  FOREIGN KEY (incident_id) REFERENCES fire_incidents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================
-- 插入示例数据
-- =============================================

-- 辖区数据
INSERT INTO fire_districts (name, danger_level, incident_count, description) VALUES
('龙岗区', 3, 2, '龙岗区火险中等，多山林火灾'),
('宝安区', 4, 3, '宝安区火险较高，工业区密集'),
('福田区', 2, 1, '福田区火险较低，城区消防覆盖完善'),
('罗湖区', 4, 3, '罗湖区老旧建筑较多，火险偏高'),
('南山区', 5, 3, '南山区科技园区密集，火险最高');

-- 火场数据
INSERT INTO fire_incidents (district_id, location, fire_level, area_sqkm, contained_area_sqkm, status, reported_at) VALUES
(1, '龙岗区梧桐山北麓', 3, 42.00, 10.00, 'active', '2026-05-11 08:30:00'),
(1, '龙岗区坪地街道工业区', 2, 15.00, 5.00, 'active', '2026-05-11 14:20:00'),
(2, '宝安区西乡街道', 4, 58.00, 8.00, 'active', '2026-05-11 06:00:00'),
(2, '宝安区石岩水库周边', 3, 35.00, 15.00, 'contained', '2026-05-10 22:00:00'),
(2, '宝安区沙井街道', 2, 12.00, 10.00, 'contained', '2026-05-11 10:30:00'),
(3, '福田区莲花山公园', 2, 8.00, 6.00, 'extinguished', '2026-05-11 12:00:00'),
(4, '罗湖区东门老街', 3, 25.00, 5.00, 'active', '2026-05-11 09:15:00'),
(4, '罗湖区银湖山', 2, 10.00, 3.00, 'active', '2026-05-11 16:00:00'),
(4, '罗湖区水库新村', 4, 30.00, 2.00, 'active', '2026-05-11 18:00:00'),
(5, '南山区科技园南区', 5, 85.00, 5.00, 'active', '2026-05-11 05:30:00'),
(5, '南山区蛇口码头', 3, 20.00, 8.00, 'contained', '2026-05-11 07:00:00'),
(5, '南山区西丽水库', 2, 10.00, 8.00, 'extinguished', '2026-05-10 20:00:00');

-- 无人机数据
INSERT INTO drones (name, type, status, current_incident_id, battery_level, water_capacity, last_maintenance) VALUES
('猎鹰 01 号', 'reconnaissance', 'cruising', 1, 85, 0, '2026-04-15'),
('猎鹰 02 号', 'reconnaissance', 'cruising', 3, 72, 0, '2026-04-10'),
('水神 01 号', 'firefighting', 'operation', 3, 45, 2000, '2026-03-20'),
('水神 02 号', 'firefighting', 'operation', 1, 60, 3000, '2026-03-25'),
('水神 03 号', 'firefighting', 'returning', 1, 20, 500, '2026-04-01'),
('水神 04 号', 'firefighting', 'idle', NULL, 100, 3000, '2026-04-05'),
('补给 01 号', 'supply', 'idle', NULL, 95, 0, '2026-05-01');

-- 调度记录
INSERT INTO dispatch_records (incident_id, drone_id, action, description, created_at) VALUES
(1, 1, 'dispatch', '猎鹰01号派遣至梧桐山侦察火情', '2026-05-11 08:35:00'),
(1, 4, 'dispatch', '水神02号派遣至梧桐山灭火', '2026-05-11 08:40:00'),
(1, 5, 'dispatch', '水神03号派遣至梧桐山支援', '2026-05-11 09:00:00'),
(3, 2, 'dispatch', '猎鹰02号派遣至西乡侦察', '2026-05-11 06:10:00'),
(3, 3, 'dispatch', '水神01号派遣至西乡灭火', '2026-05-11 06:15:00'),
(5, 5, 'return', '水神03号返航补水', '2026-05-11 15:30:00');

-- 火势趋势（火场ID=3 西乡 近24h）
INSERT INTO fire_trends (incident_id, recorded_at, fire_area_sqkm, contained_area_sqkm) VALUES
(3, '2026-05-11 08:00:00', 200.00, 0.00),
(3, '2026-05-11 12:00:00', 450.00, 100.00),
(3, '2026-05-11 16:00:00', 800.00, 350.00),
(3, '2026-05-11 20:00:00', 600.00, 700.00),
(3, '2026-05-12 00:00:00', 300.00, 850.00),
(3, '2026-05-12 04:00:00', 100.00, 950.00);
