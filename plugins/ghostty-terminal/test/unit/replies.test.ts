// What the terminal writes back to the shell on its own. A program, or a file that is `cat`ed, can print any escape sequence, so a reply
// that repeats text the output chose would let output type into the shell. The WASM of ghostty-web 0.4.0 answers only the two status
// reports below, each a fixed shape made of numbers; this holds that to the pinned version, so a newer WASM that answers more fails
// here first. It runs the real WASM, the one in the package, without a browser.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { Ghostty } from "ghostty-web";
import { WASM_SHA256 } from "../../scripts/pins.mjs";

const wasmPath = createRequire(import.meta.url).resolve("ghostty-web/ghostty-vt.wasm");

async function load(): Promise<Ghostty> {
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(readFileSync(wasmPath)), { env: { log: () => {} } });
  return new Ghostty(instance);
}

/** Everything the terminal answers to `input`, as one string per reply. */
async function repliesTo(input: string): Promise<string[]> {
  const terminal = (await load()).createTerminal(80, 24);
  try {
    terminal.write(input);
    const replies: string[] = [];
    for (let reply = terminal.readResponse(); reply !== null && replies.length < 20; reply = terminal.readResponse()) replies.push(reply);
    return replies;
  } finally {
    terminal.free();
  }
}

const ESC = "\x1b";
const ST = `${ESC}\\`;
const BEL = "\x07";
const INJECT = "INJECT-ME";
const hex = (text: string) => Buffer.from(text).toString("hex");

describe("the WASM", () => {
  it("is the one the build pins: the package's ghostty-vt.wasm has the sha256 the build checks for", () => {
    expect(createHash("sha256").update(readFileSync(wasmPath)).digest("hex")).toBe(WASM_SHA256);
  });
});

describe("what the terminal answers", () => {
  it("answers the two status reports, in fixed shapes made of numbers", async () => {
    expect(await repliesTo(`${ESC}[5n`)).toEqual([`${ESC}[0n`]);
    expect(await repliesTo(`${ESC}[6n`)).toEqual([`${ESC}[1;1R`]);
    expect(await repliesTo(`abc${ESC}[6n`)).toEqual([`${ESC}[1;4R`]);
  });

  // Each of these asks the terminal to repeat something, or to describe itself or its title; none may put output-chosen text on stdin.
  const hostile: Record<string, string> = {
    "title report after a title is set (CSI 21 t)": `${ESC}]0;${INJECT}${BEL}${ESC}[21t`,
    "icon label report (CSI 20 t)": `${ESC}]1;${INJECT}${BEL}${ESC}[20t`,
    "window size reports (CSI 14/18/19 t)": `${ESC}[14t${ESC}[18t${ESC}[19t`,
    "DECRQSS, a setting request that echoes its argument": `${ESC}P$q${INJECT}${ST}${ESC}P$qm${ST}${ESC}P$q q${ST}`,
    "XTGETTCAP, a terminfo request that echoes its names in hex": `${ESC}P+q${hex(INJECT)}${ST}${ESC}P+q${hex("Co")}${ST}`,
    "colour queries (OSC 4, 10, 11, 12)": `${ESC}]4;1;?${BEL}${ESC}]10;?${BEL}${ESC}]11;?${BEL}${ESC}]12;?${BEL}`,
    "clipboard query and clipboard write (OSC 52)": `${ESC}]52;c;?${BEL}${ESC}]52;c;${Buffer.from(INJECT).toString("base64")}${BEL}`,
    "device attributes (DA1, DA2, DA3), XTVERSION and the answerback (ENQ)": `${ESC}[c${ESC}[>c${ESC}[=c${ESC}[>q\x05`,
    "mode and keyboard-protocol queries (DECRQM, kitty)": `${ESC}[?2004$p${ESC}[4$p${ESC}[?u`,
    "a kitty graphics query": `${ESC}_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA${ST}`,
    "an unterminated string left open": `${ESC}]0;${INJECT}${ESC}P$q${INJECT}`,
  };

  for (const [name, input] of Object.entries(hostile)) {
    it(`never repeats output's text: ${name}`, async () => {
      const replies = await repliesTo(input);
      for (const reply of replies) {
        expect(reply).not.toContain(INJECT);
        expect(reply).not.toContain(hex(INJECT));
        // The only shapes it may send: a status report made of digits.
        expect(reply).toMatch(/^\x1b\[(0n|\d+;\d+R)$/);
      }
    });
  }

  it("does not answer at all to the queries a program uses to probe a terminal, other than the two status reports", async () => {
    for (const [name, input] of Object.entries(hostile)) expect(await repliesTo(input), name).toEqual([]);
  });
});
