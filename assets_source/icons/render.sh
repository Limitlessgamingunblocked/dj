#!/bin/sh
# Renders the app icons from the SVGs here (needs Chromium and ImageMagick):
#   sh assets_source/icons/render.sh
set -e
cd "$(dirname "$0")"
CHROME=${CHROME:-chromium}
OUT=../../public/icons
DESK=../../desktop/build
mkdir -p "$OUT" "$DESK"
shot() { # svg, inset px (macOS keeps its icons inside an 824 px tile), out png
  printf '<html><body style="margin:0;background:transparent"><img src="%s" style="display:block;margin:%spx;width:%spx;height:%spx"></body></html>' "$1" "$2" $((1024 - 2 * $2)) $((1024 - 2 * $2)) > _page.html
  "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --default-background-color=00000000 --window-size=1024,1200 --screenshot="$PWD/_shot.png" "file://$PWD/_page.html" 2>/dev/null
  convert _shot.png -crop 1024x1024+0+0 +repage "$3"
  rm _shot.png _page.html
}
shot icon-rounded.svg 0 _rounded.png
shot icon-rounded.svg 100 "$DESK/icon.png"
shot icon-maskable.svg 0 _maskable.png
for s in 192 512; do convert _rounded.png -resize ${s}x${s} "$OUT/icon-$s.png"; convert _maskable.png -resize ${s}x${s} "$OUT/maskable-$s.png"; done
convert _maskable.png -resize 180x180 -background '#07090d' -flatten "$OUT/apple-touch-icon.png"
convert _rounded.png -resize 32x32 "$OUT/favicon-32.png"
cp _rounded.png "$DESK/icon-full.png"
rm _rounded.png _maskable.png
