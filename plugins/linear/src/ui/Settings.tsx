import { React } from "../react";
import { LinearError, type LinearClient } from "../linear/client";
import { KEYCHAIN_TERMINAL_COMMAND, STORE_NAME, checkKey, judgeKey, type KeyStore } from "../linear/keys";
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
    const store = keys.store();
    const [draft, setDraft] = React.useState("");
    const [replacing, setReplacing] = React.useState(false);
    // A key is being checked with Linear or kept in the store.
    const [saving, setSaving] = React.useState(false);
    const [status, setStatus] = React.useState<Status>({ kind: "idle" });
    // The Keychain would not take a key (on a Mac): nothing was kept, and the card says how to put it there by hand.
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

    /** Asks Linear, then the store, about a key that was typed: see judgeKey and the store's own rules for what is kept. */
    const keep = async (key: string) => {
      // The first look at where the key is kept comes first: whether a key is saved already decides what an unchecked key may do.
      await keys.ready;
      setByHand(false);
      // Linear is asked first, so a mistyped replacement never costs the key that works, even when Linear cannot answer.
      const verdict = await ask(key);
      const ruling = judgeKey(verdict.kind, keys.has(), verdict.text);
      show(verdict, ruling.message ?? verdict.text);
      if (!ruling.save) return;
      let result: { kept: boolean; degraded: boolean };
      try {
        result = await keys.save(key);
      } catch {
        if (alive.current) setStatus({ kind: "error", text: "This app could not store the key." });
        return;
      }
      if (!result.kept) {
        if (!alive.current) return;
        if (store === "keychain") {
          setByHand(true);
          setStatus({
            kind: "error",
            text: `The Keychain would not take the key from here, and it has not been kept anywhere.${keys.has() ? " Your saved key is unchanged." : ""}`,
          });
        } else {
          // Only when the store already holds a key: a plain copy beside it would be shadowed by it, and the new key lost.
          setStatus({ kind: "error", text: "The system secret store would not take the new key, so your saved key is unchanged." });
        }
        return;
      }
      if (result.degraded && alive.current) {
        setStatus({
          kind: "error",
          text: "The system secret store (Secret Service) did not take the key from here, so it is kept in this app's profile, as plain text: any other plugin you install could read it. Is a Secret Service such as gnome-keyring running and unlocked? Buzz tries again each time it starts, or press Move to secret store.",
        });
      }
      setDraft("");
      setReplacing(false);
    };

    const save = async (event: React.FormEvent) => {
      event.preventDefault();
      const checked = checkKey(draft);
      if (!checked.ok) {
        setStatus({ kind: "error", text: checked.message });
        return;
      }
      // Cancel waits while a key is being checked and kept: a Cancel that did not stop the save would be a lie.
      setSaving(true);
      try {
        await keep(checked.key);
      } finally {
        if (alive.current) setSaving(false);
      }
    };

    // Cancel puts the card back as it was before Replace key: the typed key, a Terminal command and the last check's message go.
    const cancel = () => {
      setReplacing(false);
      setDraft("");
      setByHand(false);
      setStatus({ kind: "idle" });
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
      const moved = await keys.moveToStore();
      if (!alive.current) return;
      if (moved) {
        setByHand(false);
        setStatus({ kind: "ok", text: `Moved to ${store ? STORE_NAME[store] : "the store"}. The copy in this app's profile is gone.` });
      } else {
        setByHand(store === "keychain");
        setStatus({
          kind: "error",
          text: `${store === "keychain" ? "The Keychain" : "The system secret store"} would not take the key from here. It is still in this app's profile, as plain text.`,
        });
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
                  : keys.place() === "secret-service"
                    ? "The system secret store would not give the key up. Remove it with `secret-tool clear service buzz-linear account linear`, or in your keyring's own app (Passwords and Keys, KWalletManager)."
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
            {place === "keychain" || place === "secret-service"
              ? `It is kept in ${STORE_NAME[place]}. It is not shown again.`
              : store
                ? `It is in this app's profile, as plain text, because ${store === "keychain" ? "the Keychain" : "the system secret store (Secret Service)"} would not take it yet (it is tried again each time Buzz starts). Any other plugin you install could read it. It is not shown again.`
                : "It is in this app's profile, as plain text, because this system has no secret store the plugin can use: any other plugin you install could read it. It is not shown again."}
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
              <button type="submit" className="mtl-button" data-primary disabled={status.kind === "checking" || saving}>
                Save key
              </button>
              {replacing && (
                <button type="button" className="mtl-button" disabled={saving} onClick={cancel}>
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
            {store && place === "profile" && (
              <button type="button" className="mtl-button" data-primary disabled={status.kind === "checking"} onClick={() => void move()}>
                {store === "keychain" ? "Move to Keychain" : "Move to secret store"}
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
        {store === "keychain" ? (
          <p className="mtl-muted">
            On a Mac the key is kept in your Keychain, in an item named buzz-linear, not in this app's profile. Buzz plugins are not sandboxed: a plugin that
            declares the <code>security</code> program could read it too, and its install review lists that. Install only plugins you trust.
          </p>
        ) : store === "secret-service" ? (
          <p className="mtl-muted">
            On Linux the key is kept in the system secret store (the Secret Service: gnome-keyring, KWallet or another), in an item with the attributes service
            buzz-linear and account linear, not in this app's profile. Buzz plugins are not sandboxed: a plugin that declares the <code>secret-tool</code>{" "}
            program could read it too, and its install review lists that. If no Secret Service is running, the key is kept in this app's profile as plain text
            instead, and this card says so. Install only plugins you trust.
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
