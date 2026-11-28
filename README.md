<div align="center">

# Lingonberry Router

**One local reasoning router for coding agents and free/local model pools on macOS.**  
Verify `pi-rust`, store keys safely in macOS Keychain, cook prompts through an embedded mini-harness, enforce worktree & gate verification, and supervise active runs from a calm SwiftUI menu bar.

[Install](#install) · [Architecture](#architecture) · [Self-Config & Mini-Harness](#self-configuration--mini-harness) · [CLI](#cli) · [HTTP API](#http-api)

![Rust](https://img.shields.io/badge/core-Rust-orange)
![macOS](https://img.shields.io/badge/UI-SwiftUI%20MenuBar-blue)
![Local only](https://img.shields.io/badge/network-loopback%20%2B%20bearer%20token-green)

</div>

---

## Why

| Without Lingonberry Router | With Lingonberry Router |
|---|---|
| Raw provider keys copied into `~/.pi/agent/auth.json` or scripts | Keys stay in macOS Keychain (`kc:*`) or `~/.env`; `pi-rust` hits Lingonberry's authenticated `/v1/chat/completions` proxy |
| Discovered host `launchd`/`cron` entries look indistinguishable or unsafe | Host jobs are monitored strictly read-only (`scope = "discovered"`); never dispatched as LLM calls |
| Agents mutate your main working tree without checks | `--worktree` isolates runs in a real `git worktree` and `--gate` runs real `test`/`build`/`gitleaks` checks |
| Metered paid APIs burn budget silently | Keys are classified (`local`, `free_tier`, `metered_paid`); paid tiers block unless `--approve` is given |
| No starter skills/loops on a fresh machine | Built-in mini-harness seeds starter skills and Task Ledger workflows under `~/.lingonberry/harness/skills` |

---

<a id="architecture"></a>

## Architecture

1. **Probe & Readiness (`doctor`, `GET /api/readiness`)**: Checks for `pi`/`pi-rust`, CLI coding agents (`claude`, `codex`, `opencode`, `omp`), Ollama, Keychain/env keys, and external skills. Reports `full`, `mini_harness`, or `bare_minimum`, and supports one-click `pi-rust` installation.
2. **Cook & Route (`route`)**: Enriches raw prompts with matched skill files + Task Ledger `workflow_loop`, filters candidates by `read_only`, `allow_keys`, and cost tier (`local` / `free_tier` preferred; `metered_paid` gated behind `--approve`), and records a cryptographic receipt without running anything.
3. **Lease & Proxy (`registry`, `POST /v1/chat/completions`)**: Leases keys inside the provider boundary (`max_inflight_per_key: 3`, `rpm_per_key: 30`, `nim: 40`) with `LeaseGuard` RAII cleanup and automatic sibling failover on truncation/failure.
4. **Execute & Verify (`run`, `fanout`)**: Runs `pi` / CLI workers non-interactively with strict timeouts (`cli_timeout_s: 180`), optional `git worktree` isolation (`--worktree`), and verification gates (`--gate test|build|gitleaks|git-clean|<cmd>`).
5. **Overnight Proposals (`overnight`)**: Opt-in scanner proposes repo checks as `pending_approval` tickets with cost-tier caps. Nothing runs unattended without owner approval.

---

<a id="install"></a>

## Install & Build (macOS)

Requires Rust (`cargo`), Xcode Command Line Tools (`swift`), and `git`.

### Quick Bootstrap (Recommended on a Clean Mac)

```sh
git clone https://github.com/brusnyak/lingonberry-router.git
cd lingonberry-router
./scripts/install_mac.sh --install
open "/Applications/Lingonberry Router.app"
```

See [`docs/MAC_BOOTSTRAP.md`](docs/MAC_BOOTSTRAP.md) for a clean-slate local wipe (`rm -rf ~/.lingonberry`), a copy-ready Agent Setup Prompt, and a full macOS verification checklist.

### Manual Build

```sh
cd core
cargo test
cargo install --path .
lingonberry-core init --yes
lingonberry-core self-config --apply
lingonberry-core doctor
```

Run the native macOS SwiftUI Menu Bar app directly:

```sh
cd ui/macos-swift
swift build -c release
swift run lingonberry-tray
```

*(Note: `src/`, `tray/`, `ui/linux/`, and `ui/windows/` are deferred to future multi-OS phases; `core/` and `ui/macos-swift/` are the active Mac-first target.)*

---

<a id="self-configuration--mini-harness"></a>

## Self-Configuration & Mini-Harness

1. **Embedded Mini-Harness**: If `~/.agent-skills` or external skill packs are sparse, `lingonberry-core` seeds lightweight starter skills under `~/.lingonberry/harness/skills`.
2. **Global-First Pointers**: `self-config --apply` writes one shared skill/constitution in your global skill root and concise 2-line pointer blocks to detected agent configs (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md`).
3. **Encrypted Key Onboarding**: Add keys from the menu bar (**Setup → Keys**); they are verified live against `/models`, stored in macOS Keychain (`lingonberry-router`), and referenced only by slot name (`kc:<provider>:<label>`).

### Config Keys (`~/.lingonberry/config.json`)

| Key | Default | Meaning |
|---|---|---|
| `port` | `8799` | Loopback HTTP port |
| `default_worker` | `pi` | Default execution worker |
| `max_inflight_per_key` | `3` | Concurrent runs per key slot |
| `rpm_per_key` | `30` | Calls per key slot per 60 s (`provider_rpm.nim = 40`) |
| `cooldown_s` | `60` | Cooldown seconds after failure |
| `lease_wait_s` | `30` | Max seconds waiting for a free key lease |
| `cli_timeout_s` | `180` | Max runtime before terminating child CLI workers |
| `paid_keys_require_approval` | `true` | Require `--approve` before leasing `metered_paid` keys |
| `overnight_enabled` | `false` | Opt-in Overnight proposal queue |
| `overnight_budget_usd` | `0.0` | `0.0` restricts overnight proposals to free/local keys |
| `overnight_max_runs_per_night` | `5` | Daily run cap for overnight tickets |

State lives in `~/.lingonberry` (override with `$LINGONBERRY_HOME`). Loopback bearer token lives in `~/.lingonberry/api.token` (`0600`).

---

<a id="cli"></a>

## CLI

| Command | Use |
|---|---|
| `init [--force] [--yes]` | Create config, mini-harness, and `api.token` (idempotent) |
| `doctor` | Read-only health & readiness JSON check (`exit 1` if critical failure) |
| `discover` | Discovered agents, key slots (redacted), providers, Keychain metadata |
| `route "<prompt>" [--worktree] [--approve]` | Select worker and record receipt (dry-run) |
| `run "<prompt>" [--worker <id>] [--caller <name>] [--gate <cmd>] [--worktree] [--read-only] [--approve]` | Execute one verified run |
| `fanout "<p1>" "<p2>" [--approve]` | Parallel dispatch across available workers |
| `serve [127.0.0.1:8799]` | Start authenticated loopback daemon |
| `self-config [--apply]` | Inspect or apply global-first agent pointers |
| `mcp` | JSON-RPC 2.0 stdio MCP bridge |

---

<a id="http-api"></a>

## HTTP API (`127.0.0.1:8799`)

All `POST`/`PUT`/`DELETE` routes and `/v1/chat/completions` require `Authorization: Bearer <token>` from `~/.lingonberry/api.token` and reject untrusted browser `Origin` headers.

| Method | Path | Use |
|---|---|---|
| `GET` | `/health`, `/version`, `/snapshot`, `/api/readiness`, `/api/discover`, `/api/keys`, `/api/runs`, `/api/jobs`, `/api/self-config`, `/api/overnight` | Read-only state & diagnostics |
| `POST` | `/api/route`, `/api/run`, `/api/fanout`, `/api/rescan`, `/shutdown` | Authenticated routing, dispatch, and daemon lifecycle |
| `POST` | `/api/install/pi` | Consented `pi-rust` install (`cargo` or `brew`) + proxy setup |
| `POST` / `DELETE` | `/api/keys/add`, `/api/keys/test`, `/api/keys/{slot}`, `/api/keys/{name}/reset`, `/api/keys/{name}/rpm` | Keychain onboarding, live probe, cooldown/RPM control |
| `POST` | `/api/kill/{pid}`, `/api/jobs/kill/{pid}`, `/api/jobs/{name}/toggle`, `/api/jobs/{name}/run`, `/api/jobs/{name}/heal` | Process/job control (`403` on discovered read-only host jobs or unowned PIDs) |
| `POST` | `/api/self-config/apply` | Apply selected global/pointer config targets |
| `POST` | `/api/overnight/toggle`, `/api/overnight/scan`, `/api/overnight/tickets/{id}/approve`, `/api/overnight/tickets/{id}/defer` | Overnight policy & ticket approval flow |
| `POST` | `/v1/chat/completions` | Authenticated OpenAI-compatible loopback proxy for `pi-rust` |
