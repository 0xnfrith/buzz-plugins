#!/usr/bin/env bash
# The key-latency budget of Vim mode (see budget.spec.mjs and README.md, "Key latency budget").
#
#   plugins/vim/test/budget.sh /path/to/block/buzz-app/checkout [playwright args]
#
# Installs the plugin in the checkout's fixture app the way perf.sh does, runs plugins/vim/test/budget.spec.mjs, and leaves the
# table in BUDGET_OUT.md and BUDGET_OUT.json (default /tmp/vim-budget.md and .json). Exit status: non-zero when a row's p99 is
# over 50 ms in every attempt. Settings come from BUDGET_* variables (see the head of the spec). BUDGET_PLUGIN=/path/plugin.js
# measures another build of the plugin (the one on main, to compare with a branch). Nothing else may be running: the numbers
# are milliseconds, and on a small machine another program (the app itself) is enough to double them.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
app=$(cd "$1" && pwd); shift
mkdir -p "$app/tests/fixtures/vim-plugin"
cp "${BUDGET_PLUGIN:-$here/../plugin.js}" "$app/tests/fixtures/vim-plugin/plugin.js"
cp "$here/../manifest.json" "$app/tests/fixtures/vim-plugin/"
cp "$here/budget.spec.mjs" "$here/budget.baseline.json" "$app/tests/browser/"
fixtures="$app/tests/browser/plugin-fixtures.tsx"
(cd "$app" && git checkout -- tests/browser/plugin-fixtures.tsx)
sed -i \
  -e '/^import shortcutManifest /a import * as vim from "../fixtures/vim-plugin/plugin.js";\nimport vimManifest from "../fixtures/vim-plugin/manifest.json";' \
  -e '/^  { manifest: { ...shortcutManifest, apiVersion: 1 }, module: shortcutCounter },/a \  { manifest: { ...vimManifest, apiVersion: 1 }, module: vim },' \
  "$fixtures"
rm -f "${BUDGET_OUT:-/tmp/vim-budget}.rows.jsonl"
cd "$app"
exec nice -n 10 pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  tests/browser/budget.spec.mjs --project chromium --no-deps --workers=1 --reporter=list "$@"
