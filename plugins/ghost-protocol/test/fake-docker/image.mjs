// The image of the interface, pinned: `<registry>[:port][/path]/ghost-protocol:<exact tag>@sha256:<64 lower-case hex>`. The tag says which
// version it is for a person; the digest is what Docker checks, and a tag can be moved after it was tested where a digest cannot.
import { createHash } from "node:crypto";

/** The fake's made-up digest of one version of the image: the same for the same repository and tag, so two runs print the same text. */
export const digestOf = (repository, tag) => createHash("sha256").update(`${repository}/ghost-protocol:${tag}`).digest("hex");

/** `<repository>/ghost-protocol:<tag>@sha256:<digest>`, with the fake's digest unless one is given. */
export const pinnedImage = (repository, tag, digest = digestOf(repository, tag)) => `${repository}/ghost-protocol:${tag}@sha256:${digest}`;

/** Groups: repository (with the registry in front), tag, digest. The reference is the whole string, and nothing else is accepted. */
export const IMAGE = /^(?<repository>[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*)\/ghost-protocol:(?<tag>[0-9A-Za-z][0-9A-Za-z._+-]*)@sha256:(?<digest>[0-9a-f]{64})$/;
