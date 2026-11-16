// Drives the GHOST Protocol create form in the real Buzz web build (headless Chromium, fixture relay): the type in "New agent, Create a new
// agent", its form, Create from the first press to a listed agent, every way Create can fail, and the Claude sign-in in the agent's own
// tab. The web build cannot start a process, so the stub behind `ctx.host.spawn` (test/web/fixture.tsx) hands each call to test/web/pipe.mjs,
// which runs the fake `docker` (test/fake-docker) in Node with the plugin's stdin, and sends what it prints back as it prints it: what the
// plugin reads is what the fake printed. Run with plugins/ghost-protocol/test/run.sh.
import { test, expect } from "./fixture.mjs";
import { chooseColorMode, closeSettings, openSettings, selectSettingsSection } from "./navigation.mjs";
import {
  CODE, TOKEN, arrange, calls, cleanupFakes, create, dialogOf, fill, form, gp, introOf, leaks, openForm, progress, shot, step,
} from "./ghost-protocol-agents-page.mjs";

// The Agents page is off in the plain web build: the app's own stub for a native agent store turns it on.
test.use({ pluginFixtures: true, productionBroker: true, localAgentActivity: true });
test.describe.configure({ timeout: 180_000 });

const QUESTION = "Let GHOST Protocol update itself? It needs control of Docker to swap in new versions. You can say no and update by hand.";
const DOCKER_TEXT = "Docker didn't answer. Install or start Docker Desktop, then retry.";
const OTHER_INTERFACE = "Update this plugin, or update GHOST Protocol";
const REFUSED = "Your relay does not accept owner attestations. Ask its admin to turn them on, or to add this agent as a relay member.";

test.afterEach(cleanupFakes);

test("the type is in the Harness list, and its form asks the three things and holds Create back until they are answered", async ({ page, app }) => {
  const fake = await arrange(page, app);
  const dialog = await openForm(page);
  await expect(dialog.getByRole("combobox", { name: "Harness" })).toContainText("GHOST Protocol");
  await expect(form(page).getByText("Where it runs", { exact: true })).toBeVisible();
  await expect(form(page).getByRole("radio", { name: "This computer" })).toBeChecked();
  await expect(form(page).getByText(QUESTION, { exact: true })).toBeVisible();
  await expect(form(page).getByRole("radio", { name: "Yes", exact: true })).not.toBeChecked();
  await expect(form(page).getByRole("radio", { name: "No", exact: true })).not.toBeChecked();
  // Both ways to sign in are offered, and the token's way leads.
  await expect(form(page).getByRole("radio", { name: "Paste a setup token" })).toBeChecked();
  await expect(form(page).getByRole("radio", { name: "Sign in with an address" })).not.toBeChecked();
  await shot(page, "form-1-empty");

  const submit = dialog.getByRole("button", { name: "Create agent" });
  await dialog.getByPlaceholder("Name").fill("Maple");
  await expect(submit).toBeDisabled();
  await dialog.getByRole("radio", { name: "Yes", exact: true }).check();
  await expect(submit).toBeDisabled(); // no token yet
  await dialog.getByLabel("Claude setup token").fill("two words");
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("Claude setup token").fill(TOKEN);
  await expect(submit).toBeEnabled();
  await dialog.getByRole("radio", { name: "Sign in with an address" }).check();
  await expect(submit).toBeEnabled(); // that way needs nothing before Create
  await dialog.getByRole("radio", { name: "Paste a setup token" }).check();
  await shot(page, "form-2-filled");
  // Looking at the form started no process.
  expect(await gp(page)).toEqual({ calls: [], kills: 0 });
  expect(fake.calls()).toEqual([]);
});

test("Hosted is shown, disabled, and says coming soon; it makes no call and cannot be chosen", async ({ page, app }) => {
  const fake = await arrange(page, app);
  const dialog = await openForm(page);
  const hosted = form(page).getByRole("radio", { name: /^Hosted/ });
  await expect(hosted).toBeDisabled();
  await expect(form(page).getByText("coming soon", { exact: true })).toBeVisible();
  await hosted.click({ force: true });
  await expect(form(page).getByRole("radio", { name: "This computer" })).toBeChecked();
  await fill(dialog);
  await expect(dialog.getByRole("button", { name: "Create agent" })).toBeEnabled();
  expect(await gp(page)).toEqual({ calls: [], kills: 0 });
});

test("Create goes from the form to a listed agent: every step through the fake, in order, with the helper after a yes", async ({ page, app }) => {
  const fake = await arrange(page, app);
  const dialog = await openForm(page);
  await fill(dialog, { update: "Yes" });
  await create(page, dialog);
  // The agent is listed, on this computer, and its panel opens.
  await expect(page.getByText("On this computer")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await shot(page, "create-1-listed");

  expect(calls(fake).map((line) => line.split(" ").slice(0, 4).join(" "))).toEqual([
    "version --format {{.Server.Version}}",
    expect.stringMatching(/^pull .*ghost-protocol:/),
    "inspect --format {{.State.Status}} gp-maple",
    "run --rm -v gp-maple-data:/data",
    "inspect --format {{.State.Status}} gp-maple",
    "run -d --restart unless-stopped",
    "inspect --format {{.State.Status}} gp-maple.updater",
    "run -d --restart unless-stopped",
    "exec -i gp-maple gp",
    "exec gp-maple gp claude",
    "exec -i gp-maple gp",
    "exec gp-maple gp status",
    "exec gp-maple gp status",
  ]);
  const state = fake.state();
  expect(Object.keys(state.containers).sort()).toEqual(["gp-maple", "gp-maple.updater"]);
  const status = JSON.parse((await fake.run(["exec", "gp-maple", "gp", "status", "--json"])).stdout);
  expect(status).toMatchObject({ state: "running", claude: "active", relay: "connected" });
  // The attestation is what Buzz signed for the signed-in person, and the agent was made for that person.
  const tag = fake.calls().find((call) => call.tag)?.tag;
  const parsed = JSON.parse(tag);
  expect(parsed).toHaveLength(4);
  expect(parsed[0]).toBe("auth");
  const init = fake.calls().find((call) => call.argv[0] === "run" && call.argv.includes("init"));
  expect(init.argv.slice(-2)).toEqual(["--owner", parsed[1]]);
  // Every call named a declared process, on the host, with arguments that follow its fixed ones.
  const seen = await gp(page);
  expect(seen.calls.every((call) => call.onHost && call.declared)).toBe(true);
});

test("a new dialog starts clean: no steps and no sign-in carried over from the agent made before it", async ({ page, app }) => {
  await arrange(page, app);
  const first = await openForm(page);
  await fill(first);
  await create(page, first);
  await expect(page.getByText("On this computer")).toBeVisible({ timeout: 60_000 });
  const second = await openForm(page);
  await expect(form(page).locator('[data-gp="claude-status"]')).toContainText("Not signed in yet");
  await expect(progress(page)).toHaveCount(0);
  await second.getByPlaceholder("Name").fill("Birch");
  await second.getByRole("radio", { name: "No", exact: true }).check();
  // The earlier agent's sign-in is not this one's: without a token, Create is held back.
  await expect(second.getByRole("button", { name: "Create agent" })).toBeDisabled();
});

test("a no to self-update starts no helper and never touches the Docker socket", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: "no-self-update" });
  const dialog = await openForm(page);
  await fill(dialog, { update: "No" });
  await create(page, dialog);
  await expect(page.getByText("On this computer")).toBeVisible({ timeout: 60_000 });
  expect(Object.keys(fake.state().containers)).toEqual(["gp-maple"]);
  expect(calls(fake).some((line) => line.includes("docker.sock") || line.includes("updater"))).toBe(false);
});

test("a Claude token goes to the agent on stdin, and is left nowhere: not in a call, the page, a field or storage", async ({ page, app }) => {
  const fake = await arrange(page, app);
  const dialog = await openForm(page);
  await fill(dialog);
  await create(page, dialog);
  await expect(page.getByText("On this computer")).toBeVisible({ timeout: 60_000 });
  const tokenCall = fake.calls().find((call) => call.argv.includes("token"));
  expect(tokenCall.argv).toEqual(["exec", "-i", "gp-maple", "gp", "claude", "token"]);
  expect(tokenCall.stdin.attached).toBe(true);
  expect(await leaks(page, fake)).not.toContain(TOKEN);
});

test("when Docker is missing, Create stops at the first step with Install or start Docker Desktop, and Back shows the step that stopped", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: "docker-missing" });
  const dialog = await openForm(page);
  await fill(dialog);
  await create(page, dialog);
  await expect(introOf(page).getByRole("alert")).toHaveText(DOCKER_TEXT, { timeout: 60_000 });
  expect(Object.keys(fake.state().containers)).toEqual([]);
  expect(calls(fake)).toEqual(["version --format {{.Server.Version}}"]);
  // The token the person typed is still theirs to use again.
  await introOf(page).getByRole("button", { name: "Back", exact: true }).click();
  await expect(step(page, "docker")).toHaveAttribute("data-state", "failed");
  await expect(step(page, "pull")).toHaveAttribute("data-state", "waiting");
  await shot(page, "failure-1-docker");
});

test("pressing Create again after a failure carries on: nothing is started twice", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: "bad-auth-tag" });
  const dialog = await openForm(page);
  await fill(dialog);
  await create(page, dialog);
  await expect(introOf(page).getByRole("alert")).toContainText("did not accept your attestation", { timeout: 60_000 });
  expect(Object.keys(fake.state().containers).sort()).toEqual(["gp-maple", "gp-maple.updater"]);
  fake.use("ok");
  // The agent is made and started, so the second press only has the attestation and the Claude sign-in left.
  await introOf(page).getByRole("button", { name: "Let’s go" }).click();
  await expect(page.getByText("On this computer")).toBeVisible({ timeout: 60_000 });
  const starts = calls(fake).filter((line) => line.startsWith("run -d"));
  expect(starts).toHaveLength(2);
  expect(calls(fake).filter((line) => line.startsWith("run --rm")).length).toBe(1);
});

test("a relay that refuses the agent says so with the agent's public key, and Back has the key with a copy button", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: "relay-refuses" });
  const dialog = await openForm(page);
  await fill(dialog);
  await create(page, dialog);
  const alert = introOf(page).getByRole("alert");
  await expect(alert).toContainText(REFUSED, { timeout: 60_000 });
  const text = await alert.innerText();
  const key = /public key is ([0-9a-f]{64})\./.exec(text)?.[1];
  expect(key).toBeTruthy();
  await introOf(page).getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator('[data-gp="agent-key"]')).toHaveText(key);
  await page.getByRole("button", { name: "Copy public key" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
  await shot(page, "failure-2-refused");
  // The agent already has its Claude sign-in, so pressing Create again needs no token. Once the relay takes the agent it goes the rest of
  // the way, and nothing is made twice.
  await expect(dialog.getByRole("button", { name: "Create agent" })).toBeEnabled();
  fake.use("ok");
  await create(page, dialog);
  await expect(page.getByText("On this computer")).toBeVisible({ timeout: 60_000 });
  expect(calls(fake).filter((line) => line.startsWith("run -d"))).toHaveLength(2);
  expect(calls(fake).filter((line) => line.startsWith("run --rm"))).toHaveLength(1);
});

test("an interface number the plugin does not know stops Create with the update text", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: "unknown-interface" });
  const dialog = await openForm(page);
  await fill(dialog);
  await create(page, dialog);
  await expect(introOf(page).getByRole("alert")).toHaveText(OTHER_INTERFACE, { timeout: 60_000 });
  expect(calls(fake).some((line) => line.includes("auth-tag"))).toBe(false);
});

test("a Buzz that cannot start a program says so, and runs nothing", async ({ page, app }) => {
  await arrange(page, app, { mode: "no-spawn" });
  const dialog = await openForm(page);
  await fill(dialog);
  await create(page, dialog);
  await expect(introOf(page).getByRole("alert")).toHaveText("This Buzz cannot start programs. Use the Buzz desktop app.", { timeout: 60_000 });
});

// The plugin deletes the agent's data volume when Buzz removes the agent (`remote.remove`), which is covered against the fake in the unit
// tests. The whole Delete cannot be driven here: in the web build Buzz archives the agent first, and the harness's fixture relay answers
// that request with a 500. What this test holds is the reason it is acceptable to delete the volume: Buzz's own confirmation, which says
// the key goes and that it can't be undone, comes first, and until the person presses Delete the plugin has removed nothing.
test("Buzz's own Delete warns before anything is removed, and Cancel removes nothing", async ({ page, app }) => {
  const fake = await arrange(page, app);
  const dialog = await openForm(page);
  await fill(dialog);
  await create(page, dialog);
  await expect(page.getByText("On this computer")).toBeVisible({ timeout: 60_000 });
  // The plugin wrote down which container is this agent's.
  expect(await page.evaluate(() => localStorage.getItem("megatech.ghost-protocol.agents"))).toContain("maple");
  expect(Object.keys(fake.state().volumes)).toEqual(["gp-maple-data"]);

  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Delete agent" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Maple?" });
  await expect(confirm).toContainText("Its provider deletes it and its key");
  await expect(confirm).toContainText("It can't be undone.");
  await shot(page, "delete-1-warning");
  const noneRemoved = () => {
    expect(calls(fake).some((line) => line.startsWith("rm ") || line.startsWith("volume rm"))).toBe(false);
    expect(Object.keys(fake.state().containers).sort()).toEqual(["gp-maple", "gp-maple.updater"]);
    expect(Object.keys(fake.state().volumes)).toEqual(["gp-maple-data"]);
  };
  noneRemoved();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  noneRemoved();
});

test("Buzz's Finish setup, with the token way and no form, leaves the agent waiting for Claude and does not refuse it", async ({ page, app }) => {
  const fake = await arrange(page, app, { scenario: "bad-auth-tag" });
  const dialog = await openForm(page);
  await fill(dialog);
  await create(page, dialog);
  await expect(introOf(page).getByRole("alert")).toContainText("did not accept your attestation", { timeout: 60_000 });
  // The dialog is closed, so the token held in memory is gone, and Buzz keeps the agent as one whose setup did not finish.
  await introOf(page).getByRole("button", { name: "Back", exact: true }).click();
  await dialogOf(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialogOf(page)).toHaveCount(0);
  await page.getByText("Maple", { exact: true }).first().click();
  await expect(page.getByText("Its provider made it, but its setup did not finish.")).toBeVisible();
  fake.use("ok");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByText("On this computer")).toBeVisible({ timeout: 60_000 });
  // It was not refused for lack of a token: the sign-in is left for its tab.
  expect(calls(fake).some((line) => line.includes(" claude token") || line.includes(" claude login"))).toBe(false);
  const waiting = JSON.parse((await fake.run(["exec", "gp-maple", "gp", "status", "--json"])).stdout);
  expect(waiting.state).toBe("needs-claude");
  await page.getByRole("tab", { name: "GHOST Protocol" }).click();
  await expect(page.locator('[data-gp="claude"] [data-gp="claude-state"]')).toHaveText("Claude: not active");
  expect(Object.keys(fake.state().containers).sort()).toEqual(["gp-maple", "gp-maple.updater"]);
});

test("the tab acts only on a container that says it is this agent's", async ({ page, app }) => {
  const fake = await arrange(page, app);
  const dialog = await openForm(page);
  await fill(dialog);
  await create(page, dialog);
  await expect(page.getByText("On this computer")).toBeVisible({ timeout: 60_000 });
  const tab = page.getByRole("tab", { name: "GHOST Protocol" });
  const remount = async () => {
    await page.getByRole("tab", { name: "Identity" }).click();
    await tab.click();
  };

  // Its own container: the status screen and the Claude panel are there.
  await tab.click();
  await expect(page.locator('[data-gp="agent-tab"] .gp-agent')).toBeVisible();

  // A container that cannot say, with the pair the plugin wrote down: still its own, so the screen shows it stopped, with Restart.
  fake.patchState((state) => {
    for (const container of Object.values(state.containers)) container.running = false;
  });
  await remount();
  await expect(page.locator('[data-gp="agent-tab"] .gp-agent').getByRole("button", { name: "Restart", exact: true })).toBeVisible({ timeout: 30_000 });

  // The same container with no pair written down: the name is only a guess, and a container that cannot say is not acted on.
  await page.evaluate(() => localStorage.removeItem("megatech.ghost-protocol.agents"));
  const before = calls(fake).length;
  await remount();
  await expect(page.locator('[data-gp="container-unknown"]')).toContainText("Nothing here acts on gp-maple");
  await expect(page.locator('[data-gp="agent-tab"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Restart", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Claude setup token")).toHaveCount(0);
  await shot(page, "tab-1-unknown");

  // A running container whose status names another agent's key: this agent's tab does not act on it, pair or no pair.
  fake.patchState((state) => {
    for (const container of Object.values(state.containers)) container.running = true;
    for (const volume of Object.values(state.volumes)) volume.pubkey = "c".repeat(64);
  });
  await remount();
  await expect(page.locator('[data-gp="container-other"]')).toContainText("This container belongs to another agent");
  await expect(page.getByRole("button", { name: "Restart", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Claude setup token")).toHaveCount(0);
  // Nothing was sent to it but the one look at its status.
  const sent = calls(fake).slice(before).filter((line) => !line.startsWith("exec gp-maple gp status --json") && !line.startsWith("inspect "));
  expect(sent).toEqual([]);
  await shot(page, "tab-2-other");
});

test("the tab is only on its own agents: another type's agent has none", async ({ page, app }) => {
  await arrange(page, app);
  await page.getByText("Local tester", { exact: true }).first().click();
  await expect(page.getByRole("tab", { name: "Identity" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "GHOST Protocol" })).toHaveCount(0);
});

test("the form follows the light and the dark theme, with text that reads in both", async ({ page, app }) => {
  await arrange(page, app);
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
      // The first opaque background above the text: the dialog's own surface.
      const ground = (element) => {
        for (let node = element; node; node = node.parentElement) {
          const colour = rgb(getComputedStyle(node).backgroundColor);
          if (colour.a === 1) return colour;
        }
        return rgb("#fff");
      };
      const read = (selector) => {
        const element = document.querySelector(selector);
        return ratio(rgb(getComputedStyle(element).color), ground(element));
      };
      return { hint: read('[data-gp="configuration"] .gp-hint'), question: read('[data-gp="configuration"] .gp-question'), soon: read(".gp-soon") };
    });
  for (const mode of ["Light", "Dark"]) {
    await openSettings(page);
    await selectSettingsSection(page, "Appearance");
    await chooseColorMode(page, mode);
    await closeSettings(page);
    await openForm(page);
    const seen = await contrast();
    expect(seen.hint, `${mode}: hint text contrast`).toBeGreaterThanOrEqual(4.5);
    expect(seen.question, `${mode}: question text contrast`).toBeGreaterThanOrEqual(4.5);
    expect(seen.soon, `${mode}: "coming soon" contrast`).toBeGreaterThanOrEqual(4.5);
    await shot(page, `theme-${mode.toLowerCase()}`);
    await dialogOf(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialogOf(page)).toHaveCount(0);
  }
});
