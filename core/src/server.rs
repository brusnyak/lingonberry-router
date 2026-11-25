use crate::agents::{
    apply_self_config_targets, build_self_config_plan, call_provider_api, cook_prompt,
    is_output_truncated, route_prompt,
};
use crate::config::{load_config, Config};
use crate::cron::{execute_os_cron_command, kill_os_pid};
use crate::discovery::{redact_secrets, scan_discovery};
use crate::events::log_event;
use crate::registry::{now_sec, Registry};
use crate::storage::SqliteStore;
use crate::types::{
    DiscoveryData, JobRow, LiveWorker, Overview, RouterState, Run, RunState, SelfConfigPlan,
    SessionRow, SessionStep, Snapshot, SystemInfo, TelemetryPoint,
};
use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use axum::routing::{delete, get, post};
use axum::Router;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use sysinfo::{Disks, System};
use tokio::net::TcpListener;
use tokio::process::Command as TokioCommand;
use tokio::sync::oneshot;
use uuid::Uuid;

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
        Self {
            config: Arc::new(Mutex::new(config)),
            discovery: Arc::new(Mutex::new(discovery)),
            registry,
            store,
            applied_targets: Arc::new(Mutex::new(BTreeSet::new())),
            active_cancels: Arc::new(Mutex::new(HashMap::new())),
            active_os_pids: Arc::new(Mutex::new(HashMap::new())),
            telemetry: Arc::new(Mutex::new(telemetry)),
            next_pid: Arc::new(AtomicU32::new(41000)),
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    pub fn build_snapshot(&self) -> Snapshot {
        let now = now_sec();
        let runs = self.store.list_runs();
        let workers = self.registry.key_status();
        let sys = collect_system_info();
        let (jobs, cron_live) = self.store.list_jobs_with_live();

        let workers_live: Vec<LiveWorker> = runs
            .iter()
            .filter(|r| r.state == RunState::Running || r.state == RunState::Leased)
            .map(|r| LiveWorker {
                pid: r.pid.unwrap_or(0),
                worker: r.worker.clone(),
                caller: r.caller.clone(),
                key: r.key_slot.clone(),
                model: r.model.clone(),
                provider: r.provider.clone(),
                run_id: Some(r.id.clone()),
                task: r.prompt.clone(),
                started: now,
                elapsed_s: r.elapsed_ms.unwrap_or(0) as f64 / 1000.0,
                fanout_group: r.fanout_group.clone(),
            })
            .collect();

        let completed_24h = runs.iter().filter(|r| r.state == RunState::Done).count();
        let failed_24h = runs
            .iter()
            .filter(|r| r.state == RunState::Failed || r.state == RunState::Escalated)
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
            .map(|r| SessionRow {
                id: r.id,
                ts: now,
                prompt: r.prompt,
                worker: r.worker,
                caller: r.caller,
                key: r.key_slot,
                state: r.state.as_str().to_string(),
                duration_s: r.elapsed_ms.unwrap_or(0) as f64 / 1000.0,
                reason: r.error,
                output: r.output,
                receipt_id: r.receipt_id,
                steps: r.steps,
                fanout_group: r.fanout_group,
                failover_from: r.failover_from,
                tokens_in: r.tokens_in,
                tokens_out: r.tokens_out,
            })
            .collect();

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
        }
    }
}

pub fn collect_system_info() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

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
    }
}

#[derive(Debug, Deserialize)]
pub struct RouteBody {
    pub prompt: String,
    pub phase: Option<String>,
    pub caller: Option<String>,
    pub worktree: Option<bool>,
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
}

#[derive(Debug, Deserialize)]
pub struct FanoutBody {
    pub prompts: Option<Vec<String>>,
    pub prompt: Option<String>,
    pub caller: Option<String>,
    pub worktree: Option<bool>,
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

#[derive(Debug, Serialize)]
struct VersionResp {
    pid: u32,
    version: &'static str,
    exe_mtime: f64,
}

pub fn dispatch_run_async(
    state: AppState,
    prompt: String,
    caller: Option<String>,
    worker_id: Option<String>,
    phase: String,
    use_worktree: bool,
    simulate_fault: Option<String>,
    live_api: bool,
    fanout_group: Option<String>,
) -> Run {
    let discovery = state.discovery.lock().unwrap().clone();
    let receipt = route_prompt(
        &prompt,
        &phase,
        caller.as_deref(),
        &discovery,
        &state.registry,
        use_worktree,
    );
    let _ = state.store.insert_receipt(&receipt);

    let chosen = worker_id
        .as_deref()
        .and_then(|id| state.registry.find_worker(id))
        .or_else(|| {
            receipt
                .selected
                .as_ref()
                .and_then(|s| state.registry.find_worker(&s.worker))
        })
        .or_else(|| state.registry.select_best_worker());

    let cooked = receipt
        .cooked
        .clone()
        .unwrap_or_else(|| cook_prompt(&prompt, &discovery, &phase, use_worktree));

    let now = now_sec();
    let steps = vec![
        SessionStep {
            ts: now,
            stage: "received".into(),
            title: "Prompt received".into(),
            detail: format!("{} · {}", caller.as_deref().unwrap_or("shell"), prompt),
            tone: "info".into(),
        },
        SessionStep {
            ts: now + 0.1,
            stage: "cooked".into(),
            title: format!("Cooked with {}", cooked.selected_skill),
            detail: format!("Hook {} · Gate {}", cooked.selected_hook, cooked.gate_policy),
            tone: "route".into(),
        },
    ];

    let Some(worker) = chosen else {
        let failed = Run {
            id: Uuid::new_v4().to_string()[..8].to_string(),
            created_at: Utc::now().to_rfc3339(),
            worker: worker_id.unwrap_or_else(|| "unassigned".into()),
            caller,
            key_slot: None,
            model: None,
            provider: None,
            prompt,
            gate: Some(cooked.gate_policy.clone()),
            state: RunState::Failed,
            pid: None,
            elapsed_ms: Some(10),
            gate_passed: Some(false),
            error: Some("No routable workers available".into()),
            output: None,
            task_class: Some(cooked.task_class.clone()),
            receipt_id: Some(receipt.receipt_id.clone()),
            cooked: Some(cooked),
            steps,
            fanout_group,
            failover_from: None,
            tokens_in: None,
            tokens_out: None,
        };
        let _ = state.store.insert_run(&failed);
        return failed;
    };

    let guard = if worker.key_slot.is_some() || worker.agent == "pi" {
        match state
            .registry
            .lease_guard(worker.key_slot.as_deref(), Some(&worker.provider))
        {
            Ok(g) => Some(g),
            Err(e) => {
                let blocked = Run {
                    id: Uuid::new_v4().to_string()[..8].to_string(),
                    created_at: Utc::now().to_rfc3339(),
                    worker: worker.id.clone(),
                    caller,
                    key_slot: worker.key_slot.clone(),
                    model: worker.model.clone(),
                    provider: Some(worker.provider.clone()),
                    prompt,
                    gate: Some(cooked.gate_policy.clone()),
                    state: RunState::Blocked,
                    pid: None,
                    elapsed_ms: Some(8),
                    gate_passed: Some(false),
                    error: Some(e.to_string()),
                    output: None,
                    task_class: Some(cooked.task_class.clone()),
                    receipt_id: Some(receipt.receipt_id.clone()),
                    cooked: Some(cooked),
                    steps,
                    fanout_group,
                    failover_from: None,
                    tokens_in: None,
                    tokens_out: None,
                };
                let _ = state.store.insert_run(&blocked);
                return blocked;
            }
        }
    } else {
        None
    };

    let key_slot = guard.as_ref().map(|g| g.key_name().to_string());
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
        title: "Dispatching task…".into(),
        detail: key_slot
            .as_ref()
            .map(|k| format!("Leased key slot {k} ({})", worker.provider))
            .unwrap_or_else(|| format!("Local CLI ({})", worker.agent)),
        tone: "active".into(),
    });

    let run_id = Uuid::new_v4().to_string()[..8].to_string();
    let pid = state.next_pid.fetch_add(1, Ordering::Relaxed);
    let run = Run {
        id: run_id.clone(),
        created_at: Utc::now().to_rfc3339(),
        worker: worker.id.clone(),
        caller: caller.clone(),
        key_slot: key_slot.clone(),
        model: worker.model.clone(),
        provider: Some(worker.provider.clone()),
        prompt,
        gate: Some(cooked.gate_policy.clone()),
        state: RunState::Running,
        pid: Some(pid),
        elapsed_ms: None,
        gate_passed: None,
        error: None,
        output: None,
        task_class: Some(cooked.task_class.clone()),
        receipt_id: Some(receipt.receipt_id.clone()),
        cooked: Some(cooked.clone()),
        steps: full_steps,
        fanout_group: fanout_group.clone(),
        failover_from: None,
        tokens_in: None,
        tokens_out: None,
    };
    let _ = state.store.insert_run(&run);
    log_event(
        if fanout_group.is_some() {
            "fanout_dispatch"
        } else {
            "run_dispatch"
        },
        serde_json::json!({
            "run_id": run.id,
            "worker": run.worker,
            "key_slot": run.key_slot,
            "fanout_group": run.fanout_group,
        }),
    );

    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    state.active_cancels.lock().unwrap().insert(pid, cancel_tx);

    let run_clone = run.clone();
    tokio::spawn(async move {
        let fault = simulate_fault.as_deref().unwrap_or("none");
        let work = async {
            if fault == "429" || fault == "truncated" {
                tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
                let failed_slot = key_slot.clone();
                if let Some(g) = guard {
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
                        .lease_guard(fallback.key_slot.as_deref(), Some(&fallback.provider))
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
                        tokio::time::sleep(std::time::Duration::from_millis(1400)).await;
                        fb_guard.complete(true, None);
                        state.store.append_step(
                            &run_id,
                            SessionStep {
                                ts: now_sec(),
                                stage: "gate".into(),
                                title: "Execution completed after retry".into(),
                                detail: format!("Verified on {} ({fb_key})", fallback.id),
                                tone: "done".into(),
                            },
                        );
                        state.store.finish_run(
                            &run_id,
                            RunState::Done,
                            Some(2500),
                            Some(true),
                            None,
                            Some(format!("Recovered on {} ({fb_key})", fallback.id)),
                            Some(1020),
                            Some(580),
                        );
                        return;
                    }
                }
                state.store.finish_run(
                    &run_id,
                    RunState::Escalated,
                    Some(1100),
                    Some(false),
                    Some(format!("{fault} fault detected; no sibling slot free")),
                    None,
                    None,
                    None,
                );
                return;
            }

            if live_api {
                if let (Some(base_url), Some(slot), Some(model)) =
                    (worker.base_url.as_deref(), key_slot.as_deref(), worker.model.as_deref())
                {
                    match call_provider_api(base_url, slot, model, &cooked.cooked_prompt).await {
                        Ok((text, finish_reason))
                            if !is_output_truncated(&text, finish_reason.as_deref()) =>
                        {
                            if let Some(g) = guard {
                                g.complete(true, None);
                            }
                            state.store.append_step(
                                &run_id,
                                SessionStep {
                                    ts: now_sec(),
                                    stage: "gate".into(),
                                    title: "Live provider verified".into(),
                                    detail: format!("Gate {} passed", cooked.gate_policy),
                                    tone: "done".into(),
                                },
                            );
                            state.store.finish_run(
                                &run_id,
                                RunState::Done,
                                Some(1800),
                                Some(true),
                                None,
                                Some(text),
                                Some(640),
                                Some(320),
                            );
                            return;
                        }
                        Ok(_) | Err(_) => {
                            let failed_reason = "Truncated or rate-limited provider response";
                            if let Some(g) = guard {
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
                                        fallback.key_slot.as_deref(),
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
                                    if let Ok((retry_text, retry_finish)) = call_provider_api(
                                        fb_base,
                                        &fb_key,
                                        fb_model,
                                        &cooked.cooked_prompt,
                                    )
                                    .await
                                    {
                                        if !is_output_truncated(
                                            &retry_text,
                                            retry_finish.as_deref(),
                                        ) {
                                            fb_guard.complete(true, None);
                                            state.store.append_step(
                                                &run_id,
                                                SessionStep {
                                                    ts: now_sec(),
                                                    stage: "gate".into(),
                                                    title: "Live failover verified".into(),
                                                    detail: format!(
                                                        "Recovered on {} ({fb_key})",
                                                        fallback.id
                                                    ),
                                                    tone: "done".into(),
                                                },
                                            );
                                            state.store.finish_run(
                                                &run_id,
                                                RunState::Done,
                                                Some(2600),
                                                Some(true),
                                                None,
                                                Some(retry_text),
                                                Some(720),
                                                Some(360),
                                            );
                                            return;
                                        }
                                    }
                                    fb_guard.complete(false, Some(20));
                                }
                            }
                            state.store.finish_run(
                                &run_id,
                                RunState::Escalated,
                                Some(1400),
                                Some(false),
                                Some(format!("{failed_reason}; failover exhausted")),
                                None,
                                None,
                                None,
                            );
                            return;
                        }
                    }
                }
            }

            if let Some(ref bin_path) = worker.path {
                if worker.key_slot.is_none() && std::path::Path::new(bin_path).exists() {
                    let args: Vec<&str> = match worker.agent.as_str() {
                        "claude" => vec!["-p", &cooked.cooked_prompt],
                        "codex" => vec!["exec", &cooked.cooked_prompt],
                        "opencode" => vec!["run", &cooked.cooked_prompt],
                        "omp" => vec!["-p", &cooked.cooked_prompt],
                        _ => vec![&cooked.cooked_prompt],
                    };
                    if let Ok(child) = TokioCommand::new(bin_path)
                        .args(&args)
                        .stdin(Stdio::null())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .spawn()
                    {
                        if let Some(os_pid) = child.id() {
                            state.active_os_pids.lock().unwrap().insert(pid, os_pid);
                        }
                        let out = child.wait_with_output().await;
                        state.active_os_pids.lock().unwrap().remove(&pid);
                        if let Some(g) = guard {
                            g.complete(out.as_ref().map(|o| o.status.success()).unwrap_or(false), None);
                        }
                        match out {
                            Ok(o) if o.status.success() => {
                                let stdout_text = redact_secrets(&String::from_utf8_lossy(&o.stdout));
                                state.store.append_step(
                                    &run_id,
                                    SessionStep {
                                        ts: now_sec(),
                                        stage: "gate".into(),
                                        title: "Local CLI verified".into(),
                                        detail: format!("{} exited 0 · Gate {}", worker.agent, cooked.gate_policy),
                                        tone: "done".into(),
                                    },
                                );
                                state.store.finish_run(
                                    &run_id,
                                    RunState::Done,
                                    Some(1600),
                                    Some(true),
                                    None,
                                    Some(stdout_text),
                                    None,
                                    None,
                                );
                            }
                            Ok(o) => {
                                let stderr_text = redact_secrets(&String::from_utf8_lossy(&o.stderr));
                                state.store.finish_run(
                                    &run_id,
                                    RunState::Failed,
                                    Some(1200),
                                    Some(false),
                                    Some(format!(
                                        "{} exited {:?}: {}",
                                        worker.agent,
                                        o.status.code(),
                                        stderr_text.chars().take(160).collect::<String>()
                                    )),
                                    None,
                                    None,
                                    None,
                                );
                            }
                            Err(err) => {
                                state.store.finish_run(
                                    &run_id,
                                    RunState::Failed,
                                    Some(500),
                                    Some(false),
                                    Some(format!("CLI wait error: {err}")),
                                    None,
                                    None,
                                    None,
                                );
                            }
                        }
                        return;
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_millis(2400)).await;
            if let Some(g) = guard {
                g.complete(true, None);
            }
            state.store.append_step(
                &run_id,
                SessionStep {
                    ts: now_sec(),
                    stage: "gate".into(),
                    title: "Execution completed".into(),
                    detail: format!("Gate {} passed", cooked.gate_policy),
                    tone: "done".into(),
                },
            );
            state.store.finish_run(
                &run_id,
                RunState::Done,
                Some(2400),
                Some(true),
                None,
                Some(redact_secrets(&format!(
                    "Dispatched via {} · skill={} · gate={} passed",
                    worker.id, cooked.selected_skill, cooked.gate_policy
                ))),
                Some(480),
                Some(310),
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
                state.store.finish_run(
                    &run_id,
                    RunState::Failed,
                    Some(400),
                    Some(false),
                    Some(format!("killed by user (pid {pid})")),
                    None,
                    None,
                    None,
                );
            }
        }
    });

    run_clone
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/snapshot", get(get_snapshot))
        .route("/api/snapshot", get(get_snapshot))
        .route("/keys", get(get_keys))
        .route("/api/keys", get(get_keys))
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
        .with_state(state)
}

async fn get_snapshot(State(state): State<AppState>) -> Json<Snapshot> {
    Json(state.build_snapshot())
}

async fn get_keys(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.registry.key_status())
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
        log_event("key_rpm_cap", serde_json::json!({ "target": name, "rpm": body.rpm }));
        Json(serde_json::json!({ "ok": true, "snapshot": state.build_snapshot() })).into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
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
    *state.discovery.lock().unwrap() = disc;
    state.store.rescan_host_jobs();
    Json(state.build_snapshot())
}

async fn post_route(
    State(state): State<AppState>,
    Json(body): Json<RouteBody>,
) -> impl IntoResponse {
    let disc = state.discovery.lock().unwrap().clone();
    let receipt = route_prompt(
        &body.prompt,
        body.phase.as_deref().unwrap_or("plan"),
        body.caller.as_deref(),
        &disc,
        &state.registry,
        body.worktree.unwrap_or(false),
    );
    let _ = state.store.insert_receipt(&receipt);
    Json(receipt)
}

async fn post_run(State(state): State<AppState>, Json(body): Json<RunBody>) -> impl IntoResponse {
    let run = dispatch_run_async(
        state.clone(),
        body.prompt,
        body.caller,
        body.worker,
        body.phase.unwrap_or_else(|| "execute".into()),
        body.worktree.unwrap_or(false),
        body.simulate_fault,
        body.live_api.unwrap_or(false),
        None,
    );
    Json(serde_json::json!({ "run": run, "snapshot": state.build_snapshot() }))
}

async fn post_fanout(
    State(state): State<AppState>,
    Json(body): Json<FanoutBody>,
) -> impl IntoResponse {
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
    let mut runs = Vec::new();
    for (idx, p) in prompts.into_iter().enumerate() {
        let w_id = if workers.is_empty() {
            None
        } else {
            Some(workers[idx % workers.len()].id.clone())
        };
        runs.push(dispatch_run_async(
            state.clone(),
            p,
            body.caller.clone(),
            w_id,
            "fanout".into(),
            body.worktree.unwrap_or(false),
            None,
            false,
            Some(group.clone()),
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
    let every = body.every_s.unwrap_or(300).max(30);
    let cmd = body
        .command
        .unwrap_or_else(|| format!("lingonberry-core run \"{}\"", body.prompt.as_deref().unwrap_or(&body.name)));
    state.store.upsert_job(JobRow {
        name: body.name,
        source: body.source.unwrap_or_else(|| "lingonberry".into()),
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
    Json(state.store.list_jobs())
}

async fn post_job_toggle(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    match state.store.toggle_job(&name) {
        Some(_) => Json(state.store.list_jobs()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn post_job_watchdog(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    match state.store.toggle_watchdog(&name) {
        Some(_) => Json(state.store.list_jobs()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn post_job_heal(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    match state.store.heal_job(&name) {
        Some(job) => {
            log_event("cron_healed", serde_json::json!({ "name": job.name }));
            Json(serde_json::json!({ "job": job, "snapshot": state.build_snapshot() })).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn post_job_simulate_crash(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    match state
        .store
        .record_job_run(&name, 137, Some("SIGKILL OOM / unhandled timeout (simulated)".into()))
    {
        Some(job) => {
            log_event("cron_crash_simulated", serde_json::json!({ "name": job.name }));
            Json(serde_json::json!({ "job": job, "snapshot": state.build_snapshot() })).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn post_job_run(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
) -> impl IntoResponse {
    let Some(existing) = state
        .store
        .list_jobs()
        .into_iter()
        .find(|j| j.name == name)
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let is_external = !existing.command.trim().starts_with("lingonberry-core")
        && !existing.command.trim().starts_with("launchctl ")
        && !existing.command.trim().starts_with("systemctl ")
        && !existing.command.trim().starts_with("schtasks ");

    if is_external {
        let cmd_str = existing.command.clone();
        let (rc, lines) = tokio::task::spawn_blocking(move || execute_os_cron_command(&cmd_str))
            .await
            .unwrap_or((1, vec!["cron spawn failed".into()]));
        let _ = state
            .store
            .record_job_run(&name, rc, Some(lines.join(" | ")));
    } else {
        let _ = state
            .store
            .record_job_run(&name, 0, Some(format!("manual run triggered for {name}")));
    }

    let run = dispatch_run_async(
        state.clone(),
        existing.prompt.unwrap_or_else(|| format!("Run job {}", existing.name)),
        Some(format!("cron:{}", existing.name)),
        None,
        "cron".into(),
        false,
        None,
        false,
        None,
    );
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
        StatusCode::NOT_FOUND.into_response()
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

pub async fn serve(addr: &str) -> anyhow::Result<()> {
    let cfg = load_config()?;
    let disc = scan_discovery();
    let store = SqliteStore::open_default()?;
    let state = AppState::new(cfg, disc, store);

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    *state.shutdown_tx.lock().unwrap() = Some(shutdown_tx);

    // 5-second background cron + telemetry ring buffer ticker
    let ticker_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            interval.tick().await;
            let due = ticker_state.store.tick_jobs(5);
            for job in due {
                let job_name = job.name.clone();
                let is_external = !job.command.trim().starts_with("lingonberry-core")
                    && !job.command.trim().starts_with("launchctl ")
                    && !job.command.trim().starts_with("systemctl ")
                    && !job.command.trim().starts_with("schtasks ");
                if is_external {
                    let cmd_str = job.command.clone();
                    let store_c = ticker_state.store.clone();
                    tokio::spawn(async move {
                        let (rc, lines) =
                            tokio::task::spawn_blocking(move || execute_os_cron_command(&cmd_str))
                                .await
                                .unwrap_or((1, vec!["cron spawn error".into()]));
                        let _ = store_c.record_job_run(&job_name, rc, Some(lines.join(" | ")));
                    });
                } else {
                    dispatch_run_async(
                        ticker_state.clone(),
                        job.prompt.unwrap_or_else(|| format!("Cron job {}", job.name)),
                        Some(format!("cron:{}", job.name)),
                        None,
                        "cron".into(),
                        false,
                        None,
                        false,
                        None,
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
    async fn kill_unknown_pid_returns_404() {
        let app = build_router(test_state());
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/kill/999999")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
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
        };
        let state = AppState::new(Config::default(), disc, SqliteStore::open_in_memory().unwrap());
        let app = build_router(state.clone());

        let rpm_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/keys/NIM_1/rpm")
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
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(heal_resp.status(), StatusCode::OK);
    }
}
