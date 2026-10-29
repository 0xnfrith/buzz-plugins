import { describe, expect, test } from "vitest";
import { acceptsMoves, progress, sortColumn, sortStates } from "../../src/linear/model";
import type { Issue, StateType, WorkflowState } from "../../src/linear/types";

const state = (id: string, type: string, position: number): WorkflowState => ({ id, name: id, type: type as StateType, color: "#999", position });

describe("the order of the columns", () => {
  test("follows the lifecycle, then the state's own position", () => {
    const sorted = sortStates([state("done", "completed", 0), state("todo", "unstarted", 2), state("doing", "started", 0), state("later", "backlog", 5), state("early", "backlog", 1)]);
    expect(sorted.map((s) => s.id)).toEqual(["early", "later", "todo", "doing", "done"]);
  });

  test("Duplicate, a type of its own, ends the board however Linear lists it", () => {
    for (const position of [-1, 0, 100]) {
      const sorted = sortStates([state("dup", "duplicate", position), state("canceled", "canceled", 9), state("backlog", "backlog", 0), state("done", "completed", 0)]);
      expect(sorted.map((s) => s.id)).toEqual(["backlog", "done", "canceled", "dup"]);
    }
  });

  test("a state type that is not known yet goes after the known ones and does not scramble them", () => {
    const sorted = sortStates([state("odd", "somethingnew", -5), state("canceled", "canceled", 3), state("dup", "duplicate", 0), state("todo", "unstarted", 1), state("odd2", "another", -9)]);
    expect(sorted.map((s) => s.id)).toEqual(["todo", "canceled", "dup", "odd2", "odd"]); // the unknown ones by position among themselves
  });
});

describe("which columns take a card", () => {
  test("every state type does except Duplicate, which Linear fills only by marking an issue a duplicate of another", () => {
    for (const type of ["triage", "backlog", "unstarted", "started", "completed", "canceled"] as const) expect(acceptsMoves(type), type).toBe(true);
    expect(acceptsMoves("duplicate")).toBe(false);
  });
});

describe("sub-issue progress", () => {
  const child = (type: StateType) => ({ state: { type } });
  test("counts done out of the live ones, leaving out cancelled and duplicate sub-issues", () => {
    expect(progress([child("completed"), child("started"), child("canceled"), child("duplicate"), child("unstarted")])).toEqual({ done: 1, total: 3 });
  });
  test("nothing live is no progress", () => {
    expect(progress([])).toBeNull();
    expect(progress([child("canceled"), child("duplicate")])).toBeNull();
  });
});

describe("the order inside a column", () => {
  const issue = (id: string, sortOrder: number, updatedAt: string): Issue => ({ id, sortOrder, updatedAt, createdAt: updatedAt }) as Issue;
  // The two orders differ on purpose: by sortOrder b, c, a; by last change a, c, b.
  const issues = [issue("a", 5, "2026-03-01T00:00:00Z"), issue("b", -3, "2026-01-01T00:00:00Z"), issue("c", 1, "2026-02-01T00:00:00Z")];
  test("an open column keeps Linear's manual order, lowest sortOrder first", () => {
    for (const type of ["triage", "backlog", "unstarted", "started"] as const) expect(sortColumn(issues, type).map((i) => i.id)).toEqual(["b", "c", "a"]);
  });
  test("Done, Canceled and Duplicate show what changed last", () => {
    for (const type of ["completed", "canceled", "duplicate"] as const) expect(sortColumn(issues, type).map((i) => i.id)).toEqual(["a", "c", "b"]);
  });
});
