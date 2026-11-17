import { describe, expect, it } from "vitest";
import { NO_UPDATE_IMAGE, type UpdateImage } from "../../src/status";
import { DIGEST_PLACEHOLDER, IMAGE_PLACEHOLDER, VERSION_PLACEHOLDER, imageNameOf, sameOffer, updateByHand, versionIfSafe } from "../../src/update-by-hand";

// What Docker prints for a container made from the pinned image (`docker inspect --format {{.Config.Image}}`), and what the steps put in
// for the new version: its tag, and a placeholder for its digest, which the update's answer does not carry.
const DIGEST = "a".repeat(64);
const pinned = (name: string, tag: string) => `${name}:${tag}@sha256:${DIGEST}`;
const toBe = (name: string, tag: string) => `${name}:${tag}@sha256:${DIGEST_PLACEHOLDER}`;

// The steps when GHOST Protocol names no image for the update (an older one, or an offer made by hand): the container's image name, the new
// version, and a placeholder for its digest.
const updateByHandWithout = (slug: string, containerImage: string | undefined, version: string | null | undefined) => {
  const steps = updateByHand(slug, containerImage, { version: version ?? null, image: NO_UPDATE_IMAGE });
  if (steps.kind !== "placeholder") throw new Error(`expected the placeholder steps, got ${steps.kind}`);
  return steps.steps;
};

describe("the steps for updating by hand, when GHOST Protocol names no image for the update", () => {
  it("are the three commands: pull the new version, remove the container, run it again on the same data volume", () => {
    expect(updateByHandWithout("maple", pinned("registry.example/ghost-protocol", "0.0.0"), "0.1.1")).toEqual([
      `docker pull ${toBe("registry.example/ghost-protocol", "0.1.1")}`,
      "docker rm -f gp-maple",
      `docker run -d --name gp-maple --restart unless-stopped -v gp-maple-data:/data ${toBe("registry.example/ghost-protocol", "0.1.1")}`,
    ]);
  });

  it("name the new version's image by digest, not by tag alone, and never reuse the digest of the version the container runs", () => {
    const steps = updateByHandWithout("maple", pinned("registry.example/ghost-protocol", "0.0.0"), "0.1.1");
    expect(DIGEST_PLACEHOLDER).toBe("<digest of that version>");
    for (const step of [steps[0], steps[2]]) {
      expect(step).toMatch(/ registry\.example\/ghost-protocol:0\.1\.1@sha256:<digest of that version>$/);
      expect(step).not.toContain(DIGEST);
      expect(step).not.toContain("0.0.0");
    }
  });

  it("use the new tag in the pull and the run, and the same volume in the run as the container's name gives", () => {
    const [pull, rm, run] = updateByHandWithout("my-agent-2", pinned("registry.example:5000/team/ghost-protocol", "1.2.3"), "1.3.0");
    expect(pull).toBe(`docker pull ${toBe("registry.example:5000/team/ghost-protocol", "1.3.0")}`);
    expect(rm).toBe("docker rm -f gp-my-agent-2");
    expect(run).toContain(`-v gp-my-agent-2-data:/data ${toBe("registry.example:5000/team/ghost-protocol", "1.3.0")}`);
    expect(run).toContain("--name gp-my-agent-2 ");
  });

  it("name placeholders where the image or the new version is not known", () => {
    expect(updateByHandWithout("maple", undefined, "0.1.1")[0]).toBe(`docker pull ${toBe(IMAGE_PLACEHOLDER, "0.1.1")}`);
    expect(updateByHandWithout("maple", pinned("registry.example/ghost-protocol", "0.0.0"), null)[0]).toBe(`docker pull ${toBe("registry.example/ghost-protocol", VERSION_PLACEHOLDER)}`);
    expect(updateByHandWithout("maple", undefined, undefined)[2]).toBe(`docker run -d --name gp-maple --restart unless-stopped -v gp-maple-data:/data ${toBe(IMAGE_PLACEHOLDER, VERSION_PLACEHOLDER)}`);
    expect(IMAGE_PLACEHOLDER).toBe("<agent image>");
    expect(VERSION_PLACEHOLDER).toBe("<new version>");
  });

  it("keep a value that could mean something to a shell out of the steps, which are for pasting into a terminal", () => {
    const unsafe = ["x;rm -rf ~:1", "$(whoami):1", "`id`/ghost-protocol:1", "a b/ghost-protocol:1", "a|b:1", "a&b:1", "a>b:1", "reg/Ghost:1", "-evil:1", "a\nb:1", "reg/ghost-protocol@sha256:abcdef", "a*:1", "a'b:1", 'a"b:1', "a\\b:1", "a{b}:1", "~/x:1"];
    // The same names with the digest Docker prints, and a digest that is not one: the digest is taken off only when it is exactly a digest.
    const images = [
      ...unsafe,
      ...unsafe.map((name) => `${name}@sha256:${DIGEST}`),
      `reg/ghost-protocol:1@sha256:${"a".repeat(63)}`,
      `reg/ghost-protocol:1@sha256:${"a".repeat(65)}`,
      `reg/ghost-protocol:1@sha256:${"A".repeat(64)}`,
      `reg/ghost-protocol:1@sha256:${DIGEST};rm -rf ~`,
      `reg/ghost-protocol:1@sha256:${DIGEST}\n`,
      `reg/ghost-protocol:1@sha256:${DIGEST}@sha256:${DIGEST}`,
      `reg/ghost-protocol:1@sha512:${DIGEST}`,
    ];
    for (const image of images) {
      expect(updateByHandWithout("maple", image, "0.1.1")[0], JSON.stringify(image)).toBe(`docker pull ${toBe(IMAGE_PLACEHOLDER, "0.1.1")}`);
    }
    for (const version of ["1;rm", "$(x)", "1 2", "-1", ".1", "1/2", "1:2", "", "a".repeat(129), "1\n2", "1`x`", "1@sha256:" + DIGEST]) {
      expect(updateByHandWithout("maple", pinned("reg/ghost-protocol", "1"), version)[0], JSON.stringify(version)).toBe(`docker pull ${toBe("reg/ghost-protocol", VERSION_PLACEHOLDER)}`);
    }
  });

  it("refuse a name that is not a slug", () => {
    expect(() => updateByHandWithout("Maple; rm", "reg/x:1", "1")).toThrow("not a slug");
  });
});

// Note 15f: with an update on offer GHOST Protocol names the image of that version pinned by digest, and the pull and the run use it whole.
const NEW_DIGEST = "c".repeat(64);
const PINNED = `registry.example/ghost-protocol:0.1.1@sha256:${NEW_DIGEST}`;
const pinnedOffer = (image: string = PINNED): { version: string; image: UpdateImage } => ({ version: "0.1.1", image: { kind: "pinned", image } });

describe("the steps for updating by hand, when GHOST Protocol names the image of the update (note 15f)", () => {
  it("are the three commands with the image whole in the pull and in the run, and nothing of a placeholder", () => {
    expect(updateByHand("maple", pinned("registry.example/ghost-protocol", "0.0.0"), pinnedOffer())).toEqual({
      kind: "pinned",
      steps: [
        `docker pull ${PINNED}`,
        "docker rm -f gp-maple",
        `docker run -d --name gp-maple --restart unless-stopped -v gp-maple-data:/data ${PINNED}`,
      ],
    });
  });

  it("use the same image in the pull and in the run, the volume that goes with the container's name, and not the container's image", () => {
    const image = `registry.example:5000/team/ghost-protocol:1.3.0@sha256:${NEW_DIGEST}`;
    const result = updateByHand("my-agent-2", pinned("elsewhere.example/ghost-protocol", "1.2.3"), { version: "1.3.0", image: { kind: "pinned", image } });
    if (result.kind !== "pinned") throw new Error(result.kind);
    const [pull, rm, run] = result.steps;
    expect(pull).toBe(`docker pull ${image}`);
    expect(rm).toBe("docker rm -f gp-my-agent-2");
    expect(run).toBe(`docker run -d --name gp-my-agent-2 --restart unless-stopped -v gp-my-agent-2-data:/data ${image}`);
    for (const step of [pull, run]) {
      expect(step).not.toContain("elsewhere.example");
      expect(step).not.toContain(DIGEST_PLACEHOLDER);
      expect(step).not.toContain(IMAGE_PLACEHOLDER);
      expect(step).not.toContain(VERSION_PLACEHOLDER);
    }
  });

  it("do not need the container's image or a version of their own: the image says all of it", () => {
    for (const container of [undefined, "not an image ;", pinned("registry.example/ghost-protocol", "0.0.0")]) {
      const result = updateByHand("maple", container, pinnedOffer());
      expect(result.kind).toBe("pinned");
      expect(result.kind === "pinned" && result.steps[0]).toBe(`docker pull ${PINNED}`);
    }
  });

  it("refuse a name that is not a slug", () => {
    expect(() => updateByHand("Maple; rm", undefined, pinnedOffer())).toThrow("not a slug");
  });

  it("are no steps, and no command, when the image is refused", () => {
    expect(updateByHand("maple", pinned("registry.example/ghost-protocol", "0.0.0"), { version: "0.1.1", image: { kind: "refused" } })).toEqual({ kind: "refused" });
    expect(updateByHand("maple", undefined, { version: null, image: { kind: "refused" } })).toEqual({ kind: "refused" });
  });
});

describe("sameOffer", () => {
  const none = { version: "0.1.1", image: NO_UPDATE_IMAGE };
  it("is the same version with the same image, or the same version with none, or with a refused one", () => {
    expect(sameOffer(pinnedOffer(), pinnedOffer())).toBe(true);
    expect(sameOffer(none, { ...none })).toBe(true);
    expect(sameOffer({ version: "0.1.1", image: { kind: "refused" } }, { version: "0.1.1", image: { kind: "refused" } })).toBe(true);
    expect(sameOffer({ version: null, image: NO_UPDATE_IMAGE }, { version: null, image: NO_UPDATE_IMAGE })).toBe(true);
  });

  it("is not another version, another image of the same version, or an image where there was none", () => {
    expect(sameOffer(pinnedOffer(), { ...pinnedOffer(`registry.example/ghost-protocol:0.1.1@sha256:${"d".repeat(64)}`) })).toBe(false);
    expect(sameOffer(pinnedOffer(), { version: "0.1.2", image: { kind: "pinned", image: PINNED } })).toBe(false);
    expect(sameOffer(pinnedOffer(), none)).toBe(false);
    expect(sameOffer(none, pinnedOffer())).toBe(false);
    expect(sameOffer(none, { version: "0.1.1", image: { kind: "refused" } })).toBe(false);
    expect(sameOffer(none, { version: null, image: NO_UPDATE_IMAGE })).toBe(false);
  });
});

describe("imageNameOf", () => {
  it("is the image without its tag and its digest, with a registry's port kept", () => {
    expect(imageNameOf(pinned("registry.example/ghost-protocol", "0.0.0"))).toBe("registry.example/ghost-protocol");
    expect(imageNameOf(pinned("registry.example:5000/team/ghost-protocol", "1.2.3-rc.1"))).toBe("registry.example:5000/team/ghost-protocol");
    expect(imageNameOf(`ghcr.io/example/ghost-protocol@sha256:${DIGEST}`)).toBe("ghcr.io/example/ghost-protocol");
    // A container someone started by hand, with a tag and no digest, still has its name read.
    expect(imageNameOf("registry.example/ghost-protocol:0.0.0")).toBe("registry.example/ghost-protocol");
    expect(imageNameOf("registry.example:5000/team/ghost-protocol:0.0.0")).toBe("registry.example:5000/team/ghost-protocol");
    expect(imageNameOf("registry.example:5000/team/ghost-protocol")).toBe("registry.example:5000/team/ghost-protocol");
    expect(imageNameOf("ghost-protocol")).toBe("ghost-protocol");
    expect(imageNameOf(undefined)).toBeUndefined();
    expect(imageNameOf("")).toBeUndefined();
    expect(imageNameOf(`reg/ghost-protocol:1@sha256:${"a".repeat(63)}`)).toBeUndefined();
    expect(imageNameOf(`reg/ghost-protocol:1@sha256:${"A".repeat(64)}`)).toBeUndefined();
    expect(imageNameOf(`reg/ghost-protocol:1@sha256:${DIGEST};x`)).toBeUndefined();
  });
});

describe("versionIfSafe", () => {
  it("is a tag when it is one, and nothing otherwise", () => {
    expect(versionIfSafe("0.1.1")).toBe("0.1.1");
    expect(versionIfSafe("1.0.0-rc.1")).toBe("1.0.0-rc.1");
    expect(versionIfSafe("v2_x")).toBe("v2_x");
    expect(versionIfSafe("a".repeat(128))).toBe("a".repeat(128));
    expect(versionIfSafe("a".repeat(129))).toBeUndefined();
    expect(versionIfSafe(null)).toBeUndefined();
    expect(versionIfSafe(undefined)).toBeUndefined();
    expect(versionIfSafe("-1")).toBeUndefined();
    expect(versionIfSafe(".1")).toBeUndefined();
  });
});
