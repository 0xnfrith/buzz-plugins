import { describe, expect, test } from "vitest";
import { NEUTRAL_COLOR, safeColor } from "../../src/ui/color";

describe("colours from Linear", () => {
  test("a plain hex colour of 3, 6 or 8 digits passes as it is", () => {
    for (const ok of ["#fff", "#FFF", "#5e6ad2", "#5E6AD2", "#5e6ad2cc", "#00d4ff"]) expect(safeColor(ok), ok).toBe(ok);
  });

  test("anything that could make the page ask for something, or is not a plain colour, becomes the neutral one", () => {
    for (const bad of [
      "url(https://tracker.example/pixel.png)",
      "url('https://tracker.example/pixel.png')",
      "#fff url(https://tracker.example/pixel.png)",
      "var(--text-standard)",
      "image-set(url(https://tracker.example/x.png) 1x)",
      "red",
      "rgb(1, 2, 3)",
      "currentColor",
      "#12",
      "#1234",
      "#12345",
      "#1234567",
      "#123456789",
      "#ggg",
      "#fff;background:url(x)",
      " #fff",
      "#fff\n",
      "",
    ])
      expect(safeColor(bad), JSON.stringify(bad)).toBe(NEUTRAL_COLOR);
  });

  test("nothing at all is the fallback given, or the neutral one", () => {
    expect(safeColor(null)).toBe(NEUTRAL_COLOR);
    expect(safeColor(undefined)).toBe(NEUTRAL_COLOR);
    expect(safeColor(null, "currentColor")).toBe("currentColor");
    expect(safeColor("url(https://tracker.example/x.png)", "currentColor")).toBe("currentColor");
    expect(safeColor("#abc", "currentColor")).toBe("#abc");
  });

  test("the neutral colour is itself a plain hex colour", () => {
    expect(safeColor(NEUTRAL_COLOR, "x")).toBe(NEUTRAL_COLOR);
  });
});
