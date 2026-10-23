// ---- Keys inside the Settings dialog [DOM] ----------------------------------------------
// Every dialog and menu keeps the plugin's keys off (the host's dispatcher stands down for them and so
// does the plugin), except Settings, which is a list and a detail like the app itself: j and k move
// through its sections, l or Enter opens one and goes into it, h comes back to the list. Esc closes it,
// which the host already does. Plugin API: nothing, there is no keyboard service for a dialog. DOM: the
// dialog, its `nav[aria-label="Settings sections"]` and the host's own `#settings-content`.
import { afterLayout, clamp, isEditable, visible } from "./dom";
import { state } from "./state";

const SETTINGS_NAV = 'nav[aria-label="Settings sections"]';
const SETTINGS_OWN_KEYS = 'select, [role="combobox"], [role="listbox"], [role="menu"], [role="menuitem"], [role="option"]';
const settingsDialog = () => document.querySelector(SETTINGS_NAV)?.closest('[role="dialog"]');
// The sections, not the community address button the list starts with (it copies a URL).
const settingsItems = (dialog: Element) =>
  [...dialog.querySelectorAll<HTMLElement>(`${SETTINGS_NAV} button:not([aria-label])`)].filter(visible);
// The host draws a focus ring only after Tab, an arrow or Home/End (`html[data-keyboard-navigation]`, set
// by its own listener and cleared on a pointer press): a plain j or k would move focus with no sign of
// it. Set the same flag its `focusWithKeyboard` helper does, so the ring shows as it does for Tab.
const focusSection = (item: HTMLElement | undefined) => {
  if (!item) return;
  document.documentElement.dataset.keyboardNavigation = "";
  item.focus({ preventScroll: true, focusVisible: true });
  item.scrollIntoView({ block: "nearest" });
};
const scrollParent = (el: Element, stop: HTMLElement): HTMLElement => {
  for (let node: Element | null = el; node && node !== stop; node = node.parentElement)
    if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node as HTMLElement;
  return stop;
};
export const onSettingsKey = (event: KeyboardEvent) => {
  if (!state.enabled || event.isComposing || event.keyCode === 229) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  const { key } = event;
  if (key !== "j" && key !== "k" && key !== "h" && key !== "l" && key !== "Enter") return;
  const dialog = settingsDialog();
  const el = event.target as HTMLElement;
  // Typing, a select, a menu or a popup over the dialog (its focus is outside it) keep their own keys.
  if (!dialog || !dialog.contains(el) || isEditable(el) || el.closest?.(SETTINGS_OWN_KEYS)) return;
  const items = settingsItems(dialog);
  const content = dialog.querySelector<HTMLElement>("#settings-content");
  const item = el.closest?.<HTMLElement>(`${SETTINGS_NAV} button`);
  const current = items.find((entry) => entry.hasAttribute("aria-current")) ?? items[0];
  const swallow = () => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  if (item) {
    // In the list of sections.
    if (key === "j" || key === "k") {
      swallow();
      focusSection(items[clamp(items.indexOf(item) + (key === "j" ? 1 : -1), 0, items.length - 1)]);
    } else if (key === "l" || key === "Enter") {
      swallow();
      if (!items.includes(item)) return; // the community address button: Enter copies, l does nothing
      item.click(); // opens the section ...
      afterLayout(() => content?.focus({ preventScroll: true })); // ... and goes into it
    } else swallow(); // h: already in the list
    return;
  }
  if (key === "Enter" || key === "l") return; // a button or link in the detail keeps its Enter
  swallow();
  if (key === "h") focusSection(current); // back to the list, on the open section
  else if (content?.contains(el)) scrollParent(el, content).scrollBy({ top: key === "j" ? 48 : -48 });
  else focusSection(current); // from the close button or the dialog itself, into the list
};
