// Takes the README's screenshots in Buzz's own fixture app (fixture data only, headless Chromium).
//
//   SPEC=screenshots.spec.mjs plugins/vim/test/perf.sh /path/to/block/buzz-app/checkout with 1
//
// SHOTS_DIR sets the output folder (default /tmp/vim-shots). Each scene is taken in light and in dark mode, in the
// host's default accent; set SHOTS_ACCENT to take them in another one (the host's accent names: bee, magenta, iris,
// cobalt, citrus, mono).
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";

test.use({ pluginFixtures: true, historyCounts: { alpha: 12, beta: 3 }, viewport: { width: 1200, height: 760 } });

const DIR = process.env.SHOTS_DIR ?? "/tmp/vim-shots";
const ACCENT = process.env.SHOTS_ACCENT ?? "";
const bar = (page) => page.locator("[data-vim-status]");
const composer = (page, name = "Alpha") => page.getByRole("textbox", { name: `Message #${name}`, exact: true });
const press = async (page, ...keys) => {
  for (const key of keys) await page.keyboard.press(key);
};
const theme = (page, mode) =>
  page.evaluate(
    ([m, accent]) => {
      document.documentElement.dataset.colorMode = m;
      if (accent) document.documentElement.dataset.accent = accent;
    },
    [mode, ACCENT],
  );
// A frame to let the host repaint, the pointer out of the way (a hovered message shows its action bar), then the picture.
const shot = async (page, name, settle = 300) => {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(settle);
  fs.mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: path.join(DIR, `${name}.png`) });
};

for (const mode of ["light", "dark"]) {
  test(`screenshots, ${mode}`, async ({ page, app }) => {
    test.setTimeout(120_000);
    await open(page, app);
    await theme(page, mode);
    await expect(bar(page)).toContainText("NORMAL");

    // NORMAL: the cursor on a message, a lift on its bubble and a thin accent outline.
    await press(page, "k", "k");
    await shot(page, `normal-cursor-${mode}`);

    // INSERT: the box has the keys. The message above is not lifted; the box takes a much fainter lift.
    await press(page, "i");
    await page.keyboard.type("Ship the release notes today");
    await expect(bar(page)).toContainText("INSERT");
    await shot(page, `insert-${mode}`);

    // NORMAL in the box, and a visual highlight over a word.
    await press(page, "Escape", "0", "w");
    await expect(bar(page)).toContainText("NORMAL");
    await shot(page, `box-normal-${mode}`);
    await press(page, "v", "e");
    await expect(bar(page)).toContainText("VISUAL");
    await shot(page, `box-visual-${mode}`);
    await press(page, "Escape", "d", "d"); // leave visual mode and empty the draft; nothing is sent
    await press(page, "k");

    // A thread beside the channel: the pane that has the keys has the accent line under its header.
    await press(page, "o");
    await shot(page, `thread-pane-${mode}`);
    await press(page, "q");

    // The channel list has the keys: a ring on the current channel.
    await press(page, "h");
    await shot(page, `channel-list-${mode}`, 3000); // the host flashes the row of the thread it just closed; let that fade
  });
}

test("screenshots, the key list", async ({ page, app }) => {
  test.setTimeout(60_000);
  await open(page, app);
  await theme(page, "dark");
  await press(page, "k");
  // A real keyboard sends "?" with Shift held; Playwright's "Shift+/" sends "/" instead.
  await page.keyboard.down("Shift");
  await page.keyboard.press("?");
  await page.keyboard.up("Shift");
  await expect(page.getByRole("dialog", { name: "Vim keys", exact: true })).toBeVisible();
  await shot(page, "help-dark");
});
