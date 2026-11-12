// Which plugins the check after a merge to main loads (after-merge.yml runs this, and after-merge.test.mjs tests it in made-up
// repositories). Run from the root of a clone that has the whole history and its tags.
//
// Reads AFTER from the environment: the commit pushed. Of the installable plugins at AFTER (a folder under plugins/ with a
// manifest.json and a plugin.js beside it, as the desktop app's Git importer lists them), it picks each one that
//   - has no good/<folder> tag yet (so the first run on main checks and tags them all), or
//   - differs from its own tag: `git diff good/<folder> AFTER -- plugins/<folder>` shows a change.
// It does not look at what the push changed, only at where each plugin's tag is. So a push that GitHub dropped (it keeps one waiting
// run per concurrency group) cannot leave a change unchecked: the next run sees that the folder differs from its tag. A plugin that
// failed has not moved its tag, so every later push picks it again until it passes. A plugin that matches its tag is not picked, and
// a push that changes no plugin picks none once every plugin is tagged. (tag.mjs moves an existing tag only when the plugin's folder
// differs from where the tag is, so no tag moves on a push that did not change its plugin.)
//
// Appends `plugins=<JSON array of folder names>` to $GITHUB_OUTPUT and a table to $GITHUB_STEP_SUMMARY. Fails, after writing the
// output, when a folder the importer would list has a name that cannot be used in a tag: it could never be tagged.
import { COMMIT, ZERO, git, installable, isCommit, localTag, output, shown, summary } from "./lib.mjs";

const { AFTER = "" } = process.env;

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

const picked = [];
const rows = [];
for (const folder of names) {
  const tag = localTag(folder);
  let because = null;
  if (!tag) because = `no good/${folder} tag yet`;
  else if (differs(tag, AFTER, folder)) because = `it differs from good/${folder} (${tag.slice(0, 7)})`;
  if (because) picked.push(folder);
  rows.push({ folder, checked: because !== null, because: because ?? `the same as good/${folder} (${tag.slice(0, 7)})` });
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
