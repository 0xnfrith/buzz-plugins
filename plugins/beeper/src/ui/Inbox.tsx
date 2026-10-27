import { React } from "../react";
import { fitsInRequest } from "../beeper/curl";
import type { Inbox, InboxState, PendingSend, Thread } from "../beeper/store";
import type { Chat, Message } from "../beeper/types";
import { clock, dayLabel, listTime, mediaLabel, sameDay } from "./format";
import { CloseIcon, MuteIcon, NetworkBadge, PinIcon, RefreshIcon } from "./icons";
import { Problem } from "./States";
import { contentHeight, rowTop, scrollToReveal, visibleRange } from "./window";

type Deps = { inbox: Inbox; openSettings(): void; reloadToken(): Promise<void> };

/** The time, refreshed each minute, for "Yesterday" and the like to change on their own. */
function useNow(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const rowId = (chatID: string) => `mtb-row-${chatID}`;

export function createInboxPage({ inbox, openSettings, reloadToken }: Deps) {
  type RowProps = { chat: Chat; cursor: boolean; open: boolean; unsent: boolean; now: number; top: number; position: number; total: number };

  const Row = React.memo(function Row({ chat, cursor, open, unsent, now, top, position, total }: RowProps) {
    const unread = chat.unreadCount > 0 ? chat.unreadCount : 0;
    return (
      <div
        id={rowId(chat.id)}
        role="option"
        aria-selected={open}
        aria-posinset={position}
        aria-setsize={total}
        className="mtb-row"
        style={{ top }}
        data-chat-id={chat.id}
        data-cursor={cursor ? "" : undefined}
        data-open={open ? "" : undefined}
        data-unread={unread || chat.isMarkedUnread ? "" : undefined}
        onClick={() => void inbox.open(chat.id)}
      >
        <NetworkBadge network={chat.network} />
        <span className="mtb-row-text">
          <span className="mtb-row-name">{chat.title}</span>
          <span className="mtb-row-meta">
            {chat.isPinned && <PinIcon />}
            {chat.isMuted && <MuteIcon />}
            <span>{chat.network}</span>
            {unsent && <span className="mtb-unsent">Not sent</span>}
          </span>
        </span>
        <span className="mtb-row-end">
          <span>{listTime(chat.lastActivity, now)}</span>
          {unread > 0 ? (
            <span className="mtb-unread" data-muted={chat.isMuted ? "" : undefined} aria-label={`${unread} unread`}>
              {unread > 99 ? "99+" : unread}
            </span>
          ) : chat.isMarkedUnread ? (
            <span className="mtb-unread" data-muted={chat.isMuted ? "" : undefined} aria-label="Marked unread">
              •
            </span>
          ) : null}
        </span>
      </div>
    );
  });

  // Memoized: a poll brings the same messages again, and typing in the box must not redraw them.
  const Bubble = React.memo(function Bubble({ message, showFrom }: { message: Message; showFrom: boolean }) {
    const media = mediaLabel(message);
    const notice = message.type === "NOTICE";
    return (
      <div className="mtb-msg" data-mine={message.isSender ? "" : undefined} data-notice={notice ? "" : undefined} data-message-id={message.id}>
        {showFrom && !message.isSender && <div className="mtb-msg-from">{message.senderName ?? "Someone"}</div>}
        {media && <div className="mtb-msg-media">{media}</div>}
        {message.text ? <div className="mtb-msg-text">{message.text}</div> : null}
        {!media && !message.text && <div className="mtb-msg-media">Message</div>}
        <div className="mtb-msg-meta">{clock(message.timestamp)}</div>
      </div>
    );
  });

  function PendingBubble({ send }: { send: PendingSend }) {
    return (
      <div className="mtb-msg" data-mine="" data-pending={send.status !== "failed" ? "" : undefined} data-failed={send.status === "failed" ? "" : undefined} data-send-status={send.status}>
        <div className="mtb-msg-text">{send.text}</div>
        <div className="mtb-msg-meta">{send.status === "sending" ? "Sending…" : send.status === "sent" ? "Sent, waiting for Beeper to list it" : "Not sent"}</div>
        {send.status === "failed" && (
          <>
            <div className="mtb-msg-error" role="alert">
              {send.error}
            </div>
            <div className="mtb-actions">
              <button type="button" className="mtb-button" onClick={() => void inbox.retrySend(send.key)}>
                Try again
              </button>
              <button type="button" className="mtb-button" onClick={() => inbox.dismissSend(send.key)}>
                Dismiss
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  type ComposerProps = {
    chat: Chat;
    draft: string;
    onDraft(chatID: string, text: string): void;
    onSent(): void;
    composerRef: { current: HTMLTextAreaElement | null };
    focusList(): void;
    /** Set by the Enter key: the box takes the focus when it appears. */
    focusNext: { current: boolean };
  };

  // Its own component, so a key typed in the box draws the box and nothing else.
  const Composer = React.memo(function Composer({ chat, draft, onDraft, onSent, composerRef, focusList, focusNext }: ComposerProps) {
    const [text, setText] = React.useState(draft);

    React.useEffect(() => {
      if (focusNext.current) composerRef.current?.focus();
      focusNext.current = false;
    }, [focusNext, composerRef]);

    // [DOM] Grow the box with what is typed. `field-sizing: content` does it in the browsers that have it (see the stylesheet). Elsewhere the
    // box is measured once typing pauses: measuring needs the page laid out, and doing that on every key is what a key to paint cannot afford.
    React.useEffect(() => {
      const box = composerRef.current;
      if (!box || (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content"))) return;
      if (!text) {
        box.style.height = "";
        return;
      }
      const timer = setTimeout(() => {
        box.style.height = "auto";
        box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
      }, 80);
      return () => clearTimeout(timer);
    }, [text, composerRef]);

    // Up to 2,000 characters always fit in one request; only a longer message is measured.
    const fits = text.length < 2000 || fitsInRequest(text);
    const submit = () => {
      if (!text.trim() || !fits) return;
      void inbox.send(text);
      setText("");
      onDraft(chat.id, "");
      onSent();
    };

    if (chat.isReadOnly) return <div className="mtb-composer-note">You cannot send messages in this chat.</div>;
    return (
      <>
        <div className="mtb-composer" data-mtb="composer">
          <textarea
            ref={composerRef}
            rows={1}
            aria-label={`Reply to ${chat.title}`}
            placeholder="Reply…"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              onDraft(chat.id, event.target.value);
            }}
            onKeyDown={(event) => {
              // An input method confirming a candidate sends Enter too: isComposing says so, and on WebKit, which reports it already
              // false for that key, so does the key code 229.
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.currentTarget.blur();
                focusList();
              }
            }}
          />
          <button type="button" className="mtb-button" data-primary="" disabled={!text.trim() || !fits} onClick={submit}>
            Send
          </button>
        </div>
        <div className="mtb-composer-note" data-tone={fits ? undefined : "error"}>
          {fits ? "Enter sends, Shift+Enter adds a line. Opening a chat marks it read in Beeper." : "That message is too long to send from here."}
        </div>
      </>
    );
  });

  type PaneProps = {
    chat: Chat;
    thread: Thread | undefined;
    pending: PendingSend[];
    now: number;
    draft: string;
    onDraft(chatID: string, text: string): void;
    composerRef: { current: HTMLTextAreaElement | null };
    focusList(): void;
    focusNext: { current: boolean };
  };

  const Pane = React.memo(function Pane({ chat, thread, pending, now, draft, onDraft, composerRef, focusList, focusNext }: PaneProps) {
    const threadRef = React.useRef<HTMLDivElement | null>(null);
    const stick = React.useRef(true);
    const items = thread?.items ?? [];
    const first = items[0]?.id;
    const last = items[items.length - 1]?.id;
    // A bubble grows when its state changes (a refused send adds a reason and two buttons).
    const pendingState = pending.map((send) => send.status).join();
    const before = React.useRef<{ first?: string; height: number }>({ height: 0 });
    const onSent = React.useCallback(() => void (stick.current = true), []);

    // [DOM] Keep the newest message in view while the reader is at the bottom, and keep the reader's place when older messages are added above.
    React.useLayoutEffect(() => {
      const box = threadRef.current;
      // Nothing to place yet (the chat is still loading): reading the layout now would only make the page lay itself out for nothing.
      if (!box || (!first && !pending.length)) return;
      const prev = before.current;
      if (prev.first !== undefined && first !== prev.first && prev.height) box.scrollTop += box.scrollHeight - prev.height;
      else if (stick.current) box.scrollTop = box.scrollHeight;
      before.current = { first, height: box.scrollHeight };
    }, [first, last, pending.length, pendingState, thread?.loading]);

    let previousDay: string | undefined;
    let previousSender: string | undefined;
    const rows: React.ReactNode[] = [];
    for (const message of items) {
      const heading = !previousDay || !sameDay(previousDay, message.timestamp) ? dayLabel(message.timestamp, now) : "";
      if (heading) {
        rows.push(
          <div key={`day-${message.id}`} className="mtb-day">
            {heading}
          </div>,
        );
        previousSender = undefined;
      }
      // A message whose time cannot be read leaves the last day it knew.
      if (!Number.isNaN(Date.parse(message.timestamp))) previousDay = message.timestamp;
      rows.push(<Bubble key={message.id} message={message} showFrom={chat.type === "group" && previousSender !== message.senderID} />);
      previousSender = message.senderID;
    }

    return (
      <section className="mtb-chat" aria-label={chat.title}>
        <header className="mtb-chat-head">
          <NetworkBadge network={chat.network} size={32} />
          <div style={{ minWidth: 0 }}>
            <h2 className="mtb-chat-name">{chat.title}</h2>
            <div className="mtb-chat-sub">
              {chat.network}
              {chat.type === "group" && chat.participants ? ` · ${chat.participants.total} people` : ""}
            </div>
          </div>
          <div className="mtb-bar-end">
            <button type="button" className="mtb-icon-button" aria-label="Close chat" title="Close chat (Esc)" onClick={() => inbox.close()}>
              <CloseIcon />
            </button>
          </div>
        </header>
        <div
          className="mtb-thread"
          ref={threadRef}
          role="log"
          aria-label="Messages"
          aria-live="polite"
          onScroll={(event) => {
            const box = event.currentTarget;
            stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
          }}
        >
          {thread?.loading && <div className="mtb-muted" role="status">Loading messages…</div>}
          {thread?.hasMore && (
            <button type="button" className="mtb-more" disabled={thread.loadingEarlier} onClick={() => void inbox.loadEarlier()}>
              {thread.loadingEarlier ? "Loading…" : "Load earlier messages"}
            </button>
          )}
          {thread?.failed && (
            <div className="mtb-msg-error" role="alert">
              Could not read this chat just now. Trying again.
            </div>
          )}
          {thread && !thread.loading && !items.length && !pending.length && !thread.failed && <div className="mtb-muted">No messages yet.</div>}
          {rows}
          {pending.map((send) => (
            <PendingBubble key={send.key} send={send} />
          ))}
        </div>
        <Composer chat={chat} draft={draft} onDraft={onDraft} onSent={onSent} composerRef={composerRef} focusList={focusList} focusNext={focusNext} />
      </section>
    );
  });

  type ListProps = { list: Chat[]; cursorId: string | undefined; openId: string | undefined; unsent: ReadonlySet<string>; more: boolean; now: number; listRef: { current: HTMLDivElement | null }; empty: string };

  /** The list of chats. It draws only the rows in view; rows are one height, so where a row is, is arithmetic. */
  const ChatList = React.memo(function ChatList({ list, cursorId, openId, unsent, more, now, listRef, empty }: ListProps) {
    const [view, setView] = React.useState({ top: 0, height: 600 });
    const frame = React.useRef(0);
    const latest = React.useRef(list);
    latest.current = list;

    const measure = React.useCallback(() => {
      const box = listRef.current;
      if (box) setView((was) => (was.top === box.scrollTop && was.height === box.clientHeight ? was : { top: box.scrollTop, height: box.clientHeight }));
    }, [listRef]);

    React.useEffect(() => {
      measure();
      const box = listRef.current;
      const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
      if (box) observer?.observe(box);
      return () => {
        observer?.disconnect();
        if (frame.current) cancelAnimationFrame(frame.current);
        frame.current = 0;
      };
    }, [measure, listRef]);

    // [DOM] Bring the highlighted row into view when the highlight moves (not when the list reorders under a reader who has scrolled away).
    React.useLayoutEffect(() => {
      const box = listRef.current;
      const at = cursorId ? latest.current.findIndex((chat) => chat.id === cursorId) : -1;
      if (!box || at < 0) return;
      const next = scrollToReveal(at, box.scrollTop, box.clientHeight);
      if (next !== box.scrollTop) {
        box.scrollTop = next;
        measure();
      }
    }, [cursorId, listRef, measure]);

    const [start, end] = visibleRange(view.top, view.height, list.length);
    return (
      <div
        ref={listRef}
        className="mtb-list"
        role="listbox"
        tabIndex={0}
        aria-label="Chats"
        aria-activedescendant={cursorId ? rowId(cursorId) : undefined}
        onScroll={() => {
          if (frame.current) return;
          frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            measure();
          });
        }}
      >
        <div className="mtb-list-inner" style={{ height: contentHeight(list.length) }}>
          {list.slice(start, end).map((chat, offset) => (
            <Row key={chat.id} chat={chat} cursor={chat.id === cursorId} open={chat.id === openId} unsent={unsent.has(chat.id)} now={now} top={rowTop(start + offset)} position={start + offset + 1} total={list.length} />
          ))}
        </div>
        {!list.length && <div className="mtb-list-empty">{empty}</div>}
        {more && <div className="mtb-list-foot">Older chats are not listed.</div>}
      </div>
    );
  });

  const unreadTotal = (chats: Chat[]) => chats.reduce((sum, chat) => sum + (chat.isMuted ? 0 : chat.unreadCount), 0);

  return function BeeperPage() {
    const state: InboxState = React.useSyncExternalStore(inbox.subscribe, inbox.getState);
    const now = useNow();
    const listRef = React.useRef<HTMLDivElement | null>(null);
    const filterRef = React.useRef<HTMLInputElement | null>(null);
    const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const drafts = React.useRef(new Map<string, string>());
    const onDraft = React.useCallback((chatID: string, text: string) => void (text ? drafts.current.set(chatID, text) : drafts.current.delete(chatID)), []);
    const focusList = React.useCallback(() => listRef.current?.focus(), []);

    // Poll while this page is on screen, and only while the window is.
    React.useEffect(() => {
      const visible = () => inbox.setActive(document.visibilityState === "visible");
      visible();
      const stop = inbox.start();
      document.addEventListener("visibilitychange", visible);
      return () => {
        document.removeEventListener("visibilitychange", visible);
        stop();
      };
    }, []);

    const stateRef = React.useRef(state);
    stateRef.current = state;
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const focusComposerNext = React.useRef(false);

    // [DOM] When the list first appears, take the focus unless a person is typing somewhere or a dialog is up, so the keys work
    // without a click (opening the page leaves the focus on the sidebar entry that was used).
    // Only the first time: when Beeper comes back after a gap the focus is wherever the person has put it.
    const focusedOnce = React.useRef(false);
    const ready = state.connection === "ready";
    React.useEffect(() => {
      if (!ready || focusedOnce.current) return;
      focusedOnce.current = true;
      const at = document.activeElement;
      const typing = at instanceof HTMLElement && (at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName));
      if (!typing && !rootRef.current?.contains(at) && !document.querySelector('[role="dialog"]')) listRef.current?.focus({ preventScroll: true });
    }, [ready]);

    // Keys. The shortcut service has no handler for a page's own keys, so this listens on the window while the page is shown.
    React.useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
        if (event.defaultPrevented || event.isComposing) return;
        // Not while something modal is up (the page can stay mounted under a dialog), and not on AltGr, which is how some layouts type a letter.
        if (document.querySelector('[role="dialog"], [aria-modal="true"]') || event.getModifierState?.("AltGraph")) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        const current = stateRef.current;
        if (target?.closest("[data-mtb=composer]")) return; // the box handles its own keys
        if (target?.closest("[data-mtb=filter]")) {
          if (event.key === "Escape" || event.key === "Enter" || event.key === "ArrowDown") {
            event.preventDefault();
            if (event.key === "Escape" && current.filter) inbox.setFilter("");
            listRef.current?.focus();
          }
          return;
        }
        if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (current.connection !== "ready") return;
        const used = () => event.preventDefault();
        switch (event.key) {
          case "j":
          case "ArrowDown":
            used();
            inbox.moveCursor(1);
            break;
          case "k":
          case "ArrowUp":
            used();
            inbox.moveCursor(-1);
            break;
          case "Enter":
            // On a button or a link, Enter is that control's own.
            if (target?.closest("button, a")) break;
            if (current.cursorId) {
              used();
              if (current.openId === current.cursorId) {
                composerRef.current?.focus();
              } else {
                // The box is made when the chat opens, and takes the focus then. The flag is dropped if it was not made.
                focusComposerNext.current = true;
                void inbox.open(current.cursorId).finally(() => void (focusComposerNext.current = false));
              }
            }
            break;
          case "r":
            if (current.openId) {
              used();
              composerRef.current?.focus();
            }
            break;
          case "Escape":
            if (current.openId) {
              used();
              inbox.close();
              listRef.current?.focus();
            }
            break;
          case "/":
            used();
            filterRef.current?.focus();
            break;
          case "u":
            used();
            inbox.setUnreadOnly(!current.unreadOnly);
            break;
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, []);

    const openChat = state.openId ? state.chats.find((chat) => chat.id === state.openId) : undefined;
    // A send belongs to the chat it was for: it stays there when another chat is opened, and the list says which chats have one that failed.
    const openPending = React.useMemo(() => state.pending.filter((send) => send.chatID === state.openId), [state.pending, state.openId]);
    const unsent = React.useMemo(() => new Set(state.pending.filter((send) => send.status === "failed").map((send) => send.chatID)), [state.pending]);
    const total = unreadTotal(state.chats);

    return (
      <div className="mtb-root" data-mtb="root" ref={rootRef}>
        <header className="mtb-bar">
          <h1 className="mtb-title">Beeper</h1>
          {state.connection === "ready" && total > 0 && <span className="mtb-muted">{total} unread</span>}
          <div className="mtb-bar-end">
            <button type="button" className="mtb-icon-button" aria-label="Refresh" title="Refresh" disabled={state.connection !== "ready"} onClick={() => void inbox.refresh()}>
              <RefreshIcon />
            </button>
            <button type="button" className="mtb-button" onClick={openSettings}>
              Settings
            </button>
          </div>
        </header>
        {state.stale && (
          <div className="mtb-banner" role="status">
            Beeper is not answering. Showing what was read a moment ago.
          </div>
        )}
        {state.connection !== "ready" ? (
          <Problem connection={state.connection} problem={state.problem} onRetry={() => void reloadToken().then(() => inbox.retry())} onSettings={openSettings} />
        ) : (
          <div className="mtb-main">
            <div className="mtb-side">
              <div className="mtb-tools">
                <input
                  ref={filterRef}
                  className="mtb-input"
                  data-mtb="filter"
                  type="search"
                  aria-label="Filter chats"
                  placeholder="Filter chats  ( / )"
                  value={state.filter}
                  onChange={(event) => inbox.setFilter(event.target.value)}
                />
                <button type="button" className="mtb-toggle" aria-pressed={state.unreadOnly} title="Show only unread chats (u)" onClick={() => inbox.setUnreadOnly(!state.unreadOnly)}>
                  Unread
                </button>
              </div>
              <ChatList
                list={state.list}
                cursorId={state.cursorId}
                openId={state.openId}
                unsent={unsent}
                more={state.moreChats}
                now={now}
                listRef={listRef}
                empty={state.chats.length ? "No chats match." : "No chats yet. Chats from your Beeper accounts show here."}
              />
            </div>
            {openChat ? (
              <Pane
                key={openChat.id}
                chat={openChat}
                thread={state.thread}
                pending={openPending}
                now={now}
                draft={drafts.current.get(openChat.id) ?? ""}
                onDraft={onDraft}
                composerRef={composerRef}
                focusList={focusList}
                focusNext={focusComposerNext}
              />
            ) : (
              <div className="mtb-empty">
                <div>
                  <p>Pick a chat to read it and reply.</p>
                  <p className="mtb-muted">j and k move, Enter opens, Esc closes, / filters, u shows unread.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };
}
