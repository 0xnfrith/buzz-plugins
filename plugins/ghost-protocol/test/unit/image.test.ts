import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE, PINNED_IMAGE } from "../../src/gp/constants";
import manifest from "../../manifest.json" with { type: "json" };

const DIGEST = "a".repeat(64);

describe("the image the plugin may use is pinned by tag and digest", () => {
  it("is the form `<registry>/ghost-protocol:<tag>@sha256:<64 lower-case hex>`", () => {
    for (const image of [
      `registry.example/ghost-protocol:0.0.0@sha256:${DIGEST}`,
      `ghcr.io/example/ghost-protocol:1.2.3@sha256:${DIGEST}`,
      `ghcr.io/example/ghost-protocol:1.2.3-rc.1@sha256:${DIGEST}`,
      `registry.example:5000/team/sub.path/ghost-protocol:v1_2@sha256:${DIGEST}`,
      `localhost:5000/ghost-protocol:0.0.0@sha256:${DIGEST}`,
      `registry.example/ghost-protocol:${"t".repeat(128)}@sha256:${DIGEST}`,
      `registry.example/ghost-protocol:0.0.0@sha256:${"0123456789abcdef".repeat(4)}`,
    ]) expect(PINNED_IMAGE.test(image), image).toBe(true);
  });

  it("is not a bare tag, a bare digest, or any other form", () => {
    for (const image of [
      // a tag alone: it can be moved after the plugin was tested
      "registry.example/ghost-protocol:0.0.0",
      "registry.example/ghost-protocol:latest",
      "registry.example/ghost-protocol",
      // a digest alone: no version for a person to read
      `registry.example/ghost-protocol@sha256:${DIGEST}`,
      // the tag latest, even with a digest
      `registry.example/ghost-protocol:latest@sha256:${DIGEST}`,
      `ghcr.io/example/ghost-protocol:latest@sha256:${DIGEST}`,
      // a digest that is not a sha256 of 64 lower-case hex
      `registry.example/ghost-protocol:0.0.0@sha256:${"a".repeat(63)}`,
      `registry.example/ghost-protocol:0.0.0@sha256:${"a".repeat(65)}`,
      `registry.example/ghost-protocol:0.0.0@sha256:${"A".repeat(64)}`,
      `registry.example/ghost-protocol:0.0.0@sha256:${"g".repeat(64)}`,
      `registry.example/ghost-protocol:0.0.0@sha256:`,
      `registry.example/ghost-protocol:0.0.0@sha512:${DIGEST}`,
      `registry.example/ghost-protocol:0.0.0@${DIGEST}`,
      // something around it
      `registry.example/ghost-protocol:0.0.0@sha256:${DIGEST}:extra`,
      `registry.example/ghost-protocol:0.0.0@sha256:${DIGEST}@sha256:${DIGEST}`,
      `registry.example/ghost-protocol:0.0.0@sha256:${DIGEST} `,
      ` registry.example/ghost-protocol:0.0.0@sha256:${DIGEST}`,
      `registry.example/ghost-protocol:0.0.0@sha256:${DIGEST}\n`,
      `registry.example/ghost-protocol:0.0.0@sha256:${DIGEST};rm -rf ~`,
      `docker pull registry.example/ghost-protocol:0.0.0@sha256:${DIGEST}`,
      // another name, an unsafe tag, a tag too long
      `registry.example/other:0.0.0@sha256:${DIGEST}`,
      `registry.example/ghost-protocol-updater:0.0.0@sha256:${DIGEST}`,
      `registry.example/Ghost-Protocol:0.0.0@sha256:${DIGEST}`,
      `registry.example/ghost-protocol:-1@sha256:${DIGEST}`,
      `registry.example/ghost-protocol:.1@sha256:${DIGEST}`,
      `registry.example/ghost-protocol:1;x@sha256:${DIGEST}`,
      `registry.example/ghost-protocol:${"t".repeat(129)}@sha256:${DIGEST}`,
      `registry.example/ghost-protocol::@sha256:${DIGEST}`,
      `-registry/ghost-protocol:0.0.0@sha256:${DIGEST}`,
      "",
    ]) expect(PINNED_IMAGE.test(image), JSON.stringify(image)).toBe(false);
  });

  it("is the public image at v0.15.2, by the digest that release pins (the plain tag only exists after the release is promoted)", () => {
    expect(IMAGE).toBe("ghcr.io/0xnfrith/ghost-protocol:0.15.2@sha256:256dda44a35cdc8306cccd940e66066fb614bad4ecd2d259066d8d32cf84acc0");
    expect(PINNED_IMAGE.test(IMAGE)).toBe(true);
  });
});

// The manifest is the one place the image is written; these load the plugin's code against a manifest that names another one.
async function loadWith(image: string) {
  vi.resetModules();
  const processes = manifest.host.processes.map((process) => (process.id === "pull" ? { ...process, args: ["pull", image] } : process));
  vi.doMock("../../manifest.json", () => ({ default: { ...manifest, host: { ...manifest.host, processes } } }));
  const { IMAGE: loaded } = await import("../../src/gp/constants");
  const { commands } = await import("../../src/gp/commands");
  const { lineOf } = await import("../../src/gp/processes");
  return { IMAGE: loaded, commands, lineOf };
}

describe("every command that names the image, with a manifest that pins another one", () => {
  afterEach(() => {
    vi.doUnmock("../../manifest.json");
    vi.resetModules();
  });

  it("takes the pinned image to the pull, the init, the agent's start and the update helper's start, as it is", async () => {
    const image = `ghcr.io/example/ghost-protocol:1.2.3-rc.1@sha256:${DIGEST}`;
    const { IMAGE: loaded, commands, lineOf } = await loadWith(image);
    expect(loaded).toBe(image);
    expect(lineOf(commands.pull())).toEqual(["pull", image]);
    expect(lineOf(commands.init("maple", "Maple", "wss://relay.example.com", "f".repeat(64)))).toContain(image);
    expect(lineOf(commands.start("maple"))).toEqual(["run", "-d", "--restart", "unless-stopped", "--name", "gp-maple", "-v", "gp-maple-data:/data", image]);
    expect(lineOf(commands.startUpdater("maple"))).toEqual([
      "run", "-d", "--restart", "unless-stopped", "-v", "/var/run/docker.sock:/var/run/docker.sock", "--name", "gp-maple.updater", image, "updater", "--target", "gp-maple",
    ]);
  });

  for (const [what, image] of [
    ["a bare tag", "registry.example/ghost-protocol:0.0.0"],
    ["a bare digest", `registry.example/ghost-protocol@sha256:${DIGEST}`],
    ["the tag latest", `registry.example/ghost-protocol:latest@sha256:${DIGEST}`],
    ["a short digest", `registry.example/ghost-protocol:0.0.0@sha256:${"a".repeat(63)}`],
  ] as const) {
    it(`refuses ${what}: there is no image, and no command that names it can be made, a docker run included`, async () => {
      const { IMAGE: loaded, commands } = await loadWith(image);
      expect(loaded).toBe("");
      expect(() => commands.pull()).toThrow("not pinned by tag and digest");
      expect(() => commands.init("maple", "Maple", "wss://relay.example.com", "f".repeat(64))).toThrow("not pinned by tag and digest");
      expect(() => commands.start("maple")).toThrow("not pinned by tag and digest");
      expect(() => commands.startUpdater("maple")).toThrow("not pinned by tag and digest");
    });
  }
});
