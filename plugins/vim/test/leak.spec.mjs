// Does replacing the plugin dispose the old revision? The host applies a plugin, and on disable or on
// replacement runs the cleanup its effect returned, then applies the new one. So switching the plugin off and on
// in Settings is the same dispose-and-apply, repeated here; the real Update flow is checked in the real app.
// After the first cycle the page is in its steady state; five more cycles must add nothing: no listener, timer,
// animation frame, observer, node, attribute or byte of heap that the plugin made and did not give back.
// Run with plugins/vim/test/perf.sh (SPEC=leak.spec.mjs, mode with).
import fs from "node:fs";
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";
import { setPluginEnabled } from "./plugin-settings.mjs";
import { selectSettingsSection } from "./navigation.mjs";

test.use({ pluginFixtures: true, historyCounts: { alpha: 30, beta: 3 } });

const CYCLES = Number(process.env.LEAK_CYCLES ?? 5);
const OUT = process.env.PERF_OUT ?? "/tmp/vim-leak";

test("switching the plugin off and on leaves nothing behind", async ({ page, app }, info) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    // What is alive: timers, frames and observers, with the stack that made them.
    const live = { interval: new Map(), timeout: new Map(), frame: new Map(), observers: new Map() };
    const where = () => new Error().stack.split("\n").slice(2, 5).map((line) => line.trim().replace(/^at /, "")).join(" < ");
    const setInterval_ = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...rest) => {
      const id = setInterval_(fn, ms, ...rest);
      live.interval.set(id, where());
      return id;
    };
    const clearInterval_ = window.clearInterval.bind(window);
    window.clearInterval = (id) => (live.interval.delete(id), clearInterval_(id));
    const setTimeout_ = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...rest) => {
      const id = setTimeout_(
        (...args) => (live.timeout.delete(id), typeof fn === "function" ? fn(...args) : undefined),
        ms,
        ...rest,
      );
      live.timeout.set(id, where());
      return id;
    };
    const clearTimeout_ = window.clearTimeout.bind(window);
    window.clearTimeout = (id) => (live.timeout.delete(id), clearTimeout_(id));
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (fn) => {
      const id = raf((time) => (live.frame.delete(id), fn(time)));
      live.frame.set(id, where());
      return id;
    };
    const caf = window.cancelAnimationFrame.bind(window);
    window.cancelAnimationFrame = (id) => (live.frame.delete(id), caf(id));
    for (const name of ["ResizeObserver", "MutationObserver", "IntersectionObserver"]) {
      const Original = window[name];
      window[name] = class extends Original {
        observe(...args) {
          live.observers.set(this, `${name} ${where()}`);
          return super.observe(...args);
        }
        disconnect() {
          live.observers.delete(this);
          return super.disconnect();
        }
      };
    }
    window.__live = () => ({
      intervals: [...live.interval.values()],
      timeouts: [...live.timeout.values()],
      frames: [...live.frame.values()],
      observers: [...live.observers.values()],
    });
  });
  await open(page, app);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  await cdp.send("DOM.enable");
  const listeners = async () => {
    const out = {};
    for (const target of ["window", "document", "document.documentElement", "document.body"]) {
      const { result } = await cdp.send("Runtime.evaluate", { expression: target });
      const { listeners: found } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
      for (const { type } of found) out[`${target} ${type}`] = (out[`${target} ${type}`] ?? 0) + 1;
    }
    return out;
  };
  const look = async (label) => {
    await page.waitForTimeout(3000); // one-shot timers finish
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const page_ = await page.evaluate(() => ({
      nodes: document.getElementsByTagName("*").length,
      vimNodes: document.querySelectorAll("[data-vim-status], style[data-vim-cursor-style], [data-vim-help]").length,
      rootAttributes: document.documentElement.getAttributeNames().filter((name) => name.startsWith("data-vim")),
      live: window.__live(),
      revisions: window.__vimRevisions ?? null, // applied and disposed, counted by the plugin itself
    }));
    return {
      label,
      heapKB: Math.round(metrics.JSHeapUsedSize / 1024),
      jsListeners: metrics.JSEventListeners,
      nodes: page_.nodes,
      vimNodes: page_.vimNodes,
      rootAttributes: page_.rootAttributes,
      listeners: await listeners(),
      intervals: page_.live.intervals.length,
      timeouts: page_.live.timeouts.length,
      frames: page_.live.frames.length,
      observers: page_.live.observers.length,
      revisions: page_.revisions,
      liveDetail: page_.live,
    };
  };
  const cursorSteps = async () => {
    // One j moves the cursor one message: a handler left over from an old revision would move it more than once.
    const id = () => page.locator("style[data-vim-cursor-style]").getAttribute("data-message-id");
    await page.keyboard.press("Escape");
    await page.keyboard.press("k");
    const first = await id();
    await page.keyboard.press("k");
    const second = await id();
    await page.keyboard.press("j");
    return { first, second, back: await id() };
  };

  await press_settings(page);
  const off = () => setPluginEnabled(page, "Vim mode", false);
  const on = () => setPluginEnabled(page, "Vim mode", true);
  const result = { cycles: CYCLES, steps: [] };
  const enabledRows = [];
  const disabledRows = [];
  // Cycle 0 is the page settling into its steady state with Settings open.
  await off();
  disabledRows.push(await look("disabled 0"));
  await on();
  enabledRows.push(await look("enabled 0"));
  for (let i = 1; i <= CYCLES; i++) {
    await off();
    disabledRows.push(await look(`disabled ${i}`));
    await on();
    enabledRows.push(await look(`enabled ${i}`));
  }
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  // Not before the dialog is gone: while it closes a key still belongs to it, and the first k was lost now and then.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const steps = await cursorSteps();
  result.steps = steps;
  result.enabled = enabledRows;
  result.disabled = disabledRows;
  fs.writeFileSync(`${OUT}.json`, JSON.stringify(result, null, 2));
  const diff = (rows, field) => rows.at(-1)[field] - rows[0][field];
  const summary = (rows) => ({
    heapKB: diff(rows, "heapKB"),
    jsListeners: diff(rows, "jsListeners"),
    nodes: diff(rows, "nodes"),
    intervals: diff(rows, "intervals"),
    timeouts: diff(rows, "timeouts"),
    frames: diff(rows, "frames"),
    observers: diff(rows, "observers"),
    vimNodes: rows.at(-1).vimNodes,
  });
  console.log(`LEAK enabled ${CYCLES} cycles later vs the first: ${JSON.stringify(summary(enabledRows))}`);
  console.log(`LEAK disabled ${CYCLES} cycles later vs the first: ${JSON.stringify(summary(disabledRows))}`);
  console.log(`LEAK listeners enabled first ${JSON.stringify(enabledRows[0].listeners)}`);
  console.log(`LEAK listeners enabled last  ${JSON.stringify(enabledRows.at(-1).listeners)}`);
  console.log(`LEAK listeners disabled      ${JSON.stringify(disabledRows.at(-1).listeners)}`);
  console.log(`LEAK cursor ${JSON.stringify(steps)}`);
  // Nothing grows, and the plugin's own nodes and attributes are gone while it is off.
  expect(disabledRows.every((row) => row.vimNodes === 0 && row.rootAttributes.length === 0)).toBe(true);
  for (const field of ["jsListeners", "nodes", "intervals", "timeouts", "frames", "observers"]) {
    expect(diff(enabledRows, field), `${field} while on`).toBeLessThanOrEqual(0);
    expect(diff(disabledRows, field), `${field} while off`).toBeLessThanOrEqual(0);
  }
  // The plugin counts what it applies and disposes: one revision alive while on, none while off.
  for (const row of enabledRows) expect(row.revisions.applied - row.revisions.disposed, row.label).toBe(1);
  for (const row of disabledRows) expect(row.revisions.applied - row.revisions.disposed, row.label).toBe(0);
  console.log(`LEAK revisions after the last cycle ${JSON.stringify(enabledRows.at(-1).revisions)}`);
  expect(steps.first).not.toBe(steps.second);
  expect(steps.back).toBe(steps.first);
});

async function press_settings(page) {
  await page.keyboard.press("Control+,");
  await selectSettingsSection(page, "Manage plugins");
}
