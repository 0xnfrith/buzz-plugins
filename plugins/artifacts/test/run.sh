#!/usr/bin/env bash
# Runs test/web/artifacts.spec.mjs against the real Buzz web build (headless Chromium, fixture relay): what the node tests
# cannot see, which is real focus, `autoFocus` and whether Esc reaches the Settings dialog.
#
#   plugins/artifacts/test/run.sh /path/to/block/buzz-app/checkout [extra playwright args]
#
# The checkout needs `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium` done once. The script
# copies the plugin and the spec into the checkout (a scratch clone, not a place to commit) and adds the plugin to the
# harness's installed-fixture list, so it goes through the same registration code as a bundled one. The web build has no
# built-in browser (`ctx.browser.available` is false), so the page itself is not driven here, only the Settings card.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
app=$(cd "$1" && pwd); shift
mkdir -p "$app/tests/fixtures/artifacts-plugin"
cp "$here/plugin.js" "$here/manifest.json" "$app/tests/fixtures/artifacts-plugin/"
cp "$here/test/web/artifacts.spec.mjs" "$app/tests/browser/artifacts.spec.mjs"
fixtures="$app/tests/browser/plugin-fixtures.tsx"
(cd "$app" && git checkout -- tests/browser/plugin-fixtures.tsx)
sed -i \
  -e '/^import shortcutManifest /a import * as artifacts from "../fixtures/artifacts-plugin/plugin.js";\nimport artifactsManifest from "../fixtures/artifacts-plugin/manifest.json";' \
  -e '/^  { manifest: { ...shortcutManifest, apiVersion: 1 }, module: shortcutCounter },/a \  { manifest: { ...artifactsManifest, apiVersion: 1 }, module: artifacts },' \
  "$fixtures"
cd "$app"
exec nice -n 10 pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  tests/browser/artifacts.spec.mjs --project chromium --no-deps --workers=1 "$@"
