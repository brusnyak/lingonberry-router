#!/usr/bin/env bash
# Run before every push. Covers CI (Rust, gitleaks) plus the Swift and web builds CI skips.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

cargo test --locked --manifest-path core/Cargo.toml
cargo build --locked --manifest-path core/Cargo.toml
swift build -c release --package-path ui/macos-swift
npm run lint
npm run build
gitleaks detect --source . --redact --no-banner
echo "check.sh: all passed"
