import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GUIDE } from "../../src/claude-words";
import { STEP_ORDER } from "../../src/gp/progress";

// What a stranger with only the Buzz desktop app reads before a GHOST Protocol agent runs: this plugin's README and AGENTS.md, the
// repository's README and AGENTS.md. They must link to GHOST Protocol's own docs and back, say the same true thing about when Claude is
// connected (held against the step order the code runs), name the paid plans the Claude guide names, give the relay admin's step, and
// say what the one hand run on a Mac covered and what is still not run, and give the menu path one way. The relay must have owner
// attestations on: a relay without them is not supported yet, and no doc offers the agent as a relay member as a way that works. Every
// link to a heading in these four docs lands on one.

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
const RELAY_SETTING = `${QUICK_START}#the-relay-setting-owner-attestations-on`;
const NOT_YET = "a relay without it is not supported yet";
// A sentence that names making the agent a relay member, membership, the member fallback, or skipping the tag. Such a sentence passes
// only with the docs' own words after it, NOT_SUPPORTED; any other "not supported" (one that says it works after all) does not count.
const VERB = String.raw`add|adds|added|adding|admit|admits|admitted|admitting|make|makes|making|made|register|registers|registered|registering|enrol|enrols|enroll|enrolls|enrolled|enrolling|enrolment|enrollment|invite|invites|invited|inviting|list|lists|listed|listing`;
const MEMBER = String.raw`\b(${VERB})\b[^.]{0,30}\b(as )?a (relay )?member\b|\bmembership\b|\bmembers? needs? no tag|member.fallback|can be skipped|tag is then not needed`;
const NOT_SUPPORTED = ": that way is not supported for now";
const MEMBER_WAY = new RegExp(MEMBER, "i");
const MEMBER_WAY_DISOWNED = new RegExp(`(${MEMBER}).*${NOT_SUPPORTED}`, "i");
/** A line that starts a block of its own in Markdown (a blank line, a heading, a table row, a list item or a quote); any other line
 * continues the one before it, as a wrapped line of the same paragraph. */
const STARTS_BLOCK = /^\s*($|#|\||[-*+] |\d+[.)] |>)/;
/** A doc's paragraphs, each with its wrapped lines joined by a space, so a sentence is read whole wherever its lines break. */
const paragraphs = (text: string): string[] =>
  text.split("\n").reduce<string[]>((blocks, line) => {
    if (STARTS_BLOCK.test(line) || blocks.length === 0 || blocks[blocks.length - 1] === "") blocks.push(line.trim());
    else blocks[blocks.length - 1] += ` ${line.trim()}`;
    return blocks;
  }, []);
/** The sentences of a doc that offer the agent as a relay member without the docs' words that this way is not supported. */
const memberOffers = (text: string): string[] =>
  paragraphs(text)
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?]) /))
    .filter((sentence) => MEMBER_WAY.test(sentence) && !MEMBER_WAY_DISOWNED.test(sentence));
const OWNER_MEMBER = "the owner key that signs the attestation must itself be a member of the relay";
const STILL_NOT_RUN =
  "the Megatech Harness entry and its three choices in the desktop app, a stranger's own install through the Git importer (the plugin was already installed on that Mac), the address way of signing in to Claude, the desktop app on Windows and on Linux, Docker Desktop and other Docker engines";
const ENGINES = "OrbStack was used on the Mac run";
const DOCKER_DESKTOP = "Docker Desktop is the engine Buzz's docs expect, but it has not been run here";
/** The menu path to the create form, as Buzz 1.0.6 shows it: the one way the docs write it. */
const MENU_PATH = "**Agents → New agent → Megatech → Personal agent, this computer**";

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
/** The anchors GitHub gives a Markdown file's headings: the text as shown, in lower case, with every character that is not a letter, a
 * digit, a space, `-` or `_` removed, spaces made `-`, and `-1`, `-2` and on after a slug already taken. Headings in code blocks do not count. */
function slugs(text: string): string[] {
  const seen = new Map<string, number>();
  let fenced = false;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const shown = heading[1].replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "").replace(/[`*]/g, "");
    const base = shown.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    out.push(count === 0 ? base : `${base}-${count}`);
  }
  return out;
}
/** Every link in the given docs (path from the repository's root, and text) to a heading of a file in the repository, `](#...)` or
 * `](<path>#...)` with a relative path (a folder means its README.md), whose heading is not there: "<doc>: <link>". */
function brokenAnchors(docs: Record<string, string>): string[] {
  const broken: string[] = [];
  for (const [doc, text] of Object.entries(docs)) {
    for (const [, target, anchor] of text.matchAll(/\]\(([^)\s#]*)#([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue;
      let file = target === "" ? doc : relative(root, join(root, dirname(doc), target));
      if (!file.endsWith(".md")) file = join(file, "README.md");
      const body = docs[file] ?? read(join(root, file));
      if (!slugs(body).includes(decodeURIComponent(anchor))) broken.push(`${doc}: ${target}#${anchor}`);
    }
  }
  return broken;
}

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

describe("the member check", () => {
  it("catches the member way, however it is put, and a 'not supported' that is not the docs' own words", () => {
    for (const sentence of [
      "Or ask the admin to add the agent as a member: not supported elsewhere but works.",
      "Otherwise the relay's admin must add the agent as a member, by its public key.",
      "Or give the agent membership of the relay.",
      "Members need no tag.",
      "A member needs no tag, so ask the admin.",
      "See the member fallback.",
      "Add it as a relay member: that way is not supported elsewhere.",
      "Or the admin can admit the agent as a member.",
      "Or the admin can register the agent as a relay member.",
      "Ask the admin to enrol it as a member.",
      "Ask the admin to enroll the agent as a member.",
      "Or invite the agent to be a member.",
      "Or the admin can list the agent's key as a member.",
    ]) {
      expect(memberOffers(sentence), sentence).toEqual([sentence]);
    }
  });
  it("reads a sentence whole when its lines are wrapped", () => {
    expect(memberOffers("Or the admin can register the agent\nas a relay member, by its public key.")).toEqual([
      "Or the admin can register the agent as a relay member, by its public key.",
    ]);
    expect(memberOffers("- One item.\n- Or invite the agent\n  to be a member.\n\nA new paragraph.")).toEqual(["- Or invite the agent to be a member."]);
    expect(memberOffers("Adding the agent as a relay member: that way is\nnot supported for now.")).toEqual([]);
  });
  it("lets through the docs' own sentences", () => {
    for (const sentence of [
      "The refusal's text also suggests adding the agent as a relay member: that way is not supported for now, so do not offer it.",
      "The same refusal has one other cause: the owner key that signs the attestation must itself be a member of the relay (your own Buzz account there is).",
    ]) {
      expect(memberOffers(sentence), sentence).toEqual([]);
    }
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
  it("says the relay must have owner attestations on (off by default), and a relay without it is not supported yet", () => {
    expect(before).toContain("- **A relay with owner attestations on.**");
    expect(before).toContain("(`BUZZ_ALLOW_NIP_OA_AUTH=true`), which is **off by default**");
    expect(before).toContain(`The relay must have owner attestations on: ${NOT_YET}.`);
    expect(before).toContain("**Or create a community** in Buzz (it needs an account)");
  });
  it("keeps the symptom, with its one cure: owner attestations turned on", () => {
    expect(before).toContain('the relay refuses the agent ("not a relay member") and it never runs');
    expect(before).toContain("The one cure is for the relay's admin to turn owner attestations on, then restart the agent, or wait about a minute.");
  });
  it("says the owner's own key must be a relay member, and that gp attest --relay checks it", () => {
    expect(before).toContain(`The same refusal has one other cause: ${OWNER_MEMBER} (your own Buzz account there is)`);
    expect(before).toContain("`gp attest --relay` checks it. This is the owner's key, not the agent's.");
  });
  it("links the quick start's relay setting by its heading, never the member fallback's", () => {
    expect(before).toContain(`](${RELAY_SETTING})`);
    expect(readme).not.toContain("member-fallback");
  });
  it("says the refusal text's member suggestion is not supported", () => {
    const line = readme.split("\n").find((l) => l.includes("the plugin's text for it")) ?? "";
    expect(line).toContain("(the second way, adding the agent as a relay member: that way is not supported for now)");
  });
  it("offers no member admission as a supported way", () => {
    expect(memberOffers(readme)).toEqual([]);
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
  it("keeps Not covered honest: one hand run on a Mac worked, what is still not run, and the Linux run that stopped at the attestation", () => {
    const row = readme.split("\n").find((line) => line.startsWith("| **Not covered** |")) ?? "";
    expect(row).toContain("**The desktop route, beyond one hand run on a Mac.** One hand run on a Mac worked: an agent made with **Create agent** in the Buzz desktop app showed *Running*, Claude *Active* and the relay *Connected*, and answered a direct message.");
    expect(row).toContain(`Not run yet: ${STILL_NOT_RUN}.`);
    expect(row).toContain(ENGINES);
    expect(row).toContain("then stopped at the attestation");
    const platforms = readme.split("\n").find((line) => line.startsWith("| Platforms |")) ?? "";
    expect(platforms).toContain("**macOS:** one hand run worked, from a plugin already installed");
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
    expect(agents).toContain("4. **A relay with owner attestations on.**");
    expect(agents).toContain(`(\`BUZZ_ALLOW_NIP_OA_AUTH=true\`, **off by default**). The relay must have owner attestations on: ${NOT_YET}.`);
    expect(agents).toContain("**Create agent** signs the agent in itself, at step 7, after the attestation and before the wait.");
    expect(agents).toContain("step 7 is skipped and the agent waits at `needs-claude`");
  });
  it("says where a refusal shows, for each way, and names the Buzz button as Buzz does", () => {
    const row = agents.split("\n").find((line) => line.startsWith("| 4. Create agent |")) ?? "";
    expect(row).toContain("With a token, a relay without owner attestations on refuses the agent in step 8");
    expect(row).toContain("With the address, Create agent ends at the Claude sign-in (\"Waiting for you to sign in to Claude\") and does not report the refusal. The agent's tab shows it instead");
    expect(agents).toContain("**Or create a community** in Buzz (it needs an account)");
  });
  it("keeps the symptom with its one cure, and offers no member admission as a supported way", () => {
    expect(agents).toContain('the agent is refused ("not a relay member") and never runs');
    expect(agents).toContain("The one cure is for the relay's admin to turn owner attestations on, then restart the agent, or wait about a minute.");
    expect(agents).toContain(`The same refusal has one other cause: ${OWNER_MEMBER} (the person's own Buzz account there is)`);
    expect(agents).toContain("that way is not supported for now, so do not offer it");
    expect(memberOffers(agents)).toEqual([]);
  });
  it("gives the terminal way, and what has not run", () => {
    expect(agents).toContain("\n## The other way\n");
    expect(agents).toContain("once, by hand on a Mac, the desktop route from a plugin already installed: an agent made with **Create agent** showed **Running**, Claude **Active** and the relay **Connected**, and answered a direct message");
    for (const notRun of [
      "the Megatech Harness entry and its three choices in the desktop app (the Mac run was before them);",
      "the desktop route from a stranger's own install: no install through the Git importer in the desktop app (the plugin was already installed on that Mac);",
      "the address way of signing in to Claude;",
      "the desktop app on Windows and on Linux;",
      "Docker Desktop (the engine Buzz's docs expect) and other Docker engines.",
    ]) {
      expect(section(agents, "What has and has not been run")).toContain(`  - ${notRun}`);
    }
  });
});

describe("the repository's README and AGENTS.md", () => {
  it("README: points GHOST Protocol to its plugin page, its AGENTS.md and GHOST Protocol's quick start", () => {
    const line = rootReadme.split("\n").find((l) => l.startsWith("**GHOST Protocol** needs more than the plugin")) ?? "";
    for (const link of ["](plugins/ghost-protocol#before-you-start)", `](${QUICK_START})`, "](plugins/ghost-protocol/AGENTS.md)"]) expect(line).toContain(link);
    expect(line).toContain(`a paid Claude plan (${PLANS})`);
    expect(line).toContain("a relay with owner attestations on (`BUZZ_ALLOW_NIP_OA_AUTH=true`, turned on by its admin; off by default)");
    expect(line).toContain("A relay without it is not supported yet.");
    expect(line).toContain("The owner key that signs the attestation must itself be a member of the relay (your own Buzz account there is).");
  });
  it("README and AGENTS.md: offer no member admission as a supported way", () => {
    expect(memberOffers(rootReadme)).toEqual([]);
    expect(memberOffers(rootAgents)).toEqual([]);
  });
  it("AGENTS.md: points to the plugin's AGENTS.md", () => {
    expect(rootAgents).toContain("](plugins/ghost-protocol/AGENTS.md)");
  });
  it("README: says one hand run on a Mac worked, and what is still not run", () => {
    const row = rootReadme.split("\n").find((l) => l.startsWith("| [GHOST Protocol](plugins/ghost-protocol) |")) ?? "";
    expect(row).toContain("| one hand run worked ⁸ |");
    const note = rootReadme.split("\n").find((l) => l.includes("⁸ It checks that Docker is running")) ?? "";
    expect(note).toContain("One hand run on a Mac worked: an agent made in the desktop app ran, with Claude active and the relay connected, and answered a direct message");
    expect(note).toContain(`Not run yet: ${STILL_NOT_RUN}`);
    expect(note).toContain(ENGINES);
  });
});

describe("what the docs say of the Megatech Harness entry and the hand run", () => {
  it("README: the browser suite row names the Megatech entry, the disabled choice and the content machine's held-back Create", () => {
    const row = readme.split("\n").find((line) => line.startsWith("| Browser suite (`test/web`) |")) ?? "";
    for (const part of [
      "the type in the Harness list as Megatech (one entry, and none still named GHOST Protocol)",
      "**Personal agent, hosted** disabled with *coming soon* and no call",
      "**Content machine, hosted** showing the megatech sign-in text, hiding the two questions and holding Create back",
      "starting nothing from a press of Create, Enter in the name, the form submitted by the page, the button's own click method or a submit event",
    ]) {
      expect(row, part).toContain(part);
    }
  });
  it("say the one Mac hand run was of the form before the Megatech entry, in each doc that gives it", () => {
    expect(readme).toContain("That run was of the form before this version: the Harness entry then said GHOST Protocol and the form had two choices, so the Megatech entry and its three choices have not been seen in the desktop app.");
    const row = readme.split("\n").find((line) => line.startsWith("| **Not covered** |")) ?? "";
    expect(row).toContain("That run was of the form before this version, with the Harness entry named GHOST Protocol and two choices (**This computer**, and **Hosted**, disabled): the Megatech entry and its three choices have not been seen in the desktop app.");
    expect(agents).toContain("that run was of the form before the Harness entry was renamed Megatech and had three choices");
    expect(rootReadme).toContain("(that run was before the Harness entry was renamed Megatech and had three choices)");
  });
});

describe("the four docs, together", () => {
  const docs = { "README.md": rootReadme, "AGENTS.md": rootAgents, "plugins/ghost-protocol/README.md": readme, "plugins/ghost-protocol/AGENTS.md": agents };
  it("write the menu path one way, as Buzz 1.0.6 shows it", () => {
    expect(readme).toContain(MENU_PATH);
    expect(agents).toContain(MENU_PATH);
    for (const [name, text] of Object.entries(docs)) {
      for (const other of ["Create a new agent", "Agents → Create agent", "as the Harness", "as the **Harness**"]) expect(text, `${name}: ${other}`).not.toContain(other);
      for (const path of text.match(/Agents → [^*]*/g) ?? []) expect(`**${path}**`, name).toBe(MENU_PATH);
    }
  });
  it("name OrbStack as the one engine the Mac run used, and Docker Desktop as expected but not run", () => {
    for (const text of [readme, agents, rootReadme]) {
      expect(text).toContain(ENGINES);
      expect(text).toContain(DOCKER_DESKTOP);
    }
    for (const [name, text] of Object.entries(docs)) {
      expect(text, name).not.toMatch(/Docker Desktop (or|and) OrbStack|OrbStack (or|and) Docker Desktop/);
      expect(text, name).not.toMatch(/Docker Desktop[^.;|]{0,40}\bwere used\b/);
      expect(text, name).not.toContain("Docker Desktop on macOS and Windows");
      expect(text, name).not.toContain("Needs Docker Desktop");
    }
  });
  it("say that `claude setup-token` needs Claude Code installed, on any computer", () => {
    expect(section(readme, "Before you start")).toContain("`claude setup-token` needs Claude Code installed, on any computer");
    expect(agents).toContain("`claude setup-token` needs Claude Code installed, on any computer");
  });
  it("link only to headings that are there", () => {
    expect(brokenAnchors(docs)).toEqual([]);
  });
});

describe("the anchor check", () => {
  it("makes GitHub's slugs", () => {
    expect(slugs("## The create form and the agent's tab\n## What `gp` asks for\n### Step 1: *Docker*, [the page](x.md)\n## Tests\n## Tests\n```\n## Not a heading\n```")).toEqual([
      "the-create-form-and-the-agents-tab",
      "what-gp-asks-for",
      "step-1-docker-the-page",
      "tests",
      "tests-1",
    ]);
  });
  it("catches an anchor that names no heading, in this file or in another", () => {
    const fixture = { "plugins/ghost-protocol/README.md": "# Title\n\n## Before you start\n\nSee [it](#before-you-start).\n", "plugins/ghost-protocol/AGENTS.md": "[a](README.md#before-you-start) [b](README.md#no-such-heading) [c](#nowhere)\n" };
    expect(brokenAnchors(fixture)).toEqual(["plugins/ghost-protocol/AGENTS.md: README.md#no-such-heading", "plugins/ghost-protocol/AGENTS.md: #nowhere"]);
  });
});
