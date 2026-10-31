// Writes the declared program into manifest.json: `sh -c <main.sh> skills <skill.awk>`. The text of the program is these two files, and
// nothing else: the README prints them, and test/script.test.mjs fails when the manifest is not what this script would write.
//   node plugins/agent-skills-highlighter/reader/build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const here = new URL(".", import.meta.url);
const read = (name) => readFileSync(new URL(name, here), "utf8");
const manifestUrl = new URL("../manifest.json", here);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
manifest.host.commands[0].args = ["-c", read("main.sh"), "skills", read("skill.awk")];
writeFileSync(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
