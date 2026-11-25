# Lingonberry Router — Critique, Competitive Benchmark & Ideal State

An honest engineering roast of what exists today versus what makes Lingonberry Router durable, plug-and-play, and indispensable across macOS, Linux, and Windows.

---

## 1. Competitive Landscape (Where Each Neighbor Stops)

| System | What It Nails | Where It Stops | Lingonberry Opportunity |
|---|---|---|---|
| **LiteLLM / OpenRouter / Portkey** | Hosted/proxy HTTP routing, token accounting, multi-model fallbacks | Blind to local CLI agents (`claude`, `codex`, `opencode`, `pi`), no parent-process caller trace, no git worktree diff gate, no global skill/constitution injection | Unify CLI agents + provider HTTP slots under one loopback control plane |
| **FlorianBruniaux/agent-router** | Constraint-first routing, SHA-256 replayable receipts, abstention codes | Advisory only—does not lease keys, spawn workers, track PIDs, kill runaway trees, or expose a menu bar | Combine constraint receipts with live execution, key pools, and tray oversight |
| **Stats (exelban) / iStat Menus** | Instant menu-bar ergonomics, `.accessory` policy, crisp popover, low idle CPU | System telemetry only—zero awareness of AI workers, leased API keys, or prompt pipelines | Bring `Stats`-grade native popover polish to agent orchestration |
| **Claude Code / Codex / OpenCode** | Deep single-agent coding loops and tool calling | Each CLI maintains separate config/skills/keys; no shared RPM pool, no cross-agent caller graph, no unified cron/process kill | Global-first self-config (`~/.agent-skills` + constitution) + shared key pool |

---

## 2. Blunt Roast of the Current Implementation

1. **Toy Prompt Cooking**: `route` currently relies on keyword matching (`delete`, `rm `, `bug`, `audit`) instead of parsing actual `SKILL.md` YAML frontmatter from `~/.agent-skills` / `~/.claude/skills` / `~/.codex/skills`, ranking them against the prompt, and retrieving real workspace files/symbols.
2. **Self-Config Is Half-Built**: Discovery reads agent binaries and skill folders, but `init` does not yet perform idempotent, marker-guarded injection (`<!-- lingonberry:start --> ... <!-- lingonberry:end -->`) with `.bak` backups and clean `uninstall`, nor does it expose an **MCP server** (`lingonberry-core mcp`) so every agent discovers Lingonberry natively without prompt hacks.
3. **Key Lease Can Leak on Panic**: Returning a bare key name without an RAII `Drop` guard means a panicked dispatch permanently consumes an inflight slot (`max_inflight_per_key`).
4. **No Startup PID Reconciliation**: If `serve` crashes mid-run, SQLite rows stay `running` forever unless reconciled against live OS PIDs on boot and during `/snapshot`.
5. **No Automatic Truncation / 429 Failover**: Truncated outputs or HTTP 429/5xx errors mark the run `blocked`/`failed` instead of retrying on the next healthy key slot in the same provider pool.
6. **Buffered Subprocess Output**: `wait_with_output()` hides live progress until completion; streaming stdout/stderr chunks to the popover gives instant visibility into stuck workers before hitting Kill.
7. **Planner Ignores `doctor` Health**: `route` can select a worker whose key slot is currently in cooldown or whose CLI failed health checks.
8. **Static Cron Jobs**: `Snapshot.jobs` needs an active scheduler loop in `serve` plus cross-OS read-only inspection of `launchd` (macOS), `systemd --user` / `crontab` (Linux), and Task Scheduler (Windows).

---

## 3. Ideal State Checklist (Plug-and-Play + Durable)

1. **Zero-Friction Install & Global-First Self-Config**:
   - `lingonberry-core install-hooks` detects global skill dirs first, writes ONE shared `lingonberry-router/SKILL.md` + constitution pointer, drops 2-line marker blocks only where needed (with backups + `uninstall`), and registers `lingonberry-core mcp`.
2. **Real Skill + Retrieval Prompt Engine**:
   - Index all `SKILL.md` files, slash commands, hooks, and git repo maps (`rg --files`) into a local FTS5/BM25 index so raw prompts get deterministic skill/hook/context enrichment before routing.
3. **Crash-Proof Execution**:
   - RAII `LeaseGuard`, startup + periodic PID liveness reaper, automatic failover across sibling keys within the same provider on 429/5xx/truncation, and output secret scrubbing before anything hits SQLite, `events.jsonl`, or the UI.
4. **Cross-OS Menu Bar / Tray (`tray/`)**:
   - Tauri v2 tray wrapping the single React UI (`dist/`), managing `lingonberry-core serve` lifecycle on macOS, Linux, and Windows, streaming live `Caller → Router → Worker (Key Slot) → Gate/Outcome` telemetry, PID kill, and cron controls.
