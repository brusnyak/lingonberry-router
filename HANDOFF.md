# Handoff: Lingonberry Router

Read `README.md` first. It has the layout, the API and the install steps.

## State (2026-11-25)

- Branch `router-live-ui` holds the work. `main` has the first port. Local commits only; nothing is pushed.
- Core: `cargo test` 9/9. Agent argv, provider-scoped key leasing, async `key_for`, caller walk, `/version`, `/shutdown`, env and DB paths under `~/.lingonberry`.
- UI: menu bar popover shows running work only, the live flow, and collapsed runs that expand to the full conversation. Stop and restart act on the app and the router.
- Installed: `/Applications/Lingonberry.app` runs the current build. Core pid and `exe_mtime` were checked against the file on disk.
- OMP: `~/.omp/agent/extensions/router-status.ts` reads `/snapshot` (not the old Python backbone). Backup of the previous file is alongside it. This file is outside this repo.

## Verified

| Check | Result |
|---|---|
| `cargo test` (core) | 9 passed |
| `swift build -c release` (ui) | Build complete |
| `/version` vs file mtime | equal after install |
| `POST /shutdown` on a test core | port closed |
| OMP widget and `/router` against a fixture snapshot | correct lines |
| Expanded run in the popover | prompt visible |

## Not verified

- Clicking Stop or Restart in the live menu bar (the code path is the same one `/shutdown` already exercised).
- A pi run on NIM keys. It needs quota, so it was not run.
- Narrow window width.

## Open decisions (owner)

1. Codex: `~/.codex/config.toml` sets `gpt-6.1-sol`, which the ChatGPT login rejects. Pick a supported model.
2. Failover on truncated output: retry on another key, or fail as today?
3. Planner: skip workers that doctor reports down? (Yes is the proposal.)
4. Retire the old `com.agent-router` launchd job and `/Applications/Agent Router.app` so only Lingonberry owns port 8799. Both are outside this repo; nothing was changed there.
5. Trash `~/Developer/agent-router` (the Python backbone). It is no longer used by Lingonberry.

## Known gaps

See the list in `README.md`. The top three: no retry on truncation, planner ignores doctor status, and inflight slots are not released on panic.

## Gotchas

- `run_group` gives stdin `DEVNULL`. An agent that waits for input will not hang the core, but its output may be empty.
- The UI reads `CORE_URL` from `LINGONBERRY_CORE_URL` (default `http://127.0.0.1:8799`). Use a second port for test cores.
- Screenshot hooks: `LINGONBERRY_SHOT=<png>`, with `LINGONBERRY_TEST_WINDOW=1` or `LINGONBERRY_TEST_POPOVER=1`. `LINGONBERRY_TEST_EXPAND=1` expands the newest run. These are test-only.
- Do not add a `JSONDecoder.keyDecodingStrategy = .convertFromSnakeCase`. The models use explicit snake_case fields.

## Historical

- `SPEC-PLAN.md`: original plan. Marked historical.
- `docs/archive/ROUTERBAR-V2.md`: old Python-era spec. Marked superseded.
