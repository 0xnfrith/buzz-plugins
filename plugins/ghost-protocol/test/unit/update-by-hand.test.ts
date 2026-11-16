import { describe, expect, it } from "vitest";
import { DIGEST_PLACEHOLDER, IMAGE_PLACEHOLDER, VERSION_PLACEHOLDER, imageNameOf, updateByHand, versionIfSafe } from "../../src/update-by-hand";

// What Docker prints for a container made from the pinned image (`docker inspect --format {{.Config.Image}}`), and what the steps put in
// for the new version: its tag, and a placeholder for its digest, which the update's answer does not carry.
const DIGEST = "a".repeat(64);
const pinned = (name: string, tag: string) => `${name}:${tag}@sha256:${DIGEST}`;
const toBe = (name: string, tag: string) => `${name}:${tag}@sha256:${DIGEST_PLACEHOLDER}`;

describe("the steps for updating by hand (provisional text: GHOST Protocol's side fixes the final)", () => {
  it("are the three commands: pull the new version, remove the container, run it again on the same data volume", () => {
    expect(updateByHand("maple", pinned("registry.example/ghost-protocol", "0.0.0"), "0.1.1")).toEqual([
      `docker pull ${toBe("registry.example/ghost-protocol", "0.1.1")}`,
      "docker rm -f gp-maple",
      `docker run -d --name gp-maple --restart unless-stopped -v gp-maple-data:/data ${toBe("registry.example/ghost-protocol", "0.1.1")}`,
    ]);
  });

  it("name the new version's image by digest, not by tag alone, and never reuse the digest of the version the container runs", () => {
    const steps = updateByHand("maple", pinned("registry.example/ghost-protocol", "0.0.0"), "0.1.1");
    expect(DIGEST_PLACEHOLDER).toBe("<digest of that version>");
    for (const step of [steps[0], steps[2]]) {
      expect(step).toMatch(/ registry\.example\/ghost-protocol:0\.1\.1@sha256:<digest of that version>$/);
      expect(step).not.toContain(DIGEST);
      expect(step).not.toContain("0.0.0");
    }
  });

  it("use the new tag in the pull and the run, and the same volume in the run as the container's name gives", () => {
    const [pull, rm, run] = updateByHand("my-agent-2", pinned("registry.example:5000/team/ghost-protocol", "1.2.3"), "1.3.0");
    expect(pull).toBe(`docker pull ${toBe("registry.example:5000/team/ghost-protocol", "1.3.0")}`);
    expect(rm).toBe("docker rm -f gp-my-agent-2");
    expect(run).toContain(`-v gp-my-agent-2-data:/data ${toBe("registry.example:5000/team/ghost-protocol", "1.3.0")}`);
    expect(run).toContain("--name gp-my-agent-2 ");
  });

  it("name placeholders where the image or the new version is not known", () => {
    expect(updateByHand("maple", undefined, "0.1.1")[0]).toBe(`docker pull ${toBe(IMAGE_PLACEHOLDER, "0.1.1")}`);
    expect(updateByHand("maple", pinned("registry.example/ghost-protocol", "0.0.0"), null)[0]).toBe(`docker pull ${toBe("registry.example/ghost-protocol", VERSION_PLACEHOLDER)}`);
    expect(updateByHand("maple", undefined, undefined)[2]).toBe(`docker run -d --name gp-maple --restart unless-stopped -v gp-maple-data:/data ${toBe(IMAGE_PLACEHOLDER, VERSION_PLACEHOLDER)}`);
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
      expect(updateByHand("maple", image, "0.1.1")[0], JSON.stringify(image)).toBe(`docker pull ${toBe(IMAGE_PLACEHOLDER, "0.1.1")}`);
    }
    for (const version of ["1;rm", "$(x)", "1 2", "-1", ".1", "1/2", "1:2", "", "a".repeat(129), "1\n2", "1`x`", "1@sha256:" + DIGEST]) {
      expect(updateByHand("maple", pinned("reg/ghost-protocol", "1"), version)[0], JSON.stringify(version)).toBe(`docker pull ${toBe("reg/ghost-protocol", VERSION_PLACEHOLDER)}`);
    }
  });

  it("refuse a name that is not a slug", () => {
    expect(() => updateByHand("Maple; rm", "reg/x:1", "1")).toThrow("not a slug");
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
