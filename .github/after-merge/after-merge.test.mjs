// Tests of the check after a merge to main: which plugins it picks (select.mjs), when it moves a good/<plugin> tag (tag.mjs), and what
// the workflow (../workflows/after-merge.yml) is allowed to do. The scripts run in made-up git repositories, with a bare repository as
// the remote that holds the tags. after-merge-tests.yml runs this; by hand: node --test .github/after-merge/after-merge.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ZERO = "0".repeat(40);
// The files a plugin needs to be installable: what the desktop app's Git importer lists.
const plugin = (text = "plugin") => ({ "manifest.json": `{"id":"x"}\n`, "plugin.js": `${text}\n` });
const files = (folders) => Object.fromEntries(Object.entries(folders).flatMap(([folder, content]) => Object.entries(content).map(([name, text]) => [`plugins/${folder}/${name}`, text])));

/** A bare remote and a clone of it (the clone is where the scripts run). `commit` commits to main and pushes it. */
const world = () => {
  const root = mkdtempSync(join(tmpdir(), "after-merge-"));
  const remote = join(root, "remote.git");
  const dir = join(root, "work");
  const run = (cwd, ...args) => {
    const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  run(root, "init", "-q", "--bare", "--initial-branch=main", remote);
  run(root, "clone", "-q", remote, dir);
  run(dir, "checkout", "-q", "-b", "main");
  const git = (...args) => run(dir, ...args);
  const commit = (tree = {}, deleted = [], { push = true } = {}) => {
    for (const [name, text] of Object.entries(tree)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    for (const name of deleted) git("rm", "-q", "-r", "--", name);
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", "change");
    if (push) git("push", "-q", "origin", "main");
    return git("rev-parse", "HEAD");
  };
  /** The commit a tag points at in the remote, or null. */
  const remoteTag = (name) => {
    const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/good/${name}^{commit}`], { cwd: remote, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const putTag = (name, sha) => run(remote, "tag", "-f", `good/${name}`, sha);
  return { root, remote, dir, git, commit, remoteTag, putTag, done: () => rmSync(root, { recursive: true, force: true }) };
};

/** Runs select.mjs in the clone; returns its status, its log, the folders it picked and the ones it refused (null if it wrote none). */
const select = (w, AFTER) => {
  const out = join(w.root, "output");
  writeFileSync(out, "");
  const result = spawnSync("node", [join(here, "select.mjs")], { cwd: w.dir, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, AFTER, GITHUB_OUTPUT: out } });
  const written = (name) => {
    const line = readFileSync(out, "utf8").split("\n").find((entry) => entry.startsWith(`${name}=`));
    return line ? JSON.parse(line.slice(name.length + 1)) : null;
  };
  return { status: result.status, log: result.stdout + result.stderr, picked: written("plugins"), refused: written("refused") };
};
/** Runs tag.mjs in the clone. */
const tag = (w, AFTER, selected, passed, extra = {}) => {
  const result = spawnSync("node", [join(here, "tag.mjs")], {
    cwd: w.dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, AFTER, SELECTED: JSON.stringify(selected), PASSED: JSON.stringify(passed), ...extra },
  });
  return { status: result.status, log: result.stdout + result.stderr };
};
const withWorld = (body) => async () => {
  const w = world();
  try {
    await body(w);
  } finally {
    w.done();
  }
};
// A main with three installable plugins and a README, all tagged where they are.
const tagged = (w) => {
  const first = w.commit({ "README.md": "readme\n", ...files({ alpha: plugin("a"), bravo: plugin("b"), charlie: plugin("c") }) });
  for (const name of ["alpha", "bravo", "charlie"]) w.putTag(name, first);
  w.git("fetch", "-q", "--tags", "origin");
  return first;
};

// ---- Which plugins are picked ----

test("with no tags yet, every installable plugin is picked: the first run on main", withWorld((w) => {
  w.commit({ "README.md": "readme\n", ...files({ alpha: plugin(), bravo: plugin() }) });
  const second = w.commit({ "README.md": "changed\n" });
  const result = select(w, second);
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(result.picked, ["alpha", "bravo"]);
  assert.match(result.log, /alpha: check \(no good\/alpha tag yet\)/);
}));

test("a plugin with no tag is picked while the others, tagged and unchanged, are not", withWorld((w) => {
  tagged(w);
  const second = w.commit({ ...files({ delta: plugin("d") }) });
  assert.deepEqual(select(w, second).picked, ["delta"]);
}));

test("a plugin that is unchanged since its tag is not picked, and a push that changes no plugin picks none", withWorld((w) => {
  tagged(w);
  const second = w.commit({ "README.md": "changed\n", "docs/new.md": "new\n", ".github/workflows/x.yml": "x\n" });
  const result = select(w, second);
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(result.picked, []);
  assert.match(result.log, /alpha: skip \(the same as good\/alpha/);
  assert.deepEqual(select(w, w.commit()).picked, [], "an empty commit");
}));

test("a plugin that changed since its tag is picked, and only that one", withWorld((w) => {
  tagged(w);
  const second = w.commit({ "plugins/bravo/plugin.js": "b2\n" });
  const result = select(w, second);
  assert.deepEqual(result.picked, ["bravo"]);
  assert.match(result.log, /bravo: check \(it differs from good\/bravo/);
  // A file anywhere in the folder counts, including a new one in a subfolder or one with a name git would quote.
  const third = w.commit({ "plugins/alpha/src/new.ts": "x\n", "plugins/charlie/café \"q\".md": "x\n" });
  assert.deepEqual(select(w, third).picked, ["alpha", "bravo", "charlie"], "bravo is still not tagged at its new content");
}));

test("a plugin that was changed and changed back is the same as its tag, and is not picked", withWorld((w) => {
  tagged(w);
  const second = w.commit({ "plugins/alpha/plugin.js": "a2\n" });
  assert.deepEqual(select(w, second).picked, ["alpha"]);
  const third = w.commit({ "plugins/alpha/plugin.js": "a\n" });
  assert.deepEqual(select(w, third).picked, []);
}));

test("a run dropped between two pushes loses nothing: the next push picks what both pushes changed", withWorld((w) => {
  const first = tagged(w);
  const second = w.commit({ "plugins/charlie/plugin.js": "c2\n" }); // its run was dropped: charlie was never checked or tagged
  const third = w.commit({ "plugins/alpha/plugin.js": "a2\n" });
  const result = select(w, third);
  assert.deepEqual(result.picked, ["alpha", "charlie"]);
  assert.equal(w.remoteTag("charlie"), first, "and charlie's tag has not moved");
  void second;
}));

test("a plugin that failed is picked again by the next push, and by each after it, while its tag stays where it was", withWorld((w) => {
  const first = tagged(w);
  const second = w.commit({ "plugins/bravo/plugin.js": "broken\n" });
  assert.deepEqual(select(w, second).picked, ["bravo"]);
  assert.equal(tag(w, second, ["bravo"], []).status, 0, "it failed the check: nothing passed");
  assert.equal(w.remoteTag("bravo"), first);
  const third = w.commit({ "README.md": "x\n" }); // a push that touches no plugin
  assert.deepEqual(select(w, third).picked, ["bravo"]);
  const fourth = w.commit({ "plugins/alpha/plugin.js": "a2\n" });
  assert.deepEqual(select(w, fourth).picked, ["alpha", "bravo"]);
  // Fixed: it passes, its tag moves, and it is picked no more.
  const fifth = w.commit({ "plugins/bravo/plugin.js": "b2\n" });
  assert.equal(tag(w, fifth, ["alpha", "bravo"], ["alpha", "bravo"]).status, 0);
  w.git("fetch", "-q", "--tags", "--force", "origin");
  assert.deepEqual(select(w, fifth).picked, []);
}));

test("history that was rewritten needs no special case: a plugin is compared with its tag, wherever the tag is", withWorld((w) => {
  const first = tagged(w);
  w.git("checkout", "-q", "-b", "other", first);
  const sideways = w.commit({ "plugins/alpha/plugin.js": "a-other\n" }, [], { push: false });
  w.git("push", "-q", "origin", "other");
  w.git("checkout", "-q", "main");
  const second = w.commit({ "plugins/alpha/plugin.js": "a2\n" });
  w.putTag("alpha", sideways); // a tag on a commit that main does not contain
  w.git("fetch", "-q", "--tags", "--force", "origin");
  assert.deepEqual(select(w, second).picked, ["alpha"]);
  // select.mjs does not read the push's before: no such input is needed, and a wrong one changes nothing.
  const result = spawnSync("node", [join(here, "select.mjs")], { cwd: w.dir, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, AFTER: second, BEFORE: "garbage", GITHUB_OUTPUT: join(w.root, "o2") } });
  assert.equal(result.status, 0, result.stderr);
}));

test("only what the importer lists is installable: a manifest and a plugin.js side by side, directly under plugins/", withWorld((w) => {
  w.commit({
    ...files({ built: plugin(), probe: plugin("a measuring tool, no tests") }),
    "plugins/unbuilt/manifest.json": "{}\n", // no built plugin.js
    "plugins/no-manifest/plugin.js": "x\n",
    "plugins/nested/deeper/manifest.json": "{}\n",
    "plugins/nested/deeper/plugin.js": "x\n",
    "plugins/loose-file.txt": "x\n",
    "other/manifest.json": "{}\n",
    "other/plugin.js": "x\n",
  });
  const second = w.commit({ "README.md": "x\n" });
  assert.deepEqual(select(w, second).picked, ["built", "probe"]);
}));

test("a plugin that was deleted is not picked, and a plugin that was added is", withWorld((w) => {
  tagged(w);
  const second = w.commit({ ...files({ delta: plugin("d") }) }, ["plugins/bravo"]);
  assert.deepEqual(select(w, second).picked, ["delta"]);
}));

test("a folder whose name cannot be a tag name is refused and named, and the others are still picked and tagged", withWorld((w) => {
  w.commit({ ...files({ alpha: plugin(), "Bad Name": plugin(), "-dash": plugin(), "with\nnewline": plugin() }) });
  const second = w.commit({ "README.md": "x\n" });
  const result = select(w, second);
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(result.picked, ["alpha"]);
  assert.deepEqual(result.refused, ["-dash", "Bad Name", "with\nnewline"]);
  assert.match(result.log, /::error::plugins\/Bad Name\/ is installable, but its name cannot be used in a good\/ tag/);
  assert.match(result.log, /::error::plugins\/-dash\/ is installable/);
  assert.doesNotMatch(result.log, /^newline/m, "a newline in a name does not start a line of the log");
  // The plugin that can be named goes on to be tagged, and no tag is made for the others.
  const tagged = tag(w, second, result.picked, result.picked);
  assert.equal(tagged.status, 0, tagged.log);
  assert.equal(w.remoteTag("alpha"), second);
  const tags = spawnSync("git", ["tag", "--list"], { cwd: w.remote, encoding: "utf8" }).stdout.trim().split("\n");
  assert.deepEqual(tags, ["good/alpha"]);
}));

test("a plugin.js or a manifest.json that is a symlink is not a file the importer lists: the folder is not installable", withWorld((w) => {
  for (const [folder, link] of [["linked-plugin", "plugin.js"], ["linked-manifest", "manifest.json"]]) {
    mkdirSync(join(w.dir, "plugins", folder), { recursive: true });
    const other = link === "plugin.js" ? "manifest.json" : "plugin.js";
    writeFileSync(join(w.dir, "plugins", folder, other), "x\n");
    writeFileSync(join(w.dir, "plugins", folder, "target"), "x\n");
    symlinkSync("target", join(w.dir, "plugins", folder, link));
  }
  const first = w.commit(files({ alpha: plugin() }));
  assert.match(w.git("ls-tree", "HEAD", "plugins/linked-plugin/plugin.js"), /^120000 blob/, "git stored a symlink");
  const result = select(w, first);
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(result.picked, ["alpha"]);
  assert.deepEqual(result.refused, []);
  const tagged = tag(w, first, ["alpha", "linked-plugin", "linked-manifest"], ["alpha", "linked-plugin", "linked-manifest"]);
  assert.notEqual(tagged.status, 0, "a symlinked folder is not tagged even when it is named");
  assert.match(tagged.log, /linked-plugin: not installable/);
  assert.match(tagged.log, /linked-manifest: not installable/);
  assert.equal(w.remoteTag("alpha"), first);
  assert.equal(w.remoteTag("linked-plugin"), null);
}));

test("a push that deleted the branch, and an unreadable after, pick nothing and say so", withWorld((w) => {
  tagged(w);
  const deleted = select(w, ZERO);
  assert.equal(deleted.status, 0, deleted.log);
  assert.deepEqual(deleted.picked, []);
  for (const after of ["", "main", "2".repeat(40)]) {
    const result = select(w, after);
    assert.notEqual(result.status, 0, `after = '${after}'`);
    assert.equal(result.picked, null);
  }
}));

// ---- When a tag moves ----

test("a plugin that passed gets its tag created, and one that failed gets none", withWorld((w) => {
  const first = w.commit(files({ alpha: plugin(), bravo: plugin() }));
  const result = tag(w, first, ["alpha", "bravo"], ["alpha"]);
  assert.equal(result.status, 0, result.log);
  assert.equal(w.remoteTag("alpha"), first);
  assert.equal(w.remoteTag("bravo"), null);
  assert.match(result.log, /alpha: good\/alpha created at /);
}));

test("a failed plugin's tag stays where it was, and the other plugins are still tagged", withWorld((w) => {
  const first = tagged(w);
  const second = w.commit({ "plugins/alpha/plugin.js": "a2\n", "plugins/bravo/plugin.js": "b2\n" });
  const result = tag(w, second, ["alpha", "bravo"], ["bravo"]);
  assert.equal(result.status, 0, result.log);
  assert.equal(w.remoteTag("alpha"), first, "alpha failed: its tag stays");
  assert.equal(w.remoteTag("bravo"), second);
  assert.equal(w.remoteTag("charlie"), first);
}));

test("a tag moves forward to a commit that contains it, and stays when it is already there", withWorld((w) => {
  const first = tagged(w);
  const second = w.commit({ "plugins/alpha/plugin.js": "a2\n" });
  const moved = tag(w, second, ["alpha"], ["alpha"]);
  assert.equal(moved.status, 0, moved.log);
  assert.equal(w.remoteTag("alpha"), second);
  assert.match(moved.log, /good\/alpha moved from /);
  const again = tag(w, second, ["alpha"], ["alpha"]);
  assert.equal(again.status, 0, again.log);
  assert.match(again.log, /already at /);
  assert.equal(w.remoteTag("alpha"), second);
  void first;
}));

test("a tag never moves backwards: a run of an older commit leaves a newer tag where it is, and does not fail", withWorld((w) => {
  const first = tagged(w);
  const second = w.commit({ "plugins/alpha/plugin.js": "a2\n" });
  const third = w.commit({ "plugins/alpha/plugin.js": "a3\n" });
  w.putTag("alpha", third);
  const result = tag(w, second, ["alpha"], ["alpha"]);
  assert.equal(result.status, 0, result.log);
  assert.equal(w.remoteTag("alpha"), third);
  assert.match(result.log, /already contains /);
  void first;
}));

test("a tag on a commit that is not in the history of the pushed one is not moved, and the run fails", withWorld((w) => {
  const first = tagged(w);
  w.git("checkout", "-q", "-b", "rewritten", first);
  const sideways = w.commit({ "side.md": "s\n" }, [], { push: false });
  w.git("push", "-q", "origin", "rewritten");
  w.git("checkout", "-q", "main");
  const second = w.commit({ "plugins/alpha/plugin.js": "a2\n", "plugins/bravo/plugin.js": "b2\n" });
  w.putTag("alpha", sideways);
  const result = tag(w, second, ["alpha", "bravo"], ["alpha", "bravo"]);
  assert.notEqual(result.status, 0, result.log);
  assert.equal(w.remoteTag("alpha"), sideways);
  assert.match(result.log, /::error::alpha: good\/alpha is at .*not in the history/);
  assert.equal(w.remoteTag("bravo"), second, "bravo is still moved");
}));

test("an existing tag does not move for a plugin that has not changed since it, even when its check passed", withWorld((w) => {
  const first = tagged(w);
  const second = w.commit({ "README.md": "x\n", "plugins/bravo/plugin.js": "b2\n" });
  const result = tag(w, second, ["alpha", "bravo"], ["alpha", "bravo"]);
  assert.equal(result.status, 0, result.log);
  assert.equal(w.remoteTag("alpha"), first, "alpha did not change");
  assert.equal(w.remoteTag("bravo"), second);
  assert.match(result.log, /alpha: good\/alpha is at .*has not changed since: left there/);
  // Changed and then changed back: the folder is what the tag has, so the tag stays.
  const third = w.commit({ "plugins/bravo/plugin.js": "b\n" });
  w.putTag("bravo", first);
  assert.equal(tag(w, third, ["bravo"], ["bravo"]).status, 0);
  assert.equal(w.remoteTag("bravo"), first);
}));

test("a plugin that passed but was not picked, is not installable, or has an odd name is never tagged", withWorld((w) => {
  const first = w.commit({ ...files({ alpha: plugin(), bravo: plugin(), "Odd Name": plugin() }), "plugins/unbuilt/manifest.json": "{}\n" });
  const result = tag(w, first, ["alpha", "unbuilt", "Odd Name", "gone"], ["alpha", "bravo", "unbuilt", "Odd Name", "gone", "--delete", "../x", ""]);
  assert.notEqual(result.status, 0, result.log);
  assert.equal(w.remoteTag("alpha"), first);
  for (const name of ["bravo", "unbuilt", "gone"]) assert.equal(w.remoteTag(name), null, name);
  assert.match(result.log, /bravo: it passed but was not one of the plugins picked/);
  assert.match(result.log, /unbuilt: not installable/);
  assert.match(result.log, /Odd Name: not a plugin folder name/);
  const tags = spawnSync("git", ["tag", "--list"], { cwd: w.remote, encoding: "utf8" }).stdout.trim().split("\n");
  assert.deepEqual(tags, ["good/alpha"]);
}));

test("nothing passed: nothing is tagged and the run does not fail", withWorld((w) => {
  const first = tagged(w);
  const second = w.commit({ "plugins/alpha/plugin.js": "a2\n" });
  const result = tag(w, second, ["alpha"], []);
  assert.equal(result.status, 0, result.log);
  assert.equal(w.remoteTag("alpha"), first);
}));

test("input that is not a list of folder names fails and tags nothing", withWorld((w) => {
  const first = w.commit(files({ alpha: plugin() }));
  for (const [selected, passed] of [["", '["alpha"]'], ['["alpha"]', ""], ['["alpha"]', '"alpha"'], ['["alpha"]', "[1]"], ['["alpha"]', "{}"]]) {
    const result = spawnSync("node", [join(here, "tag.mjs")], { cwd: w.dir, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, AFTER: first, SELECTED: selected, PASSED: passed } });
    assert.notEqual(result.status, 0, `${selected} ${passed}`);
    assert.equal(w.remoteTag("alpha"), null);
  }
  assert.notEqual(tag(w, "not-a-commit", ["alpha"], ["alpha"]).status, 0);
  assert.notEqual(tag(w, ZERO, ["alpha"], ["alpha"]).status, 0);
  assert.equal(w.remoteTag("alpha"), null);
}));

test("a plugin that cannot be tagged does not stop the others", withWorld((w) => {
  const first = w.commit(files({ alpha: plugin(), bravo: plugin() }));
  // The remote refuses alpha's tag.
  const hook = join(w.remote, "hooks", "update");
  writeFileSync(hook, '#!/bin/sh\n[ "$1" = refs/tags/good/alpha ] && { echo "refused by test" >&2; exit 1; }\nexit 0\n');
  chmodSync(hook, 0o755);
  const result = tag(w, first, ["alpha", "bravo"], ["alpha", "bravo"]);
  assert.notEqual(result.status, 0, result.log);
  assert.equal(w.remoteTag("alpha"), null);
  assert.equal(w.remoteTag("bravo"), first);
  assert.match(result.log, /::error::alpha: the push of good\/alpha failed/);
}));

test("a tag that another run moved after this clone was made is read from the remote, and an older commit leaves it there", withWorld((w) => {
  const first = tagged(w);
  const second = w.commit({ "plugins/alpha/plugin.js": "a2\n" });
  // A second clone pushes a newer commit and moves the tag; the first clone has never seen that commit.
  const other = join(w.root, "other");
  spawnSync("git", ["clone", "-q", w.remote, other]);
  const run = (...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd: other, encoding: "utf8" });
  writeFileSync(join(other, "plugins", "alpha", "plugin.js"), "a3\n");
  run("add", "-A");
  run("commit", "-q", "-m", "later");
  run("push", "-q", "origin", "main");
  const later = run("rev-parse", "HEAD").stdout.trim();
  w.putTag("alpha", later);
  assert.notEqual(spawnSync("git", ["cat-file", "-e", `${later}^{commit}`], { cwd: w.dir }).status, 0, "the clone does not have it");
  const result = tag(w, second, ["alpha"], ["alpha"]);
  assert.equal(result.status, 0, result.log);
  assert.equal(w.remoteTag("alpha"), later);
  void first;
}));

test("a tag that moved after it was read is not overwritten: the push expects the commit that was read", withWorld((w) => {
  const first = tagged(w);
  const second = w.commit({ "plugins/alpha/plugin.js": "a2\n" });
  const third = w.commit({ "plugins/alpha/plugin.js": "a3\n" });
  w.putTag("alpha", second); // another run moved it, after this one read it
  // A git that tells ls-remote's story as it was a moment ago (the tag at `first`), and is the real git for everything else.
  const shim = join(w.root, "shim");
  mkdirSync(shim);
  const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(join(shim, "git"), `#!/bin/sh\nif [ "$1" = ls-remote ]; then printf '%s\\trefs/tags/good/alpha\\n' "${first}"; exit 0; fi\nexec "${real}" "$@"\n`);
  chmodSync(join(shim, "git"), 0o755);
  const result = tag(w, third, ["alpha"], ["alpha"], { PATH: `${shim}:${process.env.PATH}` });
  assert.notEqual(result.status, 0, result.log);
  assert.equal(w.remoteTag("alpha"), second, "the tag the other run set is still there");
  assert.match(result.log, /::error::alpha: the push of good\/alpha failed/);
}));

test("an annotated good/ tag counts for the commit it points at", withWorld((w) => {
  const first = tagged(w);
  const second = w.commit({ "plugins/alpha/plugin.js": "a2\n" });
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "tag", "-f", "-a", "-m", "by hand", "good/alpha", first], { cwd: w.remote });
  const result = tag(w, second, ["alpha"], ["alpha"]);
  assert.equal(result.status, 0, result.log);
  assert.equal(w.remoteTag("alpha"), second);
}));

// ---- The verdict ----

/** Runs verdict.mjs with these job results and lists. */
const verdict = (env) => {
  const result = spawnSync("node", [join(here, "verdict.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
  return { status: result.status, log: result.stdout + result.stderr };
};
const fine = { SELECT: "success", CHECK: "success", TAG: "success", REFUSED: "[]", FAILED: "[]" };

test("the run is green when every plugin loaded and was tagged, and when there was nothing to check", () => {
  assert.equal(verdict(fine).status, 0);
  assert.equal(verdict({ ...fine, CHECK: "skipped", TAG: "skipped", FAILED: "" }).status, 0, "nothing was picked");
});

test("the run is red when a plugin failed the load check, and names it", () => {
  const result = verdict({ ...fine, FAILED: '["vim","linear"]' });
  assert.equal(result.status, 1);
  assert.match(result.log, /::error::These plugins did not load in Buzz's web build: "vim", "linear"/);
});

test("the run is red when a folder was refused, even when nothing else ran", () => {
  const result = verdict({ ...fine, CHECK: "skipped", TAG: "skipped", FAILED: "", REFUSED: '["Bad Name"]' });
  assert.equal(result.status, 1);
  assert.match(result.log, /"Bad Name"/);
  assert.equal(verdict({ ...fine, REFUSED: '["Bad Name"]' }).status, 1, "and when the others loaded");
});

test("the run is red when a job broke, was cancelled, or did not run when it should have", () => {
  for (const [what, env] of [
    ["select failed", { SELECT: "failure", CHECK: "skipped", TAG: "skipped", FAILED: "", REFUSED: "" }],
    ["select was skipped", { SELECT: "skipped" }],
    ["check failed", { CHECK: "failure", TAG: "skipped", FAILED: "" }],
    ["check was cancelled", { CHECK: "cancelled", TAG: "skipped", FAILED: "" }],
    ["tag failed", { TAG: "failure" }],
    ["tag was skipped after a check that ran", { TAG: "skipped" }],
    ["tag was cancelled", { TAG: "cancelled" }],
    ["tag ran without a check", { CHECK: "skipped", TAG: "failure", FAILED: "" }],
    ["no list of failed plugins", { FAILED: "" }],
    ["a list of failed plugins that is not a list of names", { FAILED: '[1]' }],
    ["a list of failed plugins that is not JSON", { FAILED: "vim" }],
    ["no list of refused folders", { REFUSED: "" }],
    ["a list of refused folders that is not JSON", { REFUSED: "x" }],
    ["nothing at all", { SELECT: "", CHECK: "", TAG: "", REFUSED: "", FAILED: "" }],
  ]) {
    const result = verdict({ ...fine, ...env });
    assert.equal(result.status, 1, `${what}: ${result.log}`);
  }
});

test("a folder name cannot start a line of the log or an annotation of its own", () => {
  const result = verdict({ ...fine, REFUSED: JSON.stringify(["x\n::error::pwned", "y\r::set-output name=a::b"]) });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.log, /^::error::pwned/m);
  assert.doesNotMatch(result.log, /^::set-output/m);
  assert.equal(result.log.split("\n").filter((line) => line.startsWith("::")).length, 1, "one annotation, ours");
});

// ---- What the workflow may do ----

const workflow = readFileSync(join(here, "..", "workflows", "after-merge.yml"), "utf8");
/** The text of each job, by name: the lines under `jobs:` from a two-space key to the next one. */
const jobs = (() => {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === "jobs:");
  assert.ok(start >= 0, "the workflow has a jobs: block");
  const found = {};
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const key = /^  ([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (key) found[(current = key[1])] = [];
    else if (current) found[current].push(line);
  }
  return Object.fromEntries(Object.entries(found).map(([name, body]) => [name, body.join("\n")]));
})();
const code = workflow.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");

test("the workflow runs on a push to main and on nothing else", () => {
  const on = /^on:\n((?:  .*\n|\n)+?)(?=\S)/m.exec(workflow)?.[1] ?? "";
  assert.deepEqual(on.split("\n").filter((line) => /^  \S/.test(line)).map((line) => line.trim()), ["push:"]);
  assert.match(on, /^    branches: \[main\]$/m);
  assert.doesNotMatch(on, /paths|tags|workflow_dispatch|workflow_call|schedule|pull_request/);
});

test("only the tagging job may write, and it writes only contents", () => {
  assert.deepEqual(Object.keys(jobs).sort(), ["check", "select", "tag", "verdict"]);
  assert.match(code, /^permissions:\n  contents: read\n/m, "read-only by default");
  assert.equal((code.match(/: write/g) ?? []).length, 1, "one write permission in the whole file");
  assert.match(jobs.tag, /^    permissions:\n      contents: write(?: #.*)?\n/m);
  for (const name of ["select", "check", "verdict"]) {
    assert.match(jobs[name], /^    permissions:\n      contents: read\n/m, `${name} is read-only`);
    assert.doesNotMatch(jobs[name], /: write\b|permissions: write-all/, name);
  }
});

test("the tagging job runs no code from outside this repository, and the others keep no credentials", () => {
  assert.doesNotMatch(jobs.tag, /block\/buzz-app|pnpm|playwright/);
  const uses = [...jobs.tag.matchAll(/uses: (\S+)/g)].map((match) => match[1].split("@")[0]);
  assert.deepEqual(uses.sort(), ["actions/checkout", "actions/setup-node"]);
  for (const name of ["select", "check", "verdict"]) {
    for (const checkout of jobs[name].split("- uses: actions/checkout").slice(1)) assert.match(checkout.split("\n- ")[0], /persist-credentials: false/, `${name}: every checkout drops its credentials`);
  }
  assert.doesNotMatch(code, /secrets\.(?!GITHUB_TOKEN)|PERSONAL|\bPAT\b/, "no secret but the workflow's own token");
});

test("the plugins are picked by comparing each with its tag: the push's own before is not an input", () => {
  assert.doesNotMatch(code, /event\.before|BEFORE/);
  assert.match(jobs.select, /AFTER: \$\{\{ github\.sha \}\}/);
});

test("two runs never run at once, and a newer run does not cancel one in progress", () => {
  assert.match(code, /^concurrency:\n  group: \S+\n  cancel-in-progress: false\n/m);
});

test("a plugin is tagged only after its check ran: the tagging job needs the check and the pick, and uses what they say", () => {
  assert.match(jobs.tag, /needs: \[select, check\]/);
  assert.match(jobs.tag, /PASSED: \$\{\{ needs\.check\.outputs\.passed \}\}/);
  assert.match(jobs.tag, /SELECTED: \$\{\{ needs\.select\.outputs\.plugins \}\}/);
  assert.match(jobs.tag, /AFTER: \$\{\{ github\.sha \}\}/);
  // It runs after a check that ran to its end, and not after one that broke or was skipped: each condition is needed.
  const condition = /^    if: (.*)$/m.exec(jobs.tag)?.[1] ?? "";
  for (const part of ["!cancelled()", "needs.check.result == 'success'", "needs.check.outputs.passed != ''", "needs.check.outputs.failed != ''"]) {
    assert.ok(condition.includes(part), `the tagging job's condition has '${part}': ${condition}`);
  }
  assert.doesNotMatch(condition, /\|\||always\(\)/, "and nothing that widens it");
  assert.match(jobs.check, /if: .*needs\.select\.outputs\.plugins != '\[\]'/);
});

test("a plugin that failed, or a refused folder, or a broken job, turns the run red: the verdict job runs after the others, whatever they did", () => {
  assert.match(jobs.verdict, /^    needs: \[select, check, tag\]$/m);
  assert.match(jobs.verdict, /^    if: \$\{\{ !cancelled\(\) \}\}$/m, "not skipped when a job it needs was skipped or failed");
  assert.match(jobs.verdict, /run: node \.github\/after-merge\/verdict\.mjs$/m);
  for (const [variable, source] of [
    ["SELECT", "needs.select.result"],
    ["CHECK", "needs.check.result"],
    ["TAG", "needs.tag.result"],
    ["REFUSED", "needs.select.outputs.refused"],
    ["FAILED", "needs.check.outputs.failed"],
  ]) {
    assert.match(jobs.verdict, new RegExp(`^          ${variable}: \\$\\{\\{ ${source.replaceAll(".", "\\.")} \\}\\}$`, "m"), `${variable} comes from ${source}`);
  }
  assert.match(jobs.select, /refused: \$\{\{ steps\.pick\.outputs\.refused \}\}/);
  assert.doesNotMatch(jobs.verdict, /continue-on-error/, "the verdict cannot be made to pass");
});

test("failing to keep the load check's traces does not undo a check that passed", () => {
  const upload = jobs.check.split("- uses: actions/upload-artifact")[1] ?? "";
  assert.match(upload.split("\n- ")[0], /continue-on-error: true/);
  assert.doesNotMatch(jobs.check.replace(upload, ""), /continue-on-error/, "and nothing else in the check may fail quietly");
});
