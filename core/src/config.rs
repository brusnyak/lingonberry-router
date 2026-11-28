use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

/// Accepts whole seconds written as `60` or `60.0` (the older core wrote floats).
fn whole_secs<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<u64, D::Error> {
    let v = f64::deserialize(d)?;
    if v.is_finite() && v >= 0.0 && v.fract() == 0.0 {
        Ok(v as u64)
    } else {
        Err(serde::de::Error::custom("expected a whole number of seconds"))
    }
}

/// How a dispatcher that is allowed to spend owner keys behaves.
/// `live` = call the provider and store the real answer. `simulate` = record a labelled stub.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionMode {
    Live,
    Simulate,
}

impl Default for ExecutionMode {
    fn default() -> Self {
        ExecutionMode::Live
    }
}

fn default_true() -> bool {
    true
}

fn default_cli_timeout_s() -> u64 {
    300
}

fn default_quiet_start() -> u8 {
    23
}

fn default_quiet_end() -> u8 {
    7
}

fn default_idle_min_s() -> u64 {
    900
}

fn default_overnight_max_runs() -> usize {
    5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub port: u16,
    pub default_worker: String,
    pub max_inflight_per_key: usize,
    /// Default calls per minute for any provider not listed in provider_rpm. Conservative on purpose.
    pub rpm_per_key: usize,
    /// Per-provider calls per minute. NVIDIA NIM is 40 (owner-confirmed limit).
    #[serde(default = "default_provider_rpm")]
    pub provider_rpm: BTreeMap<String, usize>,
    #[serde(deserialize_with = "whole_secs")]
    pub cooldown_s: u64,
    #[serde(deserialize_with = "whole_secs")]
    pub lease_wait_s: u64,
    pub excluded_agents: Vec<String>,
    /// Owner-key dispatch mode. `simulate` keeps the old 2.4s stub (tests, dry runs).
    #[serde(default)]
    pub execution: ExecutionMode,
    /// Require explicit `--approve` / owner approval before spending metered/paid keys.
    #[serde(default = "default_true")]
    pub paid_keys_require_approval: bool,
    /// Hard wall-clock timeout for local CLI worker subprocesses.
    #[serde(default = "default_cli_timeout_s")]
    pub cli_timeout_s: u64,
    /// Opt-in Overnight / Idle mode settings (free/local only unless budget > 0 & approved).
    #[serde(default)]
    pub overnight_enabled: bool,
    #[serde(default = "default_quiet_start")]
    pub overnight_quiet_start_hour: u8,
    #[serde(default = "default_quiet_end")]
    pub overnight_quiet_end_hour: u8,
    #[serde(default = "default_idle_min_s")]
    pub overnight_idle_min_s: u64,
    #[serde(default = "default_overnight_max_runs")]
    pub overnight_max_runs_per_night: usize,
    #[serde(default)]
    pub overnight_budget_usd: f64,
    /// Optional per-key or per-provider tier overrides: "local" | "free_tier" | "metered_paid".
    #[serde(default)]
    pub key_tiers: BTreeMap<String, String>,
}

fn default_provider_rpm() -> BTreeMap<String, usize> {
    [("nim".to_string(), 40)].into_iter().collect()
}

impl Default for Config {
    fn default() -> Self {
        Self {
            port: 8799,
            default_worker: "pi".to_string(),
            max_inflight_per_key: 3,
            rpm_per_key: 30,
            provider_rpm: default_provider_rpm(),
            cooldown_s: 60,
            lease_wait_s: 30,
            excluded_agents: vec!["cline".to_string()],
            execution: ExecutionMode::Live,
            paid_keys_require_approval: true,
            cli_timeout_s: default_cli_timeout_s(),
            overnight_enabled: false,
            overnight_quiet_start_hour: default_quiet_start(),
            overnight_quiet_end_hour: default_quiet_end(),
            overnight_idle_min_s: default_idle_min_s(),
            overnight_max_runs_per_night: default_overnight_max_runs(),
            overnight_budget_usd: 0.0,
            key_tiers: BTreeMap::new(),
        }
    }
}

pub fn lingonberry_home() -> PathBuf {
    if let Ok(custom) = std::env::var("LINGONBERRY_HOME") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lingonberry")
}

pub fn config_path() -> PathBuf {
    lingonberry_home().join("config.json")
}

pub fn api_token_path() -> PathBuf {
    lingonberry_home().join("api.token")
}

/// Ensures an owner-only (`0600`) loopback bearer token exists in `~/.lingonberry/api.token`
/// (or `$LINGONBERRY_API_TOKEN` when overridden in controlled tests).
pub fn ensure_api_token() -> Result<String> {
    if let Ok(env_tok) = std::env::var("LINGONBERRY_API_TOKEN") {
        let t = env_tok.trim();
        if !t.is_empty() {
            return Ok(t.to_string());
        }
    }
    let home = lingonberry_home();
    fs::create_dir_all(&home)?;
    let path = api_token_path();
    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if trimmed.len() >= 16 {
            return Ok(trimmed.to_string());
        }
    }
    let tok = format!(
        "{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    fs::write(&path, format!("{tok}\n"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(tok)
}

pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    if ab.len() != bb.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in ab.iter().zip(bb.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub fn validate_config(cfg: &Config) -> Result<()> {
    let mut errors = Vec::new();
    if cfg.port == 0 {
        errors.push("port must be 1..65535");
    }
    if cfg.max_inflight_per_key == 0 {
        errors.push("max_inflight_per_key must be >= 1");
    }
    if cfg.rpm_per_key == 0 {
        errors.push("rpm_per_key must be >= 1");
    }
    if cfg.cooldown_s == 0 {
        errors.push("cooldown_s must be >= 1");
    }
    if cfg.cli_timeout_s == 0 {
        errors.push("cli_timeout_s must be >= 1");
    }
    if cfg.default_worker.trim().is_empty() {
        errors.push("default_worker cannot be empty");
    }
    if !errors.is_empty() {
        bail!("invalid config.json: {}", errors.join("; "));
    }
    Ok(())
}

pub fn load_config() -> Result<Config> {
    let path = config_path();
    if !path.exists() {
        return Ok(Config::default());
    }
    let text = fs::read_to_string(&path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let cfg: Config = serde_json::from_str(&text)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    validate_config(&cfg)?;
    Ok(cfg)
}

pub fn save_config(cfg: &Config) -> Result<PathBuf> {
    validate_config(cfg)?;
    let home = lingonberry_home();
    fs::create_dir_all(&home)?;
    fs::create_dir_all(home.join("logs"))?;
    let path = config_path();
    let json = serde_json::to_string_pretty(cfg)?;
    fs::write(&path, format!("{json}\n"))?;
    Ok(path)
}

pub fn write_default_config(force: bool) -> Result<PathBuf> {
    let home = lingonberry_home();
    fs::create_dir_all(&home)?;
    fs::create_dir_all(home.join("logs"))?;
    let path = config_path();
    if !path.exists() || force {
        let json = serde_json::to_string_pretty(&Config::default())?;
        fs::write(&path, format!("{json}\n"))?;
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_valid() {
        let cfg = Config::default();
        assert!(validate_config(&cfg).is_ok());
        assert_eq!(cfg.port, 8799);
        assert_eq!(cfg.max_inflight_per_key, 3);
        assert_eq!(cfg.execution, ExecutionMode::Live);
        assert!(cfg.paid_keys_require_approval);
        assert_eq!(cfg.cli_timeout_s, 300);
        assert!(!cfg.overnight_enabled);
    }

    #[test]
    fn execution_mode_is_optional_and_lowercase() {
        let json = r#"{"port":8799,"default_worker":"pi","max_inflight_per_key":3,
            "rpm_per_key":30,"cooldown_s":60,"lease_wait_s":30,"excluded_agents":[]}"#;
        let cfg: Config = serde_json::from_str(json).expect("missing execution must default");
        assert_eq!(cfg.execution, ExecutionMode::Live);
        let sim: Config = serde_json::from_str(&json.replace(
            "\"excluded_agents\":[]",
            "\"excluded_agents\":[],\"execution\":\"simulate\"",
        ))
        .unwrap();
        assert_eq!(sim.execution, ExecutionMode::Simulate);
    }

    #[test]
    fn config_written_with_float_seconds_still_loads() {
        let json = r#"{"port":8799,"default_worker":"pi","max_inflight_per_key":3,
            "rpm_per_key":30,"cooldown_s":60.0,"lease_wait_s":30.0,"excluded_agents":["cline"]}"#;
        let cfg: Config = serde_json::from_str(json).expect("float seconds must parse");
        assert_eq!(cfg.cooldown_s, 60);
        assert_eq!(cfg.lease_wait_s, 30);
    }

    #[test]
    fn fractional_seconds_are_rejected() {
        let json = r#"{"port":8799,"default_worker":"pi","max_inflight_per_key":3,
            "rpm_per_key":30,"cooldown_s":1.5,"lease_wait_s":30,"excluded_agents":[]}"#;
        assert!(serde_json::from_str::<Config>(json).is_err());
    }

    #[test]
    fn invalid_zero_port_rejected() {
        let mut cfg = Config::default();
        cfg.port = 0;
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn constant_time_eq_works() {
        assert!(constant_time_eq("abc123", "abc123"));
        assert!(!constant_time_eq("abc123", "abc124"));
        assert!(!constant_time_eq("abc", "abcd"));
    }
}
