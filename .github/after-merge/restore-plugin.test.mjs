// Tests of the way back (restore-plugin.mjs): it restores one plugin's folder to its good/<plugin> tag by a pull request, and touches
// nothing else. They run in made-up git repositories with a bare repository as the remote, and a stand-in for gh that only writes down
// how it was called, so no pull request is ever opened. after-merge-tests.yml runs this; by hand: node --test .github/after-merge/restore-plugin.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Refusal, build, verify } from "./restore-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "restore-plugin.mjs");
const plugin = (text = "plugin") => ({ "manifest.json": `{"id":"x"}\n`, "plugin.js": `${text}\n` });
const files = (folders) => Object.fromEntries(Object.entries(folders).flatMap(([folder, content]) => Object.entries(content).map(([name, text]) => [`plugins/${folder}/${name}`, text])));
const EVERY_BYTE = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

// The stand-in for gh: it writes its arguments to $GH_LOG, prints a made-up address for `pr create`, and fails when $GH_FAIL is set.
const FAKE_GH = `#!${process.execPath}
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.GH_LOG, JSON.stringify({ args: process.argv.slice(2) }) + "\\n");
if (process.argv[2] === "pr" && process.env.GH_FAIL) {
  console.error("gh: could not create the pull request");
  process.exit(1);
}
if (process.argv[2] === "pr") console.log("https://example.invalid/pull/1");
`;

/** A bare remote, a clone of it (where the script runs) and a stand-in gh. `commit` commits to main in the clone and pushes it. */
const world = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "restore-plugin-")));
  const remote = join(root, "remote.git");
  const dir = join(root, "work");
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  // No global or system git configuration: the machine running the tests cannot change what they do.
  // TMPDIR is a folder of its own, so that a test can see whether the script leaves anything in it.
  const tmp = join(root, "tmp");
  mkdirSync(tmp);
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: root, TMPDIR: tmp, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GH_LOG: join(root, "gh.log") };
  const exec = (cwd, ...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", env });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  exec(root, "init", "-q", "--bare", "--initial-branch=main", remote);
  exec(root, "clone", "-q", remote, dir);
  exec(dir, "checkout", "-q", "-b", "main");
  for (const [key, value] of [["user.name", "test"], ["user.email", "test@example.invalid"], ["commit.gpgsign", "false"]]) exec(dir, "config", key, value);
  const git = (...args) => exec(dir, ...args);
  const inRemote = (...args) => exec(remote, ...args);
  /** Commits to main in `where` (a clone) and pushes. `tree` maps a path to its content; `executable` lists paths to make executable. */
  const commitIn = (where, tree = {}, deleted = [], { executable = [], plain = [] } = {}) => {
    for (const [name, content] of Object.entries(tree)) {
      mkdirSync(dirname(join(where, name)), { recursive: true });
      writeFileSync(join(where, name), content);
    }
    for (const name of executable) chmodSync(join(where, name), 0o755);
    for (const name of plain) chmodSync(join(where, name), 0o644);
    for (const name of deleted) exec(where, "rm", "-q", "-r", "--", name);
    exec(where, "add", "-A");
    exec(where, "commit", "-q", "--allow-empty", "-m", "change");
    exec(where, "push", "-q", "origin", "main");
    return exec(where, "rev-parse", "HEAD");
  };
  const commit = (...args) => commitIn(dir, ...args);
  /** Another clone of the remote, as another person's. */
  const other = () => {
    const where = join(root, "other");
    if (!existsSync(where)) {
      exec(root, "clone", "-q", remote, where);
      for (const [key, value] of [["user.name", "other"], ["user.email", "other@example.invalid"], ["commit.gpgsign", "false"]]) exec(where, "config", key, value);
    }
    return where;
  };
  const putTag = (name, sha) => inRemote("tag", "-f", `good/${name}`, sha);
  const gh = () => (existsSync(env.GH_LOG) ? readFileSync(env.GH_LOG, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { root, remote, dir, env, bin, tmp, exec, git, inRemote, commit, commitIn, other, putTag, gh, done: () => rmSync(root, { recursive: true, force: true }) };
};
const withWorld = (body) => async () => {
  const w = world();
  try {
    await body(w);
  } finally {
    w.done();
  }
};

/** Runs the script. By default in the clone, with the stand-in gh first on the PATH. */
const restore = (w, args, { cwd = w.dir, env = {} } = {}) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env: { ...w.env, ...env } });
  return { status: result.status, out: result.stdout, err: result.stderr, log: result.stdout + result.stderr };
};

/**
 * A history with two plugins tagged at the first commit (alpha, bravo) and a second commit that changes both, adds a third that is not
 * tagged, and changes things outside the plugins. Returns the two commits.
 */
const history = (w) => {
  const first = w.commit(
    {
      "README.md": "readme v1\n",
      "docs/guide.md": "guide v1\n",
      ...files({ alpha: plugin("alpha v1"), bravo: plugin("bravo v1") }),
      "plugins/alpha/src/a.ts": "export const a = 1;\n",
      "plugins/alpha/src/b.ts": "export const b = 1;\n",
      "plugins/alpha/bin/tool": "#!/bin/sh\necho v1\n",
      "plugins/alpha/data.bin": EVERY_BYTE,
      "plugins/alpha/crlf.txt": "one\r\ntwo\r\n",
      "plugins/alpha/café \"q\".md": "a name git would quote\n",
    },
    [],
    { executable: ["plugins/alpha/bin/tool"] },
  );
  w.putTag("alpha", first);
  w.putTag("bravo", first);
  const second = w.commit(
    {
      "README.md": "readme v2\n",
      "docs/guide.md": "guide v2\n",
      ".github/workflows/x.yml": "x\n",
      ...files({ charlie: plugin("charlie v1") }),
      "plugins/alpha/plugin.js": "alpha v2\n",
      "plugins/alpha/src/new.ts": "export const added = 1;\n",
      "plugins/alpha/extra/deep/file.txt": "added since the tag\n",
      "plugins/alpha/bin/tool": "#!/bin/sh\necho v2\n",
      "plugins/alpha/data.bin": Buffer.concat([EVERY_BYTE, Buffer.from([0, 0, 1])]),
      "plugins/bravo/plugin.js": "bravo v2\n",
    },
    ["plugins/alpha/src/a.ts"],
    { plain: ["plugins/alpha/bin/tool"] },
  );
  w.git("fetch", "-q", "--tags", "origin");
  return { first, second };
};
const branchFor = (first, second, name = "alpha") => `restore-${name}-to-${first.slice(0, 7)}-on-${second.slice(0, 7)}`;
const titleFor = (first, name = "alpha") => `Restore plugins/${name} to its known-good version (good/${name} at ${first.slice(0, 7)})`;

/** Everything the script could change, to compare before and after: every ref, the index, FETCH_HEAD, the objects. */
const snapshot = (w) => ({
  local: w.git("for-each-ref"),
  remote: w.inRemote("for-each-ref"),
  status: w.git("--no-optional-locks", "status", "--porcelain"),
  index: readFileSync(join(w.dir, ".git", "index")).toString("hex"),
  head: w.git("rev-parse", "HEAD"),
  objects: w.git("count-objects", "-v"),
  fetchHead: existsSync(join(w.dir, ".git", "FETCH_HEAD")) ? readFileSync(join(w.dir, ".git", "FETCH_HEAD"), "utf8") : null,
});
/** The paths under a folder at a revision, with their modes and blob ids. */
const entries = (cwd, rev, folder, exec) =>
  exec(cwd, "ls-tree", "-r", "-z", rev, "--", folder)
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [info, path] = line.split("\t");
      const [mode, , id] = info.split(" ");
      return { mode, id, path };
    });
const blob = (cwd, id) => spawnSync("git", ["cat-file", "blob", id], { cwd, encoding: "buffer" }).stdout;

// ---- A restore ----

test("the restored folder is byte for byte what it was at the tag: contents, modes, names, and a file deleted since", withWorld((w) => {
  const { first, second } = history(w);
  const result = restore(w, ["alpha", "--open"]);
  assert.equal(result.status, 0, result.log);
  const branch = branchFor(first, second);
  // The same tree object at the folder, in the remote the branch was pushed to.
  assert.equal(w.inRemote("rev-parse", `${branch}:plugins/alpha`), w.git("rev-parse", `${first}:plugins/alpha`));
  const atTag = entries(w.dir, first, "plugins/alpha", w.exec);
  const atBranch = entries(w.remote, branch, "plugins/alpha", w.exec);
  assert.deepEqual(atBranch, atTag);
  assert.ok(atTag.length >= 8, "the fixture has a binary file, an executable, CRLF, a name that git quotes and a nested folder");
  for (const entry of atTag) assert.ok(blob(w.remote, entry.id).equals(blob(w.dir, entry.id)), entry.path);
  // And checked out from the remote, what is on disk is the tag's bytes and modes, and the file deleted since the tag is back.
  const checkout = join(w.root, "checkout");
  w.exec(w.root, "clone", "-q", "--branch", branch, w.remote, checkout);
  for (const entry of atTag) {
    const path = join(checkout, entry.path);
    assert.ok(readFileSync(path).equals(blob(w.dir, entry.id)), entry.path);
    assert.equal((statSync(path).mode & 0o111) !== 0, entry.mode === "100755", `${entry.path}: executable or not`);
  }
  assert.equal(readFileSync(join(checkout, "plugins/alpha/src/a.ts"), "utf8"), "export const a = 1;\n");
  assert.equal(readFileSync(join(checkout, "plugins/alpha/plugin.js"), "utf8"), "alpha v1\n");
}));

test("a file added to the folder since the tag is removed, with its folders", withWorld((w) => {
  const { first, second } = history(w);
  assert.equal(restore(w, ["alpha", "--open"]).status, 0);
  const branch = branchFor(first, second);
  const names = w.inRemote("ls-tree", "-r", "--name-only", branch, "--", "plugins/alpha");
  assert.doesNotMatch(names, /src\/new\.ts/);
  assert.doesNotMatch(names, /extra/);
  assert.match(names, /src\/a\.ts/, "and the file deleted since is back");
  const checkout = join(w.root, "checkout");
  w.exec(w.root, "clone", "-q", "--branch", branch, w.remote, checkout);
  assert.equal(existsSync(join(checkout, "plugins/alpha/src/new.ts")), false);
  assert.equal(existsSync(join(checkout, "plugins/alpha/extra")), false);
}));

test("nothing outside the folder changes: one commit on top of main, and only plugins/<plugin>/ in it", withWorld((w) => {
  const { first, second } = history(w);
  const before = w.inRemote("for-each-ref");
  const result = restore(w, ["alpha", "--open"]);
  assert.equal(result.status, 0, result.log);
  const branch = branchFor(first, second);
  assert.equal(w.inRemote("rev-parse", `${branch}^`), second, "on top of main");
  assert.equal(w.inRemote("rev-list", "--count", `${second}..${branch}`), "1");
  const changed = w.inRemote("diff-tree", "-r", "--name-only", second, branch).split("\n");
  assert.ok(changed.length > 0 && changed.every((path) => path.startsWith("plugins/alpha/")), changed.join(", "));
  // Every other path is main's, not the tag's: the other plugins, the README, the docs and the workflows.
  for (const path of ["plugins/bravo", "plugins/charlie", "README.md", "docs", ".github"]) {
    assert.equal(w.inRemote("rev-parse", `${branch}:${path}`), w.inRemote("rev-parse", `${second}:${path}`), path);
  }
  assert.notEqual(w.inRemote("rev-parse", `${branch}:plugins/bravo`), w.inRemote("rev-parse", `${first}:plugins/bravo`), "bravo is not rolled back with alpha");
  // The remote has one new ref, the branch. Main and every tag are where they were.
  const after = w.inRemote("for-each-ref");
  assert.deepEqual(after.split("\n").filter((line) => !before.includes(line)).map((line) => line.split("\t")[1]), [`refs/heads/${branch}`]);
  assert.equal(w.inRemote("rev-parse", "main"), second);
  assert.equal(w.inRemote("rev-parse", "refs/tags/good/alpha"), first);
}));

test("the working tree, the branch and the index of the clone are left as they were", withWorld((w) => {
  const { first, second } = history(w);
  const before = { head: w.git("rev-parse", "HEAD"), branch: w.git("symbolic-ref", "HEAD"), status: w.git("status", "--porcelain"), readme: readFileSync(join(w.dir, "README.md"), "utf8") };
  assert.equal(restore(w, ["alpha", "--open"]).status, 0);
  assert.deepEqual({ head: w.git("rev-parse", "HEAD"), branch: w.git("symbolic-ref", "HEAD"), status: w.git("status", "--porcelain"), readme: readFileSync(join(w.dir, "README.md"), "utf8") }, before);
  assert.equal(readFileSync(join(w.dir, "plugins/alpha/plugin.js"), "utf8"), "alpha v2\n", "the folder in the clone is not restored: only the branch is");
  assert.equal(w.git("rev-parse", branchFor(first, second)), w.inRemote("rev-parse", branchFor(first, second)), "the clone has the branch it pushed");
}));

test("a plugin deleted since its tag is restored whole", withWorld((w) => {
  const first = w.commit({ "README.md": "x\n", ...files({ alpha: plugin("alpha v1"), bravo: plugin("bravo v1") }) });
  w.putTag("alpha", first);
  const second = w.commit({}, ["plugins/alpha"]);
  w.git("fetch", "-q", "--tags", "origin");
  const result = restore(w, ["alpha", "--open"]);
  assert.equal(result.status, 0, result.log);
  const branch = branchFor(first, second);
  assert.equal(w.inRemote("rev-parse", `${branch}:plugins/alpha`), w.git("rev-parse", `${first}:plugins/alpha`));
  assert.equal(w.inRemote("rev-parse", `${branch}:plugins/bravo`), w.git("rev-parse", `${second}:plugins/bravo`));
}));

test("an annotated tag counts for the commit it points at", withWorld((w) => {
  const first = w.commit({ ...files({ alpha: plugin("alpha v1") }) });
  const second = w.commit({ "plugins/alpha/plugin.js": "alpha v2\n" });
  w.git("tag", "-a", "-m", "known good", "good/alpha", first);
  w.git("push", "-q", "origin", "refs/tags/good/alpha");
  w.git("tag", "-d", "good/alpha");
  const result = restore(w, ["alpha"]);
  assert.equal(result.status, 0, result.log);
  assert.match(result.out, new RegExp(`good/alpha at ${first}`));
  assert.match(result.out, new RegExp(`origin/main at ${second}`));
}));

test("it runs from a folder inside the clone, not only from its top", withWorld((w) => {
  const { first, second } = history(w);
  const result = restore(w, ["alpha", "--open"], { cwd: join(w.dir, "plugins", "alpha", "src") });
  assert.equal(result.status, 0, result.log);
  assert.equal(w.inRemote("rev-parse", `${branchFor(first, second)}:plugins/alpha`), w.git("rev-parse", `${first}:plugins/alpha`));
}));

// ---- The pull request ----

test("--open pushes the branch and calls gh once to open the pull request, with a neutral title and a body that says what it did", withWorld((w) => {
  const { first, second } = history(w);
  const result = restore(w, ["alpha", "--open"]);
  assert.equal(result.status, 0, result.log);
  const branch = branchFor(first, second);
  assert.match(result.out, new RegExp(`Pushed ${branch} \\(${w.inRemote("rev-parse", branch)}\\)`));
  assert.match(result.out, /Opened: https:\/\/example\.invalid\/pull\/1/);
  const calls = w.gh().filter((call) => call.args[0] === "pr");
  assert.equal(calls.length, 1, "one pull request");
  const [{ args }] = calls;
  assert.deepEqual(args.slice(0, 8), ["pr", "create", "--base", "main", "--head", branch, "--title", titleFor(first)]);
  assert.equal(args[8], "--body");
  assert.equal(args.length, 10);
  const body = args[9];
  assert.match(body, /^Origin: /, "the body starts with an Origin line");
  for (const fact of ["`alpha`", "`good/alpha`", first, second, "plugin.js", "known-good tag", "restored as built", "source it was built from", "all-tests", "tag stays where it is", "desktop app itself is still not built"]) {
    assert.ok(body.includes(fact), `the body says ${fact}`);
  }
  // The stat is the one the dry run shows, for the folder only.
  assert.match(body, /plugins\/alpha\/src\/new\.ts +\| +1 -/);
  assert.match(body, /\d+ files? changed/);
  assert.doesNotMatch(body, /plugins\/bravo|README/);
  // The branch is on the remote, at the commit the clone made.
  assert.equal(w.inRemote("rev-parse", `refs/heads/${branch}`), w.git("rev-parse", `refs/heads/${branch}`));
}));

test("nothing in the title, the body or the commit names a path of the machine it ran on, or a long key", withWorld((w) => {
  const { first, second } = history(w);
  const result = restore(w, ["alpha", "--open"]);
  assert.equal(result.status, 0, result.log);
  const [{ args }] = w.gh().filter((call) => call.args[0] === "pr");
  const message = w.inRemote("log", "-1", "--format=%an %ae %cn %ce%n%B", branchFor(first, second));
  for (const text of [args[7], args[9], message]) {
    assert.doesNotMatch(text, new RegExp(w.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "no path of this machine");
    assert.doesNotMatch(text, /\/home\/|\/tmp\/|[0-9a-f]{64}/i);
  }
}));

test("--open pushes no tag, even when git is set to send the tags in the history of what it pushes", withWorld((w) => {
  const { first, second } = history(w);
  w.git("config", "push.followTags", "true");
  w.git("tag", "-a", "-m", "only here", "local-only-one", first);
  w.git("tag", "-a", "-m", "only here too", "local-only-two", second);
  const before = w.inRemote("tag", "--list");
  const result = restore(w, ["alpha", "--open"]);
  assert.equal(result.status, 0, result.log);
  assert.equal(w.inRemote("tag", "--list"), before, "no tag arrived on the remote");
  assert.equal(w.inRemote("rev-parse", "--verify", branchFor(first, second)).length, 40, "and the branch did");
}));

test("--open leaves nothing in the temporary folder", withWorld((w) => {
  history(w);
  assert.equal(restore(w, ["alpha", "--open"]).status, 0);
  assert.deepEqual(readdirSync(w.tmp), []);
}));

test("a long diff stat is cut at 60 files, and the summary still says how many changed", withWorld((w) => {
  const many = (text) => Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`plugins/big/f${String(i).padStart(2, "0")}.txt`, `${text} ${i}\n`]));
  const first = w.commit({ ...files({ big: plugin("big") }), ...many("v1") });
  w.putTag("big", first);
  w.commit(many("v2"));
  w.git("fetch", "-q", "--tags", "origin");
  const result = restore(w, ["big"]);
  assert.equal(result.status, 0, result.log);
  assert.equal(result.out.split("\n").filter((line) => line.includes(" | ")).length, 60);
  assert.match(result.out, /70 files changed/);
}));

test("when the check before the push finds the commit wrong, the script stops: nothing is pushed, and gh is not asked for a pull request", withWorld((w) => {
  const { first, second } = history(w);
  // A git that builds the wrong commit: it hands commit-tree main's own tree, so the folder is not restored.
  const real = process.env.PATH.split(":").map((dir) => join(dir, "git")).find((path) => existsSync(path));
  const wrapper = join(w.root, "wrapper");
  mkdirSync(wrapper);
  writeFileSync(join(wrapper, "git"), `#!${process.execPath}
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const at = args.indexOf("commit-tree");
if (at !== -1) args[at + 1] = process.env.WRONG_TREE;
process.exit(spawnSync(process.env.REAL_GIT, args, { stdio: "inherit" }).status ?? 1);
`);
  chmodSync(join(wrapper, "git"), 0o755);
  const env = { PATH: `${wrapper}:${w.env.PATH}`, REAL_GIT: real, WRONG_TREE: w.git("rev-parse", `${second}^{tree}`) };
  const remoteBefore = w.inRemote("for-each-ref");
  const result = restore(w, ["alpha", "--open"], { env });
  assert.equal(result.status, 1, result.log);
  assert.match(result.err, /plugins\/alpha\/ in the commit built is not the same as at good\/alpha: nothing was pushed/);
  assert.equal(w.inRemote("for-each-ref"), remoteBefore, "nothing was pushed");
  assert.equal(w.git("branch", "--list", branchFor(first, second)), "", "and no branch was made");
  assert.equal(w.gh().filter((call) => call.args[0] === "pr").length, 0);
}));

test("when the push fails, gh is not called and the clone keeps no branch", withWorld((w) => {
  const { first, second } = history(w);
  writeFileSync(join(w.remote, "hooks", "pre-receive"), "#!/bin/sh\necho 'rejected by the test' >&2\nexit 1\n");
  chmodSync(join(w.remote, "hooks", "pre-receive"), 0o755);
  const result = restore(w, ["alpha", "--open"]);
  assert.equal(result.status, 1, result.log);
  assert.match(result.err, /the push of .* failed, so nothing was opened/);
  assert.equal(w.gh().filter((call) => call.args[0] === "pr").length, 0);
  assert.equal(w.git("branch", "--list", branchFor(first, second)), "", "the local branch was taken back");
  assert.equal(w.inRemote("branch", "--list", branchFor(first, second)), "");
}));

test("when gh cannot open the pull request, the branch stays pushed and the message says so", withWorld((w) => {
  const { first, second } = history(w);
  const result = restore(w, ["alpha", "--open"], { env: { GH_FAIL: "1" } });
  assert.equal(result.status, 1, result.log);
  assert.match(result.err, new RegExp(`the branch ${branchFor(first, second)} is pushed, but gh could not open the pull request`));
  assert.equal(w.inRemote("rev-parse", `refs/heads/${branchFor(first, second)}`).length, 40);
}));

test("--open without gh refuses before anything is pushed", withWorld((w) => {
  const { first, second } = history(w);
  // A PATH with git and nothing else (the script is run by its own node), so there is no gh at all.
  const only = join(w.root, "only");
  mkdirSync(only);
  const git = process.env.PATH.split(":").map((dir) => join(dir, "git")).find((path) => existsSync(path));
  symlinkSync(git, join(only, "git"));
  const before = snapshot(w);
  const result = restore(w, ["alpha", "--open"], { env: { PATH: only } });
  assert.equal(result.status, 1, result.log);
  assert.match(result.err, /gh is not installed or does not run/);
  assert.deepEqual(snapshot(w), before);
  assert.equal(w.inRemote("branch", "--list", branchFor(first, second)), "");
}));

// ---- A dry run ----

test("without a flag it is a dry run: it says what it would do, and writes and pushes nothing", withWorld((w) => {
  const { first, second } = history(w);
  const before = snapshot(w);
  const result = restore(w, ["alpha"]);
  assert.equal(result.status, 0, result.log);
  assert.match(result.out, /^Plugin: +alpha$/m);
  assert.match(result.out, new RegExp(`^Tag: +good/alpha at ${first}$`, "m"));
  assert.match(result.out, new RegExp(`^main: +origin/main at ${second}$`, "m"));
  assert.match(result.out, new RegExp(`^Branch: +${branchFor(first, second)}$`, "m"));
  assert.match(result.out, new RegExp(`^Pull request: +${titleFor(first).replace(/[()]/g, "\\$&")}$`, "m"));
  assert.match(result.out, /plugins\/alpha\/plugin\.js +\| +2 \+-/);
  assert.match(result.out, /plugins\/alpha\/src\/new\.ts +\| +1 -/, "it shows the file that would be removed as removed");
  assert.match(result.out, /Dry run: nothing was changed or pushed/);
  assert.doesNotMatch(result.out, /Pushed|Opened/);
  // The clone and the remote are exactly as they were: refs, objects, the working tree, even FETCH_HEAD. gh was not run at all.
  assert.deepEqual(snapshot(w), before);
  assert.deepEqual(w.gh(), []);
  assert.equal(w.git("branch", "--list", "restore-*"), "");
  assert.equal(w.inRemote("branch", "--list", "restore-*"), "");
}));

test("a dry run reads main and the tag from the remote as they are now, and changes no ref: not origin/main, no tag, not FETCH_HEAD", withWorld((w) => {
  const { first, second } = history(w);
  // Another person moves main on, and moves the tag to the second commit; this clone has not fetched, and still has its own good/alpha.
  const third = w.commitIn(w.other(), { "README.md": "readme v3\n", "plugins/alpha/plugin.js": "alpha v3\n" });
  w.putTag("alpha", second);
  // Settings that make a fetch write more: pruning, and tags that follow what is fetched. And a tag of another plugin that is missing here.
  for (const [key, value] of [["fetch.prune", "true"], ["fetch.pruneTags", "true"], ["gc.auto", "1"]]) w.git("config", key, value);
  w.git("tag", "-d", "good/bravo");
  const remoteBefore = w.inRemote("for-each-ref");
  const before = snapshot(w);
  assert.notEqual(spawnSync("git", ["cat-file", "-e", third], { cwd: w.dir, env: w.env }).status, 0, "this clone does not have the new main yet");
  const result = restore(w, ["alpha"]);
  assert.equal(result.status, 0, result.log);
  assert.match(result.out, new RegExp(`good/alpha at ${second}`));
  assert.match(result.out, new RegExp(`origin/main at ${third}`));
  assert.match(result.out, new RegExp(`the local tag good/alpha is at ${first}; origin's tag is used, and the local one is left as it is`));
  // It had to fetch the new commits, and that is all that changed: every ref, FETCH_HEAD, the index and the working tree are as they were.
  assert.equal(spawnSync("git", ["cat-file", "-e", third], { cwd: w.dir, env: w.env }).status, 0, "the new main was fetched, as objects");
  const after = snapshot(w);
  const { objects: objectsBefore, ...restBefore } = before;
  const { objects: objectsAfter, ...restAfter } = after;
  assert.deepEqual(restAfter, restBefore);
  assert.notEqual(objectsAfter, objectsBefore);
  assert.equal(w.inRemote("for-each-ref"), remoteBefore, "the remote is unchanged");
  assert.equal(w.git("tag", "--list", "good/bravo"), "", "the tag of another plugin, missing here, was not fetched");
  assert.equal(w.git("rev-parse", "refs/tags/good/alpha"), first, "the local tag is where it was");
  assert.equal(w.git("rev-parse", "refs/remotes/origin/main"), second, "origin/main is where it was");
  assert.equal(existsSync(join(w.dir, ".git", "FETCH_HEAD")), before.fetchHead !== null);
  assert.deepEqual(w.gh(), []);
}));

test("a dry run in a clone that is up to date writes nothing at all, not even an object", withWorld((w) => {
  history(w);
  const before = snapshot(w);
  assert.equal(restore(w, ["alpha"]).status, 0);
  assert.deepEqual(snapshot(w), before);
  assert.deepEqual(readdirSync(w.tmp), [], "and leaves nothing in the temporary folder");
}));

test("a dry run does not rewrite the index, even when a file's timestamp no longer matches it", withWorld((w) => {
  history(w);
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(w.dir, "README.md"), later, later); // `git status` would refresh the index entry of this file
  const index = join(w.dir, ".git", "index");
  const before = { bytes: readFileSync(index).toString("hex"), mtime: statSync(index).mtimeMs };
  const result = restore(w, ["alpha"]);
  assert.equal(result.status, 0, result.log);
  assert.deepEqual({ bytes: readFileSync(index).toString("hex"), mtime: statSync(index).mtimeMs }, before);
}));

test("it never fetches or changes a tag of another plugin", withWorld((w) => {
  const { first, second } = history(w);
  w.git("tag", "-f", "good/bravo", second); // a local tag that differs from the remote's: not the script's to touch
  const result = restore(w, ["alpha"]);
  assert.equal(result.status, 0, result.log);
  assert.equal(w.git("rev-parse", "refs/tags/good/bravo"), second);
  assert.equal(w.inRemote("rev-parse", "refs/tags/good/bravo"), first);
}));

test("only the flag --open opens: nothing in the environment, and no other spelling of it, does", withWorld((w) => {
  history(w);
  const before = snapshot(w);
  for (const env of [{ OPEN: "1" }, { DRY_RUN: "0" }, { CI: "true" }, { GH_OPEN: "1" }, { RESTORE_OPEN: "1" }]) {
    const result = restore(w, ["alpha"], { env });
    assert.equal(result.status, 0, result.log);
    assert.match(result.out, /Dry run/);
  }
  for (const flag of ["--opn", "--Open", "--open=true", "-o", "--yes", "--force", "--no-dry-run"]) {
    const result = restore(w, ["alpha", flag]);
    assert.equal(result.status, 2, `${flag}: ${result.log}`);
    assert.match(result.err, /unknown option/);
  }
  assert.deepEqual(snapshot(w), before);
  assert.deepEqual(w.gh(), []);
}));

// ---- Refusals ----

/** A refusal: it exits 1 and says why, and changes nothing anywhere, and gh is not run. */
const refused = (w, args, message, options) => {
  const before = snapshot(w);
  const result = restore(w, args, options);
  assert.equal(result.status, 1, `${args.join(" ")}: ${result.log}`);
  assert.match(result.err, new RegExp(`^restore-plugin: refused: .*${message}`, "m"), result.err);
  assert.equal(result.out, "", "it prints no plan for something it refuses");
  assert.deepEqual(snapshot(w), before);
  assert.deepEqual(w.gh(), []);
};

test("a name that is not a plugin folder is refused, for a dry run and for --open", withWorld((w) => {
  history(w);
  for (const name of ["../alpha", "Alpha", "alpha/src", "plugins/alpha", "al pha", "", "alpha;ls", "alpha\n", "alpha."]) {
    refused(w, [name], "is not a plugin folder name");
    refused(w, [name, "--open"], "is not a plugin folder name");
  }
}));

test("a name that starts with a dash is an unknown option, and a command line that cannot be read does nothing", withWorld((w) => {
  history(w);
  const before = snapshot(w);
  for (const args of [["-alpha"], ["--alpha"], [], ["--open"], ["alpha", "bravo"], ["alpha", "bravo", "--open"]]) {
    const result = restore(w, args);
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.log}`);
    assert.match(result.err, /Usage: restore-plugin\.mjs <plugin> \[--open\]/);
  }
  assert.deepEqual(snapshot(w), before);
  assert.deepEqual(w.gh(), []);
  const help = restore(w, ["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.out, /Usage: restore-plugin\.mjs/);
}));

test("a plugin with no good/ tag is refused, whether or not its folder exists", withWorld((w) => {
  history(w); // charlie is on main, and has no tag
  refused(w, ["charlie"], "origin has no good/charlie tag");
  refused(w, ["charlie", "--open"], "origin has no good/charlie tag");
  refused(w, ["nosuch"], "origin has no good/nosuch tag");
}));

test("a tag on a commit that is not in the history of main is refused", withWorld((w) => {
  const { first } = history(w);
  // A commit that was on another branch, never merged, and whose branch is gone: the tag is all that points at it.
  w.git("checkout", "-q", "-b", "side", first);
  writeFileSync(join(w.dir, "plugins/alpha/plugin.js"), "alpha side\n");
  w.git("commit", "-q", "-a", "-m", "side");
  const side = w.git("rev-parse", "HEAD");
  w.git("push", "-q", "origin", "side");
  w.git("checkout", "-q", "main");
  w.git("push", "-q", "origin", "--delete", "side");
  w.git("branch", "-q", "-D", "side");
  w.putTag("alpha", side);
  refused(w, ["alpha"], `good/alpha is at ${side}, which is not in the history of origin/main`);
  refused(w, ["alpha", "--open"], "is not in the history of origin/main");
}));

test("a folder that already matches the tag is refused: there is nothing to restore", withWorld((w) => {
  const first = w.commit({ ...files({ alpha: plugin("a"), bravo: plugin("b") }) });
  w.putTag("alpha", first);
  w.putTag("bravo", first);
  w.git("fetch", "-q", "--tags", "origin");
  refused(w, ["alpha"], "already matches good/alpha");
  // Also after changes elsewhere, and after the folder was changed and changed back.
  w.commit({ "README.md": "changed\n", "plugins/bravo/plugin.js": "b2\n" });
  w.commit({ "plugins/alpha/plugin.js": "a2\n" });
  w.commit({ "plugins/alpha/plugin.js": "a\n" });
  refused(w, ["alpha", "--open"], "already matches good/alpha");
  assert.equal(restore(w, ["bravo"]).status, 0, "while bravo, which did change, can be restored");
}));

test("a working tree that is not clean is refused: a changed file, a new file, and a staged one", withWorld((w) => {
  history(w);
  writeFileSync(join(w.dir, "README.md"), "edited\n");
  refused(w, ["alpha"], "the working tree is not clean");
  w.git("checkout", "--", "README.md");
  writeFileSync(join(w.dir, "untracked.txt"), "new\n");
  refused(w, ["alpha", "--open"], "the working tree is not clean");
  w.git("add", "untracked.txt");
  refused(w, ["alpha", "--open"], "the working tree is not clean");
  w.git("rm", "-q", "-f", "untracked.txt");
  assert.equal(restore(w, ["alpha"]).status, 0, "and a clean tree is accepted");
}));

test("a branch that already exists is refused, in the clone or on the remote", withWorld((w) => {
  const { first, second } = history(w);
  const branch = branchFor(first, second);
  w.git("branch", branch, second);
  refused(w, ["alpha"], `the branch ${branch} already exists in this clone`);
  w.git("branch", "-q", "-D", branch);
  w.git("push", "-q", "origin", `${second}:refs/heads/${branch}`);
  refused(w, ["alpha", "--open"], `the branch ${branch} already exists on origin`);
}));

test("a second run after --open is refused, because its branch is there", withWorld((w) => {
  history(w);
  assert.equal(restore(w, ["alpha", "--open"]).status, 0);
  const calls = w.gh().length;
  const result = restore(w, ["alpha", "--open"]);
  assert.equal(result.status, 1, result.log);
  assert.match(result.err, /already exists/);
  assert.equal(w.gh().length, calls, "and gh is not called again");
}));

test("outside a git repository, and in a clone with no origin, it is refused", withWorld((w) => {
  history(w);
  const elsewhere = join(w.root, "not-a-repo");
  mkdirSync(elsewhere);
  const result = restore(w, ["alpha"], { cwd: elsewhere, env: { GIT_CEILING_DIRECTORIES: w.root } });
  assert.equal(result.status, 1, result.log);
  assert.match(result.err, /this is not a git repository/);
  w.git("remote", "remove", "origin");
  const noOrigin = restore(w, ["alpha"]);
  assert.equal(noOrigin.status, 1, noOrigin.log);
  assert.match(noOrigin.err, /no remote called origin/);
  assert.deepEqual(w.gh(), []);
}));

test("a shallow clone is refused, with the way out", withWorld((w) => {
  history(w);
  const shallow = join(w.root, "shallow");
  w.exec(w.root, "clone", "-q", "--depth", "1", `file://${w.remote}`, shallow);
  const result = restore(w, ["alpha"], { cwd: shallow });
  assert.equal(result.status, 1, result.log);
  assert.match(result.err, /refused: this is a shallow clone/);
  assert.match(result.err, /git fetch --unshallow/);
  assert.deepEqual(w.gh(), []);
}));

// ---- The check before the push ----

test("the check before the push accepts the commit that was built, and refuses any other: a file outside the folder, another folder, another parent", withWorld((w) => {
  const { first, second } = history(w);
  const make = (branch, from, change) => {
    w.git("checkout", "-q", "-b", branch, from);
    change();
    w.git("add", "-A");
    w.git("commit", "-q", "--allow-empty", "-m", branch);
    const commit = w.git("rev-parse", "HEAD");
    w.git("checkout", "-q", "main");
    return commit;
  };
  // The restore, but with the README changed too.
  const outside = make("outside", second, () => {
    w.git("rm", "-q", "-r", "plugins/alpha");
    w.git("checkout", first, "--", "plugins/alpha");
    writeFileSync(join(w.dir, "README.md"), "changed by the restore\n");
  });
  // The restore, but with a file added in a folder whose name starts with the plugin's.
  const sibling = make("sibling", second, () => {
    w.git("rm", "-q", "-r", "plugins/alpha");
    w.git("checkout", first, "--", "plugins/alpha");
    mkdirSync(join(w.dir, "plugins/alpha-two"));
    writeFileSync(join(w.dir, "plugins/alpha-two/new.txt"), "next to the plugin\n");
  });
  // The right parent, and a folder that was changed but not restored.
  const notRestored = make("not-restored", second, () => writeFileSync(join(w.dir, "plugins/alpha/plugin.js"), "alpha v3\n"));
  // The right folder on top of the tag, not on top of main.
  const wrongParent = make("wrong-parent", first, () => {});
  const here = process.cwd();
  process.chdir(w.dir);
  try {
    const built = build({ name: "alpha", tagSha: first, mainSha: second, title: "title" });
    assert.doesNotThrow(() => verify({ name: "alpha", commit: built, tagSha: first, mainSha: second }));
    for (const [commit, message] of [[outside, /changes files outside plugins\/alpha\/ \(README\.md\)/], [sibling, /changes files outside plugins\/alpha\/ \(plugins\/alpha-two\/new\.txt\)/], [notRestored, /plugins\/alpha\/ in the commit built is not the same as at good\/alpha/], [wrongParent, /is not on top of origin\/main/]]) {
      assert.throws(() => verify({ name: "alpha", commit, tagSha: first, mainSha: second }), (error) => error instanceof Refusal && message.test(error.message), commit);
    }
  } finally {
    process.chdir(here);
  }
}));

// ---- What the script is allowed to do ----

test("the script is executable, so that it can be run by its path", () => {
  assert.ok((statSync(script).mode & 0o111) !== 0);
  assert.match(readFileSync(script, "utf8"), /^#!\/usr\/bin\/env node\n/);
});

test("the script's only push is of one new branch: never forced, never main, never a tag", () => {
  const code = ["restore-plugin.mjs", "restore-lib.mjs"].map((file) => readFileSync(join(here, file), "utf8")).join("\n").split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
  assert.equal((code.match(/"push"/g) ?? []).length, 1, "one push");
  assert.match(code, /git\("push", "--no-follow-tags", "--no-recurse-submodules", REMOTE, `refs\/heads\/\$\{branch\}:refs\/heads\/\$\{branch\}`\)/);
  // The one fetch names objects, not refs: no refspec, so no ref is stored. And the only refs it writes are its own branch.
  assert.equal((code.match(/"fetch"/g) ?? []).length, 1, "one fetch");
  assert.match(code, /"fetch", "--no-write-fetch-head", "--no-tags", REMOTE, \.\.\.missing\)/);
  assert.doesNotMatch(code, /refs\/remotes|\+refs\//);
  for (const call of code.match(/"update-ref"[^;]*/g) ?? []) assert.match(call, /refs\/heads\/\$\{branch\}/, call);
  assert.doesNotMatch(code, /"--(force|force-with-lease|tags|mirror|all|delete|prune)\b/);
  assert.doesNotMatch(code, /\+refs\/heads\/\$\{branch\}|push.*:refs\/(heads\/main|tags)/);
  assert.doesNotMatch(code, /"(checkout|switch|reset|restore|merge|rebase|stash|clean)"/, "no command that writes the working tree");
});
