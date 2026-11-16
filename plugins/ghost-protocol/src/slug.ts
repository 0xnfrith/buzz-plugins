// An agent's `<slug>`: lower-case letters, digits and `-`, made from the agent's name (interface note, section 3). It becomes part of a
// container's name and so of a `docker` argument, which is why it is checked here and nowhere else: it starts with a letter or a digit,
// so no argument built from it can be taken for an option, and it has no space, quote, slash or other character a command line reads.
export const SLUG_MAX = 40;

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export const isSlug = (text: string): boolean => text.length <= SLUG_MAX && SLUG.test(text);

/** What a person typed, as a slug: trimmed, and in lower case, since the names are. Undefined when it is not one. */
export function slugOf(typed: string): string | undefined {
  const slug = typed.trim().toLowerCase();
  return isSlug(slug) ? slug : undefined;
}
