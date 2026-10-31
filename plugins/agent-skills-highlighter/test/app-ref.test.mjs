// The guard that every workflow building block/buzz-app names the same commit (.github/check-app-ref.sh), run on the real workflow files and on
// made-up ones: the way it fails matters as much as the way it passes. A workflow that uses `env.BUZZ_APP_REF` without defining it checks out the
// default branch, so that one must fail.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const guard = join(root, ".github", "check-app-ref.sh");
const A = "d92bfb2c4dd89fc5ae6e7a1445f38ad1e8ab7060";
const B = "0123456789abcdef0123456789abcdef01234567";

const run = (dir) => spawnSync("bash", [guard, dir], { encoding: "utf8" });
const withWorkflows = (files, check) => {
  const dir = mkdtempSync(join(tmpdir(), "app-ref-"));
  mkdirSync(join(dir, "workflows"));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "workflows", name), text);
    check(run(join(dir, "workflows")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const defines = (commit, extra = "") => `name: w\nenv:\n  # The commit the plugin is tested against\n  BUZZ_APP_REF: ${commit}${extra}\njobs:\n  j:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ env.BUZZ_APP_REF }}\n`;
const usesOnly = "name: w\njobs:\n  j:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ env.BUZZ_APP_REF }}\n";
const unrelated = "name: w\njobs:\n  j:\n    steps:\n      - run: echo hi\n";
const failed = (result, words) => {
  assert.notEqual(result.status, 0, `it passed: ${result.stdout}`);
  assert.match(result.stdout, /::error::/);
  assert.match(result.stdout, words);
};

test("the real workflows pass: every one that builds the app defines the same commit", () => {
  const result = run(join(root, ".github", "workflows"));
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("workflows that agree pass, and a workflow that does not use the commit is not asked for one", () => {
  withWorkflows({ "a.yml": defines(A), "b.yml": defines(A, " # a note"), "c.yml": unrelated }, (result) => assert.equal(result.status, 0, result.stdout));
});

test("a workflow that uses env.BUZZ_APP_REF without defining it fails (its checkout would fall back to the default branch)", () => {
  withWorkflows({ "a.yml": defines(A), "b.yml": usesOnly }, (result) => {
    failed(result, /b\.yml uses env\.BUZZ_APP_REF but does not define it/);
  });
  // The same workflow with the definition line deleted from an otherwise good one
  withWorkflows({ "a.yml": defines(A), "b.yml": defines(A).replace(/^ {2}BUZZ_APP_REF: .*\n/m, "") }, (result) => failed(result, /b\.yml uses env\.BUZZ_APP_REF but does not define it/));
});

test("a mention in a comment is not a use", () => {
  withWorkflows({ "a.yml": defines(A), "b.yml": "name: w\n# ref: ${{ env.BUZZ_APP_REF }} is set in a.yml\njobs: {}\n" }, (result) => assert.equal(result.status, 0, result.stdout));
});

test("two different commits fail", () => {
  withWorkflows({ "a.yml": defines(A), "b.yml": defines(B) }, (result) => failed(result, /not the same commit/));
});

test("a definition that is not a 40-character commit fails", () => {
  for (const bad of ["main", A.slice(0, 39), A + "0", A.toUpperCase(), '""', ""]) {
    withWorkflows({ "a.yml": defines(A), "b.yml": defines(bad) }, (result) => failed(result, /not a 40-character commit/));
  }
});

test("a definition twice in one file fails", () => {
  withWorkflows({ "a.yml": defines(A) + "env2:\n  BUZZ_APP_REF: " + A + "\n" }, (result) => failed(result, /more than once/));
});

test("no definition anywhere fails", () => {
  withWorkflows({ "a.yml": unrelated }, (result) => failed(result, /no workflow defines BUZZ_APP_REF/));
  withWorkflows({}, (result) => failed(result, /no workflow defines BUZZ_APP_REF/));
});
