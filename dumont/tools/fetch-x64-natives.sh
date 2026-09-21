#!/usr/bin/env bash
# Fetch the darwin-x64 native modules that bun does not install on an arm64 Mac.
#
#   ./dumont/tools/fetch-x64-natives.sh
#
# WHY THIS EXISTS
#
# node-pty, @parcel/watcher and msgpackr-extract ship one prebuilt package per
# platform+arch, listed in optionalDependencies and selected by their `os` and
# `cpu` fields. bun installs only the ones matching the MACHINE IT RUNS ON, so on
# an Apple silicon Mac the darwin-x64 packages are never fetched.
#
# electron-builder then packages the x64 app with the arm64 binaries, because the
# arm64 ones are the only ones present. It says so, quietly, in a single line:
#
#   • missing optional dependencies  dependencies=[... "@lydell/node-pty-darwin-x64@1.2.0-beta.12" ...]
#
# The result is signed, notarised, Gatekeeper-accepted and completely broken: the
# main process dies loading pty.node before it can even open its log file, so
# there is no crash report, no window, no error, just a process sitting at 0%.
#
# Run this before an x64 or universal build. It is a no-op once the packages are
# there, so it is safe in build-mac.sh.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
store="$root/node_modules/.bun"
link_dir="$root/packages/desktop/node_modules"

# Keep these pinned to the same versions as the arm64 siblings in the lockfile.
# A mismatched prebuilt is worse than a missing one: it loads and then misbehaves.
pkgs=(
  "@lydell/node-pty-darwin-x64|1.2.0-beta.12|@lydell"
  "@parcel/watcher-darwin-x64|2.5.1|@parcel"
  "@msgpackr-extract/msgpackr-extract-darwin-x64|3.0.4|@msgpackr-extract"
)

for entry in "${pkgs[@]}"; do
  IFS='|' read -r name version scope <<< "$entry"
  short="${name##*/}"
  target="$store/${name/\//+}@${version}/node_modules/$name"

  if [ -d "$target" ]; then
    echo "have    $name@$version"
  else
    echo "fetch   $name@$version"
    tmp="$(mktemp -d)"
    url="https://registry.npmjs.org/${name}/-/${short}-${version}.tgz"
    curl -fsSL "$url" -o "$tmp/pkg.tgz"
    mkdir -p "$target"
    tar -xzf "$tmp/pkg.tgz" -C "$target" --strip-components=1
    rm -rf "$tmp"
  fi

  # electron-builder walks packages/desktop/node_modules, so the package has to
  # be reachable from there the same way its arm64 sibling is.
  mkdir -p "$link_dir/$scope"
  ln -sfn "$target" "$link_dir/$scope/$short"
done

echo
echo "darwin-x64 natives present:"
for entry in "${pkgs[@]}"; do
  IFS='|' read -r name _ scope <<< "$entry"
  short="${name##*/}"
  f="$(find "$link_dir/$scope/$short/" -name '*.node' 2>/dev/null | head -1)"
  [ -n "$f" ] && echo "  $(lipo -archs "$f" 2>/dev/null || echo '?')  $name"
done
