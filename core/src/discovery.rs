//! Machine discovery: agents on PATH, API key names in env files, providers, library sources.
//! Values are never read — only names and paths.

use crate::types::{Agent, Provider};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

/// Full discovery output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Discovery {
    pub agents: Vec<Agent>,
    pub keys: BTreeMap<String, Vec<String>>, // provider -> key names
    pub providers: BTreeMap<String, Provider>,
    pub library_dirs: Vec<PathBuf>,
    pub ssh_hosts: Vec<String>,
    pub git_projects: Vec<PathBuf>,
    pub browsers: Vec<String>,
}

/// Worker derived from discovery: every (agent, key_slot, provider) tuple.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredWorker {
    pub id: String,
    pub agent: String,
    pub key_slot: Option<String>,
    pub provider: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub write_access: bool,
    pub path: Option<String>, // resolved binary path for CLI agents
}

impl Discovery {
    /// Scan the machine and build a Discovery.
    pub fn scan() -> Result<Self, String> {
        let agents = scan_agents();
        let keys = scan_keys();
        let providers = scan_providers(&keys);
        let library_dirs = scan_library_dirs();
        let ssh_hosts = scan_ssh_hosts();
        let git_projects = scan_git_projects();
        let browsers = scan_browsers();
        Ok(Discovery {
            agents,
            keys,
            providers,
            library_dirs,
            ssh_hosts,
            git_projects,
            browsers,
        })
    }

    /// Build the dynamic worker registry from discovery.
    /// Every (agent, key_slot) pair is a worker. Key-less CLIs are workers with key_slot=None.
    pub fn workers(&self) -> Vec<DiscoveredWorker> {
        let mut out: Vec<DiscoveredWorker> = Vec::new();

        // Bare `pi`: the default. Takes any free NIM key per dispatch (see Registry::key_for).
        if self.keys.get("nim").map_or(false, |k| !k.is_empty()) {
            out.push(DiscoveredWorker {
                id: "pi".to_string(),
                agent: "pi".to_string(),
                key_slot: None,
                provider: "nim".to_string(),
                base_url: self.providers.get("nim").map(|p| p.base_url.clone()),
                model: Some(PI_NIM_MODEL.to_string()),
                write_access: true,
                path: None,
            });
        }

        // NIM workers: pi pinned to each NIM key (explicit `pi:NIM_n` only)
        for agent in &self.agents {
            if agent.id == "pi" {
                if let Some(nim_keys) = self.keys.get("nim") {
                    for key in nim_keys {
                        out.push(DiscoveredWorker {
                            id: format!("pi:{}", key),
                            agent: "pi".to_string(),
                            key_slot: Some(key.clone()),
                            provider: "nim".to_string(),
                            base_url: self.providers.get("nim").map(|p| p.base_url.clone()),
                            model: None,
                            write_access: true,
                            path: None,
                        });
                    }
                }
            }
        }

        // Groq workers on each GROQ key
        if let Some(groq_keys) = self.keys.get("groq") {
            for key in groq_keys {
                out.push(DiscoveredWorker {
                    id: format!("groq:{}", key),
                    agent: "groq".to_string(),
                    key_slot: Some(key.clone()),
                    provider: "groq".to_string(),
                    base_url: self.providers.get("groq").map(|p| p.base_url.clone()),
                    model: None,
                    write_access: true,
                    path: None,
                });
            }
        }

        // OpenRouter workers on each OPENROUTER key
        if let Some(or_keys) = self.keys.get("openrouter") {
            for key in or_keys {
                out.push(DiscoveredWorker {
                    id: format!("openrouter:{}", key),
                    agent: "openrouter".to_string(),
                    key_slot: Some(key.clone()),
                    provider: "openrouter".to_string(),
                    base_url: self.providers.get("openrouter").map(|p| p.base_url.clone()),
                    model: None,
                    write_access: true,
                    path: None,
                });
            }
        }

        // Key-less agent CLIs
        for agent in &self.agents {
            let id = agent.id.as_str();
            let write = matches!(id, "claude" | "codex" | "opencode" | "kilo" | "cline" | "goose" | "omp");
            // cline runs in yolo mode and is not used as a worker: discovered, never routed to.
            if !["pi", "nim-chat", "cline"].contains(&id) {
                out.push(DiscoveredWorker {
                    id: id.to_string(),
                    agent: id.to_string(),
                    key_slot: None,
                    provider: id.to_string(),
                    base_url: None,
                    model: None,
                    write_access: write,
                    path: agent.path.clone(),
                });
            }
        }

        // Nim-chat workers (read-only NIM API)
        if let Some(nim_keys) = self.keys.get("nim") {
            for key in nim_keys {
                out.push(DiscoveredWorker {
                    id: format!("nim-chat:{}", key),
                    agent: "nim-chat".to_string(),
                    key_slot: Some(key.clone()),
                    provider: "nim".to_string(),
                    base_url: self.providers.get("nim").map(|p| p.base_url.clone()),
                    model: None,
                    write_access: false,
                    path: None,
                });
            }
        }

        out
    }
}

/// Model the NIM-backed pi worker asks for (same id as the Python router's config).
pub const PI_NIM_MODEL: &str = "nvidia/nemotron-3.5-super-vl-120b-a12b";

fn scan_agents() -> Vec<Agent> {
    let bins = [
        "claude", "codex", "opencode", "kilo", "pi", "cline", "jcode", "goose", "omp",
        "hermes", "crush", "qwen",
    ];
    let mut out = Vec::new();
    for b in bins {
        if let Some(p) = which(b) {
            out.push(Agent { id: b.to_string(), path: Some(p.to_string_lossy().to_string()) });
        }
    }
    out
}

fn which(cmd: &str) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PATH") {
        for dir in p.split(':') {
            let full = Path::new(dir).join(cmd);
            if full.is_file() {
                return Some(full);
            }
        }
    }
    None
}

fn scan_keys() -> BTreeMap<String, Vec<String>> {
    // Provider prefixes recognized in env files + process env.
    let provider_prefixes = [
        "NIM", "NVIDIA_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY",
        "TOGETHER_API_KEY", "FIREWORKS_API_KEY", "CEREBRAS_API_KEY", "XAI_API_KEY",
    ];
    let mut found: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut seen: HashSet<String> = HashSet::new();

    // Env files
    let home = env::var_os("HOME")
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_default();
    for envfile in env_files(&home) {
        if let Ok(text) = fs::read_to_string(&envfile) {
            for line in text.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') || !line.contains('=') {
                    continue;
                }
                let name = line.split('=').next().unwrap_or("").trim();
                let name = name.strip_prefix("export ").unwrap_or(name);
                for prefix in &provider_prefixes {
                    if name.starts_with(prefix) && seen.insert(name.to_string()) {
                        let provider = provider_id(prefix);
                        found.entry(provider).or_default().push(name.to_string());
                    }
                }
            }
        }
    }

    // Process environment
    for (name, _) in env::vars() {
        for prefix in &provider_prefixes {
            if name.starts_with(prefix) && seen.insert(name.clone()) {
                let provider = provider_id(prefix);
                found.entry(provider).or_default().push(name.clone());
            }
        }
    }

    // Sort each provider's keys
    for v in found.values_mut() {
        v.sort();
    }
    found
}

fn provider_id(prefix: &str) -> String {
    match prefix {
        p if p.starts_with("NIM") => "nim".to_string(),
        "GROQ_API_KEY" => "groq".to_string(),
        "OPENROUTER_API_KEY" => "openrouter".to_string(),
        "ANTHROPIC_API_KEY" => "anthropic".to_string(),
        "OPENAI_API_KEY" => "openai".to_string(),
        "GEMINI_API_KEY" => "gemini".to_string(),
        "MISTRAL_API_KEY" => "mistral".to_string(),
        "DEEPSEEK_API_KEY" => "deepseek".to_string(),
        "TOGETHER_API_KEY" => "together".to_string(),
        "FIREWORKS_API_KEY" => "fireworks".to_string(),
        "CEREBRAS_API_KEY" => "cerebras".to_string(),
        "XAI_API_KEY" => "xai".to_string(),
        _ => prefix.to_lowercase(),
    }
}

fn scan_providers(keys: &BTreeMap<String, Vec<String>>) -> BTreeMap<String, Provider> {
    // Static provider table from config/providers.yaml equivalents.
    // In the Rust core this is loaded from config/providers.yaml; here are the defaults.
    let known: BTreeMap<&str, (&str, Option<&str>)> = BTreeMap::from([
        ("nim", ("https://integrate.api.nvidia.com/v1", Some("openai"))),
        ("openrouter", ("https://openrouter.ai/api/v1", Some("openai"))),
        ("groq", ("https://api.groq.com/openai/v1", Some("openai"))),
        ("anthropic", ("https://api.anthropic.com/v1", Some("anthropic"))),
        ("openai", ("https://api.openai.com/v1", Some("openai"))),
        ("mistral", ("https://api.mistral.ai/v1", Some("openai"))),
        ("deepseek", ("https://api.deepseek.com/v1", Some("openai"))),
        ("together", ("https://api.together.xyz/v1", Some("openai"))),
        ("fireworks", ("https://api.fireworks.ai/inference/v1", Some("openai"))),
        ("cerebras", ("https://api.cerebras.ai/v1", Some("openai"))),
        ("xai", ("https://api.x.ai/v1", Some("openai"))),
        ("gemini", ("https://generativelanguage.googleapis.com/v1beta/openai", Some("openai"))),
    ]);
    let mut out = BTreeMap::new();
    for (prov, _names) in keys {
        if let Some((url, style)) = known.get(prov.as_str()) {
            out.insert(prov.clone(), Provider {
                id: prov.clone(),
                base_url: url.to_string(),
                style: style.map(|s| s.to_string()),
            });
        } else {
            out.insert(prov.clone(), Provider {
                id: prov.clone(),
                base_url: String::new(),
                style: None,
            });
        }
    }
    out
}

fn scan_library_dirs() -> Vec<PathBuf> {
    let home = env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    vec![
        home.join(".claude").join("skills"),
        home.join(".agent-skills"),
        home.join(".codex").join("skills"),
        home.join(".config").join("opencode").join("skills"),
    ]
    .into_iter()
    .filter(|p| p.exists())
    .collect()
}

fn scan_ssh_hosts() -> Vec<String> {
    let home = env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let ssh_config = home.join(".ssh").join("config");
    let mut out = Vec::new();
    if let Ok(text) = fs::read_to_string(&ssh_config) {
        for line in text.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("Host ") {
                for host in rest.split_whitespace() {
                    if !host.contains(['*', '?', '!']) {
                        out.push(host.to_string());
                    }
                }
            }
        }
    }
    out
}

fn scan_git_projects() -> Vec<PathBuf> {
    let home = env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let roots = [home.join("Developer"), home.join("Projects"), home.join("code"), home.join("src")];
    let mut out = Vec::new();
    for root in roots {
        if !root.is_dir() { continue; }
        if let Ok(entries) = fs::read_dir(&root) {
            for e in entries.flatten() {
                let p = e.path();
                if p.join(".git").is_dir() {
                    out.push(p);
                }
            }
        }
    }
    out
}

fn scan_browsers() -> Vec<String> {
    // Placeholder: browser detection (Neo, Ego) is macOS-specific via mdfind.
    // Kept empty in the Rust core until a cross-platform browser probe is added.
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Worker;

    #[test]
    fn provider_id_mapping() {
        assert_eq!(provider_id("NIM_1"), "nim");
        assert_eq!(provider_id("GROQ_API_KEY"), "groq");
        assert_eq!(provider_id("OPENROUTER_API_KEY"), "openrouter");
    }

    #[test]
    fn worker_label_with_key() {
        let w = Worker::new("pi", Some("NIM_2"), "nim");
        assert_eq!(w.label(), "pi:NIM_2");
    }

    #[test]
    fn worker_label_without_key() {
        let w = Worker::new("claude", None, "claude");
        assert_eq!(w.label(), "claude");
    }
}

/// Env files that may hold provider keys, in priority order. The last entry is the legacy
/// location from before the rename; it is read only as a fallback.
pub fn env_files(home: &str) -> Vec<String> {
    vec![
        format!("{}/.env", home),
        format!("{}/.config/lingonberry/env", home),
        format!("{}/.config/agent-router/env", home),
    ]
}

/// Value of a key slot: process env first, then the env files discovery already scans.
/// Discovery sees names from those files, so the value must come from them too.
/// The return value is never printed.
pub fn key_value(name: &str) -> Option<String> {
    if let Ok(v) = std::env::var(name) {
        if !v.is_empty() {
            return Some(v);
        }
    }
    let home = std::env::var("HOME").ok()?;
    for file in env_files(&home) {
        let Ok(text) = std::fs::read_to_string(&file) else { continue };
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with('#') || !line.contains('=') {
                continue;
            }
            let line = line.strip_prefix("export ").unwrap_or(line);
            let Some((k, v)) = line.split_once('=') else { continue };
            if k.trim() == name {
                let v = v.trim().trim_matches('"').trim_matches('\'').to_string();
                if !v.is_empty() {
                    return Some(v);
                }
            }
        }
    }
    None
}
