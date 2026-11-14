// The terminal on screen: ghostty-web (Ghostty's VT parser, compiled to WASM, drawn on a canvas) behind a small interface the sessions use.
import { FitAddon, Ghostty, Terminal } from "ghostty-web";
import wasmDataUrl from "ghostty-web/ghostty-vt.wasm?inline";
import { fromBase64 } from "./protocol";

export type Screen = {
  /** Shows the terminal in `container`; the same terminal, with its scrollback and cursor, can be attached again after a detach. */
  attach(container: HTMLElement): void;
  detach(): void;
  write(bytes: Uint8Array): void;
  size(): { cols: number; rows: number };
  dispose(): void;
};

export type Handlers = {
  /** What the person typed or pasted, and what the terminal itself answers (see test/unit/replies.test.ts). */
  onInput(text: string): void;
  onResize(cols: number, rows: number): void;
};

const THEME = { background: "#0d1117", foreground: "#e6edf3", cursor: "#e6edf3", selectionBackground: "#264f78" };
const FONT = 'ui-monospace, Menlo, "SF Mono", Consolas, "DejaVu Sans Mono", monospace';

let ghostty: Promise<Ghostty> | undefined;

/**
 * Compiles the WASM once, on first use and not while the plugin activates (that has 10 s). A plugin is one file, so the WASM is inlined as
 * a data: URL; its bytes are decoded here and not fetched, because Buzz's content security policy has no `data:` in `connect-src`. The
 * module has one import, `env.log`, which ghostty-web's own loader fills the same way; nothing the terminal prints is logged.
 */
export function loadGhostty(): Promise<Ghostty> {
  ghostty ??= (async () => {
    const bytes = fromBase64(wasmDataUrl.slice(wasmDataUrl.indexOf(",") + 1));
    const module = await WebAssembly.compile(bytes as BufferSource);
    return new Ghostty(await WebAssembly.instantiate(module, { env: { log: () => {} } }));
  })();
  ghostty.catch(() => (ghostty = undefined)); // a failed load can be tried again
  return ghostty;
}

export async function createScreen(handlers: Handlers): Promise<Screen> {
  const host = document.createElement("div");
  host.style.cssText = "width:100%;height:100%;overflow:hidden;";
  const terminal = new Terminal({
    ghostty: await loadGhostty(),
    fontSize: 13,
    fontFamily: FONT,
    cursorBlink: true,
    scrollback: 5000, // the same bound as Buzz's own Terminal
    theme: THEME,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host);
  terminal.onData(handlers.onInput);
  terminal.onResize(({ cols, rows }) => handlers.onResize(cols, rows));

  // Links are not opened. ghostty-web opens a Ctrl- or Cmd-clicked link with window.open, whatever its scheme, and the program that
  // printed the link chose it. A capture listener on the way down stops the click before the terminal sees it.
  host.addEventListener("click", (event) => (event.ctrlKey || event.metaKey) && event.stopPropagation(), true);

  const observer = new ResizeObserver(() => fit.fit());
  return {
    attach(container) {
      container.appendChild(host);
      observer.observe(host);
      fit.fit();
      terminal.focus();
    },
    detach() {
      observer.disconnect();
      host.remove();
    },
    write: (bytes) => terminal.write(bytes),
    size: () => ({ cols: terminal.cols, rows: terminal.rows }),
    dispose() {
      observer.disconnect();
      terminal.dispose();
      host.remove();
    },
  };
}
