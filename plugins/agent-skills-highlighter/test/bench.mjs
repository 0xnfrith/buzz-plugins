// A micro-benchmark of the matcher the host calls for every prose segment of every message it draws: `node test/bench.mjs`.
// It reports microseconds per call for the common case (a segment with no slash), a slash that is not a skill, and a segment with
// skills in it, against a known set of 300 names, over 10,000 messages of a few lengths.
import { findSkills } from "../plugin.js";

const known = new Set(Array.from({ length: 300 }, (_, i) => `skill-${i}`).concat(["brainstorming", "plan-review", "deploy"]));
const words = "the relay restarted at noon and the agents picked up where they left off while the operators watched the queue drain".split(" ");
const sentence = (n, seed) => Array.from({ length: n }, (_, i) => words[(i * 7 + seed) % words.length]).join(" ");
const make = (kind, i) => {
  const base = sentence(12 + (i % 40), i);
  if (kind === "plain") return base;
  if (kind === "slash") return `${base} see /usr/local/bin/tool and https://example.com/a/b/c then /nothing-here ${sentence(6, i)}`;
  return `${sentence(6, i)} /brainstorming then /plan-review and (/deploy). ${base}`;
};
const N = 10_000;
for (const kind of ["plain", "slash", "skills"]) {
  const texts = Array.from({ length: N }, (_, i) => make(kind, i));
  let found = 0;
  for (let i = 0; i < 2000; i++) found += findSkills(texts[i], known).length; // warm up
  const start = performance.now();
  for (const text of texts) found += findSkills(text, known).length;
  const total = performance.now() - start;
  const chars = texts.reduce((sum, text) => sum + text.length, 0);
  console.log(`${kind.padEnd(7)} ${((total / N) * 1000).toFixed(2)} us per call, ${(chars / N).toFixed(0)} chars on average, ${found} ranges found`);
}
