# Codex 与 Claude Code 能力调研：Craft Workbench 接入建议

调研日期：2026-10-29。范围是本地 CLI 和桌面使用体验；官方最新文档描述的能力不等于本机已安装版本支持。实际接入应探测版本和协议能力，并分别验证 macOS、Windows、Linux。

## 判断

建议把 Workbench 做成两个原生 agent 的工作界面：CLI/SDK 保持各自的会话、工具、插件和权限语义，Craft 负责项目、交互和执行状态。首先修复可靠性和交互闭环，再逐步呈现高级能力；页面默认只呈现项目、工具、模型、权限和输入。

## 原生能力对照

| 能力 | Codex CLI / app-server | Claude Code / Agent SDK | Workbench 建议 |
| --- | --- | --- | --- |
| 会话 | app-server 提供 thread 创建、列表、读取、恢复、归档及流式事件；具体以安装版本 schema 为准。 | SDK 提供 `listSessions()`、`getSessionMessages()` 和 resume；工作目录和实际存储环境影响可见范围。 | 按真实项目分组，列出本机已有会话、预览历史并继续；Craft 只保存关联和工作台状态。 |
| 模型 | `model/list` 提供候选；模型列表不保证账号可用，需以实际请求结果为准。 | SDK 的模型能力按已安装版本查询；CLI `/model` 是交互式设置命令。 | 显示动态候选，用户明确选择；失败时呈现真实原因，不能把模型别名大小写差异当成身份不同。 |
| 流式进度 | app-server 发送回合、消息、工具及完成事件。 | SDK 支持实时流式消息、工具调用和结果。 | 按消息、执行、结果分组显示，保留出错、取消、未确认状态。 |
| 权限与提问 | app-server 支持审批请求；具体字段及实验特性以本机协议为准。 | `canUseTool` 处理审批；`AskUserQuestion` 提供单选、多选问题。 | 在当前会话内处理，区分审批和问答；避免重复提交。三类权限仅作呈现层映射，需展示各引擎真实行为与差异。 |
| 队列与中途指导 | 原生产品区分 queue（下一回合）和 steer（指导当前回合）；app-server 有 `turn/steer`。 | CLI 队列可在工具调用结束后进入同一回合，命令通常等待回合结束；立即发送的行为依当前工作而变化。 | 默认排队、允许撤回或明确立即发送；不要声称两个引擎有相同的时序或将中断伪装成 steer。SDK 的等价能力需针对安装版本实测。 |
| 技能和插件 | 技能可显式调用；插件可包含技能、MCP 和应用，插件不是简单等同一个技能。app-server 的相关发现和调用能力随版本变化。 | 桌面端输入 `/` 浏览内建命令、用户和项目技能以及插件技能；插件还可包含代理、hook、MCP、LSP。 | 输入 `@` 可作为 Craft 自己的检索入口，但选中后必须转成该引擎支持的原生引用；显示来源和类型，无法验证调用时不假装支持。 |
| 工作模式 | 原生产品提供 Plan、Goal 等能力，部分依赖产品或实验协议。 | 支持计划模式及权限模式；CLI 命令和 SDK 接口并非一一对应。 | 把“计划/执行”与权限分开；先接入经过协议及版本验证的模式。 |
| 文件与变更 | 官方产品提供附件、worktree、代码审查和差异查看。 | 桌面提供文件附件、diff、Git 隔离、内置终端和预览。 | 先呈现文件引用、变更列表与 diff；不要自动创建 worktree 或覆盖用户已有修改。 |
| 扩展 | MCP、技能、插件和连接器；app-server 提供相关能力，但可能受协议版本及账号环境限制。 | SDK 支持 MCP、技能、插件；桌面有连接器浏览和管理。 | 先只读展示当前可用项和状态，后续再增加安装及配置，敏感授权仍走原生流程。 |

来源：[Codex app-server 协议](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)、[Codex 集成分层](https://developers.openai.com/blog/codex-as-a-platform)、[Codex 模型目录说明](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)、[Codex Queue 与 Steer](https://developers.openai.com/blog/mastering-codex-remote-for-engineering)、[Claude 会话 SDK](https://code.claude.com/docs/en/agent-sdk/sessions)、[Claude 交互与队列](https://code.claude.com/docs/en/interactive-mode)、[Claude 问答和审批](https://code.claude.com/docs/en/agent-sdk/user-input)、[Claude 桌面参考](https://code.claude.com/docs/en/desktop)。

## 体验顺序建议

1. **可靠对话**：进程生命周期、流式状态、断线恢复、原生历史、会话占用提示与经身份确认的接管；等待、失败、结果未知分开表示，结果未知不自动重发。
2. **用户可控制**：页面内审批和问题回答、停止、可见的排队项、撤回和立即发送；模型和权限展示生效范围。
3. **能力入口**：输入 `@` 展示上下文相关的文件、技能、插件；`/` 命令单独处理，模型切换走控件或引擎支持的调用。用户选择时展示名称、来源和描述。
4. **工作结果**：项目文件、命令执行状态、修改列表和 diff；再考虑 worktree、终端、预览和代码审查。
5. **高级能力**：插件及 MCP 管理、多代理、计划和目标、定时任务等，按场景逐项接入并保持默认界面简洁。

## 桌面参考与边界

- Codex 官方展示的远程交互包含会话组织、队列/引导、技能、插件、附件、worktree 和审查；这篇文档是产品体验参考，不能证明本机 app-server 逐项可用。[来源](https://developers.openai.com/blog/mastering-codex-remote-for-engineering)
- Claude Code 桌面支持 `/` 选择技能、项目隔离、差异审查、会话和连接器等。插件、连接器能力按本地、SSH、云和 WSL 环境有区别，不能直接推断 Craft 支持。[来源](https://code.claude.com/docs/en/desktop)
- Claude 原生 CLI 处理队列的时间点并不总是等待整个回合结束；它与 Codex 文档中的 Queue 定义不同，设计需标明 Craft 采用的具体语义。[来源](https://code.claude.com/docs/en/interactive-mode)
- `AskUserQuestion` 官方文档说明每次 1–4 个问题、每题 2–4 个选项，并说明 Agent 工具派生的子代理目前不支持该工具；客户端需处理版本差异。[来源](https://code.claude.com/docs/en/agent-sdk/user-input)
- 当前只做资料调研，未执行真实端到端验收；具体已实现与缺失功能须以当前仓库代码和实际运行结果为准。
