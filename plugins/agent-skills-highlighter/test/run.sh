#!/usr/bin/env bash
# Runs test/web/skills.spec.mjs (and, with SKILLS_PERF=1, test/web/perf.spec.mjs) against the real Buzz web build (headless Chromium, fixture relay).
#
#   plugins/agent-skills-highlighter/test/run.sh /path/to/block/buzz-app/checkout [extra playwright args]
#
# The checkout needs `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium` done once. The script copies the
# plugin, a small wrapper and the specs into the checkout (a scratch clone, not a place to commit) and adds the plugin to the
# harness's installed-fixture list, so it goes through the same registration code as a bundled one. The web build cannot run the
# declared program, so the wrapper points `ctx.host.runCommand` at a stand-in the spec supplies.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
app=$(cd "$1" && pwd); shift
mkdir -p "$app/tests/fixtures/agent-skills-highlighter"
cp "$here/plugin.js" "$here/manifest.json" "$here/test/web/fixture.tsx" "$app/tests/fixtures/agent-skills-highlighter/"
# The functional spec always; the performance spec (a few minutes: it fills a 2,400-message channel twice) only with SKILLS_PERF=1.
rm -f "$app"/tests/browser/skills-*.spec.mjs
cp "$here/test/web/skills.spec.mjs" "$app/tests/browser/skills-skills.spec.mjs"
(cd "$app" && git checkout -- tests/browser/fixture.mjs)
if [ "${SKILLS_PERF:-}" = 1 ]; then
  cp "$here/test/web/perf.spec.mjs" "$app/tests/browser/skills-perf.spec.mjs"
  # In the scratch checkout only: every fifth message of the fixture's history holds the skills, a few times over.
  sed -i 's|"Mixed height message content. ".repeat|(i % 5 === 0 ? "Mixed height /brainstorming content /plan-review. " : "Mixed height message content. ").repeat|' "$app/tests/browser/fixture.mjs"
  grep -q '/brainstorming content' "$app/tests/browser/fixture.mjs" || { echo "the fixture's message text was not found; the performance spec cannot run" >&2; exit 1; }
fi
fixtures="$app/tests/browser/plugin-fixtures.tsx"
(cd "$app" && git checkout -- tests/browser/plugin-fixtures.tsx)
sed -i \
  -e '/^import shortcutManifest /a import { skillsFixture } from "../fixtures/agent-skills-highlighter/fixture";' \
  -e '/^  { manifest: { ...shortcutManifest, apiVersion: 1 }, module: shortcutCounter },/a \  skillsFixture,' \
  "$fixtures"
cd "$app"
exec nice -n 10 pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  tests/browser/skills-*.spec.mjs --project chromium --no-deps --workers=1 "$@"
