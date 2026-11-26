#!/bin/sh
# Build lingonberry-core in release mode and place it where Tauri's externalBin expects it,
# so the menu bar app ships with its own core (no separate install needed).
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/core"
cargo build --release --locked
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
mkdir -p "$ROOT/tray/binaries"
cp "$ROOT/core/target/release/lingonberry-core" "$ROOT/tray/binaries/lingonberry-core-$TRIPLE"
cp "$ROOT/core/target/release/lingonberry-core" "$ROOT/tray/binaries/lingonberry-core"
echo "bundled core: tray/binaries/lingonberry-core-$TRIPLE (and exact-name lingonberry-core for externalBin)"
