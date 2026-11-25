//! Self-configuration. The router writes its own config on first use and validates it on every start.
//! Everything lives under ~/.lingonberry (or $LINGONBERRY_HOME, used by tests): config.json and logs/.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Config {
    pub version: u32,
    /// Port for `serve` when no address is given on the command line.
    pub port: u16,
    /// Worker used when a run names none. Bare `pi` takes any free NIM key from the pool.
    pub default_worker: String,
    /// Concurrent runs allowed on one key slot.
    pub max_inflight_per_key: usize,
    /// Calls allowed per key slot in any 60 s window.
    pub rpm_per_key: usize,
    /// Seconds a key slot rests after a failed call.
    pub cooldown_s: f64,
    /// Seconds a dispatch waits for a free key slot before it fails.
    pub lease_wait_s: u64,
    /// Agent CLIs that are discovered but never routed to.
    pub excluded_agents: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            port: 8799,
            default_worker: "pi".to_string(),
            max_inflight_per_key: 3,
            rpm_per_key: 40,
            cooldown_s: 60.0,
            lease_wait_s: 30,
            excluded_agents: vec!["cline".to_string()],
        }
    }
}

impl Config {
    /// Problems that would make the router misbehave. Empty when the config is usable.
    pub fn problems(&self) -> Vec<String> {
        let mut out = Vec::new();
        if self.version != CONFIG_VERSION {
            out.push(format!("config version {} is not {}", self.version, CONFIG_VERSION));
        }
        if self.port == 0 {
            out.push("port must be 1-65535".to_string());
        }
        if self.default_worker.trim().is_empty() {
            out.push("default_worker is empty".to_string());
        }
        if self.max_inflight_per_key == 0 {
            out.push("max_inflight_per_key must be at least 1".to_string());
        }
        if self.rpm_per_key == 0 {
            out.push("rpm_per_key must be at least 1".to_string());
        }
        if !(self.cooldown_s >= 0.0) {
            out.push("cooldown_s must be zero or more".to_string());
        }
        out
    }
}

/// $LINGONBERRY_HOME, else ~/.lingonberry.
pub fn state_dir() -> PathBuf {
    if let Ok(p) = std::env::var("LINGONBERRY_HOME") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".lingonberry")
}

pub fn config_path() -> PathBuf {
    state_dir().join("config.json")
}

pub fn logs_dir() -> PathBuf {
    state_dir().join("logs")
}

#[derive(Debug)]
pub enum LoadError {
    Missing,
    Unreadable(String),
    Invalid(Vec<String>),
}

/// Read and validate the config. A missing file is `Missing`, not an error to hide: callers decide.
pub fn load() -> Result<Config, LoadError> {
    let path = config_path();
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(LoadError::Missing),
        Err(e) => return Err(LoadError::Unreadable(format!("{}: {}", path.display(), e))),
    };
    let cfg: Config = serde_json::from_str(&text)
        .map_err(|e| LoadError::Unreadable(format!("{}: {}", path.display(), e)))?;
    let problems = cfg.problems();
    if problems.is_empty() {
        Ok(cfg)
    } else {
        Err(LoadError::Invalid(problems))
    }
}

/// Create the state and log directories and the config file. Existing config is kept unless `force`.
/// Returns the config in effect and whether the file was written now.
pub fn init(force: bool) -> Result<(Config, bool), String> {
    std::fs::create_dir_all(logs_dir()).map_err(|e| format!("cannot create {}: {}", logs_dir().display(), e))?;
    let path = config_path();
    if path.exists() && !force {
        return match load() {
            Ok(cfg) => Ok((cfg, false)),
            Err(LoadError::Invalid(p)) => Err(format!("config invalid: {}", p.join("; "))),
            Err(LoadError::Unreadable(e)) => Err(format!("config unreadable: {}", e)),
            Err(LoadError::Missing) => Err("config vanished while reading".to_string()),
        };
    }
    let cfg = Config::default();
    let text = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, text + "\n").map_err(|e| format!("cannot write {}: {}", path.display(), e))?;
    Ok((cfg, true))
}

#[cfg(test)]
pub static TEST_HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid_and_invalid_values_are_named() {
        assert!(Config::default().problems().is_empty());
        let bad = Config { max_inflight_per_key: 0, port: 0, default_worker: " ".into(), ..Config::default() };
        let p = bad.problems();
        assert_eq!(p.len(), 3, "{:?}", p);
    }

    #[test]
    fn init_writes_once_then_keeps_user_edits() {
        let _g = TEST_HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("lb-config-{}", uuid::Uuid::new_v4()));
        std::env::set_var("LINGONBERRY_HOME", &dir);
        let (cfg, created) = init(false).unwrap();
        assert!(created);
        assert_eq!(cfg, Config::default());
        assert!(logs_dir().is_dir());
        let edited = Config { port: 9001, ..Config::default() };
        std::fs::write(config_path(), serde_json::to_string(&edited).unwrap()).unwrap();
        let (cfg2, created2) = init(false).unwrap();
        assert!(!created2);
        assert_eq!(cfg2.port, 9001);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_file_is_refused_with_reasons() {
        let _g = TEST_HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("lb-config-bad-{}", uuid::Uuid::new_v4()));
        std::env::set_var("LINGONBERRY_HOME", &dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(config_path(), r#"{"version":1,"max_inflight_per_key":0}"#).unwrap();
        match load() {
            Err(LoadError::Invalid(p)) => assert!(p.iter().any(|x| x.contains("max_inflight"))),
            other => panic!("expected Invalid, got {:?}", other),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
