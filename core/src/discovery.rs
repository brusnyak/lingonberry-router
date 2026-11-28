use crate::config::{ensure_api_token, load_config};
use crate::harness::{ensure_mini_harness, infer_cost_tier, mini_harness_skills_dir};
use crate::keychain::{load_keychain_index, resolve_keychain_secret};
use crate::types::{Agent, DiscoveredWorker, DiscoveryData, KeyCostTier, Provider};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const PI_NIM_MODEL: &str = "nvidia/nemotron-3.5-super-vl-120b-a12b";

const AGENT_BINS: &[&str] = &[
    "pi", "pi-rust", "claude", "codex", "opencode", "kilo", "cline", "goose", "omp", "hermes",
    "crush", "qwen",
];

const WRITE_AGENTS: &[&str] = &[
    "pi", "pi-rust", "claude", "codex", "opencode", "kilo", "cline", "goose", "omp",
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
        ("KILO_API_KEY", "kilo"),
        ("OPENCODE_API_KEY", "opencode"),
        ("OLLAMA_API_KEY", "ollama"),
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

pub fn known_provider(id: &str) -> Option<(&'static str, Option<&'static str>, Option<&'static str>)> {
    match id {
        "nim" => Some((
            "https://integrate.api.nvidia.com/v1",
            Some("openai-completions"),
            Some(PI_NIM_MODEL),
        )),
        "openrouter" => Some((
            "https://openrouter.ai/api/v1",
            Some("openai-completions"),
            Some("openrouter/auto"),
        )),
        "groq" => Some((
            "https://api.groq.com/openai/v1",
            Some("openai-completions"),
            Some("llama-3.3-70b-versatile"),
        )),
        "anthropic" => Some((
            "https://api.anthropic.com/v1",
            Some("anthropic"),
            Some("claude-sonnet-4"),
        )),
        "openai" => Some(("https://api.openai.com/v1", Some("openai-completions"), Some("gpt-4.1"))),
        "mistral" => Some((
            "https://api.mistral.ai/v1",
            Some("openai-completions"),
            Some("mistral-large-latest"),
        )),
        "deepseek" => Some((
            "https://api.deepseek.com/v1",
            Some("openai-completions"),
            Some("deepseek-chat"),
        )),
        "together" => Some(("https://api.together.xyz/v1", Some("openai-completions"), None)),
        "fireworks" => Some(("https://api.fireworks.ai/inference/v1", Some("openai-completions"), None)),
        "cerebras" => Some((
            "https://api.cerebras.ai/v1",
            Some("openai-completions"),
            Some("llama-3.3-70b"),
        )),
        "xai" => Some(("https://api.x.ai/v1", Some("openai-completions"), Some("grok-3"))),
        "google" => Some((
            "https://generativelanguage.googleapis.com/v1beta/openai",
            Some("openai-completions"),
            Some("gemini-2.5-flash"),
        )),
        "kimi" => Some((
            "https://api.moonshot.ai/v1",
            Some("openai-completions"),
            Some("kimi-k2-0905-preview"),
        )),
        "qwen" => Some((
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            Some("openai-completions"),
            Some("qwen-plus"),
        )),
        "ollama" => Some((
            "http://127.0.0.1:11434/v1",
            Some("openai-completions"),
            Some("qwen2.5-coder:7b"),
        )),
        "kilo" => Some((
            "https://api.kilo.ai/api/openrouter/v1",
            Some("openai-completions"),
            Some("kilo/free-auto"),
        )),
        "opencode" => Some((
            "https://opencode.ai/zen/v1",
            Some("openai-completions"),
            Some("opencode/big-pickle"),
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

/// Resolves a key value at dispatch time from macOS Keychain, process env, ~/.env,
/// or external read-only agent stores. Key values are NEVER logged or serialized into snapshots.
pub fn resolve_key_value(slot: &str) -> Option<String> {
    if slot.starts_with("kc:") {
        return resolve_keychain_secret(slot);
    }
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
    for meta in load_keychain_index() {
        if let Some(secret) = resolve_keychain_secret(&meta.slot) {
            if secret.len() >= 8 && out.contains(&secret) {
                out = out.replace(&secret, &format!("[REDACTED:{}]", meta.slot));
            }
        }
    }
    out
}

pub fn scan_discovery() -> DiscoveryData {
    let mut agents = Vec::new();
    for bin in AGENT_BINS {
        if let Ok(path) = which::which(bin) {
            let canonical_id = if *bin == "pi-rust" { "pi" } else { *bin };
            if !agents.iter().any(|a: &Agent| a.id == canonical_id) {
                agents.push(Agent {
                    id: canonical_id.to_string(),
                    path: Some(path.to_string_lossy().into_owned()),
                });
            }
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

    // macOS Keychain-managed slots (non-secret index only)
    let keychain_slots = load_keychain_index();
    for kc in &keychain_slots {
        let list = keys.entry(kc.provider.clone()).or_default();
        if !list.contains(&kc.slot) {
            list.push(kc.slot.clone());
        }
    }

    // Keys from other agents' stores become dispatchable read-only as `store:<file>|<name>` slots.
    let store_keys = dirs::home_dir()
        .map(|h| crate::stores::scan_stores(&h))
        .unwrap_or_default();
    for sk in &store_keys {
        if sk.source == ".env" || sk.source == ".config/lingonberry/env" {
            continue;
        }
        // Skip our own proxy entries inside ~/.pi/agent/
        if sk.source.starts_with(".pi/agent/") && sk.name.contains("lingonberry") {
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
        if let Some(kc) = keychain_slots
            .iter()
            .find(|m| m.provider == *prov && m.base_url.is_some())
        {
            providers.insert(
                prov.clone(),
                Provider {
                    id: prov.clone(),
                    base_url: kc.base_url.clone().unwrap_or_default(),
                    style: Some("openai-completions".into()),
                },
            );
        } else if let Some((url, style, _)) = known_provider(prov) {
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
    let _ = ensure_mini_harness();
    let mut library_dirs: Vec<String> = [
        home.join(".claude").join("skills"),
        home.join(".agent-skills"),
        home.join(".codex").join("skills"),
        home.join(".config").join("opencode").join("skills"),
    ]
    .into_iter()
    .filter(|p| p.exists())
    .map(|p| p.to_string_lossy().into_owned())
    .collect();
    let mini_dir = mini_harness_skills_dir();
    if mini_dir.exists() {
        let s = mini_dir.to_string_lossy().into_owned();
        if !library_dirs.contains(&s) {
            library_dirs.push(s);
        }
    }

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
        keychain_slots,
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
    let cfg_tiers = load_config().map(|c| c.key_tiers).unwrap_or_default();

    // `pi` workers: one per provider with available key slots. Keys stay in Keychain / env
    // and are injected dynamically via Lingonberry's local proxy or LeaseGuard.
    for (prov, keys) in &d.keys {
        if keys.is_empty() {
            continue;
        }
        let custom_model = d
            .keychain_slots
            .iter()
            .find(|m| m.provider == *prov && m.model.is_some())
            .and_then(|m| m.model.clone());
        let default_model =
            custom_model.or_else(|| known_provider(prov).and_then(|(_, _, m)| m.map(str::to_string)));
        let pi_agent = d.agents.iter().find(|a| a.id == "pi");
        let tier = cfg_tiers
            .get(prov)
            .map(|s| KeyCostTier::from_str(s))
            .or_else(|| {
                d.keychain_slots
                    .iter()
                    .find(|m| m.provider == *prov)
                    .map(|m| KeyCostTier::from_str(&m.cost_tier))
            })
            .unwrap_or_else(|| infer_cost_tier(prov, None));
        out.push(DiscoveredWorker {
            id: format!("pi:{prov}"),
            agent: "pi".to_string(),
            key_name: None,
            provider: prov.clone(),
            base_url: d
                .providers
                .get(prov)
                .map(|p| p.base_url.clone())
                .filter(|u| !u.is_empty()),
            model: default_model,
            write_access: true,
            path: pi_agent.and_then(|a| a.path.clone()),
            cost_tier: tier,
        });
    }

    // CLI agent workers (each uses its own local login/OAuth, never Lingonberry owner keys)
    for agent in &d.agents {
        if agent.id == "pi" || agent.id == "nim-chat" {
            continue;
        }
        out.push(DiscoveredWorker {
            id: agent.id.clone(),
            agent: agent.id.clone(),
            key_name: None,
            provider: agent.id.clone(),
            base_url: None,
            model: None,
            write_access: WRITE_AGENTS.contains(&agent.id.as_str()),
            path: agent.path.clone(),
            cost_tier: KeyCostTier::Local,
        });
    }

    out
}

/// Configures `pi-rust` safely: instead of writing raw provider API keys into `~/.pi/agent/auth.json`
/// and `models.json`, points `pi-rust` at Lingonberry's authenticated local loopback proxy
/// (`http://127.0.0.1:{port}/v1`) using the ephemeral `0600` local bearer token, and keeps
/// provider IDs consistent (`nim`, `groq`, `google`, `openrouter`, etc.).
pub fn configure_pi_rust(home: &Path, disc: &DiscoveryData) -> Result<(), Box<dyn std::error::Error>> {
    let pi_agent_dir = home.join(".pi").join("agent");
    std::fs::create_dir_all(&pi_agent_dir)?;

    let cfg = load_config().unwrap_or_default();
    let local_token = ensure_api_token()?;
    let proxy_base = format!("http://127.0.0.1:{}/v1", cfg.port);

    let mut auth: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    let mut providers: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();

    for (prov, keys) in &disc.keys {
        if keys.is_empty() {
            continue;
        }
        let default_model = disc
            .keychain_slots
            .iter()
            .find(|m| m.provider == *prov && m.model.is_some())
            .and_then(|m| m.model.clone())
            .or_else(|| known_provider(prov).and_then(|(_, _, m)| m.map(str::to_string)));
        let Some(model_id) = default_model else {
            continue;
        };

        auth.insert(
            prov.clone(),
            serde_json::json!({
                "type": "api_key",
                "key": local_token,
            }),
        );
        providers.insert(
            prov.clone(),
            serde_json::json!({
                "baseUrl": proxy_base,
                "api": "openai-completions",
                "apiKey": local_token,
                "models": [{
                    "id": model_id,
                    "name": model_id,
                }],
            }),
        );
    }

    let auth_path = pi_agent_dir.join("auth.json");
    let models_path = pi_agent_dir.join("models.json");
    std::fs::write(&auth_path, serde_json::to_string_pretty(&serde_json::Value::Object(auth))?)?;
    std::fs::write(
        &models_path,
        serde_json::to_string_pretty(&serde_json::json!({
            "providers": serde_json::Value::Object(providers)
        }))?,
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&auth_path, std::fs::Permissions::from_mode(0o600));
        let _ = std::fs::set_permissions(&models_path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Tests an API key against `{base_url}/models` and returns discovered model IDs (truncated).
pub async fn probe_provider_models(
    base_url: &str,
    api_key: &str,
) -> anyhow::Result<Vec<String>> {
    let endpoint = format!("{}/models", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent("lingonberry-router/0.1")
        .build()?;
    let resp = client.get(&endpoint).bearer_auth(api_key).send().await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!(
            "HTTP {}: {}",
            status.as_u16(),
            redact_secrets(&body.chars().take(200).collect::<String>())
        );
    }
    let json: serde_json::Value = resp.json().await?;
    let models = json["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item["id"].as_str().map(str::to_string))
                .take(25)
                .collect()
        })
        .unwrap_or_default();
    Ok(models)
}

/// Determines the safest consented command to install `pi` (`pi_agent_rust`) on this host.
pub fn recommended_pi_install_cmd() -> Option<(&'static str, Vec<&'static str>)> {
    if which::which("cargo").is_ok() {
        Some((
            "cargo",
            vec![
                "install",
                "--git",
                "https://github.com/Dicklesworthstone/pi_agent_rust",
                "--locked",
            ],
        ))
    } else if which::which("brew").is_ok() {
        Some(("brew", vec!["install", "pi-coding-agent"]))
    } else {
        None
    }
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

    #[test]
    fn configure_pi_rust_never_writes_raw_provider_secrets() {
        let dir = std::env::temp_dir().join(format!("lbr-pi-cfg-{}", uuid::Uuid::new_v4()));
        let lb_dir = dir.join(".lingonberry");
        fs::create_dir_all(&lb_dir).unwrap();
        std::env::set_var("LINGONBERRY_HOME", &lb_dir);
        std::env::set_var("NIM_1", "nvapi-SUPER-SECRET-SHOULD-NOT-LEAK");

        let mut keys = BTreeMap::new();
        keys.insert("nim".into(), vec!["NIM_1".into()]);
        let disc = DiscoveryData {
            agents: vec![],
            keys,
            providers: BTreeMap::new(),
            library_dirs: vec![],
            ssh_hosts: vec![],
            git_projects: vec![],
            browsers: vec![],
            stores: vec![],
            keychain_slots: vec![],
        };
        configure_pi_rust(&dir, &disc).unwrap();
        let auth_text = fs::read_to_string(dir.join(".pi/agent/auth.json")).unwrap();
        let models_text = fs::read_to_string(dir.join(".pi/agent/models.json")).unwrap();
        assert!(!auth_text.contains("nvapi-SUPER-SECRET"));
        assert!(!models_text.contains("nvapi-SUPER-SECRET"));
        assert!(models_text.contains("127.0.0.1:8799/v1"));
        assert!(models_text.contains("\"nim\""));

        std::env::remove_var("LINGONBERRY_HOME");
        std::env::remove_var("NIM_1");
        let _ = fs::remove_dir_all(&dir);
    }
}
