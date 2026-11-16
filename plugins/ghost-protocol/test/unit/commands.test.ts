import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { containerOf, imageArgs, restartArgs, rollbackArgs, stateArgs, statusArgs, stopArgs, updateArgs } from "../../src/commands";
import { VERSION_ARGS } from "../../src/docker";
import { SLUG_MAX, isSlug, slugOf } from "../../src/slug";

describe("the docker calls about an agent, to the letter (interface note, sections 8 and 10)", () => {
  it("builds each one from the container's name alone", () => {
    expect(containerOf("maple")).toBe("gp-maple");
    expect(statusArgs("maple")).toEqual(["exec", "gp-maple", "gp", "status", "--json"]);
    expect(updateArgs("maple")).toEqual(["exec", "gp-maple", "gp", "update", "request"]);
    expect(rollbackArgs("maple")).toEqual(["exec", "gp-maple", "gp", "update", "rollback"]);
    expect(restartArgs("maple")).toEqual(["restart", "gp-maple"]);
    expect(stopArgs("maple")).toEqual(["stop", "gp-maple"]);
    expect(stateArgs("maple")).toEqual(["inspect", "--format", "{{.State.Status}}", "gp-maple"]);
    expect(imageArgs("maple")).toEqual(["inspect", "--format", "{{.Config.Image}}", "gp-maple"]);
    expect(VERSION_ARGS).toEqual(["version", "--format", "{{.Server.Version}}"]);
  });

  it("writes to no process: no call takes -i or -t", () => {
    for (const args of [statusArgs, updateArgs, rollbackArgs, restartArgs, stopArgs, stateArgs, imageArgs].map((build) => build("maple"))) {
      expect(args).not.toContain("-i");
      expect(args).not.toContain("-t");
      expect(args).not.toContain("-it");
    }
  });

  it("puts nothing but the checked name in an argument that is not fixed, and it never begins with a dash", () => {
    const fixed = new Set(["exec", "gp", "status", "--json", "update", "request", "rollback", "restart", "stop", "inspect", "--format", "{{.State.Status}}", "{{.Config.Image}}"]);
    for (const slug of ["a", "maple", "my-agent-2", "0", "9-lives", "x".repeat(SLUG_MAX)]) {
      for (const build of [statusArgs, updateArgs, rollbackArgs, restartArgs, stopArgs, stateArgs, imageArgs]) {
        const loose = build(slug).filter((argument) => !fixed.has(argument));
        expect(loose).toEqual([`gp-${slug}`]);
      }
    }
    for (const build of [statusArgs, updateArgs, rollbackArgs, restartArgs, stopArgs, stateArgs, imageArgs]) {
      expect(build("maple").filter((argument) => argument.startsWith("-"))).toEqual(build("maple").includes("--json") ? ["--json"] : build("maple").includes("--format") ? ["--format"] : []);
    }
  });

  it("refuses to build a call for anything that is not a slug", () => {
    for (const bad of ["", " ", "Maple", "-maple", "--rm", "ma ple", "maple\n", "ma/ple", "ma;ple", "ma$(x)", "ma`x`", "ma'ple", 'ma"ple', "ma_ple", "ma.ple", "mäple", "a".repeat(SLUG_MAX + 1), "gp-maple ", "maple -v /:/x"]) {
      for (const build of [containerOf, statusArgs, updateArgs, rollbackArgs, restartArgs, stopArgs, stateArgs, imageArgs]) {
        expect(() => build(bad), JSON.stringify(bad)).toThrow("not a slug");
      }
    }
  });
});

describe("slugs (interface note, section 3)", () => {
  it("are lower-case letters, digits and - that begin with a letter or a digit, up to 40", () => {
    for (const good of ["a", "0", "maple", "my-agent", "a-", "a--b", "7up", "x".repeat(SLUG_MAX)]) expect(isSlug(good), good).toBe(true);
    for (const bad of ["", "-", "-a", "A", "aB", "a b", "a_b", "a.b", "a/b", "a\n", "é", "x".repeat(SLUG_MAX + 1)]) expect(isSlug(bad), JSON.stringify(bad)).toBe(false);
    expect(SLUG_MAX).toBe(40);
  });

  it("are made of what a person typed by trimming it and lower-casing it, or nothing", () => {
    expect(slugOf("  Maple \n")).toBe("maple");
    expect(slugOf("MY-AGENT")).toBe("my-agent");
    expect(slugOf("")).toBeUndefined();
    expect(slugOf("   ")).toBeUndefined();
    expect(slugOf("my agent")).toBeUndefined();
    expect(slugOf("-rm")).toBeUndefined();
    expect(slugOf("a".repeat(SLUG_MAX + 1))).toBeUndefined();
    expect(slugOf(`${"a".repeat(SLUG_MAX)}  `)).toBe("a".repeat(SLUG_MAX));
  });
});

describe("where the source asks docker anything", () => {
  const src = new URL("../../src/", import.meta.url);
  const files = (dir: URL): URL[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(new URL(`${entry.name}/`, dir)) : [new URL(entry.name, dir)]));
  const sources = files(src).filter((file) => /\.tsx?$/.test(file.pathname) && !file.pathname.endsWith(".d.ts"));

  it("starts a process in one place only, src/docker.ts", () => {
    const callers = sources.filter((file) => /\.spawn\b|\bspawn\(/.test(readFileSync(file, "utf8").replace(/\/\/.*$/gm, "")));
    expect(callers.map((file) => file.pathname.split("/").at(-1))).toEqual(["docker.ts"]);
  });

  it("writes an argument list that begins with a docker subcommand in one place only, src/commands.ts (the version call is VERSION_ARGS)", () => {
    const list = /\[\s*["'`](exec|inspect|restart|stop|rm|run|pull|kill|volume|cp|attach|start|version)["'`]/;
    const named = sources.filter((file) => list.test(readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
    expect(named.map((file) => file.pathname.split("/").at(-1)).sort()).toEqual(["commands.ts", "docker.ts"]);
  });
});
