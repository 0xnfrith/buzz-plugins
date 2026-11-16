import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { manifestProblems } from "../../../../.github/plugin-assets/check.mjs";
import { COMMAND, PROCESS } from "../../src/docker";
import { IMAGE } from "../../src/gp/constants";
import { inject } from "../../src/index";
import manifest from "../../manifest.json" with { type: "json" };

const bytes = (text: string) => new TextEncoder().encode(text).length;
// Buzz's rules for a declared process (crates/plugin-manager/src/lib.rs valid_program in block/buzz-app): a bare program name of at most
// 80 bytes, at most 16 processes and, for each, at most 16 arguments of at most 1024 bytes without a NUL.
const processProblems = (value: { host?: { commands?: { id: string; program: string; args?: string[] }[]; processes?: { id: string; program: string; args?: string[] }[] } }) => {
  const problems: string[] = [];
  const processes = [...(value.host?.commands ?? []), ...(value.host?.processes ?? [])];
  if ((value.host?.processes ?? []).length > 16) problems.push("more than 16 processes");
  if ((value.host?.commands ?? []).length > 16) problems.push("more than 16 commands");
  for (const { id, program, args = [] } of processes) {
    if (!program || bytes(program) > 80 || !/^[A-Za-z0-9._-]+$/.test(program)) problems.push(`process ${id}: program must be a bare name`);
    if (args.length > 16) problems.push(`process ${id}: more than 16 arguments`);
    for (const argument of args) if (bytes(argument) > 1024 || argument.includes("\0")) problems.push(`process ${id}: a bad argument`);
  }
  return problems;
};

describe("manifest.json", () => {
  it("declares the version check as a command, closed: `docker version --format {{.Server.Version}}`, no input, nothing for the caller to add", () => {
    expect(manifest.host.commands).toEqual([{ id: "version", program: "docker", args: ["version", "--format", "{{.Server.Version}}"] }]);
    // A command takes no argument of the caller's and takes input only when it declares `maxInputBytes`: this one declares neither a
    // limit on input nor a different one on output, so Buzz's review shows "Input: none" and the default output limit.
    expect(Object.keys(manifest.host.commands[0] ?? {}).sort()).toEqual(["args", "id", "program"]);
    expect(manifest.host.commands.map(({ id }) => id)).toEqual([COMMAND.version]);
  });

  it("declares one process for each other docker verb the plugin uses, each the bare program `docker` with its leading words fixed, and none for any other verb", () => {
    expect(manifest.host.processes).toEqual([
      { id: "pull", program: "docker", args: ["pull", IMAGE] },
      { id: "run-init", program: "docker", args: ["run", "--rm", "-v"] },
      { id: "run-agent", program: "docker", args: ["run", "-d", "--restart", "unless-stopped", "--name"] },
      { id: "run-updater", program: "docker", args: ["run", "-d", "--restart", "unless-stopped", "-v", "/var/run/docker.sock:/var/run/docker.sock", "--name"] },
      { id: "exec", program: "docker", args: ["exec"] },
      { id: "inspect-state", program: "docker", args: ["inspect", "--format", "{{.State.Status}}"] },
      { id: "inspect-image", program: "docker", args: ["inspect", "--format", "{{.Config.Image}}"] },
      { id: "restart", program: "docker", args: ["restart"] },
      { id: "stop", program: "docker", args: ["stop"] },
      { id: "rm", program: "docker", args: ["rm", "-f"] },
      { id: "volume-rm", program: "docker", args: ["volume", "rm"] },
    ]);
    // The ids the code spawns are the ones declared, and the other way round.
    expect(manifest.host.processes.map(({ id }) => id).sort()).toEqual(Object.values(PROCESS).sort());
    expect(manifest.host.processes.map(({ id }) => id)).not.toContain(COMMAND.version);
    // The verbs that would give the plugin more than it needs are not among them: copying files, building, killing, creating or starting a
    // container by another way, or touching Docker's login, system, networks, images or compose.
    const verbs = [...manifest.host.commands, ...manifest.host.processes].map(({ args }) => args[0]);
    for (const verb of ["cp", "build", "kill", "create", "start", "push", "login", "system", "network", "compose", "image", "container"]) {
      expect(verbs, verb).not.toContain(verb);
    }
    expect([...new Set(verbs)].sort()).toEqual(["exec", "inspect", "pull", "restart", "rm", "run", "stop", "version", "volume"]);
  });

  it("fixes, in every `run` entry, the flags that keep it to what the interface needs, and mounts the Docker socket in one entry only", () => {
    const runs = manifest.host.processes.filter(({ args }) => args[0] === "run");
    expect(runs.map(({ id }) => id).sort()).toEqual(["run-agent", "run-init", "run-updater"]);
    for (const { id, args } of runs) {
      // None of the flags that would widen a container: privileges, host networking or processes, published ports, devices, capabilities,
      // environment (a secret goes on stdin, never in a flag), or a bind mount of a path other than the socket.
      for (const word of args) expect(word, id).not.toMatch(/^(--privileged|--network|--net|--pid|--ipc|--uts|-p|--publish|--device|--cap-add|--security-opt|-e|--env|--env-file|--mount|--user|-u)$/);
    }
    const mounts = manifest.host.processes.filter(({ args }) => args.some((word) => word.includes("docker.sock")));
    expect(mounts.map(({ id }) => id)).toEqual(["run-updater"]);
    // The one entry that is not a run of a container in the background restarts nothing and the only one that removes things is `rm -f`.
    expect(manifest.host.processes.filter(({ args }) => args[0] === "rm" || args[0] === "volume").map(({ id }) => id).sort()).toEqual(["rm", "volume-rm"]);
  });

  it("names the one image the plugin may pull, the one the code runs", () => {
    expect(IMAGE).toMatch(/^[a-z0-9.-]+(?::[0-9]+)?(?:\/[a-z0-9._-]+)*\/ghost-protocol:[A-Za-z0-9._-]+$/);
    expect(IMAGE).not.toMatch(/:latest$/);
    expect(manifest.host.processes.find(({ id }) => id === "pull")?.args).toEqual(["pull", IMAGE]);
  });

  it("is not a shell: nothing runs through `sh`, `bash`, `cmd` or an interpreter, and no argument is a script", () => {
    for (const process of [...manifest.host.commands, ...manifest.host.processes]) {
      expect(process.program).toBe("docker");
      expect(process.program).not.toMatch(/^(sh|bash|zsh|cmd|powershell|pwsh|python3?|node|env)$/);
      for (const argument of process.args ?? []) expect(argument).not.toMatch(/[;&|`$\n]|-c$/);
    }
  });

  it("asks Buzz for the one command and the processes and nothing else: no network origins, files, bundled program or other grants", () => {
    expect(Object.keys(manifest.host)).toEqual(["commands", "processes"]);
    for (const process of manifest.host.processes) expect(Object.keys(process).sort()).toEqual(["args", "id", "program"]);
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
    expect([...inject].sort()).toEqual(["agents", "host", "pages", "react", "relay"]);
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
