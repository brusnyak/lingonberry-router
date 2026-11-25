use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, State,
};

const CORE_ADDR: &str = "127.0.0.1:8799";
const CORE_URL: &str = "http://127.0.0.1:8799";

struct CoreChild(Mutex<Option<Child>>);

fn spawn_core() -> Option<Child> {
    // Do not spawn a duplicate if lingonberry-core is already listening on loopback.
    if std::net::TcpStream::connect_timeout(
        &CORE_ADDR.parse().ok()?,
        Duration::from_millis(200),
    )
    .is_ok()
    {
        return None;
    }

    Command::new("lingonberry-core")
        .args(["serve", CORE_ADDR])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

fn stop_core(state: &State<'_, CoreChild>) {
    let _ = reqwest::blocking::Client::new()
        .post(format!("{CORE_URL}/shutdown"))
        .timeout(Duration::from_millis(400))
        .send();

    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn toggle_popover(app: &AppHandle, click_pos: Option<PhysicalPosition<f64>>) {
    let Some(win) = app.get_webview_window("popover") else {
        return;
    };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
        return;
    }

    if let Some(pos) = click_pos {
        if let Ok(size) = win.outer_size() {
            let x = (pos.x - (size.width as f64 / 2.0)).max(12.0) as i32;
            #[cfg(target_os = "macos")]
            let y = (pos.y + 8.0) as i32;
            #[cfg(not(target_os = "macos"))]
            let y = (pos.y - size.height as f64 - 12.0).max(12.0) as i32;
            let _ = win.set_position(PhysicalPosition::new(x, y));
        }
    }
    let _ = win.show();
    let _ = win.set_focus();
}

#[tauri::command]
async fn fetch_core_snapshot() -> Result<serde_json::Value, String> {
    let resp = reqwest::get(format!("{CORE_URL}/snapshot"))
        .await
        .map_err(|e| format!("core unreachable: {e}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("invalid snapshot json: {e}"))
}

#[tauri::command]
async fn kill_worker_pid(pid: u32) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{CORE_URL}/kill/{pid}"))
        .send()
        .await
        .map_err(|e| format!("kill request failed: {e}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("invalid kill response: {e}"))
}

pub fn run() {
    let child = spawn_core();

    tauri::Builder::default()
        .manage(CoreChild(Mutex::new(child)))
        .invoke_handler(tauri::generate_handler![fetch_core_snapshot, kill_worker_pid])
        .setup(|app| {
            // Accessory policy on macOS: lives in menu bar, no Dock icon.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let open_item = MenuItem::with_id(app, "open", "Open Popover", true, None::<&str>)?;
            let doctor_item = MenuItem::with_id(app, "doctor", "Run Doctor Check", true, None::<&str>)?;
            let rescan_item = MenuItem::with_id(app, "rescan", "Rescan Agents & Keys", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Lingonberry", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &doctor_item, &rescan_item, &quit_item])?;

            let tray = TrayIconBuilder::with_id("lingonberry-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Lingonberry Router · 127.0.0.1:8799")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => toggle_popover(app, None),
                    "doctor" => {
                        let _ = Command::new("lingonberry-core").arg("doctor").spawn();
                    }
                    "rescan" => {
                        let _ = Command::new("lingonberry-core").arg("discover").spawn();
                    }
                    "quit" => {
                        let core = app.state::<CoreChild>();
                        stop_core(&core);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        toggle_popover(tray.app_handle(), Some(position));
                    }
                })
                .build(app)?;

            // Poll /snapshot every 3 s while running to keep the tray title/tooltip live.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let client = reqwest::Client::new();
                loop {
                    if let Ok(resp) = client
                        .get(format!("{CORE_URL}/snapshot"))
                        .timeout(Duration::from_millis(800))
                        .send()
                        .await
                    {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            let running = json["overview"]["running"].as_u64().unwrap_or(0);
                            let tooltip = format!("Lingonberry Router · {running} active · {CORE_ADDR}");
                            let _ = tray.set_tooltip(Some(&tooltip));
                            #[cfg(target_os = "macos")]
                            {
                                let title = if running > 0 { format!(" {running}") } else { String::new() };
                                let _ = tray.set_title(Some(&title));
                            }
                        }
                    }
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }
            });

            // Hide popover automatically when it loses focus (standard menu-bar feel).
            if let Some(win) = app_handle.get_webview_window("popover") {
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = win_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Lingonberry tray application");
}
