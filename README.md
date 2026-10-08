# Craft Workbench

从 `craft` 核心拆出的可选展示项目，包含网页和 Tauri 桌面壳。默认不随核心启动，也不随核心发布。迁移日期：2026-10-08，源版本：0.12.39。

目录约定：`craft/` 与 `craft-workbench/` 位于同一父目录。依赖方向只有 `craft-workbench → craft`；核心不依赖本项目。

```text
my-craft/
  craft/                 # Runtime、四个子能力、Skill/MCP/CLI/API
  craft-workbench/
    workbench/           # HTML/CSS/JavaScript
    desktop/             # Tauri、原生桥接与 sidecar
    tests/               # 页面和桌面契约测试
    ci/                  # 已暂停的旧发布流程
    legacy/              # 已停用的旧 Windows 启动器
```

使用 Node >= 23、pnpm 11.19.0。先按核心仓库约定准备 `../craft` 的依赖；首次使用 pnpm 命令时在本项目执行 `pnpm install --frozen-lockfile`，以重建迁移后的依赖链接。Tauri 开发/构建还需要本机 Rust、Tauri 系统环境。

```sh
# 本目录执行；按需显式启用，不会自动启动。
pnpm test
pnpm test:coverage
pnpm serve       # 构建核心运行时，启动网页服务器
pnpm start       # 同上，并打开浏览器

pnpm install --frozen-lockfile
pnpm desktop:dev
pnpm desktop:build
```

网页通过 `craft serve --workbench-dir ./workbench` 显式挂载；默认核心服务器不提供页面。桌面壳加载自身打包的页面，通过原生桥接调用核心 API，保留 token、窗口隔离和同源限制。桌面 sidecar 的输出归本项目所有，位于 `dist/runtime/app`；不会把 UI 重新打入核心 npm 包。

[DESIGN.md](DESIGN.md) 和 [UX-CONTRACT.md](UX-CONTRACT.md) 保留拆分前的界面设计与交互契约。`pnpm test:coverage` 对迁出的 10 个页面逻辑模块维持行、分支、函数 100% 门槛；原有大型 `app.js` 不在此门槛中。核心侧集成契约见 `../craft/docs/technical/modules/presentation-separation.md`。

`ci/desktop-release.yml.disabled` 是原工作流的存档，不是可直接恢复的流水线。未来启用发布前，需要确定独立仓库、固定核心依赖版本、适配 checkout 和构建路径，再验证原生安装包。`legacy/windows-launcher.cs` 仅作历史保留，不属于当前启动链。

本目录尚未初始化独立 Git 仓库。仅提交 `craft` 的删除记录不会保存迁移后的源码；备份或版本管理必须同时包含本目录。
