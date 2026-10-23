import { React } from "../react";
import type { Issue, PullRequest, WorkflowState } from "../linear/types";
import { hue, initials, PRIORITY_LABEL, shortDate } from "./format";
import { PriorityIcon, ProgressIcon, ProjectIcon, PullRequestIcon, StatusIcon, UserIcon } from "./icons";

export type CardProps = {
  issue: Issue;
  state: WorkflowState;
  fraction: number;
  selected: boolean;
  dragging: boolean;
  moving: boolean;
  settled: boolean;
  onOpen(issue: Issue): void;
  onPointerDown(event: React.PointerEvent<HTMLDivElement>, issue: Issue): void;
};

export function Avatar({ name, size = 18 }: { name: string | null; size?: number }) {
  if (!name) return <UserIcon size={size} />;
  return (
    <span
      className="mtl-avatar"
      aria-hidden="true"
      style={{ width: size, height: size, background: `hsl(${hue(name)} 45% 38%)`, fontSize: Math.round(size * 0.44) }}
    >
      {initials(name)}
    </span>
  );
}

/** One PR chip says its number; several say how many. */
export function prLabel(prs: readonly PullRequest[]): string {
  const [only] = prs;
  return prs.length === 1 && only?.number != null ? `#${only.number}` : `${prs.length} PRs`;
}

/** The worst news among the PRs decides the chip's colour: open work first, then merged, then closed. */
export function prStatus(prs: readonly PullRequest[]): PullRequest["status"] {
  for (const status of ["open", "draft", "merged", "closed"] as const)
    if (prs.some((pr) => pr.status === status)) return status;
  return "unknown";
}

export function Card({ issue, state, fraction, selected, dragging, moving, settled, onOpen, onPointerDown }: CardProps) {
  const chips: React.ReactNode[] = [];
  chips.push(
    <span key="priority" className="mtl-chip mtl-chip-icon" title={PRIORITY_LABEL[issue.priority]} data-priority={issue.priority}>
      <PriorityIcon priority={issue.priority} />
    </span>,
  );
  for (const label of issue.labels.slice(0, 2))
    chips.push(
      <span key={label.id} className="mtl-chip">
        <span className="mtl-dot" style={{ background: label.color }} />
        {label.name}
      </span>,
    );
  if (issue.labels.length > 2)
    chips.push(
      <span key="more-labels" className="mtl-chip" title={issue.labels.slice(2).map((l) => l.name).join(", ")}>
        +{issue.labels.length - 2}
      </span>,
    );
  if (issue.project)
    chips.push(
      <span key="project" className="mtl-chip" title={issue.project.name}>
        <ProjectIcon color={issue.project.color ?? "currentColor"} />
        <span className="mtl-chip-text">{issue.project.name}</span>
      </span>,
    );
  if (issue.pullRequests.length)
    chips.push(
      <span key="prs" className="mtl-chip mtl-chip-pr" data-status={prStatus(issue.pullRequests)} title="Pull requests">
        <PullRequestIcon status={prStatus(issue.pullRequests)} />
        {prLabel(issue.pullRequests)}
      </span>,
    );
  if (issue.progress)
    chips.push(
      <span key="progress" className="mtl-chip" title="Sub-issues done">
        <ProgressIcon done={issue.progress.done} total={issue.progress.total} />
        {issue.progress.done}/{issue.progress.total}
      </span>,
    );

  const summary = [
    issue.identifier,
    issue.title,
    state.name,
    PRIORITY_LABEL[issue.priority],
    issue.assignee ? `assigned to ${issue.assignee.name}` : "unassigned",
  ].join(", ");

  return (
    <div
      role="button"
      tabIndex={0}
      className="mtl-card"
      aria-label={summary}
      aria-haspopup="dialog"
      aria-expanded={selected}
      aria-busy={moving || undefined}
      data-issue-id={issue.id}
      data-identifier={issue.identifier}
      data-selected={selected || undefined}
      data-dragging={dragging || undefined}
      data-moving={moving || undefined}
      data-settled={settled || undefined}
      onClick={() => onOpen(issue)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(issue);
        }
      }}
      onPointerDown={(event) => onPointerDown(event, issue)}
    >
      <div className="mtl-card-top">
        <span className="mtl-card-id">
          <span className="mtl-id">{issue.identifier}</span>
          {issue.parent && (
            <>
              <span className="mtl-crumb-sep">›</span>
              <span className="mtl-crumb">{issue.parent.title}</span>
            </>
          )}
        </span>
        <span className="mtl-card-assignee" title={issue.assignee?.name ?? "Unassigned"}>
          <Avatar name={issue.assignee?.name ?? null} />
        </span>
      </div>
      <div className="mtl-card-title">
        <StatusIcon type={state.type} color={state.color} fraction={fraction} />
        <span className="mtl-title">{issue.title}</span>
      </div>
      <div className="mtl-chips">{chips}</div>
      <div className="mtl-card-foot">Created {shortDate(issue.createdAt)}</div>
    </div>
  );
}
