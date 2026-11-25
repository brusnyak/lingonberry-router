# Cross-OS Menu Bar & System Tray (`tray/`)

Lingonberry's desktop tray app uses **Tauri v2** (`tray/`) to wrap the exact same React popover UI (`dist/`) across **macOS**, **Linux**, and **Windows**, supervising `lingonberry-core serve` on loopback `127.0.0.1:8799`.

## Why Tauri v2

- **Single UI codebase**: The Vercel web workbench (`src/client/`) and the desktop menu-bar popover share the same React components, orchestration graph, kill controls, and cron panel.
- **Native OS integration**:
  - **macOS**: Runs with `ActivationPolicy::Accessory` (no Dock icon), renders live worker count in the menu bar (`set_title`), and hides the popover on blur.
  - **Linux**: Uses `libayatana-appindicator3` / SNI system tray with right-click menu and live worker tooltip.
  - **Windows**: Uses the Windows notification tray (`NotifyIcon`) with bottom-right anchored popover and `lingonberry-core` process lifecycle management.
- **One lifecycle**: Launching the tray starts `lingonberry-core serve 127.0.0.1:8799` if not already bound; quitting the tray calls `POST /shutdown` and terminates its child process cleanly.

## Prerequisites

1. Install the Rust core binary on `PATH`:
   ```sh
   cd core && cargo install --path .
   lingonberry-core init
   ```
2. Install Node dependencies for the frontend bundle:
   ```sh
   npm install
   ```
3. Platform system libs (Linux only):
   ```sh
   sudo apt install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
   ```

## Run & Package

```sh
# Development (starts Vite dev server + native tray window)
cd tray && cargo tauri dev

# Release bundle (.app/.dmg on macOS, .AppImage/.deb on Linux, .msi/.exe on Windows)
cd tray && cargo tauri build
```

## Tauri ↔ Core IPC

The tray exposes native Tauri commands (`fetch_core_snapshot`, `kill_worker_pid`) and locks `tauri.conf.json` CSP strictly to `127.0.0.1:8799` (plus `127.0.0.1:3000` in dev), preserving the loopback-only security boundary.
