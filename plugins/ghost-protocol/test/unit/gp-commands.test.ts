import { describe, expect, it } from "vitest";
import { commands } from "../../src/gp/commands";
import { IMAGE, UPDATER_COMMAND } from "../../src/gp/constants";
import { lineOf, type Call } from "../../src/gp/processes";

const SLUG = "maple";
const OWNER = "d".repeat(64);
const RELAY = "wss://relay.example.com";

const all: Record<string, Call> = {
  pull: commands.pull(),
  init: commands.init(SLUG, "Maple", RELAY, OWNER),
  state: commands.state("gp-maple"),
  start: commands.start(SLUG),
  startUpdater: commands.startUpdater(SLUG),
  restart: commands.restart("gp-maple"),
  authTagSet: commands.authTagSet(SLUG),
  claudeStatus: commands.claudeStatus(SLUG),
  claudeLogin: commands.claudeLogin(SLUG),
  claudeToken: commands.claudeToken(SLUG),
  status: commands.status(SLUG),
  remove: commands.remove(SLUG),
  removeData: commands.removeData(SLUG),
};

describe("the command lines", () => {
  it("are the interface's, word for word", () => {
    const line = (name: string) => lineOf(all[name] as Call);
    expect(line("pull")).toEqual(["pull", IMAGE]);
    expect(line("init")).toEqual(["run", "--rm", "-v", "gp-maple-data:/data", IMAGE, "init", "--name", "Maple", "--relay", RELAY, "--owner", OWNER]);
    expect(line("state")).toEqual(["inspect", "--format", "{{.State.Status}}", "gp-maple"]);
    expect(line("start")).toEqual(["run", "-d", "--restart", "unless-stopped", "--name", "gp-maple", "-v", "gp-maple-data:/data", IMAGE]);
    expect(line("startUpdater")).toEqual([
      "run", "-d", "--restart", "unless-stopped", "-v", "/var/run/docker.sock:/var/run/docker.sock", "--name", "gp-maple.updater", IMAGE, ...UPDATER_COMMAND, "--target", "gp-maple",
    ]);
    expect(line("restart")).toEqual(["restart", "gp-maple"]);
    expect(line("authTagSet")).toEqual(["exec", "-i", "gp-maple", "gp", "auth-tag", "set"]);
    expect(line("claudeStatus")).toEqual(["exec", "gp-maple", "gp", "claude", "status"]);
    expect(line("claudeLogin")).toEqual(["exec", "-i", "gp-maple", "gp", "claude", "login"]);
    expect(line("claudeToken")).toEqual(["exec", "-i", "gp-maple", "gp", "claude", "token"]);
    expect(line("status")).toEqual(["exec", "gp-maple", "gp", "status", "--json"]);
    expect(line("remove")).toEqual(["rm", "-f", "gp-maple", "gp-maple.updater"]);
    expect(line("removeData")).toEqual(["volume", "rm", "gp-maple-data"]);
  });

  it("each pass only the words after the ones its process declares", () => {
    expect(all.pull?.args).toEqual([]);
    expect(all.init?.args.slice(0, 2)).toEqual(["gp-maple-data:/data", IMAGE]);
    expect(all.start?.args[0]).toBe("gp-maple");
    expect(all.startUpdater?.args[0]).toBe("gp-maple.updater");
    expect(all.status?.args.slice(0, 2)).toEqual(["gp-maple", "gp"]);
  });

  it("only the update helper mounts the Docker socket", () => {
    for (const [name, command] of Object.entries(all)) {
      const mounts = lineOf(command).some((word) => word.includes("docker.sock"));
      expect(mounts, name).toBe(name === "startUpdater");
    }
  });

  it("never carry a secret: no call takes a token, a code or an environment flag", () => {
    for (const [name, command] of Object.entries(all)) {
      for (const word of lineOf(command)) {
        expect(word, name).not.toMatch(/^(-e|--env|--env-file|--token|-p|--publish|--privileged|--network|--pid)$/);
        expect(word, name).not.toMatch(/sk-ant|token=|secret/i);
      }
    }
  });
});
