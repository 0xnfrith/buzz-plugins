import { React } from "../react";
import { BeeperError, type BeeperClient } from "../beeper/client";
import { DEFAULT_BASE_URL, checkBaseUrl, checkToken, type ConfigStore } from "../beeper/config";

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
    const address = React.useSyncExternalStore(config.subscribe, () => config.baseUrl());
    const [draft, setDraft] = React.useState("");
    const [replacing, setReplacing] = React.useState(false);
    const [addressDraft, setAddressDraft] = React.useState<string | undefined>(undefined);
    const [status, setStatus] = React.useState<Status>({ kind: "idle" });
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

    const save = async (event: React.FormEvent) => {
      event.preventDefault();
      const checked = checkToken(draft);
      if (!checked.ok) {
        setStatus({ kind: "error", text: checked.message });
        return;
      }
      // Beeper is asked first, so a mistyped replacement never costs the token that works.
      const verdict = await check(checked.value);
      if (verdict === "unauthorized" || verdict === "forbidden") return;
      try {
        config.saveToken(checked.value);
      } catch {
        setStatus({ kind: "error", text: "This app could not store the token." });
        return;
      }
      if (verdict !== "ok" && alive.current) setStatus({ kind: "ok", text: "Token saved. Beeper is not answering right now: open it, then press Test connection." });
      setDraft("");
      setReplacing(false);
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

    const remove = () => {
      config.clearToken();
      setStatus({ kind: "idle" });
      setReplacing(false);
      setDraft("");
    };

    const showInput = !saved || replacing;
    return (
      <section className="mtb-root mtb-settings" aria-label="Beeper">
        <p>
          Shows your Beeper chats as an inbox and lets you reply. It talks only to Beeper Desktop on this computer, using an access token you make there. Your
          messages are not sent anywhere else.
        </p>
        {saved && !replacing && (
          <p>
            <strong>Token saved.</strong> It is not shown again.
          </p>
        )}
        {showInput && (
          <form onSubmit={save} className="mtb-form">
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
              <button type="submit" className="mtb-button" data-primary="" disabled={status.kind === "checking"}>
                Save token
              </button>
              {replacing && (
                <button type="button" className="mtb-button" onClick={() => (setReplacing(false), setDraft(""))}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
        {saved && !replacing && (
          <div className="mtb-actions">
            <button type="button" className="mtb-button" disabled={status.kind === "checking"} onClick={() => void check()}>
              Test connection
            </button>
            <button type="button" className="mtb-button" onClick={() => setReplacing(true)}>
              Replace token
            </button>
            <button type="button" className="mtb-button" onClick={remove}>
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
        <p className="mtb-muted">
          The token is kept on this computer, in this app's profile, as plain text. Buzz plugins are not sandboxed, so any other plugin you install could read it:
          install only plugins you trust.
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
