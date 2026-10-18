#!/bin/sh
# Builds the app icons in public/ from assets/icon-source.png (square, 1024x1024 or larger).
# Uses sips, which comes with macOS.
set -eu
cd "$(dirname "$0")/.."

SOURCE=assets/icon-source.png
for entry in apple-touch-icon.png:180 icon-192.png:192 icon-512.png:512; do
  name=${entry%%:*}
  size=${entry##*:}
  sips -s format png -z "$size" "$size" "$SOURCE" --out "public/$name" >/dev/null
done
echo "Listo: iconos en public/"
