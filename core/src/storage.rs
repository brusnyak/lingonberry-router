use crate::config::lingonberry_home;
use crate::cron::{scan_live_cron_processes, scan_os_cron_jobs};
use crate::types::{JobRow, LiveCronProcess, Receipt, Run, RunState, SessionStep};
use anyhow::Result;
use rusqlite::{params, Connection};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

fn now_sec() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

#[derive(Clone)]
pub struct SqliteStore {
    conn: Arc<Mutex<Connection>>,
    jobs: Arc<Mutex<BTreeMap<String, JobRow>>>,
}

impl SqliteStore {
    pub fn open_default() -> Result<Self> {
        let dir = lingonberry_home();
        fs::create_dir_all(&dir)?;
        Self::open_path(&dir.join("router.db"))
    }

    pub fn open_path(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Self::from_conn(conn, true)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::from_conn(conn, false)
    }

    fn from_conn(conn: Connection, scan_host: bool) -> Result<Self> {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                worker TEXT NOT NULL,
                caller TEXT,
                key_slot TEXT,
                model TEXT,
                provider TEXT,
                prompt TEXT NOT NULL,
                gate TEXT,
                state TEXT NOT NULL,
                pid INTEGER,
                elapsed_ms INTEGER,
                gate_passed INTEGER,
                error TEXT,
                output TEXT,
                task_class TEXT,
                receipt_id TEXT,
                payload_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS receipts (
                receipt_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );
            ",
        )?;

        let now = now_sec();
        let mut jobs = BTreeMap::new();
        for job in [
            JobRow {
                name: "vault-ticket-digest".into(),
                source: "lingonberry".into(),
                schedule: "0 */4 * * *".into(),
                command: "lingonberry-core run \"Digest vault tickets into backlog\"".into(),
                every_s: Some(14400),
                last: Some(now - 6360.0),
                rc: Some(0),
                paused: Some(false),
                next_in_s: Some(8040),
                prompt: Some("Digest new vault tickets into concise engineering backlog items".into()),
                health: "healthy".into(),
                running_pid: None,
                crash_count: 0,
                restart_count: 0,
                auto_restart: true,
                last_error: None,
                log_tail: vec!["ok: digested 4 tickets cleanly (exit 0)".into()],
            },
            JobRow {
                name: "doctor-health-sweep".into(),
                source: "lingonberry".into(),
                schedule: "*/5 * * * *".into(),
                command: "lingonberry-core doctor".into(),
                every_s: Some(300),
                last: Some(now - 140.0),
                rc: Some(0),
                paused: Some(false),
                next_in_s: Some(160),
                prompt: Some("Verify config, key-slot cooldowns, and worker reachability".into()),
                health: "healthy".into(),
                running_pid: None,
                crash_count: 0,
                restart_count: 0,
                auto_restart: true,
                last_error: None,
                log_tail: vec!["ok: all routable workers reachable".into()],
            },
            JobRow {
                name: "pr-gate-audit".into(),
                source: "launchd".into(),
                schedule: "*/30 * * * *".into(),
                command: "lingonberry-core route \"Audit open PR diff gates\"".into(),
                every_s: Some(1800),
                last: Some(now - 1200.0),
                rc: Some(0),
                paused: Some(true),
                next_in_s: None,
                prompt: Some("Audit pending PR diffs and verify evidence gates".into()),
                health: "paused".into(),
                running_pid: None,
                crash_count: 0,
                restart_count: 0,
                auto_restart: true,
                last_error: None,
                log_tail: vec!["paused by operator".into()],
            },
        ] {
            jobs.insert(job.name.clone(), job);
        }

        if scan_host {
            for os_job in scan_os_cron_jobs() {
                jobs.entry(os_job.name.clone()).or_insert(os_job);
            }
        }

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            jobs: Arc::new(Mutex::new(jobs)),
        })
    }

    pub fn insert_run(&self, run: &Run) -> Result<()> {
        let json = serde_json::to_string(run)?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO runs (
                id, created_at, worker, caller, key_slot, model, provider,
                prompt, gate, state, pid, elapsed_ms, gate_passed, error,
                output, task_class, receipt_id, payload_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                run.id,
                run.created_at,
                run.worker,
                run.caller,
                run.key_slot,
                run.model,
                run.provider,
                run.prompt,
                run.gate,
                run.state.as_str(),
                run.pid.map(i64::from),
                run.elapsed_ms.map(|v| v as i64),
                run.gate_passed.map(i64::from),
                run.error,
                run.output,
                run.task_class,
                run.receipt_id,
                json
            ],
        )?;
        Ok(())
    }

    pub fn get_run(&self, id: &str) -> Option<Run> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT payload_json FROM runs WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn list_runs(&self) -> Vec<Run> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare("SELECT payload_json FROM runs ORDER BY created_at DESC LIMIT 200") {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = match stmt.query_map([], |row| row.get::<_, String>(0)) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };
        rows.flatten()
            .filter_map(|json| serde_json::from_str::<Run>(&json).ok())
            .collect()
    }

    pub fn append_step(&self, id: &str, step: SessionStep) {
        if let Some(mut run) = self.get_run(id) {
            run.steps.push(step);
            let _ = self.insert_run(&run);
        }
    }

    pub fn update_dispatch_target(
        &self,
        id: &str,
        worker: String,
        key_slot: Option<String>,
        provider: Option<String>,
        model: Option<String>,
        failover_from: Option<String>,
    ) {
        if let Some(mut run) = self.get_run(id) {
            run.worker = worker;
            run.key_slot = key_slot;
            run.provider = provider;
            run.model = model;
            run.failover_from = failover_from;
            let _ = self.insert_run(&run);
        }
    }

    pub fn finish_run(
        &self,
        id: &str,
        state: RunState,
        elapsed_ms: Option<u64>,
        gate_passed: Option<bool>,
        error: Option<String>,
        output: Option<String>,
        tokens_in: Option<u64>,
        tokens_out: Option<u64>,
    ) {
        if let Some(mut run) = self.get_run(id) {
            run.state = state;
            run.elapsed_ms = elapsed_ms;
            run.gate_passed = gate_passed;
            if let Some(e) = error {
                run.error = Some(e);
            }
            if let Some(o) = output {
                run.output = Some(o);
            }
            if tokens_in.is_some() {
                run.tokens_in = tokens_in;
            }
            if tokens_out.is_some() {
                run.tokens_out = tokens_out;
            }
            let _ = self.insert_run(&run);
        }
    }

    pub fn insert_receipt(&self, receipt: &Receipt) -> Result<()> {
        let json = serde_json::to_string(receipt)?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO receipts (receipt_id, created_at, payload_json) VALUES (?1, ?2, ?3)",
            params![receipt.receipt_id, receipt.created_at, json],
        )?;
        Ok(())
    }

    pub fn get_receipt(&self, id: &str) -> Option<Receipt> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT payload_json FROM receipts WHERE receipt_id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn list_receipts(&self) -> Vec<Receipt> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare("SELECT payload_json FROM receipts ORDER BY created_at DESC LIMIT 100") {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = match stmt.query_map([], |row| row.get::<_, String>(0)) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };
        rows.flatten()
            .filter_map(|json| serde_json::from_str::<Receipt>(&json).ok())
            .collect()
    }

    pub fn rescan_host_jobs(&self) -> Vec<JobRow> {
        let scanned = scan_os_cron_jobs();
        let mut guard = self.jobs.lock().unwrap();
        for job in scanned {
            guard.entry(job.name.clone()).or_insert(job);
        }
        guard.values().cloned().collect()
    }

    pub fn list_jobs_with_live(&self) -> (Vec<JobRow>, Vec<LiveCronProcess>) {
        let mut guard = self.jobs.lock().unwrap();
        let live = scan_live_cron_processes(&guard);
        for job in guard.values_mut() {
            let matching = live.iter().find(|p| p.job_name == job.name);
            job.running_pid = matching.map(|p| p.pid);
            if job.running_pid.is_some() {
                job.health = "running".into();
            } else if job.paused.unwrap_or(false) {
                job.health = "paused".into();
            } else if job.crash_count > 0 && job.rc != Some(0) {
                job.health = "crashed".into();
            } else if job.restart_count > 0 {
                job.health = "auto_healed".into();
            } else {
                job.health = "healthy".into();
            }
        }
        (guard.values().cloned().collect(), live)
    }

    pub fn list_jobs(&self) -> Vec<JobRow> {
        self.jobs.lock().unwrap().values().cloned().collect()
    }

    pub fn upsert_job(&self, job: JobRow) {
        self.jobs.lock().unwrap().insert(job.name.clone(), job);
    }

    pub fn toggle_job(&self, name: &str) -> Option<JobRow> {
        let mut guard = self.jobs.lock().unwrap();
        let job = guard.get_mut(name)?;
        let next_paused = !job.paused.unwrap_or(false);
        job.paused = Some(next_paused);
        job.next_in_s = if next_paused {
            None
        } else {
            Some(job.every_s.unwrap_or(300))
        };
        job.health = if next_paused { "paused" } else { "healthy" }.into();
        Some(job.clone())
    }

    pub fn toggle_watchdog(&self, name: &str) -> Option<JobRow> {
        let mut guard = self.jobs.lock().unwrap();
        let job = guard.get_mut(name)?;
        job.auto_restart = !job.auto_restart;
        job.log_tail.push(format!(
            "watchdog auto_restart={}",
            if job.auto_restart { "enabled" } else { "disabled" }
        ));
        if job.log_tail.len() > 8 {
            job.log_tail.remove(0);
        }
        Some(job.clone())
    }

    pub fn heal_job(&self, name: &str) -> Option<JobRow> {
        let mut guard = self.jobs.lock().unwrap();
        let job = guard.get_mut(name)?;
        job.paused = Some(false);
        job.rc = Some(0);
        job.crash_count = 0;
        job.restart_count += 1;
        job.last_error = None;
        job.health = "auto_healed".into();
        job.next_in_s = Some(job.every_s.unwrap_or(300));
        job.log_tail.push("watchdog healed job state & cleared crash lock".into());
        if job.log_tail.len() > 8 {
            job.log_tail.remove(0);
        }
        Some(job.clone())
    }

    pub fn record_job_run(&self, name: &str, rc: i32, log_line: Option<String>) -> Option<JobRow> {
        let mut guard = self.jobs.lock().unwrap();
        let job = guard.get_mut(name)?;
        job.last = Some(now_sec());
        job.rc = Some(rc);
        if rc != 0 {
            job.crash_count += 1;
            job.health = if job.auto_restart {
                job.restart_count += 1;
                "auto_healed".into()
            } else {
                "crashed".into()
            };
            job.last_error = log_line.clone().or_else(|| Some(format!("exited with rc={rc}")));
        } else {
            job.health = if job.paused.unwrap_or(false) {
                "paused"
            } else {
                "healthy"
            }
            .into();
            job.last_error = None;
        }
        if let Some(line) = log_line {
            job.log_tail.push(line);
            if job.log_tail.len() > 8 {
                job.log_tail.remove(0);
            }
        }
        if !job.paused.unwrap_or(false) {
            job.next_in_s = Some(job.every_s.unwrap_or(300));
        }
        Some(job.clone())
    }

    pub fn tick_jobs(&self, elapsed_s: u64) -> Vec<JobRow> {
        let mut guard = self.jobs.lock().unwrap();
        let mut due = Vec::new();
        for job in guard.values_mut() {
            if job.paused.unwrap_or(false) {
                continue;
            }
            if let Some(rem) = job.next_in_s {
                let updated = rem.saturating_sub(elapsed_s);
                if updated == 0 {
                    job.last = Some(now_sec());
                    job.rc = Some(0);
                    job.next_in_s = Some(job.every_s.unwrap_or(300));
                    due.push(job.clone());
                } else {
                    job.next_in_s = Some(updated);
                }
            }
        }
        due
    }

    pub fn remove_job(&self, name: &str) -> bool {
        self.jobs.lock().unwrap().remove(name).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_roundtrips_run_and_steps() {
        let store = SqliteStore::open_in_memory().unwrap();
        let run = Run {
            id: "r1".into(),
            created_at: "2026-11-25T07:00:00Z".into(),
            worker: "pi:NIM_1".into(),
            caller: Some("claude".into()),
            key_slot: Some("NIM_1".into()),
            model: None,
            provider: Some("nim".into()),
            prompt: "test prompt".into(),
            gate: Some("test".into()),
            state: RunState::Running,
            pid: Some(42001),
            elapsed_ms: None,
            gate_passed: None,
            error: None,
            output: None,
            task_class: Some("debug_fix".into()),
            receipt_id: None,
            cooked: None,
            steps: vec![],
            fanout_group: None,
            failover_from: None,
            tokens_in: None,
            tokens_out: None,
        };
        store.insert_run(&run).unwrap();
        store.append_step(
            "r1",
            SessionStep {
                ts: 1.0,
                stage: "received".into(),
                title: "Prompt received".into(),
                detail: "test".into(),
                tone: "info".into(),
            },
        );
        let fetched = store.get_run("r1").unwrap();
        assert_eq!(fetched.steps.len(), 1);
    }

    #[test]
    fn cron_crash_and_heal_updates_health() {
        let store = SqliteStore::open_in_memory().unwrap();
        let crashed = store
            .record_job_run("doctor-health-sweep", 1, Some("timeout".into()))
            .unwrap();
        assert_eq!(crashed.crash_count, 1);
        assert_eq!(crashed.health, "auto_healed");
        let healed = store.heal_job("doctor-health-sweep").unwrap();
        assert_eq!(healed.crash_count, 0);
        assert_eq!(healed.rc, Some(0));
    }
}
