// One stylesheet, added to <head> inside ctx.effect and removed by its cleanup. Surfaces, text and borders come from the host's theme
// tokens, so light and dark follow Settings -> Appearance with no listener. Brand accents: one cyan, with a darker one for the light
// theme (the bright one is under 2:1 on white), used for lines and focus, never for text. Every var() has a fallback in case a later
// host drops a token.
export const CSS = /* css */ `
.mts-root, .mts-settings {
  --mts-cyan: #00d4ff;
  --mts-ink: var(--text-standard, #e9eef4);
  --mts-muted: var(--text-metadata, #8290a0);
  --mts-bg: var(--surface-base, #0b0d11);
  --mts-card: var(--surface-panel, #12161c);
  --mts-line: var(--border-standard, #2b333d);
  --mts-hover: var(--affordance-row-hover, rgba(128, 140, 160, 0.14));
  --mts-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
}
.mts-root {
  display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0;
  background: var(--mts-bg); color: var(--mts-ink); font-size: 13px; line-height: 1.45;
}
:root:not(.dark):not([data-color-mode="dark"]) .mts-root, :root:not(.dark):not([data-color-mode="dark"]) .mts-settings { --mts-cyan: #0090b8; }
.mts-root *, .mts-root *::before, .mts-root *::after { box-sizing: border-box; }
.mts-root :focus-visible, .mts-settings :focus-visible { outline: 2px solid var(--mts-cyan); outline-offset: 2px; }
.mts-muted { color: var(--mts-muted); }
.mts-bar { display: flex; align-items: center; gap: 12px; flex: none; min-height: 44px; padding: 6px 16px; border-bottom: 1px solid var(--mts-line);
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--mts-cyan) 40%, transparent); }
.mts-wordmark { font-weight: 700; font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; }
.mts-sep { width: 1px; height: 16px; background: var(--mts-line); }
.mts-title { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; overflow-wrap: anywhere; }
.mts-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.mts-panel { max-width: 560px; padding: 18px 20px; border: 1px solid var(--mts-line); border-top: 2px solid var(--mts-cyan); border-radius: 2px;
  background: var(--mts-card); display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.mts-panel h2, .mts-settings h2 { margin: 0; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; }
.mts-settings .mts-settings-title { margin: 0 0 4px; font-size: 20px; font-weight: 600; letter-spacing: normal; text-transform: none; }
.mts-panel p, .mts-panel ul, .mts-settings p { margin: 0; }
.mts-panel ul { padding-left: 20px; list-style: disc; }
.mts-panel li + li { margin-top: 4px; }
.mts-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--mts-line); }
.mts-tab { height: 32px; padding: 0 12px; border: 1px solid transparent; border-bottom: 2px solid transparent; background: transparent; color: var(--mts-muted);
  font: inherit; font-weight: 500; cursor: pointer; }
.mts-tab:hover { color: var(--mts-ink); background: var(--mts-hover); }
.mts-tab[aria-selected="true"] { color: var(--mts-ink); border-bottom-color: var(--mts-cyan); }
.mts-form { display: flex; flex-direction: column; gap: 8px; max-width: 640px; align-items: flex-start; }
.mts-form label { font-weight: 500; }
.mts-form input, .mts-form textarea { width: 100%; padding: 6px 8px; border: 1px solid var(--mts-line); border-radius: 2px; background: var(--mts-card);
  color: var(--mts-ink); font: inherit; color-scheme: inherit; }
.mts-form textarea { min-height: 120px; resize: vertical; }
.mts-form input:hover, .mts-form textarea:hover { border-color: color-mix(in srgb, var(--mts-cyan) 50%, var(--mts-line)); }
.mts-button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid var(--mts-line); border-radius: 2px;
  background: transparent; color: var(--mts-ink); font: inherit; font-weight: 500; cursor: pointer; }
.mts-button:hover:not(:disabled) { background: var(--mts-hover); border-color: color-mix(in srgb, var(--mts-cyan) 50%, var(--mts-line)); }
.mts-button[data-primary] { border-color: var(--mts-cyan); font-weight: 600; }
.mts-button:disabled { opacity: 0.5; cursor: default; }
.mts-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.mts-result { max-width: 640px; padding: 12px 14px; border: 1px solid var(--mts-line); border-left: 2px solid var(--mts-cyan); border-radius: 2px; background: var(--mts-card);
  display: flex; flex-direction: column; gap: 8px; }
.mts-answer, .mts-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.mts-id { font-family: var(--mts-mono); font-size: 12px; }
.mts-root [data-tone="error"], .mts-settings [data-tone="error"] { color: var(--red-11, #e5484d); }
.mts-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-width: 720px; }
.mts-row { width: 100%; display: flex; align-items: baseline; gap: 12px; padding: 8px 10px; border: 1px solid var(--mts-line); border-radius: 2px; background: var(--mts-card);
  color: inherit; font: inherit; text-align: left; cursor: pointer; }
.mts-row:hover { border-color: color-mix(in srgb, var(--mts-cyan) 50%, var(--mts-line)); }
.mts-row-subject { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.mts-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 7px; border: 1px solid var(--mts-line); border-radius: 2px; color: var(--mts-muted); font-size: 12px; white-space: nowrap; }
.mts-messages { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; max-width: 720px; }
.mts-message { padding: 8px 10px; border: 1px solid var(--mts-line); border-radius: 2px; background: var(--mts-card); display: flex; flex-direction: column; gap: 4px; }
.mts-message[data-from="support"] { border-left: 2px solid var(--mts-cyan); }
.mts-message-head { font-size: 12px; color: var(--mts-muted); }
.mts-settings { display: flex; flex-direction: column; gap: 12px; max-width: 560px; padding: 0; color: var(--mts-ink); font-size: 13px; line-height: 1.45; }
.mts-settings * { box-sizing: border-box; }
.mts-switch { display: flex; align-items: center; gap: 8px; }
.mts-switch input { width: 16px; height: 16px; margin: 0; accent-color: var(--mts-cyan); }
.mts-settings code, .mts-panel code { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
@media (prefers-reduced-motion: reduce) { .mts-root * { transition: none !important; } }
`;
