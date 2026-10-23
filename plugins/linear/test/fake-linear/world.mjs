// The invented workspace the fake Linear serves. Everything here is made up for the tests:
// no real company, person, project or issue.

const DAY = 24 * 60 * 60 * 1000;
/** The "now" of the fixture, so dates on screen are the same in every run. */
export const FIXTURE_NOW = Date.parse("2026-10-23T15:00:00.000Z");

export const KEYS = {
  good: "test-key-good",
  other: "test-key-other",
};

// Linear lists the Duplicate state first in what its API returns, and gives it its own type, "duplicate"; the board must still end with it.
const STATES = [
  ["duplicate", "Duplicate", "duplicate", "#95a2b3", -1],
  ["backlog", "Backlog", "backlog", "#bec2c8", 0],
  ["todo", "Todo", "unstarted", "#e2e2e2", 1],
  ["doing", "In Progress", "started", "#f2c94c", 2],
  ["review", "In Review", "started", "#5e6ad2", 3],
  ["done", "Done", "completed", "#5e6ad2", 4],
  ["canceled", "Canceled", "canceled", "#95a2b3", 5],
];

const PEOPLE = ["Avery Quill", "Jordan Reyes", "Sam Okafor", "Riley Tanaka"];

/** [identifier number, title, state, priority, daysAgo, extras] */
const ISSUES = [
  [101, "Draft the onboarding checklist for new teammates", "backlog", 0, 9, {}],
  [102, "Replace the flaky smoke test with a deterministic one", "backlog", 2, 8, { labels: ["Bug"], project: "stability" }],
  [103, "Audit third-party licences before the first public build", "backlog", 3, 8, { labels: ["Compliance"] }],
  [104, "Investigate slow cold start on older laptops", "backlog", 1, 7, { labels: ["Performance"], project: "stability" }],
  [105, "Write the migration guide for the settings rename", "backlog", 4, 7, { project: "docs" }],
  [106, "Prototype keyboard shortcuts for the review queue", "backlog", 0, 6, { parent: 130 }],
  [107, "Decide which regions get a staging environment first, and when", "backlog", 3, 6, {}],
  [110, "Add the status page link to the footer", "todo", 3, 5, { project: "launch" }],
  [111, "Review the draft pricing page copy with the whole team before Friday's freeze", "todo", 2, 5, { project: "launch", labels: ["Copy"] }],
  [112, "Confirm backup restore works from a cold copy", "todo", 1, 4, { labels: ["Ops"], project: "stability" }],
  [120, "Ship the board view behind a flag", "doing", 2, 4, { project: "launch", prs: [{ n: 412, s: "open" }, { n: 415, s: "open" }, { n: 418, s: "draft" }], children: ["completed", "completed", "started", "unstarted"] }],
  [121, "Export reports as CSV", "doing", 3, 4, { prs: [{ n: 409, s: "open" }], labels: ["Feature"] }],
  [122, "Fix the date picker losing focus on Escape", "doing", 1, 3, { labels: ["Bug"], prs: [{ n: 417, s: "draft" }], assignee: 1 }],
  [123, "Cache the team list between page loads", "doing", 0, 3, { assignee: 2 }],
  [130, "Keyboard-first review queue", "doing", 3, 12, { project: "launch", children: ["completed", "started", "backlog", "backlog", "canceled"] }],
  [131, "Sort the notification settings into groups", "review", 3, 6, { prs: [{ n: 401, s: "open" }], assignee: 0 }],
  [132, "Rework the empty states", "review", 4, 6, { prs: [{ n: 399, s: "merged" }], labels: ["Design"], project: "docs" }],
  [133, "Rate-limit the public sign-up form", "review", 1, 5, { prs: [{ n: 405, s: "open" }, { n: 406, s: "closed" }], labels: ["Security"] }],
  [140, "Move the build cache to the new bucket", "done", 3, 6, { prs: [{ n: 380, s: "merged" }] }],
  [141, "Remove the unused analytics script", "done", 0, 6, { prs: [{ n: 383, s: "merged" }] }],
  [142, "Write the release notes for 0.9", "done", 4, 5, { project: "docs" }],
  [143, "Tidy the dark-mode borders", "done", 4, 5, { labels: ["Design"] }],
  [150, "Switch the mascot to the new artwork", "canceled", 0, 7, {}],
  [151, "Support a second payment provider", "canceled", 3, 6, { prs: [{ n: 377, s: "closed" }] }],
  [152, "Same report as the mascot artwork one", "duplicate", 1, 6, {}],
];

// Enough finished work that "Done" has a second page.
for (let n = 0; n < 56; n += 1)
  ISSUES.push([200 + n, `Housekeeping task ${n + 1}: archive the old checklist items`, "done", 0, 14 + (n % 9), {}]);

const OTHER_TEAM_ISSUES = [
  [10, "Sketch the new icon set", "backlog", 0, 3, {}],
  [11, "Collect feedback on the sidebar spacing", "todo", 3, 2, {}],
  [12, "Final pass on the marketing illustrations", "doing", 2, 1, {}],
];

export function createWorld() {
  let clock = FIXTURE_NOW;
  const nextStamp = () => new Date((clock += 1000)).toISOString();

  const teams = [
    { id: "team-plt", key: "PLT", name: "Platform", color: "#5e6ad2" },
    { id: "team-dsn", key: "DSN", name: "Design", color: "#f2994a" },
  ];
  const projects = [
    { id: "proj-launch", name: "Launch readiness", color: "#4cb782", teamId: "team-plt" },
    { id: "proj-stability", name: "Stability", color: "#eb5757", teamId: "team-plt" },
    { id: "proj-docs", name: "Docs refresh", color: "#26b5ce", teamId: "team-plt" },
  ];
  const labelPool = Object.fromEntries(
    [
      ["Bug", "#eb5757"],
      ["Feature", "#bb87fc"],
      ["Performance", "#f2994a"],
      ["Design", "#4ea7fc"],
      ["Security", "#e5484d"],
      ["Copy", "#26b5ce"],
      ["Ops", "#95a2b3"],
      ["Compliance", "#f2c94c"],
    ].map(([name, color]) => [name, { id: `label-${name.toLowerCase()}`, name, color }]),
  );
  const states = teams.flatMap((team) =>
    STATES.map(([slug, name, type, color, position]) => ({
      id: `${team.id}:${slug}`,
      teamId: team.id,
      name,
      type,
      color,
      position,
    })),
  );
  const stateOf = (id) => states.find((s) => s.id === id);

  const records = [];
  const addIssues = (teamId, key, list) => {
    list.forEach(([number, title, slug, priority, daysAgo, extras], index) => {
      const created = new Date(FIXTURE_NOW - daysAgo * DAY - index * 60_000).toISOString();
      records.push({
        id: `issue-${key}-${number}`,
        number,
        identifier: `${key}-${number}`,
        title,
        description: `${title}.\n\nA longer description for the details panel.\n\n- one thing\n- another thing\n\nSee https://example.com/notes/${number} for background.`,
        priority,
        createdAt: created,
        updatedAt: created,
        sortOrder: -index * 1000 - number,
        teamId,
        stateId: `${teamId}:${slug}`,
        parentNumber: extras.parent ?? null,
        assigneeIndex: extras.assignee ?? null,
        projectSlug: extras.project ?? null,
        labels: (extras.labels ?? []).map((name) => labelPool[name]),
        prs: extras.prs ?? [],
        childTypes: extras.children ?? [],
        archivedAt: null,
      });
    });
  };
  addIssues("team-plt", "PLT", ISSUES);
  addIssues("team-dsn", "DSN", OTHER_TEAM_ISSUES);

  const views = [
    {
      id: "view-mine",
      name: "Open bugs",
      color: "#eb5757",
      teamId: "team-plt",
      matches: (r) => r.labels.some((l) => l.name === "Bug") && !["completed", "canceled"].includes(stateOf(r.stateId).type),
    },
  ];

  const world = {
    clock: nextStamp,
    teams,
    states,
    projects,
    records,
    views,
    people: PEOPLE,
    organization: { name: "Fixture Studio" },
    viewer: { id: "user-0", name: PEOPLE[0], displayName: "avery" },
    stateOf,
  };
  return world;
}

/** The shape GraphQL walks for one issue record. */
export function issueView(world, record) {
  const state = world.stateOf(record.stateId);
  const view = {
    id: record.id,
    identifier: record.identifier,
    title: record.title,
    description: record.description,
    priority: record.priority,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    url: `https://linear.app/fixture/issue/${record.identifier}`,
    sortOrder: record.sortOrder,
    dueDate: null,
    estimate: null,
    state: { id: state.id, name: state.name, type: state.type, color: state.color, position: state.position },
    parent: null,
    assignee:
      record.assigneeIndex == null
        ? null
        : { id: `user-${record.assigneeIndex}`, name: world.people[record.assigneeIndex] },
    creator: { name: world.people[0] },
    project: null,
    labels: { nodes: record.labels },
    attachments: {
      nodes: record.prs.map((pr) => ({
        sourceType: "github",
        url: `https://github.com/fixture-org/fixture-repo/pull/${pr.n}`,
        metadata: { status: pr.s, draft: pr.s === "draft" },
      })),
    },
    children: { nodes: [] },
  };
  if (record.projectSlug) {
    const p = world.projects.find((x) => x.id === `proj-${record.projectSlug}`);
    view.project = { id: p.id, name: p.name, color: p.color };
  }
  if (record.parentNumber != null) {
    const parent = world.records.find((r) => r.teamId === record.teamId && r.number === record.parentNumber);
    if (parent) view.parent = { id: parent.id, identifier: parent.identifier, title: parent.title };
  }
  const kids = world.records.filter((r) => r.parentNumber === record.number && r.teamId === record.teamId);
  const synthetic = record.childTypes.map((type, i) => ({
    id: `${record.id}-child-${i}`,
    identifier: `${record.identifier}-${i + 1}`,
    title: `Sub-task ${i + 1}`,
    state: { id: `x${i}`, name: type, type, color: "#888888" },
  }));
  view.children = { nodes: [...kids.map((k) => issueView(world, k)), ...synthetic] };
  return view;
}
