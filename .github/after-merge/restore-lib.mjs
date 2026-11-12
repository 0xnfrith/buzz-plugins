// What restore-plugin.mjs builds a restore with, kept apart so that restore-plugin.test.mjs can test the check on the commit it builds.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitOut } from "./lib.mjs";

export const REMOTE = "origin";
export const BASE = "main";

/** Something that stops the restore on purpose: reported as "refused", exit 1. */
export class Refusal extends Error {}
export const refuse = (message) => {
  throw new Refusal(message);
};
export const folderOf = (name) => `plugins/${name}`;
/** The id of an object in a commit, or null when the commit has no such path. */
export const objectAt = (commit, path) => {
  const result = git("rev-parse", "--verify", "--quiet", `${commit}:${path}`);
  return result.status === 0 ? result.stdout.trim() : null;
};
/**
 * One commit on top of mainSha whose tree is mainSha's with plugins/<name>/ replaced by the tag's. Built in a temporary index with
 * git's plumbing, so the working tree, the index and the branches of this clone are not touched. Returns the commit's id.
 */
export const build = ({ name, tagSha, mainSha, title }) => {
  const folder = folderOf(name);
  const dir = mkdtempSync(join(tmpdir(), "restore-plugin-"));
  const saved = process.env.GIT_INDEX_FILE;
  process.env.GIT_INDEX_FILE = join(dir, "index");
  try {
    gitOut("read-tree", mainSha);
    gitOut("rm", "-r", "-q", "-f", "--cached", "--ignore-unmatch", "--", folder);
    gitOut("read-tree", `--prefix=${folder}/`, `${tagSha}:${folder}`);
    const tree = gitOut("write-tree").trim();
    return gitOut("commit-tree", tree, "-p", mainSha, "-m", title, "-m", `Restores ${folder}/ to what it was at good/${name} (${tagSha}), on top of ${REMOTE}/${BASE} (${mainSha}). Nothing outside the folder changes.`).trim();
  } finally {
    if (saved === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = saved;
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Throws a Refusal unless the commit is exactly what the restore promises. Nothing has been pushed yet when this runs. */
export const verify = ({ name, commit, tagSha, mainSha }) => {
  const folder = folderOf(name);
  if (gitOut("rev-parse", `${commit}^`).trim() !== mainSha) refuse(`the commit built is not on top of ${REMOTE}/${BASE}: nothing was pushed`);
  if (objectAt(commit, folder) !== objectAt(tagSha, folder)) refuse(`${folder}/ in the commit built is not the same as at good/${name}: nothing was pushed`);
  const changed = gitOut("diff-tree", "-r", "-z", "--name-only", "--no-renames", mainSha, commit).split("\0").filter(Boolean);
  const outside = changed.filter((path) => path !== folder && !path.startsWith(`${folder}/`));
  if (outside.length) refuse(`the commit built changes files outside ${folder}/ (${outside.slice(0, 3).join(", ")}): nothing was pushed`);
};
