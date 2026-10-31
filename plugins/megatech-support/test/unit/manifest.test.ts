import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../manifest.json";
import { SUPPORT_ORIGIN } from "../../src/support/origin";

const root = join(import.meta.dirname, "../..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
const source = files(join(root, "src")).filter((path) => /\.tsx?$/.test(path));

describe("the manifest", () => {
  it("declares exactly the one origin the plugin names in one place", () => {
    expect(manifest.host.networkOrigins).toEqual([SUPPORT_ORIGIN]);
  });

  it("declares nothing else of the host: no commands, no processes, no files, no servers", () => {
    expect(Object.keys(manifest.host)).toEqual(["networkOrigins"]);
  });

  it("names an origin the host's installer accepts: https, a bare origin, no port, no path", () => {
    const url = new URL(SUPPORT_ORIGIN);
    expect(url.protocol).toBe("https:");
    expect(url.origin).toBe(SUPPORT_ORIGIN);
    expect(url.username + url.password).toBe("");
    expect(SUPPORT_ORIGIN).not.toMatch(/:\d+$|\/$/);
    // The placeholder cannot resolve: `.invalid` is reserved for exactly that.
    expect(url.hostname.endsWith(".invalid")).toBe(true);
  });

  it("is an API v1 plugin with an id the host accepts and discovery text within its limits", () => {
    expect(manifest.apiVersion).toBe(1);
    expect(manifest.id).toMatch(/^[a-z][a-z0-9.-]*$/);
    expect(new TextEncoder().encode(manifest.description).length).toBeLessThanOrEqual(280);
    expect(manifest.discovery.tags.length).toBeLessThanOrEqual(16);
  });
});

describe("the plugin's code", () => {
  const code = source.map((path) => [path, readFileSync(path, "utf8")] as const);

  it("has no way out of the page but the host's declared-origin client", () => {
    for (const [path, text] of code) {
      if (path.endsWith("buzz.d.ts")) continue;
      for (const banned of [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /\bEventSource\b/, /\beval\s*\(/, /new Function\b/, /\bimport\s*\(/, /\.src\s*=/, /<img\b/, /<iframe\b/, /<script\b/])
        expect(text, `${path} must not match ${banned}`).not.toMatch(banned);
    }
  });

  it("keeps nothing in storage but the one switch, and logs nothing", () => {
    for (const [path, text] of code) {
      if (path.endsWith("buzz.d.ts")) continue;
      expect(text, path).not.toMatch(/sessionStorage|indexedDB|document\.cookie/);
      expect(text, path).not.toMatch(/console\./);
      const uses = text.match(/localStorage/g)?.length ?? 0;
      if (!/src\/index\.tsx$|src\/support\/switch\.ts$/.test(path)) expect(uses, path).toBe(0);
    }
  });

  it("never reads a key or a token of the host, and asks Buzz to sign in one place only", () => {
    for (const [path, text] of code) {
      if (path.endsWith("buzz.d.ts")) continue;
      expect(text, path).not.toMatch(/identity_export|invoke\(|__TAURI__|nsec|relay_sign|outbox|\.sign\(/);
      // The one call that signs for the user is the identity check's: nothing else may reach it.
      if (!path.endsWith("support/identity.ts")) expect(text, path).not.toMatch(/prepareRemoteAgentAuthorization/);
    }
  });

  it("exports what Buzz loads, and imports nothing", () => {
    const built = readFileSync(join(root, "plugin.js"), "utf8");
    expect(built).toMatch(/export \{[^}]*\binject\b[^}]*\}/);
    expect(built).toMatch(/export \{[^}]*\bapply\b[^}]*\}/);
    expect(built).not.toMatch(/^import\s/m);
    expect(built).toContain(SUPPORT_ORIGIN);
  });
});
