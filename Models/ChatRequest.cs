using System.Text.Json.Serialization;

namespace new_try_world.Models;

public class ChatRequest
{
    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    [JsonPropertyName("history")]
    public List<ChatMessage> History { get; set; } = new();
}

public class ChatMessage
{
    [JsonPropertyName("role")]
    public string Role { get; set; } = string.Empty;

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;
}

public class ChatResponse
{
    [JsonPropertyName("reply")]
    public string Reply { get; set; } = string.Empty;
}

/// <summary>
/// DeepSeek API 请求/响应模型
/// </summary>
public class DeepSeekRequest
{
    [JsonPropertyName("model")]
    public string Model { get; set; } = string.Empty;

    [JsonPropertyName("messages")]
    public List<DeepSeekMessage> Messages { get; set; } = new();

    [JsonPropertyName("tools")]
    public List<DeepSeekTool>? Tools { get; set; }

    [JsonPropertyName("stream")]
    public bool Stream { get; set; } = false;
}

public class DeepSeekMessage
{
    [JsonPropertyName("role")]
    public string Role { get; set; } = string.Empty;

    [JsonPropertyName("content")]
    public string? Content { get; set; }

    [JsonPropertyName("tool_calls")]
    public List<DeepSeekToolCall>? ToolCalls { get; set; }

    [JsonPropertyName("tool_call_id")]
    public string? ToolCallId { get; set; }
}

public class DeepSeekTool
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "function";

    [JsonPropertyName("function")]
    public DeepSeekFunction Function { get; set; } = new();
}

public class DeepSeekFunction
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("parameters")]
    public object Parameters { get; set; } = new();
}

public class DeepSeekToolCall
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("type")]
    public string Type { get; set; } = "function";

    [JsonPropertyName("function")]
    public DeepSeekToolCallFunction Function { get; set; } = new();
}

public class DeepSeekToolCallFunction
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("arguments")]
    public string Arguments { get; set; } = string.Empty;
}

public class DeepSeekResponse
{
    [JsonPropertyName("choices")]
    public List<DeepSeekChoice> Choices { get; set; } = new();
}

public class DeepSeekChoice
{
    [JsonPropertyName("message")]
    public DeepSeekMessage Message { get; set; } = new();

    [JsonPropertyName("finish_reason")]
    public string? FinishReason { get; set; }
}
