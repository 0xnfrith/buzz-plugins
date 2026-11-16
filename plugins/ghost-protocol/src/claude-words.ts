// Every line the Claude part of the agent's tab says: its status, the guide to connecting, and what each way ends in. The commands and
// plans are the ones Claude Code's own documentation gives (https://code.claude.com/docs/en/setup and /authentication). The codes are
// GHOST Protocol's (interface note, section 14): the text beside them is this plugin's, and GHOST Protocol's own line is shown next to it.

export const CLAUDE_STATUS = {
  checking: "Checking Claude…",
  active: "Claude: active",
  notActive: "Claude: not active",
  /** After a sign-in the agent accepted, until the person does something else. */
  accepted: "Claude accepted the sign-in.",
} as const;

/** The commands of the guide, each shown in a copy block. */
export const COMMANDS = {
  check: "claude --version",
  installUnix: "curl -fsSL https://claude.ai/install.sh | bash",
  installWindows: "irm https://claude.ai/install.ps1 | iex",
  token: "claude setup-token",
} as const;

export const LINKS = {
  plans: "https://claude.com/pricing",
  install: "https://code.claude.com/docs/en/setup",
} as const;

/** The codes GHOST Protocol answers with when Claude refuses, as the interface note names them. */
export const CODES = { token: "claude-token-invalid", login: "claude-login-failed" } as const;

export const GUIDE = {
  title: "Connect Claude",
  intro: "GHOST Protocol uses your own Claude subscription to think, so the agent cannot work until it has a sign-in.",
  subscription: "A Claude subscription is a paid Claude plan: Pro, Max, Ultra, Team or Enterprise. The free plan does not include Claude Code, so it is not enough.",
  plans: "See the plans",
  token: {
    title: "Option 1 (recommended): paste a setup token",
    terminal: "Open a terminal on your own computer: Terminal on a Mac or Linux, PowerShell on Windows, or your WSL window. Not a terminal inside Docker.",
    check: "Check whether Claude Code is installed:",
    checkOk: "If it prints a version number, go on to step 2.",
    install: "If the terminal says the command is not found, install Claude Code:",
    unix: "macOS, Linux or WSL",
    windows: "Windows PowerShell",
    installDone: "Then open a new terminal window and run the check again.",
    installHelp: "Installation help",
    make: "Make a token:",
    makeHow: "Your browser opens. Sign in to Claude and approve. The terminal then prints a long token. It does not save the token, so copy all of it now.",
    paste: "Paste the token here and press Send token. It goes to the agent and nowhere else: this plugin does not store it or log it.",
    send: "Send token",
    field: "Claude setup token",
    works: "When it works, the field empties and this section says Claude: active.",
    fails: `If Claude refuses the token, you see "Claude did not accept that token" and GHOST Protocol's code ${CODES.token}. The field empties either way. Make a new token and paste it.`,
  },
  login: {
    title: "Option 2: sign in at an address",
    why: "Use this if you cannot run the terminal command above.",
    press: "Press Sign in with an address. The agent gives an address.",
    open: "Open the address and sign in to Claude in your browser. Claude then shows a code.",
    code: "Copy the code, paste it into the box under the address, and press Continue.",
    start: "Sign in with an address",
    works: "When it works, the address and box go away and this section says Claude: active.",
    fails: `If the code is wrong or has run out, you see "Claude did not accept the sign-in" and GHOST Protocol's code ${CODES.login}. Press Sign in with an address again for a new address.`,
  },
  said: (code: string, message: string) => (message === "" ? `GHOST Protocol answered ${code}.` : `GHOST Protocol said: ${message} (${code})`),
} as const;
