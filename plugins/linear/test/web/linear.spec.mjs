// Drives the Linear plugin in the real Buzz web build (headless Chromium, fixture relay) with
// a fake Linear behind `ctx.host.request`. Run with plugins/linear/test/run.sh.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test, expect } from "./fixture.mjs";
import { chooseColorMode, closeSettings, openPage, openSettings, pageChoices, selectSettingsSection } from "./navigation.mjs";
import { setPluginEnabled } from "./plugin-settings.mjs";

const dir = process.env.LINEAR_PLUGIN_DIR;
const { createFakeLinear } = await import(pathToFileURL(join(dir, "test/fake-linear/server.mjs")).href);
const { runCommand } = await import(pathToFileURL(join(dir, "test/host-sim.mjs")).href);
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

test.use({ pluginFixtures: true });

const KEY_NAME = "megatech.linear.api-key.v1";

/**
 * A page wired to a fresh fake Linear (changed first by `prepare`), with the key already saved in the profile unless `key` is
 * null (or, with `inKeychain`, saved in the stand-in store instead). The page is made to look like a Mac (`mac`: the Keychain is
 * used), like Linux (`linux`: the Secret Service is) or, by default, like Windows, where there is no store and the key is plain text.
 * The stand-ins for `security` and `secret-tool` keep their stores in files and log every call they get; `keychainMode` and
 * `secretMode` make them misbehave (see test/fake-security and test/fake-secret-tool) and can be changed while the page runs.
 */
async function arrange(page, app, { key = "good", prepare, mac = false, linux = false, inKeychain, keychainMode = "", keychainDelay, secretMode = "", holdKeychain = false } = {}) {
  // Both of the fixture's keys are accepted, so that a replacement can be told from the key it replaces.
  const fake = createFakeLinear({ keys: Object.values(createFakeLinear().keys) });
  prepare?.(fake);
  const dir = mkdtempSync(join(tmpdir(), "linear-web-keychain-"));
  const env = {
    LINEAR_FAKE_KEYCHAIN: join(dir, "keychain.json"),
    LINEAR_FAKE_KEYCHAIN_LOG: join(dir, "log.jsonl"),
    LINEAR_FAKE_KEYCHAIN_MODE: keychainMode,
    LINEAR_FAKE_SECRET: join(dir, "secret.json"),
    LINEAR_FAKE_SECRET_LOG: join(dir, "secret-log.jsonl"),
    LINEAR_FAKE_SECRET_MODE: secretMode,
  };
  if (keychainDelay) env.LINEAR_FAKE_KEYCHAIN_DELAY = String(keychainDelay);
  const logged = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  const stored = (file) => (existsSync(file) ? Object.values(JSON.parse(readFileSync(file, "utf8"))) : []);
  const keychain = {
    env,
    calls: () => logged(env.LINEAR_FAKE_KEYCHAIN_LOG),
    kept: () => stored(env.LINEAR_FAKE_KEYCHAIN),
    /** What the person does in Terminal, with nothing refusing. */
    byHand: (value) => runCommand("keychain-save", `${value}\n${value}\n`, { env: { ...env, LINEAR_FAKE_KEYCHAIN_MODE: "" } }),
    mode: (mode) => void (env.LINEAR_FAKE_KEYCHAIN_MODE = mode),
    adds: () => keychain.calls().filter((call) => call[0] === "add-generic-password").length,
  };
  const secret = {
    calls: () => logged(env.LINEAR_FAKE_SECRET_LOG),
    kept: () => stored(env.LINEAR_FAKE_SECRET),
    direct: (value) => runCommand("secret-save", value, { env: { ...env, LINEAR_FAKE_SECRET_MODE: "" } }),
    mode: (mode) => void (env.LINEAR_FAKE_SECRET_MODE = mode),
    stores: () => secret.calls().filter((call) => call[0] === "store").length,
  };
  if (inKeychain && mac) await keychain.byHand(fake.keys[inKeychain]);
  if (inKeychain && linux) await secret.direct(fake.keys[inKeychain]);
  await page.exposeFunction("__linearRequest", (request) => fake.handle(request));
  // With `holdKeychain` no command runs until the test calls `keychain.release()`: the plugin's first look at the store is late.
  let release;
  const gate = holdKeychain ? new Promise((resolve) => (release = resolve)) : undefined;
  keychain.release = () => release?.();
  await page.exposeFunction("__linearRun", async (command, input) => {
    await gate;
    return runCommand(command, input, { env });
  });
  // What the plugin is told it runs on: a Mac, Linux (what the browser here says anyway), or Windows, where it has no store.
  await page.addInitScript((os) => {
    if (os === "mac") Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    if (os === "other") {
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
      Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" });
    }
  }, mac ? "mac" : linux ? "linux" : "other");
  if (key && !inKeychain) {
    const value = fake.keys[key];
    // Once per tab: a reload is a new session of the plugin, and what the plugin did with the key in the first one stays done.
    await page.addInitScript(
      ([name, v]) => {
        if (sessionStorage.getItem("__linear-seeded")) return;
        sessionStorage.setItem("__linear-seeded", "1");
        localStorage.setItem(name, v);
      },
      [KEY_NAME, value],
    );
  }
  await page.goto(app.origin);
  fake.keychain = keychain;
  fake.secret = secret;
  return fake;
}

const board = (page) => page.getByRole("list", { name: "Board" });
const column = (page, name) => board(page).getByRole("listitem", { name: new RegExp(`^${name}, `) });
const card = (page, identifier) => page.locator(`[data-identifier="${identifier}"]`);

async function openBoard(page, app, options) {
  const fake = await arrange(page, app, options);
  await openPage(page, "Linear");
  return fake;
}

test("the board shows the team's columns in Linear's order", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openBoard(page, app);
  await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();
  await shot(page, "01-first-load");
  await expect(page.getByLabel("Team")).toHaveValue("team-dsn");
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-120")).toBeVisible();
  const names = await board(page).getByRole("heading", { level: 2 }).allTextContents();
  expect(names).toEqual(["Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled", "Duplicate"]);
  await shot(page, "02-platform-board");
});

async function dragCard(page, identifier, columnName, { steps = 12, release = true } = {}) {
  const source = await card(page, identifier).boundingBox();
  const target = await column(page, columnName).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + 24);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + 40, { steps: 3 });
  await page.mouse.move(target.x + target.width / 2, target.y + 180, { steps });
  if (release) await page.mouse.up();
}

const stateOf = (fake, identifier) =>
  fake.control.world.records.find((r) => r.identifier === identifier).stateId.split(":")[1];

test("dragging a card to another column changes its state in Linear", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(column(page, "Todo")).toContainText("PLT-110");
  await dragCard(page, "PLT-110", "In Progress", { release: false });
  await expect(column(page, "In Progress")).toHaveAttribute("data-over", "");
  await expect(page.locator(".mtl-lift")).toBeVisible();
  await shot(page, "03-dragging");
  await page.mouse.up();
  await expect(column(page, "In Progress")).toContainText("PLT-110");
  await expect(column(page, "Todo")).not.toContainText("PLT-110");
  await expect(column(page, "Todo")).toHaveAccessibleName("Todo, 2 issues");
  await expect(column(page, "In Progress")).toHaveAccessibleName("In Progress, 6 issues");
  await expect.poll(() => stateOf(fake, "PLT-110")).toBe("doing");
  // The drop did not open the card.
  await expect(page.getByRole("dialog", { name: /PLT-110/ })).toHaveCount(0);
  await expect(card(page, "PLT-110")).toHaveAttribute("data-settled", "true");
  await shot(page, "04-after-drop");
});

test("Escape during a drag puts the card back and sends nothing", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-110")).toBeVisible();
  await dragCard(page, "PLT-110", "In Progress", { release: false });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".mtl-lift")).toHaveCount(0);
  await expect(column(page, "Todo")).toContainText("PLT-110");
  expect(fake.control.log.operations.MoveIssue ?? 0).toBe(0);
});

test("a move Linear refuses is undone, with a message", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-110")).toBeVisible();
  fake.control.fail("reject", { operation: "MoveIssue" });
  await dragCard(page, "PLT-110", "In Progress");
  await expect(page.getByRole("alert")).toContainText("PLT-110 was not moved to In Progress");
  await expect(column(page, "Todo")).toContainText("PLT-110");
  await expect(column(page, "In Progress")).not.toContainText("PLT-110");
  expect(stateOf(fake, "PLT-110")).toBe("todo");
  await shot(page, "05-move-refused");
});

test("Duplicate ends the board; a card dropped there or picked from the status menu is not sent, because Linear needs a duplicate relation", async ({ page, app }) => {
  await page.setViewportSize({ width: 2600, height: 900 }); // wide enough that all seven columns are on screen to drop on
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-110")).toBeVisible();
  await expect(column(page, "Duplicate")).toContainText("PLT-152");
  // Its header carries the same cross as Canceled's, not the generic glyph of a state type the board does not know.
  const glyph = (name) => column(page, name).locator("svg.mtl-status").first().locator("path").first().getAttribute("d");
  expect(await glyph("Duplicate")).toBe(await glyph("Canceled"));
  expect(await glyph("Duplicate")).toContain("l4.4 4.4");
  await dragCard(page, "PLT-110", "Duplicate");
  await expect(page.getByRole("alert")).toContainText("PLT-110 was not moved to Duplicate: Linear only does that when the issue is marked a duplicate of another");
  await expect(column(page, "Todo")).toContainText("PLT-110");
  await expect(column(page, "Duplicate")).not.toContainText("PLT-110");
  expect(stateOf(fake, "PLT-110")).toBe("todo");
  expect(fake.control.log.operations.MoveIssue ?? 0).toBe(0);
  await card(page, "PLT-110").click();
  const details = page.getByRole("dialog", { name: /^PLT-110 / });
  await expect(details.getByLabel("Status").locator("option", { hasText: "Duplicate" })).toBeDisabled();
  await expect(details.getByLabel("Status").locator("option", { hasText: "Done" })).toBeEnabled();
});

test("a click opens the details; its status menu moves the card; Escape closes and returns focus", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  const opener = card(page, "PLT-130");
  await opener.click();
  const details = page.getByRole("dialog", { name: "PLT-130 Keyboard-first review queue" });
  await expect(details).toBeVisible();
  await expect(details).toBeFocused();
  await expect(details.getByText("See https://example.com/notes/130")).toBeVisible();
  await expect(details.getByRole("link", { name: "https://example.com/notes/130" })).toHaveAttribute("href", "https://example.com/notes/130");
  await expect(details.getByRole("link", { name: /Open in Linear/ })).toHaveAttribute("href", "https://linear.app/fixture/issue/PLT-130");
  await expect(details.getByRole("link", { name: /Open in Linear/ })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(details.getByRole("region", { name: "Sub-issues" })).toContainText("Sub-task 1");
  await shot(page, "06-details");
  await details.getByLabel("Status").selectOption({ label: "In Review" });
  await expect.poll(() => stateOf(fake, "PLT-130")).toBe("review");
  await expect(column(page, "In Review")).toContainText("PLT-130");
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(card(page, "PLT-130")).toBeFocused();
});

test("cards work from the keyboard", async ({ page, app }) => {
  await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  const first = card(page, "PLT-110");
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /PLT-110/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(first).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog", { name: /PLT-110/ })).toBeVisible();
});

test("without a key the page says how to connect, and the key goes in the settings card", async ({ page, app }) => {
  const logs = [];
  page.on("console", (message) => logs.push(message.text()));
  page.on("pageerror", (error) => logs.push(String(error)));
  const fake = await openBoard(page, app, { key: null });
  await expect(page.getByRole("heading", { name: "Connect Linear" })).toBeVisible();
  await shot(page, "07-connect");
  expect(fake.control.log.requests).toHaveLength(0);
  await page.getByRole("button", { name: "Open Linear settings" }).click();
  await expect(page.getByRole("region", { name: "Linear", exact: true })).toBeVisible();
  const input = page.getByLabel("Personal API key");
  await input.fill(fake.keys.good);
  await expect(input).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Connected as Avery Quill in Fixture Studio." })).toBeVisible();
  await expect(page.getByText("Key saved.")).toBeVisible();
  // Once saved the key is nowhere on the page, in text or in a field.
  await expect(page.getByLabel("Personal API key")).toHaveCount(0);
  expect(await page.evaluate((key) => document.documentElement.outerHTML.includes(key) || [...document.querySelectorAll("input")].some((i) => i.value.includes(key)), fake.keys.good)).toBe(false);
  await shot(page, "08-settings-saved");
  await closeSettings(page);
  await openPage(page, "Linear");
  await expect(card(page, "DSN-10")).toBeVisible();
  expect(logs.filter((line) => line.includes(fake.keys.good))).toEqual([]);
});

test("a key Linear refuses is not kept", async ({ page, app }) => {
  await openBoard(page, app, { key: null });
  await page.getByRole("button", { name: "Open Linear settings" }).click();
  await page.getByLabel("Personal API key").fill("test-key-unknown");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert")).toContainText("Linear did not accept the API key.");
  await expect(page.getByLabel("Personal API key")).toBeVisible();
  expect(await page.evaluate((name) => localStorage.getItem(name), KEY_NAME)).toBeNull();
});

test("a key that is revoked later blocks the board and sends the user to settings", async ({ page, app }) => {
  const fake = await openBoard(page, app);
  await expect(card(page, "DSN-10")).toBeVisible();
  fake.control.revoke(fake.keys.good);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("heading", { name: "Linear did not accept your key" })).toBeVisible();
});

test("the key is never logged and Linear is reached only through the host", async ({ page, app }) => {
  const logs = [];
  const requests = [];
  page.on("console", (message) => logs.push(message.text()));
  page.on("pageerror", (error) => logs.push(String(error)));
  page.on("request", (request) => requests.push(request.url()));
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  fake.control.fail("reject", { operation: "MoveIssue" });
  await dragCard(page, "PLT-110", "In Progress");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).click();
  expect(logs.filter((line) => line.includes(fake.keys.good))).toEqual([]);
  expect(requests.filter((url) => /linear\.app/.test(url))).toEqual([]);
});

test("a project or a saved view narrows the board", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-102")).toBeVisible();
  await page.getByLabel("Filter").selectOption({ label: "Launch readiness" });
  await expect(card(page, "PLT-120")).toBeVisible();
  await expect(card(page, "PLT-102")).toHaveCount(0);
  await page.getByLabel("Filter").selectOption({ label: "Open bugs" });
  await expect(card(page, "PLT-122")).toBeVisible();
  await expect(card(page, "PLT-120")).toHaveCount(0);
  await shot(page, "09-view-open-bugs");
  await page.getByLabel("Filter").selectOption({ label: "All issues" });
  await expect(card(page, "PLT-120")).toBeVisible();
});

test("the choice of team and filter is remembered", async ({ page, app }) => {
  await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await page.getByLabel("Filter").selectOption({ label: "Stability" });
  await expect(card(page, "PLT-112")).toBeVisible();
  await page.reload();
  await openPage(page, "Linear");
  await expect(page.getByLabel("Team")).toHaveValue("team-plt");
  await expect(page.getByLabel("Filter")).toHaveValue("project:proj-stability");
});

test("a long column loads a page at a time", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  const done = column(page, "Done");
  await expect(done).toHaveAccessibleName("Done, 50+ issues");
  const more = done.getByRole("button", { name: "Show more" });
  await more.scrollIntoViewIfNeeded();
  await more.click();
  await expect(done).toHaveAccessibleName("Done, 60 issues");
  await expect(more).toHaveCount(0);
  expect(fake.control.log.operations.ColumnIssues).toBeGreaterThan(6);
});

test("a change made in Linear shows up by itself, and a quiet minute costs one small request", async ({ page, app }) => {
  await page.clock.install();
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-110")).toBeVisible();
  const before = fake.control.log.requests.length;
  await page.clock.fastForward(61_000);
  await expect.poll(() => fake.control.log.requests.length).toBe(before + 1);
  expect(fake.control.log.requests.at(-1).operation).toBe("ChangedSince");
  fake.control.touch("PLT-110", { stateSlug: "done", title: "Changed from Linear's own app" });
  await page.clock.fastForward(61_000);
  await expect(column(page, "Done")).toContainText("Changed from Linear's own app");
  await expect(column(page, "Todo")).not.toContainText("PLT-110");
});

test("a rate limit keeps the board and says when it will look again", async ({ page, app }) => {
  await page.clock.install();
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-110")).toBeVisible();
  fake.control.fail("rate-limit");
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("status").filter({ hasText: "rate limiting this key" })).toBeVisible();
  await expect(card(page, "PLT-110")).toBeVisible();
  await shot(page, "10-rate-limited");
});

test("losing the connection keeps the board and offers to try again", async ({ page, app }) => {
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-110")).toBeVisible();
  fake.control.fail("network");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Could not reach Linear. Showing the last board." })).toBeVisible();
  await expect(card(page, "PLT-110")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Showing the last board.")).toHaveCount(0);
});

for (const mode of ["Dark", "Light"]) {
  test(`${mode} mode: surfaces come from the host and the brand colour follows the mode`, async ({ page, app }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await openBoard(page, app);
    await page.getByLabel("Team").selectOption("team-plt");
    await expect(card(page, "PLT-120")).toBeVisible();
    await openSettings(page);
    await selectSettingsSection(page, "Appearance");
    await chooseColorMode(page, mode);
    await closeSettings(page);
    const root = page.locator(".mtl-root");
    await expect(root).toBeVisible();
    const look = await root.evaluate((el) => {
      const style = getComputedStyle(el);
      const probe = getComputedStyle(document.documentElement);
      return {
        cyan: style.getPropertyValue("--mtl-cyan").trim(),
        background: style.backgroundColor,
        hostBase: probe.getPropertyValue("--surface-base").trim(),
        mode: document.documentElement.getAttribute("data-color-mode"),
      };
    });
    expect(look.mode).toBe(mode.toLowerCase());
    expect(look.cyan).toBe(mode === "Dark" ? "#00d4ff" : "#0090b8");
    expect(look.hostBase).not.toBe("");
    await shot(page, `11-${mode.toLowerCase()}`);
    await card(page, "PLT-120").click();
    await expect(page.getByRole("dialog", { name: /PLT-120/ })).toBeVisible();
    await shot(page, `12-${mode.toLowerCase()}-details`);
  });
}

for (const mode of ["Dark", "Light"]) {
  test(`${mode} mode: the page's icon in the page list is painted in the entry's own text colour`, async ({ page, app }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await arrange(page, app);
    await expect(page.getByRole("button", { name: /^Community switcher:/ })).toBeVisible();
    await openSettings(page);
    await selectSettingsSection(page, "Appearance");
    await chooseColorMode(page, mode);
    await closeSettings(page);
    const choices = await pageChoices(page, "Linear");
    // The host draws the icon as an <img> of the data URL, which cannot follow the theme by itself: a mask rule does.
    const icon = choices.locator('img[src^="data:image/svg+xml,"]').first();
    await expect(icon).toBeVisible();
    const look = await icon.evaluate((img) => {
      const style = getComputedStyle(img);
      return {
        mask: style.maskImage !== "none" ? style.maskImage : style.webkitMaskImage,
        paint: style.backgroundColor,
        ink: style.color,
        src: img.getAttribute("src"),
        mode: document.documentElement.getAttribute("data-color-mode"),
      };
    });
    expect(look.mode).toBe(mode.toLowerCase());
    expect(look.mask).toContain(look.src);
    expect(look.paint).toBe(look.ink);
    expect(look.paint).not.toBe("rgba(0, 0, 0, 0)");
  });
}

test("a narrow window still shows the board and the details", async ({ page, app }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await card(page, "PLT-120").click();
  await expect(page.getByRole("dialog", { name: /PLT-120/ })).toBeVisible();
  await shot(page, "13-narrow");
});

test("leaving the page and coming back, or turning the plugin off and on, leaves nothing behind", async ({ page, app }) => {
  await page.addInitScript(() => {
    const counts = new Map();
    const track = (target, type, fn, capture, delta) => {
      if (typeof fn !== "function") return;
      const name = `${target === window ? "window" : target === document ? "document" : "other"}:${type}`;
      if (!["window:pointermove", "window:pointerup", "window:pointercancel", "window:keydown", "window:focus", "document:visibilitychange"].includes(name)) return;
      const key = `${name}:${String(capture)}`;
      const fns = counts.get(key) ?? new Set();
      if (delta > 0) fns.add(fn); else fns.delete(fn);
      counts.set(key, fns);
    };
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, options) {
      track(this, type, fn, typeof options === "object" ? !!options?.capture : !!options, 1);
      return add.call(this, type, fn, options);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, options) {
      track(this, type, fn, typeof options === "object" ? !!options?.capture : !!options, -1);
      return remove.call(this, type, fn, options);
    };
    window.__listenerCounts = () => Object.fromEntries([...counts].map(([k, v]) => [k, v.size]));
  });
  await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-120")).toBeVisible();
  const styles = () => page.locator("style[data-megatech-linear]").count();
  const counts = () => page.evaluate(() => window.__listenerCounts());
  const onBoard = await counts();
  expect(await styles()).toBe(1);
  await openPage(page, "Reminders");
  const away = await counts();
  // The open page holds exactly one window focus listener and one visibility listener.
  expect(onBoard["window:focus:false"]).toBe(away["window:focus:false"] + 1);
  expect(onBoard["document:visibilitychange:false"]).toBe(away["document:visibilitychange:false"] + 1);
  for (let round = 0; round < 4; round += 1) {
    await openPage(page, "Linear");
    await expect(card(page, "PLT-120")).toBeVisible();
    expect(await counts()).toEqual(onBoard);
    await openPage(page, "Reminders");
    expect(await counts()).toEqual(away);
  }
  await openPage(page, "Linear");
  expect(await styles()).toBe(1);
  await openSettings(page);
  await selectSettingsSection(page, "Manage plugins");
  for (let round = 0; round < 3; round += 1) {
    await setPluginEnabled(page, "Linear", false);
    expect(await styles()).toBe(0);
    await setPluginEnabled(page, "Linear", true);
    await expect.poll(styles).toBe(1);
  }
  await closeSettings(page);
  await openPage(page, "Linear");
  await expect(card(page, "PLT-120")).toBeVisible();
  expect(await counts()).toEqual(onBoard);
});

test("Escape ends a drag, and the release that follows does not open the card or move it", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  const source = await card(page, "PLT-110").boundingBox();
  await dragCard(page, "PLT-110", "In Progress", { release: false });
  await page.keyboard.press("Escape");
  await expect(page.locator(".mtl-lift")).toHaveCount(0);
  await page.mouse.move(source.x + source.width / 2, source.y + 24, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: /PLT-110/ })).toHaveCount(0);
  await expect(column(page, "Todo")).toContainText("PLT-110");
  expect(fake.control.log.operations.MoveIssue ?? 0).toBe(0);
});

test("a drop outside the board, or under the details panel, moves nothing", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  const source = await card(page, "PLT-110").boundingBox();
  const header = await page.locator(".mtl-bar").boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + 24);
  await page.mouse.down();
  await page.mouse.move(source.x + 30, source.y + 40, { steps: 3 });
  await page.mouse.move(header.x + 600, header.y + header.height / 2, { steps: 8 });
  await expect(page.locator(".mtl-lift")).toBeVisible();
  await expect(page.locator(".mtl-column[data-over]")).toHaveCount(0);
  await page.mouse.up();
  await expect(column(page, "Todo")).toContainText("PLT-110");
  // With the details open, the part of the board under the panel is not a target either.
  await card(page, "PLT-130").click();
  const panel = await page.getByRole("dialog", { name: /PLT-130/ }).boundingBox();
  const todo = await card(page, "PLT-110").boundingBox();
  await page.mouse.move(todo.x + todo.width / 2, todo.y + 24);
  await page.mouse.down();
  await page.mouse.move(todo.x + 30, todo.y + 40, { steps: 3 });
  await page.mouse.move(panel.x + panel.width / 2, panel.y + 300, { steps: 8 });
  await expect(page.locator(".mtl-column[data-over]")).toHaveCount(0);
  await page.mouse.up();
  expect(fake.control.log.operations.MoveIssue ?? 0).toBe(0);
});

test("a drag whose release the page never heard of ends at the next movement", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await dragCard(page, "PLT-110", "In Progress", { release: false });
  await expect(page.locator(".mtl-lift")).toBeVisible();
  // The button comes up in another window: the next move arrives with no button held.
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove", { buttons: 0, clientX: 700, clientY: 500, bubbles: true })));
  await expect(page.locator(".mtl-lift")).toHaveCount(0);
  expect(fake.control.log.operations.MoveIssue ?? 0).toBe(0);
});

test("a completed move is announced", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-110")).toBeVisible();
  await dragCard(page, "PLT-110", "In Progress");
  await expect(page.getByRole("status").filter({ hasText: "PLT-110 moved to In Progress" })).toHaveCount(1);
});

test("replacing the key keeps the old one unless Linear accepts the new one; removing it returns to the connect panel", async ({ page, app }) => {
  const fake = await openBoard(page, app);
  await expect(card(page, "DSN-10")).toBeVisible();
  await openSettings(page);
  await selectSettingsSection(page, "Linear");
  await page.getByRole("button", { name: "Replace key" }).click();
  await page.getByLabel("Personal API key").fill("test-key-unknown");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert")).toContainText("Linear did not accept the API key.");
  expect(await page.evaluate((name) => localStorage.getItem(name), KEY_NAME)).toBe(fake.keys.good);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Key saved.")).toBeVisible();
  await page.getByRole("button", { name: "Remove key" }).click();
  expect(await page.evaluate((name) => localStorage.getItem(name), KEY_NAME)).toBeNull();
  await closeSettings(page);
  await openPage(page, "Linear");
  await expect(page.getByRole("heading", { name: "Connect Linear" })).toBeVisible();
});

const savedKey = (page) => page.evaluate((name) => localStorage.getItem(name), KEY_NAME);

async function startReplacing(page, app, options) {
  const fake = await openBoard(page, app, options);
  await expect(card(page, "DSN-10")).toBeVisible();
  await openSettings(page);
  await selectSettingsSection(page, "Linear");
  await page.getByRole("button", { name: "Replace key" }).click();
  return fake;
}

for (const [fault, said] of [
  ["network", "Couldn't reach Linear to check the new key. Your saved key is unchanged; try again."],
  ["server", "Linear is having trouble right now, so the new key could not be checked. Your saved key is unchanged; try again."],
  ["rate-limit", "Linear is rate limiting requests, so the new key could not be checked. Your saved key is unchanged; try again in a minute."],
]) {
  test(`${fault}: a replacement key that cannot be checked changes nothing, and can be tried again`, async ({ page, app }) => {
    const fake = await startReplacing(page, app);
    const field = page.getByLabel("Personal API key");
    await field.fill("test-key-mistyped");
    fake.control.fail(fault);
    await page.getByRole("button", { name: "Save key" }).click();
    await expect(page.getByRole("alert")).toHaveText(said);
    expect(await savedKey(page)).toBe(fake.keys.good);
    // The field stays open with what was typed, so it can be tried again, and Cancel leaves the saved key as it was.
    await expect(field).toBeVisible();
    await expect(field).toHaveValue("test-key-mistyped");
    await shot(page, `13-replacement-${fault}`);
    await page.getByRole("button", { name: "Save key" }).click();
    await expect(page.getByRole("alert")).toHaveText("Linear did not accept the API key.");
    expect(await savedKey(page)).toBe(fake.keys.good);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Key saved.")).toBeVisible();
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Connected as Avery Quill in Fixture Studio." })).toBeVisible();
  });
}

test("with no key yet, a key saved while Linear cannot be reached is kept and says it was not checked", async ({ page, app }) => {
  const fake = await openBoard(page, app, { key: null });
  await page.getByRole("button", { name: "Open Linear settings" }).click();
  await page.getByLabel("Personal API key").fill(fake.keys.good);
  fake.control.fail("network");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not reach Linear. The key was saved without being checked; test it again in a moment.");
  expect(await savedKey(page)).toBe(fake.keys.good);
  await expect(page.getByText("Key saved.")).toBeVisible();
  await expect(page.getByLabel("Personal API key")).toHaveCount(0);
  await shot(page, "14-first-key-unchecked");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Connected as Avery Quill in Fixture Studio." })).toBeVisible();
});

test("Linear's own wording of a refusal never reaches the page, even when it repeats the key", async ({ page, app }) => {
  const logs = [];
  page.on("console", (message) => logs.push(message.text()));
  const fake = await startReplacing(page, app);
  const typed = "test-key-typed-for-echo";
  await page.getByLabel("Personal API key").fill(typed);
  fake.control.fail("echo");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert")).toHaveText("Linear refused the request.");
  expect(await savedKey(page)).toBe(fake.keys.good);
  await page.getByRole("button", { name: "Cancel" }).click();
  await closeSettings(page);
  await openPage(page, "Linear");
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-110")).toBeVisible();
  await page.setViewportSize({ width: 1500, height: 900 });
  fake.control.fail("echo", { operation: "MoveIssue" });
  await dragCard(page, "PLT-110", "In Progress");
  await expect(page.getByRole("alert")).toContainText("PLT-110 was not moved to In Progress: Linear refused the request.");
  expect(stateOf(fake, "PLT-110")).toBe("todo");
  const everything = await page.evaluate(() => document.documentElement.outerHTML + document.body.innerText);
  for (const secret of [fake.keys.good, typed, "Argument Validation", "is not allowed here"]) {
    expect(everything.includes(secret), secret).toBe(false);
    expect(logs.some((line) => line.includes(secret)), `console: ${secret}`).toBe(false);
  }
});

test("a colour from Linear that is not a plain hex colour never reaches the page, and makes no request", async ({ page, app }) => {
  const remote = "https://tracker.invalid/pixel.png";
  const asked = [];
  page.on("request", (request) => asked.push(request.url()));
  await page.setViewportSize({ width: 1500, height: 900 });
  await arrange(page, app, {
    prepare: (fake) => {
      const world = fake.control.world;
      world.states.find((s) => s.id === "team-plt:doing").color = `url(${remote})`;
      world.projects.find((p) => p.id === "proj-launch").color = `url(${remote})`;
      for (const record of world.records) for (const label of record.labels) if (label.name === "Feature") label.color = `url(${remote})`;
    },
  });
  await openPage(page, "Linear");
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-121")).toBeVisible();
  await card(page, "PLT-121").click(); // a card with a Feature label
  const details = page.getByRole("dialog", { name: /PLT-121/ });
  await expect(details).toBeVisible();
  const neutral = "rgb(130, 144, 160)";
  expect(await details.locator(".mtl-dot").evaluateAll((dots) => dots.map((d) => getComputedStyle(d).backgroundColor))).toEqual([neutral]);
  const dot = await page.locator(".mtl-dot").evaluateAll((dots) => dots.map((d) => getComputedStyle(d).backgroundColor));
  expect(dot.length).toBeGreaterThan(0);
  expect(dot.every((c) => /^rgba?\(/.test(c))).toBe(true);
  expect(dot).toContain(neutral);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain("tracker.invalid");
  await expect.poll(() => asked.filter((url) => url.includes("tracker.invalid"))).toEqual([]);
  // The state's glyph and the project's icon are drawn, in the neutral colour (not left unpainted).
  const head = column(page, "In Progress").locator("svg.mtl-status").first();
  expect(await head.locator("circle").first().getAttribute("stroke")).toBe("#8290a0");
});

test("while a card is held, the Duplicate column is greyed out and is not a target; dropping there still says why", async ({ page, app }) => {
  await page.setViewportSize({ width: 2600, height: 900 });
  const fake = await openBoard(page, app);
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-110")).toBeVisible();
  const dup = column(page, "Duplicate");
  await expect(dup).not.toHaveAttribute("data-refuses");
  await dragCard(page, "PLT-110", "Duplicate", { release: false });
  await expect(dup).toHaveAttribute("data-refuses", "");
  await expect(dup).not.toHaveAttribute("data-over");
  const look = await dup.evaluate((el) => {
    const style = getComputedStyle(el);
    return { opacity: Number(style.opacity), filter: style.filter, cursor: getComputedStyle(el.querySelector(".mtl-cards")).cursor };
  });
  expect(look.opacity).toBeLessThan(1);
  expect(look.filter).toContain("grayscale");
  expect(look.cursor).toBe("not-allowed");
  await expect(column(page, "Todo")).not.toHaveAttribute("data-refuses");
  await expect(column(page, "Done")).not.toHaveAttribute("data-refuses");
  await shot(page, "15-duplicate-greyed");
  await page.mouse.up();
  await expect(page.getByRole("alert")).toContainText("PLT-110 was not moved to Duplicate");
  await expect(dup).not.toHaveAttribute("data-refuses");
  expect(stateOf(fake, "PLT-110")).toBe("todo");
  expect(fake.control.log.operations.MoveIssue ?? 0).toBe(0);
});

// ---- The Keychain: a page that thinks it runs on a Mac, and the stand-in `security` (test/fake-security) behind `runCommand` ----

const everything = (page) => page.evaluate(() => document.documentElement.outerHTML + document.body.innerText);
const storedAnywhere = (page, secret) =>
  page.evaluate(
    (value) => [localStorage, sessionStorage].some((store) => Object.keys(store).some((name) => name.includes(value) || (store.getItem(name) ?? "").includes(value))),
    secret,
  );

test("on a system with no secret store the card says the key is plain text in the profile, and no store program is ever run", async ({ page, app }) => {
  const fake = await openBoard(page, app, { key: null });
  await page.getByRole("button", { name: "Open Linear settings" }).click();
  await expect(page.getByText("On this system the key is kept on this computer, in this app's profile, as plain text.")).toBeVisible();
  await page.getByLabel("Personal API key").fill(fake.keys.good);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText("Key saved.")).toBeVisible();
  await expect(page.getByText("It is in this app's profile, as plain text, because this system has no secret store the plugin can use: any other plugin you install could read it. It is not shown again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Move to Keychain" })).toHaveCount(0);
  await shot(page, "16-plain-fallback");
  expect(await savedKey(page)).toBe(fake.keys.good);
  expect(fake.keychain.calls()).toEqual([]);
  expect(fake.secret.calls()).toEqual([]);
  await page.getByRole("button", { name: "Remove key" }).click();
  expect(await savedKey(page)).toBeNull();
  expect(fake.keychain.calls()).toEqual([]);
  expect(fake.secret.calls()).toEqual([]);
});

test("on a Mac the key goes to the Keychain, not the profile, is nowhere else, and is found there in the next session", async ({ page, app }) => {
  const logs = [];
  const asked = [];
  page.on("console", (message) => logs.push(message.text()));
  page.on("request", (request) => asked.push(request.url()));
  const fake = await openBoard(page, app, { key: null, mac: true });
  await page.getByRole("button", { name: "Open Linear settings" }).click();
  await expect(page.getByText("On a Mac the key is kept in your Keychain, in an item named buzz-linear")).toBeVisible();
  await page.getByLabel("Personal API key").fill(fake.keys.good);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText("It is kept in your Keychain. It is not shown again.")).toBeVisible();
  await shot(page, "17-keychain-saved");
  expect(fake.keychain.kept()).toEqual([fake.keys.good]);
  expect(await savedKey(page)).toBeNull();
  expect(await storedAnywhere(page, fake.keys.good)).toBe(false);
  expect((await everything(page)).includes(fake.keys.good)).toBe(false);
  expect(await page.evaluate((key) => [...document.querySelectorAll("input")].some((input) => input.value.includes(key)), fake.keys.good)).toBe(false);
  // The command line of every call has the item's name and no key: the key went in on standard input.
  expect(fake.keychain.calls().length).toBeGreaterThan(0);
  for (const call of fake.keychain.calls()) expect(call.join(" ")).not.toContain(fake.keys.good);
  await closeSettings(page);
  await openPage(page, "Linear");
  await expect(card(page, "DSN-10")).toBeVisible();
  // A new session reads it back and does not write again.
  const adds = fake.keychain.adds();
  await page.reload();
  await openPage(page, "Linear");
  await expect(card(page, "DSN-10")).toBeVisible();
  expect(fake.keychain.adds()).toBe(adds);
  expect(await savedKey(page)).toBeNull();
  expect(logs.filter((line) => line.includes(fake.keys.good))).toEqual([]);
  expect(asked.filter((url) => url.includes(fake.keys.good))).toEqual([]);
});

test("on a Mac a key from an earlier version is moved to the Keychain at the start, the board waits for it, and it is not moved again", async ({ page, app }) => {
  const fake = await openBoard(page, app, { mac: true });
  await expect(card(page, "DSN-10")).toBeVisible();
  expect(fake.keychain.kept()).toEqual([fake.keys.good]);
  expect(await savedKey(page)).toBeNull();
  expect(fake.keychain.adds()).toBe(1);
  for (const call of fake.keychain.calls()) expect(call.join(" ")).not.toContain(fake.keys.good);
  await page.reload();
  await openPage(page, "Linear");
  await expect(card(page, "DSN-10")).toBeVisible();
  expect(fake.keychain.adds()).toBe(1);
  await openSettings(page);
  await selectSettingsSection(page, "Linear");
  await expect(page.getByText("It is kept in your Keychain. It is not shown again.")).toBeVisible();
});

test("on a Mac, if the Keychain will not take a key from the profile, it stays in use, says it is plain text, and moves when the button is pressed and the Keychain works", async ({ page, app }) => {
  const fake = await openBoard(page, app, { mac: true, keychainMode: "refuse-add" });
  await expect(card(page, "DSN-10")).toBeVisible(); // the key is not lost: the board works
  expect(await savedKey(page)).toBe(fake.keys.good);
  expect(fake.keychain.kept()).toEqual([]);
  await openSettings(page);
  await selectSettingsSection(page, "Linear");
  await expect(page.getByText("because the Keychain would not take it yet (it is tried again each time Buzz starts). Any other plugin you install could read it.")).toBeVisible();
  await shot(page, "18-plain-until-moved");
  await page.getByRole("button", { name: "Move to Keychain" }).click();
  await expect(page.getByRole("alert")).toContainText("The Keychain would not take the key from here. It is still in this app's profile, as plain text.");
  await expect(page.getByRole("group", { name: "Save the key in the Keychain by hand" })).toContainText("security add-generic-password -U -s buzz-linear -a linear -w");
  expect(await savedKey(page)).toBe(fake.keys.good);
  fake.keychain.mode("");
  await page.getByRole("button", { name: "Move to Keychain" }).click();
  await expect(page.getByText("Moved to your Keychain. The copy in this app's profile is gone.")).toBeVisible();
  await expect(page.getByText("It is kept in your Keychain. It is not shown again.")).toBeVisible();
  expect(fake.keychain.kept()).toEqual([fake.keys.good]);
  expect(await savedKey(page)).toBeNull();
});

test("on a Mac a replacement that cannot be checked, or that Linear refuses, leaves the Keychain as it was and writes nothing", async ({ page, app }) => {
  const fake = await startReplacing(page, app, { mac: true, inKeychain: "good" });
  const written = fake.keychain.adds(); // the one that put the saved key there
  await page.getByLabel("Personal API key").fill(fake.keys.other);
  fake.control.fail("network");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert")).toHaveText("Couldn't reach Linear to check the new key. Your saved key is unchanged; try again.");
  expect(fake.keychain.kept()).toEqual([fake.keys.good]);
  expect(fake.keychain.adds()).toBe(written);
  await page.getByLabel("Personal API key").fill("test-key-unknown");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert")).toHaveText("Linear did not accept the API key.");
  expect(fake.keychain.kept()).toEqual([fake.keys.good]);
  expect(fake.keychain.adds()).toBe(written);
});

test("on a Mac a Keychain that refuses a replacement keeps the saved key, shows the command for Terminal, and takes up the key once it is there", async ({ page, app }) => {
  const fake = await startReplacing(page, app, { mac: true, inKeychain: "good", keychainMode: "refuse-add" });
  await page.getByLabel("Personal API key").fill(fake.keys.other);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert")).toHaveText("The Keychain would not take the key from here, and it has not been kept anywhere. Your saved key is unchanged.");
  await expect(page.getByRole("group", { name: "Save the key in the Keychain by hand" })).toContainText("security add-generic-password -U -s buzz-linear -a linear -w");
  await shot(page, "19-keychain-by-hand");
  expect(fake.keychain.kept()).toEqual([fake.keys.good]);
  expect(await savedKey(page)).toBeNull();
  // The person runs the command in Terminal; the card looks again, and the board starts over with the key it finds.
  await fake.keychain.byHand(fake.keys.other);
  const requests = fake.control.log.requests.length;
  await page.getByRole("button", { name: "Check Keychain" }).click();
  await expect(page.getByText("Found the key in your Keychain.")).toBeVisible();
  expect(fake.keychain.kept()).toEqual([fake.keys.other]);
  await expect.poll(() => fake.control.log.requests.length).toBeGreaterThan(requests);
  await expect(page.getByRole("group", { name: "Save the key in the Keychain by hand" })).toHaveCount(0);
});

test("on a Mac a first key the Keychain refuses is kept nowhere, and nothing is left in the profile", async ({ page, app }) => {
  const fake = await openBoard(page, app, { key: null, mac: true, keychainMode: "refuse-add" });
  await page.getByRole("button", { name: "Open Linear settings" }).click();
  await page.getByLabel("Personal API key").fill(fake.keys.good);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert")).toHaveText("The Keychain would not take the key from here, and it has not been kept anywhere.");
  expect(fake.keychain.kept()).toEqual([]);
  expect(await savedKey(page)).toBeNull();
  expect(await storedAnywhere(page, fake.keys.good)).toBe(false);
  await expect(page.getByText("Key saved.")).toHaveCount(0);
});

test("on a Mac a replacement saved before the first look at the Keychain has finished still cannot replace the key that is there", async ({ page, app }) => {
  // No command runs until the test lets them, so what the card knows about a saved key is late.
  const fake = await arrange(page, app, { key: null, mac: true, inKeychain: "good", holdKeychain: true });
  await openSettings(page);
  await selectSettingsSection(page, "Linear");
  await page.getByLabel("Personal API key").fill(fake.keys.other);
  fake.control.fail("network");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.waitForTimeout(1000);
  await expect(page.getByRole("alert")).toHaveCount(0); // it is waiting for the first look
  expect(fake.keychain.calls().filter((call) => call[0] === "add-generic-password")).toHaveLength(1); // only the one that put the saved key there
  fake.keychain.release();
  await expect(page.getByRole("alert")).toHaveText("Couldn't reach Linear to check the new key. Your saved key is unchanged; try again.");
  expect(fake.keychain.kept()).toEqual([fake.keys.good]);
});

test("on a Mac Remove key deletes the Keychain item and any copy in the profile; if the Keychain will not let go it says so and the key stays", async ({ page, app }) => {
  const fake = await startReplacing(page, app, { mac: true, inKeychain: "good" });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.evaluate(([name]) => localStorage.setItem(name, "a stale plain copy"), [KEY_NAME]);
  fake.keychain.mode("refuse-delete");
  await page.getByRole("button", { name: "Remove key" }).click();
  await expect(page.getByRole("alert")).toHaveText("The Keychain would not give the key up. Remove it in Keychain Access (search for buzz-linear).");
  expect(fake.keychain.kept()).toEqual([fake.keys.good]);
  await expect(page.getByText("Key saved.")).toBeVisible();
  fake.keychain.mode("");
  await page.getByRole("button", { name: "Remove key" }).click();
  await expect(page.getByLabel("Personal API key")).toBeVisible();
  expect(fake.keychain.kept()).toEqual([]);
  expect(await savedKey(page)).toBeNull();
  await closeSettings(page);
  await openPage(page, "Linear");
  await expect(page.getByRole("heading", { name: "Connect Linear" })).toBeVisible();
  await page.reload();
  await openPage(page, "Linear");
  await expect(page.getByRole("heading", { name: "Connect Linear" })).toBeVisible();
});

test("on a Mac Linear's own wording of a refusal, even one that repeats the key from the Keychain, never reaches the page", async ({ page, app }) => {
  const logs = [];
  page.on("console", (message) => logs.push(message.text()));
  await page.setViewportSize({ width: 1500, height: 900 });
  const fake = await openBoard(page, app, { key: null, mac: true, inKeychain: "good" });
  await page.getByLabel("Team").selectOption("team-plt");
  await expect(card(page, "PLT-110")).toBeVisible();
  fake.control.fail("echo", { operation: "MoveIssue" });
  await dragCard(page, "PLT-110", "In Progress");
  await expect(page.getByRole("alert")).toContainText("PLT-110 was not moved to In Progress: Linear refused the request.");
  expect((await everything(page)).includes(fake.keys.good)).toBe(false);
  expect(logs.some((line) => line.includes(fake.keys.good))).toBe(false);
});

// ---- Linux: the Secret Service, through the stand-in `secret-tool` (test/fake-secret-tool), which does what the real one was seen to do ----

test("on Linux the key goes to the Secret Service, not the profile, is nowhere else, and is found there in the next session", async ({ page, app }) => {
  const logs = [];
  const asked = [];
  page.on("console", (message) => logs.push(message.text()));
  page.on("request", (request) => asked.push(request.url()));
  const fake = await openBoard(page, app, { key: null, linux: true });
  await page.getByRole("button", { name: "Open Linear settings" }).click();
  await expect(page.getByText("On Linux the key is kept in the system secret store (the Secret Service")).toBeVisible();
  await page.getByLabel("Personal API key").fill(fake.keys.good);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText("It is kept in the system secret store (Secret Service). It is not shown again.")).toBeVisible();
  await shot(page, "20-secret-service-saved");
  expect(fake.secret.kept()).toEqual([fake.keys.good]);
  expect(await savedKey(page)).toBeNull();
  expect(await storedAnywhere(page, fake.keys.good)).toBe(false);
  expect((await everything(page)).includes(fake.keys.good)).toBe(false);
  expect(fake.secret.calls().length).toBeGreaterThan(0);
  for (const call of fake.secret.calls()) expect(call.join(" ")).not.toContain(fake.keys.good);
  expect(fake.keychain.calls()).toEqual([]); // `security` is a Mac's
  await closeSettings(page);
  await openPage(page, "Linear");
  await expect(card(page, "DSN-10")).toBeVisible();
  const stores = fake.secret.stores();
  await page.reload();
  await openPage(page, "Linear");
  await expect(card(page, "DSN-10")).toBeVisible();
  expect(fake.secret.stores()).toBe(stores);
  expect(await savedKey(page)).toBeNull();
  expect(logs.filter((line) => line.includes(fake.keys.good))).toEqual([]);
  expect(asked.filter((url) => url.includes(fake.keys.good))).toEqual([]);
});

test("on Linux a key from an earlier version is moved to the Secret Service at the start, the board waits for it, and it is not moved again", async ({ page, app }) => {
  const fake = await openBoard(page, app, { linux: true });
  await expect(card(page, "DSN-10")).toBeVisible();
  expect(fake.secret.kept()).toEqual([fake.keys.good]);
  expect(await savedKey(page)).toBeNull();
  expect(fake.secret.stores()).toBe(1);
  for (const call of fake.secret.calls()) expect(call.join(" ")).not.toContain(fake.keys.good);
  await page.reload();
  await openPage(page, "Linear");
  await expect(card(page, "DSN-10")).toBeVisible();
  expect(fake.secret.stores()).toBe(1);
  await openSettings(page);
  await selectSettingsSection(page, "Linear");
  await expect(page.getByText("It is kept in the system secret store (Secret Service). It is not shown again.")).toBeVisible();
});

test("on Linux with no Secret Service the key is kept in the profile, labelled as plain text, still works, and moves to the store when the store does", async ({ page, app }) => {
  const fake = await openBoard(page, app, { key: null, linux: true, secretMode: "unreachable" });
  await page.getByRole("button", { name: "Open Linear settings" }).click();
  await page.getByLabel("Personal API key").fill(fake.keys.good);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert")).toContainText("The system secret store (Secret Service) did not take the key from here, so it is kept in this app's profile, as plain text: any other plugin you install could read it.");
  await expect(page.getByText("because the system secret store (Secret Service) would not take it yet (it is tried again each time Buzz starts)")).toBeVisible();
  await shot(page, "21-secret-service-unreachable");
  expect(await savedKey(page)).toBe(fake.keys.good);
  expect(fake.secret.kept()).toEqual([]);
  // The key is not lost: the board works with it.
  await closeSettings(page);
  await openPage(page, "Linear");
  await expect(card(page, "DSN-10")).toBeVisible();
  await openSettings(page);
  await selectSettingsSection(page, "Linear");
  await page.getByRole("button", { name: "Move to secret store" }).click();
  await expect(page.getByRole("alert")).toContainText("The system secret store would not take the key from here. It is still in this app's profile, as plain text.");
  await expect(page.getByRole("group", { name: "Save the key in the Keychain by hand" })).toHaveCount(0); // that is a Mac's way
  fake.secret.mode("");
  await page.getByRole("button", { name: "Move to secret store" }).click();
  await expect(page.getByText("Moved to the system secret store (Secret Service). The copy in this app's profile is gone.")).toBeVisible();
  expect(fake.secret.kept()).toEqual([fake.keys.good]);
  expect(await savedKey(page)).toBeNull();
});

test("on Linux a key in the profile that the store will not take at the start stays in use, and is moved at the next start", async ({ page, app }) => {
  const fake = await openBoard(page, app, { linux: true, secretMode: "refuse-store" });
  await expect(card(page, "DSN-10")).toBeVisible();
  expect(await savedKey(page)).toBe(fake.keys.good);
  expect(fake.secret.kept()).toEqual([]);
  fake.secret.mode("");
  await page.reload();
  await openPage(page, "Linear");
  await expect(card(page, "DSN-10")).toBeVisible();
  expect(fake.secret.kept()).toEqual([fake.keys.good]);
  expect(await savedKey(page)).toBeNull();
});

test("on Linux a replacement that cannot be checked, or that the store will not take, keeps the saved key, and no plain copy is made beside it", async ({ page, app }) => {
  const fake = await startReplacing(page, app, { linux: true, inKeychain: "good" });
  const stores = fake.secret.stores(); // the one that put the saved key there
  await page.getByLabel("Personal API key").fill(fake.keys.other);
  fake.control.fail("network");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert")).toHaveText("Couldn't reach Linear to check the new key. Your saved key is unchanged; try again.");
  expect(fake.secret.stores()).toBe(stores);
  fake.secret.mode("refuse-store");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert")).toHaveText("The system secret store would not take the new key, so your saved key is unchanged.");
  expect(fake.secret.kept()).toEqual([fake.keys.good]);
  expect(await savedKey(page)).toBeNull();
  fake.secret.mode("");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText("It is kept in the system secret store (Secret Service). It is not shown again.")).toBeVisible();
  expect(fake.secret.kept()).toEqual([fake.keys.other]);
});

test("on Linux Remove key deletes the store's item and any copy in the profile; if the store will not let go it says so and the key stays", async ({ page, app }) => {
  const fake = await startReplacing(page, app, { linux: true, inKeychain: "good" });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.evaluate(([name]) => localStorage.setItem(name, "a stale plain copy"), [KEY_NAME]);
  fake.secret.mode("refuse-clear");
  await page.getByRole("button", { name: "Remove key" }).click();
  await expect(page.getByRole("alert")).toContainText("The system secret store would not give the key up. Remove it with `secret-tool clear service buzz-linear account linear`");
  expect(fake.secret.kept()).toEqual([fake.keys.good]);
  await expect(page.getByText("Key saved.")).toBeVisible();
  fake.secret.mode("");
  await page.getByRole("button", { name: "Remove key" }).click();
  await expect(page.getByLabel("Personal API key")).toBeVisible();
  expect(fake.secret.kept()).toEqual([]);
  expect(await savedKey(page)).toBeNull();
  await closeSettings(page);
  await openPage(page, "Linear");
  await expect(page.getByRole("heading", { name: "Connect Linear" })).toBeVisible();
});

// ---- Cancel ----

test("Cancel puts the card back as it was: the message from the last key check goes, and Cancel waits while a key is being checked", async ({ page, app }) => {
  const fake = await startReplacing(page, app);
  const linearCard = page.locator(".mtl-settings"); // the host has status regions of its own
  // While Linear is being asked (a held answer, for a key it accepts) Cancel waits: a Cancel that did not stop the save would be a lie.
  await page.getByLabel("Personal API key").fill(fake.keys.other);
  const release = fake.control.hold("Viewer");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(linearCard.getByRole("status")).toHaveText("Checking with Linear…");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save key" })).toBeDisabled();
  release();
  await expect(linearCard.getByRole("status")).toHaveText("Connected as Avery Quill in Fixture Studio.");
  await expect(page.getByText("Key saved.")).toBeVisible();
  // A key Linear refuses leaves its message; Cancel takes it away, and the typed key with it.
  await page.getByRole("button", { name: "Replace key" }).click();
  await page.getByLabel("Personal API key").fill("test-key-unknown");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert")).toHaveText("Linear did not accept the API key.");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(linearCard.getByRole("status")).toHaveCount(0);
  await expect(page.getByLabel("Personal API key")).toHaveCount(0);
  await expect(page.getByText("Key saved.")).toBeVisible();
  expect(await savedKey(page)).toBe(fake.keys.other);
  // Replace key again: the field is empty and nothing from before is on the card.
  await page.getByRole("button", { name: "Replace key" }).click();
  await expect(page.getByLabel("Personal API key")).toHaveValue("");
  await expect(page.getByRole("alert")).toHaveCount(0);
  // A message that is not an error goes too: "Connected as ..." from Test connection.
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(linearCard.getByRole("status").filter({ hasText: "Connected as Avery Quill in Fixture Studio." })).toBeVisible();
  await page.getByRole("button", { name: "Replace key" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(linearCard.getByRole("status")).toHaveCount(0);
});

test("on a Mac Cancel and Save wait while the key is being written to the Keychain, and the key is the new one when they come back", async ({ page, app }) => {
  // Every call of the stand-in takes 1.2 seconds: after Linear has accepted the key, writing it and reading it back takes a while.
  const fake = await startReplacing(page, app, { mac: true, inKeychain: "good", keychainMode: "slow", keychainDelay: 1200 });
  await page.getByLabel("Personal API key").fill(fake.keys.other);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.locator(".mtl-settings").getByRole("status")).toHaveText("Connected as Avery Quill in Fixture Studio.");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save key" })).toBeDisabled();
  await expect(page.getByText("It is kept in your Keychain. It is not shown again.")).toBeVisible({ timeout: 15_000 });
  expect(fake.keychain.kept()).toEqual([fake.keys.other]);
});

test("on a Mac Cancel also takes away the command for Terminal and the message that went with it", async ({ page, app }) => {
  const fake = await startReplacing(page, app, { mac: true, inKeychain: "good", keychainMode: "refuse-add" });
  await page.getByLabel("Personal API key").fill(fake.keys.other);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("group", { name: "Save the key in the Keychain by hand" })).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("group", { name: "Save the key in the Keychain by hand" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(fake.keychain.kept()).toEqual([fake.keys.good]);
});

test("a saved view that was deleted in Linear does not break the board", async ({ page, app }) => {
  await page.addInitScript(() =>
    localStorage.setItem("megatech.linear.board.v1", JSON.stringify({ teamId: "team-plt", scope: { kind: "view", id: "view-deleted" } })),
  );
  await openBoard(page, app);
  await expect(card(page, "PLT-120")).toBeVisible();
  await expect(page.getByLabel("Filter")).toHaveValue("team");
  await expect(page.getByRole("alert")).toContainText("saved filter no longer exists");
});
