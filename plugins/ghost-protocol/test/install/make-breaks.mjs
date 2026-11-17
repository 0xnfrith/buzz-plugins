// Makes the copies of the committed GHOST Protocol plugin that breaks.sh installs: one that is not broken (the control), and one for each way
// a plugin can fail to install or to show up. Each copy is the committed plugin.js and manifest.json (and the files beside them) with one
// change, made on the built file as it is committed. A change that does not apply, or applies twice, stops the script: a break that changes
// nothing would pass the check it is meant to fail.
//
//   node make-breaks.mjs <the plugin's folder> <an empty folder to write the copies in>
//
// Prints one line for each copy: its name, then the text the check's failure must contain (a regular expression), or "-" for the control.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [source, out] = process.argv.slice(2);
if (!source || !out) {
  console.error("usage: node make-breaks.mjs <plugin folder> <output folder>");
  process.exit(2);
}
const original = { js: readFileSync(join(source, "plugin.js"), "utf8"), manifest: JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")) };

/** `text` with the one place `from` stands replaced by `to`. */
function once(text, from, to, what) {
  const places = text.split(from).length - 1;
  if (places !== 1) throw new Error(`${what}: expected one place for ${JSON.stringify(from)} in plugin.js, found ${places}: the built file changed; update make-breaks.mjs`);
  return text.replace(from, () => to);
}
const manifestWith = (change) => {
  const manifest = structuredClone(original.manifest);
  change(manifest);
  return manifest;
};

const breaks = [
  { name: "control", expect: "-" },
  {
    name: "apply-throws",
    js: once(original.js, "function apply(ctx) {", 'function apply(ctx) {\n\tthrow new Error("deliberate break: apply throws");', "apply-throws"),
    // The runtime's own text for a plugin whose apply threw, shown under it in "Manage plugins".
    expect: String.raw`\[activation\] GHOST Protocol did not start: .*deliberate break: apply throws`,
  },
  {
    name: "missing-service",
    js: once(original.js, 'var inject = [\n\t"react",', 'var inject = [\n\t"no-such-service",\n\t"react",', "missing-service"),
    // Cordis never starts a plugin whose service is missing; the runtime gives up after ten seconds.
    expect: String.raw`\[activation\] GHOST Protocol did not start: .*Plugin activation timed out`,
  },
  {
    name: "unknown-host-key",
    manifest: manifestWith((manifest) => (manifest.host.unknownGrant = true)),
    // The importer's own refusal of the manifest: the plugin is skipped, so the dialog has nothing to offer.
    expect: String.raw`\[offered\] .*does not offer megatech\.ghost-protocol.*unknown field`,
  },
  {
    name: "extra-process",
    manifest: manifestWith((manifest) => manifest.host.processes.push({ id: "extra", program: "docker", args: ["system", "prune"] })),
    // The review lists one grant more than the committed manifest declares.
    expect: String.raw`\[review\] the review lists [0-9]+ grants, manifest\.json declares [0-9]+`,
  },
  {
    name: "changed-argument",
    manifest: manifestWith((manifest) => manifest.host.processes.find((process) => process.id === "rm").args.push("--volumes")),
    // The same number of grants, one of them with another argument.
    expect: String.raw`\[review\] the review lists exactly the declared`,
  },
  {
    name: "no-page",
    js: once(original.js, "ctx.pages.register({", "void ({", "no-page"),
    // apply finishes and the plugin is active, and no page is registered.
    expect: String.raw`\[search\] the page is listed in Search`,
  },
  {
    name: "not-primary",
    js: once(original.js, "primary: true,", "primary: false,", "not-primary"),
    // A page that is not primary has no way in: it is in neither Search nor the sidebar.
    expect: String.raw`\[search\] the page is listed in Search`,
  },
  {
    name: "dock-placement",
    js: once(original.js, "primary: true,", 'primary: true,\n\t\tplacement: "dock",', "dock-placement"),
    // Listed in Search, but placed in the dock and not in the Messages sidebar's page block.
    expect: String.raw`\[sidebar\] the page is listed in the Messages sidebar`,
  },
];

mkdirSync(out, { recursive: true });
for (const item of breaks) {
  const folder = join(out, item.name);
  mkdirSync(folder);
  // The files beside manifest.json and plugin.js that the importer reads too.
  for (const file of ["README.md", "icon.png", "LICENSE"]) if (existsSync(join(source, file))) copyFileSync(join(source, file), join(folder, file));
  writeFileSync(join(folder, "plugin.js"), item.js ?? original.js);
  writeFileSync(join(folder, "manifest.json"), `${JSON.stringify(item.manifest ?? original.manifest, null, 2)}\n`);
  console.log(`${item.name}\t${item.expect}`);
}
