# Handoff: Lingonberry Router

Read `README.md` first (install, CLI, API, config). For the next build phase read `HANDOFF-AI-STUDIO.md`.

## State (2026-11-25)

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
