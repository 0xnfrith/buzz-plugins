import { React } from "../react";
import { LinearError, type LinearClient } from "../linear/client";
import { checkKey, judgeKey, type KeyStore } from "../linear/keys";
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
    const [draft, setDraft] = React.useState("");
    const [replacing, setReplacing] = React.useState(false);
    const [status, setStatus] = React.useState<Status>({ kind: "idle" });
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
      // Linear is asked first, so a mistyped replacement never costs the key that works, even when Linear cannot answer.
      const verdict = await ask(checked.key);
      const ruling = judgeKey(verdict.kind, keys.has(), verdict.text);
      show(verdict, ruling.message ?? verdict.text);
      if (!ruling.save) return;
      try {
        keys.save(checked.key);
      } catch {
        setStatus({ kind: "error", text: "This app could not store the key." });
        return;
      }
      setDraft("");
      setReplacing(false);
    };

    const remove = () => {
      keys.clear();
      setStatus({ kind: "idle" });
      setReplacing(false);
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
          <p className="mtl-saved">
            <strong>Key saved.</strong> It is not shown again.
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
                <button type="button" className="mtl-button" onClick={() => (setReplacing(false), setDraft(""))}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
        {saved && !replacing && (
          <div className="mtl-actions">
            <button type="button" className="mtl-button" disabled={status.kind === "checking"} onClick={async () => show(await ask())}>
              Test connection
            </button>
            <button type="button" className="mtl-button" onClick={() => setReplacing(true)}>
              Replace key
            </button>
            <button type="button" className="mtl-button" onClick={remove}>
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
        <p className="mtl-muted">
          The key is kept on this computer, in this app's profile, as plain text. Buzz plugins are not sandboxed, so any other plugin you install could read
          it: install only plugins you trust.
        </p>
      </section>
    );
  };
}
