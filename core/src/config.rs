use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub port: u16,
    pub default_worker: String,
    pub max_inflight_per_key: usize,
    /// Default calls per minute for any provider not listed in provider_rpm. Conservative on purpose.
    pub rpm_per_key: usize,
    /// Per-provider calls per minute. NVIDIA NIM is 40 (owner-confirmed limit).
    #[serde(default = "default_provider_rpm")]
    pub provider_rpm: std::collections::BTreeMap<String, usize>,
    #[serde(deserialize_with = "whole_secs")]
    pub cooldown_s: u64,
    #[serde(deserialize_with = "whole_secs")]
    pub lease_wait_s: u64,
    pub excluded_agents: Vec<String>,
    /// Owner-key dispatch mode. `simulate` keeps the old 2.4s stub (tests, dry runs).
    #[serde(default)]
    pub execution: ExecutionMode,
}

fn default_provider_rpm() -> std::collections::BTreeMap<String, usize> {
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
    }

    #[test]
    fn execution_mode_is_optional_and_lowercase() {
        let json = r#"{"port":8799,"default_worker":"pi","max_inflight_per_key":3,
            "rpm_per_key":40,"cooldown_s":60,"lease_wait_s":30,"excluded_agents":[]}"#;
        let cfg: Config = serde_json::from_str(json).expect("missing execution must default");
        assert_eq!(cfg.execution, ExecutionMode::Live);
        let sim: Config = serde_json::from_str(&json.replace("\"excluded_agents\":[]", "\"excluded_agents\":[],\"execution\":\"simulate\"")).unwrap();
        assert_eq!(sim.execution, ExecutionMode::Simulate);
    }

    #[test]
    fn config_written_with_float_seconds_still_loads() {
        let json = r#"{"port":8799,"default_worker":"pi","max_inflight_per_key":3,
            "rpm_per_key":40,"cooldown_s":60.0,"lease_wait_s":30.0,"excluded_agents":["cline"]}"#;
        let cfg: Config = serde_json::from_str(json).expect("float seconds must parse");
        assert_eq!(cfg.cooldown_s, 60);
        assert_eq!(cfg.lease_wait_s, 30);
    }

    #[test]
    fn fractional_seconds_are_rejected() {
        let json = r#"{"port":8799,"default_worker":"pi","max_inflight_per_key":3,
            "rpm_per_key":40,"cooldown_s":1.5,"lease_wait_s":30,"excluded_agents":[]}"#;
        assert!(serde_json::from_str::<Config>(json).is_err());
    }

    #[test]
    fn invalid_zero_port_rejected() {
        let mut cfg = Config::default();
        cfg.port = 0;
        assert!(validate_config(&cfg).is_err());
    }
}
