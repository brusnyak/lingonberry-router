//! Encrypted key storage via macOS Keychain (`security` CLI) with a non-secret metadata index
//! in `~/.lingonberry/keychain-slots.json`. Raw secrets are never written into index JSON,
//! snapshots, logs, or external agent configs.

use crate::config::lingonberry_home;
use crate::types::KeychainSlotMeta;
use anyhow::{bail, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const SERVICE_NAME: &str = "lingonberry-router";

pub fn keychain_index_path(home_dir: &Path) -> PathBuf {
    home_dir.join("keychain-slots.json")
}

pub fn load_keychain_index() -> Vec<KeychainSlotMeta> {
    let path = keychain_index_path(&lingonberry_home());
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_keychain_index(slots: &[KeychainSlotMeta]) -> Result<()> {
    let lb_home = lingonberry_home();
    fs::create_dir_all(&lb_home)?;
    let path = keychain_index_path(&lb_home);
    let json = serde_json::to_string_pretty(slots)?;
    fs::write(&path, format!("{json}\n"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Normalizes a slot identifier for macOS Keychain storage (`kc:<provider>:<slug>`).
pub fn make_slot_name(provider: &str, label: &str) -> String {
    let prov = provider
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>();
    let slug = label
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    let suffix = if slug.is_empty() {
        "default".to_string()
    } else {
        slug
    };
    format!("kc:{prov}:{suffix}")
}

/// Stores an API key in macOS Keychain (on macOS) or falls back to an owner-only `0600`
/// secrets file inside `$LINGONBERRY_HOME` on headless Linux/test environments.
pub fn store_secret(slot: &str, value: &str, meta: KeychainSlotMeta) -> Result<()> {
    let secret = value.trim();
    if secret.is_empty() {
        bail!("secret value cannot be empty");
    }

    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("security")
            .args(["delete-generic-password", "-s", SERVICE_NAME, "-a", slot])
            .output();
        let out = Command::new("security")
            .args([
                "add-generic-password",
                "-U",
                "-s",
                SERVICE_NAME,
                "-a",
                slot,
                "-w",
                secret,
            ])
            .output()
            .context("failed to invoke macOS security CLI")?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            bail!("Keychain store failed: {}", err.trim());
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let lb_home = lingonberry_home();
        fs::create_dir_all(&lb_home)?;
        let fallback_path = lb_home.join("secrets.env");
        let existing = fs::read_to_string(&fallback_path).unwrap_or_default();
        let mut lines: Vec<String> = existing
            .lines()
            .filter(|l| !l.starts_with(&format!("{slot}=")))
            .map(str::to_string)
            .collect();
        lines.push(format!("{slot}={secret}"));
        fs::write(&fallback_path, format!("{}\n", lines.join("\n")))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&fallback_path, fs::Permissions::from_mode(0o600));
        }
    }

    let mut index = load_keychain_index();
    index.retain(|m| m.slot != meta.slot);
    index.push(meta);
    index.sort_by(|a, b| a.slot.cmp(&b.slot));
    save_keychain_index(&index)?;
    Ok(())
}

pub fn resolve_keychain_secret(slot: &str) -> Option<String> {
    if !slot.starts_with("kc:") {
        return None;
    }

    #[cfg(target_os = "macos")]
    {
        let out = Command::new("security")
            .args(["find-generic-password", "-s", SERVICE_NAME, "-a", slot, "-w"])
            .output()
            .ok()?;
        if out.status.success() {
            let val = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !val.is_empty() {
                return Some(val);
            }
        }
        return None;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let fallback_path = lingonberry_home().join("secrets.env");
        let text = fs::read_to_string(fallback_path).ok()?;
        for line in text.lines() {
            if let Some((k, v)) = line.split_once('=') {
                if k.trim() == slot && !v.trim().is_empty() {
                    return Some(v.trim().to_string());
                }
            }
        }
        None
    }
}

pub fn delete_secret(slot: &str) -> Result<bool> {
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("security")
            .args(["delete-generic-password", "-s", SERVICE_NAME, "-a", slot])
            .output();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let fallback_path = lingonberry_home().join("secrets.env");
        if let Ok(existing) = fs::read_to_string(&fallback_path) {
            let kept: Vec<&str> = existing
                .lines()
                .filter(|l| !l.starts_with(&format!("{slot}=")))
                .collect();
            let _ = fs::write(&fallback_path, format!("{}\n", kept.join("\n")));
        }
    }

    let mut index = load_keychain_index();
    let before = index.len();
    index.retain(|m| m.slot != slot);
    let removed = index.len() < before;
    save_keychain_index(&index)?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_names_normalize_cleanly() {
        assert_eq!(make_slot_name("NIM", "Free Key 1"), "kc:nim:free_key_1");
        assert_eq!(make_slot_name("groq", ""), "kc:groq:default");
    }
}
