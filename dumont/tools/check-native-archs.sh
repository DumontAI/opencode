#!/usr/bin/env bash
# Assert each packaged app contains native binaries for ITS OWN architecture.
#
#   ./dumont/tools/check-native-archs.sh
#
# The failure this catches is invisible to every other gate. An x64 app with only
# arm64 prebuilts signs, notarises and passes `spctl -a -t exec` as Notarized
# Developer ID, then throws "Cannot find module './prebuilds/darwin-x64/pty.node'"
# in the main process. Electron shows that in a modal alert, and if the app is not
# frontmost you see nothing at all: no window, no log directory, no crash report,
# just a process alive at 0% CPU. `sample` on it shows -[NSAlert runModal].
#
# Extra architectures are NOT an error. electron-builder ships every installed
# per-arch package, and each app requires the one matching its own process.arch
# at runtime. Only a MISSING target arch breaks the app.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dist="$root/packages/desktop/dist"
fail=0
apps=0

# electron-builder names the arm64 output mac-arm64 and the x64 output plain mac.
for dir in "$dist/mac-arm64:arm64" "$dist/mac:x86_64"; do
  out="${dir%:*}"
  want="${dir##*:}"
  app="$out/Dumont Code.app"
  [ -d "$app" ] || continue
  apps=$((apps + 1))

  echo "== ${out##*/} (needs $want)"
  got="$(lipo -archs "$app/Contents/MacOS/Dumont Code" 2>/dev/null)"
  case " $got " in
    *" $want "*) echo "   ok    main binary: $got" ;;
    *) echo "   FAIL  main binary is '$got', expected $want"; fail=1 ;;
  esac

  # Group the packaged .node files by the arch they were built for.
  present=""
  while IFS= read -r node; do
    archs="$(lipo -archs "$node" 2>/dev/null)"
    rel="${node##*app.asar.unpacked/node_modules/}"
    case " $archs " in
      *" $want "*) echo "   ok    $archs  $rel"; present="$present $rel" ;;
      *) echo "   (other arch, harmless)  $archs  $rel" ;;
    esac
  done < <(find "$app/Contents/Resources/app.asar.unpacked" -name '*.node' 2>/dev/null)

  if [ -z "$present" ]; then
    echo "   FAIL  no $want native module in this app at all"
    fail=1
  fi

  # node-pty is the one that kills the app on launch, so name it explicitly.
  case "$present" in
    *node-pty*) ;;
    *) echo "   FAIL  no $want build of node-pty. The app will die before it can log."; fail=1 ;;
  esac

  # The bundle itself must import the matching platform package. Upstream's
  # node-pty-narrower plugin resolves that at bundle time from the BUILD host,
  # so this is what catches a shared bundle packaged for the wrong arch.
  # Both per-arch packages ship inside the asar, so grepping for the package
  # NAME finds them either way: match the actual import statement instead.
  narrow_want="darwin-${want/x86_64/x64}"
  imported="$(strings -a "$app/Contents/Resources/app.asar" \
    | grep -oE 'from ?"@lydell/node-pty-darwin-(arm64|x64)"' \
    | grep -oE 'darwin-(arm64|x64)' | sort -u)"
  if [ -z "$imported" ]; then
    echo "   FAIL  could not find the node-pty import in the bundle. Cannot verify the arch."
    fail=1
  elif [ "$imported" != "$narrow_want" ]; then
    echo "   FAIL  bundle imports $(echo $imported) but this app is $want."
    echo "         That electron-vite run used the wrong DUMONT_TARGET_ARCH; the app"
    echo "         will throw \"Cannot find module './prebuilds/$narrow_want/pty.node'\" on launch."
    fail=1
  else
    echo "   ok    bundle imports $narrow_want"
  fi
done

echo
if [ "$apps" = "0" ]; then echo "No packaged apps found in $dist." >&2; exit 1; fi
if [ "$fail" != "0" ]; then
  echo "Native modules do not match their app's architecture. DO NOT PUBLISH." >&2
  echo "Run ./dumont/tools/fetch-x64-natives.sh and rebuild with ./dumont/build-mac.sh --arm64 --x64" >&2
  exit 1
fi
echo "$apps app(s): native modules and bundle imports match their architecture."
