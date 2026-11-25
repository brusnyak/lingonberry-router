use crate::types::{Agent, DiscoveredWorker, DiscoveryData, Provider};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const PI_NIM_MODEL: &str = "nvidia/nemotron-3.5-super-vl-120b-a12b";

const AGENT_BINS: &[&str] = &[
    "claude", "codex", "opencode", "kilo", "pi", "cline", "jcode", "goose", "omp", "hermes",
    "crush", "qwen",
];

const PROVIDER_PREFIXES: &[&str] = &[
    "NIM",
    "NVIDIA_API_KEY",
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "MISTRAL_API_KEY",
    "DEEPSEEK_API_KEY",
    "TOGETHER_API_KEY",
    "FIREWORKS_API_KEY",
    "CEREBRAS_API_KEY",
    "XAI_API_KEY",
];

const WRITE_AGENTS: &[&str] = &[
    "claude", "codex", "opencode", "kilo", "cline", "goose", "omp",
];

pub fn provider_id(prefix: &str) -> &'static str {
    if prefix.starts_with("NIM") || prefix == "NVIDIA_API_KEY" {
        return "nim";
    }
    match prefix {
        "GROQ_API_KEY" => "groq",
        "OPENROUTER_API_KEY" => "openrouter",
        "ANTHROPIC_API_KEY" => "anthropic",
        "OPENAI_API_KEY" => "openai",
        "GEMINI_API_KEY" => "gemini",
        "MISTRAL_API_KEY" => "mistral",
        "DEEPSEEK_API_KEY" => "deepseek",
        "TOGETHER_API_KEY" => "together",
        "FIREWORKS_API_KEY" => "fireworks",
        "CEREBRAS_API_KEY" => "cerebras",
        "XAI_API_KEY" => "xai",
        _ => "custom",
    }
}

fn known_provider(id: &str) -> Option<(&'static str, Option<&'static str>, Option<&'static str>)> {
    match id {
        "nim" => Some((
            "https://integrate.api.nvidia.com/v1",
            Some("openai"),
            Some(PI_NIM_MODEL),
        )),
        "openrouter" => Some((
            "https://openrouter.ai/api/v1",
            Some("openai"),
            Some("openrouter/auto"),
        )),
        "groq" => Some((
            "https://api.groq.com/openai/v1",
            Some("openai"),
            Some("llama-3.3-70b-versatile"),
        )),
        "anthropic" => Some((
            "https://api.anthropic.com/v1",
            Some("anthropic"),
            Some("claude-sonnet-4"),
        )),
        "openai" => Some(("https://api.openai.com/v1", Some("openai"), Some("gpt-4.1"))),
        "mistral" => Some((
            "https://api.mistral.ai/v1",
            Some("openai"),
            Some("mistral-large-latest"),
        )),
        "deepseek" => Some((
            "https://api.deepseek.com/v1",
            Some("openai"),
            Some("deepseek-chat"),
        )),
        "together" => Some(("https://api.together.xyz/v1", Some("openai"), None)),
        "fireworks" => Some(("https://api.fireworks.ai/inference/v1", Some("openai"), None)),
        "cerebras" => Some(("https://api.cerebras.ai/v1", Some("openai"), None)),
        "xai" => Some(("https://api.x.ai/v1", Some("openai"), Some("grok-3"))),
        "gemini" => Some((
            "https://generativelanguage.googleapis.com/v1beta/openai",
            Some("openai"),
            Some("gemini-2.5-flash"),
        )),
        _ => None,
    }
}

pub fn env_files(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".env"),
        home.join(".config").join("lingonberry").join("env"),
    ]
}

/// Resolves a key value at dispatch time from process env or ~/.env / ~/.config/lingonberry/env.
/// Key values are NEVER logged or serialized into snapshots.
pub fn resolve_key_value(slot: &str) -> Option<String> {
    if let Ok(val) = std::env::var(slot) {
        if !val.trim().is_empty() {
            return Some(val);
        }
    }
    let home = dirs::home_dir()?;
    for file in env_files(&home) {
        if let Ok(content) = fs::read_to_string(file) {
            for raw in content.lines() {
                let line = raw.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = line.split_once('=') {
                    let key_name = k.trim().strip_prefix("export ").unwrap_or(k.trim()).trim();
                    let val = v.trim().trim_matches('"').trim_matches('\'');
                    if key_name == slot && !val.is_empty() {
                        return Some(val.to_string());
                    }
                }
            }
        }
    }
    None
}

pub fn redact_secrets(text: &str) -> String {
    let mut out = text.to_string();
    for (k, v) in std::env::vars() {
        let upper = k.to_ascii_uppercase();
        if v.len() >= 8
            && (upper.contains("KEY")
                || upper.contains("TOKEN")
                || upper.contains("SECRET")
                || upper.contains("PASSWORD")
                || upper.starts_with("NIM"))
            && out.contains(&v)
        {
            out = out.replace(&v, &format!("[REDACTED:{k}]"));
        }
    }
    out
}

pub fn scan_discovery() -> DiscoveryData {
    let mut agents = Vec::new();
    for bin in AGENT_BINS {
        if let Ok(path) = which::which(bin) {
            agents.push(Agent {
                id: (*bin).to_string(),
                path: Some(path.to_string_lossy().into_owned()),
            });
        }
    }

    let mut keys: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut seen = BTreeSet::new();
    if let Some(home) = dirs::home_dir() {
        for file in env_files(&home) {
            if let Ok(content) = fs::read_to_string(file) {
                for raw in content.lines() {
                    let line = raw.trim();
                    if line.is_empty() || line.starts_with('#') {
                        continue;
                    }
                    if let Some((k, v)) = line.split_once('=') {
                        if v.trim().is_empty() {
                            continue;
                        }
                        let name = k.trim().strip_prefix("export ").unwrap_or(k.trim()).trim();
                        for prefix in PROVIDER_PREFIXES {
                            if name.starts_with(prefix) && seen.insert(name.to_string()) {
                                let prov = provider_id(prefix).to_string();
                                keys.entry(prov).or_default().push(name.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    for (name, val) in std::env::vars() {
        if val.trim().is_empty() {
            continue;
        }
        for prefix in PROVIDER_PREFIXES {
            if name.starts_with(prefix) && seen.insert(name.clone()) {
                let prov = provider_id(prefix).to_string();
                keys.entry(prov).or_default().push(name.clone());
            }
        }
    }

    for list in keys.values_mut() {
        list.sort();
    }

    let mut providers = BTreeMap::new();
    for prov in keys.keys() {
        if let Some((url, style, _)) = known_provider(prov) {
            providers.insert(
                prov.clone(),
                Provider {
                    id: prov.clone(),
                    base_url: url.to_string(),
                    style: style.map(str::to_string),
                },
            );
        } else {
            providers.insert(
                prov.clone(),
                Provider {
                    id: prov.clone(),
                    base_url: String::new(),
                    style: None,
                },
            );
        }
    }

    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let library_dirs = [
        home.join(".claude").join("skills"),
        home.join(".agent-skills"),
        home.join(".codex").join("skills"),
        home.join(".config").join("opencode").join("skills"),
    ]
    .into_iter()
    .filter(|p| p.exists())
    .map(|p| p.to_string_lossy().into_owned())
    .collect();

    let mut ssh_hosts = Vec::new();
    if let Ok(ssh_cfg) = fs::read_to_string(home.join(".ssh").join("config")) {
        for raw in ssh_cfg.lines() {
            let trimmed = raw.trim();
            if let Some(rest) = trimmed.strip_prefix("Host ") {
                for host in rest.split_whitespace() {
                    if !host.contains('*') && !host.contains('?') && !host.contains('!') {
                        ssh_hosts.push(host.to_string());
                    }
                }
            }
        }
    }

    let mut git_projects = Vec::new();
    for root in [
        home.join("Developer"),
        home.join("Projects"),
        home.join("code"),
        home.join("src"),
    ] {
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.join(".git").exists() {
                    git_projects.push(p.to_string_lossy().into_owned());
                }
            }
        }
    }

    DiscoveryData {
        agents,
        keys,
        providers,
        library_dirs,
        ssh_hosts,
        git_projects,
        browsers: Vec::new(),
    }
}

pub fn build_workers(d: &DiscoveryData) -> Vec<DiscoveredWorker> {
    let mut out = Vec::new();
    let nim_keys = d.keys.get("nim").cloned().unwrap_or_default();

    if !nim_keys.is_empty() {
        out.push(DiscoveredWorker {
            id: "pi".to_string(),
            agent: "pi".to_string(),
            key_slot: None,
            provider: "nim".to_string(),
            base_url: d.providers.get("nim").map(|p| p.base_url.clone()),
            model: Some(PI_NIM_MODEL.to_string()),
            write_access: true,
            path: None,
        });
    }

    for agent in &d.agents {
        if agent.id == "pi" {
            for key in &nim_keys {
                out.push(DiscoveredWorker {
                    id: format!("pi:{key}"),
                    agent: "pi".to_string(),
                    key_slot: Some(key.clone()),
                    provider: "nim".to_string(),
                    base_url: d.providers.get("nim").map(|p| p.base_url.clone()),
                    model: Some(PI_NIM_MODEL.to_string()),
                    write_access: true,
                    path: None,
                });
            }
        }
    }

    for (prov, keys) in &d.keys {
        if prov == "nim" {
            continue;
        }
        let default_model = known_provider(prov).and_then(|(_, _, m)| m.map(str::to_string));
        for key in keys {
            out.push(DiscoveredWorker {
                id: format!("{prov}:{key}"),
                agent: prov.clone(),
                key_slot: Some(key.clone()),
                provider: prov.clone(),
                base_url: d.providers.get(prov).map(|p| p.base_url.clone()),
                model: default_model.clone(),
                write_access: true,
                path: None,
            });
        }
    }

    for agent in &d.agents {
        if agent.id != "pi" && agent.id != "nim-chat" {
            out.push(DiscoveredWorker {
                id: agent.id.clone(),
                agent: agent.id.clone(),
                key_slot: None,
                provider: agent.id.clone(),
                base_url: None,
                model: None,
                write_access: WRITE_AGENTS.contains(&agent.id.as_str()),
                path: agent.path.clone(),
            });
        }
    }

    for key in &nim_keys {
        out.push(DiscoveredWorker {
            id: format!("nim-chat:{key}"),
            agent: "nim-chat".to_string(),
            key_slot: Some(key.clone()),
            provider: "nim".to_string(),
            base_url: d.providers.get("nim").map(|p| p.base_url.clone()),
            model: Some(PI_NIM_MODEL.to_string()),
            write_access: false,
            path: None,
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_mapping_keeps_nim_and_gemini_isolated() {
        assert_eq!(provider_id("NIM_1"), "nim");
        assert_eq!(provider_id("NVIDIA_API_KEY"), "nim");
        assert_eq!(provider_id("GEMINI_API_KEY"), "gemini");
        assert_eq!(provider_id("GROQ_API_KEY"), "groq");
    }
}
