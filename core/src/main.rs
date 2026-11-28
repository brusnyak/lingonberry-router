use anyhow::Result;
use clap::{Parser, Subcommand};
use lingonberry_core::agents::{apply_self_config_targets, build_self_config_plan, route_prompt};
use lingonberry_core::config::{
    api_token_path, ensure_api_token, load_config, validate_config, write_default_config,
};
use lingonberry_core::discovery::{configure_pi_rust, recommended_pi_install_cmd, scan_discovery};
use lingonberry_core::harness::{build_readiness_report, ensure_mini_harness};
use lingonberry_core::registry::Registry;
use lingonberry_core::server::{build_router, dispatch_run_async, serve, AppState, DispatchOptions};
use lingonberry_core::storage::SqliteStore;
use lingonberry_core::types::RunState;
use std::collections::BTreeSet;
use std::io::{self, BufRead, Write};

#[derive(Parser)]
#[command(name = "lingonberry-core", version, about = "Lingonberry AI Agent Router")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize ~/.lingonberry/config.json, bearer token, mini-harness, and pi-rust proxy
    Init {
        #[arg(long)]
        force: bool,
        #[arg(long)]
        yes: bool,
    },
    /// Read-only health & readiness check printed as JSON
    Doctor,
    /// Print discovered agents, key names, providers, and library dirs
    Discover,
    /// Compute routing receipt without executing any model
    Route {
        prompt: String,
        #[arg(long, default_value = "plan")]
        phase: String,
        #[arg(long, env = "ROUTER_CALLER")]
        caller: Option<String>,
        #[arg(long)]
        worktree: bool,
    },
    /// Dispatch one task through the router
    Run {
        prompt: String,
        #[arg(long)]
        worker: Option<String>,
        #[arg(long, env = "ROUTER_CALLER")]
        caller: Option<String>,
        #[arg(long)]
        worktree: bool,
        #[arg(long)]
        live_api: bool,
        /// Verification gate command/preset to run before marking gate_passed (e.g. test, build, gitleaks, or custom cmd)
        #[arg(long)]
        gate: Option<String>,
        /// Approve metered/paid keys or open-ended execution
        #[arg(long)]
        approve: bool,
        /// Enforce read-only / non-mutating intent
        #[arg(long)]
        read_only: bool,
        /// Optional approved Kiro Spec ID locking overnight / scoped execution
        #[arg(long)]
        spec: Option<String>,
        /// Sandbox tier override (seatbelt | docker | worktree_only)
        #[arg(long)]
        sandbox: Option<String>,
    },
    /// Dispatch multiple prompts in parallel across workers
    Fanout {
        prompts: Vec<String>,
        #[arg(long, env = "ROUTER_CALLER")]
        caller: Option<String>,
        #[arg(long)]
        worktree: bool,
        #[arg(long)]
        approve: bool,
    },
    /// Preview or apply global-first self-configuration pointers
    SelfConfig {
        #[arg(long)]
        apply: bool,
    },
    /// Start the loopback HTTP server
    Serve {
        #[arg(default_value = "127.0.0.1:8799")]
        addr: String,
    },
    /// Run stdio JSON-RPC MCP tool server (route, discover, snapshot, self_config)
    Mcp,
}

#[tokio::main]
async fn main() -> Result<()> {
    lingonberry_core::discovery::ensure_tool_path();
    let cli = Cli::parse();
    match cli.command {
        Commands::Init { force, yes } => {
            let cfg_path = write_default_config(force)?;
            let _ = ensure_api_token()?;
            let _ = ensure_mini_harness();
            let disc = scan_discovery();
            let cfg = load_config()?;
            let plan = build_self_config_plan(&disc, &cfg, &BTreeSet::new());
            if let Some(home) = dirs::home_dir() {
                let _ = configure_pi_rust(&home, &disc);
            }
            let readiness = build_readiness_report(&disc, &cfg.key_tiers);
            let mut pi_install_note: Option<String> = None;
            if !readiness.pi_installed {
                if let Some((prog, args)) = recommended_pi_install_cmd() {
                    if yes {
                        let status = std::process::Command::new(prog).args(&args).status();
                        pi_install_note = Some(match status {
                            Ok(s) if s.success() => "pi-rust installed".into(),
                            Ok(s) => format!("pi-rust install exited {:?}", s.code()),
                            Err(e) => format!("pi-rust install error: {e}"),
                        });
                    } else {
                        pi_install_note = Some(format!(
                            "pi-rust missing; run `{prog} {}` or re-run with `lingonberry-core init --yes`",
                            args.join(" ")
                        ));
                    }
                }
            }
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "ok": true,
                    "config_path": cfg_path,
                    "readiness": readiness,
                    "pi_install": pi_install_note,
                    "self_config": plan
                }))?
            );
        }
        Commands::Doctor => {
            let cfg = load_config()?;
            validate_config(&cfg)?;
            let disc = scan_discovery();
            let reg = Registry::new(&disc, &cfg);
            let workers = reg.list_workers();
            let readiness = build_readiness_report(&disc, &cfg.key_tiers);
            let token_ok = api_token_path().exists();
            let ok = token_ok && readiness.mini_harness_ready;
            let needs_keys = workers.is_empty();
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "ok": ok,
                    "token_ok": token_ok,
                    "needs_keys": needs_keys,
                    "port": cfg.port,
                    "agents": disc.agents.len(),
                    "keys": disc.keys.values().map(Vec::len).sum::<usize>(),
                    "workers": workers.len(),
                    "readiness": readiness,
                }))?
            );
            if !ok {
                std::process::exit(1);
            }
        }
        Commands::Discover => {
            let cfg = load_config()?;
            let disc = scan_discovery();
            let reg = Registry::new(&disc, &cfg);
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "discovery": disc,
                    "workers": reg.list_workers()
                }))?
            );
        }
        Commands::Route {
            prompt,
            phase,
            caller,
            worktree,
        } => {
            let cfg = load_config()?;
            let disc = scan_discovery();
            let reg = Registry::new(&disc, &cfg);
            let receipt = route_prompt(&prompt, &phase, caller.as_deref(), &disc, &reg, worktree);
            println!("{}", serde_json::to_string_pretty(&receipt)?);
        }
        Commands::Run {
            prompt,
            worker,
            caller,
            worktree,
            live_api,
            gate,
            approve,
            read_only,
            spec,
            sandbox,
        } => {
            let cfg = load_config()?;
            let disc = scan_discovery();
            let store = SqliteStore::open_default()?;
            let state = AppState::new(cfg, disc, store);
            let _ = build_router(state.clone());
            let run = dispatch_run_async(
                state.clone(),
                DispatchOptions {
                    prompt,
                    caller,
                    worker_id: worker,
                    phase: "execute".into(),
                    use_worktree: worktree && !read_only,
                    simulate_fault: None,
                    live_api,
                    fanout_group: None,
                    allow_keys: true,
                    allow_paid: approve,
                    gate_cmd: gate,
                    read_only,
                    path_globs: None,
                    sandbox_tier: sandbox,
                    spec_id: spec,
                },
            );
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(900);
            while state
                .store
                .get_run(&run.id)
                .map(|r| r.state == RunState::Running || r.state == RunState::Leased)
                .unwrap_or(true)
                && std::time::Instant::now() < deadline
            {
                tokio::time::sleep(std::time::Duration::from_millis(80)).await;
            }
            let final_run = state.store.get_run(&run.id).unwrap_or(run);
            match final_run.state {
                RunState::Done => {
                    if let Some(output) = &final_run.output {
                        print!("{output}");
                    } else {
                        println!("{}", serde_json::to_string_pretty(&final_run)?);
                    }
                }
                RunState::Failed | RunState::Escalated | RunState::Blocked => {
                    eprintln!(
                        "{}",
                        final_run.error.unwrap_or_else(|| "run failed".to_string())
                    );
                    std::process::exit(1);
                }
                _ => {
                    eprintln!("run timed out waiting for completion");
                    std::process::exit(1);
                }
            }
        }
        Commands::Fanout {
            prompts,
            caller,
            worktree,
            approve,
        } => {
            let cfg = load_config()?;
            let disc = scan_discovery();
            let store = SqliteStore::open_default()?;
            let state = AppState::new(cfg, disc, store);
            let workers = state.registry.list_workers();
            let group = format!("fan-{}", &uuid::Uuid::new_v4().to_string()[..6]);
            let mut ids = Vec::new();
            for (idx, p) in prompts.into_iter().enumerate() {
                let w_id = workers.get(idx % workers.len().max(1)).map(|w| w.id.clone());
                let r = dispatch_run_async(
                    state.clone(),
                    DispatchOptions {
                        prompt: p,
                        caller: caller.clone(),
                        worker_id: w_id,
                        phase: "fanout".into(),
                        use_worktree: worktree,
                        simulate_fault: None,
                        live_api: false,
                        fanout_group: Some(group.clone()),
                        allow_keys: true,
                        allow_paid: approve,
                        gate_cmd: None,
                        read_only: false,
                        ..Default::default()
                    },
                );
                ids.push(r.id);
            }
            while ids.iter().any(|id| {
                state
                    .store
                    .get_run(id)
                    .map(|r| r.state == RunState::Running || r.state == RunState::Leased)
                    .unwrap_or(false)
            }) {
                tokio::time::sleep(std::time::Duration::from_millis(80)).await;
            }
            let final_runs: Vec<_> = ids.iter().filter_map(|id| state.store.get_run(id)).collect();
            println!("{}", serde_json::to_string_pretty(&final_runs)?);
        }
        Commands::SelfConfig { apply } => {
            let cfg = load_config()?;
            let disc = scan_discovery();
            let mut applied = BTreeSet::new();
            let plan = build_self_config_plan(&disc, &cfg, &applied);
            if apply {
                let all_paths: BTreeSet<String> = plan.targets.iter().map(|t| t.path.clone()).collect();
                for p in apply_self_config_targets(&plan, &all_paths) {
                    applied.insert(p);
                }
            }
            let refreshed = build_self_config_plan(&disc, &cfg, &applied);
            println!("{}", serde_json::to_string_pretty(&refreshed)?);
        }
        Commands::Serve { addr } => {
            serve(&addr).await?;
        }
        Commands::Mcp => {
            let stdin = io::stdin();
            let mut stdout = io::stdout();
            for line in stdin.lock().lines().map_while(Result::ok) {
                let Ok(req) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                let Some(id) = req.get("id").cloned() else {
                    continue;
                };
                let method = req["method"].as_str().unwrap_or("");
                let result = match method {
                    "initialize" => serde_json::json!({
                        "protocolVersion": "2024-11-05",
                        "serverInfo": { "name": "lingonberry-core", "version": env!("CARGO_PKG_VERSION") },
                        "capabilities": { "tools": {} }
                    }),
                    "tools/list" => serde_json::json!({
                        "tools": [
                            {
                                "name": "lingonberry_route",
                                "description": "Cook raw prompt with global/mini-harness skills and compute a constraint-checked routing receipt",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "prompt": { "type": "string" },
                                        "phase": { "type": "string" },
                                        "caller": { "type": "string" },
                                        "worktree": { "type": "boolean" }
                                    },
                                    "required": ["prompt"]
                                }
                            },
                            {
                                "name": "lingonberry_discover",
                                "description": "List discovered CLI agents, provider key names (never values), and skill directories",
                                "inputSchema": { "type": "object", "properties": {} }
                            },
                            {
                                "name": "lingonberry_snapshot",
                                "description": "Return current router snapshot: live workers, keys, host cron jobs, readiness, and sessions",
                                "inputSchema": { "type": "object", "properties": {} }
                            },
                            {
                                "name": "lingonberry_self_config",
                                "description": "Inspect global-first skill, constitution, and MCP configuration targets",
                                "inputSchema": { "type": "object", "properties": {} }
                            }
                        ]
                    }),
                    "tools/call" => {
                        let tool_name = req["params"]["name"].as_str().unwrap_or("");
                        let args = &req["params"]["arguments"];
                        let cfg = load_config().unwrap_or_default();
                        let disc = scan_discovery();
                        let reg = Registry::new(&disc, &cfg);
                        let payload = match tool_name {
                            "lingonberry_route" => {
                                let prompt = args["prompt"].as_str().unwrap_or("health check");
                                let phase = args["phase"].as_str().unwrap_or("plan");
                                let caller = args["caller"].as_str();
                                let worktree = args["worktree"].as_bool().unwrap_or(false);
                                serde_json::to_value(route_prompt(
                                    prompt, phase, caller, &disc, &reg, worktree,
                                ))
                                .unwrap_or_default()
                            }
                            "lingonberry_discover" => serde_json::json!({
                                "discovery": disc,
                                "workers": reg.list_workers(),
                            }),
                            "lingonberry_snapshot" => {
                                let store = SqliteStore::open_default()
                                    .or_else(|_| SqliteStore::open_in_memory())
                                    .unwrap();
                                let st = AppState::new(cfg, disc, store);
                                serde_json::to_value(st.build_snapshot()).unwrap_or_default()
                            }
                            "lingonberry_self_config" => serde_json::to_value(
                                build_self_config_plan(&disc, &cfg, &BTreeSet::new()),
                            )
                            .unwrap_or_default(),
                            other => serde_json::json!({ "error": format!("unknown tool: {other}") }),
                        };
                        serde_json::json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&payload).unwrap_or_default()
                            }]
                        })
                    }
                    _ => serde_json::json!({ "ok": true }),
                };
                let resp = serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result });
                writeln!(stdout, "{resp}")?;
                stdout.flush()?;
            }
        }
    }
    Ok(())
}
