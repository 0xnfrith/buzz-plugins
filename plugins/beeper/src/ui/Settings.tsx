import { React } from "../react";
import { BeeperError, type BeeperClient } from "../beeper/client";
import { DEFAULT_BASE_URL, KEYCHAIN_TERMINAL_COMMAND, checkBaseUrl, checkToken, type ConfigStore } from "../beeper/config";

type Status = { kind: "idle" } | { kind: "checking" } | { kind: "ok"; text: string } | { kind: "error"; text: string };

const TEXT: Partial<Record<BeeperError["kind"], string>> = {
  unauthorized: "Beeper did not accept that token.",
  forbidden: "Beeper accepted the token but it is not allowed to read chats.",
  "bad-reply": "Beeper answered with something this plugin does not understand.",
  server: "Beeper Desktop reported an error.",
};

export function createSettingsCard({ config, client }: { config: ConfigStore; client: BeeperClient }) {
  return function BeeperSettings() {
    const saved = React.useSyncExternalStore(config.subscribe, () => config.hasToken());
    const place = React.useSyncExternalStore(config.subscribe, () => config.place());
    const address = React.useSyncExternalStore(config.subscribe, () => config.baseUrl());
    const keychain = config.keychainAvailable();
    const [draft, setDraft] = React.useState("");
    const [replacing, setReplacing] = React.useState(false);
    const [addressDraft, setAddressDraft] = React.useState<string | undefined>(undefined);
    const [status, setStatus] = React.useState<Status>({ kind: "idle" });
    // The Keychain would not take the token: the token the person typed is not kept anywhere, and the card says how to do it by hand.
    const [byHand, setByHand] = React.useState(false);
    const alive = React.useRef(true);
    React.useEffect(() => {
      alive.current = true;
      return () => {
        alive.current = false;
      };
    }, []);

    /** Asks Beeper; `candidate` tries a token that is not saved yet. Returns the kind of failure, if any. */
    const check = async (candidate?: string): Promise<BeeperError["kind"] | "ok"> => {
      setStatus({ kind: "checking" });
      try {
        const info = await client.probe(candidate);
        if (alive.current) setStatus({ kind: "ok", text: `Connected to ${info.app.name} ${info.app.version}.` });
        return "ok";
      } catch (error) {
        const kind = error instanceof BeeperError ? error.kind : "bad-reply";
        let text = TEXT[kind] ?? (error instanceof BeeperError ? error.message : "Something went wrong talking to Beeper.");
        if (kind === "unreachable") {
          const found = await client.diagnose().catch(() => "unreachable" as const);
          text =
            found === "curl-missing"
              ? "The curl program was not found on this computer. This plugin needs it to reach Beeper."
              : found === "unreachable"
                ? "Beeper Desktop did not answer. Open it and turn on Settings, Developers, Beeper Desktop API."
                : "Beeper Desktop is running, but its answer was too slow or too large to use.";
        }
        if (alive.current) setStatus({ kind: "error", text });
        return kind;
      }
    };

    /** What a save does first: the token is checked as a token, then Beeper is asked, so a mistyped replacement never costs the one that works. */
    const accepted = async (): Promise<string | undefined> => {
      const checked = checkToken(draft);
      if (!checked.ok) {
        setStatus({ kind: "error", text: checked.message });
        return undefined;
      }
      const verdict = await check(checked.value);
      return verdict === "unauthorized" || verdict === "forbidden" ? undefined : checked.value;
    };
    const saveToKeychain = async (event?: React.FormEvent) => {
      event?.preventDefault();
      const value = await accepted();
      if (value === undefined) return;
      setByHand(false);
      if (await config.saveToKeychain(value)) {
        setDraft("");
        setReplacing(false);
      } else if (alive.current) {
        setByHand(true);
        setStatus({ kind: "error", text: "The Keychain would not take the token from here, and it has not been kept anywhere." });
      }
    };

    const saveToProfile = async (event?: React.FormEvent) => {
      event?.preventDefault();
      const value = await accepted();
      if (value === undefined) return;
      setByHand(false);
      try {
        await config.saveToProfile(value);
      } catch {
        setStatus({ kind: "error", text: "This app could not store the token." });
        return;
      }
      setDraft("");
      setReplacing(false);
    };

    const checkKeychain = async () => {
      await config.reload();
      if (!alive.current) return;
      if (config.place() === "keychain") {
        setByHand(false);
        setReplacing(false);
        setStatus({ kind: "ok", text: "Found the token in your Keychain." });
      } else setStatus({ kind: "error", text: "Nothing in the Keychain yet. Run the command in Terminal, type the token at the prompt, then check again." });
    };

    const move = async () => {
      setStatus({ kind: "checking" });
      const moved = await config.moveToKeychain();
      if (alive.current) setStatus(moved ? { kind: "ok", text: "Moved to your Keychain. The copy in this app's profile is gone." } : { kind: "error", text: "The Keychain would not take the token from here. It is still in this app's profile." });
    };

    const remove = async () => {
      const gone = await config.clearToken();
      if (!alive.current) return;
      setStatus(gone ? { kind: "idle" } : { kind: "error", text: "The Keychain would not give the token up. Remove it in Keychain Access (search for buzz-beeper)." });
      setReplacing(false);
      setByHand(false);
      setDraft("");
    };

    const saveAddress = (event: React.FormEvent) => {
      event.preventDefault();
      const checked = checkBaseUrl(addressDraft ?? "");
      if (!checked.ok) {
        setStatus({ kind: "error", text: checked.message });
        return;
      }
      config.saveBaseUrl(checked.value === DEFAULT_BASE_URL ? undefined : checked.value);
      setAddressDraft(undefined);
      setStatus({ kind: "ok", text: `Using ${checked.value}.` });
    };

    const showInput = !saved || replacing;
    const busy = status.kind === "checking";
    return (
      <section className="mtb-root mtb-settings" aria-label="Beeper">
        <p>
          Shows your Beeper chats as an inbox and lets you reply. It talks only to Beeper Desktop on this computer, using an access token you make there. Your
          messages are not sent anywhere else.
        </p>
        {saved && !replacing && (
          <p data-place={place}>
            {place === "keychain" ? (
              <>
                <strong>Token saved in your Keychain.</strong> It is not shown again.
              </>
            ) : (
              <>
                <strong>Token saved in this app's profile, as plain text.</strong> It is not shown again, but any other plugin you install could read it.
              </>
            )}
          </p>
        )}
        {showInput && (
          <form onSubmit={(event) => void (keychain ? saveToKeychain(event) : saveToProfile(event))} className="mtb-form">
            <label htmlFor="mtb-token">Beeper access token</label>
            <input
              id="mtb-token"
              className="mtb-input"
              type="password"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={draft}
              placeholder="Paste your access token"
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="mtb-actions">
              <button type="submit" className="mtb-button" data-primary="" disabled={busy}>
                {keychain ? "Save to Keychain" : "Save token"}
              </button>
              {keychain && (
                <button type="button" className="mtb-button" disabled={busy} onClick={() => void saveToProfile()}>
                  Keep it in this app's profile instead
                </button>
              )}
              {replacing && (
                <button type="button" className="mtb-button" onClick={() => (setReplacing(false), setDraft(""), setByHand(false))}>
                  Cancel
                </button>
              )}
            </div>
            <p className="mtb-muted">
              {keychain
                ? "Your Keychain is the safe place. The profile copy is plain text that any other plugin you install could read."
                : "On this system the token is kept in this app's profile, as plain text. Any other plugin you install could read it: install only plugins you trust."}
            </p>
          </form>
        )}
        {byHand && (
          <div role="group" aria-label="Save the token in the Keychain by hand" className="mtb-form">
            <p>
              To put it in the Keychain yourself, run this in Terminal. It asks for the token (twice, showing nothing as you type), so the token is not in the command:
            </p>
            <code className="mtb-code">{KEYCHAIN_TERMINAL_COMMAND}</code>
            <div className="mtb-actions">
              <button type="button" className="mtb-button" onClick={() => void checkKeychain()}>
                Check Keychain
              </button>
            </div>
          </div>
        )}
        {saved && !replacing && (
          <div className="mtb-actions">
            <button type="button" className="mtb-button" disabled={busy} onClick={() => void check()}>
              Test connection
            </button>
            {keychain && place === "profile" && (
              <button type="button" className="mtb-button" data-primary="" disabled={busy} onClick={() => void move()}>
                Move to Keychain
              </button>
            )}
            <button type="button" className="mtb-button" onClick={() => setReplacing(true)}>
              Replace token
            </button>
            <button type="button" className="mtb-button" onClick={() => void remove()}>
              Remove token
            </button>
          </div>
        )}
        {status.kind !== "idle" && (
          <p role={status.kind === "error" ? "alert" : "status"} data-tone={status.kind === "error" ? "error" : undefined}>
            {status.kind === "checking" ? "Asking Beeper…" : status.text}
          </p>
        )}
        <p className="mtb-muted">
          Make a token in Beeper Desktop: Settings, then Developers. Turn on Beeper Desktop API, then under Approved connections press + and follow the steps.
        </p>
        <details>
          <summary>Address</summary>
          <form onSubmit={saveAddress} className="mtb-form">
            <label htmlFor="mtb-address">Where Beeper Desktop listens</label>
            <input
              id="mtb-address"
              className="mtb-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={addressDraft ?? address}
              onChange={(event) => setAddressDraft(event.target.value)}
            />
            <p className="mtb-muted">Only this computer is allowed: http://127.0.0.1 or http://localhost, with the port. The default is {DEFAULT_BASE_URL}.</p>
            <div className="mtb-actions">
              <button type="submit" className="mtb-button" disabled={addressDraft === undefined}>
                Save address
              </button>
            </div>
          </form>
        </details>
      </section>
    );
  };
}
