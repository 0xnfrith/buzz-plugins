// Drives the Claude part of the GHOST Protocol tab in the real Buzz web build (headless Chromium, fixture relay): "Claude: active" and
// "Claude: not active", the guide for connecting, each way through the fake `docker` (test/fake-docker) from not active to active, each way
// refused, a sign-in done outside the tab, and the guide in the light and the dark theme. The agent is made through the create form with the
// sign-in left for later, so the tab finds it where a new agent waits: at `needs-claude`. Run with plugins/ghost-protocol/test/run.sh.
import { test, expect } from "./fixture.mjs";
import { chooseColorMode, closeSettings, openSettings, selectSettingsSection } from "./navigation.mjs";
import { CODE, TOKEN, arrange, cleanupFakes, create, fill, leaks, openForm, shot } from "./ghost-protocol-agents-page.mjs";

test.use({ pluginFixtures: true, productionBroker: true, localAgentActivity: true });
test.describe.configure({ timeout: 180_000 });
test.afterEach(cleanupFakes);

const COMMANDS = ["claude --version", "curl -fsSL https://claude.ai/install.sh | bash", "irm https://claude.ai/install.ps1 | iex", "claude setup-token"];

/** An agent made with its Claude sign-in left for later, and its tab open on the Claude section. */
async function waitingAgent(page, app, scenario = {}) {
  const fake = await arrange(page, app, { scenario });
  const dialog = await openForm(page);
  await fill(dialog, { way: "login" });
  await create(page, dialog);
  await expect(page.getByText("On this computer")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "GHOST Protocol" }).click();
  const claude = page.locator('[data-gp="claude"]');
  await expect(claude.locator('[data-gp="claude-state"]')).toHaveText("Claude: not active");
  return { fake, claude, state: claude.locator('[data-gp="claude-state"]'), tokenWay: claude.locator('[data-gp="guide-token"]'), loginWay: claude.locator('[data-gp="guide-login"]') };
}

const claudeStatusCalls = (fake) => fake.calls().filter((call) => call.argv.join(" ") === "exec gp-maple gp claude status").length;

test("an agent that waits for Claude says Claude: not active and shows the guide, the token's way first", async ({ page, app }) => {
  const { fake, claude, state, tokenWay, loginWay } = await waitingAgent(page, app);
  await expect(state).toHaveAttribute("role", "status");
  const guide = claude.locator('[data-gp="guide"]');
  await expect(guide).toBeVisible();

  // What a Claude subscription is, and that it is needed.
  await expect(guide).toContainText("GHOST Protocol uses your own Claude subscription to think");
  await expect(guide).toContainText("A Claude subscription is a paid Claude plan: Pro, Max, Ultra, Team or Enterprise.");
  await expect(guide).toContainText("The free plan does not include Claude Code");
  // Where to run the commands, for each system the install line is for; and no Markdown shows as typed characters.
  await expect(tokenWay).toContainText("Terminal on a Mac or Linux, PowerShell on Windows, or your WSL window.");
  expect(await claude.evaluate((element) => element.innerText.includes("`"))).toBe(false);

  // The token's way leads, the address's way follows.
  await expect(tokenWay.getByRole("heading")).toHaveText("Option 1 (recommended): paste a setup token");
  await expect(loginWay.getByRole("heading")).toHaveText("Option 2: sign in at an address");
  const [first, second] = await Promise.all([tokenWay.boundingBox(), loginWay.boundingBox()]);
  expect(first.y).toBeLessThan(second.y);

  // The steps are numbered (the text says "go on to step 2"), though the app's own styles take the numbers off lists.
  for (const way of [tokenWay, loginWay]) await expect(way.locator("ol")).toHaveCSS("list-style-type", "decimal");

  // Each command is in a copy block, and its button puts exactly that command on the clipboard.
  await expect(tokenWay.locator(".gp-code")).toHaveText(COMMANDS);
  for (const [at, command] of COMMANDS.entries()) {
    const block = tokenWay.locator(".gp-copy").nth(at);
    await block.getByRole("button", { name: "Copy" }).click();
    await expect(block.getByRole("button")).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  }

  // What success and each failure look like, with GHOST Protocol's codes.
  await expect(tokenWay.locator('[data-gp="guide-token-expect"]')).toContainText("Claude: active");
  await expect(tokenWay.locator('[data-gp="guide-token-expect"]')).toContainText("claude-token-invalid");
  await expect(loginWay.locator('[data-gp="guide-login-expect"]')).toContainText("Claude: active");
  await expect(loginWay.locator('[data-gp="guide-login-expect"]')).toContainText("claude-login-failed");

  // Its links go to a new page and are web addresses, and no sign-in has been tried by looking at the guide.
  for (const link of await guide.getByRole("link").all()) {
    await expect(link).toHaveAttribute("href", /^https:\/\/(claude\.com|code\.claude\.com)\//);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  }
  expect(fake.calls().some((call) => call.argv.includes("token") || call.argv.includes("login"))).toBe(false);

  // Nothing runs past the edge of the panel, even for the longest command.
  expect(await claude.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await shot(page, "guide-1-not-active");
});

test("option 1: a token takes the agent from not active to active, and nothing keeps it", async ({ page, app }) => {
  // The agent takes three seconds over the token, so the tab can be seen while it waits.
  const { fake, claude, state, tokenWay } = await waitingAgent(page, app, { delayMs: { "claude-token": 3000 } });
  const field = tokenWay.getByLabel("Claude setup token");
  await expect(tokenWay.getByRole("button", { name: "Send token" })).toBeDisabled();
  await field.fill(TOKEN);
  expect(await field.getAttribute("type")).toBe("password");
  await shot(page, "guide-2-token");
  await tokenWay.getByRole("button", { name: "Send token" }).click();
  // The field is empty as soon as the token has gone, and nothing can be sent again while the agent is still answering.
  await expect(field).toHaveValue("");
  await expect(field).toBeDisabled();
  await expect(tokenWay.getByRole("button", { name: "Send token" })).toBeDisabled();
  await expect(state).toHaveText("Claude: not active");
  expect(await leaks(page, fake)).not.toContain(TOKEN);

  await expect(state).toHaveText("Claude: active", { timeout: 30_000 });
  await expect(claude.locator('[data-gp="claude-accepted"]')).toHaveText("Claude accepted the sign-in.");
  await expect(claude.locator('[data-gp="guide"]')).toHaveCount(0);
  await expect(claude.getByLabel("Claude setup token")).toHaveCount(0);
  await expect(claude.getByRole("button", { name: "Check again" })).toHaveCount(0);
  await shot(page, "guide-3-active");

  // The token went to the agent on stdin, and is left nowhere.
  const sent = fake.calls().find((call) => call.argv.includes("token"));
  expect(sent.argv).toEqual(["exec", "-i", "gp-maple", "gp", "claude", "token"]);
  expect(sent.stdin.attached).toBe(true);
  expect(await leaks(page, fake)).not.toContain(TOKEN);

  // The status screen above it follows at once, and the agent goes on to run.
  await expect(page.locator(".gp-agent .gp-status")).toHaveText("Running", { timeout: 60_000 });
  await expect(page.locator(".gp-agent .gp-facts")).toContainText("Active");
});

test("option 1: a refused token says so with GHOST Protocol's code and line, empties the field, and a new token gets through", async ({ page, app }) => {
  const { fake, claude, state, tokenWay } = await waitingAgent(page, app, "token-rejected");
  const field = tokenWay.getByLabel("Claude setup token");
  await field.fill(TOKEN);
  await tokenWay.getByRole("button", { name: "Send token" }).click();

  const problem = tokenWay.locator('[data-gp="claude-problem"]');
  await expect(problem).toContainText("Claude did not accept that token. Make a new one and paste it.");
  await expect(problem).toHaveAttribute("data-code", "claude-token-invalid");
  await expect(tokenWay.locator('[data-gp="claude-said"]')).toHaveText("GHOST Protocol said: The Claude token was not accepted. (claude-token-invalid)");
  await expect(field).toHaveValue("");
  await expect(state).toHaveText("Claude: not active");
  // It is shown under the way that was tried, and under no other.
  await expect(claude.locator('[data-gp="guide-login"] [data-gp="claude-problem"]')).toHaveCount(0);
  await shot(page, "guide-4-token-refused");
  expect(await leaks(page, fake)).not.toContain(TOKEN);

  fake.use("ok");
  await field.fill(TOKEN);
  await tokenWay.getByRole("button", { name: "Send token" }).click();
  await expect(state).toHaveText("Claude: active", { timeout: 30_000 });
  await expect(claude.locator('[data-gp="claude-problem"]')).toHaveCount(0);
  expect(await leaks(page, fake)).not.toContain(TOKEN);
});

test("option 2: an address and a code take the agent to active, and giving up is said", async ({ page, app }) => {
  const { fake, claude, state, loginWay } = await waitingAgent(page, app);
  // Give up first: the address goes, and it is said.
  await loginWay.getByRole("button", { name: "Sign in with an address" }).click();
  const login = claude.locator('[data-gp="login"]');
  await expect(login.getByRole("link")).toHaveAttribute("href", /^https:\/\/claude\.example\/login\?state=[0-9a-f]{16}$/);
  await login.getByRole("button", { name: "Cancel" }).click();
  await expect(login).toHaveCount(0);
  await expect(loginWay.locator('[data-gp="claude-problem"]')).toHaveText("Signing in to Claude was cancelled.");
  await expect(state).toHaveText("Claude: not active");

  // Then the whole way.
  await loginWay.getByRole("button", { name: "Sign in with an address" }).click();
  const address = login.getByRole("link");
  await expect(address).toHaveAttribute("href", /^https:\/\/claude\.example\/login\?state=[0-9a-f]{16}$/);
  await expect(address).toHaveAttribute("target", "_blank");
  await expect(address).toHaveAttribute("rel", /noopener/);
  await expect(loginWay.locator('[data-gp="claude-problem"]')).toHaveCount(0);
  await shot(page, "guide-5-address");
  await login.getByLabel("Code from Claude").fill(CODE);
  await login.getByRole("button", { name: "Continue" }).click();
  await expect(state).toHaveText("Claude: active", { timeout: 30_000 });
  await expect(claude.locator('[data-gp="guide"]')).toHaveCount(0);
  const loginCall = fake.calls().filter((call) => call.argv.includes("login")).at(-1);
  expect(loginCall.argv).toEqual(["exec", "-i", "gp-maple", "gp", "claude", "login"]);
  expect(loginCall.stdin.attached).toBe(true);
  expect(await leaks(page, fake)).not.toContain(CODE);
  await expect.poll(async () => JSON.parse((await fake.run(["exec", "gp-maple", "gp", "status", "--json"])).stdout).state).toBe("running");
});

test("option 2: a refused code says so with GHOST Protocol's code and line, and a new address gets through", async ({ page, app }) => {
  const { fake, claude, state, loginWay } = await waitingAgent(page, app, "login-fails");
  await loginWay.getByRole("button", { name: "Sign in with an address" }).click();
  const login = claude.locator('[data-gp="login"]');
  await login.getByLabel("Code from Claude").fill(CODE);
  await login.getByRole("button", { name: "Continue" }).click();

  const problem = loginWay.locator('[data-gp="claude-problem"]');
  await expect(problem).toContainText("Claude did not accept the sign-in. Try again.");
  await expect(problem).toHaveAttribute("data-code", "claude-login-failed");
  await expect(loginWay.locator('[data-gp="claude-said"]')).toHaveText("GHOST Protocol said: The sign-in code was not accepted. (claude-login-failed)");
  await expect(login).toHaveCount(0);
  await expect(state).toHaveText("Claude: not active");
  await expect(claude.locator('[data-gp="guide-token"] [data-gp="claude-problem"]')).toHaveCount(0);
  await shot(page, "guide-6-login-refused");
  expect(await leaks(page, fake)).not.toContain(CODE);

  fake.use("ok");
  await loginWay.getByRole("button", { name: "Sign in with an address" }).click();
  await login.getByLabel("Code from Claude").fill(CODE);
  await login.getByRole("button", { name: "Continue" }).click();
  await expect(state).toHaveText("Claude: active", { timeout: 30_000 });
  expect(await leaks(page, fake)).not.toContain(CODE);
});

test("an agent that is signed in says Claude: active and shows no guide and no field", async ({ page, app }) => {
  const fake = await arrange(page, app);
  const dialog = await openForm(page);
  await fill(dialog);
  await create(page, dialog);
  await expect(page.getByText("On this computer")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "GHOST Protocol" }).click();
  const claude = page.locator('[data-gp="claude"]');
  await expect(claude.locator('[data-gp="claude-state"]')).toHaveText("Claude: active");
  await expect(claude.locator('[data-gp="guide"]')).toHaveCount(0);
  await expect(claude.getByLabel("Claude setup token")).toHaveCount(0);
  await expect(claude.locator('[data-gp="claude-accepted"]')).toHaveCount(0);
  expect(await leaks(page, fake)).not.toContain(TOKEN);
});

test("the tab picks up a sign-in made elsewhere on its next look, and stops looking when it is left", async ({ page, app }) => {
  const { fake, claude, state } = await waitingAgent(page, app);
  // Someone signs the agent in from a terminal, outside the tab.
  const outside = await fake.run(["exec", "-i", "gp-maple", "gp", "claude", "token"], { input: `${TOKEN}\n` });
  expect(outside.code).toBe(0);
  // The tab does not change by itself at once; at its next look, about ten seconds on, it says active and the guide goes.
  await expect(state).toHaveText("Claude: active", { timeout: 30_000 });
  await expect(claude.locator('[data-gp="guide"]')).toHaveCount(0);
  await expect(claude.locator('[data-gp="claude-accepted"]')).toHaveCount(0);

  // Leaving the tab ends the looks.
  await page.getByRole("tab", { name: "Identity" }).click();
  await expect(claude).toHaveCount(0);
  const before = claudeStatusCalls(fake);
  await page.waitForTimeout(13_000);
  expect(claudeStatusCalls(fake)).toBe(before);
  // And it looks again once the tab is back.
  await page.getByRole("tab", { name: "GHOST Protocol" }).click();
  await expect(page.locator('[data-gp="claude"] [data-gp="claude-state"]')).toHaveText("Claude: active");
  expect(claudeStatusCalls(fake)).toBeGreaterThan(before);
});

test("a refusal from before does not come back when the agent goes not active again", async ({ page, app }) => {
  const { fake, claude, state, tokenWay } = await waitingAgent(page, app, "token-rejected");
  await tokenWay.getByLabel("Claude setup token").fill(TOKEN);
  await tokenWay.getByRole("button", { name: "Send token" }).click();
  await expect(tokenWay.locator('[data-gp="claude-problem"]')).toBeVisible();

  // Someone signs the agent in from a terminal: the tab picks it up at its next look, and the guide and the refusal go.
  fake.use("ok");
  expect((await fake.run(["exec", "-i", "gp-maple", "gp", "claude", "token"], { input: `${TOKEN}\n` })).code).toBe(0);
  await expect(state).toHaveText("Claude: active", { timeout: 30_000 });
  await expect(claude.locator('[data-gp="guide"]')).toHaveCount(0);

  // The agent signs out, and the next look finds it not active: the guide is back, with no refusal for a sign-in nobody tried.
  fake.patchState((current) => {
    for (const volume of Object.values(current.volumes)) volume.claude = "not-active";
  });
  await expect(state).toHaveText("Claude: not active", { timeout: 30_000 });
  await expect(claude.locator('[data-gp="guide"]')).toBeVisible();
  await expect(claude.locator('[data-gp="claude-problem"]')).toHaveCount(0);
  await expect(claude.locator('[data-gp="claude-said"]')).toHaveCount(0);
});

test("the tab says so when the agent cannot be asked, and recovers when it can", async ({ page, app }) => {
  const { fake, claude, state } = await waitingAgent(page, app);
  fake.use("unknown-interface");
  await claude.getByRole("button", { name: "Check again" }).click();
  await expect(state).toHaveText("Update this plugin, or update GHOST Protocol");
  await expect(state).toHaveAttribute("role", "alert");
  await expect(claude.locator('[data-gp="guide"]')).toHaveCount(0);
  fake.use("ok");
  await claude.getByRole("button", { name: "Check again" }).click();
  await expect(state).toHaveText("Claude: not active");
  await expect(claude.locator('[data-gp="guide"]')).toBeVisible();
});

test("the guide follows the light and the dark theme, with text that reads in both", async ({ page, app }) => {
  await waitingAgent(page, app, "token-rejected");
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
      // The first opaque background above the text: the panel's own surface.
      const ground = (element) => {
        for (let node = element; node; node = node.parentElement) {
          const colour = rgb(getComputedStyle(node).backgroundColor);
          if (colour.a === 1) return colour;
        }
        return rgb("#fff");
      };
      const read = (selector) => {
        const element = document.querySelector(`[data-gp="claude"] ${selector}`);
        if (!element) return null;
        return ratio(rgb(getComputedStyle(element).color), ground(element));
      };
      return {
        status: read('[data-gp="claude-state"]'),
        intro: read(".gp-guide > .gp-hint"),
        heading: read(".gp-way h4"),
        step: read(".gp-way li p"),
        os: read(".gp-os"),
        code: read(".gp-code"),
        link: read(".gp-guide a"),
        expect: read('[data-gp="guide-token-expect"]'),
        refusal: read('[data-gp="claude-problem"] .gp-problem'),
        said: read('[data-gp="claude-said"]'),
      };
    });
  for (const mode of ["Light", "Dark"]) {
    await openSettings(page);
    await selectSettingsSection(page, "Appearance");
    await chooseColorMode(page, mode);
    await closeSettings(page);
    await page.getByRole("tab", { name: "GHOST Protocol" }).click();
    const claude = page.locator('[data-gp="claude"]');
    const field = claude.getByLabel("Claude setup token");
    await field.fill(TOKEN);
    await claude.getByRole("button", { name: "Send token" }).click();
    await expect(claude.locator('[data-gp="claude-said"]')).toBeVisible();
    const seen = await contrast();
    for (const [what, ratio] of Object.entries(seen)) {
      expect(ratio, `${mode}: ${what} is on the page`).not.toBeNull();
      expect(ratio, `${mode}: ${what} contrast`).toBeGreaterThanOrEqual(4.5);
    }
    await shot(page, `guide-theme-${mode.toLowerCase()}`);
  }
});
