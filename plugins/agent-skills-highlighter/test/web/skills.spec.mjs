// Drives the Agent Skills Highlighter in Buzz's own web build (headless Chromium, fixture relay): the highlight in a channel, a thread and a
// DM, the card (hover, keyboard, Esc, mouse-out, scroll), reduced motion, that the text neither changes nor moves, contrast in both themes,
// the Settings card, and that disabling the plugin leaves nothing behind. The program that reads skill files is a stand-in the spec
// supplies (`window.__skillsRun`); run with plugins/agent-skills-highlighter/test/run.sh.
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";
import { hoverMessage } from "./message-actions.mjs";
import { openSettings, selectSettingsSection, settingsDialog, settingsSections } from "./navigation.mjs";
import { setPluginEnabled } from "./plugin-settings.mjs";
import { LORE } from "../fixtures/agent-skills-highlighter/plugin.js";

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

test("hovering a skill opens the card with its name, description, source and a line of lore; mouse-out closes it; the card itself keeps it open", async ({ page, app }) => {
  await arrange(page, app);
  await say(page, "try /brainstorming and /plan-review");
  await expect(tokens(page)).toHaveCount(2);
  await token(page, "brainstorming").hover();
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toHaveAttribute("role", "tooltip");
  await expect(card(page).locator(".megatech-skills__name")).toHaveText("/brainstorming");
  await expect(card(page).locator(".megatech-skills__desc")).toHaveText("Explore intent and requirements before building anything.");
  await expect(card(page).locator(".megatech-skills__from")).toHaveText("From your skills folder");
  const lore = await card(page).locator(".megatech-skills__lore").textContent();
  expect(LORE).toContain(lore);
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
  // A second skill: its own description, from the plugin that has it, and the next line of lore.
  await token(page, "plan-review").hover();
  await expect(card(page).locator(".megatech-skills__desc")).toHaveText("Review a plan before it runs.");
  await expect(card(page).locator(".megatech-skills__from")).toHaveText("From the superpowers plugin");
  await expect(card(page).locator(".megatech-skills__lore")).not.toHaveText(lore);
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
      // The worst frame: the base, the darkest cell of the dither and the middle of the scan beam, all on the same pixel.
      const worst = (base) => ratio(ink, over(layer(read("--megatech-skills-beam-color"), read("--megatech-skills-a-scan")), over(layer(tint, read("--megatech-skills-a-dither")), over(layer(tint, base), ground))));
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
        lore: onPlate(".megatech-skills__lore"),
        mode: document.documentElement.dataset.colorMode,
        tint,
      };
    });
    console.log(`CONTRAST ${mode} ${JSON.stringify(ratios)}`);
    expect(ratios.rest).toBeGreaterThanOrEqual(4.5);
    expect(ratios.hover).toBeGreaterThanOrEqual(4.5);
    for (const part of ["plate", "name", "tag", "desc", "from", "lore"]) expect(ratios[part], part).toBeGreaterThanOrEqual(4.5);
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
        lore: css(".megatech-skills__lore", "color"),
        sys: css(".megatech-skills__lore", "content", "::before"),
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
    lore: "rgb(0, 153, 204)", // cyan-dim
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
  expect(light.lore).toBe("rgb(0, 112, 143)");
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
