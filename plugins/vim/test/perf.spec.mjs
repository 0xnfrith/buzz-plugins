// Baseline numbers for the Vim mode plugin in headless Chromium (the fixture app of plugins/vim/test/run.sh).
// Run with plugins/vim/test/perf.sh with | without. It measures one scenario and writes JSON; compare the two.
//
//   key -> paint   the time from the keydown reaching the window to the frame after it (a message sent
//                  after requestAnimationFrame, which arrives once the frame is on screen)
//   idle           what the page does with nobody touching it, per second: layouts, style recalculations,
//                  script and task time, from Chrome's own counters (CDP Performance.getMetrics)
//   per key        the same counters over a run of identical keys, divided by the keys
import fs from "node:fs";
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";

test.use({ pluginFixtures: true, historyCounts: { alpha: 200, beta: 3 } });

const MODE = process.env.PERF_MODE ?? "with";
const OUT = process.env.PERF_OUT ?? `/tmp/vim-perf-${MODE}`;
const IDLE_SECONDS = Number(process.env.PERF_IDLE ?? 20);
// With PERF_TRACE=paint|full the plugin's own performance trace is on (it is off by default), and each phase
// also reports what the plugin did: per handler, how often it ran, how long, and which DOM calls it made.
const TRACE = process.env.PERF_TRACE ?? "";
const COUNTERS = ["LayoutCount", "RecalcStyleCount", "LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration"];

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const r = (x) => Math.round(x * 100) / 100;
  return { n: sorted.length, median: r(at(0.5)), p95: r(at(0.95)), max: r(sorted.at(-1)), mean: r(sorted.reduce((a, b) => a + b, 0) / sorted.length) };
};

test(`baseline, plugin ${MODE}`, async ({ page, app }, info) => {
  test.setTimeout(240_000);
  if (TRACE)
    await page.addInitScript((level) => localStorage.setItem("megatech.vim-mode.settings.v2", JSON.stringify({ perf: level })), TRACE);
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
  await open(page, app);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const settle = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return metrics();
  };
  const delta = (a, b, per) =>
    Object.fromEntries(COUNTERS.map((name) => [name, Math.round(((b[name] - a[name]) / per) * 10000) / 10000]));
  // key is one key, or a list of keys used in turn.
  const press = async (key, count) => {
    const start = await page.evaluate(() => window.__kp.length);
    for (let i = 0; i < count; i++) {
      await page.keyboard.press(Array.isArray(key) ? key[i % key.length] : key);
      await page.waitForFunction((n) => window.__kp.length >= n, start + i + 1);
    }
    return page.evaluate((s) => window.__kp.slice(s), start);
  };
  const trace = (count) =>
    TRACE === "full"
      ? page.evaluate((n) => {
          const t = window.__vimPerf.summary();
          const per = (x) => Math.round((x / n) * 1000) / 1000;
          return {
            handlers: Object.fromEntries(
              Object.entries(t.handlers)
                .slice(0, 14)
                .map(([name, h]) => [name, { callsPerKey: per(h.n), msPerKey: per(h.ms), maxMs: h.max, apiPerKey: Object.fromEntries(Object.entries(h.api).map(([k, v]) => [k, per(v)])), apiMsPerKey: Object.fromEntries(Object.entries(h.apiMs).map(([k, v]) => [k, per(v)])) }]),
            ),
            hostApiPerKey: Object.fromEntries(Object.entries(t.host).map(([k, v]) => [k, per(v)])),
            countersPerKey: Object.fromEntries(Object.entries(t.counters).map(([k, v]) => [k, per(v)])),
          };
        }, count)
      : undefined;
  const run = async (name, key, count) => {
    const before = await metrics();
    if (TRACE === "full") await page.evaluate(() => window.__vimPerf.reset());
    const samples = await press(key, count);
    const after = await metrics();
    return { name, key: String(key), ...stats(samples), perKey: delta(before, after, count), trace: await trace(count) };
  };

  const result = { mode: MODE, phases: [] };
  // Idle: nobody touches the page.
  await page.waitForTimeout(2000);
  const idleStart = await settle();
  // A sampling profile of the idle seconds: how much of the time the main thread is busy at all, and in what.
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  await page.waitForTimeout(IDLE_SECONDS * 1000);
  const { profile } = await cdp.send("Profiler.stop");
  const idleEnd = await settle();
  const names = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  let total = 0;
  let idle = 0;
  const self = new Map();
  profile.samples.forEach((id, i) => {
    const dt = profile.timeDeltas[i] ?? 0;
    total += dt;
    const frame = names.get(id);
    if (frame.functionName === "(idle)") idle += dt;
    else {
      const label = `${frame.functionName || "(anonymous)"} ${frame.url.split("/").pop()}:${frame.lineNumber}:${frame.columnNumber}`;
      self.set(label, (self.get(label) ?? 0) + dt);
    }
  });
  result.idleProfile = {
    busyMsPerSecond: Math.round(((total - idle) / 1000 / IDLE_SECONDS) * 100) / 100,
    top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, us]) => [label, Math.round((us / 1000 / IDLE_SECONDS) * 100) / 100]),
  };
  result.idle = { seconds: IDLE_SECONDS, perSecond: delta(idleStart, idleEnd, IDLE_SECONDS), heapMB: Math.round((idleEnd.JSHeapUsedSize / 1048576) * 10) / 10, nodes: idleEnd.Nodes, listeners: idleEnd.JSEventListeners };
  // j and k in turn in the message list, from the oldest mounted message: the fixture mounts only a dozen or so
  // messages, so a run of j would reach the message box. 20 to warm up, then 100 measured.
  const where = () =>
    page.evaluate(
      () => `${document.activeElement?.tagName} ${document.activeElement?.getAttribute("aria-label") ?? ""} | ${document.querySelector("[data-vim-status]")?.textContent ?? "no plugin"}`,
    );
  result.focus = { afterIdle: await where() };
  await press("g", 2);
  result.focus.afterGg = await where();
  await press(["j", "k"], 21);
  result.focus.afterWarmUp = await where();
  result.phases.push(await run("j k x100 (message list)", ["j", "k"], 100));
  result.focus.afterJ = await where();
  // Typing a line into the message box, one key at a time.
  const box = page.getByRole("textbox", { name: "Message #Alpha", exact: true });
  await box.click();
  const typing = [];
  for (const char of "the quick brown fox jumps over the lazy dog and the quick brown fox again") typing.push(char);
  const before = await metrics();
  if (TRACE === "full") await page.evaluate(() => window.__vimPerf.reset());
  const start = await page.evaluate(() => window.__kp.length);
  for (const [i, char] of typing.entries()) {
    await page.keyboard.press(char === " " ? "Space" : char);
    await page.waitForFunction((n) => window.__kp.length >= n, start + i + 1);
  }
  const typed = await page.evaluate((s) => window.__kp.slice(s), start);
  result.phases.push({ name: `typing ${typing.length} characters (message box)`, ...stats(typed), perKey: delta(before, await metrics(), typing.length), trace: await trace(typing.length) });
  if (MODE === "with") {
    // Normal mode in the box: motions over the line just typed.
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-vim-status]")).toContainText("NORMAL");
    for (const key of ["w", "b", "0", "$"]) result.phases.push(await run(`${key} x50 (message box, NORMAL)`, key, 50));
  }
  result.after = await settle();
  fs.writeFileSync(`${OUT}.${info.repeatEachIndex}.json`, JSON.stringify(result, null, 2));
  console.log(`PERF ${MODE} ${JSON.stringify(result)}`);
});
