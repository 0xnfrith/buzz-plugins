// What the build and the tests both need from the one dependency that ships in plugin.js, checked on the way in: if the package on disk is
// not the one this plugin was written against, nothing that imports this runs. See pins.mjs.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { GHOSTTY_WEB, WASM_SHA256 } from "./pins.mjs";

const packageDir = dirname(createRequire(import.meta.url).resolve("ghostty-web/ghostty-vt.wasm"));

// ghostty-web ships its LICENSE in the package; the build reads it from there and puts it at the top of plugin.js. MIT asks for the notice
// in copies of the software, and the bundle carries the package's JavaScript and its WASM.
export const license = readFileSync(join(packageDir, "LICENSE"), "utf8").trim();
const info = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
if (info.name !== "ghostty-web" || info.version !== GHOSTTY_WEB) throw new Error(`Expected ghostty-web ${GHOSTTY_WEB}, found ${info.version}`);
if (info.license !== "MIT" || !/^MIT License\n\nCopyright \(c\) 2025 Coder\n/.test(license) || !license.includes("Permission is hereby granted"))
  throw new Error("The LICENSE in the ghostty-web package is not the MIT licence this build was written for: read it, then update THIRD_PARTY_NOTICES.md");

export const wasmBytes = readFileSync(join(packageDir, "ghostty-vt.wasm"));
const wasm = createHash("sha256").update(wasmBytes).digest("hex");
if (wasm !== WASM_SHA256) throw new Error(`ghostty-vt.wasm is ${wasm}, not the ${WASM_SHA256} this build pins`);

const WASM_MODULE = "ghostty-web/ghostty-vt.wasm?inline";

/** A vite plugin: `import url from "ghostty-web/ghostty-vt.wasm?inline"` is the WASM as a data: URL, from the file whose hash was just checked. */
export const inlineWasm = () => ({
  name: "inline-wasm",
  enforce: "pre",
  resolveId: (id) => (id === WASM_MODULE ? `\0${WASM_MODULE}` : null),
  load: (id) => (id === `\0${WASM_MODULE}` ? `export default ${JSON.stringify(`data:application/wasm;base64,${wasmBytes.toString("base64")}`)};` : null),
});
