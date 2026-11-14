// What a plugin folder carries besides its code, checked the way Buzz's installer checks it, plus the rules this repository adds. Run from
// the root of the repository: `node .github/plugin-assets/check.mjs`. It prints each problem and exits 1 if there is one. The tests
// (plugin-assets.test.mjs) hold a vector for every rule and run the check over this repository.
//
// Buzz's rules are mirrored from block/buzz-app at 4a87b5c (2026-11-13), `crates/plugin-manager/src/lib.rs`:
//   Manifest::validate  :206-246   MAX_README_BYTES, MAX_ICON_BYTES and the icon limits  :23-26   validate_icon  :1617-1640
//   the manifest's keys :31-45     valid_id  :350-362
// The web build CI runs does not run any of it, and neither does the load check of after-merge.yml (it reads an id, a name and apiVersion
// 1 only), so this is the only place a manifest or an icon that Buzz's installer would refuse is caught before it reaches `main`.
// `buzzodz plugin pack` would run Buzz's own validation, but the commit the tests are pinned to does not have it; when it does, the
// mirror can go.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32, inflateSync } from "node:zlib";

export const REPOSITORY = "https://github.com/0xnfrith/buzz-plugins";

// Plugins the rules do not all apply to, by folder name, with the reason. Their manifests are still checked.
export const EXEMPT = {
  "key-probe": {
    icon: "a measuring tool for the vim tests that its own manifest says not to install: an official-looking icon would invite installs",
    install: "its README says not to install it, and gives the way to do so only for the vim tests",
  },
};

const MIB = 1024 * 1024;
const MAX_ICON_BYTES = MIB; // lib.rs:24
const MAX_ICON_DIMENSION = 4096; // lib.rs:25
const MAX_ICON_PIXELS = MIB; // lib.rs:26
const MAX_README_BYTES = 256 * 1024; // lib.rs:23
// This repository's rule: the size of Buzz's own bundled icons (block/buzz-app src/bundled/*/icon.png), drawn from assets/icons/.
export const ICON_SIZE = 376;

const bytesOf = (text) => new TextEncoder().encode(text).length;
const blank = (text) => typeof text !== "string" || text.trim() === "";

// ---- the manifest: Manifest::validate -------------------------------------------------------------------------------------------------

const MANIFEST_KEYS = ["id", "name", "apiVersion", "description", "updates", "discovery", "host"]; // lib.rs:31-45, deny_unknown_fields
// Buzz's own list of categories is not a rule of the installer: an unknown but valid slug lists the plugin under "Other"
// (src/app/Settings.tsx:160-193). This is the list Buzz's Settings page groups by (src/app/plugin-categories.ts:1-11), and this
// repository's plugins use one of them so that none lands under "Other".
export const CATEGORIES = [
  "communication",
  "agents",
  "agent-tools",
  "developer-tools-and-integrations",
  "people-and-communities",
  "productivity",
];

/** valid_id, lib.rs:350-362 */
export const validId = (id) =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= 80 &&
  /^[a-z][a-z0-9.-]*$/.test(id) &&
  !id.split(/[.-]/).some((part) => part === "");

/** The problems with a parsed manifest.json, as Buzz's installer would find them, and one this repository adds (the category list). */
export function manifestProblems(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return ["manifest.json is not an object"];
  const problems = [];
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.includes(key)) problems.push(`manifest.json has the key "${key}", which Buzz rejects (it accepts ${MANIFEST_KEYS.join(", ")})`);
  }
  if (!validId(manifest.id)) problems.push("the id must be 1-80 bytes of lowercase letters, digits, dots and hyphens, starting with a letter, with no empty part");
  if (blank(manifest.name) || bytesOf(manifest.name) > 80) problems.push("the name must contain 1-80 bytes of text");
  if (manifest.apiVersion !== 1) problems.push("apiVersion must be 1");
  if ("description" in manifest && (blank(manifest.description) || bytesOf(manifest.description) > 280)) {
    problems.push(`the description must contain 1-280 bytes of text${typeof manifest.description === "string" ? ` (it has ${bytesOf(manifest.description)})` : ""}`);
  }
  const { discovery } = manifest;
  if (discovery !== undefined) {
    if (discovery === null || typeof discovery !== "object" || Array.isArray(discovery)) {
      problems.push("discovery must be an object");
    } else {
      if ("category" in discovery) {
        if (!validId(discovery.category)) problems.push("the discovery category must be a valid identifier");
        else if (!CATEGORIES.includes(discovery.category)) problems.push(`the discovery category "${discovery.category}" is not one Buzz's Settings groups by (${CATEGORIES.join(", ")}); the plugin would be listed under "Other"`);
      }
      const tags = discovery.tags ?? [];
      if (!Array.isArray(tags)) problems.push("the discovery tags must be a list");
      else {
        if (tags.length > 16) problems.push("at most 16 discovery tags");
        const seen = new Set();
        for (const tag of tags) {
          // eslint-disable-next-line no-control-regex
          if (blank(tag) || bytesOf(tag) > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(tag)) {
            problems.push("each discovery tag must contain 1-80 bytes of text without control characters");
            continue;
          }
          const key = tag.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
          if (seen.has(key)) problems.push(`the discovery tag "${tag}" is a duplicate (case and spacing do not count)`);
          seen.add(key);
        }
      }
    }
  }
  return problems;
}

// ---- icon.png: validate_icon ----------------------------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Bits per pixel by colour type, for each bit depth the format allows.
const SAMPLES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
// Chunks that carry text, dates or camera data: an icon in a public repository carries none of them.
const METADATA = ["tEXt", "zTXt", "iTXt", "eXIf", "tIME"];

/**
 * The problems with an icon.png (a Buffer): what Buzz refuses (more than 1 MiB, not a PNG that decodes, a side over 4096 or more than
 * 1,048,576 pixels) and what this repository adds (exactly 376 by 376, not interlaced, no metadata chunks). It decodes the container
 * (every chunk's CRC, the header, the palette, the end) and checks that the compressed image inflates to exactly the size the header
 * promises; it does not unfilter the pixels, so a PNG with bad filter bytes passes here and fails Buzz's decoder. The real decode is
 * Buzz's; assets/icons/render.sh, which draws every icon, is what keeps the committed PNGs safe from that.
 */
export function pngProblems(bytes) {
  if (bytes.length > MAX_ICON_BYTES) return [`icon.png exceeds 1 MiB (${bytes.length} bytes)`];
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return ["icon.png must be a PNG image"];
  const bad = (why) => [`icon.png must be a valid PNG image: ${why}`];
  let offset = 8;
  let header = null;
  let palette = false;
  let ended = false;
  const data = [];
  const metadata = [];
  for (let index = 0; offset < bytes.length; index++) {
    if (ended) return bad("data after the end chunk");
    if (offset + 12 > bytes.length) return bad("a chunk is cut off");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    if (offset + 12 + length > bytes.length) return bad(`the ${type} chunk is cut off`);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (bytes.readUInt32BE(offset + 8 + length) !== crc32(bytes.subarray(offset + 4, offset + 8 + length))) return bad(`the ${type} chunk fails its checksum`);
    if (index === 0 && type !== "IHDR") return bad("the first chunk is not the header");
    if (type === "IHDR") {
      if (index !== 0 || length !== 13) return bad("the header is not the first 13-byte chunk");
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
        compression: body[10],
        filter: body[11],
        interlace: body[12],
      };
    } else if (type === "PLTE") palette = true;
    else if (type === "IDAT") data.push(body);
    else if (type === "IEND") ended = true;
    else if (METADATA.includes(type)) metadata.push(type);
    offset += 12 + length;
  }
  if (!header) return bad("no header");
  if (!ended) return bad("no end chunk");
  const { width, height, depth, color, compression, filter, interlace } = header;
  if (!(color in SAMPLES) || !DEPTHS[color].includes(depth) || compression !== 0 || filter !== 0) return bad("the header is not one the format allows");
  if (color === 3 && !palette) return bad("a palette image without a palette");
  if (width === 0 || height === 0 || width > MAX_ICON_DIMENSION || height > MAX_ICON_DIMENSION || width * height > MAX_ICON_PIXELS) {
    return [`icon.png must be within 4096 pixels a side and 1,048,576 pixels (it is ${width} by ${height})`];
  }
  if (interlace !== 0) return ["icon.png must not be interlaced"];
  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(data));
  } catch {
    return bad("the image data does not inflate");
  }
  if (inflated.length !== height * (1 + Math.ceil((width * SAMPLES[color] * depth) / 8))) return bad("the image data is not the size the header says");
  const problems = [];
  if (width !== ICON_SIZE || height !== ICON_SIZE) problems.push(`icon.png must be ${ICON_SIZE} by ${ICON_SIZE}, the size of Buzz's own icons (it is ${width} by ${height})`);
  if (metadata.length) problems.push(`icon.png must carry no metadata chunks (it has ${[...new Set(metadata)].join(", ")})`);
  return problems;
}

// ---- READMEs ----------------------------------------------------------------------------------------------------------------------------

/** The text of every fenced code block in a Markdown file, trimmed. */
export function codeBlocks(markdown) {
  const blocks = [];
  const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^ {0,3}\1[`~]*[ \t]*$/gm;
  for (const match of markdown.matchAll(fence)) blocks.push(match[2].trim());
  return blocks;
}

/** The problems with a README's bytes. `blocks` are the code blocks it must have, each one's whole content. */
export function readmeProblems(bytes, blocks = []) {
  if (bytes.length > MAX_README_BYTES) return [`README.md exceeds 256 KiB (${bytes.length} bytes)`];
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return ["README.md is not valid UTF-8"];
  }
  const have = codeBlocks(text);
  return blocks.filter((block) => !have.includes(block)).map((block) => `the README has no code block holding exactly ${JSON.stringify(block)}`);
}

// ---- the repository ---------------------------------------------------------------------------------------------------------------------

const PLACEHOLDER = /screenshot needed|no screenshot of this plugin/i;
const SKIPPED = new Set([".git", "node_modules", "dist"]);

const regular = (path) => {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** The plugin folders Buzz's importer lists: a folder of plugins/ that has a manifest.json and a plugin.js. Names, sorted. */
export const installable = (root) =>
  readdirSync(join(root, "plugins"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => regular(join(root, "plugins", name, "manifest.json")) && regular(join(root, "plugins", name, "plugin.js")))
    .sort();

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
};

/**
 * Every problem in the repository at `root`, as "path: what is wrong" lines.
 *  - each installable plugin: a manifest Buzz accepts; unless exempt, an icon.png Buzz accepts and its source art, assets/icons/<name>.svg;
 *    a README with the code blocks that install it
 *  - README.md and docs/install.md: the code block with the repository address
 *  - no placeholder text for a missing screenshot in any .md or .svg, except where .github/plugin-assets/pending.json lists the file as
 *    still waiting, and a file listed there that no longer has a placeholder is a problem too, so the list shrinks to nothing
 */
export function check(root) {
  const problems = [];
  const add = (path, list) => list.forEach((why) => problems.push(`${path}: ${why}`));
  const file = (path) => readFileSync(join(root, path));
  const address = [REPOSITORY];

  for (const name of installable(root)) {
    const folder = `plugins/${name}`;
    let manifest;
    try {
      manifest = readJson(join(root, folder, "manifest.json"));
    } catch (error) {
      add(`${folder}/manifest.json`, [`is not JSON (${error.message})`]);
    }
    if (manifest !== undefined) add(`${folder}/manifest.json`, manifestProblems(manifest));
    const exempt = EXEMPT[name] ?? {};
    if (!exempt.icon) {
      if (!regular(join(root, folder, "icon.png"))) add(`${folder}/icon.png`, ["is missing, or is not a regular file"]);
      else add(`${folder}/icon.png`, pngProblems(file(`${folder}/icon.png`)));
      if (!regular(join(root, "assets/icons", `${name}.svg`))) add(`assets/icons/${name}.svg`, ["is missing: it is the source art of the plugin's icon (assets/icons/render.sh draws the PNG from it)"]);
    }
    if (!regular(join(root, folder, "README.md"))) add(`${folder}/README.md`, ["is missing"]);
    else add(`${folder}/README.md`, readmeProblems(file(`${folder}/README.md`), exempt.install ? [] : [...address, `good/${name}`]));
  }
  for (const path of ["README.md", "docs/install.md"]) {
    if (!regular(join(root, path))) add(path, ["is missing"]);
    else add(path, readmeProblems(file(path), address));
  }

  let pending = [];
  try {
    ({ placeholders: pending } = readJson(join(root, ".github/plugin-assets/pending.json")));
  } catch {
    pending = [];
  }
  const found = new Set();
  for (const path of walk(root)) {
    const name = relative(root, path).split("\\").join("/");
    if (!/\.(md|svg)$/.test(name) || name.startsWith(".github/plugin-assets/")) continue;
    if (PLACEHOLDER.test(readFileSync(path, "utf8"))) found.add(name);
  }
  for (const name of found) if (!pending.includes(name)) problems.push(`${name}: still has the placeholder text of a screenshot that was never made`);
  for (const name of pending) if (!found.has(name)) problems.push(`.github/plugin-assets/pending.json: lists ${name}, which has no placeholder text any more: take it off the list`);
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = check(process.cwd());
  for (const problem of problems) console.error(`::error::${problem}`);
  console.log(problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"}.` : "Every plugin folder passes.");
  process.exit(problems.length ? 1 : 0);
}
