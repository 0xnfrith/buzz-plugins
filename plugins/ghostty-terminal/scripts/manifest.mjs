// Writes manifest.json from src/bridge.py. The bridge text is the one thing the install review shows for this plugin's process, so
// it lives in one readable file and is copied, byte for byte, into the process's arguments; nothing is minified, compressed or encoded.
//
// Buzz allows 1024 bytes in one argument (crates/plugin-manager/src/lib.rs, valid_program) and python's -c takes one code string. The
// bridge is longer than that, so it is cut at blank lines into at most three arguments, and a fixed loader joins exactly those:
//   python3 -I -c "import sys;exec(sys.argv[1]+sys.argv[2]+sys.argv[3])" <first> <second> <third>
// Buzz appends the caller's arguments after these, so the loader reads three and ignores the rest, and the bridge never reads sys.argv.
// -I is python's isolated mode: no current directory, no PYTHONPATH and no user site on the import path.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LIMIT = 1024; // bytes in one argument
export const MAX_SLICES = 3; // the review shows each one in full: more than this is too much to read

// Not child_process.exec: this is python source held in a string and written to manifest.json; this script runs no command. Python's exec
// there joins the manifest arguments the review shows in full, by fixed index; it never reads the caller's arguments, which come after them.
export const loaderFor = (slices) => `import sys;exec(${Array.from({ length: slices }, (_, at) => `sys.argv[${at + 1}]`).join("+")})`;

export const description =
  "A Ghostty terminal in a channel drawer: a login shell with the channel's Buzz context in its environment. Prototype for testing; not offered for install yet.";

/** The process arguments for a bridge source: the whole source if it fits one argument, else a loader and the slices it joins. */
export function bridgeArgs(source) {
  if (!/^[\x0a\x20-\x7e]*$/.test(source)) throw new Error("bridge.py must be plain ASCII: the review shows it as is");
  if (source.length <= LIMIT) return ["-I", "-c", source];
  const slices = [];
  let rest = source;
  while (rest.length > LIMIT) {
    // The longest start of what is left that ends at a blank line and fits one argument.
    let cut = -1;
    for (let at = rest.indexOf("\n\n"); at !== -1 && at + 2 <= LIMIT; at = rest.indexOf("\n\n", at + 1)) cut = at + 2;
    if (cut === -1) throw new Error(`bridge.py has no blank line to cut at within ${LIMIT} bytes, after ${slices.length} slices`);
    slices.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  slices.push(rest);
  if (slices.length > MAX_SLICES) throw new Error(`bridge.py is too long: it needs ${slices.length} arguments of at most ${LIMIT} bytes, and ${MAX_SLICES} is the most the review should show`);
  return ["-I", "-c", loaderFor(slices.length), ...slices];
}

export function buildManifest(source) {
  return {
    id: "megatech.ghostty-terminal",
    name: "Ghostty terminal",
    apiVersion: 1,
    description,
    discovery: { category: "developer-tools-and-integrations", tags: ["Terminal", "Ghostty", "Shell"] },
    host: { processes: [{ id: "pty", program: "python3", args: bridgeArgs(source) }] },
  };
}

export const render = (source) => `${JSON.stringify(buildManifest(source), null, 2)}\n`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const here = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));
  writeFileSync(here("manifest.json"), render(readFileSync(here("src/bridge.py"), "utf8")));
}
