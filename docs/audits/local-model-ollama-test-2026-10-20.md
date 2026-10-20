# 本地模型（Ollama）实测记录（2026-10-20）

> 缘起：用户反馈「Ollama 本地向量模型报 failed to fetch（未复现）」，仓库从未实测本地模型链路。
> 本文记录排查结论、修复项与实测过程/结果，供后续维护参考。以代码为准。

## 1. 结论速览

| 项 | 结论 |
| --- | --- |
| failed to fetch 根因 | **正式版 Windows 页面 Origin 是 `http://tauri.localhost`，Ollama 默认 CORS 白名单不含它** → 渲染进程 `fetch` 直连 localhost 被 CORS 拦（dev 的 `http://localhost:1420` 在白名单内，所以只在正式版复现、开发环境永远复现不了）。Rust 侧向量化（reqwest）无 CORS，故"索引能跑、测试按钮/句对齐挂" |
| 修复 | 设置页连接测试（`vector-model-manager.tsx`）与句对齐批量 embed（`paper-alignment-service.ts`）改走 `@tauri-apps/plugin-http`（Rust 侧出网、无 Origin、绕 CORS；capabilities 已放通 `http://*:*`），并补连接失败错误翻译（提示 Ollama 未启动） |
| 本地可用路径（Windows） | 仅**外部本地服务**（Ollama / Xinference / llama.cpp server / TEI）。App 内置 llama.cpp（GGUF 下载）UI 被 `isMacOS` 包住，Windows 不可用；用户 2026-10-20 拍板**不做 App 内 GGUF 下载服务** |
| 本地 LLM | 走「自定义 OpenAI 兼容 provider」`http://127.0.0.1:11434/v1`，模型走 `/v1/models` 自动发现；factory 默认分支即 openai-compatible + plugin-http |

## 2. 实测环境（含一个晚上的踩坑记录）

- Ollama 0.40.2（用户安装于 `F:\Ollama`，模型目录实际 `F:\ProgramFiles\ollama_models`，与用户环境变量 `F:\OllamaModels` 不一致——建议统一）
- 测试模型：向量 `embeddinggemma-2:440m`（2026-10 新版，多模态/多语言，维度待实测）；LLM `qwen3.8:27b-q4_K_M`
- 机器：RTX 5070 Ti Laptop / 31.4GB RAM / F 盘 1.38TB 空闲
- **Ollama 版本坑**：用户装的是 0.40.2，而 2026-10 的 embeddinggemma-2 / qwen3.8 系列模型要求 runner ≥ 0.40.4（`ollama pull` 报 `model requires ollama version v0.40.4 or newer`）。官方安装器（1.48GB，Ollama 自身 updater 已缓存）需要点一次 UAC，静默安装被拒；本次改用 **portable zip 0.40.6**（`F:\Ollama-0.40.6\bin`）+ 显式 `OLLAMA_MODELS` 起 `ollama serve` 完成测试，用户侧正式安装仍建议手动点更新。
- **代理/TUN 坑**：用户开启 Clash TUN + fake-ip（198.18.0.0/15）后，Ollama 下载器的 SSRF 防护会把 CDN 重定向目标判为"非公网 IP"直接拒绝（`redirect target not allowed ... resolves to non-public 198.18.1.50`）；而 Ollama 是 Go 程序、默认不读 Windows 系统代理。最终模型文件改从 **ModelScope 镜像**取 GGUF（`unsloth/Qwen3.8-27B-GGUF`、`ggml-org/embeddinggemma-2-GGUF`），再 `ollama create` 导入，绕开 registry 下载链路。
- 模型目录：实际 `F:\ProgramFiles\ollama_models`，与用户环境变量 `F:\OllamaModels` 不一致（历史安装配置残留），后续建议统一。

## 3. 实测过程与结果

### 3.1 向量模型（embeddinggemma-2:440m）

`ollama show`：arch `gemma-embedding2`，271M 文本编码器 + 167M vision projector（CLIP），Q8_0，262144 上下文，requires 0.40.4；Ollama 常驻显存 486MB，**100% GPU**。

| 项 | 结果 |
| --- | --- |
| `/api/embed` 输出维度 | **768**（初次冷加载 64s；热身后单条 0.15s、16 条批量 0.32s） |
| App 连接测试等价路径（`embedBatch` → plugin-http） | 2 条文本 103ms，维度 768 自动识别通过 |
| 书索引（《伊豆の踊子》，568 chunks） | `indexEpub` 成功，25.6s（≈45 chunks/s，Rust reqwest → Ollama） |
| 语义检索（`search_db`，query「舞女」） | 570ms，top 命中相似度 0.40，内容为相关日文段落；返回 chunk 31/166/57 |

> 结论：**本地嵌入链路（设置 → 向量化 → 检索）在 Windows 上全链路可用**，速度满足日常使用；CORS 修复后的 plugin-http 通道实测穿透成功（`/api/version` 与 `/api/embed` 均从页面内调用成功）。

### 3.2 本地 LLM（qwen3.8:27b-q4_K_M）

导入方式：Ollama registry 下载受 TUN/代理坑（见 §2），最终从 ModelScope 镜像 `unsloth/Qwen3.8-27B-GGUF` 取 `Qwen3.8-27B-UD-Q4_K_M.gguf`（16,464,440,224 B，15.33GiB，单连接约 15-17MB/s）→ `ollama create qwen3.8:27b-q4_K_M -f Modelfile`。

`ollama show`：arch `qwen35`，27.3B 参数，262144 上下文，Q4_K_M，capabilities = tools / thinking / completion。

| 项 | 结果 |
| --- | --- |
| 加载 | 首载约 16.8s；常驻 16GB，**39% CPU / 61% GPU**（12GB 显存装不下 16GB 模型，自动分层） |
| 冷启动首问 | 总 65s（含 load 16.8s + prompt_eval 40.5s 首次图编译），24 tokens 生成 3.06 tok/s |
| 热身后生成 | 75 tokens / 9.3s ≈ **8.06 tok/s**（prompt_eval 0.6s），中文质量良好、思维链正常 |
| App 内 OpenAI 兼容通道 | `/v1/models` 自动发现 2 个模型 220ms（plugin-http → Rust）；`createModelInstance` + `generateText` 实跑成功（4.5s，usage 正常；thinking 模型 32 输出 token 全被思维链吃掉时 text 为空属预期） |

> 结论：**本地 LLM 在 App 里可用**（自定义 provider `http://127.0.0.1:11434/v1` + `/v1/models` 自动发现 + 聊天/工具链路），27B Q4 在这台 12GB 显存机器上约 8 tok/s，适合试用/辅助任务，日常长文对话偏慢。

## 3.3 测试后状态（已恢复/保留）

- **保留**：Ollama 模型 `qwen3.8:27b-q4_K_M`（16GB）+ `embeddinggemma-2:440m`（671MB），模型库总量 16.83GB（已清掉 registry 下载残留的 16.25GB partial 临时文件）；App 内保留「Ollama 本地」自定义 provider 与本地向量模型条目（均未设为当前，方便以后一键切换）。
- **恢复**：dev 实例当前向量模型 = 智谱 `embedding-3`（2048 维），《伊豆の踊子》已用云端模型重建索引并回写 metadata（568 chunks / 2048 维 / success）；当前聊天/辅助模型 = DeepSeek `deepseek-flash`。
- **官方 Ollama 待升级**：测试用的是 portable 0.40.6（`F:\Ollama-0.40.6\bin`，配 `F:\Ollama-0.40.6\start-portable.ps1` 启动；官方安装器 0.40.6 已由 Ollama 自己缓存在 updater 里，用户点一次更新即走正规安装）。官方 0.40.2 服务当前已停止，重启机器后托盘会以 0.40.2 启动，**新模型将不可用** —— 建议尽快完成官方升级。
- **目录统一建议**：Ollama 实际模型目录 `F:\ProgramFiles\ollama_models`，与用户环境变量 `F:\OllamaModels` 不一致，建议升级后统一（会涉及移动模型文件，先确认再动）。

## 4. 已知限制 / 待办（含管理小抄）

- **接入口径**：Windows 上本地模型只走外部服务（Ollama 等）；App 内置 llama.cpp GGUF 下载 UI 为 macOS-only，且用户已拍板不做 App 内 GGUF 下载服务。
- **换向量模型 = 旧索引失效**：本次实测 local 768 维与云端 2048 维互不兼容，切换后必须重向量化；测试书已恢复云端索引。
- **速度参考**：本机 27B Q4 约 8 tok/s（61% GPU）；embedding 热身后单条 0.15s、批量 16 条 0.32s、书索引约 45 chunks/s。
- **Ollama 管理小抄**：
  - `ollama list` / `ollama ps` / `ollama show <model>`；`ollama rm <model>` 释放空间；
  - 模型目录 `F:\ProgramFiles\ollama_models`（`blobs/manifests`）；服务端口 127.0.0.1:11434；
  - 走代理下载时 Go 需显式 `HTTPS_PROXY` 环境变量（不读 Windows 系统代理）；TUN 的 fake-ip 会触发 SSRF 保护，建议下载时关 TUN 或绕过；
  - 删除模型 = `ollama rm`；本机当前占用约 16.8GB。

- **Ollama 版本/升级**：新模型需 ≥ 0.40.4（0.40.2 报 `model requires ollama version v0.40.4 or newer`）；官方安装器升级需点一次 UAC，未完成前用 portable 版。
- **跨平台**：移动端 / macOS / Linux 适配暂未开始（无 Mac 硬件），跨平台调试路径待议（见 backlog 搁置区）。
