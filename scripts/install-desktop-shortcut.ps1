param(
  [switch]$Launcher,
  [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $repo 'desktop'
$icon = Join-Path $repo 'assets\craft.ico'

function Get-DesktopExecutable {
  $candidates = @(
    (Join-Path $desktop 'src-tauri\target\release\craft-workbench-desktop.exe'),
    (Join-Path $desktop 'src-tauri\target\debug\craft-workbench-desktop.exe'),
    (Join-Path $env:LOCALAPPDATA 'Craft Workbench\Craft Workbench.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Craft Workbench\Craft Workbench.exe'),
    (Join-Path $env:LOCALAPPDATA 'Craft Workbench\craft-workbench-desktop.exe')
  )
  return $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
}

function Get-LauncherPath {
  # .tools/start-craft-workbench.vbs sits beside the source workspace.
  $candidate = Join-Path (Split-Path -Parent $repo) '.tools\start-craft-workbench.vbs'
  if (Test-Path -LiteralPath $candidate) { return $candidate }
  return $null
}

function New-Shortcut([string]$path, [string]$target, [string]$workingDirectory, [string]$extraArguments) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $target
  $shortcut.WorkingDirectory = $workingDirectory
  # Always assign: reusing a .lnk must not keep the old launcher's arguments.
  $shortcut.Arguments = $extraArguments
  if (Test-Path -LiteralPath $icon) { $shortcut.IconLocation = "$icon,0" }
  $shortcut.Description = 'Craft Workbench'
  $shortcut.Save()
}

if ($Launcher) {
  $target = Get-LauncherPath
  if (-not $target) { throw '未找到 .tools/start-craft-workbench.vbs；请改用默认桌面应用模式。' }
  $workingDirectory = Split-Path -Parent $target
} else {
  $exe = Get-DesktopExecutable
  if ($Rebuild) {
    Write-Host '构建 Craft Workbench 桌面应用…'
    & pnpm --dir $desktop run build
    if ($LASTEXITCODE -ne 0) { throw "desktop build failed with exit code $LASTEXITCODE" }
    $exe = Get-DesktopExecutable
  }
  if ($exe) {
    $target = $exe
    $workingDirectory = Split-Path -Parent $exe
  } else {
    # No built desktop app yet: point the shortcut at the launcher, which prefers the
    # desktop app and falls back to the app window. Run with -Rebuild to build first.
    $target = Get-LauncherPath
    if (-not $target) { throw '未找到桌面应用可执行文件，也未找到 .tools/start-craft-workbench.vbs；请先运行 pnpm --dir craft-workbench desktop:build。' }
    $workingDirectory = Split-Path -Parent $target
    Write-Host '未找到已构建的桌面应用，快捷方式暂指向启动器（会在可用时使用桌面应用）。'
  }
}

$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Craft Workbench.lnk'
New-Shortcut -path $desktopLink -target $target -workingDirectory $workingDirectory -extraArguments ''

$startMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'Craft Workbench'
New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
$startMenuLink = Join-Path $startMenuDir 'Craft Workbench.lnk'
New-Shortcut -path $startMenuLink -target $target -workingDirectory $workingDirectory -extraArguments ''

Write-Host "已创建快捷方式："
Write-Host "  桌面：$desktopLink"
Write-Host "  开始菜单：$startMenuLink"
Write-Host "  目标：$target"
