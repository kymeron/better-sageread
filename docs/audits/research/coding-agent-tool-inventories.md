# 主流编码 Agent 工具体系对照（Claude Code / Codex CLI / Gemini CLI / Cursor / Aider / OpenHands / Devin）

> **一句话结论**：前沿编码 Agent 的工具集正在收敛为「少量通用原语（shell + 读 + 写/补丁 + 搜索 + 联网 + 计划 + 子代理）+ 约定文件/Skills 注入领域知识 + 工具搜索/代码执行对抗工具爆炸」；图片与 PDF 普遍走**通用读文件工具的视觉内容块**（而非场景化工具）；"在大仓库低成本定位"靠 **grep 优先 + 结构索引（repo map / 代码索引）+ 子代理隔离 + 范围化读取**，而不是为每类内容新增工具。SageRead 的 20+ 场景工具可以收敛成少量通用原语 + 书/论文的"索引/位置"参数化读取。
>
> 调研快照：2026-10-21（Asia/Shanghai）。标注 **【事实】** = 官方文档/官方仓库源码原文；**【推断】** = 基于事实的合理解读。所有 URL 均为调研当日抓取。

---

## 0. 快照、来源与可信度

| Agent | 来源（2026-10-21） | 版本/状态线索 |
|---|---|---|
| Claude Code | code.claude.com 官方文档（tools-reference、permissions、permission-modes、memory、skills、sub-agents、features-overview、how-claude-code-works、chrome、best-practices；文档内引用到 v2.1.296） | 仍在快速迭代；工具表 46 行，含 deprecated/experimental 项 |
| OpenAI Codex CLI | github.com/openai/codex 的 main 分支源码 + 系统提示词 gpt_5_2_prompt.md；官方文档已迁到 developers.openai.com/codex（直连 403，仓库 docs 只留跳转） | GPT-5.2 prompt；Rust 实现；内置工具约 20 个 |
| Gemini CLI（继任者 Antigravity CLI） | github.com/google-gemini/gemini-cli main + docs；官方 README 顶部公告 | **【事实】2026-06-18 起由 Antigravity CLI 取代（非付费版/Google One 用户）**，CLI 不再针对最新 Gemini 模型优化 |
| Cursor | cursor.com/docs/agent/tools、/docs/context/rules、/docs/agent/browser、/docs/context/codebase-indexing | 文档为当前在线版；未标注版本号 |
| Aider | aider.chat/docs/repomap.html、/docs/more/edit-formats.html、/docs/usage/images-urls.html | 文档为当前在线版 |
| OpenHands | docs.openhands.dev（Tool System & MCP、Task Tool Set）+ github.com/OpenHands/software-agent-sdk | SDK 化后的工具框架 |
| Devin | docs.devin.ai（Session Tools、Computer Use、AGENTS.md、Skills、Memory、Index a Repository） | 托管产品，内部工具清单不完全公开 |

**可信度说明**：Agent 系统提示词与工具 schema 属于"实现级事实"；产品文档属于"官方声明"；第三方镜像/博客只在官方源不可达时用于交叉验证并显式标注。

---

## 1. Claude Code（Anthropic）

### 1.1 版本与来源
- 工具参考：https://code.claude.com/docs/en/tools-reference （同日抓取的 `.md` 原文，约 80KB）
- 权限：https://code.claude.com/docs/en/permissions ，模式：https://code.claude.com/docs/en/permission-modes
- 扩展体系：https://code.claude.com/docs/en/features-overview 、memory/skills/sub-agents

### 1.2 工具清单（46 项，官方表逐行统计）
**【事实】** 官方工具表列名 + 简述 + 是否默认需要权限（Manual 模式、工作目录内）：

| 分类 | 工具（名称） | 职责 / 备注 |
|---|---|---|
| 读 | `Read` | 读文件（行号）；**原生支持 PNG/JPEG/GIF/WebP 图片、PDF、Jupyter notebook**；文本默认单次 ≤25k tokens、>256KB 拒绝，用 offset/limit 分页；v2.1.296+ 可 `allow_large: true` |
| 写/改 | `Write`, `Edit`, `NotebookEdit` | 覆盖写、精确字符串替换、改 notebook cell |
| 执行 | `Bash`, `PowerShell`, `Monitor` | 命令执行；每个 Bash 命令独立进程（cd 不持久）；Monitor 后台跑命令并逐行回喂输出/WebSocket 事件 |
| 搜 | `Glob`, `Grep`, `LSP` | Glob 按名找文件；Grep 基于 ripgrep（files_with_matches/content/count、multiline、type/glob 过滤）；LSP 提供定义跳转/引用/实时类型错误（需 code intelligence 插件） |
| 网络 | `WebFetch`, `WebSearch` | WebFetch = URL+提取 prompt，HTML→Markdown 后再跑一次模型提取（**有损、故意如此**），100k 字符上限、15 分钟缓存、拒绝 localhost/无点主机名；WebSearch 走 Anthropic 搜索后端 |
| 编排 | `Agent`, `Skill`, `Workflow`, `SendMessage`, `ListAgents`, `ListMcpResourcesTool`, `ReadMcpResourceTool`, `WaitForMcpServers`, `ToolSearch` | Agent 起子代理（启用 agent teams 时可起 teammate）；Skill 在主对话内执行技能；Workflow 是"脚本编排大量子代理"；ToolSearch 在启用 tool search 时检索并加载延迟工具 |
| 计划/任务 | `EnterPlanMode`, `ExitPlanMode`, `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`, `TaskStop`（`TodoWrite` 默认停用；`TaskOutput` v2.1.277 已移除） | 计划模式进入/批准退出；任务系统取代 TodoWrite（`CLAUDE_CODE_ENABLE_TASKS=0` 可回退 TodoWrite） |
| 交互/外围 | `AskUserQuestion`, `Artifact`, `CronCreate/Delete/List`, `ScheduleWakeup`, `RemoteTrigger`, `PushNotification`, `SendUserFile`, `SendFeedback`, `ReportFindings`, `ShareOnboardingGuide`, `EnterWorktree`/`ExitWorktree`, `EndConversation`, `SubagentHandback`, `TaskStop` | 大量是会话/工作流/团队协作类，与"编辑代码"无关 |

**【事实】** 关键变化：在 macOS/Linux/WSL 上，`Glob`/`Grep` **默认不在工具集里**，Claude 通过 Bash 的 `find`/`grep`（内嵌 bfs/ugrep）搜索，在 hook/权限层表现为 Bash 调用；只有显式 `--tools/--allowedTools` 指定、Bash 被移除、或子代理 tools 字段列出时才恢复。Windows 上 Glob/Grep 仍在默认集。这说明官方在**主动收敛工具数量**，让 shell 做通用搜索。

### 1.3 图片 / PDF / 截图自检
**【事实】**
- `Read` 对 PNG/JPEG/GIF/WebP 返回**视觉内容块**（"returned as visual content that Claude can see, not as raw bytes"），不是路径文本；过大的图会被缩放/重压缩；>128MB 拒绝。
- PDF：短 PDF 整读；>10 页用 `pages` 参数按页段读（如 `"1-5"`，一次最多 20 页），页段读取用 poppler 的 `pdftoppm` 渲染（Windows 需自行装 poppler）。即 **PDF 页 → 图片 → 视觉块**。
- 截图自检有两个层次：(a) 用户可直接粘贴/拖拽图片进 prompt；(b) 需要"程序自己看结果"时，先由 Bash/Chrome 把截图落盘成 PNG，再用 `Read` 读图；官方 best-practices 明确建议"give Claude a check it can run: tests, a build, a screenshot to compare"，"take a screenshot of the result and compare it to the original"。
- `Claude in Chrome` 扩展提供浏览器自动化（导航/点击/读 console/DOM、录 GIF、保存截图到磁盘）；截图默认**存盘并报告路径**，再由 Read 读取。**【推断】** 这是"通用读图 + 浏览器外部化"的组合，而非内置 browser/screenshot 工具。

### 1.4 项目知识注入的四层（官方定位）
**【事实】**
| 机制 | 加载时机 | 官方定位 |
|---|---|---|
| `CLAUDE.md`（也支持 `AGENTS.md` 替代） | 每个会话开始注入 | 项目约定、架构、工作流等人写指令；"treat as context, not enforced configuration" |
| Auto memory（`MEMORY.md` 前 200 行/25KB） | 每个会话开始 | Claude 自己写的偏好/纠正/经验 |
| Skills（`SKILL.md`） | 用到时才加载 body（渐进披露） | 可复用流程/参考材料；"skill's body loads only when it's used, so long reference material costs almost nothing"；custom commands 已合并进 skills |
| Subagents（`.claude/agents`） | 主模型按 description 决定委派 | 独立 context + 可配工具/权限，返回摘要 |
| Hooks | 生命周期事件（PreToolUse 等） | 强制约束/自动化，官方明确"要 block 一个动作请用 PreToolUse hook 而不是写在 CLAUDE.md 里" |
| MCP | 连接时 | 外部工具/数据源，工具定义进上下文（因此有 tool search） |

### 1.5 权限模型
**【事实】**
- 分层：只读（Read/Grep/Glob 工作目录内）默认不询问；Bash 默认询问（除内置只读命令白名单）；编辑/写文件询问；WebFetch/WebSearch 询问（预置文档域名可免问）。
- 规则语法：`Tool` 或 `Tool(specifier)`，如 `Bash(npm run build)`、`Read(./.env)`、`WebFetch(domain:example.com)`；deny/ask 还能按顶层参数匹配（`Agent(model:opus)`、`Bash(run_in_background:true)`）。
- 权限模式：`default`(Manual) / `acceptEdits` / `plan` / `auto`（分类器代替人批准）/ `dontAsk` / `bypassPermissions`；**deny 规则在所有模式生效**；v2.1.283+ 交互终端默认 `auto`。
- "Yes, and don't ask again" 规则落到 `.claude/settings.local.json`；文件修改的本次会话内有效。

### 1.6 定位策略（大仓库）
- **grep 优先 + shell 通用**：POSIX 默认用 bash 内嵌 bfs/ugrep（见 1.2），减少专用工具。
- **LSP** 提供符号级导航与编辑后类型错误（大仓/类型语言，grep 慢或不精确时）。
- **子代理隔离搜索**：Agent 工具把"读很多文件"的探索放进独立 context，只回摘要。
- **计划模式**：EnterPlanMode 后只读探索，ExitPlanMode 交计划审批。
- **范围化读取**：Read 的 offset/limit、PDF pages、25k token/256KB 上限、PARTIAL view 提示。
- 无内置"repo map"类结构索引；结构信息靠 LSP + 子代理 + 文件系统约定。

---

## 2. OpenAI Codex CLI

### 2.1 版本与来源
- 仓库：https://github.com/openai/codex （main，2026-10-21）
- 系统提示词：`codex-rs/core/gpt_5_2_prompt.md`（https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/gpt_5_2_prompt.md）
- 工具组装/注册：`codex-rs/core/src/tools/spec_plan.rs`、`.../tools/handlers/*`、`.../tools/registry.rs`
- 沙箱文档：仓库 `docs/sandbox.md` 已指向 https://developers.openai.com/codex/security （直连 403）；交叉验证用文档镜像 https://mintlify.wiki/openai/codex/architecture/sandboxing （生成于 2026-02-28，**非官方域名**）

### 2.2 工具清单（内置约 20 个，源码级）
**【事实】** 从 handlers 目录与 spec_plan 的注册逻辑可确认：

| 工具 | 职责 / 关键参数（源码） |
|---|---|
| `exec_command` | 统一 shell/PTY 执行（"Runs a command in a PTY, returning output or a session ID for ongoing interaction"）；参数 `cmd`(必填)、`workdir`、`tty`、`yield_time_ms`、`max_output_tokens`(默认 1 万)、`shell`、`login`、`environment_id`；输出 schema 含 session id |
| `write_stdin` | 向已有 exec session 写字符/轮询输出（`session_id`、`chars`、`yield_time_ms`、`max_output_tokens`） |
| `apply_patch` | 专用补丁语言（`*** Begin Patch` / Add/Delete/Update File / `*** End Patch`），比通用写文件更省 token、更安全 |
| `view_image` | **通用读图**：见 2.3 |
| `update_plan` | 计划工具：`explanation` + `plan[{step,status}]`；"At most one step can be in_progress" |
| `web_search` | hosted 工具（`create_web_search_tool`，按配置/模型能力挂载） |
| `tool_search` | 延迟工具检索：`query` + `limit`；对 deferred tool metadata 做 **BM25**，"exposes matching tools for the next model call"；描述里可列 searchable sources（MCP） |
| `code_mode`（exec/wait） | 代码执行调用工具：freeform 工具，Lark 语法 `// @exec:...` + JS 源码，工具名为 `codex_code_mode::PUBLIC_TOOL_NAME` |
| 多代理 | `spawn_agent`、`send_input`、`wait_agent`、`close_agent`、`resume_agent`、`interrupt_agent`、`send_message`（v1/v2 两套注册） |
| 用户交互/权限 | `request_user_input`(`_async`)、`request_permissions`、`send_user_message_async` |
| 上下文控制 | `get_context_remaining`、`new_context_window`、`wait_for_environment`、`sleep`、`current_time` |
| MCP/插件 | `mcp`（MCP 工具命名空间）、`list_mcp_resources`、`read_mcp_resource`、`list_mcp_resource_templates`、`request_plugin_install`、`list_available_plugins_to_install` |
| 其他 | `imagegen`（配置 image_gen 时）、`test_sync`（测试） |

**【事实】** 没有 `read_file`/`list_dir`/`grep_files` 这类内置工具：读取靠 `exec_command` + `cat/sed/rg`，官方 prompt 明确要求"搜索文本或文件时优先 `rg` / `rg --files`"，并鼓励用 `multi_tool_use.parallel` 并行读。工具面比 Claude Code 小得多，核心只有 **shell + apply_patch + view_image + update_plan + web_search**。

### 2.3 view_image：图片如何进入上下文
**【事实】** `view_image_spec.rs`：
- 输入：`path`（"Local filesystem path to an image file."，必填）；可选 `detail` = `high` | `original`（默认 high；original 保留原始分辨率），仅在模型/配置允许时出现；可选 `environment_id`。
- 输出 schema：`{"image_url": "Data URL for the loaded image"}`（必填），若启用 detail 还回 `detail`。
- 即：**工具读取本地路径 → 返回 data URL 的图片内容块**，模型直接"看"图；没有先转文字描述、也没有让模型再 Read 路径的二次步骤。
- 代码里还有 `unified_image_budget`、`image_preparation`、`can_request_original_image_detail` 等开关，说明图片有统一 token/分辨率预算。

### 2.4 AGENTS.md 约定（系统提示词原文要点）
**【事实】** `gpt_5_2_prompt.md` "AGENTS.md spec"：
- AGENTS.md 可出现在仓库任意层级；**作用域 = 所在目录的整个子树**；修改某文件时必须遵守覆盖该文件的所有 AGENTS.md；嵌套更深的优先；系统/developer/user 指令高于 AGENTS.md。
- **repo 根的 AGENTS.md 以及 CWD 到根路径上的 AGENTS.md 会随 developer message 自动注入，不必重读**；在子目录或 CWD 之外工作时需自行检查其它 AGENTS.md。
- 官方说明页：https://developers.openai.com/codex/guides/agents-md （仓库 docs 只留链接）。
- 另有 `docs/skills.md`、`hooks`、MCP；Codex 也在走"约定文件 + 技能"的扩展路线。

### 2.5 沙箱与审批
**【事实】**（沙箱页 + 源码）
- 三档沙箱：`read-only`（默认；全盘只读、网络阻断，适合探索陌生代码）/ `workspace-write`（工作区可写，网络可选）/ `danger-full-access`（无隔离）。配置枚举在 `codex-rs/protocol/src/config_types.rs` 的 `SandboxMode`。
- 平台实现：macOS Seatbelt（`/usr/bin/sandbox-exec`）；Linux Landlock LSM + Bubblewrap；Windows 进程隔离/令牌限制；`.git`、`.codex` 即使在可写根内也**始终只读**。
- 审批：命令审批、文件变更审批、网络访问控制/代理模式；运行中可通过工具参数 `sandbox_permissions` + `justification` 请求升级（handlers/mod.rs 里有 `resolve_sandbox_permissions`，justification 必须配 sandbox_permissions），并有独立 `request_permissions` 工具。
- **【推断】** 官方 prompt 里"Depending on how this run is configured, you can request that calls be escalated to the user"对应上述运行时升级机制。
- **局限**：审批策略/命令白名单的完整枚举在 developers.openai.com/codex/security（本次直连 403），本笔记只保留能从仓库源码与沙箱文档镜像验证的部分。

### 2.6 工具爆炸对策（重要）
- **tool_search**：内置 BM25 检索延迟工具；工具描述只暴露"有哪些 source"，用到再取；MCP 工具也走这条路径。**【推断】** 对应 Claude 的 Tool Search / Anthropic 的"数千工具"方案。
- **code_mode**：用 JS 代码编排工具调用（`ToolMode::CodeMode/CodeModeOnly`，非直接暴露的工具可隐藏，`is_hidden_by_code_mode_only`），减少"每个工具一次推理"和中间结果进上下文。
- **命名空间**：MCP/插件工具走 namespace（`ToolName.namespace`），有 `FunctionsNamespaceFunctionPrefixes` 等机制。

---

## 3. Gemini CLI（Google）

### 3.1 状态与版本
**【事实】** 官方 README（2026-10-21）："**Unpaid tier and Google One users: Gemini CLI was replaced by Antigravity CLI on June 18th, 2026**"；"Gemini CLI has not been optimized for Gemini 4 Argon… use Antigravity"。仓库仍维护/开源，文档在 geminicli.com。因此本节主要价值是**工具面设计参照**，而非推荐继续押注该 CLI。
- 工具参考：https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/tools.md
- 逐工具 docs：docs/tools/{file-system,shell,planning,todos,memory,web-search,web-fetch,mcp-*,activate-skill,internal-docs,tracker}.md
- **【事实】** 当前官方 tools.md 已不列 `save_memory` 工具：记忆改为由模型直接 `write_file`/`replace` 编辑 GEMINI.md（docs/tools/memory.md）；但仓库 `packages/core/src/tools/memoryTool.ts` 仍存在（实现层保留，文档层不再主推）。
- **【事实】** 继任者：Google 官方公告 [An important update: Transitioning Gemini CLI to Antigravity CLI](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)（README 引用；本次直连抓取失败，标题/存在性由搜索结果交叉确认）。Antigravity CLI 的完整工具清单本次未获取，列为未决项。

### 3.2 工具清单（26 个内置 + MCP 动态；不含实验 tracker 约 20 个）
**【事实】** 官方 tools.md 全表：

| 分类 | 工具 | 说明 |
|---|---|---|
| 执行 | `run_shell_command` | bash -c / Windows powershell -NoProfile -Command；参数 command/description/dir_path/is_background；返回 Command/Directory/Stdout/Stderr/Exit Code/Background PIDs；policy engine 有 commandPrefix/commandRegex |
| 文件系统 | `read_file`、`read_many_files`、`list_directory`、`glob`、`grep_search`（旧别名 `search_file_content`）、`replace`、`write_file` | read_file 支持 offset/limit（start_line/end_line）且**支持文本/图片/音频/PDF**；read_many_files 常由 `@` 触发；grep_search 有 git grep 快路径；replace 要求唯一匹配（allow_multiple 可放开）；写/替换需人工确认 |
| 交互/规划 | `ask_user`、`write_todos`、`enter_plan_mode`、`exit_plan_mode` | 计划模式只读；exit 提交 plan_path（必须在临时 plans 目录）并请求批准 |
| 技能/记忆 | `activate_skill`（.gemini/skills）、`get_internal_docs` | 渐进披露技能；读自身文档 |
| MCP | `list_mcp_resources`、`read_mcp_resource` + MCP 工具 | |
| Web | `google_web_search`（返回带 citation 的生成摘要）、`web_fetch`（校验私网/保留 IP；Plan Mode 需确认） | |
| 系统/任务 | `complete_task`（子代理用）、`update_topic`、tracker_* 6 个（实验） | tracker 任务图/依赖/可视化 |

### 3.3 图片 / 非文本读取
**【事实】** docs：`read_file` "Supports text, images, audio, and PDF"。源码 `packages/core/src/utils/fileUtils.ts`：
- `ProcessedFileReadResult.llmContent: PartUnion`，注释写明 "string for text, **Part for image/pdf**/unreadable binary"；
- 通过 mime + 二进制检测分类为 text/image/audio/video/pdf；**最终以多模态 Part（inline data）返回给模型**，而非路径字符串。
- 结论：Gemini CLI 与 Claude/Codex 同构——**通用读文件工具承担图片/PDF 读取**，没有专用 get_image 工具。

### 3.4 项目知识注入
**【事实】**（docs/cli/gemini-md.md）
- 三级层次：`~/.gemini/GEMINI.md`（全局）→ workspace 及父目录的 GEMINI.md（每次请求拼接注入）→ **JIT context**：工具访问某文件/目录时，自动扫描该目录及祖先到 trusted root 的 GEMINI.md，按需加载。
- `/memory show|reload` 可查看/重载；memory.md 说明"shared project instructions → 仓库 GEMINI.md；private project notes → 私有目录；cross-project → ~/.gemini/GEMINI.md"。

### 3.5 定位策略
- `glob`（按修改时间倒序、默认忽略 node_modules/.git、respect .gitignore）
- `grep_search`（git grep 快路径，回 file+line；参数丰富：include/exclude/context/before/after/max_matches 等）
- `@` 触发 `read_many_files` 批量拼接（**一次读很多文件，token 风险高**）
- `read_file` 的 offset/limit + 截断提示（明确告知剩余行数与下一步参数）
- 无 repo map / 代码索引。

### 3.6 权限与沙箱
**【事实】**（docs/reference/policy-engine.md）
- 规则：TOML `[[rule]]`，条件 `toolName`（支持 `*`、`mcp_server_*`、`mcp_*_toolName`、`mcp_*`）、`argsPattern`（正则匹配 JSON 化参数）、`modes`、`interactive`；决策 **`allow` / `deny` / `ask_user`**；优先级 = tier_base(Default1/Extension2/Workspace3/User4/Admin5) + toml_priority/1000。
- **`deny`（全局规则）会把工具从模型上下文中完全移除**（省 token、降误选）；`tools.exclude` 已废弃，推荐用 deny。
- 审批模式：`default` / `autoEdit` / `yolo` / `plan`（规则可按模式生效）；另有 sandbox、trusted folders（工作区信任目录）。
- 写文件/替换/shell 默认人工确认；web_fetch 在 Plan Mode 需确认。

---

## 4. 其他值得参考的系统

### 4.1 Cursor（Agent + Browser）
**【事实】**（https://cursor.com/docs/agent/tools 、/docs/agent/browser 、/docs/context/codebase-indexing）
- 工具类别（官方页列举）：搜索文件/目录、Web 搜索、Fetch Rules（按类型/描述取规则）、**Read files（明确支持 .png/.jpg/.gif/.webp/.svg，并作为视觉内容进上下文）**、Edit files、Run shell commands、Browser（导航/交互/截图/验证视觉改动）、Image generation、Ask questions、Checkpoints、排队/插话消息；另有 Explore 子代理、Rules、Skills、Subagents、Hooks、MCP。
- **定位**：`Instant Grep`——自研本地正则搜索索引，"outperforms ripgrep on large codebases"，不把文件路径/代码上传、不存 embedding；Explore 子代理用更快模型并行搜、只回相关结论。
- **截图/视觉自检**：Browser 工具"**Screenshots are integrated directly with the file reading tool, so Agent actually sees the browser state as images**"；浏览器日志写到文件后由 agent grep/按需读（而不是每次摘要），减少 token。
- **项目知识**：`.cursor/rules/*.mdc`（四类规则：Always/Intelligent/File-specific/Manual）+ 用户规则 + 团队规则 + `AGENTS.md`（作为 .cursor/rules 的简单替代）。
- **【推断】** 工具数量官方未给总数，按页面类别约 12 类；Cursor 的差异化在"搜索/浏览器/视觉"工业化，而不是工具数量。

### 4.2 Aider（repo map 的经典设计）
**【事实】**（https://aider.chat/docs/repomap.html 、/docs/more/edit-formats.html 、/docs/usage/images-urls.html）
- 每次请求附带**整个 git 仓库的 repo map**：文件列表 + 关键类/函数签名 + 定义的关键行；用 tree-sitter 抽取符号。
- 大仓时用**图排序**（文件为节点、依赖为边）挑最相关部分，默认 `--map-tokens 1k`，随对话动态伸缩；无文件加入 chat 时会扩大以覆盖全仓。
- 编辑不用工具 schema：用 `whole`/`diff`/`udiff` 等 **edit format** 让模型输出编辑；图片/网页通过 `/add` 加入 chat 给视觉模型。
- **启示**：不增加工具也能低成本"锚定"——把结构索引放进上下文预算内。SageRead 的 TOC/章节摘要本质就是 repo map 的对应物。

### 4.3 OpenHands（SDK 化工具框架）
**【事实】**（https://docs.openhands.dev/sdk/arch/tool-system.md 、/sdk/guides/task-tool-set.md 、github.com/OpenHands/software-agent-sdk）
- 工具框架：Action（Pydantic 输入）/ Observation（输出，`to_llm_content`）/ Executor / ToolDefinition / ToolRegistry；工具注解遵循 MCP hints（readOnly/destructive/idempotent/openWorld）；支持 MCP 工具、并行执行、安全确认。
- 内置工具模块（仓库 `openhands-tools/openhands/tools/`）：`terminal`、`file_editor`、`apply_patch`、`glob`、`grep`、`task_tracker`、`browser_use`、`planning_file_editor`、`delegate`/`task`/`child_conversation`（子代理）、`ask_oracle`/`tom_consult`、`workflow`、`gemini`；presets 目录实为 `default.py`、`gemini.py`、`gpt5.py`、`planning.py`、`task_outcome.py`、`subagents/`。
- **TaskToolSet**：父 agent 同步调用子 agent，返回结果并可按 task id 恢复（保留上下文）。
- **【推断】** 工具数量 20+，但明显按"通用操作 + 预设"组织，而非领域工具。

### 4.4 Devin（托管 Agent，能力外化到"环境"）
**【事实】**（docs.devin.ai）
- 会话工具（面向人）：Shell/终端、IDE（VSCode）、Browser；Progress tab 汇总。
- **Computer Use**：完整桌面，1024×768 屏幕，鼠标/键盘/截图/录制，覆盖 Web、桌面应用、TUI；Linux/Windows/macOS 会话。
- **项目知识**：`AGENTS.md`（每个文件自动注入前 **16KiB**，超出给截断提示并可按需读全文件）；`Skills` 走 Agent Skills 标准（`.agents/skills/<name>/SKILL.md`，跨仓自动发现）；`Memory`（个人 memory drive = Git 仓库的 Markdown，`MEMORY.md` 每会话注入，其余按需搜索；"Dreaming"后台整理）；DeepWiki 仓库索引用于 Ask Devin/代码理解。
- **【推断】** Devin 未公开内部工具 schema；从文档看是 shell/editor/browser/search/computer-use 的组合，定位依赖 DeepWiki 索引 + 浏览器/截图。

### 4.5 DeepSeek Harness（本环境，自观察；非官方文档）
- 模型直接可调用的工具只有 `run_code`（执行一段 TypeScript 程序）；**其余全部是程序内 SDK 绑定**：`read`/`read_image`/`write`/`edit`/`glob`/`grep`/`pwsh`、`web_search`/`web_fetch`、`subagent`/`spawn_teammate`、`job_*`、`team_task_*`、`session_search`、`schedule_*`、`present` 等。
- `read_image` 直接把 PNG/JPEG/WebP/GIF 作为图片返回（附件形式）；`read` 返回行号文本。
- **【推断】** 这是"代码执行即通用工具接口"的极端形态：工具爆炸被"SDK 命名空间 + 按需调用 + 程序内编排"消解；与 Claude 的 code execution with MCP、Codex code_mode 同方向。

---

## 5. 横向对比与共同模式

### 5.1 对照表

| Agent | 工具数量（口径） | 读文件 | 写/改 | Shell | 定位/搜索 | 读图 | 项目知识 | 权限 | 工具爆炸对策 |
|---|---|---|---|---|---|---|---|---|---|
| Claude Code | 46（官方表；含 deprecated/实验） | Read（文本/图/PDF/notebook） | Write/Edit/NotebookEdit | Bash/PowerShell/Monitor | Glob/Grep（POSIX 默认移出→bfs/ugrep）、LSP、Agent | **Read 原生视觉块** | CLAUDE.md/AGENTS.md + auto memory + Skills + Subagents + Hooks | allow/deny/ask 规则 + 6 种模式 + 分类器 | ToolSearch、Workflow、子代理、MCP |
| Codex CLI | ~20-30 内置（源码口径，含控制/多代理；核心 5 个） | 无 read_file；shell cat/sed/rg | apply_patch | exec_command + write_stdin | rg/rg --files via shell、tool_search | **view_image → data URL 图片块** | AGENTS.md（自动注入 root+ancestors）、Skills、Hooks、MCP | 3 档沙箱 + 审批 + request_permissions | tool_search(BM25)、code_mode、命名空间 |
| Gemini CLI | ~20 内置 | read_file（文本/图/音频/PDF）、read_many_files | write_file/replace | run_shell_command | glob/grep_search(git grep)/@批量 | **read_file 返回多模态 Part** | GEMINI.md 三级 + JIT、Skills、Memory 直改文件 | policy allow/deny/ask_user + 模式 + sandbox/trusted folders | deny 隐藏工具；无 tool search |
| Cursor | ~10 个工具类别（官方页列举） | Read files（含图片） | Edit files | Run shell | Instant Grep 本地索引、Explore 子代理、Fetch Rules | Read files 图片 + Browser 截图 | .cursor/rules + AGENTS.md + Skills + Subagents + Hooks + MCP | 浏览器 MCP allow/deny；Security 文档 | 子代理、Checkpoints、MCP 预算 |
| Aider | **无内置工具调用**（repo map + edit formats） | 用户+repo map | edit formats（whole/diff/udiff） | 用户自己跑 | **repo map（tree-sitter+图排序，默认 1k tokens）** | /add 图片进 chat | conventions/配置 | 无沙箱（本地 CLI） | 不适用（上下文工程替代工具） |
| OpenHands | 20+ 模块 | file_editor | file_editor/apply_patch | terminal | glob/grep、子代理 | browser_use 截图 | Skills/Context/Plugins | 安全确认/策略 | 工具集/preset、子代理、MCP |
| Devin | 未公开 | IDE/editor | IDE/editor | shell/terminal | DeepWiki 索引 + 搜索 | Computer Use 截图 | AGENTS.md 16KiB + Skills + Memory | 环境/VM 隔离 | 不适用（托管） |
| DSH（本环境） | 1 个直接工具 + ~40 SDK 绑定（本会话可见） | read/read_image | write/edit | pwsh | glob/grep | read_image 原生 | Skills catalog、goal/session | 沙箱模式 | 代码执行即接口 |

### 5.2 共同模式（对 SageRead 最有价值的 8 条）
1. **通用原语收敛**：所有系统最终都只有"读、写、执行、搜、联网、计划、子代理"。Claude 在 POSIX 主动移除 Glob/Grep 交给 shell；Codex 干脆不提供 read_file。**"场景化工具"在这些系统里不是主路径**。
2. **领域知识走约定文件 + 技能，而不是新工具**：CLAUDE.md/AGENTS.md/GEMINI.md/.cursor/rules 负责"稳定事实"；Skills/SKILL.md 负责"按需流程"（渐进披露，body 用到才加载）；Subagents 负责"隔离探索"。Codex AGENTS.md 明确"root+ancestors 自动注入，其它按需查"。
3. **图片 = 通用读图工具的视觉内容块**：
   - Claude Code：Read(path) → image block（PDF 页经 pdftoppm 转图）；
   - Codex：view_image(path) → `image_url` data URL；
   - Gemini：read_file(path) → 多模态 Part；
   - Cursor：Read files 支持图片 + Browser 截图"integrated directly with the file reading tool"；
   - Devin/OpenHands：截图来自 Computer Use/Browser 工具。
   共同点：**不是返回"图片路径+文字描述"，而是让模型直接看到像素**；token/分辨率预算统一管理（Claude 缩放、Codex detail/budget）。
4. **截图自检闭环**：Chrome/Browser/Computer Use 截图 → （Claude 落盘路径）→ 通用 Read 读图 → 与设计/预期对比；官方 best-practices 把"screenshot to compare"列为推荐的验证信号。Cursor 把截图直接并入 read 工具，省一次工具往返。
5. **大仓定位 = grep 优先 + 结构索引 + 子代理 + 范围读**：Aider repo map（符号图）、Cursor Instant Grep（本地索引、不传 embedding）、Devin DeepWiki 索引、Claude LSP、Gemini git grep、Codex rg；然后用 offset/limit/pages/token 预算做范围读。
6. **权限分层高度一致**：读默认放行；写/执行/网络默认 ask；规则 allow/deny/ask（Claude 的 `Tool(specifier)`、Gemini 的 TOML policy、Codex 的 sandbox+approval）；deny 规则优先且可"从上下文中移除工具"（Gemini 明确说明省 token）。自动批准模式（Claude auto 分类器、Gemini autoEdit/yolo、Codex danger-full-access）都要求环境隔离兜底。
7. **工具数量口径容易误导**：Claude 46 项里约一半是计划/团队/会话/反馈类控制面工具，真正接触代码的仍是 Read/Write/Edit/Glob/Grep/Bash 这几个；Codex 核心只有 5 个。比较工具面时应区分"控制面"与"IO 面"。
8. **工具爆炸已是显学**：Anthropic 实测"5 个 MCP server、58 个工具 ≈55K tokens"，内部最高见过 134K tokens；Tool Search Tool 把 122,800 tokens 降到 191,300 保留（~85% 节省），Opus 4 MCP 评测 49%→74%、Opus 4.5 79.5%→88.1%（https://www.anthropic.com/engineering/advanced-tool-use ）。解法：tool search / deferred loading、工具命名空间、代码执行调用工具（Anthropic code execution with MCP：https://www.anthropic.com/engineering/code-execution-with-mcp ）、子代理隔离、deny 隐藏、精简描述。
8. **计划工具是通用原语**：update_plan（Codex）/write_todos+plan mode（Gemini）/Task*+plan mode（Claude）/checkpoints（Cursor）。它属于"控制流"，不应算领域工具。

### 5.3 "是否专门为场景/领域写工具？"
- **Claude Code**：几乎没有领域工具（Artifact/PushNotification 等是产品面扩展）；领域能力靠 Skills/MCP/子代理。
- **Codex**：同样没有；工具是纯基础设施。
- **Gemini CLI**：tracker（任务图）、plan mode 属于通用控制；无阅读/论文类工具。
- **Cursor**：有 Browser/Image generation 两个"场景工具"，但仍是通用场景（Web/视觉），非领域内容工具。
- **Aider/OpenHands/Devin**：Aider 无工具；OpenHands/Devin 工具围绕"操作计算机"抽象。
- **结论**：主流系统**没有**为"图书/论文"这类内容领域写专用读取工具的先例；它们把"内容定位"做成参数（path/range/limit/query）+ 索引/约定文件。

### 5.4 图片读取机制横向对比（SageRead 最需要的一节）

| Agent | 工具/入口 | 输入 | 返回给模型的形式 | 限制/预算 |
|---|---|---|---|---|
| Claude Code | `Read` | 文件路径（可 offset/limit；PDF 可 pages） | **图片内容块**（PNG/JPEG/GIF/WebP）；PDF 页经 pdftoppm 转图 | 大图缩放/重压缩；>128MB 拒绝；文本 25k tokens/256KB 上限 |
| Codex CLI | `view_image` | 本地路径 + 可选 detail(high/original) | **data URL 图片**（output schema `image_url`） | unified_image_budget；detail 只在模型允许时出现 |
| Gemini CLI | `read_file` | 路径（start_line/end_line 只对文本） | **多模态 Part**（image/pdf/audio；`PartUnion`） | 无专用图片工具；mime+二进制检测 |
| Cursor | Read files / Browser | 路径或页面截图 | 图片进对话上下文（vision-capable 模型） | Browser 截图“integrated directly with the file reading tool” |
| Devin / OpenHands | Computer Use / browser_use | 屏幕/页面 | 截图（视觉观察） | Devin 1024×768 桌面；OpenHands browser_use（浏览器自动化，具体实现未核） |
| Aider | 无读图工具 | `/add` 图片/URL 进 chat | 图片内容进请求（视觉模型） | 依赖所选模型多模态能力 |
| DSH（本环境） | `read_image` | 路径 | **图片附件**（PNG/JPEG/WebP/GIF） | 大图自动缩放 |

**模式**："路径进、像素出"——工具参数是路径/页码，返回值是视觉内容块；因此**通用读图工具 + 文件/页范围定位**即可覆盖书籍插图、论文图表、公式截图，无需按内容类型造工具。

---

## 6. 对 SageRead 的可迁移原则（建议）

> 以下是基于上述对照的**推断性建议**，供 Lead 与设计同学取舍。

1. **工具收敛为 3 个原语 + 1 个索引**：`read(target, locator, budget)`（target 可为 book/paper/file/image/pdf；locator 可以是章节、CFI、页码、字符范围、epub spine index）、`search(scope, query, limit)`（全文/关键词，返回命中片段+位置）、`list/index(scope)`（TOC/目录/章节树/论文结构，作为"repo map"）；写/标注类工具按需 1-2 个。现有的 readBookSection/rag-range/readPaperSection/getPaperToc 等应收敛成"adapter + 参数"，而不是并列工具。
2. **图书/论文的"repo map"**：在 system/context 里注入**带位置的目录树 + 章节摘要 + 字符/token 计数**（类似 Aider repo map 的 1k 预算），让模型先看到"全貌+成本"，再决定 read 哪段。这比 RAG top-k 更可控、更省 token。
3. **范围化读取契约**：所有 read 返回必须带"我在哪、还剩多少、下一步怎么读"（Claude PARTIAL view / Gemini 截断提示 / PDF pages 的做法），并强制 token/字符预算。
4. **图片/PDF 统一走视觉块**：一个 `read_image`（或 read 的 image adapter）返回图片内容块；论文插图/公式/表格截图/书籍插图都用它，而不是 getFigures 这种"按语义命名"的工具。PDF 页渲染成图再读（Claude pdftoppm 模式）。
5. **知识注入三层**：书籍/论文级"AGENTS.md 等价物"（用户可编辑的阅读目标/术语表/笔记约定）+ Skills（如"精读论文方法""章节摘要流程"）+ 记忆（auto memory）。避免把这些塞进工具。
6. **权限**：阅读/检索默认放行；写笔记/标注/导出 ask；网络检索可配置。SageRead 是桌面 App，可用"作用域沙箱"（当前书/论文目录）替代 OS 沙箱。
7. **工具数量红线**：内置工具 ≤15-20 是当前主流（Claude 表面 46 但一半是会话/团队类；Codex ~20；Gemini ~20）。超过时先合并语义，再考虑 tool_search/延迟加载/命名空间；SageRead 场景下更可能是"合并"而非"搜索"。
8. **子代理**：把"扫全书找证据"放进子代理（隔离 context、只回摘要+位置），主 agent 只保留决策与写作，这是 Claude/Codex/Cursor/OpenHands 的一致做法。

---

## 7. 事实与推断速查 / 未决问题

- **事实**：Claude Read 原生图片/PDF；Codex view_image 返回 data URL 图片块；Gemini read_file 返回多模态 Part；三者都没有"图片转文字描述"的中间层。
- **事实**：Codex 无 read_file/list_dir/grep 工具，靠 shell+rg；Claude POSIX 默认移除 Glob/Grep 交给 shell；这两家都在"减工具"。
- **事实**：工具搜索/延迟加载已是 Anthropic 平台级能力（Tool Search Tool）且 Claude Code 有 `ToolSearch`、Codex 有 `tool_search`（BM25）。
- **事实**：Gemini CLI 已于 2026-06-18 被 Antigravity CLI 取代（官方 README）。
- **推断**：SageRead 若按"通用 read/search + 索引/位置参数 + skill/约定文件"重写，可把工具数从 20+ 降到 6-8 个，同时保留甚至提升定位精度；是否需要 tool_search 取决于 MCP/插件规模。
- **未决**：Antigravity CLI 的工具面（Google 未在公开文档给出完整工具清单，截至 2026-10-21）；Devin 内部 tool schema 未公开；Cursor 工具精确数量未公开。
- **研究局限**：部分官方页面本次直连失败（developers.openai.com 403、blog/raw 偶发 fetch failed），相关结论已退回到官方仓库源码/系统提示词或标注镜像来源；Gemini CLI 已退役，工具清单仍以仓库 docs 为准，实际产品面以 Antigravity CLI 为准。

---

## 8. 主要来源（2026-10-21）

**Claude Code**
- https://code.claude.com/docs/en/tools-reference
- https://code.claude.com/docs/en/permissions
- https://code.claude.com/docs/en/permission-modes
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/features-overview
- https://code.claude.com/docs/en/how-claude-code-works
- https://code.claude.com/docs/en/chrome
- https://code.claude.com/docs/en/best-practices

**Codex CLI**
- https://github.com/openai/codex
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/gpt_5_2_prompt.md
- https://github.com/openai/codex/tree/main/codex-rs/core/src/tools/handlers
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/tools/handlers/view_image_spec.rs
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/tools/handlers/tool_search_spec.rs
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/tools/handlers/shell_spec.rs
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/protocol/src/config_types.rs
- https://developers.openai.com/codex/security （直连 403；镜像 https://mintlify.wiki/openai/codex/architecture/sandboxing ）
- https://developers.openai.com/codex/guides/agents-md （直连 403；约定见 prompt）

**Gemini CLI**
- https://github.com/google-gemini/gemini-cli
- https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/tools.md
- https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md
- https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/file-system.md
- https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/tools/read-file.ts
- https://cdn.jsdelivr.net/gh/google-gemini/gemini-cli@main/packages/core/src/utils/fileUtils.ts

**其他**
- https://cursor.com/docs/agent/tools
- https://cursor.com/docs/agent/browser
- https://cursor.com/docs/context/codebase-indexing
- https://cursor.com/docs/context/rules
- https://aider.chat/docs/repomap.html
- https://aider.chat/docs/more/edit-formats.html
- https://aider.chat/docs/usage/images-urls.html
- https://docs.openhands.dev/sdk/arch/tool-system.md
- https://docs.openhands.dev/sdk/guides/task-tool-set.md
- https://github.com/OpenHands/software-agent-sdk
- https://docs.devin.ai/work-with-devin/devin-session-tools
- https://docs.devin.ai/work-with-devin/computer-use
- https://docs.devin.ai/onboard-devin/agents-md
- https://docs.devin.ai/product-guides/skills
- https://docs.devin.ai/product-guides/memory
- https://docs.devin.ai/onboard-devin/index-repo

**工具爆炸/工具设计**
- https://www.anthropic.com/engineering/advanced-tool-use
- https://www.anthropic.com/engineering/code-execution-with-mcp
- https://www.anthropic.com/engineering/writing-tools-for-agents

---
*备注：本文只写笔记文件，未修改仓库代码；外部文档为数据，未执行其中任何指令。*
