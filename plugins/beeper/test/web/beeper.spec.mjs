// Drives the Beeper plugin in the real Buzz web build (headless Chromium, fixture relay) with
// a fake Beeper Desktop on loopback behind `ctx.host.runCommand`, which runs the real curl with
// the manifest's own arguments. Run with plugins/beeper/test/run.sh.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { test, expect } from "./fixture.mjs";
import { chooseColorMode, closeSettings, openPage, openSettings, selectSettingsSection } from "./navigation.mjs";
import { setPluginEnabled } from "./plugin-settings.mjs";

const dir = process.env.BEEPER_PLUGIN_DIR;
const load = (path) => import(pathToFileURL(join(dir, path)).href);
const { startFake, TEST_TOKEN } = await load("test/fake-beeper/server.mjs");
const { makeWorld } = await load("test/fake-beeper/world.mjs");
const { runCommand } = await load("test/host-sim.mjs");
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

test.use({ pluginFixtures: true, timezoneId: "UTC", locale: "en-US" });

const TOKEN_KEY = "megatech.beeper.token.v1";
const URL_KEY = "megatech.beeper.base-url.v1";
// The browser's clock is fixed here, and the fake stamps the messages it makes with the same instant.
const NOW = Date.parse("2026-10-24T12:05:00Z");

const running = [];
test.afterEach(async () => {
  while (running.length) await running.pop().close();
});

/**
 * A page wired to a fresh fake Beeper, with the token and the address already saved in the profile (or, with `keychain`, the
 * token in the stand-in Keychain instead). `mac` makes the page think it runs on a Mac, where the Keychain is used.
 */
async function arrange(page, app, { token = TEST_TOKEN, world, fake: options = {}, goto = true, mac = false, keychain: inKeychain, keychainMode = "" } = {}) {
  const fake = await startFake({ world: world ?? makeWorld({ now: NOW }), now: () => NOW, ...options });
  running.push(fake);
  const host = { curl: true };
  // The stand-in `security`: its "keychain" is a file, and every call it gets is logged.
  const dir = mkdtempSync(join(tmpdir(), "beeper-web-keychain-"));
  const env = { BEEPER_FAKE_KEYCHAIN: join(dir, "keychain.json"), BEEPER_FAKE_KEYCHAIN_LOG: join(dir, "log.jsonl"), BEEPER_FAKE_KEYCHAIN_MODE: keychainMode };
  const keychain = {
    env,
    kept: () => (existsSync(env.BEEPER_FAKE_KEYCHAIN) ? Object.values(JSON.parse(readFileSync(env.BEEPER_FAKE_KEYCHAIN, "utf8"))) : []),
    calls: () => (existsSync(env.BEEPER_FAKE_KEYCHAIN_LOG) ? readFileSync(env.BEEPER_FAKE_KEYCHAIN_LOG, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []),
    /** What a person does in Terminal: the same command, the token typed at its prompt. */
    byHand: (value) => runCommand("keychain-save", `${value}\n${value}\n`, { env: { ...env, BEEPER_FAKE_KEYCHAIN_MODE: "" } }),
  };
  if (inKeychain) await keychain.byHand(inKeychain);
  await page.exposeFunction("__beeperRun", (command, input) => (host.curl ? runCommand(command, input, { env }) : null));
  if (mac) await page.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }));
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(
    ([entries]) => {
      for (const [name, value] of entries) if (value !== null) localStorage.setItem(name, value);
    },
    [[[TOKEN_KEY, inKeychain ? null : token], [URL_KEY, fake.origin]]],
  );
  if (goto) await page.goto(app.origin);
  return { fake, host, keychain };
}

async function openInbox(page, app, options) {
  const world = await arrange(page, app, options);
  await openPage(page, "Beeper");
  return world;
}

const list = (page) => page.getByRole("listbox", { name: "Chats" });
const row = (page, title) =>
  list(page)
    .getByRole("option")
    .filter({ has: page.locator(".mtb-row-name", { hasText: new RegExp(`^${title}$`) }) });
const thread = (page) => page.getByRole("log", { name: "Messages" });
const composer = (page) => page.getByRole("textbox", { name: /^Reply to / });
const titles = (page) => list(page).locator(".mtb-row-name").allTextContents();
const sent = (fake) => fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/messages"));

test("the list shows each chat's network, time and unread count, and leaves out archived chats and merged shells", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  const { fake } = await openInbox(page, app);
  await expect(list(page).getByRole("option")).toHaveCount(11);
  const names = await titles(page);
  // Pinned first, then the latest activity first.
  expect(names.slice(0, 3)).toEqual(["Bob Sample", "Alice Example", "Project Osprey crew 2"]);
  const archived = fake.world.chats.find((chat) => chat.isArchived);
  expect(names).not.toContain(archived.title);
  // The merged shell is not listed, its member is: the chat it holds appears once.
  expect(names.filter((name) => name === fake.world.chats[7].title)).toHaveLength(1);
  const alice = row(page, "Alice Example");
  await expect(alice).toContainText("WhatsApp");
  await expect(alice).toContainText("12:04 PM");
  await expect(alice.getByLabel("1 unread")).toBeVisible();
  await expect(row(page, "Erin Placeholder").getByLabel("2 unread")).toBeVisible();
  await expect(page.getByText("6 unread")).toBeVisible();
  await shot(page, "01-list");
});

test("a chat shows its messages oldest first, with media named and reactions left out; message text is text", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openInbox(page, app);
  await row(page, "Alice Example").click();
  await expect(page.getByRole("heading", { name: "Alice Example" })).toBeVisible();
  const log = thread(page);
  await expect(log).toContainText("Image: photo.jpg");
  await expect(log).toContainText("Voice message");
  await expect(log).not.toContainText("👍");
  await expect(log.locator(".mtb-msg-text").last()).toHaveText("First line\nSecond line, with <b>markup</b> & an & ampersand");
  expect(await log.locator("b").count()).toBe(0);
  // Oldest first: the last bubble is the newest message.
  const times = await log.locator(".mtb-msg-meta").allTextContents();
  expect(times.at(-1)).toBe("12:04 PM");
  await expect(log.locator(".mtb-day")).toHaveText(["Today"]);
  await shot(page, "02-chat");
});

test("days are labelled, and earlier messages load on request", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openInbox(page, app);
  await row(page, "Dave Demo 11").click();
  const log = thread(page);
  await expect(log.locator(".mtb-day").last()).toHaveText("Today");
  await expect(log.getByRole("button", { name: "Load earlier messages" })).toBeVisible();
  const before = await log.locator("[data-message-id]").count();
  expect(before).toBe(20);
  await log.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(log.locator("[data-message-id]")).toHaveCount(30);
  await expect(log.getByRole("button", { name: "Load earlier messages" })).toHaveCount(0);
  const days = await log.locator(".mtb-day").allTextContents();
  expect(days).toContain("Yesterday");
  expect(days.at(-1)).toBe("Today");
});

test("opening an unread chat marks it read in Beeper and in the list", async ({ page, app }) => {
  const { fake } = await openInbox(page, app);
  const alice = fake.world.chats.find((chat) => chat.title === "Alice Example");
  expect(alice.unreadCount).toBe(1);
  await row(page, "Alice Example").click();
  await expect.poll(() => alice.unreadCount).toBe(0);
  await expect(row(page, "Alice Example").getByLabel("1 unread")).toHaveCount(0);
  expect(fake.requests.some((r) => r.method === "POST" && r.path.endsWith("/read"))).toBe(true);
  // A read chat is not marked again.
  const marks = () => fake.requests.filter((r) => r.path.endsWith("/read")).length;
  const first = marks();
  await row(page, "Bob Sample").click();
  await page.waitForTimeout(500);
  expect(marks()).toBe(first);
});

test("a reply goes to Beeper exactly as typed, shows as sending, then as a message", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  const { fake } = await openInbox(page, app, { fake: { confirmAfterMs: 1500 } });
  await row(page, "Bob Sample").click();
  const box = composer(page);
  await box.click();
  await box.pressSequentially('Hello 🙂 "quoted" \\ and @/etc/hostname');
  await box.press("Shift+Enter");
  await box.pressSequentially("second line");
  expect(sent(fake)).toHaveLength(0);
  await box.press("Enter");
  await expect(box).toHaveValue("");
  const bubble = thread(page).locator('[data-send-status]');
  await expect(bubble).toContainText("Hello 🙂");
  await shot(page, "03-sending");
  expect(sent(fake)).toHaveLength(1);
  expect(JSON.parse(sent(fake)[0].body)).toEqual({ text: 'Hello 🙂 "quoted" \\ and @/etc/hostname\nsecond line' });
  expect(sent(fake)[0].authorization).toBe(`Bearer ${TEST_TOKEN}`);
  // Beeper lists it a moment later; the sending bubble gives way to the real message, once.
  await expect(bubble).toHaveCount(0, { timeout: 15_000 });
  await expect(thread(page).locator(".mtb-msg-text").filter({ hasText: "second line" })).toHaveCount(1);
  await expect(box).toBeFocused();
});

test("an empty reply sends nothing, and a message too long for one request says so", async ({ page, app }) => {
  const { fake } = await openInbox(page, app);
  await row(page, "Bob Sample").click();
  const box = composer(page);
  await box.fill("   \n  ");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await box.press("Enter");
  expect(sent(fake)).toHaveLength(0);
  await box.fill("x".repeat(70_000));
  await expect(page.getByText("That message is too long to send from here.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await box.press("Enter");
  expect(sent(fake)).toHaveLength(0);
});

test("a send Beeper refuses stays on screen with the reason and can be tried again or dismissed", async ({ page, app }) => {
  const { fake } = await openInbox(page, app);
  await row(page, "Bob Sample").click();
  const chat = fake.world.chats.find((c) => c.title === "Bob Sample");
  chat.isReadOnly = true; // Beeper now refuses sends here; the page learns of it on its next poll
  await composer(page).fill("will be refused");
  await composer(page).press("Enter");
  const bubble = thread(page).locator("[data-send-status=failed]");
  await expect(bubble).toContainText("will be refused");
  await expect(bubble).toContainText("Beeper refused the request.");
  await shot(page, "04-send-refused");
  chat.isReadOnly = false;
  await bubble.getByRole("button", { name: "Try again" }).click();
  await expect(thread(page).locator("[data-send-status=failed]")).toHaveCount(0);
  await expect.poll(() => sent(fake).length).toBe(2);
  chat.isReadOnly = true;
  await composer(page).fill("again");
  await composer(page).press("Enter");
  await bubble.getByRole("button", { name: "Dismiss" }).click();
  await expect(thread(page).locator("[data-send-status=failed]")).toHaveCount(0);
});

test("a read-only chat has no reply box", async ({ page, app }) => {
  await openInbox(page, app);
  await row(page, "Erin Placeholder").click();
  await expect(page.getByRole("heading", { name: "Erin Placeholder" })).toBeVisible();
  await expect(page.getByText("You cannot send messages in this chat.")).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
});

test("a long list draws only the rows in view, and the keys keep the highlighted row in view", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  // 199 chats and a merged shell make the 200 the page asks for; the archived chat and the shell are not listed.
  await openInbox(page, app, { world: makeWorld({ chats: 199, messages: 3, now: NOW }) });
  const options = list(page).getByRole("option");
  await expect(options.first()).toBeVisible();
  expect(await options.count()).toBeLessThan(40);
  for (let i = 0; i < 120; i += 1) await page.keyboard.press("j");
  const cursor = page.locator(".mtb-row[data-cursor]");
  await expect(cursor).toBeVisible();
  await expect(cursor).toHaveAttribute("aria-posinset", "121");
  await expect(cursor).toHaveAttribute("aria-setsize", "198");
  const box = await list(page).boundingBox();
  const at = await cursor.boundingBox();
  expect(at.y).toBeGreaterThanOrEqual(box.y - 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await options.count()).toBeLessThan(40);
  const name = await cursor.locator(".mtb-row-name").textContent();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  // Scrolling by hand draws the rows that come into view.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await list(page).evaluate((el) => (el.scrollTop = 180 * 56));
  await expect(options.filter({ has: page.locator('[aria-hidden]') }).first()).toBeVisible();
  await expect.poll(async () => Number(await options.first().getAttribute("aria-posinset"))).toBeGreaterThan(150);
  await page.keyboard.press("k");
  await expect(page.locator(".mtb-row[data-cursor]")).toHaveAttribute("aria-posinset", "120");
  await shot(page, "12-long-list");
});

test("the page never talks to Beeper itself: every request goes through the declared command", async ({ page, app }) => {
  const toBeeper = [];
  const { fake } = await arrange(page, app, { goto: false });
  page.on("request", (request) => {
    if (request.url().startsWith(fake.origin)) toBeeper.push(request.url());
  });
  page.on("websocket", (socket) => {
    if (socket.url().includes(new URL(fake.origin).host)) toBeeper.push(socket.url());
  });
  await page.goto(app.origin);
  await openPage(page, "Beeper");
  await row(page, "Bob Sample").click();
  await composer(page).fill("hello");
  await composer(page).press("Enter");
  await expect.poll(() => sent(fake).length).toBe(1);
  await page.waitForTimeout(4000);
  expect(fake.requests.length).toBeGreaterThan(3);
  expect(toBeeper).toEqual([]);
});

test("a message whose time cannot be read is shown, and does not take the page down", async ({ page, app }) => {
  const world = makeWorld({ now: NOW });
  const bob = world.chats.find((c) => c.title === "Bob Sample");
  const messages = world.messages.get(bob.id);
  messages.push({ ...messages[0], id: "bad-time", sortKey: "00099999", timestamp: "not a date", text: "A message with no usable time", isSender: false });
  await openInbox(page, app, { world });
  await row(page, "Bob Sample").click();
  await expect(thread(page)).toContainText("A message with no usable time");
  await expect(page.getByText("This page couldn't open")).toHaveCount(0);
  await row(page, "Alice Example").click();
  await row(page, "Bob Sample").click();
  await expect(thread(page)).toContainText("A message with no usable time");
});

test("a reply with a DEL character, an escape and a tab reaches Beeper as typed", async ({ page, app }) => {
  const { fake } = await openInbox(page, app);
  await row(page, "Bob Sample").click();
  const text = "delete\u007fcharacter, escape\u001b, tab\t, c1 \u0085";
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect.poll(() => sent(fake).length).toBe(1);
  expect(JSON.parse(sent(fake)[0].body)).toEqual({ text });
  // And a very long one that is full of them says it is too long, instead of breaking the page.
  await composer(page).fill("\u007f".repeat(30_000));
  await expect(page.getByText("That message is too long to send from here.")).toBeVisible();
});

test("an Enter that confirms an input-method candidate does not send", async ({ page, app }) => {
  const { fake } = await openInbox(page, app);
  await row(page, "Bob Sample").click();
  await composer(page).fill("half a thought");
  // WebKit reports the Enter of a confirmed candidate with isComposing false and the key code 229.
  await composer(page).evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true })));
  await page.waitForTimeout(300);
  expect(sent(fake)).toHaveLength(0);
  await expect(composer(page)).toHaveValue("half a thought");
});

test("a send that fails after its chat was left stays with that chat, and the list says so", async ({ page, app }) => {
  const { fake } = await openInbox(page, app);
  await row(page, "Bob Sample").click();
  fake.world.chats.find((c) => c.title === "Bob Sample").isReadOnly = true;
  await composer(page).fill("will not be sent");
  await composer(page).press("Enter");
  await row(page, "Alice Example").click();
  await expect(row(page, "Bob Sample")).toContainText("Not sent");
  await expect(thread(page).locator("[data-send-status]")).toHaveCount(0);
  await shot(page, "13-not-sent-in-list");
  await row(page, "Bob Sample").click();
  const bubble = thread(page).locator("[data-send-status=failed]");
  await expect(bubble).toContainText("will not be sent");
  await expect(bubble).toContainText("Beeper refused the request.");
  await bubble.getByRole("button", { name: "Dismiss" }).click();
  await row(page, "Alice Example").click();
  await expect(row(page, "Bob Sample")).not.toContainText("Not sent");
});

test("when Beeper has more chats than are listed the list says so", async ({ page, app }) => {
  await openInbox(page, app, { world: makeWorld({ chats: 30, messages: 3, now: NOW }), fake: { listLimit: 20 } });
  await expect(list(page).getByRole("option").first()).toBeVisible();
  await expect(page.getByText("Older chats are not listed.")).toBeVisible();
});

test("a draft stays with its chat when another is opened", async ({ page, app }) => {
  await openInbox(page, app);
  await row(page, "Bob Sample").click();
  await composer(page).fill("half a thought");
  await row(page, "Alice Example").click();
  await expect(composer(page)).toHaveValue("");
  await row(page, "Bob Sample").click();
  await expect(composer(page)).toHaveValue("half a thought");
});

test("keys: j k move, Enter opens and focuses the reply box, Esc steps back, / filters, u shows unread", async ({ page, app }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openInbox(page, app);
  const cursor = () => page.locator(".mtb-row[data-cursor] .mtb-row-name").textContent();
  expect(await cursor()).toBe("Bob Sample");
  await page.keyboard.press("j");
  expect(await cursor()).toBe("Alice Example");
  await page.keyboard.press("ArrowDown");
  expect(await cursor()).toBe("Project Osprey crew 2");
  await page.keyboard.press("k");
  await page.keyboard.press("k");
  await page.keyboard.press("k");
  expect(await cursor()).toBe("Bob Sample");
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Alice Example" })).toBeVisible();
  await expect(composer(page)).toBeFocused();
  // Keys typed in the box are text, not commands.
  await page.keyboard.type("jk/u");
  await expect(composer(page)).toHaveValue("jk/u");
  expect(await cursor()).toBe("Alice Example");
  await page.keyboard.press("Escape");
  await expect(composer(page)).not.toBeFocused();
  await expect(list(page)).toBeFocused();
  await expect(page.getByRole("heading", { name: "Alice Example" })).toBeVisible();
  await page.keyboard.press("r");
  await expect(composer(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Pick a chat to read it and reply.")).toBeVisible();
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Filter chats" })).toBeFocused();
  await page.keyboard.type("osprey");
  await expect(list(page).getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("searchbox", { name: "Filter chats" })).toHaveValue("");
  await expect(list(page)).toBeFocused();
  await expect(list(page).getByRole("option")).toHaveCount(11);
  await page.keyboard.press("u");
  const unread = await titles(page);
  expect(unread.length).toBeGreaterThan(0);
  expect(unread.length).toBeLessThan(11);
  await expect(page.getByRole("button", { name: "Unread" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("u");
  await expect(list(page).getByRole("option")).toHaveCount(11);
  await shot(page, "05-keys");
});

test("the keys do nothing on other pages, and Enter on a button is the button's", async ({ page, app }) => {
  const { fake } = await openInbox(page, app);
  await page.getByRole("button", { name: "Refresh" }).focus();
  const before = fake.requests.length;
  await page.keyboard.press("Enter");
  await expect.poll(() => fake.requests.length).toBeGreaterThan(before);
  expect(fake.requests.some((r) => r.path.endsWith("/messages"))).toBe(false);
  await openPage(page, "Reminders");
  const count = fake.requests.length;
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  expect(fake.requests.length).toBe(count);
});

test("a new message shows in the open chat, and a new unread count in the list, without a click", async ({ page, app }) => {
  test.setTimeout(60_000);
  const { fake } = await openInbox(page, app);
  const alice = fake.world.chats.find((c) => c.title === "Alice Example");
  const bob = fake.world.chats.find((c) => c.title === "Bob Sample");
  await row(page, "Alice Example").click();
  await expect.poll(() => alice.unreadCount).toBe(0);
  fake.receive(alice.id, "A brand new message");
  await expect(thread(page)).toContainText("A brand new message", { timeout: 10_000 });
  // It arrived in the chat being read: Beeper is told it is read.
  await expect.poll(() => alice.unreadCount, { timeout: 20_000 }).toBe(0);
  fake.receive(bob.id, "Ping for the list");
  await expect(row(page, "Bob Sample").getByLabel("1 unread")).toBeVisible({ timeout: 20_000 });
});

test("without a token the page says how to get one, and asks Beeper for nothing", async ({ page, app }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const { fake } = await openInbox(page, app, { token: null });
  await expect(page.getByRole("heading", { name: "Connect Beeper" })).toBeVisible();
  await expect(page.getByText("Under Approved connections, press + to make an access token.")).toBeVisible();
  await shot(page, "06-no-token");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByLabel("Beeper access token")).toBeVisible();
  expect(fake.requests).toHaveLength(0);
});

test("with Beeper closed the page says so, and finds Beeper when it opens", async ({ page, app }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const { fake } = await arrange(page, app, { goto: false });
  const { port } = new URL(fake.origin);
  await fake.close();
  await page.goto(app.origin);
  await openPage(page, "Beeper");
  await expect(page.getByRole("heading", { name: "Beeper is not running, or its API is off" })).toBeVisible();
  await expect(page.getByText("Settings, then Developers, then Beeper Desktop API")).toBeVisible();
  await shot(page, "07-not-running");
  const back = await startFake({ port: Number(port), now: () => NOW, world: makeWorld({ now: NOW }) });
  running.push(back);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(list(page).getByRole("option").first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a token Beeper does not accept, and one that lacks permission, each get their own message", async ({ page, app }) => {
  await openInbox(page, app, { token: "a-token-that-is-wrong" });
  await expect(page.getByRole("heading", { name: "Beeper did not accept the token" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open settings" })).toBeVisible();
});

test("a token without permission is told so", async ({ page, app }) => {
  await openInbox(page, app, { fake: { scopes: false } });
  await expect(page.getByRole("heading", { name: "The token cannot do this" })).toBeVisible();
});

test("without curl the page says so", async ({ page, app }) => {
  const { host } = await arrange(page, app);
  host.curl = false;
  await openPage(page, "Beeper");
  await expect(page.getByRole("heading", { name: "curl was not found" })).toBeVisible();
  await shot(page, "08-no-curl");
});

test("when Beeper goes away the chats stay, with a notice, and then give way to the message", async ({ page, app }) => {
  test.setTimeout(90_000);
  const { fake } = await openInbox(page, app);
  await expect(row(page, "Alice Example")).toBeVisible();
  await fake.close();
  const notice = page.getByRole("status").filter({ hasText: "Beeper is not answering." });
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(row(page, "Alice Example")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Beeper is not running, or its API is off" })).toBeVisible({ timeout: 30_000 });
});

test("the settings card checks a token before keeping it, never shows it again, and removes it on request", async ({ page, app }) => {
  const consoleText = [];
  page.on("console", (message) => consoleText.push(message.text()));
  page.on("pageerror", (error) => consoleText.push(String(error)));
  const { fake } = await arrange(page, app, { token: null });
  await openSettings(page);
  await selectSettingsSection(page, "Beeper");
  await page.getByLabel("Beeper access token").fill("a-token-that-is-wrong");
  await page.getByRole("button", { name: "Save token" }).click();
  await expect(page.getByRole("alert")).toContainText("Beeper did not accept that token.");
  expect(await page.evaluate((name) => localStorage.getItem(name), TOKEN_KEY)).toBeNull();
  await page.getByLabel("Beeper access token").fill(`Bearer ${TEST_TOKEN}`);
  await page.getByRole("button", { name: "Save token" }).click();
  await expect(page.getByText("Token saved in this app's profile, as plain text.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Connected to Beeper Desktop (fake) 0.0.0." })).toBeVisible();
  expect(await page.evaluate((name) => localStorage.getItem(name), TOKEN_KEY)).toBe(TEST_TOKEN);
  await shot(page, "09-settings");
  // The token is not on the page, in any field, or in the console.
  const everything = await page.evaluate(() => document.documentElement.outerHTML + [...document.querySelectorAll("input, textarea")].map((el) => el.value).join(" "));
  expect(everything).not.toContain(TEST_TOKEN);
  expect(consoleText.join("\n")).not.toContain(TEST_TOKEN);
  // Beeper got it in the Authorization header only.
  for (const request of fake.requests) {
    expect(request.path + request.query + request.body).not.toContain(TEST_TOKEN);
  }
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Connected to" })).toBeVisible();
  await page.getByRole("button", { name: "Remove token" }).click();
  expect(await page.evaluate((name) => localStorage.getItem(name), TOKEN_KEY)).toBeNull();
  await closeSettings(page);
  await openPage(page, "Beeper");
  await expect(page.getByRole("heading", { name: "Connect Beeper" })).toBeVisible();
});

test("off a Mac there is no Keychain: the card says the token is plain text in the profile, and the Keychain program is never run", async ({ page, app }) => {
  const { keychain } = await arrange(page, app, { token: null });
  await openSettings(page);
  await selectSettingsSection(page, "Beeper");
  await expect(page.getByRole("button", { name: "Save to Keychain" })).toHaveCount(0);
  await expect(page.getByText("On this system the token is kept in this app's profile, as plain text.")).toBeVisible();
  await page.getByLabel("Beeper access token").fill(TEST_TOKEN);
  await page.getByRole("button", { name: "Save token" }).click();
  await expect(page.getByText("Token saved in this app's profile, as plain text.")).toBeVisible();
  await page.getByRole("button", { name: "Remove token" }).click();
  await closeSettings(page);
  await openPage(page, "Beeper");
  await expect(page.getByRole("heading", { name: "Connect Beeper" })).toBeVisible();
  expect(keychain.calls()).toEqual([]);
});

test("on a Mac the token goes to the Keychain, not the profile, and is found there in the next session", async ({ page, app }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const { keychain, fake } = await arrange(page, app, { token: null, mac: true });
  await openSettings(page);
  await selectSettingsSection(page, "Beeper");
  await expect(page.getByText("Your Keychain is the safe place.")).toBeVisible();
  await page.getByLabel("Beeper access token").fill(TEST_TOKEN);
  await page.getByRole("button", { name: "Save to Keychain" }).click();
  await expect(page.getByText("Token saved in your Keychain.")).toBeVisible();
  await shot(page, "14-keychain-saved");
  expect(keychain.kept()).toEqual([TEST_TOKEN]);
  expect(await page.evaluate((name) => localStorage.getItem(name), TOKEN_KEY)).toBeNull();
  // The token went on standard input: no call to the program has it among its arguments.
  expect(keychain.calls().length).toBeGreaterThan(0);
  for (const call of keychain.calls()) expect(call.join(" ")).not.toContain(TEST_TOKEN);
  await closeSettings(page);
  await openPage(page, "Beeper");
  await expect(list(page).getByRole("option").first()).toBeVisible();
  // A new session (a reload) has no token in the profile and finds it in the Keychain.
  await page.reload();
  await openPage(page, "Beeper");
  await expect(list(page).getByRole("option").first()).toBeVisible();
  expect(await page.evaluate((name) => localStorage.getItem(name), TOKEN_KEY)).toBeNull();
  expect(fake.requests.filter((r) => r.authorization === `Bearer ${TEST_TOKEN}`).length).toBeGreaterThan(1);
  // And it is read once for the session, not on every poll.
  const reads = () => keychain.calls().filter((call) => call[0] === "find-generic-password").length;
  const before = reads();
  await page.waitForTimeout(7000);
  expect(reads()).toBe(before);
});

test("a token that is wrong is not put in the Keychain", async ({ page, app }) => {
  const { keychain } = await arrange(page, app, { token: null, mac: true });
  await openSettings(page);
  await selectSettingsSection(page, "Beeper");
  await page.getByLabel("Beeper access token").fill("a-token-that-is-wrong");
  await page.getByRole("button", { name: "Save to Keychain" }).click();
  await expect(page.getByRole("alert")).toContainText("Beeper did not accept that token.");
  expect(keychain.kept()).toEqual([]);
  expect(keychain.calls().some((call) => call[0] === "add-generic-password")).toBe(false);
});

test("if the Keychain will not take the token, the card says so, shows the one command for Terminal, and finds the token once it is there", async ({ page, app }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const { keychain } = await arrange(page, app, { token: null, mac: true, keychainMode: "refuse-add" });
  await openSettings(page);
  await selectSettingsSection(page, "Beeper");
  await page.getByLabel("Beeper access token").fill(TEST_TOKEN);
  await page.getByRole("button", { name: "Save to Keychain" }).click();
  await expect(page.getByRole("alert")).toContainText("The Keychain would not take the token from here, and it has not been kept anywhere.");
  await expect(page.locator(".mtb-code")).toHaveText("security add-generic-password -U -s buzz-beeper -a beeper -w");
  await shot(page, "15-keychain-by-hand");
  expect(await page.evaluate((name) => localStorage.getItem(name), TOKEN_KEY)).toBeNull();
  // Nothing is kept yet, and the card says so.
  await page.getByRole("button", { name: "Check Keychain" }).click();
  await expect(page.getByRole("alert")).toContainText("Nothing in the Keychain yet.");
  // The person runs the command in Terminal and types the token at its prompt.
  await keychain.byHand(TEST_TOKEN);
  await page.getByRole("button", { name: "Check Keychain" }).click();
  await expect(page.getByText("Token saved in your Keychain.")).toBeVisible();
  await expect(page.locator(".mtb-code")).toHaveCount(0);
  await closeSettings(page);
  await openPage(page, "Beeper");
  await expect(list(page).getByRole("option").first()).toBeVisible();
});

test("on a Mac the profile copy is an explicit choice, says it is plain text, and can be moved to the Keychain", async ({ page, app }) => {
  const { keychain } = await arrange(page, app, { token: null, mac: true });
  await openSettings(page);
  await selectSettingsSection(page, "Beeper");
  await page.getByLabel("Beeper access token").fill(TEST_TOKEN);
  await page.getByRole("button", { name: "Keep it in this app's profile instead" }).click();
  await expect(page.getByText("Token saved in this app's profile, as plain text.")).toBeVisible();
  expect(await page.evaluate((name) => localStorage.getItem(name), TOKEN_KEY)).toBe(TEST_TOKEN);
  expect(keychain.kept()).toEqual([]);
  await page.getByRole("button", { name: "Move to Keychain" }).click();
  await expect(page.getByText("Token saved in your Keychain.")).toBeVisible();
  expect(keychain.kept()).toEqual([TEST_TOKEN]);
  expect(await page.evaluate((name) => localStorage.getItem(name), TOKEN_KEY)).toBeNull();
  await page.getByRole("button", { name: "Remove token" }).click();
  await expect(page.getByLabel("Beeper access token")).toBeVisible();
  expect(keychain.kept()).toEqual([]);
});

test("a token already in the profile is offered the Keychain on a Mac", async ({ page, app }) => {
  const { keychain } = await arrange(page, app, { mac: true });
  await openPage(page, "Beeper");
  await expect(list(page).getByRole("option").first()).toBeVisible();
  await openSettings(page);
  await selectSettingsSection(page, "Beeper");
  await expect(page.getByText("Token saved in this app's profile, as plain text.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Move to Keychain" })).toBeVisible();
  expect(keychain.kept()).toEqual([]);
});

test("with the token only in the Keychain, the page needs no profile token; and Check again finds one that was put there later", async ({ page, app }) => {
  const { keychain } = await arrange(page, app, { token: null, mac: true });
  await openPage(page, "Beeper");
  await expect(page.getByRole("heading", { name: "Connect Beeper" })).toBeVisible();
  await keychain.byHand(TEST_TOKEN);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(list(page).getByRole("option").first()).toBeVisible();
});

test("the settings card takes only an address on this computer", async ({ page, app }) => {
  await arrange(page, app);
  await openSettings(page);
  await selectSettingsSection(page, "Beeper");
  await page.getByText("Address", { exact: true }).click();
  const address = page.getByLabel("Where Beeper Desktop listens");
  await address.fill("http://192.168.1.20:23373");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByRole("alert")).toContainText("Beeper Desktop runs on this computer");
  await address.fill("http://example.com");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByRole("alert")).toContainText("Beeper Desktop runs on this computer");
  const saved = await page.evaluate((name) => localStorage.getItem(name), URL_KEY);
  expect(saved).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  await address.fill("localhost:23373");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Using http://localhost:23373." })).toBeVisible();
  expect(await page.evaluate((name) => localStorage.getItem(name), URL_KEY)).toBe("http://localhost:23373");
});

test("an unreachable Beeper is told apart from a missing curl in the settings card", async ({ page, app }) => {
  const { fake, host } = await arrange(page, app);
  await fake.close();
  await openSettings(page);
  await selectSettingsSection(page, "Beeper");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("alert")).toContainText("Beeper Desktop did not answer.");
  host.curl = false;
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("alert")).toContainText("The curl program was not found");
});

for (const mode of ["Dark", "Light"]) {
  test(`${mode} mode: surfaces come from the host`, async ({ page, app }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await openInbox(page, app);
    await row(page, "Alice Example").click();
    await expect(thread(page)).toContainText("Image: photo.jpg");
    await openSettings(page);
    await selectSettingsSection(page, "Appearance");
    await chooseColorMode(page, mode);
    await closeSettings(page);
    const root = page.locator(".mtb-root");
    await expect(root).toBeVisible();
    const look = await root.evaluate((el) => {
      const style = getComputedStyle(el);
      const probe = getComputedStyle(document.documentElement);
      return { background: style.backgroundColor, hostBase: probe.getPropertyValue("--surface-base").trim(), mode: document.documentElement.getAttribute("data-color-mode") };
    });
    expect(look.mode).toBe(mode.toLowerCase());
    expect(look.hostBase).not.toBe("");
    await shot(page, `10-${mode.toLowerCase()}`);
  });
}

test("a narrow window still shows the list and the chat", async ({ page, app }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await openInbox(page, app);
  await row(page, "Alice Example").click();
  await expect(thread(page)).toContainText("Image: photo.jpg");
  await shot(page, "11-narrow");
});

test("leaving the page, or turning the plugin off and on, leaves nothing behind and stops the polling", async ({ page, app }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const counts = new Map();
    const track = (target, type, fn, capture, delta) => {
      if (typeof fn !== "function") return;
      const name = `${target === window ? "window" : target === document ? "document" : "other"}:${type}`;
      if (!["window:keydown", "document:visibilitychange"].includes(name)) return;
      const key = `${name}:${String(capture)}`;
      const fns = counts.get(key) ?? new Set();
      if (delta > 0) fns.add(fn);
      else fns.delete(fn);
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
  const { fake } = await openInbox(page, app);
  await expect(row(page, "Alice Example")).toBeVisible();
  const styles = () => page.locator("style[data-megatech-beeper]").count();
  const counts = () => page.evaluate(() => window.__listenerCounts());
  const onPage = await counts();
  expect(await styles()).toBe(1);
  await openPage(page, "Reminders");
  const away = await counts();
  expect(onPage["window:keydown:false"]).toBe(away["window:keydown:false"] + 1);
  expect(onPage["document:visibilitychange:false"]).toBe(away["document:visibilitychange:false"] + 1);
  // Away from the page, nothing is asked of Beeper.
  await page.waitForTimeout(500);
  const quiet = fake.requests.length;
  await page.waitForTimeout(8000);
  expect(fake.requests.length).toBe(quiet);
  for (let round = 0; round < 4; round += 1) {
    await openPage(page, "Beeper");
    await expect(row(page, "Alice Example")).toBeVisible();
    expect(await counts()).toEqual(onPage);
    await openPage(page, "Reminders");
    expect(await counts()).toEqual(away);
  }
  await openPage(page, "Beeper");
  expect(await styles()).toBe(1);
  await openSettings(page);
  await selectSettingsSection(page, "Manage plugins");
  for (let round = 0; round < 3; round += 1) {
    await setPluginEnabled(page, "Beeper", false);
    expect(await styles()).toBe(0);
    await setPluginEnabled(page, "Beeper", true);
    await expect.poll(styles).toBe(1);
  }
  await closeSettings(page);
  await openPage(page, "Beeper");
  await expect(row(page, "Alice Example")).toBeVisible();
  expect(await counts()).toEqual(onPage);
});

const CHATS = Number(process.env.PERF_CHATS ?? 200);

test(`key to paint stays inside 50 ms at the 99th percentile, with ${CHATS} chats`, async ({ page, app }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.addInitScript(() => {
    window.__kp = [];
    addEventListener(
      "keydown",
      (event) => {
        if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
        const t0 = performance.now();
        requestAnimationFrame(() => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => window.__kp.push(performance.now() - t0);
          channel.port2.postMessage(0);
        });
      },
      true, // on the window, in capture: before any listener of the page or the plugin
    );
  });
  await openInbox(page, app, { world: makeWorld({ chats: CHATS, messages: 30, now: NOW }) });
  await expect(list(page).getByRole("option").first()).toBeVisible();
  const press = async (key, count) => {
    const start = await page.evaluate(() => window.__kp.length);
    for (let i = 0; i < count; i += 1) {
      await page.keyboard.press(Array.isArray(key) ? key[i % key.length] : key);
      await page.waitForFunction((n) => window.__kp.length >= n, start + i + 1);
    }
    return page.evaluate((s) => window.__kp.slice(s), start);
  };
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const r = (x) => Math.round(x * 100) / 100;
    return { n: sorted.length, median: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), max: r(sorted.at(-1)) };
  };
  const runs = {};
  // The control: a key nothing listens to. It is the floor of this machine and browser, not of the plugin.
  runs["x (no listener: the floor)"] = await press("x", 60);
  runs["j (first 20, the list just shown)"] = await press("j", 20);
  runs["j (next 100)"] = await press("j", 100);
  runs["k (100)"] = await press("k", 100);
  runs["ArrowDown / ArrowUp (100)"] = await press(["ArrowDown", "ArrowUp"], 100);
  // Open a chat and close it again, a few times: Enter opens it, Escape leaves the box, Escape closes it.
  // This is the time to the next frame; the messages arrive from Beeper after it.
  const openClose = [];
  for (let i = 0; i < 20; i += 1) {
    openClose.push(...(await press("Enter", 1)));
    await expect(thread(page)).toBeVisible();
    openClose.push(...(await press("Escape", 1)));
    openClose.push(...(await press("Escape", 1)));
    openClose.push(...(await press("j", 1)));
  }
  runs["Enter and Esc (open, close)"] = openClose;
  runs["/ then Esc (filter)"] = await press(["/", "Escape"], 40);
  runs["u (unread only, on and off)"] = await press("u", 40);
  const summary = Object.fromEntries(Object.entries(runs).map(([name, values]) => [name, stats(values)]));
  info.annotations.push({ type: "key-to-paint", description: JSON.stringify(summary) });
  console.log("key-to-paint (ms)", JSON.stringify(summary, null, 2));
  const all = stats(Object.entries(runs).filter(([name]) => !name.startsWith("x ")).flatMap(([, values]) => values));
  console.log("all keys", JSON.stringify(all));
  // The budget is the project's, 50 ms. It depends on the machine (the control above is what this one's floor is), so a slow or busy
  // one can be given more room with PERF_P99_MS, and the number it was run with is in the report above.
  const budget = Number(process.env.PERF_P99_MS ?? 50);
  expect(all.p99).toBeLessThanOrEqual(budget);
  // Per kind of key too, at the 95th percentile: with 100 samples the 99th is the single worst one, which one stray pause of a busy machine decides.
  for (const [name, values] of Object.entries(summary)) if (!name.startsWith("x ") && values.n >= 100) expect(values.p95, name).toBeLessThanOrEqual(budget);
});
