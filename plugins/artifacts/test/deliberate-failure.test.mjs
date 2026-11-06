// A deliberate failure, to show that the all-tests check turns red when a plugin test fails. The next commit removes it.
import test from "node:test";
import assert from "node:assert/strict";

test("a deliberate failure (removed by the next commit)", () => {
  assert.equal(1 + 1, 3);
});
