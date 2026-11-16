import { describe, expect, it } from "vitest";
import { IMAGE_PLACEHOLDER, VERSION_PLACEHOLDER, imageNameOf, updateByHand, versionIfSafe } from "../../src/update-by-hand";

describe("the steps for updating by hand (provisional text: GHOST Protocol's side fixes the final)", () => {
  it("are the three commands: pull the new version, remove the container, run it again on the same data volume", () => {
    expect(updateByHand("maple", "registry.example/ghost-protocol:0.0.0", "0.1.1")).toEqual([
      "docker pull registry.example/ghost-protocol:0.1.1",
      "docker rm -f gp-maple",
      "docker run -d --name gp-maple --restart unless-stopped -v gp-maple-data:/data registry.example/ghost-protocol:0.1.1",
    ]);
  });

  it("use the new tag in the pull and the run, and the same volume in the run as the container's name gives", () => {
    const [pull, rm, run] = updateByHand("my-agent-2", "registry.example:5000/team/ghost-protocol:1.2.3", "1.3.0");
    expect(pull).toBe("docker pull registry.example:5000/team/ghost-protocol:1.3.0");
    expect(rm).toBe("docker rm -f gp-my-agent-2");
    expect(run).toContain("-v gp-my-agent-2-data:/data registry.example:5000/team/ghost-protocol:1.3.0");
    expect(run).toContain("--name gp-my-agent-2 ");
  });

  it("name placeholders where the image or the new version is not known", () => {
    expect(updateByHand("maple", undefined, "0.1.1")[0]).toBe(`docker pull ${IMAGE_PLACEHOLDER}:0.1.1`);
    expect(updateByHand("maple", "registry.example/ghost-protocol:0.0.0", null)[0]).toBe(`docker pull registry.example/ghost-protocol:${VERSION_PLACEHOLDER}`);
    expect(updateByHand("maple", undefined, undefined)[2]).toBe(`docker run -d --name gp-maple --restart unless-stopped -v gp-maple-data:/data ${IMAGE_PLACEHOLDER}:${VERSION_PLACEHOLDER}`);
    expect(IMAGE_PLACEHOLDER).toBe("<agent image>");
    expect(VERSION_PLACEHOLDER).toBe("<new version>");
  });

  it("keep a value that could mean something to a shell out of the steps, which are for pasting into a terminal", () => {
    for (const image of ["x;rm -rf ~:1", "$(whoami):1", "`id`/ghost-protocol:1", "a b/ghost-protocol:1", "a|b:1", "a&b:1", "a>b:1", "reg/Ghost:1", "-evil:1", "a\nb:1", "reg/ghost-protocol@sha256:abcdef", "a*:1", "a'b:1", 'a"b:1', "a\\b:1", "a{b}:1", "~/x:1"]) {
      expect(updateByHand("maple", image, "0.1.1")[0], JSON.stringify(image)).toBe(`docker pull ${IMAGE_PLACEHOLDER}:0.1.1`);
    }
    for (const version of ["1;rm", "$(x)", "1 2", "-1", ".1", "1/2", "1:2", "", "a".repeat(129), "1\n2", "1`x`"]) {
      expect(updateByHand("maple", "reg/ghost-protocol:1", version)[0], JSON.stringify(version)).toBe(`docker pull reg/ghost-protocol:${VERSION_PLACEHOLDER}`);
    }
  });

  it("refuse a name that is not a slug", () => {
    expect(() => updateByHand("Maple; rm", "reg/x:1", "1")).toThrow("not a slug");
  });
});

describe("imageNameOf", () => {
  it("is the image without its tag, with a registry's port kept", () => {
    expect(imageNameOf("registry.example/ghost-protocol:0.0.0")).toBe("registry.example/ghost-protocol");
    expect(imageNameOf("registry.example:5000/team/ghost-protocol:0.0.0")).toBe("registry.example:5000/team/ghost-protocol");
    expect(imageNameOf("registry.example:5000/team/ghost-protocol")).toBe("registry.example:5000/team/ghost-protocol");
    expect(imageNameOf("ghost-protocol")).toBe("ghost-protocol");
    expect(imageNameOf(undefined)).toBeUndefined();
    expect(imageNameOf("")).toBeUndefined();
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
