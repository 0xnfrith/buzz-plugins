// Does the page grow while the plugin sits there? The fixture app for IDLE_MINUTES (default 5), every 15 s:
// collect garbage and read the heap, the DOM node count, the event listeners and the documents from Chrome's own
// counters (CDP Performance.getMetrics). The slope of the heap after collection is the leak rate.
//
//   SCENARIO=idle   nobody touches the page (default)
//   SCENARIO=keys   one key every 250 ms (j k in the list, then w b in the message box), the way a user holds the keys
//   SCENARIO=busy   a varied session on a loop: the list (gg G j k), the message box (i, typing, Esc, w b 0 $ x u v,
//                   clearing the draft), a thread tab opened and closed, the help, and channel switches
//
// Run with plugins/vim/test/perf.sh (SPEC=idle.spec.mjs, mode with|without; PLUGIN_JS measures another revision).
import fs from "node:fs";
import { test } from "./fixture.mjs";
import { open } from "./timeline.mjs";

test.use({ pluginFixtures: true, historyCounts: { alpha: 200, beta: 3 } });

const MODE = process.env.PERF_MODE ?? "with";
const MINUTES = Number(process.env.IDLE_MINUTES ?? 5);
const SCENARIO = process.env.SCENARIO ?? "idle";
const OUT = process.env.PERF_OUT ?? `/tmp/vim-idle-${MODE}`;
const EVERY_MS = 15_000;

test(`growth over ${MINUTES} minutes, ${SCENARIO}, plugin ${MODE}`, async ({ page, app }, info) => {
  test.setTimeout((MINUTES + 3) * 60_000);
  await open(page, app);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  const read = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const sample = async (t) => {
    const raw = await read();
    await cdp.send("HeapProfiler.collectGarbage");
    const m = await read();
    return {
      minute: Math.round((t / 60_000) * 100) / 100,
      heapKB: Math.round(m.JSHeapUsedSize / 1024),
      heapBeforeGcKB: Math.round(raw.JSHeapUsedSize / 1024),
      totalKB: Math.round(m.JSHeapTotalSize / 1024),
      nodes: m.Nodes,
      listeners: m.JSEventListeners,
      documents: m.Documents,
      layouts: m.LayoutCount,
      styles: m.RecalcStyleCount,
      scriptSec: Math.round(m.ScriptDuration * 1000) / 1000,
    };
  };
  const rows = [];
  const start = Date.now();
  await page.waitForTimeout(2000);
  rows.push(await sample(0));
  let keyTimer;
  if (SCENARIO === "keys") {
    // Escape first so the keys are commands; then alternate between the list and the box.
    const sequence = ["Escape", "g", "g", "j", "j", "k", "j", "k", "k", "j"];
    let i = 0;
    keyTimer = setInterval(() => {
      page.keyboard.press(sequence[i++ % sequence.length]).catch(() => {});
    }, 250);
  }
  while (SCENARIO !== "busy" && Date.now() - start < MINUTES * 60_000) {
    await page.waitForTimeout(EVERY_MS);
    rows.push(await sample(Date.now() - start));
  }
  if (SCENARIO === "busy") {
    const key = (...keys) => keys.reduce((p, k) => p.then(() => page.keyboard.press(k)).then(() => page.waitForTimeout(30)), Promise.resolve());
    const typed = (text) => page.keyboard.type(text, { delay: 15 });
    let cycle = 0;
    while (Date.now() - start < MINUTES * 60_000) {
      cycle++;
      await key("Escape", "g", "g", "j", "j", "j", "j", "j", "k", "k", "G");
      await key("j"); // past the newest message: into the box, in NORMAL
      await key("i");
      await typed("hello vim mode " + cycle);
      await key("Escape", "0", "w", "w", "b", "$", "x", "u", "v", "w", "Escape");
      await key("i", "Control+a", "Backspace", "Escape", "Escape", "k"); // clear the draft, back up to the list
      if (cycle % 4 === 0) {
        await key("k", "o"); // a thread tab beside the list
        await page.waitForTimeout(300);
        await key("j", "j", "k", "i");
        await typed("r");
        await key("Control+a", "Backspace", "Escape", "Escape", "k");
        await key("Space", "q"); // leader q closes the thread
        await page.waitForTimeout(300);
      }
      if (cycle % 3 === 0) await key("Escape", "?", "Escape");
      if (cycle % 5 === 0) {
        await key("Escape", "]");
        await page.waitForTimeout(300);
        await key("[");
        await page.waitForTimeout(300);
      }
      if (Date.now() - start > rows.length * EVERY_MS) rows.push(await sample(Date.now() - start));
    }
    console.log(`BUSY ${cycle} cycles`);
  }
  clearInterval(keyTimer);
  // Least squares over the second half of the run (the first half is the page settling).
  const slope = (field) => {
    const part = rows.slice(Math.floor(rows.length / 2));
    const n = part.length;
    const mean = (f) => part.reduce((a, r) => a + f(r), 0) / n;
    const mx = mean((r) => r.minute);
    const my = mean((r) => r[field]);
    const num = part.reduce((a, r) => a + (r.minute - mx) * (r[field] - my), 0);
    const den = part.reduce((a, r) => a + (r.minute - mx) ** 2, 0);
    return den ? Math.round((num / den) * 100) / 100 : 0;
  };
  const result = {
    mode: MODE,
    scenario: SCENARIO,
    minutes: MINUTES,
    perMinute: { heapKB: slope("heapKB"), heapBeforeGcKB: slope("heapBeforeGcKB"), nodes: slope("nodes"), listeners: slope("listeners") },
    first: rows[0],
    last: rows.at(-1),
    rows,
  };
  fs.writeFileSync(`${OUT}.${info.repeatEachIndex}.json`, JSON.stringify(result, null, 2));
  console.log(`IDLE ${MODE} ${SCENARIO} ${MINUTES} min per minute ${JSON.stringify(result.perMinute)} first ${JSON.stringify(rows[0])} last ${JSON.stringify(rows.at(-1))}`);
});
