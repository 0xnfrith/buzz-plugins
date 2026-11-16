import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { imageProblems, imageTargets } from "../../../../.github/plugin-assets/check.mjs";

const folder = join(dirname(fileURLToPath(import.meta.url)), "../..");
const root = join(folder, "../..");
const readme = readFileSync(join(folder, "README.md"), "utf8");
// The pictures test/web/screenshots.spec.mjs makes, in the order they have in the README: the three of the Claude guide, which sit with the
// description of the agent's tab, then the journey: the install, the review, finding the page by search and in the sidebar, and the two
// states of the Docker panel.
const PICTURES = [
  "claude-guide-not-active",
  "claude-guide-token-refused",
  "claude-guide-active",
  "choose-a-plugin",
  "review-access",
  "find-by-search",
  "find-in-sidebar",
  "docker-is-running",
  "docker-did-not-answer",
].map((name) => `screenshots/${name}.png`);

describe("README.md's pictures", () => {
  it("every image it points at is a file of the repository, the install steps' shared ones included", () => {
    expect(imageProblems(root, "plugins/ghost-protocol/README.md", readme)).toEqual([]);
    expect(imageTargets(readme)).toEqual(expect.arrayContaining(["../../assets/install/1-manage-plugins.png", "../../assets/install/2-add-a-plugin.png", "../../assets/install/3-git-address.png"]));
  });

  it("shows each of the nine pictures once, in the order of the journey, and screenshots/ holds those and no other file", () => {
    expect(imageTargets(readme).filter((path) => path.startsWith("screenshots/"))).toEqual(PICTURES);
    expect(readdirSync(join(folder, "screenshots")).sort()).toEqual(PICTURES.map((path) => path.slice("screenshots/".length)).sort());
  });

  it("gives every image a description of what it shows", () => {
    const ours = imageTargets(readme);
    const images = [...readme.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].filter(([, , path]) => ours.includes(path ?? ""));
    expect(images.map(([, , path]) => path)).toEqual(ours); // none is written in a form this test does not read
    for (const [, alt, path] of images) expect(alt?.trim().length, `the image ${path} has no description`).toBeGreaterThan(20);
  });

  it("makes each picture a small PNG, as the repository's READMEs keep them", () => {
    for (const path of PICTURES) {
      const file = join(folder, path);
      expect(readFileSync(file).subarray(0, 8).toString("hex"), path).toBe("89504e470d0a1a0a");
      expect(statSync(file).size, `${path} is at most 100 KiB`).toBeLessThanOrEqual(100 * 1024);
    }
  });
});
