import { describe, expect, it } from "vitest";
import { containerOf, nameForInit, slugFromName, updaterOf, volumeOf } from "../../src/gp/names";

describe("slugFromName", () => {
  it("makes lower-case letters, digits and single hyphens", () => {
    expect(slugFromName("Maple")).toBe("maple");
    expect(slugFromName("My Research Agent 2")).toBe("my-research-agent-2");
    expect(slugFromName("  --Hello,   World!!  ")).toBe("hello-world");
    expect(slugFromName("a_b.c/d")).toBe("a-b-c-d");
  });

  it("takes accents down to their letter", () => {
    expect(slugFromName("Zoë Müller")).toBe("zoe-muller");
    expect(slugFromName("Crème Brûlée")).toBe("creme-brulee");
  });

  it("has no hyphen at either end, however it is cut", () => {
    expect(slugFromName("x".repeat(39) + " y")).toBe("x".repeat(39));
    expect(slugFromName("x".repeat(60))).toBe("x".repeat(40));
    for (const name of ["-a-", "a--b", "!a!", "a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d"]) {
      expect(slugFromName(name) ?? "a").toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
    }
  });

  it("is undefined when nothing is left", () => {
    for (const name of ["", "   ", "---", "木", "✨ ✨", "..."]) expect(slugFromName(name)).toBeUndefined();
  });

  it("never starts a docker option, or holds a character a command line reads", () => {
    for (const name of ["--rm", "-v /:/host", "a; rm -rf /", "$(id)", "`id`", "a\nb", "a b\tc", "\"x\"", "'x'", "x&y"]) {
      const slug = slugFromName(name);
      if (slug !== undefined) expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });
});

describe("the names built from a slug", () => {
  it("are the interface's", () => {
    expect(containerOf("maple")).toBe("gp-maple");
    expect(volumeOf("maple")).toBe("gp-maple-data");
    expect(updaterOf("maple")).toBe("gp-maple.updater");
  });

  it("never let the helper of one agent be the container of another", () => {
    // A slug has no dot, so no agent's container can be `gp-<slug>.updater`.
    for (const name of ["Maple", "Maple Updater", "Updater Maple", "maple.updater", "maple-updater"]) {
      expect(containerOf(slugFromName(name) ?? "x")).not.toContain(".");
    }
    expect(containerOf(slugFromName("Updater Maple") as string)).not.toBe(updaterOf("maple"));
  });
});

describe("nameForInit", () => {
  it("is one line, trimmed, and never starts like a flag", () => {
    expect(nameForInit("  Maple \n the\tSecond ", "maple")).toBe("Maple the Second");
    expect(nameForInit("--help", "help")).toBe("help");
    expect(nameForInit("- - x", "x")).toBe("x");
    expect(nameForInit("-----", "agent")).toBe("agent");
  });
});
