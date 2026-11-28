# Lingonberry Router — Current Architecture & Handoff

## Scope & Canonical Stack (Mac-First)
- **Canonical Runtime**:
  - `core/` — Rust backend (`axum` loopback server on `127.0.0.1:8799`, SQLite WAL, macOS Keychain secret storage, `pi-rust` OpenAI proxy at `/v1/chat/completions`, real `git worktree` isolation, verification gates, Overnight ticket queue).
  - `ui/macos-swift/` — Native macOS SwiftUI `MenuBarExtra` (`LingonberryBar`), built with zero Swift macros and zero external SwiftPM dependencies.
- **Deferred / Non-Canonical**: `src/` (web dashboard), `tray/` (Tauri), `ui/linux/`, and `ui/windows/` are deferred to post-Mac phases and are not modified in this pass.

---

## Security & Reliability Hardening Implemented

1. **Loopback Bearer Auth & Origin Guard (`core/src/config.rs`, `core/src/server.rs`, `ui/macos-swift/Sources/LingonberryBar/RouterClient.swift`)**
   - `ensure_api_token()` creates a 256-bit per-user token at `~/.lingonberry/api.token` (`0600`).
   - All `POST`/`PUT`/`DELETE` routes and `/v1/chat/completions` require `Authorization: Bearer <token>` (constant-time comparison) plus loopback `Host` and non-browser `Origin` checks.
   - `POST /api/jobs/kill/:pid` is `403 Forbidden` unless the PID belongs to an active Lingonberry child run or a Lingonberry-managed job.

2. **Read-Only Host Cron Monitoring (`core/src/cron.rs`, `core/src/storage.rs`, `core/src/server.rs`)**
   - Discovered host jobs (`launchd`, `crontab`, `systemd`, `schtasks`) are marked `scope = "discovered"` and `read_only = true`.
   - The 5-second ticker and `POST /api/jobs/:name/run` strictly skip discovered jobs — they are never dispatched as LLM calls or external shells.
   - Seeded fake `launchd` mock entries were removed; only the local `doctor-health-sweep` watchdog is seeded (`managed`).

3. **`pi-rust` Execution Layer & Zero-Key-Leak Proxy (`core/src/discovery.rs`, `core/src/keychain.rs`, `core/src/server.rs`)**
   - Raw provider API keys stay in macOS Keychain (`service = "lingonberry-router"`, slots `kc:<provider>:<label>`) or user `.env` files — never written to `~/.pi/agent/auth.json`, snapshots, or SQLite.
   - `configure_pi_rust()` points `pi` at `http://127.0.0.1:8799/v1` using only the local session token; `POST /v1/chat/completions` leases keys inside the provider boundary and enforces paid-tier approval.
   - Readiness modes (`full`, `mini_harness`, `bare_minimum`) and one-click `POST /api/install/pi` allow clean onboarding with zero external harness prerequisites (`~/.lingonberry/harness/skills`).

4. **Real Isolation, Gates & Cost Tiers (`core/src/harness.rs`, `core/src/agents.rs`, `core/src/server.rs`)**
   - `--worktree` creates an actual isolated `git worktree` under `~/.lingonberry/worktrees/<run_id>` (removed on completion).
   - `--gate` executes real verification (`test`, `build`, `gitleaks`, `git-clean`, or custom command); `gate_passed = true` is set only when a real gate ran and exited `0` (otherwise `gate_status = "not_run"` or `"failed"`).
   - `--read-only` prevents write-capable execution and worktree mutations.
   - `--approve` is required before routing to `metered_paid` providers when `paid_keys_require_approval` is `true` (default).
   - CLI runs enforce `cli_timeout_s` (default `180s`), capture up to 2000 chars of secret-redacted stderr, pass `-C <cwd> --skip-git-repo-check` to `codex exec`, and check `is_os_pid_alive(os_pid)` before marking orphan runs.

5. **Overnight Proposal Queue (`core/src/storage.rs`, `core/src/server.rs`, `ui/macos-swift/`)**
   - Scans local git repos and queues `pending_approval` tickets instead of spending keys unattended.
   - Owner approves (`POST /api/overnight/tickets/:id/approve` -> runs in isolated worktree + `--gate test`) or defers via the menu bar Setup panel or macOS notification actions (when bundled).

6. **macOS Menu Bar UX (`ui/macos-swift/Sources/LingonberryBar/`)**
   - Reactive `@Environment(\.colorScheme)` (`ThemePalette`).
   - Idle collapses `GraphView` to a compact status strip and hides `WorkersCard`; active dispatches show horizontal `Caller -> Router -> Worker` curves with `.fixedSize()` pills, valid SF Symbols, live `TimelineView` timers, and Stop controls.
   - `JobsCard` separates `Managed` vs `Host Discovered (Read-Only)`.
   - Inline 3-tab `SetupPanelView` (`Keys`, `Self-Config & pi`, `Overnight`) avoids `MenuBarExtra` modal dismissal bugs.

---

## Config Defaults (`~/.lingonberry/config.json`)
- `port`: `8799`
- `execution`: `Live` (override with `LINGONBERRY_SIMULATE=1`)
- `default_worker`: `pi`
- `max_inflight_per_key`: `3`
- `rpm_per_key`: `30` (provider override: `nim: 40`)
- `cooldown_s`: `60`
- `lease_wait_s`: `30`
- `cli_timeout_s`: `180`
- `paid_keys_require_approval`: `true`
- `overnight_enabled`: `false`, `overnight_budget_usd`: `0.0`, `overnight_max_runs_per_night`: `5`

## Verification Commands (Run on macOS)
```sh
cd core && cargo test --locked
cd core && cargo build --release --locked
cd ui/macos-swift && swift build -c release
```
