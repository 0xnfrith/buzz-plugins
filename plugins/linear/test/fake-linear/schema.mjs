import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildSchema } from "graphql";

const here = new URL(".", import.meta.url).pathname;

/** Linear's published schema, fetched on first use (see fetch-schema.sh). */
export function loadSchema() {
  execFileSync(`${here}fetch-schema.sh`, { stdio: "inherit" });
  return buildSchema(readFileSync(`${here}schema.graphql`, "utf8"), { assumeValid: false });
}
