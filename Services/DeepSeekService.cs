using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MySql.Data.MySqlClient;
using new_try_world.Models;

namespace new_try_world.Services;

public class DeepSeekService
{
    private readonly IConfiguration _config;
    private readonly HttpClient _httpClient;
    private readonly ILogger<DeepSeekService> _logger;

    public DeepSeekService(IConfiguration config, HttpClient httpClient, ILogger<DeepSeekService> logger)
    {
        _config = config;
        _httpClient = httpClient;
        _logger = logger;
    }

    /// <summary>
    /// 处理用户消息：调用 DeepSeek Function Calling → 按需查库 → 返回最终回答
    /// </summary>
    public async Task<string> ProcessMessageAsync(string userMessage, List<ChatMessage> history)
    {
        var apiKey = _config["DeepSeek:ApiKey"] ?? throw new Exception("缺少 DeepSeek:ApiKey 配置");
        var apiUrl = _config["DeepSeek:ApiUrl"] ?? "https://api.deepseek.com/v1/chat/completions";
        var model = _config["DeepSeek:Model"] ?? "deepseek-chat";

        // 1. 构建消息列表
        var messages = new List<DeepSeekMessage>
        {
            new()
            {
                Role = "system",
                Content = @"你是一个无人机救火三维指挥系统的 AI 指挥官助手，系统部署于深圳前海片区。你基于以下数据辅助火场应急指挥决策：

## 系统数据源概览

### 1. POI 数据库（MySQL — supermap_Cup）
以下 4 张表位于专题图附近，字段名均为中文：
- `医院` — 名称, 地址, 经度, 纬度, 省份, 城市, 区县, 类型, 电话, 评分, 人均消费, 标签, 距离(米), 网站, 商业区域, 行业类型, 今日营业时间, 周营业时间, 照片数量, 停车场类型
- `商场` — 同上结构
- `政府` — 单位名称, 纬度, 经度
- `消防站` — 单位名称, 纬度, 经度

### 2. 空间距离分析（CSV 预计算结果）
3 个起火点 × 11 个 POI 的路径距离分析：
- 起火点场景: 厂房(fire_id=1)、住宅(fire_id=3)、企业楼(fire_id=4)
- POI 包含: 政府(1个) + 医院(3个) + 商场(7个)
- 字段: fire_id, fire_scene, poi_id, poi_type, poi_name, straight_dist_m(直线距离米), network_dist_m(路网距离米), travel_time_est_min(通行时间分钟，假设车速40km/h), rank_network(路网排序), rank_straight(直线排序), solve_status(ok=可达/unreachable=不可达)
- 注意: 5 个商场 POI 位于路网孤立段，solve_status 为 unreachable，路网距离和通行时间为空

### 3. 火情蔓延统计
- 10 分钟 → 17 栋建筑受影响 (5.2%)，扩散速度 50 m/min
- 30 分钟 → 81 栋建筑受影响 (24.5%)
- 60 分钟 → 195 栋建筑受影响 (59.1%)
- 总建筑数 330 栋

### 4. BIM 受灾统计
- 共 418 个构件受灾（0~4 楼）
- 构件类型: wallstandardcase(标准墙)、slab(楼板)、column(柱)、furnishingelement(家具)、railing(栏杆)、openingelement(门窗洞口)

### 5. 损失估算模型
- 每栋建筑平均人口: 80 人
- 需疏散比例: 60%
- 每栋重建成本: 500 万元

## 你的能力与职责

你是火灾应急指挥决策支持 AI，可以解答以下类型的问题：

### A. 火情态势查询
- ""当前火场情况"" → 返回 3 个起火点场景及各场景可达 POI 概览
- ""厂房火情周边有什么"" → 查询对应起火点的 POI 空间距离数据
- ""火势会蔓延到什么程度"" → 查询蔓延统计数据

### B. 救援资源评估
- ""最近的医院在哪里""、""消防站在哪"" → 使用 query_database 查 MySQL
- ""哪些医院路网可达，多远"" → 使用 query_fire_spatial 查空间距离
- ""到每个医院要多久"" → 提取 travel_time_est_min

### C. 损失与人口评估
- ""这次火灾会影响多少人""、""需要疏散多少人"" → 使用 query_loss_estimate
- ""经济损失有多大"" → 提取重建成本数据
- ""这次火灾受灾严重吗"" → 综合蔓延占比和损失指数给出研判

### D. 灭火救援决策
- ""最佳救援路径是什么"" → 根据 rank_network 推荐路网最近的 POI，优先推荐 solve_status=ok 的
- ""灭火救援时间估算"" → 根据通行时间 + 蔓延速度，推算最佳救援窗口
- ""人员撤离路线建议"" → 推荐距离最近的可达 POI 作为疏散点

### E. 综合指挥建议
- 当用户问""怎么办""、""建议""、""指挥方案""时，综合所有数据给出多维度建议：
  1. 火势发展研判（蔓延曲线）
  2. 疏散优先级（受影响建筑数）
  3. 医疗资源调配（可达医院及距离）
  4. 灭火力量部署（推荐消防站/政府作为指挥点）

## 回答规范
- 用中文回答，风格专业、简洁、条理清晰
- 每条信息独立一行，用 ● 符号开头
- 涉及数值时统一单位（距离用 km、时间用 分钟、人口用人、成本用 万元）
- 先给出结论/概览，再逐条列出
- 对于不可达的 POI 要明确标注 ""路网不可达""
- 数据不足时诚实告知，不编造数据
- 不要用 Markdown 表格，不要用编号列表
- 每条信息末尾可附带关键数据标签"
            }
        };

        // 添加上下文历史
        foreach (var msg in history)
        {
            messages.Add(new DeepSeekMessage { Role = msg.Role, Content = msg.Content });
        }

        // 添加当前用户消息
        messages.Add(new DeepSeekMessage { Role = "user", Content = userMessage });

        // 2. 定义工具（Function Calling）
        var tools = new List<DeepSeekTool>
        {
            new()
            {
                Type = "function",
                Function = new DeepSeekFunction
                {
                    Name = "query_database",
                    Description = "执行 SQL SELECT 查询来获取数据库中的 POI 地理信息数据，如医院、商场、政府机构、消防站的位置、联系方式、评分等信息。只读查询，不可修改数据。",
                    Parameters = new
                    {
                        type = "object",
                        properties = new
                        {
                            sql = new
                            {
                                type = "string",
                                description = "要执行的 SQL SELECT 查询语句，表名: `医院`, `商场`, `政府`, `消防站`。注意表名和字段名是中文，需用反引号包裹。"
                            }
                        },
                        required = new[] { "sql" }
                    }
                }
            },
            new()
            {
                Type = "function",
                Function = new DeepSeekFunction
                {
                    Name = "query_fire_spatial",
                    Description = "查询指定起火点（场景）到各 POI 的距离、通行时间、可达状态。用于回答用户关于火场周边资源距离的问题。有 3 个起火点场景: 厂房(fireId=1)、住宅(fireId=3)、企业楼(fireId=4)。",
                    Parameters = new
                    {
                        type = "object",
                        properties = new
                        {
                            fireId = new
                            {
                                type = "number",
                                description = "起火点编号，1=厂房场景，3=住宅场景，4=企业楼场景。用户说「厂房」→fireId=1，「住宅」→fireId=3，「企业楼」→fireId=4。"
                            },
                            typeFilter = new
                            {
                                type = "string",
                                description = "可选，POI类型筛选条件，如「医院」只返回医院数据，「可达」只返回可达POI，不传则返回全部。"
                            }
                        },
                        required = new[] { "fireId" }
                    }
                }
            },
            new()
            {
                Type = "function",
                Function = new DeepSeekFunction
                {
                    Name = "query_fire_spread",
                    Description = "查询火情蔓延趋势数据（10/30/60 分钟阈值下的受影响建筑数、占比、扩散速度）。用于回答用户关于火势蔓延范围、发展趋势的问题。",
                    Parameters = new
                    {
                        type = "object",
                        properties = new
                        {
                            timeMin = new
                            {
                                type = "number",
                                description = "可选，指定查询的时间阈值（分钟），如 10、30、60。不传则返回所有时间节点数据。"
                            }
                        },
                        required = new string[0]
                    }
                }
            },
            new()
            {
                Type = "function",
                Function = new DeepSeekFunction
                {
                    Name = "query_loss_estimate",
                    Description = "查询火灾损失估算数据，包括每个时间节点下的受影响建筑数、预估影响人口、需疏散人口、重建成本、综合损失指数。用于回答经济损失、人员伤亡估计、疏散规模等问题。",
                    Parameters = new
                    {
                        type = "object",
                        properties = new
                        {
                            timeMin = new
                            {
                                type = "number",
                                description = "可选，指定时间阈值（分钟），如 10、30、60。不传则返回所有节点数据。"
                            }
                        },
                        required = new string[0]
                    }
                }
            }
        };

        // 3. 调用 DeepSeek API（最多 3 轮）
        var maxRounds = 3;
        for (int round = 0; round < maxRounds; round++)
        {
            var requestBody = new DeepSeekRequest
            {
                Model = model,
                Messages = messages,
                Tools = tools,
                Stream = false
            };

            var jsonOptions = new JsonSerializerOptions
            {
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
            };

            var requestJson = JsonSerializer.Serialize(requestBody, jsonOptions);
            _logger.LogInformation("第 {Round} 轮 DeepSeek 请求: {Json}", round + 1, requestJson);

            var httpRequest = new HttpRequestMessage(HttpMethod.Post, apiUrl);
            httpRequest.Headers.Add("Authorization", $"Bearer {apiKey}");
            httpRequest.Content = new StringContent(requestJson, Encoding.UTF8, "application/json");

            var httpResponse = await _httpClient.SendAsync(httpRequest);
            var responseJson = await httpResponse.Content.ReadAsStringAsync();

            if (!httpResponse.IsSuccessStatusCode)
            {
                _logger.LogError("DeepSeek API 错误 ({Status}): {Body}", httpResponse.StatusCode, responseJson);
                throw new Exception($"DeepSeek API 返回错误: {httpResponse.StatusCode}");
            }

            var deepSeekResponse = JsonSerializer.Deserialize<DeepSeekResponse>(responseJson);
            var responseMessage = deepSeekResponse?.Choices?.FirstOrDefault()?.Message;

            if (responseMessage == null)
            {
                throw new Exception("DeepSeek API 返回为空");
            }

            // 4. 检查是否有工具调用
            if (responseMessage.ToolCalls != null && responseMessage.ToolCalls.Count > 0)
            {
                // 添加 AI 的响应（含 tool_calls）到消息列表
                messages.Add(responseMessage);

                foreach (var toolCall in responseMessage.ToolCalls)
                {
                    string result;

                    switch (toolCall.Function.Name)
                    {
                        case "query_database":
                            var dbArgs = JsonSerializer.Deserialize<Dictionary<string, string>>(toolCall.Function.Arguments);
                            var sql = dbArgs?.GetValueOrDefault("sql", "") ?? "";
                            _logger.LogInformation("执行 SQL: {Sql}", sql);
                            try { result = await ExecuteQueryAsync(sql); }
                            catch (Exception ex) { result = $"查询执行失败: {ex.Message}"; }
                            break;

                        case "query_fire_spatial":
                            var spatialArgs = JsonSerializer.Deserialize<Dictionary<string, object>>(toolCall.Function.Arguments);
                            var fireId = spatialArgs?.GetValueOrDefault("fireId")?.ToString() ?? "1";
                            var typeFilter = spatialArgs?.GetValueOrDefault("typeFilter")?.ToString() ?? "";
                            _logger.LogInformation("查询空间距离: fireId={FireId}, typeFilter={TypeFilter}", fireId, typeFilter);
                            try { result = await ExecuteFireSpatialQuery(fireId, typeFilter); }
                            catch (Exception ex) { result = $"空间查询执行失败: {ex.Message}"; }
                            break;

                        case "query_fire_spread":
                            var spreadArgs = JsonSerializer.Deserialize<Dictionary<string, object>>(toolCall.Function.Arguments);
                            var spreadTime = spreadArgs?.GetValueOrDefault("timeMin")?.ToString() ?? "";
                            _logger.LogInformation("查询蔓延数据: timeMin={TimeMin}", spreadTime);
                            try { result = await ExecuteFireSpreadQuery(spreadTime); }
                            catch (Exception ex) { result = $"蔓延查询执行失败: {ex.Message}"; }
                            break;

                        case "query_loss_estimate":
                            var lossArgs = JsonSerializer.Deserialize<Dictionary<string, object>>(toolCall.Function.Arguments);
                            var lossTime = lossArgs?.GetValueOrDefault("timeMin")?.ToString() ?? "";
                            _logger.LogInformation("查询损失估算: timeMin={TimeMin}", lossTime);
                            try { result = await ExecuteLossEstimateQuery(lossTime); }
                            catch (Exception ex) { result = $"损失查询执行失败: {ex.Message}"; }
                            break;

                        default:
                            result = $"未知工具: {toolCall.Function.Name}";
                            break;
                    }

                    // 添加工具调用结果
                    messages.Add(new DeepSeekMessage
                    {
                        Role = "tool",
                        ToolCallId = toolCall.Id,
                        Content = result
                    });
                }
            }
            else
            {
                // 没有工具调用，返回最终回答
                return responseMessage.Content ?? "抱歉，我无法回答这个问题。";
            }
        }

        // 超过最大轮数，返回最后一条消息
        var lastMsg = messages.LastOrDefault();
        return lastMsg?.Content ?? "处理超时，请重试。";
    }

    /// <summary>
    /// 查询起火点到 POI 的空间距离数据
    /// </summary>
    private async Task<string> ExecuteFireSpatialQuery(string fireId, string typeFilter)
    {
        try
        {
            var baseUrl = _config["SelfBaseUrl"] ?? "http://localhost:5007";
            var url = $"{baseUrl}/api/spatial/pois?fireId={fireId}";
            var response = await _httpClient.GetAsync(url);
            if (!response.IsSuccessStatusCode)
                return $"空间查询 HTTP 错误: {response.StatusCode}";

            var json = await response.Content.ReadAsStringAsync();
            var pois = JsonSerializer.Deserialize<List<Dictionary<string, object>>>(json);
            if (pois == null || pois.Count == 0)
                return "该起火点无 POI 数据，请检查 fireId。";

            // 按类型过滤
            if (!string.IsNullOrWhiteSpace(typeFilter))
            {
                if (typeFilter == "可达")
                    pois = pois.Where(p => p.GetValueOrDefault("solveStatus")?.ToString() == "ok").ToList();
                else
                    pois = pois.Where(p => p.GetValueOrDefault("poiType")?.ToString() == typeFilter).ToList();
            }

            if (pois.Count == 0)
                return $"没有匹配 {typeFilter} 条件的 POI。";

            return JsonSerializer.Serialize(new
            {
                total = pois.Count,
                reachable = pois.Count(p => p.GetValueOrDefault("solveStatus")?.ToString() == "ok"),
                fireScene = pois.FirstOrDefault()?.GetValueOrDefault("fireScene")?.ToString() ?? "",
                pois = pois.Select(p => new
                {
                    name = p.GetValueOrDefault("poiName")?.ToString() ?? "",
                    type = p.GetValueOrDefault("poiType")?.ToString() ?? "",
                    straightDistKm = FormatDistance(p.GetValueOrDefault("straightDistM")),
                    networkDistKm = FormatDistance(p.GetValueOrDefault("networkDistM")),
                    travelTimeMin = FormatTime(p.GetValueOrDefault("travelTimeMin")),
                    status = p.GetValueOrDefault("solveStatus")?.ToString() == "ok" ? "可达" : "不可达",
                    rank = p.GetValueOrDefault("rankNetwork")?.ToString() ?? ""
                }).ToList()
            }, new JsonSerializerOptions { WriteIndented = true });
        }
        catch (Exception ex)
        {
            return $"空间查询失败: {ex.Message}";
        }
    }

    /// <summary>
    /// 查询火情蔓延数据
    /// </summary>
    private async Task<string> ExecuteFireSpreadQuery(string timeMin)
    {
        try
        {
            var baseUrl = _config["SelfBaseUrl"] ?? "http://localhost:5007";
            var response = await _httpClient.GetAsync($"{baseUrl}/api/spread/data");
            if (!response.IsSuccessStatusCode)
                return $"蔓延查询 HTTP 错误: {response.StatusCode}";

            var json = await response.Content.ReadAsStringAsync();
            var data = JsonSerializer.Deserialize<List<Dictionary<string, object>>>(json);
            if (data == null || data.Count == 0)
                return "暂无蔓延数据。";

            // 按时间筛选
            if (int.TryParse(timeMin, out var filterTime))
                data = data.Where(d => d.GetValueOrDefault("timeMin")?.ToString() == timeMin).ToList();

            return JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true });
        }
        catch (Exception ex)
        {
            return $"蔓延查询失败: {ex.Message}";
        }
    }

    /// <summary>
    /// 查询损失估算数据
    /// </summary>
    private async Task<string> ExecuteLossEstimateQuery(string timeMin)
    {
        try
        {
            var baseUrl = _config["SelfBaseUrl"] ?? "http://localhost:5007";
            var response = await _httpClient.GetAsync($"{baseUrl}/api/loss/estimate");
            if (!response.IsSuccessStatusCode)
                return $"损失查询 HTTP 错误: {response.StatusCode}";

            var json = await response.Content.ReadAsStringAsync();
            var result = JsonSerializer.Deserialize<Dictionary<string, object>>(json);
            if (result == null || !result.ContainsKey("lossData"))
                return "暂无损失估算数据。";

            var lossData = JsonSerializer.Deserialize<List<Dictionary<string, object>>>(result["lossData"].ToString()!);
            if (lossData == null || lossData.Count == 0)
                return "暂无损失数据。";

            // 按时间筛选
            if (int.TryParse(timeMin, out var filterTime))
                lossData = lossData.Where(d => d.GetValueOrDefault("timeMin")?.ToString() == timeMin).ToList();

            return JsonSerializer.Serialize(new
            {
                bimTotal = result.GetValueOrDefault("bimTotal"),
                lossData = lossData.Select(d => new
                {
                    timeMin = d.GetValueOrDefault("timeMin")?.ToString(),
                    affectedBuildings = d.GetValueOrDefault("affectedBuildings")?.ToString(),
                    estPopulation = d.GetValueOrDefault("estPopulation")?.ToString(),
                    estDisplaced = d.GetValueOrDefault("estDisplaced")?.ToString(),
                    estReconstructionCost = d.GetValueOrDefault("estReconstructionCost")?.ToString(),
                    compositeLossIndex = d.GetValueOrDefault("compositeLossIndex")?.ToString()
                }).ToList()
            }, new JsonSerializerOptions { WriteIndented = true });
        }
        catch (Exception ex)
        {
            return $"损失查询失败: {ex.Message}";
        }
    }

    /// <summary>
    /// 格式化距离为千米
    /// </summary>
    private static string? FormatDistance(object? val)
    {
        if (val == null) return null;
        if (double.TryParse(val.ToString(), out var d))
            return (d / 1000).ToString("F2") + " km";
        return null;
    }

    /// <summary>
    /// 格式化时间为分钟
    /// </summary>
    private static string? FormatTime(object? val)
    {
        if (val == null) return null;
        if (double.TryParse(val.ToString(), out var t))
            return t.ToString("F1") + " 分钟";
        return null;
    }

    /// <summary>
    /// 执行 SQL SELECT 查询并返回 JSON 结果字符串
    /// </summary>
    private async Task<string> ExecuteQueryAsync(string sql)
    {
        var trimmedSql = sql.Trim().ToUpperInvariant();
        if (!trimmedSql.StartsWith("SELECT") && !trimmedSql.StartsWith("SHOW") && !trimmedSql.StartsWith("DESC"))
        {
            return "错误：只允许执行 SELECT / SHOW / DESC 查询。";
        }

        var connectionString = _config.GetConnectionString("MySQL");
        if (string.IsNullOrEmpty(connectionString))
        {
            return "错误：数据库连接串未配置。";
        }

        await using var conn = new MySqlConnection(connectionString);
        await conn.OpenAsync();

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.CommandTimeout = 15;

        await using var reader = await cmd.ExecuteReaderAsync();

        var results = new List<Dictionary<string, object?>>();
        while (await reader.ReadAsync())
        {
            var row = new Dictionary<string, object?>();
            for (int i = 0; i < reader.FieldCount; i++)
            {
                var value = reader.GetValue(i);
                row[reader.GetName(i)] = value == DBNull.Value ? null : value;
            }
            results.Add(row);
        }

        if (results.Count == 0)
        {
            return "查询结果为空（0 条记录）。";
        }

        return JsonSerializer.Serialize(results, new JsonSerializerOptions
        {
            WriteIndented = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        });
    }
}
