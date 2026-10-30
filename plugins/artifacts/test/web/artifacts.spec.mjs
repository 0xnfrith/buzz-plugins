// Drives the Artifacts plugin's Settings card in the real Buzz web build (headless Chromium, fixture relay): what the node tests
// cannot see, which is real focus, `autoFocus` and whether Esc reaches the Settings dialog. Run with plugins/artifacts/test/run.sh.
// The web build has no built-in browser, so the page itself is not driven here.
import { test, expect } from "./fixture.mjs";
import { openSettings, settingsDialog, settingsSections } from "./navigation.mjs";

test.use({ pluginFixtures: true });

const PAGES = [
  ["Alpha page", "https://example.org/alpha"],
  ["Beta page", "https://example.org/beta"],
  ["Gamma page", "https://example.org/gamma"],
];

const rename = (page, name) => page.getByRole("button", { name: `Rename ${name}`, exact: true });
const remove = (page, name) => page.getByRole("button", { name: `Remove ${name}`, exact: true });
const question = (page, name) => page.getByRole("group", { name: `Remove ${name}?`, exact: true });
const keep = (page) => page.getByRole("button", { name: "Keep", exact: true });
const nameField = (page) => page.getByRole("textbox", { name: "Name (optional)", exact: true });
const heading = (page, name) => page.getByRole("heading", { name, level: 3, exact: true });

/** The Settings dialog open on the Artifacts card, with the given pages saved through its own add form. */
async function arrange(page, app, pages = PAGES) {
  await page.goto(app.origin);
  await openSettings(page);
  // The card is not a landmark of its own, so the section is picked by its button and found by its heading.
  await settingsSections(page).getByRole("button", { name: "Artifacts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved pages", level: 2, exact: true })).toBeVisible();
  for (const [name, address] of pages) {
    await nameField(page).fill(name);
    await page.getByRole("textbox", { name: "Web address", exact: true }).fill(address);
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    await expect(heading(page, name)).toBeVisible();
  }
}

test("after Remove and confirm the focus is on the next card's Rename, else the one before, else the add form", async ({ page, app }) => {
  await arrange(page, app);
  // The middle page, by keyboard: the safe answer has the focus, Shift+Tab reaches Remove, Enter confirms.
  await remove(page, "Beta page").click();
  await expect(keep(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(question(page, "Beta page").getByRole("button", { name: "Remove", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(heading(page, "Beta page")).toHaveCount(0);
  await expect(rename(page, "Gamma page")).toBeFocused();
  // The last page has none after it, so the focus goes to the one before.
  await remove(page, "Gamma page").click();
  await question(page, "Gamma page").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(heading(page, "Gamma page")).toHaveCount(0);
  await expect(rename(page, "Alpha page")).toBeFocused();
  // The only page: with none left, the first field of the add form.
  await remove(page, "Alpha page").click();
  await question(page, "Alpha page").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(heading(page, "Alpha page")).toHaveCount(0);
  await expect(page.getByText("No saved pages yet")).toBeVisible();
  await expect(nameField(page)).toBeFocused();
  await expect(settingsDialog(page)).toBeVisible();
});

test("Esc leaves the rename field or the question and does not close Settings; with neither open it does", async ({ page, app }) => {
  await arrange(page, app, PAGES.slice(0, 1));
  await rename(page, "Alpha page").click();
  const field = page.getByRole("textbox", { name: "Name for https://example.org/alpha", exact: true });
  await expect(field).toBeFocused(); // autoFocus, in a real browser
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(settingsDialog(page)).toBeVisible();
  await expect(rename(page, "Alpha page")).toBeFocused();
  await remove(page, "Alpha page").click();
  await expect(keep(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(question(page, "Alpha page")).toHaveCount(0);
  await expect(settingsDialog(page)).toBeVisible();
  await expect(remove(page, "Alpha page")).toBeFocused();
  await expect(heading(page, "Alpha page")).toBeVisible(); // Esc answered no
  // Nothing of the plugin's is open now: Esc is Settings' own and closes it.
  await page.keyboard.press("Escape");
  await expect(settingsDialog(page)).toHaveCount(0);
});
