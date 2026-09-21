#!/usr/bin/env bash
# Build, sign and notarise the Dumont Code macOS DMG.
#
#   ./dumont/build-mac.sh [--arm64|--x64|--universal]   (default: --arm64)
#
# Prerequisites, all of which already exist on Carlos's Mac:
#   - the Developer ID identity in the dedicated dumont-signing.keychain
#   - the App Store Connect API key at ~/.appstore/AuthKey_3424F65JAW.p8
#   - bun on PATH
#
# Do NOT add NO_CODESIGN=1 or CSC_IDENTITY_AUTO_DISCOVERY=false for a real
# release: that path strips hardenedRuntime and entitlements and notarisation
# rejects the result.
set -euo pipefail

arch="${1:---arm64}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
export OPENCODE_CHANNEL=prod

# electron-builder rejects the "Developer ID Application:" prefix and tells you
# to remove it; the team name alone is what it wants.
export CSC_NAME="Dumont Pty Ltd (5VQ28Z7532)"

# notarytool authenticates with the same App Store Connect key EAS uses, so
# there is no app-specific password anywhere.
export APPLE_API_KEY="$HOME/.appstore/AuthKey_3424F65JAW.p8"
export APPLE_API_KEY_ID="3424F65JAW"
export APPLE_API_ISSUER="afa25cf9-df72-497d-a918-e32d2043982c"

cd "$root/packages/desktop"

echo "==> prebuild (icons, metainfo, CLI bundle)"
bun run prebuild

echo "==> renderer + main bundles"
bun run build

echo "==> package, sign, notarise ($arch)"
npx electron-builder --mac dmg zip "$arch" \
  --config electron-builder.config.ts \
  --publish=never

echo
echo "==> artefacts"
ls -la dist/*.dmg dist/*.zip dist/latest-mac.yml 2>/dev/null || true
