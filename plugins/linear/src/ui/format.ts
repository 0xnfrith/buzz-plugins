const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const FULL = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/** "Oct 21", with the year when it is not this year, as Linear's own cards write it. */
export function shortDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear() ? MONTH_DAY.format(date) : FULL.format(date);
}

export function fullDate(iso: string): string {
  return FULL.format(new Date(iso));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : "")).toUpperCase();
}

/** A steady hue for a name, so the same person is the same colour every time. */
export function hue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function ago(from: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export function wait(until: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((until - now) / 60_000));
  return minutes === 1 ? "a minute" : `${minutes} minutes`;
}

export const PRIORITY_LABEL = ["No priority", "Urgent", "High", "Medium", "Low"] as const;
