# Craft Workbench

## macOS 本机固定版本管理

对已经取得的 `Craft Workbench.app` 可查看版本状态、安装、升级或回滚。稳定应用路径固定为 `~/Applications/Craft Workbench.app`；`CRAFT_DATA_DIR` 只用于状态显示，未设置时显示 `~/.craft_data`。命令不会覆盖这些路径参数，也不改动数据根目录：

```sh
pnpm --dir desktop run version-manager -- status
pnpm --dir desktop run version-manager -- install "/path/to/Craft Workbench.app"
pnpm --dir desktop run version-manager -- upgrade "/path/to/Craft Workbench.app"
pnpm --dir desktop run version-manager -- rollback
```

此功能只管理本机已有的固定版本包，不负责签名、公证、下载或自动升级。完整边界见 [desktop/FIXED_VERSION_MANAGEMENT.md](desktop/FIXED_VERSION_MANAGEMENT.md)。

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

Workbench 通过 npm 版本依赖使用 Craft 运行时（当前固定为 `craft@0.20.4`），不再读取同级 `../craft` 仓库。桌面 sidecar 会从已安装的 Runtime 生成到 `dist/runtime/app`，安装包内包含运行时及其依赖。独立工作区安装需要对应 Craft 包及其内部依赖已发布到可访问的包仓库。

## Runtime 来源

Workbench 只读取 npm 安装的 `craft` 包，不再支持指向同级源码仓库的覆盖变量。Runtime 必须声明支持的协议版本，否则启动前报错。

## 测试与发布边界

页面与桌面测试位于本仓库；核心集成测试通过公开的 `craft/runtime` 接口消费已安装包。真实双引擎、桌面窗口和各平台进程清理仍需独立验收。现有页面覆盖率命令不包括大型旧 `app.js`，不能当作整个 UI 的覆盖率结论。

`ci/desktop-release.yml.disabled` 和 `legacy/` 属于历史材料。设计文档仍包含旧版页面契约，迁移和验收状态以实际代码及当前实施清单为准；尚未据此宣称桌面发布就绪。
