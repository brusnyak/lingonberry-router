//! Finds API key NAMES in other agents' credential stores. Values are read, matched, and dropped
//! during the scan. Only `resolve_store_value` returns a value, and only at dispatch time.
//! Read-only. Files over 1 MB are skipped. Store paths come from ~/.lingonberry/store-paths.json
//! when it exists, else DEFAULT_STORE_PATHS.

use crate::discovery::provider_for_env;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_STORE_PATHS: &[&str] = &[
    ".local/share/opencode/auth.json",
    ".config/opencode/opencode.json",
    ".pi/agent/auth.json",
    ".pi/agent/models.json",
    ".codex/auth.json",
    ".config/kilo/config.json",
    ".local/share/kilo/auth.json",
    ".qwen/settings.json",
    ".gemini/settings.json",
    ".jcode/config.json",
    ".omp/config.yml",
    ".aider.conf.yml",
    ".continue/config.json",
    ".config/crush/crush.json",
    ".env",
    ".config/lingonberry/env",
];

const MAX_BYTES: u64 = 1_000_000;
/// Object keys that group credentials without naming a provider.
const GENERIC_PARENTS: &[&str] = &[
    "providers", "env", "auth", "models", "provider", "keys", "options", "apiKeys",
];
/// Object keys holding OAuth session tokens (ChatGPT login etc.). Not API keys: never dispatched.
const OAUTH_PARENTS: &[&str] = &["tokens", "oauth", "session"];

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct StoreKey {
    pub provider: String,
    pub name: String,
    pub source: String,
}

/// Maps names that agents use for the same provider onto one id.
pub fn normalize_provider(p: &str) -> String {
    match p {
        "nvidia" | "nvidia_nim" => "nim",
        "moonshot" | "moonshotai" => "kimi",
        "dashscope" | "alibaba" | "bailian" => "qwen",
        "gemini" | "google_ai" | "google_ai_studio" | "googleai" => "google",
        "grok" => "xai",
        other => other,
    }
    .to_string()
}

fn is_key_field(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "key"
        || n.contains("apikey")
        || n.contains("api_key")
        || n.ends_with("token")
        || n.ends_with("secret")
}

fn provider_from_parent(parent: &str) -> Option<String> {
    if GENERIC_PARENTS.iter().any(|g| g.eq_ignore_ascii_case(parent)) {
        return None;
    }
    Some(normalize_provider(
        &parent.to_ascii_lowercase().replace(['-', ' ', '.'], "_"),
    ))
}

fn walk_json(
    v: &serde_json::Value,
    path: &str,
    parent: Option<&str>,
    source: &str,
    out: &mut Vec<StoreKey>,
) {
    match v {
        serde_json::Value::Object(map) => {
            for (k, child) in map {
                let child_path = if path.is_empty() {
                    k.clone()
                } else {
                    format!("{path}.{k}")
                };
                if parent.is_some_and(|p| OAUTH_PARENTS.iter().any(|o| o.eq_ignore_ascii_case(p))) {
                    continue; // OAuth session tokens are not API keys
                }
                match child {
                    serde_json::Value::String(s) if is_key_field(k) && !s.trim().is_empty() => {
                        // the value is not kept: only the name and the provider are recorded
                        let provider = parent
                            .and_then(provider_from_parent)
                            .or_else(|| provider_for_env(k))
                            .unwrap_or_else(|| "unknown".into());
                        out.push(StoreKey {
                            provider,
                            name: child_path,
                            source: source.into(),
                        });
                    }
                    serde_json::Value::String(s) if !s.trim().is_empty() => {
                        // env-style entries such as {"env": {"OPENAI_API_KEY": "..."}}
                        if let Some(p) = provider_for_env(k) {
                            out.push(StoreKey {
                                provider: p,
                                name: child_path,
                                source: source.into(),
                            });
                        }
                    }
                    serde_json::Value::Object(_) => {
                        walk_json(child, &child_path, Some(k), source, out)
                    }
                    _ => {}
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                walk_json(item, path, parent, source, out);
            }
        }
        _ => {}
    }
}

fn scan_text(text: &str, source: &str, out: &mut Vec<StoreKey>) {
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=').or_else(|| line.split_once(':')) else {
            continue;
        };
        let name = k.trim().trim_start_matches("export ").trim().trim_matches('"');
        let has_value = !v.trim().trim_matches('"').trim_matches('\'').is_empty();
        if !has_value {
            continue;
        }
        if let Some(provider) = provider_for_env(name) {
            out.push(StoreKey {
                provider,
                name: name.into(),
                source: source.into(),
            });
        } else if is_key_field(name) {
            out.push(StoreKey {
                provider: "unknown".into(),
                name: name.into(),
                source: source.into(),
            });
        }
    }
}

pub fn store_paths(home: &Path) -> Vec<PathBuf> {
    let cfg = home.join(".lingonberry").join("store-paths.json");
    let custom: Option<Vec<String>> = fs::read_to_string(&cfg)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok());
    match custom {
        Some(list) => list.iter().map(|p| home.join(p)).collect(),
        None => DEFAULT_STORE_PATHS.iter().map(|p| home.join(p)).collect(),
    }
}

/// Scans every configured store under `home`. Returns names and providers only.
pub fn scan_stores(home: &Path) -> Vec<StoreKey> {
    let mut out = Vec::new();
    for path in store_paths(home) {
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        if !meta.is_file() || meta.len() > MAX_BYTES {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let source = path
            .strip_prefix(home)
            .unwrap_or(&path)
            .to_string_lossy()
            .into_owned();
        let is_json = path.extension().map(|e| e == "json").unwrap_or(false);
        if is_json {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                walk_json(&v, "", None, &source, &mut out);
                continue;
            }
        }
        scan_text(&text, &source, &mut out);
    }
    out.sort();
    out.dedup();
    out
}

/// Reads one value at dispatch time. `source` is relative to home, `name` is the dotted JSON path
/// or the env-style key. Callers must not log or serialize the result.
pub fn resolve_store_value(home: &Path, source: &str, name: &str) -> Option<String> {
    let text = fs::read_to_string(home.join(source)).ok()?;
    if source.ends_with(".json") {
        let v: serde_json::Value = serde_json::from_str(&text).ok()?;
        let mut cur = &v;
        for part in name.split('.') {
            cur = cur.get(part)?;
        }
        return cur.as_str().filter(|s| !s.trim().is_empty()).map(str::to_string);
    }
    for raw in text.lines() {
        let line = raw.trim();
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim().trim_start_matches("export ").trim();
            let val = v.trim().trim_matches('"').trim_matches('\'');
            if key == name && !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lb-stores-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn finds_names_and_providers_never_values() {
        let home = tmp("names");
        fs::create_dir_all(home.join(".local/share/opencode")).unwrap();
        fs::write(
            home.join(".local/share/opencode/auth.json"),
            r#"{"openrouter":{"type":"api","key":"SECRET-VALUE-OR-123456"},"kimi":{"apiKey":"SECRET-VALUE-KIMI-999"},"nvidia":{"key":"SECRET-VALUE-NV-1"},"tokens":{"access_token":"SECRET-VALUE-OAUTH-5"}}"#,
        )
        .unwrap();
        fs::write(
            home.join(".env"),
            "XAI_API_KEY=SECRET-VALUE-XAI-777\nNIM_1=SECRET-VALUE-NIM-42\nEMPTY_API_KEY=\n",
        )
        .unwrap();
        let keys = scan_stores(&home);
        let dump = format!("{keys:?}");
        assert!(!dump.contains("SECRET-VALUE"), "value leaked: {dump}");
        assert!(keys.iter().any(|k| k.provider == "xai" && k.name == "XAI_API_KEY"));
        assert!(keys.iter().any(|k| k.provider == "nim" && k.name == "NIM_1"));
        assert!(keys.iter().any(|k| k.provider == "kimi"));
        assert!(keys.iter().any(|k| k.provider == "openrouter"));
        assert!(keys.iter().any(|k| k.provider == "nim" && k.name == "nvidia.key"));
        assert!(!keys.iter().any(|k| k.name.starts_with("tokens")), "oauth leaked");
        assert!(!keys.iter().any(|k| k.name == "EMPTY_API_KEY"));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn resolves_one_value_on_demand() {
        let home = tmp("resolve");
        fs::create_dir_all(home.join(".local/share/opencode")).unwrap();
        fs::write(
            home.join(".local/share/opencode/auth.json"),
            r#"{"openrouter":{"key":"RESOLVED-OR-VALUE"}}"#,
        )
        .unwrap();
        assert_eq!(
            resolve_store_value(&home, ".local/share/opencode/auth.json", "openrouter.key").as_deref(),
            Some("RESOLVED-OR-VALUE")
        );
        assert_eq!(resolve_store_value(&home, ".local/share/opencode/auth.json", "missing.key"), None);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn provider_aliases_collapse() {
        assert_eq!(normalize_provider("nvidia"), "nim");
        assert_eq!(normalize_provider("moonshot"), "kimi");
        assert_eq!(normalize_provider("gemini"), "google");
        assert_eq!(normalize_provider("groq"), "groq");
    }
}
