import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { manifestProblems } from "../../../../.github/plugin-assets/check.mjs";
import { PROCESS_ID } from "../../src/docker";
import { inject } from "../../src/index";
import manifest from "../../manifest.json" with { type: "json" };

const bytes = (text: string) => new TextEncoder().encode(text).length;
// Buzz's rules for a declared process (crates/plugin-manager/src/lib.rs valid_program in block/buzz-app): a bare program name of at most
// 80 bytes, at most 16 processes and, for each, at most 16 arguments of at most 1024 bytes without a NUL.
const processProblems = (value: { host?: { processes?: { id: string; program: string; args?: string[] }[] } }) => {
  const problems: string[] = [];
  const processes = value.host?.processes ?? [];
  if (processes.length > 16) problems.push("more than 16 processes");
  for (const { id, program, args = [] } of processes) {
    if (!program || bytes(program) > 80 || !/^[A-Za-z0-9._-]+$/.test(program)) problems.push(`process ${id}: program must be a bare name`);
    if (args.length > 16) problems.push(`process ${id}: more than 16 arguments`);
    for (const argument of args) if (bytes(argument) > 1024 || argument.includes("\0")) problems.push(`process ${id}: a bad argument`);
  }
  return problems;
};

describe("manifest.json", () => {
  it("declares exactly one process, the bare program `docker`, with its arguments fixed: `version --format {{.Server.Version}}`", () => {
    expect(manifest.host.processes).toEqual([{ id: "docker-version", program: "docker", args: ["version", "--format", "{{.Server.Version}}"] }]);
    // The id the code spawns is the one declared.
    expect(manifest.host.processes.map(({ id }) => id)).toEqual([PROCESS_ID]);
  });

  it("is not a shell: nothing runs through `sh`, `bash`, `cmd` or an interpreter, and no argument is a script", () => {
    const [process] = manifest.host.processes;
    expect(process?.program).toBe("docker");
    expect(process?.program).not.toMatch(/^(sh|bash|zsh|cmd|powershell|pwsh|python3?|node|env)$/);
    for (const argument of process?.args ?? []) expect(argument).not.toMatch(/[;&|`$\n]|-c$/);
  });

  it("asks Buzz for a process and nothing else: no commands, network origins, files, bundled program or other grants", () => {
    expect(Object.keys(manifest.host)).toEqual(["processes"]);
    expect(Object.keys(manifest.host.processes[0] ?? {}).sort()).toEqual(["args", "id", "program"]);
    expect(Object.keys(manifest).sort()).toEqual(["apiVersion", "description", "discovery", "host", "id", "name"]);
  });

  it("would be accepted by Buzz's rules for a process, and by this repository's checks of a manifest", () => {
    expect(processProblems(manifest)).toEqual([]);
    expect(manifestProblems(manifest)).toEqual([]);
  });

  it("does not call itself a prototype: it is offered for install", () => {
    expect(manifest.name).toBe("GHOST Protocol");
    expect(`${manifest.description} ${manifest.discovery.tags.join(" ")}`).not.toMatch(/prototype|coming soon/i);
  });

  it("asks Buzz for the services it uses, and no more", () => {
    expect([...inject].sort()).toEqual(["host", "pages", "react"]);
  });
});

describe("the process-rule check (so a bad manifest cannot pass quietly)", () => {
  const withProgram = (program: string, args: string[] = []) => ({ host: { processes: [{ id: "x", program, args }] } });
  it("refuses a program that is a path, an argument over 1024 bytes, more than 16 arguments and a NUL", () => {
    expect(processProblems(withProgram("/usr/bin/docker"))).toHaveLength(1);
    expect(processProblems(withProgram("docker", ["x".repeat(1025)]))).toHaveLength(1);
    expect(processProblems(withProgram("docker", Array(17).fill("x")))).toHaveLength(1);
    expect(processProblems(withProgram("docker", ["a\0b"]))).toHaveLength(1);
    expect(processProblems(withProgram("docker", ["x".repeat(1024)]))).toEqual([]);
  });
});

describe("the files Buzz imports", () => {
  it("has a licence: the repository's Apache-2.0 text sits in this folder", () => {
    const licence = readFileSync(new URL("../../LICENSE", import.meta.url), "utf8");
    expect(licence).toMatch(/Apache License\s+Version 2\.0, January 2004/);
    expect(licence).toBe(readFileSync(new URL("../../../../LICENSE", import.meta.url), "utf8"));
  });
});
