//! SQLite persistence for runs and receipts.
//! All key values are never stored — only key slot names (env var identifiers).

use crate::types::{Receipt, ReceiptExclusion, ReceiptSelection, Run, RunState};
use rusqlite::{params, Connection, OpenFlags};
use std::path::PathBuf;
use std::sync::Mutex;

/// SQLite-backed run store. Persists runs to disk; survives core restarts.
#[allow(dead_code)]
pub struct SqliteRunStore {
    conn: Mutex<Connection>,
    db_path: PathBuf,
}

impl SqliteRunStore {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {}", e))?;
        }

        let conn = Connection::open_with_flags(&db_path, OpenFlags::default())
            .map_err(|e| format!("open db failed: {}", e))?;

        conn.execute_batch(
            "PRAGMA journal_mode=WAL;\n
             PRAGMA synchronous=NORMAL;\n
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
                 receipt_id TEXT
             );\n
             CREATE TABLE IF NOT EXISTS receipts (
                 receipt_id TEXT PRIMARY KEY,
                 context_hash TEXT NOT NULL,
                 catalog_hash TEXT NOT NULL,
                 policy_hash TEXT NOT NULL,
                 pool_hash TEXT NOT NULL,
                 registry_hash TEXT NOT NULL,
                 phase TEXT NOT NULL,
                 selected TEXT,
                 alternatives TEXT,
                 exclusions TEXT,
                 abstention TEXT,
                 created_at TEXT NOT NULL
             );\n
             CREATE INDEX IF NOT EXISTS idx_runs_worker ON runs(worker);
             CREATE INDEX IF NOT EXISTS idx_runs_state ON runs(state);
             CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);
             CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts(created_at);",
        )
        .map_err(|e| format!("schema init failed: {}", e))?;

        // Migration: databases created before `caller`/`output` existed.
        for (col, decl) in [("caller", "TEXT"), ("output", "TEXT")] {
            let has = conn
                .prepare("SELECT 1 FROM pragma_table_info('runs') WHERE name = ?1")
                .and_then(|mut s| s.exists(params![col]))
                .unwrap_or(false);
            if !has {
                let _ = conn.execute_batch(&format!("ALTER TABLE runs ADD COLUMN {} {}", col, decl));
            }
        }

        Ok(Self {
            conn: Mutex::new(conn),
            db_path,
        })
    }

    pub fn insert(&self, run: Run) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO runs (id, created_at, worker, caller, key_slot, model, provider, prompt, gate, state, pid, elapsed_ms, gate_passed, error, output, task_class, receipt_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                run.id,
                run.created_at.to_rfc3339(),
                run.worker,
                run.caller,
                run.key_slot,
                run.model,
                run.provider,
                run.prompt,
                run.gate,
                run.state.as_str(),
                run.pid.map(|p| p as i64),
                run.elapsed_ms.map(|m| m as i64),
                run.gate_passed.map(|b| b as i64),
                run.error,
                run.output,
                run.task_class,
                run.receipt_id,
            ],
        )
        .ok();
    }

    const COLS: &'static str = "id, created_at, worker, caller, key_slot, model, provider, prompt, gate, state, pid, elapsed_ms, gate_passed, error, output, task_class, receipt_id";

    fn run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Run> {
        let created_at_str: String = row.get(1)?;
        let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or_else(|_| chrono::Utc::now());
        let state_str: String = row.get(9)?;
        Ok(Run {
            id: row.get(0)?,
            created_at,
            worker: row.get(2)?,
            caller: row.get(3)?,
            key_slot: row.get(4)?,
            model: row.get(5)?,
            provider: row.get(6)?,
            prompt: row.get(7)?,
            gate: row.get(8)?,
            state: RunState::parse(&state_str),
            pid: row.get::<_, Option<i64>>(10)?.map(|p| p as u32),
            elapsed_ms: row.get::<_, Option<i64>>(11)?.map(|m| m as u64),
            gate_passed: row.get::<_, Option<i64>>(12)?.map(|b| b != 0),
            error: row.get(13)?,
            output: row.get(14)?,
            task_class: row.get(15)?,
            receipt_id: row.get(16)?,
        })
    }

    pub fn get(&self, id: &str) -> Option<Run> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(&format!("SELECT {} FROM runs WHERE id = ?1", Self::COLS))
            .ok()?;
        let mut rows = stmt.query_map(params![id], Self::run_from_row).ok()?;
        rows.next().and_then(|r| r.ok())
    }

    pub fn list(&self) -> Vec<Run> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(&format!("SELECT {} FROM runs ORDER BY created_at DESC", Self::COLS))
            .unwrap();
        let rows = stmt.query_map([], Self::run_from_row).unwrap();
        rows.filter_map(Result::ok).collect()
    }

    /// Attach the spawned pid and mark the run live so the UI can list and kill it.
    pub fn mark_running(&self, id: &str, pid: Option<u32>) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE runs SET state = ?1, pid = COALESCE(?2, pid) WHERE id = ?3",
            params!["running", pid.map(|p| p as i64), id],
        )
        .ok();
    }

    /// Final state, elapsed, gate result, error and captured output in one write.
    pub fn finish(
        &self,
        id: &str,
        state: RunState,
        elapsed_ms: Option<u64>,
        gate_passed: Option<bool>,
        error: Option<String>,
        output: Option<String>,
    ) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE runs SET state = ?1, elapsed_ms = ?2, gate_passed = ?3, error = COALESCE(?4, error), output = COALESCE(?5, output) WHERE id = ?6",
            params![
                state.as_str(),
                elapsed_ms.map(|m| m as i64),
                gate_passed.map(|b| b as i64),
                error,
                output,
                id
            ],
        )
        .ok();
    }

    pub fn set_state(&self, id: &str, state: RunState, gate_passed: Option<bool>, error: Option<String>) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE runs SET state = ?1, gate_passed = ?2, error = ?3 WHERE id = ?4",
            params![state.as_str(), gate_passed.map(|b| b as i64), error, id],
        )
        .ok();
    }

    pub fn set_pid(&self, id: &str, pid: u32) {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE runs SET pid = ?1 WHERE id = ?2", params![pid as i64, id])
            .ok();
    }
}

/// SQLite-backed receipt store.
#[allow(dead_code)]
pub struct SqliteReceiptStore {
    conn: Mutex<Connection>,
    db_path: PathBuf,
}

impl SqliteReceiptStore {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {}", e))?;
        }

        let conn = Connection::open_with_flags(&db_path, OpenFlags::default())
            .map_err(|e| format!("open db failed: {}", e))?;

        conn.execute_batch(
            "PRAGMA journal_mode=WAL;\n
             PRAGMA synchronous=NORMAL;\n
             CREATE TABLE IF NOT EXISTS receipts (
                 receipt_id TEXT PRIMARY KEY,
                 context_hash TEXT NOT NULL,
                 catalog_hash TEXT NOT NULL,
                 policy_hash TEXT NOT NULL,
                 pool_hash TEXT NOT NULL,
                 registry_hash TEXT NOT NULL,
                 phase TEXT NOT NULL,
                 selected TEXT,
                 alternatives TEXT,
                 exclusions TEXT,
                 abstention TEXT,
                 created_at TEXT NOT NULL
             );\n
             CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts(created_at);",
        )
        .map_err(|e| format!("schema init failed: {}", e))?;

        Ok(Self {
            conn: Mutex::new(conn),
            db_path,
        })
    }

    pub fn insert(&self, receipt: &Receipt) {
        let conn = self.conn.lock().unwrap();
        let selected_str = receipt.selected.as_ref().map(|s| serde_json::to_string(s).unwrap_or_default());
        let alternatives_str = serde_json::to_string(&receipt.alternatives).unwrap_or_default();
        let exclusions_str = serde_json::to_string(&receipt.exclusions).unwrap_or_default();
        conn.execute(
            "INSERT OR REPLACE INTO receipts (receipt_id, context_hash, catalog_hash, policy_hash, pool_hash, registry_hash, phase, selected, alternatives, exclusions, abstention, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                receipt.receipt_id,
                receipt.context_hash,
                receipt.catalog_hash,
                receipt.policy_hash,
                receipt.pool_hash,
                receipt.registry_hash,
                receipt.phase,
                selected_str,
                alternatives_str,
                exclusions_str,
                receipt.abstention,
                receipt.created_at.to_rfc3339(),
            ],
        )
        .ok();
    }

    pub fn get(&self, receipt_id: &str) -> Option<Receipt> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT receipt_id, context_hash, catalog_hash, policy_hash, pool_hash, registry_hash, phase, selected, alternatives, exclusions, abstention, created_at FROM receipts WHERE receipt_id = ?1"
        ).ok()?;
        let mut rows = stmt.query_map(params![receipt_id], |row| {
            let created_at_str: String = row.get(11).unwrap();
            let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
                .unwrap()
                .with_timezone(&chrono::Utc);
            let selected: Option<String> = row.get(7).ok();
            let alternatives: Option<String> = row.get(8).ok();
            let exclusions: Option<String> = row.get(9).ok();
            Ok(Receipt {
                receipt_id: row.get(0).unwrap(),
                context_hash: row.get(1).unwrap(),
                catalog_hash: row.get(2).unwrap(),
                policy_hash: row.get(3).unwrap(),
                pool_hash: row.get(4).unwrap(),
                registry_hash: row.get(5).unwrap(),
                phase: row.get(6).unwrap(),
                selected: selected.and_then(|s| serde_json::from_str::<ReceiptSelection>(&s).ok()),
                alternatives: alternatives.and_then(|s| serde_json::from_str::<Vec<ReceiptSelection>>(&s).ok()).unwrap_or_default(),
                exclusions: exclusions.and_then(|s| serde_json::from_str::<Vec<ReceiptExclusion>>(&s).ok()).unwrap_or_default(),
                abstention: row.get(10).unwrap(),
                created_at,
            })
        }).ok()?;
        rows.next().and_then(|r| r.ok())
    }

    pub fn list(&self) -> Vec<Receipt> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT receipt_id, context_hash, catalog_hash, policy_hash, pool_hash, registry_hash, phase, selected, alternatives, exclusions, abstention, created_at FROM receipts ORDER BY created_at DESC"
        ).unwrap();
        let rows = stmt.query_map([], |row| {
            let created_at_str: String = row.get(11).unwrap();
            let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
                .unwrap()
                .with_timezone(&chrono::Utc);
            let selected: Option<String> = row.get(7).ok().unwrap_or(None);
            let alternatives: Option<String> = row.get(8).ok().unwrap_or(None);
            let exclusions: Option<String> = row.get(9).ok().unwrap_or(None);
            Ok(Receipt {
                receipt_id: row.get(0).unwrap(),
                context_hash: row.get(1).unwrap(),
                catalog_hash: row.get(2).unwrap(),
                policy_hash: row.get(3).unwrap(),
                pool_hash: row.get(4).unwrap(),
                registry_hash: row.get(5).unwrap(),
                phase: row.get(6).unwrap(),
                selected: selected.and_then(|s| serde_json::from_str::<ReceiptSelection>(&s).ok()),
                alternatives: alternatives.and_then(|s| serde_json::from_str::<Vec<ReceiptSelection>>(&s).ok()).unwrap_or_default(),
                exclusions: exclusions.and_then(|s| serde_json::from_str::<Vec<ReceiptExclusion>>(&s).ok()).unwrap_or_default(),
                abstention: row.get(10).unwrap(),
                created_at,
            })
        }).unwrap();
        rows.filter_map(Result::ok).collect()
    }
}
