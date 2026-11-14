import { describe, expect, it } from "vitest";
import { randomSplit } from "../host-sim.mjs";
import { COLS, FRAME_BYTES, LineAssembler, LineTooLong, ROWS, encodeInput, encodeResize, fromBase64, toBase64 } from "../../src/protocol";

describe("encodeInput", () => {
  const decode = (frames: string[]) => {
    const parts = frames.map((frame) => {
      expect(frame).toMatch(/^d [A-Za-z0-9+/=]*\n$/);
      return fromBase64(frame.slice(2, -1));
    });
    return new TextDecoder().decode(Uint8Array.from(parts.flatMap((part) => [...part])));
  };

  it("sends text as base64 frames that decode back to it, multi-byte characters and emoji included", () => {
    const text = "echo é日本😀\r\x1b[A\t\x03";
    expect(decode(encodeInput(text))).toBe(text);
  });

  it("cuts a large paste into frames of at most 48 KiB, so the bridge never buffers a long line", () => {
    const text = "x".repeat(FRAME_BYTES * 3 + 5);
    const frames = encodeInput(text);
    expect(frames).toHaveLength(4);
    for (const frame of frames) expect(frame.length).toBeLessThanOrEqual(2 + Math.ceil((FRAME_BYTES * 4) / 3) + 4 + 1);
    expect(decode(frames)).toBe(text);
  });

  it("joins a character that a frame boundary cuts, because the bridge appends bytes in order", () => {
    const text = "é".repeat(FRAME_BYTES); // two bytes each: a boundary can fall inside one
    expect(decode(encodeInput(text))).toBe(text);
  });

  it("sends nothing for no text", () => {
    expect(encodeInput("")).toEqual([]);
  });
});

describe("encodeResize", () => {
  it("sends the size, bounded to what Buzz's own Terminal allows", () => {
    expect(encodeResize(120, 40)).toBe("r 120 40\n");
    expect(encodeResize(1, 0)).toBe(`r ${COLS.min} ${ROWS.min}\n`);
    expect(encodeResize(9999, 9999)).toBe(`r ${COLS.max} ${ROWS.max}\n`);
    expect(encodeResize(Number.NaN, -3)).toBe(`r ${COLS.min} ${ROWS.min}\n`);
    expect(encodeResize(80.9, 24.2)).toBe("r 80 24\n");
  });
});

describe("base64", () => {
  it("round-trips every byte value, in one piece and past the 32 KiB step", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, at) => at % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe("LineAssembler", () => {
  const lines = ["QUJD", "", "REVGRw==", "SElK"];
  const wire = `${lines.join("\n")}\n`;

  it("returns whole lines, skips empty ones, and holds a partial line for the next read", () => {
    const assembler = new LineAssembler();
    expect(assembler.push("QUJD\nREVG")).toEqual(["QUJD"]);
    expect(assembler.push("Rw==\n\nSElK")).toEqual(["REVGRw=="]);
    expect(assembler.push("\n")).toEqual(["SElK"]);
  });

  it("gives the same lines however the host cuts its reads, even one character at a time (a read can end anywhere)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const split = randomSplit(seed, 7);
      const assembler = new LineAssembler();
      const got: string[] = [];
      for (const piece of split(Buffer.from(wire))) got.push(...assembler.push(piece.toString()));
      expect(got).toEqual(lines.filter(Boolean));
    }
    const single = new LineAssembler();
    expect([...wire].flatMap((char) => single.push(char))).toEqual(lines.filter(Boolean));
  });

  it("refuses a line, finished or not, longer than the cap, instead of growing without end", () => {
    expect(() => new LineAssembler(10).push("x".repeat(11))).toThrow(LineTooLong);
    expect(() => new LineAssembler(10).push(`${"x".repeat(11)}\n`)).toThrow(LineTooLong);
    const assembler = new LineAssembler(10);
    assembler.push("x".repeat(6));
    expect(() => assembler.push("x".repeat(6))).toThrow(LineTooLong);
    expect(new LineAssembler(10).push(`${"x".repeat(10)}\n`)).toEqual(["x".repeat(10)]);
  });
});
