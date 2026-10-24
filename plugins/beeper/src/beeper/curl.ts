// Beeper Desktop speaks plain HTTP on localhost. Buzz's `host.request` is HTTPS-only and the
// page may not `fetch` it (content security policy), so the one way to reach it is a program
// the manifest declares: curl. The request travels as a curl config on stdin, which keeps the
// token out of the process list, and the manifest fixes everything else (plain http only,
// no proxy, no curlrc, short timeouts, the status code written after the body).

/** `maxInputBytes` in the manifest. */
export const MAX_INPUT_BYTES = 65536;

export type CurlRequest = {
  url: string;
  method: "GET" | "POST";
  token?: string;
  body?: unknown;
};

/** A double-quoted value in a curl config file. Anything that could end the line or the quote is escaped. */
function quote(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === "\\") out += "\\\\";
    else if (char === '"') out += '\\"';
    else if (char === "\n") out += "\\n";
    else if (char === "\r") out += "\\r";
    else if (char === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) throw new Error("A control character cannot be sent");
    else out += char;
  }
  return out + '"';
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The stdin for the `request` command, or `undefined` when it would not fit. */
export function curlConfig(request: CurlRequest): string | undefined {
  const lines = [`url = ${quote(request.url)}`, `header = ${quote("Accept: application/json")}`];
  if (request.token !== undefined) lines.push(`header = ${quote(`Authorization: Bearer ${request.token}`)}`);
  if (request.method !== "GET") lines.push(`request = ${quote(request.method)}`);
  if (request.body !== undefined) {
    lines.push(`header = ${quote("Content-Type: application/json")}`);
    // `data-raw`, not `data`: curl reads a value that starts with @ as a file name.
    // JSON leaves the DEL character (0x7f) as it is, and the config cannot carry it raw.
    lines.push(`data-raw = ${quote(JSON.stringify(request.body).replace(/\u007f/g, "\\u007f"))}`);
  }
  const config = lines.join("\n") + "\n";
  return byteLength(config) <= MAX_INPUT_BYTES ? config : undefined;
}

export type Reply = { status: number; body: string };

/** The manifest has curl print the body, a line break, then the status code. */
export function parseReply(stdout: string): Reply | undefined {
  const cut = stdout.lastIndexOf("\n");
  if (cut < 0) return undefined;
  const status = Number(stdout.slice(cut + 1));
  if (!Number.isInteger(status) || status < 100 || status > 599) return undefined;
  return { status, body: stdout.slice(0, cut) };
}

// What a send adds to the message itself: the address (a chat id is long), the headers and the
// token, at most 500 characters. A generous 3 KiB, so a message that passes `fitsInRequest` fits.
const OVERHEAD = "http://127.0.0.1:65535/v1/chats/" + "x".repeat(900) + "/messages";

/** Whether `text` can travel in one request, for the composer to say so before sending. */
export function fitsInRequest(text: string): boolean {
  try {
    return curlConfig({ url: OVERHEAD, method: "POST", token: "x".repeat(500), body: { text } }) !== undefined;
  } catch {
    return false;
  }
}
