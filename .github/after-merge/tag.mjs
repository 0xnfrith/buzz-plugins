// Moves good/<folder> to the pushed commit for each plugin that passed the load check (after-merge.yml runs this in its one job that
// may write, and after-merge.test.mjs tests it against made-up repositories). Run from the root of a clone that has the whole history.
//
// Reads from the environment:
//   AFTER     the commit that was checked and pushed
//   SELECTED  JSON array: the plugin folders that were picked to be checked
//   PASSED    JSON array: the plugin folders that passed
//   REMOTE    where the tags live (default: origin)
// A tag moves only forward: it is created at AFTER when it does not exist, and moved to AFTER only when the commit it points at is an
// ancestor of AFTER. A tag already at AFTER stays. A tag at a commit that contains AFTER (a newer run got there first) stays, and the
// run does not fail. A tag at a commit that is neither (history was rewritten) is left alone and the run fails: a person has to look.
// An existing tag moves only if the plugin's folder differs between the commit the tag is at and AFTER: a tag does not move on a check
// of a plugin that has not changed since it. The push names the commit it expects the tag to be at, so a tag that moved meanwhile is
// not overwritten.
// A plugin that was not selected, is not installable at AFTER, or is not a name usable in a tag is never tagged, whatever PASSED says.
// Each plugin is handled on its own: one that cannot be tagged does not stop the others. Exits 1 if any could not be.
import { COMMIT, NAME, git, installable, isAncestor, isCommit, shown, summary, tagRef } from "./lib.mjs";

const { AFTER = "", REMOTE = "origin" } = process.env;

/** A JSON array of strings from the environment, or a reason it is not one. */
const list = (variable) => {
  let value;
  try {
    value = JSON.parse(process.env[variable] ?? "");
  } catch {
    throw new Error(`${variable} is not JSON`);
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${variable} is not a list of folder names`);
  return value;
};

if (!COMMIT.test(AFTER) || !isCommit(AFTER)) {
  console.error(`::error::AFTER is not a commit in this clone: '${shown(AFTER)}'`);
  process.exit(1);
}
let selected, passed;
try {
  selected = list("SELECTED");
  passed = list("PASSED");
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}

/** The commit the remote's good/<name> tag points at (a tag on a tag counts for what it points at), or null if it has none. */
const remoteTag = (name) => {
  const result = git("ls-remote", "--tags", REMOTE, tagRef(name));
  if (result.status !== 0) throw new Error(`git ls-remote ${REMOTE} failed: ${result.stderr.trim()}`);
  const shas = new Map(result.stdout.split("\n").filter(Boolean).map((line) => line.split("\t").reverse()));
  return shas.get(`${tagRef(name)}^{}`) ?? shas.get(tagRef(name)) ?? null;
};

const { names: installed } = installable(AFTER);
const outcomes = [];
let problems = 0;
for (const folder of [...new Set(passed)].sort()) {
  const done = (what, bad = false) => {
    outcomes.push(`| ${shown(folder)} | ${shown(what)} |`);
    console.log(`${bad ? "::error::" : ""}${shown(folder)}: ${what}`);
    if (bad) problems++;
  };
  if (!NAME.test(folder)) {
    done("not a plugin folder name: not tagged", true);
    continue;
  }
  if (!selected.includes(folder)) {
    done("it passed but was not one of the plugins picked to be checked: not tagged", true);
    continue;
  }
  if (!installed.includes(folder)) {
    done(`not installable at ${AFTER.slice(0, 7)}: not tagged`, true);
    continue;
  }
  try {
    const current = remoteTag(folder);
    if (current === AFTER) {
      done(`good/${folder} is already at ${AFTER.slice(0, 7)}`);
      continue;
    }
    if (current) {
      // The commit may be one this clone does not have (the clone is as old as the run's start); fetching it also puts the tag here.
      if (!isCommit(current)) git("fetch", "--no-tags", REMOTE, `+${tagRef(folder)}:${tagRef(folder)}`);
      if (!isCommit(current)) {
        done(`good/${folder} is at ${current.slice(0, 7)}, which this clone cannot read: not moved`, true);
        continue;
      }
      // A difference is exit status 1; anything else but 0 is a failure of git, and is not read as "unchanged".
      const unchanged = git("diff", "--quiet", current, AFTER, "--", `plugins/${folder}`);
      if (unchanged.status === 0) {
        done(`good/${folder} is at ${current.slice(0, 7)}, and plugins/${folder} has not changed since: left there`);
        continue;
      }
      if (unchanged.status !== 1) throw new Error(`git diff failed: ${unchanged.stderr.trim()}`);
      if (isAncestor(AFTER, current)) {
        done(`good/${folder} is at ${current.slice(0, 7)}, which already contains ${AFTER.slice(0, 7)}: left there`);
        continue;
      }
      if (!isAncestor(current, AFTER)) {
        done(`good/${folder} is at ${current.slice(0, 7)}, which is not in the history of ${AFTER.slice(0, 7)}: not moved, a person has to decide`, true);
        continue;
      }
    }
    // --force-with-lease with the expected commit (nothing, for a new tag): a tag that moved since we looked is not overwritten.
    const push = git("push", REMOTE, `--force-with-lease=${tagRef(folder)}:${current ?? ""}`, `${AFTER}:${tagRef(folder)}`);
    if (push.status !== 0) {
      done(`the push of good/${folder} failed: ${push.stderr.trim().split("\n").pop()}`, true);
      continue;
    }
    done(current ? `good/${folder} moved from ${current.slice(0, 7)} to ${AFTER.slice(0, 7)}` : `good/${folder} created at ${AFTER.slice(0, 7)}`);
  } catch (error) {
    done(`could not be tagged: ${error.message}`, true);
  }
}

const failed = selected.filter((folder) => !passed.includes(folder));
summary(`### Known-good tags at ${AFTER.slice(0, 7)}\n\n| Plugin | Tag |\n| --- | --- |`);
for (const outcome of outcomes) summary(outcome);
if (failed.length) summary(`\nFailed the load check, so their tags stay where they were: ${failed.join(", ")}`);
process.exit(problems ? 1 : 0);
