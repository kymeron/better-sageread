# Agent 的「读图 / 跨文献 / 任意位置读起」能力调研（2026-10-21）

> 用户提问（临时想到、不急着施工）：论文场景下模型能否自己找图并读图？能否跨文献展开上下文并读图表？能否从任意位置（如 TOC 锁定 5.8 节）直接召回该节全文？本文按当前代码盘点能力与缺口，给后续排期参考。

## 1. 现状能力矩阵

### 1.1 图片 / 图表

| 能力 | 工具 | 范围 | 现状 |
| --- | --- | --- | --- |
| 列图片清单（图注 + 所在小节 + 图片路径） | `getFigures` | **仅当前论文**（paper scope） | ✅ 存在；只返回文本（最多 50 条），**不能看图本身** |
| 看图片（多模态） | `readImage` | **仅聊天图片附件**（`attachment://`） | ✅ 存在；返回 file part 给多模态模型。论文/书籍磁盘里的图片**不在支持范围** |
| 图表浏览 UI | 论文阅读器「图表」tab（`paper-figures-tab.tsx`） | 当前论文 | ✅ 缩略图 + 图注 + 点击定位；**没有「把这张图交给 Agent 看」入口** |
| 图注/图片进向量库 | — | — | ❌ 无图级索引；向量化只切正文文本（图注文本可能混在正文块里，但图片文件本身不可检索） |
| 跨文献找图/读图 | — | — | ❌ 无工具、无索引 |

**结论**：模型目前**不能"自己找图并读图"**。它最多用 `getFigures` 看到「这篇论文有几张图、图注是什么、在哪个小节、图片路径是什么」，然后去读图注附近正文；真正"看"图片只发生在用户把图片拖进聊天（存成 `attachment://`）之后。

### 1.2 跨文献上下文

| 能力 | 工具 | 范围 | 现状 |
| --- | --- | --- | --- |
| 跨论文语义检索 | `paperSearch` | paper scope：用户在面板选的范围（本篇/文件夹/全部）；central：全库 | ✅ 返回 chunk + 论文标题 + `md_file_path` + 全局索引 |
| 命中块前后文扩展 | `paperContext` | **仅同一篇论文内**（工具描述明确"不会串到其他论文"） | ✅ 存在；`get_paper_chunk_context` 按 chunk 邻接扩窗 |
| 跨论文合并上下文 | — | — | ❌ 无"一次取多篇命中块上下文"的工具；只能多次 `paperSearch` + 各自 `paperContext` 再拼 |
| 书籍交叉检索/读取 | — | 全部 RAG 工具限定当前书 | ❌ 无跨书检索；每本书独立向量库 |
| 中央助手读论文正文 | — | central 只有 `paperSearch`/`paperContext` | ❌ 中央助手能检索任意论文，但**没有** `getPaperToc/readPaperSection/readPaperFull`（这些只在 paper scope，且只看当前论文） |

### 1.3 任意位置读起

| 场景 | 工具 | 现状 |
| --- | --- | --- |
| 书：按标题/小节号读 | `readBookSection` | ✅ 标题精确/前缀/包含匹配；**小节号通道**（"5.8" 数字相等优先，找不到退化父级号）：模型从目录锁定 5.8 后可直接读全文，超长用 `startOffset` 续读 |
| 书：按章节标题取全章块 | `ragToc` | ✅ 章节标题取整章分块；代码里对小节标题做了起点切块处理 |
| 书：按全局分块范围读 | `ragRange` | ✅ 可跨章节连续读，按全局索引 |
| 书：从当前阅读位置读 | `readAtReadingPosition` | ✅ before/after 扩窗 + next_offset 续读（阅读位置桥 2026-10-20 落地） |
| 论文：TOC → 按标题读小节 | `getPaperToc` + `readPaperSection` | ✅ 标题文本或锚点 id，大小写/部分匹配；默认 3.2 万字符，`offset` 续读 |
| 论文：通读全文 | `readPaperFull` | ✅ 5 万字符默认、`offset` 续读 |
| 论文：从当前阅读位置读 | `readAtReadingPosition` | ✅ |
| 跨文献：从某篇 5.8 节读起 | — | ⚠️ 无直接工具。可绕：`paperSearch` 命中该篇 → 拿 `md_file_path` → `readLocalFile` 按行读（需知道行号，或先 `searchFiles` grep 标题），体验差且依赖工作区外读取确认 |
| 跨文献：按标题直接读任意论文 | — | ❌ 无 `paper_id + heading` 形态的工具 |

**结论**：**单篇内"TOC → 5.8 节全文"完全支持**（书侧更成熟，有数字匹配；论文侧靠标题文本/锚点匹配）。跨文献"打开某某论文的 5.8 节"目前没有顺手工具。

## 2. 缺口与建议（按优先级，未排期）

### P0（小改动，立刻能用）
1. **图表 tab →「问 Agent 这张图」**：把论文里的图片走附件管线落成 `attachment://` 再注入聊天，模型即可用 `readImage` 看图。复用现有附件基建（`attachment-service` + 消息 file part），改动主要在 paper-reader 图表 tab 与发送链路。
2. **中央助手补论文正文工具**：给 central 暴露带 `paper_id` 参数的 `readPaperSection/readPaperFull/getPaperToc/getFigures`（当前 central 只能检索不能"打开任意论文某节"）。

### P1（图能力闭环）
3. **图级索引**：论文向量化时抽取图表条目（图注文本 + 所在小节 + 图片绝对路径 + 图号），图注走 embedding 入库（独立表/独立向量域）；新增 `searchFigures`（跨文献、范围同 paperSearch，返回论文+图号+图注+相似度）。
4. **读图工具扩展**：`readFigure(figure_id)` 把图转成 file part（dataUrl/压缩/尺寸上限）；`readImage` 支持 `attachment://` 之外的库内图片路径。
5. **跨文献上下文**：`paperContext` 支持一次传多个 chunk（跨论文）并按篇分组返回；后端 `get_paper_chunk_context` 放宽跨论文邻接或工具层批量聚合。
6. **跨文献定位**：新增 `readPaperSectionAt(paper_id, heading)` 或让 central 的 paper 工具带 paper_id，解决"从某篇 5.8 节读起"。

### P2（成本较高，后议）
7. **跨书检索/读取**：当前一书一库，没有全局书库索引；需要统一向量库/检索层，成本大。
8. **图片 bbox/点击定位**：paper.md 无坐标信息；若要"定位到图并滚动过去"，可复用阅读器图表 tab 的 locate 能力（按图注块锚点），不必引入 bbox。

## 3. 成本/风险提示

- 多模态读图有 token 成本（一张图约数百到数千 token），必须按需读、限制张数与尺寸，并避免一轮塞多图。
- 图注检索命中后仍需回读正文确认上下文（避免只凭图注编造结论）。
- 引用规范：图引用需带「论文标题 + 图号」；跨文献图检索结果要标注来源论文。
- 书籍 EPUB 图片同理（mdbook 转换后图片在书目录内），可后续复用同一图索引方案。

## 4. 相关代码位置

- 工具注册与 scope 组装：`packages/app/src/ai/tools/registry.ts`
- 图片工具：`ai/tools/read-image.ts`、`ai/tools/paper/paper-extras.ts`（getFigures）
- 论文工具：`ai/tools/paper/paper-{toc,section,full,context,search}.ts`
- 书工具：`ai/tools/read-book-section.ts`、`rag-{search,toc,context,range}.ts`、`reading-position.ts`
- 论文图表 UI：`pages/paper-reader/paper-figures-tab.tsx`（提取逻辑在 `paper-blocks.ts`）
- 附件管线：`services/attachment-service.ts`、`ai/utils/message-processor.ts`
