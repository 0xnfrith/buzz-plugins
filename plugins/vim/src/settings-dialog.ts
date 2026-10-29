// ---- Keys inside the Settings dialog [DOM] ----------------------------------------------
// Every dialog and menu keeps the plugin's keys off (the host's dispatcher stands down for them and so
// does the plugin), except Settings, which is a list and a detail like the app itself: j and k move
// through its sections, l or Enter opens one and goes into it, h comes back to the list. Esc closes it,
// which the host already does. Inside a section j and k move from one control to the next (the plugin
// cards and their buttons, the tabs, a section's switches and menus: the tab stops, in the order Tab
// takes them), Enter presses the one that has the focus, and a field, a select or an open menu keep
// their own keys. Plugin API: nothing, there is no keyboard service for a dialog. DOM: the dialog, its
// `nav[aria-label="Settings sections"]` and the host's own `#settings-content`.
import { afterLayout, clamp, isEditable, visible } from "./dom";
import { keepFocusInView, scrollLines } from "./scroll";
import { armPending, set, state, takeCount } from "./state";

const SETTINGS_NAV = 'nav[aria-label="Settings sections"]';
const SETTINGS_OWN_KEYS = 'select, [role="combobox"], [role="listbox"], [role="menu"], [role="menuitem"], [role="option"]';
const settingsDialog = () => document.querySelector(SETTINGS_NAV)?.closest('[role="dialog"]');
// A menu button (the host's select) that is shut keeps no keys of its own: j and k move on from it. Open, its menu has them.
const ownKeys = (el: HTMLElement) => {
  const own = el.closest<HTMLElement>(SETTINGS_OWN_KEYS);
  return !!own && !(own.getAttribute("role") === "combobox" && own.tagName === "BUTTON" && own.getAttribute("aria-expanded") !== "true");
};
// The controls of a section in the order Tab visits them: what takes the focus (a tabindex of 0 or more, so a tab list's
// roving items count once) and shows.
const TAB_STOPS = 'a[href], button, input, select, textarea, [tabindex]';
const paneStops = (content: HTMLElement) =>
  [...content.querySelectorAll<HTMLElement>(TAB_STOPS)].filter(
    (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && visible(el),
  );
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
// The same for a control inside a section.
const focusControl = (el: HTMLElement) => {
  document.documentElement.dataset.keyboardNavigation = "";
  el.focus({ preventScroll: true, focusVisible: true });
  el.scrollIntoView({ block: "nearest" });
};
// The scrolling element around `el`, up to (not including) `stop`; `stop` when there is none.
const scrollParent = (el: Element, stop: HTMLElement): HTMLElement => {
  for (let node: Element | null = el; node && node !== stop; node = node.parentElement)
    if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node as HTMLElement;
  return stop;
};
export const onSettingsKey = (event: KeyboardEvent) => {
  if (!state.enabled || event.isComposing || event.keyCode === 229) return;
  if (event.metaKey || event.altKey || event.shiftKey) return;
  const { key } = event;
  // Ctrl-e and Ctrl-y scroll the part that has the keys (the list of sections, or the open section) a line.
  const line = event.ctrlKey && (key === "e" || key === "y");
  if (event.ctrlKey && !line) return;
  // The host's shortcut service stands down inside a dialog, so the digits of a count are taken here (a count
  // only means something to Ctrl-e and Ctrl-y; it lapses after a moment, like the lists').
  const digit = !event.ctrlKey && /^[0-9]$/.test(key) && (key !== "0" || state.count > 0);
  if (!line && !digit && key !== "j" && key !== "k" && key !== "h" && key !== "l" && key !== "Enter") return;
  const dialog = settingsDialog();
  const el = event.target as HTMLElement;
  // Typing, a select, a menu or a popup over the dialog (its focus is outside it) keep their own keys.
  if (!dialog || !dialog.contains(el) || isEditable(el) || ownKeys(el)) return;
  if (digit) {
    set({ count: Math.min(state.count * 10 + Number(key), 999) });
    return armPending();
  }
  const items = settingsItems(dialog);
  const content = dialog.querySelector<HTMLElement>("#settings-content");
  const item = el.closest?.<HTMLElement>(`${SETTINGS_NAV} button`);
  const current = items.find((entry) => entry.hasAttribute("aria-current")) ?? items[0];
  const swallow = () => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  if (line) {
    swallow();
    const direction = key === "e" ? 1 : -1;
    const lines = takeCount();
    if (item) {
      const list = scrollParent(item, dialog as HTMLElement);
      scrollLines(list, direction, lines);
      afterLayout(() => keepFocusInView(list, items, direction));
    } else scrollLines(scrollParent(content?.contains(el) ? el : (content ?? el), dialog as HTMLElement), direction, lines);
    return;
  }
  if (item) {
    // In the list of sections.
    if (key === "j" || key === "k") {
      swallow();
      focusSection(items[clamp(items.indexOf(item) + (key === "j" ? 1 : -1), 0, items.length - 1)]);
    } else if (key === "l" || key === "Enter") {
      swallow();
      if (!items.includes(item)) return; // the community address button: Enter copies, l does nothing
      // Opens the section ... unless it is the open one already: the host renders a section anew on every click (some 130 ms in
      // the browser harness) and would show what is there.
      const shown = item.getAttribute("aria-current") === "page" && !!content && visible(content);
      if (shown) content.focus({ preventScroll: true }); // already open: in at once, so that a j straight after finds the focus there
      else {
        item.click();
        afterLayout(() => content?.focus({ preventScroll: true })); // ... and goes into it
      }
    } else swallow(); // h: already in the list
    return;
  }
  if (content?.contains(el)) {
    // In the open section.
    if (key === "h") {
      swallow();
      return focusSection(current); // back to the list, on the open section
    }
    if (key === "j" || key === "k") {
      swallow();
      const stops = paneStops(content);
      // The next control after the one that has the focus (the section itself, just after l, is before all of them); with none
      // that way the section scrolls, as it did before the controls could be walked.
      const after = (stop: HTMLElement) => !!(el.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING) && !el.contains(stop);
      const before = (stop: HTMLElement) => !!(el.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_PRECEDING) && !stop.contains(el);
      const next = el === content ? (key === "j" ? stops[0] : undefined) : key === "j" ? stops.find(after) : stops.findLast(before);
      if (next) return focusControl(next);
      return scrollParent(el, dialog as HTMLElement).scrollBy({ top: key === "j" ? 48 : -48 });
    }
    if (key === "Enter") {
      // A switch or a check box ignores Enter; it is pressed here. A button or a link keeps its own.
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        swallow();
        el.click();
      }
      return;
    }
    return; // l: nothing further in
  }
  if (key === "Enter" || key === "l") return; // a button or link around the section keeps its Enter
  swallow();
  if (key === "h") focusSection(current); // back to the list, on the open section
  else focusSection(current); // from the close button or the dialog itself, into the list
};
