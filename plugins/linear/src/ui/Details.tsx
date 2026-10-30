import { React } from "../react";
import { acceptsMoves } from "../linear/model";
import type { BoardStore, Snapshot } from "../linear/store";
import type { Issue, IssueDetail } from "../linear/types";
import { Avatar, prLabel } from "./Card";
import { safeColor } from "./color";
import { fullDate, PRIORITY_LABEL } from "./format";
import { CloseIcon, ExternalIcon, PriorityIcon, ProgressIcon, PullRequestIcon, StatusIcon } from "./icons";

type Props = {
  issue: Issue;
  snapshot: Snapshot;
  store: BoardStore;
  onClose(): void;
};

const URL_PATTERN = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

/** Linear writes descriptions in Markdown; this shows them as plain text, with bare links made clickable. */
function Description({ text }: { text: string }) {
  if (!text.trim()) return <p className="mtl-muted">No description.</p>;
  return (
    <div className="mtl-description">
      {text.split(URL_PATTERN).map((part, index) =>
        index % 2 === 1 ? (
          <a key={index} href={part} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </div>
  );
}

export function Details({ issue, snapshot, store, onClose }: Props) {
  const [loaded, setLoaded] = React.useState<{ id: string; detail: IssueDetail } | null>(null);
  const [failed, setFailed] = React.useState(false);
  const detail = loaded?.id === issue.id ? loaded.detail : null;
  const panel = React.useRef<HTMLElement | null>(null);
  const state = snapshot.states.find((s) => s.id === issue.stateId);
  const busy = snapshot.moving.includes(issue.id);

  // Read again whenever the issue has changed since (a new `updatedAt`), without blanking what is shown meanwhile.
  React.useEffect(() => {
    let current = true;
    setFailed(false);
    store.detail(issue.id).then(
      (value) => current && setLoaded({ id: issue.id, detail: value }),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [issue.id, issue.updatedAt, store]);

  React.useEffect(() => {
    panel.current?.focus();
  }, [issue.id]);

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={`${issue.identifier} ${issue.title}`}
      className="mtl-details"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="mtl-details-head">
        <span className="mtl-id">{issue.identifier}</span>
        <button type="button" className="mtl-icon-button" aria-label="Close details" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="mtl-details-body">
        <h2 className="mtl-details-title">{issue.title}</h2>
        <dl className="mtl-fields">
          <dt>Status</dt>
          <dd>
            {state && <StatusIcon type={state.type} color={state.color} />}
            <select
              aria-label="Status"
              value={issue.stateId}
              disabled={busy}
              onChange={(event) => void store.move(issue.id, event.target.value)}
            >
              {snapshot.states.map((s) => (
                // Linear only moves an issue to Duplicate by marking it a duplicate of another, which the board cannot do.
                <option key={s.id} value={s.id} disabled={!acceptsMoves(s.type)}>
                  {s.name}
                </option>
              ))}
            </select>
          </dd>
          <dt>Priority</dt>
          <dd>
            <PriorityIcon priority={issue.priority} />
            {PRIORITY_LABEL[issue.priority]}
          </dd>
          <dt>Assignee</dt>
          <dd>
            <Avatar name={issue.assignee?.name ?? null} />
            {issue.assignee?.name ?? "Unassigned"}
          </dd>
          {issue.project && (
            <>
              <dt>Project</dt>
              <dd>{issue.project.name}</dd>
            </>
          )}
          {issue.parent && (
            <>
              <dt>Parent</dt>
              <dd>
                {issue.parent.identifier} {issue.parent.title}
              </dd>
            </>
          )}
          {issue.labels.length > 0 && (
            <>
              <dt>Labels</dt>
              <dd className="mtl-wrap">
                {issue.labels.map((label) => (
                  <span key={label.id} className="mtl-chip">
                    <span className="mtl-dot" style={{ background: safeColor(label.color) }} />
                    {label.name}
                  </span>
                ))}
              </dd>
            </>
          )}
          <dt>Created</dt>
          <dd>{fullDate(issue.createdAt)}</dd>
          <dt>Updated</dt>
          <dd>{fullDate(issue.updatedAt)}</dd>
          {detail?.creator && (
            <>
              <dt>Creator</dt>
              <dd>{detail.creator}</dd>
            </>
          )}
          {detail?.dueDate && (
            <>
              <dt>Due</dt>
              <dd>{fullDate(detail.dueDate)}</dd>
            </>
          )}
          {detail?.estimate != null && (
            <>
              <dt>Estimate</dt>
              <dd>{detail.estimate}</dd>
            </>
          )}
        </dl>

        {issue.pullRequests.length > 0 && (
          <section className="mtl-section" aria-label="Pull requests">
            <h3>Pull requests ({prLabel(issue.pullRequests)})</h3>
            <ul className="mtl-list">
              {issue.pullRequests.map((pr) => (
                <li key={pr.url}>
                  <span className="mtl-chip-pr" data-status={pr.status}>
                    <PullRequestIcon status={pr.status} />
                  </span>
                  <a href={pr.url} target="_blank" rel="noopener noreferrer">
                    #{pr.number} <span className="mtl-muted">({pr.status})</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mtl-section" aria-label="Description">
          <h3>Description</h3>
          {failed ? (
            <p className="mtl-muted">The description could not be loaded.</p>
          ) : detail ? (
            <Description text={detail.description} />
          ) : (
            <p className="mtl-muted">Loading…</p>
          )}
        </section>

        {detail && detail.subIssues.length > 0 && (
          <section className="mtl-section" aria-label="Sub-issues">
            <h3>
              Sub-issues
              {issue.progress && (
                <span className="mtl-count">
                  <ProgressIcon done={issue.progress.done} total={issue.progress.total} /> {issue.progress.done}/{issue.progress.total}
                </span>
              )}
            </h3>
            <ul className="mtl-list">
              {detail.subIssues.map((sub) => (
                <li key={sub.id}>
                  <StatusIcon type={sub.state.type} color={sub.state.color} />
                  <span className="mtl-id">{sub.identifier}</span> {sub.title}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <footer className="mtl-details-foot">
        <a className="mtl-button" href={issue.url} target="_blank" rel="noopener noreferrer">
          Open in Linear <ExternalIcon />
        </a>
      </footer>
    </aside>
  );
}
