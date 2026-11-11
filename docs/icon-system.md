# Craft 图标体系（重设计）

## 问题

旧体系有三处不一致：

1. 左侧图标栏顶部放了一个「C」形圆弧 SVG，看起来像大写字母 logo；
2. `craft-logo.svg` 是内嵌 base64 PNG 的菱形折纸位图，无法跟随主题色、无法缩放清晰；
3. 页面内 `web/ui.js` 的 `ICONS` 是 16×16 线性描边图标，和上面两套视觉语言不统一。

## 设计原则

- **不用字母**：产品名只在原生窗口标题 / `<title>` 出现，导航栏不重复字母标记。
- **纯 SVG 线性**：所有图标 `viewBox="0 0 16 16"`、`fill="none"`、`stroke="currentColor"`、
  `stroke-width` 1.5–1.7、圆角端点；颜色跟随主题变量，不内嵌位图或固定色值。
- **一个语义一个图标**：图标表达动作/对象，不表达品牌；相似动作共用同一路径。
- **可访问**：装饰性图标 `aria-hidden="true"`，按钮必须有 `aria-label` / `title`。
- **有界回路**：品牌符号（仅 favicon / project-shell）用不闭合的圆角菱形 + 三个节点，
  表示 Knowledge / Memory / Experience 的受治理闭环；不假装「自动完成」。

## 变更

| 位置 | 旧 | 新 |
|---|---|---|
| 左侧栏 `rail-brand > .mark` | 大写 C 形圆弧 | **删除**（含 CSS `.rail-brand` / `.mark` 规则） |
| 设置页 | `sliders`（双滑块） | `settings`（通用齿轮）；`sliders` 保留给「执行配置」 |
| `craft-logo.svg` | 内嵌 PNG 折纸菱形 | 纯 SVG「有界回路」线性符号 |
| `ui.js` 其它图标 | 16×16 线性 | 保持不变，统一到上述规范 |

## 语义映射（节选）

| key | 含义 | 形状 |
|---|---|---|
| `settings` | 设置 / 偏好 | 齿轮 + 中心圆 |
| `sliders` | 执行配置 / 参数 | 双滑轨 + 滑块 |
| `cpu` | 模型 / 执行器 | 芯片 |
| `plug` | 插件 / 连接器 | 插头 |
| `key` | 凭据 / 授权 | 钥匙 |
| `db` | 知识 / 存储 | 圆柱 |
| `layers` | 控制台 / 分层 | 叠层 |
| `spark` | 领航员 / 新建 | 四角星 |
| `terminal` | 工作台 | 终端窗口 |
| `search` | 检索 | 放大镜 |

## 验收

- `tests/workbench-boot.test.ts`：图标栏不再出现 `rail-brand` / `mark` / C 圆弧路径。
- `tests/settings-icon.test.ts`：设置图标是齿轮且不等于 `sliders`。
- `tests/icon-system.test.ts`：`craft-logo.svg` 是纯 SVG、无内嵌位图、无字母路径。
- 全量 442 单测 + 真实浏览器 e2e（31 页 / 62 点击 / 0 JS 错误）。
