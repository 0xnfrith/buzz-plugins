// ---- Page [API] -------------------------------------------------------------------------
import type { ChangeEvent, ReactElement } from "react";
import { apple, LEADERS, PERF_LEVELS } from "./constants";
import { ctx } from "./ctx";
import { groups } from "./key-list";
import { setting, state, subscribe } from "./state";
import type { KeyRow, PerfLevel, VimState } from "./types";

export const registerPage = () => {
  const React = ctx.react;
  const h = React.createElement;
  const useVim = () => React.useSyncExternalStore(subscribe, () => state);
  const ModeBadge = () => {
    const s = useVim();
    return s.enabled ? h("span", { "aria-label": `Vim ${s.mode} mode` }, s.mode === "insert" ? "I" : "N") : null;
  };
  const table = (rows: KeyRow[]) => {
    const tier = rows.some((row) => row[2]);
    return h(
      "table",
      { style: { borderCollapse: "collapse", marginBottom: "1rem" } },
      h(
        "tbody",
        null,
        rows.map((row) =>
          h(
            "tr",
            { key: row[0] },
            h("td", { style: { padding: "2px 16px 2px 0", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", verticalAlign: "top" } }, row[0]),
            h("td", { style: { padding: "2px 16px 2px 0" } }, row[1]),
            tier && h("td", { style: { padding: "2px 0", opacity: 0.6, whiteSpace: "nowrap", verticalAlign: "top" } }, row[2]),
          ),
        ),
      ),
    );
  };
  const toggle = (s: VimState, label: string, field: "enabled" | "statusLine" | "composerNormal", hint?: string) =>
    h(
      "label",
      { style: { display: "block", margin: "0.5rem 0" } },
      h("input", {
        type: "checkbox",
        checked: s[field],
        onChange: (event: ChangeEvent<HTMLInputElement>) => setting({ [field]: event.target.checked }),
      }),
      ` ${label}`,
      hint && h("span", { style: { opacity: 0.6 } }, ` ${hint}`),
    );
  ctx.pages.register({
    id: "main",
    title: "Vim mode",
    primary: true,
    badge: ModeBadge,
    component: function VimPage() {
      const s = useVim();
      return h(
        "section",
        { className: "ui-card", style: { padding: "var(--space-panel-inset)" } },
        h("h1", null, "Vim mode"),
        h("p", { role: "status" }, `Mode: ${s.mode}. Region: ${s.region}.`),
        toggle(s, "Vim keys", "enabled"),
        toggle(s, "Status line", "statusLine", "(the -- NORMAL -- label under the message box)"),
        toggle(s, "Normal and visual mode inside the message box", "composerNormal", "(Esc in the box keeps the focus; switch this off for a plain box)"),
        h(
          "label",
          { style: { display: "block", margin: "0.5rem 0" } },
          "Leader key ",
          h(
            "select",
            {
              "aria-label": "Leader key",
              value: s.leader,
              onChange: (event: ChangeEvent<HTMLSelectElement>) => setting({ leader: event.target.value }),
            },
            Object.entries(LEADERS)
              .filter(([id, spec]) => !spec.mac || apple || id === s.leader)
              .map(([id, spec]) => h("option", { key: id, value: id }, spec.label)),
          ),
          h(
            "span",
            { style: { opacity: 0.6 } },
            " (then h or l: next pane; q: close the thread; < > | =: resize it. Works in the message box too)",
          ),
        ),
        h(
          "label",
          { style: { display: "block", margin: "0.5rem 0" } },
          "Performance trace ",
          h(
            "select",
            {
              "aria-label": "Performance trace",
              value: s.perf,
              onChange: (event: ChangeEvent<HTMLSelectElement>) => setting({ perf: event.target.value as PerfLevel }),
            },
            PERF_LEVELS.map((entry) => h("option", { key: entry.id || "off", value: entry.id }, entry.label)),
          ),
          h(
            "span",
            { style: { opacity: 0.6 } },
            " (for measuring the plugin; off by default. Ctrl+Alt+Shift+P copies the numbers as JSON, Ctrl+Alt+Shift+R starts over)",
          ),
        ),
        h("p", { style: { opacity: 0.7 } }, "The same list opens over any page with ?. The last column says how each key reaches the app; see NOTES.md."),
        ...groups().flatMap((group): ReactElement[] => [
          h("h2", { key: `${group.title}-title` }, group.title),
          h("p", { key: `${group.title}-intro`, style: { opacity: 0.7 } }, group.intro),
          h("div", { key: group.title }, table(group.rows)),
        ]),
        h("input", {
          "aria-label": "Vim typing check",
          placeholder: "Plain keys never act while you type here",
          style: { width: "100%" },
        }),
      );
    },
  });
};
