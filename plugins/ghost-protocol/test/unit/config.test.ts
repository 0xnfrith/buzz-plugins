import { describe, expect, it } from "vitest";
import { CONTENT_MACHINE_SOON, chosenFrom, startingConfig } from "../../src/gp/config";

// The config Buzz keeps with each agent, read the way provision and activate read it: only a personal agent on this computer, with both
// questions answered, is a config that makes anything.

const saved = { place: "local", selfUpdate: true, claudeWay: "token" } as const;

describe("chosenFrom", () => {
  it("takes the config of every agent made before the content machine was shown: it has no `machine`", () => {
    expect(chosenFrom(saved)).toEqual({ selfUpdate: true, claudeWay: "token" });
    expect(chosenFrom({ ...saved, selfUpdate: false, claudeWay: "login" })).toEqual({ selfUpdate: false, claudeWay: "login" });
  });

  it("starts a new agent as a personal agent: the starting config has no `machine` either", () => {
    expect(startingConfig()).not.toHaveProperty("machine");
    expect(startingConfig("login")).not.toHaveProperty("machine");
  });

  it("refuses the content machine first, with the form's own words, whatever else the config holds", () => {
    for (const config of [{ ...saved, machine: "content" }, { ...saved, machine: "content", place: "hosted" }, { machine: "content" }, { machine: "content", selfUpdate: null }]) {
      expect(chosenFrom(config), JSON.stringify(config)).toEqual({ problem: CONTENT_MACHINE_SOON });
    }
    expect(CONTENT_MACHINE_SOON).toBe("The content machine runs on a megatech machine. It needs a megatech sign-in, and sign-up is coming soon.");
  });

  it("refuses any other `machine`, and an empty one, rather than reading it as a personal agent", () => {
    for (const machine of ["personal", "", null, 5, {}]) {
      expect(chosenFrom({ ...saved, machine }), String(machine)).toEqual({ problem: "Choose which agent to make." });
    }
  });

  it("still refuses Hosted and an unanswered question, as it did", () => {
    expect(chosenFrom({ ...saved, place: "hosted" })).toEqual({ problem: "Hosted is coming soon." });
    expect(chosenFrom({ ...saved, selfUpdate: null })).toMatchObject({ problem: expect.stringContaining("Answer the question") });
    expect(chosenFrom(undefined)).toMatchObject({ problem: expect.stringContaining("Choose where") });
  });
});
