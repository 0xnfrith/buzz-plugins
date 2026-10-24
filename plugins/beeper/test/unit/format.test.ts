import { describe, expect, it } from "vitest";
import { clock, dayLabel, hueOf, initials, listTime, mediaLabel, sameDay } from "../../src/ui/format";

const here = { locale: "en-US", timeZone: "UTC" };
const now = Date.parse("2026-10-24T15:00:00Z");

describe("times", () => {
  it("writes the clock in the zone given", () => {
    expect(clock("2026-10-24T14:05:00Z", here)).toBe("2:05 PM");
    expect(clock("2026-10-24T14:05:00Z", { locale: "en-US", timeZone: "Asia/Tokyo" })).toBe("11:05 PM");
    expect(clock("nonsense", here)).toBe("");
    expect(clock(undefined, here)).toBe("");
  });
  it("shows the time today, Yesterday, the weekday this week, then the date", () => {
    expect(listTime("2026-10-24T01:00:00Z", now, here)).toBe("1:00 AM");
    expect(listTime("2026-10-23T23:00:00Z", now, here)).toBe("Yesterday");
    expect(listTime("2026-10-21T10:00:00Z", now, here)).toBe("Wed");
    expect(listTime("2026-10-10T10:00:00Z", now, here)).toBe("Oct 10");
    expect(listTime("2025-01-10T10:00:00Z", now, here)).toBe("Jan 10, 2025");
    expect(listTime(undefined, now, here)).toBe("");
  });
  it("counts days in the viewer's zone, not in UTC", () => {
    const tokyo = { locale: "en-US", timeZone: "Asia/Tokyo" };
    // 15:00 UTC on the 24th is midnight on the 25th in Tokyo: a message from 14:00 UTC is "today" at
    // 14:30 UTC and "Yesterday" at 15:30 UTC, though both moments are on the 24th in UTC.
    expect(listTime("2026-10-24T14:00:00Z", Date.parse("2026-10-24T14:30:00Z"), tokyo)).toBe("11:00 PM");
    expect(listTime("2026-10-24T14:00:00Z", Date.parse("2026-10-24T15:30:00Z"), tokyo)).toBe("Yesterday");
  });
  it("labels days", () => {
    expect(dayLabel("2026-10-24T09:00:00Z", now, here)).toBe("Today");
    expect(dayLabel("2026-10-23T09:00:00Z", now, here)).toBe("Yesterday");
    expect(dayLabel("2026-10-20T09:00:00Z", now, here)).toBe("Tue, Oct 20");
    expect(sameDay("2026-10-24T00:00:00Z", "2026-10-24T23:59:00Z", "UTC")).toBe(true);
    expect(sameDay("2026-10-24T23:59:00Z", "2026-10-25T00:00:00Z", "UTC")).toBe(false);
  });
});

describe("a time that cannot be read", () => {
  it("is no reason to fail: no heading, no new day, no text", () => {
    expect(dayLabel("not a date", now, here)).toBe("");
    expect(dayLabel("", now, here)).toBe("");
    expect(sameDay("not a date", "2026-10-24T00:00:00Z", "UTC")).toBe(true);
    expect(sameDay("2026-10-24T00:00:00Z", "", "UTC")).toBe(true);
    expect(clock("not a date", here)).toBe("");
    expect(listTime("not a date", now, here)).toBe("");
  });
});

describe("badges", () => {
  it("takes one letter from one word and two from several", () => {
    expect(initials("WhatsApp")).toBe("W");
    expect(initials("Google Messages")).toBe("GM");
    expect(initials("iMessage")).toBe("I");
    expect(initials("  ")).toBe("?");
    expect(initials("Facebook_Messenger")).toBe("FM");
  });
  it("keeps one hue per network, whatever the case", () => {
    expect(hueOf("Signal")).toBe(hueOf("signal"));
    expect(hueOf("Signal")).not.toBe(hueOf("Telegram"));
    for (const name of ["", "a", "WhatsApp", "日本語"]) {
      expect(hueOf(name)).toBeGreaterThanOrEqual(0);
      expect(hueOf(name)).toBeLessThan(360);
    }
  });
});

describe("mediaLabel", () => {
  const base = { id: "1", chatID: "c", senderID: "s", sortKey: "1", timestamp: "2026-10-24T00:00:00Z" };
  it("names the kind and the file", () => {
    expect(mediaLabel({ ...base, type: "IMAGE", attachments: [{ fileName: "photo.jpg" }] })).toBe("Image: photo.jpg");
    expect(mediaLabel({ ...base, type: "VOICE" })).toBe("Voice message");
    expect(mediaLabel({ ...base, type: "TEXT" })).toBeUndefined();
    expect(mediaLabel({ ...base })).toBeUndefined();
  });
});
