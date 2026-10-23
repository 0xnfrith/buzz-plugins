// After `vite build`: put the built module where the app installs it from, next to manifest.json.
import { copyFileSync } from "node:fs";

copyFileSync("dist/plugin.js", "plugin.js");
console.log("plugin.js written");
