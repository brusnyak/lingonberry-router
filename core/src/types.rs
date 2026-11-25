//! Shared data types for the Lingonberry Router core.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A discovered LLM provider endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub base_url: String,
    pub style: Option<String>, // "openai" | "anthropic" | etc.
}

/// A discovered agent CLI on PATH.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub path: Option<String>, // resolved binary path, if found
}

/// A dispatchable worker: (agent, key_slot, provider, base_url, model).
/// Derived at runtime from discovery + config; never hard-coded.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Worker {
    pub id: String,           // e.g. "pi:NIM_1", "groq:GROQ_API_KEY", "claude"
    pub agent: String,        // e.g. "pi", "claude", "codex"
    pub key_slot: Option<String>, // e.g. "NIM_1", "GROQ_API_KEY"; None for key-less CLIs
    pub provider: String,     // e.g. "nim", "groq", "openrouter", "claude"
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub write_access: bool,
}

/// A single run of a task on a worker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub worker: String,
    /// Who asked the router: claude, codex, opencode, pi, or an IDE/user shell.
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
    /// Captured worker response, truncated. None while running.
    pub output: Option<String>,
    pub task_class: Option<String>,
    pub receipt_id: Option<String>,
}

/// Run lifecycle states.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
    /// One lowercase spelling for storage, HTTP and the UI. Never use Debug.
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

    pub fn parse(s: &str) -> RunState {
        match s.to_ascii_lowercase().as_str() {
            "queued" => RunState::Queued,
            "leased" => RunState::Leased,
            "running" => RunState::Running,
            "done" => RunState::Done,
            "failed" => RunState::Failed,
            "blocked" => RunState::Blocked,
            "escalated" => RunState::Escalated,
            _ => RunState::Failed,
        }
    }
}

/// The full router snapshot served over HTTP for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub ts: f64,
    pub overview: Overview,
    pub workers: Vec<WorkerStatus>,
    pub workers_live: Vec<LiveWorker>,
    pub sessions: Vec<SessionRow>,
    pub jobs: Vec<JobRow>,
    pub router: RouterState,
    pub system: SystemInfo,
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
    pub status: String, // active | idle | down | unchecked
    pub calls_24h: usize,
    pub ok_24h: usize,
    pub key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveWorker {
    pub pid: u32,
    pub worker: String,
    pub caller: Option<String>,
    pub key: Option<String>,   // actual leased key slot
    pub model: Option<String>,
    pub provider: Option<String>,
    pub run_id: Option<String>,
    pub task: String,
    pub started: f64,
    pub elapsed_s: f64,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRow {
    pub name: String,
    pub source: String,
    pub every_s: Option<f64>,
    pub last: Option<f64>,
    pub rc: Option<i32>,
    pub paused: Option<bool>,
    pub next_in_s: Option<i64>,
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

/// A replayable receipt (constraint-first routing decision).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub receipt_id: String,
    pub context_hash: String,
    pub catalog_hash: String,
    pub policy_hash: String,
    pub pool_hash: String,
    pub registry_hash: String,
    pub phase: String, // "plan" | "execute" | "verify"
    pub selected: Option<ReceiptSelection>,
    pub alternatives: Vec<ReceiptSelection>,
    pub exclusions: Vec<ReceiptExclusion>,
    pub abstention: Option<String>,
    pub created_at: DateTime<Utc>,
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

/// Result of a worker execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerResult {
    pub ok: bool,
    pub output: String,
    pub worker: String,
    pub key_slot: Option<String>,
    pub pid: Option<u32>,   // spawned child process pid (CLI agents only)
    pub latency_ms: u64,
    pub gate_passed: bool,
}

impl Default for RunState {
    fn default() -> Self {
        RunState::Queued
    }
}

impl Worker {
    pub fn new(agent: &str, key_slot: Option<&str>, provider: &str) -> Self {
        let id = match key_slot {
            Some(k) => format!("{}:{}", agent, k),
            None => agent.to_string(),
        };
        Self {
            id,
            agent: agent.to_string(),
            key_slot: key_slot.map(|s| s.to_string()),
            provider: provider.to_string(),
            base_url: None,
            model: None,
            write_access: false,
        }
    }

    pub fn label(&self) -> String {
        match &self.key_slot {
            Some(k) => format!("{}:{}", self.agent, k),
            None => self.agent.clone(),
        }
    }
}

pub fn now_ts() -> f64 {
    Utc::now().timestamp() as f64
}

pub fn new_run_id() -> String {
    Uuid::new_v4().to_string()[..8].to_string()
}

pub fn new_receipt_id() -> String {
    Uuid::new_v4().to_string()
}
