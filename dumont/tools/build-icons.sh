#!/usr/bin/env bash
# Regenerate dumont/assets/icons/ from the Dumont brand mark.
# Run this only when the brand art changes; the output is committed so that
# dumont/apply-branding.ts stays fast and deterministic.
#
#   ./dumont/tools/build-icons.sh [path/to/source-1024.png]
#
# Requires macOS (sips + iconutil) and python3.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
src="${1:-$root/dumont/assets/icon-source.png}"
out="$root/dumont/assets/icons"

[ -f "$src" ] || { echo "source icon not found: $src" >&2; exit 1; }

rm -rf "$out"
mkdir -p "$out"

px() { sips -s format png -Z "$1" "$src" --out "$2" >/dev/null; }

# Linux hicolor set + generic png
px 32 "$out/32x32.png"
px 64 "$out/64x64.png"
px 128 "$out/128x128.png"
px 256 "$out/128x128@2x.png"
px 1024 "$out/icon.png"
px 1024 "$out/dock.png"

# Windows appx tiles
px 30  "$out/Square30x30Logo.png"
px 44  "$out/Square44x44Logo.png"
px 71  "$out/Square71x71Logo.png"
px 89  "$out/Square89x89Logo.png"
px 107 "$out/Square107x107Logo.png"
px 142 "$out/Square142x142Logo.png"
px 150 "$out/Square150x150Logo.png"
px 284 "$out/Square284x284Logo.png"
px 310 "$out/Square310x310Logo.png"
px 50  "$out/StoreLogo.png"

# macOS .icns
set="$(mktemp -d)/icon.iconset"
mkdir -p "$set"
for s in 16 32 128 256 512; do
  px "$s" "$set/icon_${s}x${s}.png"
  px "$((s * 2))" "$set/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$set" -o "$out/icon.icns"
rm -rf "$(dirname "$set")"

# Windows .ico (PNG-compressed entries, which every supported Windows reads)
python3 "$here/make-ico.py" "$src" "$out/icon.ico"

# iOS / Android launcher art, so no upstream mark survives anywhere in the tree
mkdir -p "$out/ios"
for spec in "20x20@1x:20" "20x20@2x:40" "20x20@2x-1:40" "20x20@3x:60" \
            "29x29@1x:29" "29x29@2x:58" "29x29@2x-1:58" "29x29@3x:87" \
            "40x40@1x:40" "40x40@2x:80" "40x40@2x-1:80" "40x40@3x:120" \
            "60x60@2x:120" "60x60@3x:180" "76x76@1x:76" "76x76@2x:152" \
            "83.5x83.5@2x:167" "512@2x:1024"; do
  px "${spec#*:}" "$out/ios/AppIcon-${spec%%:*}.png"
done

for spec in "mdpi:48" "hdpi:72" "xhdpi:96" "xxhdpi:144" "xxxhdpi:192"; do
  d="$out/android/mipmap-${spec%%:*}"
  mkdir -p "$d"
  px "${spec#*:}" "$d/ic_launcher.png"
  px "${spec#*:}" "$d/ic_launcher_round.png"
  px "${spec#*:}" "$d/ic_launcher_foreground.png"
done
mkdir -p "$out/android/mipmap-anydpi-v26" "$out/android/values"
cat > "$out/android/mipmap-anydpi-v26/ic_launcher.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
XML
cat > "$out/android/values/ic_launcher_background.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#41b8b0</color>
</resources>
XML

echo "icons written to $out"

# Web/renderer favicons. The desktop renderer's index.html links these, and the
# in-app notification icon points at favicon-96x96-v3.png, so they are visible.
web="$root/dumont/assets/web"
rm -rf "$web"; mkdir -p "$web"
px 96  "$web/favicon-96x96.png"
px 96  "$web/favicon-96x96-v3.png"
px 180 "$web/apple-touch-icon.png"
px 180 "$web/apple-touch-icon-v3.png"
python3 "$here/make-ico.py" "$src" "$web/favicon.ico"
cp "$web/favicon.ico" "$web/favicon-v3.ico"
cp "$here/../assets/mark.svg" "$web/favicon.svg"
cp "$here/../assets/mark.svg" "$web/favicon-v3.svg"
echo "web icons written to $web"
