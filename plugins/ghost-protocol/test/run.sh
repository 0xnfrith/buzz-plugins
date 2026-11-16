#!/usr/bin/env bash
# Runs test/web/ghost-protocol.spec.mjs against the real Buzz web build (headless Chromium, the app's fixture relay), with the host's
# `spawn` replaced by a stub (the web build cannot start a process).
#
#   plugins/ghost-protocol/test/run.sh /path/to/block/buzz-app/checkout [extra playwright args]
#
# The checkout needs `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium` done once. The script runs the plugin
# as committed (plugin.js and manifest.json in this folder), and copies it, a small wrapper and the spec into the checkout (a scratch
# clone, not a place to commit) and adds the plugin to the harness's installed-fixture list. The plugin goes through the same
# registration code as a bundled one. Screenshots land in $SHOTS if set.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
app=$(cd "$1" && pwd); shift
[ -f "$here/plugin.js" ] || { echo "no plugin.js in $here: run 'pnpm install && pnpm run build' there first" >&2; exit 1; }
mkdir -p "$app/tests/fixtures/ghost-protocol"
cp "$here/plugin.js" "$here/manifest.json" "$app/tests/fixtures/ghost-protocol/"
cp "$here/test/web/fixture.tsx" "$app/tests/fixtures/ghost-protocol/fixture.tsx"
cp "$here/test/web/ghost-protocol.spec.mjs" "$app/tests/browser/ghost-protocol.spec.mjs"
fixtures="$app/tests/browser/plugin-fixtures.tsx"
(cd "$app" && git checkout -- tests/browser/plugin-fixtures.tsx)
sed -i \
  -e '/^import shortcutManifest /a import { ghostProtocolFixture } from "../fixtures/ghost-protocol/fixture";' \
  -e '/^  { manifest: { ...shortcutManifest, apiVersion: 1 }, module: shortcutCounter },/a \  ghostProtocolFixture,' \
  "$fixtures"
cd "$app"
exec nice -n 10 pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  tests/browser/ghost-protocol.spec.mjs --project chromium --no-deps --workers=1 "$@"
