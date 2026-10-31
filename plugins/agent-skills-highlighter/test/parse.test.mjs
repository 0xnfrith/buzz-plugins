// Reading skills: frontmatter values, the reader's output, and the index the highlighter works from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, parseSkillOutput, buildSkillIndex, sourceLabel, readSkills } from "../plugin.js";

test("plain values", () => {
  assert.deepEqual(parseFrontmatter("name: brainstorming\ndescription: Explore intent before you build."), { name: "brainstorming", description: "Explore intent before you build." });
});
test("a colon inside a plain value stays in the value", () => {
  assert.equal(parseFrontmatter("description: Use when: the user asks for X").description, "Use when: the user asks for X");
});
test("double-quoted and single-quoted values, with escapes", () => {
  assert.equal(parseFrontmatter('description: "Say \\"hi\\" first"').description, 'Say "hi" first');
  assert.equal(parseFrontmatter("description: 'It''s fine'").description, "It's fine");
  assert.equal(parseFrontmatter('name: "x"').name, "x");
});
test("a quoted value may run over several lines", () => {
  assert.equal(parseFrontmatter('description: "one\n  two\n  three"\nname: y').description, "one two three");
});
test("folded block scalars join their lines with a space", () => {
  assert.equal(parseFrontmatter("description: >\n  First line\n  second line\nname: z").description, "First line second line");
  assert.equal(parseFrontmatter("description: >-\n  First\n  second\n").description, "First second");
});
test("literal block scalars keep their lines", () => {
  assert.equal(parseFrontmatter("description: |\n  First\n  second\nname: z").description, "First\nsecond");
});
test("a plain value continues on indented lines", () => {
  assert.equal(parseFrontmatter("description: one\n  two\nname: y").description, "one two");
});
test("a trailing comment is not part of a plain value", () => {
  assert.equal(parseFrontmatter("name: brainstorming # the name").name, "brainstorming");
});
test("keys other than name and description are read and left to the caller; CRLF is fine", () => {
  const fields = parseFrontmatter("name: a\r\nallowed-tools: Read, Grep\r\ndescription: d\r\n");
  assert.equal(fields.name, "a");
  assert.equal(fields.description, "d");
  assert.equal(fields["allowed-tools"], "Read, Grep");
});
test("empty or odd input gives no fields and does not throw", () => {
  assert.deepEqual(parseFrontmatter(""), {});
  assert.deepEqual(parseFrontmatter("not yaml at all"), {});
  assert.deepEqual(parseFrontmatter(undefined), {});
  assert.equal(parseFrontmatter("name:\n").name, "");
});

const out = [
  "@@@\tuser\t\tbrainstorming",
  "name: brainstorming",
  "description: Explore intent first.",
  "@@@\tplugin\tsuperpowers\tplan-review",
  "name: plan-review",
  "description: >",
  "  Review a plan",
  "  before it runs.",
  "@@@\textra\t\tno-frontmatter",
  "@@@\textra\t\tbad name",
  "name: has spaces",
  "",
].join("\n");

test("the reader's output becomes records, with the folder name when a file has no usable name", () => {
  const records = parseSkillOutput(out);
  assert.deepEqual(
    records.map(({ kind, label, name }) => [kind, label, name]),
    [["user", "", "brainstorming"], ["plugin", "superpowers", "plan-review"], ["extra", "", "no-frontmatter"], ["extra", "", ""]],
  );
  assert.equal(records[1].description, "Review a plan before it runs.");
});
test("text before the first marker is ignored, and an empty output has no records", () => {
  assert.deepEqual(parseSkillOutput("noise\nname: x\n"), []);
  assert.deepEqual(parseSkillOutput(""), []);
});
test("a very long description is cut at 1000 characters", () => {
  const long = `@@@\tuser\t\ts\nname: s\ndescription: ${"x".repeat(5000)}`;
  assert.equal(parseSkillOutput(long)[0].description.length, 1000);
});

test("the index knows plugin skills by plugin:name and by name, and a user skill keeps a name it shares", () => {
  const records = [
    ...parseSkillOutput(out),
    ...parseSkillOutput("@@@\tplugin\tother\tbrainstorming\nname: brainstorming\ndescription: the plugin's version"),
  ];
  const index = buildSkillIndex(records);
  assert.deepEqual([...index.keys()].sort(), ["brainstorming", "no-frontmatter", "other:brainstorming", "plan-review", "superpowers:plan-review"]);
  assert.equal(index.get("brainstorming").description, "Explore intent first.");
  assert.equal(index.get("brainstorming").source, "your skills folder");
  assert.equal(index.get("other:brainstorming").description, "the plugin's version");
  assert.equal(index.get("superpowers:plan-review").source, "the superpowers plugin");
  assert.equal(index.get("no-frontmatter").source, "the extra folder");
});
test("a name that is not a valid skill name never enters the index", () => {
  const index = buildSkillIndex([{ kind: "user", label: "", name: "has space", description: "" }, { kind: "user", label: "", name: "", description: "" }, { kind: "user", label: "", name: "-x", description: "" }]);
  assert.equal(index.size, 0);
});
test("source labels", () => {
  assert.equal(sourceLabel({ kind: "user" }), "your skills folder");
  assert.equal(sourceLabel({ kind: "extra" }), "the extra folder");
  assert.equal(sourceLabel({ kind: "plugin", label: "p" }), "the p plugin");
  assert.equal(sourceLabel({ kind: "plugin", label: "" }), "an installed plugin");
  assert.equal(sourceLabel({ kind: "?" }), "this computer");
});

test("readSkills sends the extra folder on stdin and builds the index from what comes back", async () => {
  const calls = [];
  const host = { runCommand: async (id, input) => (calls.push([id, input]), out) };
  const index = await readSkills(host, "~/mine");
  assert.deepEqual(calls, [["skills", "~/mine\n"]]);
  assert.ok(index.has("brainstorming"));
  await readSkills(host, "");
  assert.deepEqual(calls[1], ["skills", "\n"]);
});
test("readSkills fails plainly when the command cannot run or gives nothing", async () => {
  await assert.rejects(() => readSkills(undefined, ""), /cannot run the program/);
  await assert.rejects(() => readSkills({}, ""), /cannot run the program/);
  await assert.rejects(() => readSkills({ runCommand: async () => null }, ""), /could not be read/);
  await assert.rejects(() => readSkills({ runCommand: async () => { throw new Error("boom"); } }, ""), /boom/);
});
