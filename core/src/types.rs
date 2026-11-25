use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub base_url: String,
    pub style: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Queued,
    Leased,
    Running,
    Done,
    Failed,
    Blocked,
    Escalated,
}

impl RunState {
    pub fn as_str(&self) -> &'static str {
        match self {
            RunState::Queued => "queued",
            RunState::Leased => "leased",
            RunState::Running => "running",
            RunState::Done => "done",
            RunState::Failed => "failed",
            RunState::Blocked => "blocked",
            RunState::Escalated => "escalated",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "queued" => RunState::Queued,
            "leased" => RunState::Leased,
            "running" => RunState::Running,
            "done" => RunState::Done,
            "blocked" => RunState::Blocked,
            "escalated" => RunState::Escalated,
            _ => RunState::Failed,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStep {
    pub ts: f64,
    pub stage: String,
    pub title: String,
    pub detail: String,
    pub tone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookedPromptInfo {
    pub raw_prompt: String,
    pub cooked_prompt: String,
    pub task_class: String,
    pub selected_skill: String,
    pub selected_command: String,
    pub selected_hook: String,
    pub retrieval_sources: Vec<String>,
    pub gate_policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub created_at: String,
    pub worker: String,
    pub caller: Option<String>,
    pub key_slot: Option<String>,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub prompt: String,
    pub gate: Option<String>,
    pub state: RunState,
    pub pid: Option<u32>,
    pub elapsed_ms: Option<u64>,
    pub gate_passed: Option<bool>,
    pub error: Option<String>,
    pub output: Option<String>,
    pub task_class: Option<String>,
    pub receipt_id: Option<String>,
    pub cooked: Option<CookedPromptInfo>,
    pub steps: Vec<SessionStep>,
    pub fanout_group: Option<String>,
    pub failover_from: Option<String>,
    pub tokens_in: Option<u64>,
    pub tokens_out: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Overview {
    pub running: usize,
    pub live_workers: usize,
    pub completed_24h: usize,
    pub failed_24h: usize,
    pub avg_duration_s: Option<f64>,
    pub cost_24h_usd: Option<f64>,
    pub calls_24h: Option<usize>,
    pub cpu_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerStatus {
    pub name: String,
    pub status: String,
    pub calls_24h: usize,
    pub ok_24h: usize,
    pub key: Option<String>,
    pub provider: Option<String>,
    pub cooling_remaining_s: u64,
    pub rpm_limit: usize,
    pub inflight: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveWorker {
    pub pid: u32,
    pub worker: String,
    pub caller: Option<String>,
    pub key: Option<String>,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub run_id: Option<String>,
    pub task: String,
    pub started: f64,
    pub elapsed_s: f64,
    pub fanout_group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRow {
    pub id: String,
    pub ts: f64,
    pub prompt: String,
    pub worker: String,
    pub caller: Option<String>,
    pub key: Option<String>,
    pub state: String,
    pub duration_s: f64,
    pub reason: Option<String>,
    pub output: Option<String>,
    pub receipt_id: Option<String>,
    pub steps: Vec<SessionStep>,
    pub fanout_group: Option<String>,
    pub failover_from: Option<String>,
    pub tokens_in: Option<u64>,
    pub tokens_out: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRow {
    pub name: String,
    pub source: String,
    pub schedule: String,
    pub command: String,
    pub every_s: Option<u64>,
    pub last: Option<f64>,
    pub rc: Option<i32>,
    pub paused: Option<bool>,
    pub next_in_s: Option<u64>,
    pub prompt: Option<String>,
    pub health: String,
    pub running_pid: Option<u32>,
    pub crash_count: u32,
    pub restart_count: u32,
    pub auto_restart: bool,
    pub last_error: Option<String>,
    pub log_tail: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveCronProcess {
    pub pid: u32,
    pub job_name: String,
    pub source: String,
    pub command: String,
    pub cpu_pct: f64,
    pub mem_mb: f64,
    pub elapsed_s: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterState {
    pub up: bool,
    pub serve: bool,
    pub proxy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub cpu_pct: Option<f64>,
    pub load1: Option<f64>,
    pub ram_used_gb: Option<f64>,
    pub ram_total_gb: Option<f64>,
    pub disk_used_gb: Option<f64>,
    pub disk_total_gb: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryPoint {
    pub ts: f64,
    pub cpu_pct: f64,
    pub ram_pct: f64,
    pub disk_pct: f64,
    pub active_runs: usize,
    pub rpm: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub ts: f64,
    pub overview: Overview,
    pub workers: Vec<WorkerStatus>,
    pub workers_live: Vec<LiveWorker>,
    pub sessions: Vec<SessionRow>,
    pub jobs: Vec<JobRow>,
    pub cron_live: Vec<LiveCronProcess>,
    pub router: RouterState,
    pub system: SystemInfo,
    pub telemetry: Vec<TelemetryPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptSelection {
    pub worker: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub gate: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptExclusion {
    pub candidate_id: String,
    pub code: String,
    pub evidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub receipt_id: String,
    pub context_hash: String,
    pub catalog_hash: String,
    pub policy_hash: String,
    pub pool_hash: String,
    pub registry_hash: String,
    pub phase: String,
    pub selected: Option<ReceiptSelection>,
    pub alternatives: Vec<ReceiptSelection>,
    pub exclusions: Vec<ReceiptExclusion>,
    pub abstention: Option<String>,
    pub created_at: String,
    pub caller: Option<String>,
    pub cooked: Option<CookedPromptInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredWorker {
    pub id: String,
    pub agent: String,
    pub key_slot: Option<String>,
    pub provider: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub write_access: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryData {
    pub agents: Vec<Agent>,
    pub keys: BTreeMap<String, Vec<String>>,
    pub providers: BTreeMap<String, Provider>,
    pub library_dirs: Vec<String>,
    pub ssh_hosts: Vec<String>,
    pub git_projects: Vec<String>,
    pub browsers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelfConfigTarget {
    pub target: String,
    pub scope: String,
    pub path: String,
    pub status: String,
    pub reason: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelfConfigPlan {
    pub os: String,
    pub preferred_root: String,
    pub strategy: String,
    pub targets: Vec<SelfConfigTarget>,
}
