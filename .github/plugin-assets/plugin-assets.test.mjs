// Tests of check.mjs: a vector for every rule (one that passes, and one for each way to fail), the check over a made-up repository, and the
// check over this one. Run: node --test .github/plugin-assets/plugin-assets.test.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { check, codeBlocks, ICON_SIZE, installable, manifestProblems, pngProblems, readmeProblems, REPOSITORY, validId } from "./check.mjs";

const repo = join(import.meta.dirname, "../..");
const has = (problems, text) => problems.some((problem) => problem.includes(text));

// ---- the manifest ----------------------------------------------------------------------------------------------------------------------

const manifest = (extra = {}) => ({ id: "megatech.example", name: "Example", apiVersion: 1, description: "What it does.", discovery: { category: "productivity", tags: ["One", "Two"] }, ...extra });

test("a manifest Buzz accepts has no problem, with or without a description and discovery", () => {
  assert.deepEqual(manifestProblems(manifest()), []);
  assert.deepEqual(manifestProblems({ id: "a", name: "A", apiVersion: 1 }), []);
  assert.deepEqual(manifestProblems(manifest({ host: { networkOrigins: [] }, updates: { defaultEnabled: true } })), []);
});

test("the manifest's keys are the seven Buzz accepts and no other", () => {
  assert.ok(has(manifestProblems(manifest({ icon: "icon.png" })), 'the key "icon"'));
  assert.ok(has(manifestProblems(manifest({ readme: "x" })), 'the key "readme"'));
  assert.ok(has(manifestProblems(null), "not an object"));
  assert.ok(has(manifestProblems([]), "not an object"));
});

test("an id is lowercase letters, digits, dots and hyphens, starting with a letter, with no empty part, at most 80 bytes", () => {
  for (const id of ["a", "megatech.vim-mode", "a1.b-2"]) assert.ok(validId(id), id);
  for (const id of ["", "A", "1a", "a..b", "a.-b", "a.", "-a", "a_b", "a b", "é", "a".repeat(81), undefined, 3]) assert.ok(!validId(id), String(id));
  assert.ok(validId("a".repeat(80)));
  assert.ok(has(manifestProblems(manifest({ id: "Bad Id" })), "the id must be"));
});

test("a name has 1 to 80 bytes of text", () => {
  assert.ok(has(manifestProblems(manifest({ name: "  " })), "the name must"));
  assert.ok(has(manifestProblems(manifest({ name: "n".repeat(81) })), "the name must"));
  assert.deepEqual(manifestProblems(manifest({ name: "n".repeat(80) })), []);
  assert.ok(has(manifestProblems(manifest({ name: "é".repeat(41) })), "the name must"), "bytes, not characters");
});

test("apiVersion is 1", () => {
  assert.ok(has(manifestProblems(manifest({ apiVersion: 2 })), "apiVersion must be 1"));
  assert.ok(has(manifestProblems(manifest({ apiVersion: "1" })), "apiVersion must be 1"));
});

test("a description has 1 to 280 bytes of text, counted in bytes", () => {
  assert.deepEqual(manifestProblems(manifest({ description: "d".repeat(280) })), []);
  assert.ok(has(manifestProblems(manifest({ description: "d".repeat(281) })), "(it has 281)"));
  assert.ok(has(manifestProblems(manifest({ description: "" })), "1-280 bytes"));
  assert.ok(has(manifestProblems(manifest({ description: " \n " })), "1-280 bytes"));
  assert.ok(has(manifestProblems(manifest({ description: 5 })), "1-280 bytes"));
  assert.deepEqual(manifestProblems(manifest({ description: "é".repeat(140) })), [], "280 bytes in 140 characters");
  assert.ok(has(manifestProblems(manifest({ description: "é".repeat(141) })), "1-280 bytes"), "282 bytes in 141 characters");
});

test("a discovery category is a valid identifier, and one of the six Buzz's Settings groups by", () => {
  for (const category of ["communication", "agents", "agent-tools", "developer-tools-and-integrations", "people-and-communities", "productivity"]) {
    assert.deepEqual(manifestProblems(manifest({ discovery: { category } })), [], category);
  }
  assert.ok(has(manifestProblems(manifest({ discovery: { category: "Not valid" } })), "valid identifier"));
  const unknown = manifestProblems(manifest({ discovery: { category: "games" } }));
  assert.ok(has(unknown, 'category "games"') && has(unknown, "Other"), "a valid slug Settings does not group by lands under Other");
  assert.deepEqual(manifestProblems(manifest({ discovery: { tags: ["Only tags"] } })), []);
  assert.ok(has(manifestProblems(manifest({ discovery: "x" })), "discovery must be an object"));
});

test("discovery tags: at most 16, each 1 to 80 bytes with no control character, no duplicate once case and spacing are folded", () => {
  const tags = (list) => manifestProblems(manifest({ discovery: { category: "productivity", tags: list } }));
  assert.deepEqual(tags(Array.from({ length: 16 }, (_, i) => `tag ${i}`)), []);
  assert.ok(has(tags(Array.from({ length: 17 }, (_, i) => `tag ${i}`)), "at most 16"));
  assert.ok(has(tags([""]), "1-80 bytes"));
  assert.ok(has(tags(["t".repeat(81)]), "1-80 bytes"));
  assert.deepEqual(tags(["t".repeat(80)]), []);
  assert.ok(has(tags(["tab\there"]), "control characters"));
  assert.ok(has(tags(["nul\u0000"]), "control characters"));
  assert.ok(has(tags(["Help desk", "help   DESK"]), "a duplicate"));
  assert.ok(has(tags("Skills"), "must be a list"));
});

// ---- icon.png --------------------------------------------------------------------------------------------------------------------------

const chunk = (type, body) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
};
/** A PNG of the given size: every pixel the same colour. Options bend one thing at a time. */
function png({ width = ICON_SIZE, height = ICON_SIZE, depth = 8, color = 6, interlace = 0, extra = [], palette = color === 3, rows } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([depth, color, 0, 0, interlace], 8);
  const bits = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color] ?? 1) * depth;
  const row = Buffer.alloc(1 + Math.ceil((width * bits) / 8));
  const raw = rows ?? Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(palette ? [chunk("PLTE", Buffer.from([0, 0, 0, 255, 255, 255]))] : []),
    ...extra.map(([type, body]) => chunk(type, body)),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("a 376 by 376 PNG without metadata has no problem, in any colour type the format allows", () => {
  assert.deepEqual(pngProblems(png()), []);
  assert.deepEqual(pngProblems(png({ color: 2 })), []);
  assert.deepEqual(pngProblems(png({ color: 0 })), []);
  assert.deepEqual(pngProblems(png({ color: 3, depth: 4 })), []);
  assert.deepEqual(pngProblems(png({ color: 6, depth: 16 })), []);
});

test("an icon that is not a PNG, is cut off or is damaged is refused", () => {
  assert.ok(has(pngProblems(Buffer.from("GIF89a")), "must be a PNG image"));
  assert.ok(has(pngProblems(Buffer.alloc(0)), "must be a PNG image"));
  const good = png();
  assert.ok(has(pngProblems(good.subarray(0, 40)), "cut off"));
  assert.ok(has(pngProblems(good.subarray(0, good.length - 12)), "no end chunk"));
  const damaged = Buffer.from(good);
  damaged[40] ^= 0xff; // a byte of the compressed data
  assert.ok(has(pngProblems(damaged), "checksum"));
  const header = Buffer.from(good);
  header[17] ^= 1; // a byte of the width: the header fails its checksum
  assert.ok(has(pngProblems(header), "checksum"));
  assert.ok(has(pngProblems(Buffer.concat([good, chunk("IEND", Buffer.alloc(0))])), "data after the end"));
});

test("a PNG whose compressed image is not the size its header says is refused", () => {
  assert.ok(has(pngProblems(png({ rows: Buffer.alloc(10) })), "not the size the header says"));
  assert.ok(has(pngProblems(png({ rows: Buffer.alloc(ICON_SIZE * (1 + ICON_SIZE * 4) + 1) })), "not the size the header says"));
  const notInflating = Buffer.concat([png().subarray(0, 8), chunk("IHDR", png().subarray(16, 29)), chunk("IDAT", Buffer.from("not zlib data")), chunk("IEND", Buffer.alloc(0))]);
  assert.ok(has(pngProblems(notInflating), "does not inflate"));
});

test("a header the format does not allow, or a palette image without a palette, is refused", () => {
  assert.ok(has(pngProblems(png({ color: 6, depth: 4 })), "not one the format allows"));
  assert.ok(has(pngProblems(png({ color: 5 })), "not one the format allows"));
  assert.ok(has(pngProblems(png({ color: 3, depth: 8, palette: false })), "without a palette"));
  const noHeader = Buffer.concat([png().subarray(0, 8), chunk("IDAT", deflateSync(Buffer.alloc(1))), chunk("IEND", Buffer.alloc(0))]);
  assert.ok(has(pngProblems(noHeader), "first chunk is not the header"));
});

test("Buzz's size limits: at most 1 MiB, 4096 pixels a side, 1,048,576 pixels", () => {
  assert.ok(has(pngProblems(Buffer.alloc(1024 * 1024 + 1)), "exceeds 1 MiB"));
  assert.ok(has(pngProblems(png({ width: 4097, height: 1, color: 0, depth: 1 })), "within 4096 pixels"));
  assert.ok(has(pngProblems(png({ width: 1, height: 4097, color: 0, depth: 1 })), "within 4096 pixels"));
  assert.ok(has(pngProblems(png({ width: 1025, height: 1025, color: 0, depth: 1 })), "1,048,576 pixels"));
  assert.ok(has(pngProblems(png({ width: 0, height: 5, color: 0, depth: 1 })), "within 4096 pixels"));
  assert.deepEqual(pngProblems(png({ width: 1024, height: 1024, color: 0, depth: 1 })).filter((p) => !p.includes(`must be ${ICON_SIZE}`)), []);
});

test("this repository's rules: 376 by 376, not interlaced, no text, date or camera chunks", () => {
  assert.ok(has(pngProblems(png({ width: 128, height: 128 })), "must be 376 by 376"));
  assert.ok(has(pngProblems(png({ width: 376, height: 375 })), "must be 376 by 376"));
  assert.ok(has(pngProblems(png({ interlace: 1 })), "must not be interlaced"));
  for (const type of ["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]) assert.ok(has(pngProblems(png({ extra: [[type, Buffer.from("x\0y")]] })), type), type);
  assert.deepEqual(pngProblems(png({ extra: [["sRGB", Buffer.from([0])], ["gAMA", Buffer.from([0, 1, 0xb8, 0x1b])], ["pHYs", Buffer.alloc(9)]] })), [], "colour and density chunks are not metadata");
});

// ---- READMEs ---------------------------------------------------------------------------------------------------------------------------

test("codeBlocks reads fenced blocks with any info string, in backticks or tildes, and not text that only looks like one", () => {
  const text = ["Text.", "", "```text", "https://example.test/a", "```", "", "~~~sh", "git clone x", "~~~", "", "    https://example.test/indented", "", "`inline`", "", "````md", "```", "inner", "```", "````"].join("\n");
  assert.deepEqual(codeBlocks(text), ["https://example.test/a", "git clone x", "```\ninner\n```"]);
  assert.deepEqual(codeBlocks("no blocks here"), []);
});

test("a README must have the install blocks, each holding exactly the one line", () => {
  const ok = Buffer.from(`## How to install\n\n\`\`\`text\n${REPOSITORY}\n\`\`\`\n\n\`\`\`text\ngood/vim\n\`\`\`\n`);
  assert.deepEqual(readmeProblems(ok, [REPOSITORY, "good/vim"]), []);
  assert.ok(has(readmeProblems(ok, [REPOSITORY, "good/linear"]), '"good/linear"'));
  assert.ok(has(readmeProblems(Buffer.from(`Enter ${REPOSITORY} as the repository.`), [REPOSITORY]), "no code block"), "an address in a sentence is not a block to copy");
  assert.ok(has(readmeProblems(Buffer.from(`\`\`\`text\n${REPOSITORY} and more\n\`\`\``), [REPOSITORY]), "no code block"));
  assert.deepEqual(readmeProblems(Buffer.from("anything"), []), []);
});

test("a README is UTF-8 and at most 256 KiB", () => {
  assert.ok(has(readmeProblems(Buffer.from([0x23, 0x20, 0xff, 0xfe])), "not valid UTF-8"));
  assert.ok(has(readmeProblems(Buffer.alloc(256 * 1024 + 1, "a")), "exceeds 256 KiB"));
  assert.deepEqual(readmeProblems(Buffer.alloc(256 * 1024, "a")), []);
  assert.deepEqual(readmeProblems(Buffer.from("é ü 日本語")), []);
});

// ---- a made-up repository --------------------------------------------------------------------------------------------------------------

const installBlocks = (name) => `## How to install\n\n\`\`\`text\n${REPOSITORY}\n\`\`\`\n\n\`\`\`text\ngood/${name}\n\`\`\`\n`;
/** The smallest repository that passes: one plugin, one exempt plugin, the top README and docs/install.md. `then` may change it. */
function made(then = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "plugin-assets-"));
  const put = (path, content) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  put("plugins/example/manifest.json", JSON.stringify(manifest()));
  put("plugins/example/plugin.js", "export const inject = []; export const apply = () => {};");
  put("plugins/example/icon.png", png());
  put("plugins/example/README.md", installBlocks("example"));
  put("assets/icons/example.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>");
  put("plugins/key-probe/manifest.json", JSON.stringify({ id: "megatech.key-probe", name: "Key probe", apiVersion: 1 }));
  put("plugins/key-probe/plugin.js", "export const apply = () => {};");
  put("plugins/key-probe/README.md", "Do not install it.\n");
  put("plugins/draft/manifest.json", JSON.stringify({ id: "megatech.draft", name: "Draft", apiVersion: 1 })); // no plugin.js: not listed by the importer
  put("README.md", installBlocks("x"));
  put("docs/install.md", installBlocks("x"));
  then({ root, put });
  return root;
}
const withRepo = (then, run) => {
  const root = made(then);
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("the importer lists a folder with a manifest.json and a plugin.js, and the check covers those", () => {
  withRepo(undefined, (root) => assert.deepEqual(installable(root), ["example", "key-probe"]));
  withRepo(undefined, (root) => assert.deepEqual(check(root), []));
});

test("a plugin with no icon, a bad icon or no source art is a problem; the exempt plugin needs none", () => {
  withRepo(({ root }) => rmSync(join(root, "plugins/example/icon.png")), (root) => assert.ok(has(check(root), "plugins/example/icon.png: is missing")));
  withRepo(({ put }) => put("plugins/example/icon.png", png({ width: 64, height: 64 })), (root) => assert.ok(has(check(root), "must be 376 by 376")));
  withRepo(({ root }) => rmSync(join(root, "assets/icons/example.svg")), (root) => assert.ok(has(check(root), "assets/icons/example.svg: is missing")));
  withRepo(({ root }) => { rmSync(join(root, "plugins/example/icon.png")); symlinkSync(join(root, "README.md"), join(root, "plugins/example/icon.png")); }, (root) => assert.ok(has(check(root), "is missing, or is not a regular file")), "a symlink is not a regular file");
  withRepo(({ put }) => put("plugins/key-probe/icon.png", Buffer.from("x")), (root) => assert.deepEqual(check(root), []));
});

test("a manifest Buzz would refuse is a problem, for the exempt plugin too", () => {
  withRepo(({ put }) => put("plugins/example/manifest.json", JSON.stringify(manifest({ description: "d".repeat(300) }))), (root) => assert.ok(has(check(root), "plugins/example/manifest.json: the description must")));
  withRepo(({ put }) => put("plugins/key-probe/manifest.json", JSON.stringify({ id: "megatech.key-probe", name: "K", apiVersion: 1, icon: "x" })), (root) => assert.ok(has(check(root), 'plugins/key-probe/manifest.json: manifest.json has the key "icon"')));
  withRepo(({ put }) => put("plugins/example/manifest.json", "{ not json"), (root) => assert.ok(has(check(root), "is not JSON")));
});

test("a plugin's README needs the address and its tag in code blocks; the exempt plugin's does not", () => {
  withRepo(({ put }) => put("plugins/example/README.md", `Enter ${REPOSITORY} in the box.\n`), (root) => assert.equal(check(root).filter((p) => p.startsWith("plugins/example/README.md")).length, 2));
  withRepo(({ put }) => put("plugins/example/README.md", installBlocks("other")), (root) => assert.ok(has(check(root), '"good/example"')));
  withRepo(({ root }) => rmSync(join(root, "plugins/example/README.md")), (root) => assert.ok(has(check(root), "plugins/example/README.md: is missing")));
  withRepo(({ put }) => put("README.md", "No blocks.\n"), (root) => assert.ok(has(check(root), "README.md: the README has no code block")));
  withRepo(({ put }) => put("docs/install.md", "No blocks.\n"), (root) => assert.ok(has(check(root), "docs/install.md: the README has no code block")));
});

test("placeholder text for a missing screenshot is a problem in any .md or .svg, unless pending.json lists the file", () => {
  const placeholder = "<svg xmlns='http://www.w3.org/2000/svg' aria-label='Artifacts: SCREENSHOT NEEDED'/>";
  withRepo(({ put }) => put("assets/cards/example.svg", placeholder), (root) => assert.ok(has(check(root), "assets/cards/example.svg: still has the placeholder")));
  withRepo(({ put }) => put("plugins/example/NOTES.md", "No screenshot of this plugin exists yet.\n"), (root) => assert.ok(has(check(root), "plugins/example/NOTES.md: still has the placeholder")));
  withRepo(({ put }) => { put("assets/cards/example.svg", placeholder); put(".github/plugin-assets/pending.json", JSON.stringify({ placeholders: ["assets/cards/example.svg"] })); }, (root) => assert.deepEqual(check(root), []));
  withRepo(({ put }) => put(".github/plugin-assets/pending.json", JSON.stringify({ placeholders: ["assets/cards/gone.svg"] })), (root) => assert.ok(has(check(root), "lists assets/cards/gone.svg, which has no placeholder text any more")));
  withRepo(({ put }) => put("node_modules/x/README.md", "SCREENSHOT NEEDED"), (root) => assert.deepEqual(check(root), []), "dependencies are not scanned");
  withRepo(({ put }) => put(".github/plugin-assets/notes.md", "SCREENSHOT NEEDED"), (root) => assert.deepEqual(check(root), []), "the check's own folder is not scanned");
});

// ---- this repository -------------------------------------------------------------------------------------------------------------------

test("every plugin folder of this repository passes", () => {
  assert.deepEqual(check(repo), []);
});

test("the exempt plugins are real folders, so a rename cannot leave an exemption behind", async () => {
  const { EXEMPT } = await import("./check.mjs");
  for (const name of Object.keys(EXEMPT)) assert.ok(installable(repo).includes(name), `${name} is not an installable plugin folder`);
});
