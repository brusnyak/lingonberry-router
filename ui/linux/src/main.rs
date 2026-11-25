use gtk4::glib;
use gtk4::prelude::*;
use gtk4::{
    Application, ApplicationWindow, Box as GtkBox, Button, CssProvider, Label, Orientation,
    ScrolledWindow,
};
use ksni::TrayService;
use serde::Deserialize;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const BASE_URL: &str = "http://127.0.0.1:8799";

#[derive(Debug, Clone, Deserialize)]
struct Overview {
    running: usize,
    completed_24h: usize,
    failed_24h: usize,
    avg_duration_s: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
struct LiveWorker {
    pid: u32,
    worker: String,
    key: Option<String>,
    elapsed_s: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct JobRow {
    name: String,
    source: String,
    schedule: String,
    health: String,
    paused: Option<bool>,
    crash_count: u32,
    auto_restart: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct LiveCronProcess {
    pid: u32,
    job_name: String,
    command: String,
    cpu_pct: f64,
    mem_mb: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct Snapshot {
    overview: Overview,
    workers_live: Vec<LiveWorker>,
    jobs: Vec<JobRow>,
    cron_live: Vec<LiveCronProcess>,
}

#[derive(Debug, Clone)]
enum TrayEvent {
    ToggleWindow,
    Rescan,
    Quit,
}

struct LingonberryTray {
    tx: Sender<TrayEvent>,
}

impl ksni::Tray for LingonberryTray {
    fn id(&self) -> String {
        "lingonberry-router".into()
    }

    fn title(&self) -> String {
        "Lingonberry Router".into()
    }

    fn icon_name(&self) -> String {
        "network-workgroup".into()
    }

    fn activate(&mut self, _x: i32, _y: i32) {
        let _ = self.tx.send(TrayEvent::ToggleWindow);
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        use ksni::menu::*;
        vec![
            StandardItem {
                label: "Toggle Lingonberry Popover".into(),
                activate: Box::new(|this: &mut Self| {
                    let _ = this.tx.send(TrayEvent::ToggleWindow);
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "Rescan Agents & OS Crons".into(),
                activate: Box::new(|this: &mut Self| {
                    let _ = this.tx.send(TrayEvent::Rescan);
                }),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "Quit".into(),
                activate: Box::new(|this: &mut Self| {
                    let _ = this.tx.send(TrayEvent::Quit);
                }),
                ..Default::default()
            }
            .into(),
        ]
    }
}

fn ensure_core_daemon() -> Option<Child> {
    if reqwest::blocking::get(format!("{BASE_URL}/version"))
        .map(|r| r.status().is_success())
        .unwrap_or(false)
    {
        return None;
    }
    Command::new("lingonberry-core")
        .args(["serve", "127.0.0.1:8799"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

fn fetch_snapshot() -> Option<Snapshot> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()?;
    client
        .get(format!("{BASE_URL}/snapshot"))
        .send()
        .ok()?
        .json::<Snapshot>()
        .ok()
}

fn post_action(path: String) {
    std::thread::spawn(move || {
        if let Ok(client) = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
        {
            let _ = client.post(format!("{BASE_URL}{path}")).send();
        }
    });
}

fn main() {
    let child_guard: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(ensure_core_daemon()));
    let (tx, rx) = mpsc::channel::<TrayEvent>();

    let tray_service = TrayService::new(LingonberryTray { tx: tx.clone() });
    tray_service.spawn();

    let app = Application::builder()
        .application_id("dev.lingonberry.RouterTray")
        .build();

    let child_for_exit = child_guard.clone();
    app.connect_activate(move |app| {
        let provider = CssProvider::new();
        provider.load_from_data(
            "
            window { background-color: #12141a; color: #e2e8f0; }
            .card { background-color: #161820; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px; }
            .mono { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #94a3b8; }
            ",
        );
        gtk4::style_context_add_provider_for_display(
            &gtk4::gdk::Display::default().expect("display"),
            &provider,
            gtk4::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );

        let window = ApplicationWindow::builder()
            .application(app)
            .title("Lingonberry Router")
            .default_width(620)
            .default_height(560)
            .build();

        let root = GtkBox::new(Orientation::Vertical, 10);
        root.set_margin_top(14);
        root.set_margin_bottom(14);
        root.set_margin_start(14);
        root.set_margin_end(14);

        let header = GtkBox::new(Orientation::Horizontal, 8);
        let title = Label::new(Some("Lingonberry Router · Linux Tray"));
        title.set_hexpand(true);
        title.set_halign(gtk4::Align::Start);
        let rescan_btn = Button::with_label("Rescan");
        rescan_btn.connect_clicked(|_| post_action("/api/rescan".into()));
        header.append(&title);
        header.append(&rescan_btn);
        root.append(&header);

        let telemetry_lbl = Label::new(Some("Connecting to 127.0.0.1:8799..."));
        telemetry_lbl.add_css_class("mono");
        telemetry_lbl.set_halign(gtk4::Align::Start);
        root.append(&telemetry_lbl);

        let scroll = ScrolledWindow::new();
        scroll.set_vexpand(true);
        let list_box = GtkBox::new(Orientation::Vertical, 8);
        scroll.set_child(Some(&list_box));
        root.append(&scroll);

        window.set_child(Some(&root));
        window.present();

        let win_ref = window.clone();
        let app_ref = app.clone();
        let exit_guard = child_for_exit.clone();

        glib::timeout_add_local(Duration::from_millis(250), move || {
            while let Ok(evt) = rx.try_recv() {
                match evt {
                    TrayEvent::ToggleWindow => {
                        if win_ref.is_visible() {
                            win_ref.set_visible(false);
                        } else {
                            win_ref.present();
                        }
                    }
                    TrayEvent::Rescan => post_action("/api/rescan".into()),
                    TrayEvent::Quit => {
                        if let Some(mut c) = exit_guard.lock().unwrap().take() {
                            let _ = c.kill();
                        }
                        app_ref.quit();
                        return glib::ControlFlow::Break;
                    }
                }
            }
            glib::ControlFlow::Continue
        });

        let telemetry_clone = telemetry_lbl.clone();
        let list_clone = list_box.clone();
        glib::timeout_add_local(Duration::from_secs(2), move || {
            let (tx_snap, rx_snap) = mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx_snap.send(fetch_snapshot());
            });
            if let Ok(Some(snap)) = rx_snap.recv_timeout(Duration::from_millis(800)) {
                telemetry_clone.set_text(&format!(
                    "running: {} slots · avg: {:.1}s · completed: {} · failed: {} · cron pids: {}",
                    snap.overview.running,
                    snap.overview.avg_duration_s.unwrap_or(0.0),
                    snap.overview.completed_24h,
                    snap.overview.failed_24h,
                    snap.cron_live.len()
                ));

                while let Some(child) = list_clone.first_child() {
                    list_clone.remove(&child);
                }

                for w in &snap.workers_live {
                    let row = GtkBox::new(Orientation::Horizontal, 8);
                    row.add_css_class("card");
                    let lbl = Label::new(Some(&format!(
                        "Worker {} · pid {} · {:.1}s",
                        w.worker, w.pid, w.elapsed_s
                    )));
                    lbl.set_hexpand(true);
                    lbl.set_halign(gtk4::Align::Start);
                    let kill_btn = Button::with_label("Kill");
                    let pid = w.pid;
                    kill_btn.connect_clicked(move |_| post_action(format!("/kill/{pid}")));
                    row.append(&lbl);
                    row.append(&kill_btn);
                    list_clone.append(&row);
                }

                for proc_item in &snap.cron_live {
                    let row = GtkBox::new(Orientation::Horizontal, 8);
                    row.add_css_class("card");
                    let lbl = Label::new(Some(&format!(
                        "Cron PID {} ({}) · {:.1}% CPU · {:.1}MB",
                        proc_item.pid, proc_item.job_name, proc_item.cpu_pct, proc_item.mem_mb
                    )));
                    lbl.set_hexpand(true);
                    lbl.set_halign(gtk4::Align::Start);
                    let kill_btn = Button::with_label("Kill PID");
                    let pid = proc_item.pid;
                    kill_btn.connect_clicked(move |_| post_action(format!("/api/jobs/kill/{pid}")));
                    row.append(&lbl);
                    row.append(&kill_btn);
                    list_clone.append(&row);
                }

                for job in &snap.jobs {
                    let row = GtkBox::new(Orientation::Horizontal, 8);
                    row.add_css_class("card");
                    let lbl = Label::new(Some(&format!(
                        "{} [{}] · {} · health: {} · crashes: {}",
                        job.name, job.source, job.schedule, job.health, job.crash_count
                    )));
                    lbl.set_hexpand(true);
                    lbl.set_halign(gtk4::Align::Start);
                    let name_toggle = job.name.clone();
                    let toggle_btn = Button::with_label(if job.paused.unwrap_or(false) {
                        "Resume"
                    } else {
                        "Pause"
                    });
                    toggle_btn.connect_clicked(move |_| {
                        post_action(format!("/api/jobs/{name_toggle}/toggle"))
                    });

                    let name_heal = job.name.clone();
                    let heal_btn = Button::with_label("Heal");
                    heal_btn.connect_clicked(move |_| {
                        post_action(format!("/api/jobs/{name_heal}/heal"))
                    });

                    row.append(&lbl);
                    row.append(&toggle_btn);
                    if job.health == "crashed" {
                        row.append(&heal_btn);
                    }
                    list_clone.append(&row);
                }
            }
            glib::ControlFlow::Continue
        });
    });

    app.run();
}
