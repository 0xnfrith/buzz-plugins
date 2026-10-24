// One stylesheet, added to <head> inside ctx.effect and removed by its cleanup. Surfaces, text,
// borders and the accent come from the host's theme tokens, so light and dark follow Settings →
// Appearance with no listener. Every var() has a fallback in case a later host drops a token.
export const CSS = /* css */ `
.mtb-root {
  --mtb-accent: var(--accent-9, #3e63dd);
  --mtb-ink: var(--text-standard, #e9eef4);
  --mtb-muted: var(--text-metadata, #8290a0);
  --mtb-bg: var(--surface-base, #0b0d11);
  --mtb-panel: var(--surface-panel, #12161c);
  --mtb-line: var(--border-standard, #2b333d);
  --mtb-hover: var(--affordance-row-hover, rgba(128, 140, 160, 0.14));
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--mtb-bg);
  color: var(--mtb-ink);
  font-size: 13px;
  line-height: 1.4;
}
.mtb-root *, .mtb-root *::before, .mtb-root *::after { box-sizing: border-box; }
.mtb-root :focus-visible { outline: 2px solid var(--border-focus, var(--mtb-accent)); outline-offset: -2px; }
.mtb-muted { color: var(--mtb-muted); }
.mtb-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.mtb-button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid var(--mtb-line);
  border-radius: 6px; background: transparent; color: var(--mtb-ink); font: inherit; font-weight: 500; cursor: pointer; }
.mtb-button:hover:not(:disabled) { background: var(--mtb-hover); }
.mtb-button[data-primary] { border-color: var(--mtb-accent); color: var(--mtb-accent); }
.mtb-button:disabled { opacity: 0.5; cursor: default; }
.mtb-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0;
  border: 0; border-radius: 6px; background: transparent; color: var(--mtb-muted); cursor: pointer; }
.mtb-icon-button:hover:not(:disabled) { background: var(--mtb-hover); color: var(--mtb-ink); }
.mtb-icon-button:disabled { opacity: 0.4; cursor: default; }
.mtb-input { height: 28px; padding: 0 8px; border: 1px solid var(--mtb-line); border-radius: 6px; background: var(--mtb-panel);
  color: var(--mtb-ink); font: inherit; color-scheme: inherit; }
.mtb-badge { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; color: #fff; font-weight: 600; flex: none; }

/* header */
.mtb-bar { display: flex; align-items: center; gap: 12px; flex: none; min-height: 44px; padding: 6px 16px; border-bottom: 1px solid var(--mtb-line); }
.mtb-title { margin: 0; font-size: 14px; font-weight: 600; }
.mtb-bar-end { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.mtb-banner { flex: none; padding: 6px 16px; border-bottom: 1px solid var(--mtb-line); background: color-mix(in srgb, var(--amber-9, #f5a524) 14%, transparent); }

/* states */
.mtb-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; color: var(--mtb-muted); text-align: center; }
.mtb-panel { max-width: 460px; padding: 20px 22px; border: 1px solid var(--mtb-line); border-top: 2px solid var(--mtb-accent);
  border-radius: 6px; background: var(--mtb-panel); color: var(--mtb-ink); display: flex; flex-direction: column; align-items: flex-start; gap: 10px; text-align: left; }
.mtb-panel h2 { margin: 0; font-size: 15px; }
.mtb-panel p, .mtb-panel ol { margin: 0; }
.mtb-panel ol { padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
.mtb-actions { display: flex; flex-wrap: wrap; gap: 8px; }

/* split */
.mtb-main { flex: 1; min-height: 0; display: flex; }
.mtb-side { flex: 0 0 320px; width: 320px; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--mtb-line); }
.mtb-tools { display: flex; gap: 6px; padding: 8px 10px; flex: none; border-bottom: 1px solid var(--mtb-line); }
.mtb-tools .mtb-input { flex: 1; min-width: 0; }
.mtb-toggle { height: 28px; padding: 0 10px; border: 1px solid var(--mtb-line); border-radius: 6px; background: transparent; color: var(--mtb-muted); font: inherit; cursor: pointer; }
.mtb-toggle[aria-pressed="true"] { border-color: var(--mtb-accent); color: var(--mtb-accent); }
.mtb-list { position: relative; flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 0; outline: none; }
.mtb-list-inner { position: relative; }
/* The list as a whole takes the keys; what shows it is the highlighted row, not a ring round everything. */
.mtb-root .mtb-list:focus-visible { outline: none; }
.mtb-root .mtb-list:focus-visible .mtb-row[data-cursor] { box-shadow: 0 0 0 2px var(--border-focus, var(--mtb-accent)); }
.mtb-list-foot { padding: 10px 14px 14px; color: var(--mtb-muted); font-size: 12px; }
.mtb-list-empty { padding: 20px 14px; color: var(--mtb-muted); }

/* a chat row */
.mtb-row { position: absolute; left: 4px; right: 4px; height: 56px; display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 0; border-radius: 6px;
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.mtb-row:hover { background: var(--mtb-hover); }
.mtb-row[data-cursor] { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mtb-accent) 60%, transparent); }
.mtb-row[data-open] { background: color-mix(in srgb, var(--mtb-accent) 16%, transparent); }
.mtb-row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.mtb-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mtb-row[data-unread] .mtb-row-name { font-weight: 700; }
.mtb-row-meta { display: flex; align-items: center; gap: 4px; color: var(--mtb-muted); font-size: 12px; white-space: nowrap; overflow: hidden; }
.mtb-row-end { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; color: var(--mtb-muted); font-size: 12px; }
.mtb-unsent { color: var(--red-11, #e5484d); font-weight: 600; }
.mtb-unread { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--mtb-accent); color: var(--text-on-accent, #fff); font-size: 12px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center; }
.mtb-unread[data-muted] { background: var(--mtb-muted); }

/* a chat */
.mtb-chat { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.mtb-chat-head { display: flex; align-items: center; gap: 10px; flex: none; min-height: 52px; padding: 6px 16px; border-bottom: 1px solid var(--mtb-line); }
.mtb-chat-name { margin: 0; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mtb-chat-sub { color: var(--mtb-muted); font-size: 12px; }
.mtb-thread { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 4px; }
.mtb-day { align-self: center; margin: 10px 0 4px; padding: 2px 10px; border-radius: 10px; background: var(--mtb-hover); color: var(--mtb-muted); font-size: 12px; }
.mtb-msg { max-width: min(560px, 80%); align-self: flex-start; padding: 6px 10px; border-radius: 10px; background: var(--surface-message, var(--mtb-panel)); border: 1px solid var(--mtb-line); }
.mtb-msg[data-mine] { align-self: flex-end; background: var(--surface-message-own, color-mix(in srgb, var(--mtb-accent) 20%, var(--mtb-panel))); color: var(--text-message-own, var(--mtb-ink)); border-color: transparent; }
.mtb-msg[data-mine] .mtb-msg-meta, .mtb-msg[data-mine] .mtb-msg-media { color: inherit; opacity: 0.8; }
.mtb-msg[data-notice] { align-self: center; background: transparent; border-style: dashed; color: var(--mtb-muted); font-style: italic; }
.mtb-msg[data-pending] { opacity: 0.7; }
.mtb-msg[data-failed] { border-color: var(--red-9, #e5484d); opacity: 1; }
.mtb-msg-from { font-size: 12px; font-weight: 600; color: var(--mtb-muted); }
.mtb-msg-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.mtb-msg-media { color: var(--mtb-muted); font-style: italic; }
.mtb-msg-meta { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; font-size: 11px; color: var(--mtb-muted); }
.mtb-msg-error { color: var(--red-11, #e5484d); font-size: 12px; margin-top: 2px; }
.mtb-more { align-self: center; padding: 4px 12px; border: 1px solid var(--mtb-line); border-radius: 6px; background: transparent; color: var(--mtb-ink); font: inherit; cursor: pointer; }
.mtb-more:hover:not(:disabled) { background: var(--mtb-hover); }
.mtb-composer { flex: none; display: flex; align-items: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--mtb-line); }
.mtb-composer textarea { flex: 1; field-sizing: content; min-height: 34px; max-height: 160px; resize: none; padding: 7px 10px; border: 1px solid var(--mtb-line); border-radius: 8px;
  background: var(--mtb-panel); color: var(--mtb-ink); font: inherit; color-scheme: inherit; }
.mtb-composer-note { flex: none; padding: 0 16px 8px; color: var(--mtb-muted); font-size: 12px; }
.mtb-composer-note[data-tone="error"] { color: var(--red-11, #e5484d); }

/* settings card */
.mtb-settings { height: auto; background: transparent; display: flex; flex-direction: column; gap: 12px; max-width: 560px; padding: 0; }
.mtb-settings p { margin: 0; }
.mtb-settings [data-tone="error"] { color: var(--red-11, #e5484d); }
.mtb-form { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.mtb-form .mtb-input { width: 100%; max-width: 420px; height: 32px; }
.mtb-settings details summary { cursor: pointer; color: var(--mtb-muted); }
@media (max-width: 720px) { .mtb-side { flex-basis: 240px; width: 240px; } }
@media (prefers-reduced-motion: reduce) { .mtb-root * { transition: none !important; animation: none !important; } }
`;
