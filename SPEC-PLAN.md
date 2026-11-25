> Historical plan from the Python-era rewrite. Product name is Lingonberry Router; see `README.md`. References to FlorianBruniaux/agent-router are a third-party project, not this one.

# Lingonberry Router — Spec & Plan (DRAFT v1, 2026-11-24)

Single source of truth for the rewrite: Rust core + native UI per platform. Replaces the Python `backbone` baseline without changing the product intent (VISION.md, AGENT_ROUTER.md, COMPONENTS.md, STACK.md remain valid; stack and implementation change).

## 1. Name

**Lingonberry Router.** Raw prompts are sour/unpleasant (lingonberry raw); cooked into an engineered prompt + verified result, they're delicious. Unique, no collision with `agent-router`. Needs GitHub/domain check before committing.

## 2. Product (one sentence)

Turn a raw, possibly rambling request into an engineered prompt (persona + command + skill + hook + loop + style + gate), dispatch it to the right worker across **all** available API keys in parallel, verify against evidence gates, and show the whole flow in a native menu-bar graph — zero setup, one install.

## 3. Architecture

| Layer | Tech | Role |
|---|---|---|
| Core | Rust (static binary) | Discovery, worker registry, dispatch, keys, gates, SQLite, receipts, HTTP API |
| macOS UI | Swift (SwiftUI, NSStatusItem) | Menu bar, popover, adaptive orchestration graph, kill workers |
| Windows/Linux UI | Rust + native tray (tray-rs or equivalent) | Same graph, same controls, platform-native |
| IPC | HTTP on 127.0.0.1:8799 (loopback only) | UI talks to core; one GET `/snapshot` per 5 s popover open |
| Auth | Optional token from `ROUTER_TOKEN` / `~/.agent-router/node.env` | Not required for loopback-only; present if operator sets it |

**Why not Python:** macOS system Python is PEP 668 externally-managed; requiring `venv` + `pip` is friction. Rust = one static binary, no user Python, no venv, "pull it, scan it, works."

**Why not FFI:** HTTP keeps UI and core decoupled, debuggable with curl, and identical on all three platforms. Latency is irrelevant for a 5 s refresh dashboard.

## 4. Core capabilities (P0–P5)

### P0 — Discovery + dynamic worker registry (no hard-coding)
- Scan: agent CLIs on PATH (claude, codex, opencode, kilo, pi, cline, jcode, goose, omp, hermes, crush), API key names in `~/.env` + env files (values never read), providers from `providers.yaml` (nim, openrouter, groq, mistral, openai, deepseek, together, fireworks, cerebras, xai, gemini, anthropic), skills/commands/prompts from library dirs, SSH hosts, git projects, browsers.
- Build registry: every `(agent, key_slot, provider, base_url, model)` tuple is a dispatchable worker. Example: `pi:NIM_1`, `pi:NIM_2`, `groq:GROQ_API_KEY`, `openrouter:OPENROUTER_API_KEY`, `claude`, `codex`, `jcode:NIM_1`.
- No `DEFAULT_WORKERS` table. No hard-coded `nim5` references. `routes.yaml` validated against registry at startup; unknown routes fall back to first available worker of the right class.
- `allowed()` returns exactly discovered workers.

### P1 — Full-capacity orchestration (parallel, all keys)
- Fanout: dispatch N independent tasks to N workers on N keys in parallel (not one key, one at a time).
- Swarm: split a goal into subtasks, run each on an available worker/key, integrate.
- Delegate: bounded subagents (depth 1), each with packet (prompt, owned files, gate).
- KeyPool: per-key leasing, cooldown on 429/5xx, rpm limit, failover across all keys of a provider.
- Every run recorded: worker, key_slot (actual leased key), model, provider, pid, elapsed, gate result.

### P2 — Pre-execution routing + receipts (borrowed from FlorianBruniaux/agent-router, adapted)
- `route` command (offline, no model call): constraint-first filtering (permissions, budget, risk, host support) → exclusions with code + evidence → score → selection.
- Receipt: `receipt_id`, `context_hash`, `catalog_hash`, `policy_hash`, `pool_hash`, `registry_hash`, selected + alternatives + exclusions + abstention reason. Stored in SQLite, viewable via `runs show` and in the menu bar.
- `run` executes an approved receipt; no silent writes.

### P3 — Worktree preview/approve
- `Workspace` (git worktree per run, isolated). Dispatch prepares a worktree, prints the diff, waits for approval (`--approve` or interactive), then applies. No writes without a visible patch.

### P4 — Native menu bar (Swift macOS, native tray Win/Linux)
- One app lifecycle: UI starts/stops the Rust core child process. Quit = stop core + quit UI.
- Popover 760×640 fixed, scrollable. No mini/full toggle.
- Status item: icon + live worker count only. Tooltip: `N workers · snapshot HH:mm:ss · core up|down`.
- **Adaptive orchestration graph:** nodes = caller (who dispatched) → worker (delegated to) → key/provider (reached out to). Edges = dispatch flow. Color: red/amber for active router workers, green for done. No decorative "Router → Workers live → Done" dot animation.
- Workers running: `worker · key_slot (actual) · model · provider · pid · elapsed · task` + kill (confirm). Gates excluded. Owner's own CLIs never listed or killable.
- Receipts view: last runs with selected worker/model/gate result.
- One HTTP GET to `/snapshot`; no Python spawn per refresh.

### P5 — Polish
- Confirm dialogs, empty states, accessibility, `SIZE=` self-check test, first-run scan welcome screen showing what was found and what's missing.

## 5. Non-goals (from VISION.md, unchanged)
- Another IDE; multi-user SaaS; routing other people's subscriptions; blind auto-installing of components; polishing features before the Soul Knight test passes.

## 6. Third-party comparison (FlorianBruniaux/agent-router)

Orthogonal, not competitive. His (Rust, Apache-2.0, 606 commits, 3 stars) is a **pre-execution routing advisor**: picks model/effort/skills per phase under constraints, replayable receipts, Git worktree isolation. Explicitly "not a coding agent, not a hosted gateway, not an autonomous runner; your host still does the work." No menu bar, no tray, no live stats, no daemon, no worker execution. We vendor his repo under `third_party/agent-router/` as reference. Borrow constraint-first filtering + receipt format; don't adopt his product.

## 7. Lapito

Zero matches for "lapito"/"Lapito" in this repo. No reference, integration, or design mention. If you have a Lapito spec/source, share it and I'll check fit.

## 8. Phases & exit criteria

| Phase | Goal | Exit |
|---|---|---|
| P0 | Rust core scaffold, discovery, dynamic worker registry | `cargo run -- discover` prints JSON of agents/keys/providers/workers |
| P1 | Parallel fanout, KeyPool leasing, run recording with key_slot | 3 tasks dispatched to 3 keys in parallel, all recorded |
| P2 | `route` command, receipts stored in SQLite | Receipt JSON viewable via CLI |
| P3 | Worktree preview/approve gate | Diff printed, approval required before apply |
| P4 | Swift menu bar popover (Agent Router visual) | Dark-themed popover matching Agent Router UI: stat cards, orchestration pipeline graph, sessions, workers, availability, system; core lifecycle owned by UI |
| P5 | Polish, self-check, first-run scan, Windows/Linux tray | `cargo test` green, popover renders unclipped, .app bundle in Applications, tray-rs tray for Win/Linux |

## 9. Open questions

1. Windows/Linux tray framework: `tray-rs`, `tauri`, or a minimal webview? Recommendation: Rust + `tray-rs` for the tray icon, HTTP to the same core.
2. HTTP auth: required or optional for loopback? Recommendation: optional, read from env/file if present.
3. Name confirmation: "Lingonberry Router" — confirmed.

## 10. Files created

- `core/Cargo.toml` — Rust workspace root
- `core/src/main.rs` — binary entry (`discover`, `route`, `run`, `fanout`, `serve` subcommands)
- `core/src/lib.rs` — core library
- `core/src/discovery.rs` — machine scan (agents, keys, providers, library)
- `core/src/registry.rs` — dynamic worker registry + KeyPool leasing
- `core/src/server.rs` — HTTP API (`/snapshot`, `/keys`, `/runs`, `/runs/{id}`, `/discover`, `/receipts`, `/receipts/{id}`)
- `core/src/storage.rs` — SQLite persistence (SqliteRunStore, SqliteReceiptStore, WAL mode)
- `core/src/types.rs` — shared structs (Worker, Run, Receipt, Snapshot, etc.)
- `ui/Package.swift` — Swift Package Manager manifest
- `ui/Sources/LingonberryUI/main.swift` — app entry (NSApplication, accessory policy)
- `ui/Sources/LingonberryUI/AppDelegate.swift` — status bar + popover + core lifecycle
- `ui/Sources/LingonberryUI/Models.swift` — Codable data models + RouterAPI (ObservableObject)
- `ui/Sources/LingonberryUI/Views/PopoverContentView.swift` — main UI: stat cards, pipeline graph, sessions, workers, availability, system

## 11. Security audit

- Key values never printed, logged, or returned — only key slot names (env var identifiers like `NIM_1`)
- `discover`, `Snapshot`, `LiveWorker`, `call_provider_api` all key-name-only
- SQLite stores key names only, never values
- Error messages don't include auth headers

## 12. Roast (inline)

Discovery code scans well — registry now derives from discovery (no hard-coded `DEFAULT_WORKERS`, no `nim5`). Swift popover matches Agent Router visual: dark theme, stat cards, orchestration pipeline (Caller → Agent Router → Workers → Task Complete), sessions table, workers table, worker availability with key statuses, system metrics. Core lifecycle owned by UI (starts/stops core subprocess). Remaining: P5 polish (.app bundle, first-run scan, self-check test), Windows/Linux tray.