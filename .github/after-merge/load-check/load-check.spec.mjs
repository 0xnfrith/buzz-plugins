// The load check, the same for every plugin: the committed plugin.js and manifest.json are registered in Buzz's own web build (run.sh
// does that, for one plugin at a time), and the plugin must
//  - finish `apply` (so its `inject` was met and nothing threw), and be active by the host's own account;
//  - leave no page error and no console error behind (the harness's `app` fixture fails the test on either, at the end of it);
//  - open and draw every page it registers that the host lists (a primary page): the host's error screen for a page that cannot open
//    is not shown, and something is on the page.
// Run it with .github/after-merge/load-check/run.sh.
import { test, expect } from "./fixture.mjs";
import { openPage } from "./navigation.mjs";

const id = process.env.LOAD_CHECK_PLUGIN_ID;
const folder = process.env.LOAD_CHECK_PLUGIN;

test.use({ pluginFixtures: true });

test(`${folder}: loads, is active and its pages open`, async ({ page, app }) => {
  await page.goto(app.origin);

  // Apply either finished or threw. If neither happens, the host never called it: a service the plugin injects is missing, or apply
  // does not return (the host gives up on a plugin after ten seconds).
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__loadCheck?.applied || window.__loadCheck?.error)), {
      message: "apply finished or threw (it did neither: the host never started it, or it never returned)",
      timeout: 15_000,
    })
    .toBe(true);
  expect(await page.evaluate(() => window.__loadCheck.error ?? null), "apply threw").toBeNull();
  await expect
    .poll(() => page.evaluate((id) => window.__loadCheck.ctx.pluginStatus.isActive(id, "bundled"), id), {
      message: "the host calls the plugin active",
      timeout: 15_000,
    })
    .toBe(true);

  // The pages the plugin registered, as the host lists them. Only a primary page has a way in (the search), so only those open.
  const pages = await page.evaluate(
    (id) =>
      window.__loadCheck.ctx.pages
        .snapshot()
        .filter((entry) => entry.key.startsWith(`${id}/`))
        .map((entry) => ({ key: entry.key, title: entry.title, primary: !!entry.primary })),
    id,
  );
  console.log(`${folder}: ${pages.length} page(s) registered: ${pages.map((entry) => `${entry.title}${entry.primary ? "" : " (not primary)"}`).join(", ") || "none"}`);

  const main = page.getByRole("main");
  for (const entry of pages.filter((entry) => entry.primary)) {
    const before = await main.innerHTML();
    await openPage(page, entry.title);
    // The page has replaced what was there (a check made before that would pass on the old page), ...
    await expect.poll(() => main.innerHTML(), { message: `${entry.title} replaces the page before it` }).not.toBe(before);
    // ... and what it does right after it first draws (an effect, a first request, a timer) has happened, ...
    await page.waitForTimeout(1000);
    // ... and it is not one of the host's two error screens for a page that cannot open (the page boundary's "This page couldn’t
    // open", and the shell's "This destination couldn’t open", which a page that throws while it renders gets), and something is on it.
    // (A page error, or a console error, anywhere in this test fails it when the test ends: the harness's `app` fixture looks for them.)
    await expect(page.getByRole("alert").filter({ hasText: /This (page|destination) couldn’t open/ }), `${entry.title} opens`).toHaveCount(0);
    await expect(main, `${entry.title} draws`).not.toBeEmpty();
  }
});
