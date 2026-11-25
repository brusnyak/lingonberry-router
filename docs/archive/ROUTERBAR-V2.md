> **Superseded.** Python-era spec for the old Agent Router menu bar (RouterBar). Kept for history only. The current app and core are documented in `README.md` and `HANDOFF.md`.

# RouterBar v2 — menu-bar app spec

Status: draft for owner approval, 2026-11-24. Supersedes nothing; `DESIGN.md` still owns tokens.

## 1. What is actually wrong today (verified this session)

| # | Defect | Evidence |
|---|---|---|
| 1 | Popover renders the **mini** layout (min width 700) inside a **520**-wide popover → right column clipped, session text cut mid-word | `main.swift: togglePopover()` sets `store.mini = true`, `contentSize 520×620`; `miniBody` has `.frame(minWidth: 700…)`; `screencapture` shows Workers column cut at the popover edge |
| 2 | Health lights lie. Green daemon/hub/proxy/serve while **no router process exists** | `pgrep -fl backbone` → only RouterBar 47346; `lsof -iTCP -sTCP:LISTEN` → no 8790/8799; `components()` reads `data/up-health.json`, last written **Nov 23 20:11**, and **nothing in the repo writes it** |
| 3 | Router cannot start at all | `~/.agent-router/run-agent-router.sh` execs `python -m backbone up --port 8799`; `up` is not a CLI command (`backbone: error: argument cmd: invalid choice: 'up'`); README says `backbone serve --port 8799`; launchctl state = `spawn scheduled` = crash loop |
| 4 | Two start paths, neither loaded correctly | bar plist `com.agent-router.bar` exists but `launchctl print` → *Could not find service*; running bar comes from login item "Agent Router"; `quitAll()` boots out `com.agent-router` (router), never the bar |
| 5 | It is a window app wearing a menu-bar icon | 940×760 window mode, Dock icon via `.regular`, toolbar with Stop/Quit at top-right, `full` toggle |
| 6 | Status item carries ~nothing | `updateTitle()` = live worker count only; icon `point.3.connected…` |
| 7 | Each refresh spawns Python | `barstate` run = 0.14 s CPU per 5 s ≈ 2.8 % of a core |
| 8 | **Gates are registered as workers** | `run_gate()` → `run_group(shell=True)` → `procs.register()`. A `pytest`/`curl` gate shows up in the kill list as an agent |
| 9 | The bar cannot say what a worker is doing | `procs.register(pid, cmd)` stores only cmd + started; no `run_id`, no worker name, so no task/prompt row |
| 10 | The list mixes subjects | "Agent processes" + `callers` (`claude`, `jcode`, `opencode`) presents the owner's own interactive sessions as router work. They are not the subject |

## 2. Goal

One app. Menu bar is the product. Click the icon → popover with **true, fresh** router state. The Dock is never needed.

**The subject is the router's own workers.** Not "agents". The owner's interactive CLIs (opencode, Claude Code, jcode, pi by hand) are callers, not workers: never listed as work, never killable, and not shown as the first stage of the flow. What the bar must answer, in one glance: *which workers does the router have running right now, on what task, for how long, and what do I kill if one is stuck.*

**Non-goals:** mini/compact layout (the graph and the two columns need the width — do not shrink the popover), module/widget configuration à la Stats, chart library, generic history browser, remote access.

## 3. Reference: Stats (exelban)

Copy: `.accessory` policy, one status item, popover anchored under the item with arrow, popover sized to its content (not resizable), compact signal in the bar itself, ~1–5 s refresh, right-click menu = app actions (Quit, prefs).
Do not copy: 13 widget styles, 9 modules, per-module settings panes, 41 locales.

## 4. Information architecture (single popover, no mini mode)

Popover **760 × 640**, fixed, scrolls vertically. Width is the point: the flow graph and the two-column row need ≥720. Delete `store.mini`, `miniBody`, `miniTiles`, `applyMiniSize` and the `mini/full` toolbar button — one layout, one code path.

Order:

1. **Header** — icon, "Agent Router", router pill (Running / Down / Stale), snapshot age.
2. **KPIs** — Workers live · Done 24h · Cost 24h.
3. **Flow** — `Dispatched → Router → Workers live → Done 24h`. **No "Callers" node**; the owner's own sessions are not part of the router's pipeline.
4. **Workers running** (primary section) — one row per live router-spawned process:
   `worker kind · key · pid · elapsed · task (first line)` + kill X (confirm alert).
   Empty state: "No router-spawned workers".
   Gates never appear here (see §6).
5. **Sessions** — newest 5, expand to all. State pill, worker, key, reason. This is history, below live work.
6. **Worker availability** — collapsed by default: usable / total kinds, calls 24h, latency. Not "running".
7. **System** — CPU / RAM / Disk meters.
8. **Footer** — "Last update HH:mm:ss", no destructive buttons.

Remove from the popover: `full`, `Stop router`, `Quit`, `Kill N agents`. Right-click menu only.

Right-click menu: Full window · Start router · Stop router · Quit (bar + router).

## 5. Status item contract

- Icon: `point.3.connected.trianglepath.dotted`.
- Title: **live worker count only** — empty at 0, `N` when N router workers are running. No dot, no cost, no sparkline (owner decision).
- Tooltip: `N workers · snapshot HH:mm:ss · router up|down`.
- No animation.

## 6. Data contract (`backbone.barstate`)

Keep: `overview`, `sessions`, `workers` (kinds), `jobs`, `system`, `doctor_checked`.

**6a. Registry carries identity.** `procs.register(pid, cmd, kind="worker", run_id=None, worker=None)`;
`workspace.run_group` takes the same kwargs and passes them through. `run_gate()` must register with
`kind="gate"` (or not at all) so gates never enter the kill list. `procs.live()` returns kind.

**6b. `workers_live` replaces `agent_processes`.** One row per live process:
`{pid, kind, worker, key, cmd, task, started, elapsed_s}` where `task` is the run prompt joined by `run_id`
(`runs.prompt`, cleaned to 120 chars). Rows with `kind="gate"` are excluded. Owner CLIs can never appear —
they do not pass through `run_group`.

**6c. `callers` leaves the UI payload.** Keep it in `backbone.barstate` output only for CLI diagnostics, or drop it.

**6d. `components` probed at snapshot time**, never read from a file: TCP connect `127.0.0.1:8799` (300 ms) for
`serve`, pid-file liveness for `daemon`/`proxy`, launchctl state for jobs. Unknown → omit the dot, never draw green.

**6e. Freshness.** Add `stale_s`; `overview.running` reconciled against `procs.live()` — a DB row `running`
with no live pid becomes `blocked` at snapshot time (handoff gap #2).

## 7. States

| State | Bar | Popover |
|---|---|---|
| Loading | icon | skeleton, "starting" |
| Router down (no pid, no listener) | icon | banner "router stopped — start from right-click"; live section empty |
| Up, idle | icon | normal, "No router-spawned workers" |
| Workers live | icon + N | worker rows with task + elapsed |
| Degraded (a worker kind `down`) | icon + N | failed kinds surfaced first in availability |
| Stale (snapshot > 30 s old) | icon | amber banner with age |

## 8. Performance budget

- snapshot ≤ 150 ms; popover refresh 5 s; popover closed → status title only (no full snapshot).
- Bar idle CPU < 1 % over 60 s.
- P2 removes the Python spawn: `serve` gains authenticated `GET /snapshot` returning `barstate.snapshot()`; the bar does one HTTP GET.

## 9. Launch & lifecycle

- One path: launchd `com.agent-router.bar`, `RunAtLoad=true`, `KeepAlive=false` → Quit really quits. Delete the login item "Agent Router".
- Router: fix `run-agent-router.sh` to run `backbone serve --port 8799` **and** `daemon` **and** `proxy` (or add a real `backbone start` supervisor). `KeepAlive` with `ThrottleInterval 60` so a bad start does not burn CPU.
- Bar signals: SIGTERM/SIGINT → quit. SIGUSR2 → open full window.
- **Full window: kept, right-click only, `.regular` on open and `.accessory` on close.** Decide after acceptance: if four weeks pass with zero right-click opens, delete `openWindow()` and the window code path entirely.

## 10. Acceptance criteria

1. `launchctl print gui/$UID/com.agent-router` shows a live pid; `pgrep -f "backbone serve"` non-empty; popover lights green only then.
2. `kill <router pid>` → bar shows Down/Stale within 10 s. No file edit involved.
3. `ROUTERBAR_TEST_POPOVER=1` prints `POPOVER_SHOWN=true SIZE=760x640`; a `screencapture` shows the flow graph and both columns fully inside the popover with no clipping.
4. Quit → `pgrep RouterBar` empty and stays empty for 30 s.
5. One real `@pi` task dispatched → appears in **Workers running** with worker, pid, task and elapsed → group kill removes it. Requires clearing `~/.agent-router/PAUSE` (see appendix).
6. A task with a gate: the gate command (`pytest`, `curl`) **never** appears in Workers running.
7. `pgrep -fl opencode` and a Claude session both running → neither appears anywhere in the popover (except, optionally, nothing at all — `callers` is gone from the UI).
8. `ps -o %cpu` sampled 12× over 60 s with popover closed → mean < 1 %.

## 11. Phases

- **P0 — truth (half day):** start script, live `components`, reconcile stale `running`, Quit unloads the bar job.
- **P1 — subject (half day):** `register(kind, run_id, worker)`, gates excluded, `workers_live` rows with task + elapsed, delete `callers` node, rename the section. This is the change the owner actually asked for.
- **P2 — one layout (quarter day):** delete mini, popover 760×640, right-click menu, toolbar buttons out, status title = count.
- **P3 — live (half day):** `serve` `/snapshot`, bar GET, stop spawning Python; hidden-popover refresh pause.
- **P4 — polish:** confirm dialogs, empty states, accessibility labels, `SIZE=` self-check.

## 12. Decisions (owner, 2026-11-24)

1. **No mini layout.** Do not shrink the popover; the graph and columns need the width.
2. **Status item = icon + live count.** No dot, no sparkline.
3. **Full window = right-click only**, kept for now, delete if unused after acceptance.
4. **The subject is router workers**, not the owner's own CLIs.

## 13. Files to touch

- `routerbar/Sources/RouterBar/main.swift` — drop mini, popover 760×640, Workers running section, menu, status title, quit path
- `backbone/procs.py` — `register(pid, cmd, kind, run_id, worker)`
- `backbone/workspace.py` — pass identity; `run_gate` registers `kind="gate"` or not at all
- `backbone/barstate.py` — `workers_live` with task/elapsed, gates excluded, live `components`, reconcile, `stale_s`
- `backbone/serve.py` — `/snapshot` (P3)
- `~/.agent-router/run-agent-router.sh`, `~/Library/LaunchAgents/com.agent-router{,.bar}.plist`
- `tests/test_barstate.py` — workers_live, gate exclusion, freshness, reconcile

## Appendix — commands used

```
pgrep -fl backbone            # only RouterBar 47346
lsof -nP -iTCP -sTCP:LISTEN   # no 8790/8799
cat ~/.agent-router/data/up-health.json; stat -f %Sm …
launchctl print gui/$(id -u)/com.agent-router{,.bar}
tail -6 ~/.agent-router/agent-router.log     # invalid choice: 'up'
ROUTERBAR_TEST_POPOVER=1 ./routerbar/.build/release/RouterBar; screencapture -x -o …
```

## Appendix — blocked verification (2026-11-24)

`backbone run @pi "reply with the single word ok"` → `backbone.guard.Blocked: blocked: paused: kill file present`.
`~/.agent-router/PAUSE` exists (52 bytes, 09:24). Consequence: no worker can start, so `procs.json` stays `{}`
and the bar correctly shows 0 workers. Acceptance test 5 cannot run until the owner clears that pause —
clearing it is the owner's call, not something to do silently.
