//! OpenClaw / Hermes-inspired Zero-Hosting Channel Gateway:
//! Outbound-only adapters (Telegram long-polling, Slack Socket Mode, Discord Gateway, MCP chat continuity)
//! sharing one composite-session SQLite store and human-readable `~/.lingonberry/memory/MEMORY.md`.

use crate::config::lingonberry_home;
use crate::discovery::redact_secrets;
use crate::keychain::load_keychain_index;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelBridgeStatus {
    pub id: String,
    pub label: String,
    pub transport: String,
    pub enabled: bool,
    pub connected: bool,
    pub session_key_prefix: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayMemorySummary {
    pub memory_path: String,
    pub steering_dir: String,
    pub entries_count: usize,
    pub channels: Vec<ChannelBridgeStatus>,
}

pub fn memory_dir() -> PathBuf {
    lingonberry_home().join("memory")
}

pub fn ensure_gateway_memory() -> PathBuf {
    let dir = memory_dir();
    let _ = fs::create_dir_all(&dir);
    let _ = fs::create_dir_all(lingonberry_home().join("steering"));
    let mem_file = dir.join("MEMORY.md");
    if !mem_file.exists() {
        let _ = fs::write(
            &mem_file,
            "# Lingonberry Shared Cross-Channel Memory\n\n- Spec-locked overnight execution active: unapproved edits blocked.\n- Priority routing: local pi-rust & free pools (Kilo/OpenCode/NIM/Groq) before subscription escalation.\n",
        );
    }
    let user_file = dir.join("USER.md");
    if !user_file.exists() {
        let _ = fs::write(
            &user_file,
            "# Owner Preferences\n\n- Preferred surfaces: macOS Menu Bar + Claude/Codex MCP + outbound messaging bridges.\n",
        );
    }
    mem_file
}

/// Normalizes external chat/thread identities onto Lingonberry's single cross-surface session key.
pub fn normalize_channel_session_key(channel: &str, peer_id: &str, thread_id: Option<&str>) -> String {
    let ch = channel.trim().to_ascii_lowercase();
    let peer = peer_id.trim();
    match thread_id.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => format!("{ch}:{peer}:{t}"),
        None => format!("{ch}:{peer}"),
    }
}

pub fn append_shared_memory_note(session_key: &str, note: &str) {
    let file = ensure_gateway_memory();
    let sanitized = redact_secrets(note.trim());
    if sanitized.is_empty() {
        return;
    }
    if let Ok(mut existing) = fs::read_to_string(&file) {
        existing.push_str(&format!("\n- [{session_key}] {sanitized}"));
        let _ = fs::write(file, existing);
    }
}

pub fn build_channel_gateway_status() -> GatewayMemorySummary {
    let mem_file = ensure_gateway_memory();
    let entries_count = fs::read_to_string(&mem_file)
        .map(|s| s.lines().filter(|l| l.trim_start().starts_with("- ")).count())
        .unwrap_or(0);

    let kc = load_keychain_index();
    let has_tg = kc.iter().any(|k| k.provider == "telegram" || k.slot.contains("telegram"))
        || std::env::var("LINGONBERRY_TELEGRAM_TOKEN").map(|v| !v.is_empty()).unwrap_or(false);
    let has_slack = kc.iter().any(|k| k.provider == "slack" || k.slot.contains("slack"))
        || std::env::var("LINGONBERRY_SLACK_APP_TOKEN").map(|v| !v.is_empty()).unwrap_or(false);
    let has_discord = kc.iter().any(|k| k.provider == "discord" || k.slot.contains("discord"))
        || std::env::var("LINGONBERRY_DISCORD_TOKEN").map(|v| !v.is_empty()).unwrap_or(false);

    let channels = vec![
        ChannelBridgeStatus {
            id: "menubar".into(),
            label: "macOS Menu Bar".into(),
            transport: "Loopback Bearer HTTP".into(),
            enabled: true,
            connected: true,
            session_key_prefix: "menubar:local".into(),
            description: "5-second glance, kill switches, Keychain Vault, and Setup controls.".into(),
        },
        ChannelBridgeStatus {
            id: "mcp".into(),
            label: "Claude / Codex Chat (MCP)".into(),
            transport: "Stdio JSON-RPC / Local Bridge".into(),
            enabled: true,
            connected: true,
            session_key_prefix: "mcp:<session>".into(),
            description: "Run and approve Lingonberry specs inside everyday Claude or Codex sessions with shared memory.".into(),
        },
        ChannelBridgeStatus {
            id: "telegram".into(),
            label: "Telegram Bot".into(),
            transport: "Outbound Long-Poll (Zero Port Forward)".into(),
            enabled: has_tg,
            connected: has_tg,
            session_key_prefix: "telegram:<chat_id>".into(),
            description: "Mobile inline approvals, gate alerts, and morning spec digests without public hosting.".into(),
        },
        ChannelBridgeStatus {
            id: "slack".into(),
            label: "Slack Socket Mode".into(),
            transport: "Outbound WebSocket".into(),
            enabled: has_slack,
            connected: has_slack,
            session_key_prefix: "slack:<thread_ts>".into(),
            description: "Thread-scoped spec dispatch and swarm status replies inside team channels.".into(),
        },
        ChannelBridgeStatus {
            id: "discord".into(),
            label: "Discord Gateway".into(),
            transport: "Outbound WebSocket".into(),
            enabled: has_discord,
            connected: has_discord,
            session_key_prefix: "discord:<channel_id>".into(),
            description: "Channel-bound command routing and spec approval threads.".into(),
        },
    ];

    GatewayMemorySummary {
        memory_path: mem_file.to_string_lossy().into_owned(),
        steering_dir: lingonberry_home().join("steering").to_string_lossy().into_owned(),
        entries_count,
        channels,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_keys_normalize_across_channels() {
        assert_eq!(
            normalize_channel_session_key("Telegram", "99210", None),
            "telegram:99210"
        );
        assert_eq!(
            normalize_channel_session_key("slack", "C123", Some("1700.1")),
            "slack:C123:1700.1"
        );
    }
}
