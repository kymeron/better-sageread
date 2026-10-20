/**
 * Agent 时间感知（2026-10-20 用户拍板口径）。
 *
 * 两条硬约束（都是为了提示词前缀缓存）：
 * 1) 历史消息时间戳：随消息内容写死为前缀 `[YYYY-MM-DD HH:mm]`（本机时区 24h），
 *    同一条消息一旦进入历史就逐字节稳定——禁止「距今 X 分钟 / 2 小时前」这类每轮漂移的表述，
 *    否则历史消息每轮都变、前缀缓存全灭。
 * 2) 当前时间：只出现在 system prompt 最尾部的动态段（【当前阅读位置】之后），
 *    每轮更新只击穿尾部，前面的静态/准静态段保持稳定。
 *
 * 时间戳来源：UIMessage.metadata.createdAt（秒级，见 types/message.ts）。user 消息在
 * handleSubmit 发送前钉发送时刻并随 metadata 落库（2026-10-20 补齐），assistant 在流结束
 * onFinish 时写入；存量旧 user 消息没有 createdAt——不猜测时间、宁可不加前缀，也不注入
 * 不稳定时间；本轮新发且尚未落库的末条 user 消息用发送时刻兜底（下一轮起用持久化值，
 * 通常同一秒，一次性变化可接受）。
 */
import type { MessageMetadata } from "@/types/message";
import type { AssistantContent, ModelMessage, TextPart, UIMessage, UserContent } from "ai";

/** 秒/毫秒时间戳识别阈值：毫秒时间戳约 1.7e12，秒级约 1.7e9（1e11 秒 ≈ 公元 5138 年，不会误判） */
const MS_TIMESTAMP_THRESHOLD = 1e11;

/** 周一~周日（中文）；Date#getDay() 0=周日 */
const WEEKDAY_NAMES_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

/** 历史消息时间前缀格式（含尾随空格）：[YYYY-MM-DD HH:mm] ，供幂等判断与验证脚本使用 */
export const MESSAGE_TIMESTAMP_PREFIX_RE = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] /;

/** 秒/毫秒时间戳 → Date；非法/非正值返回 null */
function toDate(value: number): Date | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value < MS_TIMESTAMP_THRESHOLD ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/** YYYY-MM-DD HH:mm（本机时区、24h、补零）；number 入参允许秒或毫秒 */
export function formatDateTime(value: number | Date): string {
  const date = typeof value === "number" ? toDate(value) : value;
  if (!date || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

/** 周几（周一~周日中文） */
export function formatWeekday(value: number | Date): string {
  const date = typeof value === "number" ? toDate(value) : value;
  if (!date || Number.isNaN(date.getTime())) return "";
  return WEEKDAY_NAMES_ZH[date.getDay()] ?? "";
}

/**
 * 历史消息时间戳前缀：[YYYY-MM-DD HH:mm]（不含尾随空格；number 入参允许秒或毫秒）。
 * 非法值返回空串，调用方据此跳过注入——绝不拿当前时间冒充历史时间。
 */
export function formatTimestamp(value: number): string {
  const dateTime = formatDateTime(value);
  return dateTime ? `[${dateTime}]` : "";
}

/** 时区名（Intl 不可用时退化为「本地时区」） */
function resolvedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区";
  } catch {
    return "本地时区";
  }
}

/**
 * system prompt 最尾部的动态段：【当前时间】。
 * 必须拼在【当前阅读位置】之后（transport 负责顺序），保证它前面所有段逐字节稳定。
 */
export function currentTimeSection(now: number | Date = new Date()): string {
  const date = typeof now === "number" ? (toDate(now) ?? new Date()) : now;
  const when = formatDateTime(date);
  if (!when) return "";
  const weekday = formatWeekday(date);
  return [
    "【当前时间】",
    `${when}（${weekday}）· 时区 ${resolvedTimeZone()}`,
    "（涉及今天/昨天/多久之前/现在几点等问题时以此为准；时间会随每轮消息更新）",
  ].join("\n");
}

/**
 * 动态段拼接（transport 直接拼到 system prompt 最尾部）：
 * 顺序固定为【当前阅读位置】（可为空/降级文案）在前、【当前时间】压尾；
 * 位置段为空时也仍返回当前时间段——当前时间永远不缺席。
 */
export function composeDynamicTail(positionSection: string, now?: number | Date): string {
  const sections = [positionSection.trim(), currentTimeSection(now)].filter((section) => section.length > 0);
  return sections.join("\n\n");
}

/** 从 UIMessage.metadata 读取 createdAt（秒级）；缺失返回 null（不做任何猜测） */
export function readMessageCreatedAt(message: UIMessage): number | null {
  const createdAt = (message.metadata as MessageMetadata | undefined)?.createdAt;
  return typeof createdAt === "number" && Number.isFinite(createdAt) && createdAt > 0 ? createdAt : null;
}

/** 模型消息时间戳查询：返回秒级时间戳；undefined = 该条不加前缀 */
export type TimestampLookup = (message: ModelMessage, index: number) => number | undefined;

/** 给单条 ModelMessage 前置时间文本（string 直接拼；数组在开头插 text part，其余 parts 顺序不变） */
function prependTimestamp(message: ModelMessage, prefix: string): ModelMessage {
  if (message.role !== "user" && message.role !== "assistant") return message;
  const content = message.content as UserContent | AssistantContent;

  if (typeof content === "string") {
    // 幂等：已带时间前缀的字符串不再重复注入
    if (MESSAGE_TIMESTAMP_PREFIX_RE.test(content)) return message;
    return { ...message, content: prefix + content } as ModelMessage;
  }
  if (!Array.isArray(content) || content.length === 0) return message;

  // 幂等：已带时间前缀的消息不再重复注入（同一输出连续过两次也逐字节稳定）
  const firstPart = content[0] as { type?: string; text?: unknown };
  if (
    firstPart?.type === "text" &&
    typeof firstPart.text === "string" &&
    MESSAGE_TIMESTAMP_PREFIX_RE.test(firstPart.text)
  ) {
    return message;
  }
  const timestampPart: TextPart = { type: "text", text: prefix };
  return { ...message, content: [timestampPart, ...content] } as ModelMessage;
}

/**
 * 把时间前缀注入 ModelMessage（仅 user/assistant；system/tool 不动）。
 * lookup 按条返回时间戳，缺时间/非法时间不加前缀；返回新数组，不修改入参。
 */
export function withMessageTimestamps(messages: ModelMessage[], lookup: TimestampLookup): ModelMessage[] {
  return messages.map((message, index) => {
    const seconds = lookup(message, index);
    if (seconds == null) return message;
    const stamp = formatTimestamp(seconds);
    if (!stamp) return message;
    return prependTimestamp(message, `${stamp} `);
  });
}

export interface TimestampLookupOptions {
  /** 本轮发送时刻（毫秒）：仅用于「末条缺 createdAt 的 user 消息」兜底 */
  now?: number;
}

/**
 * 为 convertToModelMessages 的产出构建时间戳查询。
 *
 * 对齐规则（依赖 selectedMessages 已由 selectMessagesWithinBudget 归一为 user/assistant 严格交替）：
 * - 一条 system/user UI 消息对应一条同 role 的 ModelMessage；
 * - 一条 assistant UI 消息按 step 拆成若干 assistant/tool ModelMessage，均由该 UI 消息的时间戳拥有
 *   （tool 消息不加前缀，只跳过）；
 * - 被裁掉/过滤掉的 UI 消息不推进游标，避免错位。
 */
export function buildTimestampLookup(
  uiMessages: UIMessage[],
  modelMessages: ModelMessage[],
  options?: TimestampLookupOptions,
): TimestampLookup {
  const fallbackSeconds = Math.floor((options?.now ?? Date.now()) / 1000);
  const timestamps = new Map<number, number>();
  let modelIndex = 0;

  for (let uiIndex = 0; uiIndex < uiMessages.length; uiIndex++) {
    const uiMessage = uiMessages[uiIndex];
    let seconds = readMessageCreatedAt(uiMessage);
    // 本轮新发消息兜底：末条 user 且无 createdAt 时用发送时刻（下一轮从历史载入后该前缀消失，一次性变化）
    if (seconds == null && uiMessage.role === "user" && uiIndex === uiMessages.length - 1) {
      seconds = fallbackSeconds;
    }

    if (uiMessage.role === "system" || uiMessage.role === "user") {
      const modelMessage = modelMessages[modelIndex];
      if (modelMessage?.role === uiMessage.role) {
        if (seconds != null) timestamps.set(modelIndex, seconds);
        modelIndex += 1;
      }
      continue;
    }

    if (uiMessage.role === "assistant") {
      while (
        modelIndex < modelMessages.length &&
        (modelMessages[modelIndex].role === "assistant" || modelMessages[modelIndex].role === "tool")
      ) {
        if (modelMessages[modelIndex].role === "assistant" && seconds != null) {
          timestamps.set(modelIndex, seconds);
        }
        modelIndex += 1;
      }
    }
  }

  return (_message, index) => timestamps.get(index);
}
