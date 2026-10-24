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
// KNOWN EXCEEDANCES. A row whose control is over 50 ms too is the app's. budget.baseline.json lists such rows with the p99
// each may reach and the reason: the gate then fails on a regression of those rows and on any other row over 50 ms, instead
// of failing every pull request until the app changes. The table says "known". BUDGET_BASELINE=0 ignores the file (the strict
// gate). Fix a row, or a new app version, and delete its line.
//
// THE DATA. One channel of 3,000 messages (the fixture's Markdown corpus: code, lists, quotes, mentions), 130 channels
// in the sidebar, a thread of 80 replies, a draft of 600 words and a draft with 30 mention chips (the host takes 32 at most).
//
// THE SURFACES. The channel list, the channel's message list, a thread's list, the message box (text, and mentions),
// the Reminders, Agents and Workflows pages, and the Settings dialog. Keys: j k h l gg G Ctrl-e Ctrl-y w b 0 $ and counts
// (5j, 5k, 5w, 5b). A key that does something only where it has a meaning is pressed there (w b 0 $ in the box); h and l
// are not pressed on the three pages, where `l` opens the focused channel (it leaves the page) and `h` opens the
// community switcher. A new key goes into the rows of each surface where it does something (CONTRIBUTING.md).
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
      let text = `${active?.tagName}|${active?.getAttribute?.("data-channel-id") ?? active?.getAttribute?.("aria-label") ?? active?.id}|${selection?.anchorOffset}|${selection?.focusOffset}|${selection?.anchorNode?.nodeValue?.length}|${document.querySelector("[data-vim-status]")?.textContent}`;
      for (const el of document.querySelectorAll("[data-vim-cursor]")) text += `|${el.dataset.messageId}${el.getAttribute("data-vim-cursor")}`;
      for (const el of document.querySelectorAll("[data-message-scroller], #settings-content, nav[aria-label='Settings sections'], [data-budget-scroller]")) text += `|${Math.round(el.scrollTop)}`;
      return text;
    };
    addEventListener(
      "keydown",
      (event) => {
        if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
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
              window.__kp.push({ key: event.key, ms, first, pre, post: fingerprint() });
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
const measureRow = async (page, cdp, surface, row, rowsOfSurface, id) => {
  await row.before?.(page);
  const parts = row.pair ?? [row];
  const limitOf = (part) => (part.control ? Infinity : (BASELINE[`${id} ${part.key}`]?.p99 ?? P99_LIMIT));
  const attempts = [];
  let last;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await cdp.send("HeapProfiler.collectGarbage"); // a collection in the middle of a row is noise, not the plugin
    const reps = Math.min(row.reps ?? REPS, REPS); // a row names the most its list has room for
    // A key that walks one way (k, j, w, b ...) starts every attempt from the same end, so that none runs out of list.
    for (const key of row.prepare ?? []) await press(page, key);
    if (row.prepare) await page.waitForTimeout(400);
    const samples = parts.map(() => []);
    const firsts = parts.map(() => []);
    const moved = parts.map(() => 0);
    const spent = parts.map(() => [0, 0, 0]);
    for (let i = 0; i < WARM + reps; i++)
      for (const [index, part] of parts.entries()) {
        if (TRACE && i === WARM && index === 0) await page.evaluate(() => window.__vimPerf.reset());
        const before = i >= WARM ? await counters(cdp) : null;
        const sample = await repeat(page, part.seq ?? [part.key]);
        if (i >= WARM) {
          if (sample.pre !== sample.post) moved[index]++;
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
    last = parts.map((part, index) => ({
      trace,
      surface,
      id,
      key: part.key,
      ...stats(samples[index]),
      first: stats(firsts[index]), // the same, to the first frame only
      moved: moved[index] / reps, // the share of the repetitions that changed anything on the page
      // mean milliseconds of script, of style recalculation and layout, per measured repetition (a count and its key are one)
      script: (spent[index][0] * 1000) / reps,
      style: (spent[index][1] * 1000) / reps,
      layout: (spent[index][2] * 1000) / reps,
    }));
    attempts.push(last.map((entry) => entry.p99));
    if (parts.every((part, index) => last[index].p99 <= limitOf(part))) break;
  }
  for (const [index, entry] of last.entries()) {
    const limit = limitOf(parts[index]);
    entry.control = !!parts[index].control;
    entry.known = !entry.control && limit !== P99_LIMIT;
    entry.limit = limit === Infinity ? null : limit;
    entry.why = BASELINE[`${id} ${parts[index].key}`]?.why;
    entry.attempts = attempts.map((p99s) => p99s[index]);
    entry.overTarget = entry.p95 > P95_TARGET;
    entry.over50 = entry.attempts.every((p99) => p99 > P99_LIMIT);
    entry.failed = entry.attempts.length === ATTEMPTS && entry.attempts.every((p99) => p99 > limit);
    results.push(entry);
    rowsOfSurface.push(entry);
  }
};

const wanted = (id) => ONLY.length === 0 || ONLY.includes(id);
const surface = (id, title, body) =>
  test(`budget: ${title}`, async ({ page, app }) => {
    test.skip(!wanted(id), "not in BUDGET_ONLY");
    test.setTimeout(20 * 60_000);
    await probe(page);
    await open(page, app);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    await cdp.send("Performance.enable");
    const measured = [];
    const rows = async (list) => {
      for (const row of list) await measureRow(page, cdp, title, row, measured, id);
    };
    await body({ page, app, rows });
    const failed = measured.filter((entry) => entry.failed);
    expect(
      failed.map((entry) => `${entry.surface} ${entry.key}: p99 ${entry.attempts.map((p99) => p99.toFixed(1)).join(", ")} ms, over ${P99_LIMIT}`),
      `p99 over ${P99_LIMIT} ms in all ${ATTEMPTS} attempts`,
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
const moves = (reps, list, walk = reps) => [
  { key: "k", reps: walk, prepare: ["Shift+g"] },
  { key: "j", reps: walk, prepare: ["g", "g"] },
  { pair: [{ key: "5k", seq: ["5", "k"] }, { key: "5j", seq: ["5", "j"] }] },
  { pair: [{ key: "Ctrl-y", seq: ["Control+y"] }, { key: "Ctrl-e", seq: ["Control+e"] }] },
  control("scroll a line up (the page itself)", "scroll a line down (the page itself)", `${list}.scrollTop -= 24`, `${list}.scrollTop += 24`),
  { pair: [{ key: "gg", seq: ["g", "g"] }, { key: "G", seq: ["Shift+g"] }], reps: Math.floor(reps / 2) },
  control("jump to the top (the page itself)", "jump to the bottom (the page itself)", `${list}.scrollTop = 0`, `${list}.scrollTop = ${list}.scrollHeight`, Math.floor(reps / 2)),
];

surface("sidebar", "channel list (130 channels)", async ({ page, rows }) => {
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
});

surface("list", "message list (3,000 messages)", async ({ page, rows }) => {
  await expect(bar(page)).toContainText("NORMAL");
  await rows([
    ...moves(100, MAIN_LIST),
    { pair: [{ key: "h" }, { key: "l" }] }, // to the channel list and back
    control("focus a channel row (the page itself)", "focus the message list (the page itself)", `${CHANNEL_ROWS}[0].focus({ preventScroll: true })`, `${MAIN_LIST}.focus({ preventScroll: true })`),
    // Controls, not plugin keys: a key nothing is bound to (the cost of an event and a frame with no handler work to speak of),
    // and the host's own scrolling by the arrow keys. They are the floor the rows above are read against.
    { key: "x (unbound)", seq: ["x"], control: true },
    { pair: [{ key: "ArrowUp (the host scrolls)", seq: ["ArrowUp"], control: true }, { key: "ArrowDown (the host scrolls)", seq: ["ArrowDown"], control: true }] },
  ]);
});

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
    { pair: [{ key: "h" }, { key: "l" }] }, // to the channel's list and back
    control("focus the channel's list (the page itself)", "focus the thread's list (the page itself)", `${MAIN_LIST}.focus({ preventScroll: true })`, `${SIDE_LIST}.focus({ preventScroll: true })`),
  ]);
});

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
});

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
});

for (const [id, letter, name] of [
  ["reminders", "r", "Reminders"],
  ["agents", "a", "Agents"],
  ["workflows", "w", "Workflows"],
])
  surface(id, `${name} page`, async ({ page, rows }) => {
    await goPage(page, letter, name);
    await markPageScroller(page);
    await rows([
      { key: "j", reps: 50 },
      { key: "k", reps: 50 },
      { pair: [{ key: "5j", seq: ["5", "j"] }, { key: "5k", seq: ["5", "k"] }] },
      { pair: [{ key: "Ctrl-e", seq: ["Control+e"] }, { key: "Ctrl-y", seq: ["Control+y"] }] },
      { pair: [{ key: "G", seq: ["Shift+g"] }, { key: "gg", seq: ["g", "g"] }], reps: 25 },
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
    { pair: [{ key: "l: open the next section", seq: ["h", "j", "l"] }, { key: "l: open the section before", seq: ["h", "k", "l"] }], reps: 30 },
    control("click the open section (the page itself)", "focus the open section (the page itself)", `document.querySelector('nav[aria-label="Settings sections"] button[aria-current]').click()`, `document.querySelector('nav[aria-label="Settings sections"] button[aria-current]').focus()`, 30),
    { pair: [{ key: "Ctrl-e", seq: ["Control+e"] }, { key: "Ctrl-y", seq: ["Control+y"] }] },
  ]);
});

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
      const gate = r.control ? "control" : r.failed ? `**FAIL**${r.known ? ` (known, limit ${r.limit})` : ""}` : r.known && r.over50 ? `known (over ${P99_LIMIT}, limit ${r.limit})` : "ok";
      return `| ${r.surface} | \`${r.key}\` | ${r.n} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.p99)} | ${f(r.max)} | ${f(r.script)} | ${f(r.style)} | ${f(r.layout)} | ${Math.round(r.moved * 100)}% | ${r.overTarget ? "**over**" : "ok"} | ${gate}${r.attempts.length > 1 ? ` (p99 ${r.attempts.map(f).join(" → ")})` : ""} |`;
    }),
    "",
    "script, style, layout: mean milliseconds of the page's main thread per repetition (a count and its key are one), from the engine's counters, in the last attempt. moved: the share of the repetitions after which anything on the page had changed (focus, cursor, scroll position, caret, label); a row at 0% measures a key that has nothing to do there. The control rows show what an event and a frame cost with no plugin work, or what the page costs when it does the plugin's work itself.",
    "",
    ...(rows.some((r) => !r.control && r.moved < 0.5)
      ? [`Keys that changed nothing in at least half of the presses (nothing to do on that surface): ${rows.filter((r) => !r.control && r.moved < 0.5).map((r) => `${r.surface} \`${r.key}\``).join(", ")}.`, ""]
      : []),
    `${rows.filter((r) => !r.control && r.overTarget).length} of ${rows.filter((r) => !r.control).length} rows are over the p95 target; ${rows.filter((r) => r.known && r.over50).length} are over ${P99_LIMIT} ms at p99 and known; ${rows.filter((r) => r.failed).length} fail the gate.`,
  ];
  const table = lines.join("\n");
  console.log(`\n${table}\n`);
  fs.writeFileSync(`${OUT}.md`, `${table}\n`);
  fs.writeFileSync(`${OUT}.json`, JSON.stringify({ reps: REPS, warm: WARM, attempts: ATTEMPTS, vsync: VSYNC, p95Target: P95_TARGET, p99Limit: P99_LIMIT, rows }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Vim mode key latency\n\n${table}\n`);
});
