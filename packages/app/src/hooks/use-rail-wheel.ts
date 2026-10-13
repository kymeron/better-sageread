import { installRailWheel } from "@/utils/wheel-rails";
import { useEffect } from "react";

/**
 * 宿主文档里的横向滑轨（对话区 / 论文区的块级公式、表格、代码块）：
 * 鼠标停在其上时，竖直滚轮优先滚动它自己（换算为横向），滚到头停顿后才放行给外层滚动。
 * 阅读器 iframe 内的同类滑轨由 pages/reader/utils/iframeEventHandlers.ts 的 handleWheel 处理。
 * 全应用只需挂载一次（ReaderLayout 顶层）。
 */
export function useRailWheel() {
  useEffect(() => installRailWheel(document, ".katex-display, table, pre"), []);
}
