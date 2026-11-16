import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// test/fake-docker-tests.sh is what CI runs, on Linux and on macOS, for the fake docker's tests. Each case here is a made-up folder.
const script = new URL("../fake-docker-tests.sh", import.meta.url).pathname;
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PASSING = 'import test from "node:test";\ntest("a", () => {});\n';
const run = (files?: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "fake-docker-"));
  made.push(root);
  const dir = join(root, "fake-docker");
  if (files) {
    mkdirSync(dir);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  }
  const { status, stdout, stderr } = spawnSync("bash", [script, dir], { encoding: "utf8" });
  return { status, output: `${stdout}${stderr}` };
};

describe("fake-docker-tests.sh", () => {
  it("passes, and says there is nothing to run, until the fake docker's folder exists", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/not there yet: nothing to run/);
  });

  it("fails when the folder exists and no *.test.mjs file is in it (a renamed file, a wrong glob)", () => {
    for (const files of [{}, { "docker.mjs": "export {};\n" }, { "docker.test.js": PASSING }, { "docker.tests.mjs": PASSING }]) {
      const result = run(files);
      expect(result.status, JSON.stringify(files)).toBe(1);
      expect(result.output).toMatch(/no \*\.test\.mjs file/);
    }
  });

  it("passes when its tests run and pass, and says how many", () => {
    const result = run({ "one.test.mjs": PASSING, "two.test.mjs": PASSING });
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/Fake docker tests: 2 ran, all passed\./);
  });

  it("fails when a test fails", () => {
    const result = run({ "ok.test.mjs": PASSING, "bad.test.mjs": 'import test from "node:test";\ntest("b", () => { throw new Error("no"); });\n' });
    expect(result.status).not.toBe(0);
  });

  it("fails when a test is skipped or left as a todo, since a skipped test did not run", () => {
    for (const option of ["{ skip: true }", "{ todo: true }"]) {
      const result = run({ "x.test.mjs": `import test from "node:test";\ntest("a", () => {});\ntest("b", ${option}, () => {});\n` });
      expect(result.status, option).toBe(1);
      expect(result.output).toMatch(/not all run: /);
    }
  });
});
