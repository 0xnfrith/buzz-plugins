import { LinearError, type LinearClient } from "./client";
import type { KeyValue } from "./keys";
import { sortStates, toDetail, toIssue } from "./model";
import {
  CHANGED_SINCE,
  COLUMN_ISSUES,
  ISSUE_DETAIL,
  MOVE_ISSUE,
  TEAMS,
  TEAM_SETUP,
  VIEW_COLUMN_ISSUES,
} from "./queries";
import type {
  BoardChoice,
  Issue,
  IssueDetail,
  Page,
  Project,
  Scope,
  Team,
  View,
  WorkflowState,
} from "./types";

export const PAGE_SIZE = 50;
const PREFS = "megatech.linear.board.v1";

export type Problem = { kind: LinearError["kind"]; message: string; retryAt?: number };

export type Column = {
  ids: string[];
  hasMore: boolean;
  cursor: string | null;
  loadingMore: boolean;
};

export type Snapshot = {
  /** `blocked` while there is no usable key; the board is empty and says why. */
  phase: "idle" | "loading" | "ready" | "blocked";
  problem: Problem | null;
  teams: Team[];
  choice: BoardChoice | null;
  states: WorkflowState[];
  projects: Project[];
  views: View[];
  issues: Record<string, Issue>;
  columns: Record<string, Column>;
  /** A load is in flight (the board may still be showing the last one). */
  refreshing: boolean;
  /** Issues whose move is on its way to Linear. */
  moving: readonly string[];
  /** A message about something that did not go through, until it is dismissed. */
  notice: string | null;
  /** The issue that was just moved, for a moment's highlight. */
  settled: string | null;
  refreshedAt: number | null;
};

const initial: Snapshot = {
  phase: "idle",
  problem: null,
  teams: [],
  choice: null,
  states: [],
  projects: [],
  views: [],
  issues: {},
  columns: {},
  refreshing: false,
  moving: [],
  notice: null,
  settled: null,
  refreshedAt: null,
};

type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

/**
 * Everything the board knows, outside React so the refresh timer, a move in flight and a
 * page that mounts and unmounts all see one state. Requests that come back after the team
 * or filter changed are dropped (`generation`), and a refresh never overwrites an issue
 * that is mid-move.
 */
export function createBoardStore(
  client: LinearClient,
  storage: KeyValue,
  now: () => number = Date.now,
) {
  let state: Snapshot = initial;
  let generation = 0;
  let refreshing: Promise<void> | undefined;
  /** The strongest kind of reload asked for while one was running (`true` = also re-read the team's setup). */
  let pendingFull: boolean | undefined;
  /** The newest `updatedAt` the board has seen, which the refresh timer asks Linear to beat. */
  let watermark: string | null = null;
  let probing = false;
  let lastProbeAt = 0;
  /** Each move bumps a counter, so a read that began before a move cannot undo it. */
  let moveSeq = 0;
  const movedAt = new Map<string, number>();
  const listeners = new Set<() => void>();
  const details = new Map<string, IssueDetail>();
  const newer = (a: string | null, b: string) => (a !== null && a >= b ? a : b);

  const set = (patch: Partial<Snapshot> | ((current: Snapshot) => Partial<Snapshot>)) => {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    listeners.forEach((listener) => listener());
  };

  const fail = (error: unknown): Problem => {
    if (error instanceof LinearError)
      return { kind: error.kind, message: error.message, ...(error.retryAt ? { retryAt: error.retryAt } : {}) };
    return { kind: "server", message: "Something went wrong talking to Linear." };
  };

  /** A refused key, or nothing loaded yet, leaves the board blocked; any other failure keeps what is on screen and says so. */
  const settleFailure = (error: unknown) => {
    const problem = fail(error);
    const unusable = problem.kind === "no-key" || problem.kind === "auth";
    set({ problem, phase: unusable || Object.keys(state.columns).length === 0 ? "blocked" : "ready" });
  };

  const readPrefs = (): BoardChoice | null => {
    try {
      const saved = JSON.parse(storage.getItem(PREFS) ?? "null") as BoardChoice | null;
      if (saved && typeof saved.teamId === "string" && saved.scope && typeof saved.scope.kind === "string")
        return saved;
    } catch {
      // A bad value is the same as none.
    }
    return null;
  };
  const writePrefs = (choice: BoardChoice) => {
    try {
      storage.setItem(PREFS, JSON.stringify(choice));
    } catch {
      // The board still works without remembering the choice.
    }
  };

  const filterFor = (choice: BoardChoice, stateId: string) => ({
    team: { id: { eq: choice.teamId } },
    state: { id: { eq: stateId } },
    ...(choice.scope.kind === "project" ? { project: { id: { eq: choice.scope.id } } } : {}),
  });

  async function fetchColumn(choice: BoardChoice, stateId: string, after: string | null) {
    const variables = { first: PAGE_SIZE, after, filter: filterFor(choice, stateId) };
    const page =
      choice.scope.kind === "view"
        ? (
            await client.request<{ customView: { issues: Connection<never> } }>(
              "ViewColumnIssues",
              VIEW_COLUMN_ISSUES,
              { ...variables, viewId: choice.scope.id },
            )
          ).customView.issues
        : (await client.request<{ issues: Connection<never> }>("ColumnIssues", COLUMN_ISSUES, variables)).issues;
    return { issues: page.nodes.map(toIssue), page: page.pageInfo as Page };
  }

  async function loadSetup(teamId: string) {
    const data = await client.request<{
      team: { states: { nodes: WorkflowState[] }; projects: { nodes: Project[] } };
      customViews: { nodes: View[] };
    }>("TeamSetup", TEAM_SETUP, { teamId, teamFilterId: teamId });
    return {
      states: sortStates(data.team.states.nodes),
      projects: [...data.team.projects.nodes].sort((a, b) => a.name.localeCompare(b.name)),
      views: [...data.customViews.nodes].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** Loads the first page of every column. `full` also re-reads the team's states, projects and views. */
  async function load(full: boolean) {
    let choice = state.choice;
    if (!choice) return;
    const mine = generation;
    const since = moveSeq;
    const setup = full ? await loadSetup(choice.teamId) : null;
    if (mine !== generation) return;
    // A remembered project or view that has since been deleted would otherwise break the board for good.
    let dropped = false;
    if (setup && choice.scope.kind !== "team") {
      const scopeId = choice.scope.id;
      const known = (choice.scope.kind === "project" ? setup.projects : setup.views).some((x) => x.id === scopeId);
      if (!known) {
        choice = { teamId: choice.teamId, scope: { kind: "team" } };
        writePrefs(choice);
        dropped = true;
      }
    }
    const loading = choice;
    const states = setup?.states ?? state.states;
    const pages = await Promise.all(states.map((s) => fetchColumn(loading, s.id, null)));
    if (mine !== generation) return;
    set((current) => {
      const issues: Record<string, Issue> = {};
      const columns: Record<string, Column> = {};
      states.forEach((s, index) => {
        const result = pages[index]!;
        columns[s.id] = {
          ids: result.issues.map((issue) => issue.id),
          hasMore: result.page.hasNextPage,
          cursor: result.page.endCursor,
          loadingMore: false,
        };
        for (const issue of result.issues) issues[issue.id] = issue;
      });
      // A move under way, or finished since this read began, is the freshest word on that issue.
      const keep = new Set(current.moving);
      for (const [id, at] of movedAt) if (at > since) keep.add(id);
      for (const id of keep) {
        const local = current.issues[id];
        if (!local) continue;
        for (const column of Object.values(columns)) column.ids = column.ids.filter((x) => x !== id);
        const target = columns[local.stateId];
        if (target) target.ids.push(id);
        issues[id] = local;
      }
      for (const issue of Object.values(issues)) watermark = newer(watermark, issue.updatedAt);
      return {
        ...(setup ? { states: setup.states, projects: setup.projects, views: setup.views } : {}),
        ...(dropped ? { choice: loading, notice: "The saved filter no longer exists, so the board shows all issues." } : {}),
        issues,
        columns,
        phase: "ready" as const,
        problem: null,
        refreshedAt: now(),
      };
    });
  }

  /** Runs `load`, or after the one already running if one is. Failures become `problem`. */
  function refresh(full = false): Promise<void> {
    if (refreshing) {
      pendingFull = (pendingFull ?? false) || full;
      return refreshing;
    }
    const mine = generation;
    set({ refreshing: true, ...(state.phase === "idle" || state.phase === "blocked" ? { phase: "loading" as const } : {}) });
    refreshing = (async () => {
      try {
        await load(full);
      } catch (error) {
        // An answer that arrives after the team, filter or key changed is not this board's business.
        if (mine === generation) settleFailure(error);
      } finally {
        refreshing = undefined;
        set({ refreshing: false });
      }
      if (pendingFull !== undefined) {
        const again = pendingFull;
        pendingFull = undefined;
        await refresh(again);
      }
    })();
    return refreshing;
  }

  async function choose(choice: BoardChoice, full = true) {
    generation += 1;
    writePrefs(choice);
    if (full) {
      watermark = null;
      details.clear();
    }
    set({
      choice,
      ...(full ? { states: [], projects: [], views: [], issues: {}, columns: {} } : {}),
      phase: "loading",
      problem: null,
    });
    await refresh(full);
  }

  /** Loads the teams and opens the remembered (or first) one. Safe to call again after a key change. */
  async function start(): Promise<void> {
    generation += 1;
    const mine = generation;
    watermark = null;
    set({ ...initial, phase: "loading", notice: state.notice });
    try {
      const data = await client.request<{ teams: { nodes: Team[] } }>("Teams", TEAMS);
      if (mine !== generation) return;
      const teams = [...data.teams.nodes].sort((a, b) => a.name.localeCompare(b.name));
      const saved = readPrefs();
      const team = teams.find((t) => t.id === saved?.teamId) ?? teams[0];
      set({ teams });
      if (!team) {
        set({ phase: "ready", problem: { kind: "rejected", message: "This key can see no Linear teams." } });
        return;
      }
      await choose({ teamId: team.id, scope: team.id === saved?.teamId ? saved.scope : { kind: "team" } });
    } catch (error) {
      if (mine === generation) settleFailure(error);
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => state,
    start,

    selectTeam: (teamId: string) => choose({ teamId, scope: { kind: "team" } }),
    selectScope: (scope: Scope) =>
      state.choice ? choose({ teamId: state.choice.teamId, scope }, false) : Promise.resolve(),
    /** Reads everything again; with nothing loaded yet (the first load failed) that means starting over. */
    refresh: () => (state.choice ? refresh(true) : start()),

    /** The refresh timer's tick: one small query, and a reload only when something changed. */
    async tick(): Promise<void> {
      const choice = state.choice;
      if (!choice || state.phase !== "ready" || refreshing || probing || state.moving.length) return;
      // The window coming back fires several events at once; once is enough.
      if (now() - lastProbeAt < 2000) return;
      if (state.problem?.retryAt && state.problem.retryAt > now()) return;
      lastProbeAt = now();
      probing = true;
      const mine = generation;
      // An empty board has nothing to measure against, so it uses the clock, a minute back.
      const since = watermark ?? new Date((state.refreshedAt ?? now()) - 60_000).toISOString();
      try {
        const data = await client.request<{ issues: { nodes: { id: string; updatedAt: string }[] } }>(
          "ChangedSince",
          CHANGED_SINCE,
          { filter: { team: { id: { eq: choice.teamId } }, updatedAt: { gt: since } } },
        );
        if (mine !== generation) return;
        const latest = data.issues.nodes[0];
        if (latest) {
          // Changes outside the loaded board (another project, another page) must not fire this again.
          watermark = newer(watermark, latest.updatedAt);
          probing = false;
          await refresh(false);
        } else if (state.problem) set({ problem: null });
      } catch (error) {
        if (mine === generation) set({ problem: fail(error) });
      } finally {
        probing = false;
      }
    },

    async loadMore(stateId: string): Promise<void> {
      const choice = state.choice;
      const column = state.columns[stateId];
      if (!choice || !column?.hasMore || column.loadingMore) return;
      const mine = generation;
      const since = moveSeq;
      const patch = (next: Partial<Column>) =>
        set((current) => ({ columns: { ...current.columns, [stateId]: { ...current.columns[stateId]!, ...next } } }));
      patch({ loadingMore: true });
      try {
        const result = await fetchColumn(choice, stateId, column.cursor);
        if (mine !== generation) return;
        set((current) => {
          const existing = current.columns[stateId]!;
          const known = new Set(existing.ids);
          // A card that was moved while this page was in flight keeps the place the move gave it.
          const fresh = result.issues.filter(
            (issue) => !known.has(issue.id) && !current.moving.includes(issue.id) && !((movedAt.get(issue.id) ?? 0) > since),
          );
          for (const issue of fresh) watermark = newer(watermark, issue.updatedAt);
          return {
            issues: { ...current.issues, ...Object.fromEntries(fresh.map((issue) => [issue.id, issue])) },
            columns: {
              ...current.columns,
              [stateId]: {
                ids: [...existing.ids, ...fresh.map((issue) => issue.id)],
                hasMore: result.page.hasNextPage,
                cursor: result.page.endCursor,
                loadingMore: false,
              },
            },
          };
        });
      } catch (error) {
        if (mine !== generation) return;
        patch({ loadingMore: false });
        set({ notice: fail(error).message });
      }
    },

    /** Moves a card to another column: shown at once, then sent; put back if Linear says no. */
    async move(issueId: string, stateId: string): Promise<void> {
      const issue = state.issues[issueId];
      const target = state.states.find((s) => s.id === stateId);
      if (!issue || !target || issue.stateId === stateId || state.moving.includes(issueId)) return;
      if (target.type === "duplicate") {
        // Linear refuses this ("missing duplicate relation"): it puts an issue there only when it is marked a duplicate of another.
        set({ notice: `${issue.identifier} was not moved to ${target.name}: Linear only does that when the issue is marked a duplicate of another, which the board cannot do.` });
        return;
      }
      const mine = generation;
      const before = state;
      movedAt.set(issueId, (moveSeq += 1));
      const relocate = (current: Snapshot, from: string, to: string, next: Issue): Partial<Snapshot> => {
        const columns = { ...current.columns };
        if (from !== to) {
          const source = columns[from];
          const dest = columns[to];
          if (source) columns[from] = { ...source, ids: source.ids.filter((id) => id !== issueId) };
          if (dest && !dest.ids.includes(issueId)) columns[to] = { ...dest, ids: [...dest.ids, issueId] };
        }
        return { columns, issues: { ...current.issues, [issueId]: next } };
      };
      set((current) => ({
        ...relocate(current, issue.stateId, stateId, { ...issue, stateId }),
        moving: [...current.moving, issueId],
        notice: null,
      }));
      const done = () => {
        movedAt.set(issueId, (moveSeq += 1));
        set((current) => ({ moving: current.moving.filter((id) => id !== issueId) }));
      };
      try {
        const data = await client.request<{ issueUpdate: { success: boolean; issue: never | null } }>(
          "MoveIssue",
          MOVE_ISSUE,
          { id: issueId, stateId },
        );
        if (!data.issueUpdate.success || !data.issueUpdate.issue) throw new LinearError("rejected", "Linear did not accept the move.");
        if (mine !== generation) return done();
        const saved = toIssue(data.issueUpdate.issue);
        set((current) => ({
          ...relocate(current, current.issues[issueId]?.stateId ?? stateId, saved.stateId, saved),
          settled: issueId,
        }));
        watermark = newer(watermark, saved.updatedAt); // our own change is not news
        done();
      } catch (error) {
        if (mine === generation) {
          // Back to exactly where it was, unless the board moved on in the meantime.
          set((current) => ({
            ...relocate(current, current.issues[issueId]?.stateId ?? stateId, issue.stateId, before.issues[issueId]!),
            notice: `${issue.identifier} was not moved to ${target.name}: ${fail(error).message}`,
            ...(error instanceof LinearError && error.kind === "auth" ? { phase: "blocked" as const, problem: fail(error) } : {}),
          }));
        }
        done();
      }
    },

    clearSettled: () => set({ settled: null }),
    dismissNotice: () => set({ notice: null }),

    /** An issue's description and sub-issues, read again whenever the issue has changed since. */
    async detail(issueId: string): Promise<IssueDetail> {
      const key = `${issueId}:${state.issues[issueId]?.updatedAt ?? ""}`;
      const cached = details.get(key);
      if (cached) return cached;
      const data = await client.request<{ issue: Parameters<typeof toDetail>[0] }>("IssueDetail", ISSUE_DETAIL, {
        id: issueId,
      });
      const detail = toDetail(data.issue);
      details.set(key, detail);
      return detail;
    },

    /** Forget everything, for when the key is removed or replaced. */
    reset() {
      generation += 1;
      watermark = null;
      details.clear();
      movedAt.clear();
      set({ ...initial, notice: null });
    },
  };
}

export type BoardStore = ReturnType<typeof createBoardStore>;
