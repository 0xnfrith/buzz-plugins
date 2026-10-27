import { React } from "../react";
import { hueOf, initials } from "./format";

/** The page's entry in navigation and search: a speech bubble. */
export const PAGE_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H11l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#6366f1"/><rect x="6" y="8" width="12" height="2" rx="1" fill="#fff"/><rect x="6" y="12" width="8" height="2" rx="1" fill="#fff"/></svg>',
  );

/**
 * A network's badge: its initials on a colour taken from its name. Beeper's API gives a network as
 * a display name only, and the networks' own logos are theirs, so none is bundled.
 */
export function NetworkBadge({ network, size = 28 }: { network: string; size?: number }) {
  return (
    <span
      className="mtb-badge"
      title={network}
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: `hsl(${hueOf(network)} 52% 38%)` }}
    >
      {initials(network)}
    </span>
  );
}

type IconProps = { size?: number };

export function RefreshIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3h-3" />
    </svg>
  );
}

export function CloseIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function MuteIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 6v4h3l4 3V3L5 6H2zM12 5.5l3 5M15 5.5l-3 5" />
    </svg>
  );
}

export function PinIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M9.5 1.5l5 5-1.8.6-2.4 2.4.3 3.1-1 1-3-3-4 4-.7-.7 4-4-3-3 1-1 3.1.3 2.4-2.4z" />
    </svg>
  );
}
