#!/usr/bin/env python3
"""Write a multi-resolution .ico whose entries are PNG-compressed.

macOS has no ImageMagick by default, and sips cannot emit .ico, so this builds
the container by hand. Every Windows version from Vista onward reads PNG
entries, which is the only consumer of this file (electron-builder --win).

    make-ico.py source.png out.ico
"""
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

SIZES = (16, 24, 32, 48, 64, 128, 256)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])

    with tempfile.TemporaryDirectory() as tmp:
        images = []
        for size in SIZES:
            scaled = Path(tmp) / f"{size}.png"
            subprocess.run(
                ["sips", "-s", "format", "png", "-Z", str(size), str(src), "--out", str(scaled)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            images.append((size, scaled.read_bytes()))

        header = struct.pack("<HHH", 0, 1, len(images))
        offset = len(header) + 16 * len(images)
        entries, blobs = b"", b""
        for size, data in images:
            # 256 is encoded as 0 in the directory entry.
            entries += struct.pack(
                "<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset
            )
            blobs += data
            offset += len(data)

        dst.write_bytes(header + entries + blobs)
    print(f"wrote {dst} ({dst.stat().st_size} bytes, {len(SIZES)} sizes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
