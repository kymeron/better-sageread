# SageRead Agent 工具与检索体系盘点（只读，2026-10-21）

**一句话结论**：SageRead 的 Agent 不是"工具太少"，而是同一件事长出了多套平行实现——内部搜索 4 套（另有工作区搜索 1 套、外部搜索 2 套）、上下文扩展 2 套、按锚点读取 7 种、TOC 3 套；真正的缺口是**统一文档句柄（DocRef）与 read/search/outline/媒体读取四类通用原语**，领域层应只保留"阅读位置、书章节号匹配、论文结构、引用 chunk、笔记/库操作"这些高效锚点。

> 口径：全部以当前代码为准（`packages/app/src`、`packages/app/src-tauri`），并以 `wiki/04-agent.md`、`wiki/05-papers-pipeline.md` 交叉核对；只读，未运行构建/测试、未改任何代码。标注【事实】= 代码可直接验证；【推断】= 基于代码结构的判断/建议。外部前沿 Agent 对标不在本清单范围（Lead 侧统一调研）；代码内仅有一处对标痕迹：`packages/app/src/ai/tools/lazy-toolset.ts:6` 注释称目录牌对齐 Anthropic Tool Search Tool / RAG-MCP。

---

## 1. 总装配：一条消息如何变成「scope + 工具 + 提示词」

### 1.1 调用链【事实】

1. 面板层构造 `ChatContext`：`{ activeBookId, agentScope, activeSectionLabel?, bookTocMd?, paperScopeIds?, threadId? }`（定义 `packages/app/src/hooks/use-chat-state.ts:118-130`）。书籍侧栏填 `activeSectionLabel/bookTocMd`（`components/side-chat/index.tsx:123-133`），论文面板填 `paperScopeIds`（`pages/papers/paper-chat-panel.tsx:165-175`）。
2. `CustomChatTransport.sendMessages`（`ai/custom-chat-transport.ts:98-300`）负责整条请求的组装（详见第 3、6 节）。
3. 工具面：`getToolsForScope(agentScope, { bookId: activeBookId, paperId: activeBookId, paperScopeIds, threadId })`（`custom-chat-transport.ts:199-211`）+ 异步合并的 MCP 工具，再统一过 `wrapToolsWithGuard`（`ai/utils/tool-guard.ts:104`）。
4. 工具数超预算时收缩为"目录牌 + describeTool/useTool"（`ai/tools/lazy-toolset.ts:27-31,91-197`；触发在 `custom-chat-transport.ts:216-217`）。
5. `streamText({ tools, instructions, stopWhen: isStepCount(20) })`（`custom-chat-transport.ts:261-275`）。

### 1.2 各 scope 工具面（静态注册 + 工厂动态创建）【事实】

- 静态注册表 `registry: ToolRegistration[]`（`ai/tools/registry.ts:96-111`）；`ToolScope = "central" | "reader" | "shared" | "mcp"`（:73），但 **没有任何工具静态注册到 reader**——reader/paper 专属工具全是闭包工厂。
- **shared 静态 15 个**：notes、getBooks、getReadingStats、getSkills、mindmap、webSearch、sciverseSearch、readLocalFile、writeFile、editFile、searchFiles、runCommand、exportNotes、askAppHelp、readImage（`registry.ts:115-208`）。
- **central 静态 23 个**：manageBook、convertPdf、importBook、importPaper、manageSync、searchDevDocs、vectorizeBook、manageTags、trashManager、managePreferences、switchModel、manageThreads、importFont、httpRequest、downloadFile、extractZip、manageSkill、manageSecrets、manageMcp、managePaperFolders、processPaper、translateBook、manageNotes（`registry.ts:212-351`）。
- **readThread 条件注入 1 个**：仅 `context.threadId` 存在时（`registry.ts:377-379`）。
- **reader 动态最多 8 个**：ragSearch/ragToc/ragContext/ragRange（仅"有向量能力 + 本书已索引"）+ readBookSection + getReadingPosition + readAtReadingPosition + manageNotes（`registry.ts:384-401`）。
- **paper 动态最多 11 个**：getPaperToc、readPaperSection、getReadingPosition、readAtReadingPosition、readPaperFull、getPaperInfo、getCitations、getFigures、manageNotes、paperSearch/paperContext（后两个仅"有向量能力"，不校验本篇是否已索引）（`registry.ts:404-422`）。
- **central 额外 2 个条件工具**：paperSearch、paperContext（有向量能力时，全库范围）（`registry.ts:426-429`）。
- 实际工具数：central = 15+23(+1 readThread)(+2 search) = **38~41**；reader = 15+1+(4 或 8) = **20~24**；paper = 15+1+11 = **27**；再加 MCP 的 n 个。
- 由此：**central 恒超 30 个工具，必然进入目录牌模式**；reader/paper 视 MCP 与 schema 体积（>12k 字符）才进入。

### 1.3 能力门控【事实】

- 向量能力判定：`useLlamaStore.hasVectorCapability()`（`store/llama-store.ts:126-133`）只看"是否选中/配置了嵌入模型"，与具体库是否已索引无关。
- 书籍 RAG 工具额外校验 `book_status.metadata.vectorization.status === "success"`（`registry.ts:385-394`），并把未索引兜底工具 readBookSection 常驻。
- 论文只校验全局向量能力（`registry.ts:417-421`），没有单篇索引校验 → 未索引论文上 paperSearch 会静默返回空结果（Rust 侧不报错）。
- 提示词分档也只用全局 `hasVectorCapability`（`constants/prompt.ts:114-116`、`constants/paper-prompt.ts:72-79`）→ 存在"提示词说 RAG 已启用，但本书未索引导致 rag 工具根本没挂"的错位（见 3.6）。

---

## 2. 工具清单（逐项）

**图例**：来源 `Rust/<cmd>`=Tauri command；`SQLite`=`{appData}/database/app.db`；`FS`=appData 内文件；`HTTP`=网络；`LLM`=模型调用；`Store`=前端状态。返回 `T`=文本内容、`J`=结构化 JSON、`F`=file part（多模态）、`U`=UI/副作用。重叠 `S`=搜索族、`C`=上下文扩展、`R`=读取族、`T`=TOC/大纲、`N`=笔记族、`I`=图片族。

### 2.1 shared（15 静态 + readThread 条件）

| 工具（文件:行） | scope | 一句话职责 | 关键参数 | 数据来源 | 返回 | 重叠 |
|---|---|---|---|---|---|---|
| `notes` notes.ts:46 | shared | 查用户划线/想法（book_notes type=annotation） | reasoning、days、bookId、bookTitle、kind(book/paper/all)、limit≤200 | SQLite（book_notes + books 做 kind 过滤） | J+T | N |
| `getBooks` book.ts:79 | shared | 书库/文献库列表与单条查询 | reasoning、bookId、search、kind、status、limit（minimal≤1000/full≤200）、offset、fields | Rust get_books / get_books_with_status / get_book_by_id / get_book_status → SQLite books+book_status | J | 唯一库入口 |
| `getReadingStats` reading-stats.ts:41 | shared | 阅读会话统计 | reasoning、bookId（必填）、sessionLimit≤20 | Rust get_reading_sessions_by_book → SQLite | J | 独立 |
| `getSkills` get-skills.ts:8 | shared | 按任务名查技能 SOP | task、reasoning | SQLite skills | J | 与 manageSkill 配对 |
| `mindmap` mindmap.ts:4 | shared | 输出思维导图 Markdown，UI 渲染 | reasoning、title、markdown | 无（纯格式化） | J+U | 独立 |
| `webSearch` web-search.ts:12 | shared | 通用网页搜索 | reasoning、question、maxResults≤10 | HTTP Rust web_search（Bing/百度/DDG/API） | J | S（外部） |
| `sciverseSearch` sciverse-search.ts:20 | shared | 学术证据检索（论文原文片段） | reasoning、question、topK≤30、mode、expand | HTTP Rust sciverse_search | J | S（外部） |
| `readLocalFile` central/read-local-file.ts:24 | shared | 读任意本地文件（行号分页）/列目录 | reasoning、path、mode(read/list)、offset、limit≤2000 | FS Rust agent_read_file / agent_list_dir（8MB、200k 输出、2000 行上限，`agent_ws/commands.rs:10-14`） | T+J | R（与库内读取并行） |
| `writeFile` central/write-file.ts:17 | shared | 整文件写入工作区 | reasoning、path、content | FS Rust agent_write_file（memory.md 写密钥直接拒绝） | J | 独立 |
| `editFile` central/edit-file.ts:17 | shared | oldString 唯一性局部替换 | reasoning、path、oldString、newString、replaceAll | FS Rust agent_edit_file | J | 独立 |
| `searchFiles` central/search-files.ts:16 | shared | 工作区 glob/grep | reasoning、mode、pattern、subdir | FS Rust agent_search_files（glob≤200、grep≤100、跳过>2MB） | J | S（工作区） |
| `runCommand` central/run-command.ts:19 | shared | 工作区根执行命令（万能出口） | reasoning、command、timeoutSecs≤600 | FS Rust agent_run_command（20k 输出、审计日志） | J+U | 独立 |
| `exportNotes` central/export-notes.ts:26 | shared | 导出某书划线/想法为 Markdown | reasoning、bookId | SQLite book_notes + 保存对话框 | U | N |
| `askAppHelp` central/ask-app-help.ts:23 | shared | 内置使用手册问答（RAG） | reasoning、question、limit、reindex | 内置手册语料向量库（manual-service） | T+J | S（内部语料） |
| `readImage` read-image.ts:10 | shared | 按 attachment:// 重看聊天图片 | ref | FS `{appData}/attachments/` → dataUrl | **F** | I |
| `readThread` read-thread.ts:31（条件） | shared 动态 | 读回一条对话完整问答 | reasoning、threadId（缺省当前）、maxChars≤400k、offset | SQLite threads | T | N/对话 |

### 2.2 central（23 + 2 条件）

| 工具（文件:行） | scope | 一句话职责 | 关键参数 | 数据来源 | 返回 | 重叠 |
|---|---|---|---|---|---|---|
| `manageBook` central/manage-book.ts:14 | central | 删除入回收站/打开/重置进度 | reasoning、bookId、action(delete/open/resetProgress) | Rust 查询 + SQLite + UI store | J+U | 独立 |
| `convertPdf` central/convert-pdf.ts:12 | central | PDF→EPUB 并入库 | pdfPath、ocr、translate(zh/en/ja/ko) | Books_Converter sidecar → save_book → SQLite+FS | J+U | 与 importBook 相邻 |
| `importBook` central/import-book.ts:20 | central | 本地路径导入书籍 | filePath | FS → save_book（book.epub+cover+metadata.json） | J | 独立 |
| `importPaper` central/import-paper.ts:13 | central | PDF/XML 解析为 paper.md 入文献库 | filePath、folderName | Papers_Converter sidecar → save_paper → SQLite+FS | J+U | 与 convertPdf 对称 |
| `manageSync` central/manage-sync.ts:24 | central | 备份/恢复/同步/偏好 | action(backupNow/listBackups/restore/syncNow/updatePrefs)、backupName、restart、direction、autoBackup… | sync-service + Rust 备份/同步 | J+U | 独立 |
| `searchDevDocs` central/search-dev-docs.ts:28 | central | 检索开发者 wiki | question、limit、reindex | wiki 语料向量库（`books/__repo_wiki__`） | T | S（内部语料） |
| `vectorizeBook` central/vectorize-book.ts:55 | central | 书籍/论文向量化与状态 | reasoning、action(index/status)、bookId、kind | Rust 管线 → 每书 vectors.sqlite / 全局 papers/vectors.sqlite；长任务 | J+U | 独立 |
| `manageTags` central/manage-tags.ts:11 | central | 标签 CRUD/分配 | action(list/create/rename/assign/remove)、tagName、newTagName、bookId | SQLite tags/book_tags | J | 独立 |
| `trashManager` central/trash-manager.ts:8 | central | 回收站恢复/彻底删除/清空 | action(list/restore/purge/empty)、bookId | SQLite + FS（彻底删除清向量） | J+U | 独立 |
| `managePreferences` central/manage-preferences.ts:67 | central | 主题/阅读/界面偏好 | action(setTheme/reader/ui)、mode、globalTheme、fontSize… | Store + 配置 JSON | J+U | 独立 |
| `switchModel` central/switch-model.ts:32 | central | 查看/切换聊天或辅助模型 | action(list/set)、target/provider/model | provider-store + keyring | J+U | 独立 |
| `manageThreads` central/manage-threads.ts:71 | central | 对话列表/搜索/星标/改名/删除/导出 | action(…)、threadId、format(markdown/html/png)、merge | SQLite threads + 导出 | J+U | 与 readThread |
| `importFont` central/import-font.ts:12 | central | 导入字体 | filePath | FS + font-store | J | 独立 |
| `httpRequest` central/http-request.ts:21 | central | 通用 HTTP（第三方 API） | url、method、headers、body（支持 {{secret:}}） | HTTP Rust agent_http_request | J+U | 独立 |
| `downloadFile` central/download-file.ts:9 | central | URL 下载到本地 | url、savePath | HTTP → FS | J | 独立 |
| `extractZip` central/extract-zip.ts:8 | central | 解压 ZIP | zipPath、destDir | FS | J | 独立 |
| `manageSkill` central/manage-skill.ts:26 | central | 技能 CRUD/启停 | action(create/update/toggle/delete)、name、content、scope、skillId | SQLite skills | J | 独立 |
| `manageSecrets` central/manage-secrets.ts:16 | central | 密钥保管箱（无读出真值） | action(list/set/delete)、name、value | OS keyring | J | 独立 |
| `manageMcp` central/manage-mcp.ts:36 | central | MCP 服务器配置 | action(…)、transport、url、command/args/env、headers、scope | mcp-store + MCP runtime | J+U | 独立 |
| `managePaperFolders` central/manage-paper-folders.ts:24 | central | 文献文件夹树/移动/归档 | action(list/papers/create/rename/delete/move/assign)、name、folderId、paperId、folderIds | SQLite paper folders | J | 独立 |
| `processPaper` central/process-paper.ts:46 | central | 论文翻译/句词对齐/重解析 | action(status/translate/align/reparse)、paperId、force、filePath | LLM 翻译/对齐服务 + paper.md + 译本 JSON；长任务 | J+U | 独立 |
| `translateBook` central/translate-book.ts:49 | central | EPUB 全书翻译/状态 | action(status/translate)、bookId、force | LLM + `translation/{spine}.json`；长任务 | J+U | 独立 |
| `manageNotes` central/manage-notes.ts:39（central 未绑定） | central | 长文笔记面板 CRUD/导出 | action(list/read/create/update/toggleStar/export)、bookId、noteId/title/content/mode | SQLite notes + 导出对话框 | J+U | N |
| `paperSearch` paper/paper-search.ts:26（origin=central） | central | 全库语义检索 | query、topK、vectorWeight、bm25Weight、includeReferences | Rust search_papers_db → `papers/vectors.sqlite` | J+T | S |
| `paperContext` paper/paper-context.ts:12 | central | 按 chunk_id 扩展同论文前后文 | chunk_id、before/after≤10 | Rust get_paper_chunk_context | J+T | C |

### 2.3 reader（动态 8，闭包捕获 bookId；rag* 仅"向量能力+本书已索引"）

| 工具（文件:行） | 一句话职责 | 关键参数 | 数据来源 | 返回 | 重叠 |
|---|---|---|---|---|---|
| `ragSearch` rag-search.ts:10 | 本书混合检索（BM25+向量） | reasoning、question、limit≤20、searchMode(vector/bm25/hybrid)、vectorWeight、bm25Weight | Rust `plugin:epub|search_db` → `books/{id}/vectors.sqlite` | J+T | S |
| `ragContext` rag-context.ts:8 | 按 chunk_id 扩前后文 | chunk_id、prev_count/next_count≤10（默认 3） | Rust `get_chunk_with_context` | J+T | C |
| `ragRange` rag-range.ts:7 | 按全局 chunk 索引连续取块 | start_index、end_index、max_chunks≤50（默认 20） | Rust `get_chunks_by_range` | J+T | R/C |
| `ragToc` rag-toc.ts:8 | 按章节标题取整章分块 | chapter_title（含"5.5 标题"小节起点切块逻辑） | Rust `get_toc_chunks` | J+T | R/T |
| `readBookSection` read-book-section.ts:88 | 按目录标题直读小节原文（标题模糊/小节号匹配） | reasoning、chapterTitle、maxChars(默认 8k/上限 30k)、startOffset | JS：foliate 解析 `book.epub` DOM → `extractStructuredText`；失败回退 Rust `plugin:epub|read_book_section` | J+T | R/T |
| `getReadingPosition` reading-position.ts:24 | 当前阅读位置精确坐标 | reasoning | 活位置注册表 + Rust `resolve_reading_position`（mdbook 字符偏移+估算 chunk 区间） | J | 位置锚点 |
| `readAtReadingPosition` reading-position.ts:67 | 按当前阅读位置读原文窗口 | before≤8000、after(默认 6k/≤32k) | Rust `read_position_window`（读 mdbook md） | J+T | R |
| `manageNotes` manage-notes.ts:39（绑定本书） | 本书长文笔记管理 | action、noteId/title/content/mode/locationTag | SQLite notes + 导出 | J+U | N |

### 2.4 paper（动态 11，闭包捕获 paperId；基础层不依赖向量）

| 工具（文件:行） | 一句话职责 | 关键参数 | 数据来源 | 返回 | 重叠 |
|---|---|---|---|---|---|
| `getPaperToc` paper/paper-toc.ts:7 | 论文标题层级目录 | reasoning | FS `paper.md` + parsePaperSections | J | T |
| `readPaperSection` paper/paper-section.ts:11 | 按标题/锚点 id 读小节 | heading、maxChars(32k/80k)、offset | FS paper.md | J+T | R/T |
| `readPaperFull` paper/paper-full.ts:11 | 通读全文（去 frontmatter） | maxChars(50k/100k)、offset | FS paper.md | J+T | R |
| `getPaperInfo` paper/paper-info.ts:10 | 元数据（摘要截 2000 字符） | reasoning | FS metadata.json | J | 独立 |
| `getCitations` paper/paper-extras.ts:49 | 参考文献列表 | reasoning | FS paper.md（References 标题定位 + 条目拆分；整体截 8000 字符，无翻页） | J+T | T/引用 |
| `getFigures` paper/paper-extras.ts:126 | 图片清单（图注+所在小节） | reasoning | FS paper.md（正则；≤50 条；只回路径/图注，不能读图） | J | I |
| `getReadingPosition` reading-position.ts:24 | 论文当前位置坐标 | reasoning | 活位置注册表 + Rust `resolve_paper_position` | J | 位置锚点 |
| `readAtReadingPosition` reading-position.ts:67 | 按论文位置读 paper.md 窗口 | before/after | Rust `read_position_window`（kind=paper） | J+T | R |
| `paperSearch` paper-search.ts:26 | 文献库语义+关键词混合检索 | reasoning、query、topK≤30、vectorWeight、bm25Weight、includeReferences | Rust `search_papers_db` → `papers/vectors.sqlite`；范围由 `paperScopeIds` 闭包 | J+T | S |
| `paperContext` paper-context.ts:12 | 按 chunk_id 扩展同论文前后文 | chunk_id、before/after≤10（默认 3） | Rust `get_paper_chunk_context` | J+T | C |
| `manageNotes` manage-notes.ts:39（绑定本论文） | 本论文长文笔记管理 | 同 reader | SQLite notes + 导出 | J+U | N |

### 2.5 目录牌模式的 2 个入口【事实】

- `describeTool(name)` 返回真实工具的 description + JSON Schema；`useTool(tool,args)` 转发执行，转发前用真实 inputSchema 校验并补 zod 默认值（`lazy-toolset.ts:94-196`）。
- 目录牌文本每行"工具名：一句话"进入 system 静态区（`lazy-toolset.ts:55-84`；transport `custom-chat-transport.ts:245-248`）。MCP 工具按 server 分组。

### 2.6 一眼可见的重叠【事实】

- **搜索 5 处**：ragSearch（本书）/ paperSearch（论文库）/ searchDevDocs（wiki 语料）/ askAppHelp（手册语料）/ searchFiles（工作区 glob+grep）；底层后端 4 套都是"BM25+向量混合 + 结果再排版"。
- **上下文扩展 2 处**：ragContext 与 paperContext 是同一算法两份代码（仅 Rust command 与默认值/字段名不同）。
- **按锚点读取 7 种**：readBookSection（标题/小节号）、ragToc（章节标题→chunk）、ragRange（全局 chunk 索引）、readAtReadingPosition（字符偏移）、readPaperSection（标题/id）、readPaperFull（全文 offset）、readLocalFile（行号）——单位不同（标题 / chunk 索引 / 字符 / 行），续读字段名也不同（offset / startOffset / next_offset / chunk index）。
- **TOC/大纲 3 处**：注入的 metadata.md/bookTocMd 目录、getPaperToc、ragToc；书籍侧没有独立的 getBookToc 工具。
- **笔记概念 3 套**：notes（划线标注 book_notes）/ manageNotes（长文 notes 表）/ exportNotes（导出标注）——名称相近、数据源不同。
- `reasoning` 参数几乎每个工具必填（schema 固定开销 + 每次调用 token），属"流程仪式"而非能力。

---

## 3. 系统提示词：分层、注入内容与 token 预算

### 3.1 最终拼装顺序【事实】

`custom-chat-transport.ts:240-254` 按"静态优先"顺序拼接 `instructions`：

`buildPrompt(chatContext)` → 目录牌（目录牌模式才有）→ 工作区段 → memory.md 段 → 【前情摘要】→ 动态尾部（【当前阅读位置】→【当前时间】）。

- 历史消息时间戳 `[YYYY-MM-DD HH:mm]` 在转换后逐条前缀（`custom-chat-transport.ts:230-236`；实现 `services/time-awareness.ts:139-202`）。
- 目的：除尾部外逐字节稳定，最大化前缀缓存命中（与 `services/time-awareness.ts:1-16` 的设计声明一致）。

### 3.2 分层【事实】

- 路由：`constants/prompt.ts:15-27` 按 `agentScope` 分到 buildCentralPrompt / buildPaperPrompt / buildReadingPrompt（reader）。
- 每层结构：**风格层**（激活预设 ?? `constants/agent-styles.ts:14-41` 内置默认）+ **通用规范** `constants/shared-policy.ts:8-14` + **系统策略段**（reader `constants/prompt.ts:37-87` 的 buildReaderPolicy、paper `constants/paper-prompt.ts:15-61`、central `constants/central-prompt.ts:9-73`）。
- 之后叠加：**激活技能名清单**（只列名字，正文靠 getSkills 工具按需取；reader `prompt.ts:118-122`、paper `paper-prompt.ts:81-93`、central `central-prompt.ts:82-94`）+ **scope 专属上下文**。
- central 额外注入"可用全局主题清单"（`central-prompt.ts:96-107`），避免 managePreferences 编造主题名。
- 工具使用策略**手写在策略段里**，与注册表靠人肉同步；`getToolDescriptions()`（`registry.ts:441-481`）已无任何调用方（死代码），目录牌文本由真实工具描述生成。

### 3.3 注入内容（按 scope）【事实】

| scope | 注入的上下文 | 位置/上限 |
|---|---|---|
| reader | 书籍元信息 + 目录：优先 `metadata.md`（书名/作者/出版社/日期/语言 + TOC），无则回落 `metadata.json` 的基本字段（无 TOC） | `prompt.ts:124-153`；`metadata.md` 仅在向量化管线中生成（`pipeline.rs:166-171,594-678`） |
| reader | 目录裁剪：一级平铺 + 当前章子树；EPUB 原生 TOC（`ChatContext.bookTocMd`）整段替换转换器生成的损坏目录 | `prompt.ts:146-154,160-172,180-242` |
| reader | 【当前阅读位置】动态尾部：章节名 + mdbook 文件/字符偏移/文件内%/估算 chunk 区间/spine/CFI/全书进度；**不注入正文** | `custom-chat-transport.ts:57-75,240-244`；`position-service.ts:37-51`，上限 600 字符（:23） |
| reader | 工作区根 + memory.md（持久记忆） | `utils/workspace-context.ts:26-34,40-56`；memory 上限 4000 字符（:6,52） |
| paper | 论文元数据（标题/作者/出处/DOI/关键词/**摘要全文**）——直接注入，摘要未截断 | `paper-prompt.ts:95-109,115-141` |
| paper | 【当前阅读位置】动态尾部：小节名 + paper.md 字符坐标 + 估算 chunk 区间 + 全文进度；正文不注入 | `custom-chat-transport.ts:69-74`；`position-service.ts:97-113` |
| central | 无文档上下文；仅风格/策略/技能/主题 | `central-prompt.ts:79-110` |
| 三 scope | 当前时间（system 最尾部）、历史消息时间前缀、前情摘要（≤2000 字符目标/4000 硬截）、目录牌（条件） | transport :240-254；summary-service:24,146-183 |
| 三 scope | **选中文本不注入 system**：走 user 消息的 quote part（`processQuoteMessages` 把 quote 与正文按原顺序拼为文本，`message-processor.ts:47-72`） | 引用/图片/文件占位符在输入区按位置展开，`use-chat-state.ts:874-957` |

### 3.4 token 预算与瘦身【事实】

- **历史消息双水位活塞**：>256k tokens 点火，从最新向前裁到 ≤128k；最近 10 条永不压；token 估算 CJK≈1 字/token、其余≈4 字符/token（`message-selector.ts:5-12,112-163`；`token-estimator.ts:16-21`）。
- **滚动摘要**：被裁前缀增量压缩写入 `thread.metadata.conversationSummary`，注入【前情摘要】（`custom-chat-transport.ts:179-190`；`services/conversation-summary-service.ts:24,146-183`）。
- **工具结果 L1 出生截断**：落库前 >1000 字符的"内容型工具结果"换成预览对象（`tool-result-slimming.ts:29,33-54,100-140`；写盘调用 `use-chat-state.ts:217`）。
- **工具结果 L2 存根活塞**：仅 ragSearch/ragContext/ragRange；按 user 轮次十进位块批处理，老轮次结果降级为 `⟦工具#N：已引/未引…⟧` 存根；`clear_at_least` 2000 tokens（`tool-result-slimming.ts:57-65,165-186,193-285`）。
- **工具面预算**：>30 个工具或 schema>12k 字符 → describeTool/useTool 两工具 + 目录牌（`lazy-toolset.ts:14-31`）。
- **各段硬上限**：阅读位置 600 字符、memory 4000、单次历史前情摘要 ~2000；论文摘要注入**没有上限**（见 3.6）；目录只到"当前章子树"。
- **单轮工具往返上限**：20 步（`custom-chat-transport.ts:266`）。

### 3.5 提示词缓存布局【事实/设计意图】

- 静态 → 准静态 → 动态的次序：风格/策略/技能/元数据（随书稳定）→ 工作区/记忆（少变）→ 前情摘要（稀有）→ 阅读位置（翻页变）→ 当前时间（每轮变）（`custom-chat-transport.ts:238-244` 注释与实现一致）。

### 3.6 已发现的不一致/风险【事实】

1. **提示词与工具门控口径错位**：reader 策略按全局 `hasVectorCapability` 宣称"RAG 已启用，主通道 ragSearch"（`prompt.ts:37-51,114-116`），但 rag* 还要"本书已索引"（`registry.ts:385-394`）；未索引时会话里根本没有 ragSearch，模型按提示词找工具会落空。
2. **paper 同样只有全局门控**：未索引论文的 paperSearch 返回空，但没有"本篇未索引"的提示（Rust 返回空数组；工具不抛错，`paper-search.ts:70-95`），模型容易误判为"没有相关内容"。
3. **论文摘要注入无上限**（`paper-prompt.ts:124-137`），个别长摘要会每轮挤占上下文；getPaperInfo 反而有 2000 字符上限（`paper-info.ts:7,37-41`）。
4. **阅读位置口径**：注入的 `char_offset` 是"按当前页在章内比例估算"的 mdbook 字符位置（book）或按正文比例换算的 paper.md 位置（paper），chunk 区间同为比例估算（`position.rs:88-94,130-148`），标注"精确坐标"但实际是估算；位置与文本的对应在 doc 结构改动后会漂移。
5. `ragContext/paperContext` 的 `meta.before/after` 回填用了错误变量（两处都写 `before ?? 2`，实际默认 3），仅展示口径 bug（`rag-context.ts:138-139`、`paper-context.ts:55-57,147-148`）。

---

## 4. 存储布局（`{appData}` 下）【事实，除标注待确认】

```
{appData}/
├─ database/app.db                    # 主库（SQLite）：books/book_status/threads/notes/book_notes/skills/prompt_presets/tags/folders…
├─ books/{bookId}/                    # 书籍（EPUB，id=partialMD5）
│  ├─ book.epub
│  ├─ cover.jpg
│  ├─ metadata.json                   # 导入时写；向量化时补 base_dir
│  ├─ mdbook/<bookName>/src/**.md     # epub2mdbook 产物（RAG/位置读取的文本层）
│  ├─ chapters/NNN-*.txt              # 兼容旧路径的按章纯文本
│  ├─ vectors.sqlite                  # 每书向量+BM25 索引
│  ├─ metadata.md                     # 仅向量化管线生成（元信息+目录，供提示词）
│  └─ translation/{spineIndex}.json   # 书籍对照译本
├─ books/{paperId}/                   # 论文（books.format=MARKDOWN，id=paper.md sha256 前 16 hex）
│  ├─ paper.md                        # YAML frontmatter + 正文
│  ├─ images/*.jpg|png                # 论文图片（markdown 引用 images/…）
│  ├─ metadata.json                   # frontmatter 解析缓存（含 title_zh/abstract_zh）
│  ├─ source.pdf / source.xml         # 重解析源（可缺省）
│  └─ translation-zh.json             # 论文块级译本
├─ papers/vectors.sqlite              # 全局论文索引（document_chunks.paper_id 区分）
├─ attachments/{id}.png|jpg|…         # 聊天图片附件（attachment://…）
│  └─ files/{id}-{name}               # 通用文件附件
├─ agent-workspace/                   # 文件五件套工作区根 + memory.md
├─ agent-audit/*.jsonl                # 命令/MCP/工具目录调用审计
├─ papers-converter/{slug}/           # Papers_Converter 解析 staging（paper.md+images/）
└─ books/__repo_wiki__/               # 开发者 wiki 语料 + vectors.sqlite（searchDevDocs）
```

### 4.1 书籍【事实】

- 入库：`save_book` 建 `books/{id}/`，格式 `book.{format}`，可选 `cover.jpg`、`metadata.json`（`src-tauri/src/core/books/commands.rs:9-46`）；id 来自前端 `partialMD5`（`services/book-service.ts:57`）。
- 向量化：读 `book.epub` → 转 mdbook（`pipeline.rs:52-83`）→ 按 nav.md/toc.ncx 或 spine 兜底建 TOC（:85-140）→ 分块+embedding 写 `books/{id}/vectors.sqlite`（:26,171-186）→ 生成 `metadata.md` 与 `chapters/*.txt`（:142-171,594-678）。
- mdbook 目录约定是 `mdbook/<book_name>/src`（`pipeline.rs:91-93`；`position.rs:225-260` 的 `find_mdbook_src_root`）；图片在 mdbook src 内以相对路径（如 `../Images/…`）存在，属于 epub2mdbook 产物（具体链接形态待确认）。

### 4.2 论文【事实】

- 解析产物落在 `{appData}/papers-converter/{slug}/{paper.md,images/,source.pdf}`（`src-tauri/src/core/paper_converter.rs:5-6`；`wiki/05-papers-pipeline.md:17,46`），入库时复制 `paper.md` 与 `images/`（可选 source.pdf/source.xml）到 `books/{paperId}/`，写 `metadata.json`，单事务 INSERT `books`+`book_status`（`core/books/commands.rs:1381-1449`）。
- 图片链接形态：`![Figure 1](images/fig1.jpg)`（fixture `fixtures/papers/akter2026atscale/paper.md:29`；契约 `docs/paper-format-contract.md` 亦此）；**相对 paper.md 所在目录**。
- 向量存全局 `{appData}/papers/vectors.sqlite`，内容仍留在 `books/{paperId}/`（`pipeline.rs:806-830`；`commands.rs:527-560`）；彻底删除论文时按 `paper_id` 清理全局库（`core/books/commands.rs:314-357`）。

### 4.3 索引库 schema【事实】

- `document_chunks`：id、book_title、book_author、paper_id、md_file_path（**绝对路径**）、file_order_in_book、related_chapter_titles、chunk_text、chunk_order_in_file、total_chunks_in_file、global_chunk_index、is_references、created_at（`database/connection.rs:166-187`；paper_id/is_references 为幂等迁移列 :108-149）。
- 向量表：`chunk_embeddings`（vec0，`chunk_id INTEGER PRIMARY KEY, embedding FLOAT[dim]`，:310-326）；sqlite-vec 不可用降级 `chunk_embeddings_fallback`（BLOB，:329-343）；维度变化会重建表并清空分片（:283-307）。
- BM25：只有 `bm25_stats(total_docs, avg_doc_length, updated_at)`（:388-403），**没有 FTS5 表**。
- 主库路径 `{appData}/database/app.db`（`core/database.rs:21-24`）。

### 4.4 不落 appData 的资产

- 聊天图片：`{appData}/attachments/{id}.{ext}`，消息只存 `attachment://文件名`（`services/attachment-service.ts:5-9,53-58`）。
- 通用文件附件：`attachments/files/{id}-{name}`，消息登记绝对路径（`attachment-service.ts:91-113`）。
- Agent 工作区：默认 `{appData}/agent-workspace`，可按 scope 覆盖；`memory.md` 自动注入（`utils/workspace-context.ts:14-20`）。

### 4.5 关键差异：一本书有两套文本层【事实】

- `readBookSection` 走 **EPUB DOM**（foliate `openBookDocument` 读取 `book.epub`，`read-book-section.ts:145`；`book-translation-service.ts:154-168`）再 `extractStructuredText`（公式→LaTeX、表格→Markdown）。
- `rag*` / `readAtReadingPosition` / 阅读位置走 **mdbook Markdown 文件**（`position.rs:165-214`；chunk 的 md_file_path 指向 mdbook 内绝对路径）。
- 两套文本的章节单位/字符坐标不同（spine index+CFI vs mdbook 文件+字符偏移）；目前靠"标题模糊匹配 / 比例换算"桥接，没有稳定的书内锚点 id。**这是"统一 read/outline 原语"最大的结构障碍。**

### 4.6 图片在 Markdown 里的链接形态与可用性【事实+待确认】

- 书籍：mdbook 图片相对路径由 `resolveMarkdownImagePaths` 转成"相对 appData 的路径"（`utils/path.ts:37-72`），rag 工具在返回前调用它（`rag-search.ts:113-123`、`rag-context.ts:64-77`、`rag-toc.ts:84-95`），所以模型看到的是 `books/{id}/…` 相对路径；`rag-range.ts` 未调用该转换（图片路径原样）。
- 论文：链接是 `images/fig.jpg`（不带 `./`），`resolveMarkdownImagePaths` 只处理 `./`/`../`（`path.ts:58-72`），**不会改写**；`paperSearch` 也没调用该函数（`paper-search.ts:84-95`），`paperContext` 调用但同样不改 `images/…`。→ 论文图片在 Agent 结果里是"不可直接定位"的相对路径。
- `readImage` 只接受 `attachment://`（`read-image.ts:14-16`），不能读库内图片；`getFigures` 明确"只返回路径与图注，不能看图"（`paper-extras.ts:139-140`）。

---

## 5. 检索与索引能力

### 5.1 分块【事实】

- 统一分块器 `chunk_md_file_flagged`：Markdown 结构感知，失败回退 token 行边界；`MIN=50 / MAX=300 tokens / overlap=20%`（`text/constants.rs:5-11`；`chunker.rs:182-190`）。
- 参考文献标记：首个 References/Bibliography/参考文献 ATX 标题之后的分片标 `is_references=true`（`chunker.rs:126-180`）；检索默认排除（各 search 的 `include_references=false`）。
- 书：按 mdbook 文件分组、全局 chunk 序号；论文：整个 paper.md 顺序切，`related_chapter_titles` 直接塞论文标题（`pipeline.rs:942-957`），**论文分块不携带小节标题** → 论文检索结果只有"论文标题"没有"所在小节"。

### 5.2 向量检索【事实】

- sqlite-vec vec0 表；查询向量按字节传入，`WHERE embedding MATCH ? AND k = ?`，`similarity = 1 - distance`；paper_id 过滤时先放大 k（`limit*10, min 100`）再 JOIN 过滤（`database/search.rs:45-120`）。
- 每书独立库；全局论文库按 paper_id 过滤（`commands.rs:654-711`；`pipeline.rs:969-...` 的 `search_papers_global`）。
- 入口：`search_db`（书，`commands.rs:221-279`）、`search_papers_db`（论文，:654-711）。

### 5.3 BM25/混合【事实】

- **没有 FTS5**：BM25 用 `LOWER(chunk_text) LIKE '%term%'` 逐词扫全表，再在 Rust 里算 tf/df/idf（`database/bm25.rs:157-215`）；分词是 `to_lowercase + split_whitespace`（:79-91），中文无分词（jieba 仅用于论文词级对齐的 `tokenize_zh` 命令，`commands.rs:738-744`）。
- 词频用 `str::matches` 子串计数（`bm25.rs:218-224`）→ 英文词根/中文都易误命中；性能随 chunk 总数线性退化。
- 混合：两路各取 `limit*2` → min-max 归一化 → 加权合并，默认 vector 0.7 / BM25 0.3；短查询自动偏 BM25（`database/hybrid.rs:81-162`；`config/search.rs:41-60`）。
- 书/论文共用同一套 BM25/hybrid 代码（参数 include_references/paper_ids 由封装传入）。

### 5.4 TOC / 章节锚点【事实】

- 书籍：EPUB nav.md/toc.ncx 解析（`pipeline.rs:85-140`），TOC 文本进 `metadata.md`（:647-654）并在提示词中裁剪注入（`prompt.ts:180-242`）；reader 侧另用 foliate 原生 TOC 替换目录段（`prompt.ts:160-172`；`components/side-chat/index.tsx:51-64`）。`ragToc` 按章节标题取 chunk（DB 查询 `get_chunks_by_chapter_title`），对"5.5 标题"有起点切块补丁（`rag-toc.ts:56-74`）。
- 论文：`parsePaperSections` 解析 ATX heading，生成 github-slugger 兼容 id + 纯文本标题 + 字符偏移（`markdown-sections.ts:51-99`）；`findSectionHeading` 按 id 精确→文本精确→忽略大小写→包含（:105-115）；`getSectionContent` 取到下一个同级/更高级 heading（:118-124）。
- 没有"统一 TOC 节点 id + 字符偏移"入库：书的 chunk 只有 `related_chapter_titles`（字符串），论文 chunk 没有小节信息 → 跨工具锚点只能靠标题文本。

### 5.5 paperSearch 的"范围"实现【事实】

- 用户选择"本篇/所在文件夹/全部/自定义文件夹" → `paperScopeIds: string[]|null`（`paper-chat-panel.tsx:112-131`）→ 工具闭包 → Rust `search_papers_db(paper_ids)` → SQL `paper_id IN (...)` 过滤（`database/search.rs:87-91`；`bm25.rs:169-173`）。没有独立"知识库"表，范围是查询时过滤。
- central 的 paperSearch 恒全库（`origin="central"`，`paper-search.ts:26-30`；`registry.ts:426-429`）。

### 5.6 图注 / citation【事实】

- 图注：`getFigures` 用正则扫 paper.md 的 `images/` 图片与 `Figure/Fig/Table/图/表 N` 图注段，回 alt→正文图注兜底、所在小节、游离图注计数（`paper-extras.ts:126-227`）；**无图级索引、无 caption embedding、无 bbox/页码**。
- 引用：`getCitations` 只解析 References 小节文本（`paper-extras.ts:49-123`）；检索结果用 `[chunk_id]` 做引用标注（rag*/paper* 各自返回 `citations + citation_guide`）；UI 侧 `buildCitationMap` 从工具结果重建 chunkId→来源（`components/markdown/citation-source.ts:3-66`）。
- **没有 citation graph**（仓库内无以引用关系为边的表/命令/工具）；Zotero/MCP 的外部能力不计入本盘点（待确认外部 MCP 是否补足）。

### 5.7 阅读位置桥（唯一的"跨书/论文统一读取"雏形）【事实】

- 前端渲染层把 foliate relocate 的原始位置写入活注册表（`components/side-chat/index.tsx:66-86`；paper 侧由 PaperReader 写）；transport 每轮取快照注入尾部（`custom-chat-transport.ts:57-75`）。
- Rust 换算：书 `resolve_reading_position`（spine href→mdbook md + 字符偏移 + 估算 chunk 区间），论文 `resolve_paper_position`（正文偏移→paper.md 偏移）（`position.rs:65-161`）；`read_position_window` 按字符窗口读 md（UTF-8 安全、窗口上限 10 万字符，:165-214）。
- 工具 `getReadingPosition` / `readAtReadingPosition` 两端共用同一实现（`reading-position.ts:24-130`）。这是最接近"通用 read(docRef, cursor)"的现有能力，可作为重构基座。

### 5.8 能力矩阵：哪些是通用原语、哪些是领域锚点【事实+推断】

| 能力 | 现状 | 判定 |
|---|---|---|
| 文档句柄（任意书/论文/文件） | 无：bookId/paperId 都塞进 `activeBookId`，工具闭包绑定，central 无法读任意书籍正文 | **通用原语缺失（P0）** |
| 统一 read（标题/偏移/行/chunk 任一选择器 + 统一 cursor） | 7 个工具、单位各异、续读字段各异 | **通用原语缺失（P0）** |
| outline/TOC（带稳定 id + 字符偏移） | 论文有 heading id/offset；书只有注入文本与标题模糊匹配 | **通用原语缺失（P0）** |
| 库级全文检索（跨书/跨论文/笔记） | 无；BM25 仅单库内、无 FTS5、无中文分词 | **通用原语缺失（P1）** |
| 统一 search 原语 | 4 套内部检索工具 + 2 套外部检索 | **通用原语缺失（P1）** |
| 媒体/图片读取 | 仅聊天附件可读；库内图片不可读 | **通用原语缺失（P1）** |
| 任意文件→Markdown 提取（PDF/DOCX/EPUB） | MarkItDown/OCR 只接在 UI 附件链路，未暴露成 Agent 工具 | **通用原语缺失（P1）** |
| 统一结果/引用 envelope | 每个工具自造 results/citations/citation_guide | **通用原语缺失（P2）** |
| 阅读位置锚点 + 按位置读 | 已统一书/论文，注入+工具同源 | **领域锚点（保留）** |
| 书章节号匹配（"5.8"→小节） | readBookSection 数字通道 + 父级退化 | **领域锚点（保留）** |
| 论文 heading/锚点读取 | getPaperToc + readPaperSection | **领域锚点（保留）** |
| 论文图注/参考文献提取 | getFigures/getCitations | **领域锚点（保留，可加 cursor）** |
| paperSearch 范围（文件夹/本篇/全库） | paperScopeIds 查询期过滤 | **领域锚点（保留）** |
| 库/笔记/标注/对话操作 | getBooks、notes/manageNotes、manage* | **领域锚点（应用数据不在工作区，必须保留）** |

---

## 6. 多模态链路

### 6.1 用户附件 → 模型【事实】

1. UI 添加图片时先做视觉闸：当前模型不支持图片则 toast 拒绝（`use-chat-state.ts:643-672`）。
2. 提交前图片 dataUrl 落盘 `attachments/`，消息里只留 `attachment://文件名`（`use-chat-state.ts:973-983`；`attachment-service.ts:53-58`）。
3. transport 请求期：
   - 非视觉模型 `stripFileParts` 剔除所有 file part（历史图片一并剔除）（`custom-chat-transport.ts:143-146`；`message-processor.ts:79-88`）。
   - 视觉模型：嗅探/修正存量 file part 的 mediaType（`custom-chat-transport.ts:148-170`；`utils/media-sniff.ts`）。
   - **图片一次性**：只有最后一条 user 消息的图片物化为 dataUrl 真发；更早轮次替换为文字存根"可用 readImage 重看"（`message-processor.ts:96-142`）。
4. 视觉能力判定：`modelSupportsVision(providerId, modelId)` 查静态 JSON 表（`providers/vision-map.ts:65-73`；表体 `providers/maps/vision-map.json`，支持远程热更新 `providers/maps/map-runtime.ts`）；未收录型号默认放行（设计取舍：误拦视觉模型是无声功能残废）。
5. 重新看图：`readImage(ref)` 从 `attachments/` 读回，返回 `{type:"content", value:[text, {type:"file", mediaType, url:dataUrl}]}`（`read-image.ts:10-40`）——**全仓唯一返回 file part 的工具**。

### 6.2 缺口【事实+推断】

1. **库内图片不可读**：`readImage` 只认 `attachment://`；`getFigures` 返回的 `images/fig.jpg` 与书籍 mdbook 图片路径都无法转成 file part。现有审计也确认"论文/书籍磁盘图片不在支持范围"（`docs/audits/agent-figure-and-cross-document-capabilities.md:11-17`）。
2. **论文图片路径在 Agent 结果中不可定位**：`images/…` 相对路径没有被 `resolveMarkdownImagePaths` 改写（原因见 4.6），而工作区外的绝对路径读取需确认卡；模型只能"知道有这张图"。
3. **无图级索引**：图注文本散在正文 chunk 里，`getFigures` 每次现扫 paper.md；不能按图注语义检索、不能跨文献找图。
4. **无文档提取原语**：PDF/DOCX/EPUB 的 MarkItDown 转换与扫描件 OCR 只在 UI 附件管线（`use-chat-state.ts:710-847`），Agent 没有"把这个本地文件转成 Markdown 再读"的工具；`readLocalFile` 只读文本。
5. **"看图"入口名称误导**：`readImage` 实际是"附件回看"，与"读取库内图片"不是一回事；未来若加 `readFigure` 需先统一命名/资源句柄。
6. **视觉判定是型号枚举**：未收录模型默认放行，纯文本新模型会收到一次 API 报错（已知取舍，非 bug）；远程热更新依赖 `services/model-maps-service`（待确认启动时机）。

---

## 7. 结论

### 7.1 (a) 重复 / 可合并的工具【事实+推断】

| 合并族 | 现有工具 | 重复点 | 建议 |
|---|---|---|---|
| 检索 | ragSearch、paperSearch、searchDevDocs、askAppHelp（+ webSearch/sciverseSearch 外部） | 4 套内部混合检索，结果/引用排版各自实现 | 1 个 `search(query, target)`，target = 当前书 / 论文库 / wiki / 手册 / 工作区 / 网络；后端仍是现有 Rust 命令，仅统一入口与返回 |
| 上下文扩展 | ragContext、paperContext | 算法/输出结构几乎逐字相同，仅 command 不同 | 1 个 `expand(chunkIds, before, after)` |
| 按锚点读取 | readBookSection、ragToc、ragRange、readPaperSection、readPaperFull、readAtReadingPosition、readLocalFile | 7 种"读"、4 种游标单位、4 种续读字段名 | 1 个 `read(docRef, selector, cursor, maxChars)`，selector = heading / position / charOffset / line / chunkRange / all |
| TOC/大纲 | getPaperToc、ragToc、注入目录 | 三处目录，书中无独立 outline 工具 | 1 个 `outline(docRef)`；注入目录只是它的静态缓存投影 |
| 图注/引用 | getFigures、getCitations | 同一 paper.md 的两套正则解析 | 可合并为 `extract(docRef, kind: figures\|references\|tables)` 并补 cursor/分页；若保留独立工具，至少统一返回 envelope |
| 笔记 | notes、manageNotes、exportNotes | 概念名相近、数据源不同（book_notes vs notes） | 不必合并；在提示词/描述里固定术语："标注=notes，长文=manageNotes" |
| 对话 | readThread、manageThreads(list/search/export) | readThread 是 manageThreads 的"读全文"特例 | 可纳入统一 thread 子资源，但保留 readThread 的便捷性 |

### 7.2 (b) 缺失的通用原语【推断】

| 优先级 | 原语 | 现状缺口 | 最小实现建议 |
|---|---|---|---|
| P0 | **DocRef**：`{kind: book\|paper\|file\|thread, id, path, format}` + resolve/list | activeBookId 同时当 bookId/paperId；central 无法读任意书籍/论文正文 | 在 registry 层引入 docRef 参数；复用 `getBooks` 解析；工具闭包只在"当前文档"场景作默认值 |
| P0 | **read(docRef, selector, cursor)** | 7 个读取工具、单位各异；书两套文本层 | selector 至少支持 heading / charOffset / line / chunkRange；书侧先基于位置桥的 mdbook 文本层，heading 用 outline 映射到文件+偏移；统一返回 `{text, anchors, truncated, nextCursor}` |
| P0 | **outline(docRef)**：稳定节点 id + 标题 + 层级 + 字符偏移/章节号 | 论文已有 heading id；书只有注入文本/标题模糊匹配；chunk 无锚点 | 论文直接复用 parsePaperSections；书用 nav.md 层次 + mdbook 文件偏移建立映射，或给 readBookSection 的匹配结果补 charOffset |
| P1 | **search(query, target, mode)** + 库级全文索引 | 无 FTS5/中文分词；BM25 只单库、LIKE 扫表；跨书检索缺失 | 先统一工具入口（不改索引），再评估 FTS5/独立倒排索引；CJK 需 jieba 或 ngram |
| P1 | **readMedia(ref)**：图片/PDF 页等 → file part | readImage 只认附件；库图不可读 | 给 attachment/asset 统一 URI（`attachment://`、`book://{id}/images/...`），Rust 侧读字节返回 dataUrl，工具返回 file part |
| P1 | **extractDocument(path)**：PDF/DOCX/EPUB→Markdown | MarkItDown/OCR 只在 UI 附件链路 | 把现有 sidecar 调用暴露为工具（带输出落盘 + read 指引），复用 `use-chat-state.ts:710-847` 的判定逻辑 |
| P2 | **统一结果 envelope** | 每个工具自造 `results/citations/citation_guide/meta`；ragContext/ragRange 的 `lines` 构造后未返回（死代码，`rag-context.ts:95-105`、`rag-range.ts:112-139`、`rag-toc.ts:111-128`），而 `results[].content` 是全量 chunk | `{content, anchors, source, truncated, nextCursor}` + 引用元数据集中生成；删掉重复的 citation_guide 与死代码 |
| P2 | **统一分页/续读约定** | offset / startOffset / next_offset / chunk index 混用 | 全部改为 `cursor` 字符串或 `{offset, unit}`；移动端/大文档友好 |

### 7.3 (c) 只该保留的领域高效工具【推断】

- **阅读位置桥**（注入 + getReadingPosition + readAtReadingPosition）：书/论文已共用一套实现，是"快速、省 token 锚定当前内容"的最佳范式，保留并作为 read 原语的位置 selector 实现。
- **readBookSection**：EPUB TOC 原生标题 + 小节号相等/父级退化匹配，是书侧无法被通用 heading 匹配替代的领域逻辑；保留匹配器，输出可并入 read。
- **readPaperSection / getPaperToc**：paper.md heading/id/offset 解析已经足够薄；保留为 paper 的 outline/read 适配器。
- **getFigures / getCitations**：paper.md 结构固定，两个便宜、确定性的投影仍有价值（尤其 getFigures 的图注兜底与游离图注计数）；建议补分页 cursor 后保留。
- **paperSearch 的范围语义**（本篇/文件夹/全部）与 `[chunk_id]` 引用规范：属于产品级领域语义，保留在 search 的 target 配置里。
- **ragSearch 的"当前书 + 引用 chunk"**：作为 search 的 target=currentBook 预设保留，不必单独造工具。
- **getBooks / notes / manageNotes / exportNotes / manage***：应用数据在 app.db、不在 Agent 工作区，无法用通用文件原语替代，必须保留。
- **describeTool/useTool 目录牌**：已验证的 progressive disclosure 机制（`lazy-toolset.ts:6`），保留。

### 7.4 (d) 关键文件与行号索引【事实】

| 主题 | 文件:行 |
|---|---|
| 工具注册/组装/门控 | `packages/app/src/ai/tools/registry.ts:96-111,115-208,212-351,358-436` |
| 目录牌/惰性工具 | `packages/app/src/ai/tools/lazy-toolset.ts:14-31,55-84,91-197` |
| transport 全链路 | `packages/app/src/ai/custom-chat-transport.ts:143-275` |
| 提示词分层/注入/裁剪 | `packages/app/src/constants/prompt.ts:15-27,37-87,94-157,160-172,180-242`；`paper-prompt.ts:15-61,69-112,115-141`；`central-prompt.ts:9-73,79-110`；`agent-styles.ts:14-41`；`shared-policy.ts:8-14` |
| 历史预算/摘要/瘦身 | `ai/utils/message-selector.ts:5-12,112-163`；`ai/utils/tool-result-slimming.ts:29,57-65,100-140,193-285`；`services/conversation-summary-service.ts:24,146-183` |
| 阅读位置桥 | `services/reading-position/position-service.ts:37-69,165-179`；`ai/tools/reading-position.ts:24-130`；`src-tauri/.../position.rs:65-214` |
| RAG 工具 | `ai/tools/rag-search.ts:100`；`rag-context.ts:49`；`rag-range.ts:60`；`rag-toc.ts:47`；`ai/tools/rag-error.ts:3-17` |
| 论文工具 | `ai/tools/paper/paper-{toc,section,full,info,search,context,extras}.ts`；解析 `pages/paper-reader/markdown-sections.ts:51-124`、`paper-metadata.ts:14-60` |
| 书籍直读 | `ai/tools/read-book-section.ts:88-228`；`services/book-translation/book-translation-service.ts:154-168` |
| 向量/BM25/hybrid | `src-tauri/plugins/tauri-plugin-epub/src/database/{search,bm25,hybrid,connection}.rs`；分块 `text/chunker.rs:126-180`、`text/constants.rs:5-11` |
| 存储管线 | `src-tauri/plugins/tauri-plugin-epub/src/pipeline.rs:16-186,594-678,806-830`；`src-tauri/src/core/books/commands.rs:9-46,1381-1449`；`core/database.rs:21-24` |
| 多模态 | `services/attachment-service.ts:53-113`；`ai/utils/message-processor.ts:79-142`；`ai/providers/vision-map.ts:65-73`；`ai/tools/read-image.ts:10-40` |
| 安全守卫 | `ai/utils/tool-guard.ts:41-48,104-…`（manageNotes/create 恒确认 :214-243；MCP :120-146；importPaper :278-304；processPaper reparse :308-335） |
| 工作区/memory | `ai/utils/workspace-context.ts:14-56`；`src-tauri/src/core/agent_ws/commands.rs:10-22` |
| 既有相关审计 | `docs/audits/agent-figure-and-cross-document-capabilities.md`；`docs/audits/reading-position-and-chunks-audit.md`；`wiki/04-agent.md`、`wiki/05-papers-pipeline.md` |

### 7.5 若按"通用原语 + 领域锚点"重构的最小路径【推断】

1. **先立 DocRef + read/outline 两个原语**：复用 `read_position_window`、`get_chunks_by_range`、paper.md 读取与 `parsePaperSections`，不新建索引；把 7 个读取工具收敛为"read + 3 个领域 selector 适配器"。
2. **统一 search 入口**：ragSearch/paperSearch/searchDevDocs/askAppHelp 变成 `search` 的 target 预设；先统一返回 envelope 与引用元数据，索引层维持现状。
3. **补媒体读取与文档提取**：`readMedia(assetRef)`（库图/PDF 页→file part）+ `extractDocument(path)`（复用 MarkItDown/OCR sidecar）；这是当前能力断层里性价比最高的一块。
4. **最后再评估库级 FTS/跨书检索**（成本最高）：可先做 metadata+notes 的轻量倒排，再考虑 chunk 级跨库索引。
5. **保留领域锚点**：位置注入/书章节号/论文 heading/图注/引用/库操作/笔记；它们的语义无法从通用原语自动推导。

---

## 8. 待确认清单

1. `{appData}` 的 OS 实际路径与 bundle id（本轮未查 `tauri.conf.json` 的 identifier）。
2. epub2mdbook 产物的图片链接确切形态（`../Images/` vs 其他），以及聊天 Markdown 中 appData 相对图片路径是否会被渲染（UI 侧未验证）。
3. `metadata.md` 是否只在向量化时生成/更新（代码在每次 `process_epub_to_db` 都写；未索引书靠 `metadata.json` 回落）。
4. "全局向量能力为真但本书未索引"时，提示词与工具面错位是否在真实会话中造成可见问题（需运行时复现）。
5. `related_chapter_titles` 的生成规则对论文是否有小节信息可补（当前论文 chunk 恒为论文标题，`pipeline.rs:942-957`）。
6. 是否存在仓库外的 citation graph 能力（Zotero/MCP）；本仓库内无引用关系表/命令。
7. 书籍位置桥的 chunk 区间为比例估算，实际命中精度未实测。
8. MCP 工具数量对目录牌阈值（>30 个工具）的影响：用户连接多个 MCP 后 reader/paper 也可能进入目录牌模式（未逐一实测）。
