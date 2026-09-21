#!/usr/bin/env bash
# Publish the built Dumont Code macOS artefacts to dumont.au.
#
#   ./dumont/publish-mac.sh
#
# Downloads are served from Dumont's own domain, not GitHub, mirroring the
# Dumont Chat precedent. hel1 serves /opt/dumont-website as https://dumont.au,
# so everything here lands under /opt/dumont-website/desktop/code/.
#
# Both the .dmg and the .zip must go up. latest-mac.yml is the electron-updater
# feed and it references the .zip, not the .dmg; publishing only the DMG gives
# every updater check a 404, and that failure is silent until someone acts on an
# update prompt.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist="$root/packages/desktop/dist"
host="airbase-hel1"
remote="/opt/dumont-website/desktop/code"
base="https://dumont.au/desktop/code"

version="$(cd "$root/packages/desktop" && node -p "require('./package.json').version")"
echo "==> publishing Dumont Code $version"

for f in "dumont-code-desktop-mac-arm64.dmg" "dumont-code-desktop-mac-arm64.zip" "latest-mac.yml"; do
  [ -f "$dist/$f" ] || { echo "missing artefact: $dist/$f" >&2; exit 1; }
done

ssh "$host" "mkdir -p $remote/prod/$version"
scp "$dist/dumont-code-desktop-mac-arm64.dmg" \
    "$dist/dumont-code-desktop-mac-arm64.zip" \
    "$dist/latest-mac.yml" \
    "$host:$remote/prod/$version/"

# The updater fetches <feed>/latest-mac.yml and resolves the file it names
# relative to the same directory, so the feed and the zip have to sit together
# at the channel root, not only inside the versioned folder.
ssh "$host" "
  set -e
  cd $remote/prod
  ln -sfn $version/latest-mac.yml latest-mac.yml
  ln -sfn $version/dumont-code-desktop-mac-arm64.zip dumont-code-desktop-mac-arm64.zip
  ln -sfn $version/dumont-code-desktop-mac-arm64.dmg dumont-code-desktop-mac-arm64.dmg
  cd $remote
  ln -sfn prod/$version/dumont-code-desktop-mac-arm64.dmg DumontCode-latest-arm64.dmg
"

echo "==> verifying every URL the app or a human can construct"
fail=0
for url in \
  "$base/prod/latest-mac.yml" \
  "$base/prod/dumont-code-desktop-mac-arm64.zip" \
  "$base/prod/dumont-code-desktop-mac-arm64.dmg" \
  "$base/prod/$version/dumont-code-desktop-mac-arm64.dmg" \
  "$base/DumontCode-latest-arm64.dmg"; do
  code="$(curl -sIL -o /dev/null -w '%{http_code}' "$url")"
  echo "  $code  $url"
  [ "$code" = "200" ] || fail=1
done

[ "$fail" = "0" ] || { echo "at least one URL is not 200" >&2; exit 1; }
echo
echo "download: $base/DumontCode-latest-arm64.dmg"
echo "feed:     $base/prod/latest-mac.yml"
