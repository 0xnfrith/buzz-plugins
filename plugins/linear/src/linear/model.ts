import type {
  Issue,
  IssueDetail,
  Label,
  Priority,
  Project,
  PullRequest,
  StateType,
  WorkflowState,
} from "./types";

/** Linear's board order: triage first, then the lifecycle, then its own `position`. */
const TYPE_ORDER: Record<StateType, number> = {
  triage: 0,
  backlog: 1,
  unstarted: 2,
  started: 3,
  completed: 4,
  canceled: 5,
};

export function sortStates(states: readonly WorkflowState[]): WorkflowState[] {
  return [...states].sort(
    (a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.position - b.position,
  );
}

// Raw shapes as the IssueCard fragment returns them.
type RawIssue = {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  url: string;
  sortOrder: number;
  state: { id: string };
  parent: { identifier: string; title: string } | null;
  assignee: { id: string; name: string } | null;
  project: { id: string; name: string; color: string | null } | null;
  labels: { nodes: Label[] };
  attachments: { nodes: { sourceType: string | null; url: string; metadata: unknown }[] };
  children: { nodes: { state: { type: StateType } }[] };
};

export function toIssue(raw: RawIssue): Issue {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    priority: (raw.priority >= 0 && raw.priority <= 4 ? raw.priority : 0) as Priority,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    url: raw.url,
    sortOrder: raw.sortOrder,
    stateId: raw.state.id,
    parent: raw.parent,
    assignee: raw.assignee,
    project: raw.project as Project | null,
    labels: raw.labels.nodes,
    pullRequests: pullRequests(raw.attachments.nodes),
    progress: progress(raw.children.nodes),
  };
}

export function toDetail(raw: {
  description: string | null;
  dueDate: string | null;
  estimate: number | null;
  creator: { name: string } | null;
  subIssues: { nodes: IssueDetail["subIssues"] };
}): IssueDetail {
  return {
    description: raw.description ?? "",
    creator: raw.creator?.name ?? null,
    dueDate: raw.dueDate,
    estimate: raw.estimate,
    subIssues: raw.subIssues.nodes,
  };
}

/** GitHub pull requests Linear linked to the issue, found by their URL. */
export function pullRequests(
  attachments: readonly { sourceType: string | null; url: string; metadata: unknown }[],
): PullRequest[] {
  const found: PullRequest[] = [];
  for (const attachment of attachments) {
    const match = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/.exec(attachment.url);
    if (!match) continue;
    found.push({
      url: attachment.url,
      number: Number(match[1]),
      status: prStatus(attachment.metadata),
    });
  }
  return found;
}

function prStatus(metadata: unknown): PullRequest["status"] {
  if (!metadata || typeof metadata !== "object") return "unknown";
  const meta = metadata as { status?: unknown; draft?: unknown; merged?: unknown; closed?: unknown };
  if (meta.draft === true) return "draft";
  const status = typeof meta.status === "string" ? meta.status.toLowerCase() : "";
  if (status === "merged" || meta.merged === true) return "merged";
  if (status === "closed" || meta.closed === true) return "closed";
  if (status === "open" || status === "opened") return "open";
  if (status === "draft") return "draft";
  return "unknown";
}

/** Done out of all sub-issues that were not cancelled; none when there are no sub-issues. */
export function progress(
  children: readonly { state: { type: StateType } }[],
): { done: number; total: number } | null {
  const live = children.filter((child) => child.state.type !== "canceled");
  if (live.length === 0) return null;
  return { done: live.filter((child) => child.state.type === "completed").length, total: live.length };
}

/** Columns that are mostly history show what changed last; the others keep Linear's manual order. */
export function sortColumn(issues: readonly Issue[], type: StateType): Issue[] {
  const history = type === "completed" || type === "canceled";
  return [...issues].sort((a, b) =>
    history
      ? b.updatedAt.localeCompare(a.updatedAt)
      : a.sortOrder - b.sortOrder || b.createdAt.localeCompare(a.createdAt),
  );
}
