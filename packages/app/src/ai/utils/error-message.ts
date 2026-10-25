/**
 * 聊天错误归一化：把服务商返回的原始错误（常为 JSON 字符串，如
 * `{"message":"output new_sensitive (1027)","type":"unprocessable_entity_error"}`）
 * 转成用户能看懂的中文提示。无法识别时原样返回，不吞信息。
 */

function pickMessage(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value !== "object") return String(value);

  const record = value as Record<string, unknown>;
  const candidates = [record.message, record.msg, record.error, record.detail];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object") {
      const nested = pickMessage(candidate);
      if (nested) return nested;
    }
  }
  return "";
}

function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** 从任意错误对象/字符串里提取可读的原始信息 */
function extractRawMessage(error: unknown): string {
  if (error == null) return "";

  if (typeof error === "string") {
    const parsed = tryParseJson(error);
    const fromJson = parsed ? pickMessage(parsed) : "";
    return fromJson || error.trim();
  }

  if (error instanceof Error) {
    // AI SDK 的 APICallError 带 responseBody（服务商原始响应）
    const responseBody = (error as { responseBody?: unknown }).responseBody;
    if (typeof responseBody === "string") {
      const parsed = tryParseJson(responseBody);
      const fromBody = parsed ? pickMessage(parsed) : "";
      if (fromBody) return fromBody;
    }
    const parsedMessage = tryParseJson(error.message);
    const fromMessage = parsedMessage ? pickMessage(parsedMessage) : "";
    return fromMessage || error.message;
  }

  const fromObject = pickMessage(error);
  if (fromObject) return fromObject;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** 服务商错误 → 可读中文（识别不了时返回原始信息） */
export function normalizeChatError(error: unknown): string {
  const raw = extractRawMessage(error);
  if (!raw) return "请求失败，请稍后重试";
  const lower = raw.toLowerCase();

  // 内容安全拦截：DeepSeek/MiniMax/智谱等流式生成中途被审核中断（已输出部分保留）
  if (
    lower.includes("new_sensitive") ||
    lower.includes("sensitive") ||
    lower.includes("content_filter") ||
    lower.includes("data_inspection_failed") ||
    lower.includes("content policy") ||
    lower.includes("safety")
  ) {
    return "本次回复被模型服务商的内容安全策略拦截，已生成的内容可能不完整。可改写提问，或在模型设置里换用其他模型重试。";
  }

  if (lower.includes("invalid api key") || lower.includes("incorrect api key") || lower.includes("unauthorized")) {
    return "API Key 无效或已过期，请到 设置 → 模型提供商 检查密钥。";
  }

  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429")) {
    return "请求过于频繁（触发服务商限流），请稍后再试。";
  }

  if (lower.includes("insufficient") || lower.includes("quota") || lower.includes("balance")) {
    return "账户额度不足或余额欠费，请在服务商控制台充值后重试。";
  }

  if (lower.includes("context length") || lower.includes("maximum context") || lower.includes("too long")) {
    return "上下文超出模型上限，请开启新对话或减少引用内容后重试。";
  }

  return raw;
}
