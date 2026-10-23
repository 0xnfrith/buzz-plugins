// Drives the Vim mode plugin in the real Buzz web build (headless Chromium, fixture relay).
// Run with plugins/vim/test/run.sh. The harness it relies on is block/buzz-app's tests/browser.
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";
import { hoverMessage } from "./message-actions.mjs";
import { pluginAction } from "./plugin-settings.mjs";
import { closeSettings, selectSettingsSection } from "./navigation.mjs";

test.use({ pluginFixtures: true, historyCounts: { alpha: 12, beta: 3 } });

const SETTINGS = "megatech.vim-mode.settings.v2";
const OLD_SETTINGS = "megatech.vim-mode.settings.v1";
const bar = (page) => page.locator("[data-vim-status]");
const composer = (page, name = "Alpha") =>
  page.getByRole("textbox", { name: `Message #${name}`, exact: true });
const rowIds = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-message-scroller] [data-message-id]")].map(
      (row) => row.dataset.messageId,
    ),
  );
const cursor = async (page) =>
  (await page.locator("style[data-vim-cursor-style]").getAttribute("data-message-id")) ||
  undefined;
const press = async (page, ...keys) => {
  for (const key of keys) await page.keyboard.press(key);
};
const draft = (page, name) => composer(page, name).evaluate((el) => el.textContent);

test("mode follows focus: Esc makes the message box normal, a second Esc stays, k leaves it, i comes back, plain keys type", async ({
  page,
  app,
}) => {
  await open(page, app);
  await expect(bar(page)).toContainText("NORMAL");
  await composer(page).click();
  await expect(bar(page)).toContainText("INSERT");
  // Plain letters bound in normal mode must still type in insert mode.
  await page.keyboard.type("hjkl gg 5");
  await expect.poll(() => draft(page)).toBe("hjkl gg 5");
  await press(page, "Escape");
  await expect(composer(page)).toBeFocused(); // composer editing is on by default: the first Esc stays
  await expect(bar(page)).toContainText("NORMAL");
  await press(page, "z", "q");
  await expect.poll(() => draft(page)).toBe("hjkl gg 5");
  await press(page, "Escape");
  await expect(composer(page)).toBeFocused(); // a second Esc stays in NORMAL, as in vim
  await expect(bar(page)).toHaveText("-- NORMAL --  main");
  await press(page, "k"); // the first row of the draft: up out of the box
  await expect(composer(page)).not.toBeFocused();
  await expect(bar(page)).toContainText("NORMAL");
  await expect.poll(() => draft(page)).toBe("hjkl gg 5"); // the draft survives
  // Esc left the caret on the last character. a resumes after it, i before it.
  await press(page, "a");
  await expect(composer(page)).toBeFocused();
  await expect(bar(page)).toContainText("INSERT");
  // Focused through the composer tool's documented focus() command, not by querying the DOM.
  await expect(bar(page)).toHaveAttribute("data-focus-via", "tool");
  await page.keyboard.type("!");
  await expect.poll(() => draft(page)).toBe("hjkl gg 5!");
  await press(page, "Escape", "Escape", "i");
  await expect(bar(page)).toContainText("INSERT");
  await page.keyboard.type("?");
  await expect.poll(() => draft(page)).toBe("hjkl gg 5?!");
});

test("j/k move a message cursor; counts, gg and G jump", async ({ page, app }) => {
  await open(page, app);
  const ids = await rowIds(page);
  expect(ids.length).toBeGreaterThan(6);
  await press(page, "k"); // first press places the cursor on the newest visible message
  await expect.poll(() => cursor(page)).toBe(ids.at(-1));
  await press(page, "k");
  await expect.poll(() => cursor(page)).toBe(ids.at(-2));
  await press(page, "j");
  await expect.poll(() => cursor(page)).toBe(ids.at(-1));
  await press(page, "3", "k");
  await expect.poll(() => cursor(page)).toBe(ids.at(-4));
  await press(page, "g");
  await expect(bar(page)).toContainText("g");
  await press(page, "g");
  await expect.poll(() => cursor(page)).toBe(ids[0]);
  await page.keyboard.down("Shift");
  await page.keyboard.press("G");
  await page.keyboard.up("Shift");
  await expect.poll(() => cursor(page)).toBe(ids.at(-1));
});

test("Ctrl-d and Ctrl-u scroll the message list", async ({ page, app }) => {
  await open(page, app);
  const scroller = page.getByRole("region", { name: "Channel message history" });
  const top = () => scroller.evaluate((el) => Math.round(el.scrollTop));
  await press(page, "g", "g");
  await expect.poll(top).toBe(0);
  // Control is the vim chord on every platform: the plugin binds it as `ctrl` on a Mac and as `mod` elsewhere.
  await press(page, "Control+d");
  await expect.poll(top).toBeGreaterThan(150);
  const down = await top();
  await press(page, "Control+u");
  await expect.poll(top).toBeLessThan(down - 100);
});

test("h/l/j/k move focus through the channel list; l opens, [ and ] switch", async ({
  page,
  app,
}) => {
  await open(page, app);
  const current = () =>
    page.locator('[aria-current="page"][data-channel-id]').textContent();
  expect(await current()).toContain("Alpha");
  await press(page, "h");
  await expect(bar(page)).toContainText("sidebar");
  await expect(page.locator("button[data-channel-id]:focus")).toContainText("Alpha");
  await press(page, "j");
  await expect(page.locator("button[data-channel-id]:focus")).not.toContainText("Alpha");
  const target = await page.locator("button[data-channel-id]:focus").textContent();
  await press(page, "l"); // opens the focused channel, then focus moves to its message list
  await expect.poll(current).toContain(target.trim().split(/\s/)[0]);
  await expect(bar(page)).toContainText("main");
  await press(page, "[");
  await expect.poll(current).toContain("Alpha");
  await press(page, "]");
  await expect.poll(current).not.toContain("Alpha");
  // navigation.open(..., { focus: "preserve" }) keeps the keyboard out of the message box.
  await expect(bar(page)).toContainText("NORMAL");
  await expect(page.getByRole("textbox", { name: /^Message #/ })).not.toBeFocused();
  // A pointer click on the same sidebar row does move focus into the message box.
  await page.locator('button[data-channel-id="alpha"]').click();
  await expect(composer(page)).toBeFocused();
  await expect(bar(page)).toContainText("INSERT");
});

test("no key acts on the page behind a dialog", async ({ page, app }) => {
  await open(page, app);
  await press(page, "Control+,");
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  await press(page, "k", "h", "j");
  expect(await cursor(page)).toBeUndefined();
  await expect(bar(page)).toContainText("main");
});

test("/ presses the host's own search chord; gv opens the plugin page", async ({ page, app }) => {
  await open(page, app);
  await press(page, "/");
  await expect(page.getByRole("dialog")).toBeVisible();
  await press(page, "Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await press(page, "g", "v");
  await expect(page.getByRole("heading", { name: "Vim mode", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "NORMAL, messages and panes", exact: true })).toBeVisible(); // the keys, grouped by mode
  await press(page, "v"); // a lone v does nothing
  await expect(page.getByRole("heading", { name: "Vim mode", exact: true })).toBeVisible();
});

test("Ctrl+Shift+E turns every key off and on", async ({ page, app }) => {
  await open(page, app);
  await press(page, "Control+Shift+e");
  await expect(bar(page)).toBeHidden();
  await press(page, "k");
  expect(await cursor(page)).toBeUndefined();
  await press(page, "Control+Shift+e");
  await expect(bar(page)).toBeVisible();
  await press(page, "k");
  await expect.poll(() => cursor(page)).toBeDefined();
});

test("l and h move between the message list and a thread pane; i writes the reply", async ({
  page,
  app,
}) => {
  await open(page, app);
  const row = page.locator("[data-message-scroller] [data-message-id]").last();
  await hoverMessage(row);
  await row.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = page.getByRole("textbox", { name: "Reply to thread", exact: true });
  await expect(reply).toBeFocused(); // the host focuses the reply box: insert mode
  await expect(bar(page)).toContainText("INSERT");
  await expect(bar(page)).toContainText("side");
  // The host would close the thread on Esc; the plugin pre-empts it, and Esc only makes the box
  // normal. A second Esc stays there; k on the draft's first row goes up out of the box.
  await press(page, "Escape");
  await expect(reply).toBeFocused();
  await expect(bar(page)).toContainText("NORMAL");
  await press(page, "Escape");
  await expect(reply).toBeVisible();
  await expect(reply).toBeFocused();
  await press(page, "k");
  await expect(reply).not.toBeFocused();
  await expect(bar(page)).toContainText("NORMAL");
  await expect(bar(page)).toContainText("side");
  await press(page, "h");
  await expect(bar(page)).toContainText("main");
  await press(page, "l");
  await expect(bar(page)).toContainText("side");
  await press(page, "i");
  await expect(reply).toBeFocused();
  await expect(bar(page)).toHaveAttribute("data-focus-via", "tool");
  await page.keyboard.type("from vim");
  await expect.poll(() => reply.evaluate((el) => el.textContent)).toBe("from vim");
  // Esc, then k leaves the box. In the pane's message list Esc does nothing (the host would close the
  // thread); q closes it.
  await press(page, "Escape", "k");
  await expect(reply).toBeVisible();
  await expect(reply).not.toBeFocused();
  await press(page, "Escape");
  await expect(reply).toBeVisible();
  await expect(sideScroller(page)).toBeFocused();
  await press(page, "q");
  await expect(reply).toHaveCount(0);
});

const shifted = async (page, key) => {
  await page.keyboard.down("Shift");
  await page.keyboard.press(key);
  await page.keyboard.up("Shift");
};
const switcher = (page) => page.getByRole("button", { name: /^Community switcher:/ });
const picker = (page) => page.getByRole("dialog", { name: "Switch community", exact: true });

test("} and { move through the communities and land in the channel list", async ({ page, app }) => {
  await open(page, app);
  await expect(switcher(page)).toHaveAttribute("aria-label", "Community switcher: Primary");
  await shifted(page, "}");
  await expect(switcher(page)).toHaveAttribute("aria-label", "Community switcher: Secondary");
  await expect(picker(page)).toHaveCount(0);
  await expect(bar(page)).toContainText("sidebar");
  await expect(page.locator("button[data-channel-id]:focus")).toHaveCount(1);
  await shifted(page, "}"); // at the end: stays, and the popover goes away again
  await expect(switcher(page)).toHaveAttribute("aria-label", "Community switcher: Secondary");
  await expect(picker(page)).toHaveCount(0);
  await press(page, "2");
  await shifted(page, "{"); // a count of 2 reaches Personal space from Secondary
  await expect(switcher(page)).toHaveAttribute("aria-label", "Community switcher: Personal space");
  await shifted(page, "}");
  await expect(switcher(page)).toHaveAttribute("aria-label", "Community switcher: Primary");
  await expect(page.locator("html")).not.toHaveAttribute("data-vim-driving", "");
  await expect(bar(page)).toContainText("NORMAL");
});

test("C and h open the community switcher; j, k and Enter choose in it", async ({ page, app }) => {
  await open(page, app);
  await shifted(page, "C");
  await expect(picker(page)).toBeVisible();
  // Focus starts on the current community.
  await expect(picker(page).getByRole("button", { name: "Switch to Primary", exact: true })).toBeFocused();
  await press(page, "j");
  await expect(picker(page).getByRole("button", { name: "Switch to Secondary", exact: true })).toBeFocused();
  await press(page, "k", "k");
  await expect(picker(page).getByRole("button", { name: "Personal space", exact: true })).toBeFocused();
  await press(page, "Escape");
  await expect(picker(page)).toHaveCount(0);
  await expect(switcher(page)).toHaveAttribute("aria-label", "Community switcher: Primary");
  // h moves left through the regions and past the channel list into the switcher.
  await press(page, "h");
  await expect(bar(page)).toContainText("sidebar");
  await press(page, "h");
  await expect(picker(page)).toBeVisible();
  await press(page, "j", "Enter");
  await expect(switcher(page)).toHaveAttribute("aria-label", "Community switcher: Secondary");
  await expect(picker(page)).toHaveCount(0);
});

test("r replies to the message under the cursor; m opens its menu; j and k choose", async ({ page, app }) => {
  await open(page, app);
  await press(page, "r"); // no cursor yet: nothing happens
  await expect(page.getByRole("textbox", { name: "Reply to thread", exact: true })).toHaveCount(0);
  await press(page, "k", "k");
  const ids = await rowIds(page);
  expect(await cursor(page)).toBe(ids.at(-2));
  await press(page, "m");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const items = menu.getByRole("menuitem");
  expect(await items.count()).toBeGreaterThan(1);
  await expect(items.first()).toBeFocused(); // the host opens the menu on its first item
  await press(page, "j");
  await expect(items.nth(1)).toBeFocused();
  await press(page, "j", "j"); // wraps, like the host's arrow keys
  await expect(items.first()).toBeFocused();
  await press(page, "k");
  await expect(items.last()).toBeFocused();
  await press(page, "j");
  await expect(items.first()).toBeFocused();
  await press(page, "Escape");
  await expect(menu).toHaveCount(0);
  await press(page, "r");
  const reply = page.getByRole("textbox", { name: "Reply to thread", exact: true });
  await expect(reply).toBeFocused();
  await expect(bar(page)).toContainText("INSERT");
  await expect(bar(page)).toContainText("side");
  // The reply is to the message under the cursor.
  await expect(page.getByRole("region", { name: /thread/i }).locator(`[data-message-id="${ids.at(-2)}"]`).first()).toBeVisible();
});

test("gt and gT cycle the pages in the order the app shows them; gi and gm jump by name", async ({ page, app }) => {
  await open(page, app);
  const where = () =>
    page.evaluate(() => {
      const target = JSON.parse(decodeURIComponent(location.hash.slice("#buzz=".length)));
      return target.kind === "page" ? `${target.pluginId}/${target.pageId}` : target.kind;
    });
  expect(await where()).toBe("conversation");
  await press(page, "g", "t"); // Messages, then Reminders, Agents, Workflows, Inbox
  await expect.poll(where).toBe("buzz.reminders/reminders");
  await press(page, "g", "t");
  await expect.poll(where).toBe("buzz.agents/agents");
  await press(page, "g");
  await shifted(page, "T");
  await expect.poll(where).toBe("buzz.reminders/reminders");
  await press(page, "g", "i");
  await expect.poll(where).toBe("buzz.inbox/inbox");
  await press(page, "g", "m"); // opening Messages reopens the last conversation
  await expect.poll(where).toBe("conversation");
  // The documented focus: "preserve" keeps the keyboard out of the message box.
  await expect(composer(page)).not.toBeFocused();
  await expect(bar(page)).toContainText("NORMAL");
  await press(page, "g", "w");
  await expect.poll(where).toBe("buzz.workflows/workflows");
  // A lone t does nothing, and a g that nothing follows expires.
  await press(page, "t");
  expect(await where()).toBe("buzz.workflows/workflows");
});

test("the cursor mark is on its message again after the Messages page is left and entered", async ({ page, app }) => {
  await open(page, app);
  await press(page, "k", "k");
  const id = await cursor(page);
  expect(id).toBeDefined();
  // The mark is an attribute on the row element. Leaving the page throws the whole list away and entering builds a new one.
  const marked = () =>
    page.evaluate(
      (id) => document.querySelector(`[data-message-scroller] [data-message-id="${id}"]`)?.getAttribute("data-vim-cursor") ?? null,
      id,
    );
  expect(await marked()).toBe("main");
  await press(page, "g", "i");
  await expect.poll(marked).toBeNull();
  await press(page, "g", "m");
  await expect.poll(marked).toBe("main");
  expect(await cursor(page)).toBe(id);
  await expect(page.locator("[data-vim-cursor]")).toHaveCount(1);
});

test("the cursor mark follows its message id when a row element is given another id", async ({ page, app }) => {
  await open(page, app);
  await press(page, "k", "k");
  const id = await cursor(page);
  // A virtual list may reuse a row element for another message. Swap the ids of the marked row and the one above it.
  const other = await page.evaluate((id) => {
    const rows = [...document.querySelectorAll("[data-message-scroller] [data-message-id]")];
    const a = rows.find((row) => row.dataset.messageId === id);
    const b = rows.find((row) => row !== a && !row.hasAttribute("data-membership-row"));
    const bId = b.dataset.messageId;
    a.dataset.messageId = bId;
    b.dataset.messageId = id;
    return bId;
  }, id);
  const has = (id) =>
    page.evaluate(
      (id) => [...document.querySelectorAll("[data-message-scroller] [data-message-id]")].filter((row) => row.dataset.messageId === id).map((row) => row.getAttribute("data-vim-cursor")),
      id,
    );
  await expect.poll(() => has(id)).toEqual(["main"]); // the element that carries the id now is marked
  expect(await has(other)).toEqual([null]);
  expect(await cursor(page)).toBe(id);
});

test("gs opens Settings, for the community on screen; a lone s does nothing", async ({ page, app }) => {
  await open(page, app);
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await press(page, "s");
  await expect(settings).toHaveCount(0);
  await press(page, "g", "s");
  await expect(settings).toBeVisible();
  await expect(bar(page)).toContainText("NORMAL");
  await closeSettings(page);
  await expect(settings).toHaveCount(0);
  await press(page, "g", "x"); // a letter that names no page opens nothing
  await expect(settings).toHaveCount(0);
});

const threadPane = (page) => page.getByRole("region", { name: /thread/i });
const handle = (page) => page.getByRole("separator", { name: "Resize main and secondary panels", exact: true });
const paneWidth = async (page) => Number(await handle(page).getAttribute("aria-valuenow"));
const paneBox = async (page) => (await page.locator("[data-panel-workspace]").first().boundingBox()).width;
const sideScroller = (page) => page.locator("[data-panel-workspace] [data-message-scroller]");
const mainScroller = (page) => page.locator("[data-main-workspace] [data-message-scroller]");

test("o and Enter open the thread of the message under the cursor and land in it; q closes it", async ({
  page,
  app,
}) => {
  await open(page, app);
  await press(page, "o"); // no cursor yet: nothing happens
  await expect(threadPane(page)).toHaveCount(0);
  await press(page, "k", "k");
  const target = (await rowIds(page)).at(-2);
  expect(await cursor(page)).toBe(target);
  await press(page, "g", "o"); // after g a letter picks a page: no page starts with o, and no thread opens
  await expect(threadPane(page)).toHaveCount(0);
  await press(page, "o");
  await expect(threadPane(page).locator(`[data-message-id="${target}"]`).first()).toBeVisible();
  // Focus is in the thread's message list in normal mode, not in its reply box.
  await expect(sideScroller(page)).toBeFocused();
  await expect(bar(page)).toContainText("NORMAL");
  await expect(bar(page)).toContainText("side");
  await expect(page.getByRole("textbox", { name: "Reply to thread", exact: true })).not.toBeFocused();
  await page.waitForTimeout(300); // nothing in the host takes focus back later
  await expect(sideScroller(page)).toBeFocused();
  // q closes the thread and focus returns to the message list.
  await press(page, "q");
  await expect(threadPane(page)).toHaveCount(0);
  await expect(mainScroller(page)).toBeFocused();
  await expect(bar(page)).toContainText("main");
  // Enter opens it again while the message list has focus; the cursor stayed on the message.
  expect(await cursor(page)).toBe(target);
  await press(page, "Enter");
  await expect(threadPane(page).locator(`[data-message-id="${target}"]`).first()).toBeVisible();
  await expect(sideScroller(page)).toBeFocused();
  // From the message list, q closes the thread pane's tab.
  await press(page, "h");
  await expect(bar(page)).toContainText("main");
  await press(page, "q");
  await expect(threadPane(page)).toHaveCount(0);
  await expect(mainScroller(page)).toBeFocused();
  // q with nothing to close does nothing.
  await press(page, "q");
  await expect(mainScroller(page)).toBeFocused();
  // After g, q is a page letter, not a close.
  await press(page, "Enter");
  await expect(threadPane(page)).toBeVisible();
  await press(page, "g", "q");
  await expect(threadPane(page)).toBeVisible();
  await press(page, "q");
  await expect(threadPane(page)).toHaveCount(0);
});

const html = (page) => page.locator("html");
const mainPane = (page) => page.locator("[data-main-workspace]").first();
const sidePane = (page) => page.locator("[data-panel-workspace]").first();
// The cursor row's paint, in the pane it is shown in.
const rowIn = (pane, id) => pane.locator(`[data-message-id="${id}"]`).first();
// What a CSS colour expression comes to right now, in the form the browser reports it. The plugin's
// colours are the host's theme tokens, so the tests ask the page what a token means instead of
// hard-coding a colour (a different accent or mode gives a different answer).
const colour = (page, css) =>
  page.evaluate((value) => {
    const probe = document.createElement("i");
    probe.style.color = value;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, css);
const ACCENT = "var(--accent-9)";
const tint = (percent) => `color-mix(in srgb, ${ACCENT} ${percent}%, transparent)`;
const LIFT = "var(--affordance-backdrop-pressed)"; // the host's own hover brightening
// The cursor row's mark sits on its message bubble: a step up in brightness and a thin accent outline.
// The row itself has no tint and no bar.
const bubbleIn = (pane, id) => pane.locator(`[data-message-id="${id}"] [data-bubble] [data-message-action-anchor]`).first();
const markOf = (pane, id) =>
  bubbleIn(pane, id).evaluate((el) => {
    const style = getComputedStyle(el);
    return { image: style.backgroundImage, outline: style.outlineColor, width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
const rowPaint = (pane, id) =>
  rowIn(pane, id).evaluate((row) => {
    const style = getComputedStyle(row);
    return { background: style.backgroundColor, shadow: style.boxShadow };
  });
// The line under a pane's header: the header's own ::after, which the host draws as a 1px separator.
const headerLine = (pane) =>
  pane.locator(":scope > header").evaluate((header) => {
    const line = getComputedStyle(header, "::after");
    return {
      height: line.height,
      colour: line.backgroundColor,
      width: Math.round(parseFloat(line.width)),
      header: Math.round(header.getBoundingClientRect().width),
      pane: Math.round(header.parentElement.getBoundingClientRect().width),
    };
  });

test("with a thread beside the channel, the pane that has the keys has an accent line under its header and shows its cursor row strongly", async ({
  page,
  app,
}) => {
  await open(page, app);
  await expect(html(page)).toHaveAttribute("data-vim-on", "");
  // One pane: nothing to tell apart, so no line (the host's own 1px separator stays).
  await expect(html(page)).not.toHaveAttribute("data-vim-panes", "");
  expect((await headerLine(mainPane(page))).height).toBe("1px");
  await press(page, "k", "k");
  const target = await cursor(page);
  await press(page, "o");
  await expect(sideScroller(page)).toBeFocused();
  await expect(html(page)).toHaveAttribute("data-vim-panes", "");
  await expect(html(page)).toHaveAttribute("data-vim-region", "side");
  // The thread has the keys: its header has the 2px line, across the whole pane, and its first
  // message is marked. The channel keeps its own cursor row, drawn faintly, and no line.
  const side = await headerLine(sidePane(page));
  expect(side.height).toBe("2px");
  expect(side.colour).toBe(await colour(page, ACCENT));
  expect(side.width).toBe(side.pane); // the whole pane, not just the tab strip
  expect(side.header).toBe(side.pane);
  expect((await headerLine(mainPane(page))).height).toBe("1px");
  const marks = page.locator("style[data-vim-cursor-style]");
  await expect(marks).toHaveAttribute("data-side-message-id", target);
  await expect(marks).toHaveAttribute("data-main-message-id", target);
  // The side pane has the keys: its cursor bubble is lifted and outlined in the accent, and the row has no
  // tint and no bar. The channel's cursor row is where it was left: outline only, fainter, no lift.
  const lift = await colour(page, LIFT);
  const strong = await markOf(sidePane(page), target);
  expect(strong.image).toContain(lift);
  expect(strong.outline).toBe(await colour(page, ACCENT));
  expect(strong.style).toBe("solid");
  expect(strong.width).toBe(2); // thin, and thicker than the other pane's 1px
  const rest = await markOf(mainPane(page), target);
  expect(rest.image).toBe("none");
  expect(rest.outline).toBe(await colour(page, tint(45)));
  expect(rest.style).toBe("solid");
  for (const pane of [sidePane(page), mainPane(page)])
    expect(await rowPaint(pane, target)).toEqual({ background: "rgba(0, 0, 0, 0)", shadow: "none" });
  // Back to the channel: the line and the strong row move with the keys.
  await press(page, "h");
  await expect(html(page)).toHaveAttribute("data-vim-region", "main");
  expect((await headerLine(mainPane(page))).height).toBe("2px");
  expect((await headerLine(mainPane(page))).colour).toBe(await colour(page, ACCENT));
  expect((await headerLine(sidePane(page))).height).toBe("1px");
  expect((await markOf(mainPane(page), target)).image).toContain(lift);
  expect((await markOf(sidePane(page), target)).image).toBe("none");
  // The channel list has the keys: neither message pane has a line, and the list's own ring shows.
  await press(page, "h");
  await expect(html(page)).toHaveAttribute("data-vim-region", "sidebar");
  expect((await headerLine(mainPane(page))).height).toBe("1px");
  expect((await headerLine(sidePane(page))).height).toBe("1px");
  await expect(page.locator("button[data-channel-id]:focus")).toHaveCSS("outline-color", await colour(page, "var(--border-focus)"));
  // Closing the thread leaves one pane again.
  await press(page, "l", "q");
  await expect(threadPane(page)).toHaveCount(0);
  await expect(html(page)).not.toHaveAttribute("data-vim-panes", "");
  expect((await headerLine(mainPane(page))).height).toBe("1px");
});

test("the line, the cursor row and the label follow the user's accent colour and light or dark mode, live", async ({
  page,
  app,
}) => {
  await open(page, app);
  await press(page, "k", "k");
  const target = await cursor(page);
  await press(page, "o");
  await expect(sideScroller(page)).toBeFocused();
  const look = async () => ({
    accent: await colour(page, ACCENT),
    line: (await headerLine(sidePane(page))).colour,
    mark: await markOf(sidePane(page), target),
    lift: await colour(page, LIFT),
    label: await bar(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, text: style.color, border: style.borderTopColor };
    }),
    popover: await colour(page, "var(--surface-popover)"),
    text: await colour(page, "var(--text-standard)"),
  });
  const before = await look();
  // The host's Appearance settings set these two attributes on <html> and every theme token follows.
  const theme = (accent, mode) =>
    page.evaluate(([a, m]) => {
      document.documentElement.dataset.accent = a;
      document.documentElement.dataset.colorMode = m;
    }, [accent, mode]);
  for (const [accent, mode] of [["magenta", "light"], ["cobalt", "dark"], ["magenta", "dark"]]) {
    await theme(accent, mode);
    const now = await look();
    expect(now.line).toBe(now.accent); // the line is the accent
    expect(now.label.border).toBe(now.accent);
    expect(now.label.background).toBe(now.popover); // the label's ground and ink are the mode's
    expect(now.label.text).toBe(now.text);
    expect(now.mark.image).toContain(now.lift); // the lift is the host's token, so it follows the mode
    expect(now.mark.outline).toBe(now.accent);
    expect(now.accent).not.toBe(before.accent);
  }
  // Both modes were visited: the label's colours differ between light and dark.
  await theme("cobalt", "light");
  const light = await look();
  await theme("cobalt", "dark");
  const dark = await look();
  expect(light.lift).not.toBe(dark.lift); // a darker step on light, a brighter one on dark: both read
  expect(light.label.background).not.toBe(dark.label.background);
  expect(light.label.text).not.toBe(dark.label.text);
});

// The message box's own paint while it has focus: the host's composer is the <form> around the textbox, and the plugin
// lays a much fainter copy of the bubble lift over its fill.
const boxPaint = (box) => box.evaluate((el) => getComputedStyle(el.closest("form")).backgroundImage);
const BOX_LIFT = `color-mix(in srgb, ${LIFT} 40%, transparent)`;
// The opacity in a resolved colour: rgba(r, g, b, a), color(srgb r g b / a), or no alpha at all (opaque).
const alphaOf = (resolved) => {
  const match = /(?:,\s*|\/\s*)([\d.]+)\)$/.exec(resolved);
  return match ? Number(match[1]) : 1;
};

test.describe("a message box that has the keys takes the lift from the message above", () => {
  test("INSERT and NORMAL in the channel's box: the message above keeps its place with no lift, the box has a much fainter one; the list gets it back", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await press(page, "k");
    const id = await cursor(page);
    const lift = await colour(page, LIFT);
    const faint = await colour(page, BOX_LIFT);
    expect(alphaOf(faint)).toBeLessThan(alphaOf(lift) / 2); // much fainter, from the same token
    // In the list the bubble is lifted and outlined strongly, and the box has nothing.
    const strong = await markOf(mainPane(page), id);
    expect(strong.image).toContain(lift);
    expect(strong.width).toBe(2);
    expect(await boxPaint(composer(page))).toBe("none");
    // INSERT: the box has the keys. The cursor's place is kept, drawn like the other pane's (outline only).
    await press(page, "i");
    await expect(composer(page)).toBeFocused();
    await expect(bar(page)).toContainText("INSERT");
    expect(await cursor(page)).toBe(id);
    const rest = await markOf(mainPane(page), id);
    expect(rest.image).toBe("none");
    expect(rest.outline).toBe(await colour(page, tint(45)));
    expect(rest.width).toBe(1);
    expect(await rowPaint(mainPane(page), id)).toEqual({ background: "rgba(0, 0, 0, 0)", shadow: "none" });
    expect(await boxPaint(composer(page))).toContain(faint);
    // NORMAL in the box is the same: the keys are still in the box.
    await page.keyboard.type("hello");
    await press(page, "Escape");
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await expect(composer(page)).toBeFocused();
    expect((await markOf(mainPane(page), id)).image).toBe("none");
    expect(await boxPaint(composer(page))).toContain(faint);
    expect(await cursor(page)).toBe(id);
    // Back up into the list: the lift returns to the bubble and leaves the box.
    await press(page, "k");
    await expect(composer(page)).not.toBeFocused();
    expect((await markOf(mainPane(page), await cursor(page))).image).toContain(lift);
    expect(await boxPaint(composer(page))).toBe("none");
    // Down into the box in NORMAL (j past the newest message) and out by a click elsewhere: same hand-over.
    await press(page, "j");
    await expect(composer(page)).toBeFocused();
    expect(await boxPaint(composer(page))).toContain(faint);
    expect((await markOf(mainPane(page), id)).image).toBe("none");
  });

  test("the reply box in a thread: neither message list is lifted, the reply box is, the channel's box is not", async ({ page, app }) => {
    await open(page, app);
    await press(page, "k", "k");
    const target = await cursor(page);
    await press(page, "o");
    await expect(sideScroller(page)).toBeFocused();
    const lift = await colour(page, LIFT);
    const faint = await colour(page, BOX_LIFT);
    // The thread's list has the keys: its bubble is lifted, no box is.
    expect((await markOf(sidePane(page), target)).image).toContain(lift);
    expect(await boxPaint(replyBox(page))).toBe("none");
    await press(page, "i");
    await expect(replyBox(page)).toBeFocused();
    expect((await markOf(sidePane(page), target)).image).toBe("none");
    expect((await markOf(mainPane(page), target)).image).toBe("none");
    expect(await boxPaint(replyBox(page))).toContain(faint);
    expect(await boxPaint(composer(page))).toBe("none");
    // Out of the reply box and over to the channel: the lift is in its list again, and the reply box's is gone.
    await press(page, "Escape", "Escape", "k", "h");
    await expect(html(page)).toHaveAttribute("data-vim-region", "main");
    expect((await markOf(mainPane(page), target)).image).toContain(lift);
    expect(await boxPaint(replyBox(page))).toBe("none");
  });

  test("the box's lift follows light and dark mode, and is off with the master switch", async ({ page, app }) => {
    await open(page, app);
    await press(page, "k", "i");
    await expect(composer(page)).toBeFocused();
    const theme = (mode) => page.evaluate((m) => (document.documentElement.dataset.colorMode = m), mode);
    const looks = {};
    for (const mode of ["light", "dark"]) {
      await theme(mode);
      looks[mode] = { expected: await colour(page, BOX_LIFT), image: await boxPaint(composer(page)) };
      expect(looks[mode].image).toContain(looks[mode].expected);
    }
    expect(looks.light.expected).not.toBe(looks.dark.expected); // a darker step on light, a brighter one on dark
    // The master switch (a chord, so it works in the box) takes the plugin's paint off the page.
    await press(page, "Control+Shift+E");
    await expect(html(page)).not.toHaveAttribute("data-vim-on", "");
    expect(await boxPaint(composer(page))).toBe("none");
    await press(page, "Control+Shift+E");
    await expect(html(page)).toHaveAttribute("data-vim-on", "");
    expect(await boxPaint(composer(page))).toContain(looks.dark.expected);
  });
});

test("the cursor mark works on an own bubble too, and a row with no bubble is outlined whole", async ({ page, app }) => {
  await open(page, app);
  const own = await page.evaluate(
    () => [...document.querySelectorAll("[data-message-scroller] [data-message-id]")].find((row) => row.querySelector("[data-own]"))?.dataset.messageId,
  );
  const other = await page.evaluate(
    () => [...document.querySelectorAll("[data-message-scroller] [data-message-id]")].find((row) => row.querySelector("[data-bubble]") && !row.querySelector("[data-own]"))?.dataset.messageId,
  );
  expect(own, "the fixture has an own message on screen").toBeTruthy();
  const lift = await colour(page, LIFT);
  const accent = await colour(page, ACCENT);
  const walkTo = async (id) => {
    await press(page, "g", "g");
    // gg puts the cursor on the oldest message two frames later; a j pressed before that would move on from a cursor
    // that is placed a moment after it (the test was a coin toss for want of this).
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
    for (let step = 0; step < 30 && (await cursor(page)) !== id; step++) await press(page, "j");
    expect(await cursor(page)).toBe(id);
  };
  await walkTo(own);
  const mine = await markOf(mainPane(page), own);
  expect(mine.image).toContain(lift);
  expect(mine.outline).toBe(accent);
  // The bubble next to it, not marked, is as the host made it.
  if (other) {
    const quiet = await markOf(mainPane(page), other);
    expect(quiet.image).toBe("none");
    expect(quiet.style).toBe("none");
  }
  // No bubble (a picture, a card, a huddle): the host marks that with no [data-bubble]. Take it away from
  // the marked row here and the whole message is outlined instead.
  await page.evaluate((id) => {
    document.querySelector(`[data-message-scroller] [data-message-id="${id}"] [data-bubble]`)?.removeAttribute("data-bubble");
  }, own);
  const bare = await mainPane(page).locator(`[data-message-id="${own}"] > [data-layout]`).evaluate((el) => {
    const style = getComputedStyle(el);
    return { outline: style.outlineColor, style: style.outlineStyle };
  });
  expect(bare).toEqual({ outline: accent, style: "solid" });
});

test("moving into a message list marks a row in it before any j or k", async ({ page, app }) => {
  await open(page, app);
  const ids = await rowIds(page);
  expect(await cursor(page)).toBeUndefined();
  await press(page, "h"); // the channel list
  await press(page, "l"); // out again: the open channel's message list
  await expect(html(page)).toHaveAttribute("data-vim-region", "main");
  await expect.poll(() => cursor(page)).toBe(ids.at(-1)); // the newest message
  await press(page, "k");
  await expect.poll(() => cursor(page)).toBe(ids.at(-2));
});

test.describe("a message that has replies", () => {
  test.use({ productionBroker: true, readState: true, threadUnread: true, historyCounts: { alpha: 20 } });

  test("o opens its thread with the replies in it", async ({ page, app }) => {
    await open(page, app);
    const root = app.histories.get("primary/alpha").find((row) => row.content === "Thread root 1");
    const ids = await rowIds(page);
    const up = ids.length - 1 - ids.indexOf(root.id);
    expect(up).toBeGreaterThanOrEqual(0);
    await press(page, "k"); // places the cursor on the newest message
    for (let i = 0; i < up; i++) await press(page, "k");
    expect(await cursor(page)).toBe(root.id);
    await press(page, "o");
    await expect(threadPane(page).getByText("Unread reply 1", { exact: true })).toBeVisible();
    await expect(threadPane(page).locator(`[data-message-id="${root.id}"]`).first()).toBeVisible();
    await expect(sideScroller(page)).toBeFocused();
    await press(page, "j"); // the cursor moves through the replies
    await expect.poll(() => cursor(page)).not.toBe(root.id);
  });
});

test.describe("membership rows", () => {
  test.use({ membershipActivity: true });

  test("the cursor skips 'was added' rows, so G, k and o only ever meet real messages", async ({ page, app }) => {
    await open(page, app);
    const membership = page.locator("[data-message-scroller] [data-membership-row]");
    await expect(membership.first()).toBeVisible();
    // The host gives these rows a message id although they are not messages.
    const skipped = await membership.evaluateAll((rows) => rows.map((row) => row.dataset.messageId));
    expect(skipped.length).toBeGreaterThan(0);
    await shifted(page, "G");
    await expect.poll(() => cursor(page)).toBeDefined();
    expect(skipped).not.toContain(await cursor(page));
    for (let i = 0; i < 4; i++) {
      await press(page, "k");
      expect(skipped).not.toContain(await cursor(page));
    }
    const target = await cursor(page); // read before o: afterwards the cursor that counts is the thread pane's
    await press(page, "o");
    await expect(threadPane(page).locator(`[data-message-id="${target}"]`).first()).toBeVisible();
    await expect(page.getByText("This destination couldn't open")).toHaveCount(0);
  });
});

test("Enter keeps its native meaning on a button; o does nothing in the channel list", async ({ page, app }) => {
  await open(page, app);
  await press(page, "k");
  await press(page, "h");
  await expect(bar(page)).toContainText("sidebar");
  await press(page, "o"); // the channel list has no cursor to open
  await expect(threadPane(page)).toHaveCount(0);
  await press(page, "j", "Enter"); // the host's own Enter on the focused channel button
  await expect(composer(page, "Beta")).toBeVisible();
  await expect(threadPane(page)).toHaveCount(0);
});

test("> and < widen and narrow the thread pane; | and = go to the widest and the default", async ({ page, app }) => {
  await open(page, app);
  await press(page, "k");
  await press(page, "o");
  await expect(threadPane(page)).toBeVisible();
  const start = await paneWidth(page);
  const min = Number(await handle(page).getAttribute("aria-valuemin"));
  const max = Number(await handle(page).getAttribute("aria-valuemax"));
  expect(max - start).toBeGreaterThan(48 + 144); // room for the steps below
  await shifted(page, ">");
  await expect.poll(() => paneWidth(page)).toBe(start + 48);
  expect(Math.abs((await paneBox(page)) - (start + 48))).toBeLessThan(1.5); // the pane really is wider
  await press(page, "3");
  await shifted(page, ">"); // a count multiplies
  await expect.poll(() => paneWidth(page)).toBe(start + 48 + 144);
  await shifted(page, "<");
  await expect.poll(() => paneWidth(page)).toBe(start + 144);
  await shifted(page, "|");
  await expect.poll(() => paneWidth(page)).toBe(max);
  await shifted(page, ">"); // already as wide as it goes
  await expect.poll(() => paneWidth(page)).toBe(max);
  await press(page, "=");
  await expect.poll(() => paneWidth(page)).toBe(start);
  await press(page, "9");
  await shifted(page, "<"); // clamps at the narrowest
  await expect.poll(() => paneWidth(page)).toBe(min);
  // The keys resize without moving focus.
  await expect(sideScroller(page)).toBeFocused();
  await expect(bar(page)).toContainText("NORMAL");
  // With the thread closed there is no split and the keys do nothing.
  await press(page, "q");
  await expect(handle(page)).toHaveCount(0);
  await shifted(page, ">");
  await shifted(page, "|");
  await press(page, "=");
  await expect(bar(page)).toContainText("NORMAL");
});

test("zc hides the thread pane and keeps the thread; zo shows it again", async ({ page, app }) => {
  await open(page, app);
  await press(page, "k");
  const target = await cursor(page); // read before o: afterwards the cursor that counts is the thread pane's
  await press(page, "o");
  await expect(threadPane(page).locator(`[data-message-id="${target}"]`).first()).toBeVisible();
  await press(page, "z", "c");
  await expect(threadPane(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Toggle tab pane", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(mainScroller(page)).toBeFocused();
  await expect(bar(page)).toContainText("main");
  await press(page, "c"); // a bare c does nothing
  await expect(threadPane(page)).toBeHidden();
  await press(page, "z", "o");
  await expect(threadPane(page).locator(`[data-message-id="${target}"]`).first()).toBeVisible();
  // z followed by anything else forgets the z.
  await press(page, "z", "k", "c"); // (k, not j: j on the newest message now goes down into the message box)
  await expect(threadPane(page)).toBeVisible();
  // o on another message opens a second thread tab and zc still hides the whole pane.
  await press(page, "q");
  await expect(threadPane(page)).toHaveCount(0);
  await press(page, "z", "c"); // no pane to hide: nothing happens
  await expect(bar(page)).toContainText("main");
});

test("with threads placed in the main pane, o opens a tab over the channel and q closes it", async ({ page, app }) => {
  await page.addInitScript(() => localStorage.setItem("buzz-thread-placement.v1", "main"));
  await open(page, app);
  await press(page, "k", "k");
  const target = await cursor(page);
  const tab = page.locator('[data-main-workspace] [role="tab"][data-tab-value^="thread:"]');
  await press(page, "o");
  await expect(tab).toHaveCount(1);
  await expect(tab).toHaveAttribute("aria-selected", "true");
  // The channel's own list stays mounted underneath; the thread's copy of the message is the visible one.
  await expect(page.locator(`[data-main-workspace] [data-message-scroller] [data-message-id="${target}"] >> visible=true`)).toHaveCount(1);
  await expect(page.locator("[data-main-workspace] [data-message-scroller] >> visible=true")).toBeFocused();
  await expect(bar(page)).toContainText("main");
  await expect(bar(page)).toContainText("NORMAL");
  await expect(handle(page)).toHaveCount(0); // no split to resize
  await shifted(page, ">");
  await press(page, "j"); // the cursor works in the thread tab: j past its newest message drops into its box
  await expect(replyBox(page)).toBeFocused();
  await expect(bar(page)).toHaveText("-- NORMAL -- main");
  await press(page, "k"); // and k comes back up into the thread's messages
  await expect(page.locator("[data-main-workspace] [data-message-scroller] >> visible=true")).toBeFocused();
  await press(page, "q");
  await expect(tab).toHaveCount(0);
  await expect(bar(page)).toContainText("NORMAL");
  await expect(mainScroller(page)).toBeFocused();
  await expect(mainScroller(page)).toHaveAttribute("data-channel-timeline", "alpha");
});

const replyBox = (page) => page.getByRole("textbox", { name: "Reply to thread", exact: true });
const openThreadBeside = async (page) => {
  await press(page, "k");
  await press(page, "o");
  await expect(threadPane(page)).toBeVisible();
  await expect(sideScroller(page)).toBeFocused();
};

test.describe("one NORMAL mode: a pane is its messages and, at the bottom, its message box", () => {
  test("j past the newest message drops into the box in NORMAL; k on its first row goes up to the newest message", async ({
    page,
    app,
  }) => {
    await open(page, app);
    const ids = await rowIds(page);
    await press(page, "k");
    expect(await cursor(page)).toBe(ids.at(-1));
    await press(page, "j");
    await expect(composer(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await press(page, "z", "y"); // NORMAL: plain keys never type
    await expect.poll(() => draft(page)).toBe("");
    await press(page, "k");
    await expect(composer(page)).not.toBeFocused();
    await expect(mainScroller(page)).toBeFocused();
    await expect.poll(() => cursor(page)).toBe(ids.at(-1));
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    // Nothing selected in the box, so a key the plugin does not bind cannot type into it.
    await press(page, "z", "y");
    await expect.poll(() => draft(page)).toBe("");
  });

  test("k only leaves the box from its first row: a second line, or a wrapped row, takes k up one row first", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await composer(page).click();
    await typeLines(page, "one", "two");
    await press(page, "Escape");
    await press(page, "k");
    await expect(composer(page)).toBeFocused(); // line 2 to line 1
    await press(page, "k");
    await expect(mainScroller(page)).toBeFocused(); // the first row goes up into the messages
    await expect.poll(() => lines(page)).toBe("one\ntwo");
    // One long line that wraps: k climbs its rows, and only the first row leaves.
    await press(page, "i");
    await press(page, "Control+a");
    await page.keyboard.type("word ".repeat(120));
    await press(page, "Escape");
    await press(page, "k");
    await expect(composer(page)).toBeFocused();
    for (let i = 0; i < 30 && (await composer(page).evaluate((el) => document.activeElement === el)); i++) await press(page, "k");
    await expect(mainScroller(page)).toBeFocused();
  });

  test("h at the very start and l at the very end of a draft go on into the other pane's box, both ways", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await openThreadBeside(page);
    await press(page, "i");
    await page.keyboard.type("reply text");
    await press(page, "Escape");
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
    await press(page, "0", "h"); // the very start of the thread's draft: the channel's box
    await expect(composer(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await page.keyboard.type("x"); // NORMAL: no typing
    await press(page, "i");
    await page.keyboard.type("hello");
    await press(page, "Escape"); // the host's pane handler used to swallow this Esc while a thread was open
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await press(page, "l"); // on the last character: the end of the draft
    await expect(replyBox(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
    await expect.poll(() => draft(page, "Alpha")).toBe("hello");
    await press(page, "$", "l"); // the end of the thread's draft: back to the channel's box, at its start
    await expect(composer(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    // The editor puts its own saved caret back on focus; the plugin places its caret again a moment later.
    await expect.poll(() => offset(page)).toBe(0);
    await press(page, "h"); // the very start of the channel's draft: the thread's box, at its end
    await expect(replyBox(page)).toBeFocused();
    await expect.poll(() => replyBox(page).evaluate((el) => el.textContent)).toBe("reply text");
    await press(page, "x"); // the caret really is on the last character
    await expect.poll(() => replyBox(page).evaluate((el) => el.textContent)).toBe("reply tex");
  });

  test("j past the last reply drops into the reply box, and k goes back up", async ({ page, app }) => {
    await open(page, app);
    await openThreadBeside(page);
    await press(page, "G");
    const last = await page.evaluate(() => [...document.querySelectorAll("[data-panel-workspace] [data-message-id]")].at(-1).dataset.messageId);
    await expect.poll(() => cursor(page)).toBe(last);
    await press(page, "j");
    await expect(replyBox(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
    await press(page, "k");
    await expect(sideScroller(page)).toBeFocused();
  });

  test("with composer editing off the box has no NORMAL mode, so j does not drop into it", async ({ page, app }) => {
    await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ composerNormal: false })), SETTINGS);
    await open(page, app);
    await press(page, "G", "j", "j");
    await expect(composer(page)).not.toBeFocused();
  });
});

test.describe("Esc, and ? in a NORMAL box", () => {
  test("Esc in a NORMAL box stays in NORMAL and keeps the draft; with a thread open too", async ({ page, app }) => {
    await open(page, app);
    await openThreadBeside(page);
    await composer(page).click();
    await page.keyboard.type("keep me");
    await press(page, "Escape", "Escape", "Escape");
    await expect(composer(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await expect.poll(() => draft(page)).toBe("keep me");
    await expect(threadPane(page)).toBeVisible();
    await press(page, "i");
    await expect(bar(page)).toHaveText("-- INSERT --  main");
  });

  test("Esc in a message list does nothing: it no longer closes a thread, q does", async ({ page, app }) => {
    await open(page, app);
    await openThreadBeside(page);
    await press(page, "Escape", "Escape");
    await expect(threadPane(page)).toBeVisible();
    await expect(sideScroller(page)).toBeFocused();
    await press(page, "h", "Escape");
    await expect(mainScroller(page)).toBeFocused();
    await expect(threadPane(page)).toBeVisible();
    await press(page, "l", "q");
    await expect(threadPane(page)).toHaveCount(0);
  });

  test("? in a NORMAL box opens the help over the page, and closing it returns to the box", async ({ page, app }) => {
    await open(page, app);
    await normal(page, "draft");
    await page.keyboard.down("Shift");
    await page.keyboard.press("?");
    await page.keyboard.up("Shift");
    const help = page.getByRole("dialog", { name: "Vim keys", exact: true });
    await expect(help).toBeVisible();
    await press(page, "q");
    await expect(help).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await expect.poll(() => draft(page)).toBe("draft");
    // The caret is where Esc left it, on the last character, and the keys are still commands.
    await press(page, "x");
    await expect.poll(() => draft(page)).toBe("draf");
  });
});

test.describe("the leader key", () => {
  const leader = async (page, ...then) => {
    await press(page, "Space");
    await expect(bar(page)).toContainText("leader");
    await press(page, ...then);
  };
  const shiftedKeys = async (page, ...then) => {
    await press(page, "Space");
    await shifted(page, then[0]);
  };

  test("Space then h and l move between panes, q closes the thread, < > | = resize it, from the message lists", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await openThreadBeside(page);
    await leader(page, "h");
    await expect(mainScroller(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await leader(page, "l");
    await expect(sideScroller(page)).toBeFocused();
    const start = await paneWidth(page);
    await shiftedKeys(page, ">");
    await expect.poll(() => paneWidth(page)).toBe(start + 48);
    await shiftedKeys(page, "<");
    await expect.poll(() => paneWidth(page)).toBe(start);
    await leader(page, "q");
    await expect(threadPane(page)).toHaveCount(0);
    await expect(mainScroller(page)).toBeFocused();
    // Anything else after the leader only cancels it.
    await leader(page, "x");
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await press(page, "j");
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
  });

  test("in a NORMAL message box it works too: h and l go to the next pane's box, q closes the thread", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await openThreadBeside(page);
    await press(page, "i");
    await page.keyboard.type("in the thread");
    await press(page, "Escape");
    await leader(page, "h"); // from the thread's box to the channel's box
    await expect(composer(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await leader(page, "l");
    await expect(replyBox(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
    const start = await paneWidth(page);
    await shiftedKeys(page, ">");
    await expect.poll(() => paneWidth(page)).toBe(start + 48);
    await expect(replyBox(page)).toBeFocused();
    await expect.poll(() => replyBox(page).evaluate((el) => el.textContent)).toBe("in the thread");
    await leader(page, "q");
    await expect(threadPane(page)).toHaveCount(0);
  });

  test("a plain leader never fires while typing: Space types a space in INSERT", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("a b");
    await expect.poll(() => draft(page)).toBe("a b");
    await expect(bar(page)).toHaveText("-- INSERT --  main");
  });

  test("the leader is a setting on the Vim mode page; a Ctrl chord works in INSERT as well", async ({ page, app }) => {
    await open(page, app);
    await press(page, "g", "v");
    const choice = page.getByRole("combobox", { name: "Leader key", exact: true });
    await expect(choice).toHaveValue("space"); // the default off a Mac
    await choice.selectOption("ctrl-b");
    await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).leader, SETTINGS)).toBe("ctrl-b");
    await press(page, "g", "m");
    await expect(mainScroller(page)).toBeVisible();
    await openThreadBeside(page);
    await press(page, "Space"); // no longer the leader
    await expect(bar(page)).not.toContainText("leader");
    await composer(page).click();
    await page.keyboard.type("typing");
    await expect(bar(page)).toHaveText("-- INSERT --  main");
    await press(page, "Control+b");
    await expect(bar(page)).toContainText("leader");
    await press(page, "x");
    await expect.poll(() => draft(page)).toBe("typing"); // the key after the leader is swallowed, not typed
    await expect(bar(page)).toHaveText("-- INSERT --  main");
    await press(page, "Control+b", "l"); // from the channel's box in INSERT to the thread's box
    await expect(replyBox(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
  });

  test("on a Mac the default is Ctrl-w", async ({ page, app }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel", configurable: true });
    });
    await open(page, app);
    await openThreadBeside(page);
    const start = await paneWidth(page);
    await press(page, "Control+w");
    await expect(bar(page)).toContainText("leader");
    await shifted(page, ">");
    await expect.poll(() => paneWidth(page)).toBe(start + 48);
    await press(page, "Control+w", "c");
    await expect(threadPane(page)).toHaveCount(0);
    await expect(mainScroller(page)).toBeFocused();
    await press(page, "c"); // a bare c closes nothing
    await expect(bar(page)).toContainText("NORMAL");
  });
});

test("disabling the plugin removes the overlay, the cursor rule and every key", async ({
  page,
  app,
}) => {
  await open(page, app);
  await press(page, "k");
  await expect.poll(() => cursor(page)).toBeDefined();
  await press(page, "Control+,");
  await selectSettingsSection(page, "Manage plugins");
  await pluginAction(page, "Vim mode").click();
  await closeSettings(page);
  await expect(page.locator("[data-vim-status]")).toHaveCount(0);
  await expect(page.locator("style[data-vim-cursor-style]")).toHaveCount(0);
  await expect(page.locator("[data-vim-cursor]")).toHaveCount(0); // the mark on the row goes too
  await expect(page.locator("html")).not.toHaveAttribute("data-vim-on", "");
  await expect(page.locator("html")).not.toHaveAttribute("data-vim-region", /.*/);
  await expect(page.locator("html")).not.toHaveAttribute("data-vim-box", /.*/);
  await press(page, "Escape");
  await press(page, "k");
  await expect(page.locator("[data-vim-status]")).toHaveCount(0);
});

test.describe("a long list", () => {
  test.use({ historyCounts: { alpha: 200, beta: 3 } });
  // The mark is an attribute on the row element, and the virtual list throws row elements away and builds new ones.
  test("the cursor mark comes back when the virtual list mounts its row again", async ({ page, app }) => {
    await open(page, app);
    await press(page, "k");
    const id = await cursor(page);
    expect(id).toBeDefined();
    const row = (page) =>
      page.evaluate((id) => {
        const el = document.querySelector(`[data-message-scroller] [data-message-id="${id}"]`);
        return el ? el.hasAttribute("data-vim-cursor") : null;
      }, id);
    const scrollTo = (page, where) =>
      page.evaluate((where) => {
        const scroller = document.querySelector("[data-message-scroller]");
        scroller.scrollTop = where === "top" ? 0 : scroller.scrollHeight;
      }, where);
    expect(await row(page)).toBe(true);
    // To the top, again and again: each time the list loads an older page, until the newest rows are far enough away to go.
    await expect
      .poll(async () => {
        await scrollTo(page, "top");
        return row(page);
      })
      .toBeNull(); // unmounted
    expect(await cursor(page)).toBe(id); // the cursor is the message, not the element
    await scrollTo(page, "bottom");
    await expect.poll(() => row(page)).toBe(true); // a new element, marked again
    await expect(page.locator("[data-vim-cursor]")).toHaveCount(1);
  });
});

const selected = (page) => page.evaluate(() => document.getSelection().toString());
const collapsed = (page) => page.evaluate(() => document.getSelection().isCollapsed);
const typeLines = async (page, ...lines) => {
  for (const [i, line] of lines.entries()) {
    if (i) await page.keyboard.press("Shift+Enter");
    await page.keyboard.type(line);
  }
};
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
const PLAIN = /-- VISUAL --/;
const LINE = /-- VISUAL LINE --/;

// Composer editing is on by default, so none of these set anything.
test.describe("normal mode inside the message box", () => {
  test("normal mode inside the message box moves the caret and edits", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("hello world");
    await press(page, "Escape");
    await expect(composer(page)).toBeFocused(); // first Esc stays in the box
    await expect(bar(page)).toContainText("NORMAL");
    await press(page, "z", "q"); // plain keys must not type
    await expect.poll(() => draft(page)).toBe("hello world");
    await press(page, "0", "x");
    await expect.poll(() => draft(page)).toBe("ello world");
    await press(page, "w", "i");
    await expect(bar(page)).toContainText("INSERT");
    await page.keyboard.type("big ");
    await expect.poll(() => draft(page)).toBe("ello big world");
    await press(page, "Escape", "0", "d", "w");
    await expect.poll(() => draft(page)).toBe("big world");
    await press(page, "d", "d");
    await expect.poll(() => draft(page)).toBe("");
    // The editor groups edits made within about half a second into one undo step, so one
    // undo takes back both dw and dd.
    await press(page, "u");
    await expect.poll(() => draft(page)).toBe("ello big world");
    await press(page, "Escape"); // another Esc stays in NORMAL
    await expect(composer(page)).toBeFocused();
    await press(page, "k"); // the first row: up out of the box
    await expect(composer(page)).not.toBeFocused();
    await expect(bar(page)).toContainText("NORMAL");
  });

  test("caret motions and the four ways back to insert", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("one two three");
    await press(page, "Escape", "$", "b", "i");
    await page.keyboard.type("X");
    await expect.poll(() => draft(page)).toBe("one two Xthree");
    await press(page, "Escape", "0", "l", "l", "a");
    await page.keyboard.type("!");
    await expect.poll(() => draft(page)).toBe("one! two Xthree");
    await press(page, "Escape", "A");
    await page.keyboard.type("?");
    await expect.poll(() => draft(page)).toBe("one! two Xthree?");
    await press(page, "Escape", "I");
    await page.keyboard.type(">");
    await expect.poll(() => draft(page)).toBe(">one! two Xthree?");
    await press(page, "Escape", "0", "3", "l", "i");
    await page.keyboard.type("_");
    await expect.poll(() => draft(page)).toBe(">on_e! two Xthree?");
    await press(page, "Escape", "h", "h", "i");
    await page.keyboard.type("-");
    await expect.poll(() => draft(page)).toBe(">-on_e! two Xthree?");
  });
});

test.describe("visual mode inside the message box", () => {
  test("v highlights the character under the cursor; motions grow it to the right", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("one two three");
    await press(page, "Escape", "0", "v");
    await expect(bar(page)).toHaveText(PLAIN);
    await expect.poll(() => selected(page)).toBe("o"); // the character under the cursor, at once
    await press(page, "l", "l");
    await expect.poll(() => selected(page)).toBe("one"); // inclusive: three characters, two moves
    await press(page, "h"); // a motion starts from the cursor, not from the end of the highlight
    await expect.poll(() => selected(page)).toBe("on");
    await press(page, "l");
    await expect.poll(() => selected(page)).toBe("one");
    await press(page, "w");
    await expect.poll(() => selected(page)).toBe("one t");
    await press(page, "$");
    await expect.poll(() => selected(page)).toBe("one two three"); // through the last character
    await press(page, "0");
    await expect.poll(() => selected(page)).toBe("o"); // back onto the anchor
    await press(page, "2", "l");
    await expect.poll(() => selected(page)).toBe("one"); // counts work
    await expect.poll(() => draft(page)).toBe("one two three");
  });

  test("motions to the left keep the character the highlight started on, and it can cross over", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("one two three");
    await press(page, "Escape", "$", "v");
    await expect.poll(() => selected(page)).toBe("e"); // $ rests on the last character, not past it
    await press(page, "h", "h");
    await expect.poll(() => selected(page)).toBe("ree");
    await press(page, "b");
    await expect.poll(() => selected(page)).toBe("three");
    await press(page, "b");
    await expect.poll(() => selected(page)).toBe("two three");
    await press(page, "Escape", "0", "4", "l", "v"); // on the t of two
    await expect.poll(() => selected(page)).toBe("t");
    await press(page, "h", "h");
    await expect.poll(() => selected(page)).toBe("e t");
    await press(page, "3", "l"); // across the starting character and out the other side
    await expect.poll(() => selected(page)).toBe("tw");
  });

  test("Esc leaves visual mode with the caret on the cursor; v again or a click does too; V and v switch kind", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("one two");
    await press(page, "Escape", "0", "v", "l", "l", "Escape");
    await expect(bar(page)).toContainText("NORMAL");
    expect(await collapsed(page)).toBe(true);
    await press(page, "x"); // the caret was on the third character
    await expect.poll(() => draft(page)).toBe("on two");
    await press(page, "0", "v");
    await expect(bar(page)).toHaveText(PLAIN);
    await press(page, "V");
    await expect(bar(page)).toHaveText(LINE);
    await expect.poll(() => selected(page)).toBe("on two");
    await press(page, "v");
    await expect(bar(page)).toHaveText(PLAIN);
    await expect.poll(() => selected(page)).toBe("o");
    await press(page, "v");
    await expect(bar(page)).toContainText("NORMAL");
    expect(await collapsed(page)).toBe(true);
    await press(page, "V", "V");
    await expect(bar(page)).toContainText("NORMAL");
    await press(page, "v");
    await composer(page).click();
    await expect(bar(page)).toContainText("NORMAL"); // the click ended it
    await press(page, "Escape");
    await expect(composer(page)).toBeFocused(); // Esc outside visual mode stays in NORMAL
    await press(page, "k");
    await expect(composer(page)).not.toBeFocused(); // and k on the first row leaves the box
  });

  test("keys that mean nothing here do not type; the draft is untouched until an operator acts", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("one two three");
    await press(page, "Escape", "0", "v", "3", "l");
    await expect.poll(() => selected(page)).toBe("one ");
    await press(page, "z", "q", "Enter", "i", "u");
    await expect(bar(page)).toHaveText(PLAIN); // none of them left visual mode
    await expect.poll(() => selected(page)).toBe("one ");
    await expect.poll(() => draft(page)).toBe("one two three");
  });

  test("y copies the highlight to the clipboard and keeps the draft", async ({ page, app }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("one two three");
    await press(page, "Escape", "0", "v", "w", "y");
    await expect(bar(page)).toContainText("NORMAL");
    expect(await clipboard(page)).toBe("one t");
    expect(await collapsed(page)).toBe(true);
    await expect.poll(() => draft(page)).toBe("one two three");
    await press(page, "x"); // the caret went to the start of what was copied
    await expect.poll(() => draft(page)).toBe("ne two three");
  });

  test("d and x delete the highlight, inclusive of both ends; u takes it back", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("one two three");
    await press(page, "Escape", "0", "v", "l", "l", "d");
    await expect.poll(() => draft(page)).toBe(" two three");
    await expect(bar(page)).toContainText("NORMAL");
    expect(await collapsed(page)).toBe(true);
    await press(page, "u");
    await expect.poll(() => draft(page)).toBe("one two three");
    await press(page, "$", "v", "b", "x"); // backwards, to the end of the line
    await expect.poll(() => draft(page)).toBe("one two ");
    await expect(bar(page)).toContainText("NORMAL");
  });

  test("c deletes the highlight and goes to insert mode", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("one two three");
    await press(page, "Escape", "0", "v", "l", "l", "c");
    await expect(bar(page)).toContainText("INSERT");
    await page.keyboard.type("1");
    await expect.poll(() => draft(page)).toBe("1 two three");
  });

  test("V highlights whole lines; j and k grow it both ways", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await typeLines(page, "alpha", "beta", "gamma");
    await press(page, "Escape", "V");
    await expect(bar(page)).toHaveText(LINE);
    await expect.poll(() => selected(page)).toBe("gamma");
    await press(page, "k");
    await expect.poll(() => selected(page)).toBe("beta\ngamma");
    await press(page, "k");
    await expect.poll(() => selected(page)).toBe("alpha\nbeta\ngamma");
    await press(page, "j");
    await expect.poll(() => selected(page)).toBe("beta\ngamma");
    await press(page, "j", "j"); // past the anchor, which keeps its own line
    await expect.poll(() => selected(page)).toBe("gamma");
  });

  test("a character highlight goes across lines too", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await typeLines(page, "alpha", "beta");
    await press(page, "Escape", "k", "0", "v", "j");
    await expect.poll(() => selected(page)).toBe("alpha\nb");
  });

  test("Vd takes the lines whole, with their newline; the caret lands on the next line", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await typeLines(page, "alpha", "beta", "gamma");
    await press(page, "Escape", "k", "V", "d");
    await expect.poll(() => draft(page)).toBe("alpha\ngamma");
    await press(page, "x");
    await expect.poll(() => draft(page)).toBe("alpha\namma");
  });

  test("Vd on the first line and on the last lines leaves no empty line behind", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await typeLines(page, "alpha", "beta", "gamma");
    await press(page, "Escape", "k", "k", "V", "d");
    await expect.poll(() => draft(page)).toBe("beta\ngamma");
    await press(page, "x");
    await expect.poll(() => draft(page)).toBe("eta\ngamma");
    await press(page, "j", "V", "d"); // the last line: the newline before it goes instead
    await expect.poll(() => draft(page)).toBe("eta");
    await press(page, "V", "d"); // the only line: nothing else to take
    await expect.poll(() => draft(page)).toBe("");
  });

  test("Vd on the last two lines takes the newline before them", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await typeLines(page, "alpha", "beta", "gamma");
    await press(page, "Escape", "k", "V", "j", "d");
    await expect.poll(() => draft(page)).toBe("alpha");
  });

  test("Vc keeps one empty line and types into it; Vy copies the lines", async ({ page, app }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, app);
    await composer(page).click();
    await typeLines(page, "alpha", "beta", "gamma");
    await press(page, "Escape", "k", "k", "V", "j", "y");
    expect(await clipboard(page)).toBe("alpha\nbeta");
    await expect.poll(() => draft(page)).toBe("alpha\nbeta\ngamma");
    await press(page, "j", "V", "c");
    await expect(bar(page)).toContainText("INSERT");
    await page.keyboard.type("X");
    await expect.poll(() => draft(page)).toBe("alpha\nX\ngamma");
  });
});

test("visual mode works in a thread's reply box, and Esc there ends the mode without closing the thread", async ({
  page,
  app,
}) => {
  await open(page, app);
  const row = page.locator("[data-message-scroller] [data-message-id]").last();
  await hoverMessage(row);
  await row.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = page.getByRole("textbox", { name: "Reply to thread", exact: true });
  await expect(reply).toBeFocused();
  await page.keyboard.type("hello brave world");
  await press(page, "Escape", "0", "w", "v", "l", "l");
  await expect(bar(page)).toHaveText(/-- VISUAL --.*side/);
  await expect.poll(() => selected(page)).toBe("bra");
  await press(page, "w");
  await expect.poll(() => selected(page)).toBe("brave w");
  await press(page, "Escape");
  await expect(reply).toBeVisible();
  await expect(reply).toBeFocused();
  await expect(bar(page)).toContainText("NORMAL");
  await press(page, "Escape");
  await expect(reply).toBeVisible(); // the thread is still open
  await expect(reply).toBeFocused();
  await press(page, "k");
  await expect(reply).not.toBeFocused();
  await expect.poll(() => reply.evaluate((el) => el.textContent)).toBe("hello brave world");
});

test.describe("composer editing setting", () => {
  test("switched off, one Esc leaves the message box and nothing is swallowed", async ({ page, app }) => {
    await page.addInitScript(
      ([key]) => localStorage.setItem(key, JSON.stringify({ composerNormal: false })),
      [SETTINGS],
    );
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("v");
    await press(page, "Escape");
    await expect(composer(page)).not.toBeFocused();
    await expect(bar(page)).toHaveText(/-- NORMAL --/);
    await expect.poll(() => draft(page)).toBe("v");
  });

  test("the page's checkbox is on, and switching it off saves that one choice only", async ({ page, app }) => {
    await open(page, app);
    await press(page, "g", "v");
    const box = page.getByRole("checkbox", { name: /Normal and visual mode inside the message box/ });
    await expect(box).toBeChecked();
    await box.uncheck();
    expect(await page.evaluate((key) => localStorage.getItem(key), SETTINGS)).toBe('{"composerNormal":false}');
  });

  test("an old saved record is read for the other switches, not for this one", async ({ page, app }) => {
    await page.addInitScript(
      ([key]) =>
        localStorage.setItem(key, JSON.stringify({ enabled: true, statusLine: false, composerNormal: false })),
      [OLD_SETTINGS],
    );
    await open(page, app);
    await expect(bar(page)).toBeHidden(); // statusLine=false was kept
    await composer(page).click();
    await page.keyboard.type("hi");
    await press(page, "Escape");
    await expect(composer(page)).toBeFocused(); // composerNormal=false was not: the default applies
  });
});

// ---- Motions inside the message box --------------------------------------------------------------
// Positions are read as the offset of the caret in a one-line draft, or as the character under the
// cursor (what v would highlight) in a draft with several lines.
const offset = (page) =>
  composer(page).evaluate((el) => {
    const s = document.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(s.focusNode, s.focusOffset);
    return r.toString().length;
  });
const under = async (page) => {
  await press(page, "v");
  const c = await selected(page);
  await press(page, "Escape");
  return c;
};
const lines = (page) => composer(page).evaluate((el) => el.innerText);
const normal = async (page, text) => {
  await composer(page).click();
  await page.keyboard.type(text);
  await press(page, "Escape");
  await expect(bar(page)).toContainText("NORMAL");
};
const at = async (page, ...keys) => {
  await press(page, ...keys);
  return offset(page);
};

test.describe("motions inside the message box", () => {
  // f0 o1 o2 .3 b4 a5 r6 _7 b8 a9 z10 _11 q12 u13 x14 ;15 _16 e17 n18 d19 (_ is a space, except in baz_qux)
  const WORDS = "foo.bar baz_qux; end";

  test("w b e ge treat letters, digits and underscore as one word and other characters as another", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await normal(page, WORDS);
    await press(page, "0");
    for (const want of [3, 4, 8, 15, 17, 19]) expect(await at(page, "w")).toBe(want); // the last w stops on the last character
    await press(page, "0");
    for (const want of [2, 3, 6, 14, 15, 19]) expect(await at(page, "e")).toBe(want);
    await press(page, "$");
    for (const want of [17, 15, 8, 4, 3, 0, 0]) expect(await at(page, "b")).toBe(want);
    await press(page, "$");
    for (const want of [15, 14, 6, 3, 2, 0]) expect(await at(page, "g", "e")).toBe(want);
    // Counts.
    await press(page, "0");
    expect(await at(page, "3", "w")).toBe(8);
    await press(page, "0");
    expect(await at(page, "2", "e")).toBe(3);
    await press(page, "$");
    expect(await at(page, "2", "b")).toBe(15);
    await press(page, "$");
    expect(await at(page, "2", "g", "e")).toBe(14);
  });

  test("W B E gE take any run of non-blank characters as one word", async ({ page, app }) => {
    await open(page, app);
    await normal(page, WORDS);
    await press(page, "0");
    for (const want of [8, 17, 19]) expect(await at(page, "W")).toBe(want);
    await press(page, "0");
    for (const want of [6, 15, 19]) expect(await at(page, "E")).toBe(want);
    await press(page, "$");
    for (const want of [17, 8, 0]) expect(await at(page, "B")).toBe(want);
    await press(page, "$");
    for (const want of [15, 6]) expect(await at(page, "g", "E")).toBe(want);
  });

  test("f t F T find a character on the line, ; repeats and , reverses, counts pick the nth", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await normal(page, "a,b,c,d,e"); // commas at 1 3 5 7
    await press(page, "0");
    expect(await at(page, "f", ",")).toBe(1);
    expect(await at(page, ";")).toBe(3);
    expect(await at(page, ";")).toBe(5);
    expect(await at(page, ",")).toBe(3);
    expect(await at(page, ",")).toBe(1);
    expect(await at(page, ",")).toBe(1); // no comma further back: nothing moves
    await press(page, "0");
    expect(await at(page, "t", ",")).toBe(0); // already just before the comma
    expect(await at(page, ";")).toBe(2); // a repeated t goes on to the next one
    expect(await at(page, ";")).toBe(4);
    await press(page, "$");
    expect(await at(page, "F", ",")).toBe(7);
    expect(await at(page, ";")).toBe(5);
    expect(await at(page, "T", ",")).toBe(4); // just after the comma at 3
    expect(await at(page, ";")).toBe(2); // a repeated T goes on to the next one
    await press(page, "0");
    expect(await at(page, "2", "f", ",")).toBe(3);
    await press(page, "0");
    expect(await at(page, "3", "t", ",")).toBe(4);
    await press(page, "0");
    expect(await at(page, "9", "f", ",")).toBe(0); // fewer than nine: no move
    expect(await at(page, "f", "z")).toBe(0);
  });

  test("a digit after f is the character to find, not a count; Esc cancels a half-typed f", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await normal(page, "a1b2");
    await press(page, "0");
    expect(await at(page, "f", "2")).toBe(3);
    await press(page, "0", "f");
    await expect(bar(page)).toContainText("f");
    await press(page, "Escape");
    await expect(composer(page)).toBeFocused(); // the first Esc only cancels the f
    await expect(bar(page)).toContainText("NORMAL");
    await expect(bar(page)).not.toContainText(/\bf\b/);
    await press(page, "x"); // an ordinary x, not the character to find
    await expect.poll(() => draft(page)).toBe("1b2");
  });

  test("gg and G go to the first and last line, 3G to line 3, and land on the first non-blank character", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await composer(page).click();
    await typeLines(page, "alpha", "  beta", "gamma", "delta");
    await press(page, "Escape");
    expect(await under(page)).not.toBe("");
    await press(page, "G");
    expect(await under(page)).toBe("d");
    await press(page, "g", "g");
    expect(await under(page)).toBe("a");
    await press(page, "2", "G");
    expect(await under(page)).toBe("b"); // past the two blanks
    await press(page, "3", "g", "g");
    expect(await under(page)).toBe("g");
    await press(page, "9", "G");
    expect(await under(page)).toBe("d"); // there is no line 9: the last one
  });

  test("0 ^ $ work on the whole line, not on the row it wraps to", async ({ page, app }) => {
    await open(page, app);
    const long = `a${" bcdef".repeat(70)}`;
    await normal(page, long);
    expect(await offset(page)).toBe(long.length - 1);
    await press(page, "k"); // up one screen row
    expect(await offset(page)).toBeLessThan(long.length - 20);
    expect(await at(page, "0")).toBe(0);
    expect(await at(page, "$")).toBe(long.length - 1);
    await press(page, "k");
    expect(await at(page, "0")).toBe(0);
  });

  test("$ rests on the last character, so x never eats the line break; l stays on its line", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await composer(page).click();
    await typeLines(page, "ab", "cd");
    await press(page, "Escape", "k", "0", "$", "x");
    await expect.poll(() => lines(page)).toBe("a\ncd");
    await press(page, "0", "l", "l", "l", "x"); // l cannot leave the line: this takes the last character
    await expect.poll(() => lines(page)).toBe("\ncd");
    await press(page, "x"); // nothing under the cursor on an empty line: x leaves the line break alone
    await expect.poll(() => lines(page)).toBe("\ncd");
  });

  test("the new motions extend a visual highlight, with counts", async ({ page, app }) => {
    await open(page, app);
    await normal(page, WORDS);
    await press(page, "0", "v", "e");
    await expect.poll(() => selected(page)).toBe("foo");
    await press(page, "e");
    await expect.poll(() => selected(page)).toBe("foo.");
    await press(page, "W");
    await expect.poll(() => selected(page)).toBe("foo.bar b");
    await press(page, "E");
    await expect.poll(() => selected(page)).toBe("foo.bar baz_qux;");
    await press(page, "g", "e");
    await expect.poll(() => selected(page)).toBe("foo.bar baz_qux");
    await press(page, "B");
    await expect.poll(() => selected(page)).toBe("foo.bar b");
    await press(page, "Escape", "0", "v", "f", "b");
    await expect.poll(() => selected(page)).toBe("foo.b");
    await press(page, "t", "q"); // a repeated find searches on from the cursor
    await expect.poll(() => selected(page)).toBe("foo.bar baz_");
    await press(page, "F", ".");
    await expect.poll(() => selected(page)).toBe("foo.");
    await press(page, "Escape", "0", "v", "2", "e");
    await expect.poll(() => selected(page)).toBe("foo.");
    await press(page, "Escape", "$", "v", "F", "b");
    await expect.poll(() => selected(page)).toBe("baz_qux; end"); // F b finds the b of baz, the cursor end
    await press(page, "g", "g");
    await expect.poll(() => selected(page)).toBe(WORDS);
  });

  test("V and G or gg select whole lines", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await typeLines(page, "one", "two", "three");
    await press(page, "Escape", "g", "g", "V", "G");
    await expect.poll(() => selected(page)).toBe("one\ntwo\nthree");
    await press(page, "g", "g");
    await expect.poll(() => selected(page)).toBe("one");
  });

  test("d takes the motions that land on a character too, and not the first word of the next line", async ({
    page,
    app,
  }) => {
    await open(page, app);
    // A clean, empty draft in insert mode: i if the box was left in normal mode.
    const clear = async () => {
      await composer(page).click();
      if (/NORMAL/.test(await bar(page).textContent())) await press(page, "i");
      await press(page, "Control+a", "Backspace");
    };
    const edit = async (text, keys, want) => {
      await clear();
      await page.keyboard.type(text);
      await press(page, "Escape", "0", ...keys);
      await expect.poll(() => draft(page)).toBe(want);
    };
    await edit("one two three", ["d", "e"], " two three"); // e lands on the last character of the word and takes it
    await edit("one two three", ["d", "f", "t"], "wo three"); // f takes the found character
    await edit("one two three", ["d", "t", "t"], "two three"); // t stops before it
    await edit("one two three", ["d", "W"], "two three");
    await edit("one two three", ["d", "2", "w"], "three");
    await edit("one two three", ["w", "d", "g", "e"], "onwo three"); // ge takes both ends
    await edit("one two three", ["$", "d", "F", "t"], "one two e"); // backwards stops short of the cursor
    await edit("a-b c", ["d", "w"], "-b c"); // w ends at punctuation
    await edit("a-b c", ["d", "W"], "c");
    // The last word on a line: dw takes the word and leaves the line break.
    await clear();
    await typeLines(page, "foo", "bar");
    await press(page, "Escape", "k", "0", "d", "w");
    await expect.poll(() => lines(page)).toBe("\nbar");
  });
});

// ---- The mode label and the help dialog ------------------------------------------------------------
test.describe("the mode label", () => {
  const label = (page, text) => expect(bar(page)).toHaveText(text);
  const hits = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  // The label is in the window's bottom-right corner whichever pane or thread tab has the keys, and
  // clear of every composer on screen: its send button and the buttons of its toolbar.
  const corner = async (page) => {
    const mine = await bar(page).boundingBox();
    const view = page.viewportSize();
    const at = JSON.stringify(mine);
    expect(mine.x + mine.width, `the label ${at} is past the right edge`).toBeLessThanOrEqual(view.width);
    expect(mine.y + mine.height, `the label ${at} is past the bottom edge`).toBeLessThanOrEqual(view.height);
    expect(view.width - (mine.x + mine.width), `the label ${at} is not at the right edge`).toBeLessThanOrEqual(16);
    expect(view.height - (mine.y + mine.height), `the label ${at} is not at the bottom edge`).toBeLessThanOrEqual(8);
    const buttons = await page.locator("form button:visible").all();
    for (const button of buttons) {
      const box = await button.boundingBox();
      if (box) expect(hits(mine, box), `the label ${at} touches a composer button ${JSON.stringify(box)}`).toBe(false);
    }
    for (const card of await page.locator("form:visible").all()) {
      const box = await card.boundingBox();
      if (box) expect(hits(mine, box), `the label ${at} touches a composer ${JSON.stringify(box)}`).toBe(false);
    }
  };
  const everyMode = async (page, box) => {
    await corner(page); // NORMAL, in the list
    await box.click();
    await page.keyboard.type("one two");
    await corner(page); // INSERT
    await press(page, "Escape");
    await corner(page); // NORMAL
    await press(page, "0", "v");
    await corner(page); // VISUAL
    await press(page, "V");
    await corner(page); // VISUAL LINE
    await press(page, "Escape", "Escape");
    await corner(page);
    await press(page, "k"); // up out of the box, into its pane's messages
    await corner(page);
  };

  test("says NORMAL, INSERT, VISUAL and VISUAL LINE, each with the pane that has the keys", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await label(page, "-- NORMAL -- main");
    await press(page, "h");
    await label(page, "-- NORMAL -- sidebar");
    await press(page, "l");
    await label(page, "-- NORMAL -- main");
    await composer(page).click();
    await label(page, "-- INSERT -- main");
    await page.keyboard.type("one two");
    await press(page, "Escape");
    await label(page, "-- NORMAL -- main");
    await press(page, "0", "v");
    await label(page, "-- VISUAL -- main");
    await press(page, "V");
    await label(page, "-- VISUAL LINE -- main");
    await press(page, "Escape", "Escape");
    await label(page, "-- NORMAL -- main");
    // The thread pane says side in every mode.
    const row = page.locator("[data-message-scroller] [data-message-id]").last();
    await hoverMessage(row);
    await row.getByRole("button", { name: "Reply", exact: true }).click();
    const reply = page.getByRole("textbox", { name: "Reply to thread", exact: true });
    await expect(reply).toBeFocused();
    await label(page, "-- INSERT -- side");
    await page.keyboard.type("hi there");
    await press(page, "Escape");
    await label(page, "-- NORMAL -- side");
    await press(page, "0", "v");
    await label(page, "-- VISUAL -- side");
    await press(page, "V");
    await label(page, "-- VISUAL LINE -- side");
    await press(page, "Escape", "Escape");
    await label(page, "-- NORMAL -- side");
  });

  test("sits in the window's bottom-right corner in a single pane, in every mode", async ({ page, app }) => {
    await open(page, app);
    await expect(threadPane(page)).toHaveCount(0);
    await everyMode(page, composer(page));
  });

  test("sits in the same corner with a thread beside the channel, whichever pane has the keys, in every mode", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await openThreadBeside(page);
    await everyMode(page, replyBox(page));
    await press(page, "h");
    await label(page, "-- NORMAL -- main");
    await everyMode(page, composer(page));
    await press(page, "h");
    await label(page, "-- NORMAL -- sidebar");
    await corner(page);
    // And follows nothing when the pane is made wider.
    await press(page, "l", "l", ">", ">", ">");
    await expect.poll(() => paneWidth(page)).toBeGreaterThan(0);
    await corner(page);
  });

  test("stays in that corner with two and three thread tabs open, whichever tab has the keys", async ({ page, app }) => {
    await open(page, app);
    const tabs = page.locator('[data-panel-workspace] [role="tab"][data-tab-value^="thread:"]');
    const shownList = page.locator('[data-panel-workspace] [role="tabpanel"]:not([inert]) [data-message-scroller]');
    await openThreadBeside(page);
    await expect(tabs).toHaveCount(1);
    await corner(page);
    // From the channel's list one message further up each time, a new thread tab each time.
    for (const count of [2, 3]) {
      await press(page, "h", "k", "o");
      await expect(tabs).toHaveCount(count);
      await expect(shownList).toBeFocused();
      await label(page, "-- NORMAL -- side");
      await corner(page);
    }
    // The keys that need the pane's message box find the one that shows, not the first tab's.
    await press(page, "i");
    await expect(replyBox(page)).toBeFocused();
    await label(page, "-- INSERT -- side");
    await corner(page);
    await press(page, "Escape");
    await everyMode(page, replyBox(page));
    // The channel's box to the thread's: l at the end of a draft.
    await press(page, "h");
    await composer(page).click();
    await page.keyboard.type("a");
    await press(page, "Escape", "l");
    await expect(replyBox(page)).toBeFocused();
    await label(page, "-- NORMAL -- side");
    await corner(page);
    // The label follows the keys between the panes and stays put; so does picking another tab.
    await press(page, "k", "h");
    await label(page, "-- NORMAL -- main");
    await corner(page);
    await tabs.first().click();
    await corner(page);
    await expect(page.locator("[data-vim-status]")).toHaveCount(1);
  });
});

test.describe("the help dialog", () => {
  const help = (page) => page.getByRole("dialog", { name: "Vim keys", exact: true });
  const help_scroll = (page) => help(page).evaluate((el) => Math.round(el.scrollTop));
  const question = async (page) => {
    // A real keyboard sends key "?" with Shift held; Playwright's "Shift+/" sends "/" instead.
    await page.keyboard.down("Shift");
    await page.keyboard.press("?");
    await page.keyboard.up("Shift");
  };

  test("? opens it over the page, grouped by mode; q, Esc and ? close it and leave you where you were", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await press(page, "k", "k");
    const at = await cursor(page);
    const was = await page.evaluateHandle(() => document.activeElement); // where the keys are now
    const stillThere = () => page.evaluate((el) => document.activeElement === el, was);
    await question(page);
    await expect(help(page)).toBeVisible();
    await expect(help(page)).toHaveAttribute("aria-modal", "true");
    for (const group of ["NORMAL, messages and panes", "NORMAL, the message box", "INSERT", "VISUAL"])
      await expect(help(page).getByText(`-- ${group} --`, { exact: true })).toBeAttached();
    await expect(help(page).getByText("f t F T + a character")).toBeAttached();
    // It is a layer over the page, not a page: the channel is still there, dimmed behind it.
    await expect(page.getByRole("heading", { name: "Vim mode", exact: true })).toHaveCount(0);
    await expect(mainScroller(page)).toBeVisible();
    expect(await page.locator("[data-vim-help]").boundingBox()).toMatchObject({ x: 0, y: 0, width: 1440 });
    for (const close of [["q"], ["Escape"], ["Shift+?"]]) {
      await expect(help(page)).toBeFocused();
      if (close[0] === "Shift+?") await question(page);
      else await press(page, ...close);
      await expect(help(page)).toHaveCount(0);
      expect(await stillThere()).toBe(true); // focus is back on what had it
      expect(await cursor(page)).toBe(at); // nothing moved behind it
      await question(page);
      await expect(help(page)).toBeVisible();
    }
    // A click on the dimmed backdrop closes it too.
    await page.mouse.click(5, 5);
    await expect(help(page)).toHaveCount(0);
    await expect(bar(page)).toContainText("NORMAL");
  });

  test("j k, Ctrl-d Ctrl-u and gg G scroll it, and no key reaches the page behind it", async ({ page, app }) => {
    await open(page, app);
    await press(page, "k", "k");
    const at = await cursor(page);
    await question(page);
    await expect(help(page)).toBeVisible();
    const scrollable = await help(page).evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(scrollable).toBeGreaterThan(300); // the list is longer than the dialog
    expect(await help_scroll(page)).toBe(0);
    await press(page, "j");
    await expect.poll(() => help_scroll(page)).toBe(48);
    await press(page, "j", "j");
    await expect.poll(() => help_scroll(page)).toBe(144);
    await press(page, "k");
    await expect.poll(() => help_scroll(page)).toBe(96);
    await press(page, "5", "j");
    await expect.poll(() => help_scroll(page)).toBe(336);
    const half = await help(page).evaluate((el) => el.clientHeight / 2);
    await press(page, "g", "g");
    await expect.poll(() => help_scroll(page)).toBe(0);
    await press(page, "Control+d");
    await expect.poll(() => help_scroll(page)).toBeGreaterThanOrEqual(Math.floor(half) - 1);
    await expect.poll(() => help_scroll(page)).toBeLessThanOrEqual(Math.ceil(half) + 1);
    await press(page, "Control+u");
    await expect.poll(() => help_scroll(page)).toBe(0);
    await page.keyboard.down("Shift");
    await page.keyboard.press("G");
    await page.keyboard.up("Shift");
    await expect.poll(() => help_scroll(page)).toBe(scrollable);
    await press(page, "g", "g");
    await expect.poll(() => help_scroll(page)).toBe(0);
    // Nothing leaks: no channel moved, no search, no typing into the box, no mode change.
    await press(page, "x", "i", "a", "h", "l", "/", "o", "r", "Enter", "[", "]");
    await expect(help(page)).toBeVisible();
    expect(await cursor(page)).toBe(at);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(composer(page)).not.toBeFocused();
    expect(await draft(page)).toBe("");
    await expect(bar(page)).toContainText("NORMAL");
    await press(page, "q");
    await expect(help(page)).toHaveCount(0);
    expect(await cursor(page)).toBe(at);
  });

  test("it opens from the channel list too, and returns there", async ({ page, app }) => {
    await open(page, app);
    await press(page, "h");
    await expect(bar(page)).toContainText("sidebar");
    await question(page);
    await expect(help(page)).toBeVisible();
    await press(page, "Escape");
    await expect(help(page)).toHaveCount(0);
    await expect(page.locator("button[data-channel-id]:focus")).toHaveCount(1);
    await expect(bar(page)).toContainText("sidebar");
  });

  test("? types a question mark in the message box instead", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await question(page);
    await expect(help(page)).toHaveCount(0);
    await expect.poll(() => draft(page)).toBe("?");
  });
});

// ---- The g page keys work wherever the keys are ---------------------------------------------------
// One NORMAL mode: the keys that were the app's (the lists') and the keys that were the message box's
// share it, so a `g` then a letter must go to the page in the lists, in the channel list and in a
// message box in NORMAL. A test on a Mac found them dead (in a box, g was only the start of gg, ge, gE).
test.describe("the g page keys", () => {
  const where = (page) =>
    page.evaluate(() => {
      const target = JSON.parse(decodeURIComponent(location.hash.slice("#buzz=".length)));
      return target.kind === "page" ? `${target.pluginId}/${target.pageId}` : target.kind;
    });
  const settings = (page) => page.getByRole("dialog", { name: "Settings", exact: true });
  // Back on the Messages page with the keys in the place under test.
  const enter = async (page, place) => {
    if ((await where(page)) !== "conversation") {
      await press(page, "g", "m");
      await expect.poll(() => where(page)).toBe("conversation");
    }
    const visibleList = page.locator("[data-panel-workspace] [data-message-scroller] >> visible=true");
    if (place.startsWith("the thread") && (await visibleList.count()) === 0) await openThreadBeside(page);
    if (place === "the channel's list") await mainScroller(page).focus();
    if (place === "the thread's list") await visibleList.focus();
    if (place === "the channel list") await page.locator('button[data-channel-id][aria-current="page"]').focus();
    if (place === "the channel's box") {
      await composer(page).click();
      await press(page, "Escape");
    }
    if (place === "the thread's box") {
      await replyBox(page).click();
      await press(page, "Escape");
    }
    await expect(bar(page)).toContainText(/NORMAL/);
  };
  for (const place of ["the channel's list", "the thread's list", "the channel list", "the channel's box", "the thread's box"]) {
    test(`gi ga gr gw gv gt gs and gm work from ${place}`, async ({ page, app }) => {
      await open(page, app);
      const inBox = place.endsWith("box");
      for (const [key, target] of [
        ["i", "buzz.inbox/inbox"],
        ["a", "buzz.agents/agents"],
        ["r", "buzz.reminders/reminders"],
        ["w", "buzz.workflows/workflows"],
        ["t", "buzz.reminders/reminders"],
        ["v", /^megatech\.vim-mode\//],
      ]) {
        await enter(page, place);
        await press(page, "g", key);
        await expect
          .poll(() => where(page), { message: `g${key} from ${place}` })
          .toMatch(target instanceof RegExp ? target : new RegExp(`^${target.replace(/[.]/g, "\\.")}$`));
      }
      // Settings is a dialog over the page, not a page.
      await enter(page, place);
      await press(page, "g", "s");
      await expect(settings(page), `gs from ${place}`).toBeVisible();
      await closeSettings(page);
      await expect(settings(page)).toHaveCount(0);
      // gm on the Messages page changes nothing: no message menu, no typing, no INSERT.
      await enter(page, place);
      const typed = inBox ? await composer(page).evaluate((el) => el.textContent) : "";
      await press(page, "g", "m");
      expect(await where(page)).toBe("conversation");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(bar(page)).toContainText("NORMAL");
      if (inBox) expect(await composer(page).evaluate((el) => el.textContent)).toBe(typed);
      // A g that nothing follows, then a motion that is not a page letter: gg still goes to the top
      // (a list) or the first line (a box), and nothing was typed.
      await press(page, "g", "g");
      await expect(bar(page)).toContainText("NORMAL");
      await expect(bar(page)).not.toContainText("g");
    });
  }
});

test.describe("the g page keys on a Mac", () => {
  test("gi from the message list, gs and gi from the message box, with the platform reported as a Mac", async ({ page, app }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel", configurable: true });
    });
    await open(page, app);
    const where = () =>
      page.evaluate(() => {
        const target = JSON.parse(decodeURIComponent(location.hash.slice("#buzz=".length)));
        return target.kind === "page" ? `${target.pluginId}/${target.pageId}` : target.kind;
      });
    await press(page, "g", "i");
    await expect.poll(where).toBe("buzz.inbox/inbox");
    await press(page, "g", "m");
    await expect.poll(where).toBe("conversation");
    await composer(page).click();
    await press(page, "Escape", "g", "s");
    await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
    await closeSettings(page);
    await composer(page).click();
    await press(page, "Escape", "g", "i");
    await expect.poll(where).toBe("buzz.inbox/inbox");
  });
});

// ---- Keys inside the Settings dialog ---------------------------------------------------------------
test.describe("the Settings dialog", () => {
  const dialog = (page) => page.getByRole("dialog", { name: "Settings", exact: true });
  const section = (page, name) =>
    dialog(page).getByRole("navigation", { name: "Settings sections", exact: true }).getByRole("button", { name, exact: true });
  const detail = (page) => dialog(page).locator("#settings-content");

  test("j and k move through the sections, l and Enter open one and go into it, h comes back, Esc closes", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await press(page, "g", "s");
    await expect(dialog(page).getByRole("button", { name: "Close Settings", exact: true })).toBeFocused();
    await press(page, "j"); // from the close button into the list, on the open section
    await expect(section(page, "Profile")).toBeFocused();
    await press(page, "j");
    await expect(section(page, "Local settings")).toBeFocused();
    await press(page, "j", "j");
    await expect(section(page, "Pair mobile")).toBeFocused();
    await press(page, "k");
    await expect(section(page, "Custom emoji")).toBeFocused();
    // Moving opens nothing; l does, and goes into the section.
    await expect(section(page, "Profile")).toHaveAttribute("aria-current", "page");
    await press(page, "l");
    await expect(section(page, "Custom emoji")).toHaveAttribute("aria-current", "page");
    await expect(detail(page)).toBeFocused();
    await press(page, "j", "k"); // scroll the section; nothing else happens
    await expect(detail(page)).toBeFocused();
    await press(page, "h"); // back to the list, on the open section
    await expect(section(page, "Custom emoji")).toBeFocused();
    await press(page, "k", "Enter"); // Enter opens and goes in, as l does
    await expect(section(page, "Local settings")).toHaveAttribute("aria-current", "page");
    await expect(detail(page)).toBeFocused();
    // Nothing reached the page behind the dialog.
    expect(await cursor(page)).toBeUndefined();
    await expect(bar(page)).toContainText("main");
    await press(page, "Escape");
    await expect(dialog(page)).toHaveCount(0);
  });

  test("a field in Settings still types j k h l, and another dialog keeps the keys off", async ({ page, app }) => {
    await open(page, app);
    await press(page, "g", "s");
    await expect(dialog(page)).toBeVisible();
    const field = detail(page).locator("input:visible").first();
    await field.click();
    await page.keyboard.type("jkhl");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(/jkhl$/);
    await expect(section(page, "Profile")).toHaveAttribute("aria-current", "page");
    // The edit makes Esc ask first. That dialog is not Settings: its keys stay off.
    await press(page, "Escape");
    const ask = page.getByRole("alertdialog");
    await expect(ask).toBeVisible();
    const focused = await page.evaluate(() => document.activeElement?.textContent);
    await press(page, "j", "k", "h", "l");
    await expect(ask).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(focused);
    await ask.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    // The search dialog is not Settings either: j and k are letters in its box.
    await press(page, "/");
    const search = page.getByRole("dialog").locator("input:visible").first();
    await expect(search).toBeFocused();
    await page.keyboard.type("jk");
    await expect(search).toHaveValue("jk");
    await press(page, "Escape");
  });
});

// ---- Fixes found in the real app (WebKit) and by the first test report ---------------------------------
test.describe("found in the real app and by the first test report", () => {
  test("leaving the box leaves no selection in it, and i resumes where the caret was", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await normal(page, "hello");
    await press(page, "k"); // the first row: up out of the box
    await expect(composer(page)).not.toBeFocused();
    // WebKit sends a key's text to the editor that holds the selection even without focus, so a
    // plain key that the plugin does not bind typed into the draft. No selection in the box, no leak.
    const inside = await composer(page).evaluate((el) => {
      const s = document.getSelection();
      return !!s.anchorNode && el.contains(s.anchorNode);
    });
    expect(inside).toBe(false);
    await press(page, "i");
    await expect(bar(page)).toContainText("INSERT");
    await page.keyboard.type("!");
    await expect.poll(() => draft(page)).toBe("hell!o"); // Esc stepped the caret back one character
  });

  test("u puts the caret at the start of what it restored, so the next key acts on one character", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await normal(page, "one two");
    await press(page, "0", "v", "l", "l");
    // The editor takes the page's selection into its own state a moment after it changes; a person is
    // never as quick as a test. One run under load left the caret at the end after u; a stale selection
    // in the editor's undo record is the likely cause (not proven).
    await page.waitForTimeout(150);
    await press(page, "d");
    await expect.poll(() => draft(page)).toBe(" two");
    await press(page, "u");
    await expect.poll(() => draft(page)).toBe("one two");
    expect(await collapsed(page)).toBe(true); // the editor leaves the restored text selected
    expect(await offset(page)).toBe(0);
    await press(page, "x");
    await expect.poll(() => draft(page)).toBe("ne two");
  });

  test("V d on a paragraph removes just that paragraph (a guard: it already did, in the real app too)", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    // Real paragraphs: a paste with blank lines makes them in the app; Enter would send, so ask the
    // editor for them the way its own Enter does.
    const paragraph = () => page.evaluate(() => document.execCommand("insertParagraph"));
    await page.keyboard.type("para one");
    await paragraph();
    await page.keyboard.type("para two");
    await paragraph();
    await page.keyboard.type("para three");
    await expect(composer(page).locator("p")).toHaveCount(3);
    await composer(page).locator("p").nth(1).click();
    await press(page, "Escape", "V", "d");
    await expect(composer(page).locator("p")).toHaveCount(2);
    await expect.poll(() => composer(page).locator("p").allInnerTexts()).toEqual(["para one", "para three"]);
  });
});
