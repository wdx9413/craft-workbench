# Craft Workbench 本机固定版本管理

此机制管理已经构建好的 macOS `.app`，不负责下载、签名、公证或自动更新。用户自行取得新版本包后，可用下列命令查看、安装、升级和回滚：

```sh
pnpm --dir desktop run version-manager -- status
pnpm --dir desktop run version-manager -- install "/path/to/Craft Workbench.app"
pnpm --dir desktop run version-manager -- upgrade "/path/to/Craft Workbench.app"
pnpm --dir desktop run version-manager -- rollback
```

稳定启动路径是 `~/Applications/Craft Workbench.app`，始终是真实 `.app` 目录。经过 bundle identifier、版本号和应用文件树摘要校验后，新包先复制到同卷暂存目录；切换前若当前应用仍运行，操作会拒绝执行。升级时旧 bundle 移入同级隐藏目录 `~/Applications/.craft-workbench-versions/`，再将暂存 bundle 改名到稳定路径。第二次改名失败时会把旧 bundle 放回。回滚按同样方式切换，并保留刚离开的版本作为下一次回滚版本。

应用版本从 bundle 的 `CFBundleShortVersionString` 读取，bundle identifier 必须为 `dev.craft.workbench`。`status` 返回当前版本、上一版本、稳定应用路径和有效数据根目录。数据根目录读取 `CRAFT_DATA_DIR`；未设置时显示 `~/.craft_data`。管理器不复制、移动、清理或初始化数据根目录。应用包路径或数据根目录物理解析后与应用/版本目录重叠时拒绝操作。

两次目录改名之间稳定路径会短暂不存在；普通文件系统无法把两个不同目录以一次原子操作互换。进程内失败会补偿恢复旧 bundle，但断电或强制终止发生在两次改名之间时，用户需要从 `.craft-workbench-versions/<版本>.app` 手动放回旧包。此实现没有声称对崩溃场景提供事务保证，也没有用真实签名应用验证 Finder、LaunchServices、Gatekeeper 或签名路径行为。发布安装包仍需独立完成签名、公证及实际安装验收。
