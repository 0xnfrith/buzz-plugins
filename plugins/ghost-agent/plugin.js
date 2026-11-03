// GHOST agent (prototype, MT-921).
//
// Puts a GHOST Protocol instance that already runs elsewhere (its own server, its own key) on the Agents page, and gives it
// a Banner tab with the instance's management data. It does this through the host's *hosted agent type* contract
// (`AgentType.remote` in block/buzz-app src/features/agents/service.ts): the plugin is the "provider", the app owns the
// owner's agent list. Unlike Builderlab, this provider makes nothing: `provision` hands back the pubkey of the instance the
// owner typed in, and `remove` and `profile` leave the instance alone. The app then writes the owner's kind 30177 record
// for it, which is what lists it on the owner's other devices too.
//
// The Banner tab reads the instance's own relay note, kind 30023 with d = "ghost-banner" (JSON, schema ghost-banner/v0),
// signed by the instance's key, so nothing here is hardcoded and the plugin holds no key, token or network route.
export const inject = ["react", "agents", "relay", "navigation"];

const TYPE_ID = "ghost";
const NOTE_D = "ghost-banner";
const POLL_MS = 30_000;
const HEX64 = /^[0-9a-f]{64}$/;

const KIND_ORDER = { overdue: 0, blocked: 1, reminder: 2, "idea-reminder": 3 };
const KIND_LABEL = { overdue: "Overdue", blocked: "Blocked", reminder: "Reminder woke", "idea-reminder": "Idea reminder" };

/** A thread link in an item: a `buzz://message?channel=…&id=…[&thread=…]` string, or `{ channel, id?, root? }`. */
export function threadOf(value) {
  if (!value) return undefined;
  if (typeof value === "string") {
    let url;
    try {
      url = new URL(value);
    } catch {
      return undefined;
    }
    if (url.protocol !== "buzz:") return undefined;
    const channel = url.searchParams.get("channel");
    const id = url.searchParams.get("id") ?? undefined;
    const root = url.searchParams.get("thread") ?? undefined;
    return channel ? { channel, id, root } : undefined;
  }
  if (typeof value === "object" && typeof value.channel === "string" && value.channel)
    return {
      channel: value.channel,
      id: typeof value.id === "string" ? value.id : undefined,
      root: typeof value.root === "string" ? value.root : undefined,
    };
  return undefined;
}

/** The rows the tab lists, from the note's JSON. Throws on a note that is not ghost-banner/v0. */
export function rowsOf(content) {
  const data = JSON.parse(content);
  if (!data || data.schema !== "ghost-banner/v0") throw new Error("The note is not a ghost-banner/v0 banner.");
  const rows = [];
  if (data.inbox)
    rows.push({
      key: "inbox",
      label: "Inbox",
      text: `${data.inbox.unclarified ?? "?"} unclarified lines`,
      date: data.inbox.oldest ? `oldest ${data.inbox.oldest}` : "",
      thread: threadOf(data.inbox.thread),
    });
  if (data.wip)
    rows.push({
      key: "wip",
      label: "Work in progress",
      text: `${data.wip.active ?? "?"} active items`,
      date: data.wip.soft_limit !== undefined ? `soft limit ${data.wip.soft_limit}` : "",
      warn: data.wip.soft_limit !== undefined && data.wip.active > data.wip.soft_limit,
      thread: threadOf(data.wip.thread),
    });
  const items = Array.isArray(data.items) ? [...data.items] : [];
  items.sort(
    (a, b) =>
      (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || String(a.date ?? "").localeCompare(String(b.date ?? "")),
  );
  items.forEach((item, index) =>
    rows.push({
      key: `${item.kind}:${item.id}:${index}`,
      label: KIND_LABEL[item.kind] ?? String(item.kind ?? "Item"),
      text: [item.id, item.title].filter(Boolean).join(" "),
      date: item.date ?? "",
      warn: item.kind === "overdue" || item.kind === "blocked",
      thread: threadOf(item.thread),
    }),
  );
  return { rows, generated: data.generated, instance: data.instance };
}

const STYLE = `
.ghost-banner { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.ghost-banner__meta { margin: 0; font-size: 12px; color: var(--text-secondary, #888); }
.ghost-banner__list { list-style: none; margin: 0; padding: 4px; max-height: 60vh; overflow-y: auto; outline: none;
  border: 1px solid var(--border-subtle, rgba(127,127,127,.25)); border-radius: 8px; }
.ghost-banner__list:focus-visible { border-color: var(--border-focus, var(--accent-9, #46f)); }
.ghost-banner__row { display: grid; grid-template-columns: 9.5em 1fr auto; gap: 8px; align-items: baseline;
  padding: 4px 8px; border-radius: 6px; font-size: 13px; color: var(--text-standard, inherit); cursor: default; }
.ghost-banner__row[aria-selected="true"] { background: var(--affordance-backdrop-pressed, rgba(127,127,127,.18));
  box-shadow: inset 2px 0 0 var(--accent-9, #46f); }
.ghost-banner__row--link { cursor: pointer; }
.ghost-banner__label { color: var(--text-secondary, #888); }
.ghost-banner__row--warn .ghost-banner__label { color: var(--text-danger, #d33); }
.ghost-banner__date { font-variant-numeric: tabular-nums; color: var(--text-secondary, #888); }
.ghost-banner__thread { margin-left: 6px; font-size: 11px; color: var(--accent-11, var(--accent-9, #46f)); }
`;

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;

  ctx.effect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-ghost-agent", "");
    style.textContent = STYLE;
    document.head.append(style);
    return () => style.remove();
  });

  function useRelaySnapshot() {
    return React.useSyncExternalStore(ctx.relay.subscribe, ctx.relay.snapshot, ctx.relay.snapshot);
  }

  /** The instance's latest ghost-banner note, refreshed on open, every 30 s, and on `r`. */
  function useBanner(pubkey) {
    const relay = useRelaySnapshot();
    const session = relay.status === "ready" || relay.cached ? relay.session : undefined;
    const [view, setView] = React.useState(null);
    const [failed, setFailed] = React.useState("");
    React.useEffect(() => {
      setView(null);
      setFailed("");
      if (!session || !HEX64.test(pubkey ?? "")) return;
      let owned;
      try {
        owned = session.observe([{ kinds: [30023], authors: [pubkey], "#d": [NOTE_D], limit: 1 }]);
      } catch (error) {
        setFailed(String(error?.message ?? error));
        return;
      }
      setView(owned);
      void owned.refresh?.();
      const timer = setInterval(() => void owned.refresh?.(), POLL_MS);
      return () => {
        clearInterval(timer);
        owned.dispose();
      };
    }, [session, pubkey]);
    const empty = React.useMemo(() => ({ events: [] }), []);
    const snap = React.useSyncExternalStore(
      view?.subscribe ?? (() => () => {}),
      view?.snapshot ?? (() => empty),
      view?.snapshot ?? (() => empty),
    );
    const latest = [...(snap.events ?? [])]
      .filter((event) => event.pubkey === pubkey && event.kind === 30023)
      .sort((a, b) => b.created_at - a.created_at)[0];
    return { relay, latest, failed, status: snap.status, refresh: () => void view?.refresh?.() };
  }

  function openThread(relay, thread) {
    if (!thread || !relay.viewer || !relay.origin) return;
    void ctx.navigation.open({
      version: 1,
      kind: "conversation",
      scope: { viewer: relay.viewer, communityOrigin: relay.origin },
      channelId: thread.channel,
      ...(thread.id ? { messageId: thread.id } : {}),
      ...(thread.root ? { threadRootId: thread.root } : {}),
    });
  }

  function Banner({ agent }) {
    const pubkey = agent.pubkey;
    const { relay, latest, failed, refresh } = useBanner(pubkey);
    const [cursor, setCursor] = React.useState(0);
    const listRef = React.useRef(null);
    let parsed;
    let parseError = "";
    if (latest)
      try {
        parsed = rowsOf(latest.content);
      } catch (error) {
        parseError = String(error?.message ?? error);
      }
    const rows = parsed?.rows ?? [];
    const at = Math.min(cursor, Math.max(rows.length - 1, 0));
    React.useEffect(() => {
      listRef.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: "nearest" });
    }, [at, rows.length]);

    // The list is role="listbox", which the vim plugin treats as a popup and leaves its keys to.
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const last = rows.length - 1;
      const page = 10;
      const move = {
        j: at + 1, ArrowDown: at + 1, k: at - 1, ArrowUp: at - 1,
        g: 0, Home: 0, G: last, End: last, d: at + page, PageDown: at + page, u: at - page, PageUp: at - page,
      }[event.key];
      if (move !== undefined) {
        setCursor(Math.max(0, Math.min(last, move)));
      } else if (event.key === "Enter" || event.key === "o") {
        openThread(relay, rows[at]?.thread);
      } else if (event.key === "r") {
        refresh();
      } else return;
      event.preventDefault();
      event.stopPropagation();
    };

    if (!HEX64.test(pubkey ?? "")) return h("p", { className: "ghost-banner__meta" }, "This agent has no valid pubkey.");
    const meta = failed
      ? `Could not read the banner: ${failed}`
      : parseError
        ? `The banner note did not parse: ${parseError}`
        : !latest
          ? "Waiting for the instance's ghost-banner note on this community…"
          : `From ${parsed?.instance ?? "the instance"}'s note, generated ${parsed?.generated ?? "?"}, signed ${new Date(
              latest.created_at * 1000,
            ).toISOString().replace(/\.\d+Z$/, "Z")}. j/k move, g/G ends, Enter opens the thread, r reloads.`;
    return h(
      "div",
      { className: "ghost-banner" },
      h("p", { className: "ghost-banner__meta", "data-ghost-banner-meta": "" }, meta),
      rows.length > 0 &&
        h(
          "ul",
          {
            ref: listRef,
            className: "ghost-banner__list",
            role: "listbox",
            "aria-label": "GHOST banner",
            "aria-activedescendant": `ghost-banner-row-${at}`,
            tabIndex: 0,
            onKeyDown,
          },
          rows.map((row, index) =>
            h(
              "li",
              {
                key: row.key,
                id: `ghost-banner-row-${index}`,
                "data-index": index,
                role: "option",
                "aria-selected": index === at,
                className: [
                  "ghost-banner__row",
                  row.warn ? "ghost-banner__row--warn" : "",
                  row.thread ? "ghost-banner__row--link" : "",
                ].join(" "),
                onClick: () => setCursor(index),
                onDoubleClick: () => openThread(relay, row.thread),
              },
              h("span", { className: "ghost-banner__label" }, row.label),
              h(
                "span",
                null,
                row.text,
                row.thread && h("span", { className: "ghost-banner__thread" }, "↗ thread"),
              ),
              h("span", { className: "ghost-banner__date" }, row.date),
            ),
          ),
        ),
    );
  }

  function Create({ config, onChange, disabled }) {
    const value = config?.pubkey ?? "";
    const valid = HEX64.test(value);
    return h(
      "label",
      { style: { display: "flex", flexDirection: "column", gap: 4 } },
      h("span", { style: { fontSize: 13 } }, "Instance pubkey (64 hex)"),
      h("input", {
        type: "text",
        value,
        disabled,
        spellCheck: false,
        placeholder: "the GHOST instance's own pubkey",
        onChange: (event) => onChange({ ...config, pubkey: event.target.value.trim().toLowerCase() }),
        style: { fontFamily: "monospace", fontSize: 12, padding: 6 },
      }),
      h(
        "span",
        { style: { fontSize: 12, color: "var(--text-secondary, #888)" } },
        value && !valid
          ? "That is not a 64-character hex pubkey."
          : "Links an instance that already runs on its own server. Its key stays there; Buzz only lists it.",
      ),
    );
  }

  ctx.agents.register({
    id: TYPE_ID,
    title: "GHOST Protocol",
    description: "Link a GHOST Protocol instance that already runs on its own server.",
    defaults: () => ({ config: { pubkey: "" } }),
    summary: () => "GHOST Protocol · runs on its own server",
    Create,
    tabs: [{ id: "banner", title: "Banner", component: Banner }],
    remote: {
      async provision({ config }) {
        const pubkey = config?.pubkey;
        if (!HEX64.test(pubkey ?? "")) throw new Error("Enter the instance's 64-character hex pubkey.");
        return { pubkey };
      },
      // The owner's NIP-OA attestation arrives here. The spike keeps nothing: a real provider would hand it to the
      // instance so it can attach it to what it signs. It is never logged.
      async activate() {},
      // The instance owns its own profile; renaming it in Buzz changes only the owner's listing.
      async profile() {},
      // Unlinks only. The instance and its key are untouched.
      async remove() {},
    },
  });
}
