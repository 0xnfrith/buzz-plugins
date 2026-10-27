import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BeeperError, createClient, type ErrorKind } from "../../src/beeper/client";
import { curlConfig } from "../../src/beeper/curl";
import { runCommand, declaredCommands } from "../host-sim.mjs";
import { startFake, TEST_TOKEN } from "../fake-beeper/server.mjs";
import { makeWorld } from "../fake-beeper/world.mjs";

// These tests run the real curl, with the manifest's own arguments, against a fake Beeper Desktop.
let fake: Awaited<ReturnType<typeof startFake>>;
beforeAll(async () => {
  fake = await startFake();
});
afterAll(() => fake.close());

const run = (command: "request" | "curl-version", input?: string) => runCommand(command, input);
const clientFor = (options: { token?: string | undefined; baseUrl?: string; run?: typeof run } = {}) =>
  createClient({
    run: options.run ?? run,
    token: () => ("token" in options ? options.token : TEST_TOKEN),
    baseUrl: () => options.baseUrl ?? fake.origin,
  });

async function kindOf(promise: Promise<unknown>): Promise<ErrorKind | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    if (error instanceof BeeperError) return error.kind;
    throw error;
  }
}

describe("the manifest's curl command", () => {
  it("takes no secret on its command line", () => {
    const request = declaredCommands().find((command: { id: string }) => command.id === "request");
    expect(request.program).toBe("curl");
    expect(request.args.join(" ")).not.toContain(TEST_TOKEN);
    expect(request.args).toContain("--proto");
    expect(request.args).toContain("=http");
    expect(request.args).toContain("--globoff");
    expect(request.args[0]).toBe("-q");
  });
});

describe("reading", () => {
  it("asks /v1/info without a token", async () => {
    const before = fake.requests.length;
    const info = await clientFor({ token: undefined }).info();
    expect(info.app.name).toContain("Beeper");
    const sent = fake.requests.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].authorization).toBeUndefined();
  });

  it("lists chats with the bearer token, in the header only", async () => {
    const before = fake.requests.length;
    const { items: chats, hasMore } = await clientFor().chats();
    expect(hasMore).toBe(false);
    expect(chats.length).toBeGreaterThan(5);
    expect(chats[0]).toHaveProperty("unreadCount");
    const sent = fake.requests.slice(before);
    expect(sent[0].authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(sent[0].path + sent[0].query).not.toContain(TEST_TOKEN);
    expect(sent[0].query).toBe("?limit=200");
  });

  it("pages through a chat's messages, newest first", async () => {
    const chat = fake.world.chats[0]!;
    const first = await clientFor().messages(chat.id);
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    const second = await clientFor().messages(chat.id, first.oldestCursor ?? undefined);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    const ids = new Set([...first.items, ...second.items].map((message) => message.id));
    expect(ids.size).toBe(first.items.length + second.items.length);
  });

  it("writes a chat id the way Beeper's own SDK does", async () => {
    const before = fake.requests.length;
    await clientFor().messages("!fake001:beeper.example");
    expect(fake.requests[before]!.path).toBe("/v1/chats/!fake001:beeper.example/messages");
  });
});

describe("sending", () => {
  it("delivers the text exactly, whatever it contains", async () => {
    const chat = fake.world.chats[1]!;
    const texts = [
      "plain",
      'quotes " and \\ backslashes \\n not a newline',
      "two\nlines\r\nand a tab\t.",
      "@/etc/hostname",
      'x"\nurl = "http://127.0.0.1:1/injected"\nheader = "X-Injected: 1"',
      "emoji 🙂 and é and 日本語",
      // The characters a config file and JSON each have to be careful with.
      "delete\u007fcharacter, bell\u0007, escape\u001b, nul\u0000, c1 \u0085, line separators \u2028 \u2029, a lone surrogate \ud800",
      "x".repeat(20000),
    ];
    for (const text of texts) {
      const before = fake.requests.length;
      const sent = await clientFor().send(chat.id, text);
      expect(sent.pendingMessageID).toMatch(/^pending-/);
      const requests = fake.requests.slice(before);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.method).toBe("POST");
      expect(requests[0]!.contentType).toBe("application/json");
      expect(JSON.parse(requests[0]!.body)).toEqual({ text });
    }
  });

  it("says so when a message cannot fit in one request", async () => {
    expect(await kindOf(clientFor().send(fake.world.chats[1]!.id, "x".repeat(70000)))).toBe("too-long");
  });

  it("marks a chat read", async () => {
    const chat = fake.world.chats.find((candidate) => candidate.unreadCount > 0)!;
    await clientFor().markRead(chat.id);
    expect(chat.unreadCount).toBe(0);
  });

  it("reports a refused send as such", async () => {
    const readOnly = fake.world.chats.find((candidate) => candidate.isReadOnly)!;
    expect(await kindOf(clientFor().send(readOnly.id, "hello"))).toBe("rejected");
  });
});

describe("what is written into the address", () => {
  // A client that only records the config it is given, to read the address out of it.
  const urlOf = async (call: (client: ReturnType<typeof createClient>) => Promise<unknown>) => {
    let config = "";
    const client = createClient({
      run: async (_command, input) => {
        config = input ?? "";
        return '{"items":[],"hasMore":false}\n200';
      },
      token: () => TEST_TOKEN,
      baseUrl: () => "http://127.0.0.1:23373",
    });
    await call(client).catch(() => {});
    return /^url = "(.*)"$/m.exec(config)![1]!;
  };

  it("encodes what could end or change a path or a query, and leaves what a chat id is made of", async () => {
    expect(await urlOf((c) => c.messages("!abc:beeper.com"))).toBe("http://127.0.0.1:23373/v1/chats/!abc:beeper.com/messages");
    const hostile = await urlOf((c) => c.messages("!a/b?c#d%e f[1-2]{x}\\:x.example", "cur&sor=1+2 3/4"));
    expect(hostile).toBe("http://127.0.0.1:23373/v1/chats/!a%2Fb%3Fc%23d%25e%20f%5B1-2%5D%7Bx%7D%5C:x.example/messages?cursor=cur%26sor%3D1%2B2%203%2F4&direction=before");
    expect(hostile).not.toMatch(/[\[\]{}\\ ]/);
  });

  it("is made again for each request, from the address as it is now", async () => {
    let base = "http://127.0.0.1:1111";
    let config = "";
    const client = createClient({ run: async (_c, input) => ((config = input ?? ""), '{"items":[]}\n200'), token: () => TEST_TOKEN, baseUrl: () => base });
    await client.chats();
    expect(config).toContain("http://127.0.0.1:1111/v1/chats");
    base = "http://127.0.0.1:2222";
    await client.chats();
    expect(config).toContain("http://127.0.0.1:2222/v1/chats");
  });
});

describe("a send that gets no answer", () => {
  it("is not reported as refused or as not sent: Beeper may have taken it", async () => {
    const client = createClient({ run: async () => null, token: () => TEST_TOKEN, baseUrl: () => fake.origin });
    await expect(client.send("!c:x", "hello")).rejects.toMatchObject({ kind: "unconfirmed" });
    await expect(client.chats()).rejects.toMatchObject({ kind: "unreachable" });
  });
});

describe("the token, in every way it could get out", () => {
  const everything = (error: unknown) => {
    const e = error as Error;
    return `${e.message}\n${e.stack}\n${JSON.stringify(e)}\n${String(e)}`;
  };

  it("is in no error, from the real curl failing in each way", async () => {
    const limited = await startFake({ scopes: false });
    const closed = await startFake();
    const closedOrigin = closed.origin;
    await closed.close();
    try {
      const cases: Array<() => Promise<unknown>> = [
        () => clientFor({ token: TEST_TOKEN, baseUrl: closedOrigin }).chats(),
        () => clientFor({ token: TEST_TOKEN, baseUrl: closedOrigin }).send("!c:x", "hi"),
        () => clientFor({ token: TEST_TOKEN, baseUrl: limited.origin }).chats(),
        () => clientFor({ token: TEST_TOKEN, baseUrl: fake.origin }).messages("!nobody:x"),
        () => clientFor({ token: TEST_TOKEN, baseUrl: fake.origin }).send(fake.world.chats.find((c: { isReadOnly?: boolean }) => c.isReadOnly)!.id, "hi"),
        () => createClient({ run: async () => "<html>\n200", token: () => TEST_TOKEN, baseUrl: () => fake.origin }).chats(),
        () => createClient({ run: async () => `${TEST_TOKEN}\n500`, token: () => TEST_TOKEN, baseUrl: () => fake.origin }).chats(),
      ];
      for (const run of cases) {
        const error = await run().then(
          () => undefined,
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(BeeperError);
        expect(everything(error)).not.toContain(TEST_TOKEN);
      }
    } finally {
      await limited.close();
    }
  });

  it("is on no program's command line while curl is running", async () => {
    if (process.platform !== "linux") return;
    const { readdirSync, readFileSync } = await import("node:fs");
    const config = curlConfig({ url: `${fake.origin}/__slow`, method: "GET", token: TEST_TOKEN })!;
    const running = runCommand("request", config);
    await new Promise((resolve) => setTimeout(resolve, 600));
    let curls = 0;
    for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
      let line = "";
      try {
        line = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      } catch {
        continue;
      }
      if (/(^|\/)curl\0/.test(line) && line.includes("--globoff")) {
        curls += 1;
        expect(line).not.toContain(TEST_TOKEN);
        expect(line).not.toContain(fake.origin);
      }
    }
    // The check looked at the real curl, not at nothing.
    expect(curls).toBeGreaterThan(0);
    expect(await running).toBeNull();
  }, 10000);
});

describe("a list of chats that does not fit in what Buzz lets a program print", () => {
  it("asks for fewer chats until it does, and keeps asking for that many", async () => {
    const big = await startFake({ world: makeWorld({ chats: 200, messages: 3 }), chatPadding: 6000 });
    try {
      const client = clientFor({ baseUrl: big.origin });
      const first = await client.chats();
      // 200 chats of more than 6 KB are over 1 MiB; 100 are not.
      expect(first.items).toHaveLength(100);
      expect(first.hasMore).toBe(true);
      const limits = big.requests.filter((r: { path: string }) => r.path === "/v1/chats").map((r: { query: string }) => r.query);
      expect(limits.at(0)).toBe("?limit=200");
      expect(limits.at(-1)).toBe("?limit=100");
      const before = big.requests.length;
      await client.chats();
      expect(big.requests.slice(before).map((r: { query: string }) => r.query)).toEqual(["?limit=100"]);
    } finally {
      await big.close();
    }
  });

  it("does not shrink the list because Beeper is closed", async () => {
    const closed = await startFake();
    const origin = closed.origin;
    await closed.close();
    const calls: string[] = [];
    const client = createClient({
      run: async (command, input) => (calls.push(`${command} ${/limit=(\d+)/.exec(input ?? "")?.[1] ?? ""}`), runCommand(command, input)),
      token: () => TEST_TOKEN,
      baseUrl: () => origin,
    });
    await expect(client.chats()).rejects.toMatchObject({ kind: "unreachable" });
    // Twice at 200, then the check (which asks /v1/info, with no limit); nothing at a smaller size.
    const limits = () => calls.filter((c) => /^request \d/.test(c));
    expect(limits()).toEqual(["request 200", "request 200"]);
    await expect(client.chats()).rejects.toMatchObject({ kind: "unreachable" });
    expect(limits()).toEqual(["request 200", "request 200", "request 200", "request 200"]);
  });

  it("does not shrink it for a single lost answer", async () => {
    let n = 0;
    const seen: number[] = [];
    const client = createClient({
      run: async (command, input) => {
        if (command !== "request") return "curl 8";
        seen.push(Number(/limit=(\d+)/.exec(input ?? "")?.[1]));
        return (n += 1) === 1 ? null : '{"items":[],"hasMore":false}\n200';
      },
      token: () => TEST_TOKEN,
      baseUrl: () => "http://127.0.0.1:1",
    });
    await client.chats();
    expect(seen).toEqual([200, 200]);
  });
});

describe("failures", () => {
  it("tells a wrong token from a missing permission", async () => {
    expect(await kindOf(clientFor({ token: "not-the-token" }).chats())).toBe("unauthorized");
    const limited = await startFake({ scopes: false });
    try {
      expect(await kindOf(clientFor({ baseUrl: limited.origin }).chats())).toBe("forbidden");
    } finally {
      await limited.close();
    }
  });

  it("does not call out without a token", async () => {
    const before = fake.requests.length;
    expect(await kindOf(clientFor({ token: undefined }).chats())).toBe("no-token");
    expect(fake.requests.length).toBe(before);
  });

  it("maps a missing chat to not-found", async () => {
    expect(await kindOf(clientFor().messages("!nobody:beeper.example"))).toBe("not-found");
  });

  it("calls a closed port unreachable, and diagnoses it as Beeper being down", async () => {
    const closed = await startFake();
    const origin = closed.origin;
    await closed.close();
    const client = clientFor({ baseUrl: origin });
    expect(await kindOf(client.chats())).toBe("unreachable");
    expect(await client.diagnose()).toBe("unreachable");
  });

  it("diagnoses a missing curl", async () => {
    const client = clientFor({ run: async () => null });
    expect(await client.diagnose()).toBe("curl-missing");
  });

  it("diagnoses a Beeper that is up but gave no usable answer", async () => {
    const calls: string[] = [];
    const client = clientFor({
      run: async (command, input) => {
        calls.push(command);
        return command === "request" && calls.length === 1 ? null : runCommand(command, input);
      },
    });
    expect(await kindOf(client.messages("!c:x"))).toBe("unreachable");
    expect(await client.diagnose()).toBe("reachable");
  });

  it("returns null, not a partial answer, for a reply over the host's output limit", async () => {
    const config = curlConfig({ url: `${fake.origin}/__big`, method: "GET", token: TEST_TOKEN })!;
    expect(await runCommand("request", config)).toBeNull();
  });

  it("gives up inside the host's five seconds", async () => {
    const started = Date.now();
    const config = curlConfig({ url: `${fake.origin}/__slow`, method: "GET", token: TEST_TOKEN })!;
    expect(await runCommand("request", config)).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
  }, 10000);

  it("turns a garbled answer into bad-reply", async () => {
    const client = clientFor({ run: async () => "<html>nope</html>\n200" });
    expect(await kindOf(client.chats())).toBe("bad-reply");
    expect(await kindOf(clientFor({ run: async () => "no status line" }).chats())).toBe("bad-reply");
  });
});

describe("the environment curl runs in", () => {
  it("ignores a proxy in the environment", async () => {
    const saved = { http_proxy: process.env.http_proxy, HTTP_PROXY: process.env.HTTP_PROXY, all_proxy: process.env.all_proxy };
    process.env.http_proxy = process.env.HTTP_PROXY = process.env.all_proxy = "http://127.0.0.1:1";
    try {
      expect((await clientFor().chats()).items.length).toBeGreaterThan(0);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("ignores the user's curlrc", async () => {
    const home = mkdtempSync(join(tmpdir(), "beeper-curlrc-"));
    writeFileSync(join(home, ".curlrc"), 'proxy = "http://127.0.0.1:1"\nurl = "http://127.0.0.1:1/other"\n');
    const saved = process.env.CURL_HOME;
    process.env.CURL_HOME = home;
    try {
      expect((await clientFor().chats()).items.length).toBeGreaterThan(0);
    } finally {
      if (saved === undefined) delete process.env.CURL_HOME;
      else process.env.CURL_HOME = saved;
    }
  });

  it("will not speak anything but plain http", async () => {
    const config = `url = "https://127.0.0.1:1/"\n`;
    expect(await runCommand("request", config)).toBeNull();
    expect(await runCommand("request", `url = "file:///etc/hostname"\n`)).toBeNull();
  });
});
