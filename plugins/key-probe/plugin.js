// A measuring probe, not a feature. For every key it records the time from the keydown reaching the window to the
// frame after it (a message posted after requestAnimationFrame arrives once that frame is on screen), the same
// number the Vim plugin's "Key to paint" trace reports, but taken by a separate plugin so it works with the Vim
// plugin switched off or replaced, and does not change when Vim mode is refactored.
//   Ctrl+Alt+Shift+D  copies what was recorded as JSON to the clipboard
//   Ctrl+Alt+Shift+X  starts over
// It reads no page content, keeps at most 5000 keys, and sends and writes nothing.
export const inject = [];

export function apply(ctx) {
  ctx.effect(() => {
    const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);
    const RING = 5000;
    const round = (x) => Math.round(x * 100) / 100;
    let samples = [];
    const copy = (text) => {
      const box = document.createElement("textarea");
      box.value = text;
      Object.assign(box.style, { position: "fixed", left: "-9999px", top: "0" });
      document.body.append(box);
      const was = document.activeElement;
      box.select();
      try {
        document.execCommand("copy");
      } catch {}
      box.remove();
      was?.focus?.({ preventScroll: true });
    };
    const onKey = (event) => {
      if (event.ctrlKey && event.altKey && event.shiftKey && (event.code === "KeyD" || event.code === "KeyX")) {
        if (event.code === "KeyD") copy(JSON.stringify({ at: new Date().toISOString(), agent: navigator.userAgent, samples }));
        else samples = [];
        return;
      }
      if (MODIFIERS.has(event.key)) return;
      const t0 = performance.now();
      window.requestAnimationFrame(() => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          samples.push([event.key, round(performance.now() - t0)]);
          if (samples.length > RING) samples.shift();
          channel.port1.close();
        };
        channel.port2.postMessage(0);
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
}
