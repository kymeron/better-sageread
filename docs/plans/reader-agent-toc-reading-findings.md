# 阅读助手 Agent · 目录/正文工具缺陷（跨仓调研发现，待消化）

> 2026-10-10 记录。来源：在 **sageread-mcp**（`F:\MyProjects\sageread-mcp`）侧实现 F2「书籍目录/正文直读」工具时，对本仓阅读助手 Agent 同类能力做的一次**只读代码调研**。
> 状态：**未施工、待用户消化**。下列 file:line 的**路径已对着真实目录树核对修正**（R2/R3/R4/R5 的关键断言已抽查属实）；行号可能随后续提交漂移，动手前请以符号名（函数/结构体）为准复核。
> 背景：sageread-mcp 是只读消费者，无法改本仓导入/阅读逻辑；MCP 侧已用「直读 `partNNN.md` + 精简 TOC」的更简方案落地，本文记录的是**本仓阅读助手可改进项**，非 MCP 待办。

调研范围：reader scope 注入的 `ragSearch / ragToc / ragContext / ragRange` + 常驻兜底 `readBookSection`（`packages/app/src/ai/tools/registry.ts:383-397`），工具经 Tauri IPC `invoke("plugin:epub|…")` 调 Rust。

## 缺陷清单（按影响排序）

### R1 · 正文经 EPUB DOM 重解析，而非直读现成的 partNNN.md
- 现象：`readBookSection` 走 foliate/EPUB section DOM，`extractStructuredText` 结构化提取后再切片（`packages/app/src/ai/tools/read-book-section.ts:140-190`）。
- 问题：向量化管线其实已把每章落成 `mdbook/book/src/OEBPS/Text/partNNN.md`（`packages/app/src-tauri/plugins/tauri-plugin-epub/src/pipeline.rs`）。直读这些 md 更快、更稳，且与向量检索命中块（`document_chunks.md_file_path` 就指向这些文件）天然对齐。
- 建议：阅读助手续读整章时优先直读 partNNN.md，DOM 提取仅作无 mdbook 时的兜底。
- 参考：sageread-mcp 的 `read_book` 即直读 md 文件（offset/limit 分页）。

### R2 · ragToc 返回 token 膨胀（引用指南 + 300 字预览样板）
- 现象：`ragToc` 从 `document_chunks` 按 `related_chapter_titles` 取整章（Rust 命令 `get_toc_chunks` → `get_chunks_by_chapter_title`，`packages/app/src-tauri/plugins/tauri-plugin-epub/src/commands.rs` 约 306 行起），输出夹带大量引用指南与每章 ~300 字预览。
- 问题：目录本应是轻量导航，预览样板让单次 TOC 调用吞掉大量上下文。
- 建议：TOC 只回「层级标题 + 定位标识（文件名/序号）」，预览改为按需（readBookSection/ragRange）再取。
- 参考：sageread-mcp 的 `get_book_toc` 只输出标题 + `[partNNN.md]`，无预览。

### R3 · file_order_in_book 语义易误用（≠ partNNN 的 NNN）
- 现象：`file_order_in_book = min(play_order)`，即指向同一 partNNN.md 的**首个 nav 条目序号**（`packages/app/src-tauri/plugins/tauri-plugin-epub/src/pipeline.rs`：`min_play_order` 计算约 243-247、赋值 `file_order_in_book: min_play_order` 约 305，已核对属实）。
- 问题：一个 md 文件可对应多个 nav 条目，`file_order_in_book` 既不等于文件名里的 NNN，也不是「第几个文件」。消费方（含 MCP、提示词）极易当成文件号误用。
- 建议：字段改名或补文档明确语义；对外定位一律用 `md_file_path`/文件名，不要用 file_order_in_book 当文件索引。

### R4 · nav.md 解析正则要求前导编号，无编号条目会漏
- 现象：TOC 解析正则 `^(\s*)(\d+)\.\s+\[([^\]]+)\]\(([^)]+)\)`，缩进/4=层级（`parse_nav_md_content`，`packages/app/src-tauri/plugins/tauri-plugin-epub/src/epub/toc_parser.rs:227-264`，已核对属实）。
- 问题：`\d+\.` 是硬性前缀，若 nav.md 有无编号条目（`- [标题](...)` 或纯 `[标题](...)`）会被整条跳过，导致目录缺章。
- 建议：把编号组设为可选 `(?:(\d+)\.\s+)?`。
- 参考：sageread-mcp 的 `parseNavToc` 已用可选编号正则。

### R5 · 结构体检 / 坏结构标记 / 重复段检测：完全缺失
- 现象：本仓仅有索引错误统计 ErrorStats（`packages/app/src-tauri/plugins/tauri-plugin-epub/src/models/progress.rs:27-44`，已核对）、空文件/缺文件跳过（`packages/app/src-tauri/plugins/tauri-plugin-epub/src/pipeline.rs` 约 206-231）；**没有**转换后「章数/平均章长/超长章预警」的结构体检，也没有「坏结构书仅适合语义检索」的书架标记，更没有重复段（连续 N-gram 循环，扫描版/幻觉源指纹）检测。
- 来源：对应 sageread-mcp 实战反馈 F5（外部来源 EPUB《圣殿》结构塌为单一大章 + 幻觉式循环重复段，导致「只能召回、不能直读」）。
- 建议：① 转换器加结构体检报告；② 书架支持坏结构标记；③ 导入时做重复段检测提示。
- 备注：sageread-mcp 侧可补一个只读的 `book_structure_report(book)`（从 `document_chunks` 算章数/平均章长/超长章预警）作为检索前判断，但根治在本仓导入管线。

## 值得本仓反向借鉴的 MCP 侧做法
- 标题匹配阶梯：精确 > 前缀 > 包含，多命中返回歧义候选清单（`read_book` 的 `resolveBookFile`）。
- nextOffset 分页续读（与 R1 直读 md 配合）。
