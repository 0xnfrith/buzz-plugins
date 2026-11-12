// The verdict of a run of after-merge.yml (its last job runs this, and after-merge.test.mjs tests it). Exits 1, with an error for each
// reason, unless everything went well: every step ended as it should, no plugin failed the load check, and no folder was refused.
// It writes nothing, and the job that runs it can only read.
//
// Reads from the environment:
//   SELECT, CHECK, TAG  how the jobs of those names ended: success, failure, cancelled or skipped
//   REFUSED             JSON array: the plugin folders whose names cannot be a tag name (output of select)
//   FAILED              JSON array: the plugins that failed the load check (output of check); empty if check did not run
// A job that was skipped is fine when there was nothing for it to do: check is skipped when no plugin was picked, and tag with it. If
// check ran to its end, tag must have succeeded.
const { SELECT = "", CHECK = "", TAG = "", REFUSED = "", FAILED = "" } = process.env;

/** A JSON array of strings, as a list for a message, or null if it is not one. Control characters are shown as escapes, not raw. */
const names = (text) => {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
  } catch {
    return null;
  }
};
const shown = (list) => list.map((item) => JSON.stringify(item).slice(0, 200)).join(", ");

const problems = [];
if (SELECT !== "success") problems.push(`Picking the plugins ended as '${SELECT}', so nothing else can be trusted.`);
else {
  const refused = names(REFUSED);
  if (refused === null) problems.push("Picking the plugins wrote no list of refused folder names.");
  else if (refused.length) problems.push(`These plugin folders cannot be tagged, because their names are not lowercase letters, digits and hyphens: ${shown(refused)}. Rename them.`);
}
if (!["success", "skipped"].includes(CHECK)) problems.push(`The load check ended as '${CHECK}'.`);
if (CHECK === "success") {
  const failed = names(FAILED);
  if (failed === null) problems.push("The load check wrote no list of the plugins that failed.");
  else if (failed.length) problems.push(`These plugins did not load in Buzz's web build: ${shown(failed)}. Their good/ tags stay where they were.`);
  if (TAG !== "success") problems.push(`The load check ran, but tagging ended as '${TAG}'.`);
} else if (!["success", "skipped"].includes(TAG)) problems.push(`Tagging ended as '${TAG}'.`);

if (problems.length) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}
console.log("Every picked plugin loaded and was tagged where it should be.");
