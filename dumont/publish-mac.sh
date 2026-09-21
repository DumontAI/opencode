#!/usr/bin/env bash
# Publish the built Dumont Code macOS artefacts to dumont.au.
#
#   ./dumont/publish-mac.sh
#
# Downloads are served from Dumont's own domain, not GitHub, mirroring the
# Dumont Chat precedent. hel1 serves /opt/dumont-website as https://dumont.au,
# so everything here lands under /opt/dumont-website/desktop/code/.
#
# Three things must go up together or the release is subtly broken:
#
#   - the .dmg, which is what people download
#   - the .zip, because latest-mac.yml names the ZIP and not the DMG, so
#     publishing only the DMG gives every updater check a 404, and that stays
#     silent until someone acts on an update prompt
#   - changelog.json, which the in-app release notes dialog reads. It lives at
#     the code/ root, NOT under prod/, because CHANGELOG_URL is not channelled.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist="$root/packages/desktop/dist"
host="airbase-hel1"
remote="/opt/dumont-website/desktop/code"
base="https://dumont.au/desktop/code"

version="$(cd "$root/packages/desktop" && node -p "require('./package.json').version")"
echo "==> publishing Dumont Code $version"

# Refuse to publish a changelog the app would silently discard.
bun "$root/dumont/tools/check-changelog.ts"

# Refuse to publish an app whose native modules are the wrong architecture.
# Nothing else catches it: such a build signs, notarises and passes spctl.
"$root/dumont/tools/check-native-archs.sh"

artefacts=(
  "dumont-code-desktop-mac-arm64.dmg"
  "dumont-code-desktop-mac-arm64.zip"
  "dumont-code-desktop-mac-x64.dmg"
  "dumont-code-desktop-mac-x64.zip"
  "latest-mac.yml"
)
for f in "${artefacts[@]}"; do
  [ -f "$dist/$f" ] || { echo "missing artefact: $dist/$f" >&2; exit 1; }
done

# latest-mac.yml must describe BOTH arches. electron-builder regenerates it per
# run, so if the two arches were built in separate invocations the file only
# lists whichever ran last and the other arch never sees an update.
for arch in arm64 x64; do
  grep -q "dumont-code-desktop-mac-$arch.zip" "$dist/latest-mac.yml" || {
    echo "latest-mac.yml does not list $arch. Rebuild both arches in ONE run:" >&2
    echo "  ./dumont/build-mac.sh --arm64 --x64" >&2
    exit 1
  }
done

ssh "$host" "mkdir -p $remote/prod/$version"
scp "${artefacts[@]/#/$dist/}" "$host:$remote/prod/$version/"
scp "$root/dumont/changelog.json" "$host:$remote/changelog.json"

# The updater fetches <feed>/latest-mac.yml and resolves the file it names
# relative to the same directory, so the feed and the zips have to sit together
# at the channel root, not only inside the versioned folder.
ssh "$host" "
  set -e
  cd $remote/prod
  for f in ${artefacts[*]}; do ln -sfn $version/\$f \$f; done
  cd $remote
  ln -sfn prod/$version/dumont-code-desktop-mac-arm64.dmg DumontCode-latest-arm64.dmg
  ln -sfn prod/$version/dumont-code-desktop-mac-x64.dmg DumontCode-latest-intel.dmg
"

echo "==> verifying every URL the app or a human can construct"
fail=0
urls=(
  "$base/changelog.json"
  "$base/prod/latest-mac.yml"
  "$base/prod/dumont-code-desktop-mac-arm64.zip"
  "$base/prod/dumont-code-desktop-mac-x64.zip"
  "$base/prod/dumont-code-desktop-mac-arm64.dmg"
  "$base/prod/dumont-code-desktop-mac-x64.dmg"
  "$base/prod/$version/dumont-code-desktop-mac-arm64.dmg"
  "$base/prod/$version/dumont-code-desktop-mac-x64.dmg"
  "$base/DumontCode-latest-arm64.dmg"
  "$base/DumontCode-latest-intel.dmg"
)
for url in "${urls[@]}"; do
  code="$(curl -sIL -o /dev/null -w '%{http_code}' "$url")"
  echo "  $code  $url"
  [ "$code" = "200" ] || fail=1
done

[ "$fail" = "0" ] || { echo "at least one URL is not 200" >&2; exit 1; }
echo
echo "Apple silicon : $base/DumontCode-latest-arm64.dmg"
echo "Intel         : $base/DumontCode-latest-intel.dmg"
echo "updater feed  : $base/prod/latest-mac.yml"
