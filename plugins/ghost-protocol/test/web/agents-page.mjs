// What the browser specs of the GHOST Protocol plugin share: the Agents page in Buzz's web build with `docker` being the fake, the create
// dialog and a way to fill it, the places a secret could be left, and the clean-up each test owes. The specs and this file are copied
// into the app checkout together (test/run.sh), which is where ./fixture.mjs and ./navigation.mjs are.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "./fixture.mjs";
import { openPage } from "./navigation.mjs";

export const dir = process.env.GHOST_PROTOCOL_DIR;
const { createFakeDocker } = await import(pathToFileURL(join(dir, "test/fake-docker/index.mjs")).href);
const { exposeDocker } = await import(pathToFileURL(join(dir, "test/web/pipe.mjs")).href);

const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
export const shot = (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

export const TOKEN = "sk-ant-oat01-MADE-UP-TOKEN-1234567890";
export const CODE = "MADE-UP-LOGIN-CODE-9876";

const fakes = [];

/** Run after each test: ends the fakes it made, and fails the test if one refused a command. */
export async function cleanupFakes() {
  // The fake refuses a command it does not know (exit 64, `refused` in its log): a plugin that drifts from the interface fails here.
  const refused = fakes.flatMap((fake) => fake.calls().filter((call) => call.refused).map((call) => call.argv.join(" ")));
  for (const fake of fakes.splice(0)) {
    // A command of the page may still be running and writing to the fake's folder: try again until it has ended.
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
}

/** The Agents page with `docker` being the fake. `scenario` is the fake's; `mode: "no-spawn"` is a host that cannot start a process. */
export async function arrange(page, app, { scenario = {}, mode } = {}) {
  page.setDefaultTimeout(30_000);
  const fake = createFakeDocker({ scenario });
  fakes.push(fake);
  await exposeDocker(page, fake, dir);
  // The plugin's one check of Docker is a closed command, `version`: the stub hands it to the fake too, through `__gpDocker`.
  await page.exposeFunction("__gpDocker", async (argv) => {
    const { stdout, stderr, code } = await fake.run(argv);
    return { stdout, stderr, code };
  });
  await page.addInitScript(
    (hostMode) => {
      window.__gp = { script: [], fallback: { stdout: "27.3.1\n", code: 0 }, calls: [], kills: 0, release() {}, mode: hostMode, stream: true, fake: true };
    },
    mode,
  );
  // The avatar picker loads a video: answer it with nothing, so the harness does not fail on a blocked request.
  await page.route("https://dwwgwmfqqjotj.cloudfront.net/**", (route) => route.fulfill({ status: 200, contentType: "video/webm", body: "" }));
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.origin }).catch(() => undefined);
  await page.setViewportSize({ width: 1280, height: 1150 });
  await page.goto(app.origin, { timeout: 90_000, waitUntil: "domcontentloaded" });
  await openPage(page, "Agents");
  return fake;
}

export const dialogOf = (page) => page.getByRole("dialog", { name: "Create agent" });
export const introOf = (page) => page.getByRole("dialog", { name: "Meet your remote agent" });
export const form = (page) => page.locator('[data-gp="configuration"]');
export const progress = (page) => page.locator('[data-gp="progress"]');
export const step = (page, id) => progress(page).locator(`[data-step="${id}"]`);
export const calls = (fake) => fake.calls().map((call) => call.argv.join(" "));
export const gp = (page) => page.evaluate(() => ({ calls: window.__gp.calls, kills: window.__gp.kills }));

/** New agent, Create a new agent, and the GHOST Protocol harness. */
export async function openForm(page) {
  await page.getByRole("button", { name: "New agent" }).click();
  await page.getByRole("menuitem", { name: /Create a new agent/ }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Harness" }).click();
  await page.getByRole("option", { name: "GHOST Protocol" }).click();
  await expect(form(page)).toBeVisible();
  return dialog;
}

/** Fills the form: the name, the answer to the update question, and, for the token's way, the token. */
export async function fill(dialog, { name = "Maple", update = "Yes", way = "token", token = TOKEN } = {}) {
  await dialog.getByPlaceholder("Name").fill(name);
  if (update) await dialog.getByRole("radio", { name: update, exact: true }).check();
  if (way === "login") await dialog.getByRole("radio", { name: "Sign in with an address" }).check();
  else if (token !== undefined) await dialog.getByLabel("Claude setup token").fill(token);
}

export const create = async (page, dialog) => {
  await dialog.getByRole("button", { name: "Create agent" }).click();
  await expect(introOf(page)).toBeVisible();
  await introOf(page).getByRole("button", { name: "Let’s go" }).click();
};

/** Everything a secret could be left in: the page's text, its fields, its storage, and every call the fake saw. */
export const leaks = (page, fake) =>
  page
    .evaluate(() =>
      JSON.stringify({
        text: document.body.innerText,
        fields: [...document.querySelectorAll("input, textarea")].map((field) => field.value),
        local: { ...localStorage },
        session: { ...sessionStorage },
        gp: window.__gp.calls,
      }),
    )
    .then((found) => found + JSON.stringify([fake.calls(), fake.state()]));

