#!/usr/bin/env bash
# Runs test/web/stats.spec.mjs against the real Buzz web build (headless Chromium, fixture relay).
#
#   plugins/agent-stats/test/run.sh /path/to/block/buzz-app/checkout [extra playwright args]
#
# The checkout needs `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium` done once, and must be at the commit
# the workflow names (AGENT_STATS_APP_REF in .github/workflows/agent-stats-tests.yml). The script copies the plugin, a small wrapper and
# the spec into the checkout (a scratch clone, not a place to commit) and adds the plugin to the harness's installed-fixture list, so it
# goes through the same registration code as a bundled one. Screenshots land in $SHOTS if set.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
app=$(cd "$1" && pwd); shift
mkdir -p "$app/tests/fixtures/agent-stats"
cp "$here/plugin.js" "$here/manifest.json" "$here/test/web/fixture.tsx" "$app/tests/fixtures/agent-stats/"
cp "$here/test/web/stats.spec.mjs" "$app/tests/browser/agent-stats.spec.mjs"
fixtures="$app/tests/browser/plugin-fixtures.tsx"
(cd "$app" && git checkout -- tests/browser/plugin-fixtures.tsx)
sed -i \
  -e '/^import shortcutManifest /a import { statsFixture } from "../fixtures/agent-stats/fixture";' \
  -e '/^  { manifest: { ...shortcutManifest, apiVersion: 1 }, module: shortcutCounter },/a \  statsFixture,' \
  "$fixtures"
grep -q 'statsFixture,' "$fixtures" || { echo "the harness's fixture list was not found; the plugin was not registered" >&2; exit 1; }
cd "$app"
exec nice -n 10 pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  tests/browser/agent-stats.spec.mjs --project chromium --no-deps --workers=1 "$@"
