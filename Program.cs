using System.Diagnostics;
using System.Text;
using MySql.Data.MySqlClient;
using new_try_world.Models;
using new_try_world.Services;

// 注册编码提供程序（支持 GBK）
Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

// 自动清理占用 5007 端口的旧进程
try
{
    var psi = new ProcessStartInfo("taskkill", "/f /im \"new try world.exe\"")
    {
        CreateNoWindow = true,
        UseShellExecute = false
    };
    Process.Start(psi);
    Thread.Sleep(1000);
}
catch { }

var builder = WebApplication.CreateBuilder(args);

// 注册 HttpClient 和 DeepSeekService
builder.Services.AddHttpClient<DeepSeekService>();
builder.Services.AddScoped<DeepSeekService>();

// 允许跨域（前端同源不需要，但保留扩展性）
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

var app = builder.Build();

app.UseStaticFiles();
app.UseCors();

// ===== Chat API 端点 =====
app.MapPost("/api/chat", async (ChatRequest req, DeepSeekService deepSeek) =>
{
    try
    {
        if (string.IsNullOrWhiteSpace(req.Message))
        {
            return Results.BadRequest(new ChatResponse { Reply = "消息不能为空。" });
        }

        var reply = await deepSeek.ProcessMessageAsync(req.Message, req.History);
        return Results.Ok(new ChatResponse { Reply = reply });
    }
    catch
    {
        return Results.StatusCode(500);
    }
});

// ===== 数据库健康检查端点 =====
app.MapGet("/api/db/status", async (IConfiguration config) =>
{
    try
    {
        var connStr = config.GetConnectionString("MySQL");
        if (string.IsNullOrEmpty(connStr))
            return Results.Ok(new { connected = false, message = "数据库连接串未配置" });

        await using var conn = new MySql.Data.MySqlClient.MySqlConnection(connStr);
        await conn.OpenAsync();
        await using var cmd = new MySql.Data.MySqlClient.MySqlCommand("SELECT 1", conn);
        await cmd.ExecuteScalarAsync();
        return Results.Ok(new { connected = true, message = "数据库连接正常" });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { connected = false, message = $"连接失败: {ex.Message}" });
    }
});

// ===== 数据库 Schema 端点（用于探索表结构） =====
app.MapGet("/api/db/schema", async (IConfiguration config) =>
{
    try
    {
        var connStr = config.GetConnectionString("MySQL");
        if (string.IsNullOrEmpty(connStr))
            return Results.Ok(new { error = "未配置" });

        await using var conn = new MySqlConnection(connStr);
        await conn.OpenAsync();

        // 获取所有表
        var tables = new List<string>();
        await using (var cmd = new MySqlCommand("SHOW TABLES", conn))
        await using (var reader = await cmd.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
                tables.Add(reader.GetString(0));
        }

        // 获取每张表的结构
        var schema = new Dictionary<string, object>();
        foreach (var table in tables)
        {
            var columns = new List<Dictionary<string, object?>>();
            await using (var cmd = new MySqlCommand($"SHOW FULL COLUMNS FROM `{table}`", conn))
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    var col = new Dictionary<string, object?>();
                    for (int i = 0; i < reader.FieldCount; i++)
                        col[reader.GetName(i)] = reader.GetValue(i) == DBNull.Value ? null : reader.GetValue(i);
                    columns.Add(col);
                }
            }

            // 外键信息
            var foreignKeys = new List<Dictionary<string, object?>>();
            await using (var cmd = new MySqlCommand($@"
                SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = 'supermap_Cup' AND TABLE_NAME = '{table}'
                  AND REFERENCED_TABLE_NAME IS NOT NULL", conn))
            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    var fk = new Dictionary<string, object?>();
                    for (int i = 0; i < reader.FieldCount; i++)
                        fk[reader.GetName(i)] = reader.GetValue(i) == DBNull.Value ? null : reader.GetValue(i);
                    foreignKeys.Add(fk);
                }
            }

            schema[table] = new { columns, foreignKeys };
        }

        return Results.Ok(schema);
    }
    catch (Exception ex)
    {
        return Results.Ok(new { error = ex.Message });
    }
});

// ===== POI 坐标查询：从 MySQL 读取所有 POI 经纬度 =====
app.MapGet("/api/pois", async (IConfiguration config) =>
{
    try
    {
        var connStr = config.GetConnectionString("MySQL");
        if (string.IsNullOrEmpty(connStr))
            return Results.Ok(new { error = "数据库连接串未配置" });

        await using var conn = new MySqlConnection(connStr);
        await conn.OpenAsync();

        var sql = @"
            SELECT `名称` as name, '医院' as type, 'hospital' as category, `经度` as lon, `纬度` as lat, `地址` as address, `电话` as phone FROM `医院`
            UNION ALL
            SELECT `名称` as name, '商场' as type, 'mall' as category, `经度` as lon, `纬度` as lat, `地址` as address, `电话` as phone FROM `商场`
            UNION ALL
            SELECT `单位名称` as name, '政府' as type, 'government' as category, `经度` as lon, `纬度` as lat, NULL as address, NULL as phone FROM `政府`
            UNION ALL
            SELECT `单位名称` as name, '消防站' as type, 'firestation' as category, `经度` as lon, `纬度` as lat, NULL as address, NULL as phone FROM `消防站`
            UNION ALL
            SELECT `名称` as name, '起火点' as type, 'firepoint' as category, `经度` as lon, `纬度` as lat, NULL as address, NULL as phone FROM `起火点`
        ";

        await using var cmd = new MySqlCommand(sql, conn);
        await using var reader = await cmd.ExecuteReaderAsync();

        var pois = new List<object>();
        while (await reader.ReadAsync())
        {
            pois.Add(new
            {
                name = reader.GetString(0),
                type = reader.GetString(1),
                category = reader.GetString(2),
                lon = reader.GetDouble(3),
                lat = reader.GetDouble(4),
                address = reader.IsDBNull(5) ? null : reader.GetString(5),
                phone = reader.IsDBNull(6) ? null : reader.GetString(6)
            });
        }

        return Results.Ok(pois);
    }
    catch (Exception ex)
    {
        return Results.Ok(new { error = ex.Message });
    }
});

app.MapFallbackToFile("project/index.html");

// ===== 空间查询：读取 CSV 距离数据（3 个起火点 x 11 个 POI） =====
var spatialCsvPath = Path.Combine(app.Environment.ContentRootPath, "成果", "csv_20260518", "fire_poi_distance_all.csv");

List<Dictionary<string, string>> ReadSpatialCsv()
{
    var rows = new List<Dictionary<string, string>>();
    if (!File.Exists(spatialCsvPath)) return rows;

    // 自动检测 CSV 编码：BOM → 严格 UTF-8 → GBK → Latin-1
    var encoding = GuessEncoding(spatialCsvPath);

    using var reader = new StreamReader(spatialCsvPath, encoding);
    var headerLine = reader.ReadLine();
    if (headerLine == null) return rows;
    var headers = headerLine.Split(',');

    string? line;
    while ((line = reader.ReadLine()) != null)
    {
        if (string.IsNullOrWhiteSpace(line)) continue;
        var cols = line.Split(',');
        var row = new Dictionary<string, string>();
        for (int i = 0; i < headers.Length && i < cols.Length; i++)
            row[headers[i]] = cols[i].Trim('"');
        rows.Add(row);
    }
    return rows;
}

static Encoding GuessEncoding(string path)
{
    var bytes = File.ReadAllBytes(path);
    if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
        return Encoding.UTF8;
    bool hasHigh = false;
    foreach (var b in bytes) { if (b > 0x7F) { hasHigh = true; break; } }
    if (!hasHigh) return Encoding.UTF8;
    // 优先 UTF-8 严格验证（新版 CSV 均为 UTF-8 编码）
    try
    {
        var utf8 = new UTF8Encoding(false, true);
        var text = utf8.GetString(bytes);
        // 含中文且无乱码 → 确认为 UTF-8
        if (text.Any(c => c >= 0x4E00 && c <= 0x9FFF))
            return Encoding.UTF8;
        return Encoding.UTF8;
    }
    catch { }
    // 回退 GBK（旧版 Windows 中文 ANSI 编码）
    try { return Encoding.GetEncoding("GBK"); }
    catch { return Encoding.UTF8; }
}

// 获取所有起火点
app.MapGet("/api/spatial/fires", () =>
{
    try
    {
        var rows = ReadSpatialCsv();
        var fires = rows
            .GroupBy(r => r["fire_id"])
            .Select(g => new
            {
                fireId = int.Parse(g.Key),
                fireScene = g.First()["fire_scene"]
            })
            .OrderBy(f => f.fireId)
            .ToList();
        return Results.Ok(fires);
    }
    catch (Exception ex)
    {
        return Results.Ok(new { error = ex.Message });
    }
});

// 按起火点查询 POI 距离
app.MapGet("/api/spatial/pois", (int fireId) =>
{
    try
    {
        var rows = ReadSpatialCsv();
        var pois = rows
            .Where(r => r["fire_id"] == fireId.ToString())
            .Select(r => new
            {
                fireId = int.Parse(r["fire_id"]),
                fireScene = r["fire_scene"],
                poiId = int.Parse(r["poi_id"]),
                poiType = r["poi_type"],
                poiName = r["poi_name"],
                straightDistM = double.TryParse(r["straight_dist_m"], out var sd) ? Math.Round(sd, 0) : (double?)null,
                networkDistM = double.TryParse(r["network_dist_m"], out var nd) ? Math.Round(nd, 0) : (double?)null,
                travelTimeMin = double.TryParse(r["travel_time_est_min"], out var tt) ? Math.Round(tt, 1) : (double?)null,
                rankNetwork = int.TryParse(r["rank_network"], out var rn) ? rn : (int?)null,
                rankStraight = int.TryParse(r["rank_straight"], out var rs) ? rs : (int?)null,
                solveStatus = r["solve_status"]
            })
            .OrderBy(p => p.solveStatus != "ok" ? 1 : 0)
            .ThenBy(p => p.rankNetwork ?? 99)
            .ToList();
        return Results.Ok(pois);
    }
    catch (Exception ex)
    {
        return Results.Ok(new { error = ex.Message });
    }
});

// ===== BIM 受灾统计：读取 CSV 按楼层/类型聚合 =====
var bimCsvPath = Path.Combine(app.Environment.ContentRootPath, "成果", "火情模拟", "bim_fire_20260523_2259", "BIM受灾统计表.csv");

app.MapGet("/api/bim/fire-stats", () =>
{
    try
    {
        if (!File.Exists(bimCsvPath))
            return Results.Ok(new { error = "BIM受灾统计文件不存在" });

        var rows = new List<Dictionary<string, string>>();
        using var reader = new StreamReader(bimCsvPath, System.Text.Encoding.UTF8);
        var headerLine = reader.ReadLine(); // 表头
        if (headerLine == null) return Results.Ok(new { error = "文件为空" });
        var headers = headerLine.Split(',');

        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var cols = line.Split(',');
            var row = new Dictionary<string, string>();
            for (int i = 0; i < headers.Length && i < cols.Length; i++)
                row[headers[i]] = cols[i].Trim('"');
            rows.Add(row);
        }

        // 按楼层 + 类型聚合
        var aggregated = rows
            .Where(r => !string.IsNullOrEmpty(r.GetValueOrDefault("楼层(BldgLevel)")) && !string.IsNullOrEmpty(r.GetValueOrDefault("构件类型(Category)")))
            .GroupBy(r => new { floor = r["楼层(BldgLevel)"], type = r["构件类型(Category)"] })
            .Select(g => new
            {
                floor = g.Key.floor,
                type = g.Key.type,
                count = g.Count()
            })
            .OrderBy(x => x.floor)
            .ThenBy(x => x.type)
            .ToList();

        // 按楼层汇总
        var byFloor = aggregated
            .GroupBy(x => x.floor)
            .Select(g => new
            {
                floor = g.Key,
                total = g.Sum(x => x.count),
                details = g.ToList()
            })
            .OrderBy(x => int.TryParse(x.floor, out var f) ? f : 99)
            .ToList();

        return Results.Ok(new
        {
            totalCount = rows.Count,
            byFloor,
            allRows = rows.Select(r => new
            {
                floor = r.GetValueOrDefault("楼层(BldgLevel)"),
                category = r.GetValueOrDefault("构件类型(Category)"),
                objectId = r.GetValueOrDefault("构件ID(ObjectId)"),
                family = r.GetValueOrDefault("族(Family)")
            }).ToList()
        });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { error = ex.Message });
    }
});

// ===== 火情蔓延统计：读取 CSV 返回时间序列 =====
var spreadCsvPath = Path.Combine(app.Environment.ContentRootPath, "成果", "火情模拟", "fire_spread_20260520_1342", "蔓延统计.csv");

app.MapGet("/api/spread/data", () =>
{
    try
    {
        if (!File.Exists(spreadCsvPath))
            return Results.Ok(new { error = "蔓延统计文件不存在" });

        var rows = new List<Dictionary<string, string>>();
        using var reader = new StreamReader(spreadCsvPath, System.Text.Encoding.UTF8);
        var headerLine = reader.ReadLine();
        if (headerLine == null) return Results.Ok(new { error = "文件为空" });
        var headers = headerLine.Split(',');

        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var cols = line.Split(',');
            var row = new Dictionary<string, string>();
            for (int i = 0; i < headers.Length && i < cols.Length; i++)
                row[headers[i]] = cols[i].Trim('"');
            rows.Add(row);
        }

        var result = rows.Select(r => new
        {
            timeMin = int.TryParse(r.GetValueOrDefault("时间阈值(分钟)"), out var t) ? t : 0,
            affectedBuildings = int.TryParse(r.GetValueOrDefault("受影响建筑数"), out var a) ? a : 0,
            totalBuildings = int.TryParse(r.GetValueOrDefault("总建筑数"), out var tb) ? tb : 0,
            ratio = double.TryParse(r.GetValueOrDefault("占比(%)"), out var p) ? p : 0.0,
            speed = double.TryParse(r.GetValueOrDefault("扩散速度(m/min)"), out var s) ? s : 0.0
        }).ToList();

        return Results.Ok(result);
    }
    catch (Exception ex)
    {
        return Results.Ok(new { error = ex.Message });
    }
});

// ===== 损失估算：结合蔓延 + BIM + 人口估算的多维损失评估 =====
app.MapGet("/api/loss/estimate", () =>
{
    try
    {
        // 读取蔓延数据
        var spreadRows = new List<Dictionary<string, string>>();
        if (File.Exists(spreadCsvPath))
        {
            using var r = new StreamReader(spreadCsvPath, System.Text.Encoding.UTF8);
            var h = r.ReadLine()?.Split(',') ?? [];
            string? l;
            while ((l = r.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(l)) continue;
                var c = l.Split(',');
                var row = new Dictionary<string, string>();
                for (int i = 0; i < h.Length && i < c.Length; i++) row[h[i]] = c[i].Trim('"');
                spreadRows.Add(row);
            }
        }

        // 读取 BIM 总数
        int bimTotal = 0;
        if (File.Exists(bimCsvPath))
        {
            using var r = new StreamReader(bimCsvPath, System.Text.Encoding.UTF8);
            string? l;
            while ((l = r.ReadLine()) != null)
            {
                if (!string.IsNullOrWhiteSpace(l) && !l.StartsWith("楼层")) bimTotal++;
            }
        }

        // 人口与经济估算参数
        const double POP_PER_BLD = 80;      // 每栋建筑平均 80 人
        const double COST_PER_BLD = 500;    // 每栋重建成本 500 万元
        const double BLD_VALUE = 2000;      // 每栋建筑价值 2000 万元（含内容物）

        var result = spreadRows.Select(row =>
        {
            var t = int.TryParse(row.GetValueOrDefault("时间阈值(分钟)"), out var ti) ? ti : 0;
            var a = int.TryParse(row.GetValueOrDefault("受影响建筑数"), out var ai) ? ai : 0;
            var tb = int.TryParse(row.GetValueOrDefault("总建筑数"), out var tbi) ? tbi : 0;
            var r2 = double.TryParse(row.GetValueOrDefault("占比(%)"), out var ri) ? ri : 0.0;

            return new
            {
                timeMin = t,
                affectedBuildings = a,
                totalBuildings = tb,
                ratio = r2,
                // 人口影响
                estPopulation = (int)(a * POP_PER_BLD),
                estDisplaced = (int)(a * POP_PER_BLD * 0.6),   // 60% 需疏散
                // 经济损失（万元）
                estReconstructionCost = (int)(a * COST_PER_BLD),
                estPropertyLoss = (int)(a * BLD_VALUE),
                // BIM 受灾构件（按比例折算）
                affectedComponents = (int)(bimTotal * r2 / 100.0),
                // 综合损失指数（0-100）
                compositeLossIndex = Math.Round(r2 * 0.6 + Math.Min(a / 10.0, 100) * 0.4, 1)
            };
        }).ToList();

        return Results.Ok(new
        {
            bimTotal,
            lossData = result,
            summary = new
            {
                maxPopulation = (int)(result.LastOrDefault()?.affectedBuildings * POP_PER_BLD ?? 0),
                maxCost = (int)(result.LastOrDefault()?.affectedBuildings * COST_PER_BLD ?? 0),
                maxDisplaced = (int)(result.LastOrDefault()?.affectedBuildings * POP_PER_BLD * 0.6 ?? 0)
            }
        });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { error = ex.Message });
    }
});

// ===== 火势蔓延与 BIM 火球 API（空间数据由 iServer 提供） =====

var spatialServiceUrl = "http://localhost:8090/iserver/services/fireSimulation/rest/data";
var datasourceName = "DataSource";

var planarScenes = new[]
{
    new { fireId = 1, fireName = "起火点 A — 居民区", lon = 114.05, lat = 22.62, description = "城中村密集建筑区起火" },
    new { fireId = 2, fireName = "起火点 B — 商业区", lon = 114.07, lat = 22.61, description = "商业综合体3层起火" },
    new { fireId = 3, fireName = "起火点 C — 工业区", lon = 114.09, lat = 22.60, description = "化工厂仓库起火" }
};

var planarLayerMeta = new[]
{
    new { id = "planar_10min", label = "10分钟蔓延", timeMin = 10, datasetName = "平面蔓延边界_10min_1", legendColor = "#f59e0b", available = true, affectedBuildings = 17, totalBuildings = 330 },
    new { id = "planar_30min", label = "30分钟蔓延", timeMin = 30, datasetName = "平面蔓延边界_30min_1", legendColor = "#f97316", available = true, affectedBuildings = 81, totalBuildings = 330 },
    new { id = "planar_60min", label = "60分钟蔓延", timeMin = 60, datasetName = "平面蔓延边界_60min_1", legendColor = "#ef4444", available = true, affectedBuildings = 195, totalBuildings = 330 }
};

var bimScenes = new[]
{
    new { sceneId = "bim_a", sceneName = "BIM 场景 A — 居民楼", fireFloor = 3, s3mServiceUrl = "http://localhost:8090/iserver/services/1334/rest/realspace" }
};

var bimLayerMeta = new[]
{
    new { id = "bim_fb15", label = "15米火球", radiusM = 15, datasetName = "BIM_3D火球_15m_1", legendColor = "#ff6b35", available = true, totalComponents = 0 },
    new { id = "bim_fb30", label = "30米火球", radiusM = 30, datasetName = "BIM_3D火球_30m_1", legendColor = "#e74c3c", available = true, totalComponents = 0 },
    new { id = "bim_fb60", label = "60米火球", radiusM = 60, datasetName = "BIM_3D火球_60m_1", legendColor = "#8e44ad", available = true, totalComponents = 0 },
    new { id = "bim_affected", label = "受灾构件", radiusM = 60, datasetName = "BIM_3D受灾构件_1", legendColor = "#c0392b", available = true, totalComponents = 418 }
};

app.MapGet("/api/spread/planar/scenes", () => Results.Ok(planarScenes));
app.MapGet("/api/spread/planar/layers", () =>
{
    var layers = planarLayerMeta.Select(l => new
    {
        l.id, l.label, l.timeMin, l.datasetName, l.legendColor,
        l.available, l.affectedBuildings, l.totalBuildings,
        serviceUrl = spatialServiceUrl,
        featureUrl = l.available
            ? $"{spatialServiceUrl}/datasources/{datasourceName}/datasets/{l.datasetName}/features.json?returnContent=true&fromIndex=0&toIndex=500"
            : null
    });
    return Results.Ok(layers);
});

app.MapGet("/api/spread/bim/scenes", () => Results.Ok(bimScenes));
app.MapGet("/api/spread/bim/layers", () =>
{
    var layers = bimLayerMeta.Select(l => new
    {
        l.id, l.label, l.radiusM, l.datasetName, l.legendColor,
        l.available, l.totalComponents,
        serviceUrl = spatialServiceUrl,
        featureUrl = l.available
            ? $"{spatialServiceUrl}/datasources/{datasourceName}/datasets/{l.datasetName}/features.json?returnContent=true&fromIndex=0&toIndex=500"
            : null
    });
    return Results.Ok(layers);
});

app.Run();
