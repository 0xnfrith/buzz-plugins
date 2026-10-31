// The stylesheet against the Megatech design tokens: which colours it may use, where magenta may appear, and that nothing moves at rest.
import test from "node:test";
import assert from "node:assert/strict";
import { CSS } from "../plugin.js";

const withoutKeyframes = CSS.replace(/@keyframes [\w-]+\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, "");
const hexes = (text) => [...new Set((text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((hex) => hex.toLowerCase()))].sort();

test("every colour written in the stylesheet is a design token, a derived light value, or a fallback for a host token", () => {
  const allowed = new Set([
    "#00d4ff", "#4aeaff", "#0099cc", "#ff2bd6", // cyan, cyan-bright, cyan-dim, magenta
    "#12161c", "#e9eef4", "#a7b2be", // gunmetal-deep (the plate), ink, muted
    "#03060a", // under the card's dither
    "#00708f", // derived for the light theme: cyan darkened to 5.6:1 on white
    "#fff", "#1a2026", "#566069", "#d0d7de", // fallbacks for the host's light tokens
    "#2a3a42", "#c2362b", // the Settings card: a border fallback and the error edge
  ]);
  const used = hexes(CSS);
  assert.deepEqual(used.filter((hex) => !allowed.has(hex)), []);
});

test("the old red is gone and magenta is only ever the thin split edge: named once, used inside keyframes only", () => {
  assert.ok(!/ff0033/i.test(CSS));
  assert.equal((CSS.match(/#ff2bd6/gi) ?? []).length, 1);
  assert.equal((CSS.match(/--megatech-skills-magenta:#ff2bd6/g) ?? []).length, 1);
  assert.equal((withoutKeyframes.match(/var\(--megatech-skills-magenta\)/g) ?? []).length, 0, "no fill, border, text or shadow outside the keyframes uses it");
  for (const frame of CSS.match(/@keyframes [\w-]+\{(?:[^{}]*\{[^{}]*\})*\s*\}/g)) {
    for (const shadow of frame.match(/-?\d+px 0 0 (?:var\(--megatech-skills-magenta\)|color-mix\(in srgb,var\(--megatech-skills-magenta\))/g) ?? []) assert.ok(Math.abs(parseInt(shadow, 10)) <= 4, `a split wider than 4px: ${shadow}`);
  }
});

test("corners are square and the glow is the design system's, on dark only", () => {
  assert.ok(!/border-radius:\s*[1-9]/.test(withoutKeyframes.split(".megatech-skills-set")[0]), "the highlight and the card have no rounded corners");
  assert.ok(CSS.includes("--megatech-skills-glow:0 0 0 1px rgba(0,212,255,.12),0 12px 40px rgba(0,0,0,.6),0 0 34px rgba(0,212,255,.12);"));
  assert.ok(/data-color-mode="light"\] \.megatech-skills__card\{[^}]*--megatech-skills-glow:0 0 0 0 transparent/.test(CSS), "no glow in light");
});

test("nothing moves at rest: the highlight has no animation until it is hovered, focused or open", () => {
  const rest = /\.megatech-skills__token\{[^}]*\}/.exec(CSS)[0];
  assert.ok(!/animation/.test(rest));
  assert.ok(!/infinite/.test(CSS));
});

test("the card's name is in the display face in capitals; the status line starts SYS:: in cyan-dim", () => {
  assert.ok(/\.megatech-skills__name\{[^}]*Chakra Petch[^}]*text-transform:uppercase/.test(CSS));
  assert.ok(/\.megatech-skills__lore::before\{content:"SYS:: "\}/.test(CSS));
  assert.ok(/--megatech-skills-status:var\(--megatech-skills-dim\)/.test(CSS));
});

// The layers of every `box-shadow` declared in a piece of CSS, split at the commas that are not inside brackets.
const shadowLayers = (css) =>
  [...css.matchAll(/box-shadow:([^;}]*)/g)].flatMap(([, value]) => {
    const layers = [];
    let depth = 0;
    let from = 0;
    [...value].forEach((char, at) => {
      if (char === "(") depth++;
      else if (char === ")") depth--;
      else if (char === "," && depth === 0) {
        layers.push(value.slice(from, at).trim());
        from = at + 1;
      }
    });
    layers.push(value.slice(from).trim());
    return layers;
  });

test("the highlight's shadows are all inset, so the split and the ring stay inside it, behind its own letters, and never touch the neighbouring words", () => {
  const decloak = CSS.match(/@keyframes megatech-skills-decloak\{(?:[^{}]*\{[^{}]*\})*\s*\}/)[0];
  const tokenRules = [...withoutKeyframes.matchAll(/([^{}]*megatech-skills__token[^{}]*)\{([^{}]*)\}/g)].map((m) => m[2]).join("\n");
  const layers = [...shadowLayers(decloak), ...shadowLayers(tokenRules)];
  assert.ok(layers.length >= 15, `${layers.length} shadow layers read`);
  assert.deepEqual(layers.filter((layer) => !layer.startsWith("inset ")), []);
});
