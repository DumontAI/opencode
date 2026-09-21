#!/usr/bin/env bash
# Assert each packaged app can load a native binary for ITS OWN architecture,
# for EVERY native package family it ships, not just the ones that burned us.
#
#   ./dumont/tools/check-native-archs.sh
#
# The failure this catches is invisible to every other gate. An x64 app with only
# arm64 prebuilts signs, notarises and passes `spctl -a -t exec` as Notarized
# Developer ID, then throws "Cannot find module './prebuilds/darwin-x64/pty.node'"
# in the main process. Electron shows that in a modal NSAlert, and if the app is
# not frontmost you see nothing at all: no window, no log directory, no crash
# report, no stderr, just a process alive at 0% CPU. `sample <pid>` showing
# -[NSAlert runModal] is what tells you it is waiting rather than dead.
#
# Extra architectures are not an error: electron-builder ships every installed
# per-arch package and each app picks its own at runtime. A MISSING target arch
# is the error, and it has to be checked per package family, because one family
# being present says nothing about another.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dist="$root/packages/desktop/dist"
fail=0
apps=0

# Families allowed to have no build for the target arch, each with the reason and
# the test that established it. Nothing goes in here on reasoning alone.
#
#   @msgpackr-extract/msgpackr-extract
#     msgpackr requires it inside `try { ... } catch { /* native module is
#     optional */ }` in node-index.js and falls back to its JS decoder; it also
#     honours MSGPACKR_NATIVE_ACCELERATION_DISABLED, so running without the
#     native module is a supported mode. Verified 2026-09-21 by running the x64
#     app's own Electron binary as node under Rosetta against its own asar:
#     process.arch=x64, `require msgpackr: OK`, `pack/unpack: OK`,
#     `msgpackr-extract native: FAILED -> No native build was found for
#     platform=darwin arch=x64`. The arm64 control loaded the native module, so
#     the test discriminates. Cost is decode speed, not correctness.
optional_families=(
  "@msgpackr-extract/msgpackr-extract"
)

is_optional() {
  local f="$1"
  for o in "${optional_families[@]}"; do [ "$f" = "$o" ] && return 0; done
  return 1
}

# @lydell/node-pty-darwin-arm64/prebuilds/... -> @lydell/node-pty
# @msgpackr-extract/msgpackr-extract-darwin-x64/... -> @msgpackr-extract/msgpackr-extract
family_of() {
  local rel="$1"
  local pkg
  case "$rel" in
    @*/*) pkg="$(echo "$rel" | cut -d/ -f1-2)" ;;
    *)    pkg="$(echo "$rel" | cut -d/ -f1)" ;;
  esac
  echo "$pkg" | sed -E 's/-(darwin|linux|win32)-(arm64|x64|x86_64)(-(glibc|musl))?$//'
}

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

  families=""
  satisfied=""
  found_any=0
  while IFS= read -r node; do
    found_any=1
    archs="$(lipo -archs "$node" 2>/dev/null)"
    rel="${node##*app.asar.unpacked/node_modules/}"
    fam="$(family_of "$rel")"
    case " $families " in *" $fam "*) ;; *) families="$families $fam" ;; esac
    case " $archs " in
      *" $want "*)
        echo "   ok    $archs  $rel"
        case " $satisfied " in *" $fam "*) ;; *) satisfied="$satisfied $fam" ;; esac
        ;;
      *) echo "   ----  $archs  $rel  (other arch)" ;;
    esac
  done < <(find "$app/Contents/Resources/app.asar.unpacked" -name '*.node' 2>/dev/null)

  if [ "$found_any" = "0" ]; then
    echo "   FAIL  no .node files at all, which is itself suspicious"
    fail=1
  fi

  for fam in $families; do
    case " $satisfied " in
      *" $fam "*) ;;
      *)
        if is_optional "$fam"; then
          echo "   warn  $fam has no $want build; documented as optional, falls back to JS"
        else
          echo "   FAIL  $fam has no $want build. Unless it is proven to degrade"
          echo "         gracefully, this app is dead on $want. Prove it with:"
          echo "           ELECTRON_RUN_AS_NODE=1 '<app>/Contents/MacOS/Dumont Code' test.js"
          echo "         then add it to optional_families with the evidence, or fix the build."
          fail=1
        fi
        ;;
    esac
  done

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
echo "$apps app(s): every native package family resolves for its own architecture."
