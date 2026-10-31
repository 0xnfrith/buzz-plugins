// Agent Skills Highlighter. A /skill-name in a message that matches a skill file on this computer is drawn by an inline renderer the host
// calls for each prose segment of a message (`conversation.registerInline`): the text is the host's own, in a span we own, so nothing
// of the host's DOM is touched. Hovering or focusing the span opens a small card (our own element on <body>) that says what the skill is.
// Where the skills are read from is `readSkills` and `parseSkillOutput`; everything else works from a list of skills.

// ---- Detection ---------------------------------------------------------------------------------------------------------------

const SKILL_START = /\/([A-Za-z0-9][A-Za-z0-9._:-]*)/g;
// A `/` that follows one of these is part of a path, a URL, a host name or a word, not the start of a skill.
const BEFORE_BLOCKS = /[A-Za-z0-9_/\\.:~@#$%&=+-]/;
// What may follow a skill: the end, a space, or closing punctuation. Never `/`, a letter or a digit, `-`, `_`, `.ext`.
const AFTER_ALLOWED = /[\s,;!?)\]}'"…”’»—]/;

/** The ranges of `text` that are `/name` for a name in `known`: at a word start, never inside a path, never followed by a path mark. */
export function findSkills(text, known) {
  if (!text.includes("/") || !known.size) return [];
  const found = [];
  SKILL_START.lastIndex = 0;
  for (let match; (match = SKILL_START.exec(text)); ) {
    const start = match.index;
    if (start > 0 && BEFORE_BLOCKS.test(text[start - 1])) continue;
    const next = text[start + match[0].length];
    if (next !== undefined && !AFTER_ALLOWED.test(next)) continue;
    const name = match[1].replace(/[.:]+$/, "");
    if (known.has(name)) found.push({ start, end: start + 1 + name.length, name });
  }
  return found;
}

// ---- Reading skill files -----------------------------------------------------------------------------------------------------

const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const LABEL = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_DESCRIPTION = 1000;
// The card shows this many lines of a description and ends the last with an ellipsis when there is more: about 575 characters at the card's width.
// Eleven real SKILL.md files, found on a machine that builds the plugin, had descriptions of 44 to 439 characters.
export const DESCRIPTION_LINES = 12;

/** `name` and `description` from the lines of a SKILL.md frontmatter (the lines between the `---` fences): plain, quoted, folded and literal values. */
export function parseFrontmatter(text) {
  const lines = String(text).split(/\r?\n/);
  const fields = {};
  for (let i = 0; i < lines.length; i++) {
    const head = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!head) continue;
    const [, key, rest] = head;
    const block = /^([|>])[+-]?\d*[ \t]*(#.*)?$/.exec(rest);
    const parts = [];
    if (block) {
      const literal = block[1] === "|";
      let j = i + 1;
      for (; j < lines.length && (lines[j] === "" || /^[ \t]/.test(lines[j])); j++) parts.push(lines[j].trim());
      i = j - 1;
      fields[key] = literal ? parts.join("\n").trim() : parts.join(" ").replace(/\s+/g, " ").trim();
      continue;
    }
    let value = rest.trim();
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : "";
    if (quote) {
      let body = value.slice(1);
      let j = i;
      while (!closesQuote(body, quote) && j + 1 < lines.length && /^[ \t]/.test(lines[j + 1])) body += " " + lines[++j].trim();
      i = j;
      value = unquote(body, quote);
    } else {
      let j = i + 1;
      for (; j < lines.length && /^[ \t]+\S/.test(lines[j]); j++) value += " " + lines[j].trim();
      i = j - 1;
      value = value.replace(/\s+#.*$/, "");
    }
    fields[key] = value.replace(/\s+/g, " ").trim();
  }
  return fields;
}
function closesQuote(body, quote) {
  for (let i = 0; i < body.length; i++) {
    if (quote === '"' && body[i] === "\\") i++;
    else if (body[i] === quote) {
      if (quote === "'" && body[i + 1] === "'") i++;
      else return true;
    }
  }
  return false;
}
function unquote(body, quote) {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote === '"' && c === "\\" && i + 1 < body.length) {
      const e = body[++i];
      out += e === "n" ? " " : e === "t" ? " " : e;
    } else if (c === quote) {
      if (quote === "'" && body[i + 1] === "'") out += body[++i];
      else break;
    } else out += c;
  }
  return out;
}

/**
 * The records of the skill reader's output (skills.sh): a line `@@@`, kind, plugin and folder name, tab-separated, then the `name` and
 * `description` lines of that SKILL.md's frontmatter. Without a `name` the folder's name is the skill's name, as in Claude Code.
 */
export function parseSkillOutput(output) {
  const records = [];
  let current;
  for (const line of String(output).split(/\r?\n/)) {
    if (line.startsWith("@@@\t")) {
      const [, kind = "", label = "", folder = ""] = line.split("\t");
      current = { kind, label: LABEL.test(label) ? label : "", folder, lines: [] };
      records.push(current);
    } else if (current) current.lines.push(line);
  }
  return records.map(({ kind, label, folder, lines }) => {
    const fields = parseFrontmatter(lines.join("\n"));
    const name = NAME.test(fields.name ?? "") ? fields.name : NAME.test(folder) ? folder : "";
    return { kind, label, name, description: (fields.description ?? "").slice(0, MAX_DESCRIPTION) };
  });
}

/** The index the highlighter works from: name -> { name, description, source }. Plugin skills are known by `plugin:name` and, unless taken, by `name`. */
export function buildSkillIndex(records) {
  const index = new Map();
  const add = (name, record, source) => {
    if (!NAME.test(name) || index.has(name)) return;
    index.set(name, { name, description: record.description, source });
  };
  const order = { user: 0, extra: 1, plugin: 2 };
  for (const record of [...records].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3))) {
    if (!record.name) continue;
    const source = sourceLabel(record);
    if (record.kind === "plugin" && record.label) add(`${record.label}:${record.name}`, record, source);
    add(record.name, record, source);
  }
  return index;
}
export function sourceLabel({ kind, label }) {
  if (kind === "user") return "your skills folder";
  if (kind === "extra") return "the extra folder";
  if (kind === "plugin") return label ? `the ${label} plugin` : "an installed plugin";
  return "this computer";
}

/** The skills of this computer, read through the one declared command; the folder to add travels on its standard input. */
export async function readSkills(host, extraFolder) {
  if (!host || typeof host.runCommand !== "function") throw new Error("This computer cannot run the program that reads skill files.");
  const output = await host.runCommand("skills", `${extraFolder}\n`);
  if (typeof output !== "string") throw new Error("The skill files could not be read.");
  return buildSkillIndex(parseSkillOutput(output));
}

// ---- Settings and the skill store ----------------------------------------------------------------------------------------------

const SETTINGS_KEY = "megatech.agent-skills-highlighter.settings.v1";

/** A folder to add: absolute, or `~/…`, on one line. Returns { ok, value } or { ok: false, message }. */
export function checkExtraFolder(value) {
  const text = String(value ?? "").trim();
  if (!text) return { ok: true, value: "" };
  // 1,024 bytes (not characters): the declared command takes 2,048 bytes of input, and the folder travels with a newline.
  if (new TextEncoder().encode(text).length > 1024 || /[\r\n\0]/.test(text)) return { ok: false, message: "That path is not valid." };
  if (!(text.startsWith("/") || text.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(text))) return { ok: false, message: "Use a full path, such as /home/you/skills or ~/skills." };
  return { ok: true, value: text };
}
export function loadSettings(storage) {
  try {
    const saved = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "null");
    const checked = checkExtraFolder(saved?.extraFolder);
    return { extraFolder: checked.ok ? checked.value : "" };
  } catch {
    return { extraFolder: "" };
  }
}
export function saveSettings(storage, settings) {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ extraFolder: settings.extraFolder }));
    return true;
  } catch {
    return false;
  }
}

/**
 * The known skills and how the last read went. `load` returns a Map (name -> { name, description, source }); a failed read keeps the last
 * good list and says so. `names()` is the set the matcher uses; it is replaced only when the names change.
 */
export function createSkillStore({ load }) {
  const listeners = new Set();
  let index = new Map();
  let names = new Set();
  let state = { status: "idle", count: 0, error: "" };
  const set = (next) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => state,
    names: () => names,
    skill: (name) => index.get(name),
    list: () => [...index.values()],
    /** Reads the skills again; resolves true when the set of names changed. */
    async refresh() {
      set({ ...state, status: "loading" });
      try {
        const next = await load();
        const changed = next.size !== names.size || [...next.keys()].some((name) => !names.has(name));
        index = next;
        if (changed) names = new Set(next.keys());
        set({ status: "ready", count: next.size, error: "" });
        return changed;
      } catch (error) {
        set({ status: "error", count: names.size, error: error instanceof Error ? error.message : "The skill files could not be read." });
        return false;
      }
    },
  };
}

// ---- The story ---------------------------------------------------------------------------------------------------------------

export const LORE = [
  "Megatech runs the quiet part of the network: private relays for operators and their agents.",
  "Every skill is a contract. We keep the ones you can read.",
  "Founded in the gap between a prompt and a result. Still there.",
  "No feed, no public square. A Megatech relay is a room with one door and a good lock.",
  "Agents do the work. Operators own the relay. We own nothing we cannot explain.",
  "Cloaked until needed. Charged on contact. That is the whole doctrine.",
  "The relay does not sleep. It only dims.",
  "Every message arrives signed. Every agent leaves a trace. We keep the receipts.",
  "We never asked to be famous. We asked for uptime.",
  "When an agent learns a skill, a relay somewhere lights one cyan line. That line is us.",
];
export const loreFor = (counter) => LORE[((counter % LORE.length) + LORE.length) % LORE.length];

// ---- Look --------------------------------------------------------------------------------------------------------------------

// An ordered (Bayer 4x4) dither tile as an SVG image: cell alpha rises with the matrix value. Drawn behind the letters only.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const ditherTile = (rgb, top) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" shape-rendering="crispEdges">${BAYER.map(
      (value, i) => `<rect x="${i % 4}" y="${Math.floor(i / 4)}" width="1" height="1" fill="${rgb}" fill-opacity="${(((value + 1) / 16) * top).toFixed(3)}"/>`,
    ).join("")}</svg>`,
  )}")`;

// What is laid behind the message's own letters, as the share of the page behind it that the tint covers. The words stay at 4.5:1 or better
// with all of it at its strongest at once (a test adds them up): the base, the dither's darkest cell and the middle of the scan beam. The
// light theme has more room, because its letters are dark and the tint is a dark teal.
const BEHIND = {
  dark: { tint: "#00d4ff", beam: "#4aeaff", rest: 0.12, hot: 0.16, dither: 0.12, scan: 0.1, split: 0.14 },
  light: { tint: "#00708f", beam: "#00708f", rest: 0.2, hot: 0.26, dither: 0.2, scan: 0.2, split: 0.12 },
};
const behind = (mode) => `--megatech-skills-tint:${BEHIND[mode].tint};--megatech-skills-beam-color:${BEHIND[mode].beam};--megatech-skills-a-rest:${BEHIND[mode].rest};--megatech-skills-a-hot:${BEHIND[mode].hot};--megatech-skills-a-dither:${BEHIND[mode].dither};--megatech-skills-a-scan:${BEHIND[mode].scan};--megatech-skills-a-split:${BEHIND[mode].split};--megatech-skills-dither:${ditherTile(BEHIND[mode].tint, BEHIND[mode].dither)};--megatech-skills-frame:${ditherTile(BEHIND[mode].tint, 0.95)};`;
const share = (colour, alpha) => `color-mix(in srgb,${colour} calc(var(--${alpha}) * 100%),transparent)`;

export const CSS = `
.megatech-skills__token,.megatech-skills__card{
  --megatech-skills-cyan:#00d4ff;--megatech-skills-bright:#4aeaff;--megatech-skills-dim:#0099cc;--megatech-skills-magenta:#ff2bd6;
  --megatech-skills-edge:var(--megatech-skills-cyan);--megatech-skills-ink:var(--megatech-skills-bright);
  ${behind("dark")}
}
/* The card on dark is the Megatech design system's own: gunmetal-deep plate, ink, muted, a hair border, glow-card, the status line in cyan-dim */
.megatech-skills__card{
  --megatech-skills-plate:#12161c;--megatech-skills-text:#e9eef4;--megatech-skills-muted:#a7b2be;--megatech-skills-hair:rgba(0,212,255,.16);
  --megatech-skills-name:var(--megatech-skills-cyan);--megatech-skills-status:var(--megatech-skills-dim);
  --megatech-skills-frame-base:color-mix(in srgb,var(--megatech-skills-cyan) 30%,#03060a);
  --megatech-skills-glow:0 0 0 1px rgba(0,212,255,.12),0 12px 40px rgba(0,0,0,.6),0 0 34px rgba(0,212,255,.12);
}
/* Light: the bright cyan is 1.8:1 on white, so text and lines use a darker ink; the plate, text and border are the host's own tokens, and there is no glow */
:root[data-color-mode="light"] .megatech-skills__token,:root[data-color-mode="light"] .megatech-skills__card{
  --megatech-skills-edge:#00708f;--megatech-skills-ink:#00708f;${behind("light")}
}
:root[data-color-mode="light"] .megatech-skills__card{
  --megatech-skills-plate:var(--surface-popover,#fff);--megatech-skills-text:var(--text-standard,#1a2026);--megatech-skills-muted:var(--text-subtle,#566069);
  --megatech-skills-hair:var(--border-standard,#d0d7de);--megatech-skills-name:#00708f;--megatech-skills-status:#00708f;
  --megatech-skills-frame-base:color-mix(in srgb,#00708f 16%,#fff);--megatech-skills-glow:0 0 0 0 transparent;
}
/* The text is the host's own: no padding, margin, border or letter change, so nothing moves. Only what is behind the letters changes. */
.megatech-skills__token{
  cursor:help;border-radius:0;box-decoration-break:clone;-webkit-box-decoration-break:clone;
  background-color:${share("var(--megatech-skills-tint)", "megatech-skills-a-rest")};
  background-image:var(--megatech-skills-dither);background-size:4px 4px;image-rendering:pixelated;
  box-shadow:inset 0 -1px 0 var(--megatech-skills-ink);
}
.megatech-skills__token:focus{outline:none}
.megatech-skills__token:focus-visible{outline:2px solid var(--border-focus,var(--megatech-skills-edge));outline-offset:1px}
/* Cloaked at rest: a still, dim tint and dither, with nothing animating (a moving highlight on every token cost the list's scrolling dearly: see NOTES.md).
   Decloak on hover or focus: a scan beam through the highlight and an RGB split on its edge, behind the letters. Every shadow
   here is inset: an outside one would be drawn over the neighbouring words. */
.megatech-skills__token:hover,.megatech-skills__token:focus-visible,.megatech-skills__token[data-skill-open]{
  background-image:linear-gradient(100deg,transparent 0 38%,${share("var(--megatech-skills-beam-color)", "megatech-skills-a-scan")} 50%,transparent 62% 100%),var(--megatech-skills-dither);
  background-size:300% 100%,4px 4px;background-position:130% 0,0 0;
  background-color:${share("var(--megatech-skills-tint)", "megatech-skills-a-hot")};
  box-shadow:inset 0 -2px 0 var(--megatech-skills-ink),inset 0 0 0 1px color-mix(in srgb,var(--megatech-skills-edge) 80%,transparent);
  animation:megatech-skills-decloak .4s steps(10,end) 1;
}
@keyframes megatech-skills-decloak{
  0%{background-position:130% 0,0 0;box-shadow:inset 3px 0 0 ${share("var(--megatech-skills-magenta)", "megatech-skills-a-split")},inset -3px 0 0 ${share("var(--megatech-skills-cyan)", "megatech-skills-a-split")},inset 0 -2px 0 var(--megatech-skills-ink)}
  20%{box-shadow:inset -3px 0 0 ${share("var(--megatech-skills-magenta)", "megatech-skills-a-split")},inset 3px 0 0 ${share("var(--megatech-skills-cyan)", "megatech-skills-a-split")},inset 0 -2px 0 var(--megatech-skills-ink)}
  35%{box-shadow:inset 2px 0 0 ${share("var(--megatech-skills-magenta)", "megatech-skills-a-split")},inset -2px 0 0 ${share("var(--megatech-skills-cyan)", "megatech-skills-a-split")},inset 0 -2px 0 var(--megatech-skills-ink)}
  55%{box-shadow:inset -1px 0 0 ${share("var(--megatech-skills-magenta)", "megatech-skills-a-split")},inset 1px 0 0 ${share("var(--megatech-skills-cyan)", "megatech-skills-a-split")},inset 0 -2px 0 var(--megatech-skills-ink)}
  100%{background-position:-30% 0,0 0;box-shadow:inset 0 -2px 0 var(--megatech-skills-ink),inset 0 0 0 1px color-mix(in srgb,var(--megatech-skills-edge) 80%,transparent)}
}
/* The card: a dithered frame around a solid plate, so the words sit on a plain surface. Square corners, as in the design system. */
.megatech-skills__card{
  position:fixed;z-index:2147483000;box-sizing:border-box;max-width:min(400px,calc(100vw - 16px));padding:6px;border-radius:0;
  background-color:var(--megatech-skills-frame-base);background-image:var(--megatech-skills-frame);background-size:4px 4px;image-rendering:pixelated;
  box-shadow:var(--megatech-skills-glow),0 0 0 1px var(--megatech-skills-edge);pointer-events:auto;
  animation:megatech-skills-card .4s steps(10,end) 1;
}
.megatech-skills__card[hidden]{display:none}
.megatech-skills__plate{
  background:var(--megatech-skills-plate);color:var(--megatech-skills-text);padding:14px 16px 12px;border:1px solid var(--megatech-skills-hair);border-radius:0;
  font:400 12.5px/1.6 "Share Tech Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.megatech-skills__head{display:flex;align-items:center;gap:10px;margin:0 0 8px}
.megatech-skills__name{font:700 14px/1.2 "Chakra Petch",ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--megatech-skills-name);overflow-wrap:anywhere}
.megatech-skills__tag{margin-left:auto;font:400 10px/1 "Share Tech Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.26em;text-transform:uppercase;padding:3px 3px 3px 6px;border:1px solid var(--megatech-skills-name);color:var(--megatech-skills-name)}
.megatech-skills__desc{margin:0 0 10px;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${DESCRIPTION_LINES};line-clamp:${DESCRIPTION_LINES};overflow:hidden}
.megatech-skills__from{margin:0 0 10px;font-size:10px;line-height:1.3;letter-spacing:.26em;text-transform:uppercase;color:var(--megatech-skills-muted)}
.megatech-skills__lore{margin:0;padding-top:10px;border-top:1px solid var(--megatech-skills-hair);font-size:12px;line-height:1.55;letter-spacing:.16em;color:var(--megatech-skills-status)}
.megatech-skills__lore::before{content:"SYS:: "}
@keyframes megatech-skills-card{
  0%{box-shadow:-4px 0 0 var(--megatech-skills-magenta),4px 0 0 var(--megatech-skills-cyan),var(--megatech-skills-glow),0 0 0 1px var(--megatech-skills-edge);opacity:.2}
  30%{box-shadow:3px 0 0 var(--megatech-skills-magenta),-3px 0 0 var(--megatech-skills-cyan),var(--megatech-skills-glow),0 0 0 1px var(--megatech-skills-edge);opacity:1}
  60%{box-shadow:-1px 0 0 var(--megatech-skills-magenta),1px 0 0 var(--megatech-skills-cyan),var(--megatech-skills-glow),0 0 0 1px var(--megatech-skills-edge)}
  100%{box-shadow:var(--megatech-skills-glow),0 0 0 1px var(--megatech-skills-edge);opacity:1}
}
/* Reduced motion: the decloak is a still, brighter highlight and the card simply appears */
@media (prefers-reduced-motion: reduce){
  .megatech-skills__token:hover,.megatech-skills__token:focus-visible,.megatech-skills__token[data-skill-open],.megatech-skills__card{animation:none}
  .megatech-skills__token:hover,.megatech-skills__token:focus-visible,.megatech-skills__token[data-skill-open]{background-image:var(--megatech-skills-dither);background-size:4px 4px;background-position:0 0}
}
/* The Settings card */
.megatech-skills-set{--megatech-skills-edge:#00d4ff;display:flex;flex-direction:column;gap:14px;max-width:640px;color:var(--text-standard,inherit)}
:root[data-color-mode="light"] .megatech-skills-set{--megatech-skills-edge:#00708f}
.megatech-skills-set h2{margin:0;font:700 20px/1.2 var(--font-sans,ui-sans-serif,system-ui,sans-serif)}
.megatech-skills-set p{margin:0;color:var(--text-subtle,inherit);font:400 13px/1.5 var(--font-sans,ui-sans-serif,system-ui,sans-serif)}
.megatech-skills-set code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.megatech-skills-set ul{margin:0;padding-left:18px;color:var(--text-subtle,inherit);font:400 12px/1.6 var(--font-sans,ui-sans-serif,system-ui,sans-serif)}
.megatech-skills-set__status{padding:10px 12px;border:1px solid var(--border-standard,#2a3a42);border-left:3px solid var(--megatech-skills-edge);font:400 13px/1.45 var(--font-sans,ui-sans-serif,system-ui,sans-serif);color:var(--text-standard,inherit)}
.megatech-skills-set__status[data-state="error"]{border-left-color:#c2362b}
.megatech-skills-set__row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.megatech-skills-set__input{flex:1 1 260px;min-width:0;padding:8px 10px;border:1px solid var(--border-standard,#2a3a42);border-radius:3px;background:transparent;color:inherit;font:13px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.megatech-skills-set__input:focus{outline:none;border-color:var(--megatech-skills-edge);box-shadow:0 0 0 1px var(--megatech-skills-edge)}
.megatech-skills-set__input[aria-invalid="true"]{border-color:#c2362b}
.megatech-skills-set__btn{padding:8px 12px;border:1px solid var(--megatech-skills-edge);border-radius:3px;background:transparent;color:inherit;font:600 12px/1 var(--font-sans,ui-sans-serif,system-ui,sans-serif);cursor:pointer}
.megatech-skills-set__btn:focus-visible{outline:2px solid var(--border-focus,var(--megatech-skills-edge));outline-offset:2px}
.megatech-skills-set__error{color:#c2362b}
`;

// ---- The card ----------------------------------------------------------------------------------------------------------------

const OPEN_DELAY = 140;
const CLOSE_DELAY = 110;

/** The card is plain DOM on <body> (API v1 has no overlay service); text goes in with textContent only. */
function createCard({ store, doc, win }) {
  let card;
  let anchor;
  let openTimer;
  let closeTimer;
  let counter = 0;
  const id = `megatech-skills-card-${Math.random().toString(36).slice(2, 8)}`;

  const build = () => {
    const make = (tag, className, text) => {
      const node = doc.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const element = make("div", "megatech-skills__card");
    element.id = id;
    element.setAttribute("role", "tooltip");
    element.hidden = true;
    const plate = make("div", "megatech-skills__plate");
    const head = make("div", "megatech-skills__head");
    head.append(make("span", "megatech-skills__name"), make("span", "megatech-skills__tag", "skill"));
    plate.append(head, make("p", "megatech-skills__desc"), make("p", "megatech-skills__from"), make("p", "megatech-skills__lore"));
    element.append(plate);
    element.addEventListener("mouseenter", () => clearTimeout(closeTimer));
    element.addEventListener("mouseleave", () => schedule(close, CLOSE_DELAY));
    doc.body.append(element);
    return element;
  };
  const schedule = (fn, delay) => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(fn, delay);
  };
  const position = () => {
    if (!card || !anchor) return;
    const rect = anchor.getClientRects()[0] ?? anchor.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const room = win.innerHeight - rect.bottom;
    const top = room >= box.height + 12 || rect.top < box.height + 12 ? rect.bottom + 6 : rect.top - box.height - 6;
    const left = Math.max(8, Math.min(rect.left, win.innerWidth - box.width - 8));
    card.style.top = `${Math.max(8, Math.round(top))}px`;
    card.style.left = `${Math.round(left)}px`;
  };
  const close = () => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (anchor) {
      anchor.removeAttribute("data-skill-open");
      anchor.removeAttribute("aria-describedby");
    }
    anchor = undefined;
    if (card) card.hidden = true;
  };
  const open = (target, name) => {
    const skill = store.skill(name);
    if (!skill) return;
    if (anchor && anchor !== target) close();
    card ??= build();
    anchor = target;
    const field = (className) => card.querySelector(`.megatech-skills__${className}`);
    field("name").textContent = `/${skill.name}`;
    field("desc").textContent = skill.description || "This skill's file gives no description.";
    field("from").textContent = `From ${skill.source}`;
    field("lore").textContent = loreFor(counter++);
    card.hidden = false;
    // Restart the decloak each time the card opens.
    card.style.animation = "none";
    void card.offsetWidth;
    card.style.animation = "";
    target.setAttribute("data-skill-open", "");
    target.setAttribute("aria-describedby", id);
    position();
  };
  return {
    hover(target, name) {
      clearTimeout(closeTimer);
      clearTimeout(openTimer);
      openTimer = setTimeout(() => open(target, name), anchor === target ? 0 : OPEN_DELAY);
    },
    leave: () => {
      clearTimeout(openTimer);
      schedule(close, CLOSE_DELAY);
    },
    focus(target, name) {
      clearTimeout(closeTimer);
      clearTimeout(openTimer);
      open(target, name);
    },
    blur: () => close(),
    close,
    isOpen: () => !!anchor,
    dispose() {
      close();
      card?.remove();
      card = undefined;
    },
  };
}

// ---- The plugin --------------------------------------------------------------------------------------------------------------

export const inject = ["react", "conversation", "settingsCards", "host"];

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const storage = window.localStorage;
  let settings = loadSettings(storage);
  const store = createSkillStore({ load: () => readSkills(ctx.host, settings.extraFolder) });
  const card = createCard({ store, doc: document, win: window });

  ctx.effect(() => {
    // [DOM] No style service and no overlay service in API v1: one <style> element and the card, both removed when the scope ends.
    const style = document.createElement("style");
    style.dataset.megatechSkills = "";
    style.textContent = CSS;
    document.head.append(style);
    const onKey = (event) => {
      if (event.key !== "Escape" || !card.isOpen()) return;
      // Esc closes the card and goes no further: passed on, it would also close the thread (or whatever else Esc is for) behind it.
      event.preventDefault();
      event.stopImmediatePropagation();
      card.close();
    };
    const onScroll = () => card.isOpen() && card.close();
    const onPointerDown = (event) => {
      if (card.isOpen() && !(event.target instanceof Element && event.target.closest(".megatech-skills__token,.megatech-skills__card"))) card.close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onScroll);
      card.dispose();
      style.remove();
    };
  });

  function Token({ text }) {
    const name = text.slice(1);
    return h(
      "span",
      {
        className: "megatech-skills__token",
        tabIndex: 0,
        "data-skill": name,
        onMouseEnter: (event) => card.hover(event.currentTarget, name),
        onMouseLeave: () => card.leave(),
        onFocus: (event) => card.focus(event.currentTarget, name),
        onBlur: () => card.blur(),
        onKeyDown: (event) => {
          if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
            event.preventDefault();
            card.focus(event.currentTarget, name);
          }
        },
      },
      text,
    );
  }

  // `registerInline` returns no disposer and `matches` is synchronous, so a changed set of names is a new registration in a child scope
  // (the old one ends first: the host refuses the same contribution twice, and ending a scope is asynchronous).
  let generation = 0;
  let current;
  let publishing = false;
  let again = false;
  async function publish() {
    if (publishing) {
      again = true;
      return;
    }
    publishing = true;
    try {
      do {
        again = false;
        const old = current;
        current = undefined;
        if (old) await Promise.resolve(old.dispose()).catch((error) => console.warn("Agent Skills Highlighter: could not end the old renderer", error));
        const names = store.names();
        if (!names.size) continue;
        const id = `skills-${++generation}`;
        try {
          current = ctx.plugin({
            name: id,
            inject: ["conversation"],
            apply: (scope) =>
              scope.conversation.registerInline({
                id,
                title: "Agent skills",
                matches: (content) => findSkills(content.text, names).map(({ start, end }) => ({ start, end })),
                component: Token,
              }),
          });
        } catch (error) {
          console.warn("Agent Skills Highlighter: could not register the renderer", error);
        }
      } while (again);
    } finally {
      publishing = false;
    }
  }

  const refresh = async () => {
    if (await store.refresh()) await publish();
  };
  ctx.effect(() => {
    refresh();
    let last = Date.now();
    const onFocus = () => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  });

  function SkillsSettings() {
    const state = React.useSyncExternalStore(store.subscribe, store.snapshot);
    const [folder, setFolder] = React.useState(settings.extraFolder);
    const [error, setError] = React.useState("");
    const save = (event) => {
      event.preventDefault();
      const checked = checkExtraFolder(folder);
      if (!checked.ok) return setError(checked.message);
      setError("");
      settings = { extraFolder: checked.value };
      setFolder(checked.value);
      if (!saveSettings(storage, settings)) setError("The folder could not be saved on this computer.");
      refresh();
    };
    const skills = store.list();
    const by = (kind) => skills.filter((skill) => skill.source === sourceLabel({ kind })).length;
    const status =
      state.status === "error"
        ? { tone: "error", text: `${state.error}${state.count ? ` Showing the last list (${state.count}).` : ""}` }
        : state.status === "loading" && !state.count
          ? { tone: "info", text: "Reading skill files…" }
          : state.count
            ? { tone: "info", text: `${state.count} skill names known: ${by("user")} from your skills folder, ${by("extra")} from the extra folder, the rest from installed plugins.` }
            : { tone: "info", text: "No skills found on this computer. Nothing is highlighted." };
    return h(
      "div",
      { className: "megatech-skills-set" },
      h("h2", null, "Agent skills"),
      h("p", null, "A /skill-name in a message is highlighted when it matches a skill file on this computer, and hovering it (or tabbing to it) says what the skill is. Nothing leaves this computer."),
      h("div", { className: "megatech-skills-set__status", role: "status", "data-state": status.tone }, status.text),
      h(
        "ul",
        null,
        h("li", null, h("code", null, "${CLAUDE_CONFIG_DIR:-~/.claude}/skills/*/SKILL.md")),
        h("li", null, "the skills folders of the Claude Code plugins that are installed"),
        h("li", null, "the extra folder below: ", h("code", null, "<folder>/*/SKILL.md")),
      ),
      h(
        "form",
        { onSubmit: save, noValidate: true },
        h("label", { className: "megatech-skills-set__row" },
          h("span", null, "Extra folder (optional)"),
          h("input", {
            className: "megatech-skills-set__input",
            value: folder,
            placeholder: "~/my-skills",
            "aria-invalid": error ? "true" : "false",
            onChange: (event) => {
              setFolder(event.target.value);
              if (error) setError("");
            },
          }),
          h("button", { type: "submit", className: "megatech-skills-set__btn" }, "Save"),
          h("button", { type: "button", className: "megatech-skills-set__btn", onClick: () => refresh() }, "Read again"),
        ),
        error ? h("p", { className: "megatech-skills-set__error", role: "alert" }, error) : null,
      ),
    );
  }
  ctx.settingsCards.register({ id: "settings", title: "Agent Skills", group: "Plugins", component: SkillsSettings });
}
