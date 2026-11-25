//! HTTP API for the UI: /snapshot, /keys, /runs, /route, /discover, /receipts, /receipts/:id.
//! Loopback-only; the Swift/tray UI polls /snapshot every 5 s while the popover is open.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use crate::discovery::Discovery;
use crate::registry::Registry;
use crate::storage::{SqliteReceiptStore, SqliteRunStore};
use crate::types::{Receipt, Run, RunState, Snapshot};
use std::net::SocketAddr;
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct AppState {
    pub discovery: Discovery,
    pub registry: Registry,
    pub runs: SqliteRunStore,
    pub receipts: SqliteReceiptStore,
}

/// Binary mtime (unix seconds) captured when this process started. The app compares it with the
/// binary on disk: a newer file means a rebuild happened and this process must be restarted.
static STARTED_EXE_MTIME: OnceLock<f64> = OnceLock::new();

fn exe_mtime() -> f64 {
    std::env::current_exe()
        .and_then(|p| std::fs::metadata(p))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

async fn version() -> Json<serde_json::Value> {
    let started = *STARTED_EXE_MTIME.get_or_init(exe_mtime);
    Json(serde_json::json!({
        "pid": std::process::id(),
        "version": env!("CARGO_PKG_VERSION"),
        "exe_mtime": started,
    }))
}

/// Stop this core so the app can start a fresh one. Loopback only (the server binds 127.0.0.1).
async fn shutdown() -> Json<serde_json::Value> {
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        std::process::exit(0);
    });
    Json(serde_json::json!({ "stopping": true, "pid": std::process::id() }))
}

pub async fn serve(
    addr: SocketAddr,
    discovery: Discovery,
    registry: Registry,
    runs: SqliteRunStore,
    receipts: SqliteReceiptStore,
) {
    let state = Arc::new(AppState { discovery, registry, runs, receipts });
    let app = Router::new()
        .route("/snapshot", get(snapshot))
        .route("/keys", get(keys_status))
        .route("/runs", get(runs_list))
        .route("/runs/{id}", get(run_get))
        .route("/discover", get(discover))
        .route("/receipts", get(receipts_list))
        .route("/receipts/{id}", get(receipt_get))
        .route("/kill/{pid}", post(kill_worker))
        .route("/version", get(version))
        .route("/shutdown", post(shutdown))
        .with_state(state);

    STARTED_EXE_MTIME.get_or_init(exe_mtime);
    let listener = tokio::net::TcpListener::bind(addr).await
        .expect("failed to bind HTTP listener");
    tracing::info!("lingonberry-core HTTP on http://{}", addr);
    axum::serve(listener, app).await.expect("server error");
}

fn now_ts() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64()
}

async fn snapshot(State(state): State<Arc<AppState>>) -> Json<Snapshot> {
    let key_status = state.registry.key_status();
    let runs = state.runs.list();
    let now = now_ts();
    let window_start = now - 86_400.0;

    let workers_live: Vec<crate::types::LiveWorker> = runs
        .iter()
        .filter(|r| matches!(r.state, RunState::Running | RunState::Leased))
        .map(|r| crate::types::LiveWorker {
            pid: r.pid.unwrap_or(0),
            worker: r.worker.clone(),
            caller: r.caller.clone(),
            key: r.key_slot.clone(),
            model: r.model.clone(),
            provider: r.provider.clone(),
            run_id: Some(r.id.clone()),
            task: r.prompt.clone(),
            started: r.created_at.timestamp() as f64,
            elapsed_s: now - r.created_at.timestamp() as f64,
        })
        .collect();

    let last_day: Vec<&Run> = runs
        .iter()
        .filter(|r| r.created_at.timestamp() as f64 >= window_start)
        .collect();
    let completed_24h = last_day.iter().filter(|r| matches!(r.state, RunState::Done)).count();
    let failed_24h = last_day.iter().filter(|r| matches!(r.state, RunState::Failed)).count();
    let finished: Vec<u64> = last_day.iter().filter_map(|r| r.elapsed_ms).collect();
    let avg_duration_s = if finished.is_empty() {
        None
    } else {
        Some(finished.iter().sum::<u64>() as f64 / finished.len() as f64 / 1000.0)
    };

    let snapshot = Snapshot {
        ts: now,
        overview: crate::types::Overview {
            running: workers_live.len(),
            live_workers: workers_live.len(),
            completed_24h,
            failed_24h,
            avg_duration_s,
            cost_24h_usd: None,
            calls_24h: Some(last_day.len()),
            cpu_pct: system_info().cpu_pct,
        },
        workers: key_status,
        workers_live,
        sessions: runs
            .iter()
            .take(60)
            .map(|r| crate::types::SessionRow {
                id: r.id.clone(),
                ts: r.created_at.timestamp() as f64,
                prompt: r.prompt.clone(),
                worker: r.worker.clone(),
                caller: r.caller.clone(),
                key: r.key_slot.clone(),
                state: r.state.as_str().to_string(),
                duration_s: match r.elapsed_ms {
                    Some(m) => m as f64 / 1000.0,
                    None => now - r.created_at.timestamp() as f64,
                },
                reason: r.error.clone(),
                output: r.output.clone(),
            })
            .collect(),
        jobs: Vec::new(),
        router: crate::types::RouterState { up: true, serve: true, proxy: true },
        system: system_info(),
    };
    Json(snapshot)
}

/// Host metrics via the OS tools that already exist on macOS. Cached for 4 s so a
/// 1 Hz UI poll never forks `top` on every frame.
fn system_info() -> crate::types::SystemInfo {
    use std::sync::{Mutex, OnceLock};
    static CACHE: OnceLock<Mutex<Option<(f64, crate::types::SystemInfo)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let now = now_ts();
    if let Ok(guard) = cache.lock() {
        if let Some((ts, info)) = guard.as_ref() {
            if now - ts < 4.0 {
                return info.clone();
            }
        }
    }
    let info = collect_system_info();
    if let Ok(mut guard) = cache.lock() {
        *guard = Some((now, info.clone()));
    }
    info
}

fn collect_system_info() -> crate::types::SystemInfo {
    let cpu_pct = cpu_percent();
    let load1 = sh_line("/usr/sbin/sysctl", &["-n", "vm.loadavg"])
        .and_then(|s| s.trim_matches(|c| c == '{' || c == '}' || c == ' ').split_whitespace().next().map(|x| x.to_string()))
        .and_then(|s| s.parse::<f64>().ok());
    let total_bytes = sh_line("/usr/sbin/sysctl", &["-n", "hw.memsize"]).and_then(|s| s.parse::<f64>().ok());
    let (ram_used_gb, ram_total_gb) = match total_bytes {
        Some(total) => {
            let used = vm_stat_used_bytes().unwrap_or(0.0);
            (
                Some((used / 1_073_741_824.0 * 10.0).round() / 10.0),
                Some((total / 1_073_741_824.0 * 10.0).round() / 10.0),
            )
        }
        None => (None, None),
    };
    let (disk_used_gb, disk_total_gb) = df_gb();
    crate::types::SystemInfo { cpu_pct, load1, ram_used_gb, ram_total_gb, disk_used_gb, disk_total_gb }
}

fn sh_line(bin: &str, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new(bin).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Sum of per-process CPU% divided by core count = machine utilisation, 0-100.
fn cpu_percent() -> Option<f64> {
    let cores = sh_line("/usr/sbin/sysctl", &["-n", "hw.ncpu"])?.parse::<f64>().ok()?;
    let out = std::process::Command::new("/bin/ps").args(["-A", "-o", "%cpu="]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let sum: f64 = text.lines().filter_map(|l| l.trim().parse::<f64>().ok()).sum();
    if cores <= 0.0 {
        return None;
    }
    Some(((sum / cores).clamp(0.0, 100.0) * 10.0).round() / 10.0)
}

fn vm_stat_used_bytes() -> Option<f64> {
    let out = std::process::Command::new("/usr/bin/vm_stat").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let page = text
        .lines()
        .next()
        .and_then(|l| l.split("page size of").nth(1))
        .and_then(|l| l.split_whitespace().next())
        .and_then(|p| p.parse::<f64>().ok())
        .unwrap_or(16384.0);
    let pages = |name: &str| -> f64 {
        text.lines()
            .find(|l| l.trim_start().starts_with(name))
            .and_then(|l| l.split(':').nth(1))
            .map(|v| v.trim().trim_end_matches('.').replace('.', ""))
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.0)
    };
    let free = pages("Pages free");
    let inactive = pages("Pages inactive");
    let speculative = pages("Pages speculative");
    let cached = pages("File-backed pages");
    let total_pages = sh_line("/usr/sbin/sysctl", &["-n", "hw.memsize"])
        .and_then(|b| b.parse::<f64>().ok())
        .map(|b| b / page)
        .unwrap_or(0.0);
    if total_pages <= 0.0 {
        return None;
    }
    let available = free + inactive + speculative + cached;
    Some((total_pages - available).max(0.0) * page)
}

fn df_gb() -> (Option<f64>, Option<f64>) {
    let out = match std::process::Command::new("/bin/df").args(["-k", "/"]).output() {
        Ok(o) => o,
        Err(_) => return (None, None),
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let line = match text.lines().nth(1) {
        Some(l) => l,
        None => return (None, None),
    };
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() < 3 {
        return (None, None);
    }
    let used = cols[2].parse::<f64>().ok().map(|k| (k / 1_048_576.0 * 10.0).round() / 10.0);
    let total = cols[1].parse::<f64>().ok().map(|k| (k / 1_048_576.0 * 10.0).round() / 10.0);
    (used, total)
}

async fn keys_status(State(state): State<Arc<AppState>>) -> Json<Vec<crate::types::WorkerStatus>> {
    Json(state.registry.key_status())
}

async fn runs_list(State(state): State<Arc<AppState>>) -> Json<Vec<Run>> {
    Json(state.runs.list())
}

async fn run_get(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<Run>, StatusCode> {
    match state.runs.get(&id) {
        Some(r) => Ok(Json(r)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn discover(State(state): State<Arc<AppState>>) -> Json<Discovery> {
    Json(state.discovery.clone())
}

async fn receipts_list(State(state): State<Arc<AppState>>) -> Json<Vec<Receipt>> {
    Json(state.receipts.list())
}

async fn receipt_get(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<Receipt>, StatusCode> {
    match state.receipts.get(&id) {
        Some(r) => Ok(Json(r)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// Kill a live worker by pid. Only runs currently in flight are eligible, so a recycled
/// pid from a finished run can never take out an unrelated process.
async fn kill_worker(
    State(state): State<Arc<AppState>>,
    Path(pid): Path<u32>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let target = state
        .runs
        .list()
        .into_iter()
        .find(|r| r.pid == Some(pid) && matches!(r.state, RunState::Running | RunState::Leased));
    let Some(run) = target else {
        return Err(StatusCode::NOT_FOUND);
    };
    // Workers are spawned as group leaders: negative pid takes the children too.
    let group_ok = std::process::Command::new("/bin/kill")
        .arg("-TERM")
        .arg(format!("-{pid}"))
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    let ok = group_ok
        || std::process::Command::new("/bin/kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
    if ok {
        state.runs.set_state(
            &run.id,
            RunState::Failed,
            Some(false),
            Some(format!("killed by user (pid {pid})")),
        );
    }
    Ok(Json(serde_json::json!({ "ok": ok, "pid": pid, "run_id": run.id, "worker": run.worker })))
}
