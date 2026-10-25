// The key-latency budget of Vim mode, in Buzz's own browser harness (headless Chromium, the production web build).
//
//   plugins/vim/test/budget.sh /path/to/block/buzz-app/checkout      (see README.md, "Key latency budget")
//
// WHAT IS MEASURED. For every key pressed: the time from the `keydown` reaching the window (a capture listener on the
// window, before any listener of the app or the plugin) to the second frame painted after it (two requestAnimationFrames,
// then a MessageChannel message, which arrives once that frame is on screen). Both ends are performance.now(). The second
// frame, not the first, because the plugin puts the work that has to wait for a scroll to lay out (the cursor moving after
// Ctrl-e, gg, G) behind two animation frames; the first frame's figures are kept in the JSON as `first`. This covers the
// handlers of the page and of the plugin, style, layout and paint, and not the GPU. Chromium is started with its frame-rate
// limit off: otherwise every key waits up to a 60 Hz tick (16.7 ms) whatever the plugin does, and a p95 of 16 ms could not
// be met by an empty handler. BUDGET_VSYNC=1 turns the tick back on.
//
// THE BUDGET. p95 <= 16 ms (one frame) is the target: it is reported, and a row over it is flagged. p99 > 50 ms fails the
// test. The p99 of 100 presses is their second largest (nearest rank), so one garbage collection on a shared CI machine
// could fail a row by itself; a row is therefore measured again (up to BUDGET_ATTEMPTS = 3 times, the heap collected first)
// and fails only when its p99 is over the limit in every attempt. A real regression repeats, a stall does not.
// BUDGET_ATTEMPTS=1 makes the gate strict.
//
// CONTROLS. A row marked "control" is a reference and never fails: a key nothing is bound to, the host's own scrolling by
// the arrow keys, and, for each plugin key whose cost is mostly the app's, the same work done by the page itself from
// F9 and F10 (which nothing is bound to): the page scrolls a line, jumps to the top, focuses a channel row, clicks the open
// settings section. What a control costs, the plugin key next to it cannot avoid.
//
// KNOWN EXCEEDANCES. A row whose control is over 50 ms too is the app's. budget.baseline.json lists such rows, each with its
// control row and the reason. A listed row that is over 50 ms in an attempt is measured against its control in that same
// attempt, the control pressed as often as the key (100 presses, so its p99 is not one stall): p99 <= max(50, control p99 + 30)
// and p50 <= control p50 + 25. The median is what a stall in the control cannot hide, and the rooms are added, not multiplied. On
// a machine where the control is under 20 ms the p99 limit stays 50, so the file does not let a fast machine hide a regression;
// on a slow machine it moves with the machine. No fixed limits. The table says "known". BUDGET_BASELINE=0 ignores the file (the
// strict gate). Every entry is checked against the rows of its surface before anything is measured. Fix a row, or a new app
// version, and delete its line.
//
// INVALID ROWS. A row whose presses did not move anything (under 90%), or did not have the focus on the row's surface (under 90%;
// rows that `cross` panes are only checked for moving), measures nothing: the test fails it, and the table says INVALID.
//
// THE DATA. One channel with 3,000 messages in the store (the fixture's Markdown corpus: code, lists, quotes, mentions), 130
// channels in the sidebar, a thread of 80 replies, a draft of 600 words and a draft with 30 mention chips (the host takes 32 at
// most). The harness serves only the newest page of a channel and holds the older ones until asked (olderPageDelayMs), so the
// list surface first loads them all ("Load older messages" until it is gone). The app keeps at most 2,400 of a channel's messages
// in its list: the newest, 600 to 2,999 here. The list is then 2,400 messages, some 630 screens high, and every row of it starts
// in the middle.
//
// THE SURFACES. The channel list, the channel's message list, a thread's list, the message box (text, and mentions),
// the Reminders, Agents and Workflows pages, and the Settings dialog. Keys: j k h l gg G Ctrl-e Ctrl-y w b 0 $ and counts
// (5j, 5k, 5w, 5b), where each does something: not every key of the plugin is pressed (README.md lists what is not). On the
// three pages j k 5j 5k G gg find nothing to move and are control rows; h and l are not pressed there, where `l` opens the
// focused channel (it leaves the page) and `h` opens the community switcher. A new key goes into the rows of each surface
// where it does something (CONTRIBUTING.md).
//
// Environment: BUDGET_REPS (100) and BUDGET_WARM (15) presses per row, BUDGET_ATTEMPTS (3), BUDGET_ONLY (a comma list of
// surface ids: sidebar, list, thread, box-text, box-mentions, reminders, agents, workflows, settings), BUDGET_OUT (the
// prefix of the .json and .md files, default /tmp/vim-budget), BUDGET_VSYNC (1 keeps the 60 Hz tick), BUDGET_BASELINE (0
// ignores the file of known exceedances), BUDGET_TRACE (full: the plugin's own trace, below).
import fs from "node:fs";
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";

const REPS = Number(process.env.BUDGET_REPS ?? 100);
const WARM = Number(process.env.BUDGET_WARM ?? 15);
const ATTEMPTS = Number(process.env.BUDGET_ATTEMPTS ?? 3);
const P95_TARGET = 16;
const P99_LIMIT = 50;
const VALID = 0.9; // a row is valid when at least this share of its presses moved something, and of those on its surface
const VSYNC = process.env.BUDGET_VSYNC === "1";
// BUDGET_TRACE=full turns the plugin's own trace on (a setting of the plugin, off by default): each row then also says how long
// each of the plugin's handlers ran per repetition. The trace wraps DOM methods, so the milliseconds of such a run are for finding
// where the plugin spends time, not for the budget.
const TRACE = process.env.BUDGET_TRACE ?? "";
const ONLY = (process.env.BUDGET_ONLY ?? "").split(",").filter(Boolean);
const OUT = process.env.BUDGET_OUT ?? "/tmp/vim-budget";
const BASELINE =
  process.env.BUDGET_BASELINE === "0" ? {} : JSON.parse(fs.readFileSync(new URL("./budget.baseline.json", import.meta.url), "utf8"));

test.use({
  pluginFixtures: true,
  exactMessages: true,
  markdownMessages: true,
  largeSidebar: true,
  historyCounts: { alpha: 3000, beta: 3 },
  olderPageDelayMs: 50, // older pages of the history are released after this long; without it "Load older messages" never completes
  launchOptions: VSYNC ? {} : { args: ["--disable-frame-rate-limit", "--disable-gpu-vsync"] },
});

// ---- Measuring ----------------------------------------------------------------------------------------------------
// Nearest rank: the smallest sample that at least p of them do not exceed (the p99 of 100 presses is the second largest).
const quantile = (sorted, p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { n: sorted.length, p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), p99: quantile(sorted, 0.99), max: sorted.at(-1) };
};
// One object per surface and key, in the order measured. They go to a file as they are measured: Playwright starts a new
// worker after a failed test, and the table at the end must still have every row.
const ROWS_FILE = `${OUT}.rows.jsonl`;
const results = {
  push: (entry) => fs.appendFileSync(ROWS_FILE, `${JSON.stringify(entry)}\n`),
  all: () => (fs.existsSync(ROWS_FILE) ? fs.readFileSync(ROWS_FILE, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []),
};

const probe = async (page) => {
  if (TRACE) await page.addInitScript((level) => localStorage.setItem("megatech.vim-mode.settings.v2", JSON.stringify({ perf: level })), TRACE);
  await page.addInitScript(() => {
    window.__kp = [];
    // What the keys can change on any surface, as one short string: the focused element, the cursors of the message panes, the
    // scroll position of the scrolling areas (the message lists, the settings, and the one a page marks with data-budget-scroller),
    // the caret, and the label. A press that leaves it as it was did nothing. It is read in the page, outside the measured time
    // (before t0, and after the frame's mark), and it builds little: garbage made between two presses is paid by the next one.
    const fingerprint = () => {
      const active = document.activeElement;
      const selection = getSelection();
      let text = `${active?.tagName}|${active?.getAttribute?.("data-channel-id") ?? active?.getAttribute?.("aria-label") ?? active?.id}|${active?.tagName === "BUTTON" ? active.textContent?.slice(0, 40) : ""}|${document.querySelector("nav[aria-label='Settings sections'] [aria-current]")?.textContent?.slice(0, 40)}|${selection?.anchorOffset}|${selection?.focusOffset}|${selection?.anchorNode?.nodeValue?.length}|${document.querySelector("[data-vim-status]")?.textContent}`;
      for (const el of document.querySelectorAll("[data-vim-cursor]")) text += `|${el.dataset.messageId}${el.getAttribute("data-vim-cursor")}`;
      for (const el of document.querySelectorAll("[data-message-scroller], #settings-content, nav[aria-label='Settings sections'], [data-budget-scroller]")) text += `|${Math.round(el.scrollTop)}`;
      return text;
    };
    addEventListener(
      "keydown",
      (event) => {
        // Only keys the test sends: the plugin sends keydowns of its own (u, the host's search chord, Tab) and each would be a
        // sample that belongs to no press.
        if (!event.isTrusted || ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
        const pre = fingerprint();
        const t0 = performance.now();
        // A message posted from a frame's rAF callback arrives once that frame is on screen. Two frames are followed: the plugin
        // puts the work it can defer (moving the cursor after a scroll has laid out) behind two rAFs, so it lands in the second.
        const afterPaint = (then) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = then;
          channel.port2.postMessage(0);
        };
        let first = 0;
        requestAnimationFrame(() => {
          afterPaint(() => (first = performance.now() - t0));
          requestAnimationFrame(() =>
            afterPaint(() => {
              const ms = performance.now() - t0;
              let on = true;
              try {
                on = window.__on ? window.__on() : true;
              } catch {}
              window.__kp.push({ key: event.key, ms, first, pre, post: fingerprint(), on });
            }),
          );
        });
      },
      true,
    );
    // F9 and F10 are bound to nothing. A control row sets what they do (see `controls`), so that the page does by itself the work a
    // key of the plugin does, and the row shows what that work costs in Buzz without the plugin.
    addEventListener("keydown", (event) => window.__controls?.[event.key]?.(), true);
  });
};
// One key press, and its sample: the milliseconds from its keydown to the second frame after it (ms), and to the first (first). The samples are counted here after the
// first, so every press made through this function costs one key event and one wait (keys pressed any other way, before the
// first measured press, are counted once by that first press).
const counted = new WeakMap();
const press = async (page, key) => {
  const before = counted.get(page) ?? (await page.evaluate(() => window.__kp.length));
  await page.keyboard.press(key);
  const sample = await page.waitForFunction((n) => window.__kp.length > n && window.__kp[n], before);
  counted.set(page, before + 1);
  return sample.jsonValue();
};
// A repetition is one key or a few (a count, then the key); its sample is the last press.
const repeat = async (page, seq) => {
  let sample;
  let pre;
  for (const key of seq) {
    sample = await press(page, key);
    pre ??= sample.pre;
  }
  return { ...sample, pre };
};

// A control row: F9 and F10 run the two bodies of code in the page (the work of a plugin key, done by the page itself).
const controls = (f9, f10) => (page) =>
  page.evaluate(
    ({ f9, f10 }) => {
      window.__controls = { F9: new Function(f9), F10: new Function(f10) };
    },
    { f9, f10 },
  );
const control = (up, down, f9, f10, reps) => ({
  pair: [
    { key: `control: ${up}`, seq: ["F9"], control: true },
    { key: `control: ${down}`, seq: ["F10"], control: true },
  ],
  reps,
  before: controls(f9, f10),
});
// A row: { key: "j" } (seq defaults to [key]), { key: "5j", seq: ["5", "j"] }, or a pair of keys pressed in turn so that
// the cursor comes back where it started: { pair: [{ key: "gg", seq: ["g", "g"] }, { key: "G", seq: ["Shift+g"] }] }.
// `reps` overrides the default for a list too short for that many steps.
// Where the main thread's time went, from the engine's own counters: seconds of script, of style recalculation and of layout.
const COUNTERS = ["ScriptDuration", "RecalcStyleDuration", "LayoutDuration"];
const counters = async (cdp) => {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return COUNTERS.map((name) => metrics.find((metric) => metric.name === name)?.value ?? 0);
};
// A page with no message list scrolls its own area: find the biggest one that scrolls and mark it for the fingerprint.
const markPageScroller = (page) =>
  page.evaluate(() => {
    let best;
    let area = 0;
    for (const el of document.body.querySelectorAll("*")) {
      if (el.scrollHeight <= el.clientHeight + 1 || !/auto|scroll/.test(getComputedStyle(el).overflowY) || el.closest("[data-sidebar-section], [role='dialog']")) continue;
      if (el.clientHeight * el.clientWidth > area) [best, area] = [el, el.clientHeight * el.clientWidth];
    }
    best?.setAttribute("data-budget-scroller", "");
    return !!best;
  });
// One attempt at a row: its parts pressed in turn, WARM + reps times, and the figures of each part.
const attemptRow = async (page, cdp, surface, id, row, checked) => {
  const parts = row.pair ?? [row];
  await cdp.send("HeapProfiler.collectGarbage"); // a collection in the middle of a row is noise, not the plugin
  const reps = Math.min(row.reps ?? REPS, REPS); // a row names the most its list has room for
  await row.position?.(page); // where the row starts, when its list is long enough to start in the middle
  // A key that walks one way (k, j, w, b ...) starts every attempt from the same end, so that none runs out of list.
  for (const key of row.prepare ?? []) await press(page, key);
  if (row.prepare) await page.waitForTimeout(400);
  const samples = parts.map(() => []);
  const firsts = parts.map(() => []);
  const moved = parts.map(() => 0);
  const onSurface = parts.map(() => 0);
  const spent = parts.map(() => [0, 0, 0]);
  for (let i = 0; i < WARM + reps; i++)
    for (const [index, part] of parts.entries()) {
      if (TRACE && i === WARM && index === 0) await page.evaluate(() => window.__vimPerf.reset());
      const before = i >= WARM ? await counters(cdp) : null;
      const sample = await repeat(page, part.seq ?? [part.key]);
      if (i >= WARM) {
        if (sample.pre !== sample.post) moved[index]++;
        if (sample.on) onSurface[index]++;
        samples[index].push(sample.ms);
        firsts[index].push(sample.first);
        (await counters(cdp)).forEach((value, c) => (spent[index][c] += value - before[c]));
      }
    }
  const trace = TRACE
    ? await page.evaluate(
        (n) => {
          const t = window.__vimPerf.summary();
          const per = (x) => Math.round((x / n) * 100) / 100;
          return {
            handlers: Object.fromEntries(Object.entries(t.handlers).slice(0, 8).map(([name, h]) => [name, { calls: per(h.n), ms: per(h.ms), api: Object.fromEntries(Object.entries(h.api).map(([k, v]) => [k, per(v)])) }])),
            host: Object.fromEntries(Object.entries(t.host).map(([k, v]) => [k, per(v)])),
          };
        },
        reps,
      )
    : undefined;
  return parts.map((part, index) => ({
    trace,
    surface,
    id,
    key: part.key,
    ...stats(samples[index]),
    first: stats(firsts[index]), // the same, to the first frame only
    moved: moved[index] / reps, // the share of the repetitions that changed anything on the page
    // the share of the repetitions after which the focus was on the surface the row belongs to (null: not checked, a control or a row that crosses surfaces)
    on: checked && !part.control && !row.crosses ? onSurface[index] / reps : null,
    // mean milliseconds of script, of style recalculation and layout, per measured repetition (a count and its key are one)
    script: (spent[index][0] * 1000) / reps,
    style: (spent[index][1] * 1000) / reps,
    layout: (spent[index][2] * 1000) / reps,
  }));
};
// A row of the baseline may go over 50 ms by what its control costs. The control is pressed in the same attempt, on the same
// machine, and as often as the key (a p99 of 100 presses is the second largest, not one stall that becomes room for the key):
//   p99 <= max(50, control p99 + P99_ROOM), and
//   p50 <= control p50 + P50_ROOM.
// The median is what a stall in the control cannot hide: a plugin regression moves every press, a stall moves one. The rooms are
// added, not multiplied: a stall of 60 ms in a control gives the key 30 ms, not 85.
const P99_ROOM = 30;
const P50_ROOM = 25;
// Every row of the baseline is checked before anything is measured: a wrong name would be noticed only when that row went over 50 ms.
const checkBaseline = (id, list) => {
  const parts = list.flatMap((row) => row.pair ?? [row]);
  for (const [name, entry] of Object.entries(BASELINE)) {
    if (!name.startsWith(`${id} `)) continue;
    if (!parts.some((part) => !part.control && `${id} ${part.key}` === name)) throw new Error(`budget.baseline.json: "${name}" is not a row of the "${id}" surface`);
    if (!parts.some((part) => part.control && part.key === entry.control)) throw new Error(`budget.baseline.json: "${name}" names the control "${entry.control}", which the "${id}" surface does not have`);
  }
};
const measureRow = async (page, cdp, surface, row, rowsOfSurface, id, defined, checked) => {
  await row.before?.(page);
  const parts = row.pair ?? [row];
  const known = (part) => (part.control ? undefined : BASELINE[`${id} ${part.key}`]);
  const attempts = [];
  const limits = [];
  const controls = [];
  const overs = [];
  let last;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    last = await attemptRow(page, cdp, surface, id, row, checked);
    attempts.push(last.map((entry) => entry.p99));
    const limit = [];
    const control = [];
    const over = [];
    for (const [index, part] of parts.entries()) {
      let max = part.control ? Infinity : P99_LIMIT;
      let reference = null;
      let past = !part.control && last[index].p99 > P99_LIMIT;
      if (known(part) && past) {
        const name = known(part).control;
        const def = defined.find((candidate) => (candidate.pair ?? [candidate]).some((one) => one.key === name));
        await def.before?.(page);
        const entries = await attemptRow(page, cdp, surface, id, { ...def, reps: row.reps }, false);
        const one = entries[(def.pair ?? [def]).findIndex((candidate) => candidate.key === name)];
        reference = { p50: one.p50, p99: one.p99 };
        max = Math.max(P99_LIMIT, reference.p99 + P99_ROOM);
        past = last[index].p99 > max || last[index].p50 > reference.p50 + P50_ROOM;
      }
      limit.push(max);
      control.push(reference);
      over.push(past);
    }
    limits.push(limit);
    controls.push(control);
    overs.push(over);
    if (!over.some(Boolean)) break;
  }
  for (const [index, entry] of last.entries()) {
    entry.control = !!parts[index].control;
    entry.known = !!known(parts[index]);
    entry.why = known(parts[index])?.why;
    entry.controlRow = known(parts[index])?.control;
    entry.attempts = attempts.map((p99s) => p99s[index]);
    entry.limits = limits.map((one) => (one[index] === Infinity ? null : one[index]));
    entry.controlP99 = controls.map((one) => one[index]?.p99 ?? null);
    entry.controlP50 = controls.map((one) => one[index]?.p50 ?? null);
    entry.limit = entry.limits.at(-1);
    entry.overTarget = entry.p95 > P95_TARGET;
    entry.over50 = entry.attempts.every((p99) => p99 > P99_LIMIT);
    entry.failed = entry.attempts.length === ATTEMPTS && overs.every((one) => one[index]);
    // A row that does not move anything, or whose keys are not on its surface, measures nothing: that is not a pass.
    entry.invalid = !entry.control && (entry.moved < VALID || (entry.on !== null && entry.on < VALID));
    results.push(entry);
    rowsOfSurface.push(entry);
  }
};

const SURFACE_IDS = ["sidebar", "list", "thread", "box-text", "box-mentions", "reminders", "agents", "workflows", "settings"];
for (const name of Object.keys(BASELINE))
  if (!SURFACE_IDS.some((id) => name.startsWith(`${id} `))) throw new Error(`budget.baseline.json: "${name}" does not start with the id of a surface (${SURFACE_IDS.join(", ")})`);
const wanted = (id) => ONLY.length === 0 || ONLY.includes(id);
// `on` is an expression of the focused element `a`: true where the focus belongs while the keys of this surface are pressed. A
// row whose keys leave it (h and l between panes) says `crosses`. Without `on` nothing is checked (the pages, whose keys are controls).
const surface = (id, title, body, on) =>
  test(`budget: ${title}`, async ({ page, app }) => {
    expect(SURFACE_IDS, "a surface id the baseline knows").toContain(id);
    test.skip(!wanted(id), "not in BUDGET_ONLY");
    test.setTimeout(30 * 60_000);
    await probe(page);
    await open(page, app);
    if (on)
      await page.evaluate((source) => {
        const check = new Function("a", `return !!(${source});`);
        window.__on = () => (document.activeElement ? check(document.activeElement) : false);
      }, on);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    await cdp.send("Performance.enable");
    const measured = [];
    const rows = async (list) => {
      checkBaseline(id, list);
      for (const row of list) await measureRow(page, cdp, title, row, measured, id, list, !!on);
    };
    await body({ page, app, rows });
    const pct = (x) => `${Math.round(x * 100)}%`;
    expect.soft(
      measured.filter((entry) => entry.invalid).map((entry) => `${entry.surface} ${entry.key}: ${pct(entry.moved)} of the presses moved anything${entry.on === null ? "" : `, ${pct(entry.on)} had the focus on the surface`}`),
      `rows that measure nothing (under ${pct(VALID)} of their presses moved something, or had the focus on the surface)`,
    ).toEqual([]);
    expect(
      measured.filter((entry) => entry.failed).map((entry) => `${entry.surface} ${entry.key}: p99 ${entry.attempts.map((p99) => p99.toFixed(1)).join(", ")} ms, over ${entry.limits.map((limit) => (limit ?? 0).toFixed(0)).join(", ")}`),
      `p99 over its limit in all ${ATTEMPTS} attempts`,
    ).toEqual([]);
  });

// ---- Surfaces -----------------------------------------------------------------------------------------------------
const bar = (page) => page.locator("[data-vim-status]");
const composer = (page) => page.getByRole("textbox", { name: "Message #Alpha", exact: true });
const goPage = async (page, letter, name) => {
  await page.keyboard.press("g");
  await page.keyboard.press(letter);
  await expect(page.getByRole("tab", { name, exact: true }).first()).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(500);
};
// The message lists and the channel rows, for the controls.
const MAIN_LIST = `document.querySelector('[data-main-workspace] [data-message-scroller], [data-solo-focus-pane] [data-message-scroller]')`;
const SIDE_LIST = `document.querySelector('[data-panel-workspace] [data-message-scroller]')`;
const CHANNEL_ROWS = `[...document.querySelectorAll('[data-sidebar-section] button[data-channel-id]')]`;
// `list` is the code that finds the message list the keys move in.
// `walk` is how many presses of k or j a list has room for (the list of a thread is short).
// `start` says where the rows that walk begin. The list of a thread is short: k begins at the bottom (G), j at the top (gg). The list of a
// channel is hundreds of screens high and the host mounts a couple of dozen rows of it: gg and a count of k only reach the ends of
// what is mounted, so every row begins in the middle of the list (`middle`), where k and j and the scrolling keys have room.
const moves = (reps, list, walk = reps, middle = false) => {
  const at = middle ? { position: toMiddle(list) } : {};
  return [
    { key: "k", reps: walk, ...(middle ? at : { prepare: ["Shift+g"] }) },
    { key: "j", reps: walk, ...(middle ? at : { prepare: ["g", "g"] }) },
    { pair: [{ key: "5k", seq: ["5", "k"] }, { key: "5j", seq: ["5", "j"] }], ...at },
    { pair: [{ key: "Ctrl-y", seq: ["Control+y"] }, { key: "Ctrl-e", seq: ["Control+e"] }], ...at },
    { ...control("scroll a line up (the page itself)", "scroll a line down (the page itself)", `${list}.scrollTop -= 24`, `${list}.scrollTop += 24`), ...at },
    { pair: [{ key: "gg", seq: ["g", "g"] }, { key: "G", seq: ["Shift+g"] }] },
    control("jump to the top (the page itself)", "jump to the bottom (the page itself)", `${list}.scrollTop = 0`, `${list}.scrollTop = ${list}.scrollHeight`),
  ];
};
const toMiddle = (list) => async (page) => {
  await page.evaluate(`(() => { const el = ${list}; el.scrollTop = el.scrollHeight / 2; })()`);
  await page.waitForTimeout(800);
};

// The channel list scrolls its own area: mark it for the fingerprint.
const markSidebarScroller = (page) =>
  page.evaluate(() => {
    for (let el = document.querySelector("[data-sidebar-section]"); el && el !== document.body; el = el.parentElement)
      if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
        el.setAttribute("data-budget-scroller", "");
        return true;
      }
    return false;
  });
surface("sidebar", "channel list (130 channels)", async ({ page, rows }) => {
  await markSidebarScroller(page);
  await page.keyboard.press("h"); // the channel list has the keys
  await expect(bar(page)).toContainText("sidebar");
  await page.keyboard.press("Shift+g"); // the last of the 130 rows: j and k then walk through all of them
  await rows([
    { key: "k", reps: 100, prepare: ["Shift+g"] },
    { key: "j", reps: 100, prepare: ["g", "g"] },
    { pair: [{ key: "5k", seq: ["5", "k"] }, { key: "5j", seq: ["5", "j"] }] },
    { pair: [{ key: "Ctrl-y", seq: ["Control+y"] }, { key: "Ctrl-e", seq: ["Control+e"] }] },
    { pair: [{ key: "gg", seq: ["g", "g"] }, { key: "G", seq: ["Shift+g"] }], reps: 50 },
    control(
      "focus the row above (the page itself)",
      "focus the row below (the page itself)",
      `const rows = ${CHANNEL_ROWS}; const row = rows[Math.max(0, rows.indexOf(document.activeElement) - 1)]; row.focus({ preventScroll: true }); row.scrollIntoView({ block: "nearest" });`,
      `const rows = ${CHANNEL_ROWS}; const row = rows[Math.min(rows.length - 1, rows.indexOf(document.activeElement) + 1)]; row.focus({ preventScroll: true }); row.scrollIntoView({ block: "nearest" });`,
    ),
  ]);
}, `a.closest("[data-sidebar-section]")`);

// The harness serves the newest page of a channel (a dozen messages) and holds the older ones until they are asked for. Load them
// all, as a reader who has scrolled back would have: the list is then as long as the channel (hundreds of screens), the browser
// mounts a couple of dozen rows of it, and j and k have rows to walk.
const loadHistory = async (page) => {
  const scroller = page.locator("[data-main-workspace] [data-message-scroller], [data-solo-focus-pane] [data-message-scroller]").first();
  const older = page.getByRole("button", { name: "Load older messages" });
  let height = 0;
  let still = 0;
  for (let i = 0; i < 400 && still < 8; i++) {
    if (await older.count()) await older.first().click().catch(() => {});
    else await scroller.evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(400);
    const now = await scroller.evaluate((el) => el.scrollHeight);
    still = now === height && !(await older.count()) ? still + 1 : 0;
    height = now;
  }
  const [scrollHeight, clientHeight] = await scroller.evaluate((el) => [el.scrollHeight, el.clientHeight]);
  expect(scrollHeight, "the history is loaded: the list is hundreds of screens high").toBeGreaterThan(100 * clientHeight);
  // Which messages are in the list: the numbers in the texts of the rows mounted at its two ends (the fixture numbers them from 0).
  const end = async (top) => {
    await scroller.evaluate((el, top) => (el.scrollTop = top ? 0 : el.scrollHeight), top);
    await page.waitForTimeout(1000);
    return scroller.evaluate((el) => [...el.querySelectorAll("[data-message-id]")].map((row) => Number(row.textContent.match(/primary alpha message (\d+)/)?.[1])).filter((n) => !Number.isNaN(n)));
  };
  const oldest = Math.min(...(await end(true)));
  const newest = Math.max(...(await end(false)));
  expect(newest - oldest + 1, "most of the channel's history is in the list").toBeGreaterThan(1000);
  console.log(`history loaded: messages ${oldest} to ${newest} (${newest - oldest + 1}) in a list ${scrollHeight} px high, ${Math.round(scrollHeight / clientHeight)} screens`);
};
const IN_MAIN_LIST = `a.id === "main-content" || a.closest("[data-main-workspace] [data-message-scroller], [data-solo-focus-pane] [data-message-scroller]")`;
surface("list", "message list (2,400 messages loaded)", async ({ page, rows }) => {
  await expect(bar(page)).toContainText("NORMAL");
  await loadHistory(page);
  await page.keyboard.press("Shift+g");
  await page.waitForTimeout(1000);
  await rows([
    ...moves(100, MAIN_LIST, 100, true),
    { pair: [{ key: "h" }, { key: "l" }], crosses: true }, // to the channel list and back
    control("focus a channel row (the page itself)", "focus the message list (the page itself)", `${CHANNEL_ROWS}[0].focus({ preventScroll: true })`, `${MAIN_LIST}.focus({ preventScroll: true })`),
    // Controls, not plugin keys: a key nothing is bound to (the cost of an event and a frame with no handler work to speak of),
    // and the host's own scrolling by the arrow keys. They are the floor the rows above are read against.
    { key: "x (unbound)", seq: ["x"], control: true },
    { pair: [{ key: "ArrowUp (the host scrolls)", seq: ["ArrowUp"], control: true }, { key: "ArrowDown (the host scrolls)", seq: ["ArrowDown"], control: true }] },
  ]);
}, IN_MAIN_LIST);

surface("thread", "thread pane (80 replies)", async ({ page, app, rows }) => {
  const opened = await page.evaluate(
    (target) => window.fixtureNavigation.open(target),
    { version: 1, kind: "conversation", channelId: "alpha", messageId: app.exact.root.id, threadRootId: app.exact.root.id, scope: { viewer: app.viewer, communityOrigin: "https://primary.example" } },
  );
  expect(opened).toEqual({ status: "opened" });
  await expect(bar(page)).toHaveText("-- NORMAL --  side");
  await page.waitForTimeout(1000);
  await rows([
    ...moves(100, SIDE_LIST, 40),
    { pair: [{ key: "h" }, { key: "l" }], crosses: true }, // to the channel's list and back
    control("focus the channel's list (the page itself)", "focus the thread's list (the page itself)", `${MAIN_LIST}.focus({ preventScroll: true })`, `${SIDE_LIST}.focus({ preventScroll: true })`),
  ]);
}, `a.closest("[data-panel-workspace] [data-message-scroller]")`); // the thread's message list, not its reply box

// A draft is typed into the box in one insertion (no key events), mentions are picked from the @ list.
const pickMention = async (page, count) => {
  await page.keyboard.type("@");
  const option = page.getByRole("option", { name: /Fixture Reader/ });
  await expect(option).toBeVisible();
  await page.keyboard.press("Enter"); // picks the person in the open list (nothing is sent)
  await expect(composer(page).locator('[contenteditable="false"]')).toHaveCount(count);
  await expect(option).toHaveCount(0);
};
const boxRows = (words) => [
  { key: "w", reps: words, prepare: ["0"] },
  { key: "b", reps: words, prepare: ["$"] },
  { pair: [{ key: "5w", seq: ["5", "w"] }, { key: "5b", seq: ["5", "b"] }] },
  { pair: [{ key: "0" }, { key: "$" }] },
  { key: "l", reps: 100, prepare: ["0"] },
  { key: "h", reps: 100, prepare: ["$"] },
];

surface("box-text", "message box, NORMAL motions (600 words)", async ({ page, rows }) => {
  await composer(page).click();
  const words = Array.from({ length: 600 }, (_, i) => ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"][i % 6] + (i % 11 === 0 ? "," : "")).join(" ");
  await page.keyboard.insertText(words);
  await page.keyboard.press("Escape");
  await expect(bar(page)).toContainText("NORMAL");
  await page.keyboard.press("0");
  await rows(boxRows(100));
}, "a.isContentEditable");

surface("box-mentions", "message box, NORMAL motions (30 mentions)", async ({ page, rows }) => {
  await composer(page).click();
  for (let i = 1; i <= 30; i++) {
    await page.keyboard.insertText("alpha beta ");
    await pickMention(page, i);
  }
  await page.keyboard.insertText("omega");
  await page.keyboard.press("Escape");
  await expect(bar(page)).toContainText("NORMAL");
  await page.keyboard.press("0");
  await rows(boxRows(60));
}, "a.isContentEditable");

for (const [id, letter, name] of [
  ["reminders", "r", "Reminders"],
  ["agents", "a", "Agents"],
  ["workflows", "w", "Workflows"],
])
  surface(id, `${name} page`, async ({ page, rows }) => {
    await goPage(page, letter, name);
    await markPageScroller(page);
    // A page has no message list: j k 5j 5k G gg find nothing to move. They are control rows, what an event, a frame and a handler
    // that finds nothing cost (the page scrolls, and Ctrl-e and Ctrl-y move it), and never fail.
    const idle = (key, seq) => ({ key: `${key} (nothing to move on this page)`, seq, control: true });
    await rows([
      { ...idle("j", ["j"]), reps: 50 },
      { ...idle("k", ["k"]), reps: 50 },
      { pair: [idle("5j", ["5", "j"]), idle("5k", ["5", "k"])] },
      { pair: [{ key: "Ctrl-e", seq: ["Control+e"] }, { key: "Ctrl-y", seq: ["Control+y"] }] },
      { pair: [idle("G", ["Shift+g"]), idle("gg", ["g", "g"])], reps: 25 },
    ]);
  });

surface("settings", "Settings dialog", async ({ page, rows }) => {
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("j"); // from the close button into the list of sections
  await rows([
    { pair: [{ key: "j" }, { key: "k" }] },
    { pair: [{ key: "5j", seq: ["5", "j"] }, { key: "5k", seq: ["5", "k"] }] },
    { pair: [{ key: "l" }, { key: "h" }] }, // go into the open section, and back to the list
    // Open another section: the host renders it anew (a section is a whole page of settings). The sample is the `l`.
    { pair: [{ key: "l: open the next section", seq: ["h", "j", "l"] }, { key: "l: open the section before", seq: ["h", "k", "l"] }] },
    // The page opening the next section and the one before itself: what the two rows above cost the app (a section is rendered anew).
    control(
      "open the next section (the page itself)",
      "open the section before (the page itself)",
      `const b = [...document.querySelectorAll('nav[aria-label="Settings sections"] button')]; b[Math.min(b.length - 1, b.findIndex((x) => x.hasAttribute("aria-current")) + 1)].click()`,
      `const b = [...document.querySelectorAll('nav[aria-label="Settings sections"] button')]; b[Math.max(0, b.findIndex((x) => x.hasAttribute("aria-current")) - 1)].click()`,
    ),
    control("click the open section (the page itself)", "focus the open section (the page itself)", `document.querySelector('nav[aria-label="Settings sections"] button[aria-current]').click()`, `document.querySelector('nav[aria-label="Settings sections"] button[aria-current]').focus()`, 30),
    { pair: [{ key: "Ctrl-e", seq: ["Control+e"] }, { key: "Ctrl-y", seq: ["Control+y"] }] },
  ]);
}, `a.closest('[role="dialog"]')`);

// ---- The table ----------------------------------------------------------------------------------------------------
test("budget: the table", async () => {
  const rows = results.all();
  test.skip(rows.length === 0, "nothing was measured");
  const f = (x) => x.toFixed(1);
  const lines = [
    `Key to next paint, ms (keydown on the window to the frame after it). Target p95 <= ${P95_TARGET}, gate p99 <= ${P99_LIMIT} (fails when over in all ${ATTEMPTS} attempts). ${REPS} presses a row after ${WARM} warm-up, ${VSYNC ? "60 Hz tick on" : "frame-rate limit off"}.`,
    "",
    "| Surface | Key | n | p50 | p95 | p99 | max | script | style | layout | moved | p95 target | p99 gate |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...rows.map((r) => {
      const pct = (x) => `${Math.round(x * 100)}%`;
      const control = r.controlP99?.filter((x) => x !== null).at(-1);
      const median = r.controlP50?.filter((x) => x !== null).at(-1);
      const why = r.known && control !== undefined ? ` (control \`${r.controlRow.replace(/^control: /, "")}\` p99 ${f(control)}, p50 ${f(median)}: limit p99 ${f(r.limit)}, p50 ${f(median + P50_ROOM)})` : "";
      const gate = r.control
        ? "control"
        : r.invalid
          ? `**INVALID** (${pct(r.moved)} moved${r.on === null ? "" : `, ${pct(r.on)} on the surface`})`
          : r.failed
            ? `**FAIL**${why}`
            : r.known && r.over50
              ? `known (over ${P99_LIMIT})${why}`
              : "ok";
      return `| ${r.surface} | \`${r.key}\` | ${r.n} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.p99)} | ${f(r.max)} | ${f(r.script)} | ${f(r.style)} | ${f(r.layout)} | ${pct(r.moved)} | ${r.overTarget ? "**over**" : "ok"} | ${gate}${r.attempts.length > 1 ? ` (p99 ${r.attempts.map(f).join(" -> ")})` : ""} |`;
    }),
    "",
    "script, style, layout: mean milliseconds of the page's main thread per repetition (a count and its key are one), from the engine's counters, in the last attempt. moved: the share of the repetitions after which anything on the page had changed (focus, cursor, scroll position, caret, label). A row is INVALID, and fails the test, when under 90% of its presses moved something or had the focus on its surface: it measures nothing. The control rows show what an event and a frame cost with no plugin work, or what the page costs when it does the plugin's work itself; a known row (budget.baseline.json) may go over 50 ms by what its control costs, the control pressed as often as the key in the same attempt: p99 <= max(50, control p99 + 30) and p50 <= control p50 + 25.",
    "",
    ...(rows.some((r) => r.control && / \(nothing to move on this page\)$/.test(r.key))
      ? ["On the Reminders, Agents and Workflows pages `j k 5j 5k G gg` find nothing to move (a page has no message list): they are control rows.", ""]
      : []),
    `${rows.filter((r) => !r.control && r.overTarget).length} of ${rows.filter((r) => !r.control).length} rows are over the p95 target; ${rows.filter((r) => r.known && r.over50).length} are over ${P99_LIMIT} ms at p99 and known; ${rows.filter((r) => r.failed).length} fail the gate; ${rows.filter((r) => r.invalid).length} are invalid.`,
  ];
  const table = lines.join("\n");
  console.log(`\n${table}\n`);
  fs.writeFileSync(`${OUT}.md`, `${table}\n`);
  fs.writeFileSync(`${OUT}.json`, JSON.stringify({ reps: REPS, warm: WARM, attempts: ATTEMPTS, vsync: VSYNC, p95Target: P95_TARGET, p99Limit: P99_LIMIT, rows }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Vim mode key latency\n\n${table}\n`);
});
