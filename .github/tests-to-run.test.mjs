// The script that picks which plugin test workflows a change calls (.github/tests-to-run.sh), run in made-up git repositories with the
// real list of rows. The `changes` job of tests.yml runs this test before it runs the script. Run by hand: node --test .github/tests-to-run.test.mjs
// ROWS below is the list of rows the script must print, in its order: a row added to the script is added here too.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "tests-to-run.sh");
const ROWS = ["after-merge", "agent-skills-highlighter", "agent-stats", "ai-sorter", "artifacts", "artifacts-browser", "beeper", "linear", "megatech-support", "megatech-support-browser", "merge-by-policy", "vim-tests", "vim-latency"];
const ZERO = "0".repeat(40);

// A throwaway repository. `commit(files, deleted)` writes and deletes files and returns the new commit.
const repository = () => {
  const dir = mkdtempSync(join(tmpdir(), "tests-to-run-"));
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q", "--initial-branch=main");
  const commit = (files = {}, deleted = []) => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    for (const name of deleted) git("rm", "-q", "--", name);
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", "change");
    return git("rev-parse", "HEAD");
  };
  return { dir, git, commit, done: () => rmSync(dir, { recursive: true, force: true }) };
};

// Runs the script in `dir` and returns its exit status, its log, and the outputs it wrote, as an object.
const run = (dir, EVENT, BASE, HEAD) => {
  const out = join(dir, "..", `${dir.split("/").pop()}.output`);
  writeFileSync(out, "");
  const result = spawnSync("bash", [script], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, EVENT, BASE, HEAD, GITHUB_OUTPUT: out } });
  const outputs = Object.fromEntries(readFileSync(out, "utf8").split("\n").filter(Boolean).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  rmSync(out, { force: true });
  return { status: result.status, log: result.stdout + result.stderr, outputs };
};

// The rows that run, from a successful run; also checks every row is there, once, as true or false, and `rows` names them all.
const running = (result) => {
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(Object.keys(result.outputs).sort(), [...ROWS, "rows"].sort(), result.log);
  assert.deepEqual(result.outputs.rows.split(" "), ROWS);
  for (const name of ROWS) assert.match(result.outputs[name], /^(true|false)$/);
  return ROWS.filter((name) => result.outputs[name] === "true");
};

const base = { "README.md": "readme\n", "plugins/vim/plugin.js": "vim\n", "plugins/linear/plugin.js": "linear\n", "plugins/artifacts/plugin.js": "artifacts\n", "plugins/beeper/plugin.js": "beeper\n", "plugins/key-probe/plugin.js": "probe\n", ".github/workflows/tests.yml": "name: Tests\n" };

// One pull request: a base commit with `base`, then a head commit with `files` and `deleted`. Returns the rows that run (or the result).
const pullRequest = (files, deleted = [], raw = false) => {
  const repo = repository();
  try {
    const before = repo.commit(base);
    const after = repo.commit(files, deleted);
    const result = run(repo.dir, "pull_request", before, after);
    return raw ? result : running(result);
  } finally {
    repo.done();
  }
};

test("a name git would quote (non-ASCII, a quote, a backslash, a newline) still calls its plugin's tests", () => {
  assert.deepEqual(pullRequest({ "plugins/vim/café.ts": "x\n" }), ["vim-tests", "vim-latency"]);
  assert.deepEqual(pullRequest({ 'plugins/linear/a "quoted" name.ts': "x\n" }), ["linear"]);
  assert.deepEqual(pullRequest({ "plugins/artifacts/back\\slash.md": "x\n" }), ["artifacts", "artifacts-browser"]);
  assert.deepEqual(pullRequest({ "plugins/beeper/new\nline.md": "x\n" }), ["beeper"]);
});

test("a change to one plugin calls only that plugin's tests", () => {
  assert.deepEqual(pullRequest({ "plugins/beeper/plugin.js": "changed\n" }), ["beeper"]);
  assert.deepEqual(pullRequest({ "plugins/linear/plugin.js": "changed\n" }), ["linear"]);
  assert.deepEqual(pullRequest({ "plugins/agent-stats/plugin.js": "changed\n" }), ["agent-stats"]);
});

test("a change outside plugins/ and .github/ calls none", () => {
  assert.deepEqual(pullRequest({ "README.md": "changed\n", "docs/new.md": "new\n" }), []);
});

test("any change under .github/ calls every test workflow", () => {
  assert.deepEqual(pullRequest({ ".github/check-app-ref.sh": "x\n" }), ROWS);
  assert.deepEqual(pullRequest({ ".github/workflows/tests.yml": "changed\n" }), ROWS);
  assert.deepEqual(pullRequest({}, [".github/workflows/tests.yml"]), ROWS);
});

test("a moved file calls the tests of the folder it left (no rename detection)", () => {
  assert.deepEqual(pullRequest({ "docs/plugin.js": "vim\n" }, ["plugins/vim/plugin.js"]), ["vim-tests", "vim-latency"]);
});

test("a plugin folder with no row fails, and says which; a plugin without tests on purpose does not", () => {
  const result = pullRequest({ "plugins/new-plugin/plugin.js": "x\n", "plugins/vim/x.js": "x\n" }, [], true);
  assert.notEqual(result.status, 0, result.log);
  assert.match(result.log, /::error::plugins\/new-plugin\/ changed, but no test workflow runs for it/);
  assert.deepEqual(result.outputs, {}, "no output when it fails");
  assert.deepEqual(pullRequest({ "plugins/key-probe/plugin.js": "changed\n" }), []);
  // Deleting a plugin that has no row is not a change to test.
  const repo = repository();
  try {
    const before = repo.commit({ ...base, "plugins/old/plugin.js": "x\n" });
    const after = repo.commit({}, ["plugins/old/plugin.js"]);
    assert.deepEqual(running(run(repo.dir, "pull_request", before, after)), []);
  } finally {
    repo.done();
  }
});

test("a pull request is read from its merge base, as GitHub lists its files: a later change to the base is not in it", () => {
  const repo = repository();
  try {
    const start = repo.commit(base);
    repo.git("checkout", "-q", "-b", "topic");
    const head = repo.commit({ "README.md": "topic\n" });
    repo.git("checkout", "-q", "main");
    const main = repo.commit({ "plugins/vim/plugin.js": "main moved on\n" });
    assert.deepEqual(running(run(repo.dir, "pull_request", main, head)), []);
    assert.deepEqual(running(run(repo.dir, "pull_request", start, head)), []);
  } finally {
    repo.done();
  }
});

test("a push and a merge group are read from their base to their commit; a base that is not there calls everything", () => {
  const repo = repository();
  try {
    const before = repo.commit(base);
    const after = repo.commit({ "plugins/linear/plugin.js": "changed\n" });
    assert.deepEqual(running(run(repo.dir, "push", before, after)), ["linear"]);
    assert.deepEqual(running(run(repo.dir, "merge_group", before, after)), ["linear"]);
    assert.deepEqual(running(run(repo.dir, "push", ZERO, after)), ROWS);
    assert.deepEqual(running(run(repo.dir, "push", "1234567890123456789012345678901234567890", after)), ROWS);
    assert.deepEqual(running(run(repo.dir, "pull_request", "1234567890123456789012345678901234567890", after)), ROWS);
  } finally {
    repo.done();
  }
});

test("a run by hand calls every test workflow", () => {
  const repo = repository();
  try {
    repo.commit(base);
    assert.deepEqual(running(run(repo.dir, "workflow_dispatch", "", "")), ROWS);
  } finally {
    repo.done();
  }
});
