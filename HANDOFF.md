# Handoff — Lingonberry Router UI (next session)

Date: 2026-11-25. Owner intent: **simple, smart, lazy**. Show the router's real work. Stop inventing a pipeline.

## Read before touching UI

Load skills: `unslop`, `impeccable` (or `frontend-design`), and `roast` before shipping.
Judge UI only from screenshots, never from code.

## State — proven this session

| Check | Command | Result |
|---|---|---|
| Core builds + tests | `cargo build` / `cargo test` in `core/` | clean, 6/6 pass |
| UI builds | `swift build` in `ui/` | Build complete |
| Snapshot live | `curl -s 127.0.0.1:8799/snapshot` | overview, 7 key slots, 24 sessions, real `system` metrics |
| Live runs | fake worker poll loop | `workers_live` 1 row, pid + caller + elapsed for 5 polls |
| Kill | `POST /kill/{pid}` | process gone, state `failed`, reason `killed by user (pid …)` |
| Re-kill finished pid | `POST /kill/{pid}` | 404 (state-gated, cannot hit a recycled pid) |
| Output capture | fake worker run | `output` persisted in `/runs` and shown in detail pane |
| UI render | `LINGONBERRY_SHOT=/tmp/x.png` | real window PNG, works while the screen is locked |

Both copies exist and build:
- `~/Developer/lingonberry-router/` ← **work here**
- `~/Developer/agent-router/` ← original; `core/` and `ui/` are duplicates, not yet trashed

Ticket: `T-20261125-05` (vault `pages/tickets/`).

## The design mistake to undo

The current `GraphView` forces the router into four orbs: Callers → Router → Workers → Done.
It is decorative. It cannot show concurrency, keys in use, or who called what, and it makes 24 real
runs look like one arrow. Owner's words: "doesn't showcase true work of the router".

**Rule: every visual element maps to a field the core actually returns. No invented flow.**

## What to build instead (in order, each one shippable)

1. **Delete `GraphView`.** Remove the 4-orb chain and its canvas/lane code. Do not replace it with another diagram of the same lie.
2. **"Now" panel** — one row per `workers_live` entry: caller dot in caller colour, `caller → worker → key slot`, elapsed ticking, pid, kill button. Empty state: `Idle — nothing dispatched`. This is the real-time view; it needs no art.
3. **"24h routing" bars** — rows = caller (from `sessions[].caller`), each row a horizontal stacked bar where segments are `worker:key` and width ∝ run count; segment label on hover/tooltip. Pure SwiftUI `GeometryReader`; no Charts dependency. This replaces the orbs and is literally the router's job: who sent work, which worker and key served it.
4. Keep and polish what already works: stat tiles, sessions list (click → prompt + output + copy), key slots, system meters, kill-all.
5. Spacing/type pass with `unslop`: consistent 12/16 rhythm, one accent per meaning, no emoji, no glows. Verify at 1280 and 780 px wide.

## Backend facts the UI may rely on

`GET /snapshot` → `ts, overview{running,live_workers,completed_24h,failed_24h,avg_duration_s,cost_24h_usd,calls_24h,cpu_pct}, workers[{name,status,calls_24h,ok_24h,key}], workers_live[{pid,worker,caller,key,model,provider,run_id,task,elapsed_s}], sessions[{id,ts,prompt,worker,caller,key,state,duration_s,reason,output}], jobs[], router{up,serve,proxy}, system{cpu_pct,load1,ram_used_gb,ram_total_gb,disk_used_gb,disk_total_gb}`

`POST /kill/{pid}` — only `running`/`leased`, process-group TERM.
`GET /runs`, `GET /runs/{id}`, `GET /keys`, `GET /discover`, `GET /receipts`.
States are lowercase everywhere (`done`, `failed`, `running`).

Known gaps (do not fake them in the UI):
- `cost_24h_usd` is always null (no pricing data). Render `–`, not `$0.00`.
- `jobs` is always empty; the core does not own schedules (launchd does). Either hide the section or say so.
- `caller` is null for runs recorded before this change; show `unknown` and colour it grey.
- `worker` rows are key slots, not agents; agent identity only exists on runs.
- One-shot CLI: `lingonberry-core run …` per invocation; caller comes from `--caller`, `ROUTER_CALLER`, else the parent process name.

## Verify recipe (copy-paste)

```sh
cd ~/Developer/lingonberry-router/core && cargo build && cargo test
cd ../ui && swift build
# core (port must be free; check: lsof -nP -iTCP:8799 -sTCP:LISTEN)
nohup ../core/target/debug/lingonberry-core serve > /tmp/lb-core.log 2>&1 &
curl -s 127.0.0.1:8799/snapshot | head -c 400
# UI receipt without screen-capture permission (screen may be locked)
LINGONBERRY_TEST_WINDOW=1 LINGONBERRY_SHOT=/tmp/lb.png ./.build/debug/lingonberry-ui
# live + kill proof, zero API cost
mkdir -p /tmp/fakebin && printf '#!/bin/sh\nsleep 6\necho "FAKE $1"\n' > /tmp/fakebin/claude && chmod +x /tmp/fakebin/claude
PATH=/tmp/fakebin:$PATH ../core/target/debug/lingonberry-core run "test" --worker claude --caller codex &
sleep 2 && curl -s 127.0.0.1:8799/snapshot | python3 -c "import json,sys;print(json.load(sys.stdin)['workers_live'])"
```

## Do not

- No GitHub push, rename, repo creation, or `gh repo create` — owner has not said yes. `brusnyak/lingonberry-router` is free (checked), and `brusnyak` is the owner's own account, so there is no "other dude".
- Do not delete `~/Developer/agent-router` or its Python `backbone/`. The launchd job `com.agent-router` still points at `~/.agent-router/run-agent-router.sh` and also wants port 8799.
- Do not print secrets or read `~/.env`; `.env`/`.env.local` sit in the agent-router root and must not be copied.
- Do not re-add `JSONDecoder.keyDecodingStrategy = .convertFromSnakeCase` — that bug blanked the whole UI.
- No screen `screencapture` for receipts; use the `LINGONBERRY_SHOT` hook.

## Needs owner yes

1. Trash `~/Developer/agent-router/core` and `ui` now that the copies build? (originals are untracked duplicates)
2. Rename/repo: create `lingonberry-router` on GitHub and push the new folder?
3. Replace `/Applications/Agent Router.app` with a bundled Lingonberry `.app` (needs a bundling step + icon), or keep both?
4. Should `com.agent-router` launchd job be retired so only one router owns port 8799?

## File map

- `core/src/main.rs` — CLI, caller resolution, tracked spawn, `run`/`fanout`/`serve`
- `core/src/server.rs` — HTTP, snapshot, system metrics, kill
- `core/src/storage.rs` — SQLite runs/receipts, migration, `mark_running`/`finish`
- `core/src/types.rs` — Run/SessionRow/LiveWorker/Overview, `RunState::as_str/parse`
- `ui/Sources/LingonberryUI/main.swift` — the whole app (~800 lines, single file)
