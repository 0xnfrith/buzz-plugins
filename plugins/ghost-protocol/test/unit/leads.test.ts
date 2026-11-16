import { describe, expect, it } from "vitest";
import { startingConfig } from "../../src/gp/config";
import { CLAUDE_LEADS } from "../../src/gp/constants";
import { waysFor } from "../../src/ui/CreateForm";
import { agentType } from "../../src/agent-type";
import { createBook } from "../../src/gp/book";
import { createProgress, createSecrets } from "../../src/gp/progress";

// Which way of signing in to Claude the form leads with is one constant. Both ways are built, so the form follows the constant, whichever
// it holds, and a test can say what each value does.

describe("the way Claude leads with", () => {
  it("is the setup token's, until the sign-in by address is proven (GHOST Protocol's decision)", () => {
    expect(CLAUDE_LEADS).toBe("token");
  });

  it("is the starting choice of a new agent, and the first of the two choices on the form", () => {
    for (const leads of ["token", "login"] as const) {
      expect(startingConfig(leads).claudeWay).toBe(leads);
      expect(waysFor(leads)).toEqual(leads === "token" ? ["token", "login"] : ["login", "token"]);
      expect(waysFor(leads)[0]).toBe(leads);
    }
    expect(startingConfig()).toEqual({ place: "local", selfUpdate: null, claudeWay: CLAUDE_LEADS });
  });

  it("is what the registered type starts a new agent with", () => {
    const type = agentType({
      host: {},
      relay: { snapshot: () => ({ status: "connecting" }) },
      progress: createProgress(),
      secrets: createSecrets(),
      book: createBook(() => undefined),
      CreateConfiguration: undefined,
      Create: undefined,
    });
    expect(type.defaults().config.claudeWay).toBe(CLAUDE_LEADS);
  });
});
