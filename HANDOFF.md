# Handoff: Lingonberry Router

Read `README.md` first (install, CLI, API, config). For the next build phase read `HANDOFF-AI-STUDIO.md`.

## State (2026-11-26, uncommitted, owner decides commit)

Verified with the dev binary, isolated home (`LINGONBERRY_HOME=<copy>`), real providers:
- NIM `nvidia/nemotron-3.5-super-vl-120b-a12b` via `nim-chat:NIM_1 --live-api`: "pong", state done, row persisted.
- Chunked map-reduce, 33.9k-char prompt, 3 sections: `ALPHA=K7Q2 BRAVO=M9X4 CHARLIE=Z1R8`, all correct.
- Google `gemini-2.5-flash` via `google:GOOGLE_STUDIO_API --live-api`: "pong".
- Groq `llama-3.3-70b-versatile`: HTTP 404 model_not_found for this key. Failover to Google works. Needs a current model id (not yet chosen).
- OpenRouter: keyed calls return 401 (stale key). `openrouter/auto` default must be replaced by three pinned `:free` models (owner rule).
- `cargo test`: 30 passed.

Fixed this pass (diff in agents.rs, server.rs, storage.rs, main.rs):
1. Live HTTP had no timeout (reqwest default). Now `LINGONBERRY_HTTP_TIMEOUT_S` (default 240).
2. `max_tokens` hardcoded 512; reasoning models returned empty text. Now `LINGONBERRY_MAX_TOKENS` (default 4096); `finish=length` with empty content is an error.
3. Empty provider text counted as "Live provider verified". Now an error and failover.
4. 4xx bodies parsed as success. Now error with status and 300-char body snippet.
5. Failover reason said "Truncated or rate-limited" for every error. Now the real error text.
6. STORAGE BUG: `insert_run` writes column `key_name`; DBs created before the rename have only `key_slot`. Every insert failed silently (`let _ =`), so no CLI run was ever persisted and `run` waited forever. Migration in `storage.rs` adds `key_name` (additive; old binaries keep working). Production `~/.lingonberry/router.db` NOT migrated yet: it migrates on the next open by the new binary.
7. CLI `run` wait loop: treats missing row as "still running", deadline 900 s.

Done this pass (2026-11-26, owner yes):
1. Production server rebuilt and restarted on 127.0.0.1:8799 (pid 73848). Serves real provider calls with real elapsed/tokens. Replaced old pid 52840 stub binary.
2. Pi keyed slots (`pi:NIM_n`) route through `call_chunked`/`call_provider_api` instead of the 2.4 s stub (`core/src/server.rs`).
3. Elapsed/tokens measured real via `std::time::Instant` in `live_api`, failover, and stub paths.
4. Skill matcher requires `>= 2` word overlaps before displacing default (`core/src/agents.rs`) — no false skill at score 1.00.
5. Skill body capped at `SKILL_BODY_CHARS=4000` (`core/src/agents.rs`) — already covered.
6. Overnight launchd `com.yegor.lingonberry-overnight` loaded (StartInterval 7200s); dispatcher `~/.claude/scripts/lingonberry-overnight.sh` exit=0, state=done, output='pong'. Ticket T-20261126-20 closed (outcome done).
7. Permissions allowlist already contains all 6 entries (`~/.claude/settings.json` lines 379-385). No edit needed.
8. OpenRouter: BLOCKED — kilo-auth OpenRouter key returns 401. Owner must refresh key in kilo auth; then re-test three pinned `:free` models.
9. Groq: default model `llama-3.3-70b-versatile` → `llama-3.1-8b-instant`; verified live via prod CLI (output "Pong. Acknowledged.", elapsed 7273 ms).

Reports: `~/memory-vault/pages/reports/2026-11-26-lingonberry-ideal-state-plan.md`, `...-real-model-tests.md`.

## Previous state (2026-11-25)

- `main` on GitHub holds the whole project. History was rewritten to remove personal identity and home paths; the author is now `Lingonberry dev`.
- Scope now: the core CLI and HTTP API only. The Swift menu-bar app was removed from the repo; its installed copy was moved to the Trash.
- Core: `cargo test` 13/13 on a fresh clone. `route` returns a receipt; `doctor` exits 0 after `init`.
- CI: `.github/workflows/ci.yml`, core test and build on Ubuntu, gitleaks scan.

## Open

1. Run-level tests for `serve` and HTTP endpoints (only unit tests exist).
2. Planner should skip workers `doctor` marks down.
3. Truncation retry on another key.
4. Codex model: `~/.codex/config.toml` must name a model the ChatGPT login accepts.

## Gotchas

- `run_group` gives stdin `DEVNULL`. An agent that waits for input will not hang the core, but its output may be empty.
- `doctor` does not create the config; run `init` first on a new machine.
- Models use explicit snake_case fields. Do not add `keyDecodingStrategy`-style global renaming (legacy note from the Swift app; kept in case a UI is rebuilt).

## Historical

- `SPEC-PLAN.md`: original plan. Marked historical.
- `docs/archive/ROUTERBAR-V2.md`: old Python-era spec. Marked superseded.
