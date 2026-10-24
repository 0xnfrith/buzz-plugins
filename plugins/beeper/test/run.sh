#!/usr/bin/env bash
# Runs test/web/beeper.spec.mjs against the real Buzz web build (headless Chromium, fixture relay).
#
#   plugins/beeper/test/run.sh /path/to/block/buzz-app/checkout [extra playwright args]
#
# The checkout needs `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium`
# done once. The script copies the built plugin, a small wrapper and the spec into the checkout (a
# scratch clone, not a place to commit) and adds the plugin to the harness's installed-fixture
# list. The plugin goes through the same registration code as a bundled one. The spec runs the
# real curl against a fake Beeper Desktop on loopback. Screenshots land in $SHOTS if set.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
app=$(cd "$1" && pwd); shift
mkdir -p "$app/tests/fixtures/beeper-plugin"
cp "$here/plugin.js" "$here/manifest.json" "$app/tests/fixtures/beeper-plugin/"
cp "$here/test/web/fixture.tsx" "$app/tests/fixtures/beeper-plugin/fixture.tsx"
cp "$here/test/web/beeper.spec.mjs" "$app/tests/browser/beeper.spec.mjs"
fixtures="$app/tests/browser/plugin-fixtures.tsx"
if ! grep -q beeper-plugin "$fixtures"; then
  sed -i \
    -e '/^import shortcutManifest /a import { beeperFixture } from "../fixtures/beeper-plugin/fixture";' \
    -e '/^  { manifest: { ...shortcutManifest, apiVersion: 1 }, module: shortcutCounter },/a \  beeperFixture,' \
    "$fixtures"
fi
cd "$app"
export BEEPER_PLUGIN_DIR="$here"
exec nice -n 10 pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  tests/browser/beeper.spec.mjs --project chromium --no-deps --workers=1 "$@"
