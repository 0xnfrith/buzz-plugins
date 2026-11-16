// The steps for updating an agent by hand, shown instead of the Update button when `gp update request` answers `no-updater`: the agent
// has no update helper, because its user said no to self-update at install. The wording is provisional: GHOST Protocol's side fixes the
// final text, and this file is the one place it lives.
import { containerOf } from "./commands";

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

/**
 * The three commands, in order: pull the new version, remove the container, start it again on the same data volume. The image is pinned
 * by digest like the agent's own, but GHOST Protocol's answer to an update names only the new version, so its digest is shown as a
 * placeholder, for the person to fill in from what GHOST Protocol published for that version.
 */
export function updateByHand(slug: string, image: string | undefined, newVersion: string | null | undefined): readonly string[] {
  const container = containerOf(slug);
  const reference = `${imageNameOf(image) ?? IMAGE_PLACEHOLDER}:${versionIfSafe(newVersion) ?? VERSION_PLACEHOLDER}@sha256:${DIGEST_PLACEHOLDER}`;
  return [
    `docker pull ${reference}`,
    `docker rm -f ${container}`,
    `docker run -d --name ${container} --restart unless-stopped -v ${container}-data:/data ${reference}`,
  ];
}
