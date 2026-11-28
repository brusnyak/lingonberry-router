# Clean-Slate macOS Bootstrap, Real E2E & Agent Continuation

Use this guide to wipe older local Lingonberry state on your Mac, let your local coding agent bootstrap the build from GitHub, run real end-to-end (E2E) + git worktree lifecycle checks, and implement the final native macOS polish items.

---

## 1. Optional Clean-Slate Local Wipe (macOS)

Run this in Terminal if you had an older test build or partial config on your Mac:

```sh
pkill -f lingonberry-core || true
pkill -f lingonberry-tray || true
rm -rf ~/.lingonberry ~/.cargo/bin/lingonberry-core "/Applications/Lingonberry Router.app"
```

*(Note: `~/.ssh`, your macOS Login Keychain, and existing `~/.claude` / `~/.codex` folders stay untouched—only Lingonberry state is cleared.)*

---

## 2. Copy-Ready Mac Agent Bootstrap Prompt

Paste this prompt to Claude Code, Codex, OpenCode, or Pi on your Mac (replace `<GITHUB_REPO_URL>` with your repository URL):

```text
Clone <GITHUB_REPO_URL> into ~/Code/lingonberry-router (or pull clean if present) and bootstrap Lingonberry Router for macOS:
1. Verify prerequisites (`cargo`, `rustc`, `swift`, `git`; also check `sandbox-exec`, optional `docker`, and `ollama`).
2. Run `./scripts/install_mac.sh --install` from the repository root so `lingonberry-core` tests pass, `pi-rust` is verified/installed, `~/.lingonberry` + `api.token` + mini-harness skills are initialized, `self-config --apply` indexes global skills + agent pointers, `doctor` passes, and `/Applications/Lingonberry Router.app` is built.
3. Run `lingonberry-core discover` and `lingonberry-core route "Audit auth token guard" --worktree`.
4. Open "/Applications/Lingonberry Router.app" (or run `swift run lingonberry-tray`) and verify `curl -sf http://127.0.0.1:8799/health` returns `ok`.
5. Follow Section 3 & Section 4 of `docs/MAC_BOOTSTRAP.md` to verify real E2E + git worktree lifecycle isolation, then ask ONLY for the API keys I want stored in macOS Keychain (e.g., free NVIDIA NIM, Groq, Google AI Studio, or optional Telegram/Slack tokens)—never write raw keys to plaintext config files.
```

---

## 3. Real E2E & Git Worktree Verification Checklist (After Onboarding Keys)

Once you add at least one free key in **Menu Bar -> Setup -> Keys** (or start `ollama serve`):

1. **Menu Bar Icon & Idle State**:
   - Confirm the monochrome branching lingonberry icon adapts cleanly to both Light & Dark macOS menu bars.
   - Open the popover when idle: the Routing Graph collapses to a 1-line summary and idle worker cards remain hidden.
2. **Bearer Auth Enforcement**:
   - Unauthenticated mutation must fail (`401`):
     ```sh
     curl -i -X POST http://127.0.0.1:8799/api/rescan
     ```
   - Authenticated mutation must succeed (`200`):
     ```sh
     TOKEN="$(cat ~/.lingonberry/api.token)"
     curl -sf -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:8799/api/rescan | jq .ok
     ```
3. **Real Worktree Isolation, Gate Verification & Cleanup**:
   - Before running, record your baseline worktrees and confirm a clean working tree:
     ```sh
     git status --short
     git worktree list
     ```
   - Dispatch a real verified run inside an isolated temporary `git worktree`:
     ```sh
     lingonberry-core run "List crate modules and verify cargo test passes" --worktree --gate test
     ```
   - While running, open the Menu Bar popover to confirm live **Caller -> Router -> Worker** curves and the `Kill` PID button render cleanly.
   - After completion, confirm your main checkout stayed untouched and no orphan worktree dirs leaked:
     ```sh
     git status --short
     git worktree list
     ls -la /tmp/lb-wt 2>/dev/null || true
     ```
4. **Read-Only Host Cron Boundary**:
   - Confirm discovered host `launchd` / `crontab` entries appear read-only (`scope = "discovered"`) and never execute as LLM dispatches.
5. **Kiro SHA-256 Spec Lock**:
   - Create a draft spec in **Setup -> Overnight** (or via `/api/specs`), confirm running an unapproved draft is rejected, then approve/sign and execute it against a scoped `allowed_path_globs` target.

---

## 4. Continuation Tasks for Your Local Mac Agent

Once synced on macOS, your local agent can complete these macOS-only native items directly against real Xcode/macOS APIs:

1. **Worktree GC + Failure Post-Mortem Capture (`git worktree prune`)**:
   - When a `--worktree` run fails a verification gate, snapshot `git diff`, failing gate stderr, model/provider metadata, and `run_id` into `~/.lingonberry/failures/<run_id>.md` (so overnight roast/critic memory never loses the failure context), **then** immediately remove the temporary worktree and run `git worktree prune`.
   - On daemon startup (`core/src/server.rs`) and after SIGTERM/timeout cleanup, prune any remaining stale worktrees and orphaned `/tmp/lb-wt/*` directories left by hard-killed runs.
2. **Launch at Login (`SMAppService`)**:
   - Add a native macOS `SMAppService.mainApp` toggle inside `ui/macos-swift/Sources/LingonberryBar/Views/SetupSheetView.swift` so `Lingonberry Router.app` can start automatically with your Mac session.
3. **Live Keychain + `pi-rust` Smoke Suite**:
   - Run an authenticated end-to-end smoke script hitting `/api/keys/test`, `/v1/chat/completions` (via `pi-rust`), `--worktree --gate test`, and `/api/kill/{pid}` against a dummy long-running worker.
4. **Optional Single-Source Design System (`design/tokens.json`)**:
   - If iterating on the marketing site and macOS UI together, extract shared palette/spacing tokens into `design/tokens.json` so Tailwind (`src/index.css`) and SwiftUI (`PopoverView.swift`) generate from one source of truth, and keep any 3D/hero artwork strictly on the web hero rather than inside the menu bar tray.

