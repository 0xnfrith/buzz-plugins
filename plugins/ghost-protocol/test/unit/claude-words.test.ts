import { describe, expect, it } from "vitest";
import { CLAUDE_STATUS, CODES, COMMANDS, GUIDE, LINKS } from "../../src/claude-words";
import { CLAUDE_WORDS } from "../../src/words";

// The words of the Claude status and the guide. They are what a stranger reads, so what they tell the person to run, the plans they
// name and the codes they quote are held here against the places those come from.

describe("the Claude status words", () => {
  it("say Claude: active and Claude: not active, and the status screen's row says the same two things", () => {
    expect(CLAUDE_STATUS.active).toBe("Claude: active");
    expect(CLAUDE_STATUS.notActive).toBe("Claude: not active");
    expect(CLAUDE_WORDS).toEqual({ active: "Active", "not-active": "Not active" });
  });
});

describe("the guide", () => {
  it("gives the commands Claude Code's own documentation gives", () => {
    expect(COMMANDS).toEqual({
      check: "claude --version",
      installUnix: "curl -fsSL https://claude.ai/install.sh | bash",
      installWindows: "irm https://claude.ai/install.ps1 | iex",
      token: "claude setup-token",
    });
  });

  it("links only to https pages of Anthropic's", () => {
    for (const link of Object.values(LINKS)) expect(link).toMatch(/^https:\/\/(claude\.com|code\.claude\.com)\//);
  });

  it("names the plans that have Claude Code, and says the free plan does not", () => {
    for (const plan of ["Pro", "Max", "Ultra", "Team", "Enterprise"]) expect(GUIDE.subscription).toContain(plan);
    expect(GUIDE.subscription).toMatch(/free plan does not include Claude Code/);
  });

  it("quotes the codes GHOST Protocol answers with (test/unit/claude.test.ts holds the fake docker to the same two)", () => {
    expect(CODES).toEqual({ token: "claude-token-invalid", login: "claude-login-failed" });
    expect(GUIDE.token.fails).toContain(CODES.token);
    expect(GUIDE.login.fails).toContain(CODES.login);
  });

  it("says GHOST Protocol's line and code, or the code alone when it had no line", () => {
    expect(GUIDE.said("claude-token-invalid", "The Claude token was not accepted.")).toBe("GHOST Protocol said: The Claude token was not accepted. (claude-token-invalid)");
    expect(GUIDE.said("claude-login-failed", "")).toBe("GHOST Protocol answered claude-login-failed.");
  });
});
