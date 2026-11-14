// The lines the plugin and src/bridge.py exchange. Everything on the wire is ASCII, because the host decodes a process's output as lossy
// UTF-8 (a byte that is not valid UTF-8 would become U+FFFD) and cuts it into reads at any byte.
//
//   plugin -> bridge   "d <base64 bytes>\n"      keys, a paste or a terminal reply, to the shell
//                      "r <cols> <rows>\n"       the terminal's size
//   bridge -> plugin   "<base64 bytes>\n"        what the shell printed

/** Input is sent in frames of at most this many bytes, so the bridge's line buffer never holds more than one frame. */
export const FRAME_BYTES = 48 * 1024;
/** A bridge output line is one read of at most 64 KiB, in base64: far under this. A longer line means something is wrong. */
export const MAX_LINE_CHARS = 1024 * 1024;
/** Buzz's own Terminal bounds a terminal to 2-500 columns and 1-300 rows (docs/terminal.md in block/buzz-app). */
export const COLS = { min: 2, max: 500 };
export const ROWS = { min: 1, max: 300 };

const clamp = (value: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, Math.trunc(value) || min));

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let at = 0; at < bytes.length; at += 0x8000) out += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(out);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/** The frames that send `text` to the shell, in order. */
export function encodeInput(text: string): string[] {
  const bytes = new TextEncoder().encode(text);
  const frames: string[] = [];
  for (let at = 0; at < bytes.length; at += FRAME_BYTES) frames.push(`d ${toBase64(bytes.subarray(at, at + FRAME_BYTES))}\n`);
  return frames;
}

export const encodeResize = (cols: number, rows: number): string => `r ${clamp(cols, COLS)} ${clamp(rows, ROWS)}\n`;

export class LineTooLong extends Error {
  constructor() {
    super("The bridge sent a line longer than it ever should");
    this.name = "LineTooLong";
  }
}

/** Joins the host's output reads, which can end anywhere, back into the bridge's lines. */
export class LineAssembler {
  private partial = "";
  constructor(private readonly max = MAX_LINE_CHARS) {}

  push(text: string): string[] {
    const lines: string[] = [];
    let from = 0;
    for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n", from)) {
      const line = this.partial + text.slice(from, end);
      this.partial = "";
      if (line.length > this.max) throw new LineTooLong();
      if (line) lines.push(line);
      from = end + 1;
    }
    this.partial += text.slice(from);
    if (this.partial.length > this.max) throw new LineTooLong();
    return lines;
  }
}
