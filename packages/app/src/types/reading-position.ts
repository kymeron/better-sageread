/**
 * 阅读位置桥（2026-10-20）——foliate 阅读位置 ↔ mdbook 文本坐标的统一契约。
 *
 * 背景：书籍侧"读到哪"此前只有 foliate 的 TOC label（目录塌了就没有），
 * 论文侧"读到哪"只有 heading 文本。本模块定义三样东西：
 *   1. RawReadingPosition：渲染层（foliate / paper-reader）实时采集的原始位置；
 *   2. ResolvedPositionCoordinates：Rust 侧按 mdbook 产物换算出的文本坐标（字符偏移 + 分块区间）；
 *   3. ReadingPositionSnapshot：前端组装后供提示词注入 / 工具返回 / 持久化的快照。
 *
 * 缓存纪律：快照只在 system prompt 最尾部（buildDynamicStateSection）注入，静态前缀不受影响。
 */

/** 书籍（EPUB / foliate）原始位置：渲染层每次 relocate 更新 */
export interface ReaderRawPosition {
  scope: "reader";
  bookId: string;
  /** 当前 spine 序号（0-based，= foliate relocate 的 section index） */
  sectionIndex: number;
  /** EPUB 内 zip 相对路径，如 "OEBPS/Text/part012.xhtml"（来自 book.sections[i].id） */
  sectionHref: string;
  /** 本章内进度 0..1（foliate renderer relocate 的 fraction） */
  sectionFraction: number;
  /** foliate pageinfo：全书 loc 单位进度 */
  locCurrent: number;
  locTotal: number;
  /** TOC 章节名；目录缺失时为空串 */
  label: string;
  tocAvailable: boolean;
  /** foliate CFI（持久化/同步锚点） */
  cfi: string;
}

/** 论文原始位置：paper-reader 滚动跟踪产出 */
export interface PaperRawPosition {
  scope: "paper";
  paperId: string;
  /** rehype-slug 锚点 id（= markdown-sections 的 heading.id） */
  headingId: string;
  headingText: string;
  headingLevel: number;
  /** 正文（去 frontmatter 后）字符偏移，精确定位到"读到哪个字符" */
  charOffset: number;
  /** 正文总字符数 */
  docLength: number;
  /** 全文进度 0..1 */
  docFraction: number;
  tocAvailable: boolean;
}

export type RawReadingPosition = ReaderRawPosition | PaperRawPosition;

/**
 * Rust 侧坐标换算结果：
 * - 书籍：resolve_reading_position(book_id, section_href, section_fraction, ...)
 * - 论文：resolve_paper_position(paper_id, char_offset, doc_length)
 * 书籍在 mdbook 产物缺失时 Rust 侧会先做一次转换（幂等），再计算坐标。
 */
export interface ResolvedPositionCoordinates {
  /** mdbook 内相对路径：书籍如 "OEBPS/Text/part012.md"；论文固定 "paper.md" */
  mdRelPath: string;
  /** md 文件字符数（UTF-8 字符，非字节） */
  mdLength: number;
  /** 估算的字符偏移（书籍 = 本章 fraction × md 长度） */
  charOffset: number;
  /** 文件内位置百分比 0..100（一位小数由前端处理） */
  percentInDoc: number;
  /** 该书/论文是否已建向量索引（无索引时只有字符坐标，没有分块区间） */
  indexed: boolean;
  /** 估算命中分块区间（0-based global_chunk_index；无索引为 null） */
  chunkRangeStart: number | null;
  chunkRangeEnd: number | null;
  /** 该书/论文分块总数（无索引为 null） */
  chunkTotal: number | null;
  /** 书籍 spine 总数（论文为 null） */
  spineTotal: number | null;
}

/** 前端组装后的位置快照：提示词注入 / 工具返回 / 展示共用 */
export interface ReadingPositionSnapshot {
  scope: "reader" | "paper";
  /** 文档 id（书籍 bookId / 论文 paperId），按位置读原文时定位文件用 */
  docId: string;
  /** 章节名（TOC 或论文 heading；目录缺失时用兜底文案） */
  label: string;
  /** label 是否来自真实目录（fallback = TOC 不可用，用 spine 序号兜底） */
  labelSource: "toc" | "fallback";
  mdRelPath: string;
  mdLength: number;
  charOffset: number;
  /** 文件内百分比 0..100（保留一位小数） */
  percentInDoc: number;
  /** 估算分块区间（1-based，展示口径；无索引 null） */
  chunkRange: [number, number] | null;
  chunkTotal: number | null;
  /** 全书/全文进度 0..100（保留一位小数） */
  overallPercent: number;
  spineIndex: number | null;
  spineTotal: number | null;
  cfi: string | null;
}

/** read_position_window 命令返回 */
export interface PositionWindow {
  text: string;
  /** 本次返回的起始字符偏移 */
  start: number;
  /** 本次返回的结束字符偏移（exclusive） */
  end: number;
  /** md 文件总字符数 */
  totalLength: number;
  mdRelPath: string;
  /** 后续续读建议 offset（= end；到末尾为 null） */
  nextOffset: number | null;
}
