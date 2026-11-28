use crate::agents::{
    apply_self_config_targets, build_self_config_plan, call_chunked, call_provider_api,
    classify_complexity, cook_prompt, is_output_truncated, proxy_provider_chat,
    route_prompt_with_budget, select_escalation_candidate, validate_explicit_worker_policy,
};
use crate::channels::{append_shared_memory_note, build_channel_gateway_status, normalize_channel_session_key};
use crate::config::{
    constant_time_eq, ensure_api_token, load_config, save_config, Config, ExecutionMode,
};
use crate::cron::{is_os_pid_alive, kill_os_pid};
use crate::discovery::{
    configure_pi_rust, known_provider, probe_provider_models, recommended_pi_install_cmd,
    redact_secrets, resolve_key_value, scan_discovery,
};
use crate::events::log_event;
use crate::harness::{
    build_readiness_report, ensure_mini_harness, execute_verification_gate, git_repo_root,
    infer_cost_tier, WorktreeHandle,
};
use crate::keychain::{delete_secret, make_slot_name, store_secret};
use crate::registry::{now_sec, LeaseGuard, Registry};
use crate::sandbox::{
    build_docker_sandbox_args, probe_sandbox_health, select_sandbox_tier, write_seatbelt_profile,
    SandboxTier,
};
use crate::spec_engine::{
    check_diff_scope_guard, create_draft_spec, load_matching_steering, KiroSpecManifest,
    SpecWaveTask,
};
use crate::storage::SqliteStore;
use crate::swarm::SwarmCoordinator;
use crate::types::{
    DiscoveryData, JobRow, KeyCostTier, KeychainSlotMeta, LiveWorker, OvernightSummary,
    OvernightTicket, Overview, RouterState, Run, RunState, SelfConfigPlan, SessionRow, SessionStep,
    Snapshot, SystemInfo, TelemetryPoint,
};
use crate::watchdog::{safe_worker_env_limits, HostWatchdog};
use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use axum::routing::{delete, get, post};
use axum::Router;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use sysinfo::{Disks, System};
use tokio::net::TcpListener;
use tokio::process::Command as TokioCommand;
use tokio::sync::oneshot;
use uuid::Uuid;

#[derive(Clone, Debug, Default)]
pub struct DispatchOptions {
    pub prompt: String,
    pub caller: Option<String>,
    pub worker_id: Option<String>,
    pub phase: String,
    pub use_worktree: bool,
    pub simulate_fault: Option<String>,
    pub live_api: bool,
    pub fanout_group: Option<String>,
    pub allow_keys: bool,
    pub allow_paid: bool,
    pub gate_cmd: Option<String>,
    pub read_only: bool,
    pub path_globs: Option<Vec<String>>,
    pub sandbox_tier: Option<String>,
    pub spec_id: Option<String>,
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Mutex<Config>>,
    pub discovery: Arc<Mutex<DiscoveryData>>,
    pub registry: Registry,
    pub store: SqliteStore,
    pub applied_targets: Arc<Mutex<BTreeSet<String>>>,
    pub active_cancels: Arc<Mutex<HashMap<u32, oneshot::Sender<()>>>>,
    pub active_os_pids: Arc<Mutex<HashMap<u32, u32>>>,
    pub telemetry: Arc<Mutex<VecDeque<TelemetryPoint>>>,
    pub next_pid: Arc<AtomicU32>,
    pub shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    /// Set true by the load watcher when system CPU/RAM exceeds thresholds.
    /// When set, non-pi (local CLI) workers are refused dispatch to protect the machine.
    pub load_throttled: Arc<AtomicBool>,
    /// Live (real provider call) or simulate (labelled stub). Set from config at boot.
    pub execution: ExecutionMode,
    /// Per-user loopback bearer token required on all mutating and proxy routes.
    pub api_token: String,
    /// Host RAM / APFS disk / RPM & subscription burst watchdog.
    pub watchdog: HostWatchdog,
    /// 50-agent swarm semaphore, non-overlapping file lease locks, and serial merge queue.
    pub swarm: SwarmCoordinator,
}

impl AppState {
    pub fn new(config: Config, discovery: DiscoveryData, store: SqliteStore) -> Self {
        let registry = Registry::new(&discovery, &config);
        let mut telemetry = VecDeque::with_capacity(36);
        let sys = collect_system_info();
        let now = now_sec();
        let ram_pct = match (sys.ram_used_gb, sys.ram_total_gb) {
            (Some(u), Some(t)) if t > 0.0 => (u / t) * 100.0,
            _ => 42.0,
        };
        let disk_pct = match (sys.disk_used_gb, sys.disk_total_gb) {
            (Some(u), Some(t)) if t > 0.0 => (u / t) * 100.0,
            _ => 35.0,
        };
        for idx in 0..12 {
            telemetry.push_back(TelemetryPoint {
                ts: now - ((11 - idx) as f64) * 60.0,
                cpu_pct: sys.cpu_pct.unwrap_or(14.0),
                ram_pct,
                disk_pct,
                active_runs: 0,
                rpm: 0,
            });
        }
        // Collision-free synthetic run PIDs across restarts: mix OS PID prefix + existing max.
        let pid_prefix = (std::process::id() % 90_000 + 10_000).saturating_mul(10_000);
        let existing_max = store
            .list_runs()
            .iter()
            .filter_map(|r| r.pid)
            .max()
            .unwrap_or(0);
        let next_pid_start = pid_prefix.max(existing_max.saturating_add(1));

        let api_token = ensure_api_token()
            .unwrap_or_else(|_| format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()));

        Self {
            execution: config.execution,
            config: Arc::new(Mutex::new(config)),
            discovery: Arc::new(Mutex::new(discovery)),
            registry,
            store,
            applied_targets: Arc::new(Mutex::new(BTreeSet::new())),
            active_cancels: Arc::new(Mutex::new(HashMap::new())),
            active_os_pids: Arc::new(Mutex::new(HashMap::new())),
            telemetry: Arc::new(Mutex::new(telemetry)),
            next_pid: Arc::new(AtomicU32::new(next_pid_start)),
            shutdown_tx: Arc::new(Mutex::new(None)),
            load_throttled: Arc::new(AtomicBool::new(false)),
            api_token,
            watchdog: HostWatchdog::new(6),
            swarm: SwarmCoordinator::new(6),
        }
    }

    pub fn build_overnight_summary(&self) -> OvernightSummary {
        let cfg = self.config.lock().unwrap().clone();
        let tickets = self.store.list_tickets();
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let runs_tonight = tickets
            .iter()
            .filter(|t| {
                t.created_at.starts_with(&today)
                    && matches!(t.status.as_str(), "approved" | "running" | "done" | "failed")
            })
            .count();
        OvernightSummary {
            enabled: cfg.overnight_enabled,
            free_only: cfg.overnight_budget_usd <= 0.0,
            nightly_budget_usd: cfg.overnight_budget_usd,
            spent_today_usd: 0.0,
            runs_tonight,
            max_runs_per_night: cfg.overnight_max_runs_per_night,
            tickets,
        }
    }

    pub fn build_snapshot(&self) -> Snapshot {
        let now = now_sec();
        let runs = self.store.list_runs();
        let workers = self.registry.key_status();
        let sys = collect_system_info();
        let (jobs, cron_live) = self.store.list_jobs_with_live();
        let disc = self.discovery.lock().unwrap().clone();
        let cfg = self.config.lock().unwrap().clone();
        let readiness = build_readiness_report(&disc, &cfg.key_tiers);
        let overnight = self.build_overnight_summary();

        let parse_epoch = |iso: &str| -> f64 {
            DateTime::parse_from_rfc3339(iso)
                .map(|dt| dt.timestamp_millis() as f64 / 1000.0)
                .unwrap_or(now)
        };

        let workers_live: Vec<LiveWorker> = runs
            .iter()
            .filter(|r| r.state == RunState::Running || r.state == RunState::Leased)
            .map(|r| {
                let started = parse_epoch(&r.created_at);
                let live_elapsed = (now - started).max(0.0);
                LiveWorker {
                    pid: r.pid.unwrap_or(0),
                    worker: r.worker.clone(),
                    caller: r.caller.clone(),
                    key: r.key_name.clone(),
                    model: r.model.clone(),
                    provider: r.provider.clone(),
                    run_id: Some(r.id.clone()),
                    task: r.prompt.clone(),
                    started,
                    elapsed_s: r
                        .elapsed_ms
                        .map(|m| m as f64 / 1000.0)
                        .unwrap_or(live_elapsed),
                    fanout_group: r.fanout_group.clone(),
                }
            })
            .collect();

        let completed_24h = runs.iter().filter(|r| r.state == RunState::Done).count();
        let failed_24h = runs
            .iter()
            .filter(|r| {
                r.state == RunState::Failed
                    || r.state == RunState::Escalated
                    || r.state == RunState::Blocked
            })
            .count();
        let finished: Vec<f64> = runs
            .iter()
            .filter_map(|r| r.elapsed_ms.map(|m| m as f64 / 1000.0))
            .collect();
        let avg_duration_s = if finished.is_empty() {
            None
        } else {
            Some(finished.iter().sum::<f64>() / finished.len() as f64)
        };

        let sessions = runs
            .into_iter()
            .take(60)
            .map(|r| {
                let ts = parse_epoch(&r.created_at);
                let is_active = r.state == RunState::Running || r.state == RunState::Leased;
                let duration_s = if is_active {
                    (now - ts).max(0.0)
                } else {
                    r.elapsed_ms.unwrap_or(0) as f64 / 1000.0
                };
                let gate_status = r.gate_status.or_else(|| {
                    r.gate_passed.map(|p| {
                        if p {
                            "passed".to_string()
                        } else {
                            "failed".to_string()
                        }
                    })
                });
                SessionRow {
                    id: r.id,
                    ts,
                    prompt: r.prompt,
                    worker: r.worker,
                    caller: r.caller,
                    key: r.key_name,
                    model: r.model,
                    state: r.state.as_str().to_string(),
                    duration_s,
                    reason: r.error,
                    output: r.output,
                    receipt_id: r.receipt_id,
                    cooked: r.cooked,
                    steps: r.steps,
                    fanout_group: r.fanout_group,
                    failover_from: r.failover_from,
                    tokens_in: r.tokens_in,
                    tokens_out: r.tokens_out,
                    gate_status,
                    cost_tier: r.cost_tier,
                    escalation_from: r.escalation_from,
                    sandbox_tier: r.sandbox_tier,
                    complexity_tier: r.complexity_tier,
                    spec_id: r.spec_id,
                }
            })
            .collect();

        let watchdog = self.watchdog.current_status();
        let sandbox = probe_sandbox_health();
        let swarm = self.swarm.summary();
        let gateway = build_channel_gateway_status();
        let specs = self.store.list_specs();

        Snapshot {
            ts: now,
            overview: Overview {
                running: workers_live.len(),
                live_workers: workers_live.len(),
                completed_24h,
                failed_24h,
                avg_duration_s,
                cost_24h_usd: Some(0.0),
                calls_24h: Some(completed_24h + failed_24h + workers_live.len()),
                cpu_pct: sys.cpu_pct,
            },
            workers,
            workers_live,
            sessions,
            jobs,
            cron_live,
            router: RouterState {
                up: true,
                serve: true,
                proxy: true,
            },
            system: sys,
            telemetry: self.telemetry.lock().unwrap().iter().cloned().collect(),
            readiness,
            overnight,
            watchdog: Some(watchdog),
            sandbox: Some(sandbox),
            swarm: Some(swarm),
            gateway: Some(gateway),
            specs,
        }
    }
}

/// One long-lived sampler. CPU usage needs two samples, and building a new `System` for every
/// poll scanned every process on the machine several times a minute.
static SAMPLER: std::sync::OnceLock<std::sync::Mutex<System>> = std::sync::OnceLock::new();

pub fn collect_system_info() -> SystemInfo {
    let cell = SAMPLER.get_or_init(|| std::sync::Mutex::new(System::new()));
    let mut sys = cell.lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let me = sysinfo::Pid::from_u32(std::process::id());
    let kind = sysinfo::ProcessRefreshKind::new().with_cpu().with_memory();
    sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::Some(&[me]), true, kind);
    let parent = sys.process(me).and_then(|p| p.parent());
    let mut pids = vec![me];
    if let Some(pp) = parent {
        sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::Some(&[pp]), true, kind);
        let is_tray = sys
            .process(pp)
            .map(|p| {
                let n = p.name().to_string_lossy();
                n.contains("lingonberry-tray") || n.contains("Lingonberry")
            })
            .unwrap_or(false);
        if is_tray {
            pids.push(pp);
        }
    }
    let app_cpu: f32 = pids
        .iter()
        .filter_map(|p| sys.process(*p))
        .map(|p| p.cpu_usage())
        .sum();
    let app_ram: u64 = pids
        .iter()
        .filter_map(|p| sys.process(*p))
        .map(|p| p.memory())
        .sum();
    let app_ram_gb = Some((app_ram as f64 / 1_073_741_824.0 * 100.0).round() / 100.0);
    let app_cpu_pct = Some(app_cpu as f64);

    let cpu_pct = if sys.cpus().is_empty() {
        None
    } else {
        let sum: f32 = sys.cpus().iter().map(|c| c.cpu_usage()).sum();
        Some((sum / sys.cpus().len() as f32) as f64)
    };
    let load1 = Some(System::load_average().one);
    let ram_total_gb = Some((sys.total_memory() as f64 / 1_073_741_824.0 * 10.0).round() / 10.0);
    let ram_used_gb = Some((sys.used_memory() as f64 / 1_073_741_824.0 * 10.0).round() / 10.0);

    let disks = Disks::new_with_refreshed_list();
    let (disk_used_gb, disk_total_gb) = disks
        .iter()
        .next()
        .map(|d| {
            let total = d.total_space() as f64 / 1_073_741_824.0;
            let avail = d.available_space() as f64 / 1_073_741_824.0;
            (
                Some(((total - avail) * 10.0).round() / 10.0),
                Some((total * 10.0).round() / 10.0),
            )
        })
        .unwrap_or((None, None));

    SystemInfo {
        cpu_pct,
        load1,
        ram_used_gb,
        ram_total_gb,
        disk_used_gb,
        disk_total_gb,
        app_cpu_pct,
        app_ram_gb,
    }
}

#[derive(Debug, Deserialize)]
pub struct RouteBody {
    pub prompt: String,
    pub phase: Option<String>,
    pub caller: Option<String>,
    pub worktree: Option<bool>,
    pub approve: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct RunBody {
    pub prompt: String,
    pub caller: Option<String>,
    pub worker: Option<String>,
    pub phase: Option<String>,
    pub worktree: Option<bool>,
    pub simulate_fault: Option<String>,
    pub live_api: Option<bool>,
    pub gate: Option<String>,
    pub approve: Option<bool>,
    pub read_only: Option<bool>,
    pub path_globs: Option<Vec<String>>,
    pub sandbox_tier: Option<String>,
    pub spec_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SpecCreateBody {
    pub title: String,
    pub goal: String,
    pub repo_root: Option<String>,
    pub requirements_md: String,
    pub design_md: String,
    pub tasks_dag: Option<Vec<SpecWaveTask>>,
    pub allowed_path_globs: Option<Vec<String>>,
    pub forbidden_actions: Option<Vec<String>>,
    pub gate_cmd: Option<String>,
    pub sandbox_tier: Option<String>,
    pub max_budget_usd: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct FanoutBody {
    pub prompts: Option<Vec<String>>,
    pub prompt: Option<String>,
    pub caller: Option<String>,
    pub worktree: Option<bool>,
    pub approve: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct JobCreateBody {
    pub name: String,
    pub every_s: Option<u64>,
    pub schedule: Option<String>,
    pub command: Option<String>,
    pub prompt: Option<String>,
    pub source: Option<String>,
    pub auto_restart: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SelfConfigApplyBody {
    pub targets: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct KeyRpmBody {
    pub rpm: usize,
}

#[derive(Debug, Deserialize)]
pub struct KeyAddBody {
    pub provider: String,
    pub label: Option<String>,
    pub api_key: String,
    pub cost_tier: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub rpm_limit: Option<usize>,
    pub test_first: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct KeyTestBody {
    pub slot: Option<String>,
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OvernightToggleBody {
    pub enabled: Option<bool>,
    pub nightly_budget_usd: Option<f64>,
    pub max_runs_per_night: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct TicketApproveBody {
    pub allow_paid: Option<bool>,
}

#[derive(Debug, Serialize)]
struct VersionResp {
    pid: u32,
    version: &'static str,
    exe_mtime: f64,
}

fn local_proxy_listening(port: u16) -> bool {
    let addr: std::net::SocketAddr = ([127, 0, 0, 1], port).into();
    std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(60)).is_ok()
}

pub fn dispatch_run_async(state: AppState, opts: DispatchOptions) -> Run {
    let cfg = state.config.lock().unwrap().clone();
    let paid_allowed = opts.allow_paid || !cfg.paid_keys_require_approval;
    let simulate_env = std::env::var("LINGONBERRY_SIMULATE").ok().as_deref() == Some("1");
    let live_api = opts.allow_keys
        && !simulate_env
        && opts.simulate_fault.is_none()
        && (opts.live_api || state.execution == ExecutionMode::Live);

    let effective_worktree = opts.use_worktree && !opts.read_only;
    let discovery = state.discovery.lock().unwrap().clone();
    let receipt = route_prompt_with_budget(
        &opts.prompt,
        &opts.phase,
        opts.caller.as_deref(),
        &discovery,
        &state.registry,
        effective_worktree,
        opts.allow_keys,
        paid_allowed,
    );
    let _ = state.store.insert_receipt(&receipt);

    let cooked = receipt
        .cooked
        .clone()
        .unwrap_or_else(|| cook_prompt(&opts.prompt, &discovery, &opts.phase, effective_worktree));

    let effective_gate = opts
        .gate_cmd
        .clone()
        .filter(|g| !g.trim().is_empty() && g.trim() != "none");

    let complexity_tier = classify_complexity(&opts.prompt, effective_worktree)
        .as_str()
        .to_string();
    let sandbox_health = probe_sandbox_health();
    let selected_sandbox_res = select_sandbox_tier(
        opts.sandbox_tier.as_deref(),
        opts.phase == "overnight",
        opts.spec_id.is_some(),
        &sandbox_health,
    );
    let selected_sandbox_label = match &selected_sandbox_res {
        Ok(t) => Some(t.as_str().to_string()),
        Err(_) => opts.sandbox_tier.clone(),
    };

    let now = now_sec();
    let make_rejected_run = |worker_name: String,
                             provider: Option<String>,
                             cost_tier: Option<String>,
                             run_state: RunState,
                             title: String,
                             detail: String|
     -> Run {
        let failed = Run {
            id: Uuid::new_v4().to_string()[..8].to_string(),
            created_at: Utc::now().to_rfc3339(),
            worker: worker_name,
            caller: opts.caller.clone(),
            key_name: None,
            model: None,
            provider,
            prompt: opts.prompt.clone(),
            gate: effective_gate.clone().or_else(|| Some(cooked.gate_policy.clone())),
            state: run_state,
            pid: None,
            os_pid: None,
            elapsed_ms: Some(4),
            gate_passed: None,
            gate_status: Some("not_run".into()),
            worktree_path: None,
            cost_tier,
            budget_approved: Some(paid_allowed),
            error: Some(detail.clone()),
            output: None,
            task_class: Some(cooked.task_class.clone()),
            receipt_id: Some(receipt.receipt_id.clone()),
            cooked: Some(cooked.clone()),
            steps: vec![
                SessionStep {
                    ts: now,
                    stage: "received".into(),
                    title: "Prompt received".into(),
                    detail: format!(
                        "{} · {}",
                        opts.caller.as_deref().unwrap_or("shell"),
                        opts.prompt
                    ),
                    tone: "info".into(),
                },
                SessionStep {
                    ts: now + 0.05,
                    stage: "routed".into(),
                    title,
                    detail,
                    tone: "error".into(),
                },
            ],
            fanout_group: opts.fanout_group.clone(),
            failover_from: None,
            escalation_from: None,
            sandbox_tier: selected_sandbox_label.clone(),
            complexity_tier: Some(complexity_tier.clone()),
            spec_id: opts.spec_id.clone(),
            tokens_in: None,
            tokens_out: None,
        };
        let _ = state.store.insert_run(&failed);
        failed
    };

    let selected_sandbox = match selected_sandbox_res {
        Ok(tier) => tier,
        Err(reason) => {
            return make_rejected_run(
                opts.worker_id.unwrap_or_else(|| "sandbox".into()),
                None,
                None,
                RunState::Blocked,
                "Sandbox isolation unavailable".into(),
                reason,
            );
        }
    };

    let mut spec_allowed_globs = opts.path_globs.clone().unwrap_or_default();
    if let Some(ref sid) = opts.spec_id {
        match state.store.get_spec(sid) {
            Some(spec) => {
                if let Err(err_msg) = spec.verify_signature() {
                    return make_rejected_run(
                        opts.worker_id.unwrap_or_else(|| "spec_guard".into()),
                        None,
                        None,
                        RunState::Blocked,
                        "Kiro Spec signature invalid".into(),
                        err_msg,
                    );
                }
                if spec_allowed_globs.is_empty() {
                    spec_allowed_globs = spec.allowed_path_globs;
                }
            }
            None => {
                return make_rejected_run(
                    opts.worker_id.unwrap_or_else(|| "spec_guard".into()),
                    None,
                    None,
                    RunState::Blocked,
                    "Kiro Spec not found".into(),
                    format!("No Kiro Spec with id '{sid}' exists"),
                );
            }
        }
    }

    let wd_status = state.watchdog.current_status();
    if let Some(paused_reason) = wd_status.paused_reason {
        if !opts.read_only {
            return make_rejected_run(
                opts.worker_id.unwrap_or_else(|| "watchdog".into()),
                None,
                None,
                RunState::Blocked,
                "Watchdog paused dispatch".into(),
                paused_reason,
            );
        }
    }

    // Explicit --worker MUST pass lookup AND policy checks (no silent fallback or policy bypass).
    let chosen = match opts.worker_id.as_deref() {
        Some(id) => match state.registry.find_worker(id) {
            Some(w) => {
                if let Err(excl) = validate_explicit_worker_policy(
                    &w,
                    &opts.prompt,
                    &state.registry,
                    opts.allow_keys,
                    paid_allowed,
                ) {
                    let st = if excl.code == "DOCTOR_DOWN" {
                        RunState::Failed
                    } else {
                        RunState::Blocked
                    };
                    return make_rejected_run(
                        w.id.clone(),
                        Some(w.provider.clone()),
                        Some(w.cost_tier.as_str().to_string()),
                        st,
                        format!("Policy blocked ({})", excl.code),
                        excl.evidence,
                    );
                }
                Some(w)
            }
            None => {
                return make_rejected_run(
                    id.to_string(),
                    None,
                    None,
                    RunState::Failed,
                    "Worker lookup failed".into(),
                    format!("No worker with id '{id}' in registry"),
                );
            }
        },
        None => receipt
            .selected
            .as_ref()
            .and_then(|s| state.registry.find_worker(&s.worker))
            .or_else(|| {
                state
                    .registry
                    .select_best_worker_excluding_tier(None, paid_allowed)
            }),
    };

    let steps = vec![
        SessionStep {
            ts: now,
            stage: "received".into(),
            title: "Prompt received".into(),
            detail: format!(
                "{} · {}",
                opts.caller.as_deref().unwrap_or("shell"),
                opts.prompt
            ),
            tone: "info".into(),
        },
        SessionStep {
            ts: now + 0.1,
            stage: "cooked".into(),
            title: format!("Cooked with {}", cooked.selected_skill),
            detail: format!(
                "Loop {} · Hook {} · Gate {}",
                cooked.workflow_loop.as_deref().unwrap_or("single"),
                cooked.selected_hook,
                effective_gate.as_deref().unwrap_or(&cooked.gate_policy)
            ),
            tone: "route".into(),
        },
    ];

    let Some(mut worker) = chosen else {
        let reason = receipt
            .abstention
            .clone()
            .unwrap_or_else(|| "No routable workers passed constraint filters".into());
        return make_rejected_run(
            opts.worker_id.unwrap_or_else(|| "unassigned".into()),
            None,
            None,
            RunState::Blocked,
            "Routing abstained".into(),
            reason,
        );
    };

    if !paid_allowed && worker.cost_tier == KeyCostTier::MeteredPaid {
        return make_rejected_run(
            worker.id.clone(),
            Some(worker.provider.clone()),
            Some(worker.cost_tier.as_str().to_string()),
            RunState::Blocked,
            "Paid key approval required".into(),
            "metered/paid key blocked until --approve or owner budget approval".into(),
        );
    }

    // Load watcher: refuse non-pi local CLI worker dispatch when the machine is overloaded.
    if state.load_throttled.load(Ordering::Relaxed) && worker.agent != "pi" {
        return make_rejected_run(
            worker.id.clone(),
            Some(worker.provider.clone()),
            Some(worker.cost_tier.as_str().to_string()),
            RunState::Blocked,
            "Load throttled".into(),
            format!(
                "Worker {} paused: CPU/RAM high; use `pi` workers or wait for recovery",
                worker.id
            ),
        );
    }

    let mut guard: Option<LeaseGuard> = None;
    let mut failover_from: Option<String> = None;
    if worker.key_name.is_some() || worker.agent == "pi" {
        match state
            .registry
            .lease_guard(worker.key_name.as_deref(), Some(&worker.provider))
        {
            Ok(g) => guard = Some(g),
            Err(e) => {
                let original = worker.id.clone();
                let alt = state
                    .registry
                    .select_best_worker_excluding_tier(Some(&worker.id), paid_allowed);
                let switched = alt.and_then(|alt| {
                    state
                        .registry
                        .lease_guard(alt.key_name.as_deref(), Some(&alt.provider))
                        .ok()
                        .map(|g| (alt, g))
                });
                if let Some((alt, g)) = switched {
                    failover_from = Some(original);
                    worker = alt;
                    guard = Some(g);
                } else {
                    return make_rejected_run(
                        worker.id.clone(),
                        Some(worker.provider.clone()),
                        Some(worker.cost_tier.as_str().to_string()),
                        RunState::Blocked,
                        "Key pool exhausted".into(),
                        e.to_string(),
                    );
                }
            }
        }
    }

    let key_name = guard.as_ref().map(|g| g.key_name().to_string());
    let mut full_steps = steps;
    full_steps.push(SessionStep {
        ts: now + 0.25,
        stage: "routed".into(),
        title: format!("Router selected {}", worker.id),
        detail: receipt
            .selected
            .as_ref()
            .map(|s| s.reason.clone())
            .unwrap_or_default(),
        tone: "route".into(),
    });
    full_steps.push(SessionStep {
        ts: now + 0.4,
        stage: "leased".into(),
        title: if opts.read_only {
            "Dispatching (read-only)…".into()
        } else if effective_worktree {
            "Dispatching in isolated worktree…".into()
        } else {
            "Dispatching task…".into()
        },
        detail: key_name
            .as_ref()
            .map(|k| format!("Leased slot {k} ({})", worker.provider))
            .unwrap_or_else(|| format!("Local CLI ({})", worker.agent)),
        tone: "active".into(),
    });

    let run_id = Uuid::new_v4().to_string()[..8].to_string();
    let pid = state.next_pid.fetch_add(1, Ordering::Relaxed);
    let run = Run {
        id: run_id.clone(),
        created_at: Utc::now().to_rfc3339(),
        worker: worker.id.clone(),
        caller: opts.caller.clone(),
        key_name: key_name.clone(),
        model: worker.model.clone(),
        provider: Some(worker.provider.clone()),
        prompt: opts.prompt.clone(),
        gate: effective_gate.clone().or_else(|| Some(cooked.gate_policy.clone())),
        state: RunState::Running,
        pid: Some(pid),
        os_pid: None,
        elapsed_ms: None,
        gate_passed: None,
        gate_status: Some("not_run".into()),
        worktree_path: None,
        cost_tier: Some(worker.cost_tier.as_str().to_string()),
        budget_approved: Some(paid_allowed),
        error: None,
        output: None,
        task_class: Some(cooked.task_class.clone()),
        receipt_id: Some(receipt.receipt_id.clone()),
        cooked: Some(cooked.clone()),
        steps: full_steps,
        fanout_group: opts.fanout_group.clone(),
        failover_from,
        escalation_from: None,
        sandbox_tier: Some(selected_sandbox.as_str().to_string()),
        complexity_tier: Some(complexity_tier.clone()),
        spec_id: opts.spec_id.clone(),
        tokens_in: None,
        tokens_out: None,
    };
    let _ = state.store.insert_run(&run);
    log_event(
        if opts.fanout_group.is_some() {
            "fanout_dispatch"
        } else {
            "run_dispatch"
        },
        serde_json::json!({
            "run_id": run.id,
            "worker": run.worker,
            "key_name": run.key_name,
            "fanout_group": run.fanout_group,
            "worktree": effective_worktree,
            "read_only": opts.read_only,
        }),
    );

    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    state.active_cancels.lock().unwrap().insert(pid, cancel_tx);

    let run_clone = run.clone();
    let cli_timeout_s = cfg.cli_timeout_s.max(5);
    let server_port = cfg.port;
    let simulate_fault = opts.simulate_fault.clone();
    let read_only = opts.read_only;

    tokio::spawn(async move {
        let _slot_permit = state.swarm.acquire_worker_slot().await;
        let run_started = std::time::Instant::now();
        let base_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let worktree_handle = if effective_worktree {
            WorktreeHandle::create(&run_id, &base_cwd)
        } else {
            None
        };
        if let Some(ref wt) = worktree_handle {
            let wt_str = wt.worktree_path.to_string_lossy().into_owned();
            state
                .store
                .update_run_os_pid(&run_id, None, Some(wt_str.clone()));
            state.store.append_step(
                &run_id,
                SessionStep {
                    ts: now_sec(),
                    stage: "worktree".into(),
                    title: "Git worktree created".into(),
                    detail: wt_str,
                    tone: "info".into(),
                },
            );
        } else if effective_worktree {
            state.store.append_step(
                &run_id,
                SessionStep {
                    ts: now_sec(),
                    stage: "worktree".into(),
                    title: "Worktree skipped (not a git repo)".into(),
                    detail: format!("Running directly in {}", base_cwd.display()),
                    tone: "warn".into(),
                },
            );
        }

        let work_dir = worktree_handle
            .as_ref()
            .map(|w| w.worktree_path.clone())
            .unwrap_or_else(|| base_cwd.clone());

        if effective_worktree {
            if let Err(conflict) = state.swarm.acquire_path_lease(
                &run_id,
                &base_cwd,
                spec_allowed_globs.clone(),
                &work_dir,
                selected_sandbox.as_str(),
            ) {
                state.store.finish_run_with_gate(
                    &run_id,
                    RunState::Blocked,
                    Some(run_started.elapsed().as_millis() as u64),
                    Some(false),
                    Some("not_run"),
                    Some(conflict),
                    None,
                    None,
                    None,
                );
                state.swarm.mark_worker_finished();
                return;
            }
        }

        let session_key = normalize_channel_session_key(
            opts.caller.as_deref().unwrap_or("menubar"),
            &run_id,
            opts.spec_id.as_deref(),
        );
        let _steering = load_matching_steering(
            &base_cwd,
            &crate::agents::word_tokens(&opts.prompt)
                .into_iter()
                .collect::<Vec<_>>(),
        );
        state.watchdog.record_provider_call(
            &worker.provider,
            matches!(worker.agent.as_str(), "claude" | "codex"),
        );

        let finalize_with_gate = |output_text: String,
                                  tokens_in: Option<u64>,
                                  tokens_out: Option<u64>| {
            let mut full_out = output_text;
            if let Some(ref wt) = worktree_handle {
                if let Some(diff) = wt.diff_summary() {
                    full_out.push_str(&format!("\n\n[worktree diff]\n{diff}"));
                }
                if !spec_allowed_globs.is_empty() {
                    let scope_res = check_diff_scope_guard(&work_dir, &spec_allowed_globs);
                    if !scope_res.allowed {
                        let elapsed_ms = run_started.elapsed().as_millis() as u64;
                        let msg = format!(
                            "Scope drift blocked: out-of-scope edits in {}",
                            scope_res.out_of_scope_files.join(", ")
                        );
                        state.store.finish_run_with_gate(
                            &run_id,
                            RunState::Blocked,
                            Some(elapsed_ms),
                            Some(false),
                            Some("failed"),
                            Some(msg),
                            Some(full_out),
                            tokens_in,
                            tokens_out,
                        );
                        return;
                    }
                }
            }
            let gate_outcome = execute_verification_gate(effective_gate.as_deref(), &work_dir);
            let elapsed_ms = run_started.elapsed().as_millis() as u64;
            let mut final_state = match gate_outcome.status {
                "failed" => RunState::Failed,
                _ => RunState::Done,
            };
            let mut err = if gate_outcome.status == "failed" {
                Some(gate_outcome.detail.clone())
            } else {
                None
            };

            if gate_outcome.status == "failed" && simulate_fault.is_none() && !read_only {
                if let Some(esc) = select_escalation_candidate(
                    &worker,
                    &state.registry,
                    paid_allowed,
                    state.watchdog.subscription_headroom(),
                ) {
                    final_state = RunState::Escalated;
                    state.store.append_step(
                        &run_id,
                        SessionStep {
                            ts: now_sec(),
                            stage: "escalation".into(),
                            title: format!("Gate failed -> escalating {} -> {}", worker.id, esc.id),
                            detail: format!("Complexity {complexity_tier} escalated on gate failure within budget guard"),
                            tone: "warn".into(),
                        },
                    );
                    err = Some(format!(
                        "{} · escalated to {} ({})",
                        gate_outcome.detail, esc.id, esc.provider
                    ));
                }
            } else if gate_outcome.status == "passed" && worktree_handle.is_some() {
                state.swarm.enqueue_merge(
                    &run_id,
                    &base_cwd,
                    &work_dir,
                    effective_gate.as_deref().unwrap_or("none"),
                );
            }
            append_shared_memory_note(
                &session_key,
                &format!("run {} ({}) finished {:?}", run_id, worker.id, final_state.as_str()),
            );

            state.store.append_step(
                &run_id,
                SessionStep {
                    ts: now_sec(),
                    stage: "gate".into(),
                    title: match gate_outcome.status {
                        "passed" => "Verification gate passed".into(),
                        "failed" => "Verification gate failed".into(),
                        _ => "Completed (no gate run)".into(),
                    },
                    detail: gate_outcome.detail.clone(),
                    tone: if gate_outcome.status == "failed" {
                        "error".into()
                    } else if gate_outcome.status == "passed" {
                        "done".into()
                    } else {
                        "info".into()
                    },
                },
            );
            state.store.finish_run_with_gate(
                &run_id,
                final_state,
                Some(elapsed_ms),
                gate_outcome.passed,
                Some(gate_outcome.status),
                err,
                Some(full_out),
                tokens_in,
                tokens_out,
            );
        };

        let work = async {
            let fault = simulate_fault.as_deref().unwrap_or("none");
            if fault == "429" || fault == "truncated" {
                tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                let failed_slot = key_name.clone();
                if let Some(g) = guard.take() {
                    g.complete(false, Some(20));
                }
                let mut exclude = BTreeSet::new();
                if let Some(ref s) = failed_slot {
                    exclude.insert(s.clone());
                }
                if let Some(fallback) = state
                    .registry
                    .find_fallback_worker(&exclude, Some(&worker.provider))
                {
                    if let Ok(fb_guard) = state
                        .registry
                        .lease_guard(fallback.key_name.as_deref(), Some(&fallback.provider))
                    {
                        let fb_key = fb_guard.key_name().to_string();
                        state.store.append_step(
                            &run_id,
                            SessionStep {
                                ts: now_sec(),
                                stage: "failover".into(),
                                title: format!(
                                    "Auto-failover from {} → {fb_key}",
                                    failed_slot.as_deref().unwrap_or(&worker.id)
                                ),
                                detail: format!("Triggered by {fault} · retried on {}", fallback.id),
                                tone: "warn".into(),
                            },
                        );
                        state.store.update_dispatch_target(
                            &run_id,
                            fallback.id.clone(),
                            Some(fb_key.clone()),
                            Some(fallback.provider.clone()),
                            fallback.model.clone(),
                            failed_slot.clone(),
                        );
                        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                        fb_guard.complete(true, None);
                        finalize_with_gate(
                            format!("[simulated recovery on {} ({fb_key})]", fallback.id),
                            Some(120),
                            Some(64),
                        );
                        return;
                    }
                }
                let elapsed_ms = run_started.elapsed().as_millis() as u64;
                state.store.finish_run_with_gate(
                    &run_id,
                    RunState::Escalated,
                    Some(elapsed_ms),
                    Some(false),
                    Some("failed"),
                    Some(format!("{fault} fault detected; no other key free")),
                    None,
                    None,
                    None,
                );
                return;
            }

            // 1. Prefer real `pi-rust` CLI execution when `pi` is installed AND our local proxy is
            //    listening, OR for any other non-keyed local CLI agent (`claude`, `codex`, `opencode`, `omp`).
            let use_pi_cli = worker.agent == "pi"
                && worker.path.is_some()
                && local_proxy_listening(server_port);
            let use_local_cli = worker.key_name.is_none()
                && worker.agent != "pi"
                && worker.path.is_some();

            if use_pi_cli || use_local_cli {
                let bin_path = worker.path.as_deref().unwrap();
                if std::path::Path::new(bin_path).exists() {
                    if use_pi_cli {
                        // Proxy route will manage actual key lease per HTTP request.
                        if let Some(g) = guard.take() {
                            g.cancel();
                        }
                    }
                    let args: Vec<String> = match worker.agent.as_str() {
                        "claude" => vec!["-p".into(), cooked.cooked_prompt.clone()],
                        "codex" => {
                            let mut a = vec![
                                "exec".into(),
                                "-C".into(),
                                work_dir.to_string_lossy().into_owned(),
                            ];
                            if git_repo_root(&work_dir).is_none() {
                                a.push("--skip-git-repo-check".into());
                            }
                            if read_only {
                                a.push("--sandbox".into());
                                a.push("read-only".into());
                            }
                            a.push(cooked.cooked_prompt.clone());
                            a
                        }
                        "opencode" => vec!["run".into(), cooked.cooked_prompt.clone()],
                        "omp" => vec!["-p".into(), cooked.cooked_prompt.clone()],
                        "pi" => {
                            let provider = if worker.provider.is_empty() {
                                "nim".to_string()
                            } else {
                                worker.provider.clone()
                            };
                            let model = worker.model.clone().unwrap_or_else(|| {
                                "nvidia/nemotron-3.5-super-vl-120b-a12b".to_string()
                            });
                            vec![
                                "-p".into(),
                                "--provider".into(),
                                provider,
                                "--model".into(),
                                model,
                                cooked.cooked_prompt.clone(),
                            ]
                        }
                        _ => vec![cooked.cooked_prompt.clone()],
                    };

                    if use_pi_cli && !read_only {
                        // Ensure ~/.pi/agent proxy config stays fresh with current token/port.
                        if let Some(home) = dirs::home_dir() {
                            let d = state.discovery.lock().unwrap().clone();
                            let _ = configure_pi_rust(&home, &d);
                        }
                    }

                    let mut cmd = if selected_sandbox == SandboxTier::Seatbelt {
                        if let Some((sb_path, _)) = dirs::home_dir()
                            .and_then(|h| write_seatbelt_profile(&run_id, &h, &work_dir))
                        {
                            let mut c = TokioCommand::new("/usr/bin/sandbox-exec");
                            c.arg("-f").arg(sb_path).arg(bin_path).args(&args);
                            c
                        } else {
                            let mut c = TokioCommand::new(bin_path);
                            c.args(&args);
                            c
                        }
                    } else if selected_sandbox == SandboxTier::Docker
                        && effective_worktree
                        && which::which("docker").is_ok()
                    {
                        let mut full_worker_cmd = vec![bin_path.to_string()];
                        full_worker_cmd.extend(args.clone());
                        let d_args = build_docker_sandbox_args(
                            &work_dir,
                            "lingonberry/worker:latest",
                            server_port,
                            &state.api_token,
                            &full_worker_cmd,
                        );
                        let mut c = TokioCommand::new("docker");
                        c.args(&d_args);
                        c
                    } else {
                        let mut c = TokioCommand::new(bin_path);
                        c.args(&args);
                        c
                    };
                    cmd.current_dir(&work_dir)
                        .stdin(Stdio::null())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .kill_on_drop(true);
                    for (k, v) in safe_worker_env_limits() {
                        cmd.env(k, v);
                    }
                    if read_only {
                        cmd.env("LINGONBERRY_READ_ONLY", "1");
                    }

                    match cmd.spawn() {
                        Ok(child) => {
                            let child_os_pid = child.id();
                            if let Some(os_pid) = child_os_pid {
                                state.active_os_pids.lock().unwrap().insert(pid, os_pid);
                                state.store.update_run_os_pid(&run_id, Some(os_pid), None);
                            }

                            let wait_res = tokio::time::timeout(
                                std::time::Duration::from_secs(cli_timeout_s),
                                child.wait_with_output(),
                            )
                            .await;
                            state.active_os_pids.lock().unwrap().remove(&pid);

                            match wait_res {
                                Ok(Ok(o)) if o.status.success() => {
                                    if let Some(g) = guard.take() {
                                        g.complete(true, None);
                                    }
                                    let stdout_text =
                                        redact_secrets(&String::from_utf8_lossy(&o.stdout));
                                    let chars_in = cooked.cooked_prompt.chars().count() as u64;
                                    let chars_out = stdout_text.chars().count() as u64;
                                    finalize_with_gate(
                                        stdout_text,
                                        Some(chars_in / 4),
                                        Some(chars_out / 4),
                                    );
                                    return;
                                }
                                Ok(Ok(o)) => {
                                    if let Some(g) = guard.take() {
                                        g.complete(false, None);
                                    }
                                    let elapsed_ms = run_started.elapsed().as_millis() as u64;
                                    let stderr_text =
                                        redact_secrets(&String::from_utf8_lossy(&o.stderr));
                                    let stdout_tail =
                                        redact_secrets(&String::from_utf8_lossy(&o.stdout));
                                    let snippet: String = if !stderr_text.trim().is_empty() {
                                        stderr_text.trim().chars().take(2000).collect()
                                    } else {
                                        stdout_tail.trim().chars().take(2000).collect()
                                    };
                                    state.store.finish_run_with_gate(
                                        &run_id,
                                        RunState::Failed,
                                        Some(elapsed_ms),
                                        Some(false),
                                        Some("not_run"),
                                        Some(format!(
                                            "{} exited {:?}: {}",
                                            worker.agent,
                                            o.status.code(),
                                            snippet
                                        )),
                                        None,
                                        None,
                                        None,
                                    );
                                    return;
                                }
                                Ok(Err(err)) => {
                                    if let Some(g) = guard.take() {
                                        g.complete(false, None);
                                    }
                                    let elapsed_ms = run_started.elapsed().as_millis() as u64;
                                    state.store.finish_run_with_gate(
                                        &run_id,
                                        RunState::Failed,
                                        Some(elapsed_ms),
                                        Some(false),
                                        Some("not_run"),
                                        Some(format!("CLI wait error: {err}")),
                                        None,
                                        None,
                                        None,
                                    );
                                    return;
                                }
                                Err(_) => {
                                    if let Some(os_pid) = child_os_pid {
                                        let _ = kill_os_pid(os_pid);
                                    }
                                    if let Some(g) = guard.take() {
                                        g.complete(false, None);
                                    }
                                    let elapsed_ms = run_started.elapsed().as_millis() as u64;
                                    state.store.finish_run_with_gate(
                                        &run_id,
                                        RunState::Failed,
                                        Some(elapsed_ms),
                                        Some(false),
                                        Some("not_run"),
                                        Some(format!(
                                            "{} timed out after {}s",
                                            worker.agent, cli_timeout_s
                                        )),
                                        None,
                                        None,
                                        None,
                                    );
                                    return;
                                }
                            }
                        }
                        Err(err) => {
                            if let Some(g) = guard.take() {
                                g.complete(false, None);
                            }
                            let elapsed_ms = run_started.elapsed().as_millis() as u64;
                            state.store.finish_run_with_gate(
                                &run_id,
                                RunState::Failed,
                                Some(elapsed_ms),
                                Some(false),
                                Some("not_run"),
                                Some(format!("failed to spawn {}: {err}", worker.agent)),
                                None,
                                None,
                                None,
                            );
                            return;
                        }
                    }
                }
            }

            // 2. Direct provider-API path (used when live_api is on and pi-rust CLI is absent
            //    or standalone CLI runs without a local proxy server). Never falls back to simulated!
            if live_api {
                if let (Some(base_url), Some(slot), Some(model)) = (
                    worker.base_url.as_deref(),
                    key_name.as_deref(),
                    worker.model.as_deref(),
                ) {
                    let api_started = std::time::Instant::now();
                    match call_chunked(base_url, slot, model, &cooked).await {
                        Ok((text, finish_reason))
                            if !text.trim().is_empty()
                                && !is_output_truncated(&text, finish_reason.as_deref()) =>
                        {
                            let api_ms = api_started.elapsed().as_millis() as u64;
                            if let Some(g) = guard.take() {
                                g.complete(true, None);
                            }
                            let chars_in = cooked.cooked_prompt.chars().count() as u64;
                            let chars_out = text.chars().count() as u64;
                            state.store.append_step(
                                &run_id,
                                SessionStep {
                                    ts: now_sec(),
                                    stage: "execute".into(),
                                    title: "Live provider responded".into(),
                                    detail: format!(
                                        "{} ({model}) in {api_ms} ms",
                                        worker.provider
                                    ),
                                    tone: "done".into(),
                                },
                            );
                            finalize_with_gate(text, Some(chars_in / 4), Some(chars_out / 4));
                            return;
                        }
                        other => {
                            let failed_reason = match other {
                                Err(e) => redact_secrets(&format!("{e:#}")),
                                _ => "Truncated or empty provider response".to_string(),
                            };
                            if let Some(g) = guard.take() {
                                g.complete(false, Some(20));
                            }
                            let mut exclude = BTreeSet::new();
                            exclude.insert(slot.to_string());
                            if let Some(fallback) = state
                                .registry
                                .find_fallback_worker(&exclude, Some(&worker.provider))
                            {
                                if let (
                                    Some(fb_base),
                                    Some(fb_model),
                                    Ok(fb_guard),
                                ) = (
                                    fallback.base_url.as_deref(),
                                    fallback.model.as_deref(),
                                    state.registry.lease_guard(
                                        fallback.key_name.as_deref(),
                                        Some(&fallback.provider),
                                    ),
                                ) {
                                    let fb_key = fb_guard.key_name().to_string();
                                    state.store.append_step(
                                        &run_id,
                                        SessionStep {
                                            ts: now_sec(),
                                            stage: "failover".into(),
                                            title: format!("Auto-failover from {slot} → {fb_key}"),
                                            detail: format!(
                                                "{failed_reason} · retrying on {}",
                                                fallback.id
                                            ),
                                            tone: "warn".into(),
                                        },
                                    );
                                    state.store.update_dispatch_target(
                                        &run_id,
                                        fallback.id.clone(),
                                        Some(fb_key.clone()),
                                        Some(fallback.provider.clone()),
                                        fallback.model.clone(),
                                        Some(slot.to_string()),
                                    );
                                    let fb_started = std::time::Instant::now();
                                    if let Ok((retry_text, retry_finish)) = call_provider_api(
                                        fb_base,
                                        &fb_key,
                                        fb_model,
                                        &cooked.cooked_prompt,
                                    )
                                    .await
                                    {
                                        let fb_ms = fb_started.elapsed().as_millis() as u64;
                                        if !retry_text.trim().is_empty()
                                            && !is_output_truncated(
                                                &retry_text,
                                                retry_finish.as_deref(),
                                            )
                                        {
                                            fb_guard.complete(true, None);
                                            let fb_chars_in =
                                                cooked.cooked_prompt.chars().count() as u64;
                                            let fb_chars_out = retry_text.chars().count() as u64;
                                            state.store.append_step(
                                                &run_id,
                                                SessionStep {
                                                    ts: now_sec(),
                                                    stage: "execute".into(),
                                                    title: "Live failover succeeded".into(),
                                                    detail: format!(
                                                        "Recovered on {} ({fb_key}) in {fb_ms} ms",
                                                        fallback.id
                                                    ),
                                                    tone: "done".into(),
                                                },
                                            );
                                            finalize_with_gate(
                                                retry_text,
                                                Some(fb_chars_in / 4),
                                                Some(fb_chars_out / 4),
                                            );
                                            return;
                                        }
                                    }
                                    fb_guard.complete(false, Some(20));
                                }
                            }
                            let elapsed_ms = run_started.elapsed().as_millis() as u64;
                            state.store.finish_run_with_gate(
                                &run_id,
                                RunState::Escalated,
                                Some(elapsed_ms),
                                Some(false),
                                Some("not_run"),
                                Some(format!("{failed_reason}; failover exhausted")),
                                None,
                                None,
                                None,
                            );
                            return;
                        }
                    }
                } else {
                    if let Some(g) = guard.take() {
                        g.cancel();
                    }
                    let elapsed_ms = run_started.elapsed().as_millis() as u64;
                    state.store.finish_run_with_gate(
                        &run_id,
                        RunState::Failed,
                        Some(elapsed_ms),
                        Some(false),
                        Some("not_run"),
                        Some(format!(
                            "worker {} has no runnable CLI binary or configured API endpoint/model",
                            worker.id
                        )),
                        None,
                        None,
                        None,
                    );
                    return;
                }
            }

            // 3. Explicit simulation mode only (`ExecutionMode::Simulate` or `LINGONBERRY_SIMULATE=1`).
            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
            if let Some(g) = guard.take() {
                g.cancel();
            }
            let elapsed_ms = run_started.elapsed().as_millis() as u64;
            state.store.append_step(
                &run_id,
                SessionStep {
                    ts: now_sec(),
                    stage: "gate".into(),
                    title: "Simulated — execution=simulate".into(),
                    detail: format!(
                        "worker {} simulated (live dispatch disabled); no key spent",
                        worker.id
                    ),
                    tone: "warn".into(),
                },
            );
            state.store.finish_run_with_gate(
                &run_id,
                RunState::Done,
                Some(elapsed_ms),
                None,
                Some("not_run"),
                None,
                Some(redact_secrets(&format!(
                    "[simulated] {} · skill={} · no verification gate run",
                    worker.id, cooked.selected_skill
                ))),
                None,
                None,
            );
        };

        tokio::select! {
            _ = work => {
                state.active_cancels.lock().unwrap().remove(&pid);
                state.active_os_pids.lock().unwrap().remove(&pid);
            }
            _ = &mut cancel_rx => {
                if let Some(os_pid) = state.active_os_pids.lock().unwrap().remove(&pid) {
                    let _ = kill_os_pid(os_pid);
                }
                let elapsed_ms = run_started.elapsed().as_millis() as u64;
                state.store.finish_run_with_gate(
                    &run_id,
                    RunState::Failed,
                    Some(elapsed_ms),
                    Some(false),
                    Some("not_run"),
                    Some(format!("killed by user (pid {pid})")),
                    None,
                    None,
                    None,
                );
            }
        }
        if let Some(ref wt) = worktree_handle {
            // Keep dirty worktrees inspectable; prune clean ones automatically.
            if wt.diff_summary().is_none() {
                wt.cleanup();
            }
        }
        state.swarm.release_lease(&run_id);
        state.swarm.mark_worker_finished();
    });

    run_clone
}

pub fn build_router(state: AppState) -> Router {
    let cors = tower_http::cors::CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::predicate(owner_origin_value))
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);
    Router::new()
        .route("/health", get(get_health))
        .route("/snapshot", get(get_snapshot))
        .route("/api/snapshot", get(get_snapshot))
        .route("/api/capabilities", get(get_capabilities))
        .route("/api/readiness", get(get_readiness))
        .route("/api/install/pi", post(post_install_pi))
        .route("/keys", get(get_keys))
        .route("/api/keys", get(get_keys))
        .route("/api/keys/add", post(post_key_add))
        .route("/api/keys/test", post(post_key_test))
        .route("/api/keys/:name", delete(delete_key))
        .route("/api/load", get(get_load))
        .route("/keys/:name/reset", post(post_key_reset))
        .route("/api/keys/:name/reset", post(post_key_reset))
        .route("/api/keys/:name/rpm", post(post_key_rpm))
        .route("/runs", get(get_runs))
        .route("/api/runs", get(get_runs))
        .route("/runs/:id", get(get_run_by_id))
        .route("/api/runs/:id", get(get_run_by_id))
        .route("/discover", get(get_discover))
        .route("/api/discover", get(get_discover))
        .route("/receipts", get(get_receipts))
        .route("/api/receipts", get(get_receipts))
        .route("/receipts/:id", get(get_receipt_by_id))
        .route("/api/receipts/:id", get(get_receipt_by_id))
        .route("/kill/:pid", post(post_kill))
        .route("/api/kill/:pid", post(post_kill))
        .route("/version", get(get_version))
        .route("/api/version", get(get_version))
        .route("/shutdown", post(post_shutdown))
        .route("/api/rescan", post(post_rescan))
        .route("/api/route", post(post_route))
        .route("/api/run", post(post_run))
        .route("/api/fanout", post(post_fanout))
        .route("/api/jobs", get(get_jobs).post(post_job))
        .route("/api/jobs/rescan", post(post_jobs_rescan))
        .route("/api/jobs/kill/:pid", post(post_job_kill_pid))
        .route("/api/jobs/:name/toggle", post(post_job_toggle))
        .route("/api/jobs/:name/run", post(post_job_run))
        .route("/api/jobs/:name/heal", post(post_job_heal))
        .route("/api/jobs/:name/simulate-crash", post(post_job_simulate_crash))
        .route("/api/jobs/:name/watchdog", post(post_job_watchdog))
        .route("/api/jobs/:name", delete(delete_job))
        .route("/api/self-config", get(get_self_config))
        .route("/api/self-config/apply", post(post_self_config_apply))
        .route("/api/overnight", get(get_overnight))
        .route("/api/overnight/toggle", post(post_overnight_toggle))
        .route("/api/overnight/scan", post(post_overnight_scan))
        .route("/api/overnight/tickets/:id/approve", post(post_ticket_approve))
        .route("/api/overnight/tickets/:id/defer", post(post_ticket_defer))
        .route("/api/specs", get(get_specs).post(post_spec_create))
        .route("/api/specs/:id/approve", post(post_spec_approve))
        .route("/api/specs/:id/run", post(post_spec_run))
        .route("/api/watchdog", get(get_watchdog))
        .route("/api/swarm", get(get_swarm))
        .route("/api/channels", get(get_channels))
        .route("/v1/chat/completions", post(post_v1_chat_completions))
        .layer(axum::middleware::from_fn_with_state(state.clone(), guard))
        .layer(cors)
        .with_state(state)
}

async fn get_health() -> impl IntoResponse {
    Json(serde_json::json!({ "ok": true }))
}

async fn get_snapshot(State(state): State<AppState>) -> Json<Snapshot> {
    Json(state.build_snapshot())
}

async fn get_keys(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.registry.key_status())
}

async fn get_load(State(state): State<AppState>) -> impl IntoResponse {
    let sys = collect_system_info();
    let throttled = state.load_throttled.load(Ordering::Relaxed);
    Json(serde_json::json!({
        "throttled": throttled,
        "cpu_pct": sys.cpu_pct,
        "ram_pct": sys.ram_used_gb.zip(sys.ram_total_gb).map(|(u, t)| (u / t) * 100.0),
        "load1": sys.load1,
        "app_ram_gb": sys.app_ram_gb,
        "active_runs": state.store.list_runs().iter().filter(|r| r.state == RunState::Running || r.state == RunState::Leased).count(),
    }))
}

async fn get_runs(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.store.list_runs())
}

async fn get_run_by_id(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    match state.store.get_run(&id) {
        Some(r) => Json(r).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn get_capabilities(State(state): State<AppState>) -> impl IntoResponse {
    let disc = state.discovery.lock().unwrap().clone();
    let cfg = state.config.lock().unwrap().clone();
    let providers: Vec<String> = disc.keys.keys().cloned().collect();
    let readiness = build_readiness_report(&disc, &cfg.key_tiers);
    Json(serde_json::json!({
        "live_google_available": disc.keys.contains_key("google"),
        "discovered_providers": providers,
        "rust_core_present": true,
        "runtime": "rust-core",
        "readiness": readiness,
    }))
}

async fn get_readiness(State(state): State<AppState>) -> impl IntoResponse {
    let disc = state.discovery.lock().unwrap().clone();
    let cfg = state.config.lock().unwrap().clone();
    let report = build_readiness_report(&disc, &cfg.key_tiers);
    let install_cmd = recommended_pi_install_cmd()
        .map(|(p, args)| format!("{p} {}", args.join(" ")));
    Json(serde_json::json!({
        "readiness": report,
        "pi_install_cmd": install_cmd,
    }))
}

async fn post_install_pi(State(state): State<AppState>) -> impl IntoResponse {
    let Some((prog, args)) = recommended_pi_install_cmd() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "ok": false,
                "error": "Neither `cargo` nor `brew` was found on PATH to install pi-rust"
            })),
        )
            .into_response();
    };
    let args_owned: Vec<String> = args.into_iter().map(str::to_string).collect();
    let out = tokio::task::spawn_blocking(move || {
        std::process::Command::new(prog).args(&args_owned).output()
    })
    .await;

    match out {
        Ok(Ok(res)) if res.status.success() => {
            let disc = scan_discovery();
            let cfg = state.config.lock().unwrap().clone();
            state.registry.refresh(&disc, &cfg);
            if let Some(home) = dirs::home_dir() {
                let _ = configure_pi_rust(&home, &disc);
            }
            let readiness = build_readiness_report(&disc, &cfg.key_tiers);
            *state.discovery.lock().unwrap() = disc;
            log_event("pi_installed", serde_json::json!({ "ok": true }));
            Json(serde_json::json!({
                "ok": true,
                "readiness": readiness,
                "snapshot": state.build_snapshot()
            }))
            .into_response()
        }
        Ok(Ok(res)) => {
            let err = redact_secrets(&String::from_utf8_lossy(&res.stderr));
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "ok": false,
                    "error": format!("install exited {:?}: {}", res.status.code(), err.chars().take(600).collect::<String>())
                })),
            )
                .into_response()
        }
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "ok": false, "error": format!("spawn failed: {e}") })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "ok": false, "error": format!("task failed: {e}") })),
        )
            .into_response(),
    }
}

pub fn is_owner_origin_str(o: &str) -> bool {
    o == "tauri://localhost" || o == "http://tauri.localhost"
}

fn owner_origin_value(origin: &axum::http::HeaderValue, _: &axum::http::request::Parts) -> bool {
    origin.to_str().map(is_owner_origin_str).unwrap_or(false)
}

fn has_valid_bearer(headers: &axum::http::HeaderMap, expected_token: &str) -> bool {
    let Some(raw) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };
    let Some(token) = raw.strip_prefix("Bearer ").map(str::trim) else {
        return false;
    };
    constant_time_eq(token, expected_token)
}

pub fn is_owner_request(headers: &axum::http::HeaderMap, expected_token: &str) -> bool {
    if !has_valid_bearer(headers, expected_token) {
        return false;
    }
    match headers
        .get(axum::http::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
    {
        Some(o) => is_owner_origin_str(o),
        None => true,
    }
}

/// Host, Origin, and Bearer-token guard:
/// 1. Blocks DNS rebinding (`Host` must be loopback).
/// 2. Blocks state changes / proxy spend from untrusted browser origins.
/// 3. Requires owner-only `Authorization: Bearer <token>` on ALL mutating routes and `/v1/*` proxy.
async fn guard(
    State(state): State<AppState>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::http::{header, Method};
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let host_ok = host.is_empty()
        || host == "127.0.0.1"
        || host.starts_with("127.0.0.1:")
        || host == "localhost"
        || host.starts_with("localhost:")
        || host == "[::1]"
        || host.starts_with("[::1]:");
    if !host_ok {
        return (StatusCode::FORBIDDEN, "host not allowed").into_response();
    }

    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let owner_origin = origin.as_deref().map(is_owner_origin_str).unwrap_or(false);
    let path = req.uri().path().to_string();
    let is_proxy = path.starts_with("/v1/");
    let mutating = matches!(*req.method(), Method::POST | Method::PUT | Method::DELETE);

    if (mutating || is_proxy) && origin.is_some() && !owner_origin {
        return (StatusCode::FORBIDDEN, "browser origins cannot modify state or spend keys")
            .into_response();
    }

    if (mutating || is_proxy) && !has_valid_bearer(req.headers(), &state.api_token) {
        return (StatusCode::UNAUTHORIZED, "missing or invalid bearer token").into_response();
    }

    next.run(req).await
}

async fn get_discover(State(state): State<AppState>) -> impl IntoResponse {
    let disc = state.discovery.lock().unwrap().clone();
    let workers = state.registry.list_workers();
    Json(serde_json::json!({
        "agents": disc.agents,
        "keys": disc.keys,
        "providers": disc.providers,
        "library_dirs": disc.library_dirs,
        "ssh_hosts": disc.ssh_hosts,
        "git_projects": disc.git_projects,
        "browsers": disc.browsers,
        "keychain_slots": disc.keychain_slots,
        "workers": workers,
    }))
}

async fn get_receipts(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.store.list_receipts())
}

async fn get_receipt_by_id(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    match state.store.get_receipt(&id) {
        Some(r) => Json(r).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn post_kill(
    State(state): State<AppState>,
    AxumPath(pid): AxumPath<u32>,
) -> impl IntoResponse {
    let tx = state.active_cancels.lock().unwrap().remove(&pid);
    match tx {
        Some(sender) => {
            let _ = sender.send(());
            log_event("kill_pid", serde_json::json!({ "pid": pid }));
            Json(serde_json::json!({ "ok": true, "pid": pid })).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn get_version() -> Json<VersionResp> {
    Json(VersionResp {
        pid: std::process::id(),
        version: env!("CARGO_PKG_VERSION"),
        exe_mtime: 0.0,
    })
}

async fn post_shutdown(State(state): State<AppState>) -> impl IntoResponse {
    if let Some(tx) = state.shutdown_tx.lock().unwrap().take() {
        let _ = tx.send(());
    }
    Json(serde_json::json!({ "ok": true }))
}

async fn post_key_reset(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    if state.registry.clear_cooldown(&name) {
        log_event("key_reset", serde_json::json!({ "name": name }));
        Json(serde_json::json!({ "ok": true, "snapshot": state.build_snapshot() })).into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn post_key_rpm(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
    Json(body): Json<KeyRpmBody>,
) -> impl IntoResponse {
    if state.registry.set_rpm_limit(&name, body.rpm) {
        log_event(
            "key_rpm_cap",
            serde_json::json!({ "target": name, "rpm": body.rpm }),
        );
        Json(serde_json::json!({ "ok": true, "snapshot": state.build_snapshot() })).into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn post_key_add(
    State(state): State<AppState>,
    Json(body): Json<KeyAddBody>,
) -> impl IntoResponse {
    let prov = body.provider.trim().to_ascii_lowercase();
    if prov.is_empty() || body.api_key.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "error": "provider and api_key are required" })),
        )
            .into_response();
    }
    let label = body
        .label
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("default");
    let slot = make_slot_name(&prov, label);

    let default_base = body
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| known_provider(&prov).map(|(u, _, _)| u.to_string()));

    let mut discovered_models = Vec::new();
    if body.test_first.unwrap_or(true) {
        if let Some(ref base) = default_base {
            match probe_provider_models(base, body.api_key.trim()).await {
                Ok(models) => discovered_models = models,
                Err(e) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({
                            "ok": false,
                            "error": format!("Key validation failed: {e}")
                        })),
                    )
                        .into_response();
                }
            }
        }
    }

    let tier = body
        .cost_tier
        .as_deref()
        .map(KeyCostTier::from_str)
        .unwrap_or_else(|| infer_cost_tier(&prov, Some(&slot)));
    let chosen_model = body
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| discovered_models.first().cloned())
        .or_else(|| known_provider(&prov).and_then(|(_, _, m)| m.map(str::to_string)));

    let meta = KeychainSlotMeta {
        slot: slot.clone(),
        provider: prov.clone(),
        label: label.to_string(),
        cost_tier: tier.as_str().to_string(),
        rpm_limit: body.rpm_limit,
        base_url: default_base,
        model: chosen_model,
    };

    if let Err(e) = store_secret(&slot, body.api_key.trim(), meta) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "ok": false, "error": format!("{e}") })),
        )
            .into_response();
    }

    let disc = scan_discovery();
    let cfg = state.config.lock().unwrap().clone();
    state.registry.refresh(&disc, &cfg);
    if let Some(home) = dirs::home_dir() {
        let _ = configure_pi_rust(&home, &disc);
    }
    *state.discovery.lock().unwrap() = disc;
    log_event(
        "key_added",
        serde_json::json!({ "slot": slot, "provider": prov, "cost_tier": tier.as_str() }),
    );
    Json(serde_json::json!({
        "ok": true,
        "slot": slot,
        "models": discovered_models,
        "snapshot": state.build_snapshot(),
    }))
    .into_response()
}

async fn post_key_test(
    State(state): State<AppState>,
    Json(body): Json<KeyTestBody>,
) -> impl IntoResponse {
    let (prov, secret) = if let Some(ref slot) = body.slot {
        let disc = state.discovery.lock().unwrap().clone();
        let found_prov = disc
            .keys
            .iter()
            .find(|(_, names)| names.iter().any(|n| n == slot))
            .map(|(p, _)| p.clone())
            .or_else(|| body.provider.clone())
            .unwrap_or_default();
        let Some(val) = resolve_key_value(slot) else {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "ok": false, "error": "Key value not found" })),
            )
                .into_response();
        };
        (found_prov, val)
    } else if let (Some(prov), Some(key)) = (body.provider.clone(), body.api_key.clone()) {
        (prov.to_ascii_lowercase(), key)
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "error": "Provide slot or provider+api_key" })),
        )
            .into_response();
    };

    let base_url = body
        .base_url
        .or_else(|| known_provider(&prov).map(|(u, _, _)| u.to_string()));
    let Some(url) = base_url else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "error": format!("No base URL known for {prov}") })),
        )
            .into_response();
    };

    match probe_provider_models(&url, &secret).await {
        Ok(models) => Json(serde_json::json!({ "ok": true, "models": models })).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn delete_key(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    if !name.starts_with("kc:") {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "ok": false,
                "error": "Only Keychain-managed slots (kc:*) can be deleted from Lingonberry; edit ~/.env or external stores manually"
            })),
        )
            .into_response();
    }
    match delete_secret(&name) {
        Ok(true) => {
            let disc = scan_discovery();
            let cfg = state.config.lock().unwrap().clone();
            state.registry.refresh(&disc, &cfg);
            if let Some(home) = dirs::home_dir() {
                let _ = configure_pi_rust(&home, &disc);
            }
            *state.discovery.lock().unwrap() = disc;
            log_event("key_deleted", serde_json::json!({ "slot": name }));
            Json(serde_json::json!({ "ok": true, "snapshot": state.build_snapshot() }))
                .into_response()
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "ok": false, "error": format!("{e}") })),
        )
            .into_response(),
    }
}

async fn post_rescan(State(state): State<AppState>) -> impl IntoResponse {
    let cfg = match load_config() {
        Ok(c) => {
            *state.config.lock().unwrap() = c.clone();
            c
        }
        Err(_) => state.config.lock().unwrap().clone(),
    };
    let disc = scan_discovery();
    state.registry.refresh(&disc, &cfg);
    if let Some(home) = dirs::home_dir() {
        let _ = configure_pi_rust(&home, &disc);
    }
    *state.discovery.lock().unwrap() = disc;
    state.store.rescan_host_jobs();
    Json(state.build_snapshot())
}

async fn post_route(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<RouteBody>,
) -> impl IntoResponse {
    let disc = state.discovery.lock().unwrap().clone();
    let cfg = state.config.lock().unwrap().clone();
    let owner = is_owner_request(&headers, &state.api_token);
    let allow_paid = body.approve.unwrap_or(false) || !cfg.paid_keys_require_approval;
    let receipt = route_prompt_with_budget(
        &body.prompt,
        body.phase.as_deref().unwrap_or("plan"),
        body.caller.as_deref(),
        &disc,
        &state.registry,
        body.worktree.unwrap_or(false),
        owner,
        allow_paid,
    );
    let _ = state.store.insert_receipt(&receipt);
    Json(receipt)
}

async fn post_run(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<RunBody>,
) -> impl IntoResponse {
    let owner = is_owner_request(&headers, &state.api_token);
    let run = dispatch_run_async(
        state.clone(),
        DispatchOptions {
            prompt: body.prompt,
            caller: body.caller,
            worker_id: body.worker,
            phase: body.phase.unwrap_or_else(|| "execute".into()),
            use_worktree: body.worktree.unwrap_or(false),
            simulate_fault: body.simulate_fault,
            live_api: body.live_api.unwrap_or(false),
            fanout_group: None,
            allow_keys: owner,
            allow_paid: body.approve.unwrap_or(false),
            gate_cmd: body.gate,
            read_only: body.read_only.unwrap_or(false),
            path_globs: body.path_globs,
            sandbox_tier: body.sandbox_tier,
            spec_id: body.spec_id,
        },
    );
    Json(serde_json::json!({ "run": run, "snapshot": state.build_snapshot() }))
}

async fn post_fanout(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<FanoutBody>,
) -> impl IntoResponse {
    let owner = is_owner_request(&headers, &state.api_token);
    let prompts: Vec<String> = match (body.prompts, body.prompt) {
        (Some(list), _) if !list.is_empty() => list,
        (_, Some(base)) if !base.trim().is_empty() => vec![
            format!("[Branch 1/3 · Architecture] {base}"),
            format!("[Branch 2/3 · Tests & Gate] {base}"),
            format!("[Branch 3/3 · Security] {base}"),
        ],
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };
    let group = format!("fan-{}", &Uuid::new_v4().to_string()[..6]);
    let workers = state.registry.list_workers();
    let allow_paid = body.approve.unwrap_or(false);
    let mut runs = Vec::new();
    for (idx, p) in prompts.into_iter().enumerate() {
        let w_id = if workers.is_empty() {
            None
        } else {
            Some(workers[idx % workers.len()].id.clone())
        };
        runs.push(dispatch_run_async(
            state.clone(),
            DispatchOptions {
                prompt: p,
                caller: body.caller.clone(),
                worker_id: w_id,
                phase: "fanout".into(),
                use_worktree: body.worktree.unwrap_or(false),
                simulate_fault: None,
                live_api: false,
                fanout_group: Some(group.clone()),
                allow_keys: owner,
                allow_paid,
                gate_cmd: None,
                read_only: false,
                ..Default::default()
            },
        ));
    }
    Json(serde_json::json!({
        "fanout_group": group,
        "runs": runs,
        "snapshot": state.build_snapshot()
    }))
    .into_response()
}

async fn get_jobs(State(state): State<AppState>) -> impl IntoResponse {
    let (jobs, cron_live) = state.store.list_jobs_with_live();
    Json(serde_json::json!({ "jobs": jobs, "cron_live": cron_live }))
}

async fn post_jobs_rescan(State(state): State<AppState>) -> impl IntoResponse {
    state.store.rescan_host_jobs();
    Json(state.build_snapshot())
}

async fn post_job_kill_pid(
    State(state): State<AppState>,
    AxumPath(pid): AxumPath<u32>,
) -> impl IntoResponse {
    // Only allow terminating processes spawned by Lingonberry OR belonging to a Lingonberry-managed job.
    let owned_run_pid = {
        let map = state.active_os_pids.lock().unwrap();
        map.values().any(|&os_pid| os_pid == pid)
    };
    let managed_cron_pid = {
        let (jobs, live) = state.store.list_jobs_with_live();
        live.iter().any(|p| {
            p.pid == pid
                && jobs
                    .iter()
                    .any(|j| j.name == p.job_name && j.scope == "managed" && !j.read_only)
        })
    };
    if !owned_run_pid && !managed_cron_pid {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "ok": false,
                "error": format!("PID {pid} is not owned by Lingonberry Router or a managed job")
            })),
        )
            .into_response();
    }

    if kill_os_pid(pid) {
        log_event("cron_kill_pid", serde_json::json!({ "pid": pid }));
        Json(serde_json::json!({ "ok": true, "pid": pid, "snapshot": state.build_snapshot() }))
            .into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

async fn post_job(
    State(state): State<AppState>,
    Json(body): Json<JobCreateBody>,
) -> impl IntoResponse {
    if body.command.is_some() {
        return (
            StatusCode::FORBIDDEN,
            "custom shell commands are not accepted over HTTP",
        )
            .into_response();
    }
    let every = body.every_s.unwrap_or(300).max(30);
    let cmd = format!(
        "lingonberry-core run \"{}\"",
        body.prompt.as_deref().unwrap_or(&body.name)
    );
    state.store.upsert_job(JobRow {
        name: body.name,
        source: body.source.unwrap_or_else(|| "lingonberry".into()),
        scope: "managed".into(),
        read_only: false,
        schedule: body.schedule.unwrap_or_else(|| format!("every {every}s")),
        command: cmd,
        every_s: Some(every),
        last: None,
        rc: None,
        paused: Some(false),
        next_in_s: Some(every),
        prompt: body.prompt,
        health: "healthy".into(),
        running_pid: None,
        crash_count: 0,
        restart_count: 0,
        auto_restart: body.auto_restart.unwrap_or(true),
        last_error: None,
        log_tail: vec!["Scheduled with watchdog monitoring".into()],
    });
    Json(state.store.list_jobs()).into_response()
}

async fn post_job_toggle(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    match state.store.toggle_job(&name) {
        Some(_) => Json(state.store.list_jobs()).into_response(),
        None => StatusCode::FORBIDDEN.into_response(),
    }
}

async fn post_job_watchdog(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    match state.store.toggle_watchdog(&name) {
        Some(_) => Json(state.store.list_jobs()).into_response(),
        None => StatusCode::FORBIDDEN.into_response(),
    }
}

async fn post_job_heal(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    match state.store.heal_job(&name) {
        Some(job) => {
            log_event("cron_healed", serde_json::json!({ "name": job.name }));
            Json(serde_json::json!({ "job": job, "snapshot": state.build_snapshot() }))
                .into_response()
        }
        None => StatusCode::FORBIDDEN.into_response(),
    }
}

async fn post_job_simulate_crash(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    match state.store.record_job_run(
        &name,
        137,
        Some("SIGKILL OOM / unhandled timeout (simulated)".into()),
    ) {
        Some(job) => {
            log_event(
                "cron_crash_simulated",
                serde_json::json!({ "name": job.name }),
            );
            Json(serde_json::json!({ "job": job, "snapshot": state.build_snapshot() }))
                .into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn post_job_run(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    let Some(existing) = state.store.list_jobs().into_iter().find(|j| j.name == name) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if existing.read_only || existing.scope == "discovered" {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "ok": false,
                "error": "Host-discovered launchd/cron jobs are monitored read-only and cannot be triggered from Lingonberry"
            })),
        )
            .into_response();
    }

    if existing.name == "doctor-health-sweep" {
        let cfg = state.config.lock().unwrap().clone();
        let disc = scan_discovery();
        state.registry.refresh(&disc, &cfg);
        let readiness = build_readiness_report(&disc, &cfg.key_tiers);
        *state.discovery.lock().unwrap() = disc;
        let _ = state.store.record_job_run(
            &existing.name,
            0,
            Some(format!(
                "mode={} · agents={} · free_keys={}",
                readiness.mode, readiness.agents_count, readiness.free_keys_count
            )),
        );
        return Json(serde_json::json!({
            "jobs": state.store.list_jobs(),
            "snapshot": state.build_snapshot()
        }))
        .into_response();
    }

    let run = dispatch_run_async(
        state.clone(),
        DispatchOptions {
            prompt: existing
                .prompt
                .unwrap_or_else(|| format!("Run managed job {}", existing.name)),
            caller: Some(format!("cron:{}", existing.name)),
            worker_id: None,
            phase: "cron".into(),
            use_worktree: false,
            simulate_fault: None,
            live_api: false,
            fanout_group: None,
            allow_keys: true,
            allow_paid: false,
            gate_cmd: None,
            read_only: false,
            ..Default::default()
        },
    );
    let _ = state
        .store
        .record_job_run(&existing.name, 0, Some(format!("dispatched run {}", run.id)));
    Json(serde_json::json!({
        "jobs": state.store.list_jobs(),
        "run": run,
        "snapshot": state.build_snapshot()
    }))
    .into_response()
}

async fn delete_job(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    if state.store.remove_job(&name) {
        Json(state.store.list_jobs()).into_response()
    } else {
        StatusCode::FORBIDDEN.into_response()
    }
}

async fn get_self_config(State(state): State<AppState>) -> Json<SelfConfigPlan> {
    let disc = state.discovery.lock().unwrap().clone();
    let cfg = state.config.lock().unwrap().clone();
    let applied = state.applied_targets.lock().unwrap().clone();
    Json(build_self_config_plan(&disc, &cfg, &applied))
}

async fn post_self_config_apply(
    State(state): State<AppState>,
    Json(body): Json<SelfConfigApplyBody>,
) -> Json<SelfConfigPlan> {
    let disc = state.discovery.lock().unwrap().clone();
    let cfg = state.config.lock().unwrap().clone();
    let plan = build_self_config_plan(&disc, &cfg, &BTreeSet::new());
    let chosen: BTreeSet<String> = body
        .targets
        .filter(|t| !t.is_empty())
        .map(|t| t.into_iter().collect())
        .unwrap_or_else(|| plan.targets.iter().map(|t| t.path.clone()).collect());
    let written = apply_self_config_targets(&plan, &chosen);
    {
        let mut applied = state.applied_targets.lock().unwrap();
        for target in written {
            applied.insert(target);
        }
    }
    let applied = state.applied_targets.lock().unwrap().clone();
    Json(build_self_config_plan(&disc, &cfg, &applied))
}

async fn get_overnight(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.build_overnight_summary())
}

async fn post_overnight_toggle(
    State(state): State<AppState>,
    Json(body): Json<OvernightToggleBody>,
) -> impl IntoResponse {
    let cfg = {
        let mut guard = state.config.lock().unwrap();
        if let Some(en) = body.enabled {
            guard.overnight_enabled = en;
        } else {
            guard.overnight_enabled = !guard.overnight_enabled;
        }
        if let Some(budget) = body.nightly_budget_usd {
            guard.overnight_budget_usd = budget.max(0.0);
        }
        if let Some(max_runs) = body.max_runs_per_night {
            guard.overnight_max_runs_per_night = max_runs.clamp(1, 50);
        }
        guard.clone()
    };
    let _ = save_config(&cfg);
    log_event(
        "overnight_toggled",
        serde_json::json!({
            "enabled": cfg.overnight_enabled,
            "budget_usd": cfg.overnight_budget_usd,
        }),
    );
    Json(serde_json::json!({
        "overnight": state.build_overnight_summary(),
        "snapshot": state.build_snapshot()
    }))
}

async fn post_overnight_scan(State(state): State<AppState>) -> impl IntoResponse {
    let specs = state.store.list_specs();
    let approved_count = specs
        .iter()
        .filter(|s| s.verify_signature().is_ok())
        .count();
    Json(serde_json::json!({
        "ok": true,
        "policy": "spec_locked",
        "approved_specs_count": approved_count,
        "message": "Overnight execution is strictly spec-locked: unapproved heuristic repo scans are disabled. Author and SHA-256 sign a Kiro Spec via /api/specs before overnight execution.",
        "created": Vec::<OvernightTicket>::new(),
        "overnight": state.build_overnight_summary(),
        "snapshot": state.build_snapshot()
    }))
}

async fn get_specs(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.store.list_specs())
}

async fn post_spec_create(
    State(state): State<AppState>,
    Json(body): Json<SpecCreateBody>,
) -> impl IntoResponse {
    if body.title.trim().is_empty() || body.goal.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "error": "title and goal are required" })),
        )
            .into_response();
    }
    let repo_root = body
        .repo_root
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            std::env::current_dir()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|_| ".".into())
        });
    let globs = body
        .allowed_path_globs
        .filter(|g| !g.is_empty())
        .unwrap_or_else(|| vec!["core/src/**".into()]);
    let gate_cmd = body
        .gate_cmd
        .filter(|g| !g.trim().is_empty())
        .unwrap_or_else(|| "test".into());
    let tasks = body
        .tasks_dag
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| {
            vec![SpecWaveTask {
                task_id: "wave-1".into(),
                wave: 1,
                title: body.title.clone(),
                path_globs: globs.clone(),
                gate_cmd: gate_cmd.clone(),
                status: "pending".into(),
            }]
        });
    let spec = create_draft_spec(
        body.title,
        body.goal,
        repo_root,
        body.requirements_md,
        body.design_md,
        tasks,
        globs,
        body.forbidden_actions.unwrap_or_default(),
        gate_cmd,
        body.sandbox_tier.unwrap_or_else(|| "docker".into()),
        body.max_budget_usd.unwrap_or(0.0),
    );
    if let Err(e) = state.store.insert_spec(&spec) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "ok": false, "error": format!("{e}") })),
        )
            .into_response();
    }
    log_event(
        "spec_created",
        serde_json::json!({ "spec_id": spec.spec_id, "digest": spec.sha256_digest }),
    );
    Json(serde_json::json!({ "ok": true, "spec": spec, "snapshot": state.build_snapshot() }))
        .into_response()
}

async fn post_spec_approve(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let Some(mut spec) = state.store.get_spec(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    spec.approve();
    if let Err(e) = state.store.insert_spec(&spec) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "ok": false, "error": format!("{e}") })),
        )
            .into_response();
    }
    log_event(
        "spec_approved",
        serde_json::json!({ "spec_id": spec.spec_id, "digest": spec.sha256_digest }),
    );
    Json(serde_json::json!({ "ok": true, "spec": spec, "snapshot": state.build_snapshot() }))
        .into_response()
}

async fn post_spec_run(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let Some(mut spec) = state.store.get_spec(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Err(msg) = spec.verify_signature() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "ok": false, "error": msg })),
        )
            .into_response();
    }
    let summary = state.build_overnight_summary();
    if summary.runs_tonight >= summary.max_runs_per_night {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "ok": false, "error": "Overnight run cap reached" })),
        )
            .into_response();
    }

    let allow_paid = spec.max_budget_usd > 0.0 || summary.nightly_budget_usd > 0.0;
    let group = format!("spec-{}", &spec.spec_id);
    let mut dispatched = Vec::new();
    for task in &mut spec.tasks_dag {
        task.status = "running".into();
        let prompt = format!(
            "[Kiro Spec: {} | Digest: {}]\nGoal: {}\nTask (Wave {}): {}\nAllowed Paths: {}",
            spec.title,
            &spec.sha256_digest.chars().take(12).collect::<String>(),
            spec.goal,
            task.wave,
            task.title,
            task.path_globs.join(", ")
        );
        let r = dispatch_run_async(
            state.clone(),
            DispatchOptions {
                prompt,
                caller: Some(format!("spec:{}", spec.spec_id)),
                worker_id: None,
                phase: "overnight".into(),
                use_worktree: true,
                simulate_fault: None,
                live_api: true,
                fanout_group: Some(group.clone()),
                allow_keys: true,
                allow_paid,
                gate_cmd: Some(task.gate_cmd.clone()),
                read_only: false,
                path_globs: Some(task.path_globs.clone()),
                sandbox_tier: Some(spec.sandbox_tier.clone()),
                spec_id: Some(spec.spec_id.clone()),
            },
        );
        dispatched.push(r);
    }
    spec.status = "running".into();
    let _ = state.store.insert_spec(&spec);
    Json(serde_json::json!({
        "ok": true,
        "spec": spec,
        "runs": dispatched,
        "snapshot": state.build_snapshot()
    }))
    .into_response()
}

async fn get_watchdog(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.watchdog.current_status())
}

async fn get_swarm(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.swarm.summary())
}

async fn get_channels() -> impl IntoResponse {
    Json(build_channel_gateway_status())
}

async fn post_ticket_approve(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<TicketApproveBody>>,
) -> impl IntoResponse {
    let Some(mut ticket) = state.store.get_ticket(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let summary = state.build_overnight_summary();
    if summary.runs_tonight >= summary.max_runs_per_night {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({
                "ok": false,
                "error": "Overnight run cap reached for today"
            })),
        )
            .into_response();
    }
    let allow_paid = body
        .and_then(|b| b.allow_paid)
        .unwrap_or(summary.nightly_budget_usd > 0.0);
    let run = dispatch_run_async(
        state.clone(),
        DispatchOptions {
            prompt: ticket.prompt.clone(),
            caller: Some(format!("overnight:{}", ticket.id)),
            worker_id: None,
            phase: "overnight".into(),
            use_worktree: true,
            simulate_fault: None,
            live_api: true,
            fanout_group: None,
            allow_keys: true,
            allow_paid,
            gate_cmd: Some("test".into()),
            read_only: false,
            ..Default::default()
        },
    );
    ticket.status = "running".into();
    ticket.run_id = Some(run.id.clone());
    let _ = state.store.insert_ticket(&ticket);

    // Track run completion back onto the overnight ticket.
    let state_bg = state.clone();
    let ticket_id = ticket.id.clone();
    let run_id = run.id.clone();
    tokio::spawn(async move {
        for _ in 0..360 {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let Some(r) = state_bg.store.get_run(&run_id) else {
                break;
            };
            if r.state != RunState::Running && r.state != RunState::Leased {
                if let Some(mut t) = state_bg.store.get_ticket(&ticket_id) {
                    t.status = if r.state == RunState::Done {
                        "done".into()
                    } else {
                        "failed".into()
                    };
                    t.gate_status = r.gate_status.clone();
                    t.summary = r
                        .output
                        .as_deref()
                        .or(r.error.as_deref())
                        .map(|s| s.chars().take(240).collect());
                    let _ = state_bg.store.insert_ticket(&t);
                }
                break;
            }
        }
    });

    Json(serde_json::json!({
        "ok": true,
        "ticket": ticket,
        "run": run,
        "overnight": state.build_overnight_summary(),
        "snapshot": state.build_snapshot()
    }))
    .into_response()
}

async fn post_ticket_defer(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> impl IntoResponse {
    let Some(mut ticket) = state.store.get_ticket(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    ticket.status = "deferred".into();
    let _ = state.store.insert_ticket(&ticket);
    Json(serde_json::json!({
        "ok": true,
        "ticket": ticket,
        "overnight": state.build_overnight_summary(),
        "snapshot": state.build_snapshot()
    }))
    .into_response()
}

/// Authenticated OpenAI-compatible loopback proxy for `pi-rust` so raw provider keys stay inside
/// Lingonberry's Keychain/env pool and never touch `~/.pi/agent/auth.json`.
async fn post_v1_chat_completions(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    let disc = state.discovery.lock().unwrap().clone();
    let cfg = state.config.lock().unwrap().clone();

    let requested_model = payload
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let header_prov = headers
        .get("x-lingonberry-provider")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let allow_paid_header = headers
        .get("x-lingonberry-allow-paid")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let (provider, stripped_model) = if let Some(p) = header_prov {
        (p, None)
    } else if let Some((prefix, rest)) = requested_model.split_once('/') {
        if disc.providers.contains_key(prefix) {
            (prefix.to_string(), Some(rest.to_string()))
        } else {
            let p = disc
                .keys
                .keys()
                .find(|k| *k == "nim")
                .or_else(|| disc.keys.keys().next())
                .cloned()
                .unwrap_or_else(|| "nim".into());
            (p, None)
        }
    } else {
        let p = disc
            .keys
            .keys()
            .find(|k| *k == "nim")
            .or_else(|| disc.keys.keys().next())
            .cloned()
            .unwrap_or_else(|| "nim".into());
        (p, None)
    };

    let tier = cfg
        .key_tiers
        .get(&provider)
        .map(|s| KeyCostTier::from_str(s))
        .unwrap_or_else(|| infer_cost_tier(&provider, None));
    if cfg.paid_keys_require_approval && !allow_paid_header && tier == KeyCostTier::MeteredPaid {
        return (
            StatusCode::PAYMENT_REQUIRED,
            Json(serde_json::json!({
                "error": {
                    "message": format!("PAID_APPROVAL_REQUIRED: provider '{provider}' is metered_paid"),
                    "type": "lingonberry_budget_guard"
                }
            })),
        )
            .into_response();
    }

    let base_url = disc
        .providers
        .get(&provider)
        .map(|p| p.base_url.clone())
        .filter(|u| !u.is_empty())
        .or_else(|| known_provider(&provider).map(|(u, _, _)| u.to_string()));
    let Some(base_url) = base_url else {
        return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({
                "error": { "message": format!("No endpoint configured for provider {provider}") }
            })),
        )
            .into_response();
    };

    let mut clean_payload = payload;
    if let Some(m) = stripped_model {
        clean_payload["model"] = serde_json::Value::String(m);
    }
    let fallback_model = known_provider(&provider).and_then(|(_, _, m)| m);

    let guard = match state.registry.lease_guard(None, Some(&provider)) {
        Ok(g) => g,
        Err(e) => {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(serde_json::json!({ "error": { "message": format!("{e}") } })),
            )
                .into_response();
        }
    };
    let slot = guard.key_name().to_string();
    match proxy_provider_chat(&base_url, &slot, clean_payload, fallback_model).await {
        Ok(json) => {
            guard.complete(true, None);
            log_event(
                "pi_proxy_completion",
                serde_json::json!({ "provider": provider, "slot": slot }),
            );
            Json(json).into_response()
        }
        Err(e) => {
            guard.complete(false, Some(20));
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": { "message": redact_secrets(&format!("{e:#}")) } })),
            )
                .into_response()
        }
    }
}

pub async fn serve(addr: &str) -> anyhow::Result<()> {
    let cfg = load_config()?;
    let _ = ensure_mini_harness();
    let disc = scan_discovery();
    if let Some(home) = dirs::home_dir() {
        let _ = configure_pi_rust(&home, &disc);
    }
    let store = SqliteStore::open_default()?;
    let state = AppState::new(cfg, disc, store);

    // Reconcile orphaned runs ONLY when no recorded child OS PID is still alive.
    for run in state.store.list_runs() {
        if run.state == RunState::Running || run.state == RunState::Leased {
            let alive = run.os_pid.map(is_os_pid_alive).unwrap_or(false);
            if !alive {
                state.store.finish_run_with_gate(
                    &run.id,
                    RunState::Failed,
                    None,
                    Some(false),
                    Some("not_run"),
                    Some(
                        "orphaned: previous core exited and no live worker process remains"
                            .to_string(),
                    ),
                    None,
                    None,
                    None,
                );
            }
        }
    }

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    *state.shutdown_tx.lock().unwrap() = Some(shutdown_tx);

    // 5-second background ticker: evaluates ONLY Lingonberry-managed non-LLM watchdogs & telemetry.
    // Discovered host launchd/cron/systemd jobs are NEVER dispatched to LLMs or external shells.
    let ticker_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            interval.tick().await;
            let due = ticker_state.store.tick_jobs(5);
            for job in due {
                if job.scope != "managed" || job.read_only {
                    continue;
                }
                if job.name == "doctor-health-sweep" {
                    let cfg = ticker_state.config.lock().unwrap().clone();
                    let disc = scan_discovery();
                    ticker_state.registry.refresh(&disc, &cfg);
                    let readiness = build_readiness_report(&disc, &cfg.key_tiers);
                    *ticker_state.discovery.lock().unwrap() = disc;
                    let _ = ticker_state.store.record_job_run(
                        &job.name,
                        0,
                        Some(format!(
                            "mode={} · agents={} · free_keys={}",
                            readiness.mode, readiness.agents_count, readiness.free_keys_count
                        )),
                    );
                } else {
                    dispatch_run_async(
                        ticker_state.clone(),
                        DispatchOptions {
                            prompt: job
                                .prompt
                                .unwrap_or_else(|| format!("Managed job {}", job.name)),
                            caller: Some(format!("cron:{}", job.name)),
                            worker_id: None,
                            phase: "cron".into(),
                            use_worktree: false,
                            simulate_fault: None,
                            live_api: false,
                            fanout_group: None,
                            allow_keys: true,
                            allow_paid: false,
                            gate_cmd: None,
                            read_only: false,
                            ..Default::default()
                        },
                    );
                }
            }

            let sys = collect_system_info();
            let active_runs = ticker_state
                .store
                .list_runs()
                .iter()
                .filter(|r| r.state == RunState::Running || r.state == RunState::Leased)
                .count();
            let wd_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let wd = ticker_state.watchdog.refresh(&wd_cwd, active_runs);
            ticker_state
                .load_throttled
                .store(wd.paused_reason.is_some(), Ordering::Relaxed);
            let ram_pct = match (sys.ram_used_gb, sys.ram_total_gb) {
                (Some(u), Some(t)) if t > 0.0 => (u / t) * 100.0,
                _ => 42.0,
            };
            let disk_pct = match (sys.disk_used_gb, sys.disk_total_gb) {
                (Some(u), Some(t)) if t > 0.0 => (u / t) * 100.0,
                _ => 35.0,
            };
            let mut ring = ticker_state.telemetry.lock().unwrap();
            ring.push_back(TelemetryPoint {
                ts: now_sec(),
                cpu_pct: sys.cpu_pct.unwrap_or(14.0),
                ram_pct,
                disk_pct,
                active_runs,
                rpm: ticker_state.registry.total_rpm(),
            });
            while ring.len() > 36 {
                ring.pop_front();
            }
        }
    });

    // Load watcher: throttle non-pi (local CLI) worker dispatch when machine is overloaded.
    let load_state = state.clone();
    tokio::spawn(async move {
        let mut sys = System::new_all();
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            interval.tick().await;
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            let cpu_pct = if sys.cpus().is_empty() {
                0.0
            } else {
                sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / sys.cpus().len() as f32
            };
            let ram_total = sys.total_memory();
            let ram_used = sys.used_memory();
            let ram_pct = if ram_total > 0 {
                ram_used as f32 / ram_total as f32 * 100.0
            } else {
                0.0
            };
            let overloaded = cpu_pct > 85.0 || ram_pct > 90.0;
            let recovered = cpu_pct < 70.0 && ram_pct < 80.0;
            if overloaded {
                load_state.load_throttled.store(true, Ordering::Relaxed);
            } else if recovered {
                load_state.load_throttled.store(false, Ordering::Relaxed);
            }
        }
    });

    let listener = TcpListener::bind(addr).await?;
    println!("Lingonberry Core listening on http://{addr}");
    axum::serve(listener, build_router(state))
        .with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    fn test_state() -> AppState {
        let store = SqliteStore::open_in_memory().unwrap();
        let disc = DiscoveryData {
            agents: vec![],
            keys: std::collections::BTreeMap::new(),
            providers: std::collections::BTreeMap::new(),
            library_dirs: vec![],
            ssh_hosts: vec![],
            git_projects: vec![],
            browsers: vec![],
            stores: vec![],
            keychain_slots: vec![],
        };
        AppState::new(Config::default(), disc, store)
    }

    #[tokio::test]
    async fn snapshot_and_jobs_endpoints_return_200() {
        let app = build_router(test_state());
        let resp = app
            .clone()
            .oneshot(Request::builder().uri("/snapshot").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let jobs = app
            .oneshot(Request::builder().uri("/api/jobs").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(jobs.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn rebinding_host_is_refused() {
        let app = build_router(test_state());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/snapshot")
                    .header("host", "evil.example:8799")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn mutating_routes_require_bearer_token() {
        for path in ["/shutdown", "/kill/1", "/api/jobs/kill/1", "/api/run"] {
            let app = build_router(test_state());
            let resp = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(path)
                        .header("content-type", "application/json")
                        .body(Body::from("{}"))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "path {path}");
        }
    }

    #[tokio::test]
    async fn arbitrary_os_pid_kill_is_forbidden_even_with_token() {
        let st = test_state();
        let auth = format!("Bearer {}", st.api_token);
        let app = build_router(st);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/jobs/kill/1")
                    .header("authorization", auth)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn browser_origin_cannot_change_state_or_run_agents() {
        let st = test_state();
        let auth = format!("Bearer {}", st.api_token);
        for path in ["/kill/1", "/api/jobs", "/api/run", "/v1/chat/completions"] {
            let app = build_router(st.clone());
            let resp = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(path)
                        .header("origin", "https://evil.example")
                        .header("authorization", &auth)
                        .header("content-type", "application/json")
                        .body(Body::from("{}"))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::FORBIDDEN, "path {path}");
        }
    }

    #[tokio::test]
    async fn authenticated_kill_unknown_pid_returns_404() {
        let st = test_state();
        let auth = format!("Bearer {}", st.api_token);
        let app = build_router(st);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/kill/999999")
                    .header("authorization", auth)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn explicit_worker_cannot_bypass_key_forbidden_or_paid_guard() {
        let mut keys = std::collections::BTreeMap::new();
        keys.insert("openai".into(), vec!["OPENAI_API_KEY".into()]);
        let mut providers = std::collections::BTreeMap::new();
        providers.insert(
            "openai".into(),
            crate::types::Provider {
                id: "openai".into(),
                base_url: "https://api.openai.com/v1".into(),
                style: Some("openai-completions".into()),
            },
        );
        let disc = DiscoveryData {
            agents: vec![],
            keys,
            providers,
            library_dirs: vec![],
            ssh_hosts: vec![],
            git_projects: vec![],
            browsers: vec![],
            stores: vec![],
            keychain_slots: vec![],
        };
        let state = AppState::new(Config::default(), disc, SqliteStore::open_in_memory().unwrap());

        let r1 = dispatch_run_async(
            state.clone(),
            DispatchOptions {
                prompt: "summarize".into(),
                caller: Some("shell".into()),
                worker_id: Some("pi:openai".into()),
                phase: "execute".into(),
                use_worktree: false,
                simulate_fault: None,
                live_api: true,
                fanout_group: None,
                allow_keys: false,
                allow_paid: true,
                gate_cmd: None,
                read_only: false,
                ..Default::default()
            },
        );
        assert_eq!(r1.state, RunState::Blocked);

        let r2 = dispatch_run_async(
            state,
            DispatchOptions {
                prompt: "summarize".into(),
                caller: Some("shell".into()),
                worker_id: Some("pi:openai".into()),
                phase: "execute".into(),
                use_worktree: false,
                simulate_fault: None,
                live_api: true,
                fanout_group: None,
                allow_keys: true,
                allow_paid: false,
                gate_cmd: None,
                read_only: false,
                ..Default::default()
            },
        );
        assert_eq!(r2.state, RunState::Blocked);
    }

    #[tokio::test]
    async fn key_rpm_and_job_crash_heal_roundtrip() {
        let mut keys = std::collections::BTreeMap::new();
        keys.insert("nim".into(), vec!["NIM_1".into()]);
        let disc = DiscoveryData {
            agents: vec![],
            keys,
            providers: std::collections::BTreeMap::new(),
            library_dirs: vec![],
            ssh_hosts: vec![],
            git_projects: vec![],
            browsers: vec![],
            stores: vec![],
            keychain_slots: vec![],
        };
        let state = AppState::new(Config::default(), disc, SqliteStore::open_in_memory().unwrap());
        let auth = format!("Bearer {}", state.api_token);
        let app = build_router(state.clone());

        let rpm_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/keys/NIM_1/rpm")
                    .header("authorization", &auth)
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"rpm":25}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rpm_resp.status(), StatusCode::OK);
        assert_eq!(state.registry.key_status()[0].rpm_limit, 25);

        let crash_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/jobs/doctor-health-sweep/simulate-crash")
                    .header("authorization", &auth)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(crash_resp.status(), StatusCode::OK);

        let heal_resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/jobs/doctor-health-sweep/heal")
                    .header("authorization", &auth)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(heal_resp.status(), StatusCode::OK);
    }
}
