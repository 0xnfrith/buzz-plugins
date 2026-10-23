// Drives the Linear plugin in the real Buzz web build (headless Chromium, fixture relay) with
// a fake Linear behind `ctx.host.request`. Run with plugins/linear/test/run.sh.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { test, expect } from "./fixture.mjs";
import { chooseColorMode, closeSettings, openPage, openSettings, selectSettingsSection } from "./navigation.mjs";
import { setPluginEnabled } from "./plugin-settings.mjs";

const dir = process.env.LINEAR_PLUGIN_DIR;
const { createFakeLinear } = await import(pathToFileURL(join(dir, "test/fake-linear/server.mjs")).href);
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

test.use({ pluginFixtures: true });

const KEY_NAME = "megatech.linear.api-key.v1";

/** A page wired to a fresh fake Linear, with the key already saved unless `key` is null. */
async function arrange(page, app, { key = "good" } = {}) {
  const fake = createFakeLinear();
  await page.exposeFunction("__linearRequest", (request) => fake.handle(request));
  if (key) {
    const value = fake.keys[key];
    await page.addInitScript(([name, v]) => localStorage.setItem(name, v), [KEY_NAME, value]);
  }
  await page.goto(app.origin);
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
  expect(names).toEqual(["Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"]);
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

test("a saved view that was deleted in Linear does not break the board", async ({ page, app }) => {
  await page.addInitScript(() =>
    localStorage.setItem("megatech.linear.board.v1", JSON.stringify({ teamId: "team-plt", scope: { kind: "view", id: "view-deleted" } })),
  );
  await openBoard(page, app);
  await expect(card(page, "PLT-120")).toBeVisible();
  await expect(page.getByLabel("Filter")).toHaveValue("team");
  await expect(page.getByRole("alert")).toContainText("saved filter no longer exists");
});
