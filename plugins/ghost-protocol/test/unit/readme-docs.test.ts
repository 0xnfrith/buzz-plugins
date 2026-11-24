import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GUIDE } from "../../src/claude-words";
import { STEP_ORDER } from "../../src/gp/progress";

// What a stranger with only the Buzz desktop app reads before a GHOST Protocol agent runs: this plugin's README and AGENTS.md, the
// repository's README and AGENTS.md. They must link to GHOST Protocol's own docs and back, say the same true thing about when Claude is
// connected (held against the step order the code runs), name the paid plans the Claude guide names, give the relay admin's step, and
// say that the desktop route has not run.

const folder = join(dirname(fileURLToPath(import.meta.url)), "../..");
const root = join(folder, "../..");
const read = (path: string): string => (existsSync(path) ? readFileSync(path, "utf8") : "");
const readme = read(join(folder, "README.md"));
const agents = read(join(folder, "AGENTS.md"));
const rootReadme = read(join(root, "README.md"));
const rootAgents = read(join(root, "AGENTS.md"));

const GP = "https://github.com/0xnfrith/ghost-protocol";
const QUICK_START = `${GP}/blob/main/docs/quick-start.md`;
const GP_AGENTS = `${GP}/blob/main/AGENTS.md`;
const GP_README = `${GP}#readme`;
const PLANS = "Pro, Max, Ultra, Team or Enterprise";

/** The text of one `## ` section of a Markdown file, up to the next `## ` heading ("" when there is no such section). */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start < 0) return "";
  const next = text.indexOf("\n## ", start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}
/** The line numbers (0-based) where each text first appears, -1 for one that is missing. */
const linesOf = (text: string, needles: readonly string[]): number[] => {
  const lines = text.split("\n");
  return needles.map((needle) => lines.findIndex((line) => line.includes(needle)));
};

describe("the order the docs describe is the order the code runs", () => {
  it("hands over the attestation, then signs in to Claude, then waits", () => {
    const [tag, claude, wait] = (["tag", "claude", "wait"] as const).map((id) => STEP_ORDER.indexOf(id));
    expect(tag).toBeGreaterThanOrEqual(0);
    expect(claude).toBe(tag + 1);
    expect(wait).toBe(claude + 1);
    expect(claude + 1).toBe(7); // step 7 of 8, as the docs number it
  });
  it("ends Create at the Claude sign-in with the words the docs quote", () => {
    expect(read(join(folder, "src/gp/flow.ts"))).toContain('"Waiting for you to sign in to Claude"');
  });
  it("names the same paid plans as the Claude guide", () => {
    expect(GUIDE.subscription).toContain(`a paid Claude plan: ${PLANS}`);
  });
});

describe("the plugin's README", () => {
  const before = section(readme, "Before you start");
  it("has a Before you start section, before what it does", () => {
    expect(before).not.toBe("");
    expect(readme.indexOf("\n## Before you start\n")).toBeLessThan(readme.indexOf("\n## What it does\n"));
  });
  it("links GHOST Protocol's quick start, README and AGENTS.md, and this folder's AGENTS.md", () => {
    for (const link of [`](${QUICK_START})`, `](${GP_README})`, `](${GP_AGENTS})`, "](AGENTS.md)"]) expect(before).toContain(link);
  });
  it("says the desktop app is needed", () => {
    expect(before).toContain("**The Buzz desktop app**");
  });
  it("says a paid Claude plan, not the free plan", () => {
    expect(before).toContain(`**A paid Claude plan:** ${PLANS}.`);
    expect(before).toContain("The free plan does not include Claude Code");
  });
  it("gives the relay admin's step: owner attestations on (off by default), or the agent as a member", () => {
    expect(before).toContain("(`BUZZ_ALLOW_NIP_OA_AUTH=true`), which is **off by default**");
    expect(before).toContain("the relay's admin must add the agent as a member");
    expect(before).toContain("**Or create a community** in Buzz (it needs an account)");
  });
  it("says when Claude is connected, for each way", () => {
    const form = section(readme, "The create form and the agent's tab");
    expect(form).toContain("**When Claude is connected:** a token pasted here is sent by **Create agent** itself, at step 7, after the attestation and before the wait.");
    expect(form).toContain("With the address, step 7 is skipped and the agent waits at *Waiting for a Claude sign-in*; you sign in afterwards on the agent's **GHOST Protocol** tab.");
  });
  it("says where a refusal shows: Create stops at step 8 with a token; with the address, the tab shows it, even before the sign-in", () => {
    const form = section(readme, "The create form and the agent's tab");
    expect(form).toContain("Step 6 only hands the attestation to the agent; the relay judges it when the agent logs in. **With a token**, that is in step 8");
    expect(form).toContain("**With the address** (or with no token held), Create ends at step 8 with *Waiting for you to sign in to Claude* and does not report the refusal");
    expect(form).toContain("The agent's tab shows it instead, from the relay field of the status: *Refused: not a member*, with the agent's public key, even before the sign-in.");
  });
  it("keeps Not covered honest: the desktop route never ran, and the one hand run stopped at the attestation", () => {
    const row = readme.split("\n").find((line) => line.startsWith("| **Not covered** |")) ?? "";
    expect(row).toContain("**The desktop route, ever.** Nobody has yet installed this plugin in the Buzz desktop app and made an agent with **Create agent**, on any system");
    expect(row).toContain("then stopped at the attestation");
  });
});

describe("the plugin's AGENTS.md", () => {
  it("is there", () => {
    expect(agents).not.toBe("");
  });
  it("gives the whole chain, in order", () => {
    const at = linesOf(agents, ["| 1. Add the plugin |", "| 2. Check Docker |", "| 3. The create form |", "| 4. Create agent |", "| 5. Running |"]);
    expect(at.every((line) => line >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("links both repositories' docs", () => {
    for (const link of [`](${QUICK_START})`, `](${GP_README})`, `](${GP_AGENTS})`, "](README.md)", "](../../README.md)", "](../../AGENTS.md)"]) {
      expect(agents).toContain(link);
    }
  });
  it("says a paid Claude plan, the relay admin's step and when Claude is connected", () => {
    expect(agents).toContain(`**A paid Claude plan:** ${PLANS}.`);
    expect(agents).toContain("(`BUZZ_ALLOW_NIP_OA_AUTH=true`, **off by default**). Otherwise the relay's admin adds the agent as a member");
    expect(agents).toContain("**Create agent** signs the agent in itself, at step 7, after the attestation and before the wait.");
    expect(agents).toContain("step 7 is skipped and the agent waits at `needs-claude`");
  });
  it("says where a refusal shows, for each way, and names the Buzz button as Buzz does", () => {
    const row = agents.split("\n").find((line) => line.startsWith("| 4. Create agent |")) ?? "";
    expect(row).toContain("With a token, a relay without owner attestations on refuses the agent in step 8");
    expect(row).toContain("With the address, Create agent ends at the Claude sign-in (\"Waiting for you to sign in to Claude\") and does not report the refusal. The agent's tab shows it instead");
    expect(agents).toContain("**Or create a community** in Buzz (it needs an account)");
  });
  it("gives the terminal way, and what has not run", () => {
    expect(agents).toContain("\n## The other way\n");
    expect(agents).toContain("the desktop route: no install in the desktop app, no **Create agent**");
  });
});

describe("the repository's README and AGENTS.md", () => {
  it("README: points GHOST Protocol to its plugin page, its AGENTS.md and GHOST Protocol's quick start", () => {
    const line = rootReadme.split("\n").find((l) => l.startsWith("**GHOST Protocol** needs more than the plugin")) ?? "";
    for (const link of ["](plugins/ghost-protocol#before-you-start)", `](${QUICK_START})`, "](plugins/ghost-protocol/AGENTS.md)"]) expect(line).toContain(link);
    expect(line).toContain(`a paid Claude plan (${PLANS})`);
    expect(line).toContain("owner attestations turned on by its admin (off by default) or with the agent added as a member");
  });
  it("AGENTS.md: points to the plugin's AGENTS.md", () => {
    expect(rootAgents).toContain("](plugins/ghost-protocol/AGENTS.md)");
  });
});
