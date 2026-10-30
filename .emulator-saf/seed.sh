#!/usr/bin/env bash
# Seeds the emulator's shared storage with the SAF spike test trees (M-14). Idempotent; run after boot.
set -euo pipefail
T=/sdcard/Documents/GonqSpike
S=/sdcard/Download/GonqSecond
tmp="$(mktemp -d)"
mkdir -p "$tmp/GonqSpike/sub" "$tmp/GonqSpike/img" "$tmp/GonqSecond"
printf '# Alpha\n\nFirst note.\n\n![pic](img/pic.png)\n\n![up](../GonqSecond/d.md)\n' > "$tmp/GonqSpike/a.md"
printf '# Bravo\n\nSecond note, link to [c](sub/c.md).\n' > "$tmp/GonqSpike/b.md"
printf '# Charlie (nested)\n\n![pic](../img/pic.png)\n' > "$tmp/GonqSpike/sub/c.md"
printf 'not markdown\n' > "$tmp/GonqSpike/notes.txt"
# 1x1 red PNG
echo iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg== | base64 -d > "$tmp/GonqSpike/img/pic.png"
printf '# Delta (second provider: Downloads)\n' > "$tmp/GonqSecond/d.md"
adb shell "rm -rf $T $S"
adb push "$tmp/GonqSpike" /sdcard/Documents/ >/dev/null
adb push "$tmp/GonqSecond" /sdcard/Download/ >/dev/null
# make MediaStore/DocumentsUI see them
adb shell "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://$T >/dev/null" || true
adb shell "find $T $S -type f | sort"
rm -rf "$tmp"
