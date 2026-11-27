# Lingonberry Router — Handoff for Next Session

## Current State (as of 2026-11-27)

### Deployed at `/Applications/Lingonberry Router.app/`
- `Contents/MacOS/lingonberry-tray` — SwiftUI menu bar app (auto-starts core on launch)
- `Contents/MacOS/lingonberry-core` — Rust backend HTTP server (bundled inside app)
- `Contents/Resources/icon.icns` — New tree icon (branching nodes + red fruit + green leaves)
- App is **codesigned** (ad-hoc)

### How to use
Just double-click `/Applications/Lingonberry Router.app`. No terminal needed.
The app auto-launches `lingonberry-core serve` in the background, then opens the menu bar popover anchored under the icon.

### Verified working
- Core: `cargo build --release` clean, `cargo test --release` 31 passed
- UI: `swift build -c release` clean
- App opens → core auto-starts → `/api/snapshot` returns data (8 workers, 38 jobs, 60 sessions, 105 completed 24h)
- Real NIM provider calls work (genuine output, not stubs)
- Key rotation works (NIM_1 → NIM_2, not pinned to one key)
- Failover works (bad Groq model → escalates cleanly)

---

## Issues Fixed in This Session

### 1. Data not showing — "The data couldn't be read because it is missing"
**Root cause:** `Thread.sleep(forTimeInterval: 0.5)` blocked the **main thread** in `ensureCoreRunning()`. `URLSession.shared.dataTask` callbacks are delivered on the main run loop, so while sleeping, callbacks couldn't fire. `coreIsRunning()` always returned false, core appeared down, and `refresh()` failed.

**Fix:** Removed the blocking `Thread.sleep` wait loop. `ensureCoreRunning()` now just launches core non-blockingly. The 3-second refresh timer (`store.start()`) plus `refresh()`'s internal 2-second retry handle the wait until core is up.

**Files changed:** `ui/macos-swift/Sources/LingonberryBar/main.swift`

### 2. Menu bar popover not anchored under icon
**Root cause:** `.menuBarExtraStyle(.window)` had been removed, causing default floating-window behavior on this macOS version.

**Fix:** Restored `.menuBarExtraStyle(.window)` which anchors the popover under the menu bar icon.

**Files changed:** `ui/macos-swift/Sources/LingonberryBar/main.swift`

### 3. Graph design didn't match reference
**Root cause:** Original graph was too simple — simple circles, single accent color lines, no "Router Dispatch" center badge.

**Fix:** Rewrote `GraphView` to match reference image #1:
- Dark background with rounded rectangle
- Center: "Router Dispatch" badge (purple/blue rounded square with network icon)
- Left: Caller nodes (Claude, Codex, OpenCode) as pill-shaped nodes with icons
- Right: Provider nodes (OMP/NIM, Pi/Groq, JCode/OpenRouter, OpenCode, Kilo) as pill-shaped nodes with icons
- Colored curved gradient lines connecting left→center→right (orange, green, blue, purple, pink)

**Files changed:** `ui/macos-swift/Sources/LingonberryBar/Views/PopoverView.swift`

---

## What Remains for Next Session

### P0: Verify the app works end-to-end for the user
1. User double-clicks `/Applications/Lingonberry Router.app`
2. Core auto-starts (verify via Activity Monitor or `pgrep -fl lingonberry-core`)
3. Menu bar icon appears
4. Click the icon → popover opens **under the icon** (not floating in middle of screen)
5. Green dot shows router is up
6. Stats strip shows real numbers (Running, Avg, Success %, Tasks 24h)
7. Graph shows the reference-style layout with colored nodes and curved lines
8. Three cards show Workers / Providers / Routerjobs with real data
9. Sessions show last 24h of dispatch with real worker output

### P1: Known issues to investigate
- **Snapshot dev command hangs:** `LB_SNAPSHOT=...` dev path spawns `ImageRenderer` which blocks on main thread. Dev-only scaffolding, not a product bug. Can be removed or fixed separately.
- **macOS icon cache:** If the menubar icon looks stale, quit and reopen the app (macOS caches app icons aggressively).
- **Groq model invalid:** `known_provider` groq = `llama-3.1-8b-instant` returns 404. Failover handles it, but config points at a dead model. Fix `known_provider` in `core/src/discovery.rs` or drop groq from rotation.

### P2: Code cleanup
- **Commit backend + UI changes** (push needs owner yes):
  - `core/src/config.rs` — `ExecutionMode {Live, Simulate}`, `execution` field
  - `core/src/registry.rs` — `provider_headroom()`, `select_best_worker_excluding()`, `LeaseGuard::cancel()`
  - `core/src/agents.rs` — headroom tiebreak in route scoring
  - `core/src/server.rs` — `is_owner_request` no-Origin handling, `live_api` gating, failover tracking, stub removal
  - `ui/macos-swift/Sources/LingonberryBar/main.swift` — non-blocking core launch, `.window` style
  - `ui/macos-swift/Sources/LingonberryBar/Views/PopoverView.swift` — new graph, error display in header
  - `ui/macos-swift/Sources/LingonberryBar/RouterStore.swift` — error logging, retry on first failure
- **Add tests** for `provider_headroom()` and lease failover (31 tests pass but don't cover these paths)
- **Fix groq model** in `core/src/discovery.rs`
- **Remove dev scaffolding** from `main.swift` (`LB_SNAPSHOT`, `LB_PREVIEW`, `LB_DARK`, `RenderFlags.noScroll`) or keep gated behind env vars

### P3: Architecture questions for the owner
- **pi-rust NIMs:** `pi` binary not installed (`which pi` → not found), `~/.pi/agent/auth.json` is `{}`. Backend already supports `pi` workers (leases keys, calls providers directly — no pi-rust binary needed). Install pi binary only if you want it as the executor.
- **Live vs Simulate default:** `config.execution` defaults to `Live` — cron/fanout/`run_job_now` will spend NIM/google/groq/openrouter keys on real calls. Kill switch: `LINGONBERRY_SIMULATE=1` or `"execution": "simulate"` in `~/.lingonberry/config.json`.

---

## File Structure
```
/Users/yegor/Developer/lingonberry-router/
├── core/
│   ├── src/
│   │   ├── config.rs      # ExecutionMode, execution field
│   │   ├── registry.rs    # provider_headroom, select_best_worker_excluding, LeaseGuard::cancel
│   │   ├── agents.rs      # headroom tiebreak in route scoring
│   │   ├── server.rs      # is_owner_request, live_api gating, failover tracking
│   │   ├── discovery.rs   # provider_for_env, known_provider, build_workers
│   │   ├── server.rs      # build_snapshot (JSON output)
│   │   └── types.rs       # Snapshot, SessionRow, JobRow, etc.
│   └── target/release/lingonberry-core
├── ui/macos-swift/
│   ├── Sources/LingonberryBar/
│   │   ├── main.swift          # MenuBarExtra, ensureCoreRunning, auto-start core
│   │   ├── RouterStore.swift   # refresh(), snapshot polling, lastError
│   │   ├── RouterClient.swift  # URLSession client for /api/snapshot
│   │   ├── Views/PopoverView.swift  # GraphView, HeaderView, ThreeCardsView, SessionsView
│   │   ├── RouterStore.swift
│   │   └── Info.plist
│   └── target/release/lingonberry-tray
└── HANDOFF.md (this file)
```

## Config Files
- `~/.lingonberry/config.json` — port 8799, `execution: Live`, `default_worker: pi`, `max_inflight_per_key: 3`, `rpm_per_key: 30`, `cooldown_s: 60`, `provider_rpm: {nim: 40}`
- `~/.env` — API keys: `NIM_1`…`NIM_5`, `GOOGLE_STUDIO_API`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, etc.

## Backend Endpoints
- `GET http://127.0.0.1:8799/version` — core PID + version
- `GET http://127.0.0.1:8799/api/snapshot` — full state (workers, jobs, sessions, keys, telemetry)
- `GET http://127.0.0.1:8799/keys` — key status (inflight, window, cooling)
- `POST http://127.0.0.1:8799/api/run` — dispatch a run (worker, prompt, live_api)
