#!/usr/bin/env bash
# Draws each plugin's icon.png from its source art: assets/icons/<plugin>.svg -> plugins/<plugin>/icon.png, 376 by 376, the size of
# Buzz's own icons. Buzz never runs a build, so the PNG is committed beside the plugin's manifest; this is how it is made.
#
# Needs a Chromium that can take a screenshot from the command line: a Chrome or Chromium on the PATH, or CHROME=/path/to/it.
# Playwright's headless shell works too (`pnpm exec playwright install chromium`, then CHROME=~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell).
# Run it from the root of the repository; pass plugin names to draw only those.
set -euo pipefail

chrome=${CHROME:-}
if [ -z "$chrome" ]; then
  for name in google-chrome chromium chromium-browser chrome-headless-shell; do
    chrome=$(command -v "$name" || true)
    [ -z "$chrome" ] || break
  done
fi
[ -n "$chrome" ] || { echo "No Chromium found: put one on the PATH or set CHROME=/path/to/it." >&2; exit 1; }

names=("$@")
[ ${#names[@]} -gt 0 ] || { for svg in assets/icons/*.svg; do name=${svg##*/}; names+=("${name%.svg}"); done; }

for name in "${names[@]}"; do
  svg=assets/icons/$name.svg
  [ -f "$svg" ] || { echo "No source art: $svg" >&2; exit 1; }
  [ -d "plugins/$name" ] || { echo "No plugin folder: plugins/$name" >&2; exit 1; }
  # The art fills the whole square: Buzz clips it to its own rounded shape and does not recolour an installed plugin's icon.
  "$chrome" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=376,376 \
    --screenshot="$PWD/plugins/$name/icon.png" "file://$PWD/$svg" >/dev/null 2>&1
  echo "plugins/$name/icon.png"
done
