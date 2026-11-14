// What makes this folder an exempt prototype (AGENTS.md: named as such in its README, kept out of the importer's list because no built
// plugin.js is on main, never offered to people) and what keeps its notices honest. Each of these is a rule a later change could break.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { license } from "../../scripts/ghostty-package.mjs";

const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const readme = read("README.md");

describe("the prototype is named as one", () => {
  it("says so first, and says not to install it from main", () => {
    expect(readme.split("\n")[0]).toMatch(/prototype/i);
    expect(readme).toMatch(/\*\*This is a prototype, and it is not offered for install\.\*\*/);
    expect(readme).toMatch(/Do not install it from `main`/);
  });

  it("carries no install block: no repository address and no good/ tag to import from", () => {
    const blocks = [...readme.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((match) => match[1]);
    expect(blocks.length).toBeGreaterThan(0); // the build and test commands
    for (const block of blocks) {
      expect(block).not.toMatch(/github\.com\/0xnfrith|buzz-plugins\.git|good\//);
    }
    expect(readme).not.toMatch(/good\/ghostty/);
  });

  it("states the limits that matter to someone about to run it: SSH agent, links, the bridge's reach, no speed claim", () => {
    expect(readme).toMatch(/SSH_AUTH_SOCK/);
    expect(readme).toMatch(/Links are not opened/);
    expect(readme).toMatch(/setsid/);
    expect(readme).toMatch(/no speed claim/i);
  });
});

describe("no built plugin.js is committed", () => {
  it("is not tracked by git, so Buzz's importer skips the folder", () => {
    let tracked: string;
    try {
      tracked = execFileSync("git", ["ls-files", "--", "plugin.js"], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
    } catch {
      return; // not in a git checkout (a source archive): nothing to check
    }
    expect(tracked.trim()).toBe("");
  });

  it("is ignored, so a build cannot be committed by accident", () => {
    expect(read(".gitignore")).toMatch(/^plugin\.js$/m);
  });
});

describe("THIRD_PARTY_NOTICES.md", () => {
  const notices = read("THIRD_PARTY_NOTICES.md");

  it("holds the licence text that is in the ghostty-web package, word for word", () => {
    expect(notices).toContain(license);
  });

  it("names the copyright holders of what is bundled, and says what has not been checked", () => {
    expect(notices).toContain("Copyright (c) 2025 Coder");
    expect(notices).toContain("Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors");
    expect(notices).toMatch(/## Not yet checked/);
    expect(notices).toMatch(/What else is compiled into `ghostty-vt\.wasm`/);
  });
});
