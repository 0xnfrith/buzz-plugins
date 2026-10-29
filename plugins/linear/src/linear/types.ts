export type StateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | "duplicate";

export type Team = { id: string; key: string; name: string; color: string | null };

export type WorkflowState = {
  id: string;
  name: string;
  type: StateType;
  color: string;
  position: number;
};

export type Project = { id: string; name: string; color: string | null };
export type View = { id: string; name: string; color: string | null };

export type PullRequest = {
  url: string;
  number: number | null;
  status: "open" | "merged" | "closed" | "draft" | "unknown";
};

export type Label = { id: string; name: string; color: string };

/** 0 none, 1 urgent, 2 high, 3 medium, 4 low: Linear's own numbering. */
export type Priority = 0 | 1 | 2 | 3 | 4;

export type Issue = {
  id: string;
  identifier: string;
  title: string;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  url: string;
  sortOrder: number;
  stateId: string;
  parent: { identifier: string; title: string } | null;
  assignee: { id: string; name: string } | null;
  project: Project | null;
  labels: Label[];
  pullRequests: PullRequest[];
  /** Sub-issues finished out of those still counted (cancelled ones are left out). */
  progress: { done: number; total: number } | null;
};

export type IssueDetail = {
  description: string;
  creator: string | null;
  dueDate: string | null;
  estimate: number | null;
  subIssues: { id: string; identifier: string; title: string; state: { name: string; type: StateType; color: string } }[];
};

export type Page = { hasNextPage: boolean; endCursor: string | null };

export type Scope =
  | { kind: "team" }
  | { kind: "project"; id: string }
  | { kind: "view"; id: string };

export type BoardChoice = { teamId: string; scope: Scope };
