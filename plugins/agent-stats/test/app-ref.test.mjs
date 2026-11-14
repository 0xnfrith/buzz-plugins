// The plugin is tested against the one block/buzz-app commit every workflow that builds the app names, as BUZZ_APP_REF. The shared guard
// (.github/check-app-ref.sh, which plugins/agent-skills-highlighter/test/app-ref.test.mjs runs on the real workflows) keeps that commit the
// same everywhere; this checks what is specific to this workflow: it defines it once, checks the app out at it, runs the guard first, and
// NOTES.md says the plugin was tested against the same commit.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflow = readFileSync(join(root, ".github", "workflows", "agent-stats-tests.yml"), "utf8");
const notes = readFileSync(join(root, "plugins", "agent-stats", "NOTES.md"), "utf8");

test("the workflow names one full commit for the app, and uses it", () => {
  const definitions = [...workflow.matchAll(/^ {2}BUZZ_APP_REF: (\S+)(?: .*)?$/gm)];
  assert.equal(definitions.length, 1, "defined once");
  assert.match(definitions[0][1], /^[0-9a-f]{40}$/, "a 40-character commit, not a branch or a short name");
  assert.match(workflow, /^ {10}ref: \$\{\{ env\.BUZZ_APP_REF \}\}$/m, "the app is checked out at it");
});

test("the workflow has no commit of its own, and runs the shared guard before it checks the app out", () => {
  assert.doesNotMatch(workflow, /AGENT_STATS_APP_REF/, "the plugin's own variable is gone");
  const guard = workflow.indexOf("run: .github/check-app-ref.sh");
  assert.ok(guard > 0, "the browser job runs the guard");
  assert.ok(guard < workflow.indexOf("repository: block/buzz-app"), "and runs it first");
});

test("NOTES.md says the plugin was tested against the commit the workflow runs", () => {
  const commit = workflow.match(/^ {2}BUZZ_APP_REF: ([0-9a-f]{40})/m)[1];
  const tested = notes.split("\n").filter((line) => line.startsWith("**Tested against**"));
  assert.equal(tested.length, 1, "NOTES.md has one 'Tested against' line");
  assert.ok(tested[0].includes(`block/buzz-app \`${commit}\``), `its block/buzz-app commit is not ${commit}`);
});
