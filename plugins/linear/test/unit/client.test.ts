import { describe, expect, test } from "vitest";
import { createClient, LinearError } from "../../src/linear/client";
import { VIEWER } from "../../src/linear/queries";
import { setup } from "./fake";

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as LinearError;
  }
  throw new Error("expected the request to fail");
}

describe("client", () => {
  test("sends a personal key as is, without Bearer", async () => {
    const seen: Record<string, string>[] = [];
    const client = createClient(
      async (request) => {
        seen.push({ ...request.headers });
        return { status: 200, headers: {}, body: JSON.stringify({ data: { ok: true } }) };
      },
      () => "test-key-abc",
    );
    await client.request("Viewer", VIEWER);
    expect(seen[0]?.authorization).toBe("test-key-abc");
  });

  test("with no key it fails before sending anything", async () => {
    let sent = 0;
    const client = createClient(async () => (sent += 1, { status: 200, headers: {}, body: "{}" }), () => undefined);
    expect((await failure(client.request("Viewer", VIEWER))).kind).toBe("no-key");
    expect(sent).toBe(0);
  });

  test("a refused key is an auth error", async () => {
    const { client, fake } = setup({ key: "test-key-unknown" });
    const error = await failure(client.request("Viewer", VIEWER));
    expect(error.kind).toBe("auth");
    expect(fake.control.log.operations.Viewer).toBe(1);
  });

  test("Bearer in front of a personal key is refused, as Linear refuses it", async () => {
    const { fake } = setup();
    const client = createClient((r) => fake.handle(r), () => `Bearer ${fake.keys.good}`);
    expect((await failure(client.request("Viewer", VIEWER))).kind).toBe("auth");
  });

  test("a forbidden key says what it needs", async () => {
    const { client, fake } = setup();
    fake.control.fail("forbidden");
    const error = await failure(client.request("Viewer", VIEWER));
    expect(error.kind).toBe("auth");
    expect(error.message).toMatch(/Read and Write/);
  });

  test("rate limiting carries the time Linear gives", async () => {
    const { fake } = setup();
    const client = createClient((r) => fake.handle(r), () => fake.keys.good, () => Date.parse("2026-10-23T15:00:00Z"));
    fake.control.fail("rate-limit");
    const error = await failure(client.request("Viewer", VIEWER));
    expect(error.kind).toBe("rate-limited");
    expect(error.retryAt).toBe(Date.parse("2026-10-23T15:05:00Z"));
  });

  test("an unreachable host is a network error that names nothing", async () => {
    const client = createClient(
      async () => {
        throw new Error("Host request failed: https://api.linear.app/graphql");
      },
      () => "test-key-abc",
    );
    const error = await failure(client.request("Viewer", VIEWER));
    expect(error.kind).toBe("network");
    expect(error.message).not.toMatch(/linear\.app|lin_api/);
  });

  test("GraphQL errors and bad bodies are told apart", async () => {
    const { client, fake } = setup();
    fake.control.fail("reject");
    expect((await failure(client.request("Viewer", VIEWER))).kind).toBe("rejected");
    fake.control.fail("server");
    expect((await failure(client.request("Viewer", VIEWER))).kind).toBe("server");
  });

  test("no error message or thrown value carries the key", async () => {
    const { fake } = setup();
    const key = fake.keys.good;
    for (const kind of ["network", "server", "rate-limit", "forbidden", "reject", "echo"]) {
      const client = createClient((r) => fake.handle(r), () => key);
      fake.control.fail(kind);
      const error = await failure(client.request("Viewer", VIEWER));
      expect(JSON.stringify({ m: error.message, s: error.stack })).not.toContain(key);
    }
  });

  test("a GraphQL error's own wording is never shown, even when it repeats the key", async () => {
    const { fake } = setup();
    const key = fake.keys.good;
    const client = createClient((r) => fake.handle(r), () => key);
    fake.control.fail("echo");
    const error = await failure(client.request("Viewer", VIEWER));
    expect(error.kind).toBe("rejected");
    expect(error.message).toBe("Linear refused the request.");
    expect(JSON.stringify({ m: error.message, s: error.stack })).not.toContain(key);
    expect(JSON.stringify({ m: error.message, s: error.stack })).not.toContain("Argument Validation");
  });

  test("every kind of error has fixed text, none taken from the reply", async () => {
    const reply = (status: number, body: string) => createClient(async () => ({ status, headers: {}, body }), () => "test-key-abc").request("Viewer", VIEWER);
    const wording = "Wording that must not appear: test-key-abc";
    expect((await failure(reply(200, JSON.stringify({ errors: [{ message: wording, extensions: { code: "INVALID_INPUT" } }] })))).message).toBe("Linear refused the request.");
    expect((await failure(reply(400, JSON.stringify({ errors: [{ message: wording, extensions: { code: "AUTHENTICATION_ERROR" } }] })))).message).toBe("Linear did not accept the API key.");
    expect((await failure(reply(403, JSON.stringify({ errors: [{ message: wording, extensions: { code: "FORBIDDEN" } }] })))).message).toBe("This key is not allowed to do that. It needs Read and Write access.");
    expect((await failure(reply(400, JSON.stringify({ errors: [{ message: wording, extensions: { code: "RATELIMITED" } }] })))).message).toBe("Linear is rate limiting this key.");
    expect((await failure(reply(503, wording))).message).toBe("Linear is having trouble right now (503).");
    expect((await failure(reply(400, wording))).message).toBe("Linear answered with an unexpected response (400).");
    expect((await failure(reply(200, JSON.stringify({ data: null })))).message).toBe("Linear answered with an unexpected response (200).");
  });
});
