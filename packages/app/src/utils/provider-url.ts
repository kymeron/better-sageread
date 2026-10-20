/**
 * 提供商端点判定工具（本地/内网服务 vs 云端）。
 *
 * 本地服务（Ollama / LM Studio / Xinference / llama.cpp server / TEI 等）：
 * - 通常不需要 API Key（apiKey 留空即可）；
 * - 请求走 @tauri-apps/plugin-http（Rust 侧出网，绕过 CORS）；
 * - 设置页应给出"本地服务可留空"的引导，而不是拦截启用。
 */

const LOCAL_HOST_RE = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i;

/** 是否本地/回环端点（含端口）。空值返回 false。 */
export function isLocalEndpoint(baseUrl?: string | null): boolean {
  const url = (baseUrl ?? "").trim();
  return url.length > 0 && LOCAL_HOST_RE.test(url);
}

/** 是否为 Ollama 默认端口端点（用于图标/文案识别）。 */
export function isOllamaEndpoint(baseUrl?: string | null): boolean {
  const url = (baseUrl ?? "").trim();
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):11434(?:\/|$)/i.test(url);
}

/** 是否为 LM Studio 默认端点（本地 OpenAI 兼容，默认 127.0.0.1:1234）。 */
export function isLMStudioEndpoint(baseUrl?: string | null): boolean {
  const url = (baseUrl ?? "").trim();
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):1234(?:\/|$)/i.test(url);
}
