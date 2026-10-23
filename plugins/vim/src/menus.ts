// ---- j and k inside the host's menus and the community switcher [DOM] -------------------
// Both are roving-focus lists that the host drives with arrow keys; this moves focus the same
// way. Capture phase, because Base UI's menus run their own typeahead on letters.
import { COMMUNITY_POPUP } from "./constants";
import { isEditable, visible } from "./dom";
import { state } from "./state";

export const onMenuKey = (event: KeyboardEvent) => {
  if (!state.enabled || event.defaultPrevented || event.isComposing) return;
  if (event.key !== "j" && event.key !== "k") return;
  const target = event.target as Element | null;
  if (event.metaKey || event.ctrlKey || event.altKey || isEditable(target)) return;
  const list = target?.closest?.(`${COMMUNITY_POPUP}, [role="menu"]`);
  if (!list) return;
  const items = [
    ...list.querySelectorAll<HTMLElement>(
      list.matches('[role="menu"]') ? '[role="menuitem"]:not([aria-disabled="true"])' : "button:not([disabled])",
    ),
  ].filter(visible);
  if (!items.length) return;
  event.preventDefault();
  event.stopPropagation();
  const down = event.key === "j";
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = at < 0 ? (down ? 0 : items.length - 1) : (at + (down ? 1 : -1) + items.length) % items.length;
  items[next].focus();
};
