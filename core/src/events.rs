//! Append-only event log for global agentic use: one JSON object per line in ~/.lingonberry/logs/events.jsonl.
//! Fields carry names, ids, states and timings only. Key values never enter this log.

use serde_json::{json, Map, Value};
use std::io::Write;

pub const FILE_NAME: &str = "events.jsonl";

/// Append one event. Logging must never break a run, so write errors are reported to stderr and dropped.
pub fn log(event: &str, fields: Value) {
    let mut rec = Map::new();
    rec.insert("ts".into(), json!(chrono::Utc::now().to_rfc3339()));
    rec.insert("event".into(), json!(event));
    rec.insert("pid".into(), json!(std::process::id()));
    if let Value::Object(extra) = fields {
        for (k, v) in extra {
            rec.insert(k, v);
        }
    }
    let line = match serde_json::to_string(&Value::Object(rec)) {
        Ok(s) => s,
        Err(_) => return,
    };
    let dir = crate::config::logs_dir();
    let path = dir.join(FILE_NAME);
    let res = std::fs::create_dir_all(&dir).and_then(|_| {
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
        writeln!(f, "{}", line)
    });
    if let Err(e) = res {
        eprintln!("events: cannot write {}: {}", path.display(), e);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn writes_one_json_line_per_event() {
        let _g = crate::config::TEST_HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("lb-events-{}", uuid::Uuid::new_v4()));
        std::env::set_var("LINGONBERRY_HOME", &dir);
        super::log("test.event", serde_json::json!({"run_id": "abc", "state": "done"}));
        let text = std::fs::read_to_string(dir.join("logs").join(super::FILE_NAME)).unwrap();
        let last: serde_json::Value = serde_json::from_str(text.lines().last().unwrap()).unwrap();
        assert_eq!(last["event"], "test.event");
        assert_eq!(last["run_id"], "abc");
        assert!(last["ts"].is_string());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
