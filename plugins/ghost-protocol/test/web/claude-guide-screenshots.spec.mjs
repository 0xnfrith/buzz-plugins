// Makes the three pictures of the Claude guide in the README (../../README.md), from Buzz's own production web build, headless Chromium, in
// the light theme, as test/web/screenshots.spec.mjs makes the others (which names the folder, the rules for a picture and how to make them
// again: plugins/ghost-protocol/test/screenshots.sh). The Agents page needs this spec's own test options, which is why it is a file of its own.
//
// An agent called Maple is made through the create form against the fake `docker` (test/fake-docker), with its Claude sign-in left for later,
// and its GHOST Protocol tab opened:
//   claude-guide-not-active    the Claude section as it opens: Claude: not active, the guide, down to the step that makes the token.
//   claude-guide-token-refused the paste step, after the fake refused a token: GHOST Protocol's own code and line, and the field empty.
//   claude-guide-active        the whole tab after the fake took a token: the status screen saying Running, and Claude: active.
// All of it is the harness's fixture data and the fake's: the agent, the relay and the version are made up, and the token is a made-up string
// that is not in any picture (the field is empty after use). The words of GHOST Protocol's own line in the second are the fake's.
import { mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { animationsSettled } from "./animations.mjs";
import { test, expect } from "./fixture.mjs";
import { TOKEN, arrange, cleanupFakes, create, fill, openForm } from "./ghost-protocol-agents-page.mjs";

// Where the pictures go: the folder the README points at (screenshots.sh), or a scratch folder (every other run).
const OUT = process.env.GHOST_PROTOCOL_SHOTS ?? mkdtempSync(join(tmpdir(), "gp-guide-shots-"));
mkdirSync(OUT, { recursive: true });
// The repository's rule for a README's PNG (.github/plugin-assets/check.mjs), and the sides a picture of this tab stays within.
const MAX_BYTES = 100 * 1024;
const MAX_SIDE = 1000;

test.use({ pluginFixtures: true, productionBroker: true, localAgentActivity: true });
test.describe.configure({ timeout: 240_000 });
test.afterEach(cleanupFakes);

/** A clip of whole pixels: the box's top left corner, its width, and down to `bottom` (as in screenshots.spec.mjs: Playwright rounds a clip
 *  with a fractional edge, and the picture would differ from one run to the next). */
function crop(box, bottom) {
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  return { x, y, width: Math.ceil(box.x + box.width) - x, height: Math.ceil(bottom) - y };
}

/** Takes the picture, and checks it is a PNG of a sane size. */
async function shot(target, name, options = {}) {
  const path = join(OUT, `${name}.png`);
  await target.screenshot({ path, animations: "disabled", ...options });
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString("hex"), `${name} is a PNG`).toBe("89504e470d0a1a0a");
  expect(statSync(path).size, `${name} is a small PNG`).toBeLessThanOrEqual(MAX_BYTES);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(width, `${name}: width`).toBeGreaterThan(100);
  expect(width, `${name}: width`).toBeLessThanOrEqual(MAX_SIDE);
  expect(height, `${name}: height`).toBeGreaterThan(40);
  expect(height, `${name}: height`).toBeLessThanOrEqual(MAX_SIDE);
}

test("the Claude guide: not active, a token that is refused, and active", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: "token-rejected" });
  // The light theme, which is what the other pictures are in.
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
  const dialog = await openForm(page);
  await fill(dialog, { way: "login" });
  await create(page, dialog);
  await expect(page.getByText("On this computer")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "GHOST Protocol" }).click();
  const tab = page.locator('[data-gp="agent-tab"]');
  const claude = page.locator('[data-gp="claude"]');
  const tokenWay = claude.locator('[data-gp="guide-token"]');
  await expect(claude.locator('[data-gp="claude-state"]')).toHaveText("Claude: not active");
  // A window tall enough for the whole tab, so that no picture needs a scroll; the mouse is away, so that no button is under it.
  await page.setViewportSize({ width: 1300, height: 2200 });
  await page.mouse.move(0, 0);
  await animationsSettled(tab, { subtree: true });

  // Not active, with the guide: from the top of the section down to the end of the step that makes the token.
  const section = await claude.boundingBox();
  const made = await tokenWay.locator("li").nth(1).boundingBox();
  await shot(page, "claude-guide-not-active", { clip: crop(section, made.y + made.height + 8) });

  // A token that is refused: from the step that takes the token down to GHOST Protocol's own line under it.
  await tokenWay.getByLabel("Claude setup token").fill(TOKEN);
  await tokenWay.getByRole("button", { name: "Send token" }).click();
  const refusal = tokenWay.locator('[data-gp="claude-problem"]');
  await expect(refusal).toContainText("GHOST Protocol said: The Claude token was not accepted. (claude-token-invalid)");
  await expect(tokenWay.getByLabel("Claude setup token")).toHaveValue("");
  await page.mouse.move(0, 0);
  await animationsSettled(tab, { subtree: true });
  // The refusal sits under the list, so the picture is as wide as the whole of option 1, and starts at the paste step's line.
  const way = await tokenWay.boundingBox();
  const paste = await tokenWay.locator("li").nth(2).boundingBox();
  const said = await refusal.boundingBox();
  await shot(page, "claude-guide-token-refused", { clip: crop({ x: way.x, y: paste.y, width: way.width }, said.y + said.height + 8) });

  // Active: a token the fake takes. The whole tab, with the status screen above it following to Running.
  fake.use("ok");
  await tokenWay.getByLabel("Claude setup token").fill(TOKEN);
  await tokenWay.getByRole("button", { name: "Send token" }).click();
  await expect(claude.locator('[data-gp="claude-state"]')).toHaveText("Claude: active", { timeout: 30_000 });
  await expect(page.locator(".gp-agent .gp-status")).toHaveText("Running", { timeout: 60_000 });
  await expect(claude.locator('[data-gp="guide"]')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await animationsSettled(tab, { subtree: true });
  await shot(tab, "claude-guide-active");
});
