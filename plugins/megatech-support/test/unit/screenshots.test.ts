import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const pngs = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? pngs(join(dir, name)) : name.endsWith(".png") ? [join(dir, name)] : []));

/** The chunks of a PNG, and its colour type (2 is truecolour). */
function chunks(file: string) {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const names: string[] = [];
  let colour = -1;
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const name = bytes.subarray(at + 4, at + 8).toString("latin1");
    if (name === "IHDR") colour = bytes[at + 8 + 9] as number;
    names.push(name);
    at += 12 + length;
  }
  return { names, colour, size: bytes.length };
}

describe("the screenshots", () => {
  const files = pngs(join(root, "screenshots"));

  it("are there, and every one the README shows exists", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const shown = [...readme.matchAll(/\]\((screenshots\/[^)\s]+\.png)\)/g)].map((match) => match[1] as string);
    expect(shown.length).toBeGreaterThanOrEqual(7);
    for (const path of shown) expect(files).toContain(join(root, path));
    // And none lies about: every file in the folder is shown by the README.
    for (const file of files) expect(shown).toContain(file.slice(root.length + 1));
  });

  it("keep only the image: truecolour, with the chunks IHDR, IDAT and IEND and no date, text or colour profile", () => {
    for (const file of files) {
      const { names, colour } = chunks(file);
      expect(new Set(names), file).toEqual(new Set(["IHDR", "IDAT", "IEND"]));
      expect(names[0]).toBe("IHDR");
      expect(names.at(-1)).toBe("IEND");
      expect(colour, file).toBe(2);
    }
  });

  it("are not heavy, so the README stays quick to load", () => {
    const total = files.reduce((sum, file) => sum + chunks(file).size, 0);
    for (const file of files) expect(chunks(file).size, file).toBeLessThan(260_000);
    expect(total).toBeLessThan(1_000_000);
  });
});
