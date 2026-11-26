import { afterEach, describe, expect, it } from "vitest";
import { agentType } from "../../src/agent-type";
import { createBook } from "../../src/gp/book";
import { CreateError } from "../../src/gp/flow";
import { CLAUDE_LEADS } from "../../src/gp/constants";
import { createProgress, createSecrets } from "../../src/gp/progress";
import { authOf, hostFrom, OWNER, RELAY, SIGNAL, TOKEN } from "./support";
import { createFakeDocker, type FakeDocker, type ScenarioInput } from "../fake-docker/index.mjs";

// The registered type, driven the way Buzz drives it: `provision`, then `activate`, with the process the host would start made from the
// fake docker.

const fakes: FakeDocker[] = [];
afterEach(() => {
  for (const fake of fakes.splice(0)) fake.cleanup();
});

function setup(scenario: ScenarioInput = "ok", options: { ready?: boolean; spawn?: boolean } = {}) {
  const fake = createFakeDocker({ scenario });
  fakes.push(fake);
  const { host, calls } = hostFrom(fake);
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) };
  const progress = createProgress();
  const secrets = createSecrets();
  const book = createBook(() => storage);
  const relay = { snapshot: () => (options.ready === false ? { status: "connecting" } : { status: "ready", session: { viewer: OWNER } }) };
  const type = agentType({ host: options.spawn === false ? {} : (host as never), relay, progress, secrets, book, CreateConfiguration: undefined, Create: undefined });
  return { fake, calls, progress, secrets, book, type, memory };
}

const config = { place: "local", selfUpdate: true, claudeWay: "token" } as const;
const provisionInput = (over: Record<string, unknown> = {}) => ({ name: "Maple", community: RELAY, config, signal: SIGNAL, ...over });
const activateInput = (pubkey: string, over: Record<string, unknown> = {}) => ({ pubkey, name: "Maple", community: RELAY, auth: authOf() as never, config, signal: SIGNAL, ...over });

describe("the type", () => {
  it("is a Remote type with the four steps Buzz needs, and a starting config that asks both questions", () => {
    const { type } = setup();
    // The title is what Buzz's Harness row shows; the id is the key of every agent made before the title changed, so it stays.
    expect(type).toMatchObject({ id: "ghost-protocol", title: "Megatech" });
    expect(Object.keys(type.remote).sort()).toEqual(["activate", "profile", "provision", "remove"]);
    expect(type.defaults()).toEqual({ config: { place: "local", selfUpdate: null, claudeWay: CLAUDE_LEADS } });
    expect(type.defaults().config).not.toHaveProperty("machine");
    expect(type.summary?.({})).toBe("On this computer");
  });

  it("goes from the form's answers to a running agent, and back to nothing", async () => {
    const { type, secrets, book, calls, fake } = setup();
    secrets.setToken(TOKEN);
    const { pubkey } = await type.remote.provision(provisionInput());
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(book.get(pubkey)).toBe("maple");
    await type.remote.activate(activateInput(pubkey));
    expect(Object.keys(fake.state().containers).sort()).toEqual(["gp-maple", "gp-maple.updater"]);
    // Every process it asked the host for is one the manifest declares, and every call was a method call on the host.
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.every((call) => call.onHost)).toBe(true);

    await type.remote.remove({ pubkey, community: RELAY, signal: SIGNAL });
    expect(fake.state().containers).toEqual({});
    expect(fake.state().volumes).toEqual({});
    expect(book.get(pubkey)).toBeUndefined();
  });

  it("makes the agent for the person who is signed in, and for nobody else", async () => {
    const { type, fake } = setup();
    await type.remote.provision(provisionInput());
    const init = fake.calls().find((call) => call.argv[0] === "run" && call.argv.includes("init"));
    expect(init?.argv.slice(-2)).toEqual(["--owner", OWNER]);
    expect(init?.argv).toContain(RELAY);
  });

  it("does not start while the community is not ready, or the signed-in key is not one", async () => {
    const notReady = setup("ok", { ready: false });
    await expect(notReady.type.remote.provision(provisionInput())).rejects.toThrow(/Connect to your community and sign in/);
    expect(notReady.calls).toEqual([]);

    const fake = createFakeDocker({ scenario: "ok" });
    fakes.push(fake);
    const type = agentType({
      host: hostFrom(fake).host as never,
      relay: { snapshot: () => ({ status: "ready", session: { viewer: "NPUB1" } }) },
      progress: createProgress(),
      secrets: createSecrets(),
      book: createBook(() => undefined),
      CreateConfiguration: undefined,
      Create: undefined,
    });
    await expect(type.remote.provision(provisionInput())).rejects.toBeInstanceOf(CreateError);
    expect(fake.calls()).toEqual([]);
  });

  it("refuses Hosted, and an unanswered question, before it runs anything", async () => {
    const { type, calls } = setup();
    await expect(type.remote.provision(provisionInput({ config: { ...config, place: "hosted" } }))).rejects.toThrow("Hosted is coming soon.");
    await expect(type.remote.provision(provisionInput({ config: { ...config, selfUpdate: null } }))).rejects.toThrow(/Answer the question about updating itself/);
    await expect(type.remote.provision(provisionInput({ config: undefined }))).rejects.toThrow(/Choose where/);
    await expect(type.remote.provision(provisionInput({ config: { ...config, claudeWay: "email" } }))).rejects.toThrow(/Choose how to sign in/);
    await expect(type.remote.activate(activateInput("a".repeat(64), { config: { ...config, selfUpdate: null } }))).rejects.toThrow(/Answer the question/);
    expect(calls).toEqual([]);
  });

  it("makes nothing for the content machine: provision and activate refuse it before any call, whatever else the config holds", async () => {
    const { type, calls, fake, secrets, book } = setup();
    secrets.setToken(TOKEN);
    const soon = "The content machine runs on a megatech machine. It needs a megatech sign-in, and sign-up is coming soon.";
    for (const machine of [{ ...config, machine: "content" }, { place: "hosted", machine: "content" }, { machine: "content" }]) {
      await expect(type.remote.provision(provisionInput({ config: machine }))).rejects.toThrow(soon);
      await expect(type.remote.activate(activateInput("a".repeat(64), { config: machine }))).rejects.toThrow(soon);
    }
    await expect(type.remote.provision(provisionInput({ config: { ...config, machine: "other" } }))).rejects.toThrow("Choose which agent to make.");
    expect(calls).toEqual([]);
    expect(fake.calls()).toEqual([]);
    expect(fake.state().containers).toEqual({});
    expect(book.get("a".repeat(64))).toBeUndefined();
  });

  it("says so in the web build, which cannot start a program", async () => {
    const { type } = setup("ok", { spawn: false });
    await expect(type.remote.provision(provisionInput())).rejects.toThrow("This Buzz cannot start programs. Use the Buzz desktop app.");
  });

  it("starts no helper after a no", async () => {
    const { type, secrets, fake } = setup("no-self-update");
    secrets.setToken(TOKEN);
    const noConfig = { ...config, selfUpdate: false };
    const { pubkey } = await type.remote.provision(provisionInput({ config: noConfig }));
    await type.remote.activate(activateInput(pubkey, { config: noConfig }));
    expect(Object.keys(fake.state().containers)).toEqual(["gp-maple"]);
  });

  it("removes nothing it cannot tell is the agent's", async () => {
    const { type, calls } = setup();
    await type.remote.remove({ pubkey: "f".repeat(64), community: RELAY, signal: SIGNAL });
    expect(calls).toEqual([]);
  });

  it("has no profile to publish and makes no call for one", async () => {
    const { type, calls } = setup();
    await type.remote.profile({ pubkey: "a".repeat(64), community: RELAY, name: "Maple", signal: SIGNAL });
    expect(calls).toEqual([]);
  });

  it("keeps the pair of key and name only as text it can read back, and ignores anything else in that storage", async () => {
    const { book, memory } = setup();
    memory.set("megatech.ghost-protocol.agents", JSON.stringify({ [`${"a".repeat(64)}`]: "maple", nothex: "x", [`${"b".repeat(64)}`]: "Not A Slug", [`${"c".repeat(64)}`]: 5 }));
    expect(book.get("a".repeat(64))).toBe("maple");
    expect(book.get("b".repeat(64))).toBeUndefined();
    expect(book.get("c".repeat(64))).toBeUndefined();
    memory.set("megatech.ghost-protocol.agents", "{not json");
    expect(book.get("a".repeat(64))).toBeUndefined();
    book.set("a".repeat(64), "maple");
    expect(book.get("a".repeat(64))).toBe("maple");
  });
});
