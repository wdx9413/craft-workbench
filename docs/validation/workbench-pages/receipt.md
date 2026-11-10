# Workbench 全页面首轮验收记录

日期：2026-11-10
目标：Craft Workbench `main` 工作区当前代码
环境：Playwright CLI 浏览器 + 显式 `pnpm start:mock`；此记录不代表真实 Craft 数据验收。

## 页面打开检查

逐项将 `mode` 与 `page` 写入应用深链，在 390×844 浏览器视口中读取页面标题和主内容；31 个模式/页面组合均打开并显示内容，没有出现通用加载失败标记或空白主区，页面未超出视口宽度。随后检查浏览器控制台，错误数为 0。该检查不验证每个页面的业务写操作。

| 模式 | 已打开页面 |
| --- | --- |
| 工作台 | home、overview、plugins、skills、connectors、models、memory、knowledge、workflows、mods、filedir、relations、onboard、mode-confirm、asset-revisions、context-usage、workflow-designs、evaluations、settings |
| 控制台 | tasks、approvals、subscriptions、objects、permissions、mods、executors、evolution、blocked、mode-confirm、settings |
| 领航员 | pilot |

另外打开了“添加模型”主内容页，检查服务商选择步骤以及“其他 / 自建”分支；打开新建任务表单检查输入说明。设置页中全局默认档位已移除；运行环境显示 Mock 来源和 fixture 根。记忆页使用关系图显示演示冲突，并通过键盘可操作的节点列表聚焦节点。

## 已知未覆盖项

- 这是页面/标题/内容冒烟，不是全页面端到端行为覆盖；本次未逐个执行写入、权限拒绝、失败重试、加载状态与真实空态。
- 浏览器前进/后退的完整交互旅程未在这次手工浏览器检查中执行；自动化覆盖仍以现有 Node 测试为主。
- 模型自动发现、外部服务连接验证及凭据保管服务尚未实现；添加模型页允许手动模型 ID，并说明不会自动向服务商发请求。
- 插件扩展目前只支持宿主白名单能力；未知工具停用。沙箱插件页面及任意插件代码执行不在本次实现中。
- 插件工具调用会在运行时重新校验插件已安装、该工作区已启用且工具仍在声明中；禁用后的旧 UI 调用会失败关闭。权限授予/撤销机制尚无可复用的授权记录合同，因此不能声称“权限撤销立即失效”已实现。当前界面仅加载项目上下文，任务专属插件操作还未接入。
- 首页提交遇到网络错误时会保留原任务/消息编号；同一草稿重试会复用编号，草稿变化时会阻止再次发送并要求先核对原任务。
- 真实运行数据验收（最终代码重建包）：从最终 DMG 挂载的 `Craft Workbench.app` 随包 Node/Craft sidecar 连续冷启动 3 次。每次 `/api/runtime-info` 均返回来源 `craft`、版本 `0.20.2` 和实际数据根 `~/.craft_data`；Knowledge 摘要读到 12 条 claims、0 条 pages，Memory 资源读到 3 条，Experience overview 成功返回（sessions、launches、traces、outcomes、artifacts、pilots、timeline 均为空）。未输出具体记录内容。
- 修复前复现的 `statement has been finalized` 来自 CraftStore 启动索引扫描；最终 DMG 的三次冷启动均未再出现。直接启动包内桌面可执行文件后进程存活 8 秒。CUA 桌面控制服务不可用，未完成可见窗口渲染和点击验收，因此不据 API 结果推断 UI 已完整显示这些记录。
- 最终 DMG 路径：`desktop/src-tauri/target/release/bundle/dmg/Craft Workbench_0.18.1_aarch64.dmg`。`pnpm desktop:build` 成功；`hdiutil verify` 校验和有效。本机 `codesign --verify` 曾失败，因此签名/公证未验收。
- Craft 全量 `pnpm test` 已通过构建、类型检查、分层/工具面/文档/一致性审计，但完整 TypeScript 测试进程运行超过 15 分钟仍未退出，后被中断；该命令不计为通过，通用覆盖率总门禁及 smoke/plugin 阶段未取得通过证据。Craft 的 Runtime API、项目迁移、作用域身份、插件协议覆盖率门禁，以及 183 个本次改动相关的定向测试和内容索引/存储测试通过；插件协议、Workbench 启动、任务提交、主题色模块均达到 100% 行/分支/函数覆盖。Workbench 最终全量 `pnpm test` 及所有已配置覆盖率门禁通过。Mock 结果不作为真实数据证据。
