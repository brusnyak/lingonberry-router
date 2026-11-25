//! Lingonberry Router core CLI.
//! Subcommands: discover, route, run, fanout, serve.

use lingonberry_core::discovery::Discovery;
use lingonberry_core::registry::Registry;
use lingonberry_core::server::serve;
use lingonberry_core::storage::{SqliteReceiptStore, SqliteRunStore};
use lingonberry_core::types::{Receipt, ReceiptExclusion, ReceiptSelection, Run, RunState, WorkerResult};

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;
use std::net::SocketAddr;
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Instant;

/// Run history and receipts: ~/.lingonberry/lingonberry.db.
fn default_db_path() -> PathBuf {
    lingonberry_core::config::state_dir().join("lingonberry.db")
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: lingonberry-core <init|doctor|discover|route|run|fanout|serve> [args]");
        std::process::exit(2);
    }
    match args[1].as_str() {
        "discover" => cmd_discover(),
        "serve" => cmd_serve(&args).await,
        "route" => cmd_route(&args).await,
        "run" => cmd_run(&args).await,
        "fanout" => cmd_fanout(&args).await,
        "init" => cmd_init(&args),
        "doctor" => cmd_doctor(),
        other => {
            eprintln!("unknown subcommand: {}", other);
            std::process::exit(2);
        }
    }
}

/// Load the self-config. First run writes ~/.lingonberry/config.json and logs it; an invalid file stops the router
/// with the exact problems, so nothing runs on a config it cannot trust.
fn load_config_or_init() -> lingonberry_core::config::Config {
    use lingonberry_core::config::{self, LoadError};
    match config::load() {
        Ok(c) => c,
        Err(LoadError::Missing) => match config::init(false) {
            Ok((c, created)) => {
                lingonberry_core::events::log("config.init", serde_json::json!({
                    "created": created, "path": config::config_path().display().to_string(),
                }));
                c
            }
            Err(e) => {
                eprintln!("config: {}", e);
                std::process::exit(1);
            }
        },
        Err(LoadError::Invalid(p)) => {
            eprintln!("config invalid ({}): {}", config::config_path().display(), p.join("; "));
            std::process::exit(1);
        }
        Err(LoadError::Unreadable(e)) => {
            eprintln!("config unreadable: {}", e);
            std::process::exit(1);
        }
    }
}

fn cmd_init(args: &[String]) {
    let force = args.iter().any(|a| a == "--force");
    match lingonberry_core::config::init(force) {
        Ok((cfg, created)) => {
            lingonberry_core::events::log("config.init", serde_json::json!({
                "created": created, "forced": force,
                "path": lingonberry_core::config::config_path().display().to_string(),
            }));
            let out = serde_json::json!({
                "config_path": lingonberry_core::config::config_path().display().to_string(),
                "logs_dir": lingonberry_core::config::logs_dir().display().to_string(),
                "created": created,
                "config": cfg,
            });
            println!("{}", serde_json::to_string_pretty(&out).unwrap());
        }
        Err(e) => {
            eprintln!("init failed: {}", e);
            std::process::exit(1);
        }
    }
}

/// Read-only health check. Prints one JSON document; exits 1 if any check fails. Never prints key values.
fn cmd_doctor() {
    use lingonberry_core::config::{self, LoadError};
    let mut checks: Vec<(String, bool, String)> = Vec::new();

    let state = config::state_dir();
    let writable = std::fs::create_dir_all(config::logs_dir()).is_ok()
        && std::fs::OpenOptions::new().create(true).append(true).open(config::logs_dir().join(".doctor-write-test")).is_ok();
    let _ = std::fs::remove_file(config::logs_dir().join(".doctor-write-test"));
    checks.push(("state_dir_writable".into(), writable, state.display().to_string()));

    let cfg = match config::load() {
        Ok(c) => {
            checks.push(("config".into(), true, config::config_path().display().to_string()));
            Some(c)
        }
        Err(LoadError::Missing) => {
            checks.push(("config".into(), false, "missing: run `lingonberry-core init`".into()));
            None
        }
        Err(LoadError::Invalid(p)) => {
            checks.push(("config".into(), false, p.join("; ")));
            None
        }
        Err(LoadError::Unreadable(e)) => {
            checks.push(("config".into(), false, e));
            None
        }
    };

    let db = default_db_path();
    let db_ok = SqliteRunStore::new(db.clone()).is_ok();
    checks.push(("database".into(), db_ok, db.display().to_string()));

    match Discovery::scan() {
        Ok(d) => {
            let cfg_ref = cfg.clone().unwrap_or_default();
            let reg = Registry::from_discovery_with(&d, &cfg_ref);
            let agents: Vec<String> = d.agents.iter().map(|a| a.id.clone()).collect();
            checks.push(("agents".into(), !agents.is_empty(), agents.join(", ")));
            let keys: Vec<String> = d.keys.iter().map(|(p, names)| format!("{}: {}", p, names.join(", "))).collect();
            checks.push(("key_names".into(), !keys.is_empty(), if keys.is_empty() { "none found".into() } else { keys.join(" | ") }));
            let dw = cfg_ref.default_worker.clone();
            let found = reg.find_worker(&dw).is_some() || reg.select_best_worker().is_some();
            checks.push(("default_worker".into(), found, format!("configured {} · routable {}", dw,
                reg.select_best_worker().map(|w| w.id).unwrap_or_else(|| "none".into()))));
            checks.push(("excluded_agents".into(), true, cfg_ref.excluded_agents.join(", ")));
        }
        Err(e) => checks.push(("discovery".into(), false, e)),
    }

    let port = cfg.as_ref().map(|c| c.port).unwrap_or(8799);
    let busy = std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(), std::time::Duration::from_millis(300)).is_ok();
    checks.push(("port".into(), true, if busy { format!("127.0.0.1:{} in use (a router is probably running)", port) } else { format!("127.0.0.1:{} free", port) }));

    let all_ok = checks.iter().all(|(_, ok, _)| *ok);
    lingonberry_core::events::log("doctor.run", serde_json::json!({
        "ok": all_ok, "failed": checks.iter().filter(|c| !c.1).map(|c| c.0.clone()).collect::<Vec<_>>(),
    }));
    let out = serde_json::json!({
        "ok": all_ok,
        "checks": checks.iter().map(|(n, ok, d)| serde_json::json!({"check": n, "ok": ok, "detail": d})).collect::<Vec<_>>(),
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
    if !all_ok {
        std::process::exit(1);
    }
}

fn cmd_discover() {
    match Discovery::scan() {
        Ok(d) => {
            let workers: Vec<_> = d.workers().iter().map(|w| w.id.clone()).collect();
            let json = serde_json::json!({
                "agents": d.agents.iter().map(|a| &a.id).collect::<Vec<_>>(),
                "keys": d.keys,
                "providers": d.providers,
                "workers": workers,
                "library_dirs": d.library_dirs.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>(),
                "ssh_hosts": d.ssh_hosts,
                "git_projects": d.git_projects.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>(),
            });
            println!("{}", serde_json::to_string_pretty(&json).unwrap());
        }
        Err(e) => {
            eprintln!("discover failed: {}", e);
            std::process::exit(1);
        }
    }
}

async fn cmd_serve(args: &[String]) {
    // The config is loaded (and created on first run) below, before the registry is built.
    let port = lingonberry_core::config::load().map(|c| c.port).unwrap_or(8799);
    let addr: SocketAddr = if args.len() > 2 {
        SocketAddr::from_str(&args[2]).unwrap_or_else(|_| format!("127.0.0.1:{}", port).parse().unwrap())
    } else {
        format!("127.0.0.1:{}", port).parse().unwrap()
    };

    let d = match Discovery::scan() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("discover failed: {}", e);
            std::process::exit(1);
        }
    };
    let cfg = load_config_or_init();
    let registry = Registry::from_discovery_with(&d, &cfg);
    let runs = match SqliteRunStore::new(default_db_path()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("db open failed: {}", e);
            std::process::exit(1);
        }
    };
    let receipts = match SqliteReceiptStore::new(default_db_path()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("receipt db open failed: {}", e);
            std::process::exit(1);
        }
    };

    tracing_subscriber::fmt::init();
    lingonberry_core::events::log("server.start", serde_json::json!({"addr": addr.to_string(), "workers": registry.workers.len()}));
    serve(addr, d, registry, runs, receipts).await;
}

/// Parse simple flags: --key value pairs after the positional args.
fn parse_flags(args: &[String]) -> (Vec<String>, HashMap<String, String>) {
    let mut positionals = Vec::new();
    let mut flags = HashMap::new();
    let mut i = 2; // skip binary + subcommand
    while i < args.len() {
        if args[i].starts_with("--") && i + 1 < args.len() && !args[i + 1].starts_with("--") {
            flags.insert(args[i][2..].to_string(), args[i + 1].to_string());
            i += 2;
        } else if args[i].starts_with("--") {
            flags.insert(args[i][2..].to_string(), String::new());
            i += 1;
        } else {
            positionals.push(args[i].clone());
            i += 1;
        }
    }
    (positionals, flags)
}

async fn cmd_route(args: &[String]) {
    let (positionals, flags) = parse_flags(args);
    if positionals.is_empty() {
        eprintln!("usage: lingonberry-core route <prompt> [--phase plan|execute|verify]");
        std::process::exit(2);
    }
    let prompt = positionals.join(" ");
    let phase = flags.get("phase").cloned().unwrap_or_else(|| "plan".to_string());

    let d = match Discovery::scan() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("discover failed: {}", e);
            std::process::exit(1);
        }
    };
    let cfg = load_config_or_init();
    let registry = Registry::from_discovery_with(&d, &cfg);
    let workers = registry.list_workers();

    // --- Constraint-first filtering ---
    let mut exclusions: Vec<ReceiptExclusion> = Vec::new();
    let mut candidates: Vec<&lingonberry_core::discovery::DiscoveredWorker> = workers.iter().collect();

    // 1. Permissions: workers without write_access are excluded for write-heavy tasks
    // (heuristic: prompts containing destructive keywords)
    let destructive = ["delete", "rm ", "drop", "truncate", "destroy", "wipe", "format"];
    let is_destructive = destructive.iter().any(|kw| prompt.to_lowercase().contains(kw));
    if is_destructive {
        candidates.retain(|w| w.write_access);
        let removed = workers.len() - candidates.len();
        if removed > 0 {
            exclusions.push(ReceiptExclusion {
                candidate_id: "key-less/read-only workers".to_string(),
                code: "NO_WRITE_ACCESS".to_string(),
                evidence: format!("prompt contains destructive keyword; {} workers excluded", removed),
            });
        }
    }

    // 2. Host support: key-based workers need their env var set
    candidates.retain(|w| match &w.key_slot {
        Some(ks) => lingonberry_core::discovery::key_value(ks).is_some(),
        None => true, // CLI agents don't need env keys
    });
    let unkeyed: Vec<_> = workers.iter().filter(|w| {
        match &w.key_slot {
            Some(ks) => lingonberry_core::discovery::key_value(ks).is_none(),
            None => false,
        }
    }).collect();
    if !unkeyed.is_empty() {
        exclusions.push(ReceiptExclusion {
            candidate_id: format!("{:?}", unkeyed.iter().map(|w| w.id.as_str()).collect::<Vec<_>>()),
            code: "KEY_NOT_SET".to_string(),
            evidence: "required API key env var not present in environment".to_string(),
        });
    }

    // 3. Risk: NIM workers on cooling are excluded (checked via registry key state)
    // Handled at lease time; here we just note it.

    if candidates.is_empty() {
        let receipt = Receipt {
            receipt_id: lingonberry_core::types::new_receipt_id(),
            context_hash: hash_sha256(&prompt),
            catalog_hash: hash_catalog(&d),
            policy_hash: hash_policy(&exclusions),
            pool_hash: hash_pool(&d.keys),
            registry_hash: hash_registry(&workers),
            phase,
            selected: None,
            alternatives: Vec::new(),
            exclusions,
            abstention: Some("no workers passed constraint filters".to_string()),
            created_at: chrono::Utc::now(),
        };
        store_receipt(&receipt);
        println!("{}", serde_json::to_string_pretty(&receipt).unwrap());
        std::process::exit(0);
    }

    // --- Score remaining workers ---
    // Score: key-less CLI agents first (no key dependency), then key-based by availability.
    let mut scored: Vec<(f64, &lingonberry_core::discovery::DiscoveredWorker)> = candidates
        .into_iter()
        .map(|w| {
            // Default is bare pi (pool across NIM keys); key-less CLIs next; pinned pi:NIM_n last.
            let score = if w.agent == "pi" && w.key_slot.is_none() { 1.0 }
                else if w.key_slot.is_none() { 0.9 } else { 0.8 };
            (score, w)
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let best = scored[0].1;
    let alternatives: Vec<ReceiptSelection> = scored
        .iter()
        .skip(1)
        .map(|(score, w)| ReceiptSelection {
            worker: w.id.clone(),
            model: w.model.clone(),
            effort: None,
            gate: None,
            reason: format!("score={:.2}", score),
        })
        .collect();

    let selected = ReceiptSelection {
        worker: best.id.clone(),
        model: best.model.clone(),
        effort: None,
        gate: None,
        reason: format!("score={:.2}", scored[0].0),
    };

    let receipt = Receipt {
        receipt_id: lingonberry_core::types::new_receipt_id(),
        context_hash: hash_sha256(&prompt),
        catalog_hash: hash_catalog(&d),
        policy_hash: hash_policy(&exclusions),
        pool_hash: hash_pool(&d.keys),
        registry_hash: hash_registry(&workers),
        phase,
        selected: Some(selected),
        alternatives,
        exclusions,
        abstention: None,
        created_at: chrono::Utc::now(),
    };

    store_receipt(&receipt);
    println!("{}", serde_json::to_string_pretty(&receipt).unwrap());
}

async fn cmd_run(args: &[String]) {
    let (positionals, flags) = parse_flags(args);
    if positionals.is_empty() {
        eprintln!("usage: lingonberry-core run <prompt> [--worker <id>] [--gate <name>] [--receipt <id>] [--worktree] [--approve]");
        std::process::exit(2);
    }
    let prompt = positionals.join(" ");
    let worker_id = flags.get("worker").cloned();
    let gate = flags.get("gate").cloned();
    let receipt_id = flags.get("receipt").cloned();
    let use_worktree = flags.contains_key("worktree");
    let auto_approve = flags.contains_key("approve");

    let d = match Discovery::scan() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("discover failed: {}", e);
            std::process::exit(1);
        }
    };
    let cfg = load_config_or_init();
    let registry = Registry::from_discovery_with(&d, &cfg);
    let runs = match SqliteRunStore::new(default_db_path()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("db open failed: {}", e);
            std::process::exit(1);
        }
    };

    // If a receipt is provided, use its selected worker.
    let (worker, key_slot) = if let Some(rid) = &receipt_id {
        let receipt = match find_receipt(rid) {
            Some(r) => r,
            None => {
                eprintln!("receipt not found: {}", rid);
                std::process::exit(1);
            }
        };
        let sel = match &receipt.selected {
            Some(s) => s,
            None => {
                eprintln!("receipt {} has no selection", rid);
                std::process::exit(1);
            }
        };
        let w = match registry.find_worker(&sel.worker) {
            Some(w) => w,
            None => {
                eprintln!("worker {} from receipt not found", sel.worker);
                std::process::exit(1);
            }
        };
        let ks = match registry.key_for(&w).await {
            Ok(k) => k,
            Err(e) => {
                eprintln!("key lease failed for {}: {}", w.id, e);
                std::process::exit(1);
            }
        };
        (w, ks)
    } else {
        // Select worker.
        let worker = match &worker_id {
            Some(id) => match registry.find_worker(id) {
                Some(w) => w,
                None => {
                    eprintln!("worker not found: {}", id);
                    std::process::exit(1);
                }
            },
            None => match registry.select_best_worker() {
                Some(w) => w,
                None => {
                    eprintln!("no workers available");
                    std::process::exit(1);
                }
            },
        };

        // Lease key if the worker needs one.
        let key_slot = match registry.key_for(&worker).await {
            Ok(k) => k,
            Err(e) => {
                eprintln!("key lease failed for {}: {}", worker.id, e);
                std::process::exit(1);
            }
        };
        (worker, key_slot)
    };

    let run_id = lingonberry_core::types::new_run_id();
    let created_at = chrono::Utc::now();
    let caller = resolve_caller(&flags);

    // Insert first, state=running: the UI can list this run and kill it while it works.
    runs.insert(Run {
        id: run_id.clone(),
        created_at,
        worker: worker.id.clone(),
        caller: caller.clone(),
        key_slot: key_slot.clone(),
        model: worker.model.clone(),
        provider: Some(worker.provider.clone()),
        prompt: prompt.clone(),
        gate: gate.clone(),
        state: RunState::Running,
        pid: None,
        elapsed_ms: None,
        gate_passed: None,
        error: None,
        output: None,
        task_class: None,
        receipt_id: receipt_id.clone(),
    });

    lingonberry_core::events::log("run.start", serde_json::json!({
        "run_id": run_id, "worker": worker.id, "key": key_slot, "caller": caller, "gate": gate, "receipt": receipt_id,
    }));
    let started = Instant::now();
    let result = if use_worktree && worker.path.is_some() {
        run_with_worktree(&worker, key_slot.as_deref(), &prompt, auto_approve, &run_id).await
    } else if let Some(path) = worker.path.clone() {
        run_cli_agent_tracked(&runs, &run_id, &worker.agent, &path, &prompt).await
    } else {
        execute_worker(&worker, key_slot.as_deref(), &prompt).await
    };

    let elapsed_ms = started.elapsed().as_millis() as u64;
    let pid = result.pid;
    let output = truncate_output(&result.output, 4000);
    let had_output = !result.output.trim().is_empty();

    runs.finish(
        &run_id,
        if result.ok { RunState::Done } else { RunState::Failed },
        Some(elapsed_ms),
        Some(result.ok),
        if result.ok || !had_output { None } else { Some(truncate_output(&result.output, 800)) },
        if had_output { Some(output) } else { None },
    );
    if let Some(p) = pid {
        runs.set_pid(&run_id, p);
    }

    lingonberry_core::events::log("run.finish", serde_json::json!({
        "run_id": run_id, "worker": worker.id, "key": key_slot, "caller": caller,
        "state": if result.ok { "done" } else { "failed" }, "elapsed_ms": elapsed_ms,
    }));
    // Release key.
    if let Some(ks) = &key_slot {
        registry.release_key(ks, result.ok);
    }

    // Output JSON result.
    let out = serde_json::json!({
        "run_id": run_id,
        "worker": worker.id,
        "caller": caller,
        "key_slot": key_slot,
        "provider": worker.provider,
        "ok": result.ok,
        "elapsed_ms": elapsed_ms,
        "gate_passed": result.ok,
        "output": result.output,
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());

    if !result.ok {
        std::process::exit(1);
    }
}

/// Who invoked the router: --caller, ROUTER_CALLER, else the parent process name.
fn resolve_caller(flags: &HashMap<String, String>) -> Option<String> {
    if let Some(c) = flags.get("caller") {
        let c = c.trim();
        if !c.is_empty() {
            return Some(normalize_caller(c));
        }
    }
    if let Ok(c) = std::env::var("ROUTER_CALLER") {
        if !c.trim().is_empty() {
            return Some(normalize_caller(&c));
        }
    }
    // Walk up past wrappers (timeout, env, nohup, caffeinate...) to the agent that really called us.
    const WRAPPERS: [&str; 8] = ["timeout", "env", "nohup", "caffeinate", "sudo", "xargs", "gtimeout", "script"];
    let own = Command::new("/bin/ps").args(["-o", "ppid=", "-p", &std::process::id().to_string()]).output().ok()?;
    let mut pid: u32 = String::from_utf8_lossy(&own.stdout).trim().parse().ok()?;
    let mut saw_shell = false;
    for _ in 0..8 {
        let out = Command::new("/bin/ps").args(["-o", "ppid=,comm=", "-p", &pid.to_string()]).output().ok()?;
        let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let (ppid_s, comm) = line.split_once(char::is_whitespace)?;
        let comm = comm.trim();
        let base = comm.rsplit('/').next().unwrap_or(comm);
        let ppid: u32 = ppid_s.trim().parse().ok()?;
        if ppid <= 1 || comm.is_empty() {
            return None;
        }
        // A shell is a wrapper too: `claude` runs its tools through zsh, so keep walking to the agent.
        if WRAPPERS.contains(&base) || matches!(base, "zsh" | "bash" | "sh" | "fish" | "login") {
            if matches!(base, "zsh" | "bash" | "sh" | "fish" | "login") {
                saw_shell = true;
            }
            pid = ppid;
            continue;
        }
        return Some(normalize_caller(comm));
    }
    if saw_shell { Some("shell".to_string()) } else { None }
}

fn normalize_caller(raw: &str) -> String {
    let base = raw.rsplit('/').next().unwrap_or(raw).trim().to_string();
    match base.as_str() {
        "zsh" | "bash" | "sh" | "fish" | "login" | "" => "shell".to_string(),
        "node" => "node".to_string(),
        other => other.to_string(),
    }
}

fn truncate_output(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{}\n… truncated", head)
}

/// CLI worker with live visibility: the pid is written to the run row as soon as it spawns,
/// so the UI can show and kill the process while it is still working.
async fn run_cli_agent_tracked(
    runs: &SqliteRunStore,
    run_id: &str,
    agent: &str,
    path: &str,
    prompt: &str,
) -> WorkerResult {
    let started = Instant::now();
    let path_owned = path.to_string();
    let agent_owned = agent.to_string();
    let prompt_owned = prompt.to_string();
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<u32>>();
    let handle = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&path_owned);
        cmd.args(lingonberry_core::agents::agent_argv(&agent_owned, &prompt_owned));
        cmd.stdin(std::process::Stdio::null()); // an agent waiting on stdin would hang the run
        cmd.process_group(0); // own group: a TERM to -pid takes the whole worker tree
        // Must be piped or wait_with_output() captures nothing (the child writes to our terminal).
        cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
        match cmd.spawn() {
            Ok(child) => {
                let pid = child.id();
                let _ = tx.send(Some(pid));
                let output = child.wait_with_output().unwrap_or_else(|e| std::process::Output {
                    status: std::process::ExitStatus::from_raw(1),
                    stdout: Vec::new(),
                    stderr: format!("command wait error: {}", e).into_bytes(),
                });
                (Some(pid), output)
            }
            Err(e) => {
                let _ = tx.send(None);
                let output = std::process::Output {
                    status: std::process::ExitStatus::from_raw(1),
                    stdout: Vec::new(),
                    stderr: format!("command error: {}", e).into_bytes(),
                };
                (None, output)
            }
        }
    });

    if let Ok(Some(pid)) = rx.await {
        runs.mark_running(run_id, Some(pid));
    }

    let elapsed_ms = started.elapsed().as_millis() as u64;
    match handle.await {
        Ok((pid, output)) => {
            let ok = output.status.success();
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let combined = if stderr.is_empty() { stdout } else { format!("{}\n{}", stdout, stderr) };
            WorkerResult { ok, output: combined, worker: path.to_string(), key_slot: None, pid, latency_ms: elapsed_ms, gate_passed: ok }
        }
        Err(_) => WorkerResult { ok: false, output: "task join failed".to_string(), worker: path.to_string(), key_slot: None, pid: None, latency_ms: elapsed_ms, gate_passed: false },
    }
}

fn run_git(cwd: &str, args: &[&str]) -> std::process::Output {
    std::process::Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .unwrap_or_else(|e| std::process::Output {
            status: std::process::ExitStatus::from_raw(1),
            stdout: b"".to_vec(),
            stderr: format!("git spawn error: {}", e).into_bytes(),
        })
}

async fn run_with_worktree(
    worker: &lingonberry_core::discovery::DiscoveredWorker,
    _key_slot: Option<&str>,
    prompt: &str,
    auto_approve: bool,
    run_id: &str,
) -> WorkerResult {
    use std::io::Write;

    // Find git root of current directory.
    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let git_root = match run_git(current_dir.to_str().unwrap(), &["rev-parse", "--show-toplevel"]) {
        output if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        _ => {
            return WorkerResult {
                ok: false,
                output: "not in a git repository; worktree mode requires a git repo".to_string(),
                worker: worker.id.clone(),
                key_slot: None,
                pid: None,
                latency_ms: 0,
                gate_passed: false,
            };
        }
    };

    // Create worktree directory.
    let wt_parent = current_dir.join(".lingonberry").join("worktrees");
    std::fs::create_dir_all(&wt_parent).ok();

    let wt_path = wt_parent.join(format!("wt-{}", &run_id[..8]));

    // Create worktree.
    let create_result = run_git(
        &git_root,
        &["worktree", "add", "--detach", wt_path.to_str().unwrap(), "HEAD"],
    );
    if !create_result.status.success() {
        let stderr = String::from_utf8_lossy(&create_result.stderr).to_string();
        return WorkerResult {
            ok: false,
            output: format!("failed to create worktree: {}", stderr),
            worker: worker.id.clone(),
            key_slot: None,
            pid: None,
            latency_ms: 0,
            gate_passed: false,
        };
    }

    // Run worker in worktree.
    let path = worker.path.as_ref().unwrap().clone();
    let wt_path_clone = wt_path.clone();
    let path_clone = path.clone();
    let prompt_owned = prompt.to_string();
    let started = Instant::now();
    let output = tokio::task::spawn_blocking(move || {
        Command::new(&path_clone)
            .current_dir(&wt_path_clone)
            .arg(prompt_owned)
            .output()
    })
    .await
    .unwrap_or_else(|_| Err(std::io::Error::new(std::io::ErrorKind::Other, "join failed")))
    .unwrap_or_else(|e| std::process::Output {
        status: std::process::ExitStatus::from_raw(1),
        stdout: b"".to_vec(),
        stderr: format!("command error: {}", e).into_bytes(),
    });

    let elapsed_ms = started.elapsed().as_millis() as u64;
    let ok = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = if stderr.is_empty() {
        stdout
    } else {
        format!("{}\n{}", stdout, stderr)
    };

    // Show diff preview.
    let diff_result = run_git(wt_path.to_str().unwrap(), &["diff", "--stat"]);
    let diff_text = String::from_utf8_lossy(&diff_result.stdout).to_string();
    if !diff_text.is_empty() {
        println!(
            "\n=== Worktree diff preview ({}) ===\n{}",
            wt_path.display(),
            diff_text
        );
    } else {
        println!("\n=== No file changes in worktree ===\n");
    }

    // Approval gate.
    let approved = if auto_approve {
        true
    } else {
        print!("\nApply changes from worktree? (y/n): ");
        std::io::stdout().flush().ok();
        let mut input = String::new();
        std::io::stdin().read_line(&mut input).ok();
        input.trim().to_lowercase() == "y"
    };

    // If approved, apply worktree changes back to the main repo.
    if approved {
        if let Ok(entries) = std::fs::read_dir(&wt_path) {
            for entry in entries.flatten() {
                let src = entry.path();
                if src.is_file() {
                    if let Ok(rel) = src.strip_prefix(&wt_path) {
                        let dest = Path::new(&git_root).join(rel);
                        if let Some(parent) = dest.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        let _ = std::fs::copy(&src, &dest);
                    }
                }
            }
        }
    }

    // Clean up worktree.
    let _ = run_git(&git_root, &["worktree", "remove", "--force", wt_path.to_str().unwrap()]);

    WorkerResult {
        ok,
        output: combined,
        worker: path,
        key_slot: None,
        pid: None,
        latency_ms: elapsed_ms,
        gate_passed: ok && approved,
    }
}

async fn cmd_fanout(args: &[String]) {
    let (positionals, _flags) = parse_flags(args);
    if positionals.is_empty() {
        eprintln!("usage: lingonberry-core fanout <prompt1> <prompt2> ...");
        std::process::exit(2);
    }

    let d = match Discovery::scan() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("discover failed: {}", e);
            std::process::exit(1);
        }
    };
    let cfg = load_config_or_init();
    let registry = Arc::new(Registry::from_discovery_with(&d, &cfg));
    let runs = Arc::new(SqliteRunStore::new(default_db_path()).expect("db open"));

    let workers: Vec<lingonberry_core::discovery::DiscoveredWorker> = registry.list_workers();
    if workers.is_empty() {
        eprintln!("no workers available");
        std::process::exit(1);
    }

    let n = positionals.len();
    let mut handles = Vec::with_capacity(n);

    for (idx, prompt) in positionals.into_iter().enumerate() {
        let registry = registry.clone();
        let runs = runs.clone();
        let worker_pool = workers.clone();
        let handle = tokio::task::spawn(async move {
            // Round-robin worker selection for fanout.
            let worker = &worker_pool[idx % worker_pool.len()];
            let key_slot = match registry.key_for(worker).await {
                Ok(k) => k,
                Err(e) => {
                    return serde_json::json!({
                        "prompt": prompt,
                        "worker": worker.id,
                        "ok": false,
                        "error": format!("key lease failed: {}", e),
                    });
                }
            };

            let started = Instant::now();
            let result = execute_worker(worker, key_slot.as_deref(), &prompt).await;
            let elapsed_ms = started.elapsed().as_millis() as u64;

            let run_id = lingonberry_core::types::new_run_id();
            let run = Run {
                id: run_id.clone(),
                created_at: chrono::Utc::now(),
                worker: worker.id.clone(),
                caller: env::var("ROUTER_CALLER").ok().map(|c| normalize_caller(&c)),
                key_slot: key_slot.clone(),
                model: worker.model.clone(),
                provider: Some(worker.provider.clone()),
                prompt,
                gate: None,
                state: if result.ok { RunState::Done } else { RunState::Failed },
                pid: result.pid,
                elapsed_ms: Some(elapsed_ms),
                gate_passed: Some(result.ok),
                error: if result.ok { None } else { Some(result.output.clone()) },
                output: Some(truncate_output(&result.output, 4000)),
                task_class: None,
                receipt_id: None,
            };
            runs.insert(run);

            if let Some(ks) = &key_slot {
                registry.release_key(ks, result.ok);
            }

            serde_json::json!({
                "run_id": run_id,
                "worker": worker.id,
                "key_slot": key_slot,
                "provider": worker.provider,
                "ok": result.ok,
                "elapsed_ms": elapsed_ms,
                "gate_passed": result.ok,
                "output": result.output,
            })
        });
        handles.push(handle);
    }

    let mut results = Vec::with_capacity(n);
    for handle in handles {
        match handle.await {
            Ok(v) => results.push(v),
            Err(e) => results.push(serde_json::json!({"ok": false, "error": format!("task join failed: {}", e)})),
        }
    }

    println!("{}", serde_json::to_string_pretty(&serde_json::json!(results)).unwrap());

    let all_ok = results.iter().all(|r| r.get("ok").and_then(|v| v.as_bool()).unwrap_or(false));
    if !all_ok {
        std::process::exit(1);
    }
}

/// Execute a task on a worker.
/// CLI agents (path is Some) run as a subprocess; key-based workers (path is None, key_slot is Some)
/// call the provider's chat/completions HTTP endpoint.
async fn execute_worker(
    worker: &lingonberry_core::discovery::DiscoveredWorker,
    key_slot: Option<&str>,
    prompt: &str,
) -> WorkerResult {
    // CLI agent execution: run the binary with the prompt.
    if let Some(path) = &worker.path {
        return run_cli_agent(&worker.agent, path, prompt).await;
    }

    // Key-based API execution: POST to provider chat/completions.
    if let Some(ks) = key_slot {
        if let Some(api_key) = lingonberry_core::discovery::key_value(ks) {
            return call_provider_api(worker, &api_key, prompt).await;
        }
        return WorkerResult {
            ok: false,
            output: format!("env var {} not set", ks),
            worker: worker.id.clone(),
            key_slot: Some(ks.to_string()),
            pid: None,
            latency_ms: 0,
            gate_passed: false,
        };
    }

    WorkerResult {
        ok: false,
        output: format!("worker {} has no binary path and no key slot", worker.id),
        worker: worker.id.clone(),
        key_slot: None,
        pid: None,
        latency_ms: 0,
        gate_passed: false,
    }
}

async fn run_cli_agent(agent: &str, path: &str, prompt: &str) -> WorkerResult {
    let started = Instant::now();
    let path = path.to_string();
    let prompt = prompt.to_string();
    let agent = agent.to_string();
    let path_for_result = path.clone();
    let result = tokio::task::spawn_blocking(move || {
        let pid = match Command::new(&path)
            .args(lingonberry_core::agents::agent_argv(&agent, &prompt))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .process_group(0)
            .spawn()
        {
            Ok(child) => {
                let pid = Some(child.id());
                let output = child.wait_with_output().unwrap_or_else(|e| std::process::Output {
                    status: std::process::ExitStatus::from_raw(1),
                    stdout: b"".to_vec(),
                    stderr: format!("command wait error: {}", e).into_bytes(),
                });
                (pid, output)
            }
            Err(e) => {
                let output = std::process::Output {
                    status: std::process::ExitStatus::from_raw(1),
                    stdout: b"".to_vec(),
                    stderr: format!("command error: {}", e).into_bytes(),
                };
                (None, output)
            }
        };
        pid
    }).await;

    let elapsed_ms = started.elapsed().as_millis() as u64;

    match result {
        Ok((pid, output)) => {
            let ok = output.status.success();
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let combined = if stderr.is_empty() { stdout } else { format!("{}\n{}", stdout, stderr) };
            WorkerResult {
                ok,
                output: combined,
                worker: path_for_result.clone(),
                key_slot: None,
                pid,
                latency_ms: elapsed_ms,
                gate_passed: ok,
            }
        }
        Err(_) => WorkerResult {
            ok: false,
            output: "task join failed".to_string(),
            worker: path_for_result.clone(),
            key_slot: None,
            pid: None,
            latency_ms: elapsed_ms,
            gate_passed: false,
        },
    }
}

async fn call_provider_api(
    worker: &lingonberry_core::discovery::DiscoveredWorker,
    api_key: &str,
    prompt: &str,
) -> WorkerResult {
    let started = Instant::now();
    let base_url = worker.base_url.as_deref().unwrap_or("https://api.openai.com/v1");
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": worker.model.as_deref().unwrap_or("default"),
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
        "max_tokens": 4000,
    });

    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&body)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await;

    let elapsed_ms = started.elapsed().as_millis() as u64;

    match resp {
        Ok(r) if r.status().is_success() => {
            let text = r.text().await.unwrap_or_default();
            WorkerResult {
                ok: true,
                output: text,
                worker: worker.id.clone(),
                key_slot: worker.key_slot.clone(),
                pid: None,
                latency_ms: elapsed_ms,
                gate_passed: true,
            }
        }
        Ok(r) => {
            let status = r.status();
            let text = r.text().await.unwrap_or_default();
            WorkerResult {
                ok: false,
                output: format!("HTTP {}: {}", status, text),
                worker: worker.id.clone(),
                key_slot: worker.key_slot.clone(),
                pid: None,
                latency_ms: elapsed_ms,
                gate_passed: false,
            }
        }
        Err(e) => WorkerResult {
            ok: false,
            output: format!("request error: {}", e),
            worker: worker.id.clone(),
            key_slot: worker.key_slot.clone(),
            pid: None,
            latency_ms: elapsed_ms,
            gate_passed: false,
        },
    }
}

// --- Receipt storage helpers ---

fn store_receipt(receipt: &Receipt) {
    let db_path = default_db_path();
    if let Ok(store) = SqliteReceiptStore::new(db_path) {
        store.insert(receipt);
    }
}

fn find_receipt(receipt_id: &str) -> Option<Receipt> {
    let db_path = default_db_path();
    if let Ok(store) = SqliteReceiptStore::new(db_path) {
        return store.get(receipt_id);
    }
    None
}

// --- Hash helpers for receipt integrity ---

fn hash_sha256(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn hash_catalog(d: &Discovery) -> String {
    let mut hasher = Sha256::new();
    for dir in &d.library_dirs {
        hasher.update(dir.to_string_lossy().as_bytes());
    }
    for ssh in &d.ssh_hosts {
        hasher.update(ssh.as_bytes());
    }
    for proj in &d.git_projects {
        hasher.update(proj.to_string_lossy().as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn hash_policy(exclusions: &[ReceiptExclusion]) -> String {
    let mut hasher = Sha256::new();
    for e in exclusions {
        hasher.update(e.code.as_bytes());
        hasher.update(e.evidence.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn hash_pool(keys: &std::collections::BTreeMap<String, Vec<String>>) -> String {
    let mut hasher = Sha256::new();
    for (prov, names) in keys {
        hasher.update(prov.as_bytes());
        for name in names {
            hasher.update(name.as_bytes());
        }
    }
    format!("{:x}", hasher.finalize())
}

fn hash_registry(workers: &[lingonberry_core::discovery::DiscoveredWorker]) -> String {
    let mut hasher = Sha256::new();
    for w in workers {
        hasher.update(w.id.as_bytes());
        if let Some(ks) = &w.key_slot {
            hasher.update(ks.as_bytes());
        }
    }
    format!("{:x}", hasher.finalize())
}
