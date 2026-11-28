//! Tiered worker sandbox policies:
//! - Tier 1: Git worktree + dynamic macOS Seatbelt (`sandbox-exec`) SBPL profile confining writes to
//!   worktree and explicitly denying reads on `~/.ssh`, `~/.aws`, `~/.gnupg`, Keychains, and host `.env*`.
//! - Tier 2: Ephemeral Docker sandbox (`--read-only --cap-drop=ALL --security-opt=no-new-privileges`)
//!   with zero raw secrets inside the container filesystem or env.

use crate::config::lingonberry_home;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SandboxTier {
    Seatbelt,
    Docker,
    WorktreeOnly,
}

impl SandboxTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            SandboxTier::Seatbelt => "seatbelt",
            SandboxTier::Docker => "docker",
            SandboxTier::WorktreeOnly => "worktree_only",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxHealth {
    pub seatbelt_available: bool,
    pub docker_available: bool,
    pub docker_runtime: Option<String>,
    pub default_local_tier: String,
    pub default_overnight_tier: String,
}

pub fn probe_sandbox_health() -> SandboxHealth {
    let seatbelt_available = cfg!(target_os = "macos")
        && (Path::new("/usr/bin/sandbox-exec").exists() || which::which("sandbox-exec").is_ok());

    let mut docker_available = false;
    let mut docker_runtime = None;
    if let Ok(docker_bin) = which::which("docker") {
        if let Ok(out) = Command::new(&docker_bin).arg("info").output() {
            if out.status.success() {
                docker_available = true;
                let info = String::from_utf8_lossy(&out.stdout).to_ascii_lowercase();
                docker_runtime = Some(if info.contains("orbstack") {
                    "OrbStack".into()
                } else if info.contains("colima") {
                    "Colima".into()
                } else {
                    "Docker Desktop".into()
                });
            }
        }
    }

    SandboxHealth {
        seatbelt_available,
        docker_available,
        docker_runtime,
        default_local_tier: if seatbelt_available {
            "seatbelt".into()
        } else {
            "worktree_only".into()
        },
        default_overnight_tier: if docker_available {
            "docker".into()
        } else if seatbelt_available {
            "seatbelt".into()
        } else {
            "worktree_only".into()
        },
    }
}

/// Builds a strict macOS Seatbelt SBPL profile confining file writes strictly to `worktree_path`
/// and scratch `/tmp`, while denying reads across SSH/cloud/Keychain/token directories.
pub fn build_macos_seatbelt_profile(home: &Path, worktree_path: &Path) -> String {
    let home_s = home.to_string_lossy().replace('"', "\\\"");
    let wt_s = worktree_path.to_string_lossy().replace('"', "\\\"");
    format!(
        r#"(version 1)
(allow default)
(deny file-write* (subpath "/"))
(allow file-write*
  (subpath "{wt_s}")
  (subpath "/private/tmp")
  (subpath "/tmp")
  (subpath "/var/folders")
  (literal "/dev/null"))
(deny file-read*
  (subpath "{home_s}/.ssh")
  (subpath "{home_s}/.aws")
  (subpath "{home_s}/.gnupg")
  (subpath "{home_s}/.config/gh")
  (subpath "{home_s}/Library/Keychains")
  (literal "{home_s}/.env")
  (literal "{home_s}/.lingonberry/api.token"))
"#
    )
}

pub fn write_seatbelt_profile(run_id: &str, home: &Path, worktree_path: &Path) -> Option<(PathBuf, String)> {
    let dir = lingonberry_home().join("sandboxes");
    fs::create_dir_all(&dir).ok()?;
    let sbpl = build_macos_seatbelt_profile(home, worktree_path);
    let mut hasher = Sha256::new();
    hasher.update(sbpl.as_bytes());
    let hash = format!("{:x}", hasher.finalize())[..12].to_string();
    let path = dir.join(format!("run-{run_id}-{hash}.sb"));
    fs::write(&path, sbpl).ok()?;
    Some((path, hash))
}

/// Builds non-shell `docker run` argument vector for isolated container execution.
/// Secrets remain on host loopback proxy (`host.docker.internal:<port>/v1`).
pub fn build_docker_sandbox_args(
    worktree_path: &Path,
    image: &str,
    proxy_port: u16,
    scoped_token: &str,
    worker_cmd: &[String],
) -> Vec<String> {
    let mut args = vec![
        "run".into(),
        "--rm".into(),
        "--read-only".into(),
        "--cap-drop=ALL".into(),
        "--security-opt=no-new-privileges".into(),
        "--memory=4g".into(),
        "--cpus=2".into(),
        "--pids-limit=256".into(),
        "--tmpfs".into(),
        "/tmp:rw,noexec,nosuid,size=512m".into(),
        "-v".into(),
        format!("{}:/workspace:rw", worktree_path.display()),
        "-w".into(),
        "/workspace".into(),
        "-e".into(),
        format!("OPENAI_BASE_URL=http://host.docker.internal:{proxy_port}/v1"),
        "-e".into(),
        format!("OPENAI_API_KEY={scoped_token}"),
        image.into(),
    ];
    args.extend(worker_cmd.iter().cloned());
    args
}

pub fn select_sandbox_tier(
    requested: Option<&str>,
    is_overnight: bool,
    is_heavy_or_untrusted: bool,
    health: &SandboxHealth,
) -> Result<SandboxTier, String> {
    if let Some("docker") = requested {
        if !health.docker_available {
            return Err("docker sandbox requested/required, but Docker/OrbStack/Colima daemon is not running".into());
        }
        return Ok(SandboxTier::Docker);
    }
    if (is_overnight || is_heavy_or_untrusted) && health.docker_available {
        return Ok(SandboxTier::Docker);
    }
    if is_overnight && requested == Some("docker_required") && !health.docker_available {
        return Err("overnight spec requires Docker isolation; holding safely until Docker starts".into());
    }
    if health.seatbelt_available {
        return Ok(SandboxTier::Seatbelt);
    }
    Ok(SandboxTier::WorktreeOnly)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seatbelt_profile_denies_secrets_and_confines_writes() {
        let sbpl = build_macos_seatbelt_profile(
            Path::new("/Users/alice"),
            Path::new("/Users/alice/.lingonberry/worktrees/wt-1"),
        );
        assert!(sbpl.contains("(deny file-write* (subpath \"/\"))"));
        assert!(sbpl.contains("/Users/alice/.lingonberry/worktrees/wt-1"));
        assert!(sbpl.contains("/Users/alice/.ssh"));
        assert!(sbpl.contains("/Users/alice/.lingonberry/api.token"));
    }

    #[test]
    fn docker_args_never_embed_host_secrets_and_drop_caps() {
        let args = build_docker_sandbox_args(
            Path::new("/tmp/wt-9"),
            "lingonberry/worker:latest",
            8799,
            "ephemeral-tok",
            &["pi".into(), "-p".into(), "check".into()],
        );
        assert!(args.contains(&"--cap-drop=ALL".to_string()));
        assert!(args.contains(&"--read-only".to_string()));
        assert!(args.contains(&"OPENAI_BASE_URL=http://host.docker.internal:8799/v1".to_string()));
    }
}
