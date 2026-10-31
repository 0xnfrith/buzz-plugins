// Does the highlighter slow the message list? The same 2,400-message channel, one message in five holding known skills, is loaded and
// scrolled with the plugin off and on, and the load time and the frame times of the scroll are reported side by side. The matcher itself
// is measured by test/bench.mjs. Run with plugins/agent-skills-highlighter/test/run.sh.
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";
import { openSettings, selectSettingsSection, settingsDialog } from "./navigation.mjs";
import { setPluginEnabled } from "./plugin-settings.mjs";

test.use({ pluginFixtures: true, historyCounts: { alpha: 2400, beta: 3 }, olderPageDelayMs: 50 }); // without the delay "Load older messages" never completes
test.describe.configure({ mode: "serial" });
test.setTimeout(900_000); // each of the two runs fills 330,000 px of history and scrolls it three times: five minutes on a quiet 2-CPU machine

const SKILLS = [
  "@@@\tuser\t\tbrainstorming",
  "name: brainstorming",
  "description: Explore intent before building.",
  "@@@\tuser\t\tplan-review",
  "name: plan-review",
  "description: Review a plan.",
  "@@@\tuser\t\tdeploy",
  "name: deploy",
  "description: Ship it.",
  "",
].join("\n");
const results = {};

// The harness serves the newest page and holds the older ones until they are asked for: load them all, as a reader who has scrolled back
// would have, so the list is as long as the channel (a couple of dozen rows are mounted at a time). run.sh, with SKILLS_PERF=1, makes
// every fifth message of the fixture's history hold the skills (in the scratch checkout only). The whole list is then scrolled in one
// pass, half a screen a frame, so that every frame mounts new rows: the cost of drawing a row is what is measured.
const pause = (page, ms) => page.evaluate((delay) => new Promise((resolve) => setTimeout(resolve, delay)), ms);
async function measure(page, label) {
  const scroller = page.locator("[data-main-workspace] [data-message-scroller], [data-solo-focus-pane] [data-message-scroller]").first();
  const older = page.getByRole("button", { name: "Load older messages" });
  const started = Date.now();
  let height = 0;
  // The channel is in when the list is about as high as 2,400 of the fixture's messages make it (the loads are timed by the harness, so wait for the height, not for a count of tries).
  for (let i = 0; i < 900 && height < 330_000; i++) {
    if (await older.count()) await older.first().click().catch(() => {});
    else await scroller.evaluate((el) => (el.scrollTop = 0));
    await pause(page, 250);
    height = await scroller.evaluate((el) => el.scrollHeight);
  }
  expect(height, "the whole history is loaded").toBeGreaterThanOrEqual(330_000);
  const fillMs = Date.now() - started;
  // Three passes from the newest message to the oldest, half a screen a frame; the figures are the middle value of the three.
  const passes = [];
  for (let pass = 0; pass < 3; pass++) {
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await pause(page, 1200);
    const frames = await scroller.evaluate(
      (el) =>
        new Promise((resolve) => {
          const times = [];
          let last = performance.now();
          const step = () => {
            const now = performance.now();
            times.push(now - last);
            last = now;
            el.scrollTop -= el.clientHeight * 0.5;
            if (el.scrollTop <= 1 || times.length > 400) resolve(times);
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
    );
    const sorted = [...frames].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    passes.push({ frames: frames.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) });
  }
  const middle = (key) => [...passes].map((one) => one[key]).sort((a, b) => a - b)[1];
  const tokens = await page.locator("[data-skill]").count();
  const result = { scrollHeight: height, fillMs, frames: passes[0].frames, p50: middle("p50"), p95: middle("p95"), p99: middle("p99"), max: middle("max"), tokens };
  console.log(`PERF ${label} ${JSON.stringify(Object.fromEntries(Object.entries(result).map(([k, v]) => [k, Math.round(v * 10) / 10])))} passes ${JSON.stringify(passes.map((one) => [one.p50, one.p95].map((v) => Math.round(v))))}`);
  return result;
}

for (const state of ["off", "on"]) {
  test(`2,400 messages, one in five with skills, plugin ${state}`, async ({ page, app }) => {
    await page.exposeFunction("__skillsRun", () => SKILLS);
    if (state === "off") {
      await page.goto(app.origin);
      await openSettings(page);
      await selectSettingsSection(page, "Manage plugins");
      await setPluginEnabled(page, "Agent Skills Highlighter", false);
      await settingsDialog(page).getByRole("button", { name: "Close Settings", exact: true }).click();
    }
    await open(page, app);
    results[state] = await measure(page, state);
    if (state === "off") expect(results.off.tokens).toBe(0);
    else expect(results.on.tokens).toBeGreaterThan(0);
  });
}

test("the highlighter's cost stays small: fill time and the middle frame times within a fifth of the same list without it, plus a small allowance", async () => {
  const { on, off } = results;
  console.log(`PERF compare load ${off.fillMs} -> ${on.fillMs} ms; p50 ${off.p50.toFixed(1)} -> ${on.p50.toFixed(1)}; p95 ${off.p95.toFixed(1)} -> ${on.p95.toFixed(1)}; p99 ${off.p99.toFixed(1)} -> ${on.p99.toFixed(1)} ms`);
  expect(Math.abs(on.scrollHeight - off.scrollHeight)).toBeLessThan(off.scrollHeight * 0.05); // the same list, with or without the plugin: both loaded to the same depth, give or take a page
  expect(on.fillMs).toBeLessThanOrEqual(off.fillMs * 1.2 + 3000);
  expect(on.p50).toBeLessThanOrEqual(off.p50 * 1.2 + 4);
  expect(on.p95).toBeLessThanOrEqual(off.p95 * 1.2 + 12); // p99 is reported, not asserted: with a few hundred frames it is one frame
});
