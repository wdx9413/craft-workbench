# Craft Workbench

独立的网页与 Tauri 桌面展示仓库。页面、组件、样式、图标、桌面桥接及安装包属于本仓库；会话协调、队列、权限、存储和评测服务属于 Craft。

依赖方向：`craft-workbench → craft → craft-eval`。核心不依赖页面仓库，浏览器页面通过本地服务通信，不直接访问数据库。

## 安装与使用

使用 Node >= 23、pnpm 11.19.0；桌面开发还需 Rust 与目标平台 Tauri 环境。

```sh
pnpm install --frozen-lockfile
pnpm build:runtime  # 检查已安装的 Craft 包及协议兼容性
pnpm serve         # 启动网页服务
pnpm start         # 启动并打开网页
pnpm test
pnpm desktop:dev
pnpm desktop:build
```

正式路径从依赖包解析 Runtime，不要求同级存在 `craft/` 源码。当前 npm registry 尚未提供本项目的核心包，使用 `vendor/` 中固定 tarball，并由锁文件约束完整性。该包是本地联调产物，不代表正式发布；后续发布须绑定精确源码与验收记录。桌面 sidecar 从已安装包准备到 `dist/runtime/app`，开发与正式窗口均使用准备好的编译产物。

## 显式源码联调

需要调试未打包的核心时，先在核心仓库完成构建，再为命令设置绝对路径 `CRAFT_RUNTIME_ROOT`。例如：

```sh
CRAFT_RUNTIME_ROOT=/absolute/path/to/craft pnpm serve
CRAFT_RUNTIME_ROOT=/absolute/path/to/craft pnpm desktop:dev
```

此选择不会自动修改已安装依赖或锁文件，也不会自动构建核心源码。普通启动与发布构建不隐式查找 `../craft`。Runtime 必须声明支持的协议版本，否则启动前报错。

## 测试与发布边界

页面与桌面测试位于本仓库；核心集成测试通过公开的 `craft/runtime` 接口消费已安装包。真实双引擎、桌面窗口和各平台进程清理仍需独立验收。现有页面覆盖率命令不包括大型旧 `app.js`，不能当作整个 UI 的覆盖率结论。

`ci/desktop-release.yml.disabled` 和 `legacy/` 属于历史材料。设计文档仍包含旧版页面契约，迁移和验收状态以实际代码及当前实施清单为准；尚未据此宣称桌面发布就绪。
