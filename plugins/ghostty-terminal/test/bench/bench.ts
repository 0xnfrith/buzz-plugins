// Feeds the same output to this plugin's terminal (ghostty-web on a canvas) and to xterm 6.0.0 with its default DOM renderer, which is
// what Buzz's own Terminal uses, and measures what the page can see. It is the render path only: nothing here crosses Buzz's host, so the
// pipe, the bridge and the Tauri channel are not in these numbers (see NOTES.md). Run by run.mjs in headless Chromium.
import { Terminal as Xterm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { createScreen, type Screen } from "../../src/term";

const CHUNK = 64 * 1024; // what the host reads from a pipe at a time

/** A deterministic stream of the kind of output a shell prints: coloured text, UTF-8, long and short lines, no two chunks alike. */
function corpus(bytes: number): Uint8Array[] {
  let state = 12345;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const words = ["build", "ok", "warning:", "src/index.ts", "error", "é日本語", "😀", "0x7fff5fbff8a0", "####", "node_modules", "passed", "->"];
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < bytes) {
    let text = "";
    while (text.length < CHUNK - 400) {
      const color = 30 + Math.floor(random() * 8);
      let line = `\x1b[${random() < 0.2 ? "1;" : ""}${color}m`;
      for (let at = 0, count = 4 + Math.floor(random() * 14); at < count; at++) line += `${words[Math.floor(random() * words.length)]} `;
      text += `${line}\x1b[0m\r\n`;
    }
    const chunk = encoder.encode(text);
    chunks.push(chunk);
    total += chunk.length;
  }
  return chunks;
}

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const task = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

type Emulator = { write(bytes: Uint8Array): Promise<void>; echo(text: string): void; dispose(): void };

async function ghostty(box: HTMLElement): Promise<{ emulator: Emulator; opened: number }> {
  const started = performance.now();
  const screen: Screen = await createScreen({ onInput() {}, onResize() {} });
  screen.attach(box);
  const opened = performance.now() - started;
  return {
    opened,
    emulator: {
      write: async (bytes) => screen.write(bytes),
      echo: (text) => screen.write(new TextEncoder().encode(text)),
      dispose: () => screen.dispose(),
    },
  };
}

async function xterm(box: HTMLElement): Promise<{ emulator: Emulator; opened: number }> {
  const started = performance.now();
  const terminal = new Xterm({ cols: 120, rows: 30, scrollback: 5000, fontSize: 13 });
  terminal.open(box);
  const opened = performance.now() - started;
  return {
    opened,
    emulator: {
      // xterm parses in the background and calls back when it has taken the data: wait for that, as a caller that cares about ordering would.
      write: (bytes) => new Promise((resolve) => terminal.write(bytes, resolve)),
      echo: (text) => terminal.write(text),
      dispose: () => terminal.dispose(),
    },
  };
}

async function measure(kind: "ghostty" | "xterm", megabytes: number, samples: number) {
  const box = document.getElementById("box")!;
  box.replaceChildren();
  const { emulator, opened } = await (kind === "ghostty" ? ghostty(box) : xterm(box));
  await frame();
  await frame();

  // Throughput: every chunk is its own task, as each Tauri channel event is, and the clock stops when the last frame is drawn.
  const chunks = corpus(megabytes * 1024 * 1024);
  const bytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const longTasks: number[] = [];
  const observer = new PerformanceObserver((list) => list.getEntries().forEach((entry) => longTasks.push(entry.duration)));
  observer.observe({ entryTypes: ["longtask"] });
  const started = performance.now();
  for (const chunk of chunks) {
    await emulator.write(chunk);
    await task();
  }
  await frame();
  await frame();
  const seconds = (performance.now() - started) / 1000;
  await task();
  observer.disconnect();

  // Echo latency, render side: a character arrives, and the clock stops at the second animation frame after it (the first can run before
  // the terminal has drawn). Frame-quantized, so it says "within N frames", not a finer number.
  const echo: number[] = [];
  for (let at = 0; at < samples; at++) {
    await task();
    const t0 = performance.now();
    emulator.echo(`x${at % 10}`);
    await frame();
    await frame();
    echo.push(performance.now() - t0);
  }
  echo.sort((a, b) => a - b);
  longTasks.sort((a, b) => a - b);
  emulator.dispose();
  box.replaceChildren();
  return {
    kind,
    openMs: Math.round(opened * 10) / 10,
    megabytes: Math.round((bytes / 1048576) * 10) / 10,
    seconds: Math.round(seconds * 100) / 100,
    mbPerSecond: Math.round((bytes / 1048576 / seconds) * 10) / 10,
    longTasks: longTasks.length,
    longestTaskMs: Math.round(longTasks.at(-1) ?? 0),
    echoP50: Math.round(quantile(echo, 0.5) * 10) / 10,
    echoP95: Math.round(quantile(echo, 0.95) * 10) / 10,
    echoP99: Math.round(quantile(echo, 0.99) * 10) / 10,
  };
}

declare global {
  interface Window {
    bench: typeof measure;
    ready: boolean;
  }
}
window.bench = measure;
window.ready = true;
