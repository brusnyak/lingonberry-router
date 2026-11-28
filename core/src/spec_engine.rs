//! Kiro-style 3-artifact Spec Engine (`Requirements -> Design -> Tasks DAG`), Steering globs,
//! immutable SHA-256 signature verification, and zero-token deterministic git-diff scope guard.

use crate::config::lingonberry_home;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::process::Command;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecWaveTask {
    pub task_id: String,
    pub wave: u16,
    pub title: String,
    pub path_globs: Vec<String>,
    pub gate_cmd: String,
    pub status: String, // pending | running | done | failed | blocked
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KiroSpecManifest {
    pub spec_id: String,
    pub title: String,
    pub goal: String,
    pub repo_root: String,
    pub requirements_md: String,
    pub design_md: String,
    pub tasks_dag: Vec<SpecWaveTask>,
    pub allowed_path_globs: Vec<String>,
    pub forbidden_actions: Vec<String>,
    pub gate_cmd: String,
    pub sandbox_tier: String, // "seatbelt" | "docker"
    pub max_budget_usd: f64,
    pub sha256_digest: String,
    pub approved_at: Option<String>,
    pub status: String, // draft | approved | running | completed | blocked
    pub created_at: String,
}

impl KiroSpecManifest {
    pub fn canonical_payload(&self) -> String {
        let tasks_s = self
            .tasks_dag
            .iter()
            .map(|t| format!("{}:{}:{}", t.task_id, t.wave, t.path_globs.join(",")))
            .collect::<Vec<_>>()
            .join("|");
        format!(
            "{}|{}|{}|{}|{}|{}|{}|{}|{}|{:.4}",
            self.title.trim(),
            self.goal.trim(),
            self.repo_root.trim(),
            self.requirements_md.trim(),
            self.design_md.trim(),
            tasks_s,
            self.allowed_path_globs.join(","),
            self.forbidden_actions.join(","),
            self.gate_cmd.trim(),
            self.max_budget_usd
        )
    }

    pub fn compute_digest(&self) -> String {
        let mut h = Sha256::new();
        h.update(self.canonical_payload().as_bytes());
        format!("{:x}", h.finalize())
    }

    pub fn approve(&mut self) {
        self.sha256_digest = self.compute_digest();
        self.approved_at = Some(Utc::now().to_rfc3339());
        self.status = "approved".into();
    }

    pub fn verify_signature(&self) -> Result<(), String> {
        if self.approved_at.is_none() || self.status == "draft" {
            return Err("spec has not been signed and approved by owner".into());
        }
        let expected = self.compute_digest();
        if self.sha256_digest != expected {
            return Err(format!(
                "spec digest mismatch (tampered or edited after approval): expected {expected}"
            ));
        }
        Ok(())
    }
}

pub fn create_draft_spec(
    title: String,
    goal: String,
    repo_root: String,
    requirements_md: String,
    design_md: String,
    tasks_dag: Vec<SpecWaveTask>,
    allowed_path_globs: Vec<String>,
    forbidden_actions: Vec<String>,
    gate_cmd: String,
    sandbox_tier: String,
    max_budget_usd: f64,
) -> KiroSpecManifest {
    let mut spec = KiroSpecManifest {
        spec_id: format!("spec-{}", &Uuid::new_v4().to_string()[..8]),
        title,
        goal,
        repo_root,
        requirements_md,
        design_md,
        tasks_dag,
        allowed_path_globs,
        forbidden_actions,
        gate_cmd,
        sandbox_tier,
        max_budget_usd,
        sha256_digest: String::new(),
        approved_at: None,
        status: "draft".into(),
        created_at: Utc::now().to_rfc3339(),
    };
    spec.sha256_digest = spec.compute_digest();
    spec
}

#[derive(Debug, Clone)]
pub struct DiffGuardResult {
    pub allowed: bool,
    pub changed_files: Vec<String>,
    pub out_of_scope_files: Vec<String>,
    pub diff_hash: String,
}

/// Deterministic zero-token anti-drift verification inspecting `git diff --name-only HEAD`
/// against a spec's declared `allowed_path_globs`.
pub fn check_diff_scope_guard(worktree_path: &Path, allowed_globs: &[String]) -> DiffGuardResult {
    let out = Command::new("git")
        .args(["diff", "--name-only", "HEAD"])
        .current_dir(worktree_path)
        .output();
    let changed_files: Vec<String> = match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    };

    let mut out_of_scope_files = Vec::new();
    for f in &changed_files {
        if !allowed_globs.is_empty() && !matches_any_glob(f, allowed_globs) {
            out_of_scope_files.push(f.clone());
        }
    }

    let mut h = Sha256::new();
    h.update(changed_files.join("\n").as_bytes());
    let diff_hash = format!("{:x}", h.finalize())[..12].to_string();

    DiffGuardResult {
        allowed: out_of_scope_files.is_empty(),
        changed_files,
        out_of_scope_files,
        diff_hash,
    }
}

pub fn matches_any_glob(file_path: &str, globs: &[String]) -> bool {
    let f = file_path.trim().trim_start_matches("./");
    for raw in globs {
        let g = raw.trim().trim_start_matches("./");
        if g == "*" || g == "**" || f == g {
            return true;
        }
        if let Some(prefix) = g.strip_suffix("/**") {
            if f == prefix || f.starts_with(&format!("{prefix}/")) {
                return true;
            }
        } else if let Some(prefix) = g.strip_suffix("/*") {
            if f.starts_with(&format!("{prefix}/")) {
                return true;
            }
        } else if let Some(ext) = g.strip_prefix("*.") {
            if f.ends_with(&format!(".{ext}")) {
                return true;
            }
        }
    }
    false
}

/// Loads relevant `.lingonberry/steering` or `.kiro/steering` markdown rules without full-repo bloat.
pub fn load_matching_steering(repo_root: &Path, hint_tokens: &[String]) -> Vec<String> {
    let mut rules = Vec::new();
    let dirs = [
        lingonberry_home().join("steering"),
        repo_root.join(".lingonberry").join("steering"),
        repo_root.join(".kiro").join("steering"),
    ];
    for d in dirs {
        let Ok(entries) = fs::read_dir(d) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if let Ok(text) = fs::read_to_string(&p) {
                let first_lines: String = text.lines().take(6).collect::<Vec<_>>().join(" ").to_ascii_lowercase();
                if first_lines.contains("inclusion: always")
                    || hint_tokens.iter().any(|t| t.len() >= 4 && first_lines.contains(&t.to_ascii_lowercase()))
                {
                    rules.push(text.chars().take(1200).collect());
                }
            }
        }
    }
    rules
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsigned_spec_is_rejected_and_signed_verifies() {
        let mut spec = create_draft_spec(
            "Lock auth middleware".into(),
            "Add constant-time token check".into(),
            "/tmp/repo".into(),
            "EARS: reject missing token".into(),
            "Update middleware layer".into(),
            vec![SpecWaveTask {
                task_id: "t1".into(),
                wave: 1,
                title: "Verify auth test".into(),
                path_globs: vec!["core/src/**".into()],
                gate_cmd: "test".into(),
                status: "pending".into(),
            }],
            vec!["core/src/**".into()],
            vec!["rm -rf".into()],
            "test".into(),
            "docker".into(),
            0.0,
        );
        assert!(spec.verify_signature().is_err());
        spec.approve();
        assert!(spec.verify_signature().is_ok());
        spec.goal.push_str(" AND rewrite README");
        assert!(spec.verify_signature().is_err());
    }

    #[test]
    fn glob_matcher_enforces_scope() {
        let globs = vec!["core/src/**".into(), "*.md".into()];
        assert!(matches_any_glob("core/src/server.rs", &globs));
        assert!(matches_any_glob("HANDOFF.md", &globs));
        assert!(!matches_any_glob(".github/workflows/ci.yml", &globs));
    }
}
