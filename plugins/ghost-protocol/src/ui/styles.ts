// One stylesheet, added to <head> inside ctx.effect and removed by its cleanup. Surfaces, text, borders and the focus ring come from the
// host's theme tokens, so light and dark follow Settings -> Appearance with no listener, and every var() has a fallback in case a later
// host drops a token. The plugin adds no colour of its own.
export const CSS = /* css */ `
.gp-root {
  --gp-ink: var(--text-standard, #e9eef4);
  --gp-muted: var(--text-metadata, #8290a0);
  --gp-bg: var(--surface-base, #0b0d11);
  --gp-card: var(--surface-panel, #12161c);
  --gp-line: var(--border-standard, #2b333d);
  --gp-focus: var(--border-focus, var(--accent-9, #4f9cf9));
  --gp-hover: var(--affordance-row-hover, rgba(128, 140, 160, 0.14));
  display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0;
  background: var(--gp-bg); color: var(--gp-ink); font-size: 13px; line-height: 1.45;
}
.gp-root *, .gp-root *::before, .gp-root *::after { box-sizing: border-box; }
.gp-root :focus-visible { outline: 2px solid var(--gp-focus); outline-offset: 2px; }
.gp-bar { display: flex; align-items: center; flex: none; min-height: 44px; padding: 6px 16px; border-bottom: 1px solid var(--gp-line); }
.gp-title { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; overflow-wrap: anywhere; }
.gp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.gp-panel { max-width: 560px; padding: 18px 20px; border: 1px solid var(--gp-line); border-radius: 4px; background: var(--gp-card);
  display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.gp-panel h2 { margin: 0; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600; }
.gp-status { margin: 0; font-size: 15px; font-weight: 500; overflow-wrap: anywhere; }
.gp-facts { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; }
.gp-facts dt { color: var(--gp-muted); }
.gp-facts dd { margin: 0; font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.gp-note { margin: 0; max-width: 560px; color: var(--gp-muted); }
.gp-button { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border: 1px solid var(--gp-line); border-radius: 4px;
  background: transparent; color: var(--gp-ink); font: inherit; font-weight: 500; cursor: pointer; }
.gp-button:hover:not(:disabled) { background: var(--gp-hover); }
.gp-button:disabled { opacity: 0.5; cursor: default; }
`;
