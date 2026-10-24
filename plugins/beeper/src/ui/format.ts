import type { Message } from "../beeper/types";

export type Locale = { locale?: string; timeZone?: string };

const DAY = 86_400_000;

/** The calendar day of `ms` in the zone, as a number that compares and subtracts like days. */
function dayNumber(ms: number, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms).split("-").map(Number);
  return Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!) / DAY;
}

/** The clock time of a message: "14:05" or "2:05 PM", as the person's locale writes it. */
export function clock(iso: string | undefined, { locale, timeZone }: Locale = {}): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(ms);
}

/** For the chat list: the time today, "Yesterday", the weekday this week, otherwise the date. */
export function listTime(iso: string | undefined, now: number, { locale, timeZone }: Locale = {}): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return "";
  const ago = dayNumber(now, timeZone) - dayNumber(ms, timeZone);
  if (ago <= 0) return clock(iso, { locale, timeZone });
  if (ago === 1) return "Yesterday";
  if (ago < 7) return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short" }).format(ms);
  return new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric", ...(ago > 300 ? { year: "numeric" } : {}) }).format(ms);
}

/** The heading above a day's messages; nothing for a time that cannot be read. */
export function dayLabel(iso: string, now: number, { locale, timeZone }: Locale = {}): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const ago = dayNumber(now, timeZone) - dayNumber(ms, timeZone);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", month: "short", day: "numeric", ...(ago > 300 ? { year: "numeric" } : {}) }).format(ms);
}

/** Whether two messages are from one day. A time that cannot be read is no reason for a new heading. */
export function sameDay(a: string, b: string, timeZone?: string): boolean {
  const first = Date.parse(a);
  const second = Date.parse(b);
  if (Number.isNaN(first) || Number.isNaN(second)) return true;
  return dayNumber(first, timeZone) === dayNumber(second, timeZone);
}

/** Two letters at most, for a network's badge: "WhatsApp" is W, "Google Messages" is GM. */
export function initials(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? words[0]!.slice(0, 1) : words[0]!.slice(0, 1) + words[1]!.slice(0, 1);
  return letters.toLocaleUpperCase();
}

/** A hue from the name, so each network keeps one colour from run to run. */
export function hueOf(name: string): number {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash % 360;
}

const ATTACHMENT_LABEL: Partial<Record<NonNullable<Message["type"]>, string>> = {
  IMAGE: "Image",
  VIDEO: "Video",
  VOICE: "Voice message",
  AUDIO: "Audio",
  FILE: "File",
  STICKER: "Sticker",
  LOCATION: "Location",
};

/** What stands in for media the plugin does not load: the kind, and a file name when there is one. */
export function mediaLabel(message: Message): string | undefined {
  const base = message.type ? ATTACHMENT_LABEL[message.type] : undefined;
  if (!base) return undefined;
  const name = message.attachments?.find((attachment) => attachment.fileName)?.fileName;
  return name ? `${base}: ${name}` : base;
}
