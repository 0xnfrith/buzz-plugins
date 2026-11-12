// A check that cannot fail proves nothing. This runs the load check (run.sh) on a made-up plugin that is fine and on copies of it, each
// broken in one way a real plugin could be, and fails unless the fine one passes and every broken one fails. The scripts that decide
// what is tagged trust the result of the load check, so this is what keeps that result honest.
//
//   node .github/after-merge/load-check/canary.mjs /path/to/block/buzz-app/checkout
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = process.argv[2];
if (!app) {
  console.error("usage: node canary.mjs <block/buzz-app checkout>");
  process.exit(2);
}
const run = join(dirname(fileURLToPath(import.meta.url)), "run.sh");

// The plugin that is fine: a page with a heading. `apply` takes the context as `ctx`; the broken ones change one thing.
const fine = (page = `() => h("h1", null, "Canary page")`, before = "", inject = `["react", "pages"]`) => `export const inject = ${inject};
export function apply(ctx) {
  const h = ctx.react.createElement;
  ${before}
  ctx.pages.register({ id: "page", title: "Canary page", primary: true, component: ${page} });
}
`;
const plugins = {
  "canary-fine": fine(),
  "canary-throws-at-load": `throw new Error("canary: thrown while the module loads");\n${fine()}`,
  "canary-syntax-error": `${fine()}\nthis is not javascript\n`,
  "canary-apply-throws": fine(undefined, `throw new Error("canary: thrown in apply");`),
  "canary-apply-rejects": fine().replace("export function apply", "export async function apply").replace("const h", "await Promise.resolve();\n  const h").replace("  ctx.pages.register", `  throw new Error("canary: rejected in apply");\n  ctx.pages.register`),
  "canary-missing-service": fine(undefined, "", `["react", "pages", "no-such-service"]`),
  "canary-page-throws": fine(`() => { throw new Error("canary: thrown while the page renders"); }`),
  "canary-page-blank": fine(`() => null`),
  "canary-console-error": fine(undefined, `console.error("canary: logged an error");`),
  "canary-late-error": fine(undefined, `setTimeout(() => { throw new Error("canary: thrown later"); }, 200);`),
  "canary-unhandled-rejection": fine(undefined, `Promise.reject(new Error("canary: nobody catches this"));`),
  "canary-no-manifest-id": fine(),
};
// Each plugin's manifest.json: the same for all but the last, which has no id.
const manifestOf = (name) => (name === "canary-no-manifest-id" ? { name: "Canary", apiVersion: 1 } : { id: `canary.${name}`, name: "Canary", apiVersion: 1 });

const dir = mkdtempSync(join(tmpdir(), "load-check-canary-"));
try {
  for (const [name, text] of Object.entries(plugins)) {
    mkdirSync(join(dir, "plugins", name), { recursive: true });
    writeFileSync(join(dir, "plugins", name, "plugin.js"), text);
    writeFileSync(join(dir, "plugins", name, "manifest.json"), JSON.stringify(manifestOf(name)));
  }
  const results = join(dir, "results.json");
  spawnSync(run, [app, ...Object.keys(plugins)], { stdio: "inherit", env: { ...process.env, LOAD_CHECK_PLUGINS_DIR: join(dir, "plugins"), LOAD_CHECK_RESULTS: results } });
  const { passed, failed } = JSON.parse(readFileSync(results, "utf8"));
  const expectedPassed = ["canary-fine"];
  const expectedFailed = Object.keys(plugins).filter((name) => name !== "canary-fine");
  const wrong = [
    ...expectedPassed.filter((name) => !passed.includes(name)).map((name) => `${name} should have passed and did not`),
    ...expectedFailed.filter((name) => !failed.includes(name)).map((name) => `${name} should have failed and did not`),
  ];
  if (wrong.length) {
    for (const line of wrong) console.error(`::error::${line}`);
    process.exit(1);
  }
  console.log(`The canary holds: ${expectedPassed.join(", ")} passed, and ${expectedFailed.length} broken plugins failed.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
