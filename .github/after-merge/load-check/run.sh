#!/usr/bin/env bash
# The load check: loads each named plugin's committed plugin.js and manifest.json in block/buzz-app's own production web build, in
# headless Chromium with the harness's fixture relay (load-check.spec.mjs says what must hold). The same for every plugin.
#
#   .github/after-merge/load-check/run.sh /path/to/block/buzz-app/checkout <plugin folder>...
#
# The checkout needs `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium` done once, and must be at the
# BUZZ_APP_REF of .github/workflows/after-merge.yml. The script copies the plugin, a small wrapper and the spec into the checkout (a
# scratch clone, not a place to commit), adds the plugin to the harness's installed-fixture list, so it goes through the same
# registration code as a bundled one, and puts everything back when it ends. Each plugin gets its own build of the app and its own
# browser, so a plugin that does not even build or evaluate fails alone.
#
# Every plugin is checked, whatever happens to the ones before it. Writes the result to $LOAD_CHECK_RESULTS (default
# load-check-results.json in the current folder) as {"passed": [...], "failed": [...], "seconds": {"<folder>": n}}, prints a table, and
# exits 1 if any plugin failed. $LOAD_CHECK_PLUGINS_DIR (default: plugins/ of this repository) is where the plugin folders are; the
# canary (canary.mjs) points it at made-up plugins, some of them broken. Playwright clears its results folder at each run, so for a
# plugin that fails, its results (traces, screenshots) are copied to $LOAD_CHECK_ARTIFACTS/<folder> when that is set.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../.." && pwd)
here=$(cd "$(dirname "$0")" && pwd)
[ $# -ge 2 ] || { echo "usage: $0 <block/buzz-app checkout> <plugin folder>..." >&2; exit 2; }
app=$(cd "$1" && pwd); shift
plugins=$(cd "${LOAD_CHECK_PLUGINS_DIR:-$repo/plugins}" && pwd)
results=${LOAD_CHECK_RESULTS:-$PWD/load-check-results.json}
fixtures="$app/tests/browser/plugin-fixtures.tsx"

# Puts the checkout back as it was found, however the script ends.
tidy() {
  (cd "$app" && git checkout -q -- tests/browser/plugin-fixtures.tsx) || true
  rm -rf "$app/tests/fixtures/load-check" "$app/tests/browser/load-check.spec.mjs"
}
trap tidy EXIT
tidy

passed=()
failed=()
rows=()
seconds="{}"
for name in "$@"; do
  [[ $name =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "::error::'$name' is not a plugin folder name" >&2; exit 2; }
  folder="$plugins/$name"
  started=$SECONDS
  echo "::group::Load check: $name"
  status=0
  if [ -f "$folder/plugin.js" ] && [ -f "$folder/manifest.json" ]; then
    # The manifest the importer reads: a name, an id and apiVersion 1 (the wrapper registers the plugin under exactly these).
    id=$(node -e '
      const manifest = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const text = (value) => typeof value === "string" && value.trim() !== "";
      if (!text(manifest.id) || !text(manifest.name) || manifest.apiVersion !== 1) {
        console.error("manifest.json needs an id, a name (both text) and apiVersion 1");
        process.exit(1);
      }
      console.log(manifest.id);' "$folder/manifest.json") || status=1
  else
    echo "plugins/$name has no plugin.js and manifest.json" >&2
    status=1
  fi
  if [ "$status" = 0 ]; then
    tidy
    mkdir -p "$app/tests/fixtures/load-check"
    cp "$folder/plugin.js" "$folder/manifest.json" "$here/fixture.tsx" "$app/tests/fixtures/load-check/"
    cp "$here/load-check.spec.mjs" "$app/tests/browser/load-check.spec.mjs"
    sed -i \
      -e '/^import shortcutManifest /a import { loadCheckFixture } from "../fixtures/load-check/fixture";' \
      -e '/^  { manifest: { ...shortcutManifest, apiVersion: 1 }, module: shortcutCounter },/a \  loadCheckFixture,' \
      "$fixtures"
    # Not registered means not checked: the check would find nothing to load, so stop rather than pass.
    if grep -q 'loadCheckFixture,' "$fixtures"; then
      (cd "$app" && LOAD_CHECK_PLUGIN="$name" LOAD_CHECK_PLUGIN_ID="$id" \
        pnpm exec playwright test --config tests/browser/playwright.config.mjs \
        tests/browser/load-check.spec.mjs --project chromium --no-deps --workers=1) || status=$?
    else
      echo "::error::the harness's fixture list was not found; the plugin was not registered" >&2
      status=1
    fi
  fi
  took=$((SECONDS - started))
  if [ "$status" != 0 ] && [ -n "${LOAD_CHECK_ARTIFACTS:-}" ] && [ -d "$app/test-results" ]; then
    mkdir -p "$LOAD_CHECK_ARTIFACTS/$name" && cp -r "$app/test-results/." "$LOAD_CHECK_ARTIFACTS/$name/" || true
  fi
  echo "::endgroup::"
  if [ "$status" = 0 ]; then passed+=("$name"); rows+=("| $name | passed | ${took}s |"); else failed+=("$name"); rows+=("| $name | FAILED | ${took}s |"); fi
  seconds=$(node -e 'const s = JSON.parse(process.argv[1]); s[process.argv[2]] = Number(process.argv[3]); console.log(JSON.stringify(s))' "$seconds" "$name" "$took")
done

json() { node -e 'console.log(JSON.stringify(process.argv.slice(1)))' "$@"; }
node -e 'console.log(JSON.stringify({ passed: JSON.parse(process.argv[1]), failed: JSON.parse(process.argv[2]), seconds: JSON.parse(process.argv[3]) }, null, 2))' \
  "$(json "${passed[@]}")" "$(json "${failed[@]}")" "$seconds" >"$results"
{
  echo "| Plugin | Load check | Time |"
  echo "| --- | --- | --- |"
  printf '%s\n' "${rows[@]}"
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
[ ${#failed[@]} -eq 0 ]
