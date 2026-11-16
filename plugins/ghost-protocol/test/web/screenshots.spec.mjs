// Makes the pictures in the plugin's README (../../README.md) from Buzz's own production web build, headless Chromium, in the light theme,
// and checks them: each is a PNG of a sane size, and the set is the one committed in screenshots/. The harness's own fixture
// community is all the data there is: no key, relay or person of anyone's. Make them again, into that folder, with
// plugins/ghost-protocol/test/screenshots.sh whenever Buzz's screens change; test/run.sh runs this spec into a scratch folder, so a screen
// that moved, or a text that changed, fails the suite and does not leave a stale picture to be found later.
//
// How each picture is made:
//   choose-a-plugin, review-access   Buzz's real Settings -> Manage plugins -> Add dialogs. The web build has no importer (it is desktop only,
//                                    and shows no Add button), so the page says it is the desktop app and the native importer's answer is
//                                    scripted, the way Buzz's own plugin-import spec does it. What the dialogs are given is the repository's
//                                    own plugin folders: each manifest.json, as the importer lists it, one row to a plugin. The review is
//                                    drawn by Buzz's own component from this plugin's real manifest.json; nothing of it is written here.
//   find-by-search, find-in-sidebar  the plugin's built plugin.js, registered by test/web/fixture.tsx, opened from Cmd+K Search and from
//                                    the Messages sidebar.
//   docker-is-running, docker-did-not-answer
//                                    the plugin's page with what `docker version` prints scripted (the web build cannot run a program).
// The install steps before the list (Manage plugins, Add, the address) are pictures of the desktop app that the other plugins' READMEs use
// too: assets/install/. Not made here.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { animationsSettled } from "./animations.mjs";
import { test, expect } from "./fixture.mjs";
import { openPage, openSettings, pageChoices, selectSettingsSection } from "./navigation.mjs";

const PLUGIN_DIR = process.env.GHOST_PROTOCOL_DIR;
const REPOSITORY = "https://github.com/0xnfrith/buzz-plugins";
// The commit the importer reads, which its dialog shows. Not a real one: an example that is plainly one.
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
// Where the pictures go: the folder the README points at (screenshots.sh), or a scratch folder (every other run).
const OUT = process.env.GHOST_PROTOCOL_SHOTS ?? mkdtempSync(join(tmpdir(), "gp-shots-"));
mkdirSync(OUT, { recursive: true });
const COMMITTED = PLUGIN_DIR && join(PLUGIN_DIR, "screenshots");
// The repository's rule for a README's PNG (.github/plugin-assets/check.mjs), and the sides a picture of one dialog stays within.
const MAX_BYTES = 100 * 1024;
const MAX_SIDE = 1000;

const made = [];
test.use({ pluginFixtures: true });
test.describe.configure({ mode: "serial", timeout: 120_000 });

/** The PNG at `path` is a picture of a sane size: a PNG, small, and a few hundred pixels a side. Returns its sides. */
function sizeOf(path) {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString("hex"), `${path} is a PNG`).toBe("89504e470d0a1a0a");
  expect(statSync(path).size, `${path} is a small PNG`).toBeLessThanOrEqual(MAX_BYTES);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function shot(target, name, options = {}) {
  const path = join(OUT, `${name}.png`);
  await target.screenshot({ path, animations: "disabled", ...options });
  made.push(`${name}.png`);
  const { width, height } = sizeOf(path);
  expect(width, `${name}: width`).toBeGreaterThan(100);
  expect(width, `${name}: width`).toBeLessThanOrEqual(MAX_SIDE);
  expect(height, `${name}: height`).toBeGreaterThan(40);
  expect(height, `${name}: height`).toBeLessThanOrEqual(MAX_SIDE);
}

/** Hides what is around a dialog, so that the picture of it has clear corners, and not a corner of the page behind it. Hides nothing of the
 *  dialog itself; the picture is then taken with `omitBackground`. */
async function alone(dialog) {
  await dialog.evaluate((node) => {
    for (let element = node; element.parentElement; element = element.parentElement) {
      for (const other of element.parentElement.children) if (other !== element) other.style.visibility = "hidden";
      if (element !== node) element.style.background = "transparent";
    }
    document.documentElement.style.background = "transparent";
  });
}

/** The light theme, which is what Buzz's own screenshots in assets/install/ are in. */
async function light(page) {
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
}

// ---- the installer: Settings -> Manage plugins -> Add -> Find plugins -> Choose a plugin -> Review plugin access ---------------------------

/** What the importer lists for the repository: every plugin folder with a manifest.json and a plugin.js, as Buzz's importer finds them. */
function candidates() {
  const root = join(PLUGIN_DIR, "../..");
  return readdirSync(join(root, "plugins"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((name) => {
      try {
        const manifest = JSON.parse(readFileSync(join(root, "plugins", name, "manifest.json"), "utf8"));
        const code = readFileSync(join(root, "plugins", name, "plugin.js"));
        return [{ path: `plugins/${name}`, manifest, revision: createHash("sha256").update(code).digest("hex") }];
      } catch {
        return []; // no built plugin.js beside manifest.json: the importer skips the folder
      }
    });
}

/** The native importer's end of the desktop app, as Buzz's own plugin-import spec scripts it: the page says it is the desktop app, and
 *  `invoke` answers the few commands the Settings page and the importer use. Anything else fails loudly, so a new command is noticed. */
async function nativeImporter(page, preview) {
  await page.addInitScript((given) => {
    window.isTauri = true;
    const plugins = ["channels", "agents", "profiles"].map((name) => ({
      manifest: { id: `buzz.${name}`, name, apiVersion: 1 },
      source: "bundled",
      enabled: true,
      revision: "bundled",
      previous: null,
      reloadable: false,
      error: null,
    }));
    const catalog = () => ({
      status: "ready",
      externalPluginsPaused: false,
      catalog: { profile: "screenshots", location: "scripted", plugins: structuredClone(plugins) },
    });
    let nextCallback = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback() {
        return ++nextCallback;
      },
      unregisterCallback() {},
      invoke: async (command, args) => {
        if (command === "deep_link_take") return [];
        if (command === "deep_link_watch") return;
        if (command === "plugin_catalog") return catalog();
        if (command === "plugin_import_git") return { ...structuredClone(given), token: "preview-1" };
        if (command === "plugin_import_discard") return;
        if (command === "app_agent_state_load") return {};
        if (command === "app_agent_state_set") return;
        if (command === "credential_pairing_communities") return;
        if (command === "plugin_host_mcp_pairing") return null;
        throw new Error(`Unexpected command ${command} ${JSON.stringify(args)}`);
      },
    };
  }, preview);
}

test.describe("the installer", () => {
  /** Opens Settings -> Manage plugins -> Add, types the repository, presses Find, and picks this plugin: the Choose a plugin dialog, in a
   *  window `height` high. Each picture has its own page and its own window, because a dialog that is resized between its steps has not
   *  settled when it is taken. */
  async function choosing(page, app, height) {
    expect(PLUGIN_DIR, "GHOST_PROTOCOL_DIR names this plugin's folder (test/run.sh sets it)").toBeTruthy();
    const list = candidates();
    expect(list.map((one) => one.manifest.name)).toContain("GHOST Protocol");
    await nativeImporter(page, { source: REPOSITORY, commit: COMMIT, warnings: [], candidates: list });
    // The harness registers the plugin whatever the page says it is; the installer's pictures do not use it.
    await page.addInitScript(() => {
      window.__gp = { script: [], fallback: { stdout: "27.3.1\n", code: 0 }, calls: [], kills: 0, release() {} };
    });
    await page.setViewportSize({ width: 1000, height });
    await page.goto(app.origin);
    await light(page);
    await openSettings(page);
    await selectSettingsSection(page, "Manage plugins");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("Git or GitHub repository").fill(REPOSITORY);
    await page.getByRole("button", { name: "Find plugins", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Choose a plugin" });
    await expect(dialog).toBeVisible();
    const ours = page.getByRole("radio", { name: /GHOST Protocol/ });
    await ours.check();
    await expect(ours).toBeChecked();
    await animationsSettled(dialog);
    return { dialog, ours };
  }

  test("choose a plugin: the repository's own plugin folders, down to this one", async ({ page, app }) => {
    // Tall enough for the list not to scroll under the dialog's title, so that the picture needs no scrolling to make.
    const { dialog, ours } = await choosing(page, app, 1150);
    // The picture is the top of the dialog down to this plugin's row: the plugins after it add size and nothing the step needs.
    await alone(dialog);
    const box = await dialog.boundingBox();
    // The row is the radio's nearest ancestor that spans the dialog's list (the radio itself is a small circle).
    const bottom = await ours.evaluate((node) => {
      let row = node;
      while (row.parentElement && row.getBoundingClientRect().width < 400) row = row.parentElement;
      return row.getBoundingClientRect().bottom;
    });
    await shot(page, "choose-a-plugin", {
      omitBackground: true,
      clip: { x: box.x, y: box.y, width: box.width, height: bottom + 8 - box.y },
    });
  });

  test("review plugin access: drawn by Buzz from this plugin's own manifest.json", async ({ page, app }) => {
    // A window of an ordinary height: the review is a list that scrolls, and the picture is its top, the way it opens.
    await choosing(page, app, 760);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const review = page.getByRole("dialog", { name: /^Review GHOST Protocol/ });
    await expect(review.getByRole("button", { name: "Install plugin", exact: true })).toBeVisible();
    // The entries the README says the review must show, and no other: Buzz draws one row for each command and each process of the
    // manifest, "Run docker" and "Start docker" while every program is docker, beside the Computer access row every plugin gets.
    const { host } = JSON.parse(readFileSync(join(PLUGIN_DIR, "manifest.json"), "utf8"));
    expect([...host.commands, ...host.processes].map((entry) => entry.program)).toEqual(Array(host.commands.length + host.processes.length).fill("docker"));
    await expect(review.getByRole("button", { name: /^Run docker/ })).toHaveCount(host.commands.length);
    await expect(review.getByRole("button", { name: /^Start docker/ })).toHaveCount(host.processes.length);
    await expect(review.getByRole("button", { name: /^Computer access/ })).toHaveCount(1);
    // Each row is a level 3 heading holding its button: these and no other.
    await expect(review.getByRole("heading", { level: 3 })).toHaveCount(1 + host.commands.length + host.processes.length);
    await animationsSettled(review);
    await expect(review.getByRole("button", { name: /^Run docker/ }).first()).toBeInViewport({ ratio: 1 });
    await alone(review);
    await shot(review, "review-access", { omitBackground: true });
  });
});

// ---- the page: found in search and in the sidebar, and its Docker panel ---------------------------------------------------------------

test.describe("the page", () => {
  /** The page, with `docker` scripted: `fallback` is what every call to it does. Opens the plugin's page. */
  async function arrange(page, app, fallback) {
    page.setDefaultTimeout(30_000);
    await page.setViewportSize({ width: 1300, height: 860 });
    await page.addInitScript((other) => {
      window.__gp = { script: [], fallback: other, calls: [], kills: 0, release() {} };
    }, fallback);
    await page.goto(app.origin, { timeout: 90_000, waitUntil: "domcontentloaded" });
    await light(page);
    await openPage(page, "GHOST Protocol");
  }
  const root = (page) => page.locator(".gp-root");
  const dockerPanel = (page) => root(page).locator(".gp-panel").first();

  test("Cmd+K Search finds it under Pages, and so does the Messages sidebar", async ({ page, app }) => {
    await arrange(page, app, { stdout: "27.3.1\n", code: 0 });
    await openPage(page, "Messages");
    // The sidebar: the pages are listed below Activity.
    const sidebar = page.locator('aside[aria-label="Sidebar"]');
    await expect(sidebar.getByRole("button", { name: "GHOST Protocol", exact: true })).toBeVisible();
    const box = await sidebar.boundingBox();
    const bottom = (await sidebar.getByRole("button", { name: "GHOST Protocol", exact: true }).boundingBox()).y + 60;
    await shot(page, "find-in-sidebar", { clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, bottom - box.y) } });
    // The search: GHOST typed, its row under Pages.
    const choices = await pageChoices(page, "GHOST");
    await expect(choices.getByText("GHOST Protocol", { exact: true })).toBeVisible();
    // Only as far down as the Pages: the rows below them are the harness's own plugins, which the search lists whatever is typed.
    const search = page.getByRole("dialog", { name: "Search Buzz", exact: true });
    await alone(search);
    const dialog = await search.boundingBox();
    const pages = await choices.boundingBox();
    await shot(page, "find-by-search", {
      omitBackground: true,
      clip: { x: dialog.x, y: dialog.y, width: dialog.width, height: pages.y + pages.height + 12 - dialog.y },
    });
  });

  test("the Docker panel says Docker is running", async ({ page, app }) => {
    await arrange(page, app, { stdout: "27.3.1\n", code: 0 });
    await expect(root(page).getByRole("status")).toHaveText("Docker is running");
    await expect(root(page).locator("dd")).toHaveText("27.3.1");
    await shot(dockerPanel(page), "docker-is-running");
  });

  test("the Docker panel says Docker didn't answer", async ({ page, app }) => {
    await arrange(page, app, { stderr: "Cannot connect to the Docker daemon\n", code: 1 });
    await expect(root(page).getByRole("alert")).toHaveText("Docker didn't answer. Install or start Docker Desktop, then retry.");
    await shot(dockerPanel(page), "docker-did-not-answer");
  });
});

// ---- the set ----------------------------------------------------------------------------------------------------------------------------

test("the pictures made are the ones committed in screenshots/", async () => {
  expect(made.sort()).toEqual(
    ["choose-a-plugin.png", "docker-did-not-answer.png", "docker-is-running.png", "find-by-search.png", "find-in-sidebar.png", "review-access.png"],
  );
  if (COMMITTED) {
    // Each committed picture is a PNG of the same sane size, and nothing is committed that this spec does not make. (Not the same pixels:
    // fonts and anti-aliasing differ from one machine to the next.)
    expect(readdirSync(COMMITTED).sort(), "screenshots/ holds exactly the pictures this spec makes").toEqual(made);
    for (const name of made) sizeOf(join(COMMITTED, name));
  }
});
