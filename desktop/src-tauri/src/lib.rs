use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_dialog::DialogExt;

struct RuntimeState {
    child: Mutex<Option<Child>>,
    backend: Mutex<Option<runtime_bridge::Backend>>,
}

mod runtime_bridge;
mod entry_window;

#[tauri::command]
fn entry_window_mode(window: tauri::WebviewWindow, mode: String) -> Result<(), String> {
    require_main(&window)?;
    let (width, height) = entry_window::dimensions(&mode)?;
    window.set_size(tauri::LogicalSize::new(width, height)).map_err(|error| error.to_string())
}

#[tauri::command]
async fn choose_project_folder(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        window.dialog().file().set_title("选择项目文件夹").blocking_pick_folder()
            .map(|path| path.into_path().map_err(|error| error.to_string())
                .and_then(|path| path.into_os_string().into_string().map_err(|_| "文件夹路径无法显示".to_owned())))
            .transpose()
    }).await.map_err(|_| "无法打开文件夹选择器".to_owned())?
}

#[tauri::command]
async fn choose_reference_files(window: tauri::WebviewWindow) -> Result<Vec<String>, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        window.dialog().file().set_title("选择要引用的文件").blocking_pick_files()
            .unwrap_or_default().into_iter().map(|path| path.into_path().map_err(|error| error.to_string())
                .and_then(|path| path.into_os_string().into_string().map_err(|_| "文件路径无法显示".to_owned())))
            .collect()
    }).await.map_err(|_| "无法打开文件选择器".to_owned())?
}

#[derive(serde::Serialize)]
struct WorkbenchResponse { status: u16, body: String }

fn require_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "Window identity unavailable")?;
    let development_url = if cfg!(debug_assertions) { window.app_handle().config().build.dev_url.as_ref() } else { None };
    if !trusted_main(window.label(), &url, development_url) {
        return Err("Command requires the bundled main window".into());
    }
    Ok(())
}

fn trusted_main(label: &str, url: &Url, development_url: Option<&Url>) -> bool {
    let bundled = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"));
    let development = development_url.is_some_and(|dev| dev.scheme() == "http" && dev.host_str() == Some("127.0.0.1") && dev.origin() == url.origin());
    label == "main" && (bundled || development)
}

#[cfg(test)]
mod window_identity_tests {
    use super::*;
    #[test]
    fn only_main_and_exact_development_origin_are_allowed() {
        let dev = Url::parse("http://127.0.0.1:1430/").unwrap();
        let other = Url::parse("http://127.0.0.1:1431/").unwrap();
        let remote = Url::parse("https://example.com/").unwrap();
        let bundled = Url::parse("tauri://localhost/index.html").unwrap();
        assert!(trusted_main("main", &dev, Some(&dev)));
        assert!(!trusted_main("main", &dev, None));
        assert!(!trusted_main("main", &other, Some(&dev)));
        assert!(!trusted_main("main", &remote, Some(&remote)));
        assert!(!trusted_main("embedded", &dev, Some(&dev)));
        assert!(trusted_main("main", &bundled, None));
    }
}

#[tauri::command]
async fn workbench_request(window: tauri::WebviewWindow, state: tauri::State<'_, RuntimeState>, method: String, path: String, body: String) -> Result<WorkbenchResponse, String> {
    require_main(&window)?;
    let (port, token) = {
        let backend = state.backend.lock().map_err(|_| "Runtime lock unavailable")?;
        let backend = backend.as_ref().ok_or("Runtime unavailable")?;
        (backend.port, backend.token.clone())
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (status, body) = runtime_bridge::Backend { port, token }.request(&method, &path, &body)?;
        Ok(WorkbenchResponse { status, body })
    }).await.map_err(|_| "Runtime request interrupted".to_owned())?
}

fn runtime_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, bool), String> {
    let root = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dist/runtime/app")
    } else { app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("app") };
    Ok((
        root.join(if cfg!(target_os = "windows") {
            "node.exe"
        } else {
            "node"
        }),
        root.join("dist/core/cli.js"),
        false,
    ))
}

fn start_workbench(app: &AppHandle) -> Result<(Child, Url), String> {
    let (node, cli, typescript) = runtime_paths(app)?;
    let mut command = Command::new(node);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // This window is a GUI subsystem app, so Windows would otherwise give the
        // console-subsystem sidecar a console window of its own — a stray command
        // prompt next to the app. Its stdout and stderr are already piped.
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    // The Node runtime resolves an explicit environment, settings, then ~/.craft_data.
    if typescript { command.arg("--experimental-strip-types"); }
    let cli_argument = cli.to_string_lossy().replace('\\', "/");
    let mut child = command.arg(cli_argument).args(["serve", "--port", "0", "--parent-stdin"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|error| format!("无法启动 Craft 本地运行时：{error}"))?;
    let stdout = child.stdout.take().ok_or("Craft 本地运行时未提供启动输出")?;
    let stderr = child.stderr.take().ok_or("Craft 本地运行时未提供错误输出")?;
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(url) = line.strip_prefix("Craft API: ") { let _ = sender.send(url.to_owned()); }
        }
    });
    std::thread::spawn(move || { let _ = std::io::copy(&mut BufReader::new(stderr), &mut std::io::sink()); });
    let result = receiver.recv_timeout(std::time::Duration::from_secs(30))
        .map_err(|_| "Craft 本地运行时启动失败：超时或进程退出".to_owned())
        .and_then(|line| Url::parse(line.trim()).map_err(|_| "Craft 返回了无效地址".to_owned()))
        .and_then(|url| {
            let token = url.fragment().and_then(|value| value.strip_prefix("token=")).unwrap_or("");
            if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.port().is_none()
                || !runtime_bridge::valid_token(token) {
                return Err("Craft 返回了未授权的运行时地址".into());
            }
            Ok(url)
        });
    match result {
        Ok(url) => Ok((child, url)),
        Err(error) => { let _ = child.kill(); let _ = child.wait(); Err(error) }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("craft-entry-open", ());
    }
}

#[tauri::command]
fn open_embedded_page(window: tauri::WebviewWindow, app: AppHandle, url: String) -> Result<(), String> {
    require_main(&window)?;
    let parsed =
        Url::parse(&url).map_err(|_| "请输入完整的 http:// 或 https:// 地址".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("内嵌网页只接受 http:// 或 https:// 地址".into());
    }
    if let Some(window) = app.get_webview_window("embedded") {
        window.close().map_err(|error| error.to_string())?;
    }
    WebviewWindowBuilder::new(&app, "embedded", WebviewUrl::External(parsed))
        .title("网页查看 · Craft Workbench")
        .inner_size(1180.0, 820.0)
        .min_inner_size(760.0, 520.0)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Open an http(s) page in the user's default browser. The embedded webview
/// cannot use the machine's proxy settings, so install guides otherwise land on
/// a blank window when the docs host is unreachable.
#[tauri::command]
fn open_external_url(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    require_main(&window)?;
    let parsed = Url::parse(&url).map_err(|_| "请输入完整的 http:// 或 https:// 地址".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("外部浏览器只接受 http:// 或 https:// 地址".into());
    }
    #[cfg(target_os = "windows")]
    let spawned = Command::new("rundll32").arg("url.dll,FileProtocolHandler").arg(parsed.as_str()).spawn();
    #[cfg(target_os = "macos")]
    let spawned = Command::new("open").arg(parsed.as_str()).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = Command::new("xdg-open").arg(parsed.as_str()).spawn();
    spawned.map_err(|error| format!("无法打开系统浏览器：{error}"))?;
    Ok(())
}

#[derive(serde::Serialize)]
struct CliInstallResult {
    provider: String,
    command: String,
    ok: bool,
    code: Option<i32>,
    output: String,
}

/// Only these three packages may be installed from the workbench. The provider
/// id comes from the page, so the mapping must stay an exact allow-list.
fn install_package(provider: &str) -> Result<(&'static str, &'static str, &'static [&'static str]), String> {
    match provider {
        "codex" => Ok(("Codex CLI", "@openai/codex", &["@openai/codex"])),
        "claude" => Ok(("Claude Code", "@anthropic-ai/claude-code", &["@anthropic-ai/claude-code"])),
        // DSH pulls native modules whose install scripts build node-pty/koffi.
        "dsh" => Ok(("DSH", "@deepseek-ai/dsh", &[
            "@deepseek-ai/dsh", "@deepseek-ai/dsh-subprocess-local", "koffi", "node-pty", "@google/genai", "protobufjs",
        ])),
        _ => Err("该工具没有可自动执行的安装命令".into()),
    }
}

fn run_npm(args: &[String]) -> std::io::Result<std::process::Output> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("cmd");
        command.args(["/d", "/s", "/c", "npm"]).args(args);
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        command.stdin(Stdio::null()).output()
    }
    #[cfg(not(windows))]
    {
        Command::new("npm").args(args).stdin(Stdio::null()).output()
    }
}

#[tauri::command]
async fn install_cli(window: tauri::WebviewWindow, provider: String) -> Result<CliInstallResult, String> {
    require_main(&window)?;
    let (label, package, scripts) = install_package(&provider)?;
    let allow = format!("--allow-scripts={}", scripts.join(","));
    let command_label = format!("npm install -g {allow} {package}");
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let with_policy = [String::from("install"), String::from("-g"), allow, String::from(package)];
        let first = run_npm(&with_policy);
        // npm < 11.6 has no --allow-scripts; retry the plain command there.
        let output = match first {
            Ok(out) if !out.status.success() => {
                let stderr = String::from_utf8_lossy(&out.stderr).to_lowercase();
                if stderr.contains("unknown option") || stderr.contains("unknown argument") {
                    run_npm(&[String::from("install"), String::from("-g"), String::from(package)])
                } else {
                    Ok(out)
                }
            }
            other => other,
        };
        let _ = tx.send(output);
    });
    let output = rx
        .recv_timeout(Duration::from_secs(600))
        .map_err(|_| "安装超时（10 分钟）。命令可能仍在后台继续，请稍后点「重新检测」。".to_owned())?
        .map_err(|error| format!("无法启动 npm：{error}。请先安装 Node.js / npm。"))?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&stderr);
    }
    const LIMIT: usize = 16 * 1024;
    if text.len() > LIMIT {
        text = text.split_off(text.len() - LIMIT);
        text.insert_str(0, "[较早的输出已省略]\n");
    }
    Ok(CliInstallResult {
        provider: label.to_string(),
        command: command_label,
        ok: output.status.success(),
        code: output.status.code(),
        output: text.trim().to_string(),
    })
}

/// Opens a separately profiled, visible local Edge session for the person to complete login.
/// The profile is not copied into the WebView and Craft never reads cookies or credentials.
#[tauri::command]
fn open_managed_browser(window: tauri::WebviewWindow, app: AppHandle, url: String) -> Result<(), String> {
    require_main(&window)?;
    let parsed = Url::parse(&url).map_err(|_| "请输入完整的 http:// 或 https:// 地址".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("受管浏览器只接受 http:// 或 https:// 地址".into());
    }
    let profile = app.path().app_local_data_dir().map_err(|error| error.to_string())?.join("browser-profile");
    std::fs::create_dir_all(&profile).map_err(|error| format!("无法创建本地浏览器资料目录：{error}"))?;
    let edge = [
        PathBuf::from(r"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"),
        PathBuf::from(r"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"),
        PathBuf::from("msedge.exe"),
    ].into_iter().find(|candidate| candidate == &PathBuf::from("msedge.exe") || candidate.is_file())
        .ok_or("未找到 Microsoft Edge；请安装或从已有浏览器开启本地 CDP 后连接")?;
    Command::new(edge)
        .arg("--no-first-run")
        .arg("--remote-debugging-address=127.0.0.1")
        .arg("--remote-debugging-port=9222")
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg(parsed.as_str())
        .spawn()
        .map_err(|error| format!("无法启动受管浏览器：{error}"))?;
    Ok(())
}

#[tauri::command]
fn notify(window: tauri::WebviewWindow, app: AppHandle, title: String, body: String) -> Result<(), String> {
    require_main(&window)?;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

pub fn run() {
    let state = RuntimeState {
        child: Mutex::new(None),
        backend: Mutex::new(None),
    };
    tauri::Builder::default()
        // Must be the first plugin: a second launch (for example a second
        // double-click on the desktop shortcut) should surface the window we
        // already have instead of starting a whole new app and sidecar.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        show_main(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let (child, url) = start_workbench(app.handle())?;
            *state.child.lock().expect("runtime state") = Some(child);
            *state.backend.lock().expect("runtime state") = Some(runtime_bridge::Backend {
                port: url.port().expect("validated runtime port"),
                token: url.fragment().expect("validated token").trim_start_matches("token=").into(),
            });
            app.manage(state);
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Craft")
                .inner_size(1200.0, 800.0)
                .min_inner_size(380.0, 400.0)
                .build()?;
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            // Another Craft window (or another app) may already own this hotkey. A busy
            // global shortcut must not stop the window from opening, so registration is
            // best-effort rather than part of the setup contract.
            let _ = app.global_shortcut().register(shortcut);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_embedded_page, open_external_url, install_cli, open_managed_browser, notify, workbench_request, entry_window_mode, choose_project_folder, choose_reference_files])
        .build(tauri::generate_context!())
        .expect("error while building Craft Workbench")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<RuntimeState>() {
                    if let Some(mut child) = state.child.lock().expect("runtime state").take() {
                        drop(child.stdin.take());
                        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
                        loop {
                            if matches!(child.try_wait(), Ok(Some(_))) { break; }
                            if std::time::Instant::now() >= deadline { let _ = child.kill(); break; }
                            std::thread::sleep(std::time::Duration::from_millis(50));
                        }
                        let _ = child.wait();
                    }
                }
            }
        });
}
