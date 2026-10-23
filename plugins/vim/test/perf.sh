#!/usr/bin/env bash
# Baseline measurements in the fixture app (see perf.spec.mjs).
#
#   [SPEC=leak.spec.mjs] plugins/vim/test/perf.sh /path/to/block/buzz-app/checkout with|without [repeats]
#
# "with" has the plugin installed, "without" has it removed from the fixture list (not merely switched off: its
# focus handlers would still run). Writes /tmp/vim-perf-MODE.N.json (PERF_OUT sets the prefix), one file per
# repeat. PLUGIN_JS measures another plugin.js than the work tree's.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
app=$(cd "$1" && pwd)
mode=$2
repeats=${3:-3}
fixtures="$app/tests/browser/plugin-fixtures.tsx"
mkdir -p "$app/tests/fixtures/vim-plugin"
cp "${PLUGIN_JS:-$here/plugin.js}" "$app/tests/fixtures/vim-plugin/plugin.js"
cp "$here/manifest.json" "$app/tests/fixtures/vim-plugin/"
spec=${SPEC:-perf.spec.mjs}
cp "$here/test/$spec" "$app/tests/browser/$spec"
# Start from the checkout's own fixture list, then add the plugin only for "with".
(cd "$app" && git checkout -- tests/browser/plugin-fixtures.tsx)
if [ "$mode" = with ]; then
  sed -i \
    -e '/^import shortcutManifest /a import * as vim from "../fixtures/vim-plugin/plugin.js";\nimport vimManifest from "../fixtures/vim-plugin/manifest.json";' \
    -e '/^  { manifest: { ...shortcutManifest, apiVersion: 1 }, module: shortcutCounter },/a \  { manifest: { ...vimManifest, apiVersion: 1 }, module: vim },' \
    "$fixtures"
fi
cd "$app"
PERF_MODE=$mode exec nice -n 10 pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  "tests/browser/$spec" --project chromium --no-deps --workers=1 --repeat-each="$repeats"
