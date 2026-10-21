# SageRead Agent 体系对标调研：从「场景工具拼装」到「通用原语 + 领域锚点」

> 日期：2026-10-21 · 状态：调研报告（未改代码）· 调研对象：DeepSeek Harness 0.2.1-rc.2（本机安装包，源码级核实）、Claude Code / OpenAI Codex CLI / Gemini CLI 等主流编码 Agent（公开资料，见 §3）。
> 触发问题：阅读器 Agent 工作区共用，书籍/论文原文与图片散落各处，现在不断为它们「牵线搭桥」（readContent、viewImage、按 scope 各来一套）。用户希望 Agent 既通用灵活、又在图书/论文场景里快速省 token 地锚定内容，问：**前沿通用 Agent 到底是怎么设计的？我们能借鉴什么？**

---

## 0. TL;DR

1. **你的直觉是对的：前沿 Agent 不为每个领域写一套场景工具。** Claude Code 官方工具表 46 项里近一半是会话/团队/管理类，真正做事的是「读、写/改、执行、搜、联网、计划、子代理」；OpenAI Codex CLI 内置约 20 个工具，**根本没有 read_file/list_dir/grep**——读取靠 shell（rg/cat/sed）+ apply_patch；Gemini CLI 约 20 个；Aider 甚至 0 个工具 schema，用 repo map + edit format 替代。领域知识一律走「约定文件（CLAUDE.md/AGENTS.md/GEMINI.md/.cursor/rules）+ 技能（SKILL.md 渐进披露）+ 子代理/脚本/MCP」。
2. **图片/PDF 的主流做法是「通用读文件工具返回视觉内容块」，不是场景工具。** Claude Code 的 Read 原生读图片/PDF（大图自动缩放重压缩，PDF 按页渲染）并直接给模型看像素；Codex 的 view_image(path) 返回 data URL 图片块；Gemini 的 read_file 返回多模态 Part（文本/图片/音频/PDF）；Cursor 的 Read files 支持图片且把 Browser 截图直接并入读文件工具。**没有一家先转成文字描述再让模型猜。** DeepSeek Harness 的 read_image 同构：本地路径 → 文本信封 + 图片块，按模型 image input 能力门控、自动降采样。SageRead 缺的是「本地路径入口 + 视觉门控 + 预算」，不是更多工具。
3. **编码 Agent 与阅读 Agent 的差异在「结构」与「闭环」**：代码库有命名结构（grep 即可当索引）、编译器/测试（ground truth）、git（变更上下文）；平铺的文献库没有。因此领域层需要补的不是一堆工具，而是**两类锚点**：语义检索（跨文档模糊定位）与结构/位置锚点（TOC、阅读位置、图注、引用关系），并且要用**锚点 URI 统一表达**（book:/paper:/chunk:/figure:/cite:）。Aider 的 repo map（tree-sitter 抽符号 + 依赖图排序，默认只花 1k token）是「把结构索引放进上下文预算」的最佳类比——SageRead 的「带位置的目录/章节摘要」就是它的对应物。
4. **工具爆炸是显学，且有量化数据**：Anthropic 实测 5 个 MCP server、58 个工具 ≈ 55k token（内部见过 134k）；Tool Search 把上下文从 77k 降到 8.7k（-85%）的同时，Opus 4 准确率 49%→74%、Opus 4.5 79.5%→88.1%。Codex 用 BM25 tool_search + code_mode；Gemini 的 deny 规则直接把工具从上下文移除；Claude 在 POSIX 主动移除 Glob/Grep 交给 shell。**SageRead central 38–41 个工具恒进目录牌，说明工具面本身需要收敛。**
5. **2026-05 的「Is Grep All You Need?」给了一个反直觉但重要的实证**：116 题 LongMemEval-S、4 种 harness × 5 个模型，**inline 模式下 grep 在每个组合都高于向量检索**；但同一模型换 harness 的差距 ≈ 换检索器，且 file-based 投递会把排序打乱（Codex/GPT-5.4 从 93.1% 跌到 55.2%）。含义：默认 inline 词法/精确检索 + 语义作为可选工具；**结果投递方式是一等设计变量**，本地小模型尤其不应默认文件投递。
6. **SageRead 现状的问题不是「工具多」本身，而是「按场景复制 + 提示词手工罗列 + 门控散落」**：≈58 个定义、central 38–41、reader 20–24、paper 27；7 套按锚点读取、4 套内部检索、2 套上下文扩展、3 套 TOC；书还有两套文本层（EPUB DOM vs mdbook）；无 DocRef；无 FTS5/跨库检索；库内图片不可读；提示词按全局向量能力宣称 RAG 可用而工具按「本书已索引」门控，存在错位。
7. **建议目标架构**：L1 四原语（outline / search / read / view，其中 view 可由 read 按文件类型分派）+ L2 领域锚点层（DocRef + 锚点 URI + search_library / read_document / get_reading_position / list_figures / get_citations）+ L3 约定与提示层（文献库地图、工具 guidance 单一来源、技能）。角色差异 = 可见性 + 上下文，不复制实现。
8. **路线**：P0（0.5–1 天）本地路径 read_image、getFigures 绝对路径、库地图注入、shared guidance 单源、兼容包装；P1（2–4 天）DocRef + outline/read/search 收敛、统一结果 envelope、删死代码、图注索引；P2 子代理/引用图谱/技能/批量。
9. **验收**：30–50 题真实任务评测（准确率、步数、token、工具错误率、引用可定位率）+ prompt 缓存不退化 + 旧工具回归；每角色可见工具数 ≤14。

---

## 1. 现状基线：SageRead 的 Agent 工具面

> 详细逐项清单见配套盘点：docs/audits/research/sageread-agent-inventory.md（432 行，含文件:行号）。

### 1.1 数量与分布（源码统计）

registry 静态注册 + 工厂动态创建：

| 层 | 每轮可见工具数 | 构成 |
|---|---|---|
| central（全局助手） | 38–41 | shared 15 + central 23 + readThread 1 + paperSearch/paperContext 2（有向量能力时） |
| reader（阅读助手） | 20–24 | shared 15 + readThread 1 + 动态 4–8（ragSearch/ragToc/ragContext/ragRange 需「有向量能力且本书已索引」；readBookSection、getReadingPosition、readAtReadingPosition、manageNotes 常驻） |
| paper（论文助手） | 27 | shared 15 + readThread 1 + 动态 11（getPaperToc、readPaperSection、readPaperFull、getPaperInfo、getCitations、getFigures、getReadingPosition、readAtReadingPosition、manageNotes、paperSearch/paperContext） |
| 静态定义合计 | ≈58 | shared 15 + central 23 + reader/paper 工厂 8/11 + 条件工具 |

**central 恒超 30 个工具，目录牌模式必然触发**（ai/tools/lazy-toolset.ts：>30 个或 schema >12k 字符 → describeTool/useTool + 目录牌）。这是对工具面膨胀的补丁，不是架构解。

### 1.2 结构性症状

1. **同一件事长出多套平行实现**：按锚点读取 7 套（readBookSection 标题/小节号、ragToc 章节标题→chunk、ragRange 全局 chunk 索引、readAtReadingPosition 字符偏移、readPaperSection 标题/id、readPaperFull 全文 offset、readLocalFile 行号），续读字段 offset/startOffset/next_offset/chunk index 混用；上下文扩展 2 套（ragContext≈paperContext 逐字重复）；内部检索 4 套（ragSearch/paperSearch/searchDevDocs/askAppHelp，后端都是「BM25+向量+自造引用排版」）；TOC/大纲 3 处（注入目录、getPaperToc、ragToc），书籍侧没有独立 outline 工具。
2. **缺统一的文档句柄（DocRef）**：activeBookId 同时当 bookId 与 paperId 用，工具靠闭包绑定当前文档；central 能检索任意论文，却不能「打开任意书籍/论文的某一节」读正文。
3. **一本书有两套文本层**：readBookSection 走 EPUB DOM（foliate，公式/表格转结构化文本）；rag*/位置桥走 mdbook Markdown。两套的章节单位与坐标不同（spine+CFI vs mdbook 文件+字符偏移），靠标题模糊匹配/比例估算桥接——这是「统一 read/outline」最大的结构障碍。
4. **索引层弱**：没有 FTS5；BM25 用 LOWER(chunk_text) LIKE 逐词扫全表并在 Rust 里算 tf/df/idf，中文无分词；论文 chunk 不携带小节标题（related_chapter_titles 恒为论文标题），跨工具锚点只能靠标题文本。
5. **提示词与工具注册表双维护**：三份 scope prompt 手写工具用法（每段约 2–3k 字）；getToolDescriptions() 已无调用方（死代码）；能力门控散落在 getToolsForScope。
6. **门控口径错位**：提示词按全局 hasVectorCapability 宣称「RAG 已启用」，但 rag* 还要求「本书已索引」——未索引时会话里根本没有 ragSearch；论文侧 paperSearch 又无单篇索引门控，未索引时静默返回空。
7. **多模态闭环缺口**：readImage 只接受 attachment://（聊天附件）；getFigures 只回图注与相对路径并明说「不能看图」；readLocalFile 走 Rust agent_read_file（UTF-8 lossy、按行、8MB），图片只会变成乱码文本。
8. **图片路径在 Agent 结果里不可执行**：论文 paper.md 写 images/xxx.jpg，resolveMarkdownImagePaths 只处理 ./ 与 ../，不改写裸相对路径；书籍 mdbook 图片经改写后是 appData 相对路径（rag-range 例外未转）。模型知道有图，但无法直接定位读取。
9. **工具描述冗长、用法塞进 prompt**：description 写大量「什么时候别用/注意事项」，prompt 再写一遍编排策略；每个工具还强制 reasoning 参数（schema 固定开销 + 每调用 token，属流程仪式）。
10. **工具结果/引用 envelope 各自为政**：每个工具自造 results/citations/citation_guide/meta，部分字段构造后未返回（死代码）；无统一 cursor/续读约定。

---

## 2. 实地解剖：DeepSeek Harness 的工具体系（源码级证据）

> 证据来源：本机安装包 `F:\ProgramFiles\deepseek harness\resources\app.asar`（Electron asar，虚拟路径可读）内 `dsh/node_modules/@deepseek-ai/*` 的包 README 与 `dsh-base/cordis.patch.yml`。Harness 版本 0.2.1-rc.2。

### 2.1 组合式插件：每个原语一个包，没有"场景包"

Harness 的工具不是一个大注册表，而是**每个能力一个可组合插件**。base 组合（`dsh-base/cordis.patch.yml`）里模型可用的工具行只有这些：

| 包 | 提供的工具 | 说明 |
|---|---|---|
| `dsh-tool-fs` | `read`、`read_image`、`write`、`edit` | 文件系统原语；`read_image` 依赖附件服务与图片输入路由 |
| `dsh-tool-fs-search` | `glob`、`grep` | 直接 spawn 打包的 ripgrep，**不依赖预建索引** |
| `dsh-tool-bash` / `dsh-tool-pwsh` | `bash` / `pwsh` | 按平台二选一；shell 是通用逃生口 |
| `dsh-tool-jobs` | `job_list/job_output/job_kill` | 后台任务 |
| `dsh-tool-web` | `web_search`、`web_fetch` | 网络 |
| `dsh-tool-skill` | `skill` | 技能目录 + 按需加载 |
| `dsh-tool-subagent`（两个工具名） | `subagent`、`subagent_fork`；`list_agents/send_message/interrupt_agent/wait_agent` | 子代理与编排 |
| `dsh-tool-todo` / `dsh-tool-goal` / `dsh-tool-workflow` | 任务清单/目标/工作流 | 流程编排 |
| `dsh-tool-present` / `dsh-tool-workspace-dependencies` / `dsh-tool-working-directory` | 交付物/环境/工作目录 | 宿主能力 |
| `dsh-tools`（PTC 模式可选） | `run_code` | 把上述工具变成代码 SDK，一个元工具替代全部 schema |

**没有** `read_paper_section`、`get_figures`、`search_documents` 这类领域工具——Harness 是通用编码/工作 Agent，领域=用户的项目目录。项目的领域知识通过 `AGENTS.md`、skills、脚本、MCP 进入，而不是硬编码工具。

### 2.2 `read_image`：通用原语，不是场景工具（关键实证）

`dsh-tool-fs/lib/index.js` 中注册的模型可见描述只有一句：

> "Read a PNG/JPEG/WebP/GIF file and return the image itself. Large images are downscaled automatically; do not install image libraries or create thumbnails to inspect an image."

参数只有 `file_path`（"Path to the image file, resolved by the filesystem backend."）。行为要点（同包 README）：

- 接受 PNG/JPEG/WebP/GIF；**无扩展名文件按文件签名嗅探**；解码由附件服务兜底校验。
- 读取后**持久化为附件**（不可变对象），并在「下一次模型请求前」做规范化/降采样（模型无需自己生成缩略图）。
- **严格路由门控**：解析当前会话实际路由（provider/model），要求其声明 `inputModalities` 含 `image`；否则报错：
  `cannot read "<path>" as an image: model "<model>" does not declare image input; switch to an image-capable model to read images`。
- 输出是**两段内容**：文本信封 + 图片块。信封形如：

```text
<path>{canonical absolute path}</path>
<type>image</type>
<content>
image/jpeg image, 1200x800 px, 180000 bytes (downscaled from 2400x1600 px; multiply x coordinates by 2 and y coordinates by 2 to locate features in the original file)
</content>
```

- 部署限制（字节/尺寸/像素/消息内总量）由附件服务统一执行；超限报错并**给出恢复指令**（"downscale the image and read the smaller copy"）。

**设计含义**：图片"能不能看"由**模态通道 + 路由能力**决定；工具只负责"按路径取一张图"。这一条直接回答了上一轮的问题：SageRead 缺的不是"更多工具"，而是把 `readImage` 的入口从 `attachment://` 扩展到本地路径，并接上同样的门控/降采样。

### 2.3 文件 + shell 是通用接口；领域知识放在"约定文件"

- **`AGENTS.md`/`CLAUDE.md` 指令链**：`dsh-agent-instructions` 在首次请求注入用户全局（`$DSH_HOME/AGENTS.md`、`~/.agents/AGENTS.md`）+ 项目从根到 cwd 的指令链；`maxBytes: 65536` 预算，**越宽泛越先省略、最具体最后截断**；内容按 digest 去重（`AGENTS.md` 与 `CLAUDE.md` 相同只渲染一次）；作为持久 user 消息进入历史，可压缩/回放。读取到更深目录后自动发现新的嵌套指令。
- **Skills（渐进披露）**：`SKILL.md`（YAML frontmatter：name/description/whenToUse…）放在项目/用户 skill 根目录；首次请求只注入**目录**（名字 + 有长度上限的描述），模型需要时调 `skill` 工具加载**完整正文** + 资源路径。工具包说明里明确：单个 SKILL.md 渲染后控制在 8192 字符阈值内，超过会被工具结果修剪器裁剪。这就是"领域 SOP"的承载方式——**不是工具**。
- **`@file` 引用**：UI 提供路径补全，但"选中候选绝不读取或附带文件内容；模型必须调用文件系统工具才能查看文件"——减少"引用即注入"的隐式成本。
- **外部能力**：MCP server 发现工具后直接 `ctx.tools.register()`，工具 schema 自动流入提示词组装；写/执行类经 `tools/pre-execute` 策略流水线。

### 2.4 可见性与角色：restrict/preset，不是复制实现

- `ctx.tools.register(defineTool({...}))` 注册；`ctx.tools.restrict(filter)` 对单个 agent 应用允许/拒绝掩码（可叠加取交集），**作用域注册保持可见，限制在 dispose 时解除**；`ctx.tools.get(name, scope)` 按作用域视角解析工具。
- **工具包自己贡献 prompting guidance**，组装时用 `ctx.tools.get(name, scope)` 检查"这个工具在此 agent 是否可见"，仅在可见时输出对应段落（如 `Use the read tool — not shell commands like cat — to inspect text files.`；grep 段落还会在 read 可见时才说"用 read 看匹配文件上下文"）。
- **agent preset**（`dsh-agent-preset`）：用普通 YAML 声明一个 agent 的子插件列表，多个 preset 由会话选择；Web 端"按 agent preset 组合 web 工具"。**角色 = 插件组合 + 可见性 + 上下文，不是复制一套实现**。
- `mode` 可配 `native`（逐工具 schema）或 `ptc`（只暴露 `run_code` + 生成 SDK）；单个 agent 可用 `presentAs` 覆盖。

### 2.5 上下文与成本工程（"够用就好"的硬约束）

| 机制 | 参数/行为 | 目的 |
|---|---|---|
| `read` 上限 | 默认/最大 2000 行、单行 2000 字符、单次 51200 字节；≥10MB 流式读 | 结果有界、可分页续读 |
| `grep`/`glob` 上限 | 250 条匹配 / 100 条路径；超出写 spill 文件并返回 locator | 不把大结果塞上下文 |
| tool result pruner | 阈值 8192 字符，保留 head 4096 + tail 1024 | 压缩旧工具结果 |
| spill | 超限结果完整保存，模型按 locator 再取 | 可恢复的有界输出 |
| 图片 offload | 图片预算超限时，旧的图片出现位置永久替换为"占位文本 + 只读路径"，重试 | 图片密集会话可继续 |
| repeat-tool-reminder | 同一工具连续重复 3/5/8 次时提醒 | 抑制打转 |
| compaction | 摘要压缩 | 长会话 |

这些不是"锦上添花"，而是通用 Agent 能在长任务里保持低成本的原因。SageRead 已有部分类似机制（tool-result-slimming、token-estimator），但缺少 read_image 的图片预算/offload 与统一的 spill 语义。

### 2.6 PTC / `run_code`：工具即 SDK（前沿但非默认）

`dsh-tools` 的 `mode: ptc` 会只保留一个 `run_code` 工具，把每个工具生成为 TypeScript SDK 声明（`tools.read(...)`、`tools.grep(...)`），模型写一段程序**批量/条件式调用**工具；中间绑定值只存在于执行局部，只有外层 `run_code` 结果有硬上限；成功且含图片的子调用结果会成为延后的 user-message 上下文。Harness 的默认仍是 `native`——PTC 用于工具多、输出大、需要循环组合的场景，不是"更优雅所以默认"。

对 SageRead 的启示：**不要现在上 PTC**；但"跨 200 篇论文批量提取字段"这类需求迟早需要，先用子代理 + 批量检索 API 过渡。

### 2.7 安全边界：workspace 是显式的

`dsh-base` 默认：`sandbox-policy.workspaceRoot = process.cwd()`，`mode = workspace-write`，`approval = ask`；preset 三档 `read-only / workspace-write / danger-full-access`。`write/edit` 与 shell 在界外写入会带 `sandbox_permissions` + `justification` 请求一次升级；读文件与读图由 `ctx.fs` 决定路径授权（SageRead 已有 `tool-guard` 对应这套分层）。**关键差异**：Harness 让 Session 的 cwd 就是"工作区"，所以工具天然对项目文件生效；SageRead 的库在 appData，工作区另有其地，导致"领域内容"永远在界外，只能靠专用工具桥接——这是架构层面最值得借鉴的一点（见 §5.1）。

---

---

## 3. 主流编码 Agent 对照（2026-10-21 快照）

> 详细逐家清单与源码链接见配套笔记：docs/audits/research/coding-agent-tool-inventories.md（38KB，事实/推断分级）。

| Agent | 工具面（口径） | 读图/PDF | 项目知识注入 | 大仓定位策略 | 工具爆炸对策 |
|---|---|---|---|---|---|
| Claude Code | 官方表 46 项（含会话/团队/管理类；核心约 15） | **Read 原生读图/PDF/notebook**：图片→视觉块并缩放重压缩，>128MB 拒绝；PDF 按 pages 用 pdftoppm 渲染 | CLAUDE.md/AGENTS.md + auto memory + Skills（正文按需加载）+ Subagents + Hooks + MCP | Glob/Grep 在 POSIX **默认移除**交 shell（bfs/ugrep）；LSP；子代理隔离；offset/limit/25k token 范围读 | ToolSearch、Workflow、子代理、MCP 延迟加载 |
| OpenAI Codex CLI | 源码级 ~20 个；核心 shell+apply_patch+view_image+update_plan+web_search | **view_image(path)→data URL 图片块**（detail=high/original，统一 image budget） | AGENTS.md（根+祖先自动注入，嵌套优先）+ Skills + Hooks + MCP | **无 read_file/list_dir/grep**：exec_command + rg/rg --files，multi_tool_use.parallel 并行读 | tool_search（BM25 延迟工具）、code_mode（JS 编排）、命名空间 |
| Gemini CLI | 官方 ~20 个 | **read_file 返回多模态 Part**（文本/图片/音频/PDF） | GEMINI.md 三级（全局→workspace/父目录→JIT 工具触达时加载）+ Skills + Memory 直改文件 | glob/grep_search（git grep 快路径）/@ 批量读；offset/limit 截断提示 | deny 规则从上下文移除工具；sandbox/trusted folders |
| Cursor | 约 12 类（官方页） | **Read files 支持图片**；Browser 截图「直接并入读文件工具」 | .cursor/rules 四类 + AGENTS.md + Skills + Subagents + Hooks + MCP | Instant Grep 本地正则索引（不上传、不存 embedding）+ Explore 子代理 | 子代理、Checkpoints、MCP 预算 |
| Aider | **0 个工具 schema** | /add 图片进 chat | conventions/配置 | **repo map**：tree-sitter 抽符号 + 依赖图排序，默认 1k tokens、随对话伸缩 | 用上下文工程替代工具 |
| OpenHands / Devin | 20+ 模块 / 未公开 | Browser/Computer Use 截图；Devin 视觉看屏 | OpenHands Skills/Presets；Devin AGENTS.md 16KiB + Skills + Memory + DeepWiki 索引 | 搜索 + 索引 + 子代理/任务集 | 工具集/preset、子代理、MCP |
| DeepSeek Harness | base 组合约 15 个工具插件；PTC 模式只有 1 个 run_code + 生成 SDK | **read_image 原语**：本地路径→文本信封+图片块，路由能力门控、降采样 | AGENTS.md 指令链（64KB 预算）+ SKILL.md 技能 + 子代理/团队 | glob/grep 直接跑 ripgrep（无预建索引）+ shell；子代理隔离 | 插件组合 + 作用域 restrict + PTC/run_code |

**关键结论**

1. **没有先例为「图书/论文」这类内容领域写专用读取工具**。主流系统的领域能力来自约定文件、技能、索引（repo map/DeepWiki/Instant Grep）与 shell，而不是 readBookSection/getPaperToc 这类并列工具。
2. **多模态走「通用读文件 → 视觉块」**：Claude/Codex/Gemini/Cursor/DSH 五家一致；区别只在「并入 Read」还是「独立 view_image」——两者都比 SageRead 现状（getFigures 只给路径、readImage 只认 attachment://）少一层断桥。
3. **工具面在收敛**：Codex 干脆不提供 read_file/grep；Claude 在 POSIX 主动移除 Glob/Grep；Aider 用 repo map 取代工具；Gemini 用 deny 把工具移出上下文。**「场景工具」不是主路径。**
4. **大仓低成本定位的配方**：grep 优先 + 结构索引（repo map / LSP / Instant Grep / DeepWiki）+ 子代理隔离 + 范围化读取（offset/limit/pages/token 预算）。平铺文献库缺的是「结构索引」这一层，而不是缺工具。
5. **工具爆炸的工程解法**：tool search/deferred loading（Claude/Codex）、code mode（Codex/Claude）、命名空间、deny 隐藏、精简描述；Anthropic 的量化数据见 §4。
6. **项目知识三层**：自动注入的短约定（AGENTS.md/CLAUDE.md/GEMINI.md）→ 按需技能（SKILL.md）→ 隔离探索（subagents）；没有一层需要新增工具。

---

## 4. 原则提炼：什么该做成工具，什么不该

### 4.1 工具设计五原则（Anthropic 官方，2025-09）

来源：[Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)。

1. **选对工具，别只包装 API**：list_contacts 让模型逐条读完 → 应实现 search_contacts；用少量高影响工作流起步，再按评测扩展。
2. **命名空间**：按服务或资源分组；前缀 vs 后缀对评测有非平凡影响。
3. **返回有意义的上下文**：语义字段优先（name/image_url/file_type），避免裸 UUID；可提供 concise/detailed 两种返回（示例 206 → 72 token）。
4. **为 token 效率优化**：分页/范围/过滤/合理默认值；Claude Code 单次工具结果默认 ≤25k token；截断与错误要「教模型下一步」。
5. **工具描述本身就是提示词工程**：像给新同事写文档，写清边界、输入格式、与其他工具的区别、示例。

**评测驱动**：先原型 → 建评测 → 按真实多步任务迭代；指标不止正确率，还要工具调用数、总 token、单次耗时、错误率；把 transcripts 交给 Agent 批量重构工具与描述（Anthropic 称本文多数建议来自该循环）。反模式是「先全量返回，再让模型自己筛」。

### 4.2 上下文工程：最小高信号 token 集

来源：[Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（2025-09）、[Chroma Context Rot](https://research.trychroma.com/context-rot)（2025-07）、[Lost in the Middle](https://arxiv.org/abs/2307.03172)。

- 所有模型都有 **context rot**：输入越长越不准，且不是均匀退化（中段信息最难用）。目标是「最小的、高信号的 token 集合」。
- 系统提示词要「正确的高度」：不硬编码 if-else，也不空泛；工具/示例同理。
- 长任务三个杠杆：**压缩**（保留最近访问文件/锚点）、**结构化笔记**（NOTES/todo）、**子代理**（花数万 token 探索，只回 1–2k 摘要）。多智能体在内部研究评测上高 90.2%，但 token 约 15×——不是默认选项。

### 4.3 检索与投递：grep 的实证与「投递方式」变量

来源：[Is Grep All You Need?](https://arxiv.org/abs/2605.15184)（2026-05-14）。

- 116 题 LongMemEval-S、4 harness × 5 模型：**inline 模式下 grep 在每个 harness×模型组合都优于向量检索**（最大差 86.2% vs 62.9%）。
- **harness 效应 ≈ 检索器效应**：同一 Opus 4.6，Chronos inline grep 93.1%，Claude Code 76.7%——系统提示、工具描述、命中渲染都在塑造搜索策略。
- **file-based 投递是压力测试**：programmatic 模式下 vector 在 5/10 组合反超 grep；Codex/GPT-5.4 的 programmatic grep 从 93.1% 崩到 55.2%。
- 实践含义：**默认 inline 词法/精确检索 + 语义检索作为可选工具**；把「结果怎么投递」当一等设计变量；本地小模型/弱 harness 不要默认文件投递。SageRead 的本地模型用户多，这一条权重很高。

### 4.4 渐进披露、代码调用与工具搜索

- **Skills**（Anthropic 2025-10，已开放标准）：启动只加载 name/description；相关时读 SKILL.md 正文；正文再按需引用 references/scripts/assets。三级披露，理论容量近无限。来源：[Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)、[agentskills.io](https://agentskills.io/)。
- **Code execution / 代码调用工具**：把工具定义生成成文件系统上的 typed API，中间结果留在代码里；官方示例 token 150,000 → 2,000（-98.7%）。来源：[Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)（2025-11）。PTC/tool search 已产品化（[Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)，2025-11）。
- **工具搜索的量化**：58 个 MCP 工具 ≈ 55k token（GitHub 35 个≈26k、Slack 11 个≈21k…）；内部见过 134k token；Tool Search 常驻 ~500 token + 按需 3k，总消耗 77k → 8.7k（-85%），准确率 Opus 4 49%→74%、Opus 4.5 79.5%→88.1%。MCP 规范建议按上下文 1%–5% 设阈值，catalog→inspect→execute 三层，并注意中途增删 tools 会击穿 prompt cache。
- **不要过度**：对「5 个工具的小系统」，tool search/PTC 是负收益；弱模型写代码+读回填的失败率可能高于直接调用（见 §4.3 反例）。

### 4.5 判断「该不该做专用工具」的 checklist

| 维度 | 高分信号 |
|---|---|
| 频次 | 每周多次、跨会话重复 |
| 通用性 | 用 L1 原语 + 2–3 步提示无法等价，或需要模型做领域推理（如「5.8 节」解析） |
| token/步数 | 相比原语组合省 ≥50% token 或 ≥2 次调用 |
| 确定性 | 要求严格输出/权限/顺序（如引用格式、范围过滤） |
| 可评测性 | 能写 10–20 道有标准答案的题，失败可归因 |
| 可恢复性 | 错误信息可操作、结果可重试 |
| 维护成本 | 复用现有索引/锚点，而非新建第二套数据 |
| 风险 | 不扩大写/外发/执行面，或已有权限模型 |

**决策规则**：≥3 个高分 → 做专用工具；能拆成 2 步原语 → 合并；只是知识/流程 → 写成 skill/提示；只是「语义模糊/规模大」→ 做索引，不做一堆工具。

### 4.6 三层设计模型与锚点 URI

- **L1 通用原语**：outline（地图/目录）、search（找位置，返回锚点+片段）、read（按锚点读窗口）、view（非文本→视觉块）、write/edit（可选）、exec（可选，仅在有沙箱时）。
- **L2 领域锚点**：统一 URI 表达地址（book:<id>/<md_path>#<heading>、paper:<id>#<heading>、chunk:<id>、figure:<paper_id>:<fig_no>、cite:<paper_id>:<ref_no>），解析器负责「人话→锚点」；保留少量返回 id/图注/引用边的锚点器（getFigures/getCitations），读内容交给 L1。
- **L3 约定与提示**：系统提示写「导航协议」（先 outline 后 read、单次读多少、何时停、引用格式、scope 边界、禁止全量 dump）；SKILL.md 承接「怎么做」（论文精读/综述/引用核查/章节摘要）；AGENTS.md 承接产品/项目约定；工具描述本身也是 L3。

### 4.7 代码库 vs 平铺文献库：哪些能照搬，哪些不能

| 维度 | 代码库（编码 Agent） | 文献库（SageRead） | 对 SageRead 的含义 |
|---|---|---|---|
| 结构 | 目录/模块/符号树，有明确架构 | 平铺 books/<id>/；有 TOC 但无稳定锚点 id | 需要 outline + 锚点 URI 充当「符号表」；书侧先统一 mdbook 文本层 |
| 检索 | grep 字面命中率高；语义检索只是补充 | 术语/语言差异大，语义检索是主路径之一 | search 默认词法/精确 + 可选向量；返回可定位锚点 |
| 真值闭环 | 编译/测试/lint 可自动验证 | 原文引用/页码/图号/坐标 | read 必须返回行号/字符偏移；引用要可核验 |
| 知识注入 | CLAUDE.md/AGENTS.md/rules + skills | 阅读目标/术语表/笔记约定 + 阅读方法 | 文献库地图 + 技能，不写进工具 |
| 规模 | 大（数万文件），需要 repo map/索引 | 单篇中等；全库大 | 单文档内通用原语足够；全库需库级索引（P1/P2） |
| 变更频率 | git 频繁变更 | 书/论文导入后基本静态 | 目录/章节摘要可预建缓存，缓存友好 |
| 多模态 | 截图自检 UI | 插图/图表/公式是内容主体 | read/view 视觉块 + 图注锚点（P0 补） |
| 运行反馈 | 可执行、可测试 | 无执行，只能「引用原文」自检 | 工具返回坐标 + 引用格式，替代编译反馈 |

**一句话**：编码 Agent 的「grep + 结构（repo map/LSP）+ 编译反馈」在文献库要换成「**词法/语义检索 + TOC/锚点 + 原文坐标**」；工具数量不应增加，增加的是**索引与协议**。

### 4.7 对 SageRead 的直接推论

1. **不新增领域读取工具**；先把「通用 read/outline/search/view + DocRef + 锚点 URI」立起来，旧工具降级为 adapter。
2. **结构索引进上下文**：带位置的目录树 + 章节摘要 + 字符/token 计数（Aider repo map 的 1k 预算类比），比 RAG top-k 更可控。
3. **图片/PDF 统一进视觉块**：read 按文件类型分派（文本/图片/PDF 页），图片走视觉内容块；getFigures 只做锚点器（返回图号+图注+绝对路径），读图复用 read/view。
4. **结果投递默认 inline**，大结果写文件+locator 作为可选；先做 30–50 题评测再删工具。
5. **知识注入三层**：文献库地图（静态约定）→ 技能（阅读方法/SOP）→ 子代理（长阅读隔离），不要把领域知识塞进工具描述。
6. **权限**：阅读/检索默认放行；写笔记/标注/导出 ask；复用现有 tool-guard + 授权根（用户工作区可写、文献库只读）。

---

## 5. SageRead 目标架构：三层收敛

> 一句话：把文献库变成 Agent 可只读漫游的「文件系统工作区」，用 10 来个原语覆盖「找、读、看图」；把场景差异从「工具实现」上移到「可见性 + 上下文 + 技能」；只保留少量真正需要索引/产品状态的领域锚点。

### 5.1 关键转变：文献库成为第二个工作区（library workspace）

现状的根因不是「工具少」，而是内容在工具工作区之外：shared 工具根是用户设置的工作区（如文档目录），而书/论文在 {appData}/books/。于是每个「读库内内容」的能力都必须单独造桥（readPaperSection、readBookSection、ragRange…），模型也无法用通用方式「顺着路径摸过去」。

设计：

- 扩展 resolveWorkspaceRootForScope() 的语义为「多个授权根」：用户工作区（可写）+ 文献库根 {appData}/books（只读）+ 附件根（只读）。
- read / read_image / glob / grep / list_dir 统一按「授权根内路径」解析；界外仍走现有 tool-guard 确认卡（GUARDED_TOOLS 增加 fileRead 分档即可）。
- write / edit 对库根返回明确错误（「文献库只读；导入/删除/翻译请用全局助手的管理工具」），避免误改。
- 当前文档（docId + 绝对路径 + 类型）作为上下文注入，不作为工具参数必需项——模型既能「以当前文档为中心」，也能跨文档。

这样，论文/书籍对 Agent 就真的是「一堆可任意检索、只读访问的文件」，不再需要为一次读取造一个工具。这是回答「为什么编码 Agent 没这么繁杂」的第一块拼图。

### 5.2 三层工具面

先立协议，再谈工具：**DocRef + 锚点 URI**

- DocRef = { kind: "book" | "paper" | "file", id, markdownPath, imagesDir, format, indexStatus }。所有工具用 DocRef 参数，不再靠闭包绑定「当前书/当前论文」；「当前文档」只是缺省值（上下文注入）。
- 锚点 URI：book:<id>/<md_path>#<heading>、paper:<id>#<heading>、chunk:<id>、figure:<paper_id>:<fig_no>、cite:<paper_id>:<ref_no>、position:<doc_ref>@<char>。工具之间靠锚点衔接，模型引用可定位、可核验。
- 收益：central 能打开任意书/论文；reader/paper 只差「默认 DocRef」；同一实现服务三角色。

#### A. 通用执行层（10–12 个；所有角色同一套实现）

| 工具 | 签名（示意） | 职责 | 吸收的旧工具 |
|---|---|---|---|
| read | (file_path, offset?, limit?) | 文本读取：行号、totalLines、续读 footer、单次字节上限 | readLocalFile(read)、readPaperSection/readBookSection 的底层读取 |
| read_image | (file_path) | 本地图片 → 文本信封 + 图片块；魔数嗅探、降采样、视觉门控。也可由 read 按文件类型分派（Claude Code 模式），两者选一即可 | 扩展 readImage；补齐 getFigures 的「看」 |
| glob | (pattern, path?) | 按路径发现文件（库内/工作区） | searchFiles(glob) |
| grep | (pattern, path?, include?) | 内容搜索（库内/工作区），上限 + 截断提示 | searchFiles(grep) |
| list_dir | (path) | 列目录（可与 glob 合并） | readLocalFile(list) |
| write | (file_path, content) | 写用户工作区/笔记；库根只读 | writeFile |
| edit | (file_path, old_string, new_string, replace_all?) | 局部编辑 | editFile |
| web_search / web_fetch | 现有 | 外部信息 | webSearch（补 fetch 更好） |
| todo / present | 可选 | 长任务编排 / 交付物 | 新增（借鉴 Harness） |

> 兼容策略：旧工具名保留为薄包装，内部调用上述原语；默认可见（或标 deprecated 但可用），稳定一个版本后按可见性开关下线。这样迁移可回退、不破坏行为。

#### B. 领域锚点层（4–6 个；参数化，不按文档类型复制）

| 工具 | 签名（示意） | 职责 | 为什么通用原语做不到 |
|---|---|---|---|
| search_library | (query, scope="current"｜"collection"｜"all", doc_type?, top_k?) | 语义/混合检索；返回可定位坐标 | 平铺库没有 grep 的「命名结构」，语义模糊定位需要向量索引 |
| read_document | (doc_id?, anchor, before?, after?)；anchor = {kind:"position"} / {kind:"heading",title} / {kind:"char",offset} / {kind:"chunk",id} | 按结构/位置读窗口，返回行号/字符偏移/next_offset | 书籍章节标题→mdbook 文件映射、TOC 缺失回退；但接口只有一个 |
| get_document_info | (doc_id?) | 元数据 + 目录 + 索引状态 + 图片/引用计数 | 产品数据模型；比让模型 glob 目录省 token |
| get_reading_position | () | 用户当前精确位置（产品独占信号） | 外部不可得 |
| list_figures / search_figures | (doc_id?, query?) / (query, scope) | 图注索引 → 绝对路径 + 所在小节 | 「哪张图相关」是语义问题；P1 |
| get_citations | (doc_id?) | 论文引用列表/网络 | 结构化数据；P1 可扩图谱 |

要点：

1. 每个锚点工具都接受「当前文档」默认值 + 显式 docId，因此 reader/paper/central 共用一个实现；scope 只决定默认值与可见性。
2. 返回可定位坐标（docId/heading/char offset/chunk id/绝对图片路径），模型才能继续用 read/read_image 深挖，也才能给出可核验引用——这是阅读 Agent 的「ground truth 闭环」。
3. 不暴露分页游标/内部 id（除稳定 docId/chunk_id）；上限由部署配置，模型只看到「继续/缩小范围」的指引（借鉴 Harness session-query 的「无游标」设计）。
4. 旧 readPaperSection/readBookSection/ragRange/ragContext/readAtReadingPosition 先映射到 read_document；旧 paperSearch/ragSearch 映射到 search_library；getPaperToc/getPaperInfo 映射到 get_document_info。

#### C. 约定与上下文层（不用工具承载领域知识）

1. 文献库地图（静态，缓存友好）：注入一段【文献库与读取约定】：
   - 根路径：{appData}/books（只读）；
   - 目录布局：论文 <id>/paper.md + images/；书籍 <id>/mdbook/book/src/EPUB/*.md + images/；
   - 图片链接是相对路径，工具输出已解析为绝对路径，可直接 read_image；
   - 探索顺序：元数据/目录 → search_library/grep → read_document 窗口 → read_image；
   - 只读边界与「写库用全局助手管理工具」；
   - 当前文档与阅读位置指针。
   这相当于 Harness 的 AGENTS.md：几百字的约定，替代几千字的逐工具罗列。
2. 工具 guidance 单一来源：每个工具定义旁附一段 guidance（Markdown，如「Use grep — not shell pipelines — to search the library.」），组装系统提示词时按当前可见工具条件拼接。删除 getToolDescriptions() 手工副本和 prompt 里重复的工具清单。等价于 Harness 中每个 tool 包贡献 guidance 段、按 ctx.tools.get(name, scope) 可见性输出。
3. 角色 = 可见工具集 + 上下文 + 技能：reader/paper/central 不再复制实现，只声明 filter 与上下文绑定（当前书/当前论文/全库）。能力门控（向量模型是否配置、某书是否已索引）统一在 assembleTools(scope, capabilities) 一处计算，输出可见集合与 guidance。
4. 技能（SKILL）继续扩展：用户教给 Agent 的阅读方法/SOP 用现有 skill 体系承载（已有 getSkills 机制），不要变成新工具。

### 5.3 多模态闭环（P0 细节，照搬 Harness read_image 范式）

- 新原语 read_image(file_path)：
  1. 读字节（Rust 侧或 fs plugin）→ 魔数嗅探（现有 media-sniff.ts 改为支持原始 bytes，而不只是 dataUrl）；
  2. 部署限制：单图 ≤ 4MB、长边 ≤ 2048（超出用前端 canvas/Rust image 降采样；P0 可先「超限报错并提示」）；
  3. 视觉门控：modelSupportsVision(providerId, modelId) 为假 → 返回可操作错误（「当前模型不支持图片输入，请切换视觉模型」），不要像传输层那样静默剔除；
  4. 返回 AI SDK v7 file part：{type:"content", value:[{type:"text", text: envelope}, {type:"file", mediaType, url:dataUrl}]}；envelope 仿 Harness：<path>…</path><type>image</type><content>image/jpeg image, WxH px, N bytes (downscaled …)</content>；
  5. 路径授权：库根/附件根/工作区只读；界外走 tool-guard 确认（GUARDED_TOOLS 加 readImage fileRead 分档）。
- getFigures → list_figures：返回绝对路径 + caption + 所在小节；guidance 明说「要看图调用 read_image」，不再有「不能看图」的死角。
- 图片预算：单轮最多 N 张（建议 4）；历史旧图沿用现有「⟦可用 readImage 重看⟧」存根机制，需要时再读——等价 Harness 的 image offload。
- 验收：论文插图问答、EPUB 插图问答、非视觉模型报错提示三条 E2E。

### 5.4 Token 效率策略（写进库地图 guidance）

1. 先元数据后正文：get_document_info 回答「标题/目录/索引状态」，不读正文；
2. 先定位后精读：search_library（语义）或 grep（精确术语/公式号/人名）→ 命中的坐标；
3. 窗口读取：read_document 默认 ~4–8k 字符窗口 + next_offset，禁止默认全文（readPaperFull 只作为显式「总结全文」路径，或改为子代理调用）；
4. 跨文档长任务：子代理（subagent）读完一章/一篇只回结论，主上下文不背原文——这正是 Harness 的上下文隔离思路；
5. 结果有界 + spill：search 命中、read 窗口、图片数量都有上限；超限结果写回执文件 + locator（现有 tool-result-slimming 可扩展）。

### 5.5 保留哪些「领域专用工具」

应该保留的（需要特权/状态/副作用）：

- 检索索引类：search_library、list_figures/search_figures、get_citations（需要预先建索引/结构化数据）；
- 产品状态类：get_reading_position、manageNotes、notes、reading stats；
- 管理动作类（仅 central）：import/delete/translate/vectorize/sync/MCP/skill/secret——这些是「操作 App」，不是「读内容」，继续留在 central 合理；
- 长文产出类：mindmap、exportNotes（有特定输出格式/落盘语义）。

应该消灭的：

- 按文档类型复制的「读章节/读全文/取目录/取图片/扩展上下文」（readPaperSection、readBookSection、ragRange、ragContext、paperContext、readPaperFull、getPaperToc、getPaperInfo、getFigures 中的读取部分）；
- 按 scope 复制的检索入口（ragSearch vs paperSearch vs central paperSearch）；
- 提示词里逐工具罗列的用法（迁到工具 guidance）。

### 5.6 与 Harness 的逐项对照

| Harness 设计 | SageRead 对应改造 |
|---|---|
| 小工具面（~15 个原语） | 通用执行层 10–12 个 + 锚点 4–6 个 |
| read_image 通用原语 | 本地路径 read_image（P0） |
| AGENTS.md 约定链 | 【文献库与读取约定】静态段 |
| Skills 渐进披露 | 现有 skill 体系（SOP/阅读方法）继续用 |
| ctx.tools.restrict/get(name,scope) | assembleTools(scope, capabilities) 统一可见性 |
| 工具包贡献 guidance | 工具定义旁 guidance 单源拼接 |
| tool result pruner/spill | 现有 tool-result-slimming + 新增 spill 语义 |
| image offload | 现有图片存根机制 + readImage 重看 |
| sandbox workspaceRoot | 授权根：用户工作区（写）+ 文献库（只读） |
| PTC/run_code | P2 评估，先上子代理 |
| agent preset | reader/paper/central 组合化 |

---

## 6. 迁移路线（可分阶段、可回退）

### P0（0.5–1 天，先补闭环、不动旧行为）

0. 先建评测基线（半天）：30–50 道真实任务（书：定位/总结/跨章对比；论文：方法/实验/图注/引用；跨文献对比），记录准确率、工具调用数、token、首 token 延迟、引用可定位率——没有基线就没有「删工具」的依据。
1. 本地路径 read_image（或让 readImage 同时接受 attachment:// 与绝对路径）：魔数嗅探、视觉门控、file part 返回、tool-guard fileRead 分档、单图体积上限与降采样提示。
2. getFigures 返回绝对路径（解析 paperDir/images）；guidance 指向 read_image。
3. 库地图静态注入：buildLibraryGuide()（根/布局/图片规则/探索顺序/只读边界），先与旧 policy 并存。
4. shared 工具 guidance 单源化：把 prompt 中 15 个 shared 工具的用法挪到工具定义旁，按可见性拼接；验证 prompt 缓存命中不退化。
5. 兼容包装：readLocalFile(read) 内部走统一 read 实现；getFigures 路径修正。不删旧工具。

验收：论文图/书图问答 E2E；visual 非支持模型错误提示；pnpm tsc/biome 绿；关键 prompt 长度对比。

### P1（2–4 天，收敛工具面）

1. read_document(doc_id?, anchor, before?, after?) 一个实现吸收 readPaperSection/readBookSection/ragRange/ragContext/readAtReadingPosition（书籍章节映射内部做，TOC 缺失回退 spine/字符偏移）。
2. search_library(query, scope, doc_type?, top_k?) 吸收 ragSearch/paperSearch（含 central 全库）；paperContext→read_document。
3. get_document_info 吸收 getPaperInfo/getPaperToc（+书籍 TOC/索引状态）。
4. 删除 getToolDescriptions() 手工副本；registry.ts 成为唯一描述来源。
5. lazy-toolset 只对 MCP 工具生效（内置工具面回到 <14 后不再触发目录牌）。
6. 引入 DocRef 与锚点 URI：central 可读任意书/论文正文；「当前文档」变缺省值；书两套文本层（EPUB DOM vs mdbook）先以 mdbook 为主层、EPUB 匹配器降级为 heading 适配器。
7. 统一结果 envelope：{content, anchors, source, truncated, nextCursor} + 引用元数据集中生成；删除手写 citation_guide 与未返回的死代码。
8. list_figures（P1 前半）→ search_figures（图注索引，P1 后半）；getFigures 只返回锚点，读图走 read_image。

验收指标：每角色可见工具 ≤14；system prompt 工具相关文本 −40%；典型任务（总结章节 / 图 3 说明 / 两篇论文方法对比）步数与 token 对比；全部旧工具回归通过。

### P2（1–2 周，增强）

- 引用图谱/被引分析（get_citations 扩展）；
- 子代理编排：长文总结、跨文献对比、批量提取；
- 用户技能/SOP（把「读书方法」沉淀为 SKILL.md），与现有 skill 服务打通；
- PTC/run_code 式批量脚本评估（跨 200 篇提取字段）。

### 风险与回退

| 风险 | 缓解 |
|---|---|
| 书籍章节→mdbook 文件映射复杂 | 先保留 readBookSection 薄包装；read_document 的 heading anchor 内部回退字符偏移 |
| 迁移期工具双开导致 schema 变大 | deprecated 工具默认隐藏，仅兼容旧会话；或按可见性开关 |
| prompt 缓存退化 | 库地图静态段放最前；动态位置/时间仍在最尾（沿用现有 D3 布局） |
| 图片体积/安全 | 单图上限 + 张数上限 + 只读根 + 界外确认；非视觉模型前置报错 |
| 旧对话引用旧工具 | 保留一个版本的 alias；工具结果结构尽量兼容（坐标字段） |

---

## 7. 验收与度量

> 没有评测就没有「删工具」的勇气（Anthropic 评测驱动方法）。建议先攒 30–50 道真实任务，建基线，再按指标迭代；评测集留 held-out 防过拟合，并把失败轨迹（transcripts）交给 Agent 反向重构工具与描述。

### 7.1 指标

| 类别 | 指标 | 采集方式 |
|---|---|---|
| 工具面 | 每角色可见工具数、schema+guidance token 估算 | registry 组装结果 + token-estimator（已有） |
| 效果 | 任务准确率、引用可定位率（返回坐标命中原文）、图片问答准确率、无索引兜底成功率 | 评测集人工/自动判分 |
| 成本 | 输入/输出 token、首 token 延迟、总时延、工具调用次数 | transport 现有日志 + 评测脚本 |
| 稳定性 | 工具错误率（参数错误/空结果/超时）、重试次数、旧工具回归通过率 | 轨迹统计 + 回归集 |
| 缓存 | prompt 前缀命中率（静态段不变、动态段只在尾部） | 对照 provider 缓存指标/请求日志 |

### 7.2 评测任务（示例，先各 5–8 题）

1. **书**：「总结第 3 章论点」「第 2 章与第 5 章的方法差异」「5.8 节讲了什么」。
2. **论文**：「本文的贡献是什么」「图 3 说明了什么」「实验设置与基线」「参考文献里的 X 是谁」。
3. **跨文献**：「A、B 两篇的方法差异」「找三篇讨论 Y 的论文并比较」。
4. **位置**：「我读到哪里了，把这一节原文给我」。 
5. **无索引兜底**：未向量化的书/论文上完成上述 1–2 个任务。
6. **图片 E2E**：论文插图与 EPUB 插图各一张，要求引用图号+说明。

### 7.3 A/B 方案

- A：现状（旧工具面 + 旧提示词）；B：新原语/锚点 + 库地图 + guidance 单源（P1 完成态）。
- 同一模型、同一评测集、同一温度；记录每题的调用轨迹（工具序列、token、时延、错误）。
- 先做「不改行为」的 P0（read_image/路径/库地图/guidance），再逐项替换旧工具；每步保持旧工具 alias 可用，单独评测。

## 8. 参考来源与配套材料

### 8.1 本仓配套笔记（本次调研产出，可直接查阅细节）

- 主流编码 Agent 工具清单与源码级事实：docs/audits/research/coding-agent-tool-inventories.md
- 工具设计原则、上下文工程、检索实证与移植建议：docs/audits/research/agent-tool-design-principles.md
- SageRead 现状盘点（工具逐项、存储布局、索引/多模态缺口、文件:行号）：docs/audits/research/sageread-agent-inventory.md
- 既有能力审计（图片/跨文献/任意位置）：docs/audits/agent-figure-and-cross-document-capabilities.md

### 8.2 一手来源（按主题）

- Anthropic 工具设计五原则：https://www.anthropic.com/engineering/writing-tools-for-agents （2025-09-11）
- 上下文工程：https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents （2025-09-29）
- 代码执行 with MCP（150k→2k token）：https://www.anthropic.com/engineering/code-execution-with-mcp （2025-11-04）
- Tool Search / PTC / 工具膨胀量化：https://www.anthropic.com/engineering/advanced-tool-use （2025-11-24）
- Agent Skills（三级披露）：https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills （2025-10-16）
- MCP Client Best Practices（catalog→inspect→execute、1%–5% 阈值、缓存冲突）：https://modelcontextprotocol.io/docs/draft/develop/clients/client-best-practices
- AGENTS.md 约定：https://agents.md/
- Claude Code 工具参考（Read 图片/PDF、Glob/Grep 平台差异）：https://code.claude.com/docs/en/tools-reference
- Claude Code 权限：https://code.claude.com/docs/en/permissions
- Codex CLI 源码与系统提示词（view_image/tool_search/apply_patch/AGENTS.md）：https://github.com/openai/codex
- Codex view_image schema：https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/view_image_spec.rs
- Gemini CLI 工具参考（read_file 多模态）：https://geminicli.com/docs/reference/tools/ 、https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/tools.md
- Cursor Agent tools / Browser / Codebase indexing：https://cursor.com/docs/agent/tools 、https://cursor.com/docs/agent/browser 、https://cursor.com/docs/context/codebase-indexing
- Aider repo map（图排序、1k 预算）：https://aider.chat/docs/repomap.html
- OpenHands SDK 工具系统：https://docs.openhands.dev/sdk/arch/tool-system.md
- Devin 工具/Computer Use/AGENTS.md/Skills/Memory：https://docs.devin.ai/
- SWE-agent / ACI 论文：https://arxiv.org/abs/2405.15793
- Is Grep All You Need?（2026-05-14）：https://arxiv.org/abs/2605.15184
- Lost in the Middle：https://arxiv.org/abs/2307.03172
- Context Rot（Chroma）：https://research.trychroma.com/context-rot

### 8.3 本报告证据等级

- 「源码级事实」：DeepSeek Harness 安装包内 dsh-base/cordis.patch.yml、@deepseek-ai/* 包 README 与 lib 代码；SageRead 仓库代码与行号。
- 「官方文档事实」：上述 Anthropic/Claude Code/Codex/Gemini CLI/Cursor/Aider/OpenHands/Devin 页面（2026-10-21 抓取）。
- 「推断/建议」：§4.5–§4.7、§5、§6 的架构与路线，属于设计判断，不是外部事实。
