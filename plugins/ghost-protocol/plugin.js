// src/react.ts
var React;
function provideReact(react) {
	React = react;
}
// src/ui/styles.ts
var CSS = `
.gp-root {
  --gp-ink: var(--text-standard, #e9eef4);
  --gp-muted: var(--text-metadata, #8290a0);
  --gp-bg: var(--surface-base, #0b0d11);
  --gp-card: var(--surface-panel, #12161c);
  --gp-line: var(--border-standard, #2b333d);
  --gp-focus: var(--border-focus, var(--accent-9, #4f9cf9));
  --gp-hover: var(--affordance-row-hover, rgba(128, 140, 160, 0.14));
  display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0;
  background: var(--gp-bg); color: var(--gp-ink); font-size: 13px; line-height: 1.45;
}
.gp-root *, .gp-root *::before, .gp-root *::after { box-sizing: border-box; }
.gp-root :focus-visible { outline: 2px solid var(--gp-focus); outline-offset: 2px; }
.gp-bar { display: flex; align-items: center; flex: none; min-height: 44px; padding: 6px 16px; border-bottom: 1px solid var(--gp-line); }
.gp-title { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; overflow-wrap: anywhere; }
.gp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.gp-panel { max-width: 560px; padding: 18px 20px; border: 1px solid var(--gp-line); border-radius: 4px; background: var(--gp-card);
  display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.gp-panel h2 { margin: 0; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600; }
.gp-status { margin: 0; font-size: 15px; font-weight: 500; overflow-wrap: anywhere; }
.gp-facts { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; }
.gp-facts dt { color: var(--gp-muted); }
.gp-facts dd { margin: 0; font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.gp-note { margin: 0; max-width: 560px; color: var(--gp-muted); }
.gp-button { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border: 1px solid var(--gp-line); border-radius: 4px;
  background: transparent; color: var(--gp-ink); font: inherit; font-weight: 500; cursor: pointer; }
.gp-button:hover:not(:disabled) { background: var(--gp-hover); }
.gp-button:disabled { opacity: 0.5; cursor: default; }
`;
// src/docker.ts
/** The id of the process in manifest.json's `host.processes`. */
var PROCESS_ID = "docker-version";
/** How long Docker has to answer before the check gives up. A daemon that is starting can leave the command waiting. */
var TIMEOUT_MS = 15e3;
/** Characters of output kept: a version is a few, so anything longer is not one. */
var KEPT = 4096;
var WORDS = {
	checking: "Checking Docker…",
	ready: "Docker is running",
	unavailable: "Install or start Docker Desktop",
	unsupported: "This Buzz cannot start programs. Use the Buzz desktop app."
};
var textOf = (state) => WORDS[state];
var VERSION = /^[0-9][0-9A-Za-z._+~-]{0,63}$/;
function versionOf(output) {
	const lines = output.trim().split(/\r?\n/);
	const [line] = lines;
	return lines.length === 1 && line !== void 0 && VERSION.test(line) ? line : void 0;
}
/**
* Runs the check. Resolves with the outcome, or with `undefined` when `signal` aborts first: the process is then stopped and the caller
* has gone. It never rejects.
*/
async function checkDocker(host, signal, timeoutMs = TIMEOUT_MS) {
	if (typeof host.spawn !== "function") return { state: "unsupported" };
	let output = "";
	let process;
	try {
		process = await host.spawn(PROCESS_ID, {
			onStdout(text) {
				if (output.length < KEPT) output += text;
			},
			onStderr() {}
		});
	} catch {
		return signal?.aborted ? void 0 : { state: "unavailable" };
	}
	let timer;
	try {
		const stopped = new Promise((resolve) => {
			timer = setTimeout(() => resolve("timeout"), timeoutMs);
			if (signal?.aborted) resolve("abort");
			else signal?.addEventListener("abort", () => resolve("abort"), { once: true });
		});
		const result = await Promise.race([process.exited, stopped]);
		if (result === "abort" || result === "timeout") {
			await process.kill().catch(() => void 0);
			return result === "abort" ? void 0 : { state: "unavailable" };
		}
		const version = result === 0 ? versionOf(output) : void 0;
		return version === void 0 ? { state: "unavailable" } : {
			state: "ready",
			version
		};
	} catch {
		await process.kill().catch(() => void 0);
		return signal?.aborted ? void 0 : { state: "unavailable" };
	} finally {
		clearTimeout(timer);
	}
}
// src/ui/Page.tsx
function createPage(host) {
	return function GhostProtocolPage() {
		const [state, setState] = React.useState({ state: "checking" });
		const [round, setRound] = React.useState(0);
		React.useEffect(() => {
			const abort = new AbortController();
			setState({ state: "checking" });
			checkDocker(host, abort.signal).then((check) => {
				if (check && !abort.signal.aborted) setState(check);
			});
			return () => abort.abort();
		}, [round]);
		const failed = state.state === "unavailable" || state.state === "unsupported";
		return /* @__PURE__ */ React.createElement("div", { className: "gp-root" }, /* @__PURE__ */ React.createElement("header", { className: "gp-bar" }, /* @__PURE__ */ React.createElement("h1", { className: "gp-title" }, "GHOST Protocol")), /* @__PURE__ */ React.createElement("div", { className: "gp-body" }, /* @__PURE__ */ React.createElement("section", {
			className: "gp-panel",
			"aria-labelledby": "gp-docker"
		}, /* @__PURE__ */ React.createElement("h2", { id: "gp-docker" }, "Docker"), /* @__PURE__ */ React.createElement("p", {
			className: "gp-status",
			role: failed ? "alert" : "status"
		}, textOf(state.state)), state.state === "ready" && /* @__PURE__ */ React.createElement("dl", { className: "gp-facts" }, /* @__PURE__ */ React.createElement("dt", null, "Docker version"), /* @__PURE__ */ React.createElement("dd", null, state.version)), /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "gp-button",
			disabled: state.state === "checking",
			onClick: () => setRound((n) => n + 1)
		}, "Check again")), /* @__PURE__ */ React.createElement("p", { className: "gp-note" }, "GHOST Protocol will run as a container in Docker on this computer. For now this page only checks that Docker is ready.")));
	};
}
// src/index.tsx
var inject = [
	"react",
	"pages",
	"host"
];
function apply(ctx) {
	provideReact(ctx.react);
	ctx.effect(() => {
		const style = document.createElement("style");
		style.dataset.ghostProtocol = "";
		style.textContent = CSS;
		document.head.append(style);
		return () => style.remove();
	});
	ctx.pages.register({
		id: "ghost-protocol",
		title: "GHOST Protocol",
		primary: true,
		layout: "workspace",
		component: createPage(ctx.host)
	});
}
export { apply, inject };
