#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SWIFT_DIR="$ROOT_DIR/ui/macos-swift"
APP_DIR="$ROOT_DIR/dist/LingonberryBar.app"
ICON_SRC="$SWIFT_DIR/Sources/LingonberryBar/Resources/appicon_1024.png"

export PATH="$HOME/.cargo/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "==> Building SwiftUI tray release binary..."
(
  cd "$SWIFT_DIR"
  swift build -c release
)

TRAY_BIN="$(cd "$SWIFT_DIR" && swift build -c release --show-bin-path)/lingonberry-tray"
if [[ ! -x "$TRAY_BIN" ]]; then
  echo "error: lingonberry-tray binary not found at $TRAY_BIN" >&2
  exit 1
fi

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

cp "$TRAY_BIN" "$APP_DIR/Contents/MacOS/lingonberry-tray"
cp "$SWIFT_DIR/Sources/LingonberryBar/Info.plist" "$APP_DIR/Contents/Info.plist"

# Bundle lingonberry-core inside the .app so launching the menu bar never depends on shell PATH
CORE_BIN="$(command -v lingonberry-core || true)"
if [[ -z "$CORE_BIN" && -x "$HOME/.cargo/bin/lingonberry-core" ]]; then
  CORE_BIN="$HOME/.cargo/bin/lingonberry-core"
fi
if [[ -n "$CORE_BIN" && -x "$CORE_BIN" ]]; then
  cp "$CORE_BIN" "$APP_DIR/Contents/MacOS/lingonberry-core"
fi

# Generate icon.icns from appicon_1024.png using macOS sips + iconutil
if [[ -f "$ICON_SRC" ]] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  ICONSET_DIR="$(mktemp -d)/icon.iconset"
  mkdir -p "$ICONSET_DIR"
  sips -z 16 16     "$ICON_SRC" --out "$ICONSET_DIR/icon_16x16.png"      >/dev/null
  sips -z 32 32     "$ICON_SRC" --out "$ICONSET_DIR/icon_16x16@2x.png"   >/dev/null
  sips -z 32 32     "$ICON_SRC" --out "$ICONSET_DIR/icon_32x32.png"      >/dev/null
  sips -z 64 64     "$ICON_SRC" --out "$ICONSET_DIR/icon_32x32@2x.png"   >/dev/null
  sips -z 128 128   "$ICON_SRC" --out "$ICONSET_DIR/icon_128x128.png"    >/dev/null
  sips -z 256 256   "$ICON_SRC" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
  sips -z 256 256   "$ICON_SRC" --out "$ICONSET_DIR/icon_256x256.png"    >/dev/null
  sips -z 512 512   "$ICON_SRC" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
  sips -z 512 512   "$ICON_SRC" --out "$ICONSET_DIR/icon_512x512.png"    >/dev/null
  sips -z 1024 1024 "$ICON_SRC" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$ICONSET_DIR" -o "$APP_DIR/Contents/Resources/icon.icns"
  rm -rf "$(dirname "$ICONSET_DIR")"
fi

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP_DIR" >/dev/null 2>&1 || true
fi

if [[ "${1:-}" == "--install" ]]; then
  rm -rf "/Applications/Lingonberry Router.app"
  cp -R "$APP_DIR" "/Applications/Lingonberry Router.app"
  echo "Installed /Applications/Lingonberry Router.app"
else
  echo "Built $APP_DIR (pass --install to copy to /Applications/Lingonberry Router.app)"
fi
