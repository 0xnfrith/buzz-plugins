// Drives the GHOST Protocol plugin in the real Buzz web build (headless Chromium, fixture relay) with a stub behind `ctx.host.runCommand`
// (test/web/fixture.tsx): the page, the one screen it draws for each way `docker version` can end, its icon, and what the plugin asked the
// host for. The web build cannot run a command, so what `docker` itself prints is scripted here, and nothing in this file runs docker.
// Run with plugins/ghost-protocol/test/run.sh.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixture.mjs";
import { chooseColorMode, closeSettings, openPage, openSettings, pageChoices, selectSettingsSection } from "./navigation.mjs";

const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

test.use({ pluginFixtures: true });
// The first page of a run waits for the harness to warm its caches, and a shared runner is slow: give each test and each wait room.
test.describe.configure({ timeout: 120_000 });

const DOCKER_TEXT = "Docker didn't answer. Install or start Docker Desktop, then retry.";

/** The page, with `docker` scripted: `script` are the next spawns in order, `fallback` every one after. Opens the plugin's page. */
async function arrange(page, app, { script = [], fallback = { stdout: "27.3.1\n", code: 0 }, mode } = {}) {
  page.setDefaultTimeout(30_000);
  await page.addInitScript(
    ([scripted, other, hostMode]) => {
      window.__gp = { script: scripted, fallback: other, calls: [], kills: 0, release() {}, mode: hostMode };
    },
    [script, fallback, mode],
  );
  await page.goto(app.origin, { timeout: 90_000, waitUntil: "domcontentloaded" });
  await openPage(page, "GHOST Protocol");
}

const root = (page) => page.locator(".gp-root");
const gp = (page) => page.evaluate(() => ({ calls: window.__gp.calls, kills: window.__gp.kills }));

test("shows the Docker server's version when `docker version` exits 0 and prints it", async ({ page, app }) => {
  await page.setViewportSize({ width: 1300, height: 860 });
  await arrange(page, app);
  await expect(root(page).getByRole("heading", { name: "GHOST Protocol", level: 1 })).toBeVisible();
  await expect(root(page).getByRole("status")).toHaveText("Docker is running");
  await expect(root(page).getByText("Docker version", { exact: true })).toBeVisible();
  await expect(root(page).locator("dd")).toHaveText("27.3.1");
  await expect(root(page).getByText(DOCKER_TEXT)).toHaveCount(0);
  await shot(page, "01-version");
});

test("asks the host for the declared `version` command and nothing else: its id, nothing of its own, called on the host", async ({ page, app }) => {
  await arrange(page, app);
  await expect(root(page).locator("dd")).toHaveText("27.3.1");
  const { calls } = await gp(page);
  // One call, for the page's check of Docker, to the declared `version` command, whose every word is fixed in the manifest. It was given
  // no input. The status screen asks nothing until an agent is named.
  expect(calls).toEqual([
    { kind: "command", id: "version", options: [], args: [], argv: ["version", "--format", "{{.Server.Version}}"], onHost: true, declared: true },
  ]);
});

test("shows the failure text when `docker version` exits non-zero", async ({ page, app }) => {
  await page.setViewportSize({ width: 1300, height: 860 });
  await arrange(page, app, { fallback: { stderr: "Cannot connect to the Docker daemon\n", code: 1 } });
  await expect(root(page).getByRole("alert")).toHaveText(DOCKER_TEXT);
  await expect(root(page).locator("dd")).toHaveCount(0);
  await expect(root(page).getByText("Docker is running")).toHaveCount(0);
  await shot(page, "02-not-running");
});

test("shows the same failure text when there is no docker on the PATH (the host cannot run it)", async ({ page, app }) => {
  await arrange(page, app, { fallback: { reject: "program not found" } });
  await expect(root(page).getByRole("alert")).toHaveText(DOCKER_TEXT);
  await expect(root(page).locator("dd")).toHaveCount(0);
});

test("shows the same failure text when it exits 0 with nothing that is a version, or is killed by a signal", async ({ page, app }) => {
  await arrange(page, app, { script: [{ stdout: "", code: 0 }, { stdout: "27.3.1\n", code: null }] });
  await expect(root(page).getByRole("alert")).toHaveText(DOCKER_TEXT);
  await root(page).getByRole("button", { name: "Check again" }).click();
  await expect(root(page).getByRole("alert")).toHaveText(DOCKER_TEXT);
  await expect(root(page).locator("dd")).toHaveCount(0);
});

test("says so when this Buzz has no way to run a command", async ({ page, app }) => {
  await arrange(page, app, { mode: "no-spawn" });
  await expect(root(page).getByRole("alert")).toHaveText("This Buzz cannot start programs. Use the Buzz desktop app.");
  const { calls } = await gp(page);
  expect(calls).toEqual([]);
});

test("says it is checking while docker has not answered, and Check again waits for the answer", async ({ page, app }) => {
  await arrange(page, app, { script: [{ stdout: "27.3.1\n", code: 0, hold: true }] });
  await expect(root(page).getByRole("status")).toHaveText("Checking Docker…");
  await expect(root(page).getByRole("button", { name: "Check again" })).toBeDisabled();
  await page.evaluate(() => window.__gp.release());
  await expect(root(page).getByRole("status")).toHaveText("Docker is running");
  await expect(root(page).getByRole("button", { name: "Check again" })).toBeEnabled();
});

test("Check again asks again, and moves from the failure text to the version once Docker is up", async ({ page, app }) => {
  await arrange(page, app, { script: [{ stderr: "Cannot connect to the Docker daemon\n", code: 1 }], fallback: { stdout: "28.0.0-rc.1\r\n", code: 0 } });
  await expect(root(page).getByRole("alert")).toHaveText(DOCKER_TEXT);
  await root(page).getByRole("button", { name: "Check again" }).click();
  await expect(root(page).getByRole("status")).toHaveText("Docker is running");
  await expect(root(page).locator("dd")).toHaveText("28.0.0-rc.1");
  await expect(root(page).getByRole("alert")).toHaveCount(0);
  expect((await gp(page)).calls).toHaveLength(2);
});

test("leaving the page while docker has not answered shows nothing late", async ({ page, app }) => {
  await arrange(page, app, { script: [{ stdout: "27.3.1\n", code: 0, hold: true }] });
  await expect(root(page).getByRole("status")).toHaveText("Checking Docker…");
  await openPage(page, "Messages");
  await expect(root(page)).toHaveCount(0);
  // The command cannot be stopped; its answer, when it comes, goes nowhere.
  await page.evaluate(() => window.__gp.release());
  await page.waitForTimeout(300);
  await expect(root(page)).toHaveCount(0);
  expect((await gp(page)).calls).toHaveLength(1);
});

test("the page follows the light and the dark theme, with text that reads in both", async ({ page, app }) => {
  await page.setViewportSize({ width: 1300, height: 860 });
  await arrange(page, app);
  await expect(root(page).locator("dd")).toHaveText("27.3.1");
  // Contrast (WCAG): the status text against the panel it sits on, in each mode. Colours are read through a canvas, so any CSS colour
  // syntax Buzz's tokens use comes back as the rgb it draws.
  const contrast = () =>
    page.evaluate(() => {
      const rgb = (css) => {
        const canvas = document.createElement("canvas").getContext("2d");
        canvas.fillStyle = "#000";
        canvas.clearRect(0, 0, 1, 1);
        canvas.fillStyle = css;
        canvas.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
        return { r, g, b, a: a / 255 };
      };
      const light = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const lin = (value) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
      const ratio = (a, b) => (Math.max(light(a), light(b)) + 0.05) / (Math.min(light(a), light(b)) + 0.05);
      const text = getComputedStyle(document.querySelector(".gp-status"));
      const panel = getComputedStyle(document.querySelector(".gp-panel"));
      const muted = getComputedStyle(document.querySelector(".gp-note"));
      const ground = getComputedStyle(document.querySelector(".gp-root"));
      return {
        status: ratio(rgb(text.color), rgb(panel.backgroundColor)),
        note: ratio(rgb(muted.color), rgb(ground.backgroundColor)),
        opaque: rgb(panel.backgroundColor).a === 1 && rgb(ground.backgroundColor).a === 1,
        ground: ground.backgroundColor,
      };
    });
  const grounds = [];
  for (const mode of ["Light", "Dark"]) {
    await openSettings(page);
    await selectSettingsSection(page, "Appearance");
    await chooseColorMode(page, mode);
    await closeSettings(page);
    const seen = await contrast();
    expect(seen.opaque, `${mode}: the page's grounds are opaque`).toBe(true);
    expect(seen.status, `${mode}: status text contrast`).toBeGreaterThanOrEqual(4.5);
    expect(seen.note, `${mode}: note text contrast`).toBeGreaterThanOrEqual(4.5);
    grounds.push(seen.ground);
    await shot(page, `03-${mode.toLowerCase()}`);
  }
  expect(grounds[0]).not.toBe(grounds[1]);
});

for (const mode of ["Dark", "Light"]) {
  test(`${mode} mode: the page has its own icon, in navigation and in search, painted in the entry's own text colour`, async ({ page, app }) => {
    await page.setViewportSize({ width: 1300, height: 860 });
    await arrange(page, app);
    await expect(root(page).locator("dd")).toHaveText("27.3.1");
    await openSettings(page);
    await selectSettingsSection(page, "Appearance");
    await chooseColorMode(page, mode);
    await closeSettings(page);
    // The host draws the icon as an <img> of the data URL, which cannot follow the theme by itself: a mask rule does.
    const look = (img) =>
      img.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          mask: style.maskImage !== "none" ? style.maskImage : style.webkitMaskImage,
          paint: style.backgroundColor,
          ink: style.color,
          src: node.getAttribute("src"),
          box: node.getBoundingClientRect().width,
          mode: document.documentElement.getAttribute("data-color-mode"),
        };
      });
    // In search: the row for GHOST Protocol among the pages.
    const choices = await pageChoices(page, "GHOST");
    const found = choices.locator('img[src^="data:image/svg+xml,"]').first();
    await expect(found).toBeVisible();
    const inSearch = await look(found);
    expect(inSearch.mode).toBe(mode.toLowerCase());
    expect(inSearch.src).toContain("data:image/svg+xml,");
    expect(inSearch.mask).toContain(inSearch.src);
    expect(inSearch.paint).toBe(inSearch.ink);
    expect(inSearch.paint).not.toBe("rgba(0, 0, 0, 0)");
    expect(inSearch.box).toBeGreaterThan(8);
    await page.keyboard.press("Escape");
    // In navigation: the row in the Messages sidebar, the same image.
    const row = page.getByRole("navigation", { name: "Pages", exact: true }).getByRole("button", { name: "GHOST Protocol", exact: true });
    await expect(row).toBeVisible();
    const inNavigation = await look(row.locator("img").first());
    expect(inNavigation.src).toBe(inSearch.src);
    expect(inNavigation.paint).toBe(inNavigation.ink);
    expect(inNavigation.mask).toContain(inNavigation.src);
    // No other page's icon was painted: the rule matches this image only.
    const others = await page.getByRole("navigation", { name: "Pages", exact: true }).locator("img").evaluateAll((images, src) => images.filter((img) => img.getAttribute("src") !== src).map((img) => getComputedStyle(img).maskImage), inSearch.src);
    for (const mask of others) expect(mask).toBe("none");
    await shot(page, `04-icon-${mode.toLowerCase()}`);
  });
}

test("disabling the plugin removes its styles", async ({ page, app }) => {
  await arrange(page, app);
  await expect(root(page).locator("dd")).toHaveText("27.3.1");
  expect(await page.locator("style[data-ghost-protocol]").count()).toBe(1);
  await openSettings(page);
  await selectSettingsSection(page, "Manage plugins");
  const { setPluginEnabled } = await import("./plugin-settings.mjs");
  await setPluginEnabled(page, "GHOST Protocol", false);
  await expect(page.locator("style[data-ghost-protocol]")).toHaveCount(0);
});
