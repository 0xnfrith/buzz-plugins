// The names GHOST Protocol's interface derives from an agent's name (section 3 of the interface note).
import { containerOf } from "../commands";
import { SLUG_MAX } from "../slug";

export { containerOf };

/**
 * Lower-case letters, digits and `-`, made from the agent's name: accents drop to their letter, every other run of characters becomes one
 * `-`, and none stands at either end. `undefined` when nothing is left (a name with no letter or digit docker accepts). What it makes is
 * always a slug in src/slug.ts's sense, which `containerOf` checks.
 */
export function slugFromName(name: string): string | undefined {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  return slug === "" ? undefined : slug;
}

/** The update helper beside the agent. Its dot is a character no slug has, so it can never be an agent's name. */
export const updaterOf = (slug: string): string => `${containerOf(slug)}.updater`;
/** The data volume: the agent's key, memory, attestation and Claude sign-in. */
export const volumeOf = (slug: string): string => `${containerOf(slug)}-data`;

/** The agent's name as `init --name` takes it: one line, with no flag-like start. */
export function nameForInit(name: string, slug: string): string {
  const line = name.replace(/\s+/g, " ").trim().replace(/^[-\s]+/, "");
  return line === "" ? slug : line;
}
