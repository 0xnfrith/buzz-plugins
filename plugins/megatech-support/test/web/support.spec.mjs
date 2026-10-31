// Drives the Megatech support plugin in the real Buzz web build (headless Chromium, fixture relay) with a fake service behind
// `ctx.host.request` and a fake host behind `ctx.host.prepareRemoteAgentAuthorization` (a made-up user whose key really signs, and a
// service that really checks the signature). Run with plugins/megatech-support/test/run.sh.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { test, expect } from "./fixture.mjs";
import { chooseColorMode, closeSettings, openPage, openSettings, selectSettingsSection } from "./navigation.mjs";

const dir = process.env.SUPPORT_PLUGIN_DIR;
const { createFakeSupport, createFakeHost, createUser, derive } = await import(pathToFileURL(join(dir, "test/fake-support/server.mjs")).href);
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

test.use({ pluginFixtures: true });
// The first page of a run waits for the harness to warm its caches, and a shared runner is slow: give each test and each wait room.
test.describe.configure({ timeout: 120_000 });

const SWITCH_KEY = "megatech.support.agent.v1";
const SECRET = /SECRET-(SERVICE|HOST)-WORDING/;
const ASK = "megatech_support_ask_or_open";
const STATUS = "megatech_support_ticket_status";

/**
 * A page wired to a fresh fake service and a fake host. `saved` is what the profile has kept of the agent switch ("on" or "off")
 * before the page loads, once per tab: a reload is a new start of the plugin. `mode` is how the fake host answers the attestation
 * call (see createFakeHost), and `missing` takes the call away.
 */
async function arrange(page, { app, saved, mode = "", missing = false } = {}) {
  page.setDefaultTimeout(30_000);
  const fake = createFakeSupport();
  const user = createUser(`web-${Math.random()}`);
  const host = createFakeHost({ user, mode });
  // What the page prints and what it asks the network for: the plugin reaches the service only through the host, so neither may carry
  // the session or name the service.
  const seen = { console: [], requests: [] };
  page.on("console", (message) => seen.console.push(message.text()));
  page.on("request", (request) => seen.requests.push(request.url()));
  // `delays` makes the service slow for a path (milliseconds), so a test can leave a tab while its request is out.
  fake.delays = new Map();
  await page.exposeFunction("__supportRequest", async (request) => {
    const wait = fake.delays.get(new URL(request.url).pathname);
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    return fake.handle(request);
  });
  await page.exposeFunction("__supportAuthorize", (agent) => host.prepareRemoteAgentAuthorization(agent));
  await page.addInitScript(
    ([viewer, hostMissing]) => {
      window.__supportViewer = viewer;
      window.__supportHostMissing = hostMissing;
    },
    [user.pubkey, missing],
  );
  if (saved)
    await page.addInitScript(
      ([name, value]) => {
        if (sessionStorage.getItem("__support-seeded")) return;
        sessionStorage.setItem("__support-seeded", "1");
        localStorage.setItem(name, value);
      },
      [SWITCH_KEY, saved],
    );
  await page.goto(app.origin, { timeout: 90_000, waitUntil: "domcontentloaded" });
  return Object.assign(fake, { user, host, seen });
}

const verifyButton = (page) => page.getByRole("button", { name: "Verify with Megatech support" });

async function openSupport(page, app, options) {
  const fake = await arrange(page, { app, ...options });
  await openPage(page, "Megatech support");
  return fake;
}

async function verified(page, app, options) {
  const fake = await openSupport(page, app, options);
  await verifyButton(page).click();
  await expect(page.getByRole("tab", { name: "Ask" })).toBeVisible();
  return fake;
}

test("the page asks to verify first, says what pressing Verify does, and sends nothing before it", async ({ page, app }) => {
  await page.setViewportSize({ width: 1300, height: 860 });
  const fake = await openSupport(page, app);
  await expect(page.getByRole("heading", { name: "Verify your identity" })).toBeVisible();
  await expect(page.getByText("sends your public key")).toBeVisible();
  await expect(page.getByText("support.megatech.invalid").first()).toBeVisible();
  await expect(page.getByText("Nothing is published to your community", { exact: false })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Ask" })).toHaveCount(0);
  await shot(page, "01-verify");
  // Nothing has gone to the service, and Buzz has not been asked to sign anything.
  expect(fake.log).toEqual([]);
  expect(fake.host.calls).toEqual([]);
});

test("Verify has Buzz attest to a hash of the service's code, and the service accepts it", async ({ page, app }) => {
  const fake = await openSupport(page, app);
  await verifyButton(page).click();
  await expect(page.getByRole("tab", { name: "Ask" })).toBeVisible();
  expect(fake.log.map((entry) => entry.path)).toEqual(["/v1/identity/challenge", "/v1/identity/verify"]);
  expect(fake.sessions.size).toBe(1);
  const [challenge] = [...fake.challenges.keys()];
  // Buzz was asked about one value, the hash of the code: not the code, and not a key.
  expect(fake.host.calls).toEqual([derive(challenge)]);
  expect(fake.log[1].body.auth).toEqual(fake.host.answers[0]);
  expect(fake.log[1].body.pubkey).toBe(fake.user.pubkey);
  // The session token never reaches the page's text.
  const [token] = [...fake.sessions.keys()];
  expect(await page.locator("body").innerText()).not.toContain(token);
  await shot(page, "02-verified");
  // Use the session, so the token has been in a request header, and look for it everywhere the page can leak it.
  await page.getByLabel("Your question").fill("How do I reset my password?");
  await page.getByRole("button", { name: "Ask support" }).click();
  await expect(page.getByRole("status", { name: "Support's reply" })).toBeVisible();
  const [challengeCode] = [...fake.challenges.keys()];
  expect(await page.locator("html").innerHTML()).not.toContain(token);
  expect(fake.seen.console.join("\n")).not.toContain(token);
  expect(fake.seen.console.join("\n")).not.toContain(challengeCode);
  expect(fake.seen.requests.join("\n")).not.toContain(token);
  // The page makes no request of its own to the service: everything went through the host's declared route.
  expect(fake.seen.requests.filter((url) => url.includes("megatech"))).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))).not.toContain(token);
});

test("a refused identity check says so in fixed words and the page stays on the Verify card", async ({ page, app }) => {
  const fake = await openSupport(page, app);
  fake.refuseVerify = true;
  await verifyButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("Megatech support did not accept the identity check.");
  await expect(page.getByRole("tab", { name: "Ask" })).toHaveCount(0);
  expect(fake.sessions.size).toBe(0);
  fake.refuseVerify = false;
  await verifyButton(page).click();
  await expect(page.getByRole("tab", { name: "Ask" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("when Buzz answers in a form the plugin does not accept, the check fails closed", async ({ page, app }) => {
  const fake = await openSupport(page, app, { mode: "other-owner" });
  await verifyButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("Buzz answered the identity check in a form Megatech support does not accept.");
  await expect(page.getByRole("tab", { name: "Ask" })).toHaveCount(0);
  // The service was asked for a code, and given nothing: no verify call, no session.
  expect(fake.log.map((entry) => entry.path)).toEqual(["/v1/identity/challenge"]);
  expect(fake.sessions.size).toBe(0);
  await shot(page, "03-failed-closed");
  fake.host.mode = "";
  await verifyButton(page).click();
  await expect(page.getByRole("tab", { name: "Ask" })).toBeVisible();
});

test("a Buzz without the attestation call says so and never reaches the service's verify", async ({ page, app }) => {
  const fake = await openSupport(page, app, { missing: true });
  await verifyButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("This version of Buzz cannot check your identity for Megatech support.");
  expect(fake.sessions.size).toBe(0);
  // The service is not even asked for a code it could not use, so it is not sent the key.
  expect(fake.log).toEqual([]);
});

test("asking shows the answer and the ticket, or says a ticket is open when there is no answer yet", async ({ page, app }) => {
  const fake = await verified(page, app);
  await page.getByLabel("Your question").fill("How do I reset my password?");
  await page.getByRole("button", { name: "Ask support" }).click();
  const reply = page.getByRole("status", { name: "Support's reply" });
  await expect(reply).toContainText("reset it from Account");
  await expect(reply).toContainText(/Ticket T-\d+/);
  await expect(page.getByLabel("Your question")).toHaveValue("");
  await shot(page, "04-answer");
  await page.getByLabel("Your question").fill("My order is late");
  await page.getByRole("button", { name: "Ask support" }).click();
  await expect(reply).toContainText("No answer yet");
  await expect(reply).not.toContainText("reset it from Account");
  expect(fake.ticketsOf(fake.user.pubkey)).toHaveLength(2);
});

test("an error from the service shows fixed words, never the service's own", async ({ page, app }) => {
  const fake = await verified(page, app);
  fake.fail("/v1/ask", { status: 500, body: { error: { message: "SECRET-SERVICE-WORDING" } } });
  await page.getByLabel("Your question").fill("hello");
  await page.getByRole("button", { name: "Ask support" }).click();
  await expect(page.getByRole("alert")).toHaveText("Megatech support is having trouble right now.");
  expect(await page.locator("body").innerText()).not.toMatch(SECRET);
  // The question is kept, so it can be sent again.
  await expect(page.getByLabel("Your question")).toHaveValue("hello");
  await page.getByRole("button", { name: "Ask support" }).click();
  await expect(page.getByRole("status", { name: "Support's reply" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("opening a ticket makes one ticket even when the first try failed", async ({ page, app }) => {
  const fake = await verified(page, app);
  await page.getByRole("tab", { name: "Open a ticket" }).click();
  await page.getByLabel("Subject").fill("Printer on fire");
  await page.getByLabel("What happened").fill("It started at noon.");
  fake.fail("/v1/tickets", { status: 503, body: {} });
  await page.getByRole("button", { name: "Open ticket" }).click();
  await expect(page.getByRole("alert")).toHaveText("Megatech support is having trouble right now.");
  await page.getByRole("button", { name: "Open ticket" }).click();
  await expect(page.getByRole("status", { name: "Ticket opened" })).toContainText(/Ticket T-\d+ is open/);
  const keys = fake.log.filter((entry) => entry.path === "/v1/tickets" && entry.method === "POST").map((entry) => entry.headers["idempotency-key"]);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(fake.ticketsOf(fake.user.pubkey)).toHaveLength(1);
  await expect(page.getByLabel("Subject")).toHaveValue("");
  await shot(page, "05-opened");
});

test("an Ask that ends after its tab was left still clears the box, so pressing Ask again is not a second ticket", async ({ page, app }) => {
  const fake = await verified(page, app);
  fake.delays.set("/v1/ask", 1500);
  await page.getByLabel("Your question").fill("My order is late");
  await page.getByRole("button", { name: "Ask support" }).click();
  await page.getByRole("tab", { name: "My tickets" }).click();
  await expect.poll(() => fake.ticketsOf(fake.user.pubkey).length).toBe(1);
  await page.getByRole("tab", { name: "Ask" }).click();
  // The answer reaches the page after the tab was left: the box is empty and the result is there when the tab is back.
  await expect(page.getByLabel("Your question")).toHaveValue("");
  await expect(page.getByRole("status", { name: "Support's reply" })).toContainText(/Ticket T-\d+/);
  await expect(page.getByRole("button", { name: "Ask support" })).toBeDisabled();
  expect(fake.ticketsOf(fake.user.pubkey)).toHaveLength(1);
  const keys = fake.log.filter((entry) => entry.path === "/v1/ask").map((entry) => entry.headers["idempotency-key"]);
  expect(keys).toHaveLength(1);
});

test("coming back to a tab whose request is still out does not offer its button again", async ({ page, app }) => {
  const fake = await verified(page, app);
  fake.delays.set("/v1/ask", 2000);
  await page.getByLabel("Your question").fill("My order is late");
  await page.getByRole("button", { name: "Ask support" }).click();
  await expect(page.getByRole("button", { name: "Asking…" })).toBeDisabled();
  await page.getByRole("tab", { name: "Open a ticket" }).click();
  await page.getByRole("tab", { name: "Ask" }).click();
  // The text is still there (the request has not ended) and the button is still off: a second press cannot happen.
  await expect(page.getByLabel("Your question")).toHaveValue("My order is late");
  await expect(page.getByRole("button", { name: "Asking…" })).toBeDisabled();
  await expect(page.getByRole("status", { name: "Support's reply" })).toContainText(/Ticket T-\d+/);
  await expect(page.getByRole("button", { name: "Ask support" })).toBeDisabled();
  expect(fake.log.filter((entry) => entry.path === "/v1/ask")).toHaveLength(1);
  expect(fake.ticketsOf(fake.user.pubkey)).toHaveLength(1);

  // The same for opening a ticket.
  await page.getByRole("tab", { name: "Open a ticket" }).click();
  await page.getByLabel("Subject").fill("Printer on fire");
  await page.getByLabel("What happened").fill("It started at noon.");
  fake.delays.set("/v1/tickets", 2000);
  await page.getByRole("button", { name: "Open ticket" }).click();
  await expect(page.getByRole("button", { name: "Opening…" })).toBeDisabled();
  await page.getByRole("tab", { name: "Ask" }).click();
  await page.getByRole("tab", { name: "Open a ticket" }).click();
  await expect(page.getByRole("button", { name: "Opening…" })).toBeDisabled();
  await expect(page.getByRole("status", { name: "Ticket opened" })).toContainText(/Ticket T-\d+ is open/);
  expect(fake.log.filter((entry) => entry.path === "/v1/tickets" && entry.method === "POST")).toHaveLength(1);
  expect(fake.ticketsOf(fake.user.pubkey)).toHaveLength(2);
});

test("a slow answer for a ticket that was left does not replace the ticket now open", async ({ page, app }) => {
  const fake = await verified(page, app);
  await page.getByRole("tab", { name: "Open a ticket" }).click();
  for (const [subject, body] of [["First ticket", "one"], ["Second ticket", "two"]]) {
    await page.getByLabel("Subject").fill(subject);
    await page.getByLabel("What happened").fill(body);
    await page.getByRole("button", { name: "Open ticket" }).click();
    await expect(page.getByRole("status", { name: "Ticket opened" })).toContainText(subject === "First ticket" ? "T-1001" : "T-1002");
  }
  await page.getByRole("tab", { name: "My tickets" }).click();
  const list = page.getByRole("list", { name: "Your tickets" });
  await expect(list.getByRole("button")).toHaveCount(2);
  fake.delays.set("/v1/tickets/T-1001", 2000);
  await list.getByRole("button", { name: /T-1001/ }).click();
  await page.getByRole("button", { name: "Back to my tickets" }).click();
  await list.getByRole("button", { name: /T-1002/ }).click();
  await expect(page.getByRole("region", { name: "Ticket T-1002" })).toContainText("two");
  // The slow answer for the first ticket arrives now, and changes nothing.
  await page.waitForTimeout(2500);
  await expect(page.getByRole("region", { name: "Ticket T-1002" })).toContainText("two");
  await expect(page.getByRole("region", { name: "Ticket T-1001" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("My tickets lists them, opens one with its messages, and shows a reply after Refresh", async ({ page, app }) => {
  const fake = await verified(page, app);
  await page.getByRole("tab", { name: "Open a ticket" }).click();
  await page.getByLabel("Subject").fill("Printer on fire");
  await page.getByLabel("What happened").fill("It started at noon.");
  await page.getByRole("button", { name: "Open ticket" }).click();
  await expect(page.getByRole("status", { name: "Ticket opened" })).toBeVisible();
  await page.getByRole("tab", { name: "My tickets" }).click();
  const list = page.getByRole("list", { name: "Your tickets" });
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(list).toContainText("Printer on fire");
  await expect(list).toContainText("open");
  await shot(page, "06-tickets");
  await list.getByRole("button").click();
  const messages = page.getByRole("list", { name: "Messages" });
  await expect(messages.getByRole("listitem")).toHaveCount(1);
  await expect(messages).toContainText("It started at noon.");
  const [{ ticket_id }] = fake.ticketsOf(fake.user.pubkey);
  fake.reply(fake.user.pubkey, ticket_id, "We are sending a fire extinguisher.", "answered");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(messages.getByRole("listitem")).toHaveCount(2);
  await expect(messages).toContainText("We are sending a fire extinguisher.");
  await expect(page.getByRole("region", { name: `Ticket ${ticket_id}` })).toContainText("answered");
  await shot(page, "07-ticket");
  await page.getByRole("button", { name: "Back to my tickets" }).click();
  await expect(list).toBeVisible();
});

test("when the service forgets the session the page goes back to the Verify card", async ({ page, app }) => {
  const fake = await verified(page, app);
  fake.sessions.clear();
  await page.getByRole("tab", { name: "My tickets" }).click();
  await expect(page.getByRole("heading", { name: "Verify your identity" })).toBeVisible();
  await verifyButton(page).click();
  await expect(page.getByRole("tab", { name: "Ask" })).toBeVisible();
  expect(fake.sessions.size).toBe(1);
});

test("a session that ends in the middle of a form says so and keeps what was typed", async ({ page, app }) => {
  const fake = await verified(page, app);
  await page.getByRole("tab", { name: "Open a ticket" }).click();
  await page.getByLabel("Subject").fill("Printer on fire");
  await page.getByLabel("What happened").fill("It started at noon.");
  fake.sessions.clear();
  await page.getByRole("button", { name: "Open ticket" }).click();
  await expect(page.getByRole("heading", { name: "Verify your identity" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "session ended" })).toContainText("what you typed is still here");
  await verifyButton(page).click();
  await expect(page.getByRole("tab", { name: "Open a ticket" })).toBeVisible();
  await page.getByRole("tab", { name: "Open a ticket" }).click();
  await expect(page.getByLabel("Subject")).toHaveValue("Printer on fire");
  await expect(page.getByLabel("What happened")).toHaveValue("It started at noon.");
  await page.getByRole("button", { name: "Open ticket" }).click();
  await expect(page.getByRole("status", { name: "Ticket opened" })).toBeVisible();
  expect(fake.ticketsOf(fake.user.pubkey)).toHaveLength(1);
});

test("the tabs follow the arrow keys, Home and End, and only the chosen one is in the tab order", async ({ page, app }) => {
  await verified(page, app);
  const tab = (name) => page.getByRole("tab", { name });
  await tab("Ask").focus();
  await expect(tab("Ask")).toHaveAttribute("tabindex", "0");
  await expect(tab("Open a ticket")).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowRight");
  await expect(tab("Open a ticket")).toHaveAttribute("aria-selected", "true");
  await expect(tab("Open a ticket")).toBeFocused();
  await page.keyboard.press("End");
  await expect(tab("My tickets")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tab("Ask")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab("My tickets")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab("Ask")).toBeFocused();
  // The selected tab points at a panel that exists, and the others at nothing.
  await expect(tab("Ask")).toHaveAttribute("aria-controls", "mts-panel");
  await expect(page.locator("#mts-panel")).toHaveCount(1);
  await expect(tab("My tickets")).not.toHaveAttribute("aria-controls", /./);
});

test("the Settings card shows the identity and keeps the agent switch off until it is turned on", async ({ page, app }) => {
  await page.setViewportSize({ width: 1300, height: 860 });
  const fake = await arrange(page, { app });
  await openSettings(page);
  await selectSettingsSection(page, "Megatech support");
  const card = page.getByRole("region", { name: "Megatech support" });
  await expect(card.getByRole("status").first()).toHaveText(/Not verified/);
  await expect(card.getByRole("switch")).not.toBeChecked();
  // The card's title is a heading, and its two sections are one level below it.
  await expect(card.getByRole("heading", { level: 2, name: "Megatech support" })).toBeVisible();
  await expect(card.getByRole("heading", { level: 3, name: "Identity" })).toBeVisible();
  await expect(card.getByRole("heading", { level: 3, name: "Megatech support agent" })).toBeVisible();
  await expect(card.getByRole("heading", { level: 2 })).toHaveCount(1);
  // It says what the tools cannot do, and when they are added.
  await expect(card.getByText("An agent cannot tell who asked it", { exact: false })).toBeVisible();
  await expect(card.getByText("when Buzz starts, or when the plugin is turned off and on or updated", { exact: false })).toBeVisible();
  await shot(page, "08-settings-off");
  // Verify from the card.
  await card.getByRole("button", { name: "Verify with Megatech support" }).click();
  await expect(card.getByRole("status").first()).toContainText("Verified with Megatech support until");
  await expect(card.getByRole("button", { name: "Forget" })).toBeVisible();
  expect(fake.sessions.size).toBe(1);
  await card.getByRole("button", { name: "Forget" }).click();
  await expect(card.getByRole("status").first()).toHaveText(/Not verified/);
  // Forget also asks the service to end the session.
  await expect.poll(() => fake.log.filter((entry) => entry.path === "/v1/identity/logout").length).toBe(1);
  expect(fake.sessions.size).toBe(0);
  // The switch is saved at once and takes effect at the next start.
  await card.getByRole("switch").check();
  await expect(card.getByText("Restart Buzz to turn this on.")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), SWITCH_KEY)).toBe("on");
  // Nothing was added to the running app.
  expect(await page.evaluate(() => window.__supportCtx.agents.tools().map((tool) => tool.name).filter((name) => name.startsWith("megatech_support_")))).toEqual([]);
  await shot(page, "09-settings-restart");
  await card.getByRole("switch").uncheck();
  await expect(card.getByText(/Restart Buzz/)).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), SWITCH_KEY)).toBe("off");
});

test("with the switch off at start there is no agent type and no tool", async ({ page, app }) => {
  await arrange(page, { app, saved: "off" });
  await openPage(page, "Megatech support");
  const added = await page.evaluate(() => ({
    tools: window.__supportCtx.agents.tools().map((tool) => tool.name).filter((name) => name.startsWith("megatech_support_")),
    types: window.__supportCtx.agents.types().map((type) => type.key),
  }));
  expect(added.tools).toEqual([]);
  expect(added.types.filter((key) => key.startsWith("megatech.support/"))).toEqual([]);
});

// `owner` is the owner Buzz records for the agent: by default the signed-in user ("viewer"), or another key, or none (null).
const callTool = (page, name, args, pubkey = "a".repeat(64), owner = "viewer") =>
  page.evaluate(
    async ([toolName, input, agent, who]) => {
      const tool = window.__supportCtx.agents.tools().find((entry) => entry.name === toolName);
      const client = who === "viewer" ? { pubkey: agent, owner: window.__supportViewer } : who === null ? { pubkey: agent } : { pubkey: agent, owner: who };
      try {
        return { ok: await tool.call(client, {}, input) };
      } catch (error) {
        return { error: error.message };
      }
    },
    [name, args, pubkey, owner],
  );

test("with the switch on at start the agent type and both tools are there, and any of the user's own agents may use them once verified", async ({ page, app }) => {
  const fake = await arrange(page, { app, saved: "on" });
  await openPage(page, "Megatech support");
  const added = await page.evaluate(() => ({
    tools: window.__supportCtx.agents.tools().filter((tool) => tool.name.startsWith("megatech_support_")).map((tool) => ({ name: tool.name, schema: tool.inputSchema })),
    types: window.__supportCtx.agents.types().map((type) => type.key),
  }));
  expect(added.tools.map((tool) => tool.name).sort()).toEqual([ASK, STATUS]);
  expect(added.tools.find((tool) => tool.name === ASK).schema).toMatchObject({ type: "object", required: ["question"], additionalProperties: false });
  expect(added.types).toContain("megatech.support/support");
  // Until the identity is verified, an agent gets fixed words, and nothing reaches the service.
  const unverified = await callTool(page, ASK, { question: "hi" });
  expect(unverified.error).toBe("Megatech support is not verified. The owner verifies it in Buzz, Settings, Plugins, Megatech support.");
  expect(fake.log).toEqual([]);
  // Verified, the user's own agents can ask and read a ticket's status.
  await verifyButton(page).click();
  await expect(page.getByRole("tab", { name: "Ask" })).toBeVisible();
  const asked = await callTool(page, ASK, { question: "My order is late" }, "b".repeat(64));
  const { ticket_id } = JSON.parse(asked.ok);
  expect(ticket_id).toMatch(/^T-\d+$/);
  expect(JSON.parse((await callTool(page, STATUS, { ticket_id }, "c".repeat(64))).ok)).toEqual({ ticket_id, status: "open" });
  expect(fake.ticketsOf(fake.user.pubkey)).toHaveLength(1);
  // An agent that is not the verified person's own is refused with fixed words, and nothing reaches the service.
  const before = fake.log.length;
  const NOT_YOURS = "This agent does not belong to the person who verified Megatech support, so it may not use it.";
  expect((await callTool(page, ASK, { question: "hi" }, "d".repeat(64), "e".repeat(64))).error).toBe(NOT_YOURS);
  expect((await callTool(page, STATUS, { ticket_id }, "d".repeat(64), null)).error).toBe(NOT_YOURS);
  expect(fake.log.length).toBe(before);
  // Turning the switch off stops them at once, though they stay listed until Buzz restarts.
  await page.evaluate((key) => localStorage.setItem(key, "off"), SWITCH_KEY);
  const off = await callTool(page, ASK, { question: "hi again" });
  expect(off.error).toBe("Megatech support is switched off. The owner turns it on in Buzz, Settings, Plugins, Megatech support.");
  expect(fake.ticketsOf(fake.user.pubkey)).toHaveLength(1);
  await page.evaluate((key) => localStorage.setItem(key, "on"), SWITCH_KEY);
  // The Settings card says it is on in this session, and no restart is needed.
  await openSettings(page);
  await selectSettingsSection(page, "Megatech support");
  const card = page.getByRole("region", { name: "Megatech support" });
  await expect(card.getByRole("switch")).toBeChecked();
  await expect(card.getByText("On in this session.")).toBeVisible();
  await shot(page, "10-settings-on");
});

test("the page and the card follow the light and the dark theme", async ({ page, app }) => {
  await page.setViewportSize({ width: 1300, height: 860 });
  await verified(page, app);
  await page.getByLabel("Your question").fill("How do I reset my password?");
  await page.getByRole("button", { name: "Ask support" }).click();
  await expect(page.getByRole("status", { name: "Support's reply" })).toBeVisible();
  const ink = () => page.locator(".mts-root").evaluate((root) => getComputedStyle(root).color);
  const bg = () => page.locator(".mts-root").evaluate((root) => getComputedStyle(root).backgroundColor);
  await openSettings(page);
  await selectSettingsSection(page, "Appearance");
  await chooseColorMode(page, "Light");
  await closeSettings(page);
  const light = [await ink(), await bg()];
  await shot(page, "11-light");
  await openSettings(page);
  await selectSettingsSection(page, "Appearance");
  await chooseColorMode(page, "Dark");
  await closeSettings(page);
  const dark = [await ink(), await bg()];
  await shot(page, "12-dark");
  expect(light[1]).not.toBe(dark[1]);
  expect(light[0]).not.toBe(dark[0]);
});

test("disabling the plugin removes its styles", async ({ page, app }) => {
  await verified(page, app);
  expect(await page.locator("style[data-megatech-support]").count()).toBe(1);
  await openSettings(page);
  await selectSettingsSection(page, "Manage plugins");
  const { setPluginEnabled } = await import("./plugin-settings.mjs");
  await setPluginEnabled(page, "Megatech support", false);
  await expect(page.locator("style[data-megatech-support]")).toHaveCount(0);
});
