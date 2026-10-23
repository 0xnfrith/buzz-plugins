// What the page has that the TypeScript DOM library leaves out, and the window globals the plugin leaves for its tests.
export {};

declare global {
  interface Selection {
    // Non-standard, but Blink, WebKit and Gecko all ship it; the plugin's whole caret movement is built on it.
    modify(alter: "move" | "extend", direction: "forward" | "backward", granularity: string): void;
  }
  interface FocusOptions {
    focusVisible?: boolean;
  }
  interface Window {
    // How many revisions of the plugin the page has applied and disposed (see index.ts).
    __vimRevisions?: { applied: number; disposed: number };
    // The performance trace's numbers, while it is on (see perf.ts).
    __vimPerf?: { dump(): unknown; summary(): unknown; reset(): void; level(): string };
  }
  interface Performance {
    memory?: { usedJSHeapSize: number }; // Chromium only
  }
}
