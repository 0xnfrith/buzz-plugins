// The words each declared process fixes, read from manifest.json itself, so the code and the install review cannot differ. The host starts a
// declared process as its `program` (`docker`), then these words, then the arguments the plugin passes when it asks, and nothing else:
// the review lists exactly these verbs, with as many leading words fixed as each call allows (the rest, such as a container's name, is
// the caller's). A command that does not begin with its process's words is refused before it is started (src/gp/commands.ts).
import manifest from "../../manifest.json";
import type { Call, ProcessId } from "../docker";

export type { Call, ProcessId };

/** The words after `docker` that a process fixes, by its id. */
export const DECLARED: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  manifest.host.processes.map((process) => [process.id, process.args as readonly string[]]),
);

/** The whole command line `docker` runs for a call: the declared words, then the call's. */
export const lineOf = (call: Call): string[] => [...(DECLARED[call.process] ?? []), ...call.args];
