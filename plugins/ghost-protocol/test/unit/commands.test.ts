import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { containerOf, imageCall, restartCall, rollbackCall, stateCall, statusCall, stopCall, updateCall } from "../../src/commands";
import { PROCESS, VERSION_CALL } from "../../src/docker";
import { SLUG_MAX, isSlug, slugOf } from "../../src/slug";
import manifest from "../../manifest.json" with { type: "json" };
import { argvOf } from "./support/fake-host";

const BUILDERS = [statusCall, updateCall, rollbackCall, restartCall, stopCall, stateCall, imageCall];

describe("the docker calls about an agent, to the letter (GHOST Protocol's interface)", () => {
  it("names a declared process and gives the arguments after its fixed ones, built from the container's name alone", () => {
    expect(containerOf("maple")).toBe("gp-maple");
    expect(statusCall("maple")).toEqual({ process: "exec", args: ["gp-maple", "gp", "status", "--json"] });
    expect(updateCall("maple")).toEqual({ process: "exec", args: ["gp-maple", "gp", "update", "request"] });
    expect(rollbackCall("maple")).toEqual({ process: "exec", args: ["gp-maple", "gp", "update", "rollback"] });
    expect(restartCall("maple")).toEqual({ process: "restart", args: ["gp-maple"] });
    expect(stopCall("maple")).toEqual({ process: "stop", args: ["gp-maple"] });
    expect(stateCall("maple")).toEqual({ process: "inspect-state", args: ["gp-maple"] });
    expect(imageCall("maple")).toEqual({ process: "inspect-image", args: ["gp-maple"] });
    expect(VERSION_CALL).toEqual({ process: "version", args: [] });
  });

  it("makes the command lines `docker` gets, to the letter, once the manifest's fixed words are in front", () => {
    expect(argvOf(statusCall("maple"))).toEqual(["exec", "gp-maple", "gp", "status", "--json"]);
    expect(argvOf(updateCall("maple"))).toEqual(["exec", "gp-maple", "gp", "update", "request"]);
    expect(argvOf(rollbackCall("maple"))).toEqual(["exec", "gp-maple", "gp", "update", "rollback"]);
    expect(argvOf(restartCall("maple"))).toEqual(["restart", "gp-maple"]);
    expect(argvOf(stopCall("maple"))).toEqual(["stop", "gp-maple"]);
    expect(argvOf(stateCall("maple"))).toEqual(["inspect", "--format", "{{.State.Status}}", "gp-maple"]);
    expect(argvOf(imageCall("maple"))).toEqual(["inspect", "--format", "{{.Config.Image}}", "gp-maple"]);
    expect(argvOf(VERSION_CALL)).toEqual(["version", "--format", "{{.Server.Version}}"]);
  });

  it("uses every process the manifest declares, and only those: no grant is left unused, and no call names another", () => {
    const used = new Set<string>([VERSION_CALL.process, ...BUILDERS.map((build) => build("maple").process)]);
    expect([...used].sort()).toEqual(manifest.host.processes.map(({ id }) => id).sort());
    expect([...used].sort()).toEqual(Object.values(PROCESS).sort());
  });

  it("writes to no process: no call takes -i or -t", () => {
    for (const call of BUILDERS.map((build) => build("maple"))) {
      for (const flag of ["-i", "-t", "-it", "--interactive", "--tty"]) expect(argvOf(call)).not.toContain(flag);
    }
  });

  it("puts nothing but the checked name in an argument the manifest does not fix, and no argument of the call begins with a dash except --json", () => {
    for (const slug of ["a", "maple", "my-agent-2", "0", "9-lives", "x".repeat(SLUG_MAX)]) {
      for (const build of BUILDERS) {
        const [name, ...rest] = build(slug).args;
        expect(name, build.name).toBe(`gp-${slug}`);
        for (const word of rest) expect(["gp", "status", "--json", "update", "request", "rollback"]).toContain(word);
      }
    }
    for (const build of BUILDERS) {
      expect(build("maple").args.filter((argument) => argument.startsWith("-"))).toEqual(build("maple").args.includes("--json") ? ["--json"] : []);
    }
  });

  it("refuses to build a call for anything that is not a slug", () => {
    for (const bad of ["", " ", "Maple", "-maple", "--rm", "ma ple", "maple\n", "ma/ple", "ma;ple", "ma$(x)", "ma`x`", "ma'ple", 'ma"ple', "ma_ple", "ma.ple", "m\u00e4ple", "a".repeat(SLUG_MAX + 1), "gp-maple ", "maple -v /:/x"]) {
      for (const build of [containerOf, ...BUILDERS]) {
        expect(() => build(bad), JSON.stringify(bad)).toThrow("not a slug");
      }
    }
  });
});

describe("slugs", () => {
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

  it("names a process in one place only, src/commands.ts (and the version call, in src/docker.ts, which keeps the list of ids)", () => {
    const named = sources.filter((file) => /process:\s*(PROCESS\.|["'`])/.test(readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
    expect(named.map((file) => file.pathname.split("/").at(-1)).sort()).toEqual(["commands.ts", "docker.ts"]);
  });
});
