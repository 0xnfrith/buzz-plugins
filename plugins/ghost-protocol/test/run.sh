#!/usr/bin/env bash
# Runs test/web/ghost-protocol.spec.mjs, status-screen.spec.mjs, create-form.spec.mjs and claude-guide.spec.mjs against the real Buzz web
# build (headless Chromium, the app's fixture relay), with the host's `spawn` replaced by a stub (the web build cannot start a process). The first scripts what
# `docker version` prints. The second hands every call to the fake `docker` (test/fake-docker), which it runs in Node, so what the plugin
# reads is what the fake printed. The third does the same and also streams stdin to the fake and its output back (test/web/pipe.mjs), for
# the create form and (the fourth) the Claude guide, which write a Claude token and a login code; those two share test/web/agents-page.mjs.
# The specs find the fake through GHOST_PROTOCOL_DIR, which this script sets to this plugin's folder.
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
cp "$here/test/web/status-screen.spec.mjs" "$app/tests/browser/ghost-protocol-status.spec.mjs"
cp "$here/test/web/create-form.spec.mjs" "$app/tests/browser/ghost-protocol-create.spec.mjs"
cp "$here/test/web/claude-guide.spec.mjs" "$app/tests/browser/ghost-protocol-claude-guide.spec.mjs"
cp "$here/test/web/agents-page.mjs" "$app/tests/browser/ghost-protocol-agents-page.mjs"
fixtures="$app/tests/browser/plugin-fixtures.tsx"
(cd "$app" && git checkout -- tests/browser/plugin-fixtures.tsx)
sed -i \
  -e '/^import shortcutManifest /a import { ghostProtocolFixture } from "../fixtures/ghost-protocol/fixture";' \
  -e '/^  { manifest: { ...shortcutManifest, apiVersion: 1 }, module: shortcutCounter },/a \  ghostProtocolFixture,' \
  "$fixtures"
cd "$app"
export GHOST_PROTOCOL_DIR="$here"
exec nice -n 10 pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  tests/browser/ghost-protocol.spec.mjs tests/browser/ghost-protocol-status.spec.mjs tests/browser/ghost-protocol-create.spec.mjs tests/browser/ghost-protocol-claude-guide.spec.mjs --project chromium --no-deps --workers=1 "$@"
