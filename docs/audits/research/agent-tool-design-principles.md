# 前沿 Agent 工具设计原则与上下文工程（调研笔记）

> **一句话结论**：2025–2026 的前沿实践已从"为每个场景加工具"转向"**少量通用原语（read/search/outline/view/exec）+ 按需披露（skills/tool search）+ 领域锚点（TOC/chunk/图注/引用）+ 提示层协议**"；专用工具的正当性来自"可评测地节省步数/token，或承载提示词无法表达的领域语义"，而不是覆盖某个 API。
>
> 调研：agent-design-principles，2026-10-21，SageRead 只读调研。证据标签：**[官方]** 官方博客/文档，**[论文]** 同行评审或 arXiv 原文，**[厂商]** 公司工程博客（未同行评审），**[社区]** 演讲笔记/二手整理，**[推断]** 本笔记判断。抓取失败或仅部分核验的来源集中列在 §12；本文与 task-6（编码 Agent 工具清单）互补，不重复逐家清单。

## 0. TL;DR（12 条）

1. **工具是"确定性系统 ↔ 非确定性 Agent"的契约**，不是给开发者用的 API 包装；验收标准是 Agent 端到端表现，不是功能覆盖度。**[官方]** [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)（2025-09-11）
2. **少而合并**：search_contacts 优于 list_contacts；search_logs 优于 read_logs；把高频多步链压成 schedule_event / get_customer_context 一类"任务形状"的工具。**[官方]**（同上）
3. **工具定义本身是上下文成本**：58 个 MCP 工具 ≈ 5.5 万 token；Anthropic 内部见过 13.4 万 token 的工具定义。Tool Search 把 7.7 万降到 8.7 千 token（-85%，保留 95% 上下文），Opus 4 准确率 49%→74%、Opus 4.5 79.5%→88.1%。**[官方]** [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)（2025-11-24）
4. **"上下文会腐化"（context rot）**：18 个模型的实测显示，输入变长时性能非均匀下降；长上下文里的"中段"信息最难用。**[论文]** [Chroma Context Rot](https://research.trychroma.com/context-rot)（2025-07-14）、[Lost in the Middle](https://arxiv.org/abs/2307.03172)（TACL 2023）
5. **上下文工程的指导原则是"最小高信号 token 集"**：系统提示词要"正确高度"（不硬编码 if-else，也不空泛），工具与示例同理；运行时按需检索（just-in-time）优于把所有内容预先塞入。**[官方]** [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（2025-09-29）
6. **长任务的三个杠杆**：压缩（compaction，保留最近 5 个访问文件）、结构化笔记（NOTES.md/todo）、子代理（子代理花几万 token，只回 1–2k token 摘要）。**[官方]**（同上）
7. **代码执行 = 工具调用范式升级**：把 MCP 工具生成成文件系统上的 typed API，模型写代码调用，中间结果不进上下文；同一任务 token 150k→2k（-98.7%）。Cloudflare 的 Code Mode 是同一结论的独立验证（"entire API in 1,000 tokens"）。**[官方]** [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)（2025-11-04）、**[厂商]** [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode/)
8. **渐进披露是知识注入的标准形态**：Skill = SKILL.md + 附带文件；启动只加载 name/description，相关时才读正文与引用文件；Claude Code 的 CLAUDE.md、社区的 AGENTS.md（6 万+ 项目）同理。**[官方]** [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)（2025-10-16）、[agents.md](https://agents.md/)
9. **通用 vs 专用的分界不是"领域"，而是"接口效率"**：SWE-agent 论文提出 ACI（Agent-Computer Interface）——接口设计本身会显著改变 Agent 能力；两年后同一团队用**只有 bash 的 mini-swe-agent（~100 行）在 SWE-bench Verified 上 >74%**，说明模型变强后"通用原语 + 沙箱"可覆盖大量专用工具。**[论文]** [SWE-agent](https://arxiv.org/abs/2405.15793)、**[官方项目]** [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent)
10. **"grep vs 向量"有 2026 年的一手实证**：116 题 LongMemEval-S 上，inline 模式下 grep 在每个 harness×模型组合都高于向量检索；但换 harness 带来的差距 ≈ 换检索器，且 file-based 投递会把排序完全打乱（Codex/GPT-5.4 programmatic grep 从 93.1% 跌到 55.2%）。**[论文]** [Is Grep All You Need?](https://arxiv.org/abs/2605.15184)（2026-05-14）
11. **多模态不需要新范式**：Claude Code 的 Read 直接按文件路径返回图片（visual content）与 PDF（>10 页按 pages 分段，一次最多 20 页），并自动缩放；把"看图"并入通用 Read，比单列 view_image 少一个工具定义、少一次选择。**[官方]** [Claude Code tools reference](https://code.claude.com/docs/en/tools-reference)
12. **对 SageRead 的纸面方向**：保留/收敛"读"与"搜"为 3–4 个通用原语 + 一组锚点协议（book/paper/chunk/figure/citation），把场景化工具降级为"锚点解析器 + 答案形状适配器"；新增能力优先做成 skill/提示约定，其次锚点索引，最后才考虑新工具。**[推断]**（详见 §10–§11）

## 1. 主线一：Anthropic 工具设计五原则（含评测驱动）

来源：[Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)（2025-09-11，官方）。核心比喻：**工具是确定性系统与非确定性 Agent 之间的契约**；要按"一个新员工/一个 Agent 会怎么用"来设计，而不是按内部 API 结构来暴露。

**五条原则（原文归纳）**

| # | 原则 | 原文要点 / 例子 |
|---|---|---|
| 1 | 选对要实现的工具（以及不实现什么） | 别只包装 API 端点。通讯录例子：list_contacts 让模型逐条读完全部联系人（浪费上下文），应实现 search_contacts。用少量"高影响工作流"工具起步，再按评测扩展 |
| 2 | 命名空间 | 按服务（asana_search）或资源（asana_projects_search）分组；前缀 vs 后缀对评测有"非平凡影响"，要按自家评测选 |
| 3 | 返回有意义的上下文 | 优先语义化字段（name / image_url / file_type），避免裸 UUID、mime、缩略图 URL；需要时提供 response_format: concise/detailed 枚举——示例里 detailed 206 token / concise 72 token（约 1/3） |
| 4 | 为 token 效率优化响应 | 分页/范围/过滤/截断 + 合理默认值；Claude Code 默认把单次工具响应限制在 25,000 token；截断与错误信息要"教模型下一步"（错误应可操作，不要裸 traceback） |
| 5 | 对工具描述做提示词工程 | 像给新同事写文档：参数名 user_id 而非 user；写清输入格式、边界、与其他工具的区别、示例；用严格 schema 约束 |

**评测驱动（这门手艺的核心方法论）**

- 先做原型 → 建评测 → 用真实任务反复迭代，而不是先写大量工具。**[官方]**（同上）
- 评测任务要"真实且多步"：官方举例包含"约会议 + 取上次笔记 + 订会议室"、"客户被重复扣款，查日志并判断是否影响其他客户"；弱任务是"搜 customer_id=9182"这种单步查询。
- 指标不能只看准确率：还应记录**工具调用总数、总 token、单次工具耗时、工具错误率**；工具调用模式能暴露该合并的工具。
- 用 held-out 测试集防止对评测过拟合；把 transcripts 丢给 Claude Code 让它批量重构工具与描述（官方称本文多数建议来自这个循环）。
- 反模式：**"先全量返回，再让模型自己筛"**（把确定性系统的处理方式强加给注意力有限的模型）。

**补充：工具描述可以直接改变任务完成时间。** Anthropic 多智能体研究系统里有一个"工具测试 agent"：反复调用有缺陷的 MCP 工具、重写描述，新描述让后续任务完成时间下降 **40%**。**[官方]** [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)（2025-06-13）

## 2. 主线二：上下文工程（context engineering）

来源：[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（2025-09-29）。

**为什么重要**

- 上下文是有限资源、边际收益递减；所有模型都存在 **context rot**，越长越不准，且不是均匀退化。**[官方]**（同上）；独立实证见 [Chroma 的 18 模型报告](https://research.trychroma.com/context-rot) 与 [Lost in the Middle](https://arxiv.org/abs/2307.03172)（相关信息在开头/结尾最易用，中段显著退化）。
- 目标是"**找到最小的、高信号的 token 集合**，最大化期望结果"；这比"写一个好 prompt"更接近持续运营。

**具体手法**

| 层次 | 做法 | 原文要点 |
|---|---|---|
| 系统提示词 | 正确的高度（right altitude） | 两个失败极端：把复杂 if-else 硬编码进 prompt（脆弱、难维护）vs 过于空泛/假设共享上下文。最优是"足够具体给方向，足够灵活给启发式" |
| 工具 | 最小、清晰、边界明确 | 工具定义与返回值同样是上下文；工具越多越易选错（见 §4 数字） |
| 示例 | 少而精 | 不要把边缘案例堆成清单；动态按需检索比预载更省 |
| 检索 | just-in-time | Claude Code 的混合策略：CLAUDE.md 预载，glob/grep 运行时导航，"绕开过期索引和复杂语法树"；代价是比预计算检索慢，需要好的工具与启发式 |
| 长任务 | compaction / note-taking / sub-agent | 见下 |

- 压缩（compaction）：把接近上限的对话摘要后重开窗口；保留架构决策、未解决 bug、实现细节，丢弃冗余工具输出；Claude Code 的具体做法是摘要 + "最近访问的 5 个文件"。最轻的压缩是 **tool result clearing**（清掉早期工具原始结果）。
- 结构化笔记：NOTES.md/todo 持久化到上下文之外，需要时取回；非代码域同样有效（官方举了 Claude 玩 Pokémon 维护计数与地图笔记）。
- 子代理：子代理在独立上下文里探索（可花数万 token），只回 **1–2k token** 的压缩摘要；主 agent 保持高层计划。
- 结论句："**do the simplest thing that works**"；模型越强，越应把决策交给模型，减少人工编排。**[官方]**

**多智能体的成本/收益（同团队，2025-06）**：多智能体（Opus 4 lead + Sonnet 4 子代理）在内部研究评测上比单 agent 高 **90.2%**；代价是聊天 4× token、多智能体 15× token；BrowseComp 上 token 用量解释 80% 的性能方差；并行子代理把复杂查询耗时最多降 90%。**[官方]** [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)

**厂商经验补充（Manus，2025-07-18）**：其公开经验把 **KV-cache 命中率**列为生产 Agent 第一指标（缓存输入价格可差 10×），做法包括稳定前缀/只追加、用 logit mask 而不是删工具（"mask, don't remove"）、把文件系统当外部记忆、用 todo 复述目标、保留错误轨迹让模型自纠。**[厂商]** [Context Engineering for AI Agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)（正文为 JS 渲染，本次未逐字抓取，见 §12；要点与 Anthropic/DSH 实践一致）

## 3. 主线三：从"工具调用"到"代码调用"（Code Execution / Code Mode）

**问题（MCP 规模化的两个 token 黑洞）** **[官方]** [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)（2025-11-04）
1. 工具定义全量预载：数百/数千工具、数十万 token，还没读用户请求就先烧掉上下文。
2. 中间结果全部穿过上下文：Drive 文档→Salesforce 的例子，2 小时会议转录约额外 5 万 token，且可能重复一次。

**解法**：MCP 客户端把工具定义**生成成文件系统上的代码 API**（如 ./servers/google-drive/getDocument.ts），Agent 像逛代码库一样列目录、读单个工具签名、在沙箱里写代码调用；结果在代码里过滤/聚合后再 console.log。

- token：150,000 → 2,000（**-98.7%**）；10,000 行表格只回前 5 行。
- 控制流：循环、条件、重试、跨数据源 join 都在一次执行里完成，不必每步一次推理。
- 状态与复用：中间产物落盘；把验证过的代码保存成 ./skills/*.ts，配 SKILL.md 变成可复用技能。
- 安全：PII 可在客户端 token 化后再回填；数据流规则可确定性执行。
- Cloudflare 的独立实践 [Code Mode](https://blog.cloudflare.com/code-mode/)：把整个 API 暴露为 TypeScript 接口，主张"用约 1,000 token 给 Agent 一整个 API"（本次抓取正文被页面导航截断，见 §12；Anthropic 文中明确引用其为同一思路）。

**官方产品化：Programmatic Tool Calling（PTC）** **[官方]** [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- 模型在代码执行环境里调用被标记 allowed_callers 的工具；工具结果先回到代码、不回到模型上下文；只把最终摘要回传。
- 典型场景：Claude for Excel 读写数千行表格；循环轮询 Slack 直到部署完成。
- 与 Tool Search、Tool Use Examples 组合：**先搜工具 → 再写代码编排 → 最后用示例校准参数**。

**代价与边界**：需要可用的沙箱与 broker（无网络直连、凭证留在宿主、逐调用授权、输出过滤/截断）；对"5 个工具的小系统"是过度设计；弱模型写代码 + 读文件回填的失败率可能高于直接调用（见 §6 grep 论文的 programmatic 反例）。**[官方]** MCP 规范 [Client Best Practices](https://modelcontextprotocol.io/docs/draft/develop/clients/client-best-practices) 给出了 Deno/isolated-vm、Monty、pctx、Wasmtime 等沙箱选型与安全清单。

## 4. 主线四：工具膨胀与按需发现（Tool Search / Deferred Loading）

来源：[Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)（2025-11-24）与 [MCP Client Best Practices](https://modelcontextprotocol.io/docs/draft/develop/clients/client-best-practices)。

**膨胀的量化**

- 5 个 MCP server：GitHub 35 工具（~26k token）、Slack 11（~21k）、Sentry 5（~3k）、Grafana 5（~3k）、Splunk 2（~2k）——**58 工具 ≈ 55k token**；再加 Jira（~17k）就逼近 100k。
- 失败模式不止成本：**选错工具、传错参数**，尤其名称相近时（notification-send-user vs notification-send-channel）。
- Anthropic 内部优化前见过 **134k token** 的工具定义。

**Tool Search Tool**

- 常驻只放一个 ~500 token 的搜索工具；按需加载 3–5 个相关工具（~3k token）。总上下文消耗 ~77k → **8.7k（-85%）**，"preserves 95% of context window"。
- 准确率同时上升：Opus 4 49%→74%，Opus 4.5 79.5%→88.1%（MCP 评测）。
- 配套 Tool Use Examples：复杂参数场景 72%→90%；但对单参数、显而易见的工具不划算（会增加定义 token）。

**MCP 规范的渐进披露标准模式**（draft 文档）

- 触发阈值：建议按上下文百分比设置（示例 **1%–5%**）；工具定义占比小就别上搜索。
- 三层：**Catalog（search_tools，只回名字+一句话）→ Inspect（get_tool_details，只取目标工具 schema）→ Execute**。
- 目录检索可选 keyword/BM25、embedding、子代理（小模型选工具，效果好但贵）、hybrid。
- 动态 server：维护 registry，按需 enable_server/disable_server，任务结束释放上下文；skill 可声明需要哪些 server。
- **与 prompt cache 的冲突**：中途增删 tools 数组会让前缀缓存失效；规范建议把新定义**追加在缓存断点之后**，或全部调用走一个稳定的 call_tool({name,args}) 元工具，并让 server 断开发生在"会话边界"而非每轮。
- 三种"调用面"可叠加：progressive discovery（控定义进入） + programmatic tool calling（控调用方式） + 输出过滤（控结果进入）。

## 5. 主线五：渐进披露、技能与项目知识（Skills / AGENTS.md / 文件系统）

**Agent Skills（2025-10-16）** **[官方]** [Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- 形态：一个目录 + 必需 SKILL.md（YAML frontmatter 至少 name、description）+ 可选 scripts/references/assets。
- **三级渐进披露**：① 启动时只把 name/description 放进系统提示词（"够判断何时用"）；② 模型认为相关时读 SKILL.md 正文；③ 正文按需引用 reference.md/forms.md 等，理论容量无上限。
- 代码可"作为工具执行"而非读进上下文（PDF 表单解析脚本），兼顾确定性与 token。
- 建设方法：从评测/真实缺口出发；SKILL.md 过长就拆文件、把互斥路径分开；观察真实轨迹迭代；注意恶意 skill 的供应链风险。
- 2025-12-18 起成为跨平台开放标准：[agentskills.io](https://agentskills.io/)；Claude Code 文档明确"skills follow the Agent Skills open standard"。

**项目知识注入的层次**
1. **自动加载的短约定**：CLAUDE.md（Claude Code 自动注入；可放仓库根/父目录/子目录（子目录按需加载）/~/.claude/CLAUDE.md；建议精简、像 prompt 一样迭代）。**[官方]** [Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices)（2025-04-18）
2. **跨工具约定文件**：AGENTS.md——"给 Agent 的 README"，独立于人类 README；官网称 6 万+ 开源项目使用，Codex/Gemini CLI/Cursor/Aider 等均兼容。**[官方]** [agents.md](https://agents.md/)
3. **仓库即知识库**：OpenAI 的 harness engineering 实践（2026-02，官方正文被 JS 拦截，仅二手核验，见 §12）把 AGENTS.md 降为 ~100 行**目录**，指向 docs/（design-docs/exec-plans/generated/references 等），并强调"**Agent legibility**：运行中它无法在上下文里访问的东西等于不存在"；配套文档园丁 agent、lint/结构测试治理文档腐烂。**[二手]** [原文](https://openai.com/index/harness-engineering/)、[摘要转引](https://raw.githubusercontent.com/tim-kaa-py/ai-wiki/f1291d9707416754d7d5cafecb5c94018a45a985/summaries/2026-02-11_openai_harness-engineering-leveraging-codex-agent-first-world.md)
4. **文件系统即记忆**：memory tool / NOTES.md / todo；Claude Code 子代理在独立上下文工作，只回摘要；子代理 description 本身占上下文（合计超 15k token 会告警）。**[官方]** [Subagents](https://code.claude.com/docs/en/sub-agents)

**token/延迟权衡（官方原话的推论）**：预载快但会"腐烂/过期"，运行时探索慢但总能拿到最新内容；Anthropic 建议 **hybrid**——小份稳定知识预载 + 大规模内容 JIT 探索（他们把 CLAUDE.md + glob/grep 当作范例，并指出法律/金融等低动态领域可以更偏预载）。**[官方]** §2 来源；**[推断]** 阅读类产品（书/论文）天然是"低动态、可索引"内容，比代码更适合"预载地图 + JIT 正文"。

## 6. 通用 vs 专用：ACI、shell、grep 与专用索引

**ACI 论文（SWE-agent, NeurIPS 2024）** **[论文]** [arXiv:2405.15793](https://arxiv.org/abs/2405.15793)
- 核心论点：**LM Agent 是新的"最终用户"，需要为它设计接口（Agent-Computer Interface）**；接口设计会改变 Agent 行为与性能，不能直接复用人类 GUI 或裸 shell。
- 四条 ACI 设计原则（原文）：① 动作简单易懂（少选项、简短文档）；② 动作紧凑高效（把高频复合操作压成一个命令）；③ 环境反馈"有信息量但简洁"；④ 护栏（guardrail）阻止错误级联、加速恢复（如编辑后自动 lint/syntax check）。
- 消融反例：给"迭代式逐条搜索结果浏览器"后，Agent 会把每条结果都看一遍，耗尽预算，**性能反而比没有搜索工具更差**；而紧凑的单命令编辑 + 自动反馈显著优于 shell 里 cd/ls/cat/sed 串联。

**"bash is all you need" 的实证** **[官方项目]** [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent)
- SWE-bench 团队一年后的答案：**只用 bash、不给任何专用工具、线性历史、每个动作独立 subprocess.run**，agent 核心约 100 行 Python，SWE-bench Verified **>74%**；README 明确"模型能力变强后，很多特殊接口不再必要"，且单动作无状态 shell 让它天然适配沙箱（subprocess.run 换 docker exec 即可）。这并不否定 ACI，而是说明：**ACI 的价值主要在"模型还不能自己合成"的环节；工具应随模型能力退场**。**[推断]** 二者合并后的原则：先问"通用 bash/文件原语 + 好提示能不能做到"，再问"专用接口是否显著更省/更稳"。

**代码/动作统一为代码：CodeAct 与 CodeAgents**
- CodeAct（ICML 2024）：把动作统一成可执行 Python，17 个模型上比 JSON/文本动作 **成功率高至 20%**，可组合、可自纠。**[论文]** [arXiv:2402.01030](https://arxiv.org/abs/2402.01030)
- CodeAgents（2025）：把 Task/Plan/Feedback/工具调用都写成带控制流与类型的伪代码，GAIA/HotpotQA/VirtualHome 上比自然语言规划 **+3–36 个百分点**，输入 token **-55%~-87%**、输出 **-41%~-70%**。**[论文]** [arXiv:2507.03254](https://arxiv.org/abs/2507.03254)

**grep vs 向量：2026 年的一手对照实验** **[论文]** [Is Grep All You Need? How Agent Harnesses Reshape Agentic Search](https://arxiv.org/abs/2605.15184)（2026-05-14）
- 设置：LongMemEval-S 116 题 × 5 个模型（Claude Opus 4.6/Haiku 4.5、GPT-5.4、Gemini 3.1 Pro/Flash-Lite）× 4 种 harness（自研 Chronos、Claude Code、Codex CLI、Gemini CLI）× inline vs programmatic（结果写文件再由模型读取）。
- **实验 1（inline）**：grep 在每个 harness×模型组合都高于 vector；最大差 Chronos+Gemini Flash-Lite 86.2% vs 62.9%；最小差 Claude Code+Opus 4.6 76.7% vs 75.0%。
- **harness 效应 ≈ 检索器效应**：同一 Opus 4.6，Chronos inline grep 93.1%，Claude Code 只有 76.7%——换 harness 的差距和换检索器一样大。作者结论：所谓"retrieval"其实是 **retrieval + orchestration**（系统提示、工具描述、命中渲染都在塑造搜索策略）。
- **file-based 投递是"工具使用压力测试"**：programmatic 模式下 vector 在 5/10 个组合反超 grep；Codex/GPT-5.4 的 programmatic grep 从 93.1% 崩到 **55.2%**（读文件-整合-重试的循环不够可靠时，再便宜的检索也白搭）。
- **实验 2（噪声递增）**：两种方法都只有轻微退化，grep 平均仍更高（Figure 1）；解释是 LongMemEval 的答案常由"字面证据"许可（日期、计数、偏好），词法匹配是精度偏置，向量是召回偏置（会捞到语义相近的干扰项）。
- **实践含义**：默认词法/精确搜索 + 可选的语义检索作为工具；把"结果投递方式"当成一等设计变量；小模型/弱 harness 不要默认 file-based。**[推断]**

**社区侧的相同观察**：Augment 的 SWE-bench agent 演讲（Colin Flaherty）称 embedding 检索不是瓶颈，grep/find 足够；Agent 的"坚持重试"能弥补工具粗糙；但大代码库、非结构化自然语言、成本/延迟场景仍需 embedding，最佳形态是"把向量检索作为工具暴露给 Agent"。**[社区]** [演讲笔记](https://github.com/jxnl/systematically-improving-rag/blob/e0957c23/docs/talks/colin-rag-agents.md)

**何时"必须"专用索引（判断清单）**

| 信号 | 说明 | 对应设计 |
|---|---|---|
| 语料规模大 + 全扫描成本高 | 单本书 grep 够用，全库/全文件夹不行 | FTS/倒排 + 向量，search 工具内部路由 |
| 查询语义模糊/同义表达多 | 用户问"作者对失败的看法"没有字面串 | 向量/混合检索，返回 chunk + 摘要 |
| 非文本模态 | 图、表、公式、扫描页 | 图注/图表索引 + view 返回图像/页面 |
| 跨文档关系 | 引用图、同一概念在不同论文的上下文 | 图索引/引用表 + 锚点跳转 |
| 需要确定性/权限过滤 | 只允许检索用户选中的范围 | 索引层做 scope 过滤，而非提示词约束 |
| 高频 + 固定输出形状 | 每周几十次的"总结本章" | 任务形状工具（getCustomerContext 模式） |

## 7. 检索与导航设计：先目录后局部读

**navigation 模式（跨来源一致）**
1. 顶层先给"地图"：目录/大纲/文件树/论文 TOC，条目带 id、层级、字数/块数、是否已索引。官方说法：文件大小、命名、时间戳都是给 Agent 的信号（progressive disclosure 的元数据层）。**[官方]** §2
2. 再按锚点读局部：read(anchor, offset, limit)，带行号/字符偏移、total、next_offset、截断原因；绝不"整书/整篇 dump"。
3. 搜不到时给"下一步建议"（换关键词、扩大 scope、用向量检索），而不是空结果。
4. 结果投递默认 inline 小结果；大结果写文件/给指针（并确保模型能可靠读回，见 §6 反例）。
5. 子代理做"深挖"：把大量搜索/阅读隔离在子上下文，只回结论与引用锚点。

**多智能体的提示词经验（可直接移植）**：先宽后窄（short broad queries → 逐步收窄）、先看全部工具再匹配意图、优先专用工具、给显式启发式而非硬规则、guardrail 防失控。**[官方]** [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)

**token 成本与延迟的权衡表（综合 §2–§4）**

| 策略 | 上下文成本 | 延迟/工程成本 | 适用 |
|---|---|---|---|
| 全量预载（提示词/工具定义/全文） | 高，持续占用 | 低 | 小而稳定（<1–5% 上下文） |
| 目录 + 按需读（JIT） | 低 | 中（多轮） | 书/论文/代码库等可导航内容 |
| 预计算索引（向量/FTS） | 低（只回结果） | 建索引/同步成本 | 大规模、语义查询 |
| 代码执行/文件投递 | 最低（只回摘要） | 沙箱 + 模型能力要求 | 批量/跨源/长结果 |
| 子代理 | 主上下文低 | token 总量高（约 15×） | 并行探索、研究型任务 |

## 8. 多模态：Agent 如何"看文件"

**一手事实（Claude Code Read 工具）** **[官方]** [tools reference](https://code.claude.com/docs/en/tools-reference)
- 图片（PNG/JPEG/GIF/WebP）**作为 visual content 返回**，不是原始字节；大图自动缩放/重压缩；>128MB 直接拒绝并提示先裁剪/压缩；细节不够时建议用 ImageMagick 裁剪后再读。
- PDF：短 PDF 整读；>10 页按 pages 分段（如 "1-5"，一次最多 20 页），用 pdftoppm 渲染页面；没有 poppler 会报明确错误。
- 文本文件默认单次最多 25,000 token；>256KB 走分页/搜索；allow_large 时按剩余上下文窗口动态放宽；图片/PDF/notebook 限制不变。
- 默认把 Glob/Grep 在 macOS/Linux/WSL 上设为"默认不存在"（由 Bash 覆盖）——这是"通用原语优先"的又一信号。**[官方]**（同上）；**[推断]** 平台差异也说明：工具面应随环境能力裁剪，而不是强行统一。

**截图反馈闭环**：Anthropic 的 computer use 模型（2024-10）就是"看截图 → 数像素移动光标 → 点击 → 再看新截图"的循环；训练中"数像素"是关键能力。**[官方]** [Developing a computer use model](https://www.anthropic.com/research/developing-computer-use)。浏览器自动化 MCP（如 [Playwright MCP](https://github.com/microsoft/playwright-mcp)，本次未抓取正文）把"页面快照/截图"作为工具暴露，Agent 用"操作-截图-自检"闭环验证 UI 结果。**[推断]** 对阅读器/排版类产品，截图同样是"渲染结果是否符合预期"的唯一可靠信号。

**PDF 处理建议（合并官方事实 + 推断）**
- 双通道：文本层用于检索/引用（精确、便宜），页面图像用于版面、图表、公式（贵、按需）。**[推断]**
- 分段读：按页范围/章节锚点读，避免整 PDF 进上下文；对扫描版先 OCR/转 markdown（SageRead 的 convertPdf/processPaper 方向正确）。
- 图表不是"读一次就完"：getFigures 这类工具应返回**图注 + 锚点 + 所在小节**（便宜的定位信息），真正 view 图片留给确认环节。

**是否值得给 Agent 一个通用 view_image？** **[推断]**
- 不建议作为**独立上层工具**：Claude Code 已证明把图片/PDF 并入 Read（按路径）最省定义与选择成本；独立 view_image 只在"图不是文件、而是需要检索/定位的实体"时才有价值。
- 推荐形态：read(path|anchor) 内部分派 → 文本返回文本、图片返回 content block、PDF 返回页图；再加一个**领域锚点** figure(paper_id, fig_no|query) 负责"找图/定位图"，其返回值仍是锚点 + 元数据，读图动作复用 read。
- 成本控制：一次一张、按需缩放/裁剪、单轮多图上限、旧轮次图片降级为存根 + 可重看工具。SageRead 已有 readImage 的"图片一次性（D4）"实现，正是这个模式（见 §10）。

## 9. 纸面结论：三层设计原则

**L1 通用原语层（少量、稳定、可组合）**

| 原语 | 职责 | 必须提供 |
|---|---|---|
| outline(scope) | 地图/目录 | 层级、id、字数/块数、是否索引、摘要 |
| search(query, scope, sources) | 找位置 | 返回锚点 + 片段 + 来源类型 + 总数；支持词法/向量/图注/引用；分页 |
| read(anchor, offset, limit) | 读局部 | 行/字符偏移、total、next、truncated 原因、估算 token |
| view(anchor) | 非文本 | 图片/PDF 页 → content block；缩放/裁剪参数 |
| write/edit（可选） | 落盘 | 沙箱/权限、确认卡 |
| exec（可选） | 批处理 | **仅在有沙箱与权限模型时**；桌面产品可先用"预置管道"替代 |

**L2 领域锚点层（领域知识沉淀为"地址 + 解析器"，不是新工具名）**
- 统一 URI：book:<id>/<md_path>#<heading>、paper:<id>#<heading>、chunk:<chunk_id>、figure:<paper_id>:<fig_no>、cite:<paper_id>:<ref_no>。
- 解析器负责"人话 → 锚点"：章节号 5.8、标题模糊匹配、图号、"上一篇/下一节"、阅读位置。
- 保留少量"答案形状"的锚点器工具：getFigures（图注+锚点）、getCitations（引用边），它们的高价值是**返回 id 而不是全文**；读取交给 L1。
- 结构索引（TOC、chunk 邻接、图注、引用图、AGENTS/README 地图）属于 L2 数据层，不对模型暴露成多个 API。

**L3 约定与提示层（最便宜、迭代最快）**
- 系统提示词写"导航协议"：先 outline 后 read；单次读多少；何时停；引用格式；scope 边界；禁止全量 dump。
- SKILL.md 承接"怎么做"（论文精读、综述、引用核查、章节摘要），名称/描述常驻、正文按需。
- AGENTS.md/CLAUDE.md 承接"这个产品/项目的约定"（SageRead 可考虑工作区级 AGENTS.md）。
- 工具描述本身是 L3：写"何时用/何时不用/示例/边界"。
- 目录牌/tool search 是 L1 与 L3 的接口：预算阈值（如 >30 工具或 >12k 字符）时降级为目录 + describe/use。

**判断"该不该做专用工具"的 checklist（打分制）**

| 维度 | 问题 | 高分信号 |
|---|---|---|
| 频次 | 真实用户任务里出现频率？ | 每周多次、跨会话重复 |
| 通用性 | 用 L1 原语 + 2–3 步提示能否等价？ | 不能，或需要模型做领域推理（如"5.8 节"解析） |
| token/步数 | 相比原语组合省多少？ | 省 ≥50% token 或 ≥2 次调用 |
| 确定性 | 是否要求严格输出/权限/顺序？ | 是（如引用格式、权限过滤） |
| 可评测性 | 能否写 10–20 道有标准答案的题？ | 能，且失败可归因 |
| 可恢复性 | 出错时模型能否自纠？ | 错误信息可操作、结果可重试 |
| 维护成本 | 是否引入第二套数据/索引？ | 复用现有索引/锚点而非新建 |
| 风险 | 是否扩大写/外发/执行面？ | 不扩大，或已有权限模型 |

决策规则（建议）：**≥3 个高分信号 → 做专用工具；能拆成 2 步原语 → 合并；只是知识/流程 → 写成 skill/提示；只是"语义模糊/规模大" → 做索引，不做工具。**

## 10. 对领域型 Agent（非代码）的移植建议（SageRead）

**现状事实（只读代码，2026-10-21）**
- 工具体系按 scope 组装：central/reader/paper/shared/mcp，注册框架见 packages/app/src/ai/tools/registry.ts:1-10,73-92；工具文件约 60 个，书/论文各有一套 RAG/读取工具（rag-*、read-book-section、paper/*）。
- 已有 **D8 工具目录牌**：工具 >30 个或 schema >12k 字符时切换 describeTool/useTool（lazy-toolset.ts:14-15,86-150），机制对齐 MCP 渐进披露——这是很好的既有基础，下一步可从"固定目录牌"升级为"检索式 tool search"。
- 已有 **技能系统雏形**：getSkills 从数据库按任务名取 SOP 全文（get-skills.ts:1-80）；可升级为 SKILL.md 三级披露（name/description 常驻、正文按需）。
- 已有 **图片一次性（D4）**：历史轮次图片降级为存根，readImage 按 attachment:// 重看（read-image.ts:5-18）；与 §8 的成本控制结论一致。
- 已知缺口（既有审计 docs/audits/agent-figure-and-cross-document-capabilities.md）：论文图片只能看清单不能看；跨文献"打开某篇 5.8 节"无工具；paperContext 不跨论文；一书一向量库、无跨书检索。

**分阶段建议**

| 阶段 | 动作 | 依据 |
|---|---|---|
| P0（低风险、先做） | 统一 read/search 结果信封（anchor/offset/total/next/truncated/token_est）；把书/论文重复实现收敛为同一实现 + 命名空间；给所有工具描述补"何时用/不用/示例"；建 30 题真实任务评测（准确率、调用数、token、错误率、引用正确率） | §1、§7 |
| P1（核心） | 落 L1 四原语：outline（书/论文/文件夹/全库）、search（词法 + 向量 + 图注 + 引用统一入口，按 sources 路由）、read（按锚点/偏移读任一篇章）、view（图/PDF 页）。锚点 URI 作为协议在系统提示与工具间共享 | §6、§9 |
| P2（降本） | 目录牌 → tool search（BM25/embedding 检索工具描述，阈值参考 MCP 1%–5%）；技能 SKILL.md 化（论文精读/综述/引用核查/章节摘要），正文带脚本（如"章节摘要模板"） | §4、§5 |
| P3（可选，谨慎） | 不做完整代码沙箱（桌面端风险/成本高）；先做**预置批处理管道**满足跨文献需求（如"多篇命中块合并上下文"、"图注批量扫描"），等价于把 code mode 的收益以确定性工具兑现；若未来做，参照 MCP 沙箱清单（无网络、宿主 broker、逐调用授权） | §3 |

**工具处置建议（按 §9 checklist，逐条可再评估）**

| 现有工具 | 建议 | 理由 |
|---|---|---|
| readBookSection、readPaperSection、readPaperFull、ragRange | 合并为 read(anchor, offset, limit) + 锚点解析器 | 都是"按位置读"，差异只在解析层 |
| ragToc、getPaperToc、getPaperInfo | 收敛为 outline(scope)（信息类字段并入 outcome） | 目录是地图，不是读取 |
| ragSearch、paperSearch、sciverseSearch、searchFiles | 统一 search(query, scope, sources)；学术外部检索保留独立源 | 同一动作不同数据源；应做路由而非多工具 |
| ragContext、paperContext | 变成 read 的扩窗参数（before/after）或 expand(chunk) | 高频但只是"读邻近块" |
| getFigures、getCitations | 保留为 L2 锚点器（返回 id/图注/引用边，不返回全文）；新增 view(figure:...) 读图 | 领域语义强、频次中高、可评测 |
| readImage | 保留；扩展支持库内图片路径（不只 attachment） | 复用 D4 预算机制；避免新工具 |
| readLocalFile、searchFiles、writeFile、editFile | 保留为通用文件原语；明确 scope 与权限；读文件统一带行号/offset | 工作区是 Agent 的"文件系统记忆" |
| readAtReadingPosition | 保留为阅读位置锚点器（返回锚点 + 窗口），不做独立读取语义 | 位置是 L2 知识 |
| getSkills | 改为"目录常驻 + readSkill(name)"的 SKILL.md 模式（若暂不改协议，至少只返回匹配项的摘要+全文两级） | §5 渐进披露 |

**评测与缓存（容易忽略的两点）**
- 评测：先 30–50 题（书：定位/总结/跨章对比；论文：方法/实验/图注/引用），A/B 旧工具 vs 新原语；指标含 **首 token 延迟**与**上下文占用**；held-out 防过拟合。参考 [Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)（2026-01-09）。
- 缓存：工具定义与系统提示的稳定前缀不要每轮变；动态内容（当前阅读位置、当前时间）放尾部——SageRead 已有"位置/时间动态段"设计，重构工具面时不要破坏；MCP 规范同样警告中途改 tools 数组会击穿 prompt cache。**[官方]** [MCP Client Best Practices](https://modelcontextprotocol.io/docs/draft/develop/clients/client-best-practices)

**风险清单**
- 弱模型/本地模型：file-based 投递与 code mode 对"读-整合-重试"能力要求高（§6 反例），SageRead 用户可能挂本地小模型 → 默认 inline，file-based 作为可选。
- 中文检索：grep/FTS 依赖分词与大小写/标点归一化；中文书名、章节号、图号要做归一化（SageRead 已有"5.8 数字匹配"经验，应保留）。
- 权限：桌面端读本地文件、写笔记、HTTP 外发必须有统一 guard/确认卡；代码执行面不要轻易引入。
- 评测成本：没有评测就没有"删工具"的勇气；建议先攒真实失败轨迹（transcripts）再删。

## 11. 未解问题（值得后续实验）

1. **inline vs 文件投递**在阅读场景（单篇论文/单本书）是否也有 grep 论文那样的反转？需要 SageRead 自己的 A/B。
2. **tool search 的检索质量**：工具描述用 BM25/embedding/子代理哪种？多语言（中英混合工具名）如何？
3. **锚点 URI 的模型可学性**：模型是否会稳定使用 book:id/path#heading？需要 few-shot 与错误提示设计。
4. **压缩策略**：阅读类会话的"最近 5 个文件"应换成"最近 3 个锚点 + 当前阅读位置"？
5. **图/表的 token 预算**：单轮最多几张、是否必须先图注定位再读图、能否用低分辨率缩略图做"是否值得看"的判断？
6. **skill 的触发精度**：name/description 常驻会不会造成误触发？Claude Code 用 description + 显式调用双通道，SageRead 需评测。

## 12. 来源、核验状态与抓取限制

**核心官方来源（均已抓取正文）**

| 主题 | 来源 | 日期 |
|---|---|---|
| 工具设计五原则/评测 | https://www.anthropic.com/engineering/writing-tools-for-agents | 2025-09-11 |
| 上下文工程 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | 2025-09-29 |
| 代码执行 with MCP | https://www.anthropic.com/engineering/code-execution-with-mcp | 2025-11-04 |
| 工具搜索/PTC/示例 | https://www.anthropic.com/engineering/advanced-tool-use | 2025-11-24 |
| Agent Skills | https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills | 2025-10-16 |
| Building effective agents（workflow vs agent；ACI 附录） | https://www.anthropic.com/engineering/building-effective-agents | 2024-12-19 |
| Claude Code best practices | https://www.anthropic.com/engineering/claude-code-best-practices | 2025-04-18 |
| 多智能体研究系统 | https://www.anthropic.com/engineering/multi-agent-research-system | 2025-06-13 |
| Agent 评测 | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents | 2026-01-09 |
| Computer use（截图循环） | https://www.anthropic.com/research/developing-computer-use | 2024-10-22 |
| Claude Code 工具参考（Read 图片/PDF、25k token） | https://code.claude.com/docs/en/tools-reference | 持续更新 |
| Claude Code 子代理（上下文隔离） | https://code.claude.com/docs/en/sub-agents | 持续更新 |
| Claude Code skills（开放标准） | https://code.claude.com/docs/en/skills | 持续更新 |
| MCP 客户端最佳实践（渐进披露/Code Mode/沙箱） | https://modelcontextprotocol.io/docs/draft/develop/clients/client-best-practices | draft |
| AGENTS.md | https://agents.md/ | 持续更新 |
| Agent Skills 开放标准 | https://agentskills.io/ | 2025-12 |

**论文**

| 主题 | 来源 |
|---|---|
| SWE-agent / ACI（NeurIPS 2024） | https://arxiv.org/abs/2405.15793 |
| Is Grep All You Need?（2026-05-14） | https://arxiv.org/abs/2605.15184 |
| CodeAct（ICML 2024） | https://arxiv.org/abs/2402.01030 |
| CodeAgents（2025） | https://arxiv.org/abs/2507.03254 |
| Lost in the Middle（TACL 2023） | https://arxiv.org/abs/2307.03172 |
| Context Rot（Chroma，2025-07-14） | https://research.trychroma.com/context-rot |

**厂商/社区**

| 主题 | 来源 | 状态 |
|---|---|---|
| Cloudflare Code Mode | https://blog.cloudflare.com/code-mode/ | 正文被导航截断，仅核验标题与 Anthropic 转述 |
| mini-swe-agent（bash-only，>74%） | https://github.com/SWE-agent/mini-swe-agent | README 已核验 |
| Manus context engineering | https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus | 页面 JS 渲染，正文未逐字抓取；要点按公开转述（KV-cache/文件记忆/复述/保留错误） |
| OpenAI harness engineering | https://openai.com/index/harness-engineering/ | 官网 JS 拦截；仅通过二手摘要核验（AGENTS.md 当目录、docs/ 为 system of record、agent legibility） |
| Augment 演讲笔记（grep/embedding） | https://github.com/jxnl/systematically-improving-rag/blob/e0957c23/docs/talks/colin-rag-agents.md | 已核验（演讲笔记，非官方博客） |
| Playwright MCP | https://github.com/microsoft/playwright-mcp | 本次抓取 DNS 失败，仅作示例引用 |

**抓取失败与替代**

- Anthropic API 文档（vision / pdf-support / programmatic-tool-calling / tool-search-tool 的 .md 路径）在本次环境出现跨域重定向循环（platform.claude.com ↔ anthropic.com），正文未取到；相关结论改用 Claude Code tools reference 与官方工程博客，规范 URL 仍列出供复核。
- HuggingFace 站点 DNS 失败，CodeAgents 改用 arXiv 原文（2507.03254）核验。
- 本笔记中的产品数字（token、百分比、准确率）均来自上述页面原文；**[推断]** 部分为设计判断，不作为事实引用。
