// Drives the built Ghostty terminal plugin in the real Buzz web build (headless Chromium, the app's fixture relay), with the real PTY bridge
// behind a host simulator (test/host-sim.mjs), because the web build has no `ctx.host.spawn`. Run with plugins/ghostty-terminal/test/run.sh.
//
// This proves the plugin and the bridge work together inside Buzz's page: the launcher and the shortcut, the canvas showing the shell's
// output, the environment, resize, hide and reopen, restart, end, disabling the plugin, and what the terminal must never do. It does not
// prove the desktop app: the real Tauri channel and its speed, the install review, the content security policy, python3 on a Mac.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { pluginAction } from "./plugin-settings.mjs";
import { closeSettings, openPage } from "./navigation.mjs";
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";

const dir = process.env.GHOSTTY_PLUGIN_DIR;
const { createHost, randomSplit } = await import(pathToFileURL(join(dir, "test/host-sim.mjs")).href);
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));

test.use({ pluginFixtures: true, historyCounts: { alpha: 1, beta: 0 } });
// The first page of a run waits for the harness to warm its caches, and a shared runner is slow: give each test and each wait room.
test.describe.configure({ timeout: 120_000 });

const SECRET = "must-not-reach-the-shell";

/** Wires a page to a fresh host simulator and returns what the test needs to look at. */
async function arrange(page, { split } = {}) {
  const home = mkdtempSync(join(tmpdir(), "ghostty-web-"));
  const host = createHost(manifest, { env: { ...process.env, HOME: home, SENTINEL_SECRET: SECRET }, home, ...(split ? { split } : {}) });
  const procs = new Map();
  /** Everything the plugin sent to the bridge, in order. */
  const sent = [];
  let pushes = Promise.resolve();
  // A test aid in the plugin (src/term.ts) that is off unless this is set; and a window.open the page can only count.
  await page.addInitScript(() => {
    window.__ghosttyDebug = true;
    window.__opened = [];
    window.open = (...args) => {
      window.__opened.push(args.map(String));
      return null;
    };
  });
  await page.exposeFunction("__ghosttySpawn", async (handle, id, options) => {
    const emit = (kind, payload) => {
      pushes = pushes.then(() => page.evaluate(([h, k, p]) => window.__ghosttyEmit?.(h, k, p), [handle, kind, payload]).catch(() => {}));
    };
    const proc = await host.spawn(id, { ...options, onStdout: (text) => emit("stdout", text), onStderr: (text) => emit("stderr", text) });
    procs.set(handle, proc);
    void proc.exited.then((code) => emit("exit", code));
  });
  await page.exposeFunction("__ghosttyWrite", async (handle, data, close) => {
    sent.push(data);
    const proc = procs.get(handle);
    await (close ? proc.end(data) : proc.write(data));
  });
  await page.exposeFunction("__ghosttyKill", (handle) => procs.get(handle)?.kill());
  return {
    host,
    home,
    sent,
    /** Text the bridge was sent as keys, decoded from its frames. */
    keys: () =>
      sent
        .join("")
        .split("\n")
        .filter((line) => line.startsWith("d "))
        .map((line) => Buffer.from(line.slice(2), "base64").toString("latin1"))
        .join(""),
    async cleanup() {
      await host.stopAll();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

const launcher = (page) => page.getByRole("button", { name: "Toggle Ghostty terminal", exact: true });
const restart = (page) => page.getByRole("button", { name: "Restart", exact: true });
const canvas = (page) => page.locator("canvas").last();
const screenText = (page) => page.evaluate(() => window.__ghosttyScreens?.at(-1)?.text() ?? "");
const shows = (page, needle) => expect.poll(() => screenText(page), { timeout: 30_000, message: `the terminal shows ${needle}` }).toContain(needle);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const modifier = (page) => page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control"));

async function typeLine(page, line) {
  await page.keyboard.type(line);
  await page.keyboard.press("Enter");
}

/** Opens the drawer and waits until a shell answers. */
async function show(page) {
  await launcher(page).click();
  await expect(restart(page)).toBeVisible();
  await expect(canvas(page)).toBeVisible();
  await canvas(page).click();
  await typeLine(page, "echo ready-$((6*7))");
  await shows(page, "ready-42");
}

async function gone(pid, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 100))) if (!alive(pid)) return true;
  return !alive(pid);
}

test("adds a header button that opens a drawer with a shell on a terminal, and the canvas shows what the shell prints", async ({ page, app }) => {
  const world = await arrange(page);
  try {
    await open(page, app);
    await show(page);
    await typeLine(page, "[ -t 0 ] && [ -t 1 ] && echo tty-$((6*7)); echo $TERM-$COLORTERM-$TERM_PROGRAM");
    await shows(page, "tty-42");
    await shows(page, "xterm-256color-truecolor-Buzz");
    expect(world.host.calls).toHaveLength(1);
    expect(world.host.calls[0]).toMatchObject({ id: "pty", args: [], cwd: world.home });
  } finally {
    await world.cleanup();
  }
});

test("starts the shell with the channel's Buzz context, and with none of the app's other variables", async ({ page, app }) => {
  const world = await arrange(page);
  try {
    await open(page, app);
    await show(page);
    const added = world.host.calls[0].added;
    expect(added).toMatchObject({ TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Buzz", BUZZ_CHANNEL: "Alpha" });
    expect(added.BUZZ_NPUB).toMatch(/^npub1[02-9ac-hj-np-z]{58}$/);
    expect(added.BUZZ_RELAY_URL).toMatch(/^wss?:\/\/[\x21-\x7e]+$/);
    expect(added).not.toHaveProperty("BUZZ_THREAD_ID");
    for (const [name, value] of Object.entries(added)) expect(value, name).toMatch(/^[\x20-\x7e]*$/);

    // What the shell itself sees: the context is there, the app's secret is not.
    await typeLine(page, 'echo "[$BUZZ_CHANNEL][${BUZZ_NPUB:+npub-set}][${SENTINEL_SECRET-unset}][${SSH_AUTH_SOCK-unset}]"');
    await shows(page, "[Alpha][npub-set][unset][unset]");
    expect(await screenText(page)).not.toContain(SECRET);
  } finally {
    await world.cleanup();
  }
});

test("keeps the shell when the drawer is hidden, and shows the same terminal again", async ({ page, app }) => {
  const world = await arrange(page);
  try {
    await open(page, app);
    await show(page);
    await typeLine(page, "export KEPT=still-$((6*7)); echo set-it");
    await shows(page, "set-it");
    await launcher(page).click();
    await expect(restart(page)).toHaveCount(0);
    await launcher(page).click();
    await expect(restart(page)).toBeVisible();
    await expect(canvas(page)).toBeVisible();
    await canvas(page).click();
    await typeLine(page, "echo $KEPT");
    await shows(page, "still-42");
    expect(await screenText(page)).toContain("ready-42"); // the scrollback survived
    expect(world.host.calls).toHaveLength(1);
  } finally {
    await world.cleanup();
  }
});

test("opens and closes with Cmd or Ctrl+Shift+J", async ({ page, app }) => {
  const world = await arrange(page);
  try {
    await open(page, app);
    await launcher(page).waitFor();
    const key = `${await modifier(page)}+Shift+J`;
    await page.keyboard.press(key);
    await expect(restart(page)).toBeVisible();
    await page.keyboard.press(key);
    await expect(restart(page)).toHaveCount(0);
    await page.keyboard.press(key);
    await expect(restart(page)).toBeVisible();
    expect(world.host.calls).toHaveLength(1);
  } finally {
    await world.cleanup();
  }
});

test("gives the shell the size of the drawer, and tells it when the drawer changes", async ({ page, app }) => {
  const world = await arrange(page);
  const size = async () => {
    const before = (await screenText(page)).split("\n").filter((line) => /^\d+ \d+$/.test(line.trim())).length;
    await typeLine(page, "stty size");
    await expect.poll(async () => (await screenText(page)).split("\n").filter((line) => /^\d+ \d+$/.test(line.trim())).length, { timeout: 15_000 }).toBeGreaterThan(before);
    const lines = (await screenText(page)).split("\n").filter((line) => /^\d+ \d+$/.test(line.trim()));
    const [rows, cols] = lines.at(-1).trim().split(" ").map(Number);
    return { rows, cols };
  };
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await open(page, app);
    await show(page);
    const wide = await size();
    const shown = await page.evaluate(() => window.__ghosttyScreens.at(-1).size());
    expect(wide).toEqual({ rows: shown.rows, cols: shown.cols });
    await page.setViewportSize({ width: 900, height: 900 });
    await expect.poll(async () => (await page.evaluate(() => window.__ghosttyScreens.at(-1).size())).cols).toBeLessThan(shown.cols);
    await canvas(page).click();
    const narrow = await size();
    expect(narrow.cols).toBeLessThan(wide.cols);
    expect(narrow.cols).toBe((await page.evaluate(() => window.__ghosttyScreens.at(-1).size())).cols);
  } finally {
    await world.cleanup();
  }
});

test("restarts the shell, ends it, and starts a new one", async ({ page, app }) => {
  const world = await arrange(page);
  try {
    await open(page, app);
    await show(page);
    const first = world.host.calls.length;
    // The typed line is echoed before the shell runs it, so wait for a marker that only its output has (the sum, not the text of the sum).
    await typeLine(page, "echo old-$((6*7))-$$");
    await expect.poll(() => screenText(page), { timeout: 30_000 }).toMatch(/old-42-\d+/);
    const oldShell = Number(/old-42-(\d+)/.exec(await screenText(page))?.[1]);
    expect(alive(oldShell)).toBe(true);

    await restart(page).click();
    await expect.poll(() => world.host.calls.length).toBe(first + 1);
    expect(await gone(oldShell), "the old shell outlived Restart").toBe(true);
    await canvas(page).click();
    await typeLine(page, "echo fresh-$((6*7))");
    await shows(page, "fresh-42");
    expect(await screenText(page)).not.toContain("ready-42"); // a new terminal, not the old one

    await page.getByRole("button", { name: "End", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start a shell", exact: true })).toBeVisible();
    await expect.poll(() => world.host.live()).toBe(0);
    await page.getByRole("button", { name: "Start a shell", exact: true }).click();
    await expect.poll(() => world.host.calls.length).toBe(first + 2);
  } finally {
    await world.cleanup();
  }
});

test("shows a shell that has exited, with its status, and keeps its output", async ({ page, app }) => {
  const world = await arrange(page);
  try {
    await open(page, app);
    await show(page);
    await typeLine(page, "echo bye-$((6*7)); exit 3");
    await expect(page.getByText("The shell exited with status 3.", { exact: false }).first()).toBeVisible();
    await shows(page, "bye-42");
  } finally {
    await world.cleanup();
  }
});

test("hangs up the shell when the plugin is disabled", async ({ page, app }) => {
  const world = await arrange(page);
  try {
    await open(page, app);
    await show(page);
    await typeLine(page, "echo shell-$((6*7))-$$");
    await expect.poll(() => screenText(page), { timeout: 30_000 }).toMatch(/shell-42-\d+/);
    const shell = Number(/shell-42-(\d+)/.exec(await screenText(page))?.[1]);
    expect(alive(shell)).toBe(true);

    // A focused terminal keeps every key but its own toggle chord for the shell, so leave it before the app's Settings shortcut.
    await page.getByRole("textbox", { name: "Message #Alpha", exact: true }).click();
    await page.keyboard.press(`${await modifier(page)}+,`);
    await page.getByRole("button", { name: "Manage plugins" }).click();
    const toggle = pluginAction(page, "Ghostty terminal");
    await toggle.click();
    await expect(toggle).toHaveAccessibleName(/^Enable /);
    expect(await gone(shell), "the shell outlived the plugin").toBe(true);
    expect(world.host.live()).toBe(0);
    await closeSettings(page);
    await openPage(page, "Messages");
    await expect(launcher(page)).toHaveCount(0);
  } finally {
    await world.cleanup();
  }
});

test("a program's output cannot type into the shell: no title, setting or terminfo query is answered with its text", async ({ page, app }) => {
  const world = await arrange(page);
  try {
    await open(page, app);
    await show(page);
    // The word is cut apart in what is typed, and its hex is computed by the shell, so the typed line cannot be mistaken for an answer
    // that repeats it.
    const queries = String.raw`'\033]0;INJ'ECT-ME'\007\033[21t\033]1;INJ'ECT-ME'\007\033[20t\033P$qINJ'ECT-ME'\033\\\033]52;c;?\007\033[c\033[>q'`;
    await typeLine(page, String.raw`H=$(printf INJ'ECT' | od -An -tx1 | tr -d ' \n'); printf ${queries}; printf "\033P+q$H\033\\"; echo done-$((6*7))`);
    await shows(page, "done-42");
    // And a report that is asked for is answered, so this is not a terminal that answers nothing.
    await typeLine(page, String.raw`printf '\033[6n'; sleep 1; echo asked-$((6*7))`);
    await shows(page, "asked-42");
    const keys = world.keys();
    expect(keys).not.toContain("INJECT-ME");
    expect(keys).not.toContain("494e4a454354");
    expect(keys).toMatch(/\x1b\[\d+;\d+R/); // the cursor-position report went to the shell
    const replies = keys.match(/\x1b[\[P\]][^\n\r]*?(?=\x1b|$)/g) ?? [];
    for (const reply of replies) expect(reply).toMatch(/^\x1b\[(0n|\d+;\d+R)$/);
  } finally {
    await world.cleanup();
  }
});

test("never opens a link, however it is clicked", async ({ page, app }) => {
  const world = await arrange(page);
  try {
    await open(page, app);
    await show(page);
    await page.evaluate(() => (window.__opened.length = 0));
    // ghostty-web 0.4.0 finds a link only by the shape of a URL: it does not expose an OSC 8 hyperlink's target (getHyperlinkUri returns
    // null). Both kinds are printed, and the OSC 8 ones are clicked too, so a version that starts to support them is held to the same rule.
    await typeLine(
      page,
      String.raw`clear; printf '\033]8;;javascript:alert(1)\033\\JSLINK\033]8;;\033\\ \033]8;;https://example.com/\033\\OSCLINK\033]8;;\033\\ and https://example.org/plain and http://example.net/x\n'`,
    );
    await shows(page, "JSLINK OSCLINK and https://example.org/plain and http://example.net/x");
    const lines = (await screenText(page)).split("\n");
    const shown = await page.evaluate(() => window.__ghosttyScreens.at(-1).size());
    const box = await canvas(page).boundingBox();
    const row = lines.findLastIndex((line) => line.includes("JSLINK OSCLINK"));
    const viewportRow = row - (lines.length - shown.rows);
    const key = await modifier(page);
    const at = (word) => {
      const column = lines[row].indexOf(word) + 2;
      return [box.x + ((column + 0.5) * box.width) / shown.cols, box.y + ((viewportRow + 0.5) * box.height) / shown.rows];
    };
    const pointer = () => canvas(page).evaluate((element) => getComputedStyle(element.parentElement).cursor);
    for (const word of ["JSLINK", "OSCLINK", "https://example.org/plain", "http://example.net/x"]) {
      const [x, y] = at(word);
      await page.mouse.move(x, y);
      // The pointer cursor is the terminal saying "a link is here". The URLs must have it (so the clicks below are aimed at a link, not at
      // nothing); the OSC 8 words are not required to.
      if (word.includes("://")) await expect.poll(pointer, { message: word }).toBe("pointer");
      await page.keyboard.down(key);
      await page.mouse.click(x, y);
      await page.keyboard.up(key);
    }
    expect(await page.evaluate(() => window.__opened)).toEqual([]);
  } finally {
    await world.cleanup();
  }
});

test("takes a large paste to the shell whole (600 KB, in the browser's paste event)", async ({ page, app }) => {
  const world = await arrange(page, { split: randomSplit(3) });
  try {
    await open(page, app);
    await show(page);
    const pasted = Array.from({ length: 6000 }, (_, at) => `line ${at} ${"abcdefghij".repeat(9)}\n`).join("");
    expect(pasted.length).toBeGreaterThan(590_000);
    await typeLine(page, `stty raw -echo; head -c ${pasted.length} > pasted.txt; echo got-$((6*7))`);
    await page.waitForTimeout(500);
    await page.evaluate((text) => {
      const textarea = document.activeElement;
      const data = new DataTransfer();
      data.setData("text/plain", text);
      textarea.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, pasted);
    await shows(page, "got-42");
    const received = readFileSync(join(world.home, "pasted.txt"));
    expect(received.length).toBe(pasted.length);
    expect(createHash("sha256").update(received).digest("hex")).toBe(createHash("sha256").update(pasted).digest("hex"));
  } finally {
    await world.cleanup();
  }
});
