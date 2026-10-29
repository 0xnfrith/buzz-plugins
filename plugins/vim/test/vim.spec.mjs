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

test("gp opens Settings on Manage plugins; a lone p does nothing; gs still opens Settings on the section it was on", async ({ page, app }) => {
  await open(page, app);
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const current = settings.locator('nav[aria-label="Settings sections"] [aria-current]');
  await press(page, "p");
  await expect(settings).toHaveCount(0);
  await press(page, "g", "p");
  await expect(settings).toBeVisible();
  await expect(current).toHaveText("Manage plugins");
  await expect(bar(page)).toContainText("NORMAL");
  await closeSettings(page);
  await expect(settings).toHaveCount(0);
  await press(page, "g", "s");
  await expect(settings).toBeVisible();
  await expect(current).not.toHaveText("Manage plugins"); // gs asks for no section: Settings opens as the host opens it
  await closeSettings(page);
});

test("gp on a Buzz that rejects the section field still opens Settings", async ({ page, app }) => {
  await open(page, app);
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  // A Buzz that does not take the section (an older one, whose Settings target has no such field) rejects the target. The page makes
  // this one's pattern for the section name refuse "plugins", which is what its validator then does with the field.
  await page.evaluate(() => {
    const test = RegExp.prototype.test;
    RegExp.prototype.test = function (value) {
      return value === "plugins" && this.source.includes("(?:") ? false : test.call(this, value);
    };
  });
  const answer = await page.evaluate(
    (viewer) =>
      window.fixtureNavigation.open({ version: 1, kind: "settings", section: "plugins", scope: { viewer, communityOrigin: "https://primary.example" } }),
    app.viewer,
  );
  expect(answer).toEqual({ status: "failed", reason: "invalid-target" }); // the host refuses a target that names the section
  await expect(settings).toHaveCount(0);
  await press(page, "g", "p");
  await expect(settings).toBeVisible(); // Settings opened all the same, on the section it opens on
  await expect(settings.locator('nav[aria-label="Settings sections"] [aria-current]')).not.toHaveText("Manage plugins");
  await closeSettings(page);
  await expect(settings).toHaveCount(0);
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

// The cursor on the message that has the long thread (exactMessages): the third, from the top of the channel's list.
const toRoot = async (page, app) => {
  const ids = await rowIds(page);
  const at = ids.indexOf(app.exact.root.id);
  expect(at).toBeGreaterThanOrEqual(0);
  await press(page, "g", "g");
  await expect.poll(() => cursor(page)).toBe(ids[0]);
  for (let i = 0; i < at; i++) await press(page, "j");
  await expect.poll(() => cursor(page)).toBe(app.exact.root.id);
};

test.describe("o opens a thread at its end", () => {
  // The channel's third message has 80 replies: a thread many screens long.
  test.use({ exactMessages: true });
  const atEnd = (scroller) => scroller.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
  const top = (scroller) => scroller.evaluate((el) => Math.round(el.scrollTop));
  // The row that carries the cursor of `pane` is in the part of the list that shows.
  const markedShows = (scroller, pane) =>
    scroller.evaluate((el, pane) => {
      const row = el.querySelector(`[data-vim-cursor="${pane}"]`);
      if (!row) return false;
      const list = el.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      return box.bottom > list.top && box.top < list.bottom;
    }, pane);
  test("beside the channel: the pane is at its end and the newest reply is under the cursor", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    await press(page, "o");
    await expect(threadPane(page)).toBeVisible();
    await expect(bar(page)).toContainText("side");
    const list = sideScroller(page);
    const newest = app.exact.target.id;
    await expect.poll(() => cursor(page)).toBe(newest);
    await expect.poll(() => atEnd(list)).toBe(true);
    expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(await list.evaluate((el) => el.clientHeight));
    expect(await markedShows(list, "side")).toBe(true);
    // The virtual list goes on mounting and measuring rows after the first scroll: the end it settles on is still the end.
    await page.waitForTimeout(1000);
    expect(await cursor(page)).toBe(newest);
    expect(await atEnd(list)).toBe(true);
    expect(await markedShows(list, "side")).toBe(true);
    await expect(sideScroller(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
    // The cursor moves on from there: k to the reply before, j back, j past the newest into the reply box.
    await press(page, "k");
    await expect.poll(() => cursor(page)).toBe(app.exact.replies.at(-2).id);
    await press(page, "j", "j");
    await expect(replyBox(page)).toBeFocused();
    // The channel's cursor stayed on the message the thread belongs to.
    expect(await page.locator("style[data-vim-cursor-style]").getAttribute("data-main-message-id")).toBe(app.exact.root.id);
  });

  test("opening it again from the channel's list lands at the end again, wherever the pane had been scrolled to", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    await press(page, "o");
    const list = sideScroller(page);
    await expect.poll(() => cursor(page)).toBe(app.exact.target.id);
    await press(page, "g", "g"); // up to the thread's first message
    await expect.poll(() => top(list)).toBe(0);
    await expect.poll(() => cursor(page)).not.toBe(app.exact.target.id);
    await press(page, "h"); // the channel's list; its cursor is on the root still
    await expect(bar(page)).toContainText("main");
    expect(await cursor(page)).toBe(app.exact.root.id);
    await press(page, "o");
    await expect(bar(page)).toContainText("side");
    await expect.poll(() => cursor(page)).toBe(app.exact.target.id);
    await expect.poll(() => atEnd(list)).toBe(true);
  });

  test("a key pressed while it lands wins: the cursor is not taken back to the newest message", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    // The moment the landing first marks a row in the pane, a k is pressed (from the page itself: a real key press takes longer than
    // that). The thread has its first rows by then and brings the rest in afterwards, and the landing would follow its end.
    await page.evaluate(() => {
      const mark = '[data-panel-workspace] [data-vim-cursor="side"]';
      const watch = new MutationObserver(() => {
        if (!document.querySelector(mark)) return;
        watch.disconnect();
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", bubbles: true, cancelable: true }));
        window.__kPressed = true;
      });
      watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-vim-cursor"] });
    });
    await press(page, "o");
    await page.waitForFunction(() => window.__kPressed);
    await expect.poll(() => cursor(page)).toBeDefined();
    const above = await cursor(page);
    expect(above).not.toBe(app.exact.target.id);
    await page.waitForTimeout(1500); // the rest of the thread arrives
    expect(await cursor(page)).toBe(above);
    expect(await sideScroller(page).locator(`[data-vim-cursor="side"]`).getAttribute("data-message-id")).toBe(above);
  });

  test("l, h and zo keep the cursor where the pane left it", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    await press(page, "o");
    await expect.poll(() => cursor(page)).toBe(app.exact.target.id);
    await press(page, "k", "k");
    await expect.poll(() => cursor(page)).toBe(app.exact.replies.at(-3).id);
    const list = sideScroller(page);
    const at = await top(list);
    await press(page, "h");
    await expect(bar(page)).toContainText("main");
    await press(page, "l");
    await expect(bar(page)).toContainText("side");
    await page.waitForTimeout(500);
    expect(await cursor(page)).toBe(app.exact.replies.at(-3).id);
    expect(await top(list)).toBe(at);
    await press(page, "z", "c", "z", "o");
    await expect(threadPane(page)).toBeVisible();
    await press(page, "l");
    await expect(bar(page)).toContainText("side");
    await page.waitForTimeout(500);
    expect(await cursor(page)).toBe(app.exact.replies.at(-3).id);
    expect(await top(list)).toBe(at);
  });

  test("q and o again at once: the second landing is not taken by the first's mark", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    await press(page, "o");
    await expect(threadPane(page)).toBeVisible();
    await press(page, "q"); // while the thread still lands
    await expect(threadPane(page)).toHaveCount(0);
    await expect(bar(page)).toContainText("main");
    await press(page, "o");
    await expect(bar(page)).toContainText("side");
    const list = sideScroller(page);
    await expect.poll(() => cursor(page)).toBe(app.exact.target.id);
    await expect.poll(() => atEnd(list)).toBe(true);
    await page.waitForTimeout(1500);
    expect(await cursor(page)).toBe(app.exact.target.id);
    expect(await atEnd(list)).toBe(true);
  });

  // The fixture's relay answers a thread in two pages (the host walks them in order: the first 50 replies, then the rest, following the
  // end as they come). A slow network leaves a wait before each: the first page is held here for `first` ms, the second for `later`.
  // Set after the channel's list has loaded, so that only the thread's own queries are held.
  const slowThread = (page, { first = 0, later = 0 }) =>
    page.route("**/query", async (route) => {
      let filters;
      try {
        filters = route.request().postDataJSON();
      } catch {}
      const walk = Array.isArray(filters) ? filters.find((filter) => filter.depth_limit !== undefined) : undefined;
      const ms = !walk ? 0 : walk.thread_cursor === undefined ? first : later;
      if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
      await route.continue();
    });

  // The rows behind a thread's loader are inert, which keeps them out of what the plugin can mark. A host that did not make them inert would
  // show them: the page takes the attribute off again whenever it is put on, so that a landing that did not wait for the list would mark one.
  const showRowsBehindLoader = (page) =>
    page.evaluate(() => {
      const unlock = () => document.querySelectorAll("[data-thread-rows][inert]").forEach((el) => el.removeAttribute("inert"));
      new MutationObserver(unlock).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["inert"] });
      unlock();
    });

  test("a thread brought in a page at a time, the second long after the first: the mark follows the end", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    await slowThread(page, { later: 1800 }); // three times as long as the landing waits for a change
    await press(page, "o");
    const list = sideScroller(page);
    // The first page ends at the 50th reply, where the landing marks the newest row that shows.
    await expect.poll(() => cursor(page)).toBe(app.exact.replies[49].id);
    await page.waitForTimeout(1000); // the landing has stopped by now
    await expect.poll(() => cursor(page), { timeout: 10000 }).toBe(app.exact.target.id);
    await expect.poll(() => atEnd(list)).toBe(true);
    expect(await markedShows(list, "side")).toBe(true);
    await expect(sideScroller(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
  });

  test("a thread whose first page comes after the landing has given up: nothing was marked, and the newest is when it comes", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    await slowThread(page, { first: 4200 }); // more than the landing's 3 s: the follow waits for the list, as the landing did
    await showRowsBehindLoader(page);
    await press(page, "o");
    await expect(threadPane(page)).toBeVisible();
    await page.waitForTimeout(3500);
    expect(await cursor(page)).toBeUndefined(); // nothing to mark yet
    const list = sideScroller(page);
    await expect.poll(() => cursor(page), { timeout: 15000 }).toBe(app.exact.target.id);
    await expect.poll(() => atEnd(list)).toBe(true);
    expect(await markedShows(list, "side")).toBe(true);
    await page.waitForTimeout(1500);
    expect(await cursor(page)).toBe(app.exact.target.id);
  });

  test("... and a key pressed before the second page comes wins over the mark following the end", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    await slowThread(page, { later: 2500 });
    await press(page, "o");
    await expect.poll(() => cursor(page)).toBe(app.exact.replies[49].id);
    await page.waitForTimeout(1000);
    await press(page, "k");
    await expect.poll(() => cursor(page)).toBe(app.exact.replies[48].id);
    await page.waitForTimeout(3500); // the second page has come, and the host has followed the end
    expect(await cursor(page)).toBe(app.exact.replies[48].id);
  });

  test("... and a thread closed with q, then opened again before the late page comes, is not marked by the first one's follow", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    await slowThread(page, { later: 2500 });
    await press(page, "o");
    await expect.poll(() => cursor(page)).toBe(app.exact.replies[49].id);
    await page.waitForTimeout(1000); // landed, following
    await press(page, "q");
    await expect(threadPane(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelector("[data-vim-cursor=side]") === null)).toBe(true);
    await press(page, "o"); // a new thread pane, its own landing
    await expect.poll(() => cursor(page), { timeout: 10000 }).toBe(app.exact.target.id);
    await expect.poll(() => atEnd(sideScroller(page))).toBe(true);
  });

  test("while the thread's first page is awaited its list is busy: nothing is marked, and the newest reply is when the page comes", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    await slowThread(page, { first: 1500 }); // within the landing's 3 s: the landing itself waits for the list
    await showRowsBehindLoader(page);
    await press(page, "o");
    await expect(threadPane(page)).toBeVisible();
    await page.waitForTimeout(900);
    expect(await cursor(page)).toBeUndefined(); // the message shown behind the loader is not marked
    const list = sideScroller(page);
    await expect.poll(() => cursor(page), { timeout: 10000 }).toBe(app.exact.target.id);
    await expect.poll(() => atEnd(list)).toBe(true);
  });

  test("with threads placed in the main pane: the channel's tab clicked while the thread still lands, the landing stands down", async ({ page, app }) => {
    await page.addInitScript(() => localStorage.setItem("buzz-thread-placement.v1", "main"));
    await open(page, app);
    await toRoot(page, app);
    await slowThread(page, { first: 1500 }); // the landing waits for the thread's list
    await press(page, "o");
    const tab = page.locator('[data-main-workspace] [role="tab"][data-tab-value^="thread:"]');
    await expect(tab).toHaveCount(1);
    await page.waitForTimeout(300);
    await page.locator('[role="tab"][data-tab-value="conversation"]').click(); // not a key: the message the thread came from gets the cursor
    await page.waitForTimeout(2500); // the landing's time, and the thread's page coming into the tab that is hidden
    const channelList = page.locator('[data-main-workspace] [data-message-scroller][data-channel-timeline="alpha"]');
    await expect(channelList.locator('[data-vim-cursor="main"]')).toHaveAttribute("data-message-id", app.exact.root.id);
    expect(await page.locator("style[data-vim-cursor-style]").getAttribute("data-main-message-id")).toBe(app.exact.root.id);
  });

  test("a held o (its auto-repeats) does not end its own landing", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    await page.keyboard.down("o");
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(90);
      await page.keyboard.down("o"); // the same key still down: an auto-repeat
    }
    await page.keyboard.up("o");
    await expect(threadPane(page)).toBeVisible();
    const list = sideScroller(page);
    await expect.poll(() => cursor(page), { timeout: 10000 }).toBe(app.exact.target.id);
    await expect.poll(() => atEnd(list)).toBe(true);
    await page.waitForTimeout(1500);
    expect(await cursor(page)).toBe(app.exact.target.id);
  });

  // With threads placed over the channel the cursor goes back to the message the thread was opened from whenever the tab stops showing.
  for (const [how, leave] of [
    ["clicking the channel's tab", (page) => page.locator('[role="tab"][data-tab-value="conversation"]').click()],
    [
      "the tab's close button",
      (page) => page.locator('[data-closable="true"]:has([role="tab"][data-tab-value^="thread:"]) button[aria-label^="Close "]').click(),
    ],
    ["Cmd+W (the window event the native menu sends)", (page) => page.evaluate(() => window.dispatchEvent(new Event("buzz:close-active-tab", { cancelable: true })))],
  ]) {
    test(`with threads placed in the main pane: leaving the tab by ${how} gives the cursor back to the message`, async ({ page, app }) => {
      await page.addInitScript(() => localStorage.setItem("buzz-thread-placement.v1", "main"));
      await open(page, app);
      await toRoot(page, app);
      await press(page, "o");
      await expect(page.locator('[data-main-workspace] [role="tab"][data-tab-value^="thread:"]')).toHaveCount(1);
      await expect.poll(() => cursor(page)).toBe(app.exact.target.id);
      await page.waitForTimeout(1200); // the landing has run its course
      await leave(page);
      const mainCursor = () => page.locator("style[data-vim-cursor-style]").getAttribute("data-main-message-id");
      await expect.poll(mainCursor).toBe(app.exact.root.id);
      const channelList = page.locator('[data-main-workspace] [data-message-scroller][data-channel-timeline="alpha"]');
      await expect(channelList.locator('[data-vim-cursor="main"]')).toHaveAttribute("data-message-id", app.exact.root.id);
    });
  }

  // The cursor goes back to the message the thread was opened from, also when the tab is left while the landing still runs (q straight
  // after o) and when the message has no replies, so that the tab's newest message is a copy of the message itself.
  test("with threads placed in the main pane: o, then q while it still lands, leaves the mark on the message the thread was opened from", async ({ page, app }) => {
    await page.addInitScript(() => localStorage.setItem("buzz-thread-placement.v1", "main"));
    await open(page, app);
    await toRoot(page, app);
    await slowThread(page, { first: 1500 }); // the landing has nothing to mark yet when q comes
    const tab = page.locator('[data-main-workspace] [role="tab"][data-tab-value^="thread:"]');
    const channelList = page.locator('[data-main-workspace] [data-message-scroller][data-channel-timeline="alpha"]');
    for (const wait of [0, 250]) {
      await press(page, "o");
      await expect(tab).toHaveCount(1);
      await page.waitForTimeout(wait);
      await press(page, "q"); // while it lands
      await expect(tab).toHaveCount(0);
      await page.waitForTimeout(1300); // longer than the landing's fallback waits for a row
      expect(await cursor(page)).toBe(app.exact.root.id);
      await expect(channelList.locator('[data-vim-cursor="main"]')).toHaveAttribute("data-message-id", app.exact.root.id);
    }
  });

  test("with threads placed in the main pane: o on a message with no replies, then q, leaves that message marked", async ({ page, app }) => {
    await page.addInitScript(() => localStorage.setItem("buzz-thread-placement.v1", "main"));
    await open(page, app);
    const first = (await rowIds(page))[0];
    await press(page, "g", "g");
    await expect.poll(() => cursor(page)).toBe(first);
    await press(page, "o");
    const tab = page.locator('[data-main-workspace] [role="tab"][data-tab-value^="thread:"]');
    await expect(tab).toHaveCount(1);
    await page.waitForTimeout(2500); // the thread is its message alone: the landing marks the tab's copy of it
    await press(page, "q");
    await expect(tab).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await cursor(page)).toBe(first);
    await expect(page.locator('[data-main-workspace] [data-message-scroller][data-channel-timeline="alpha"] [data-vim-cursor="main"]')).toHaveAttribute("data-message-id", first);
  });

  test("with threads placed in the main pane: the tab is at its end with the newest reply under the cursor, and q gives the cursor back to the message", async ({ page, app }) => {
    await page.addInitScript(() => localStorage.setItem("buzz-thread-placement.v1", "main"));
    await open(page, app);
    await toRoot(page, app);
    await press(page, "o");
    const tab = page.locator('[data-main-workspace] [role="tab"][data-tab-value^="thread:"]');
    await expect(tab).toHaveCount(1);
    const list = page.locator("[data-main-workspace] [data-message-scroller] >> visible=true");
    await expect(bar(page)).toContainText("main");
    await expect.poll(() => cursor(page)).toBe(app.exact.target.id);
    await expect.poll(() => atEnd(list)).toBe(true);
    expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(await list.evaluate((el) => el.clientHeight));
    expect(await markedShows(list, "main")).toBe(true);
    await page.waitForTimeout(1000);
    expect(await cursor(page)).toBe(app.exact.target.id);
    expect(await atEnd(list)).toBe(true);
    await expect(list).toBeFocused();
    await press(page, "k");
    await expect.poll(() => cursor(page)).toBe(app.exact.replies.at(-2).id);
    await press(page, "j", "j");
    await expect(replyBox(page)).toBeFocused();
    await press(page, "k", "q");
    await expect(tab).toHaveCount(0);
    await expect(mainScroller(page)).toBeFocused();
    await expect.poll(() => cursor(page)).toBe(app.exact.root.id);
    await expect(mainScroller(page).locator(`[data-vim-cursor="main"]`)).toHaveAttribute("data-message-id", app.exact.root.id);
  });
});

// In a thread, `o` opens and folds the replies to the message under the cursor. The thread of the message with 80 replies has one reply
// that has a reply of its own (the 80th, to the 79th): the 79th has a branch, closed behind a pill at first.
test.describe("o in a thread opens and folds the replies to a message", () => {
  test.use({ exactMessages: "nested" });
  // What the branch of a message looks like: its pill (the host's, only while the branch is closed), the host's state, the plugin's fold,
  // and how many of the replies in it show.
  const branchOf = (scroller, id) =>
    scroller.evaluate((el, id) => {
      const branch = el.querySelector(`[data-message-id="${id}"]`)?.closest("[data-depth]");
      if (!branch) return undefined;
      const replies = [...branch.querySelectorAll(":scope > :last-child [data-message-id]")];
      return {
        pill: !!branch.querySelector(":scope > * > button[data-thread-summary][aria-controls]"),
        open: branch.getAttribute("data-open"),
        fold: branch.getAttribute("data-vim-fold"),
        shown: replies.filter((reply) => reply.getClientRects().length > 0).length,
        count: getComputedStyle(branch, "::after").content,
      };
    }, id);
  const folds = (page) => page.locator("[data-vim-fold]").count();

  // The tests run once in each placement of the thread: beside the channel and over it (a tab).
  for (const placement of ["side", "main"]) {
    test.describe(`thread placed ${placement === "side" ? "beside the channel" : "over the channel"}`, () => {
      const list = (page) => (placement === "side" ? sideScroller(page) : page.locator("[data-main-workspace] [data-message-scroller] >> visible=true"));
      test.beforeEach(async ({ page }) => {
        if (placement === "main") await page.addInitScript(() => localStorage.setItem("buzz-thread-placement.v1", "main"));
      });

      test("o opens the replies of the message under the cursor, and o again folds them, and again opens them", async ({ page, app }) => {
        await open(page, app);
        await toRoot(page, app);
        await press(page, "o"); // in the channel's list: opens the thread, at its end
        const parent = app.exact.replies.at(-2).id; // has the reply of its own
        const child = app.exact.replies.at(-1).id;
        await expect(bar(page)).toContainText(placement);
        // The newest reply that shows is the 79th: its own reply is behind the pill.
        await expect.poll(() => cursor(page)).toBe(parent);
        expect(await branchOf(list(page), parent)).toMatchObject({ pill: true, shown: 0, fold: null });
        // Opened: the reply shows under the message, the pill is gone, the cursor has not moved, the message list has the keys.
        await press(page, "o");
        await expect.poll(() => branchOf(list(page), parent)).toMatchObject({ pill: false, open: "true", shown: 1, fold: null });
        expect(await cursor(page)).toBe(parent);
        await expect(list(page)).toBeFocused();
        await expect(bar(page)).toHaveText(`-- NORMAL --  ${placement}`);
        // Folded: the replies are hidden, a count stands where the pill was, and the cursor has not moved.
        await press(page, "o");
        await expect.poll(() => branchOf(list(page), parent)).toMatchObject({ pill: false, open: "true", shown: 0, fold: "1 reply", count: '"1 reply"' });
        expect(await cursor(page)).toBe(parent);
        expect(await folds(page)).toBe(1);
        // A folded branch is not walked into: j goes past the last message into the reply box, as with nothing below.
        await press(page, "j");
        await expect(replyBox(page)).toBeFocused();
        await press(page, "k");
        await expect.poll(() => cursor(page)).toBe(parent);
        // Opened again: now j walks into the reply.
        await press(page, "o");
        await expect.poll(() => branchOf(list(page), parent)).toMatchObject({ shown: 1, fold: null });
        await press(page, "j");
        await expect.poll(() => cursor(page)).toBe(child);
        // On the reply, which has none of its own, o does nothing.
        await press(page, "o");
        await page.waitForTimeout(300);
        expect(await cursor(page)).toBe(child);
        expect(await folds(page)).toBe(0);
        expect(await branchOf(list(page), parent)).toMatchObject({ shown: 1, fold: null });
      });

      test("o on a message that has no replies, and on the thread's first message, does nothing", async ({ page, app }) => {
        await open(page, app);
        await toRoot(page, app);
        await press(page, "o");
        await expect.poll(() => cursor(page)).toBe(app.exact.replies.at(-2).id);
        await press(page, "k");
        const before = app.exact.replies.at(-3).id;
        await expect.poll(() => cursor(page)).toBe(before);
        await press(page, "o");
        await page.waitForTimeout(300);
        expect(await cursor(page)).toBe(before);
        expect(await folds(page)).toBe(0);
        expect(await branchOf(list(page), app.exact.replies.at(-2).id)).toMatchObject({ pill: true, shown: 0 });
        await expect(bar(page)).toContainText(placement);
        // The first message of the thread is in no branch.
        await press(page, "g", "g");
        await expect.poll(() => cursor(page)).toBe(app.exact.root.id);
        await press(page, "o");
        await page.waitForTimeout(300);
        expect(await cursor(page)).toBe(app.exact.root.id);
        expect(await folds(page)).toBe(0);
        await expect(bar(page)).toContainText(placement);
      });
    });
  }

  // The fold leans on Buzz's markup. Where the stylesheet's rule meets nothing (a host that draws its branches differently), the replies
  // would stay on show with a count under them: the plugin takes its mark off again, and o only ever opens, as before.
  test("fail safe: where the replies do not hide, o leaves the branch open", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    await press(page, "o");
    const parent = app.exact.replies.at(-2).id;
    await expect.poll(() => cursor(page)).toBe(parent);
    await page.addStyleTag({ content: "[data-vim-fold] > :last-child { display: block !important; }" });
    await press(page, "o"); // opens it, as the host does
    await expect.poll(() => branchOf(sideScroller(page), parent)).toMatchObject({ pill: false, shown: 1, fold: null });
    await press(page, "o"); // would fold it: the replies still show, so the mark comes off
    await page.waitForTimeout(500);
    expect(await branchOf(sideScroller(page), parent)).toMatchObject({ open: "true", shown: 1, fold: null });
    expect(await folds(page)).toBe(0);
    expect(await cursor(page)).toBe(parent);
    await press(page, "j"); // the keys still work
    await expect.poll(() => cursor(page)).toBe(app.exact.replies.at(-1).id);
  });

  test("in the channel's list o still opens the thread, also after a thread was closed", async ({ page, app }) => {
    await open(page, app);
    await toRoot(page, app);
    await press(page, "o");
    await expect(threadPane(page)).toBeVisible();
    await press(page, "q");
    await expect(threadPane(page)).toHaveCount(0);
    await expect(bar(page)).toContainText("main");
    await press(page, "o");
    await expect(threadPane(page)).toBeVisible();
    await expect(bar(page)).toContainText("side");
    await expect.poll(() => cursor(page)).toBe(app.exact.replies.at(-2).id);
  });
});

// With threads placed over the channel, the row the cursor goes back to shows, not only is marked: the channel's list comes back at its
// bottom, which leaves an older message far above the view.
const channelRowShows = (page) =>
  page.evaluate(() => {
    const list = document.querySelector('[data-main-workspace] [data-message-scroller][data-channel-timeline="alpha"]');
    const row = list?.querySelector('[data-vim-cursor="main"]');
    if (!list || !row) return false;
    const edge = list.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    return box.top >= edge.top - 1 && box.bottom <= edge.bottom + 1;
  });
// The ways out of a thread tab.
const LEAVES = [
  ["q", (page) => press(page, "q")],
  ["a click on the channel's tab", (page) => page.locator('[role="tab"][data-tab-value="conversation"]').click()],
  ["the tab's close button", (page) => page.locator('[data-closable="true"]:has([role="tab"][data-tab-value^="thread:"]) button[aria-label^="Close "]').click()],
];
const mainCursorId = (page) => page.locator("style[data-vim-cursor-style]").getAttribute("data-main-message-id");
// A message with no replies: the thread's newest message is a copy of it, so the cursor's id is in the channel's rows when the tab goes.
test.describe("with threads over a long channel: the row the cursor goes back to shows", () => {
  test.use({ historyCounts: { alpha: 200, beta: 3 } });
  for (const [how, leave] of LEAVES) {
    test(`o on an older message, then ${how}: that row is marked and in view`, async ({ page, app }) => {
      await page.addInitScript(() => localStorage.setItem("buzz-thread-placement.v1", "main"));
      await open(page, app);
      await press(page, "Escape", "k"); // out of the box: the newest message
      await expect.poll(() => cursor(page)).toBeDefined();
      for (let i = 0; i < 12; i++) await press(page, "k"); // a few rows above the newest, beyond what the list shows when it comes back at its bottom
      await page.waitForTimeout(500); // the list follows the cursor
      const older = await cursor(page);
      await press(page, "o");
      const tab = page.locator('[data-main-workspace] [role="tab"][data-tab-value^="thread:"]');
      await expect(tab).toHaveCount(1);
      await page.waitForTimeout(1500); // the thread has landed
      await leave(page);
      await expect.poll(() => mainCursorId(page)).toBe(older);
      await expect.poll(() => channelRowShows(page), { timeout: 3000 }).toBe(true);
    });
  }
});
// A message that has replies (the third from the top, with 80): the thread's newest message is a reply, which the channel's list does not
// have, so the cursor goes back to the message the thread was opened from, by the other path of `cursorBack`.
test.describe("with threads over a channel that scrolls, on a message that has replies: the row the cursor goes back to shows", () => {
  test.use({ exactMessages: true, historyCounts: { alpha: 16, beta: 3 } });
  for (const [how, leave] of LEAVES) {
    test(`o on the message with the long thread, then ${how}: that row is marked and in view`, async ({ page, app }) => {
      await page.addInitScript(() => localStorage.setItem("buzz-thread-placement.v1", "main"));
      await open(page, app);
      await press(page, "g", "g"); // the top of the list: the root is the third message
      await page.waitForTimeout(800);
      for (let i = 0; i < 12 && (await mainCursorId(page)) !== app.exact.root.id; i++) {
        await press(page, "j");
        await page.waitForTimeout(100);
      }
      expect(await mainCursorId(page)).toBe(app.exact.root.id);
      await press(page, "o");
      const tab = page.locator('[data-main-workspace] [role="tab"][data-tab-value^="thread:"]');
      await expect(tab).toHaveCount(1);
      await expect.poll(() => mainCursorId(page), { timeout: 10000 }).toBe(app.exact.target.id); // the thread's newest reply
      await page.waitForTimeout(800);
      await leave(page);
      await expect.poll(() => mainCursorId(page)).toBe(app.exact.root.id);
      await expect.poll(() => channelRowShows(page), { timeout: 3000 }).toBe(true);
    });
  }
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

  test("h at the very start and l at the very end of a draft go one pane left or right: the thread's box, the channel's box, the channel list", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await openThreadBeside(page);
    await press(page, "i");
    await page.keyboard.type("reply text");
    await press(page, "Escape");
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
    await press(page, "0", "h"); // the very start of the thread's draft: the channel's box, to its left
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
    // The thread is the rightmost pane: nothing lies to its right, so l stays where it is (it used to jump back).
    await press(page, "$", "l");
    await expect(replyBox(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
    // The editor puts its own selection back a moment after one moves (see the note above): a 0 sent at once can be undone.
    await page.waitForTimeout(250);
    await press(page, "0", "h"); // left again: the channel's box, at the end of its draft
    await expect(composer(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await press(page, "x"); // the caret really is on the last character
    await expect.poll(() => draft(page, "Alpha")).toBe("hell");
    await page.waitForTimeout(250); // as above: the editor restores its selection after an edit
    // Left once more: the channel list, as h does from the message list. It used to go back to the thread's box.
    await press(page, "0", "h");
    await expect(bar(page)).toHaveText("-- NORMAL --  sidebar");
    await expect(page.locator("button[data-channel-id]:focus")).toContainText("Alpha");
    await expect(composer(page)).not.toBeFocused();
    await expect.poll(() => draft(page, "Alpha")).toBe("hell");
    await expect.poll(() => replyBox(page).evaluate((el) => el.textContent)).toBe("reply text");
  });

  for (const tabCount of [1, 2, 3]) {
    test(`with ${tabCount} thread tab${tabCount > 1 ? "s" : ""} open, h from the channel's box goes to the channel list whichever pane the cursor came from, and l from the thread's box stays`, async ({
      page,
      app,
    }) => {
      await open(page, app);
      const tabs = page.locator('[data-panel-workspace] [role="tab"][data-tab-value^="thread:"]');
      await openThreadBeside(page);
      for (let count = 2; count <= tabCount; count++) {
        await press(page, "h", "k", "o"); // from the channel's list one message further up, a new thread tab
        await expect(tabs).toHaveCount(count);
      }
      await press(page, "i");
      await expect(replyBox(page)).toBeFocused();
      await press(page, "Escape");
      await expect(bar(page)).toHaveText("-- NORMAL --  side");
      await press(page, "h"); // left from the thread's box: the channel's box
      await expect(composer(page)).toBeFocused();
      await expect(bar(page)).toHaveText("-- NORMAL --  main");
      await press(page, "h"); // left again: the channel list, not back to the thread's box
      await expect(bar(page)).toHaveText("-- NORMAL --  sidebar");
      await expect(page.locator("button[data-channel-id]:focus")).toContainText("Alpha");
      await expect(replyBox(page)).not.toBeFocused();
      // Right: from the channel's box to the thread's (the tab that shows), and no further.
      await composer(page).click();
      await press(page, "Escape");
      await expect(bar(page)).toHaveText("-- NORMAL --  main");
      await press(page, "l");
      await expect(replyBox(page)).toBeFocused();
      await expect(bar(page)).toHaveText("-- NORMAL --  side");
      await press(page, "l");
      await expect(replyBox(page)).toBeFocused();
      await expect(bar(page)).toHaveText("-- NORMAL --  side");
    });
  }

  test("with no thread open, h at the very start of the channel's draft reaches the channel list and l at the very end stays", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("abc");
    await press(page, "Escape");
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await press(page, "l"); // on the last character; there is no pane to the right
    await expect(composer(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await press(page, "0", "h");
    await expect(bar(page)).toHaveText("-- NORMAL --  sidebar");
    await expect(page.locator("button[data-channel-id]:focus")).toContainText("Alpha");
    await expect.poll(() => draft(page, "Alpha")).toBe("abc");
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

  test("in a NORMAL message box h and l go by position too: with a thread open h from the channel's box reaches the channel list and l from the thread's box stays", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await openThreadBeside(page);
    await press(page, "i");
    await press(page, "Escape");
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
    await leader(page, "l"); // the thread is the rightmost pane
    await expect(replyBox(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
    await leader(page, "h");
    await expect(composer(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await leader(page, "h"); // left of the channel's box is the channel list, not the thread's box
    await expect(bar(page)).toHaveText("-- NORMAL --  sidebar");
    await expect(composer(page)).not.toBeFocused();
    await expect(replyBox(page)).not.toBeFocused();
  });

  test("in a NORMAL message box it works too: h and l go to the box of the pane beside it, q closes the thread", async ({
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
    test(`gi ga gr gw gv gt gs gp and gm work from ${place}`, async ({ page, app }) => {
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
      // gp: Settings on Manage plugins, and nothing typed into a box.
      await enter(page, place);
      const draftBefore = inBox ? await composer(page).evaluate((el) => el.textContent) : "";
      await press(page, "g", "p");
      await expect(settings(page), `gp from ${place}`).toBeVisible();
      await expect(settings(page).locator('nav[aria-label="Settings sections"] [aria-current]')).toHaveText("Manage plugins");
      await closeSettings(page);
      await expect(settings(page)).toHaveCount(0);
      if (inBox) expect(await composer(page).evaluate((el) => el.textContent)).toBe(draftBefore);
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
    await press(page, "j"); // the first control of the section takes the focus (a section with none scrolls)
    await expect(detail(page)).not.toBeFocused();
    await expect(detail(page).locator(":focus")).toHaveCount(1);
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

  test("in Manage plugins, l goes into the section and j and k walk the cards and their buttons; h comes back, Esc closes", async ({ page, app }) => {
    await open(page, app);
    await press(page, "g", "p");
    await expect(section(page, "Manage plugins")).toHaveAttribute("aria-current", "page");
    await press(page, "j"); // from the close button into the list, on the open section
    await expect(section(page, "Manage plugins")).toBeFocused();
    await press(page, "l"); // into the section
    await expect(detail(page)).toBeFocused();
    const button = (name) => detail(page).getByRole("button", { name, exact: true });
    await press(page, "j"); // the first control; a disabled one ("Required") is skipped, as Tab skips it
    await expect(button("View Channels details")).toBeFocused();
    await press(page, "j");
    await expect(button("View Agents details")).toBeFocused();
    await press(page, "j");
    await expect(button("Disable Agents")).toBeFocused();
    await press(page, "j", "j");
    await expect(button("Disable Profiles")).toBeFocused();
    await press(page, "k");
    await expect(button("View Profiles details")).toBeFocused();
    await press(page, "k", "k", "k");
    await expect(button("View Channels details")).toBeFocused();
    await press(page, "k"); // nothing before the first control: the focus stays
    await expect(button("View Channels details")).toBeFocused();
    // Down through the rest of the section: the tab list, the search box, the plugin rows and their buttons, to the last control.
    for (let i = 0; i < 5; i++) await press(page, "j");
    await expect(detail(page).getByRole("tab", { name: "All plugins", exact: true })).toBeFocused();
    await press(page, "j");
    await expect(detail(page).getByRole("searchbox")).toBeFocused();
    // The search box keeps its keys: j types.
    await page.keyboard.type("jk");
    await expect(detail(page).getByRole("searchbox")).toHaveValue("jk");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    // Tab leaves the box, and j walks on from there.
    await press(page, "Tab");
    await press(page, "j");
    await expect(detail(page).locator(":focus")).toHaveCount(1);
    await press(page, "h"); // back to the list, on the open section
    await expect(section(page, "Manage plugins")).toBeFocused();
    await press(page, "l");
    await expect(detail(page)).toBeFocused();
    await press(page, "j");
    await expect(button("View Channels details")).toBeFocused();
    // Nothing reached the page behind the dialog, and Esc closes Settings as it always did.
    expect(await cursor(page)).toBeUndefined();
    await press(page, "Escape");
    await expect(dialog(page)).toHaveCount(0);
  });

  test("Enter presses a switch; a shut menu button lets j and k move on", async ({ page, app }) => {
    await open(page, app);
    await press(page, "g", "s");
    await selectSettingsSection(page, "Notifications"); // a click: the focus is on its button in the list
    await expect(section(page, "Notifications")).toBeFocused();
    await press(page, "l"); // into the section ...
    await expect(detail(page)).toBeFocused();
    await press(page, "j"); // ... onto its first control: the first switch
    const first = detail(page).locator(":focus");
    await expect(first).toHaveCount(1);
    const state = () => first.evaluate((el) => el.checked ?? el.getAttribute("aria-checked"));
    const before = await state();
    await press(page, "Enter");
    await expect.poll(state).not.toBe(before);
    await press(page, "Enter");
    await expect.poll(state).toBe(before);
    // A menu button: reach one (Direct messages, a select in this section) and move on past it.
    const menu = detail(page).getByRole("combobox").first();
    await menu.focus();
    await press(page, "j");
    await expect(menu).not.toBeFocused();
    await expect(detail(page).locator(":focus")).toHaveCount(1);
    await expect(page.getByRole("listbox")).toHaveCount(0); // j opened nothing
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

// ---- Ctrl-e and Ctrl-y: scroll the view a line, the cursor stays ---------------------------------------
test.describe("Ctrl-e and Ctrl-y scroll the view a line at a time", () => {
  test.use({ viewport: { width: 1200, height: 360 } });
  const lineOf = (loc) =>
    loc.evaluate((el) => {
      const style = getComputedStyle(el);
      const lh = parseFloat(style.lineHeight);
      return Math.max(1, Math.round(Number.isFinite(lh) ? lh : (parseFloat(style.fontSize) || 16) * 1.5));
    });
  const top = (loc) => loc.evaluate((el) => Math.round(el.scrollTop));
  const ctrl = (page, key, ...before) => press(page, ...before, `Control+${key}`);
  // The ids of the message rows that show whole in the list, top to bottom (those that show at all when none does).
  const shown = (page, scroller = mainScroller(page)) =>
    scroller.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const rows = [...el.querySelectorAll("[data-message-id]")].filter(
        (row) => !row.hasAttribute("data-membership-row") && !row.parentElement?.closest("[data-message-id]") && row.getBoundingClientRect().height > 0,
      );
      const whole = rows.filter((row) => row.getBoundingClientRect().top >= box.top && row.getBoundingClientRect().bottom <= box.bottom);
      const some = rows.filter((row) => row.getBoundingClientRect().bottom > box.top && row.getBoundingClientRect().top < box.bottom);
      return (whole.length ? whole : some).map((row) => row.dataset.messageId);
    });
  // The one area of the page that scrolls (outside the channel list and any dialog), marked so a test can find it again.
  const pageScroller = async (page) => {
    await page.evaluate(() => {
      document.querySelectorAll("[data-test-scroller]").forEach((el) => el.removeAttribute("data-test-scroller"));
      const found = [...document.body.querySelectorAll("*")]
        .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.clientHeight >= 40 && el.scrollHeight > el.clientHeight + 1)
        .filter((el) => !el.closest('nav[aria-label="Subscribed channels"]') && !el.closest('[role="dialog"]'))
        .sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0];
      found?.setAttribute("data-test-scroller", "");
    });
    return page.locator("[data-test-scroller]");
  };
  const channelNav = (page) => page.getByRole("navigation", { name: "Subscribed channels", exact: true });

  test("in the message list the view moves a line and the cursor stays; a count moves more; the cursor follows only when it would leave the view", async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width: 1200, height: 460 });
    await open(page, app);
    const list = mainScroller(page);
    const line = await lineOf(list);
    // A cursor that was never placed is not placed by scrolling.
    const first = await top(list);
    expect(first).toBeGreaterThan(5 * line);
    await ctrl(page, "y");
    await expect.poll(() => top(list)).toBe(first - line);
    expect(await cursor(page)).toBeUndefined();
    await ctrl(page, "e");
    await expect.poll(() => top(list)).toBe(first);
    await press(page, "k", "k");
    const target = await cursor(page);
    const bottom = await top(list);
    await ctrl(page, "y"); // the content goes down a line: the view is a line higher
    await expect.poll(() => top(list)).toBe(bottom - line);
    expect(await cursor(page)).toBe(target);
    await ctrl(page, "e");
    await expect.poll(() => top(list)).toBe(bottom);
    await press(page, "3", "Control+y"); // a count
    await expect.poll(() => top(list)).toBe(bottom - 3 * line);
    expect(await cursor(page)).toBe(target);
    await ctrl(page, "e", "2");
    await expect.poll(() => top(list)).toBe(bottom - line);
    // Far up: the cursor row left the view, so the cursor goes to the last row that still shows.
    await press(page, "9", "9", "Control+y");
    await expect.poll(() => top(list)).toBeLessThan(3 * line); // the top (the host may nudge it when it loads older history)
    await expect.poll(async () => (await shown(page)).at(-1) === (await cursor(page))).toBe(true);
    expect(await cursor(page)).not.toBe(target);
    // A line down keeps it; far down takes it to the first row that shows.
    const parked = await cursor(page);
    const atTop = await top(list);
    await ctrl(page, "e");
    await expect.poll(() => top(list)).toBe(atTop + line);
    expect(await cursor(page)).toBe(parked);
    await press(page, "9", "9", "Control+e");
    await expect.poll(() => top(list)).toBeGreaterThan(bottom - 2 * line);
    await expect.poll(async () => (await shown(page))[0] === (await cursor(page))).toBe(true);
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
  });

  test("in the thread pane it scrolls the thread's list and leaves the channel's alone", async ({ page, app }) => {
    await page.setViewportSize({ width: 1200, height: 300 });
    await open(page, app);
    await openThreadBeside(page);
    const list = sideScroller(page);
    const line = await lineOf(list);
    expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(3 * line);
    await page.waitForTimeout(600); // the channel's list settles after the pane opened beside it
    const channelTop = await top(mainScroller(page));
    const start = await top(list); // the thread opens near its end
    const target = await cursor(page);
    await ctrl(page, "y");
    await expect.poll(() => top(list)).toBe(start - line);
    await press(page, "2", "Control+y");
    await expect.poll(() => top(list)).toBe(start - 3 * line);
    await ctrl(page, "e");
    await expect.poll(() => top(list)).toBe(start - 2 * line);
    expect(await cursor(page)).toBe(target);
    expect(await top(mainScroller(page))).toBe(channelTop);
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
  });

  test("in the channel list it scrolls the list, and the focus moves only when its row would leave the view", async ({ page, app }) => {
    await open(page, app);
    await press(page, "h");
    await expect(bar(page)).toHaveText("-- NORMAL --  sidebar");
    const nav = channelNav(page);
    const line = await lineOf(nav);
    expect(await nav.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(2 * line);
    const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim());
    const shownFocus = () =>
      nav.evaluate((el) => {
        const row = document.activeElement;
        if (!row || !el.contains(row)) return false;
        const a = row.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        return a.bottom > b.top && a.top < b.bottom;
      });
    const start = await top(nav);
    const first = await focused();
    expect(first).toContain("Alpha");
    await ctrl(page, "y");
    await expect.poll(() => top(nav)).toBe(start - line);
    expect(await focused()).toBe(first);
    await ctrl(page, "e");
    await expect.poll(() => top(nav)).toBe(start);
    // Far up the row of the open channel is out of the view: the focus goes to a row that shows.
    await press(page, "9", "9", "Control+y");
    await expect.poll(() => top(nav)).toBe(0);
    await expect.poll(shownFocus).toBe(true);
    expect(await focused()).not.toBe(first);
    await press(page, "9", "9", "Control+e");
    await expect.poll(async () => (await top(nav)) > 0).toBe(true);
    await expect.poll(shownFocus).toBe(true);
    await expect(bar(page)).toHaveText("-- NORMAL --  sidebar");
  });

  // Pages with a list of their own. The fixture has no reminders and no workflows, so those two pages are given a
  // tall element to scroll; Agents and Inbox scroll their own lists.
  for (const [keys, name] of [
    ["a", "Agents"],
    ["i", "Inbox"],
  ]) {
    test(`on the ${name} page, with the focus in the channel list, it scrolls the page's list`, async ({ page, app }) => {
      await page.setViewportSize({ width: 1200, height: 300 });
      await open(page, app);
      await press(page, "h", "g", keys);
      await expect(page.getByRole("tab", { name, exact: true }).first()).toHaveAttribute("aria-selected", "true");
      await expect.poll(async () => (await pageScroller(page)).count()).toBe(1);
      const area = await pageScroller(page);
      const line = await lineOf(area);
      const navTop = await top(channelNav(page));
      await ctrl(page, "e");
      await expect.poll(() => top(area)).toBe(line);
      await press(page, "2", "Control+e");
      await expect.poll(() => top(area)).toBe(3 * line);
      await ctrl(page, "y");
      await expect.poll(() => top(area)).toBe(2 * line);
      expect(await top(channelNav(page))).toBe(navTop);
    });
  }

  test("on the Workflows page it scrolls the page's body", async ({ page, app }) => {
    await page.setViewportSize({ width: 1200, height: 300 });
    await open(page, app);
    await press(page, "h", "g", "w");
    await expect(page.getByRole("tab", { name: "Workflows", exact: true })).toHaveAttribute("aria-selected", "true");
    const body = page.locator(".workflows-body");
    await expect(body).toBeVisible();
    await body.evaluate((el) => {
      const spacer = document.createElement("div");
      spacer.style.height = "1500px";
      el.append(spacer);
    });
    const line = await lineOf(body);
    await ctrl(page, "e");
    await expect.poll(() => top(body)).toBe(line);
    await press(page, "4", "Control+e");
    await expect.poll(() => top(body)).toBe(5 * line);
    await press(page, "9", "9", "Control+y");
    await expect.poll(() => top(body)).toBe(0);
  });

  test("on the Reminders page it scrolls the page", async ({ page, app }) => {
    await page.setViewportSize({ width: 1200, height: 300 });
    await open(page, app);
    await press(page, "h", "g", "r");
    await expect(page.getByRole("tab", { name: "Reminders", exact: true })).toHaveAttribute("aria-selected", "true");
    // The page's root clips its content; let it scroll, and give it something tall.
    const root = page.getByText("Connect to a community to see your reminders.").locator("xpath=ancestor::*[@data-buzz-ui][1]");
    await root.evaluate((el) => {
      el.style.overflowY = "auto";
      const spacer = document.createElement("div");
      spacer.style.cssText = "height: 1500px; flex: none";
      el.append(spacer);
    });
    const line = await lineOf(root);
    await ctrl(page, "e");
    await expect.poll(() => top(root)).toBe(line);
    await press(page, "3", "Control+e");
    await expect.poll(() => top(root)).toBe(4 * line);
    await ctrl(page, "y");
    await expect.poll(() => top(root)).toBe(3 * line);
  });

  test.describe("in the Settings dialog", () => {
    const dialog = (page) => page.getByRole("dialog", { name: "Settings", exact: true });
    const sections = (page) => dialog(page).getByRole("navigation", { name: "Settings sections", exact: true });
    const section = (page, name) => sections(page).getByRole("button", { name, exact: true });

    test("it scrolls the list of sections when that has the keys, and the open section when that has", async ({ page, app }) => {
      await open(page, app);
      await press(page, "g", "s");
      await expect(dialog(page)).toBeVisible();
      await press(page, "j"); // from the close button into the list, on Profile
      await expect(section(page, "Profile")).toBeFocused();
      const nav = sections(page);
      const line = await lineOf(nav);
      expect(await nav.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(3 * line);
      await ctrl(page, "e");
      await expect.poll(() => top(nav)).toBe(line);
      await press(page, "2", "Control+e");
      await expect.poll(() => top(nav)).toBe(3 * line);
      await ctrl(page, "y");
      await expect.poll(() => top(nav)).toBe(2 * line);
      await expect(section(page, "Profile")).toHaveAttribute("aria-current", "page"); // nothing opened or changed
      // Far down the focused section is out of the view: the focus goes to a section that shows.
      await press(page, "9", "9", "Control+e");
      await expect.poll(() => nav.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2)).toBe(true);
      await expect(section(page, "Profile")).not.toBeFocused();
      await expect
        .poll(() =>
          nav.evaluate((el) => {
            const row = document.activeElement;
            if (!row || !el.contains(row)) return false;
            const a = row.getBoundingClientRect();
            const b = el.getBoundingClientRect();
            return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
          }),
        )
        .toBe(true);
      await expect(section(page, "Profile")).toHaveAttribute("aria-current", "page");
      await press(page, "9", "9", "Control+y");
      await expect.poll(() => top(nav)).toBe(0);
      // Into the open section: the detail scrolls.
      await section(page, "Profile").focus();
      await press(page, "l");
      const content = dialog(page).locator("#settings-content");
      await expect(content).toBeFocused();
      await content.evaluate((el) => {
        document.querySelectorAll("[data-test-scroller]").forEach((x) => x.removeAttribute("data-test-scroller"));
        const above = [];
        for (let node = el; node && node.getAttribute("role") !== "dialog"; node = node.parentElement) above.push(node);
        [...above, ...el.querySelectorAll("*")]
          .find((x) => /auto|scroll/.test(getComputedStyle(x).overflowY) && x.scrollHeight > x.clientHeight + 1)
          ?.setAttribute("data-test-scroller", "");
      });
      const detail = page.locator("[data-test-scroller]");
      await expect(detail).toHaveCount(1);
      const navTop = await top(nav);
      // (j and k no longer scroll the section when it has controls: they move the focus from one to the next, and the section follows.)
      await ctrl(page, "e");
      await expect.poll(() => top(detail)).toBe(line);
      await press(page, "3", "Control+e");
      await expect.poll(() => top(detail)).toBe(4 * line);
      await ctrl(page, "y");
      await expect.poll(() => top(detail)).toBe(3 * line);
      expect(await top(nav)).toBe(navTop);
      await closeSettings(page);
    });
  });

  test("in the message box it scrolls the pane's messages in NORMAL and is left alone in INSERT; e and y keep their meaning", async ({ page, app }) => {
    await open(page, app);
    const list = mainScroller(page);
    const line = await lineOf(list);
    await composer(page).click();
    await page.keyboard.type("ab cd ef");
    const start = await top(list);
    await expect(bar(page)).toContainText("INSERT");
    await ctrl(page, "y"); // INSERT: the editor keeps the key
    await page.waitForTimeout(400);
    expect(await top(list)).toBe(start);
    await expect.poll(() => draft(page)).toBe("ab cd ef");
    await press(page, "Escape");
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await ctrl(page, "y");
    await expect.poll(() => top(list)).toBe(start - line);
    await press(page, "3", "Control+y");
    await expect.poll(() => top(list)).toBe(start - 4 * line);
    await ctrl(page, "e");
    await expect.poll(() => top(list)).toBe(start - 3 * line);
    await expect(composer(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await expect.poll(() => draft(page)).toBe("ab cd ef");
    // Plain e is still the end of a word, and the caret was not moved by the scrolling: x takes the character it is on.
    await press(page, "0", "e", "Control+e", "x");
    await expect.poll(() => draft(page)).toBe("a cd ef");
    // Visual mode: a scroll leaves the highlight, and y still yanks it (and ends visual mode).
    await press(page, "0", "v", "e", "Control+y");
    await expect(bar(page)).toContainText("VISUAL");
    expect(await page.evaluate(() => document.getSelection().toString())).toBe("a cd"); // e from a one-letter word: the next word's end
    await press(page, "y");
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await expect.poll(() => draft(page)).toBe("a cd ef");
  });

  test("with the platform reported as a Mac it is the Control key, not Command", async ({ page, app }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel", configurable: true });
    });
    await open(page, app);
    const list = mainScroller(page);
    const line = await lineOf(list);
    await press(page, "k");
    const bottom = await top(list);
    await press(page, "Meta+y");
    await page.waitForTimeout(400);
    expect(await top(list)).toBe(bottom);
    await ctrl(page, "y");
    await expect.poll(() => top(list)).toBe(bottom - line);
    await ctrl(page, "e");
    await expect.poll(() => top(list)).toBe(bottom);
  });

  test("the key list names the two keys, and in the help dialog they scroll a line", async ({ page, app }) => {
    await open(page, app);
    await page.keyboard.down("Shift");
    await page.keyboard.press("?");
    await page.keyboard.up("Shift");
    const help = page.getByRole("dialog", { name: "Vim keys", exact: true });
    await expect(help).toBeVisible();
    await expect(help).toContainText(/Ctrl-e\s+Ctrl-y/);
    const line = await lineOf(help);
    await ctrl(page, "e");
    await expect.poll(() => top(help)).toBe(line);
    await ctrl(page, "y");
    await expect.poll(() => top(help)).toBe(0);
    await press(page, "q");
    await expect(help).toHaveCount(0);
  });
});

// ---- Mention chips in the draft ---------------------------------------------------------------------
// A mention is a chip: an element with contenteditable="false", one unit to the editor. A caret inside it is not drawn
// and nothing can be typed there (a Mac's WKWebView does not recover from it, Chromium does), so the plugin must only
// ever put the caret beside a chip. The tests look at where the caret is, which is what differs between engines.
test.describe("a mention chip in the draft", () => {
  const chip = (page, box = composer(page)) => box.locator('[contenteditable="false"]');
  // Types `before`, picks "Fixture Reader" from the @ list (a chip, then a space), then drops that space unless `keepSpace`.
  const mentionIn = async (page, before = "", { keepSpace = false } = {}) => {
    await composer(page).click();
    if (before) await page.keyboard.type(before);
    await page.keyboard.type("@");
    const option = page.getByRole("option", { name: /Fixture Reader/ });
    await expect(option).toBeVisible();
    await press(page, "Enter"); // picks the person in the open list (nothing is sent)
    await expect(chip(page)).toHaveCount(1);
    await expect(option).toHaveCount(0);
    if (!keepSpace) await press(page, "Backspace");
  };
  // Where the caret is: inside a chip, and the text on both sides of it.
  const caret = (page) =>
    page.evaluate(() => {
      const selection = document.getSelection();
      const node = selection.anchorNode;
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      const box = document.querySelector('[aria-label="Message #Alpha"]');
      const range = document.createRange();
      range.selectNodeContents(box);
      if (node) range.setEnd(node, selection.anchorOffset);
      return {
        inChip: !!el?.closest('[contenteditable="false"]'),
        focused: document.activeElement === box,
        before: range.toString(),
        collapsed: selection.isCollapsed,
      };
    });
  // The editor puts its own selection back about 20 ms after the box gains focus and the plugin places its caret again
  // at 80 ms (see enterBox), so look once the box has settled, not at the first sample that happens to be fine.
  const expectBesideChip = async (page) => {
    await page.waitForTimeout(300);
    const where = await caret(page);
    expect(where.focused).toBe(true);
    expect(where.inChip).toBe(false);
  };
  // Out of the box upwards, with the cursor on the newest message (placed a frame later).
  const leaveUp = async (page) => {
    await press(page, "Escape", "k");
    await expect(mainScroller(page)).toBeFocused();
    await expect.poll(() => cursor(page)).toBeTruthy();
  };

  test("a chip alone: j into the box puts the caret beside it, and i then types", async ({ page, app }) => {
    await open(page, app);
    await mentionIn(page);
    await leaveUp(page);
    await press(page, "j"); // back into the box in NORMAL, at the start of the draft
    await expect(composer(page)).toBeFocused();
    await expectBesideChip(page);
    expect((await caret(page)).before).toBe(""); // before the chip
    await press(page, "i");
    await expect(bar(page)).toContainText("INSERT");
    await expectBesideChip(page);
    await page.keyboard.type("ZZ");
    await expect.poll(() => draft(page)).toBe("ZZ@Fixture Reader");
    await expectBesideChip(page);
  });

  test("a chip at the start of the draft, text after it", async ({ page, app }) => {
    await open(page, app);
    await mentionIn(page, "", { keepSpace: true });
    await page.keyboard.type("tail");
    await leaveUp(page);
    await press(page, "j");
    await expect(composer(page)).toBeFocused();
    await expectBesideChip(page);
    expect((await caret(page)).before).toBe("");
    await press(page, "i");
    await page.keyboard.type("ZZ");
    await expect.poll(() => draft(page)).toBe("ZZ@Fixture Reader tail");
    // Esc, two characters right onto the chip, then a: typing goes after the chip, not into it.
    await press(page, "Escape", "0", "l", "l", "a");
    await expectBesideChip(page);
    await page.keyboard.type("Q");
    await expect.poll(() => draft(page)).toBe("ZZ@Fixture ReaderQ tail");
  });

  test("a chip at the end of the draft: entered from the thread's box, the caret is beside it and i types", async ({ page, app }) => {
    await open(page, app);
    await mentionIn(page, "hi ");
    await leaveUp(page);
    await press(page, "o"); // a thread beside the channel
    await expect(threadPane(page)).toBeVisible();
    await press(page, "i");
    await expect(replyBox(page)).toBeFocused();
    await press(page, "Escape", "h"); // left from the thread's box: the channel's box, at the end of its draft
    await expect(composer(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await expectBesideChip(page);
    await press(page, "i");
    await expectBesideChip(page);
    await page.keyboard.type("ZZ");
    await expect.poll(() => draft(page)).toBe("hi @Fixture ReaderZZ");
  });

  test("a chip in the middle: motions walk over it, the caret is never inside it, and i types beside it", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("ab ");
    await mentionIn(page, "", { keepSpace: true }); // clicking the box again keeps the caret where it is
    await page.keyboard.type("cd");
    await press(page, "Escape", "0");
    await expect(bar(page)).toContainText("NORMAL");
    // l walks a, b, the space, the chip (one step), the space, c; the chip is neither the end nor the start of the draft,
    // so neither h nor l leaves the box on account of it.
    const seen = [];
    for (const key of ["l", "l", "l", "l", "l", "l", "h", "h", "h", "h", "l", "l", "l", "l", "w", "w", "b", "b", "e", "e", "$", "h", "h", "h", "h", "0"]) {
      await press(page, key);
      await page.waitForTimeout(60);
      const where = await caret(page);
      seen.push(where.before);
      expect(where.inChip, `after ${key}`).toBe(false);
      expect(where.focused, `after ${key}`).toBe(true);
      await expect(bar(page)).toHaveText("-- NORMAL --  main");
    }
    // Six steps right put the cursor on c, past the chip; four back put it on the first space again.
    expect(seen.slice(0, 6)).toEqual(["a", "ab", "ab ", "ab @Fixture Reader", "ab @Fixture Reader ", "ab @Fixture Reader c"]);
    await press(page, "f", "c");
    await expect.poll(async () => (await caret(page)).before).toBe("ab @Fixture Reader ");
    await press(page, "i");
    await expectBesideChip(page);
    await page.keyboard.type("Z");
    await expect.poll(() => draft(page)).toBe("ab @Fixture Reader Zcd");
  });

  test("x on a chip takes it whole, and the caret stays beside what is left", async ({ page, app }) => {
    await open(page, app);
    await composer(page).click();
    await page.keyboard.type("ab ");
    await mentionIn(page, "", { keepSpace: true });
    await page.keyboard.type("cd");
    await press(page, "Escape", "0", "l", "l", "l"); // a, b, the space: the cursor is on the chip
    await page.waitForTimeout(250);
    await press(page, "x");
    await expect.poll(() => draft(page)).toBe("ab  cd");
    await expect(chip(page)).toHaveCount(0);
    await expectBesideChip(page);
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
  });

  // ---- A run of mentions at the start or the end of the draft is skipped as a whole on the way out ----------------
  // Each mention is a chip and the space the host puts after it. h from just right of a leading run, or from inside it,
  // leaves the box as h at the start does (no stop on the chips); l does the same for a trailing run when a pane lies to
  // the right; a chip with text before it (leading) or after it (trailing) keeps the one-character steps.
  const mentionsIn = async (page, count, { before = "", after = "" } = {}) => {
    await composer(page).click();
    if (before) await page.keyboard.type(before);
    for (let i = 1; i <= count; i++) {
      await page.keyboard.type("@");
      const option = page.getByRole("option", { name: /Fixture Reader/ });
      await expect(option).toBeVisible();
      await press(page, "Enter");
      await expect(chip(page)).toHaveCount(i);
      await expect(option).toHaveCount(0);
    }
    if (after) await page.keyboard.type(after);
  };
  const stays = async (page, label = "-- NORMAL --  main") => {
    await page.waitForTimeout(150);
    await expect(bar(page)).toHaveText(label);
    expect((await caret(page)).focused).toBe(true);
  };
  const leaves = async (page) => {
    await expect(bar(page)).toHaveText("-- NORMAL --  sidebar");
    await expect(composer(page)).not.toBeFocused();
  };

  test("one leading mention: h from just right of it goes straight to the channel list", async ({ page, app }) => {
    await open(page, app);
    await mentionsIn(page, 1);
    await press(page, "Escape"); // the caret steps back onto the space after the chip
    await page.waitForTimeout(250);
    await expect(bar(page)).toHaveText("-- NORMAL --  main");
    await press(page, "h");
    await leaves(page);
    await expect.poll(() => draft(page)).toBe("@Fixture Reader "); // nothing was changed
  });

  for (const [steps, where] of [
    [7, "just right of the run (on the last space)"],
    [4, "inside the run, on the third chip"],
    [3, "inside the run, on a space between two chips"],
    [1, "on the space after the first chip"],
  ]) {
    test(`four leading mentions: h ${where} leaves the box`, async ({ page, app }) => {
      await open(page, app);
      await mentionsIn(page, 4);
      await press(page, "Escape", "0");
      for (let i = 0; i < steps; i++) await press(page, "l");
      await page.waitForTimeout(250);
      await stays(page); // walking right over the chips never leaves
      await press(page, "h");
      await leaves(page);
    });
  }

  test("0 goes before a leading mention, not after it, and i there types before it", async ({ page, app }) => {
    await open(page, app);
    await mentionsIn(page, 1, { after: "hello" });
    await press(page, "Escape", "0");
    await page.waitForTimeout(250);
    await stays(page);
    await expectBesideChip(page);
    expect((await caret(page)).before).toBe(""); // before the chip
    await press(page, "i");
    await page.keyboard.type("X");
    await expect.poll(() => draft(page)).toBe("X@Fixture Reader hello");
  });

  test("mentions then text: h from the first word steps to the space, the next h leaves", async ({ page, app }) => {
    await open(page, app);
    await mentionsIn(page, 2, { after: "hello" });
    await press(page, "Escape", "0", "l", "l", "l", "l"); // c, space, c, space: the cursor is on the h of hello
    await page.waitForTimeout(250);
    await stays(page);
    expect((await caret(page)).before.endsWith("Reader ")).toBe(true);
    await press(page, "h"); // onto the space after the second chip
    await stays(page);
    await press(page, "h"); // just right of the leading run: out
    await leaves(page);
  });

  test("text then a mention: the chip keeps its one-character steps, and h at the start still leaves", async ({ page, app }) => {
    await open(page, app);
    await mentionsIn(page, 1, { before: "hi " });
    await press(page, "Escape"); // on the space after the chip
    await page.waitForTimeout(250);
    await stays(page);
    await press(page, "h"); // onto the chip
    await stays(page);
    await press(page, "h"); // onto the space before it
    await stays(page);
    await press(page, "h", "h"); // i, h
    await stays(page);
    expect((await caret(page)).before).toBe("");
    await press(page, "h"); // the start of the draft: out, as before
    await leaves(page);
  });

  test("a trailing mention with a thread beside the channel: l from the space before it goes to the thread's box", async ({ page, app }) => {
    await open(page, app);
    await mentionsIn(page, 1, { before: "hi " });
    await leaveUp(page);
    await press(page, "o");
    await expect(threadPane(page)).toBeVisible();
    await press(page, "i");
    await expect(replyBox(page)).toBeFocused();
    await press(page, "Escape", "h"); // the channel's box, at the end of its draft
    await expect(composer(page)).toBeFocused();
    await page.waitForTimeout(300);
    await press(page, "h"); // onto the chip
    await stays(page);
    await press(page, "l"); // the space after it is not part of the run: a normal step
    await stays(page);
    await press(page, "h", "h"); // the chip, then the space before it
    await stays(page);
    await press(page, "l"); // the next step lands on the chip, the start of the trailing run: on to the thread
    await expect(replyBox(page)).toBeFocused();
    await expect(bar(page)).toHaveText("-- NORMAL --  side");
  });

  test("four trailing mentions with a thread: l from inside the run goes to the thread's box", async ({ page, app }) => {
    await open(page, app);
    await mentionsIn(page, 4, { before: "go " });
    await leaveUp(page);
    await press(page, "o");
    await expect(threadPane(page)).toBeVisible();
    await press(page, "i");
    await expect(replyBox(page)).toBeFocused();
    await press(page, "Escape", "h");
    await expect(composer(page)).toBeFocused();
    await page.waitForTimeout(300);
    await press(page, "h", "h", "h", "h", "h"); // the last space, c4, a space, c3, a space: five steps back from the end
    await stays(page);
    await press(page, "l");
    await expect(replyBox(page)).toBeFocused();
  });

  test("a trailing mention with no pane to the right: l walks over it as before", async ({ page, app }) => {
    await open(page, app);
    await mentionsIn(page, 1, { before: "hi " });
    await press(page, "Escape", "0", "l", "l", "l"); // h, i, the space: the cursor is on the space before the chip
    await page.waitForTimeout(250);
    await stays(page);
    await press(page, "l"); // onto the chip
    await stays(page);
    await press(page, "l"); // onto the space after it
    await stays(page);
    await press(page, "l"); // the end of the draft, and nothing to the right
    await stays(page);
  });
});
