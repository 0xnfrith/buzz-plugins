import { describe, expect, test } from "vitest";
import { sortColumn } from "../../src/linear/model";
import { PAGE_SIZE, type Snapshot } from "../../src/linear/store";
import { setup } from "./fake";

const names = (snapshot: Snapshot, column: string) =>
  sortColumn(
    snapshot.columns[column]!.ids.map((id) => snapshot.issues[id]!),
    snapshot.states.find((s) => s.id === column)!.type,
  ).map((issue) => issue.identifier);

describe("board store", () => {
  test("opens the first team with its states in Linear's order", async () => {
    const { store } = setup();
    await store.start();
    const s = store.snapshot();
    expect(s.phase).toBe("ready");
    expect(s.teams.map((t) => t.name)).toEqual(["Design", "Platform"]);
    expect(s.choice).toEqual({ teamId: "team-dsn", scope: { kind: "team" } });
    // Linear lists Duplicate first, with a type of its own; the board still ends with it.
    expect(s.states.map((x) => x.name)).toEqual(["Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled", "Duplicate"]);
    expect(names(s, "team-dsn:backlog")).toEqual(["DSN-10"]);
  });

  test("remembers the team and the project filter", async () => {
    const { store, storage } = setup();
    await store.start();
    await store.selectTeam("team-plt");
    await store.selectScope({ kind: "project", id: "proj-launch" });
    expect(JSON.parse(storage.getItem("megatech.linear.board.v1")!)).toEqual({
      teamId: "team-plt",
      scope: { kind: "project", id: "proj-launch" },
    });
    const again = setup();
    again.storage.setItem("megatech.linear.board.v1", storage.getItem("megatech.linear.board.v1")!);
    const second = (await import("../../src/linear/store")).createBoardStore(again.client, again.storage);
    await second.start();
    expect(second.snapshot().choice).toEqual({ teamId: "team-plt", scope: { kind: "project", id: "proj-launch" } });
  });

  test("a project filter keeps only that project's issues", async () => {
    const { store } = setup();
    await store.start();
    await store.selectTeam("team-plt");
    const all = Object.keys(store.snapshot().issues).length;
    await store.selectScope({ kind: "project", id: "proj-launch" });
    const s = store.snapshot();
    expect(Object.values(s.issues).every((i) => i.project?.id === "proj-launch")).toBe(true);
    expect(Object.keys(s.issues).length).toBeLessThan(all);
    expect(s.projects.map((p) => p.name)).toContain("Launch readiness");
  });

  test("a saved view filters through Linear's own view", async () => {
    const { store } = setup();
    await store.start();
    await store.selectTeam("team-plt");
    await store.selectScope({ kind: "view", id: "view-mine" });
    const s = store.snapshot();
    expect(s.views.map((v) => v.name)).toEqual(["Open bugs"]);
    expect(Object.values(s.issues).length).toBeGreaterThan(0);
    expect(Object.values(s.issues).every((i) => i.labels.some((l) => l.name === "Bug"))).toBe(true);
  });

  test("a long column loads a page and then more", async () => {
    const { store } = setup();
    await store.start();
    await store.selectTeam("team-plt");
    const done = "team-plt:done";
    expect(store.snapshot().columns[done]!.ids).toHaveLength(PAGE_SIZE);
    expect(store.snapshot().columns[done]!.hasMore).toBe(true);
    await store.loadMore(done);
    const column = store.snapshot().columns[done]!;
    expect(column.hasMore).toBe(false);
    expect(column.ids.length).toBeGreaterThan(PAGE_SIZE);
    expect(new Set(column.ids).size).toBe(column.ids.length);
  });

  test("cards carry what the board shows", async () => {
    const { store } = setup();
    await store.start();
    await store.selectTeam("team-plt");
    const s = store.snapshot();
    const card = Object.values(s.issues).find((i) => i.identifier === "PLT-120")!;
    expect(card.pullRequests.map((p) => [p.number, p.status])).toEqual([[412, "open"], [415, "open"], [418, "draft"]]);
    expect(card.progress).toEqual({ done: 2, total: 4 });
    expect(card.project?.name).toBe("Launch readiness");
    const child = Object.values(s.issues).find((i) => i.identifier === "PLT-106")!;
    expect(child.parent).toEqual({ identifier: "PLT-130", title: "Keyboard-first review queue" });
    const parent = Object.values(s.issues).find((i) => i.identifier === "PLT-130")!;
    expect(parent.progress).toEqual({ done: 1, total: 5 }); // the cancelled sub-issue is left out
  });

  describe("moving a card", () => {
    test("shows it in the new column at once and keeps it after Linear confirms", async () => {
      const { store, fake } = setup();
      await store.start();
      await store.selectTeam("team-plt");
      const id = Object.values(store.snapshot().issues).find((i) => i.identifier === "PLT-110")!.id;
      fake.control.latency = 20;
      const pending = store.move(id, "team-plt:doing");
      expect(store.snapshot().issues[id]!.stateId).toBe("team-plt:doing");
      expect(store.snapshot().columns["team-plt:todo"]!.ids).not.toContain(id);
      expect(store.snapshot().columns["team-plt:doing"]!.ids).toContain(id);
      expect(store.snapshot().moving).toEqual([id]);
      await pending;
      const s = store.snapshot();
      expect(s.moving).toEqual([]);
      expect(s.settled).toBe(id);
      // Confirmed by Linear, it is still in the column it was moved to, once.
      expect(s.columns["team-plt:doing"]!.ids.filter((x) => x === id)).toHaveLength(1);
      expect(s.columns["team-plt:todo"]!.ids).not.toContain(id);
      expect(fake.control.world.records.find((r: any) => r.id === id).stateId).toBe("team-plt:doing");
      expect(fake.control.log.requests.at(-1)).toMatchObject({
        operation: "MoveIssue",
        variables: { id, stateId: "team-plt:doing" },
      });
    });

    test("puts it back and says why when Linear refuses", async () => {
      const { store, fake } = setup();
      await store.start();
      await store.selectTeam("team-plt");
      const id = Object.values(store.snapshot().issues).find((i) => i.identifier === "PLT-110")!.id;
      fake.control.fail("reject", { operation: "MoveIssue" });
      await store.move(id, "team-plt:done");
      const s = store.snapshot();
      expect(s.issues[id]!.stateId).toBe("team-plt:todo");
      expect(s.columns["team-plt:todo"]!.ids).toContain(id);
      expect(s.columns["team-plt:done"]!.ids).not.toContain(id);
      expect(s.notice).toBe("PLT-110 was not moved to Done: Linear refused the request.");
      expect(fake.control.world.records.find((r: any) => r.id === id).stateId).toBe("team-plt:todo");
    });

    test("Linear's own wording of a refusal never reaches the board, even when it repeats the key", async () => {
      const { store, fake } = setup();
      await store.start();
      await store.selectTeam("team-plt");
      const id = Object.values(store.snapshot().issues).find((i) => i.identifier === "PLT-110")!.id;
      fake.control.fail("echo", { operation: "MoveIssue" });
      await store.move(id, "team-plt:done");
      const s = store.snapshot();
      expect(s.notice).toBe("PLT-110 was not moved to Done: Linear refused the request.");
      expect(JSON.stringify(s)).not.toContain(fake.keys.good);
      expect(JSON.stringify(s)).not.toContain("Argument Validation");
    });

    test("a revoked key blocks the board and puts the card back", async () => {
      const { store, fake } = setup();
      await store.start();
      await store.selectTeam("team-plt");
      const id = Object.values(store.snapshot().issues).find((i) => i.identifier === "PLT-110")!.id;
      fake.control.revoke(fake.keys.good);
      await store.move(id, "team-plt:done");
      expect(store.snapshot().phase).toBe("blocked");
      expect(store.snapshot().problem?.kind).toBe("auth");
      expect(store.snapshot().issues[id]!.stateId).toBe("team-plt:todo");
    });

    test("a card is not moved into Duplicate: nothing is sent and the board says why", async () => {
      const { store, fake } = setup();
      await store.start();
      await store.selectTeam("team-plt");
      const id = Object.values(store.snapshot().issues).find((i) => i.identifier === "PLT-110")!.id;
      const before = fake.control.log.operations.MoveIssue ?? 0;
      await store.move(id, "team-plt:duplicate");
      const s = store.snapshot();
      expect(fake.control.log.operations.MoveIssue ?? 0).toBe(before);
      expect(s.issues[id]!.stateId).toBe("team-plt:todo");
      expect(s.columns["team-plt:duplicate"]!.ids).not.toContain(id);
      expect(s.moving).toEqual([]);
      expect(s.notice).toMatch(/PLT-110 was not moved to Duplicate: Linear only does that when the issue is marked a duplicate of another/);
    });

    test("moving to the column it is already in does nothing", async () => {
      const { store, fake } = setup();
      await store.start();
      await store.selectTeam("team-plt");
      const id = Object.values(store.snapshot().issues).find((i) => i.identifier === "PLT-110")!.id;
      const before = fake.control.log.operations.MoveIssue ?? 0;
      await store.move(id, "team-plt:todo");
      expect(fake.control.log.operations.MoveIssue ?? 0).toBe(before);
    });
  });

  describe("refreshing", () => {
    test("a quiet tick is one small request and changes nothing", async () => {
      const { store, fake } = setup();
      await store.start();
      await store.selectTeam("team-plt");
      const before = store.snapshot();
      const requests = fake.control.log.requests.length;
      await store.tick();
      expect(fake.control.log.requests.slice(requests).map((r: any) => r.operation)).toEqual(["ChangedSince"]);
      expect(store.snapshot().issues).toBe(before.issues);
    });

    test("a change made elsewhere is picked up by the next tick", async () => {
      const { store, fake } = setup();
      await store.start();
      await store.selectTeam("team-plt");
      fake.control.touch("PLT-110", { stateSlug: "done", title: "Renamed elsewhere" });
      await store.tick();
      const s = store.snapshot();
      const card = Object.values(s.issues).find((i) => i.identifier === "PLT-110")!;
      expect(card.title).toBe("Renamed elsewhere");
      expect(s.columns["team-plt:done"]!.ids).toContain(card.id);
    });

    test("our own move does not look like a change from elsewhere", async () => {
      const { store, fake } = setup();
      await store.start();
      await store.selectTeam("team-plt");
      const id = Object.values(store.snapshot().issues).find((i) => i.identifier === "PLT-110")!.id;
      await store.move(id, "team-plt:doing");
      const columnReads = fake.control.log.operations.ColumnIssues;
      await store.tick();
      expect(fake.control.log.operations.ColumnIssues).toBe(columnReads);
    });

    test("a rate limit keeps the board and holds off further ticks until the time Linear gave", async () => {
      let clock = Date.parse("2026-10-23T15:00:00Z");
      const { fake, storage } = setup();
      const { createBoardStore } = await import("../../src/linear/store");
      const { createClient } = await import("../../src/linear/client");
      const client = createClient((request) => fake.handle(request), () => fake.keys.good, () => clock);
      const store = createBoardStore(client, storage, () => clock);
      await store.start();
      await store.selectTeam("team-plt");
      const cards = Object.keys(store.snapshot().issues).length;
      fake.control.fail("rate-limit");
      await store.tick();
      expect(store.snapshot().problem?.kind).toBe("rate-limited");
      expect(Object.keys(store.snapshot().issues)).toHaveLength(cards);
      const requests = fake.control.log.requests.length;
      // Linear's reset is 15:05:00. A tick inside the 2-second de-bounce would be held back anyway, so each step below is
      // well past it: only the reset time can be what holds the next ones back.
      for (const at of ["2026-10-23T15:00:30Z", "2026-10-23T15:03:00Z", "2026-10-23T15:04:59Z"]) {
        clock = Date.parse(at);
        await store.tick();
        expect(fake.control.log.requests.length, at).toBe(requests);
      }
      clock = Date.parse("2026-10-23T15:05:00Z");
      await store.tick();
      expect(fake.control.log.requests.length).toBe(requests + 1);
      expect(store.snapshot().problem).toBeNull();
    });

    test("an answer that arrives after the team changed is dropped", async () => {
      const { store, fake } = setup();
      await store.start();
      fake.control.latency = 15;
      const slow = store.selectTeam("team-plt");
      const fast = store.selectTeam("team-dsn");
      await Promise.all([slow, fast]);
      expect(store.snapshot().choice?.teamId).toBe("team-dsn");
      expect(store.snapshot().states.length).toBeGreaterThan(0);
      expect(Object.values(store.snapshot().issues).length).toBeGreaterThan(0);
      expect(Object.values(store.snapshot().issues).every((i) => i.identifier.startsWith("DSN-"))).toBe(true);
    });
  });

  describe("races", () => {
    test("switching team while a timer refresh is running still loads the new team", async () => {
      const { store, fake } = setup();
      await store.start();
      await store.selectTeam("team-plt");
      fake.control.latency = 15;
      const running = store.refresh();
      const switched = store.selectTeam("team-dsn");
      await Promise.all([running, switched]);
      const s = store.snapshot();
      expect(s.phase).toBe("ready");
      expect(s.states.length).toBeGreaterThan(0);
      expect(Object.values(s.issues).every((i) => i.identifier.startsWith("DSN-"))).toBe(true);
    });

    test("a key change while the board is loading starts over cleanly", async () => {
      const { store, fake } = setup();
      fake.control.latency = 15;
      const first = store.start();
      store.reset();
      const second = store.start();
      await Promise.all([first, second]);
      const s = store.snapshot();
      expect(s.phase).toBe("ready");
      expect(s.states.length).toBeGreaterThan(0);
    });

    test("Refresh after a failed first load starts over instead of sticking on loading", async () => {
      const { store, fake } = setup();
      fake.control.fail("network");
      await store.start();
      expect(store.snapshot().phase).toBe("blocked");
      await store.refresh();
      expect(store.snapshot().phase).toBe("ready");
      expect(store.snapshot().states.length).toBeGreaterThan(0);
    });

    test("a slow read that began before a move cannot undo it", async () => {
      const { store, fake } = setup();
      await store.start();
      await store.selectTeam("team-plt");
      const id = Object.values(store.snapshot().issues).find((i) => i.identifier === "PLT-110")!.id;
      const release = fake.control.hold("ColumnIssues"); // answered now, delivered late
      const reading = store.refresh();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await store.move(id, "team-plt:doing");
      release();
      await reading;
      const s = store.snapshot();
      expect(s.issues[id]!.stateId).toBe("team-plt:doing");
      expect(s.columns["team-plt:doing"]!.ids).toContain(id);
      expect(s.columns["team-plt:todo"]!.ids).not.toContain(id);
    });
  });

  describe("the saved choice", () => {
    for (const scope of [
      { kind: "view", id: "view-deleted" },
      { kind: "project", id: "proj-deleted" },
    ]) {
      test(`a deleted ${scope.kind} falls back to all issues, with a note`, async () => {
        const { store, storage } = setup();
        storage.setItem("megatech.linear.board.v1", JSON.stringify({ teamId: "team-plt", scope }));
        await store.start();
        const s = store.snapshot();
        expect(s.phase).toBe("ready");
        expect(s.problem).toBeNull();
        expect(s.choice).toEqual({ teamId: "team-plt", scope: { kind: "team" } });
        expect(Object.keys(s.issues).length).toBeGreaterThan(10);
        expect(s.notice).toMatch(/no longer exists/);
        expect(JSON.parse(storage.getItem("megatech.linear.board.v1")!).scope).toEqual({ kind: "team" });
      });
    }
  });

  describe("the refresh timer", () => {
    const timed = async () => {
      let clock = Date.parse("2026-10-23T15:00:00Z");
      const { fake, client, storage } = setup();
      const { createBoardStore } = await import("../../src/linear/store");
      const store = createBoardStore(client, storage, () => clock);
      return { fake, store, advance: (ms: number) => (clock += ms) };
    };

    test("ticks that come close together cost one probe", async () => {
      const { store, fake, advance } = await timed();
      await store.start();
      await store.selectTeam("team-plt");
      const before = fake.control.log.operations.ChangedSince ?? 0;
      await Promise.all([store.tick(), store.tick(), store.tick()]);
      expect((fake.control.log.operations.ChangedSince ?? 0) - before).toBe(1);
      advance(3000);
      await store.tick();
      expect((fake.control.log.operations.ChangedSince ?? 0) - before).toBe(2);
    });

    test("a change outside the chosen project reloads once, not on every tick", async () => {
      const { store, fake, advance } = await timed();
      await store.start();
      await store.selectTeam("team-plt");
      await store.selectScope({ kind: "project", id: "proj-launch" });
      fake.control.touch("PLT-102", { title: "Changed in a project that is not on the board" });
      advance(3000);
      const reads = () => fake.control.log.operations.ColumnIssues;
      const before = reads();
      await store.tick();
      expect(reads()).toBeGreaterThan(before); // the team did change, so the board looked
      const after = reads();
      advance(3000);
      await store.tick();
      advance(3000);
      await store.tick();
      expect(reads()).toBe(after); // and then stayed quiet
    });

    test("a description edited in Linear is read again, one that did not change is not", async () => {
      const { store, fake, advance } = await timed();
      await store.start();
      await store.selectTeam("team-plt");
      const id = Object.values(store.snapshot().issues).find((i) => i.identifier === "PLT-130")!.id;
      await store.detail(id);
      await store.detail(id);
      expect(fake.control.log.operations.IssueDetail).toBe(1);
      fake.control.touch("PLT-130", { title: "Keyboard-first review queue (renamed)" });
      advance(3000);
      await store.tick();
      await store.detail(id);
      expect(fake.control.log.operations.IssueDetail).toBe(2);
    });
  });

  describe("without a usable key", () => {
    test("no key leaves the board blocked, with nothing sent", async () => {
      const { store, fake } = setup({ key: undefined });
      await store.start();
      expect(store.snapshot().phase).toBe("blocked");
      expect(store.snapshot().problem?.kind).toBe("no-key");
      expect(fake.control.log.requests).toHaveLength(0);
    });

    test("a refused key blocks it with an auth problem", async () => {
      const { store } = setup({ key: "test-key-unknown" });
      await store.start();
      expect(store.snapshot().phase).toBe("blocked");
      expect(store.snapshot().problem?.kind).toBe("auth");
    });

    test("a network failure on the first load is blocked, not blank", async () => {
      const { store, fake } = setup();
      fake.control.fail("network");
      await store.start();
      expect(store.snapshot().phase).toBe("blocked");
      expect(store.snapshot().problem?.kind).toBe("network");
    });
  });

  test("details are fetched once and cached", async () => {
    const { store, fake } = setup();
    await store.start();
    await store.selectTeam("team-plt");
    const id = Object.values(store.snapshot().issues).find((i) => i.identifier === "PLT-130")!.id;
    const detail = await store.detail(id);
    expect(detail.description).toContain("Keyboard-first review queue");
    expect(detail.subIssues.length).toBeGreaterThan(1);
    await store.detail(id);
    expect(fake.control.log.operations.IssueDetail).toBe(1);
  });
});
