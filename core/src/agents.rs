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
    path: String,
    body: String,
}

/// Prompt is split into chunks of at most this many chars; longer input runs map-reduce.
pub const CHUNK_CHARS: usize = 12_000;
/// Skill body injected into the cooked prompt, capped.
const SKILL_BODY_CHARS: usize = 4_000;
/// Default dispatch order: pi, jcode, then the other CLI agents. Direct provider APIs come last.
pub const WORKER_ORDER: &[&str] = &["pi", "jcode", "omp", "opencode", "kilo", "codex", "claude"];
const STOPWORDS: &[&str] = &[
    "that", "this", "with", "from", "your", "have", "will", "into", "about", "just", "make",
    "want", "need", "then", "them", "they", "what", "when", "where", "which", "there",
];

/// Lowercase alphanumeric words of a text. Whole words only, so "preview" is not "review".
pub fn word_tokens(text: &str) -> BTreeSet<String> {
    text.to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect()
}

/// True when the keyword occurs as a word or with a plain inflection (s, es, ed, ing).
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
    1.0 - rank as f64 * 0.05
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

pub fn cook_prompt(
    raw_prompt: &str,
    discovery: &DiscoveryData,
    phase: &str,
    use_worktree: bool,
) -> CookedPromptInfo {
    let tokens = word_tokens(raw_prompt);

    let (task_class, mut selected_skill, selected_command, selected_hook, gate_policy) =
        if ["bug", "fix", "error", "fail", "crash", "stack", "broken", "debug"]
            .iter()
            .any(|kw| has_word(&tokens, kw))
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
            .any(|kw| has_word(&tokens, kw))
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
        .any(|kw| has_word(&tokens, kw))
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
            .any(|kw| has_word(&tokens, kw))
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
    let mut selected_body: Option<String> = None;
    let mut selected_path: Option<String> = None;
    for sk in local_skills {
        let hay = word_tokens(&format!("{} {}", sk.name, sk.description));
        let score = tokens
            .iter()
            .filter(|t| t.len() >= 4 && !STOPWORDS.contains(&t.as_str()) && hay.contains(t.as_str()))
            .count();
        // Require more than a single shared word before a local skill displaces the default;
        // otherwise short/plain prompts pick up a mismatched skill body (e.g. score 1.00).
        if score >= 2 && score > best_score {
            best_score = score;
            selected_skill = sk.name.clone();
            selected_body = Some(sk.body);
            selected_path = Some(sk.path);
        }
    }

    let mut retrieval_sources = Vec::new();
    if let Some(path) = &selected_path {
        retrieval_sources.push(path.clone());
    }
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
    let skill_block = match &selected_body {
        Some(body) => format!("\n[Skill body: {selected_skill}]\n{}\n", redact_secrets(body)),
        None => String::new(),
    };
    let cooked_prompt = format!(
        "[Constitution: global-agentic-skills · {selected_skill}]\n\
         [Task Class: {task_class} · Command: {selected_command}]\n\
         [Hook: {selected_hook} · Gate: {gate_policy}]\n\
         [Retrieved Context: {}]{skill_block}\n\
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

/// Routes with the owner's full worker set (CLI, tests, the owner's own jobs).
pub fn route_prompt(
    prompt: &str,
    phase: &str,
    caller: Option<&str>,
    discovery: &DiscoveryData,
    registry: &Registry,
    use_worktree: bool,
) -> Receipt {
    route_prompt_with(prompt, phase, caller, discovery, registry, use_worktree, true)
}

/// `allow_keys = false` for every caller except the owner: API-key workers are excluded, so an
/// agent that calls the router spends its own configured CLI login, never the owner's keys.
pub fn route_prompt_with(
    prompt: &str,
    phase: &str,
    caller: Option<&str>,
    discovery: &DiscoveryData,
    registry: &Registry,
    use_worktree: bool,
    allow_keys: bool,
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

    // 3. Key availability constraint
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

    // 3b. Listed but not dispatchable: a provider key with no known base URL or model
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

    // 3a. Owner keys are reserved for the owner. Other callers use their own CLI workers only.
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

    // 4. Key cooldown constraint
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
                "no workers passed constraint filters (add a provider key or install a CLI agent)"
                    .to_string(),
            ),
            created_at: Utc::now().to_rfc3339(),
            caller: caller.map(str::to_string),
            cooked: Some(cooked),
        };
    }

    let mut scored: Vec<(f64, DiscoveredWorker)> = {
        // Capacity tiebreak: among workers of the same agent family (all `pi:*` score 1.00),
        // prefer the provider with the most free key slots. Weight is below the 0.05 agent-rank
        // gap, so it never promotes a CLI worker over `pi`, only spreads pi traffic across
        // providers as keys saturate.
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
/// so the execution engine can automatically retry on a sibling key.
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

/// Calls an OpenAI-compatible provider endpoint using only the resolved key value at request time.
pub async fn call_provider_api(
    base_url: &str,
    key_name: &str,
    model: &str,
    cooked_prompt: &str,
) -> anyhow::Result<(String, Option<String>)> {
    let api_key = resolve_key_value(key_name)
        .ok_or_else(|| anyhow::anyhow!("key {key_name} value missing at dispatch time"))?;
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    // Timeout and token budget are env-tunable: a stalled NIM socket used to hang the run forever,
    // and 512 tokens is below the reasoning budget of nemotron-3.5-super-vl (empty content, finish=length).
    let timeout_s: u64 = std::env::var("LINGONBERRY_HTTP_TIMEOUT_S").ok().and_then(|v| v.parse().ok()).unwrap_or(240);
    let max_tokens: u64 = std::env::var("LINGONBERRY_MAX_TOKENS").ok().and_then(|v| v.parse().ok()).unwrap_or(8192);
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
        // A 4xx body used to parse as success with empty content, so the gate "passed" on nothing.
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("HTTP {}: {}", status.as_u16(), redact_secrets(&text.chars().take(300).collect::<String>()));
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
        anyhow::bail!("truncated: empty content at max_tokens={max_tokens} (raise LINGONBERRY_MAX_TOKENS)");
    }
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
            stores: vec![],
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
        // crush is not in WRITE_AGENTS, so it is the read-only worker this test needs.
        discovery.agents.push(crate::types::Agent {
            id: "crush".into(),
            path: Some("/bin/true".into()),
        });
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
            stores: vec![],
        };
        discovery.keys.insert("groq".into(), vec!["GROQ_API_KEY".into()]);
        let reg = Registry::new(&discovery, &Config::default());
        reg.mark_worker_down("pi:groq", true);
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

/// Splits text at blank lines into pieces of at most `max` chars. Paragraphs longer than `max`
/// are hard-split. Never returns an empty list.
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

/// One provider call, or map-reduce when the objective is longer than CHUNK_CHARS.
/// Map: each chunk is answered under the same header. Reduce: one call merges the answers.
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
mod prompt_tests {
    use super::*;

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
        assert!(chunks.iter().all(|c| !c.trim().is_empty() && c.chars().count() <= 200));
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
        };
        assert!(preference_score(&mk("pi")) > preference_score(&mk("jcode")));
        assert!(preference_score(&mk("jcode")) > preference_score(&mk("claude")));
        assert!(preference_score(&mk("claude")) > preference_score(&mk("groq")));
    }
}
