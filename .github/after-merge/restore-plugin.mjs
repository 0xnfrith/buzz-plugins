#!/usr/bin/env node
// The way back: restores one plugin's folder to what it was at its known-good tag (good/<plugin>, docs/known-good.md) by opening a pull
// request. It never changes main, and never writes to the working tree. Run it from a clone of the repository, with git and gh set up:
//
//   .github/after-merge/restore-plugin.mjs <plugin>          a dry run: says what it would do, and does nothing
//   .github/after-merge/restore-plugin.mjs <plugin> --open   pushes a branch and opens the pull request with gh
//
// What it does, in this order:
//   1. Refuses unless <plugin> is a plugin folder name, the working tree is clean, and origin has a good/<plugin> tag.
//   2. Fetches origin's main and that one tag (a plain fetch: the only thing a dry run writes, and the tag it fetches replaces a local
//      tag of the same name, as the remote's tag is the one that counts). It never fetches or pushes any other tag.
//   3. Refuses unless the tag's commit is in the history of origin/main and plugins/<plugin>/ differs between the two, and unless the
//      branch it would use does not exist yet, locally or on origin.
//   4. A dry run prints the plugin, the two commits, the diff stat it would apply, and the branch and pull request title, and stops.
//   5. With --open it builds one commit on top of origin/main, in a temporary index, so neither the working tree nor any branch of the
//      clone changes: origin/main's tree with plugins/<plugin>/ replaced by the tag's. It checks that the commit's folder is the tag's
//      folder (the same tree object, so the same bytes and modes), that it changed nothing outside the folder, and that its parent is
//      origin/main. Only then does it push that commit as a new branch (never forced, never main) and open the pull request against main.
//
// The pull request goes through the normal pipeline: all-tests, review, merge. This script merges nothing and pushes no tag.
import { spawnSync } from "node:child_process";
import { NAME, ZERO, git, gitOut, isAncestor, tagRef } from "./lib.mjs";
import { BASE, REMOTE, Refusal, build, folderOf, objectAt, refuse, verify } from "./restore-lib.mjs";

const USAGE = `Usage: restore-plugin.mjs <plugin> [--open]

Restores plugins/<plugin>/ to what it was at its good/<plugin> tag, by a pull request against ${BASE}.
Without --open it is a dry run: it prints what it would do and changes nothing. With --open it pushes
a new branch and opens the pull request with gh. Run it from a clone of the repository.`;

/** A command line that cannot be read: exit 2. */
class Usage extends Error {}

/** The plugin folder name and whether --open was given. Anything else on the command line is an error, never ignored. */
const parse = (argv) => {
  let name = null;
  let open = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--open") open = true;
    else if (arg.startsWith("-")) throw new Usage(`unknown option ${JSON.stringify(arg)}`);
    else if (name !== null) throw new Usage("more than one plugin was named");
    else name = arg;
  }
  if (name === null) throw new Usage("no plugin was named");
  return { name, open };
};

/** Whether the remote has this exact ref (a pattern given to ls-remote matches the end of a ref name, so the answer is checked). */
const remoteHas = (ref) => {
  const result = git("ls-remote", REMOTE, ref);
  if (result.status !== 0) refuse(`could not read ${REMOTE}: ${result.stderr.trim()}`);
  return result.stdout.split("\n").some((line) => line.split("\t")[1] === ref || line.split("\t")[1] === `${ref}^{}`);
};

const titleOf = (name, tagSha) => `Restore plugins/${name} to its known-good version (good/${name} at ${tagSha.slice(0, 7)})`;
const branchOf = (name, tagSha, mainSha) => `restore-${name}-to-${tagSha.slice(0, 7)}-on-${mainSha.slice(0, 7)}`;
const bodyOf = ({ name, tagSha, mainSha, stat }) => `Origin: the repository's AGENTS.md requires a stated way back to the last good commit for each plugin; this restores \`plugins/${name}/\` from its known-good tag.

This pull request restores \`plugins/${name}/\` to exactly what it was at \`good/${name}\`, the last commit where the after-merge check loaded the plugin (docs/known-good.md). Files added to the folder since then are removed. Nothing outside \`plugins/${name}/\` changes.

| | |
| --- | --- |
| Plugin | \`${name}\` |
| Tag | \`good/${name}\` |
| Tag commit | \`${tagSha}\` |
| \`${BASE}\` commit | \`${mainSha}\` |

Diff stat, \`${BASE}\` to the tag, for \`plugins/${name}/\` only:

\`\`\`
${stat}
\`\`\`

The restore came from the known-good tag, with \`.github/after-merge/restore-plugin.mjs\`. \`plugin.js\` is restored as built at that commit, together with the source it was built from, so the check that the committed \`plugin.js\` is the build of that source sees the pair that passed it then.

It goes through the normal checks (\`all-tests\`), review and merge. After the merge the folder is the same as at the tag, so the after-merge check has nothing to pick for it and the tag stays where it is.

A run of each plugin in the desktop app itself is still not built: this restore has not been tried there.`;

const run = () => {
  const args = parse(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const { name, open } = args;
  const folder = folderOf(name);
  if (!NAME.test(name)) refuse(`${JSON.stringify(name)} is not a plugin folder name: lowercase letters, digits and hyphens, starting with a letter or a digit`);

  const top = git("rev-parse", "--show-toplevel");
  if (top.status !== 0) refuse("this is not a git repository: run it from a clone of the repository");
  process.chdir(top.stdout.trim());
  if (git("remote", "get-url", REMOTE).status !== 0) refuse(`this clone has no remote called ${REMOTE}`);
  const status = git("status", "--porcelain");
  if (status.status !== 0) refuse(`git status failed: ${status.stderr.trim()}`);
  if (status.stdout.trim()) refuse("the working tree is not clean: commit or stash what git status shows, then run it again");

  if (!remoteHas(tagRef(name))) refuse(`${REMOTE} has no good/${name} tag, so there is no known-good version of ${name} to restore (git ls-remote --tags ${REMOTE} 'good/*' lists the tags)`);
  const fetch = git("fetch", "--no-write-fetch-head", "--no-tags", REMOTE, `+refs/heads/${BASE}:refs/remotes/${REMOTE}/${BASE}`, `+${tagRef(name)}:${tagRef(name)}`);
  if (fetch.status !== 0) refuse(`could not fetch ${BASE} and good/${name} from ${REMOTE}: ${fetch.stderr.trim()}`);
  const tagSha = gitOut("rev-parse", "--verify", `${tagRef(name)}^{commit}`).trim();
  const mainSha = gitOut("rev-parse", "--verify", `refs/remotes/${REMOTE}/${BASE}^{commit}`).trim();

  if (!isAncestor(tagSha, mainSha)) refuse(`good/${name} is at ${tagSha}, which is not in the history of ${REMOTE}/${BASE} (${mainSha}): history may have been rewritten, and a person has to look at the tag`);
  const tagTree = objectAt(tagSha, folder);
  if (tagTree === null || gitOut("cat-file", "-t", tagTree).trim() !== "tree") refuse(`${folder}/ is not a folder at good/${name} (${tagSha})`);
  if (objectAt(mainSha, folder) === tagTree) refuse(`${folder}/ on ${REMOTE}/${BASE} already matches good/${name} (${tagSha.slice(0, 7)}): nothing to restore`);

  const branch = branchOf(name, tagSha, mainSha);
  if (git("show-ref", "--verify", "--quiet", `refs/heads/${branch}`).status === 0) refuse(`the branch ${branch} already exists in this clone: a restore from these two commits was already made`);
  if (remoteHas(`refs/heads/${branch}`)) refuse(`the branch ${branch} already exists on ${REMOTE}: a restore from these two commits was already pushed, look for its pull request`);

  const stat = gitOut("diff", "--stat=100", "--stat-count=60", "--no-color", "--no-ext-diff", "--no-renames", mainSha, tagSha, "--", folder).trimEnd();
  const title = titleOf(name, tagSha);
  console.log(`Plugin:            ${name}`);
  console.log(`Tag:               good/${name} at ${tagSha}`);
  console.log(`${BASE}:              ${REMOTE}/${BASE} at ${mainSha}`);
  console.log(`Branch:            ${branch}`);
  console.log(`Pull request:      ${title}`);
  console.log(`\nDiff stat it would apply (${REMOTE}/${BASE} to good/${name}, ${folder}/ only):\n${stat}\n`);
  if (!open) {
    console.log("Dry run: nothing was changed or pushed. Add --open to push the branch and open the pull request.");
    return;
  }

  const gh = spawnSync("gh", ["--version"], { encoding: "utf8" });
  if (gh.error || gh.status !== 0) refuse("gh is not installed or does not run: --open needs it to open the pull request, and nothing was pushed");
  const commit = build({ name, tagSha, mainSha, title });
  verify({ name, commit, tagSha, mainSha });
  // Created only if it does not exist (the old value is the zero commit), so it can never move a branch that is there.
  gitOut("update-ref", `refs/heads/${branch}`, commit, ZERO);
  // Never forced, and only this branch: not main, and no tag.
  const push = git("push", REMOTE, `refs/heads/${branch}:refs/heads/${branch}`);
  if (push.status !== 0) {
    git("update-ref", "-d", `refs/heads/${branch}`, commit);
    refuse(`the push of ${branch} failed, so nothing was opened: ${push.stderr.trim()}`);
  }
  console.log(`Pushed ${branch} (${commit}) to ${REMOTE}.`);
  const pr = spawnSync("gh", ["pr", "create", "--base", BASE, "--head", branch, "--title", title, "--body", bodyOf({ name, tagSha, mainSha, stat })], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
  });
  if (pr.error || pr.status !== 0) {
    refuse(`the branch ${branch} is pushed, but gh could not open the pull request: ${(pr.error?.message ?? pr.stderr).trim()}. Open it by hand against ${BASE} from that branch`);
  }
  console.log(`Opened: ${pr.stdout.trim().split("\n").pop()}`);
};

try {
  run();
} catch (error) {
  if (error instanceof Usage) {
    console.error(`restore-plugin: ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  console.error(`restore-plugin: ${error instanceof Refusal ? "refused: " : "failed: "}${error.message}`);
  process.exit(1);
}
