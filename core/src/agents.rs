use crate::config::Config;
use crate::discovery::{redact_secrets, resolve_key_value};
use crate::registry::Registry;
use crate::types::{
    CookedPromptInfo, DiscoveredWorker, DiscoveryData, Receipt, ReceiptExclusion, ReceiptSelection,
    SelfConfigPlan, SelfConfigTarget,
};
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

struct DiscoveredSkill {
    name: String,
    description: String,
}

fn scan_local_skills(library_dirs: &[String]) -> Vec<DiscoveredSkill> {
    let mut skills = Vec::new();
    for dir in library_dirs {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let skill_file = p.join("SKILL.md");
            if let Ok(text) = fs::read_to_string(&skill_file) {
                let slice: String = text.chars().take(1200).collect();
                let mut name = entry.file_name().to_string_lossy().into_owned();
                let mut desc = String::new();
                for line in slice.lines() {
                    let trimmed = line.trim();
                    if let Some(rest) = trimmed.strip_prefix("name:") {
                        name = rest.trim().trim_matches('"').trim_matches('\'').to_string();
                    } else if let Some(rest) = trimmed.strip_prefix("description:") {
                        desc = rest.trim().trim_matches('"').trim_matches('\'').to_string();
                    }
                }
                skills.push(DiscoveredSkill {
                    name,
                    description: desc,
                });
            }
        }
    }
    skills
}

pub fn cook_prompt(
    raw_prompt: &str,
    discovery: &DiscoveryData,
    phase: &str,
    use_worktree: bool,
) -> CookedPromptInfo {
    let lower = raw_prompt.to_ascii_lowercase();
    let tokens: BTreeSet<String> = lower
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-')
        .filter(|t| t.len() > 2)
        .map(str::to_string)
        .collect();

    let (task_class, mut selected_skill, selected_command, selected_hook, gate_policy) =
        if ["bug", "fix", "error", "fail", "crash", "stack", "broken", "debug"]
            .iter()
            .any(|kw| lower.contains(kw))
        {
            (
                "debug_fix",
                "systematic-debugging".to_string(),
                if use_worktree {
                    "lingonberry-core run --worktree --gate test".to_string()
                } else {
                    "lingonberry-core run --gate test".to_string()
                },
                "pre-apply-diff-preview",
                "test-suite-exit-0",
            )
        } else if ["security", "secret", "key", "auth", "audit", "vuln", "review"]
            .iter()
            .any(|kw| lower.contains(kw))
        {
            (
                "security_audit",
                "secure-review-constitution".to_string(),
                "lingonberry-core run --gate gitleaks".to_string(),
                "key-redaction-guard",
                "zero-secret-leak",
            )
        } else if [
            "refactor",
            "migrate",
            "port",
            "rewrite",
            "build",
            "create",
            "implement",
        ]
        .iter()
        .any(|kw| lower.contains(kw))
        {
            (
                "engineering_build",
                "architecture-first-build".to_string(),
                if use_worktree {
                    "lingonberry-core run --worktree --approve".to_string()
                } else {
                    "lingonberry-core run --gate build".to_string()
                },
                "worktree-isolation-hook",
                "compile-and-lint-pass",
            )
        } else if ["summarize", "explain", "compare", "research", "plan", "check"]
            .iter()
            .any(|kw| lower.contains(kw))
        {
            (
                "research_plan",
                "deep-retrieval-brief".to_string(),
                "lingonberry-core route --phase plan".to_string(),
                "source-grounding-hook",
                "citation-grounded",
            )
        } else {
            (
                "general_synthesis",
                "context-retrieval-core".to_string(),
                format!("lingonberry-core route --phase {phase}"),
                "receipt-audit-log",
                "structured-output-check",
            )
        };

    let local_skills = scan_local_skills(&discovery.library_dirs);
    let mut best_score = 0usize;
    for sk in local_skills {
        let hay = format!("{} {}", sk.name, sk.description).to_ascii_lowercase();
        let score = tokens.iter().filter(|tok| hay.contains(tok.as_str())).count();
        if score > best_score {
            best_score = score;
            selected_skill = sk.name;
        }
    }

    let mut retrieval_sources = Vec::new();
    if discovery.library_dirs.is_empty() {
        retrieval_sources.push("~/.agent-skills (global constitution)".to_string());
    } else {
        retrieval_sources.extend(discovery.library_dirs.iter().take(2).cloned());
    }
    if discovery.git_projects.is_empty() {
        retrieval_sources.push("workspace-context-index".to_string());
    } else {
        retrieval_sources.extend(discovery.git_projects.iter().take(2).cloned());
    }

    let sanitized = redact_secrets(raw_prompt.trim());
    let cooked_prompt = format!(
        "[Constitution: global-agentic-skills · {selected_skill}]\n\
         [Task Class: {task_class} · Command: {selected_command}]\n\
         [Hook: {selected_hook} · Gate: {gate_policy}]\n\
         [Retrieved Context: {}]\n\n\
         Objective: {sanitized}",
        retrieval_sources.join(", ")
    );

    CookedPromptInfo {
        raw_prompt: sanitized,
        cooked_prompt,
        task_class: task_class.to_string(),
        selected_skill,
        selected_command,
        selected_hook: selected_hook.to_string(),
        retrieval_sources,
        gate_policy: gate_policy.to_string(),
    }
}

fn has_key_available(slot: &str, discovery: &DiscoveryData) -> bool {
    if std::env::var(slot).map(|v| !v.is_empty()).unwrap_or(false) {
        return true;
    }
    discovery.keys.values().any(|names| names.iter().any(|n| n == slot))
}

pub fn route_prompt(
    prompt: &str,
    phase: &str,
    caller: Option<&str>,
    discovery: &DiscoveryData,
    registry: &Registry,
    use_worktree: bool,
) -> Receipt {
    let workers = registry.list_workers();
    let mut exclusions = Vec::new();
    let mut candidates: Vec<DiscoveredWorker> = workers.clone();

    // 1. Skip workers flagged down by doctor
    let down_ids: Vec<String> = candidates
        .iter()
        .filter(|w| registry.is_worker_down(&w.id))
        .map(|w| w.id.clone())
        .collect();
    if !down_ids.is_empty() {
        exclusions.push(ReceiptExclusion {
            candidate_id: down_ids.join(", "),
            code: "DOCTOR_DOWN".to_string(),
            evidence: "worker marked unhealthy by doctor check".to_string(),
        });
        candidates.retain(|w| !registry.is_worker_down(&w.id));
    }

    // 2. Destructive keyword constraint
    let lower = prompt.to_ascii_lowercase();
    let destructive = ["delete", "rm ", "drop", "truncate", "destroy", "wipe", "format"];
    if destructive.iter().any(|kw| lower.contains(kw)) {
        let before = candidates.len();
        candidates.retain(|w| w.write_access);
        let removed = before.saturating_sub(candidates.len());
        if removed > 0 {
            exclusions.push(ReceiptExclusion {
                candidate_id: "read-only workers".to_string(),
                code: "NO_WRITE_ACCESS".to_string(),
                evidence: format!(
                    "prompt contains destructive keyword; {removed} read-only workers excluded"
                ),
            });
        }
    }

    // 3. Key availability constraint
    let unkeyed: Vec<String> = candidates
        .iter()
        .filter(|w| {
            w.key_slot
                .as_deref()
                .map(|s| !has_key_available(s, discovery))
                .unwrap_or(false)
        })
        .map(|w| w.id.clone())
        .collect();
    if !unkeyed.is_empty() {
        exclusions.push(ReceiptExclusion {
            candidate_id: unkeyed.join(", "),
            code: "KEY_NOT_SET".to_string(),
            evidence: "required API key env var not present in environment".to_string(),
        });
        candidates.retain(|w| {
            w.key_slot
                .as_deref()
                .map(|s| has_key_available(s, discovery))
                .unwrap_or(true)
        });
    }

    // 4. Key cooldown constraint
    let status_map: BTreeMap<String, String> = registry
        .key_status()
        .into_iter()
        .map(|k| (k.name, k.status))
        .collect();
    let cooling: Vec<String> = candidates
        .iter()
        .filter(|w| {
            w.key_slot
                .as_deref()
                .and_then(|s| status_map.get(s))
                .map(|st| st == "down")
                .unwrap_or(false)
        })
        .map(|w| w.id.clone())
        .collect();
    if !cooling.is_empty() {
        exclusions.push(ReceiptExclusion {
            candidate_id: cooling.join(", "),
            code: "KEY_COOLDOWN".to_string(),
            evidence: "key slot resting on cooldown after previous failure".to_string(),
        });
        candidates.retain(|w| {
            w.key_slot
                .as_deref()
                .and_then(|s| status_map.get(s))
                .map(|st| st != "down")
                .unwrap_or(true)
        });
    }

    let cooked = cook_prompt(prompt, discovery, phase, use_worktree);

    let catalog_hash = sha256_hex(&format!(
        "{}|{}|{}",
        discovery.library_dirs.join(","),
        discovery.ssh_hosts.join(","),
        discovery.git_projects.join(",")
    ));
    let policy_hash = sha256_hex(
        &exclusions
            .iter()
            .map(|e| format!("{}:{}", e.code, e.evidence))
            .collect::<Vec<_>>()
            .join("|"),
    );
    let pool_hash = sha256_hex(
        &discovery
            .keys
            .iter()
            .map(|(p, names)| format!("{p}:{}", names.join(",")))
            .collect::<Vec<_>>()
            .join("|"),
    );
    let registry_hash = sha256_hex(
        &workers
            .iter()
            .map(|w| format!("{}:{}", w.id, w.key_slot.as_deref().unwrap_or("")))
            .collect::<Vec<_>>()
            .join("|"),
    );

    if candidates.is_empty() {
        return Receipt {
            receipt_id: Uuid::new_v4().to_string(),
            context_hash: sha256_hex(prompt),
            catalog_hash,
            policy_hash,
            pool_hash,
            registry_hash,
            phase: phase.to_string(),
            selected: None,
            alternatives: Vec::new(),
            exclusions,
            abstention: Some(
                "no workers passed constraint filters (add a provider key or install a CLI agent)"
                    .to_string(),
            ),
            created_at: Utc::now().to_rfc3339(),
            caller: caller.map(str::to_string),
            cooked: Some(cooked),
        };
    }

    let mut scored: Vec<(f64, DiscoveredWorker)> = candidates
        .into_iter()
        .map(|w| {
            let score = if w.agent == "pi" && w.key_slot.is_none() {
                1.0
            } else if w.key_slot.is_none() {
                0.9
            } else {
                0.8
            };
            (score, w)
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let to_sel = |(score, w): &(f64, DiscoveredWorker)| ReceiptSelection {
        worker: w.id.clone(),
        model: w.model.clone(),
        effort: Some(
            if cooked.task_class == "engineering_build" {
                "high"
            } else {
                "standard"
            }
            .to_string(),
        ),
        gate: Some(cooked.gate_policy.clone()),
        reason: format!("score={score:.2} · skill={}", cooked.selected_skill),
    };

    let selected = Some(to_sel(&scored[0]));
    let alternatives = scored.iter().skip(1).map(to_sel).collect();

    Receipt {
        receipt_id: Uuid::new_v4().to_string(),
        context_hash: sha256_hex(prompt),
        catalog_hash,
        policy_hash,
        pool_hash,
        registry_hash,
        phase: phase.to_string(),
        selected,
        alternatives,
        exclusions,
        abstention: None,
        created_at: Utc::now().to_rfc3339(),
        caller: caller.map(str::to_string),
        cooked: Some(cooked),
    }
}

/// Detects truncated model responses (mid-sentence cutoff or unclosed JSON/code fences)
/// so the execution engine can automatically retry on a sibling key slot.
pub fn is_output_truncated(text: &str, finish_reason: Option<&str>) -> bool {
    if finish_reason == Some("length") || finish_reason == Some("max_tokens") {
        return true;
    }
    let fence_count = text.matches("```").count();
    if fence_count % 2 == 1 {
        return true;
    }
    let trimmed = text.trim();
    if trimmed.starts_with('{') && !trimmed.ends_with('}') {
        return true;
    }
    false
}

pub fn build_self_config_plan(
    discovery: &DiscoveryData,
    _cfg: &Config,
    applied: &BTreeSet<String>,
) -> SelfConfigPlan {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let os_name = if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "windows") {
        "Windows"
    } else {
        "Linux"
    };

    let global_dir = discovery
        .library_dirs
        .iter()
        .find(|d| d.contains(".agent-skills"))
        .or_else(|| discovery.library_dirs.first())
        .cloned()
        .unwrap_or_else(|| home.join(".agent-skills").to_string_lossy().into_owned());

    let global_skill_path = PathBuf::from(&global_dir)
        .join("lingonberry-router")
        .join("SKILL.md")
        .to_string_lossy()
        .into_owned();
    let constitution_path = home
        .join(".lingonberry")
        .join("CONSTITUTION.md")
        .to_string_lossy()
        .into_owned();
    let mcp_path = home
        .join(".lingonberry")
        .join("mcp.json")
        .to_string_lossy()
        .into_owned();

    let mut targets = vec![
        SelfConfigTarget {
            target: "Global Agentic Skills + Constitution".into(),
            scope: "global".into(),
            path: global_skill_path.clone(),
            status: if applied.contains(&global_skill_path) || PathBuf::from(&global_skill_path).exists() {
                "applied".into()
            } else {
                "ready".into()
            },
            reason: "Single shared source of truth: every agent reading global skills inherits Lingonberry routing without per-agent duplication.".into(),
            snippet: "---\nname: lingonberry-router\ndescription: Delegate heavy, parallel, or multi-provider work via lingonberry-core.\n---\nBefore multi-file edits or parallel fanout, run `lingonberry-core route \"<prompt>\"`.".into(),
        },
        SelfConfigTarget {
            target: "Shared Router Directive".into(),
            scope: "global".into(),
            path: constitution_path.clone(),
            status: if applied.contains(&constitution_path) || PathBuf::from(&constitution_path).exists() {
                "applied".into()
            } else {
                "ready".into()
            },
            reason: "Defines prompt-cooking rules, destructive-keyword gates, and key-slot isolation across all callers.".into(),
            snippet: "# Lingonberry Constitution Pointer\nUse `ROUTER_CALLER=<agent>` and `lingonberry-core serve` (127.0.0.1:8799).".into(),
        },
        SelfConfigTarget {
            target: "MCP Tool Bridge (lingonberry-core mcp)".into(),
            scope: "global".into(),
            path: mcp_path.clone(),
            status: if applied.contains(&mcp_path) || PathBuf::from(&mcp_path).exists() {
                "applied".into()
            } else {
                "ready".into()
            },
            reason: "Exposes route, run, fanout, and snapshot as standard MCP tools.".into(),
            snippet: "{\n  \"mcpServers\": {\n    \"lingonberry-router\": {\n      \"command\": \"lingonberry-core\",\n      \"args\": [\"mcp\"]\n    }\n  }\n}".into(),
        },
    ];

    let discovered: BTreeSet<&str> = discovery.agents.iter().map(|a| a.id.as_str()).collect();
    for (name, p, snippet) in [
        (
            "claude",
            home.join(".claude").join("CLAUDE.md"),
            "<!-- lingonberry:start -->\nRead `~/.agent-skills/lingonberry-router/SKILL.md` for subagent dispatch.\n<!-- lingonberry:end -->",
        ),
        (
            "codex",
            home.join(".codex").join("AGENTS.md"),
            "<!-- lingonberry:start -->\nUse `lingonberry-core` per `~/.agent-skills/lingonberry-router/SKILL.md`.\n<!-- lingonberry:end -->",
        ),
        (
            "opencode",
            home.join(".config").join("opencode").join("AGENTS.md"),
            "<!-- lingonberry:start -->\nUse `lingonberry-core` per `~/.agent-skills/lingonberry-router/SKILL.md`.\n<!-- lingonberry:end -->",
        ),
    ] {
        let path_str = p.to_string_lossy().into_owned();
        targets.push(SelfConfigTarget {
            target: format!("{name} (light pointer)"),
            scope: "light-pointer".into(),
            path: path_str.clone(),
            status: if applied.contains(&path_str) {
                "applied".into()
            } else {
                "ready".into()
            },
            reason: if discovered.contains(name) {
                format!("Discovered {name}: 2-line pointer to shared global skill.")
            } else {
                format!("Ready for {name}: dormant until {name} is on PATH.")
            },
            snippet: snippet.into(),
        });
    }

    SelfConfigPlan {
        os: os_name.into(),
        preferred_root: global_dir,
        strategy: "Global-first injection: write one canonical skill, constitution & MCP bridge in your shared global folder, plus 2-line idempotent pointers per agent.".into(),
        targets,
    }
}

/// Safely writes global self-config skills/constitution/MCP files and upserts idempotent
/// `<!-- lingonberry:start -->` light pointer blocks into agent instruction files.
/// Confined strictly to paths emitted in `plan.targets`.
pub fn apply_self_config_targets(plan: &SelfConfigPlan, chosen: &BTreeSet<String>) -> Vec<String> {
    let mut applied = Vec::new();
    for target in &plan.targets {
        if !chosen.contains(&target.path) {
            continue;
        }
        let path = PathBuf::from(&target.path);
        if target.scope == "global" {
            if let Some(parent) = path.parent() {
                if fs::create_dir_all(parent).is_err() {
                    continue;
                }
            }
            if fs::write(&path, format!("{}\n", target.snippet.trim())).is_ok() {
                applied.push(target.path.clone());
            }
        } else if target.scope == "light-pointer" {
            let Some(parent) = path.parent() else {
                continue;
            };
            if fs::create_dir_all(parent).is_err() {
                continue;
            }
            let existing = fs::read_to_string(&path).unwrap_or_default();
            let block = target.snippet.trim();
            let updated = if let (Some(start), Some(end)) = (
                existing.find("<!-- lingonberry:start -->"),
                existing.find("<!-- lingonberry:end -->"),
            ) {
                if end >= start {
                    let after_end = end + "<!-- lingonberry:end -->".len();
                    format!("{}{}{}", &existing[..start], block, &existing[after_end..])
                } else {
                    format!("{}\n\n{}\n", existing.trim_end(), block)
                }
            } else if existing.trim().is_empty() {
                format!("{block}\n")
            } else {
                format!("{}\n\n{}\n", existing.trim_end(), block)
            };
            if fs::write(&path, updated).is_ok() {
                applied.push(target.path.clone());
            }
        }
    }
    applied
}

/// Calls an OpenAI-compatible provider endpoint using only the resolved key slot value at request time.
pub async fn call_provider_api(
    base_url: &str,
    key_slot: &str,
    model: &str,
    cooked_prompt: &str,
) -> anyhow::Result<(String, Option<String>)> {
    let api_key = resolve_key_value(key_slot)
        .ok_or_else(|| anyhow::anyhow!("key slot {key_slot} value missing at dispatch time"))?;
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .post(&endpoint)
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": cooked_prompt}],
            "max_tokens": 512
        }))
        .send()
        .await?;

    let status = resp.status();
    if status.as_u16() == 429 || status.is_server_error() {
        anyhow::bail!("HTTP {}", status.as_u16());
    }
    let body: serde_json::Value = resp.json().await?;
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let finish_reason = body["choices"][0]["finish_reason"]
        .as_str()
        .map(str::to_string);
    Ok((redact_secrets(&content), finish_reason))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn destructive_prompt_excludes_read_only_worker() {
        let mut discovery = DiscoveryData {
            agents: vec![],
            keys: BTreeMap::new(),
            providers: BTreeMap::new(),
            library_dirs: vec![],
            ssh_hosts: vec![],
            git_projects: vec![],
            browsers: vec![],
        };
        discovery.keys.insert("nim".into(), vec!["NIM_1".into()]);
        let reg = Registry::new(&discovery, &Config::default());
        let rcpt = route_prompt("delete stale build artifacts", "execute", Some("shell"), &discovery, &reg, false);
        assert!(rcpt.exclusions.iter().any(|e| e.code == "NO_WRITE_ACCESS"));
    }

    #[test]
    fn doctor_down_worker_is_excluded() {
        let mut discovery = DiscoveryData {
            agents: vec![],
            keys: BTreeMap::new(),
            providers: BTreeMap::new(),
            library_dirs: vec![],
            ssh_hosts: vec![],
            git_projects: vec![],
            browsers: vec![],
        };
        discovery.keys.insert("groq".into(), vec!["GROQ_API_KEY".into()]);
        let reg = Registry::new(&discovery, &Config::default());
        reg.mark_worker_down("groq:GROQ_API_KEY", true);
        let rcpt = route_prompt("summarize logs", "plan", Some("shell"), &discovery, &reg, false);
        assert!(rcpt.exclusions.iter().any(|e| e.code == "DOCTOR_DOWN"));
    }

    #[test]
    fn truncation_detector_catches_unclosed_fence_and_length() {
        assert!(is_output_truncated("ok", Some("length")));
        assert!(is_output_truncated("```rust\nfn main() {", None));
        assert!(!is_output_truncated("```rust\nfn main() {}\n```", Some("stop")));
    }

    #[test]
    fn self_config_light_pointer_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("lbr-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let target_file = dir.join("CLAUDE.md");
        fs::write(&target_file, "# Existing User Rules\nKeep diffs small.\n").unwrap();
        let target_str = target_file.to_string_lossy().into_owned();
        let plan = SelfConfigPlan {
            os: "Linux".into(),
            preferred_root: dir.to_string_lossy().into_owned(),
            strategy: "test".into(),
            targets: vec![SelfConfigTarget {
                target: "claude".into(),
                scope: "light-pointer".into(),
                path: target_str.clone(),
                status: "ready".into(),
                reason: "test".into(),
                snippet: "<!-- lingonberry:start -->\nPointer v1\n<!-- lingonberry:end -->".into(),
            }],
        };
        let mut chosen = BTreeSet::new();
        chosen.insert(target_str.clone());
        apply_self_config_targets(&plan, &chosen);
        apply_self_config_targets(&plan, &chosen);
        let final_text = fs::read_to_string(&target_file).unwrap();
        assert!(final_text.contains("# Existing User Rules"));
        assert_eq!(final_text.matches("<!-- lingonberry:start -->").count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
