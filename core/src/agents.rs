use crate::config::Config;
use crate::discovery::{redact_secrets, resolve_key_value};
use crate::harness::MINI_HARNESS_SKILLS;
use crate::registry::Registry;
use crate::types::{
    CookedPromptInfo, DiscoveredWorker, DiscoveryData, KeyCostTier, Receipt, ReceiptExclusion,
    ReceiptSelection, SelfConfigPlan, SelfConfigTarget,
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
    path: String,
    body: String,
}

pub const CHUNK_CHARS: usize = 12_000;
const SKILL_BODY_CHARS: usize = 4_000;
pub const WORKER_ORDER: &[&str] = &["pi", "jcode", "omp", "opencode", "kilo", "codex", "claude"];
const STOPWORDS: &[&str] = &[
    "that", "this", "with", "from", "your", "have", "will", "into", "about", "just", "make",
    "want", "need", "then", "them", "they", "what", "when", "where", "which", "there",
];

pub fn word_tokens(text: &str) -> BTreeSet<String> {
    text.to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect()
}

pub fn has_word(tokens: &BTreeSet<String>, kw: &str) -> bool {
    tokens.iter().any(|t| {
        t == kw
            || ["s", "es", "ed", "ing"]
                .iter()
                .any(|suf| t.strip_suffix(suf) == Some(kw))
    })
}

pub fn preference_score(w: &DiscoveredWorker) -> f64 {
    let rank = WORKER_ORDER
        .iter()
        .position(|a| *a == w.agent)
        .unwrap_or(WORKER_ORDER.len());
    let base = 1.0 - rank as f64 * 0.05;
    let tier_bonus = match w.cost_tier {
        KeyCostTier::Local => 0.02,
        KeyCostTier::FreeTier => 0.01,
        KeyCostTier::MeteredPaid => -0.03,
    };
    base + tier_bonus
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
                let body: String = text.chars().take(SKILL_BODY_CHARS).collect();
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
                    path: skill_file.to_string_lossy().into_owned(),
                    body,
                });
            }
        }
    }
    skills
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ComplexityTier {
    Trivial,
    Standard,
    Complex,
    Critical,
}

impl ComplexityTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            ComplexityTier::Trivial => "trivial",
            ComplexityTier::Standard => "standard",
            ComplexityTier::Complex => "complex",
            ComplexityTier::Critical => "critical",
        }
    }
}

/// Stage 1: Zero-API-cost structural & blast-radius feature extractor (< 0.2ms).
pub fn classify_complexity(prompt: &str, use_worktree: bool) -> ComplexityTier {
    let tokens = word_tokens(prompt);
    let sensitive_hits = [
        "auth", "token", "migration", "sql", "schema", "sandbox", "keychain", "delete",
        "security", "concurrency", "swarm", "rebase", "merge", "architect", "rewrite",
    ]
    .iter()
    .filter(|kw| has_word(&tokens, kw))
    .count();

    if sensitive_hits >= 2 || (use_worktree && prompt.chars().count() > 240) {
        ComplexityTier::Critical
    } else if sensitive_hits == 1
        || use_worktree
        || ["refactor", "migrate", "implement", "debug", "fix", "gate", "spec"]
            .iter()
            .any(|kw| has_word(&tokens, kw))
    {
        if prompt.chars().count() > 140 {
            ComplexityTier::Complex
        } else {
            ComplexityTier::Standard
        }
    } else if prompt.chars().count() < 80
        && ["summarize", "explain", "check", "status", "list", "read"]
            .iter()
            .any(|kw| has_word(&tokens, kw))
    {
        ComplexityTier::Trivial
    } else {
        ComplexityTier::Standard
    }
}

/// Computes BM25-inspired weighted semantic match between prompt tokens and candidate text.
fn semantic_bm25_score(prompt_tokens: &BTreeSet<String>, doc_text: &str) -> f64 {
    let doc_tokens = word_tokens(doc_text);
    if doc_tokens.is_empty() || prompt_tokens.is_empty() {
        return 0.0;
    }
    let mut hits = 0.0;
    for pt in prompt_tokens {
        if pt.len() < 3 || STOPWORDS.contains(&pt.as_str()) {
            continue;
        }
        if doc_tokens.contains(pt.as_str()) {
            hits += if pt.len() >= 7 { 1.6 } else { 1.1 };
        }
    }
    let norm = (doc_tokens.len() as f64).sqrt().max(1.0);
    hits / norm
}

pub fn cook_prompt(
    raw_prompt: &str,
    discovery: &DiscoveryData,
    phase: &str,
    use_worktree: bool,
) -> CookedPromptInfo {
    let tokens = word_tokens(raw_prompt);
    let complexity = classify_complexity(raw_prompt, use_worktree);

    let archetypes: &[(&str, &str, &str, &str, &str, &str, &str)] = &[
        (
            "debug_fix",
            "systematic-debugging",
            "bug fix error fail crash stack broken debug trace regression panic",
            "lingonberry-core run --worktree --gate test",
            "pre-apply-diff-preview",
            "test",
            "maker_checker_loop",
        ),
        (
            "security_audit",
            "secure-review-constitution",
            "security secret key auth audit vuln review gitleaks seatbelt sandbox token",
            "lingonberry-core run --read-only --gate gitleaks",
            "key-redaction-guard",
            "gitleaks",
            "sequential",
        ),
        (
            "engineering_build",
            "architecture-first-build",
            "refactor migrate port rewrite build create implement swarm worktree module",
            "lingonberry-core run --worktree --gate build --approve",
            "worktree-isolation-hook",
            "build",
            "sequential",
        ),
        (
            "research_plan",
            "deep-retrieval-brief",
            "summarize explain compare research plan check spec requirements design",
            "lingonberry-core route --phase plan",
            "source-grounding-hook",
            "none",
            "single",
        ),
    ];

    let mut best_arch = (
        "general_synthesis",
        "deep-retrieval-brief",
        format!("lingonberry-core route --phase {phase}"),
        "receipt-audit-log",
        "none",
        "single",
    );
    let mut best_arch_score = 0.25f64;

    for (cls, skill, lexicon, cmd, hook, gate, wloop) in archetypes {
        let s = semantic_bm25_score(&tokens, lexicon);
        if s > best_arch_score {
            best_arch_score = s;
            let resolved_cmd = if !use_worktree && cmd.contains("--worktree") {
                cmd.replace(" --worktree", "")
            } else {
                (*cmd).to_string()
            };
            best_arch = (cls, skill, resolved_cmd, hook, gate, wloop);
        }
    }

    let (task_class, default_skill_str, selected_command, selected_hook, gate_policy, workflow_loop) =
        best_arch;
    let default_skill = default_skill_str.to_string();

    let local_skills = scan_local_skills(&discovery.library_dirs);
    let mut scored_skills: Vec<(f64, DiscoveredSkill)> = Vec::new();
    for sk in local_skills {
        let score = semantic_bm25_score(&tokens, &format!("{} {} {}", sk.name, sk.description, sk.body));
        if score >= 0.45 {
            scored_skills.push((score, sk));
        }
    }
    scored_skills.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.1.name.cmp(&b.1.name))
    });

    let mut selected_skills: Vec<String> = scored_skills
        .iter()
        .take(2)
        .map(|(_, s)| s.name.clone())
        .collect();
    if selected_skills.is_empty() {
        selected_skills.push(default_skill.clone());
    }
    let selected_skill = selected_skills[0].clone();

    let builtin_fallback = MINI_HARNESS_SKILLS
        .iter()
        .find(|b| b.id == selected_skill)
        .map(|b| b.body.to_string());

    let selected_body = scored_skills
        .first()
        .map(|(_, s)| s.body.clone())
        .or(builtin_fallback);
    let selected_path = scored_skills.first().map(|(_, s)| s.path.clone());

    let mut retrieval_sources = Vec::new();
    if let Some(path) = &selected_path {
        retrieval_sources.push(path.clone());
    }
    if discovery.library_dirs.is_empty() {
        retrieval_sources.push("~/.lingonberry/harness/skills (built-in mini-harness)".to_string());
    } else {
        retrieval_sources.extend(discovery.library_dirs.iter().take(2).cloned());
    }
    if !discovery.git_projects.is_empty() {
        retrieval_sources.extend(discovery.git_projects.iter().take(2).cloned());
    }

    let sanitized = redact_secrets(raw_prompt.trim());
    let skill_block = match &selected_body {
        Some(body) => format!("\n[Skill Guide: {selected_skill}]\n{}\n", redact_secrets(body)),
        None => String::new(),
    };
    let cooked_prompt = format!(
        "[Task Ledger · Mode: {phase} · Complexity: {} · Loop: {workflow_loop} · Class: {task_class}]\n\
         [Skills: {} · Planned Gate: {gate_policy}]\n\
         [Context Roots: {}]{skill_block}\n\
         Objective: {sanitized}",
        complexity.as_str(),
        selected_skills.join(", "),
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
        workflow_loop: Some(workflow_loop.to_string()),
        skills: selected_skills,
    }
}

/// Escalates a failed or gate-blocked run to a stronger worker along the Big-Three / Subscription
/// ladder (`pi`/free pools -> `claude` CLI subscription -> `codex` CLI -> approved `metered_paid`).
pub fn select_escalation_candidate(
    current_worker: &DiscoveredWorker,
    registry: &Registry,
    allow_paid: bool,
    subscription_headroom: usize,
) -> Option<DiscoveredWorker> {
    let workers = registry.list_workers();
    let mut tier_order: Vec<&str> = Vec::new();
    if subscription_headroom > 0 {
        tier_order.extend(["claude", "codex"]);
    }
    tier_order.extend(["opencode", "kilo", "pi"]);

    for agent_id in tier_order {
        if agent_id == current_worker.agent {
            continue;
        }
        if let Some(cand) = workers.iter().find(|w| {
            w.agent == agent_id
                && !registry.is_worker_down(&w.id)
                && (w.path.is_some() || w.base_url.is_some())
                && (allow_paid || w.cost_tier != KeyCostTier::MeteredPaid)
        }) {
            return Some(cand.clone());
        }
    }
    None
}

fn has_key_available(slot: &str, discovery: &DiscoveryData) -> bool {
    if std::env::var(slot).map(|v| !v.is_empty()).unwrap_or(false) {
        return true;
    }
    discovery.keys.values().any(|names| names.iter().any(|n| n == slot))
}

/// Validates an explicit `--worker` choice against policy rules (non-owner key isolation,
/// doctor down status, destructive write-access check, and metered/paid key approval).
pub fn validate_explicit_worker_policy(
    worker: &DiscoveredWorker,
    prompt: &str,
    registry: &Registry,
    allow_keys: bool,
    allow_paid: bool,
) -> Result<(), ReceiptExclusion> {
    if registry.is_worker_down(&worker.id) {
        return Err(ReceiptExclusion {
            candidate_id: worker.id.clone(),
            code: "DOCTOR_DOWN".into(),
            evidence: "explicit worker is marked unhealthy".into(),
        });
    }
    let prompt_tokens = word_tokens(prompt);
    let destructive = ["delete", "rm", "drop", "truncate", "destroy", "wipe", "format"];
    if destructive.iter().any(|kw| has_word(&prompt_tokens, kw)) && !worker.write_access {
        return Err(ReceiptExclusion {
            candidate_id: worker.id.clone(),
            code: "NO_WRITE_ACCESS".into(),
            evidence: "destructive prompt cannot target read-only worker".into(),
        });
    }
    let keyed = worker.key_name.is_some() || worker.base_url.is_some();
    if !allow_keys && keyed {
        return Err(ReceiptExclusion {
            candidate_id: worker.id.clone(),
            code: "KEY_FORBIDDEN".into(),
            evidence: "API keys are reserved for owner-authenticated requests".into(),
        });
    }
    if !allow_paid && worker.cost_tier == KeyCostTier::MeteredPaid {
        return Err(ReceiptExclusion {
            candidate_id: worker.id.clone(),
            code: "PAID_APPROVAL_REQUIRED".into(),
            evidence: "metered/paid key requires explicit --approve / owner approval".into(),
        });
    }
    Ok(())
}

pub fn route_prompt(
    prompt: &str,
    phase: &str,
    caller: Option<&str>,
    discovery: &DiscoveryData,
    registry: &Registry,
    use_worktree: bool,
) -> Receipt {
    route_prompt_with_budget(
        prompt,
        phase,
        caller,
        discovery,
        registry,
        use_worktree,
        true,
        true,
    )
}

pub fn route_prompt_with(
    prompt: &str,
    phase: &str,
    caller: Option<&str>,
    discovery: &DiscoveryData,
    registry: &Registry,
    use_worktree: bool,
    allow_keys: bool,
) -> Receipt {
    route_prompt_with_budget(
        prompt,
        phase,
        caller,
        discovery,
        registry,
        use_worktree,
        allow_keys,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn route_prompt_with_budget(
    prompt: &str,
    phase: &str,
    caller: Option<&str>,
    discovery: &DiscoveryData,
    registry: &Registry,
    use_worktree: bool,
    allow_keys: bool,
    allow_paid: bool,
) -> Receipt {
    let workers = registry.list_workers();
    let mut exclusions = Vec::new();
    let mut candidates: Vec<DiscoveredWorker> = workers.clone();

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

    let prompt_tokens = word_tokens(prompt);
    let destructive = ["delete", "rm", "drop", "truncate", "destroy", "wipe", "format"];
    if destructive.iter().any(|kw| has_word(&prompt_tokens, kw)) {
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

    let unkeyed: Vec<String> = candidates
        .iter()
        .filter(|w| {
            w.key_name
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
            w.key_name
                .as_deref()
                .map(|s| has_key_available(s, discovery))
                .unwrap_or(true)
        });
    }

    let is_no_endpoint = |w: &DiscoveredWorker| {
        w.path.is_none() && (w.base_url.is_none() || w.model.is_none())
    };
    let no_endpoint: Vec<String> = candidates
        .iter()
        .filter(|w| is_no_endpoint(w))
        .map(|w| w.id.clone())
        .collect();
    if !no_endpoint.is_empty() {
        exclusions.push(ReceiptExclusion {
            candidate_id: no_endpoint.join(", "),
            code: "NO_ENDPOINT".to_string(),
            evidence: "provider has no known base URL or model; set one in config".to_string(),
        });
        candidates.retain(|w| !is_no_endpoint(w));
    }

    if !allow_keys {
        let keyed = |w: &DiscoveredWorker| w.key_name.is_some() || w.base_url.is_some();
        let forbidden: Vec<String> = candidates
            .iter()
            .filter(|w| keyed(w))
            .map(|w| w.id.clone())
            .collect();
        if !forbidden.is_empty() {
            exclusions.push(ReceiptExclusion {
                candidate_id: forbidden.join(", "),
                code: "KEY_FORBIDDEN".to_string(),
                evidence: "API keys are reserved for the owner; this caller uses its own worker".to_string(),
            });
            candidates.retain(|w| !keyed(w));
        }
    }

    if !allow_paid {
        let paid: Vec<String> = candidates
            .iter()
            .filter(|w| w.cost_tier == KeyCostTier::MeteredPaid)
            .map(|w| w.id.clone())
            .collect();
        if !paid.is_empty() {
            exclusions.push(ReceiptExclusion {
                candidate_id: paid.join(", "),
                code: "PAID_APPROVAL_REQUIRED".to_string(),
                evidence: "metered/paid providers stay disabled until --approve or owner budget approval".to_string(),
            });
            candidates.retain(|w| w.cost_tier != KeyCostTier::MeteredPaid);
        }
    }

    let status_map: BTreeMap<String, String> = registry
        .key_status()
        .into_iter()
        .map(|k| (k.name, k.status))
        .collect();
    let cooling: Vec<String> = candidates
        .iter()
        .filter(|w| {
            w.key_name
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
            evidence: "key resting on cooldown after previous failure".to_string(),
        });
        candidates.retain(|w| {
            w.key_name
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
            .map(|w| format!("{}:{}", w.id, w.key_name.as_deref().unwrap_or("")))
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
                "no workers passed constraint filters (add a free/local key, install `pi`, or pass --approve for paid keys)"
                    .to_string(),
            ),
            created_at: Utc::now().to_rfc3339(),
            caller: caller.map(str::to_string),
            cooked: Some(cooked),
        };
    }

    let mut scored: Vec<(f64, DiscoveredWorker)> = {
        let key_backed = |w: &DiscoveredWorker| w.key_name.is_some() || w.base_url.is_some();
        let max_headroom = candidates
            .iter()
            .filter(|w| key_backed(w))
            .map(|w| registry.provider_headroom(&w.provider))
            .max()
            .unwrap_or(0);
        candidates
            .into_iter()
            .map(|w| {
                let cap = if key_backed(&w) && max_headroom > 0 {
                    registry.provider_headroom(&w.provider) as f64 / max_headroom as f64
                } else {
                    0.0
                };
                (preference_score(&w) + 0.04 * cap, w)
            })
            .collect()
    };
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
        reason: format!(
            "score={score:.2} · tier={} · skill={}",
            w.cost_tier.as_str(),
            cooked.selected_skill
        ),
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
            reason: "Defines prompt-cooking rules, destructive-keyword gates, and key isolation across all callers.".into(),
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

pub async fn call_provider_api(
    base_url: &str,
    key_name: &str,
    model: &str,
    cooked_prompt: &str,
) -> anyhow::Result<(String, Option<String>)> {
    let api_key = resolve_key_value(key_name)
        .ok_or_else(|| anyhow::anyhow!("key {key_name} value missing at dispatch time"))?;
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let timeout_s: u64 = std::env::var("LINGONBERRY_HTTP_TIMEOUT_S")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(240);
    let max_tokens: u64 = std::env::var("LINGONBERRY_MAX_TOKENS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8192);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_s))
        .user_agent("lingonberry-router/0.1")
        .build()?;
    let resp = client
        .post(&endpoint)
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": cooked_prompt}],
            "max_tokens": max_tokens
        }))
        .send()
        .await?;

    let status = resp.status();
    if status.as_u16() == 429 || status.is_server_error() {
        anyhow::bail!("HTTP {}", status.as_u16());
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!(
            "HTTP {}: {}",
            status.as_u16(),
            redact_secrets(&text.chars().take(300).collect::<String>())
        );
    }
    let body: serde_json::Value = resp.json().await?;
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let finish_reason = body["choices"][0]["finish_reason"]
        .as_str()
        .map(str::to_string);
    if content.trim().is_empty() && finish_reason.as_deref() == Some("length") {
        anyhow::bail!(
            "truncated: empty content at max_tokens={max_tokens} (raise LINGONBERRY_MAX_TOKENS)"
        );
    }
    Ok((redact_secrets(&content), finish_reason))
}

/// Forwards an OpenAI-compatible chat-completions JSON payload from `pi-rust` through an owner
/// key slot without exposing the raw API key to `pi-rust`.
pub async fn proxy_provider_chat(
    base_url: &str,
    key_name: &str,
    mut payload: serde_json::Value,
    fallback_model: Option<&str>,
) -> anyhow::Result<serde_json::Value> {
    let api_key = resolve_key_value(key_name)
        .ok_or_else(|| anyhow::anyhow!("key {key_name} value missing at dispatch time"))?;
    if payload.get("model").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        if let Some(m) = fallback_model {
            payload["model"] = serde_json::Value::String(m.to_string());
        }
    }
    payload["stream"] = serde_json::Value::Bool(false);
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(240))
        .user_agent("lingonberry-router-proxy/0.1")
        .build()?;
    let resp = client
        .post(&endpoint)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await?;
    let status = resp.status();
    if status.as_u16() == 429 || status.is_server_error() {
        anyhow::bail!("HTTP {}", status.as_u16());
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!(
            "HTTP {}: {}",
            status.as_u16(),
            redact_secrets(&text.chars().take(300).collect::<String>())
        );
    }
    let json: serde_json::Value = resp.json().await?;
    Ok(json)
}

pub fn chunk_text(text: &str, max: usize) -> Vec<String> {
    let max = max.max(1);
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    for para in text.split("\n\n") {
        if para.trim().is_empty() {
            continue;
        }
        let mut rest = para.to_string();
        while rest.chars().count() > max {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            out.push(rest.chars().take(max).collect());
            rest = rest.chars().skip(max).collect();
        }
        let sep = if cur.is_empty() { 0 } else { 2 };
        if !cur.is_empty() && cur.chars().count() + sep + rest.chars().count() > max {
            out.push(std::mem::take(&mut cur));
        }
        if !cur.is_empty() {
            cur.push_str("\n\n");
        }
        cur.push_str(&rest);
    }
    if !cur.trim().is_empty() {
        out.push(cur);
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

pub async fn call_chunked(
    base_url: &str,
    key_name: &str,
    model: &str,
    cooked: &CookedPromptInfo,
) -> anyhow::Result<(String, Option<String>)> {
    let chunks = chunk_text(&cooked.raw_prompt, CHUNK_CHARS);
    if chunks.len() <= 1 {
        return call_provider_api(base_url, key_name, model, &cooked.cooked_prompt).await;
    }
    let header = cooked
        .cooked_prompt
        .split("\nObjective: ")
        .next()
        .unwrap_or("")
        .to_string();
    let n = chunks.len();
    let mut parts = Vec::with_capacity(n);
    for (i, chunk) in chunks.iter().enumerate() {
        let prompt = format!(
            "{header}\nObjective: [chunk {} of {n} of a longer input; answer what this chunk supports]\n\n{chunk}",
            i + 1
        );
        let (text, _) = call_provider_api(base_url, key_name, model, &prompt).await?;
        parts.push(format!("## Chunk {}/{n}\n{}", i + 1, text.trim()));
    }
    let reduce = format!(
        "{header}\nObjective: {}\n\nMerge these per-chunk answers into one complete answer to the objective. Remove duplicates, keep every distinct finding.\n\n{}",
        cooked.raw_prompt,
        parts.join("\n\n")
    );
    call_provider_api(base_url, key_name, model, &reduce).await
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
            stores: vec![],
            keychain_slots: vec![],
        };
        discovery.keys.insert("nim".into(), vec!["NIM_1".into()]);
        discovery.providers.insert(
            "nim".into(),
            crate::types::Provider {
                id: "nim".into(),
                base_url: "https://integrate.api.nvidia.com/v1".into(),
                style: Some("openai".into()),
            },
        );
        discovery.agents.push(crate::types::Agent {
            id: "crush".into(),
            path: Some("/bin/true".into()),
        });
        let reg = Registry::new(&discovery, &Config::default());
        let rcpt = route_prompt(
            "delete stale build artifacts",
            "execute",
            Some("shell"),
            &discovery,
            &reg,
            false,
        );
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
            stores: vec![],
            keychain_slots: vec![],
        };
        discovery.keys.insert("groq".into(), vec!["GROQ_API_KEY".into()]);
        let reg = Registry::new(&discovery, &Config::default());
        reg.mark_worker_down("pi:groq", true);
        let rcpt = route_prompt("summarize logs", "plan", Some("shell"), &discovery, &reg, false);
        assert!(rcpt.exclusions.iter().any(|e| e.code == "DOCTOR_DOWN"));
    }

    #[test]
    fn paid_worker_is_excluded_without_approval() {
        let mut discovery = DiscoveryData {
            agents: vec![],
            keys: BTreeMap::new(),
            providers: BTreeMap::new(),
            library_dirs: vec![],
            ssh_hosts: vec![],
            git_projects: vec![],
            browsers: vec![],
            stores: vec![],
            keychain_slots: vec![],
        };
        discovery.keys.insert("openai".into(), vec!["OPENAI_API_KEY".into()]);
        discovery.providers.insert(
            "openai".into(),
            crate::types::Provider {
                id: "openai".into(),
                base_url: "https://api.openai.com/v1".into(),
                style: Some("openai".into()),
            },
        );
        let reg = Registry::new(&discovery, &Config::default());
        let rcpt = route_prompt_with_budget(
            "summarize logs",
            "plan",
            Some("shell"),
            &discovery,
            &reg,
            false,
            true,
            false,
        );
        assert!(rcpt.exclusions.iter().any(|e| e.code == "PAID_APPROVAL_REQUIRED"));
        assert!(rcpt.selected.is_none());
    }

    #[test]
    fn explicit_worker_policy_rejects_paid_and_key_forbidden() {
        let w = DiscoveredWorker {
            id: "pi:openai".into(),
            agent: "pi".into(),
            key_name: None,
            provider: "openai".into(),
            base_url: Some("https://api.openai.com/v1".into()),
            model: Some("gpt-4.1".into()),
            write_access: true,
            path: None,
            cost_tier: KeyCostTier::MeteredPaid,
        };
        let disc = DiscoveryData {
            agents: vec![],
            keys: BTreeMap::new(),
            providers: BTreeMap::new(),
            library_dirs: vec![],
            ssh_hosts: vec![],
            git_projects: vec![],
            browsers: vec![],
            stores: vec![],
            keychain_slots: vec![],
        };
        let reg = Registry::new(&disc, &Config::default());
        assert_eq!(
            validate_explicit_worker_policy(&w, "hi", &reg, false, true)
                .unwrap_err()
                .code,
            "KEY_FORBIDDEN"
        );
        assert_eq!(
            validate_explicit_worker_policy(&w, "hi", &reg, true, false)
                .unwrap_err()
                .code,
            "PAID_APPROVAL_REQUIRED"
        );
        assert!(validate_explicit_worker_policy(&w, "hi", &reg, true, true).is_ok());
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

    #[test]
    fn whole_word_matching_ignores_substrings() {
        let t = word_tokens("preview the monkey keyboard report");
        assert!(!has_word(&t, "review"));
        assert!(!has_word(&t, "key"));
        assert!(!has_word(&t, "port"));
        assert!(has_word(&word_tokens("please review the fixes"), "review"));
        assert!(has_word(&word_tokens("reviewing code"), "review"));
        assert!(has_word(&word_tokens("fixed the bug"), "fix"));
    }

    #[test]
    fn chunks_keep_every_word_and_respect_the_limit() {
        let text = (0..6)
            .map(|i| format!("para{i} {}", "word ".repeat(20)))
            .collect::<Vec<_>>()
            .join("\n\n");
        let chunks = chunk_text(&text, 200);
        assert!(chunks.len() > 1);
        assert!(chunks
            .iter()
            .all(|c| !c.trim().is_empty() && c.chars().count() <= 200));
        let joined = chunks.join(" ");
        for i in 0..6 {
            assert!(joined.contains(&format!("para{i}")));
        }
    }

    #[test]
    fn oversize_paragraph_is_hard_split() {
        let chunks = chunk_text(&"x".repeat(950), 400);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks.iter().map(|c| c.chars().count()).sum::<usize>(), 950);
    }

    #[test]
    fn short_text_is_one_chunk() {
        assert_eq!(chunk_text("a\n\nb", 1000), vec!["a\n\nb".to_string()]);
    }

    #[test]
    fn preference_puts_pi_then_jcode_first() {
        let mk = |agent: &str| DiscoveredWorker {
            id: agent.into(),
            agent: agent.into(),
            key_name: None,
            provider: agent.into(),
            base_url: None,
            model: None,
            write_access: true,
            path: None,
            cost_tier: KeyCostTier::FreeTier,
        };
        assert!(preference_score(&mk("pi")) > preference_score(&mk("jcode")));
        assert!(preference_score(&mk("jcode")) > preference_score(&mk("claude")));
        assert!(preference_score(&mk("claude")) > preference_score(&mk("groq")));
    }
}
