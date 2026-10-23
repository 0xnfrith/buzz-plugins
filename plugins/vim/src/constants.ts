import type { LeaderSpec, PerfLevel } from "./types";

export const STORAGE_KEY = "megatech.vim-mode.settings.v2";
// v1 saved all three switches on any change, so its composerNormal=false cannot be told from a
// choice. v2 saves only what the user switched. A v1 record still supplies the other two.
export const OLD_STORAGE_KEY = "megatech.vim-mode.settings.v1";
export const SETTING_KEYS = ["enabled", "statusLine", "composerNormal", "leader", "perf"] as const;
export const PERF_LEVELS: { id: PerfLevel; label: string }[] = [
  { id: "", label: "Off" },
  { id: "paint", label: "Key to paint" },
  { id: "full", label: "Full (every handler and DOM call)" },
];
export const PENDING_MS = 1500;

// Whether the host treats Command (not Control) as its modifier. Read when the module loads, like the platform.
export const apple = /Mac|iPhone|iPad/.test(navigator.platform);

// The leader key is a prefix for pane commands that work from anywhere, even in the message box,
// where every plain key is a text command. A chord (Ctrl-...) also works while typing; a plain key
// (Space, comma) only outside INSERT. The Vim mode page offers these; the default is Space, or
// Ctrl-w on a Mac, where the host does not use it (on Windows and Linux it closes the tab).
export const LEADERS: Record<string, LeaderSpec> = {
  space: { label: "Space", key: " " },
  "ctrl-w": { label: "Ctrl-w", key: "w", ctrl: true, mac: true },
  "ctrl-b": { label: "Ctrl-b", key: "b", ctrl: true },
  "ctrl-space": { label: "Ctrl-Space", key: " ", ctrl: true },
  comma: { label: "Comma ( , )", key: ",", show: "," },
  backslash: { label: "Backslash ( \\ )", key: "\\", show: "\\" },
};

// Colours come from the host's own theme tokens ([DOM]: custom properties on <html>, set from
// Settings → Appearance), so they follow the accent colour and light or dark mode live. The fallback
// is only for a host that stops defining the token. See "Theme" in plugins/vim/NOTES.md for the list.
export const ACCENT = "var(--accent-9, #e5a50a)"; // the accent's strong fill
export const FOCUS_RING = "var(--border-focus, #1d1d1f)"; // on the channel list: the selected row is itself an accent fill
export const mix = (colour: string, percent: number) => `color-mix(in srgb, ${colour} ${percent}%, transparent)`;

// Hooks into the host's Channels markup. All of these are [DOM] and found by reading the source.
export const MAIN = "[data-main-workspace], [data-solo-focus-pane]";
export const SIDE = "[data-panel-workspace]";
export const SIDEBAR_ROW = "[data-sidebar-section] button[data-channel-id]";
export const SCROLLER = "[data-message-scroller]";
export const MESSAGE = "[data-message-id]";
export const COMPOSER = '[data-tab-focus]:is([role="textbox"], input, textarea)';
export const NOT_WRITABLE = '[aria-disabled="true"], [disabled], [readonly], [contenteditable="false"]';
// A key typed here belongs to a menu or dialog, not to us.
export const POPUP = '[role="menu"], [role="listbox"], [role="combobox"], [role="dialog"], [aria-modal="true"], .xterm';
// The community switcher and the message action bar, both [DOM] and read from the source.
export const COMMUNITY_TRIGGER = 'nav[aria-label="Communities"] button[aria-label^="Community switcher"]';
export const COMMUNITY_POPUP = '[role="dialog"][aria-label="Switch community"]';
// The thread pane's split handle (a focusable ARIA separator) and the button that hides or shows the pane.
export const PANE_HANDLE = 'hr[aria-label="Resize main and secondary panels"]';
export const PANE_TOGGLE = "[data-tab-pane-toggle]";
