// The steps for updating an agent by hand, shown instead of the Update button when `gp update request` answers `no-updater`: the agent
// has no update helper, because its user said no to self-update at install. This file is the one place the commands live.
//
// With an update on offer, GHOST Protocol gives the new version's image pinned by digest (`update.image`), and the pull and the run
// use it whole. When it gives none (an older GHOST Protocol, or an offer made by hand in a test), the steps are the tag-only ones with the
// digest left as a placeholder. When it gives an image that is not a pinned one, there are no steps: a command made from it would be a bad one.
import { containerOf } from "./commands";
import type { UpdateImage } from "./status";

/** Shown where the real value is not known. */
export const IMAGE_PLACEHOLDER = "<agent image>";
export const VERSION_PLACEHOLDER = "<new version>";
export const DIGEST_PLACEHOLDER = "<digest of that version>";

// The steps are for pasting into a terminal, so a value that came from Docker or from GHOST Protocol goes in only when it can mean
// nothing to a shell: a repository name is lower-case letters, digits and `. _ - / :` and begins with a letter or a digit; a tag is
// letters, digits and `. _ -` and does not begin with `.` or `-`. Anything else is shown as the placeholder.
const NAME = /^[a-z0-9][a-z0-9._/:-]*$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
// The digest an image is pinned by, at the end of what Docker prints for the container (`…/ghost-protocol:1.2.3@sha256:<64 hex>`). It is
// the digest of the version the container runs, so none of it goes into the steps: the new version has a digest of its own.
const DIGEST = /@sha256:[0-9a-f]{64}$/;

/**
 * The image's name without its tag or its digest (`registry.example.com:5000/team/ghost-protocol` from
 * `…/ghost-protocol:1.2.3@sha256:<64 hex>`), when it is safe.
 */
export function imageNameOf(image: string | undefined): string | undefined {
  if (image === undefined) return undefined;
  const pinned = image.replace(DIGEST, "");
  const colon = pinned.lastIndexOf(":");
  const name = colon > pinned.lastIndexOf("/") ? pinned.slice(0, colon) : pinned;
  return NAME.test(name) ? name : undefined;
}

export const versionIfSafe = (version: string | null | undefined): string | undefined =>
  version !== null && version !== undefined && TAG.test(version) ? version : undefined;

/** The three commands, in order: pull the new version, remove the container, start it again on the same data volume. */
const commands = (slug: string, reference: string): readonly string[] => {
  const container = containerOf(slug);
  return [
    `docker pull ${reference}`,
    `docker rm -f ${container}`,
    `docker run -d --name ${container} --restart unless-stopped -v ${container}-data:/data ${reference}`,
  ];
};

/** What the steps for an update by hand are, for the update on offer. */
export type ByHand =
  /** The image GHOST Protocol named, whole, in the pull and the run. */
  | Readonly<{ kind: "pinned"; steps: readonly string[] }>
  /** GHOST Protocol named no image: the container's image name and the new version, and a placeholder for the digest. */
  | Readonly<{ kind: "placeholder"; steps: readonly string[] }>
  /** GHOST Protocol named an image that is not pinned for this version: no commands. */
  | Readonly<{ kind: "refused" }>;

/**
 * The steps for the update on offer (`version` and `image` of the status's `update`). `containerImage` is the image the container was made
 * from, read only for the placeholder steps. Where it or the version is not known the placeholder steps show a placeholder for it.
 */
export function updateByHand(slug: string, containerImage: string | undefined, offer: Readonly<{ version: string | null; image: UpdateImage }>): ByHand {
  if (offer.image.kind === "pinned") return { kind: "pinned", steps: commands(slug, offer.image.image) };
  if (offer.image.kind === "refused") return { kind: "refused" };
  // The image is pinned by digest like the agent's own, but this GHOST Protocol named only the new version, so the digest of that version is
  // a placeholder, for the person to fill in from what GHOST Protocol published for it.
  const reference = `${imageNameOf(containerImage) ?? IMAGE_PLACEHOLDER}:${versionIfSafe(offer.version) ?? VERSION_PLACEHOLDER}@sha256:${DIGEST_PLACEHOLDER}`;
  return { kind: "placeholder", steps: commands(slug, reference) };
}

/** Whether two offers are the same update: the same version, and the same image (or none, or a refused one). */
export function sameOffer(a: Readonly<{ version: string | null; image: UpdateImage }>, b: Readonly<{ version: string | null; image: UpdateImage }>): boolean {
  if (a.version !== b.version || a.image.kind !== b.image.kind) return false;
  return a.image.kind !== "pinned" || (b.image.kind === "pinned" && a.image.image === b.image.image);
}
