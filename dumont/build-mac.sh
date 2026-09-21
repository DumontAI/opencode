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

# Accepts several arch flags. Build every arch you intend to ship in ONE
# invocation: electron-builder regenerates latest-mac.yml per run, so building
# arm64 and x64 separately leaves the updater feed describing only whichever ran
# last, and the other arch silently never sees an update.
archs=("$@")
[ ${#archs[@]} -eq 0 ] && archs=(--arm64)
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

# bun installs only the native prebuilts matching THIS machine, so an x64 or
# universal build on Apple silicon would otherwise package arm64 binaries into an
# x64 app: signed, notarised, and dead on launch with no log and no crash report.
case "${archs[*]}" in
  *x64*|*universal*) "$root/dumont/tools/fetch-x64-natives.sh" ;;
esac

echo "==> prebuild (icons, metainfo, CLI bundle)"
bun run prebuild

# One electron-vite run PER ARCH. Upstream's node-pty-narrower plugin bakes the
# target arch into the main bundle, so a single shared bundle cannot serve both:
# the x64 app would import node-pty-darwin-arm64 and die on launch. See
# dumont/README.md, "The x64 build that signs, notarises and does not run".
feeds=()
for a in "${archs[@]}"; do
  node_arch="${a#--}"
  echo
  echo "==> bundle for $node_arch"
  DUMONT_TARGET_ARCH="$node_arch" bun run build

  echo "==> package, sign, notarise ($node_arch)"
  npx electron-builder --mac dmg zip "$a" \
    --config electron-builder.config.ts \
    --publish=never

  # electron-builder rewrites latest-mac.yml every run, so keep each arch's copy
  # and merge them once at the end.
  cp dist/latest-mac.yml "dist/latest-mac.$node_arch.yml"
  feeds+=("dist/latest-mac.$node_arch.yml")
done

if [ ${#feeds[@]} -gt 1 ]; then
  echo
  echo "==> merge the per-arch updater feeds"
  bun "$root/dumont/tools/merge-latest-mac.ts" "${feeds[@]}"
fi

echo "==> every packaged .node must match its app's arch"
"$root/dumont/tools/check-native-archs.sh"

echo
echo "==> artefacts"
ls -la dist/*.dmg dist/*.zip dist/latest-mac.yml 2>/dev/null || true
