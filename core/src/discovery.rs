use crate::types::{Agent, DiscoveredWorker, DiscoveryData, Provider};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const PI_NIM_MODEL: &str = "nvidia/nemotron-3.5-super-vl-120b-a12b";

const AGENT_BINS: &[&str] = &[
    "claude", "codex", "opencode", "kilo", "pi", "cline", "jcode", "goose", "omp", "hermes",
    "crush", "qwen",
];

/// Env var name -> provider id. Explicit names first, then any `<NAME>_API_KEY` becomes a
/// provider `<name>` (shown, but dispatched only when a base URL is known). NIM_n and NVIDIA_API_KEY map to nim.
const WRITE_AGENTS: &[&str] = &[
    "claude", "codex", "opencode", "kilo", "cline", "goose", "omp",
];

pub fn provider_for_env(name: &str) -> Option<String> {
    let n = name.trim().to_ascii_uppercase();
    if n == "NVIDIA_API_KEY" || (n.starts_with("NIM_") && n.len() > 4) {
        return Some("nim".into());
    }
    let exact = [
        ("GROQ_API_KEY", "groq"),
        ("XAI_API_KEY", "xai"),
        ("GROK_API_KEY", "xai"),
        ("GOOGLE_API_KEY", "google"),
        ("GEMINI_API_KEY", "google"),
        ("GOOGLE_STUDIO_API", "google"),
        ("GOOGLE_AI_STUDIO_API_KEY", "google"),
        ("OPENROUTER_API_KEY", "openrouter"),
        ("MOONSHOT_API_KEY", "kimi"),
        ("KIMI_API_KEY", "kimi"),
        ("QWEN_API_KEY", "qwen"),
        ("DASHSCOPE_API_KEY", "qwen"),
        ("DEEPSEEK_API_KEY", "deepseek"),
        ("MISTRAL_API_KEY", "mistral"),
        ("OPENAI_API_KEY", "openai"),
        ("ANTHROPIC_API_KEY", "anthropic"),
        ("TOGETHER_API_KEY", "together"),
        ("FIREWORKS_API_KEY", "fireworks"),
        ("CEREBRAS_API_KEY", "cerebras"),
    ];
    if let Some((_, p)) = exact.iter().find(|(k, _)| *k == n) {
        return Some((*p).into());
    }
    let suffix = "_API_KEY";
    if n.ends_with(suffix) && n.len() > suffix.len() {
        return Some(n[..n.len() - suffix.len()].to_ascii_lowercase());
    }
    None
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
            Some("llama-3.1-8b-instant"),
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
        "google" => Some((
            "https://generativelanguage.googleapis.com/v1beta/openai",
            Some("openai"),
            Some("gemini-2.5-flash"),
        )),
        "kimi" => Some((
            "https://api.moonshot.ai/v1",
            Some("openai"),
            Some("kimi-k2-0905-preview"),
        )),
        "qwen" => Some((
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            Some("openai"),
            Some("qwen-plus"),
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
    if let Some(rest) = slot.strip_prefix("store:") {
        let (source, name) = rest.split_once('|')?;
        let home = dirs::home_dir()?;
        return crate::stores::resolve_store_value(&home, source, name);
    }
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
    let mut take = |name: &str, keys: &mut BTreeMap<String, Vec<String>>| {
        if let Some(prov) = provider_for_env(name) {
            if seen.insert(name.to_string()) {
                keys.entry(prov).or_default().push(name.to_string());
            }
        }
    };
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
                        take(name, &mut keys);
                    }
                }
            }
        }
    }
    for (name, val) in std::env::vars() {
        if !val.trim().is_empty() {
            take(&name, &mut keys);
        }
    }

    // Keys from other agents' stores become dispatchable as `store:<file>|<name>` slots.
    // Env files are skipped here: the env scan above already covers them.
    let store_keys = dirs::home_dir()
        .map(|h| crate::stores::scan_stores(&h))
        .unwrap_or_default();
    for sk in &store_keys {
        if sk.source == ".env" || sk.source == ".config/lingonberry/env" {
            continue;
        }
        if known_provider(&sk.provider).is_none() {
            continue;
        }
        let slot = format!("store:{}|{}", sk.source, sk.name);
        let list = keys.entry(sk.provider.clone()).or_default();
        if !list.contains(&slot) {
            list.push(slot);
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
        stores: store_keys,
    }
}

/// The core is often started by launchd or Finder, which gives a minimal PATH that hides
/// the agent CLIs installed under the user's tool directories. Add the usual ones once at startup.
pub fn ensure_tool_path() {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut parts: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    let extra = [
        format!("{home}/.local/bin"),
        format!("{home}/.cargo/bin"),
        format!("{home}/.npm-global/bin"),
        format!("{home}/.bun/bin"),
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
    ];
    for dir in extra {
        if !parts.contains(&dir) {
            parts.push(dir);
        }
    }
    std::env::set_var("PATH", parts.join(":"));
}

pub fn build_workers(d: &DiscoveryData) -> Vec<DiscoveredWorker> {
    let mut out = Vec::new();
    let nim_keys = d.keys.get("nim").cloned().unwrap_or_default();

    if !nim_keys.is_empty() {
        out.push(DiscoveredWorker {
            id: "pi".to_string(),
            agent: "pi".to_string(),
            key_name: None,
            provider: "nim".to_string(),
            base_url: d.providers.get("nim").map(|p| p.base_url.clone()),
            model: Some(PI_NIM_MODEL.to_string()),
            write_access: true,
            path: None,
        });
    }

    for agent in &d.agents {
        if agent.id == "pi" {
            // pi reads keys from environment variable names, so store-file slots are not offered to it
            for key in nim_keys.iter().filter(|k| !k.starts_with("store:")) {
                out.push(DiscoveredWorker {
                    id: format!("pi:{key}"),
                    agent: "pi".to_string(),
                    key_name: Some(key.clone()),
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
                key_name: Some(key.clone()),
                provider: prov.clone(),
                base_url: d.providers.get(prov).map(|p| p.base_url.clone()).filter(|u| !u.is_empty()),
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
                key_name: None,
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
            key_name: Some(key.clone()),
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
    fn provider_mapping_covers_named_and_generic_keys() {
        assert_eq!(provider_for_env("NIM_1").as_deref(), Some("nim"));
        assert_eq!(provider_for_env("NVIDIA_API_KEY").as_deref(), Some("nim"));
        assert_eq!(provider_for_env("GOOGLE_STUDIO_API").as_deref(), Some("google"));
        assert_eq!(provider_for_env("GEMINI_API_KEY").as_deref(), Some("google"));
        assert_eq!(provider_for_env("GROQ_API_KEY").as_deref(), Some("groq"));
        assert_eq!(provider_for_env("OPENROUTER_API_KEY").as_deref(), Some("openrouter"));
        assert_eq!(provider_for_env("XAI_API_KEY").as_deref(), Some("xai"));
        assert_eq!(provider_for_env("MOONSHOT_API_KEY").as_deref(), Some("kimi"));
        assert_eq!(provider_for_env("QWEN_API_KEY").as_deref(), Some("qwen"));
        assert_eq!(provider_for_env("FOO_API_KEY").as_deref(), Some("foo"));
        assert_eq!(provider_for_env("NIMBUS_TOKEN"), None);
        assert_eq!(provider_for_env("PATH"), None);
    }
}
