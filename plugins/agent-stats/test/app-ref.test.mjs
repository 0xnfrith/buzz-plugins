// The plugin is tested against one block/buzz-app commit, named in its workflow as AGENT_STATS_APP_REF. The shared guard
// (.github/check-app-ref.sh) does not read this variable, so this checks it: a full commit, named once, and the same commit that
// NOTES.md says the plugin was tested against.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflow = readFileSync(join(root, ".github", "workflows", "agent-stats-tests.yml"), "utf8");
const notes = readFileSync(join(root, "plugins", "agent-stats", "NOTES.md"), "utf8");

test("the workflow names one full commit for the app, and uses it", () => {
  const definitions = [...workflow.matchAll(/^ {2}AGENT_STATS_APP_REF: (\S+)(?: .*)?$/gm)];
  assert.equal(definitions.length, 1, "defined once");
  assert.match(definitions[0][1], /^[0-9a-f]{40}$/, "a 40-character commit, not a branch or a short name");
  assert.match(workflow, /^ {10}ref: \$\{\{ env\.AGENT_STATS_APP_REF \}\}$/m, "the app is checked out at it");
});

test("NOTES.md says the plugin was tested against the commit the workflow runs", () => {
  const commit = workflow.match(/^ {2}AGENT_STATS_APP_REF: ([0-9a-f]{40})/m)[1];
  const tested = notes.split("\n").filter((line) => line.startsWith("**Tested against**"));
  assert.equal(tested.length, 1, "NOTES.md has one 'Tested against' line");
  assert.ok(tested[0].includes(`block/buzz-app \`${commit}\``), `its block/buzz-app commit is not ${commit}`);
});

test("the shared guard still passes with this workflow beside the others, and does not read this variable", () => {
  assert.doesNotMatch(workflow, /^ {2}BUZZ_APP_REF:/m);
  assert.doesNotMatch(workflow.replace(/^\s*#.*$/gm, ""), /env\.BUZZ_APP_REF/);
});
