// What select.mjs and tag.mjs share: running git, and the importer's rule for which plugin folders are installable.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export const ZERO = "0".repeat(40);
// A commit, spelled out. Anything else (a branch name, an option, the zero commit of a new or deleted branch) is not one.
export const COMMIT = /^[0-9a-f]{40}$/;
// A plugin folder name, which becomes part of a tag name (good/<name>) and of a path. Anything else is refused, never quoted.
export const NAME = /^[a-z0-9][a-z0-9-]*$/;
export const tagRef = (name) => `refs/tags/good/${name}`;

/** Runs git in the current folder; returns { status, stdout, stderr }. */
export const git = (...args) => {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};
/** Runs git and returns its output; throws if it fails. */
export const gitOut = (...args) => {
  const result = git(...args);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
};
export const isCommit = (sha) => COMMIT.test(sha ?? "") && sha !== ZERO && git("cat-file", "-e", `${sha}^{commit}`).status === 0;
export const isAncestor = (older, newer) => git("merge-base", "--is-ancestor", older, newer).status === 0;
/** The commit a local tag points at, or null. */
export const localTag = (name) => {
  const result = git("rev-parse", "--verify", "--quiet", `${tagRef(name)}^{commit}`);
  return result.status === 0 ? result.stdout.trim() : null;
};

/**
 * The plugin folders the Git importer lists at a commit: a folder directly under plugins/ with a manifest.json and a plugin.js beside
 * it, both regular files. Returns { names, refused }: the names that are safe to use in a tag, and the folder names that are not.
 */
export const installable = (commit) => {
  const folders = gitOut("ls-tree", "-z", "--name-only", "-d", commit, "plugins/")
    .split("\0")
    .filter(Boolean)
    .map((path) => path.slice("plugins/".length));
  const names = [];
  const refused = [];
  for (const folder of folders) {
    const files = gitOut("ls-tree", "-z", commit, "--", `plugins/${folder}/manifest.json`, `plugins/${folder}/plugin.js`)
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.split("\t")[0].split(" "))
      .filter(([mode, type]) => type === "blob" && /^100(644|755)$/.test(mode));
    if (files.length !== 2) continue;
    (NAME.test(folder) ? names : refused).push(folder);
  }
  return { names: names.sort(), refused: refused.sort() };
};

/** Appends `name=value` to the file GitHub Actions reads step outputs from, when there is one. */
export const output = (name, value) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};
/** Appends a line of Markdown to the step summary, when there is one. */
export const summary = (text) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
};
/** A name as it is shown in a log and a table row: one line, no | to break a row. */
export const shown = (text) => String(text).replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|");
