#!/usr/bin/env bash
# Runs test/web/ghostty-terminal.spec.mjs against the real Buzz web build (headless Chromium, the app's fixture relay), with the real PTY
# bridge behind a host simulator.
#
#   plugins/ghostty-terminal/test/run.sh /path/to/block/buzz-app/checkout [extra playwright args]
#
# The checkout needs `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium` done once. This folder needs
# `pnpm install --frozen-lockfile` and `pnpm run build` first: the suite loads the built plugin.js, which a prototype never commits. The
# script copies the built plugin, a small wrapper and the spec into the checkout (a scratch clone, not a place to commit) and adds the plugin
# to the harness's installed-fixture list. The plugin goes through the same registration code as a bundled one.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
app=$(cd "$1" && pwd); shift
[ -f "$here/plugin.js" ] || { echo "run 'pnpm install && pnpm run build' in $here first" >&2; exit 1; }
mkdir -p "$app/tests/fixtures/ghostty-terminal"
cp "$here/plugin.js" "$here/manifest.json" "$app/tests/fixtures/ghostty-terminal/"
cp "$here/test/web/fixture.tsx" "$app/tests/fixtures/ghostty-terminal/fixture.tsx"
cp "$here/test/web/ghostty-terminal.spec.mjs" "$app/tests/browser/ghostty-terminal.spec.mjs"
fixtures="$app/tests/browser/plugin-fixtures.tsx"
(cd "$app" && git checkout -- tests/browser/plugin-fixtures.tsx)
sed -i \
  -e '/^import shortcutManifest /a import { ghosttyFixture } from "../fixtures/ghostty-terminal/fixture";' \
  -e '/^  { manifest: { ...shortcutManifest, apiVersion: 1 }, module: shortcutCounter },/a \  ghosttyFixture,' \
  "$fixtures"
cd "$app"
export GHOSTTY_PLUGIN_DIR="$here"
exec nice -n 10 pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  tests/browser/ghostty-terminal.spec.mjs --project chromium --no-deps --workers=1 "$@"
