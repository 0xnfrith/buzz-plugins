import test from "node:test";
import assert from "node:assert/strict";
import { formatAgo, formatContext, formatDuration, formatTask } from "../plugin.js";

test("durations read as seconds, minutes with seconds, then hours with minutes", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(-5), "0s");
  assert.equal(formatDuration(42_900), "42s");
  assert.equal(formatDuration(60_000), "1m 00s");
  assert.equal(formatDuration(7 * 60_000 + 5_000), "7m 05s");
  assert.equal(formatDuration(59 * 60_000 + 59_000), "59m 59s");
  assert.equal(formatDuration(3600_000), "1h 00m");
  assert.equal(formatDuration(3600_000 * 26 + 61_000), "26h 01m");
});

test("how long ago steps from just now to a date", () => {
  const now = Date.UTC(2026, 10, 8, 12, 0, 0);
  assert.equal(formatAgo(now - 3_000, now), "just now");
  assert.equal(formatAgo(now + 5_000, now), "just now", "a clock a little fast");
  assert.equal(formatAgo(now - 10_000, now), "10 s ago");
  assert.equal(formatAgo(now - 59_000, now), "59 s ago");
  assert.equal(formatAgo(now - 60_000, now), "1 min ago");
  assert.equal(formatAgo(now - 59 * 60_000, now), "59 min ago");
  assert.equal(formatAgo(now - 3600_000, now), "1 h ago");
  assert.equal(formatAgo(now - 23 * 3600_000, now), "23 h ago");
  assert.match(formatAgo(now - 3 * 86400_000, now), /\d/);
});

test("the context window is a percentage of its size, held between 0 and 100", () => {
  assert.equal(formatContext(undefined), undefined);
  assert.equal(formatContext({ used: 50, size: 200 }), "25% of 200");
  assert.equal(formatContext({ used: 84_000, size: 200_000 }), "42% of 200,000");
  assert.equal(formatContext({ used: 500, size: 200 }), "100% of 200");
  assert.equal(formatContext({ used: -5, size: 200 }), "0% of 200");
});

test("the task reads as its title, then its detail", () => {
  assert.equal(formatTask(undefined), undefined);
  assert.equal(formatTask({ id: "a" }), undefined);
  assert.equal(formatTask({ title: "Bash" }), "Bash");
  assert.equal(formatTask({ title: "Bash", detail: "npm" }), "Bash · npm");
  assert.equal(formatTask({ title: "buzz-dev-mcp__shell", detail: "npm" }), "Command · npm", "Buzz's own tools get a plain label");
  assert.equal(formatTask({ title: "buzz-dev-mcp__read_file", detail: "app.js" }), "Read file · app.js");
  assert.equal(formatTask({ title: "buzz-dev-mcp__str_replace" }), "Edit file");
  assert.equal(formatTask({ title: "buzz-dev-mcp__view_image" }), "View image");
  assert.equal(formatTask({ title: "constructor" }), "constructor", "a tool called like an object property is only a name");
  assert.equal(formatTask({ title: "other__shell", detail: "x" }), "other__shell · x");
});
