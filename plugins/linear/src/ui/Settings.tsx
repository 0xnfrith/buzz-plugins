import { React } from "../react";
import { LinearError, type LinearClient } from "../linear/client";
import { KEYCHAIN_TERMINAL_COMMAND, checkKey, judgeKey, type KeyStore } from "../linear/keys";
import { VIEWER } from "../linear/queries";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; text: string }
  | { kind: "error"; text: string };

type Verdict = { kind: LinearError["kind"] | "ok"; text: string };

type Viewer = { viewer: { name: string }; organization: { name: string } };

export function createSettingsCard({ keys, client }: { keys: KeyStore; client: LinearClient }) {
  return function LinearSettings() {
    const saved = React.useSyncExternalStore(keys.subscribe, () => keys.has());
    const place = React.useSyncExternalStore(keys.subscribe, () => keys.place());
    const keychain = keys.keychainAvailable();
    const [draft, setDraft] = React.useState("");
    const [replacing, setReplacing] = React.useState(false);
    const [status, setStatus] = React.useState<Status>({ kind: "idle" });
    // The Keychain would not take a key: nothing was kept, and the card says how to put it there by hand.
    const [byHand, setByHand] = React.useState(false);
    const alive = React.useRef(true);
    React.useEffect(() => {
      alive.current = true;
      return () => {
        alive.current = false;
      };
    }, []);

    /** Asks Linear who the key belongs to. `candidate` checks a key that is not saved yet. What to show is up to the caller. */
    const ask = async (candidate?: string): Promise<Verdict> => {
      setStatus({ kind: "checking" });
      try {
        const data = await client.request<Viewer>("Viewer", VIEWER, {}, candidate);
        return { kind: "ok", text: `Connected as ${data.viewer.name} in ${data.organization.name}.` };
      } catch (error) {
        return error instanceof LinearError
          ? { kind: error.kind, text: error.message }
          : { kind: "server", text: "Something went wrong talking to Linear." };
      }
    };

    const show = (verdict: Verdict, text: string = verdict.text) => {
      if (alive.current) setStatus({ kind: verdict.kind === "ok" ? "ok" : "error", text });
    };

    const save = async (event: React.FormEvent) => {
      event.preventDefault();
      const checked = checkKey(draft);
      if (!checked.ok) {
        setStatus({ kind: "error", text: checked.message });
        return;
      }
      // The first look at where the key is kept comes first: whether a key is saved already decides what an unchecked key may do.
      await keys.ready;
      setByHand(false);
      // Linear is asked first, so a mistyped replacement never costs the key that works, even when Linear cannot answer.
      const verdict = await ask(checked.key);
      const ruling = judgeKey(verdict.kind, keys.has(), verdict.text);
      show(verdict, ruling.message ?? verdict.text);
      if (!ruling.save) return;
      let kept: boolean;
      try {
        kept = await keys.save(checked.key);
      } catch {
        if (alive.current) setStatus({ kind: "error", text: "This app could not store the key." });
        return;
      }
      if (!kept) {
        if (alive.current) {
          setByHand(true);
          setStatus({
            kind: "error",
            text: `The Keychain would not take the key from here, and it has not been kept anywhere.${keys.has() ? " Your saved key is unchanged." : ""}`,
          });
        }
        return;
      }
      setDraft("");
      setReplacing(false);
    };

    const checkKeychain = async () => {
      await keys.reload();
      if (!alive.current) return;
      if (keys.place() === "keychain") {
        setByHand(false);
        setReplacing(false);
        setStatus({ kind: "ok", text: "Found the key in your Keychain." });
      } else
        setStatus({ kind: "error", text: "Nothing in the Keychain yet. Run the command in Terminal, type the key at the prompt, then check again." });
    };

    const move = async () => {
      setStatus({ kind: "checking" });
      const moved = await keys.moveToKeychain();
      if (!alive.current) return;
      if (moved) {
        setByHand(false);
        setStatus({ kind: "ok", text: "Moved to your Keychain. The copy in this app's profile is gone." });
      } else {
        setByHand(true);
        setStatus({ kind: "error", text: "The Keychain would not take the key from here. It is still in this app's profile, as plain text." });
      }
    };

    const remove = async () => {
      const gone = await keys.clear();
      if (!alive.current) return;
      setStatus(
        gone
          ? { kind: "idle" }
          : {
              kind: "error",
              text:
                keys.place() === "keychain"
                  ? "The Keychain would not give the key up. Remove it in Keychain Access (search for buzz-linear)."
                  : "This app could not remove the key from its profile.",
            },
      );
      setReplacing(false);
      setByHand(false);
      setDraft("");
    };

    const showInput = !saved || replacing;
    return (
      <section className="mtl-root mtl-settings" aria-label="Linear">
        <p>
          Shows your Linear issues as a board. Each person pastes their own personal API key; it is kept on this computer and sent only to
          Linear.
        </p>
        {saved && !replacing && (
          <p className="mtl-saved" data-place={place}>
            <strong>Key saved.</strong>{" "}
            {place === "keychain"
              ? "It is kept in your Keychain. It is not shown again."
              : keychain
                ? "It is in this app's profile, as plain text, because the Keychain would not take it yet (it is tried again each time Buzz starts). Any other plugin you install could read it. It is not shown again."
                : "It is in this app's profile, as plain text: any other plugin you install could read it. It is not shown again."}
          </p>
        )}
        {showInput && (
          <form onSubmit={save} className="mtl-key-form">
            <label htmlFor="mtl-key">Personal API key</label>
            <input
              id="mtl-key"
              type="password"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={draft}
              placeholder="Paste your Linear API key"
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="mtl-actions">
              <button type="submit" className="mtl-button" data-primary disabled={status.kind === "checking"}>
                Save key
              </button>
              {replacing && (
                <button type="button" className="mtl-button" onClick={() => (setReplacing(false), setDraft(""), setByHand(false))}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
        {byHand && (
          <div role="group" aria-label="Save the key in the Keychain by hand" className="mtl-key-form">
            <p>
              To put it in the Keychain yourself, run this in Terminal. It asks for the key (twice, showing nothing as you type), so the key is not in the
              command:
            </p>
            <code className="mtl-code">{KEYCHAIN_TERMINAL_COMMAND}</code>
            <div className="mtl-actions">
              <button type="button" className="mtl-button" onClick={() => void checkKeychain()}>
                Check Keychain
              </button>
            </div>
          </div>
        )}
        {saved && !replacing && (
          <div className="mtl-actions">
            <button type="button" className="mtl-button" disabled={status.kind === "checking"} onClick={async () => show(await ask())}>
              Test connection
            </button>
            {keychain && place === "profile" && (
              <button type="button" className="mtl-button" data-primary disabled={status.kind === "checking"} onClick={() => void move()}>
                Move to Keychain
              </button>
            )}
            <button type="button" className="mtl-button" onClick={() => setReplacing(true)}>
              Replace key
            </button>
            <button type="button" className="mtl-button" onClick={() => void remove()}>
              Remove key
            </button>
          </div>
        )}
        {status.kind !== "idle" && (
          <p role={status.kind === "error" ? "alert" : "status"} data-tone={status.kind === "error" ? "error" : undefined}>
            {status.kind === "checking" ? "Checking with Linear…" : status.text}
          </p>
        )}
        <p className="mtl-muted">
          Make a key in Linear under{" "}
          <a href="https://linear.app/settings/account/security" target="_blank" rel="noopener noreferrer">
            Settings, Account, Security &amp; access
          </a>
          . Give it Write access (Read comes with it): Write is what lets a dragged card change state. If Linear lets you limit the key to certain
          teams, limit it to the teams you use.
        </p>
        {keychain ? (
          <p className="mtl-muted">
            On a Mac the key is kept in your Keychain, in an item named buzz-linear, not in this app's profile. Buzz plugins are not sandboxed: a plugin that
            declares the <code>security</code> program could read it too, and its install review lists that. Install only plugins you trust.
          </p>
        ) : (
          <p className="mtl-muted">
            On this system the key is kept on this computer, in this app's profile, as plain text. Buzz plugins are not sandboxed, so any other plugin you
            install could read it: install only plugins you trust.
          </p>
        )}
      </section>
    );
  };
}
