// Runs the bench page in headless Chromium and prints the numbers as a table (and as JSON on the last line). Not a test: it asserts
// nothing about speed, because a shared runner's numbers move. It fails only if an emulator does not finish.
//
//   node test/bench/run.mjs /path/to/block/buzz-app/checkout [megabytes] [echo samples]
//
// The checkout is only where Playwright and Chromium come from (`pnpm install` and `pnpm exec playwright install chromium` there, as for
// test/run.sh). The page is built here first: `pnpm run bench:build`. Each emulator runs alone in a fresh page, so neither warms the other.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = process.argv[2];
const megabytes = Number(process.argv[3] ?? 16);
const samples = Number(process.argv[4] ?? 200);
if (!app) throw new Error("usage: node test/bench/run.mjs /path/to/block/buzz-app [megabytes] [echo samples]");
const dist = fileURLToPath(new URL("./dist/", import.meta.url));
if (!existsSync(join(dist, "index.html"))) throw new Error("run `pnpm run bench:build` first");
const { chromium } = createRequire(resolve(app, "package.json"))("@playwright/test");

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((request, response) => {
  const path = normalize(join(dist, new URL(request.url, "http://x").pathname === "/" ? "index.html" : new URL(request.url, "http://x").pathname));
  if (!path.startsWith(dist) || !existsSync(path) || !statSync(path).isFile()) return void response.writeHead(404).end();
  response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const rows = [];
try {
  for (const kind of ["xterm", "ghostty"]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.ready === true);
    rows.push(await page.evaluate(([k, mb, n]) => window.bench(k, mb, n), [kind, megabytes, samples]));
    if (errors.length) throw new Error(`${kind}: ${errors.join("; ")}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

const names = { xterm: "xterm 6.0.0, DOM renderer (Buzz's Terminal)", ghostty: "ghostty-web 0.4.0 (this plugin)" };
const lines = [
  `Render path only, headless Chromium (${process.platform}), ${rows[0].megabytes} MB of coloured UTF-8 output in 64 KiB chunks, one task each. Relative, not a Mac.`,
  "",
  "| Emulator | Open (ms) | Time (s) | MB/s | Long tasks | Longest (ms) | Echo p50 (ms) | p95 | p99 |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${names[r.kind]} | ${r.openMs} | ${r.seconds} | ${r.mbPerSecond} | ${r.longTasks} | ${r.longestTaskMs} | ${r.echoP50} | ${r.echoP95} | ${r.echoP99} |`),
  "",
  "Echo is frame-quantized: one animation frame is about 16.7 ms.",
];
console.log(lines.join("\n"));
console.log(JSON.stringify(rows));
