// A stand-in for api.linear.app. It runs graphql-js against Linear's own published schema,
// so a query with a wrong field, argument or variable type fails here as it would there.
// `handle` has the shape of Buzz's `ctx.host.request`, so a test can hand it straight to the
// plugin. It can also be served over HTTPS (serve.mjs).
import { execute, parse, validate } from "graphql";
import { createWorld, issueView, KEYS } from "./world.mjs";
import { loadSchema } from "./schema.mjs";

const schema = loadSchema();
const ORIGIN = "https://api.linear.app";

const authError = (message = "Authentication required, not authenticated") => ({
  status: 401,
  body: {
    errors: [{ message, extensions: { type: "authentication error", code: "AUTHENTICATION_ERROR", userError: true } }],
  },
});

/** Linear answers `ID` filters as `{ eq: "…" }` and so on; anything else is refused loudly. */
function matcher(world, filter) {
  const checks = [];
  for (const [field, value] of Object.entries(filter ?? {})) {
    if (field === "team" && value?.id) checks.push((r) => compare(r.teamId, value.id));
    else if (field === "state" && value?.id) checks.push((r) => compare(r.stateId, value.id));
    else if (field === "project" && value?.id)
      checks.push((r) => compare(r.projectSlug ? `proj-${r.projectSlug}` : null, value.id));
    else if (field === "updatedAt") checks.push((r) => compare(r.updatedAt, value));
    else throw new Error(`fake Linear does not implement the IssueFilter field "${field}"`);
  }
  return (record) => checks.every((check) => check(record));
}

function compare(actual, comparator) {
  for (const [op, expected] of Object.entries(comparator)) {
    if (op === "eq" && actual !== expected) return false;
    if (op === "gt" && !(actual > expected)) return false;
    if (!["eq", "gt"].includes(op)) throw new Error(`fake Linear does not implement the comparator "${op}"`);
  }
  return true;
}

function connection(world, records, { first = 50, after, orderBy, includeArchived }) {
  const sorted = [...records]
    .filter((r) => includeArchived || !r.archivedAt)
    // Linear's default order is by creation, not by change; a query that wants the latter must say so.
    .sort((a, b) => (orderBy === "updatedAt" ? b.updatedAt.localeCompare(a.updatedAt) : b.createdAt.localeCompare(a.createdAt)));
  const start = after ? Number(Buffer.from(after, "base64").toString()) + 1 : 0;
  const slice = sorted.slice(start, start + first);
  const end = start + slice.length - 1;
  return {
    nodes: slice.map((record) => issueView(world, record)),
    pageInfo: {
      hasNextPage: end + 1 < sorted.length,
      endCursor: slice.length ? Buffer.from(String(end)).toString("base64") : null,
    },
  };
}

export function createFakeLinear({ keys = [KEYS.good] } = {}) {
  const world = createWorld();
  const valid = new Set(keys);
  const faults = [];
  const held = new Map();
  const log = { requests: [], operations: {} };
  const control = {
    world,
    log,
    /** The next request (or the next one for `operation`) fails this way. */
    fail(kind, { operation } = {}) {
      faults.push({ kind, operation });
    },
    /** Every answer waits this long first. */
    latency: 0,
    /**
     * Answers to `operation` are worked out when asked (so they show the world as it is now) but
     * not delivered until the returned function is called: a slow reply that lands late.
     */
    hold(operation) {
      let release;
      held.set(operation, new Promise((resolve) => (release = resolve)));
      return () => {
        held.delete(operation);
        release();
      };
    },
    /** Which keys are valid, for revoking one mid-test. */
    revoke(key) {
      valid.delete(key);
    },
    /** Something changed in Linear behind the app's back. */
    touch(identifier, change = {}) {
      const record = world.records.find((r) => r.identifier === identifier);
      if (change.stateSlug) record.stateId = `${record.teamId}:${change.stateSlug}`;
      if (change.title) record.title = change.title;
      record.updatedAt = world.clock();
    },
  };

  const rootValue = {
    viewer: () => world.viewer,
    organization: () => world.organization,
    teams: () => ({ nodes: world.teams }),
    team: ({ id }) => {
      const team = world.teams.find((t) => t.id === id);
      if (!team) throw new Error("Entity not found: Team");
      return {
        id: team.id,
        states: { nodes: world.states.filter((s) => s.teamId === id) },
        projects: { nodes: world.projects.filter((p) => p.teamId === id) },
      };
    },
    customViews: ({ filter }) => ({
      nodes: world.views.filter((v) => !filter?.team?.id?.eq || v.teamId === filter.team.id.eq),
    }),
    customView: ({ id }) => {
      const view = world.views.find((v) => v.id === id);
      if (!view) throw new Error("Entity not found: CustomView");
      return {
        id: view.id,
        issues: (args) =>
          connection(world, world.records.filter((r) => view.matches(r) && matcher(world, args.filter)(r)), args),
      };
    },
    issues: (args) => connection(world, world.records.filter(matcher(world, args.filter)), args),
    issue: ({ id }) => {
      const record = world.records.find((r) => r.id === id || r.identifier === id);
      if (!record) throw new Error("Entity not found: Issue");
      return issueView(world, record);
    },
    issueUpdate: ({ id, input }) => {
      const record = world.records.find((r) => r.id === id);
      if (!record) throw new Error("Entity not found: Issue");
      if (input.stateId) {
        const state = world.stateOf(input.stateId);
        if (!state || state.teamId !== record.teamId) throw new Error("Argument Validation Error: stateId is not in this team");
        // What Linear answers (checked against a real workspace): an issue reaches Duplicate only by being marked a duplicate of another.
        if (state.type === "duplicate" && record.stateId !== state.id) throw new Error("missing duplicate relation");
        record.stateId = state.id;
      }
      record.updatedAt = world.clock();
      return { success: true, issue: issueView(world, record) };
    },
  };

  /** Same signature as `ctx.host.request`, answered locally. */
  async function handle(request) {
    if (control.latency) await new Promise((resolve) => setTimeout(resolve, control.latency));
    const url = new URL(request.url);
    if (url.origin !== ORIGIN) throw new Error("Host request origin is not declared");
    if (url.pathname !== "/graphql" || (request.method ?? "GET") !== "POST")
      return respond(404, { errors: [{ message: "Not found" }] });

    const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    let payload;
    try {
      payload = JSON.parse(request.body ?? "");
    } catch {
      return respond(400, { errors: [{ message: "Body must be JSON" }] });
    }
    const operation = payload.operationName ?? "";
    log.requests.push({ operation, variables: payload.variables });
    log.operations[operation] = (log.operations[operation] ?? 0) + 1;

    const fault = faults.findIndex((f) => !f.operation || f.operation === operation);
    if (fault >= 0) {
      const [{ kind }] = faults.splice(fault, 1);
      if (kind === "network") throw new Error("Host request failed");
      if (kind === "server") return respond(502, { errors: [{ message: "Bad gateway" }] });
      if (kind === "rate-limit")
        return respond(
          400,
          { errors: [{ message: "Rate limit exceeded", extensions: { type: "ratelimited", code: "RATELIMITED" } }] },
          { "x-ratelimit-requests-reset": String(Date.parse("2026-10-23T15:05:00Z")) },
        );
      if (kind === "forbidden")
        return respond(403, { errors: [{ message: "forbidden", extensions: { type: "forbidden", code: "FORBIDDEN" } }] });
      // A GraphQL error whose wording repeats what it was sent, the key among it: the plugin must never show that text.
      if (kind === "echo")
        return respond(200, { errors: [{ message: `Argument Validation Error: authorization "${headers.authorization}" is not allowed here`, extensions: { code: "INVALID_INPUT" } }], data: null });
      if (kind === "reject")
        return respond(200, { errors: [{ message: "Argument Validation Error", extensions: { code: "INVALID_INPUT" } }], data: null });
    }

    const key = headers.authorization;
    if (!key || !valid.has(key)) {
      const { status, body } = authError();
      return respond(status, body);
    }

    let document;
    try {
      document = parse(payload.query);
    } catch (error) {
      return respond(400, { errors: [{ message: error.message }] });
    }
    const problems = validate(schema, document);
    if (problems.length)
      return respond(400, {
        errors: problems.map((p) => ({ message: p.message, extensions: { code: "GRAPHQL_VALIDATION_FAILED" } })),
      });
    const result = await execute({ schema, document, rootValue, variableValues: payload.variables, operationName: operation || undefined });
    const answer = respond(200, JSON.parse(JSON.stringify(result)), { "x-complexity": "1" });
    const gate = held.get(operation);
    if (gate) await gate;
    return answer;
  }

  return { handle, control, keys: KEYS };
}

function respond(status, body, headers = {}) {
  return { status, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}
