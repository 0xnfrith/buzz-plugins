/** Used for a colour from Linear that is not a plain hex colour. */
export const NEUTRAL_COLOR = "#8290a0";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Linear's label, project and state colours go into a `style` or an SVG attribute. Only `#rgb`, `#rrggbb` and `#rrggbbaa` get
 * through, so a `url(...)` (a remote image) or a `var(...)` can never come from the service; anything else is `fallback`.
 */
export function safeColor(value: string | null | undefined, fallback: string = NEUTRAL_COLOR): string {
  return typeof value === "string" && HEX.test(value) ? value : fallback;
}
