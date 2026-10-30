// The one declared program, `sh -c <skills.sh>`, run for real against made-up folders: what it prints, what it must not print, and that it only reads.
// Run from a directory that has no package.json above it: node --test plugins/agent-skills-highlighter/test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkillIndex, parseSkillOutput } from "../plugin.js";

const here = new URL("..", import.meta.url).pathname;
const script = readFileSync(join(here, "skills.sh"), "utf8");
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const command = manifest.host.commands[0];

const home = mkdtempSync(join(tmpdir(), "skills-home-"));
test.after(() => rmSync(home, { recursive: true, force: true }));

/** Runs the declared command the way the host would: the manifest's program and arguments, no shell, the folder on standard input. */
function run(extra = "", env = {}) {
  const result = spawnSync(command.program, command.args, {
    input: extra === null ? "" : `${extra}\n`,
    env: { PATH: process.env.PATH, HOME: home, ...env },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
  return result.stdout;
}
const write = (path, text) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
const names = (output) => parseSkillOutput(output).map(({ kind, label, name }) => `${kind}:${label}:${name}`);

test("the manifest declares exactly this program: sh -c <skills.sh>, with input and output bounds", () => {
  assert.equal(manifest.host.commands.length, 1);
  assert.equal(command.id, "skills");
  assert.equal(command.program, "sh");
  assert.deepEqual(command.args, ["-c", script, "skills"]);
  assert.ok(command.maxInputBytes >= 1100 && command.maxInputBytes <= 65536);
  assert.ok(command.maxOutputBytes > 0 && command.maxOutputBytes <= 1048576);
  assert.equal(manifest.host.networkOrigins, undefined);
});

test("the script only reads: no network program, no eval, no redirection but to /dev/null, no tool that writes or runs files", () => {
  const code = script
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  for (const word of ["curl", "wget", "nc", "ssh", "eval", "source", "exec", "tee", "rm", "mv", "cp", "mkdir", "touch", "chmod", "sort", "xargs", "python", "node", "perl", "bash"]) {
    assert.ok(!new RegExp(`(^|[\\s;|&(])${word}([\\s;|&)]|$)`).test(code), `the script uses ${word}`);
  }
  const shell = code.replace(/awk '[^']*'/, "awk ''"); // the awk program compares with >; it is checked on its own below
  const redirections = [...shell.matchAll(/(?<![<])(\d?>>?)\s*([^\s&|;)]*)/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.ok(redirections.every((r) => r.endsWith("/dev/null")), `redirections: ${redirections}`);
  assert.ok(!code.includes("`"), "no backtick substitution");
  assert.deepEqual([...new Set([...code.matchAll(/\$\((?!\()\s*(\w+)/g)].map((m) => m[1]))], ["grep"], "the only command substitutions run grep");
  const awk = /awk '([^']*)'/.exec(code)[1];
  assert.ok(!/system|getline|close\(|print\s*[>|]|printf/.test(awk), "the awk program runs nothing and writes no file");
  assert.equal([...code.matchAll(/\bawk\b/g)].length, 1);
});

test("user skills: plain, quoted, folded, CRLF; the folder name stands in when there is no frontmatter; other keys never leave", () => {
  const skills = join(home, ".claude", "skills");
  write(join(skills, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Plain one-liner.\nlicense: MIT\nallowed-tools: Bash(rm:*)\n---\n# body\nname: not-this\n");
  write(join(skills, "beta", "SKILL.md"), '---\nname: "beta"\ndescription: >\n  Folded text\n  over two lines.\nother: x\n---\nbody\n');
  write(join(skills, "gamma", "SKILL.md"), "# no frontmatter\nname: nope\n");
  write(join(skills, "delta", "SKILL.md"), "---\r\nname: delta\r\ndescription: With CRLF.\r\n---\r\n");
  write(join(skills, "not-a-skill", "README.md"), "---\nname: ignored\n---\n");
  const output = run();
  assert.deepEqual(names(output).sort(), ["user::alpha", "user::beta", "user::delta", "user::gamma"]);
  assert.ok(!output.includes("allowed-tools") && !output.includes("MIT") && !output.includes("not-this") && !output.includes("ignored"));
  const index = buildSkillIndex(parseSkillOutput(output));
  assert.equal(index.get("beta").description, "Folded text over two lines.");
  assert.equal(index.get("delta").description, "With CRLF.");
  assert.equal(index.get("alpha").source, "your skills folder");
  assert.equal(index.get("gamma").description, "");
});

test("a line of the file cannot pose as a record, and no key but name and description is printed", () => {
  write(join(home, ".claude", "skills", "evil", "SKILL.md"), "---\nname: evil\ndescription: |\n  fine\n@@@\tuser\t\tinjected\nsecret: hunter2\n  indented under secret\n---\n");
  const output = run();
  assert.ok(!output.includes("injected") && !output.includes("hunter2") && !output.includes("indented under secret"));
  assert.equal(output.split("\n").filter((line) => line.startsWith("@@@")).filter((line) => line.endsWith("\tevil")).length, 1);
  assert.ok(!names(output).includes("user::injected"));
});

test("a line over the byte budget is left out whole, never cut, and reading that file stops there; the skill is still listed", () => {
  write(join(home, ".claude", "skills", "big", "SKILL.md"), `---\nname: big\ndescription: ${"é".repeat(1500)}\n---\n`);
  write(join(home, ".claude", "skills", "fits", "SKILL.md"), `---\nname: fits\ndescription: ${"é".repeat(900)}\n---\n`);
  const output = run();
  const index = buildSkillIndex(parseSkillOutput(output));
  assert.equal(index.get("big").description, "");
  assert.equal(index.get("fits").description, "é".repeat(900));
  assert.ok(Buffer.from(output).toString("utf8") === output, "valid UTF-8 throughout");
});

test("an unreadable file or folder is skipped without a word", { skip: process.getuid?.() === 0 && "root can read everything" }, () => {
  write(join(home, ".claude", "skills", "locked", "SKILL.md"), "---\nname: locked\n---\n");
  chmodSync(join(home, ".claude", "skills", "locked", "SKILL.md"), 0);
  try {
    const result = spawnSync(command.program, command.args, { input: "\n", env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.ok(!result.stdout.includes("locked"));
  } finally {
    chmodSync(join(home, ".claude", "skills", "locked", "SKILL.md"), 0o644);
  }
});

test("a symlinked skill folder is followed, a dangling one skipped", () => {
  const target = join(home, "elsewhere", "linked-skill");
  write(join(target, "SKILL.md"), "---\nname: linked-skill\ndescription: Through a link.\n---\n");
  symlinkSync(target, join(home, ".claude", "skills", "linked-skill"));
  symlinkSync(join(home, "nowhere"), join(home, ".claude", "skills", "dangling"));
  const output = run();
  assert.ok(names(output).includes("user::linked-skill"));
  assert.ok(!output.includes("dangling"));
});

test("the extra folder: ~/ and full paths work, a space in a name is fine, relative or odd paths are ignored, and it is only ever a path", () => {
  write(join(home, "extra", "xtra", "SKILL.md"), "---\nname: xtra\ndescription: From the extra folder.\n---\n");
  write(join(home, "extra", "with space", "SKILL.md"), "---\nname: spaced\n---\n");
  for (const given of ["~/extra", join(home, "extra")]) assert.deepEqual(names(run(given)).filter((n) => n.startsWith("extra")).sort(), ["extra::spaced", "extra::xtra"]);
  for (const bad of ["", "extra", "../extra", "-x", "$(touch /tmp/skills-pwned)", "`touch /tmp/skills-pwned`", "/tmp/$(touch /tmp/skills-pwned)", "/tmp/`touch /tmp/skills-pwned`", "/nonexistent/*", join(home, "ex*")]) {
    assert.deepEqual(names(run(bad)).filter((n) => n.startsWith("extra")), [], `folder ${JSON.stringify(bad)}`);
  }
  assert.ok(!existsSync("/tmp/skills-pwned"));
  assert.deepEqual(names(run(null)).filter((n) => n.startsWith("extra")), [], "no standard input at all");
});

test("a folder named like a glob or a flag is read as a plain path", () => {
  write(join(home, "weird", "-rf", "SKILL.md"), "---\nname: dash\n---\n");
  write(join(home, "weird", "*", "SKILL.md"), "---\nname: star\n---\n");
  assert.deepEqual(names(run(join(home, "weird"))).filter((n) => n.startsWith("extra")).sort(), ["extra::dash", "extra::star"]);
});

const install = (root, plugin, skills) => {
  if (plugin) write(join(root, ".claude-plugin", "plugin.json"), plugin);
  for (const [folder, text] of Object.entries(skills)) write(join(root, "skills", folder, "SKILL.md"), text);
};

test("plugin skills: the installed_plugins.json install folders, the plugin's own name, else the folder's; duplicates, missing and relative paths are skipped", () => {
  const cache = join(home, ".claude", "plugins", "cache", "mkt");
  install(join(cache, "pl-one", "1.0.0"), '{\n  "name": "pl-one",\n  "author": {"name": "Jane"}\n}\n', {
    "tool-a": "---\nname: tool-a\ndescription: Plugin tool A.\n---\n",
    "tool-b": "---\ndescription: Tool B has no name.\n---\n",
  });
  install(join(cache, "folder-name", "2.0.0"), null, { solo: "---\nname: solo\ndescription: Solo.\n---\n" });
  install(join(cache, "renamed", "3.0.0"), '{"author":{"name":"Two Words"},"name":"inner-name","version":"3"}', { thing: "---\nname: thing\n---\n" });
  install(join(cache, "stale", "0.9.0"), '{"name":"stale"}', { old: "---\nname: old\n---\n" });
  const entry = (path, scope = "user") => `{"scope":"${scope}","installPath":${JSON.stringify(path)}}`;
  write(
    join(home, ".claude", "plugins", "installed_plugins.json"),
    `{"version":2,"plugins":{\n"pl-one@mkt":[${entry(join(cache, "pl-one", "1.0.0"))},${entry(join(cache, "pl-one", "1.0.0"), "project")}],\n"folder-name@mkt":[${entry(join(cache, "folder-name", "2.0.0"))}],\n"renamed@mkt":[${entry(join(cache, "renamed", "3.0.0"))}],\n"gone@mkt":[${entry(join(cache, "gone", "1.0.0"))}],\n"rel@mkt":[${entry("relative/path")}]\n}}`,
  );
  const output = run();
  const plugin = names(output).filter((n) => n.startsWith("plugin"));
  assert.deepEqual(plugin, ["plugin:pl-one:tool-a", "plugin:pl-one:tool-b", "plugin:folder-name:solo", "plugin:inner-name:thing"]);
  const index = buildSkillIndex(parseSkillOutput(output));
  assert.equal(index.get("pl-one:tool-a").description, "Plugin tool A.");
  assert.equal(index.get("pl-one:tool-a").source, "the pl-one plugin");
  assert.ok(index.has("tool-b") && index.has("pl-one:tool-b"), "a plugin skill without name takes its folder's name");
  assert.ok(!index.has("old"), "a version the list does not name is not read");
});

test("a V1 list (one install object per plugin) works the same", () => {
  const root = join(home, "v1", "p", "1");
  install(root, '{"name":"v1plug"}', { s1: "---\nname: s1\n---\n" });
  write(join(home, ".claude", "plugins", "installed_plugins.json"), `{"version":1,"plugins":{"v1plug@m":{"version":"1","installPath":${JSON.stringify(root)}}}}`);
  assert.deepEqual(names(run()).filter((n) => n.startsWith("plugin")), ["plugin:v1plug:s1"]);
});

test("CLAUDE_CONFIG_DIR moves the whole tree; a relative one reads nothing", () => {
  const dir = join(home, "other-config");
  write(join(dir, "skills", "cfg", "SKILL.md"), "---\nname: cfg\n---\n");
  assert.deepEqual(names(run("", { CLAUDE_CONFIG_DIR: dir })), ["user::cfg"]);
  assert.equal(run("", { CLAUDE_CONFIG_DIR: "relative" }), "");
});

test("a garbled list or an empty computer is an empty output and exit 0, not a failure", () => {
  write(join(home, ".claude", "plugins", "installed_plugins.json"), "not json {{{ \u0000 \"installPath\": ");
  assert.ok(run().length > 0);
  const empty = mkdtempSync(join(tmpdir(), "skills-empty-"));
  try {
    const result = spawnSync(command.program, command.args, { input: "\n", env: { PATH: process.env.PATH, HOME: empty }, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("at most 400 files are read, and the worst case stays under the output bound", () => {
  const many = mkdtempSync(join(tmpdir(), "skills-many-"));
  try {
    const long = "x".repeat(1100);
    for (let i = 0; i < 450; i++) write(join(many, "skills", `s${String(i).padStart(3, "0")}`, "SKILL.md"), `---\nname: s${i}\ndescription: ${long}\ndescription2: x\n---\n`);
    const result = spawnSync(command.program, command.args, { input: "\n", env: { PATH: process.env.PATH, HOME: many, CLAUDE_CONFIG_DIR: many }, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.split("\n").filter((line) => line.startsWith("@@@")).length, 400);
    assert.ok(Buffer.byteLength(result.stdout) < command.maxOutputBytes);
    // About the most a file can print: lines up to the budget, and a header.
    const worst = "---\nname: n\ndescription: |\n" + "  " + "y".repeat(1900) + "\n  more\n  more\n---\n";
    for (let i = 0; i < 450; i++) write(join(many, "skills", `s${String(i).padStart(3, "0")}`, "SKILL.md"), worst);
    const again = spawnSync(command.program, command.args, { input: "\n", env: { PATH: process.env.PATH, HOME: many, CLAUDE_CONFIG_DIR: many }, encoding: "utf8" });
    assert.ok(Buffer.byteLength(again.stdout) < command.maxOutputBytes, `${Buffer.byteLength(again.stdout)} bytes`);
  } finally {
    rmSync(many, { recursive: true, force: true });
  }
});

test("it changes nothing: every file and folder it reads is as it was", () => {
  const snapshot = (dir) => {
    const out = [];
    const walk = (path) => {
      for (const name of readdirSync(path).sort()) {
        const full = join(path, name);
        const st = statSync(full, { throwIfNoEntry: false });
        if (!st) continue;
        out.push(`${full} ${st.mtimeMs} ${st.size}`);
        if (st.isDirectory()) walk(full);
      }
    };
    walk(dir);
    return out.join("\n");
  };
  const before = snapshot(home);
  run("~/extra");
  assert.equal(snapshot(home), before);
});

test("the README prints the whole script, and it is the text of skills.sh", () => {
  const readme = readFileSync(join(here, "README.md"), "utf8");
  assert.ok(readme.includes("```sh\n" + script.trimEnd() + "\n```"), "the README's script differs from skills.sh");
});
