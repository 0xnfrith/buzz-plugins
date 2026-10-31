// Detection: a /name is a skill only when it is a known name at a word start and nothing in the text makes it a path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findSkills } from "../plugin.js";

const known = new Set(["brainstorming", "plan-review", "plug:thing", "buy", "x", "a.b"]);
const slices = (text, set = known) => findSkills(text, set).map(({ start, end }) => text.slice(start, end));

const yes = [
  ["/brainstorming", ["/brainstorming"]],
  ["use /brainstorming now", ["/brainstorming"]],
  ["Use /brainstorming.", ["/brainstorming"]],
  ["Use /brainstorming...", ["/brainstorming"]],
  ["(/brainstorming)", ["/brainstorming"]],
  ["[/brainstorming]", ["/brainstorming"]],
  ['"/brainstorming"', ["/brainstorming"]],
  ["'/brainstorming'", ["/brainstorming"]],
  ["“/brainstorming”", ["/brainstorming"]],
  ["/brainstorming, then /plan-review!", ["/brainstorming", "/plan-review"]],
  ["/brainstorming?", ["/brainstorming"]],
  ["/brainstorming; /plan-review?", ["/brainstorming", "/plan-review"]],
  ["Try /brainstorming: it asks first", ["/brainstorming"]],
  ["Try /brainstorming…", ["/brainstorming"]],
  ["Try /brainstorming — it asks first", ["/brainstorming"]],
  ["/plug:thing", ["/plug:thing"]],
  ["ask for /plug:thing.", ["/plug:thing"]],
  ["x /brainstorming /plan-review", ["/brainstorming", "/plan-review"]],
  ["line one\n/brainstorming\nline three", ["/brainstorming"]],
  ["run /brainstorming\tnow", ["/brainstorming"]],
  ["/x", ["/x"]],
  ["a /a.b skill", ["/a.b"]],
  ["🔥/brainstorming", ["/brainstorming"]],
  ["完了。/brainstorming", ["/brainstorming"]], // punctuation of another script is not a word
  ["日本語 /brainstorming", ["/brainstorming"]],
  ["«/brainstorming»", ["/brainstorming"]],
];
for (const [text, want] of yes) test(`finds ${JSON.stringify(text)}`, () => assert.deepEqual(slices(text), want));

const no = [
  "",
  "no slash here",
  "/unknown",
  "/Brainstorming",
  "/BRAINSTORMING",
  "a/brainstorming",
  "x/brainstorming",
  "1/brainstorming",
  "~/brainstorming",
  "foo.bar/brainstorming",
  "foo@/brainstorming",
  "a=/brainstorming",
  "//brainstorming",
  "/brainstorming/",
  "/brainstorming/plan-review",
  "/brainstorming\\",
  "/brainstorming*",
  "/brainstorming.md",
  "/plan-review.md",
  "/brainstorming.next",
  "/brainstorming-notes",
  "/brainstorming_x",
  "/brainstormings",
  "/buy/plan",
  "/usr/bin/brainstorming",
  "/usr/local/bin/x",
  "https://x.example/brainstorming",
  "http://example.com/x",
  "see example.com/brainstorming",
  "C:/brainstorming",
  "a:/brainstorming",
  "/brainstorming#section",
  "/brainstorming=1",
  "/brainstorming+x",
  "/brainstorming@home",
  "/brainstorming$",
  "/brainstorming%20x",
  "/brainstorming|x",
  "/brainstorming<b>",
  // A letter, number or mark of any script before the slash makes it part of a word or a path (it was only ASCII letters before)
  "é/brainstorming",
  "日本/brainstorming",
  "ключ/brainstorming",
  "𠀀/brainstorming", // a letter outside the first plane: two UTF-16 units
  "٣/brainstorming", // an Arabic-Indic digit
  "e\u0301/brainstorming", // a letter and a combining accent
  "see é/brainstorming and 日本/plan-review",
  "/brainstorming日本",
];
for (const text of no) test(`leaves ${JSON.stringify(text)} alone`, () => assert.deepEqual(slices(text), []));

test("an empty set of known skills finds nothing and a text without a slash returns at once", () => {
  assert.deepEqual(findSkills("/brainstorming", new Set()), []);
  assert.deepEqual(findSkills("brainstorming", known), []);
});

test("the ranges are UTF-16 offsets into the text, after emoji and accents", () => {
  const text = "héllo 🔥 /brainstorming ok";
  const [range] = findSkills(text, known);
  assert.equal(text.slice(range.start, range.end), "/brainstorming");
  assert.equal(range.name, "brainstorming");
});

test("a path that continues after a known name is not a skill, but the same name on its own later in the text is", () => {
  const text = "/buy/plan then /buy";
  assert.deepEqual(slices(text), ["/buy"]);
  assert.equal(findSkills(text, known)[0].start, text.lastIndexOf("/buy"));
});

test("the same input twice gives the same ranges (the matcher keeps no state between calls)", () => {
  const text = "/brainstorming and /plan-review";
  assert.deepEqual(findSkills(text, known), findSkills(text, known));
});
