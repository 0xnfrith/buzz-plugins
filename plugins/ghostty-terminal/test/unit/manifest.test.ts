import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIMIT, LOADER, bridgeArgs, render } from "../../scripts/manifest.mjs";
import { processProblems } from "../host-sim.mjs";
import manifest from "../../manifest.json" with { type: "json" };

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const bridge = read("src/bridge.py");
const bytes = (text: string) => new TextEncoder().encode(text).length;
const [process] = manifest.host.processes;

describe("manifest.json", () => {
  it("is what scripts/manifest.mjs writes from src/bridge.py (run `pnpm run manifest` after editing the bridge)", () => {
    expect(read("manifest.json")).toBe(render(bridge));
  });

  it("starts python in isolated mode, so no current directory, PYTHONPATH or user site is on its import path", () => {
    expect(process.program).toBe("python3");
    expect(process.args.slice(0, 2)).toEqual(["-I", "-c"]);
  });

  it("shows the bridge in full: the two halves joined are src/bridge.py, byte for byte, and each fits Buzz's 1024-byte argument", () => {
    const [, , loader, ...halves] = process.args;
    expect(loader).toBe(LOADER);
    expect(halves).toHaveLength(2);
    expect(halves.join("")).toBe(bridge);
    for (const half of halves) expect(bytes(half)).toBeLessThanOrEqual(LIMIT);
    expect(bytes(loader)).toBeLessThanOrEqual(LIMIT);
  });

  it("uses the fixed loader: it joins exactly two arguments, so the arguments Buzz appends after them are never run", () => {
    expect(LOADER).toBe("import sys;exec(sys.argv[1]+sys.argv[2])");
    expect(process.args).toHaveLength(5);
    // The bridge itself must not read its arguments either (they are the plugin's to add, and Buzz appends them).
    expect(bridge).not.toMatch(/sys\.argv|import sys|\bargv\b/);
  });

  it("holds nothing the review cannot read: plain ASCII, no eval, compile, base64-decoded or compressed code", () => {
    expect(bridge).toMatch(/^[\n\x20-\x7e]+$/);
    // Safe: "exec" below is a word searched for in the bridge's python text; this test file calls no child_process.exec.
    expect(bridge).not.toMatch(/\b(eval|compile|exec|zlib|marshal|pickle|importlib|__import__)\b/);
    // base64 is used for the data on the wire only, never for code.
    expect([...bridge.matchAll(/b64decode\(([^)]*)\)/g)].map((match) => match[1])).toEqual(["line[2:]"]);
  });

  it("asks Buzz for a process and nothing else: no commands, network origins, files or other grants", () => {
    expect(Object.keys(manifest.host)).toEqual(["processes"]);
    expect(manifest.host.processes).toHaveLength(1);
    expect(process.id).toBe("pty");
    expect(Object.keys(process).sort()).toEqual(["args", "id", "program"]);
  });

  it("would be accepted by Buzz's rules for a process (lib.rs valid_program) and its basic manifest fields", () => {
    expect(processProblems(manifest)).toEqual([]);
    expect(manifest.apiVersion).toBe(1);
    expect(manifest.id).toMatch(/^[a-z][a-z0-9.-]*$/);
    expect(bytes(manifest.id)).toBeLessThanOrEqual(80);
    expect(bytes(manifest.name)).toBeGreaterThanOrEqual(1);
    expect(bytes(manifest.name)).toBeLessThanOrEqual(80);
    expect(bytes(manifest.description)).toBeGreaterThanOrEqual(1);
    expect(bytes(manifest.description)).toBeLessThanOrEqual(280);
    expect(manifest.discovery.tags.length).toBeLessThanOrEqual(16);
  });

  it("says in its description that it is a prototype", () => {
    expect(manifest.description).toMatch(/prototype/i);
  });
});

describe("the process-rule check (so a bad manifest cannot pass quietly)", () => {
  const withArgs = (args: string[], program = "python3") => ({ host: { processes: [{ id: "pty", program, args }] } });
  it("refuses an argument over 1024 bytes, more than 16 arguments, a NUL, and a program that is a path", () => {
    expect(processProblems(withArgs(["x".repeat(1025)]))).toHaveLength(1);
    expect(processProblems(withArgs(Array(17).fill("x")))).toHaveLength(1);
    expect(processProblems(withArgs(["a\0b"]))).toHaveLength(1);
    expect(processProblems(withArgs([], "/usr/bin/python3"))).toHaveLength(1);
    expect(processProblems(withArgs(["x".repeat(1024)]))).toEqual([]);
  });

  it("measures bytes, not characters", () => {
    expect(processProblems(withArgs(["é".repeat(513)]))).toHaveLength(1);
  });
});

describe("bridgeArgs", () => {
  it("passes a source that fits one argument through whole, with no loader", () => {
    expect(bridgeArgs("print(1)\n")).toEqual(["-I", "-c", "print(1)\n"]);
  });

  it("cuts a longer source at the last blank line inside its first 1024 bytes", () => {
    const source = `${"a = 1\n".repeat(100)}\n${"b = 2\n".repeat(100)}`;
    const [, , loader, first, second] = bridgeArgs(source);
    expect(loader).toBe(LOADER);
    expect(first + second).toBe(source);
    expect(first.endsWith("\n\n")).toBe(true);
  });

  it("refuses a source that cannot be cut into two arguments, or that is not ASCII", () => {
    expect(() => bridgeArgs("a = 1\n".repeat(400))).toThrow(/blank line/);
    expect(() => bridgeArgs(`${"a = 1\n".repeat(100)}\n${"b = 2\n".repeat(300)}`)).toThrow(/too long/);
    expect(() => bridgeArgs("print('é')\n")).toThrow(/ASCII/);
  });
});
