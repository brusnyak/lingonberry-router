//! Dynamic worker registry + per-key leasing (KeyPool port).
//! Workers are derived from discovery; keys are leased with cooldown/rpm/failover.

use crate::discovery::{Discovery, DiscoveredWorker};
use crate::types::{Run, RunState};
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// A leased key with state.
#[derive(Debug, Clone)]
struct KeyState {
    pub name: String,
    pub cooling_until: f64,
    pub inflight: usize,
    pub ok: usize,
    pub fail: usize,
    pub window: Vec<f64>, // request timestamps, sliding 60s
}

/// The registry holds all workers and key states.
pub struct Registry {
    pub workers: Vec<DiscoveredWorker>,
    keys: Mutex<BTreeMap<String, KeyState>>,
    rpm_limit: usize,
    cooldown_s: f64,
}

impl Registry {
    pub fn from_discovery(d: &Discovery) -> Self {
        let mut workers = d.workers();
        // Deterministic order: sort by id.
        workers.sort_by(|a, b| a.id.cmp(&b.id));

        let mut keys = BTreeMap::new();
        for (_, names) in &d.keys {
            for name in names {
                keys.insert(name.clone(), KeyState {
                    name: name.clone(),
                    cooling_until: 0.0,
                    inflight: 0,
                    ok: 0,
                    fail: 0,
                    window: Vec::new(),
                });
            }
        }

        Self {
            workers,
            keys: Mutex::new(keys),
            rpm_limit: 40,
            cooldown_s: 60.0,
        }
    }

    /// List all workers (for the UI / allowed()).
    pub fn list_workers(&self) -> Vec<DiscoveredWorker> {
        self.workers.clone()
    }

    /// Find a worker by id.
    pub fn find_worker(&self, id: &str) -> Option<DiscoveredWorker> {
        self.workers.iter().find(|w| w.id == id).cloned()
    }

    /// Auto-select a worker: key-less CLIs first (no key dependency),
    /// then key-based workers (key leased at dispatch time).
    pub fn select_best_worker(&self) -> Option<DiscoveredWorker> {
        if let Some(w) = self.workers.iter().find(|w| w.key_slot.is_none()) {
            return Some(w.clone());
        }
        self.workers.first().cloned()
    }

    /// Lease a key for a worker run. Returns the key name or an error if none available.
    pub fn lease_key(&self, prefer: Option<&str>) -> Result<String, String> {
        let mut keys = self.keys.lock().unwrap();
        let now = now();
        let mut candidates: Vec<&mut KeyState> = keys.values_mut().collect();
        // Sort: preferred first, then fewest inflight, then fewest window hits, not cooling.
        candidates.sort_by(|a, b| {
            let a_pref = prefer.map_or(false, |p| a.name == p) as usize;
            let b_pref = prefer.map_or(false, |p| b.name == p) as usize;
            b_pref.cmp(&a_pref)
                .then_with(|| a.inflight.cmp(&b.inflight))
                .then_with(|| a.window.len().cmp(&b.window.len()))
        });

        for k in &mut candidates {
            if now < k.cooling_until { continue; }
            // rpm check
            k.window.retain(|t| now - t <= 60.0);
            if k.window.len() >= self.rpm_limit { continue; }
            // concurrency check (0 = unlimited)
            if k.inflight >= 1 && self.rpm_limit > 0 { /* per-key concurrency handled by inflight */ }
            // claim
            k.inflight += 1;
            k.window.push(now);
            return Ok(k.name.clone());
        }
        Err(format!("no keys available (rpm_limit={}, cooldown={}s)", self.rpm_limit, self.cooldown_s))
    }

    /// Release a leased key and record outcome.
    pub fn release_key(&self, name: &str, ok: bool) {
        let mut keys = self.keys.lock().unwrap();
        if let Some(k) = keys.get_mut(name) {
            k.inflight = k.inflight.saturating_sub(1);
            if ok { k.ok += 1; } else { k.fail += 1; }
            if !ok {
                k.cooling_until = now() + self.cooldown_s;
            }
        }
    }

    /// Key status snapshot for the UI.
    pub fn key_status(&self) -> Vec<crate::types::WorkerStatus> {
        let keys = self.keys.lock().unwrap();
        let now = now();
        keys.values().map(|k| {
            let active_calls = k.window.iter().filter(|t| now - *t <= 60.0).count();
            crate::types::WorkerStatus {
                name: k.name.clone(),
                status: if now < k.cooling_until { "down".to_string() } else { "idle".to_string() },
                calls_24h: active_calls,
                ok_24h: k.ok,
                key: Some(k.name.clone()),
            }
        }).collect()
    }
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            workers: Vec::new(),
            keys: Mutex::new(BTreeMap::new()),
            rpm_limit: 40,
            cooldown_s: 60.0,
        }
    }
}

/// In-memory run store (replaced by SQLite later).
pub struct RunStore {
    runs: Mutex<HashMap<String, Run>>,
}

impl RunStore {
    pub fn new() -> Self {
        Self { runs: Mutex::new(HashMap::new()) }
    }
    pub fn insert(&self, run: Run) {
        self.runs.lock().unwrap().insert(run.id.clone(), run);
    }
    pub fn get(&self, id: &str) -> Option<Run> {
        self.runs.lock().unwrap().get(id).cloned()
    }
    pub fn list(&self) -> Vec<Run> {
        self.runs.lock().unwrap().values().cloned().collect()
    }
    pub fn set_state(&self, id: &str, state: RunState, gate_passed: Option<bool>, error: Option<String>) {
        if let Some(r) = self.runs.lock().unwrap().get_mut(id) {
            r.state = state;
            r.gate_passed = gate_passed;
            r.error = error;
        }
    }
    pub fn set_pid(&self, id: &str, pid: u32) {
        if let Some(r) = self.runs.lock().unwrap().get_mut(id) {
            r.pid = Some(pid);
        }
    }
}

impl Default for RunStore {
    fn default() -> Self { Self::new() }
}

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::discovery::Discovery;

    fn mk_discovery() -> Discovery {
        Discovery {
            agents: vec![crate::types::Agent { id: "pi".to_string(), path: Some("/usr/bin/pi".to_string()) }],
            keys: BTreeMap::from([
                ("nim".to_string(), vec!["NIM_1".to_string(), "NIM_2".to_string()]),
                ("groq".to_string(), vec!["GROQ_API_KEY".to_string()]),
            ]),
            providers: BTreeMap::new(),
            library_dirs: Vec::new(),
            ssh_hosts: Vec::new(),
            git_projects: Vec::new(),
            browsers: Vec::new(),
        }
    }

    #[test]
    fn registry_builds_workers() {
        let d = mk_discovery();
        let reg = Registry::from_discovery(&d);
        let ids: Vec<_> = reg.workers.iter().map(|w| w.id.clone()).collect();
        assert!(ids.contains(&"pi:NIM_1".to_string()));
        assert!(ids.contains(&"pi:NIM_2".to_string()));
        assert!(ids.contains(&"groq:GROQ_API_KEY".to_string()));
    }

    #[test]
    fn lease_and_release() {
        let d = mk_discovery();
        let reg = Registry::from_discovery(&d);
        let k = reg.lease_key(Some("NIM_1")).unwrap();
        assert_eq!(k, "NIM_1");
        reg.release_key(&k, true);
        // second lease should succeed after release
        let k2 = reg.lease_key(None).unwrap();
        assert!(!k2.is_empty());
    }

    #[test]
    fn run_store_roundtrip() {
        let store = RunStore::new();
        let run = Run {
            id: "r1".to_string(),
            created_at: chrono::Utc::now(),
            worker: "pi:NIM_1".to_string(),
            caller: Some("claude".to_string()),
            key_slot: Some("NIM_1".to_string()),
            model: None,
            provider: Some("nim".to_string()),
            prompt: "hi".to_string(),
            gate: None,
            state: RunState::Queued,
            pid: None,
            elapsed_ms: None,
            gate_passed: None,
            error: None,
            output: None,
            task_class: None,
            receipt_id: None,
        };
        store.insert(run.clone());
        let got = store.get("r1").unwrap();
        assert_eq!(got.worker, "pi:NIM_1");
        assert_eq!(got.key_slot, Some("NIM_1".to_string()));
    }
}
