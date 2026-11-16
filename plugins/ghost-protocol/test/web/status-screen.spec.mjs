// Drives the GHOST Protocol status screen in the real Buzz web build (headless Chromium, fixture relay). The web build cannot start a
// process, so the stub behind `ctx.host.spawn` (test/web/fixture.tsx) hands each call to this file, which runs the fake `docker`
// (test/fake-docker) in Node: what the plugin reads is what the fake printed, for every state, relay value, error and button.
// The page clock is the test's: the ten-second poll and the two-minute update gap are moved with `page.clock`, not waited for.
// Run with plugins/ghost-protocol/test/run.sh.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "./fixture.mjs";
import { chooseColorMode, closeSettings, openPage, openSettings, selectSettingsSection } from "./navigation.mjs";

const { createFakeDocker } = await import(pathToFileURL(join(process.env.GHOST_PROTOCOL_DIR, "test/fake-docker/index.mjs")).href);

const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

test.use({ pluginFixtures: true });
// The first page of a run waits for the harness to warm its caches, and a shared runner is slow: give each test and each wait room.
test.describe.configure({ timeout: 120_000 });

const fakes = [];
test.afterEach(async () => {
  // The fake refuses a command it does not know (exit 64, `refused` in its log): a plugin that drifts from the interface fails here.
  const refused = fakes.flatMap((fake) => fake.calls().filter((call) => call.refused).map((call) => call.argv.join(" ")));
  for (const fake of fakes.splice(0)) {
    // The page may still be running a command of its last look, which writes to the fake's folder: try again until it has ended.
    for (let attempt = 0; ; attempt++) {
      try {
        fake.cleanup();
        break;
      } catch (error) {
        if (attempt >= 20) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
  expect(refused, "commands the fake refused").toEqual([]);
});

const STATUS = "exec gp-maple gp status --json";
const REFUSED = "Your relay does not accept owner attestations. Ask its admin to turn them on, or to add this agent as a relay member.";
const OTHER_INTERFACE = "Update this plugin, or update GHOST Protocol";
const DOCKER_TEXT = "Install or start Docker Desktop";

/**
 * The page, with `docker` being the fake. `scenario` is the fake's; `seed` is how the agent `maple` starts (false: no container).
 * Opens the plugin's page and returns the fake. Time on the page is the test's: it passes only when the test moves it.
 */
async function arrange(page, app, { scenario = {}, seed = { condition: "running" }, mode, script, dockerUp = true } = {}) {
  page.setDefaultTimeout(30_000);
  const fake = createFakeDocker({ scenario });
  fakes.push(fake);
  if (seed) fake.seed({ slug: "maple", ...seed });
  await page.exposeFunction("__gpDocker", async (args) => {
    const { stdout, stderr, code } = await fake.run(args);
    return { stdout, stderr, code };
  });
  // `script`: scripted answers in the place of the fake, in order, for what the fake cannot be made to do.
  await page.addInitScript(
    ([hostMode, scripted]) => {
      window.__gp = { script: scripted ?? [], fallback: { stdout: "27.3.1\n", code: 0 }, calls: [], kills: 0, release() {}, mode: hostMode, fake: !scripted };
    },
    [mode, script],
  );
  await page.clock.install();
  await page.goto(app.origin, { timeout: 90_000, waitUntil: "domcontentloaded" });
  await openPage(page, "GHOST Protocol");
  await expect(root(page)).toBeVisible();
  if (dockerUp && mode === undefined) await expect(root(page).getByRole("status").first()).toHaveText("Docker is running");
  return fake;
}

const root = (page) => page.locator(".gp-root");
const agent = (page) => page.locator(".gp-agent");
const headline = (page) => agent(page).locator(".gp-status");
const gp = (page) => page.evaluate(() => ({ calls: window.__gp.calls, kills: window.__gp.kills }));
const button = (page, name) => agent(page).getByRole("button", { name, exact: true });
const fact = (page, label) => agent(page).locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");

/** Types a name into the agent field and presses Show status. */
async function show(page, typed = "maple") {
  await root(page).getByLabel("Agent name in Docker").fill(typed);
  await root(page).getByRole("button", { name: "Show status", exact: true }).click();
}

const countOf = (fake, command) => fake.calls().filter((call) => call.argv.join(" ") === command).length;
/**
 * Moves the page's clock until the fake has seen `count` calls of `command`: `runFor` moves it by `ms` and fires the poll timer, which
 * the plugin arms once the look before has ended, so a move that comes too early is made again. `fastForward` jumps by `ms` instead.
 * The clock also runs on by itself, so a time is a floor, never exact: tests that count seconds leave room.
 */
async function pass(page, fake, ms, command, count, how = "runFor") {
  await expect
    .poll(
      async () => {
        if (countOf(fake, command) < count) await page.clock[how](ms);
        await page.waitForTimeout(50);
        return countOf(fake, command);
      },
      { timeout: 30_000 },
    )
    .toBe(count);
}

// ---- the screen, in every state of `gp status --json` --------------------------------------------------------------------------------

test("asks nothing about an agent until it is named, then shows a running agent: state, version, relay, Claude, update, way back", async ({ page, app }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  const fake = await arrange(page, app);
  await expect(agent(page)).toHaveCount(0);
  expect((await gp(page)).calls.map(({ args }) => args.join(" "))).toEqual(["version --format {{.Server.Version}}"]);
  await show(page);
  await expect(headline(page)).toHaveText("Running");
  await expect(agent(page).getByRole("heading", { name: "gp-maple", level: 2 })).toBeVisible();
  await expect(fact(page, "State")).toHaveText("Running");
  await expect(fact(page, "Version")).toHaveText("0.0.0");
  await expect(fact(page, "Relay")).toHaveText("Connected");
  await expect(fact(page, "Relay address")).toHaveText("wss://relay.example.com");
  await expect(fact(page, "Claude")).toHaveText("Signed in");
  await expect(fact(page, "Update")).toHaveText("No update is available");
  await expect(fact(page, "Previous version")).toHaveText("None");
  // Four buttons; Roll back waits for a previous version.
  await expect(button(page, "Update")).toBeEnabled();
  await expect(button(page, "Roll back")).toBeDisabled();
  await expect(button(page, "Restart")).toBeEnabled();
  await expect(button(page, "Stop")).toBeEnabled();
  expect(countOf(fake, STATUS)).toBe(1);
  await shot(page, "10-running");
});

const STATES = [
  ["needs-auth-tag", "Waiting for the owner's attestation", { seed: { condition: "needs-auth-tag" } }],
  ["needs-claude", "Waiting for a Claude sign-in", { seed: { condition: "needs-claude" } }],
  ["error", "Error", { scenario: "status-error" }],
];
for (const [state, words, options] of STATES) {
  test(`shows the state ${state}`, async ({ page, app }) => {
    await page.setViewportSize({ width: 1300, height: 900 });
    await arrange(page, app, options);
    await show(page);
    await expect(headline(page)).toHaveText(words);
    await expect(fact(page, "State")).toHaveText(words);
    // Waiting for something: the relay has not been tried yet, and Docker's own state is not a problem.
    if (state === "error") {
      await expect(headline(page)).toHaveAttribute("role", "alert");
      await expect(agent(page).getByText("crashed", { exact: true })).toBeVisible();
      await expect(agent(page).getByText("The agent stopped unexpectedly.", { exact: true })).toBeVisible();
    } else {
      await expect(headline(page)).toHaveAttribute("role", "status");
      await expect(agent(page).getByText("Error code")).toHaveCount(0);
    }
    await shot(page, `11-${state}`);
  });
}

test("shows connecting and then running, as the agent's polls go", async ({ page, app }) => {
  const fake = await arrange(page, app, { seed: { condition: "needs-claude" } });
  // A Claude token is all it waited for: the next status says connecting, and the one after says running.
  await fake.run(["exec", "-i", "gp-maple", "gp", "claude", "token"], { input: "made-up-token\n" });
  await show(page);
  await expect(headline(page)).toHaveText("Connecting to the relay");
  await pass(page, fake, 10_000, STATUS, 2);
  await expect(headline(page)).toHaveText("Running");
  await expect(fact(page, "Relay")).toHaveText("Connected");
  await shot(page, "12-connecting-then-running");
});

test("shows updating, with the version it is still on", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: "update-available" });
  await fake.run(["exec", "gp-maple", "gp", "update", "request"]);
  await show(page);
  await expect(headline(page)).toHaveText("Updating");
  await expect(fact(page, "Version")).toHaveText("0.0.0");
  await expect(fact(page, "Update")).toHaveText("Version 0.1.1 is available");
});

test("shows an update on offer and the version to go back to", async ({ page, app }) => {
  await arrange(page, app, { scenario: "update-available", seed: { condition: "running", version: "0.0.5", previousVersion: "0.0.0" } });
  await show(page);
  await expect(fact(page, "Update")).toHaveText("Version 0.1.1 is available");
  await expect(fact(page, "Previous version")).toHaveText("0.0.0");
  await expect(button(page, "Roll back")).toBeEnabled();
});

// ---- the relay -----------------------------------------------------------------------------------------------------------------------

test("shows a refusal by the relay in the note's own words, with the agent's public key and a button that copies it", async ({ page, app }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.origin });
  const fake = await arrange(page, app, { scenario: "relay-refuses" });
  await show(page);
  await expect(fact(page, "Relay")).toHaveText("Refused: not a member");
  const refused = agent(page).locator(".gp-refused");
  await expect(refused).toHaveAttribute("role", "alert");
  await expect(refused.locator("p").first()).toHaveText(REFUSED);
  const key = fake.state().volumes["gp-maple-data"].pubkey;
  await expect(refused.getByText(key, { exact: true })).toBeVisible();
  await expect(refused.getByText("Agent's public key")).toBeVisible();
  await refused.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(refused.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
  await shot(page, "13-relay-refuses");
});

test("shows an unreachable relay, without the refusal text", async ({ page, app }) => {
  await arrange(page, app, { scenario: "relay-unreachable" });
  await show(page);
  await expect(fact(page, "Relay")).toHaveText("Cannot be reached");
  await expect(agent(page).getByText(REFUSED)).toHaveCount(0);
  await expect(agent(page).getByRole("button", { name: "Copy" })).toHaveCount(0);
});

test("cuts a long text from GHOST Protocol, so it cannot fill the page", async ({ page, app }) => {
  const message = `${"word ".repeat(200)}END`;
  await arrange(page, app, { scenario: { statusOverride: { state: "error", error: { code: "c".repeat(500), message } } } });
  await show(page);
  await expect(headline(page)).toHaveText("Error");
  const [code, shown] = await agent(page).locator(".gp-problem dd").allTextContents();
  expect(code).toBe(`${"c".repeat(300)}…`);
  expect(shown).toBe(`${message.slice(0, 300)}…`);
  expect(shown).not.toContain("END");
});

test("shows a Claude that is not signed in", async ({ page, app }) => {
  await arrange(page, app, { seed: { condition: "needs-claude" } });
  await show(page);
  await expect(fact(page, "Claude")).toHaveText("Not signed in");
});

// ---- an interface it does not know -----------------------------------------------------------------------------------------------------

test("shows only `Update this plugin, or update GHOST Protocol` for an interface number it does not know, and recovers when GHOST Protocol is updated", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: "unknown-interface" });
  await show(page);
  await expect(headline(page)).toHaveText(OTHER_INTERFACE);
  await expect(headline(page)).toHaveAttribute("role", "alert");
  // Nothing else: no facts, no buttons, no copy of the answer.
  await expect(agent(page).locator("dl")).toHaveCount(0);
  await expect(agent(page).getByRole("button")).toHaveCount(0);
  await expect(agent(page).locator("p")).toHaveCount(1);
  // It keeps looking, so a GHOST Protocol that is updated shows at once.
  fake.use({});
  await pass(page, fake, 10_000, STATUS, 2);
  await expect(headline(page)).toHaveText("Running");
});

// ---- when docker exec fails ------------------------------------------------------------------------------------------------------------

test("says the container is stopped, and offers Restart alone, and Restart brings the agent back", async ({ page, app }) => {
  const fake = await arrange(page, app, { seed: { condition: "stopped" } });
  await show(page);
  await expect(headline(page)).toHaveText("gp-maple is stopped (exited).");
  await expect(headline(page)).toHaveAttribute("role", "alert");
  await expect(agent(page).getByRole("button")).toHaveCount(1);
  await shot(page, "14-stopped");
  await button(page, "Restart").click();
  await expect(agent(page).getByText("Restarted gp-maple.")).toBeVisible();
  // A look follows the button at once: the agent connects again, and runs a look later.
  await expect(headline(page)).toHaveText("Connecting to the relay");
  expect(fake.state().containers["gp-maple"].running).toBe(true);
  await pass(page, fake, 10_000, STATUS, 3);
  await expect(headline(page)).toHaveText("Running");
});

test("says there is no such container, and offers no button", async ({ page, app }) => {
  await arrange(page, app, { seed: false });
  await show(page);
  await expect(headline(page)).toHaveText("There is no container gp-maple.");
  await expect(agent(page).getByRole("button")).toHaveCount(0);
  await shot(page, "15-gone");
});

test("says to install or start Docker Desktop when the daemon is down", async ({ page, app }) => {
  await arrange(page, app, { scenario: "daemon-down", seed: false, dockerUp: false });
  await expect(root(page).getByRole("alert").first()).toHaveText(DOCKER_TEXT);
  await show(page);
  await expect(headline(page)).toHaveText(DOCKER_TEXT);
  await expect(agent(page).getByRole("button")).toHaveCount(0);
});

test("says to install or start Docker Desktop when there is no docker to start", async ({ page, app }) => {
  await arrange(page, app, { mode: "missing", seed: false });
  await expect(root(page).getByRole("alert")).toHaveText(DOCKER_TEXT);
  await show(page);
  await expect(headline(page)).toHaveText(DOCKER_TEXT);
  await expect(agent(page).getByRole("button")).toHaveCount(0);
});

test("says this Buzz cannot start programs when the host has no spawn", async ({ page, app }) => {
  await arrange(page, app, { mode: "no-spawn", seed: false });
  await show(page);
  await expect(headline(page)).toHaveText("This Buzz cannot start programs. Use the Buzz desktop app.");
  await expect(agent(page).getByRole("button")).toHaveCount(0);
  expect((await gp(page)).calls).toEqual([]);
});

test("says GHOST Protocol answered something it cannot read, and offers no button", async ({ page, app }) => {
  await arrange(page, app, { scenario: { statusOverride: { version: 7 } } });
  await show(page);
  await expect(headline(page)).toHaveText("GHOST Protocol answered, but this plugin could not read the answer.");
  await expect(headline(page)).toHaveAttribute("role", "alert");
  await expect(agent(page).getByRole("button")).toHaveCount(0);
});

test("says the container runs but GHOST Protocol did not answer, with its code and message, and offers Restart and Stop", async ({ page, app }) => {
  // The fake has no way to fail `gp status` inside a container that runs, so this test scripts Docker's answers: the version check, the
  // failed status, and `docker inspect` saying the container runs.
  await arrange(page, app, {
    seed: false,
    mode: "scripted",
    script: [
      { stdout: "27.3.1\n", code: 0 },
      { stdout: "GP_INTERFACE=1\nGP_ERROR=db-locked\nGP_ERROR_MESSAGE=The database is locked.\n", code: 1 },
      { stdout: "running\n", code: 0 },
    ],
  });
  await expect(root(page).getByRole("status").first()).toHaveText("Docker is running");
  await show(page);
  await expect(headline(page)).toHaveText("gp-maple is running, but GHOST Protocol did not answer.");
  await expect(headline(page)).toHaveAttribute("role", "alert");
  await expect(agent(page).getByText("The database is locked. (db-locked)")).toBeVisible();
  await expect(agent(page).getByRole("button")).toHaveText(["Restart", "Stop"]);
  expect((await gp(page)).calls.map(({ args }) => args.join(" ")).slice(1)).toEqual([STATUS, "inspect --format {{.State.Status}} gp-maple"]);
});

// ---- the update's gap ------------------------------------------------------------------------------------------------------------------

test("keeps saying Updating while the container is missing during an update, then shows the new version", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: "update-gap" });
  await fake.run(["exec", "gp-maple", "gp", "update", "request"]);
  await show(page);
  await expect(headline(page)).toHaveText("Updating");
  await pass(page, fake, 10_000, STATUS, 2);
  await expect(headline(page)).toHaveText("Updating");
  await pass(page, fake, 10_000, STATUS, 3);
  await expect(headline(page)).toHaveText("Updating. The agent is being swapped for the new version, which can take a minute or two.");
  await expect(headline(page)).toHaveAttribute("role", "status");
  await expect(agent(page).getByRole("button")).toHaveCount(0);
  await shot(page, "16-swapping");
  await pass(page, fake, 10_000, STATUS, 4);
  await expect(headline(page)).toHaveText(/^Updating\. The agent is being swapped/);
  await pass(page, fake, 10_000, STATUS, 5);
  await expect(headline(page)).toHaveText("Running");
  await expect(fact(page, "Version")).toHaveText("0.1.1");
  await expect(fact(page, "Previous version")).toHaveText("0.0.0");
  await expect(fact(page, "Update")).toHaveText("No update is available");
});

test("shows an update that is quicker than a look as updating, and not as a missing container", async ({ page, app }) => {
  // The update never says `updating` to a look: the container is missing for two looks, and then it is the new version.
  const fake = await arrange(page, app, { scenario: { update: { available: true, version: "0.1.1" }, updatingPolls: 0, updateGapPolls: 2 } });
  await show(page);
  await expect(headline(page)).toHaveText("Running");
  await button(page, "Update").click();
  await expect(agent(page).getByText("Update requested. The agent finishes its task first, then updates.")).toBeVisible();
  // The look that follows the button falls in the gap.
  await expect(headline(page)).toHaveText(/^Updating\. The agent is being swapped/);
  await expect(headline(page)).toHaveAttribute("role", "status");
  expect(countOf(fake, STATUS)).toBe(2);
  await pass(page, fake, 10_000, STATUS, 3);
  await expect(headline(page)).toHaveText(/^Updating\. The agent is being swapped/);
  await pass(page, fake, 10_000, STATUS, 4);
  await expect(headline(page)).toHaveText("Running");
  await expect(fact(page, "Version")).toHaveText("0.1.1");
});

test("shows that the container is gone once it has been missing for two minutes during an update", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: { update: { available: true, version: "0.1.1" }, updatingPolls: 1, updateGapPolls: "forever" } });
  await fake.run(["exec", "gp-maple", "gp", "update", "request"]);
  await show(page);
  await expect(headline(page)).toHaveText("Updating");
  // The first look that finds the container missing starts the two minutes.
  await pass(page, fake, 10_000, STATUS, 2);
  await expect(headline(page)).toHaveText(/^Updating\. The agent is being swapped/);
  // A minute and a half on: still updating. The next look, a minute on again, is past two minutes.
  await pass(page, fake, 90_000, STATUS, 3, "fastForward");
  await expect(headline(page)).toHaveText(/^Updating\. The agent is being swapped/);
  await expect(headline(page)).toHaveText(/^Updating\. The agent is being swapped/);
  await pass(page, fake, 60_000, STATUS, 4, "fastForward");
  await expect(headline(page)).toHaveText("There is no container gp-maple.");
  await expect(headline(page)).toHaveAttribute("role", "alert");
  await shot(page, "17-gone-after-update");
});

test("shows that the container is stopped, not gone, when an update leaves it stopped for two minutes", async ({ page, app }) => {
  const fake = await arrange(page, app, {
    scenario: { update: { available: true, version: "0.1.1" }, updatingPolls: 1, updateGapPolls: "forever", updateGapKind: "stopped" },
  });
  await fake.run(["exec", "gp-maple", "gp", "update", "request"]);
  await show(page);
  await expect(headline(page)).toHaveText("Updating");
  await pass(page, fake, 10_000, STATUS, 2);
  await expect(headline(page)).toHaveText(/^Updating\. The agent is being swapped/);
  await pass(page, fake, 130_000, STATUS, 3, "fastForward");
  await expect(headline(page)).toHaveText("gp-maple is stopped (exited).");
  await expect(button(page, "Restart")).toBeEnabled();
});

// ---- polling ---------------------------------------------------------------------------------------------------------------------------

test("looks again about every ten seconds while the screen is open, and not before", async ({ page, app }) => {
  const fake = await arrange(page, app);
  await show(page);
  await expect(headline(page)).toHaveText("Running");
  expect(countOf(fake, STATUS)).toBe(1);
  // Five seconds on, and a moment of real time: no second look yet.
  await page.clock.runFor(5_000);
  await page.waitForTimeout(500);
  expect(countOf(fake, STATUS)).toBe(1);
  // Past ten seconds: the second look. The third comes ten seconds after the answer to it, and not at once.
  await pass(page, fake, 6_000, STATUS, 2);
  await expect(headline(page)).toHaveText("Running");
  await page.waitForTimeout(500);
  expect(countOf(fake, STATUS)).toBe(2);
  await pass(page, fake, 11_000, STATUS, 3);
});

test("stops looking when the page is left", async ({ page, app }) => {
  const fake = await arrange(page, app);
  await show(page);
  await expect(headline(page)).toHaveText("Running");
  await openPage(page, "Messages");
  await expect(root(page)).toHaveCount(0);
  await page.clock.runFor(60_000);
  await page.waitForTimeout(500);
  expect(countOf(fake, STATUS)).toBe(1);
});

test("shows another agent when another name is shown, and looks only at that one", async ({ page, app }) => {
  const fake = await arrange(page, app);
  fake.seed({ slug: "birch", condition: "needs-claude", name: "Birch" });
  await show(page, "  Maple ");
  await expect(agent(page).getByRole("heading", { name: "gp-maple", level: 2 })).toBeVisible();
  await expect(headline(page)).toHaveText("Running");
  await show(page, "birch");
  await expect(agent(page).getByRole("heading", { name: "gp-birch", level: 2 })).toBeVisible();
  await expect(headline(page)).toHaveText("Waiting for a Claude sign-in");
  const before = countOf(fake, STATUS);
  await page.clock.runFor(10_000);
  await expect.poll(() => countOf(fake, "exec gp-birch gp status --json")).toBe(2);
  expect(countOf(fake, STATUS)).toBe(before);
});

test("shows nothing of one agent on the screen of another: not its outcome, not that it was updating", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: "update-available" });
  await fake.run(["exec", "gp-maple", "gp", "update", "request"]);
  await show(page);
  await expect(headline(page)).toHaveText("Updating");
  await button(page, "Stop").click();
  await expect(agent(page).getByText("Stopped gp-maple.", { exact: true })).toBeVisible();
  // Another agent, which is not there: it was not updating, so it is not swapping, and the button's line is not its own.
  await show(page, "nobody");
  await expect(agent(page).getByRole("heading", { name: "gp-nobody", level: 2 })).toBeVisible();
  await expect(headline(page)).toHaveText("There is no container gp-nobody.");
  await expect(agent(page).getByText("Stopped gp-maple.")).toHaveCount(0);
});

test("stops a look that has not ended when the page is left, and shows nothing late", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: { delayMs: { status: 20_000 } } });
  await show(page);
  await expect.poll(() => countOf(fake, STATUS)).toBe(1);
  await expect(headline(page)).toHaveText("Looking for gp-maple…");
  expect((await gp(page)).kills).toBe(0);
  await openPage(page, "Messages");
  await expect(root(page)).toHaveCount(0);
  await expect.poll(async () => (await gp(page)).kills).toBe(1);
});

test("refuses a name that is not a slug, and starts nothing", async ({ page, app }) => {
  const fake = await arrange(page, app);
  for (const bad of ["", "my agent", "-rm", "ma;ple", "Mäple", "a".repeat(41)]) {
    await show(page, bad);
    await expect(root(page).getByRole("alert").filter({ hasText: "Use lower-case letters, digits and - only" })).toBeVisible();
    await expect(agent(page)).toHaveCount(0);
  }
  expect(fake.calls().map((call) => call.argv.join(" "))).toEqual(["version --format {{.Server.Version}}"]);
  await show(page, "maple");
  await expect(root(page).getByRole("alert").filter({ hasText: "Use lower-case letters" })).toHaveCount(0);
  await expect(headline(page)).toHaveText("Running");
});

// ---- the buttons -----------------------------------------------------------------------------------------------------------------------

test("Update asks the container to update, says the agent finishes first, and the screen follows it to the new version", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: "update-available" });
  await show(page);
  await expect(button(page, "Update")).toBeEnabled();
  await button(page, "Update").click();
  await expect(agent(page).getByText("Update requested. The agent finishes its task first, then updates.")).toBeVisible();
  expect(fake.calls().map((call) => call.argv.join(" "))).toContain("exec gp-maple gp update request");
  // The look that follows the button sees the update under way; later looks see it done.
  await expect(headline(page)).toHaveText("Updating");
  await pass(page, fake, 10_000, STATUS, 3);
  await pass(page, fake, 10_000, STATUS, 4);
  await expect(headline(page)).toHaveText("Running");
  await expect(fact(page, "Version")).toHaveText("0.1.1");
  await shot(page, "20-updated");
});

test("Update says so when there is no update to take", async ({ page, app }) => {
  const fake = await arrange(page, app, {});
  await show(page);
  await button(page, "Update").click();
  await expect(agent(page).getByText("No update is available.", { exact: true })).toBeVisible();
  expect(countOf(fake, "exec gp-maple gp update request")).toBe(1);
});

test("Update says an update is already in progress to a second request", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: { update: { available: true, version: "0.1.1" }, updateStartPolls: 5 } });
  await show(page);
  await button(page, "Update").click();
  await expect(agent(page).getByText("Update requested.")).toBeVisible();
  await button(page, "Update").click();
  await expect(agent(page).getByText("An update is already in progress.", { exact: true })).toBeVisible();
  expect(countOf(fake, "exec gp-maple gp update request")).toBe(2);
});

test("Update shows the steps to update by hand, instead of the button, when the agent has no update helper", async ({ page, app }) => {
  await page.setViewportSize({ width: 1300, height: 1000 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.origin });
  const fake = await arrange(page, app, { scenario: { selfUpdate: "no", update: { available: true, version: "0.1.1" } } });
  await show(page);
  await button(page, "Update").click();
  // The button gives way to the steps, with the image the container was made from.
  await expect(button(page, "Update")).toHaveCount(0);
  await expect(agent(page).locator("p[role='status'], p[role='alert']").filter({ hasText: /^This agent has no update helper/ })).toHaveCount(0);
  const steps = agent(page).locator(".gp-steps");
  await expect(steps.getByText("This agent has no update helper, so update it by hand. Run these three commands, one after the other:")).toBeVisible();
  await expect(steps.locator("li code")).toHaveText([
    "docker pull registry.example/ghost-protocol:0.1.1",
    "docker rm -f gp-maple",
    "docker run -d --name gp-maple --restart unless-stopped -v gp-maple-data:/data registry.example/ghost-protocol:0.1.1",
  ]);
  await expect(steps.getByText("Your data and sign-ins live in the volume gp-maple-data, so nothing is lost between steps 2 and 3.")).toBeVisible();
  // Each step has its own copy button.
  await expect(steps.getByRole("button", { name: "Copy", exact: true })).toHaveCount(3);
  await steps.getByRole("button", { name: "Copy", exact: true }).nth(1).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("docker rm -f gp-maple");
  await shot(page, "21-update-by-hand");
  // The steps stay through the next look, and the other buttons stay. (A look followed the button, so this is the third.)
  await pass(page, fake, 10_000, STATUS, 3);
  await expect(steps.locator("li code")).toHaveCount(3);
  await expect(button(page, "Restart")).toBeEnabled();
});

test("Roll back asks the container to go back, and the screen follows it to the old version", async ({ page, app }) => {
  const fake = await arrange(page, app, { seed: { condition: "running", version: "0.1.1", previousVersion: "0.0.0" } });
  await show(page);
  await expect(button(page, "Roll back")).toBeEnabled();
  await button(page, "Roll back").click();
  await expect(agent(page).getByText("Roll back requested. Watch the state: it goes to Updating, then back to Running.")).toBeVisible();
  expect(fake.calls().map((call) => call.argv.join(" "))).toContain("exec gp-maple gp update rollback");
  await expect(headline(page)).toHaveText("Updating");
  await pass(page, fake, 10_000, STATUS, 3);
  await pass(page, fake, 10_000, STATUS, 4);
  await expect(headline(page)).toHaveText("Running");
  await expect(fact(page, "Version")).toHaveText("0.0.0");
  await expect(fact(page, "Update")).toHaveText("Version 0.1.1 is available");
  await expect(button(page, "Roll back")).toBeDisabled();
});

test("Roll back says there is no earlier version when GHOST Protocol answers so", async ({ page, app }) => {
  const fake = await arrange(page, app, { seed: { condition: "running", version: "0.1.1", previousVersion: "0.0.0" } });
  await show(page);
  await expect(button(page, "Roll back")).toBeEnabled();
  // The screen's last look is a few seconds old: by now the way back is gone.
  fake.patchState((state) => {
    state.containers["gp-maple"].previousVersion = null;
  });
  await button(page, "Roll back").click();
  await expect(agent(page).getByText("There is no earlier version to roll back to.", { exact: true })).toBeVisible();
});

test("Roll back says it cannot roll back from here when the agent has no update helper", async ({ page, app }) => {
  await arrange(page, app, { scenario: "no-self-update", seed: { condition: "running", version: "0.1.1", previousVersion: "0.0.0" } });
  await show(page);
  await button(page, "Roll back").click();
  await expect(agent(page).getByText("This agent has no update helper, so it cannot roll back from here.", { exact: true })).toBeVisible();
  await expect(agent(page).locator(".gp-steps")).toHaveCount(0);
  await expect(button(page, "Update")).toBeEnabled();
});

test("a failed update request shows GHOST Protocol's own message", async ({ page, app }) => {
  await arrange(page, app, { scenario: { update: { available: true, version: "0.1.1" }, fail: { updateRequest: true } } });
  await show(page);
  await button(page, "Update").click();
  const outcome = agent(page).getByText("The update could not be requested. (update-failed)", { exact: true });
  await expect(outcome).toBeVisible();
  await expect(outcome).toHaveAttribute("role", "alert");
});

test("Stop stops the container, and the screen then offers Restart alone", async ({ page, app }) => {
  const fake = await arrange(page, app);
  await show(page);
  await button(page, "Stop").click();
  await expect(agent(page).getByText("Stopped gp-maple.", { exact: true })).toBeVisible();
  expect(fake.calls().map((call) => call.argv.join(" "))).toContain("stop gp-maple");
  expect(fake.state().containers["gp-maple"].running).toBe(false);
  await expect(headline(page)).toHaveText("gp-maple is stopped (exited).");
  await expect(agent(page).getByRole("button")).toHaveCount(1);
  await expect(button(page, "Restart")).toBeEnabled();
});

test("Restart restarts a running container and the agent answers again", async ({ page, app }) => {
  const fake = await arrange(page, app);
  await show(page);
  await button(page, "Restart").click();
  await expect(agent(page).getByText("Restarted gp-maple.", { exact: true })).toBeVisible();
  expect(fake.calls().map((call) => call.argv.join(" "))).toContain("restart gp-maple");
  // The look that follows the button finds it connecting again, and the next finds it running.
  await expect(headline(page)).toHaveText("Connecting to the relay");
  await pass(page, fake, 10_000, STATUS, 3);
  await expect(headline(page)).toHaveText("Running");
});

test("a button that Docker cannot carry out says so, with Docker's own first line", async ({ page, app }) => {
  const fake = await arrange(page, app);
  await show(page);
  await expect(headline(page)).toHaveText("Running");
  // The container goes away between the look and the press.
  fake.patchState((state) => {
    delete state.containers["gp-maple"];
  });
  await button(page, "Restart").click();
  const outcome = agent(page).locator("p[role='alert']").filter({ hasText: "Docker could not restart gp-maple." });
  await expect(outcome).toContainText("No such container");
  await expect(headline(page)).toHaveText("There is no container gp-maple.");
});

test("disables every button while one is working, and says so", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: { delayMs: { restart: 1500 } } });
  await show(page);
  await button(page, "Restart").click();
  await expect(agent(page).getByText("Working…")).toBeVisible();
  for (const name of ["Update", "Roll back", "Restart", "Stop"]) await expect(button(page, name)).toBeDisabled();
  await expect(agent(page).getByText("Restarted gp-maple.")).toBeVisible();
  await expect(button(page, "Restart")).toBeEnabled();
  expect(countOf(fake, "restart gp-maple")).toBe(1);
});

// ---- what the plugin asked the host for -----------------------------------------------------------------------------------------------

test("asks the host for the declared process only, with these arguments only, called on the host", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: { update: { available: true, version: "0.1.1" } }, seed: { condition: "running", version: "0.1.1", previousVersion: "0.0.0" } });
  await show(page);
  await expect(headline(page)).toHaveText("Running");
  for (const name of ["Update", "Roll back", "Restart", "Stop"]) {
    await button(page, name).click();
    await expect(agent(page).getByText("Working…")).toHaveCount(0);
    await expect(agent(page).locator("p[role='status'], p[role='alert']").filter({ hasText: /\.$/ }).first()).toBeVisible();
    // After Stop there is only Restart; the others need a running agent.
    if (name === "Stop") break;
  }
  const { calls } = await gp(page);
  const allowed = [
    /^version --format \{\{\.Server\.Version\}\}$/,
    /^exec gp-maple gp status --json$/,
    /^exec gp-maple gp update request$/,
    /^exec gp-maple gp update rollback$/,
    /^restart gp-maple$/,
    /^stop gp-maple$/,
    /^inspect --format \{\{\.State\.Status\}\} gp-maple$/,
    /^inspect --format \{\{\.Config\.Image\}\} gp-maple$/,
  ];
  expect(calls.length).toBeGreaterThan(5);
  for (const call of calls) {
    expect(call.id).toBe("docker");
    expect(call.declared).toBe(true);
    expect(call.onHost).toBe(true);
    // Arguments and the two output handlers: no working directory, no environment.
    expect(call.options).toEqual(["args", "onStderr", "onStdout"]);
    expect(allowed.some((pattern) => pattern.test(call.args.join(" "))), call.args.join(" ")).toBe(true);
  }
  // The same calls, seen by the fake: every one a form it answers.
  expect(fake.calls().every((call) => !call.refused)).toBe(true);
  // None of them writes to a process.
  expect(calls.flatMap((call) => call.args)).not.toContain("-i");
});

// ---- the look ---------------------------------------------------------------------------------------------------------------------------

test("the screen follows the light and the dark theme, with text that reads in both", async ({ page, app }) => {
  await page.setViewportSize({ width: 1300, height: 1000 });
  await arrange(page, app, { scenario: "relay-refuses" });
  await show(page);
  await expect(fact(page, "Relay")).toHaveText("Refused: not a member");
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
      const lin = (value) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
      const light = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const ratio = (a, b) => (Math.max(light(a), light(b)) + 0.05) / (Math.min(light(a), light(b)) + 0.05);
      const panel = rgb(getComputedStyle(document.querySelector(".gp-agent")).backgroundColor);
      const on = (selector) => ratio(rgb(getComputedStyle(document.querySelector(selector)).color), panel);
      return {
        headline: on(".gp-agent .gp-status"),
        label: on(".gp-agent .gp-facts dt"),
        value: on(".gp-agent .gp-facts dd"),
        refusal: on(".gp-agent .gp-refused p"),
        code: on(".gp-agent .gp-code"),
        opaque: panel.a === 1,
      };
    });
  for (const mode of ["Light", "Dark"]) {
    await openSettings(page);
    await selectSettingsSection(page, "Appearance");
    await chooseColorMode(page, mode);
    await closeSettings(page);
    const seen = await contrast();
    expect(seen.opaque, `${mode}: the panel is opaque`).toBe(true);
    for (const [part, value] of Object.entries(seen)) if (part !== "opaque") expect(value, `${mode}: ${part} contrast`).toBeGreaterThanOrEqual(4.5);
    await shot(page, `30-${mode.toLowerCase()}`);
  }
});

test("a problem line reads in both themes", async ({ page, app }) => {
  await page.setViewportSize({ width: 1300, height: 1000 });
  await arrange(page, app, { scenario: "status-error" });
  await show(page);
  await expect(agent(page).getByText("The agent stopped unexpectedly.")).toBeVisible();
  for (const mode of ["Light", "Dark"]) {
    await openSettings(page);
    await selectSettingsSection(page, "Appearance");
    await chooseColorMode(page, mode);
    await closeSettings(page);
    const ratio = await page.evaluate(() => {
      const rgb = (css) => {
        const canvas = document.createElement("canvas").getContext("2d");
        canvas.fillStyle = "#000";
        canvas.clearRect(0, 0, 1, 1);
        canvas.fillStyle = css;
        canvas.fillRect(0, 0, 1, 1);
        const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
        return { r, g, b };
      };
      const lin = (value) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
      const light = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const text = rgb(getComputedStyle(document.querySelector(".gp-agent .gp-problem dd")).color);
      const panel = rgb(getComputedStyle(document.querySelector(".gp-agent")).backgroundColor);
      return (Math.max(light(text), light(panel)) + 0.05) / (Math.min(light(text), light(panel)) + 0.05);
    });
    expect(ratio, `${mode}: error text contrast`).toBeGreaterThanOrEqual(4.5);
  }
});
