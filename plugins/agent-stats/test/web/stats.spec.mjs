// Drives Agent Stats in Buzz's own web build (headless Chromium, fixture relay): an agent's telemetry is encrypted to the viewer by the
// harness and delivered on the owner-only route, decrypted by the host, and added up on the plugin's page. Run with
// plugins/agent-stats/test/run.sh.
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";
import { closeSettings, openPage } from "./navigation.mjs";
import { pluginAction } from "./plugin-settings.mjs";
import { generateSecretKey, getPublicKey } from "nostr-tools";

test.use({ pluginFixtures: true, productionBroker: true });

const at = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const frame = (kind, turnId, extra = {}) => ({ kind, seq: 1, channelId: "alpha", sessionId: "S", turnId, timestamp: at(), ...extra });
const acp = (turnId, update) => frame("acp_read", turnId, { payload: { method: "session/update", params: { update } } });
const card = (page, agent) => page.locator(`[data-agent-stats="page"] [data-agent="${agent}"]`);
const badge = (scope, word) => scope.locator(".megatech-agent-stats__badge", { hasText: word });
const value = (scope, label) => scope.locator(".megatech-agent-stats__item", { has: scope.page().getByText(label, { exact: true }) }).locator("dd");
const openPlugins = async (page) => {
  await page.getByRole("button", { name: "Your profile", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Manage plugins", exact: true }).click();
};
const model = { category: "model", id: "model", name: "Model", currentValue: "m1", options: [{ value: "m1", name: "Model One" }] };

// The spec sends turns that began seconds ago and expects them to be today's. A run that starts within two minutes of local midnight would
// see them fall on the other side of it, so it waits that out.
async function stayClearOfMidnight(testInfo) {
  const now = new Date();
  const sinceMidnight = now - new Date(now).setHours(0, 0, 0, 0);
  const untilMidnight = new Date(now).setHours(24, 0, 0, 0) - now;
  const wait = untilMidnight < 120_000 ? untilMidnight + 60_000 : sinceMidnight < 60_000 ? 60_000 - sinceMidnight : 0;
  if (!wait) return;
  testInfo.setTimeout(testInfo.timeout + wait);
  await new Promise((resolve) => setTimeout(resolve, wait));
}

async function start(page, app) {
  await stayClearOfMidnight(test.info());
  await open(page, app);
  await expect.poll(() => app.relay.hasRoute("primary", "observer")).toBe(true);
  const key = generateSecretKey();
  return { key, agent: getPublicKey(key) };
}

test("a turn is added up on the page as it happens: working, what it runs, the model, the context window, then idle", async ({ page, app }, testInfo) => {
  const { key, agent } = await start(page, app);
  app.observer(frame("turn_started", "t1", { startedAt: at(-40_000) }), key);
  app.observer(frame("session_config_captured", "t1", { payload: { configOptions: [model] } }), key);
  app.observer(acp("t1", { sessionUpdate: "tool_call", toolCallId: "c1", title: "buzz-dev-mcp__shell", kind: "other", status: "in_progress", rawInput: { command: "npm test --token=hunter2\nsecond line" } }), key);
  app.observer(acp("t1", { sessionUpdate: "usage_update", used: 50_000, size: 200_000 }), key);
  await openPage(page, "Agent stats");
  const mine = card(page, agent);
  await expect(mine).toBeVisible();
  await expect(badge(mine, "Working")).toBeVisible();
  await expect(value(mine, "Turns today")).toHaveText("1");
  await expect(value(mine, "Commands run")).toHaveText("1");
  await expect(value(mine, "Doing now")).toHaveText("Command · npm");
  await expect(page.locator('[data-agent-stats="page"]')).not.toContainText("hunter2");
  await expect(value(mine, "Model")).toHaveText("Model One");
  await expect(value(mine, "Context window used")).toHaveText("25% of 200,000");
  await expect(value(mine, "Time working")).toHaveText(/^(?:[4-5]\ds|1m [0-5]\ds)$/);
  await expect(page.getByText("Listening to your agents.", { exact: true })).toBeVisible();
  await expect(mine.getByRole("heading", { level: 2 })).toContainText(`Agent ${agent.slice(0, 8)}`);

  app.observer(acp("t1", { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" }), key);
  app.observer(frame("turn_completed", "t1", { payload: { outcome: "completed" } }), key);
  await expect(badge(mine, "Idle")).toBeVisible();
  await expect(mine.locator(".megatech-agent-stats__item", { hasText: "Doing now" })).toHaveCount(0);
  await expect(value(mine, "Commands run")).toHaveText("1");
  await expect(value(mine, "Last active")).toHaveText("just now");
  const elapsed = await value(mine, "Time working").innerText();
  await page.waitForTimeout(1500);
  await expect(value(mine, "Time working")).toHaveText(elapsed);
});

test("several agents are listed, the one working first, and a second turn of the same agent adds to the first", async ({ page, app }) => {
  const { key, agent } = await start(page, app);
  const otherKey = generateSecretKey();
  const other = getPublicKey(otherKey);
  app.observer(frame("turn_started", "a1", { startedAt: at(-5_000) }), key);
  app.observer(frame("turn_completed", "a1"), key);
  app.observer(frame("turn_started", "a2", { startedAt: at(-2_000) }), key);
  app.observer(frame("turn_started", "b1", { startedAt: at(-1_000) }), otherKey);
  app.observer(frame("turn_completed", "b1"), otherKey);
  app.observer(frame("turn_liveness", "a2"), key);
  await openPage(page, "Agent stats");
  await expect(value(card(page, agent), "Turns today")).toHaveText("2");
  await expect(value(card(page, other), "Turns today")).toHaveText("1");
  await expect(badge(card(page, agent), "Working")).toBeVisible();
  await expect(badge(card(page, other), "Idle")).toBeVisible();
  // A working agent and an idle one lay their figures out alike: the task is a line of its own, not a cell that spans the grid.
  const first = async (agentKey) => (await card(page, agentKey).locator(".megatech-agent-stats__item", { hasText: "Turns today" }).boundingBox()).width;
  expect(Math.abs((await first(agent)) - (await first(other)))).toBeLessThan(1);
  await expect(card(page, agent).locator(".megatech-agent-stats__grid .megatech-agent-stats__item", { hasText: "Doing now" })).toHaveCount(0);
  const order = await page.locator('[data-agent-stats="page"] [data-agent]').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-agent")));
  expect(order).toEqual([agent, other]);
});

test("the plugin takes its own lease on the telemetry: with Agent Activity off it still counts, and turning it off lets go", async ({ page, app }) => {
  const { key, agent } = await start(page, app);
  await openPlugins(page);
  const activity = pluginAction(page, "Agent Activity");
  await activity.click();
  await expect(activity).toHaveAccessibleName("Enable Agent Activity");
  await expect.poll(() => app.relay.hasRoute("primary", "observer"), "Agent Stats still listens").toBe(true);
  app.observer(frame("turn_started", "t1", { startedAt: at(-3_000) }), key);
  app.observer(frame("turn_completed", "t1"), key);
  await closeSettings(page);
  await openPage(page, "Agent stats");
  await expect(value(card(page, agent), "Turns today")).toHaveText("1");

  await openPlugins(page);
  const stats = pluginAction(page, "Agent Stats");
  const withdrawn = page.waitForResponse((response) => response.url().endsWith("/stream-observer") && response.ok() && response.request().postDataJSON().observer === null);
  await stats.click();
  await withdrawn;
  await expect.poll(() => app.relay.hasRoute("primary", "observer")).toBe(false);
  await stats.click();
  await expect(stats).toHaveAccessibleName("Disable Agent Stats");
  await expect.poll(() => app.relay.hasRoute("primary", "observer")).toBe(true);
  await closeSettings(page);
  await openPage(page, "Agent stats");
  await expect(value(card(page, agent), "Turns today"), "the day's tally is there after turning the plugin off and on").toHaveText("1");
});

test("the day's tally survives a restart of the app", async ({ page, app }) => {
  const { key, agent } = await start(page, app);
  app.observer(frame("turn_started", "t1", { startedAt: at(-4_000) }), key);
  app.observer(acp("t1", { sessionUpdate: "tool_call", toolCallId: "c1", title: "Bash", kind: "execute" }), key);
  app.observer(frame("turn_completed", "t1"), key);
  await openPage(page, "Agent stats");
  await expect(value(card(page, agent), "Commands run")).toHaveText("1");
  await page.waitForTimeout(1500); // the tally is saved a moment after it changes
  await open(page, app); // loads the page again, as a restart does
  await openPage(page, "Agent stats");
  await expect(value(card(page, agent), "Turns today")).toHaveText("1");
  await expect(value(card(page, agent), "Commands run")).toHaveText("1");
  await expect(badge(card(page, agent), "Idle")).toBeVisible();
});

test("an empty page says so, frames it should not count are ignored, and the page is the plugin's own with no request of its own", async ({ page, app }) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const { key, agent } = await start(page, app);
  await openPage(page, "Agent stats");
  await expect(page.getByText("No agent has reported yet.", { exact: false })).toBeVisible();
  app.observer({ kind: "turn_started", turnId: "x".repeat(300), timestamp: at() }, key);
  app.observer(frame("agent_management_request", "m1"), key);
  app.observer(frame("turn_started", "t1", { startedAt: at(-1_000) }), key);
  await expect(value(card(page, agent), "Turns today")).toHaveText("1");
  expect(requests.filter((url) => /stats/i.test(new URL(url).pathname))).toEqual([]);
});

test("nothing from a command's arguments or settings reaches the page, however the command is written", async ({ page, app }) => {
  const { key, agent } = await start(page, app);
  app.observer(frame("turn_started", "t1", { startedAt: at(-3_000) }), key);
  await openPage(page, "Agent stats");
  const run = (id, command) => app.observer(acp("t1", { sessionUpdate: "tool_call", toolCallId: id, title: "buzz-dev-mcp__shell", kind: "other", status: "in_progress", rawInput: { command } }), key);
  run("c0", "npm test --token=hunter2");
  await expect(value(card(page, agent), "Doing now")).toHaveText("Command · npm");
  const unsure = ['API_KEY="s3cr3t value" make test', 'FOO="a b c" npm test', "A=$(cat /etc/secret) go test", "--token=abc"];
  for (const [index, command] of unsure.entries()) {
    run(`d${index}`, command);
    // The program cannot be told for certain, so the line says only that a command is running.
    await expect(value(card(page, agent), "Doing now")).toHaveText("Command");
    await expect(page.locator('[data-agent-stats="page"]')).not.toContainText(/s3cr3t|hunter2|secret|--token|abc|value/);
  }
  await expect(value(card(page, agent), "Commands run")).toHaveText("5");
});

test("the host registers the plugin's tab for an agent's profile", async ({ page, app }) => {
  await open(page, app);
  const tabs = await page.evaluate(() => window.__statsCtx.agents.addedTabs().map((tab) => ({ plugin: tab.pluginId ?? tab.plugin ?? null, id: tab.id ?? tab.value?.id, title: tab.title ?? tab.value?.title })));
  expect(tabs.map((tab) => tab.title)).toContain("Stats");
});

// Reads the colours as the browser paints them (a canvas turns any CSS colour into sRGB), and the ratio WCAG asks of text: 4.5 to 1.
async function contrastOf(page, selectors) {
  return page.evaluate((list) => {
    const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const rgba = (css) => {
      canvas.clearRect(0, 0, 1, 1);
      canvas.fillStyle = "#000";
      canvas.fillStyle = css;
      canvas.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const over = (top, below) => ({ r: top.r * top.a + below.r * (1 - top.a), g: top.g * top.a + below.g * (1 - top.a), b: top.b * top.a + below.b * (1 - top.a), a: 1 });
    const luminance = ({ r, g, b }) => {
      const channel = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const backgroundOf = (element) => {
      const layers = [];
      for (let node = element; node; node = node.parentElement) {
        const color = rgba(getComputedStyle(node).backgroundColor);
        if (color.a > 0) layers.push(color);
        if (color.a >= 1) break;
      }
      return layers.reduceRight((below, layer) => over(layer, below), rgba(getComputedStyle(document.documentElement).backgroundColor));
    };
    return list.flatMap((selector) =>
      [...document.querySelectorAll(selector)].map((element) => {
        const style = getComputedStyle(element);
        const ink = over({ ...rgba(style.color), a: rgba(style.color).a * Number(style.opacity) }, backgroundOf(element));
        const [hi, lo] = [luminance(ink), luminance(backgroundOf(element))].sort((a, b) => b - a);
        return { selector, text: element.textContent.trim().slice(0, 30), ratio: (hi + 0.05) / (lo + 0.05) };
      }),
    );
  }, selectors);
}

test("the page reads in light and dark: every text has 4.5 to 1 against what is behind it, and it fits a narrow window", async ({ page, app }) => {
  const { key, agent } = await start(page, app);
  const otherKey = generateSecretKey();
  app.observer(frame("turn_started", "t1", { startedAt: at(-40_000) }), key);
  app.observer(frame("session_config_captured", "t1", { payload: { configOptions: [model] } }), key);
  app.observer(acp("t1", { sessionUpdate: "tool_call", toolCallId: "c1", title: "buzz-dev-mcp__shell", kind: "other", status: "in_progress", rawInput: { command: "npm test" } }), key);
  app.observer(acp("t1", { sessionUpdate: "usage_update", used: 84_000, size: 200_000 }), key);
  app.observer(frame("turn_started", "b1", { startedAt: at(-300_000) }), otherKey);
  app.observer(acp("b1", { sessionUpdate: "tool_call", toolCallId: "d1", title: "Bash", kind: "execute" }), otherKey);
  app.observer(frame("turn_completed", "b1"), otherKey);
  await openPage(page, "Agent stats");
  await expect(value(card(page, agent), "Doing now")).toHaveText("Command · npm");
  const text = [".megatech-agent-stats__title", ".megatech-agent-stats__note", ".megatech-agent-stats__status", ".megatech-agent-stats__name", ".megatech-agent-stats__badge", ".megatech-agent-stats__label", ".megatech-agent-stats__value"];
  for (const mode of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: mode });
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
    const found = await contrastOf(page, text);
    expect(new Set(found.map((entry) => entry.selector)).size, "every kind of text was measured").toBe(text.length);
    for (const entry of found) expect(entry.ratio, `${mode}: ${entry.selector} "${entry.text}"`).toBeGreaterThanOrEqual(4.5);
    if (process.env.SHOTS) await page.locator('[data-agent-stats="page"]').screenshot({ path: `${process.env.SHOTS}/page-${mode}.png` });
  }
  // A narrow window: the page neither scrolls sideways nor lets a number run out of its card.
  await page.setViewportSize({ width: 420, height: 800 });
  const overflow = await page.locator('[data-agent-stats="page"]').evaluate((root) => ({ page: root.scrollWidth - root.clientWidth, cards: [...root.querySelectorAll(".megatech-agent-stats__card")].map((node) => node.scrollWidth - node.clientWidth) }));
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(Math.max(...overflow.cards)).toBeLessThanOrEqual(0);
});
