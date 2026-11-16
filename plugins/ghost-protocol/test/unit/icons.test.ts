import { describe, expect, it } from "vitest";
import { PAGE_ICON } from "../../src/ui/icons";
import { CSS } from "../../src/ui/styles";

const svg = decodeURIComponent(PAGE_ICON.slice("data:image/svg+xml,".length));
// Buzz keeps a page's icon only when it is a data:image/ URL (src/features/pages/service.ts dataImageUrl, block/buzz-app at the pinned commit).
const BUZZ_DATA_IMAGE_URL = /^data:image\/[\w.+-]+(?:;[^,]*)?,/i;

describe("the page icon", () => {
  it("is a data: SVG that Buzz keeps, and a small one", () => {
    expect(PAGE_ICON).toMatch(BUZZ_DATA_IMAGE_URL);
    expect(PAGE_ICON.startsWith("data:image/svg+xml,")).toBe(true);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(PAGE_ICON.length).toBeLessThan(1024);
  });

  it("is one shape with no colour of its own, so the mask can paint it in the theme's, with the eyes cut out of it", () => {
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(svg).not.toMatch(/\b(fill|stroke)="(?!none)[^"]+"/);
    expect(svg.match(/<path\b/g)).toHaveLength(1);
    expect(svg).toContain('fill-rule="evenodd"');
    // Three closed outlines: the body and two eyes.
    expect(svg.match(/z/gi)).toHaveLength(3);
  });

  it("is painted in the entry's text colour by a mask of the same image on the host's <img>", () => {
    const rule = CSS.slice(CSS.indexOf(`img[src="${PAGE_ICON}"]`));
    expect(rule.startsWith(`img[src="${PAGE_ICON}"] {`)).toBe(true);
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("background-color: currentColor");
    // Both spellings, each on its own line: WebKit takes the prefixed one, the others the plain one.
    const lines = body.split("\n").map((line) => line.trim());
    expect(lines).toContain(`-webkit-mask: url("${PAGE_ICON}") center / contain no-repeat;`);
    expect(lines).toContain(`mask: url("${PAGE_ICON}") center / contain no-repeat;`);
    expect(body).toContain("object-position: 999px 0");
  });

  it("cannot break out of the selector or the url()", () => {
    expect(PAGE_ICON).not.toMatch(/["'()\\\s]/);
  });
});
