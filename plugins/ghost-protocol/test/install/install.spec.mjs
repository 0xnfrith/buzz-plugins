// Installs the GHOST Protocol plugin the way a person does, in Buzz's own web build (headless Chromium, the app's fixture relay), with the
// app's real code on both sides of the plugin commands: Settings, Manage plugins, Add, the review, the loader and the runtime in the browser,
// and the `buzzodz-plugins` crate (the Git importer, the manifest checks, the registry) behind the bridge in bridge.rs, which the browser's
// `invoke` is routed to. Nothing here stands in for the importer or the loader. The test fails, at a step named in square brackets, when
//   [network]    the importer cannot reach GitHub (the clone is tried twice, the log says so);
//   [commit]     the importer read another commit than the one this job checked out (the branch moved after the push, or is another branch);
//   [offered]    the repository does not offer the plugin in "Add a plugin" (the importer refused its folder, or it is not there);
//   [review]     the review of access does not list exactly what manifest.json declares: every command, process and origin in full, and the count;
//   [installed]  the catalog does not hold the plugin as an installed, enabled one;
//   [module]     the loader was not given the plugin.js that was installed;
//   [activation] the plugin did not start: "Manage plugins" shows its error (apply threw, a service it injects is missing, ...);
//   [search]     its page is not in Search's Pages;
//   [sidebar]    its page is not in the Messages sidebar's page block.
// A page error or a console error anywhere fails the test too (the harness's `app` fixture). breaks.sh runs this on broken copies of the plugin
// and holds each to the step it must fail at. Run it with run.sh.
//
// The review is read from the dialog (each grant opened, its details read), and compared with `manifest.json` read here, in Node, from the
// plugin's committed folder, so the Rust side's own reading of the manifest (it adds `networkOrigins: []`, for one) is not the expectation.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test, expect } from "./fixture.mjs";
import { closeSettings, openSettings, pageChoice, pageChoices, selectSettingsSection } from "./navigation.mjs";

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: run plugins/ghost-protocol/test/install/run.sh`);
  return value;
};
const bridgeBinary = need("INSTALL_BRIDGE");
const sourceKind = need("INSTALL_SOURCE"); // "git": the repository on GitHub. "folder": a folder on disk, as the folder picker would answer.
const committedDir = need("INSTALL_COMMITTED_DIR"); // the plugin's folder at the commit under test: what the review must match
const sourceDir = need("INSTALL_SOURCE_DIR"); // the folder whose files are installed: the same in git mode, a copy in folder mode
if (!["git", "folder"].includes(sourceKind)) throw new Error(`INSTALL_SOURCE is "git" or "folder", not "${sourceKind}"`);
const git = sourceKind === "git" ? { repository: need("INSTALL_REPOSITORY"), reference: need("INSTALL_REFERENCE"), path: need("INSTALL_FOLDER_PATH"), commit: need("INSTALL_EXPECTED_COMMIT") } : null;

const manifest = JSON.parse(readFileSync(join(committedDir, "manifest.json"), "utf8"));
const PAGE = "GHOST Protocol";

// What git prints when it cannot reach the host. Only these are retried, and once.
const NETWORK = /Could not resolve host|unable to access|Failed to connect|Connection (?:timed out|refused|reset)|Operation timed out|Recv failure|SSL|TLS|RPC failed|early EOF|unexpected disconnect|returned error: (?:429|5\d\d)|exceeded 60 seconds/i;

test.use({ historyCounts: { alpha: 0, beta: 0 } });
test.describe.configure({ timeout: 180_000 });

/** The bridge process: one JSON line out for each request, one in for each reply. Keeps what the browser asked and was answered. */
function startBridge(home) {
  const child = spawn(bridgeBinary, sourceKind === "folder" ? [home, sourceDir] : [home], { stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map();
  const log = { previews: [], importErrors: [], modules: new Map(), catalogs: [], networkFailure: null };
  createInterface({ input: child.stdout }).on("line", (line) => waiting.get(JSON.parse(line).id)?.(JSON.parse(line)));
  let next = 0;
  const send = (command, args) =>
    new Promise((resolve) => {
      const id = ++next;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ id, command, args })}\n`);
    });
  async function call(command, args = {}) {
    const started = Date.now();
    let reply = await send(command, args);
    // The Git import is the one call that leaves the machine. A network error is tried once more, in the log; any other error is final.
    if (command === "plugin_import_git" && reply.err && NETWORK.test(reply.err)) {
      console.log(`[bridge] ${command} hit a network error, retrying the clone once: ${reply.err.split("\n").at(-1)}`);
      reply = await send(command, args);
      if (reply.err && NETWORK.test(reply.err)) log.networkFailure = reply.err;
    }
    // The app reads the catalog every second; that is not worth a line each.
    if (command !== "plugin_catalog" || reply.err) console.log(`[bridge] ${command} ${reply.err ? "failed" : "ok"} in ${((Date.now() - started) / 1000).toFixed(1)}s${reply.err ? `: ${reply.err}` : ""}`);
    if (reply.err && (command === "plugin_import_git" || command === "plugin_import_folder")) log.importErrors.push(reply.err);
    if (!reply.err) {
      if (command === "plugin_import_git" || command === "plugin_import_folder") log.previews.push(reply.ok);
      if (command === "plugin_module") log.modules.set(args.id, reply.ok);
      if (reply.ok?.catalog) log.catalogs.push(reply.ok.catalog);
    }
    return reply;
  }
  return { call, log, close: () => child.kill() };
}

/** The commands the bridge answers: the ones of the plugin manager, and no others. */
const BRIDGED = ["plugin_catalog", "plugin_import_git", "plugin_import_folder", "plugin_import_discard", "plugin_import_install", "plugin_module", "plugin_change"];

/** The bundled plugins the app's own import spec runs with. The others (Shared compute, agent activity, ...) call the desktop host, to start a
 * process or ask the network, which the web build cannot answer, and query the relay for what the fixture relay does not serve. They are
 * switched off through the manager, as Settings switches a plugin off; the plugin under test is the one this check is about. */
const BUNDLED_KEPT = ["buzz.channels", "buzz.github", "buzz.bestie", "buzz.repos", "buzz.workflows"];
async function switchOffOtherBundledPlugins(bridge) {
  const { ok } = await bridge.call("plugin_catalog");
  for (const plugin of ok.catalog.plugins) {
    if (plugin.source !== "bundled" || !plugin.enabled || BUNDLED_KEPT.includes(plugin.manifest.id)) continue;
    const reply = await bridge.call("plugin_change", { action: "disable", id: plugin.manifest.id });
    if (reply.err) throw new Error(`could not switch off ${plugin.manifest.id}: ${reply.err}`);
  }
}

/** What the desktop app's `invoke` answers, from the page: the plugin manager's commands go to the bridge, and the few the app asks at
 * start-up are answered as plugin-import.spec.mjs in the app answers them (they are not about plugins). Anything else is an error, so the
 * test sees it. */
async function routeNative(page, bridge) {
  await page.exposeFunction("__installBridge", (command, args) => bridge.call(command, args));
  await page.addInitScript((bridged) => {
    window.isTauri = true;
    let nextCallback = 0;
    const callbacks = new Map();
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback, once = false) {
        const id = ++nextCallback;
        callbacks.set(id, (value) => {
          if (once) callbacks.delete(id);
          callback?.(value);
        });
        return id;
      },
      unregisterCallback: (id) => callbacks.delete(id),
      invoke: async (command, args) => {
        if (bridged.includes(command)) {
          const reply = await window.__installBridge(command, args);
          if ("err" in reply) throw reply.err;
          return reply.ok;
        }
        if (command === "deep_link_take") return [];
        if (command === "deep_link_watch") {
          if (args.onEvent.toJSON() !== `__CHANNEL__:${args.onEvent.id}` || !callbacks.has(args.onEvent.id)) throw new Error("Invalid deep-link channel");
          return;
        }
        if (command === "app_agent_state_load") return {};
        if (command === "app_agent_state_set") return;
        if (command === "credential_pairing_communities") return;
        throw new Error(`Unexpected command ${command}`);
      },
    };
  }, BRIDGED);
}

const button = (page, name) => page.getByRole("button", { name, exact: true });

// ---- what manifest.json declares, and what the review shows ----

/** The grants the review lists, from manifest.json. Fails on a kind of grant this check does not read, so a new one cannot go unchecked. */
function declaredGrants() {
  const host = manifest.host ?? {};
  const known = ["commands", "processes", "networkOrigins", "agentHooks", "agentExecution", "publicImages", "publicPages", "mcp", "managedFiles", "files"];
  const unread = Object.keys(host).filter((key) => !known.includes(key));
  if (unread.length) throw new Error(`[review] manifest.json declares host.${unread.join(", host.")}, which install.spec.mjs does not read: add it to declaredGrants and grantOf`);
  if (host.processes?.some((process) => process.artifact || process.bundled)) throw new Error("[review] a process with `artifact` or `bundled` is not read by install.spec.mjs yet: add it to declaredGrants and grantOf");
  const flags = ["publicImages", "publicPages", "mcp", "managedFiles", "files"].filter((key) => host[key]);
  return [
    ...(host.commands ?? []).map((c) => ({
      kind: "command",
      id: c.id,
      program: c.program,
      args: c.args,
      input: c.maxInputBytes === undefined ? "none" : `up to ${c.maxInputBytes} bytes`,
      output: `up to ${c.maxOutputBytes ?? 4096} bytes`,
    })),
    ...(host.processes ?? []).map((p) => ({ kind: "process", id: p.id, program: p.program, args: p.args ?? [] })),
    ...(host.networkOrigins ?? []).map((origin) => ({ kind: "origin", origin })),
    ...(host.agentHooks ?? []).map((harness) => ({ kind: "agentHooks", harness })),
    ...(host.agentExecution ?? []).map((harness) => ({ kind: "agentExecution", harness })),
    ...flags.map((flag) => ({ kind: flag })),
  ];
}

const FLAG_LABELS = { "Public images details": "publicImages", "Public pages details": "publicPages", "MCP servers details": "mcp", "Managed files details": "managedFiles", "Files details": "files" };
/** One opened grant of the review, in the same shape as declaredGrants. */
function grantOf({ label, texts, program, args, code }) {
  const line = (prefix) => texts.find((text) => text.startsWith(prefix))?.slice(prefix.length).trim();
  let match;
  if ((match = /^Command (.+) details$/.exec(label))) return { kind: "command", id: match[1], program, args, input: line("Input:"), output: line("Output:") };
  if ((match = /^Process (.+) details$/.exec(label))) {
    if (texts.some((text) => text === "Bundled with Buzz." || text.startsWith("Executable artifact:"))) return { kind: "process-with-extras", id: match[1] };
    return { kind: "process", id: match[1], program, args };
  }
  if ((match = /^HTTPS origin (.+) details$/.exec(label))) return { kind: "origin", origin: match[1] };
  if (label === "Agent hooks details") return { kind: "agentHooks", harness: code };
  if (label === "Agent execution details") return { kind: "agentExecution", harness: code };
  if (FLAG_LABELS[label]) return { kind: FLAG_LABELS[label] };
  return { kind: "unknown", label };
}

/** Opens every grant in the review and reads it. The dialog's own text is the only source. */
async function reviewedGrants(page) {
  const scopes = page.getByRole("region", { name: "Declared scopes", exact: true });
  await expect(scopes, "[review] the review has a Declared scopes section").toBeVisible();
  const triggers = scopes.getByRole("button");
  const count = await triggers.count();
  for (let index = 0; index < count; index++) {
    const trigger = triggers.nth(index);
    // A panel that is opening moves the ones below it, and a click can land on the place the trigger has just left: click only a trigger
    // that is still closed, until it is open.
    await expect(async () => {
      if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
    }, `[review] grant ${index + 1} of ${count} opens`).toPass({ timeout: 15_000 });
  }
  const details = scopes.locator("section[aria-label$=' details']");
  await expect(details, "[review] each grant opens to its details").toHaveCount(count);
  const read = await details.evaluateAll((sections) =>
    sections.map((section) => {
      const paragraphs = [...section.querySelectorAll("p")];
      return {
        label: section.getAttribute("aria-label"),
        texts: paragraphs.map((paragraph) => paragraph.innerText.trim()),
        program: paragraphs.find((paragraph) => paragraph.textContent.startsWith("Program:"))?.querySelector("code")?.textContent,
        args: [...section.querySelectorAll('li[aria-label^="Argument "] code')].map((code) => code.textContent),
        code: section.querySelector("code")?.textContent,
      };
    }),
  );
  return read.map(grantOf);
}

const order = (grants) => grants.map((grant) => JSON.stringify(grant)).sort();

// ---- the page, as the shell lists it ----

async function searchPages(page) {
  const group = await pageChoices(page, PAGE);
  const dialog = page.getByRole("dialog", { name: "Search Buzz", exact: true });
  // Until the community connects, the palette is a placeholder with no pages in it.
  await expect(dialog.getByText("Connecting to this community…", { exact: true })).toHaveCount(0);
  return { group, close: () => page.keyboard.press("Escape") };
}
const sidebarPage = (page) => page.getByRole("navigation", { name: "Pages", exact: true }).getByRole("button", { name: PAGE, exact: true });

/** The error "Manage plugins" shows for a plugin that did not start (the runtime's own text), if there is one. */
const activationErrors = (page) => page.getByRole("region", { name: "Manage plugins", exact: true }).locator("p.error");

test("installs the committed plugin through Add, starts it, and lists its page in Search and the Messages sidebar", async ({ page, app }) => {
  const home = mkdtempSync(join(tmpdir(), "ghost-protocol-install-"));
  const bridge = startBridge(home);
  try {
    await switchOffOtherBundledPlugins(bridge);
    await routeNative(page, bridge);
    await page.setViewportSize({ width: 1300, height: 860 });
    await page.goto(app.origin);
    await expect(page.getByRole("button", { name: /^Community switcher:/ })).toBeVisible();

    await test.step("before: the page is nowhere", async () => {
      // So the two checks at the end can see an absence: they are not true of every page.
      const { group, close } = await searchPages(page);
      await expect(pageChoice(group, PAGE), "[search] before the install the page is not in Search").toHaveCount(0);
      await close();
      await expect(sidebarPage(page), "[sidebar] before the install the page is not in the sidebar").toHaveCount(0);
    });

    await test.step("Add: find the plugin in the repository, or the folder", async () => {
      await openSettings(page);
      await selectSettingsSection(page, "Manage plugins");
      await button(page, "Add").click();
      const answered = bridge.log.previews.length + bridge.log.importErrors.length;
      if (git) {
        await page.getByLabel("Git or GitHub repository").fill(git.repository);
        await page.getByLabel("Branch or tag (optional)").fill(git.reference);
        await page.getByLabel("Folder (optional)").fill(git.path);
        await button(page, "Find plugins").click();
      } else {
        await button(page, "Browse plugin folder").click();
      }
      // The importer has answered, with a preview or with what it could not read (its own limit for a clone is 60 seconds).
      await expect.poll(() => bridge.log.previews.length + bridge.log.importErrors.length, { message: "the importer answers", timeout: 90_000 }).toBeGreaterThan(answered);
      if (bridge.log.networkFailure) throw new Error(`[network] the Git importer could not reach GitHub, twice: ${bridge.log.networkFailure}`);
      if (bridge.log.importErrors.length) throw new Error(`[offered] the importer refused the source: ${bridge.log.importErrors.at(-1)}`);

      const preview = bridge.log.previews.at(-1);
      if (git) {
        expect(preview?.commit, `[commit] the importer read ${preview?.commit}, but this job checked out ${git.commit}: ${git.reference} is not at that commit (it moved after that commit was pushed, or ${git.reference} is another branch); run the job again`).toBe(git.commit);
      }
      const offered = preview?.candidates.find((candidate) => candidate.manifest.id === manifest.id);
      if (!offered) {
        const skipped = (preview?.warnings ?? []).join("; ");
        throw new Error(`[offered] "Add a plugin" does not offer ${manifest.id}. It offers: ${(preview?.candidates ?? []).map((c) => c.manifest.id).join(", ") || "nothing"}. Skipped folders: ${skipped || "none"}`);
      }
      // Several plugins offered: choose one. One plugin offered: the dialog goes straight to its review.
      const choices = page.getByRole("radiogroup", { name: "Choose a plugin" });
      await expect(choices.or(page.getByRole("dialog", { name: /^Review / })).first(), "[offered] the dialog shows a list to choose from, or the review").toBeVisible();
      if (await choices.isVisible()) {
        await choices.getByRole("radio", { name: new RegExp(`^${manifest.name}`) }).check();
        await button(page, "Continue").click();
      }
    });

    await test.step("review: exactly what manifest.json declares", async () => {
      await expect(page.getByRole("dialog", { name: /^Review / }), "[review] the review of access opens").toBeVisible();
      const declared = declaredGrants();
      const reviewed = await reviewedGrants(page);
      expect(reviewed.length, `[review] the review lists ${reviewed.length} grants, manifest.json declares ${declared.length}`).toBe(declared.length);
      expect(order(reviewed), "[review] the review lists exactly the declared commands, processes and origins, each in full (id, program, arguments)").toEqual(order(declared));
      await expect(page.getByRole("switch", { name: "Enable plugin" }), "[review] the review offers to enable the plugin").toBeChecked();
      await button(page, "Install plugin").click();
      await expect(page.getByRole("dialog", { name: /^Review / })).toHaveCount(0);
    });

    await test.step("installed, enabled and started", async () => {
      await expect
        .poll(() => bridge.log.catalogs.at(-1)?.plugins.find((plugin) => plugin.manifest.id === manifest.id)?.enabled, { message: "[installed] the plugin is enabled in the catalog", timeout: 15_000 })
        .toBe(true);
      const entry = bridge.log.catalogs.at(-1).plugins.find((plugin) => plugin.manifest.id === manifest.id);
      expect(entry.source, "[installed] it is an installed (external) plugin, not a bundled one").toBe("external");
      expect(entry.error, "[installed] the importer recorded no error for it").toBeNull();

      // The runtime fails a plugin that has not started in ten seconds, so by fifteen it has either started or said why not.
      // A started plugin shows its page in the sidebar; one that did not shows the runtime's error in "Manage plugins".
      await expect
        .poll(
          async () => {
            if (await activationErrors(page).count()) return "failed";
            return (await page.locator("nav[aria-label='Pages'] button", { hasText: PAGE }).count()) ? "listed" : "waiting";
          },
          { timeout: 15_000 },
        )
        .not.toBe("waiting")
        // Neither within fifteen seconds is an answer too (started, and no page): the checks below say what is missing, and where.
        .catch(() => {});
      const errors = await activationErrors(page).allInnerTexts();
      if (errors.length) throw new Error(`[activation] ${manifest.name} did not start: ${errors.join(" | ")}`);

      const served = bridge.log.modules.get(manifest.id);
      expect(served, "[module] the loader asked the host for the plugin's code").toBeDefined();
      expect(served === readFileSync(join(sourceDir, "plugin.js"), "utf8"), "[module] the code the host served is the plugin.js that was installed, byte for byte").toBe(true);
    });

    await test.step("its page is in Search and in the Messages sidebar", async () => {
      await closeSettings(page);
      const { group, close } = await searchPages(page);
      await expect(pageChoice(group, PAGE), "[search] the page is listed in Search's Pages").toBeVisible();
      await close();
      await expect(sidebarPage(page), "[sidebar] the page is listed in the Messages sidebar's page block").toBeVisible();
    });
  } finally {
    bridge.close();
    rmSync(home, { recursive: true, force: true });
  }
});
