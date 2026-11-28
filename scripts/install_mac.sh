#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "==> Lingonberry Router · macOS Clean Bootstrap"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: scripts/install_mac.sh is for macOS (Darwin)." >&2
  exit 1
fi

for cmd in cargo rustc swift git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: missing required tool '$cmd'. Install Xcode CLT + Rustup first." >&2
    exit 1
  fi
done

echo "==> 1/5 Testing & installing lingonberry-core..."
(
  cd "$ROOT_DIR/core"
  cargo test
  cargo install --path . --force
)

CORE_BIN="$(command -v lingonberry-core || echo "$HOME/.cargo/bin/lingonberry-core")"
if [[ ! -x "$CORE_BIN" ]]; then
  echo "error: lingonberry-core binary not found after cargo install." >&2
  exit 1
fi

echo "==> 2/5 Initializing ~/.lingonberry, api.token, mini-harness & pi-rust..."
"$CORE_BIN" init --yes

echo "==> 3/5 Applying global-first skill & agent pointers..."
"$CORE_BIN" self-config --apply

echo "==> 4/5 Running readiness doctor..."
DOCTOR_JSON="$("$CORE_BIN" doctor)"
echo "$DOCTOR_JSON"

echo "==> 5/5 Building LingonberryBar.app bundle with app icon..."
"$ROOT_DIR/scripts/build_mac_app.sh" "${1:-}"

echo ""
echo "Bootstrap complete."
echo "Next steps:"
echo "  1. Open $ROOT_DIR/dist/LingonberryBar.app (or run: cd ui/macos-swift && swift run lingonberry-tray)"
echo "  2. In the menu bar popover -> Setup -> Keys, paste at least one free NVIDIA NIM / Groq / Gemini key (or run Ollama locally)."
