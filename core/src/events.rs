use crate::config::lingonberry_home;
use chrono::Utc;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;

#[derive(Debug, Serialize)]
pub struct EventRecord<'a, T: Serialize> {
    pub ts: String,
    pub kind: &'a str,
    pub payload: T,
}

/// Appends structured JSON lines to ~/.lingonberry/logs/events.jsonl without ever logging raw keys.
pub fn log_event<T: Serialize>(kind: &str, payload: T) {
    let logs_dir = lingonberry_home().join("logs");
    if fs::create_dir_all(&logs_dir).is_err() {
        return;
    }
    let path = logs_dir.join("events.jsonl");
    let rec = EventRecord {
        ts: Utc::now().to_rfc3339(),
        kind,
        payload,
    };
    if let Ok(line) = serde_json::to_string(&rec) {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{line}");
        }
    }
}
