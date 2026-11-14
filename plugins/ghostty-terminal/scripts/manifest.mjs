// Writes manifest.json from src/bridge.py. The bridge text is the one thing the install review shows for this plugin's process, so
// it lives in one readable file and is copied, byte for byte, into the process's arguments; nothing is minified, compressed or encoded.
//
// Buzz allows 1024 bytes in one argument (crates/plugin-manager/src/lib.rs, valid_program) and python's -c takes one code string. The
// bridge is longer than that, so it is cut at a blank line into two arguments and a fixed loader joins exactly those two:
//   python3 -I -c "import sys;exec(sys.argv[1]+sys.argv[2])" <first half> <second half>
// Buzz appends the caller's arguments after these, so the loader reads two and ignores the rest, and the bridge never reads sys.argv.
// -I is python's isolated mode: no current directory, no PYTHONPATH and no user site on the import path.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LIMIT = 1024; // bytes in one argument
// Not child_process.exec: this is python source held in a string and written to manifest.json; this script runs no command. Python's exec
// there joins the two manifest arguments the review shows in full; it never reads the caller's arguments, which come after them.
export const LOADER = "import sys;exec(sys.argv[1]+sys.argv[2])";

export const description =
  "A Ghostty terminal in a channel drawer: a login shell with the channel's Buzz context in its environment. Prototype for testing; not offered for install yet.";

/** The process arguments for a bridge source: the whole source if it fits one argument, else the loader and its two halves. */
export function bridgeArgs(source) {
  if (!/^[\x0a\x20-\x7e]*$/.test(source)) throw new Error("bridge.py must be plain ASCII: the review shows it as is");
  if (source.length <= LIMIT) return ["-I", "-c", source];
  let cut = -1;
  for (let at = source.indexOf("\n\n"); at !== -1 && at + 2 <= LIMIT; at = source.indexOf("\n\n", at + 1)) cut = at + 2;
  if (cut === -1) throw new Error("bridge.py has no blank line to cut at within its first 1024 bytes");
  const halves = [source.slice(0, cut), source.slice(cut)];
  if (halves[1].length > LIMIT) throw new Error(`bridge.py is too long: its second half is ${halves[1].length} bytes, the limit is ${LIMIT}`);
  return ["-I", "-c", LOADER, ...halves];
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
