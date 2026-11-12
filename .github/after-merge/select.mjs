// Which plugins the check after a merge to main loads (after-merge.yml runs this, and after-merge.test.mjs tests it in made-up
// repositories). Run from the root of a clone that has the whole history and its tags.
//
// Reads BEFORE and AFTER from the environment: the commit main was at before the push, and the commit pushed. Of the installable
// plugins at AFTER (a folder under plugins/ with a manifest.json and a plugin.js beside it, as the desktop app's Git importer lists
// them), it picks each one that
//   - the push changed (`git diff BEFORE AFTER` over its folder), or
//   - has no good/<folder> tag yet (so the first run on main checks and tags them all), or
//   - is any plugin, when BEFORE is not in the history of AFTER (a force push, a new branch): what the push changed cannot be told.
// A push that changes no plugin and finds every plugin tagged picks none, so it moves no tag. (tag.mjs moves an existing tag only when
// the plugin's folder differs from where the tag is, so a check that is run for another reason moves none either.)
//
// Appends `plugins=<JSON array of folder names>` to $GITHUB_OUTPUT and a table to $GITHUB_STEP_SUMMARY. Fails, after writing the
// output, when a folder the importer would list has a name that cannot be used in a tag: it could never be tagged.
import { COMMIT, ZERO, git, installable, isAncestor, isCommit, localTag, output, shown, summary } from "./lib.mjs";

const { BEFORE = "", AFTER = "" } = process.env;

// A push that deleted the branch has nothing to check.
if (AFTER === ZERO) {
  console.log("The push deleted the branch: nothing to check.");
  output("plugins", "[]");
  process.exit(0);
}
if (!COMMIT.test(AFTER) || !isCommit(AFTER)) {
  console.error(`::error::AFTER is not a commit in this clone: '${shown(AFTER)}'`);
  process.exit(1);
}

/** Whether a folder differs between two commits. git diff --quiet exits 1 for a difference, and 128 or so for a real failure. */
const differs = (from, to, folder) => {
  const result = git("diff", "--quiet", from, to, "--", `plugins/${folder}`);
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error(`git diff ${from} ${to} failed: ${result.stderr.trim()}`);
};

const { names, refused } = installable(AFTER);
const beforeKnown = isCommit(BEFORE) && isAncestor(BEFORE, AFTER);
const everything = beforeKnown ? "" : `the commit before the push (${shown(BEFORE.slice(0, 12)) || "none"}) is not in the history`;

const picked = [];
const rows = [];
for (const folder of names) {
  const reasons = [];
  if (everything) reasons.push(everything);
  else if (differs(BEFORE, AFTER, folder)) reasons.push("the push changed it");
  if (!localTag(folder)) reasons.push(`no good/${folder} tag yet`);
  if (reasons.length) picked.push(folder);
  rows.push({ folder, checked: reasons.length > 0, because: reasons.join("; ") || "the push did not change it" });
}

console.log(`${names.length} installable plugin(s) at ${AFTER.slice(0, 7)}: ${names.join(", ") || "none"}`);
console.log(`To check: ${picked.join(", ") || "none"}`);
for (const row of rows) console.log(`  ${row.folder}: ${row.checked ? "check" : "skip"} (${row.because})`);
output("plugins", JSON.stringify(picked));
summary("### Plugins to load-check\n\n| Plugin | Checked | Because |\n| --- | --- | --- |");
for (const row of rows) summary(`| ${row.folder} | ${row.checked ? "yes" : "no"} | ${row.because} |`);

if (refused.length) {
  for (const folder of refused) {
    console.error(`::error::plugins/${shown(folder)}/ is installable, but its name cannot be used in a good/ tag: use lowercase letters, digits and hyphens, and start with a letter or digit.`);
  }
  process.exit(1);
}
