#!/usr/bin/env bash
# Run plugins/vim/test/vim.spec.mjs against the real Buzz web build in headless Chromium.
#
#   plugins/vim/test/run.sh /path/to/block/buzz-app/checkout [extra playwright args]
#
# The checkout needs `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium`
# done once. This script copies the plugin and the spec into the checkout (it is a scratch clone,
# not a place to commit) and adds the plugin to the harness's installed-fixture list, with a second
# test-only plugin (test/pins-fixture.tsx: one more page in the top bar, off until a test turns it on).
# The build is the production web app; the plugin goes through the same registration code as a bundled one.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
app=$(cd "$1" && pwd); shift
mkdir -p "$app/tests/fixtures/vim-plugin"
cp "$here/plugin.js" "$here/manifest.json" "$app/tests/fixtures/vim-plugin/"
cp "$here/test/vim.spec.mjs" "$app/tests/browser/vim.spec.mjs"
cp "$here/test/pins-fixture.tsx" "$app/tests/fixtures/vim-plugin/pins.tsx"
fixtures="$app/tests/browser/plugin-fixtures.tsx"
(cd "$app" && git checkout -- tests/browser/plugin-fixtures.tsx)
sed -i \
  -e '/^import shortcutManifest /a import * as vim from "../fixtures/vim-plugin/plugin.js";\nimport vimManifest from "../fixtures/vim-plugin/manifest.json";\nimport * as pins from "../fixtures/vim-plugin/pins";' \
  -e '/^  { manifest: { ...shortcutManifest, apiVersion: 1 }, module: shortcutCounter },/a \  { manifest: { ...vimManifest, apiVersion: 1 }, module: vim },\n  { manifest: { id: "vim-test.pins", name: "Vim test pins", apiVersion: 1 }, enabledByDefault: false, module: pins },' \
  "$fixtures"
cd "$app"
exec nice -n 10 pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  tests/browser/vim.spec.mjs --project chromium --no-deps --workers=1 "$@"
