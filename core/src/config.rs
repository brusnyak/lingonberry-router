use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub port: u16,
    pub default_worker: String,
    pub max_inflight_per_key: usize,
    pub rpm_per_key: usize,
    pub cooldown_s: u64,
    pub lease_wait_s: u64,
    pub excluded_agents: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            port: 8799,
            default_worker: "pi".to_string(),
            max_inflight_per_key: 3,
            rpm_per_key: 40,
            cooldown_s: 60,
            lease_wait_s: 30,
            excluded_agents: vec!["cline".to_string()],
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
    }

    #[test]
    fn invalid_zero_port_rejected() {
        let mut cfg = Config::default();
        cfg.port = 0;
        assert!(validate_config(&cfg).is_err());
    }
}
