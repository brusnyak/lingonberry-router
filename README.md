# Lingonberry Router

A local router for AI workers. A caller (an agent CLI such as `claude`, `omp`, `codex`, `opencode`) asks for work. The router picks a worker, leases an API key for it, runs the task, records the run, and shows what is running on a menu bar popover.

Two parts, one repo:

| Part | Path | Language | What it is |
|---|---|---|---|
| Core | `core/` | Rust | discovery, worker registry, key leasing, dispatch, run store, HTTP API on `127.0.0.1:8799` |
| UI | `ui/` | Swift (SwiftUI, AppKit) | menu bar app that polls the core and shows running work |

Nothing here is hosted. Everything runs on your Mac and talks to loopback only.

## Where things live

| What | Where |
|---|---|
| Source | `core/src/*.rs`, `ui/Sources/LingonberryUI/main.swift` |
| Run database | `~/.lingonberry/lingonberry.db` (SQLite). Falls back to `~/.agent-router/lingonberry.db` only if the new file does not exist yet |
| Git worktrees for isolated runs | `<project>/.lingonberry/worktrees/` |
| Provider keys | `~/.env` or `~/.config/lingonberry/env`, as `NAME=value`. Legacy `~/.config/agent-router/env` is read last |
| Installed app | `/Applications/Lingonberry.app` (binary `Contents/MacOS/lingonberry-ui`) |
| Core binary | `core/target/{debug,release}/lingonberry-core`. The app starts the newest one it finds |
| Plist template | `ui/Resources/Info.plist` (matches the installed bundle) |
| Design notes | `SPEC-PLAN.md` (historical plan), `docs/archive/` (superseded specs) |

Key values are never printed. The core reads them from the process environment first, then from the env files above.

## How it works

1. **Discover.** `lingonberry-core discover` scans PATH for agent CLIs and the env files for key *names*. Every (agent, key slot) pair becomes a worker.
2. **Choose.** The default worker is bare `pi`, which takes any free NIM key per dispatch. Key-less agent CLIs come next. `cline` is discovered but never routed to.
3. **Lease.** `Registry::key_for` leases a key for the worker's provider only (a NIM request never gets a GROQ key). Each key allows `MAX_INFLIGHT = 3` concurrent runs and 40 calls per minute. A dispatch waits up to 30 s for a free key, then fails.
4. **Run.** CLI agents run non-interactively with stdin closed: `claude -p`, `codex exec`, `opencode run`, `kilo run`, `jcode run`, `omp -p` (see `core/src/agents.rs`). Key-based workers call the provider's chat-completions endpoint.
5. **Record.** Each run stores caller, worker, key slot, state, output and timing. The caller is the agent that started the run, found by walking parent processes past shells and wrappers.
6. **Show.** The UI polls `GET /snapshot` every 2 s.

## HTTP API (loopback)

| Method | Path | Use |
|---|---|---|
| GET | `/snapshot` | everything the UI shows: running workers, sessions, key slots, overview |
| GET | `/keys` | key-slot status |
| GET | `/runs`, `/runs/{id}` | run history and one run |
| GET | `/receipts`, `/receipts/{id}` | routing receipts |
| GET | `/discover` | discovered agents, keys (names), providers, workers |
| POST | `/kill/{pid}` | SIGTERM the process group of one live router worker. Refused for any pid the router did not start |
| GET | `/version` | `exe_mtime` of the running binary. The app shows "Update ready" when the file on disk is newer |
| POST | `/shutdown` | stop this core |

## CLI

```sh
lingonberry-core discover                    # agents, keys (names only), workers
lingonberry-core route "<prompt>"            # choose a worker, print the receipt; does not run
lingonberry-core run "<prompt>" [--worker <id>] [--caller <name>] [--gate <cmd>] [--worktree] [--approve]
lingonberry-core fanout "<p1>" "<p2>" ...    # one run per prompt, round-robin over workers
lingonberry-core serve [127.0.0.1:8799]      # HTTP API + run store
```

`ROUTER_CALLER` overrides caller detection.

## Build, test, install

```sh
cd core && cargo test && cargo build          # 9 unit tests
cd ui && swift build                          # debug
cd ui && swift build -c release               # for the installed app
```

Install the app by hand (no script yet):

```sh
osascript -e 'tell application "Lingonberry" to quit'
curl -s -X POST 127.0.0.1:8799/shutdown       # stop the core
cp ui/.build/release/lingonberry-ui /Applications/Lingonberry.app/Contents/MacOS/lingonberry-ui
codesign --force --deep --sign - /Applications/Lingonberry.app
open -a /Applications/Lingonberry.app         # starts the newest core
```

Check it took: `curl -s 127.0.0.1:8799/version` should show an `exe_mtime` equal to `stat -f %m core/target/debug/lingonberry-core`.

## Menu bar

- **Header:** state pill, and a menu with *Open full window*, *Restart router & app*, *Stop router & app*. "Update ready" appears when the core on disk is newer.
- **Running now:** only work in flight. Each row shows caller, worker and key, task and elapsed time, with a stop button. *Stop all* appears with more than one.
- **Live flow:** draws only the running work, caller → router → worker·key. Idle shows "Idle. Nothing is dispatched."
- **Runs:** collapsed. Tap a row to see the prompt and output, with copy buttons.

Stop and restart act on the app and the router together.

## Known gaps

- A worker whose output is truncated is marked `blocked`. The router does not retry it on another key yet.
- The planner does not skip workers that doctor marks down.
- `Lease` returns a bare key name with no RAII guard. A panic between lease and release leaks an inflight slot.
- A poisoned registry mutex panics instead of recovering.
- `cost_24h_usd` is not tracked.
- Codex is unusable until its model in `~/.codex/config.toml` is one the ChatGPT login supports.

## Layout of the repo

```
core/src/main.rs        CLI, caller detection, run/route/fanout/serve
core/src/discovery.rs   agents, key names, env files, key values, workers
core/src/registry.rs    worker lookup, key leasing (provider-scoped, MAX_INFLIGHT)
core/src/agents.rs      non-interactive argv per agent CLI
core/src/server.rs      HTTP API, snapshot, kill, version, shutdown
core/src/storage.rs     SQLite run and receipt stores
core/src/types.rs       shared types (Run, Worker, LiveWorker, Snapshot ...)
ui/Sources/LingonberryUI/main.swift   the whole menu bar app
ui/Resources/           Info.plist template, AppIcon.icns
HANDOFF.md              current state and open decisions
```
