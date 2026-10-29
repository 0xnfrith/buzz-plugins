#!/usr/bin/env bash
# Runs test/web/linear.spec.mjs against the real Buzz web build (headless Chromium, fixture relay).
#
#   plugins/linear/test/run.sh /path/to/block/buzz-app/checkout [extra playwright args]
#
# The checkout needs `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium`
# done once, and this folder needs `pnpm install` (the fake Linear uses graphql-js). The script
# copies the built plugin, a small wrapper and the spec into the checkout (a scratch clone, not a
# place to commit) and adds the plugin to the harness's installed-fixture list. The plugin goes
# through the same registration code as a bundled one. Screenshots land in $SHOTS if set.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
app=$(cd "$1" && pwd); shift
"$here/test/fake-linear/fetch-schema.sh"
[ -d "$here/node_modules/graphql" ] || { echo "run 'pnpm install' in $here first" >&2; exit 1; }
mkdir -p "$app/tests/fixtures/linear-plugin"
cp "$here/plugin.js" "$here/manifest.json" "$app/tests/fixtures/linear-plugin/"
cp "$here/test/web/fixture.tsx" "$app/tests/fixtures/linear-plugin/fixture.tsx"
cp "$here/test/web/linear.spec.mjs" "$app/tests/browser/linear.spec.mjs"
fixtures="$app/tests/browser/plugin-fixtures.tsx"
if ! grep -q linear-plugin "$fixtures"; then
  sed -i \
    -e '/^import shortcutManifest /a import { linearFixture } from "../fixtures/linear-plugin/fixture";' \
    -e '/^  { manifest: { ...shortcutManifest, apiVersion: 1 }, module: shortcutCounter },/a \  linearFixture,' \
    "$fixtures"
fi
cd "$app"
export LINEAR_PLUGIN_DIR="$here"
exec nice -n 10 pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  tests/browser/linear.spec.mjs --project chromium --no-deps --workers=1 "$@"
