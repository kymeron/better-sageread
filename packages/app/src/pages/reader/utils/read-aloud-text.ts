import type { BookProgress } from "@/types/book";
import type { FoliateView } from "@/types/view";

/**
 * 正文朗读文本抽取：以当前可见范围的起点为界，取当前章节剩余文本。
 * 可见范围来自 foliate relocate 的 progress.range（分页/滚动都由 paginator 计算），
 * 比 caretRangeFromPoint 更可靠（不依赖 iframe 内滚动位置与写作模式）。
 */

/** 参与朗读的块级元素（叶子块优先，避免嵌套块重复取文本） */
const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, dd, dt, figcaption, td, th";

/** 已有句末/收尾标点时不补句号，避免 TTS 分句粘连 */
const TRAILING_PUNCTUATION = /[。！？!?….,，、;；:："'”’）)】」』]$/;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** range 是否仍然可用（章节切换后旧 range 的节点会脱离文档） */
function isUsableRange(range: Range | null | undefined, doc: Document): range is Range {
  if (!range) return false;
  const node = range.startContainer as Node | null;
  if (!node?.isConnected) return false;
  return doc.contains(node) || node.ownerDocument === doc;
}

function getActiveDocument(view: FoliateView | null, progress?: BookProgress): Document | null {
  const contents = view?.renderer?.getContents?.() ?? [];
  if (!contents.length) return null;

  const rangeDoc = isUsableRange(progress?.range, contents[0].doc) ? progress.range.startContainer.ownerDocument : null;
  if (rangeDoc && contents.some((content) => content.doc === rangeDoc)) return rangeDoc;
  return contents[0].doc ?? null;
}

/** 取正文路径上的叶子块元素（含嵌套块的容器跳过，只保留最内层） */
function collectLeafBlocks(doc: Document): Element[] {
  const body = doc.body;
  if (!body) return [];
  return Array.from(body.querySelectorAll(BLOCK_SELECTOR)).filter((el) => !el.querySelector(BLOCK_SELECTOR));
}

function resolveStartBlock(range: Range | undefined, blocks: Element[]): Element | null {
  if (!range) return blocks[0] ?? null;

  const node = range.startContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const block = el?.closest(BLOCK_SELECTOR);
  if (!block) return blocks[0] ?? null;

  return blocks.find((item) => item === block || item.contains(block) || block.contains(item)) ?? blocks[0] ?? null;
}

/** 从当前页起点一直取到章节末尾；无块级结构时回退整篇文本 */
export function extractReadableTextFromCurrentPage(view: FoliateView | null, progress?: BookProgress): string {
  const doc = getActiveDocument(view, progress);
  if (!doc?.body) return "";

  const blocks = collectLeafBlocks(doc);
  if (!blocks.length) {
    return normalize(doc.body.textContent ?? "");
  }

  const usableRange = isUsableRange(progress?.range, doc) ? progress.range : undefined;
  const startBlock = resolveStartBlock(usableRange, blocks);
  const startIndex = startBlock ? blocks.indexOf(startBlock) : 0;

  const parts: string[] = [];
  for (let i = startIndex >= 0 ? startIndex : 0; i < blocks.length; i++) {
    const text = normalize(blocks[i].textContent ?? "");
    if (!text) continue;
    parts.push(TRAILING_PUNCTUATION.test(text) ? text : `${text}。`);
  }

  return parts.join("");
}
