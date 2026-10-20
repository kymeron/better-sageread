# 阅读进度定位与 chunk 体系审计（2026-10-14）

> 缘起：确认"阅读进度是否依赖 EPUB 目录""能否以块/行定位阅读位置"。本文核查现有实现，给出结论与缺口清单，供后续 Agent 上手执行。
> 原则：以代码为准；所有引用都带文件:行号。

## 0. 结论速览

| 问题 | 结论 |
| --- | --- |
| 阅读进度（恢复到哪）依赖 EPUB 目录吗？ | **不依赖**。持久化的是 CFI + spine 序估算（`book_status.location`、`progress_current/total`），目录烂也能精确回跳 |
| 阅读助手"读到哪"的信息依赖目录吗？ | **依赖**。`【当前阅读章节】`注入的是 TOC label，无 nav/NCX 的 EPUB 注入为空 |
| chunk 是预先切好再向量化的吗？ | **是**。索引进线时从 md 文本切（token 50–300，带重叠），切块→向量化→入库一气呵成 |
| chunk 里有偏移/行号/标题锚吗？ | **没有**。只有 `chunk_order_in_file`、`global_chunk_index`、`md_file_path`、`file_order_in_book`、`related_chapter_titles` |
| 已支持"以块取内容/扩窗口"吗？ | **已支持**（ragRange/ragContext/ragToc、paperContext），但**活阅读位置→块的映射不存在** |
| 目录烂还会影响什么？ | 向量索引本身：未被子 TOC 引用的 spine 文件**不参与切块**，极端情况整书 0 chunk |

## 1. 书籍（EPUB）侧：阅读位置链路

### 1.1 持久化进度（不依赖 TOC）

- foliate relocate → `foliate-viewer-manager.ts:242-257` 上报 `{location: CFI, sectionHref, sectionLabel, section(spine index), pageinfo, range}`
- 自动保存 `use-progress-auto-save.ts:112-119` 写 `book_status`：`location`=CFI、`progressCurrent/Total`
- `pageinfo` 来自 `SectionProgress`（`foliate-js/progress.js:71-126`）：按 spine 文件大小等长估算（1500 loc/章尺寸），**与 TOC 无关**
- 即：目录全烂，打开书仍能回到原位置（CFI 反解）；跨设备同步 LWW 也以 CFI 为准

### 1.2 Agent 感知"当前位置"（依赖 TOC，这是脆弱点）

- `【当前阅读章节】`=`progress.sectionLabel`（`ai/custom-chat-transport.ts:56-59`；reader 侧不注入正文，只有 label）
- `sectionLabel` 来自 foliate `detail.tocItem.label`；`tocItem` 由 `TOCProgress`（`foliate-js/progress.js:18-69`）查表得出
- foliate 的 toc 只来自 EPUB3 nav 或 EPUB2 NCX（`foliate-js/epub.js:996-1013`）；**无 nav 且无 NCX 时 `book.toc ?? []` 为空表**（`view.js:256`），foliate 不会合成 spine 目录 → `tocItem` undefined → label="" → 注入为空，Agent 不知道用户读到哪
- 但此时 `detail.section.current`（spine 序号）与 CFI 依然有效——**只是没有被用起来**
- 提示词里的整本目录 `bookTocMd` 同样来自 foliate `bookDoc.toc`（`components/side-chat/index.tsx:47-49`），目录烂则目录段缺失

### 1.3 readBookSection（未建索引时的正文兜底）

- 匹配链：精确 > 前缀 > 包含 > 小节号精确 > 父级号退化（`ai/tools/read-book-section.ts:39-67`），"号通道"就是为对抗注入目录被转义/截断而加的
- 但仍需目录项可匹配；目录彻底为空时 JS 层失败，回退 Rust `read_book_section`（按章节标题正则剥标签，同样吃目录）
- href→spine 解析有后缀归一容错（`read-book-section.ts:70-80`）

## 2. 向量化 chunk 体系

### 2.1 切块时机与算法

- **索引进线时切**（不是阅读时，也不是 EPUB 原件上切）：
  1. `convert_epub_to_mdbook`（外部 crate `epub2mdbook 0.15.0`，**不在本仓库**）把 EPUB 转成 `mdbook/`（每 spine 文件一个 md）
  2. 解析 nav.md / toc.ncx 得扁平 TOC，按 `md_src` 分组（`pipeline.rs:85-146`）
  3. 逐 md 文件 `chunk_md_file_flagged`（`pipeline.rs:234`）→ 逐块向量化 → 批量入库
- 切块器 `text/chunker.rs`：token 估算 MIN 50 / MAX 300（`constants.rs:5,8`），优先按 Markdown 结构（标题/代码块/空行/句末标点），带重叠 `CHUNK_OVERLAP_RATIO`，超长行按句→字符兜底
- 论文同一把刀：整篇 `paper.md` 单文件切（`pipeline.rs:740`），`chunk_order_in_file == global_chunk_index`

### 2.2 chunk 记录有什么、没什么

- 有：`md_file_path`（绝对路径）、`file_order_in_book`（= 相关 TOC 节点 play_order 最小值）、`related_chapter_titles`（索引进线时从 TOC 节点拼，"|" 连接）、`chunk_order_in_file`、`total_chunks_in_file`、`global_chunk_index`、`is_references`（`models/document.rs:5-34`；表结构 `database/connection.rs:167-184`）
- **没有**：字节/字符偏移、行号、标题锚点。想"定位到块内第几行"现在做不到
- 无偏移的历史原因注释：`pipeline.rs:275` 曾"以等长估计给每个 chunk 一个起始位置"，现仅余注释，无字段落库

### 2.3 块号的稳定性问题（重要）

- 切块触发条件依赖 token 数与内容结构，**块与块之间有重叠**（相邻块共享尾部/头部文本）
- 重向量化（内容变化、换嵌入模型）会重切，**全局块号必然漂移**；同一段文本可能出现在相邻两块
- 结论：块号适合做"检索窗口/临时引用"，**不适合做持久地址**（书签、笔记、跨会话引用）
- 现有持久锚 precedent：翻译 sidecar `translation/{spineIndex}.json` 按 spine 序号分章 + 段文本 sha256-16 作键——"spine 序号 + 内容哈希"是已被验证的非 TOC 稳定锚（`02-data-model.md` 第 2 节）

### 2.4 目录对向量索引的反噬（比定位更严重）

- `md_groups` 从扁平 TOC 构建（`pipeline.rs:142-146`）：**TOC 未引用的 md 文件不参与切块**；flat_toc 为空 → 整书 0 chunk
- 挂载点：nav.md/toc.ncx 由 epub2mdbook 生成；**TOC-less EPUB 时该 crate 是否合成 spine 目录未验证**（外部仓库，本审计未覆盖）——这是待验证项 V1
- `related_chapter_titles` 也来自索引进线的 TOC：目录烂 → 块的章节归属标签烂（检索结果的章节名不可信）

### 2.5 已经存在的"以块取内容"能力

- 书籍：`ragRange`（`ai/tools/rag-range.ts`，按 `global_chunk_index` 范围取块、跨章）、`ragContext`（按 chunk_id 前后扩 0-10 块）、`ragToc`（按章标题取整章块，再按小节标题文本切起点——本质是文本包含猜的，`rag-toc.ts:56-70`）
- 论文：`paperSearch` + `paperContext`（`ai/tools/paper/paper-context.ts`，同篇前后邻居扩窗）
- 缺口：**活阅读位置 → 块** 的桥不存在。foliate 侧坐标（CFI / spine href / spine index）与 mdbook 侧坐标（md 文件路径）没有任何映射表；chunk 的 `md_file_path` 是 mdbook 产物路径，与 foliate spine id 不对应

## 3. 论文侧对照

- "目录"= `paper.md` 的 ATX 标题（`pages/paper-reader/markdown-sections.ts`：slug 对齐 rehype-slug/github-slugger + 字符偏移 start/contentStart）。**没有独立目录文件可坏**；但论文若整体没有标题（转换失败），同样退化
- 当前位置：滚动跟踪 `currentHeading {id, text}`（`paper-reader-view.tsx:101`），注入 `【当前阅读小节】`+`【当前小节正文】`（`paper-chat-panel.tsx:195-201`、`custom-chat-transport.ts:48-54`）
- 笔记定位三列：`location_cfi`=heading slug、`location_tag`=文本兜底、`location_block`=TOC 序号（`paper-reader-view.tsx:539-544`）——**论文已经把"结构锚+文本兜底+序号"三件套做出来了**，书籍侧可以照抄思路
- chunk→小节映射同样不存在：`related_chapter_titles` 只存论文标题，rag-toc 靠"块文本是否含标题行"猜小节起点

## 4. 缺口清单（给后续施工）

按价值/成本排序：

1. **阅读位置 → 块映射（双侧）**：让 Agent 能回答"你正读到块 524/529 附近，属于 X 章"。前置工作：建 foliate spine ↔ mdbook md 文件映射（转换时落一张表，或以 spineIndex 命名 md 文件——翻译 sidecar 已是 `{spineIndex}.json` 先例）。注入形态：reader 侧除 `【当前阅读章节】` 外增加 `【当前位置坐标】`（spine index + sectionHref + CFI + 命中块号区间），TOC 缺失时降级用它
2. **TOC-less 降级链路**：EPUB 无目录时，①注入坐标而非 label；②`readBookSection` 增加"按 spine 序号/文件名直读"通道；③提示词目录段缺失时明示"本书无目录"
3. **验证 V1**：造一本无 nav 无 NCX 的 EPUB 跑向量索引，确认 epub2mdbook 是否合成 nav.md、未引用文件是否丢块；若丢块，考虑按 spine 全量切块 + TOC 只作标签
4. **chunk 持久偏移（可选）**：`document_chunks` 加 `start_offset/end_offset`（md 域字符偏移）或首个非重叠行的内容哈希，使块可被稳定引用、可做"块→小节"反查（建索引时顺手记录所属 heading slug，论文/书籍同构）
5. **章节→块区间表（可选）**：用户举例"块 524-529 属于 3.4.2"——建索引时按 heading 边界记录每小节的 [first_chunk, last_chunk]，ragToc 不再靠文本猜
6. **行号定位**：只有在"以 mdbook 为权威文本层"的前提下才有意义（阅读器渲染的是 EPUB spine HTML，与 md 行无天然对应）。若要行级地址，等于先落实 1 的映射 + 4 的偏移；优先级低于 1/2

## 5. 关键文件索引

| 主题 | 位置 |
| --- | --- |
| 进度持久化 | `packages/app/src/pages/reader/hooks/use-progress-auto-save.ts:84-139` |
| foliate 位置上报 | `packages/app/src/pages/reader/hooks/use-foliate-viewer/foliate-viewer-manager.ts:242-257` |
| TOC→位置映射 | `packages/foliate-js/progress.js:18-69`（TOCProgress）；toc 来源 `epub.js:996-1013` |
| 动态注入 | `packages/app/src/ai/custom-chat-transport.ts:44-61` |
| 提示词目录段 | `packages/app/src/constants/prompt.ts:145`；`components/side-chat/index.tsx:47-49` |
| 切块器 | `packages/app/src-tauri/plugins/tauri-plugin-epub/src/text/chunker.rs`（`constants.rs:5,8`） |
| 书籍索引管线 | `plugins/tauri-plugin-epub/src/pipeline.rs:16-378`（md_groups :142-146） |
| 论文索引管线 | `pipeline.rs:713-705` |
| chunk 表结构 | `plugins/tauri-plugin-epub/src/database/connection.rs:167-184` |
| 按块取内容工具 | `src/ai/tools/rag-range.ts`、`rag-context.ts`、`rag-toc.ts`、`paper/paper-context.ts` |
| 论文小节解析 | `src/pages/paper-reader/markdown-sections.ts` |
| 翻译稳定锚 precedent | `translation/{spineIndex}.json`（段 sha256，见 `wiki/02-data-model.md` 第 2 节） |

## 6. 本次未覆盖（留给后续核实）

- epub2mdbook（Books_Converter 侧的 Rust crate）对 TOC-less/坏 TOC EPUB 的 nav.md 合成行为
  —— **2026-10-20 部分覆盖**：已核实 epub2mdbook 按「EPUB zip 资源路径换 .md 扩展」输出到 src 根，spine 页可直接映射（见 §7）；
  TOC-less 索引回退已实装，但「回退后整书向量化」未做真机联网实测（需嵌入模型额度）。
- 双栏/固定布局 EPUB 的 CFI 稳定性（与本文主题正交）
- TTS 朗读进度的坐标体系（独立链路，未核查）

## 7. 2026-10-20 施工落地（阅读位置桥，缺口 1/2）

### 7.1 落地形态

- **书籍侧坐标**：foliate relocate 新增 `sectionIndex / sectionHref(zip 路径) / sectionFraction / spineTotal`（`packages/foliate-js/view.js`）→ 活位置注册表 → 唤醒侧 `plugin:epub|resolve_reading_position` 换算为 `mdbook/src/...md + 字符偏移 + 估算分块区间`。href→md 的映射与 §2.1 的 epub2mdbook 产物规则一致（资源路径换 .md 扩展），mdbook 缺失时命令内部幂等触发一次 EPUB→mdbook 转换（非向量化老书也能用）。
- **论文侧坐标**：scroll spy 同步产出 `heading id/text + 正文字符偏移/比例`（坐标系 = `parsePaperSections` 的 body，不反推原文长度）→ `plugin:epub|resolve_paper_position` 换算为 paper.md 全文偏移（剥 frontmatter 后按比例回算）+ 篇内分块区间。
- **注入**：两侧统一在 system prompt 最尾部注入【当前阅读位置】（坐标 + 估算分块 + 进度；目录缺失时 label 用 spine 兜底），不再注入论文当前小节正文；注入段 ≤600 字符，静态前缀缓存不受影响。
- **按需读原文**：新工具 `getReadingPosition` / `readAtReadingPosition`（UTF-8 字符窗口、before/after 扩窗、next_offset 续读），取代"每轮灌正文"。
- **持久化**：论文阅读位置写入 `book_status.location`（JSON `{v,headingId,fraction,charOffset}`）+ `progressCurrent/Total`（字符口径）→ 重启恢复 + 文献库「阅读中 x%」；书籍继续用 CFI（已有），坐标由 CFI/spine 实时派生。
- **TOC-less 索引回退**：pipeline 在既无 nav.md/toc.ncx 或解析为空时，按 EPUB spine 顺序合成扁平 TOC（标题取 md 首个 ATX 标题），修复「目录坏 → 整书 0 chunk / 直接索引失败」。

### 7.2 验证（2026-10-20）

- `pnpm --filter app exec tsc -b --pretty false` → exit 0。
- `cargo test --manifest-path packages/app/src-tauri/plugins/tauri-plugin-epub/Cargo.toml --lib` → 32 passed（新增 7 个位置桥单测）。
- **CDP 实盘**（dev 实例，真实书库数据）：`node scripts/cdp-verify-reading-position.mjs` → ALL PASS：
  - 真实书 spine href → md 相对路径精确映射、charOffset/fraction/百分比一致、已索引书分块区间在 [1,全书总数]；提示词注入段格式与「以此为准」口径正确；
  - 按位置读窗口（totalLength/区间/正文）正确；
  - 论文 paper.md 坐标（frontmatter 剥离 + 正文比例）正确；
  - 含 `..` 的 href 被拒绝（服务降级 null，不返回坐标）；
  - 「有 EPUB 无 mdbook」的真实老书：命令内部幂等转换成功 → 非向量化书也拿到坐标并可读原文。

### 7.3 已知边界（非阻塞）

- 分块区间是**估算值**（fraction × 文件分块数），不承诺块边界精确；块号仅作检索窗口参考。
- 论文 `global_chunk_index` 因空分片跳过存在空洞，估算用 count 公式，属近似。
- 译文/对照视图下论文 `markdown` 为译文重建文本，坐标比例语义仍成立，但 charOffset 是该视图坐标系（恢复用 heading+fraction，不依赖 charOffset）。
- TOC-less 回退的整书向量化未联网实测（需嵌入模型额度）；单测覆盖回退目录合成逻辑。

