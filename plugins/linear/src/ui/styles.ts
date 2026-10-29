// One stylesheet, added to <head> inside ctx.effect and removed by its cleanup. Surfaces,
// text and borders come from the host's theme tokens, so light and dark follow Settings
// → Appearance with no listener. The MEGATECH brand shows as the header lockup, tracked
// capitals, square corners and cyan (focus, drag target, selection, the primary button).
// Every var() has a fallback in case a later host drops a token.
import { PAGE_ICON } from "./icons";

export const CSS = /* css */ `
/* [DOM] The page's entry in navigation and search. The host draws its icon as an <img> of PAGE_ICON, which
   cannot follow the theme, so paint the same shape in the entry's text colour (a mask) and move the
   image's own pixels out of its box. It matches only an <img> whose src is exactly PAGE_ICON, so no
   other icon is touched. If a later host draws the icon some other way this stops matching and the
   icon is simply the plain black one. */
img[src="${PAGE_ICON}"] {
  background-color: currentColor;
  -webkit-mask: url("${PAGE_ICON}") center / contain no-repeat;
  mask: url("${PAGE_ICON}") center / contain no-repeat;
  object-position: 999px 0;
}
.mtl-root {
  --mtl-cyan: #00d4ff;
  --mtl-ink: var(--text-standard, #e9eef4);
  --mtl-muted: var(--text-metadata, #8290a0);
  --mtl-bg: var(--surface-base, #0b0d11);
  --mtl-col: color-mix(in srgb, var(--surface-panel, #12161c) 55%, transparent);
  --mtl-card: var(--surface-panel, #12161c);
  --mtl-line: var(--border-standard, #2b333d);
  --mtl-hover: var(--affordance-row-hover, rgba(128, 140, 160, 0.14));
  --mtl-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--mtl-bg);
  color: var(--mtl-ink);
  font-size: 13px;
  line-height: 1.4;
}
:root:not(.dark):not([data-color-mode="dark"]) .mtl-root { --mtl-cyan: #0090b8; }
.mtl-root *, .mtl-root *::before, .mtl-root *::after { box-sizing: border-box; }
/* WebKit (Buzz on macOS and Linux) still wants the prefixed form; without it a drag selects the text it passes over. */
.mtl-root[data-dragging], .mtl-root[data-dragging] * { cursor: grabbing !important; -webkit-user-select: none; user-select: none; }
.mtl-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.mtl-muted { color: var(--mtl-muted); }
.mtl-root a { color: var(--mtl-cyan); text-decoration: none; }
.mtl-root a:hover { text-decoration: underline; }
.mtl-root :focus-visible { outline: 2px solid var(--mtl-cyan); outline-offset: 2px; }

/* header */
.mtl-bar { display: flex; align-items: center; gap: 16px; flex: none; min-height: 44px; padding: 6px 16px;
  border-bottom: 1px solid var(--mtl-line); box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--mtl-cyan) 40%, transparent); }
.mtl-brand { display: flex; align-items: center; gap: 10px; }
.mtl-mark { display: block; }
.mtl-wordmark { font-weight: 700; font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; }
.mtl-brand-sep { width: 1px; height: 16px; background: var(--mtl-line); }
.mtl-page-title { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; }
.mtl-pickers { display: flex; align-items: center; gap: 8px; }
.mtl-bar-end { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.mtl-updated { font-size: 12px; }
.mtl-select, .mtl-details select, .mtl-key-form input {
  height: 28px; padding: 0 8px; border: 1px solid var(--mtl-line); border-radius: 2px;
  background: var(--mtl-card); color: var(--mtl-ink); font: inherit; color-scheme: inherit; }
.mtl-select:hover, .mtl-details select:hover, .mtl-key-form input:hover { border-color: color-mix(in srgb, var(--mtl-cyan) 50%, var(--mtl-line)); }
.mtl-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0;
  border: 1px solid transparent; border-radius: 2px; background: transparent; color: var(--mtl-muted); cursor: pointer; }
.mtl-icon-button:hover:not(:disabled) { background: var(--mtl-hover); color: var(--mtl-ink); }
.mtl-icon-button:disabled { opacity: 0.4; cursor: default; }
.mtl-icon-button[data-busy] svg { animation: mtl-spin 0.9s linear infinite; }
@keyframes mtl-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .mtl-icon-button[data-busy] svg { animation: none; } .mtl-card { transition: none !important; } }
.mtl-button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid var(--mtl-line);
  border-radius: 2px; background: transparent; color: var(--mtl-ink); font: inherit; font-weight: 500; cursor: pointer; text-decoration: none !important; }
.mtl-button:hover:not(:disabled) { background: var(--mtl-hover); border-color: color-mix(in srgb, var(--mtl-cyan) 50%, var(--mtl-line)); }
.mtl-button[data-primary] { border-color: var(--mtl-cyan); color: var(--mtl-cyan); }
.mtl-button:disabled { opacity: 0.5; cursor: default; }

/* banners and empty states */
.mtl-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: none; padding: 8px 16px;
  border-bottom: 1px solid var(--mtl-line); background: color-mix(in srgb, var(--mtl-cyan) 8%, transparent); }
.mtl-banner[data-tone="error"] { background: color-mix(in srgb, var(--red-9, #e5484d) 14%, transparent); }
.mtl-banner[data-tone="warning"] { background: color-mix(in srgb, var(--amber-9, #f5a524) 14%, transparent); }
.mtl-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; color: var(--mtl-muted); }
.mtl-panel { max-width: 440px; padding: 20px 22px; border: 1px solid var(--mtl-line); border-top: 2px solid var(--mtl-cyan);
  border-radius: 2px; background: var(--mtl-card); color: var(--mtl-ink); display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.mtl-panel h2 { margin: 0; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; }
.mtl-panel p { margin: 0; }

/* board */
.mtl-main { position: relative; flex: 1; min-height: 0; display: flex; }
.mtl-board { flex: 1; min-width: 0; display: flex; align-items: stretch; gap: 12px; padding: 12px 16px 0; overflow-x: auto; overflow-y: hidden; }
.mtl-column { flex: 0 0 316px; width: 316px; min-height: 0; display: flex; flex-direction: column; border-radius: 2px; background: var(--mtl-col); }
.mtl-column[data-over] { outline: 2px solid var(--mtl-cyan); outline-offset: -2px; background: color-mix(in srgb, var(--mtl-cyan) 8%, var(--mtl-col)); }
.mtl-column-head { display: flex; align-items: center; gap: 8px; flex: none; padding: 10px 12px 8px; }
.mtl-column-name { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; }
.mtl-count { font-family: var(--mtl-mono); font-size: 12px; color: var(--mtl-muted); display: inline-flex; align-items: center; gap: 4px; }
.mtl-cards { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px 8px 12px; }
.mtl-column-empty { margin: 8px 4px; color: var(--mtl-muted); }
.mtl-more { align-self: center; padding: 6px 14px; border: 1px solid var(--mtl-line); border-radius: 2px; background: transparent; color: var(--mtl-ink); font: inherit; cursor: pointer; }
.mtl-more:hover:not(:disabled) { background: var(--mtl-hover); }

/* cards */
.mtl-card { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--mtl-line);
  border-radius: 2px; background: var(--mtl-card); cursor: grab; -webkit-user-select: none; user-select: none; touch-action: pan-y; transition: border-color 0.12s, box-shadow 0.12s; }
.mtl-card:hover { border-color: color-mix(in srgb, var(--mtl-cyan) 55%, var(--mtl-line)); }
.mtl-card[data-selected] { border-color: var(--mtl-cyan); box-shadow: 0 0 0 1px var(--mtl-cyan); }
.mtl-card[data-dragging] { opacity: 0.35; }
.mtl-card[data-moving] { opacity: 0.7; }
.mtl-card[data-settled] { border-color: var(--mtl-cyan); box-shadow: 0 0 0 2px color-mix(in srgb, var(--mtl-cyan) 45%, transparent); }
.mtl-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.mtl-card-id { display: flex; align-items: baseline; gap: 6px; min-width: 0; color: var(--mtl-muted); }
.mtl-id { font-family: var(--mtl-mono); font-size: 12px; color: var(--mtl-muted); white-space: nowrap; }
.mtl-crumb-sep { opacity: 0.6; }
.mtl-crumb { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.mtl-card-assignee { flex: none; color: var(--mtl-muted); display: inline-flex; }
.mtl-avatar { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; color: #fff; font-weight: 600; flex: none; }
.mtl-card-title { display: flex; align-items: flex-start; gap: 8px; }
.mtl-status { flex: none; margin-top: 2px; }
.mtl-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-weight: 500; overflow-wrap: anywhere; }
.mtl-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mtl-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; height: 22px; padding: 0 7px; border: 1px solid var(--mtl-line);
  border-radius: 2px; color: var(--mtl-muted); font-size: 12px; white-space: nowrap; }
.mtl-chip-icon { padding: 0 5px; }
.mtl-chip-text { overflow: hidden; text-overflow: ellipsis; max-width: 130px; }
.mtl-chip[data-priority="1"] { border-color: color-mix(in srgb, #f2994a 60%, var(--mtl-line)); }
.mtl-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.mtl-root [data-status="open"] { color: var(--green-9, #30a46c); }
.mtl-root [data-status="merged"] { color: var(--purple-9, #8e4ec6); }
.mtl-root [data-status="closed"] { color: var(--red-9, #e5484d); }
.mtl-root [data-status="draft"] { color: var(--mtl-muted); }
.mtl-card-foot { font-size: 12px; color: var(--mtl-muted); }
.mtl-lift { position: fixed; z-index: 1000; pointer-events: none; opacity: 0.95; transform: rotate(1.2deg);
  filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.35)); }
.mtl-lift .mtl-card { cursor: grabbing; border-color: var(--mtl-cyan); }

/* details */
.mtl-details { flex: 0 0 380px; width: 380px; min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--mtl-line);
  background: var(--mtl-card); outline: none; }
@media (max-width: 920px) { .mtl-details { position: absolute; right: 0; top: 0; bottom: 0; z-index: 5; box-shadow: -8px 0 24px rgba(0, 0, 0, 0.3); } }
.mtl-details-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--mtl-line); }
.mtl-details-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 16px; }
.mtl-details-title { margin: 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.mtl-fields { display: grid; grid-template-columns: 88px 1fr; gap: 8px 12px; margin: 0; align-items: center; }
.mtl-fields dt { color: var(--mtl-muted); }
.mtl-fields dd { margin: 0; display: flex; align-items: center; gap: 8px; min-width: 0; }
.mtl-wrap { flex-wrap: wrap; }
.mtl-section h3 { margin: 0 0 8px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mtl-muted); display: flex; align-items: center; gap: 8px; }
.mtl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mtl-list li { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mtl-description { white-space: pre-wrap; overflow-wrap: anywhere; }
.mtl-details-foot { padding: 12px 14px; border-top: 1px solid var(--mtl-line); }

/* settings card */
.mtl-settings { height: auto; background: transparent; display: flex; flex-direction: column; gap: 12px; max-width: 560px; padding: 0; }
.mtl-settings p { margin: 0; }
.mtl-settings [data-tone="error"] { color: var(--red-11, #e5484d); }
.mtl-key-form { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.mtl-key-form input { width: 100%; max-width: 420px; height: 32px; }
.mtl-actions { display: flex; flex-wrap: wrap; gap: 8px; }
`;
