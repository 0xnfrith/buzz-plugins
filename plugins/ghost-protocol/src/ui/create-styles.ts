// The create form's styles, added to <head> with the page's (src/index.tsx). The form sits in Buzz's dialog, not in the page's `.gp-root`,
// so it carries its own tokens: the host's theme tokens with a fallback each, and no colour of its own.
export const CREATE_CSS = /* css */ `
.gp-create {
  --gp-ink: var(--text-standard, #e9eef4);
  --gp-muted: var(--text-metadata, #8290a0);
  --gp-line: var(--border-standard, #2b333d);
  --gp-focus: var(--border-focus, var(--accent-9, #4f9cf9));
  --gp-hover: var(--affordance-row-hover, rgba(128, 140, 160, 0.14));
  display: flex; flex-direction: column; gap: 10px; min-width: 0; color: var(--gp-ink); font-size: 13px; line-height: 1.45;
}
.gp-root.gp-in-tab { height: auto; background: transparent; gap: 14px; padding: 0 0 16px; }
.gp-in-tab .gp-create { padding: 18px 20px; border: 1px solid var(--gp-line); border-radius: 4px; background: var(--gp-card, transparent); }
.gp-create *, .gp-create *::before, .gp-create *::after { box-sizing: border-box; }
.gp-create :focus-visible { outline: 2px solid var(--gp-focus); outline-offset: 2px; }
.gp-create-group { margin: 0; padding: 10px 0 0; border: 0; border-top: 1px solid var(--gp-line); min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.gp-create-group legend { padding: 0 6px 0 0; font-weight: 600; }
.gp-create-fields { display: flex; flex-direction: column; gap: 6px; }
.gp-choice { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.gp-choice[aria-disabled="true"] { opacity: 0.6; cursor: default; }
.gp-soon { color: var(--gp-muted); font-size: 12px; }
.gp-hint { margin: 0; color: var(--gp-muted); overflow-wrap: anywhere; }
.gp-question { margin: 0; font-weight: 500; overflow-wrap: anywhere; }
.gp-input { width: 100%; min-width: 0; height: 30px; padding: 0 8px; border: 1px solid var(--gp-line); border-radius: 4px; background: transparent; color: inherit; font: inherit; }
.gp-create code { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.gp-steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.gp-step { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.gp-step[data-state="waiting"], .gp-step[data-state="skipped"] { color: var(--gp-muted); }
.gp-mark { width: 1.2em; text-align: center; flex: none; }
.gp-step-state, .gp-step-note { color: var(--gp-muted); font-size: 12px; overflow-wrap: anywhere; min-width: 0; }
.gp-login, .gp-refused { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--gp-line); border-radius: 4px; }
.gp-address { margin: 0; overflow-wrap: anywhere; }
.gp-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.gp-create .gp-button { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border: 1px solid var(--gp-line); border-radius: 4px;
  background: transparent; color: var(--gp-ink); font: inherit; font-weight: 500; cursor: pointer; }
.gp-create .gp-button:hover:not(:disabled) { background: var(--gp-hover); }
.gp-create .gp-button:disabled { opacity: 0.5; cursor: default; }
`;
