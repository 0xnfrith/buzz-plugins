import { React } from "../react";
import type { KeyStore } from "../linear/keys";
import { acceptsMoves, sortColumn } from "../linear/model";
import type { BoardStore, Snapshot } from "../linear/store";
import type { Issue, Scope, WorkflowState } from "../linear/types";
import { Card as CardImpl } from "./Card";
import { Details } from "./Details";
import { ago, wait } from "./format";
import { BrandMark, CloseIcon, RefreshIcon, StatusIcon } from "./icons";

const REFRESH_EVERY = 60_000;
const DRAG_THRESHOLD = 5;
const EDGE = 64;

// React exists only once `apply` has run, so the memoised card is made on first render.
let MemoCard: typeof CardImpl | undefined;
const card = () => (MemoCard ??= React.memo(CardImpl) as typeof CardImpl);

type Drag = { id: string; x: number; y: number; dx: number; dy: number; width: number; over: string | null };

const encodeScope = (scope: Scope) => (scope.kind === "team" ? "team" : `${scope.kind}:${scope.id}`);
const decodeScope = (value: string): Scope => {
  const [kind, ...rest] = value.split(":");
  return kind === "project" || kind === "view" ? { kind, id: rest.join(":") } : { kind: "team" };
};

/** How far through its work a "started" column looks: the later the column, the fuller the circle. */
function fractions(states: readonly WorkflowState[]): Record<string, number> {
  const started = states.filter((s) => s.type === "started");
  return Object.fromEntries(started.map((s, i) => [s.id, (i + 1) / (started.length + 1)]));
}

export function createBoardPage({
  store,
  keys,
  openSettings,
}: {
  store: BoardStore;
  keys: KeyStore;
  openSettings(): void;
}) {
  return function BoardPage() {
    const snapshot = React.useSyncExternalStore(store.subscribe, store.snapshot);
    const keyVersion = React.useSyncExternalStore(keys.subscribe, keys.version);
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [drag, setDrag] = React.useState<Drag | null>(null);
    const [clock, setClock] = React.useState(() => Date.now());
    const boardRef = React.useRef<HTMLDivElement | null>(null);
    const columnRefs = React.useRef(new Map<string, HTMLElement>());
    const stopDrag = React.useRef<(() => void) | null>(null);
    const suppressClick = React.useRef(false);
    const snapshotRef = React.useRef(snapshot);
    snapshotRef.current = snapshot;

    // Start (or start over, when the key changed); coming back to a board we have, just look for changes.
    const startedFor = React.useRef<number | null>(null);
    React.useEffect(() => {
      const first = startedFor.current === null;
      const changed = !first && startedFor.current !== keyVersion;
      startedFor.current = keyVersion;
      if (store.snapshot().phase === "idle" || changed) void store.start();
      else void store.tick();
    }, [keyVersion]);

    // A quiet check once a minute while the page is open and visible, and when the window comes back.
    React.useEffect(() => {
      const tick = () => {
        setClock(Date.now());
        if (document.visibilityState === "visible") void store.tick();
      };
      const timer = window.setInterval(tick, REFRESH_EVERY);
      window.addEventListener("focus", tick);
      document.addEventListener("visibilitychange", tick);
      return () => {
        window.clearInterval(timer);
        window.removeEventListener("focus", tick);
        document.removeEventListener("visibilitychange", tick);
      };
    }, []);

    // The highlight on a card that was just moved fades after a moment.
    React.useEffect(() => {
      if (!snapshot.settled) return;
      const timer = window.setTimeout(() => store.clearSettled(), 1600);
      return () => window.clearTimeout(timer);
    }, [snapshot.settled]);

    React.useEffect(() => () => stopDrag.current?.(), []);

    const selected = selectedId ? snapshot.issues[selectedId] : undefined;
    React.useEffect(() => {
      if (selectedId && !selected && snapshot.phase === "ready" && !snapshot.refreshing) setSelectedId(null);
    }, [selectedId, selected, snapshot.phase, snapshot.refreshing]);

    const open = React.useCallback((issue: Issue) => {
      if (suppressClick.current) return;
      setSelectedId(issue.id);
    }, []);

    // Closing hands focus back to the card it was opened from, even if the card moved columns meanwhile.
    const close = React.useCallback(() => {
      const id = selectedId;
      setSelectedId(null);
      // [DOM] Only the plugin's own markup: the card it opened from, found by its data attribute.
      if (id) window.requestAnimationFrame(() => boardRef.current?.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(id)}"]`)?.focus());
    }, [selectedId]);

    /** The column under a point, but only inside the board: not over the toolbar, and not under the details panel. */
    const columnAt = (x: number, y: number): string | null => {
      const board = boardRef.current;
      if (!board) return null;
      const box = board.getBoundingClientRect();
      if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) return null;
      if (document.elementFromPoint(x, y)?.closest(".mtl-details")) return null;
      for (const [id, el] of columnRefs.current) {
        const rect = el.getBoundingClientRect();
        if (x >= rect.left && x < rect.right) return id;
      }
      return null;
    };

    const press = React.useCallback((event: React.PointerEvent<HTMLDivElement>, issue: Issue) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      if (snapshotRef.current.moving.includes(issue.id)) return;
      if ((event.target as Element).closest("a,button,select,input,textarea")) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const origin = { x: event.clientX, y: event.clientY };
      const pointer = { x: event.clientX, y: event.clientY };
      let active = false;
      // Escape ends the drag but not the press: the release that follows must not open the card either.
      let cancelled = false;
      let frame = 0;

      const place = () => {
        setDrag({
          id: issue.id,
          x: pointer.x,
          y: pointer.y,
          dx: origin.x - rect.left,
          dy: origin.y - rect.top,
          width: rect.width,
          over: columnAt(pointer.x, pointer.y),
        });
      };
      // Keep scrolling while the pointer rests near an edge of the board or of a column.
      const autoscroll = () => {
        frame = 0;
        if (!active) return;
        const board = boardRef.current;
        if (board) {
          const box = board.getBoundingClientRect();
          if (pointer.x < box.left + EDGE) board.scrollLeft -= Math.ceil((EDGE - (pointer.x - box.left)) / 4);
          else if (pointer.x > box.right - EDGE) board.scrollLeft += Math.ceil((EDGE - (box.right - pointer.x)) / 4);
        }
        const over = columnAt(pointer.x, pointer.y);
        const body = over ? columnRefs.current.get(over)?.querySelector<HTMLElement>(".mtl-cards") : null;
        if (body) {
          const box = body.getBoundingClientRect();
          if (pointer.y < box.top + EDGE) body.scrollTop -= Math.ceil((EDGE - (pointer.y - box.top)) / 4);
          else if (pointer.y > box.bottom - EDGE) body.scrollTop += Math.ceil((EDGE - (box.bottom - pointer.y)) / 4);
        }
        place();
        frame = window.requestAnimationFrame(autoscroll);
      };

      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", abandon);
        window.removeEventListener("keydown", key, true);
        if (frame) window.cancelAnimationFrame(frame);
        stopDrag.current = null;
        setDrag(null);
      };
      const move = (e: PointerEvent) => {
        // The release can happen where this page never hears of it (another window, a context menu).
        if (e.buttons === 0) return abandon();
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        if (cancelled) return;
        if (!active) {
          if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_THRESHOLD) return;
          active = true;
          frame = window.requestAnimationFrame(autoscroll);
        }
        // [DOM] Whatever the engine tried to select on the way is cleared, as a second line after user-select.
        window.getSelection()?.removeAllRanges();
        place();
      };
      const up = () => {
        const target = active && !cancelled ? columnAt(pointer.x, pointer.y) : null;
        if (active || cancelled) {
          // The click that ends a drag must not open the card.
          suppressClick.current = true;
          window.setTimeout(() => (suppressClick.current = false), 0);
        }
        active = false;
        finish();
        if (target && target !== issue.stateId) void store.move(issue.id, target);
      };
      const abandon = () => {
        active = false;
        finish();
      };
      const key = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !active) return;
        e.preventDefault();
        e.stopPropagation();
        active = false;
        cancelled = true;
        if (frame) window.cancelAnimationFrame(frame);
        setDrag(null);
      };
      stopDrag.current?.();
      // [DOM] A drag needs pointer events on the window (the pointer leaves the card at once); the host has no drag service.
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", abandon);
      window.addEventListener("keydown", key, true);
      stopDrag.current = abandon;
    }, []);

    const fraction = React.useMemo(() => fractions(snapshot.states), [snapshot.states]);
    const Card = card();
    const draggedIssue = drag ? snapshot.issues[drag.id] : undefined;
    const state = (id: string) => snapshot.states.find((s) => s.id === id);
    const choice = snapshot.choice;
    const settledIssue = snapshot.settled ? snapshot.issues[snapshot.settled] : undefined;
    const settledState = settledIssue ? state(settledIssue.stateId) : undefined;

    return (
      <div className="mtl-root" data-dragging={drag ? "" : undefined}>
        <header className="mtl-bar">
          <div className="mtl-brand" aria-label="MEGATECH Linear">
            <BrandMark size={22} />
            <span className="mtl-wordmark">MEGATECH</span>
            <span className="mtl-brand-sep" aria-hidden="true" />
            <h1 className="mtl-page-title">Linear</h1>
          </div>
          {snapshot.teams.length > 0 && choice && (
            <div className="mtl-pickers">
              <label>
                <span className="mtl-visually-hidden">Team</span>
                <select
                  aria-label="Team"
                  className="mtl-select"
                  value={choice.teamId}
                  onChange={(event) => void store.selectTeam(event.target.value)}
                >
                  {snapshot.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mtl-visually-hidden">Filter</span>
                <select
                  aria-label="Filter"
                  className="mtl-select"
                  value={encodeScope(choice.scope)}
                  onChange={(event) => void store.selectScope(decodeScope(event.target.value))}
                >
                  <option value="team">All issues</option>
                  {snapshot.projects.length > 0 && (
                    <optgroup label="Projects">
                      {snapshot.projects.map((project) => (
                        <option key={project.id} value={`project:${project.id}`}>
                          {project.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {snapshot.views.length > 0 && (
                    <optgroup label="Views">
                      {snapshot.views.map((view) => (
                        <option key={view.id} value={`view:${view.id}`}>
                          {view.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            </div>
          )}
          <div className="mtl-bar-end">
            {snapshot.refreshedAt && (
              <span className="mtl-muted mtl-updated">Updated {ago(snapshot.refreshedAt, clock)}</span>
            )}
            <button
              type="button"
              className="mtl-icon-button"
              aria-label="Refresh"
              title="Refresh"
              data-busy={snapshot.refreshing || undefined}
              disabled={snapshot.phase === "blocked" && snapshot.problem?.kind === "no-key"}
              onClick={() => void store.refresh()}
            >
              <RefreshIcon />
            </button>
          </div>
        </header>

        <div className="mtl-visually-hidden" role="status" aria-live="polite">
          {settledIssue && settledState ? `${settledIssue.identifier} moved to ${settledState.name}` : ""}
        </div>

        {snapshot.notice && (
          <div className="mtl-banner" role="alert" data-tone="error">
            <span>{snapshot.notice}</span>
            <button type="button" className="mtl-icon-button" aria-label="Dismiss" onClick={() => store.dismissNotice()}>
              <CloseIcon />
            </button>
          </div>
        )}
        {snapshot.phase === "ready" && snapshot.problem && <ProblemBanner snapshot={snapshot} clock={clock} onRetry={() => void store.refresh()} />}

        {snapshot.phase === "blocked" ? (
          <Blocked snapshot={snapshot} openSettings={openSettings} onRetry={() => void store.start()} />
        ) : snapshot.phase !== "ready" || snapshot.states.length === 0 ? (
          <div className="mtl-empty" role="status">
            Loading your Linear board…
          </div>
        ) : (
          <div className="mtl-main">
            <div className="mtl-board" ref={boardRef} role="list" aria-label="Board">
              {snapshot.states.map((s) => {
                const column = snapshot.columns[s.id];
                const issues = sortColumn(
                  (column?.ids ?? []).map((id) => snapshot.issues[id]).filter((x): x is Issue => !!x),
                  s.type,
                );
                const count = `${issues.length}${column?.hasMore ? "+" : ""}`;
                return (
                  <section
                    key={s.id}
                    role="listitem"
                    className="mtl-column"
                    aria-label={`${s.name}, ${count} issues`}
                    data-column={s.id}
                    data-state-type={s.type}
                    data-over={drag?.over === s.id && acceptsMoves(s.type) ? "" : undefined}
                    data-refuses={drag && !acceptsMoves(s.type) ? "" : undefined}
                    ref={(el) => {
                      if (el) columnRefs.current.set(s.id, el);
                      else columnRefs.current.delete(s.id);
                    }}
                  >
                    <header className="mtl-column-head">
                      <StatusIcon type={s.type} color={s.color} fraction={fraction[s.id] ?? 0.5} />
                      <h2 className="mtl-column-name">{s.name}</h2>
                      <span className="mtl-count" data-count>
                        {count}
                      </span>
                    </header>
                    <div className="mtl-cards" role="group" aria-label={`${s.name} issues`}>
                      {issues.map((issue) => (
                        <Card
                          key={issue.id}
                          issue={issue}
                          state={s}
                          fraction={fraction[s.id] ?? 0.5}
                          selected={issue.id === selectedId}
                          dragging={drag?.id === issue.id}
                          moving={snapshot.moving.includes(issue.id)}
                          settled={snapshot.settled === issue.id}
                          onOpen={open}
                          onPointerDown={press}
                        />
                      ))}
                      {issues.length === 0 && <p className="mtl-column-empty">No issues</p>}
                      {column?.hasMore && (
                        <button
                          type="button"
                          className="mtl-more"
                          disabled={column.loadingMore}
                          onClick={() => void store.loadMore(s.id)}
                        >
                          {column.loadingMore ? "Loading…" : "Show more"}
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
            {selected && <Details issue={selected} snapshot={snapshot} store={store} onClose={close} />}
          </div>
        )}

        {drag && draggedIssue && state(draggedIssue.stateId) && (
          <div className="mtl-lift" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width }} aria-hidden="true">
            <Card
              issue={draggedIssue}
              state={state(draggedIssue.stateId)!}
              fraction={fraction[draggedIssue.stateId] ?? 0.5}
              selected={false}
              dragging={false}
              moving={false}
              settled={false}
              onOpen={() => {}}
              onPointerDown={() => {}}
            />
          </div>
        )}
      </div>
    );
  };
}

function ProblemBanner({ snapshot, clock, onRetry }: { snapshot: Snapshot; clock: number; onRetry(): void }) {
  const problem = snapshot.problem!;
  const limited = problem.kind === "rate-limited" && problem.retryAt;
  return (
    <div className="mtl-banner" role="status" data-tone="warning">
      <span>
        {limited
          ? `Linear is rate limiting this key. The board will check again in ${wait(problem.retryAt!, clock)}.`
          : `${problem.message} Showing the last board.`}
      </span>
      {!limited && (
        <button type="button" className="mtl-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

function Blocked({ snapshot, openSettings, onRetry }: { snapshot: Snapshot; openSettings(): void; onRetry(): void }) {
  const kind = snapshot.problem?.kind;
  if (kind === "no-key" || kind === "auth")
    return (
      <div className="mtl-empty">
        <div className="mtl-panel" role="status">
          <h2>{kind === "no-key" ? "Connect Linear" : "Linear did not accept your key"}</h2>
          <p>
            {kind === "no-key"
              ? "Paste a personal API key in the Linear card in Settings. The key stays on this computer and is sent only to Linear."
              : `${snapshot.problem!.message} Check it in the Linear card in Settings, or make a new one.`}
          </p>
          <p className="mtl-muted">
            In Linear: Settings, Account, Security &amp; access, Personal API keys. Give it Write access (Read comes with it), so cards can change state.
          </p>
          <button type="button" className="mtl-button" data-primary onClick={openSettings}>
            Open Linear settings
          </button>
        </div>
      </div>
    );
  return (
    <div className="mtl-empty">
      <div className="mtl-panel" role="alert">
        <h2>The board could not load</h2>
        <p>{snapshot.problem?.message ?? "Something went wrong."}</p>
        <button type="button" className="mtl-button" data-primary onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}
