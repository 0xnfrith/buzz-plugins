// Drives the Agent Skills Highlighter in Buzz's own web build (headless Chromium, fixture relay): the highlight in a channel, a thread and a
// DM, the card (hover, keyboard, Esc, mouse-out, scroll), reduced motion, that the text neither changes nor moves, contrast in both themes,
// the Settings card, and that disabling the plugin leaves nothing behind. The program that reads skill files is a stand-in the spec
// supplies (`window.__skillsRun`); run with plugins/agent-skills-highlighter/test/run.sh.
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";
import { hoverMessage } from "./message-actions.mjs";
import { openSettings, selectSettingsSection, settingsDialog, settingsSections } from "./navigation.mjs";
import { setPluginEnabled } from "./plugin-settings.mjs";
import { DESCRIPTION_LINES, SIGNAL } from "../fixtures/agent-skills-highlighter/plugin.js";

test.use({ pluginFixtures: true, productionBroker: true, dmLabels: true, historyCounts: { alpha: 12, beta: 3 } });

const PLUGIN = "Agent Skills Highlighter";
const SKILLS = [
  "@@@\tuser\t\tbrainstorming",
  "name: brainstorming",
  "description: Explore intent and requirements before building anything.",
  "@@@\tplugin\tsuperpowers\tplan-review",
  "name: plan-review",
  "description: >",
  "  Review a plan",
  "  before it runs.",
  "",
].join("\n");

/** The page open on the channel, with the stand-in reader answering `state.output` (null makes it fail) and noting every call. */
async function arrange(page, app, output = SKILLS) {
  const state = { output, calls: [] };
  await page.exposeFunction("__skillsRun", (command, input) => {
    state.calls.push({ command, input });
    return state.output;
  });
  await open(page, app);
  return state;
}
const composer = (page) => page.getByRole("textbox", { name: /^(Message|Reply)/ }).last();
const say = async (page, text) => {
  await composer(page).click();
  await page.keyboard.insertText(text);
  await page.keyboard.press("Enter");
};
const tokens = (page) => page.locator("[data-skill]");
const token = (page, name) => page.locator(`[data-skill="${name}"]`);
const card = (page) => page.locator(".megatech-skills__card");
// A timer of the page's own: the time the card waits before it closes is what is under test, not the speed of this runner.
const pageTimer = (page, ms) => page.evaluate((delay) => new Promise((resolve) => setTimeout(resolve, delay)), ms);

test("a known skill is drawn in a channel, a thread and a DM, and a path, a URL, code and an unknown name are left alone", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "use /brainstorming now, not /usr/bin/brainstorming or a/brainstorming or /plan-review.md or /nothing-here. In code: `/brainstorming`. A link: https://example.com/brainstorming");
  await expect(tokens(page)).toHaveCount(1);
  await expect(tokens(page).first()).toHaveText("/brainstorming");
  const row = page.locator("[data-message-scroller] [data-message-id]").last();
  await hoverMessage(row);
  await row.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Reply to thread", exact: true })).toBeFocused();
  await page.keyboard.insertText("and /plan-review, please.");
  await page.keyboard.press("Enter");
  await expect(token(page, "plan-review")).toHaveCount(1);
  await page.locator('[data-sidebar-section="dms"] [data-channel-id="dm-peer"]').click();
  await say(page, "(/brainstorming) in a DM.");
  await expect(token(page, "brainstorming")).toHaveCount(1);
  await expect(tokens(page).first()).toHaveText("/brainstorming");
});

test("hovering a skill opens the card with its name, description, source and a signal line; mouse-out closes it; the card itself keeps it open", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "try /brainstorming and /plan-review");
  await expect(tokens(page)).toHaveCount(2);
  await token(page, "brainstorming").hover();
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toHaveAttribute("role", "tooltip");
  await expect(card(page).locator(".megatech-skills__name")).toHaveText("/brainstorming");
  await expect(card(page).locator(".megatech-skills__desc")).toHaveText("Explore intent and requirements before building anything.");
  await expect(card(page).locator(".megatech-skills__from")).toHaveText("From your skills folder");
  const signal = await card(page).locator(".megatech-skills__signal").textContent();
  expect(SIGNAL).toContain(signal);
  const id = await card(page).getAttribute("id");
  await expect(token(page, "brainstorming")).toHaveAttribute("aria-describedby", id);
  await expect(token(page, "brainstorming")).toHaveAttribute("data-skill-open", "");
  // The card sits beside the token, inside the window, and the token does not move.
  const at = await token(page, "brainstorming").boundingBox();
  const box = await card(page).boundingBox();
  const view = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  expect(box.y >= at.y + at.height - 1 || box.y + box.height <= at.y + 1).toBe(true);
  // Onto the card: it stays open past the time it would have closed.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pageTimer(page, 400);
  await expect(card(page)).toBeVisible();
  // Away from both: it closes, and the token's marks go.
  await page.mouse.move(2, 2);
  await expect(card(page)).toBeHidden();
  await expect(token(page, "brainstorming")).not.toHaveAttribute("data-skill-open", "");
  await expect(token(page, "brainstorming")).not.toHaveAttribute("aria-describedby", /.+/);
  // A second skill: its own description, from the plugin that has it, and the next signal line.
  await token(page, "plan-review").hover();
  await expect(card(page).locator(".megatech-skills__desc")).toHaveText("Review a plan before it runs.");
  await expect(card(page).locator(".megatech-skills__from")).toHaveText("From the superpowers plugin");
  await expect(card(page).locator(".megatech-skills__signal")).not.toHaveText(signal);
});

test("by keyboard: a skill is a tab stop, focus opens the card, Esc closes it, moving on closes it", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "first /brainstorming then /plan-review");
  await expect(tokens(page)).toHaveCount(2);
  await expect(token(page, "brainstorming")).toHaveAttribute("tabindex", "0");
  await token(page, "brainstorming").focus();
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator(".megatech-skills__name")).toHaveText("/brainstorming");
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();
  await expect(token(page, "brainstorming")).toBeFocused();
  // Enter on the focused skill opens the card again (focus does not fire a second time), and Esc closes it again.
  await page.keyboard.press("Enter");
  await expect(card(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();
  await page.keyboard.press(" ");
  await expect(card(page)).toBeVisible();
  // Tab reaches the next skill in the text, and the card is for that one.
  let reached = false;
  for (let step = 0; step < 6 && !reached; step++) {
    await page.keyboard.press("Tab");
    reached = await token(page, "plan-review").evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  await expect(card(page).locator(".megatech-skills__name")).toHaveText("/plan-review");
  await page.keyboard.press("Shift+Tab");
  await expect(token(page, "brainstorming")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await composer(page).focus();
  await expect(card(page)).toBeHidden();
});

test("Esc with the card open closes the card and nothing else: the thread behind it stays open, and the next Esc closes the thread", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "a message to reply to");
  const row = page.locator("[data-message-scroller] [data-message-id]").last();
  await hoverMessage(row);
  await row.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = page.getByRole("textbox", { name: "Reply to thread", exact: true });
  await expect(reply).toBeFocused();
  await page.keyboard.insertText("try /brainstorming here");
  await page.keyboard.press("Enter");
  await expect(tokens(page)).toHaveCount(1); // the only skill on the page is in the thread
  // Opened by keyboard focus: Esc closes the card, the thread stays, and the skill keeps the focus.
  await token(page, "brainstorming").focus();
  await expect(card(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();
  await expect(reply).toBeVisible();
  await expect(token(page, "brainstorming")).toBeFocused();
  // Opened by the pointer: the same.
  await token(page, "brainstorming").hover();
  await expect(card(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();
  await expect(reply).toBeVisible();
  // With no card open Esc is the app's again, and it closes the thread: the check that the test above could have failed.
  await page.mouse.move(2, 2);
  await page.keyboard.press("Escape");
  await expect(reply).toBeHidden();
});

test("Esc with a card the pointer opened while the focus is elsewhere closes the card and still reaches the page; with the focus on the skill it does not", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "see /brainstorming");
  // What gets as far as the page after the plugin's own listener (which is on the window, in the capture phase).
  await page.evaluate(() => {
    window.__esc = [];
    document.addEventListener("keydown", (event) => event.key === "Escape" && window.__esc.push(event.defaultPrevented));
  });
  await composer(page).click();
  await token(page, "brainstorming").hover();
  await expect(card(page)).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.getAttribute("role") === "textbox" || document.activeElement?.isContentEditable), "the focus is in the composer").toBe(true);
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();
  expect(await page.evaluate(() => window.__esc), "the key reached the page, and nobody had prevented it").toEqual([false]);
  // The same card with the focus on its skill: the plugin keeps the key.
  await token(page, "brainstorming").focus();
  await expect(card(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeHidden();
  expect(await page.evaluate(() => window.__esc), "the second Esc did not reach the page").toEqual([false]);
});

test("a card whose skill is unmounted while it is open closes by itself, with no mouse-out to wait for", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "see /brainstorming");
  await token(page, "brainstorming").hover();
  await expect(card(page)).toBeVisible();
  // As an edited or a deleted message would do: the node goes, the pointer stays where it was, and no mouseleave is ever sent to it.
  await token(page, "brainstorming").evaluate((el) => el.remove());
  await expect(card(page)).toBeHidden({ timeout: 3000 });
  // And it opens again for the next skill.
  await say(page, "and again /plan-review");
  await expect(token(page, "plan-review")).toHaveCount(1);
  await token(page, "plan-review").hover();
  await expect(card(page)).toBeVisible();
});

test("a skill is a button for a screen reader: a role, a hint, and whether its card is open", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "run /brainstorming now");
  const button = page.getByRole("button", { name: "/brainstorming", exact: true });
  await expect(button).toHaveCount(1);
  await expect(button).toHaveAttribute("data-skill", "brainstorming");
  await expect(button).toHaveAttribute("aria-description", /Press Enter or Space/);
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.focus();
  await expect(card(page)).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  // Enter and Space, which the role promises, open it.
  for (const key of ["Enter", " "]) {
    await page.keyboard.press(key);
    await expect(card(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card(page)).toBeHidden();
  }
  // The words are still the message's own.
  await expect(button).toHaveText("/brainstorming");
});

test("a long description is clamped to a fixed number of lines and ends in an ellipsis; one of a real size shows whole", async ({ page, app }) => {
  const words = Array.from({ length: 125 }, (_, i) => `word${String(i).padStart(3, "0")}`).join(" "); // 999 characters
  const real = Array.from({ length: 55 }, (_, i) => `real${String(i).padStart(2, "0")}`).join(" "); // 329 characters
  const longest = Array.from({ length: 73 }, (_, i) => `rl${String(i).padStart(3, "0")}`).join(" "); // 437 characters: the longest of the real descriptions found
  await arrange(page, app, ["@@@\tuser\t\tlong", "name: long", `description: ${words}`, "@@@\tuser\t\treal", "name: real", `description: ${real}`, "@@@\tuser\t\tlongest", "name: longest", `description: ${longest}`, ""].join("\n"));
  await say(page, "/long /real /longest");
  await expect(tokens(page)).toHaveCount(3);
  const desc = card(page).locator(".megatech-skills__desc");
  const read = () =>
    desc.evaluate((el) => {
      const style = getComputedStyle(el);
      const text = el.firstChild;
      const range = document.createRange();
      const bottom = el.getBoundingClientRect().bottom;
      let shown = 0;
      for (let at = 0; at < text.length; at++) {
        range.setStart(text, at);
        range.setEnd(text, at + 1);
        const rect = range.getClientRects()[0];
        if (rect && rect.bottom > bottom + 1) break;
        shown = at + 1;
      }
      return { clamp: style.webkitLineClamp, lines: Math.round(el.clientHeight / parseFloat(style.lineHeight)), clipped: el.scrollHeight > el.clientHeight + 1, shown, length: text.length };
    });
  await token(page, "long").hover();
  await expect(card(page).locator(".megatech-skills__name")).toHaveText("/long");
  const clamped = await read();
  console.log(`CLAMP long ${JSON.stringify(clamped)}`);
  expect(clamped.clamp).toBe(String(DESCRIPTION_LINES));
  expect(clamped.lines).toBe(DESCRIPTION_LINES);
  expect(clamped.clipped, "the description is longer than the card shows").toBe(true);
  expect(clamped.shown, "what shows is a part of it").toBeLessThan(clamped.length);
  expect(clamped.shown, "and a good part: more than the longest real description").toBeGreaterThan(437);
  await token(page, "real").hover();
  await expect(card(page).locator(".megatech-skills__name")).toHaveText("/real");
  const whole = await read();
  expect(whole.clipped).toBe(false);
  expect(whole.shown).toBe(whole.length);
  await token(page, "longest").hover();
  await expect(card(page).locator(".megatech-skills__name")).toHaveText("/longest");
  const longestShown = await read();
  console.log(`CLAMP longest ${JSON.stringify(longestShown)}`);
  expect(longestShown.clipped, "the longest real description fits").toBe(false);
  expect(longestShown.shown).toBe(longestShown.length);
});

test("scrolling the list closes the card, and so does a click elsewhere", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "see /brainstorming");
  await token(page, "brainstorming").hover();
  await expect(card(page)).toBeVisible();
  await page.locator("[data-message-scroller]").evaluate((el) => el.scrollBy(0, -30));
  await expect(card(page)).toBeHidden();
  await token(page, "brainstorming").hover();
  await expect(card(page)).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(card(page)).toBeHidden();
});

test("the text never changes or moves: no padding, margin or border, the same type, and the same box before and while the card is open", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "before /brainstorming after, and a long enough line that it wraps onto a second line around /plan-review, then more words to fill it");
  await expect(tokens(page)).toHaveCount(2);
  const measure = () =>
    page.evaluate(() => {
      const mark = document.querySelector('[data-skill="brainstorming"]');
      const paragraph = mark.closest("p");
      const style = getComputedStyle(mark);
      const parent = getComputedStyle(paragraph);
      return {
        text: paragraph.textContent,
        paragraph: JSON.stringify(paragraph.getBoundingClientRect().toJSON()),
        rects: JSON.stringify([...mark.getClientRects()].map((r) => r.toJSON())),
        spacing: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"].map((key) => style[key]),
        type: [style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle, style.letterSpacing, style.wordSpacing, style.lineHeight, style.textTransform, style.color].join("|"),
        parentType: [parent.fontFamily, parent.fontSize, parent.fontWeight, parent.fontStyle, parent.letterSpacing, parent.wordSpacing, parent.lineHeight, parent.textTransform, parent.color].join("|"),
        display: style.display,
      };
    });
  const before = await measure();
  expect(before.spacing.every((value) => value === "0px")).toBe(true);
  expect(before.type).toBe(before.parentType);
  expect(before.display).toBe("inline");
  await token(page, "brainstorming").hover();
  await expect(card(page)).toBeVisible();
  const during = await measure();
  expect(during.text).toBe(before.text);
  expect(during.paragraph).toBe(before.paragraph);
  expect(during.rects).toBe(before.rects);
  expect(during.type).toBe(before.type);
  expect(during.spacing).toEqual(before.spacing);
  // The page's text is the message's text, whole, with or without the marks.
  expect(before.text).toContain("before /brainstorming after");
});

test("the glitch stays inside the highlight, behind its own letters: every shadow is inset, and the neighbouring letters are the same pixels in every frame", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "see(/brainstorming) now");
  const mark = token(page, "brainstorming");
  await expect(mark).toHaveCount(1);
  // The two strips of page either side of the highlight, which hold "(" and ")": what is drawn there must not change.
  const strips = async () => {
    const box = await mark.boundingBox();
    const clip = (x) => ({ x, y: box.y - 2, width: 9, height: box.height + 4 });
    return [await page.screenshot({ clip: clip(box.x - 9) }), await page.screenshot({ clip: clip(box.x + box.width) })];
  };
  // The pointer rests on the message (its own row has a hover state) but not on the highlight.
  const box = await mark.boundingBox();
  await page.mouse.move(box.x + box.width + 60, box.y + box.height / 2);
  const [leftAtRest, rightAtRest] = await strips();
  // Each frame of the decloak, held still: a negative delay picks the moment, `paused` stops it there.
  for (const at of [0, 40, 80, 120, 160, 200, 280, 360, 399]) {
    const shadow = await mark.evaluate((el, ms) => {
      el.style.animation = "megatech-skills-decloak .4s steps(10,end) 1 paused";
      el.style.animationDelay = `-${ms}ms`;
      return getComputedStyle(el).boxShadow;
    }, at);
    const layers = shadow.split(/,\s(?![^(]*\))/);
    expect(layers.length, shadow).toBeGreaterThanOrEqual(2);
    for (const layer of layers) expect(layer, `at ${at} ms: ${shadow}`).toContain("inset");
    const [left, right] = await strips();
    expect(left.equals(leftAtRest), `the letter before the highlight is as it was at ${at} ms`).toBe(true);
    expect(right.equals(rightAtRest), `the letter after the highlight is as it was at ${at} ms`).toBe(true);
  }
  await mark.evaluate((el) => {
    el.style.animation = "";
    el.style.animationDelay = "";
  });
  // And the hovered, open state once the decloak is over: the ring is inside, too. (The pixels beside it are not compared here: the open card's
  // own glow, the design system's, falls on the line.)
  await mark.hover();
  await expect(card(page)).toBeVisible();
  await pageTimer(page, 600);
  const open = await mark.evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, animation: getComputedStyle(el).animationName }));
  const openLayers = open.shadow.split(/,\s(?![^(]*\))/);
  expect(openLayers.length, open.shadow).toBeGreaterThanOrEqual(2);
  for (const layer of openLayers) expect(layer, open.shadow).toContain("inset");
});

test("reduced motion: a still brighter highlight and a card that simply appears; otherwise the decloak and the card's glitch run, and nothing moves at rest", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "see /brainstorming");
  const animation = () => token(page, "brainstorming").evaluate((el) => getComputedStyle(el).animationName);
  const cardAnimation = () => card(page).evaluate((el) => getComputedStyle(el).animationName);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await animation()).toBe("none"); // at rest nothing animates: a moving highlight on every skill cost the list's scrolling dearly
  await token(page, "brainstorming").hover();
  await expect.poll(animation).toBe("megatech-skills-decloak");
  await expect(card(page)).toBeVisible();
  expect(await cardAnimation()).toBe("megatech-skills-card");
  await page.mouse.move(2, 2);
  await expect(card(page)).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animation()).toBe("none");
  await token(page, "brainstorming").hover();
  await expect(card(page)).toBeVisible();
  expect(await animation()).toBe("none");
  expect(await cardAnimation()).toBe("none");
  // Still highlighted and dithered, with nothing moving.
  expect(await token(page, "brainstorming").evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("data:image/svg+xml");
});

for (const mode of ["dark", "light"]) {
  test(`${mode} theme: the message's own text stays at 4.5:1 or better on the highlight, in its worst frame, and on the card's plate`, async ({ page, app }) => {
    await arrange(page, app);
    await say(page, "read /brainstorming please");
    await expect(tokens(page)).toHaveCount(1);
    await page.evaluate((value) => (document.documentElement.dataset.colorMode = value), mode);
    await token(page, "brainstorming").hover();
    await expect(card(page)).toBeVisible();
    const ratios = await page.evaluate(() => {
      const pixel = (css) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = css;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return { r, g, b, a: a / 255 };
      };
      const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
      const luminance = ({ r, g, b }) => {
        const [R, G, B] = [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * R + 0.7152 * G + 0.0722 * B;
      };
      const ratio = (a, b) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const mark = document.querySelector('[data-skill="brainstorming"]');
      // The host's ground under the token: the first opaque background up the tree.
      let ground = { r: 255, g: 255, b: 255, a: 1 };
      for (let node = mark.parentElement; node; node = node.parentElement) {
        const color = pixel(getComputedStyle(node).backgroundColor);
        if (color.a > 0) {
          ground = over(color, ground);
          if (color.a === 1) break;
        }
      }
      const style = getComputedStyle(mark);
      const ink = pixel(style.color);
      const read = (name) => style.getPropertyValue(name).trim();
      const tint = read("--megatech-skills-tint");
      const layer = (colour, alpha) => pixel(`color-mix(in srgb, ${colour} ${Number(alpha) * 100}%, transparent)`);
      // The worst frame: the base, the darkest cell of the dither and the middle of the scan beam, all on the same pixel; and, at the first and last
      // letters, the glitch's magenta or cyan band as well (it is drawn behind the letters, inside the highlight).
      const worst = (base) => {
        const under = over(layer(read("--megatech-skills-beam-color"), read("--megatech-skills-a-scan")), over(layer(tint, read("--megatech-skills-a-dither")), over(layer(tint, base), ground)));
        const split = (colour) => ratio(ink, over(layer(read(colour), read("--megatech-skills-a-split")), under));
        return Math.min(ratio(ink, under), split("--megatech-skills-magenta"), split("--megatech-skills-cyan"));
      };
      const el = document.querySelector(".megatech-skills__plate");
      const plate = over(pixel(getComputedStyle(el).backgroundColor), { r: 255, g: 255, b: 255, a: 1 });
      // Every line of the card against its plate.
      const onPlate = (selector) => ratio(pixel(getComputedStyle(document.querySelector(selector)).color), plate);
      return {
        rest: worst(read("--megatech-skills-a-rest")),
        hover: worst(read("--megatech-skills-a-hot")),
        plate: ratio(pixel(getComputedStyle(el).color), plate),
        name: onPlate(".megatech-skills__name"),
        tag: onPlate(".megatech-skills__tag"),
        desc: onPlate(".megatech-skills__desc"),
        from: onPlate(".megatech-skills__from"),
        signal: onPlate(".megatech-skills__signal"),
        mode: document.documentElement.dataset.colorMode,
        tint,
      };
    });
    console.log(`CONTRAST ${mode} ${JSON.stringify(ratios)}`);
    expect(ratios.rest).toBeGreaterThanOrEqual(4.5);
    expect(ratios.hover).toBeGreaterThanOrEqual(4.5);
    for (const part of ["plate", "name", "tag", "desc", "from", "signal"]) expect(ratios[part], part).toBeGreaterThanOrEqual(4.5);
  });
}

test("the card is the Megatech design system's in dark and the host's own plate and text in light; corners are square", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "read /brainstorming please");
  await expect(tokens(page)).toHaveCount(1);
  await token(page, "brainstorming").hover();
  await expect(card(page)).toBeVisible();
  const look = () =>
    page.evaluate(() => {
      const css = (selector, property, pseudo) => getComputedStyle(document.querySelector(selector), pseudo)[property];
      const probe = document.createElement("div");
      probe.style.cssText = "background:var(--surface-popover,#fff);color:var(--text-standard,#1a2026)";
      document.body.append(probe);
      const host = { plate: getComputedStyle(probe).backgroundColor, text: getComputedStyle(probe).color };
      probe.remove();
      return {
        mode: document.documentElement.dataset.colorMode,
        host,
        plate: css(".megatech-skills__plate", "backgroundColor"),
        text: css(".megatech-skills__plate", "color"),
        hair: css(".megatech-skills__plate", "borderTopColor"),
        name: css(".megatech-skills__name", "color"),
        nameCase: css(".megatech-skills__name", "textTransform"),
        nameFont: css(".megatech-skills__name", "fontFamily"),
        signal: css(".megatech-skills__signal", "color"),
        sys: css(".megatech-skills__signal", "content", "::before"),
        glow: getComputedStyle(document.querySelector(".megatech-skills__card")).getPropertyValue("--megatech-skills-glow"), // the card is mid-animation, so its box-shadow is read from the variable
        radii: [css(".megatech-skills__card", "borderRadius"), css(".megatech-skills__plate", "borderRadius"), css('[data-skill="brainstorming"]', "borderRadius")],
        magenta: getComputedStyle(document.querySelector(".megatech-skills__card")).getPropertyValue("--megatech-skills-magenta").trim(),
      };
    });
  await page.evaluate(() => (document.documentElement.dataset.colorMode = "dark"));
  const dark = await look();
  expect(dark).toMatchObject({
    plate: "rgb(18, 22, 28)", // gunmetal-deep
    text: "rgb(233, 238, 244)", // ink
    hair: "rgba(0, 212, 255, 0.16)",
    name: "rgb(0, 212, 255)", // cyan
    nameCase: "uppercase",
    signal: "rgb(0, 153, 204)", // cyan-dim
    sys: '"SYS:: "',
    radii: ["0px", "0px", "0px"],
    magenta: "#ff2bd6",
  });
  expect(dark.nameFont).toContain("Chakra Petch");
  expect(dark.glow).toContain("40px"); // glow-card
  await page.evaluate(() => (document.documentElement.dataset.colorMode = "light"));
  const light = await look();
  expect(light.plate).toBe(light.host.plate); // the host's popover surface and text, not ours
  expect(light.text).toBe(light.host.text);
  expect(light.name).toBe("rgb(0, 112, 143)"); // cyan darkened for white
  expect(light.signal).toBe("rgb(0, 112, 143)");
  expect(light.glow).not.toContain("40px"); // no glow on light
  expect(light.radii).toEqual(["0px", "0px", "0px"]);
});

test("the Settings card shows what was found, takes an extra folder through the command's standard input, and keeps the last list when a read fails", async ({ page, app }) => {
  const state = await arrange(page, app);
  await openSettings(page);
  await settingsSections(page).getByRole("button", { name: "Agent Skills", exact: true }).click();
  const dialog = settingsDialog(page);
  await expect(dialog.getByRole("heading", { name: "Agent skills", level: 2 })).toBeVisible();
  await expect(dialog.locator(".megatech-skills-set__status")).toContainText("skill names known");
  await expect(dialog.locator(".megatech-skills-set__status")).toContainText("1 from your skills folder");
  expect(state.calls[0]).toEqual({ command: "skills", input: "\n" });
  // Square corners here too: not one element of the card has a radius, and the input and the buttons are in it.
  const radii = await dialog.locator(".megatech-skills-set").evaluate((root) => [root, ...root.querySelectorAll("*")].map((el) => `${el.className || el.tagName}:${getComputedStyle(el).borderRadius}`));
  expect(radii.filter((entry) => !entry.endsWith(":0px")), "every element of the Settings card has square corners").toEqual([]);
  expect(radii.filter((entry) => entry.startsWith("megatech-skills-set__")).length).toBeGreaterThanOrEqual(4);
  const field = dialog.getByRole("textbox", { name: "Extra folder (optional)" });
  await field.fill("skills");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Use a full path");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(state.calls).toHaveLength(1);
  await field.fill("~/my-skills");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => state.calls.length).toBe(2);
  expect(state.calls[1]).toEqual({ command: "skills", input: "~/my-skills\n" });
  expect(await page.evaluate(() => localStorage.getItem("megatech.agent-skills-highlighter.settings.v1"))).toBe('{"extraFolder":"~/my-skills"}');
  // A failed read says so, and shows the list it kept.
  state.output = null;
  await dialog.getByRole("button", { name: "Read again", exact: true }).click();
  await expect(dialog.locator(".megatech-skills-set__status")).toContainText("could not be read");
  await expect(dialog.locator(".megatech-skills-set__status")).toContainText("Showing the last list");
  // A machine with no skills: nothing is highlighted and the card says so.
  state.output = "";
  await dialog.getByRole("button", { name: "Read again", exact: true }).click();
  await expect(dialog.locator(".megatech-skills-set__status")).toContainText("No skills found");
});

test("reading again picks up a new skill and highlights it in a message that is already on the page", async ({ page, app }) => {
  const state = await arrange(page, app);
  await say(page, "we need /fresh-skill and /brainstorming");
  await expect(tokens(page)).toHaveCount(1);
  state.output = `${SKILLS}@@@\tuser\t\tfresh-skill\nname: fresh-skill\ndescription: Just added.\n`;
  await openSettings(page);
  await settingsSections(page).getByRole("button", { name: "Agent Skills", exact: true }).click();
  await settingsDialog(page).getByRole("button", { name: "Read again", exact: true }).click();
  await settingsDialog(page).getByRole("button", { name: "Close Settings", exact: true }).click();
  await expect(tokens(page)).toHaveCount(2);
  await token(page, "fresh-skill").hover();
  await expect(card(page).locator(".megatech-skills__desc")).toHaveText("Just added.");
});

test("disabling the plugin leaves no highlight, no card and no style; enabling it again leaves exactly one of each", async ({ page, app }) => {
  const state = await arrange(page, app);
  await say(page, "see /brainstorming");
  await token(page, "brainstorming").hover();
  await expect(card(page)).toBeVisible();
  await openSettings(page);
  await selectSettingsSection(page, "Manage plugins");
  await setPluginEnabled(page, PLUGIN, false);
  await settingsDialog(page).getByRole("button", { name: "Close Settings", exact: true }).click();
  await expect(tokens(page)).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator("style[data-megatech-skills]")).toHaveCount(0);
  await expect(page.locator("[data-message-scroller]")).toContainText("see /brainstorming");
  const calls = state.calls.length;
  await openSettings(page);
  await selectSettingsSection(page, "Manage plugins");
  await setPluginEnabled(page, PLUGIN, true);
  await settingsDialog(page).getByRole("button", { name: "Close Settings", exact: true }).click();
  await expect(tokens(page)).toHaveCount(1);
  await expect(page.locator("style[data-megatech-skills]")).toHaveCount(1);
  await expect.poll(() => state.calls.length).toBeGreaterThan(calls);
  await token(page, "brainstorming").hover();
  await expect(card(page)).toHaveCount(1);
});
