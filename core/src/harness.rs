//! Self-contained built-in mini-harness, host readiness diagnosis, git worktree isolation,
//! and real evidence gate execution.

use crate::config::lingonberry_home;
use crate::discovery::redact_secrets;
use crate::types::{DiscoveryData, KeyCostTier, ReadinessReport};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct BuiltinSkill {
    pub id: &'static str,
    pub title: &'static str,
    pub body: &'static str,
}

pub const MINI_HARNESS_SKILLS: &[BuiltinSkill] = &[
    BuiltinSkill {
        id: "systematic-debugging",
        title: "Systematic Root-Cause Debugging",
        body: "1. Reproduce the failure with exact command/inputs.\n2. Inspect stack/stderr/state before patching.\n3. Propose minimal root-cause fix and verify with a test or build gate.",
    },
    BuiltinSkill {
        id: "architecture-first-build",
        title: "Architecture-First Modular Build",
        body: "1. Check existing interfaces and boundaries before editing.\n2. Keep edits cohesive and modular.\n3. Verify compilation, types, and unit tests before reporting completion.",
    },
    BuiltinSkill {
        id: "secure-review-constitution",
        title: "Security & Secret-Boundary Review",
        body: "1. Check auth boundaries, input validation, path confinement, and secret redaction.\n2. Verify no keys or credentials appear in logs, payloads, or disk configs.\n3. Prefer read-only inspection first; cite exact lines/checks.",
    },
    BuiltinSkill {
        id: "deep-retrieval-brief",
        title: "Source-Grounded Research & Planning",
        body: "1. Cite concrete files/observations only; state unknowns honestly.\n2. Break multi-part prompts into clear non-overlapping subtasks with verification gates.",
    },
];

pub fn mini_harness_skills_dir() -> PathBuf {
    lingonberry_home().join("harness").join("skills")
}

/// Ensures ~/.lingonberry/harness/skills contains the built-in mini-harness so machines without
/// external ~/.agent-skills still get real structured skills, hooks, and verification rules.
pub fn ensure_mini_harness() -> bool {
    let base = mini_harness_skills_dir();
    if fs::create_dir_all(&base).is_err() {
        return false;
    }
    for skill in MINI_HARNESS_SKILLS {
        let dir = base.join(skill.id);
        if fs::create_dir_all(&dir).is_err() {
            return false;
        }
        let file = dir.join("SKILL.md");
        if !file.exists() {
            let content = format!(
                "---\nname: {}\ndescription: {}\n---\n\n{}\n",
                skill.id, skill.title, skill.body
            );
            if fs::write(&file, content).is_err() {
                return false;
            }
        }
    }
    true
}

pub fn infer_cost_tier(provider: &str, _slot: Option<&str>) -> KeyCostTier {
    match provider.trim().to_ascii_lowercase().as_str() {
        "ollama" | "llamacpp" | "llama_cpp" | "local" | "mlx" => KeyCostTier::Local,
        "nim" | "groq" | "google" | "cerebras" | "kilo" | "opencode" => KeyCostTier::FreeTier,
        _ => KeyCostTier::MeteredPaid,
    }
}

pub fn build_readiness_report(
    disc: &DiscoveryData,
    key_tiers: &std::collections::BTreeMap<String, String>,
) -> ReadinessReport {
    let pi_agent = disc
        .agents
        .iter()
        .find(|a| a.id == "pi" || a.id == "pi-rust");
    let pi_installed = pi_agent.and_then(|a| a.path.as_ref()).is_some();
    let pi_path = pi_agent.and_then(|a| a.path.clone());
    let mini_harness_ready = mini_harness_skills_dir().exists() || ensure_mini_harness();

    let mut free_keys_count = 0usize;
    let mut paid_keys_count = 0usize;
    for (prov, slots) in &disc.keys {
        for slot in slots {
            let tier = key_tiers
                .get(slot)
                .or_else(|| key_tiers.get(prov))
                .map(|s| KeyCostTier::from_str(s))
                .or_else(|| {
                    disc.keychain_slots
                        .iter()
                        .find(|m| m.slot == *slot)
                        .map(|m| KeyCostTier::from_str(&m.cost_tier))
                })
                .unwrap_or_else(|| infer_cost_tier(prov, Some(slot)));
            match tier {
                KeyCostTier::Local | KeyCostTier::FreeTier => free_keys_count += 1,
                KeyCostTier::MeteredPaid => paid_keys_count += 1,
            }
        }
    }

    let external_skills_count = disc.library_dirs.len();
    let mut recommendations = Vec::new();
    if !pi_installed {
        recommendations.push(
            "Install `pi` (pi-rust) for fast, low-cost local tool execution instead of single-turn API calls.".into(),
        );
    }
    if external_skills_count == 0 {
        recommendations.push(
            "No external ~/.agent-skills found; Lingonberry's built-in mini-harness is active.".into(),
        );
    }
    if free_keys_count == 0 && paid_keys_count == 0 && disc.agents.is_empty() {
        recommendations.push(
            "Add a free-tier key (NVIDIA NIM, Google AI Studio, Groq) or install a CLI agent in Setup.".into(),
        );
    } else if free_keys_count == 0 && paid_keys_count > 0 {
        recommendations.push(
            "Only metered paid keys detected; unapproved runs and Overnight Mode stay paused until approved.".into(),
        );
    }

    let mode = if pi_installed && (free_keys_count > 0 || paid_keys_count > 0) {
        if external_skills_count > 0 {
            "full".to_string()
        } else {
            "mini_harness".to_string()
        }
    } else {
        "bare_minimum".to_string()
    };

    ReadinessReport {
        pi_installed,
        pi_path,
        mini_harness_ready,
        agents_count: disc.agents.len(),
        free_keys_count,
        paid_keys_count,
        external_skills_count,
        mode,
        recommendations,
    }
}

/// Finds the git repository root for `cwd`, if `cwd` is inside one.
pub fn git_repo_root(cwd: &Path) -> Option<PathBuf> {
    let out = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(cwd)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let root = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if root.is_empty() {
        None
    } else {
        Some(PathBuf::from(root))
    }
}

pub struct WorktreeHandle {
    pub repo_root: PathBuf,
    pub worktree_path: PathBuf,
}

impl WorktreeHandle {
    pub fn create(run_id: &str, base_dir: &Path) -> Option<Self> {
        let repo_root = git_repo_root(base_dir)?;
        let wt_dir = lingonberry_home().join("worktrees").join(format!("wt-{run_id}"));
        if let Some(parent) = wt_dir.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let out = Command::new("git")
            .args([
                "worktree",
                "add",
                "--detach",
                wt_dir.to_str()?,
                "HEAD",
            ])
            .current_dir(&repo_root)
            .output()
            .ok()?;
        if out.status.success() {
            Some(Self {
                repo_root,
                worktree_path: wt_dir,
            })
        } else {
            None
        }
    }

    pub fn diff_summary(&self) -> Option<String> {
        let out = Command::new("git")
            .args(["status", "--short"])
            .current_dir(&self.worktree_path)
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }

    pub fn cleanup(&self) {
        let _ = Command::new("git")
            .args([
                "worktree",
                "remove",
                "--force",
                &self.worktree_path.to_string_lossy(),
            ])
            .current_dir(&self.repo_root)
            .output();
    }
}

#[derive(Debug, Clone)]
pub struct GateOutcome {
    pub status: &'static str, // "passed" | "failed" | "not_run"
    pub passed: Option<bool>,
    pub detail: String,
}

/// Executes a real verification gate command in `cwd`.
/// Never marks `passed` without an actual exit code 0 execution.
pub fn execute_verification_gate(gate_spec: Option<&str>, cwd: &Path) -> GateOutcome {
    let Some(spec) = gate_spec.map(str::trim).filter(|s| !s.is_empty() && *s != "none") else {
        return GateOutcome {
            status: "not_run",
            passed: None,
            detail: "no verification gate requested".into(),
        };
    };

    let (program, args): (&str, Vec<&str>) = match spec {
        "test" => {
            if cwd.join("Cargo.toml").exists() || cwd.join("core/Cargo.toml").exists() {
                if cwd.join("core/Cargo.toml").exists() && !cwd.join("Cargo.toml").exists() {
                    ("cargo", vec!["test", "--manifest-path", "core/Cargo.toml"])
                } else {
                    ("cargo", vec!["test"])
                }
            } else if cwd.join("package.json").exists() {
                ("npm", vec!["test"])
            } else if cwd.join("Package.swift").exists() {
                ("swift", vec!["test"])
            } else {
                return GateOutcome {
                    status: "not_run",
                    passed: None,
                    detail: "no supported test manifest found for gate 'test'".into(),
                };
            }
        }
        "build" => {
            if cwd.join("Cargo.toml").exists() {
                ("cargo", vec!["check"])
            } else if cwd.join("core/Cargo.toml").exists() {
                ("cargo", vec!["check", "--manifest-path", "core/Cargo.toml"])
            } else if cwd.join("Package.swift").exists() {
                ("swift", vec!["build"])
            } else if cwd.join("package.json").exists() {
                ("npm", vec!["run", "build"])
            } else {
                return GateOutcome {
                    status: "not_run",
                    passed: None,
                    detail: "no supported build manifest found for gate 'build'".into(),
                };
            }
        }
        "gitleaks" => {
            if which::which("gitleaks").is_ok() {
                ("gitleaks", vec!["detect", "--source", ".", "--redact", "--no-banner"])
            } else {
                return GateOutcome {
                    status: "not_run",
                    passed: None,
                    detail: "gitleaks binary not installed".into(),
                };
            }
        }
        "git-clean" => ("git", vec!["status", "--porcelain"]),
        other => {
            // Allow safe custom shell command only when explicitly requested by local CLI/owner
            let res = Command::new("sh")
                .args(["-c", other])
                .current_dir(cwd)
                .output();
            return match res {
                Ok(out) => {
                    let rc = out.status.code().unwrap_or(1);
                    let snippet = redact_secrets(
                        &String::from_utf8_lossy(&out.stderr)
                            .chars()
                            .take(300)
                            .collect::<String>(),
                    );
                    if out.status.success() {
                        GateOutcome {
                            status: "passed",
                            passed: Some(true),
                            detail: format!("gate `{other}` exited 0"),
                        }
                    } else {
                        GateOutcome {
                            status: "failed",
                            passed: Some(false),
                            detail: format!("gate `{other}` exited {rc}: {snippet}"),
                        }
                    }
                }
                Err(e) => GateOutcome {
                    status: "failed",
                    passed: Some(false),
                    detail: format!("gate `{other}` failed to spawn: {e}"),
                },
            };
        }
    };

    match Command::new(program).args(&args).current_dir(cwd).output() {
        Ok(out) => {
            let rc = out.status.code().unwrap_or(1);
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            let tail: String = redact_secrets(combined.trim()).chars().take(400).collect();
            if out.status.success() {
                GateOutcome {
                    status: "passed",
                    passed: Some(true),
                    detail: format!("`{} {}` passed (exit 0)", program, args.join(" ")),
                }
            } else {
                GateOutcome {
                    status: "failed",
                    passed: Some(false),
                    detail: format!("`{} {}` exited {rc}: {tail}", program, args.join(" ")),
                }
            }
        }
        Err(e) => GateOutcome {
            status: "failed",
            passed: Some(false),
            detail: format!("gate `{program}` failed to spawn: {e}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_run_gate_never_reports_passed() {
        let out = execute_verification_gate(None, Path::new("."));
        assert_eq!(out.status, "not_run");
        assert_eq!(out.passed, None);
    }

    #[test]
    fn cost_tier_defaults_conservative_for_paid_providers() {
        assert_eq!(infer_cost_tier("nim", None), KeyCostTier::FreeTier);
        assert_eq!(infer_cost_tier("groq", None), KeyCostTier::FreeTier);
        assert_eq!(infer_cost_tier("google", None), KeyCostTier::FreeTier);
        assert_eq!(infer_cost_tier("openai", None), KeyCostTier::MeteredPaid);
        assert_eq!(infer_cost_tier("anthropic", None), KeyCostTier::MeteredPaid);
        assert_eq!(infer_cost_tier("ollama", None), KeyCostTier::Local);
    }
}
