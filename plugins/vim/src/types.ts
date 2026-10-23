export type Region = "sidebar" | "main" | "side";
export type PerfLevel = "" | "paint" | "full";
export type Mode = "insert" | "normal";
export type VisualKind = "" | "char" | "line";

export interface LeaderSpec {
  label: string;
  key: string;
  ctrl?: boolean;
  mac?: boolean;
  show?: string;
}

export interface VimState {
  enabled: boolean; // master switch for every key below
  statusLine: boolean; // the -- NORMAL -- overlay
  composerNormal: boolean; // a normal mode (and visual mode) inside the message box; the page can switch it off
  mode: Mode; // "insert" exactly while an editable has focus (and text mode allows it)
  textMode: Mode; // inside the message box: "insert" or "normal" (only when composerNormal)
  visual: VisualKind; // inside the message box, in text normal mode: "" or "char" (v) or "line" (V)
  region: Region; // "sidebar" | "main" | "side": where j/k act
  count: number; // pending numeric prefix
  operator: string; // pending "g", "z" (outside the message box), "d" (inside it) or "leader" (anywhere)
  prefix: string; // inside the message box: a pending "g", or the f t F T waiting for its character
  leader: string; // a key of LEADERS
  perf: PerfLevel; // the performance trace: "", "paint" or "full" (see perf.ts)
}

// A motion in the message box: run(selection, n, typed, operator) moves the caret; `inclusive` says that a command
// like d takes the character it lands on too; `lines` is a motion to a line, which d does not take.
export interface Motion {
  run: (selection: Selection, n: number, typed?: number, operator?: boolean | string) => void;
  inclusive?: boolean;
  lines?: boolean;
}

// One row of the key list, shown on the Vim mode page and in the help dialog. The third column, where there
// is one, says how the key reaches the app (see NOTES.md).
export type KeyRow = [keys: string, what: string, how?: string];
export interface KeyGroup {
  title: string;
  intro: string;
  rows: KeyRow[];
}
