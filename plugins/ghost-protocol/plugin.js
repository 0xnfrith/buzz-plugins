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
.gp-form { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 100%; }
.gp-input { width: 100%; max-width: 320px; height: 28px; padding: 0 8px; border: 1px solid var(--gp-line); border-radius: 4px;
  background: transparent; color: var(--gp-ink); font: inherit; font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; }
.gp-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.gp-problem { color: var(--text-danger, var(--gp-ink)); overflow-wrap: anywhere; }
.gp-agent p { margin: 0; overflow-wrap: anywhere; }
.gp-agent h2 { text-transform: none; letter-spacing: 0.02em; }
.gp-agent .gp-facts dd { font-family: inherit; }
.gp-agent .gp-facts dd.gp-mono { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; }
.gp-refused { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 10px 12px; border: 1px solid var(--gp-line);
  border-radius: 4px; width: 100%; }
.gp-label { color: var(--gp-muted); }
.gp-steps { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 100%; }
.gp-steps ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; width: 100%; }
.gp-copy { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.gp-code { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; user-select: all;
  padding: 2px 6px; border: 1px solid var(--gp-line); border-radius: 4px; }
`;
// src/docker.ts
/** The id of the process in manifest.json's `host.processes`. */
var PROCESS_ID = "docker";
/** How long Docker has to answer before a call gives up. A daemon that is starting can leave a command waiting. */
var TIMEOUT_MS = 15e3;
/** Characters of output kept from each stream: a version or a one-line error is a few, so anything longer is not one. */
var KEPT = 4096;
/** Characters kept of what a GHOST Protocol call prints: a status is a few hundred, written over several lines. */
var KEPT_OF_GP = 65536;
/** A runner for one host, which stops its calls with `signal`. */
var runnerFor = (host, signal) => (args, timeoutMs = TIMEOUT_MS) => runDocker(host, args, {
	signal,
	timeoutMs,
	keep: KEPT_OF_GP
});
/**
* Runs `docker` with `args` and waits for it to end. Resolves with `undefined` when `options.signal` aborts first: the process is then
* stopped and the caller has gone. It never rejects.
*/
async function runDocker(host, args, options = {}) {
	const { signal, timeoutMs = TIMEOUT_MS, keep = KEPT } = options;
	if (typeof host.spawn !== "function") return { kind: "unsupported" };
	let stdout = "";
	let stderr = "";
	let process;
	try {
		process = await host.spawn(PROCESS_ID, {
			args,
			onStdout(text) {
				if (stdout.length < keep) stdout += text;
			},
			onStderr(text) {
				if (stderr.length < KEPT) stderr += text;
			}
		});
	} catch {
		return signal?.aborted ? void 0 : { kind: "unavailable" };
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
			return result === "abort" ? void 0 : { kind: "unavailable" };
		}
		return {
			kind: "exit",
			code: result,
			stdout,
			stderr
		};
	} catch {
		await process.kill().catch(() => void 0);
		return signal?.aborted ? void 0 : { kind: "unavailable" };
	} finally {
		clearTimeout(timer);
	}
}
var WORDS$1 = {
	checking: "Checking Docker…",
	ready: "Docker is running",
	unavailable: "Install or start Docker Desktop",
	unsupported: "This Buzz cannot start programs. Use the Buzz desktop app."
};
var textOf = (state) => WORDS$1[state];
var VERSION = /^[0-9][0-9A-Za-z._+~-]{0,63}$/;
function versionOf(output) {
	const lines = output.trim().split(/\r?\n/);
	const [line] = lines;
	return lines.length === 1 && line !== void 0 && VERSION.test(line) ? line : void 0;
}
/** `docker version`, asking for the server's version alone. */
var VERSION_ARGS = [
	"version",
	"--format",
	"{{.Server.Version}}"
];
/**
* Asks Docker for its server's version. Resolves with `undefined` when `signal` aborts first: the process is then stopped and the caller
* has gone. It never rejects.
*/
async function checkDocker(host, signal, timeoutMs = TIMEOUT_MS) {
	const ran = await runDocker(host, VERSION_ARGS, {
		signal,
		timeoutMs
	});
	if (ran === void 0) return void 0;
	if (ran.kind === "unsupported") return { state: "unsupported" };
	if (ran.kind === "unavailable" || ran.code !== 0) return { state: "unavailable" };
	const version = versionOf(ran.stdout);
	return version === void 0 ? { state: "unavailable" } : {
		state: "ready",
		version
	};
}
var SLUG = /^[a-z0-9][a-z0-9-]*$/;
var isSlug = (text) => text.length <= 40 && SLUG.test(text);
/** What a person typed, as a slug: trimmed, and in lower case, since the names are. Undefined when it is not one. */
function slugOf(typed) {
	const slug = typed.trim().toLowerCase();
	return isSlug(slug) ? slug : void 0;
}
// src/words.ts
var STATE_WORDS = {
	"needs-claude": "Waiting for a Claude sign-in",
	"needs-auth-tag": "Waiting for the owner's attestation",
	connecting: "Connecting to the relay",
	running: "Running",
	updating: "Updating",
	error: "Error"
};
var RELAY_WORDS = {
	connected: "Connected",
	"refused-not-member": "Refused: not a member",
	unreachable: "Cannot be reached"
};
var CLAUDE_WORDS = {
	active: "Signed in",
	"not-active": "Not signed in"
};
/** The only thing shown when GHOST Protocol speaks an interface this plugin does not know (section 9). */
var OTHER_INTERFACE = "Update this plugin, or update GHOST Protocol";
var WORDS = {
	slugLabel: "Agent name in Docker",
	slugHelp: "The agent's name as Docker has it: its container is gp- followed by this name.",
	slugBad: "Use lower-case letters, digits and - only, starting with a letter or a digit.",
	show: "Show status",
	looking: (container) => `Looking for ${container}…`,
	unreadable: "GHOST Protocol answered, but this plugin could not read the answer.",
	swapping: "Updating. The agent is being swapped for the new version, which can take a minute or two.",
	stopped: (container, dockerState) => `${container} is stopped (${dockerState}).`,
	gone: (container) => `There is no container ${container}.`,
	notAnswering: (container) => `${container} is running, but GHOST Protocol did not answer.`,
	dockerUnavailable: WORDS$1.unavailable,
	unsupported: WORDS$1.unsupported,
	state: "State",
	version: "Version",
	relay: "Relay",
	relayUrl: "Relay address",
	claude: "Claude",
	update: "Update",
	previousVersion: "Previous version",
	publicKey: "Agent's public key",
	noUpdate: "No update is available",
	noPrevious: "None",
	updateAvailable: (version) => version === null ? "An update is available" : `Version ${version} is available`,
	copy: "Copy",
	copied: "Copied",
	copyFailed: "Could not copy. Select the key and copy it.",
	buttons: {
		update: "Update",
		rollback: "Roll back",
		restart: "Restart",
		stop: "Stop"
	},
	working: "Working…",
	updateRequested: "Update requested. The agent finishes its task first, then updates.",
	rollbackRequested: "Roll back requested. Watch the state: it goes to Updating, then back to Running.",
	noUpdateAvailable: "No update is available.",
	updateInProgress: "An update is already in progress.",
	noPreviousVersion: "There is no earlier version to roll back to.",
	noUpdaterRollback: "This agent has no update helper, so it cannot roll back from here.",
	noUpdaterTitle: "This agent has no update helper, so update it by hand. Run these three commands, one after the other:",
	noUpdaterNote: (volume) => `Your data and sign-ins live in the volume ${volume}, so nothing is lost between steps 2 and 3.`,
	restarted: (container) => `Restarted ${container}.`,
	stoppedNow: (container) => `Stopped ${container}.`,
	restartFailed: (container) => `Docker could not restart ${container}.`,
	stopFailed: (container) => `Docker could not stop ${container}.`,
	gpRefused: (code) => `GHOST Protocol refused: ${code}.`,
	gpNotUnderstood: "GHOST Protocol answered in a way this plugin does not understand.",
	dockerFailed: "Docker could not run it.",
	errorCode: "Error code",
	errorMessage: "Message"
};
// src/commands.ts
/** `gp-<slug>`: the agent's container. */
var containerOf = (slug) => {
	if (!isSlug(slug)) throw new Error("not a slug");
	return `gp-${slug}`;
};
/** The status, one JSON object (several lines when it is printed for people). */
var statusArgs = (slug) => [
	"exec",
	containerOf(slug),
	"gp",
	"status",
	"--json"
];
/** Asks GHOST Protocol to update itself once the agent has finished its task. */
var updateArgs = (slug) => [
	"exec",
	containerOf(slug),
	"gp",
	"update",
	"request"
];
/** Asks GHOST Protocol to go back to the version before the last update. */
var rollbackArgs = (slug) => [
	"exec",
	containerOf(slug),
	"gp",
	"update",
	"rollback"
];
var restartArgs = (slug) => ["restart", containerOf(slug)];
var stopArgs = (slug) => ["stop", containerOf(slug)];
/** What the container is doing: `running`, `exited` and so on. It fails when there is no such container. */
var stateArgs = (slug) => [
	"inspect",
	"--format",
	"{{.State.Status}}",
	containerOf(slug)
];
/** The image the container was made from, with its tag. */
var imageArgs = (slug) => [
	"inspect",
	"--format",
	"{{.Config.Image}}",
	containerOf(slug)
];
var STATES = [
	"needs-claude",
	"needs-auth-tag",
	"connecting",
	"running",
	"updating",
	"error"
];
var RELAYS = [
	"connected",
	"refused-not-member",
	"unreachable"
];
var CLAUDES = ["active", "not-active"];
var PUBKEY = /^[0-9a-fA-F]{64}$/;
var GP_LINE = /^GP_[A-Z][A-Z0-9_]*=/;
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isOneOf = (list, value) => typeof value === "string" && list.includes(value);
var isText = (value) => typeof value === "string" && value !== "";
var isTextOrNull = (value) => value === null || typeof value === "string";
/** Reads the whole of stdout as a status. */
function readStatus(stdout) {
	let json;
	try {
		json = JSON.parse(stdout.split(/\r?\n/).filter((line) => !GP_LINE.test(line)).join("\n"));
	} catch {
		return { kind: "unreadable" };
	}
	if (!isObject(json)) return { kind: "unreadable" };
	if (json.interface !== 1) return { kind: "other-interface" };
	const { state, version, agent_pubkey: agentPubkey, relay_url: relayUrl, relay, claude, update, previous_version: previousVersion, error } = json;
	if (!isOneOf(STATES, state) || !isOneOf(RELAYS, relay) || !isOneOf(CLAUDES, claude)) return { kind: "unreadable" };
	if (!isText(version) || typeof agentPubkey !== "string" || !PUBKEY.test(agentPubkey) || typeof relayUrl !== "string") return { kind: "unreadable" };
	if (!isTextOrNull(previousVersion)) return { kind: "unreadable" };
	if (!isObject(update) || typeof update.available !== "boolean" || !isTextOrNull(update.version)) return { kind: "unreadable" };
	if (error !== null && !(isObject(error) && typeof error.code === "string" && typeof error.message === "string")) return { kind: "unreadable" };
	return {
		kind: "status",
		status: {
			state,
			version,
			agentPubkey,
			relayUrl,
			relay,
			claude,
			update: {
				available: update.available,
				version: update.version
			},
			previousVersion,
			error: error === null ? null : {
				code: error.code,
				message: error.message
			}
		}
	};
}
/** The `GP_<KEY>=<value>` lines of stdout (interface note, section 4), by key. A key printed twice keeps its last value. */
function gpLines(stdout) {
	const lines = /* @__PURE__ */ new Map();
	for (const line of stdout.split(/\r?\n/)) {
		const found = /^GP_([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
		if (found?.[1] !== void 0 && found[2] !== void 0) lines.set(found[1], found[2]);
	}
	return lines;
}
// src/actions.ts
/** An update or a roll back waits for the agent to finish its task, and `docker exec` returns at once; this is for a slow Docker. */
var GP_MS = 3e4;
/** `docker stop` gives the container ten seconds before it kills it, and `restart` does that and starts it again. */
var DOCKER_MS = 6e4;
var LINE_MAX = 200;
/** The first non-empty line of what Docker said, cut to a length that fits a line. */
function firstLine(text) {
	const line = text.split(/\r?\n/).find((one) => one.trim() !== "")?.trim() ?? "";
	return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX)}…` : line;
}
var withDetail = (text, detail) => detail === "" ? text : `${text} ${detail}`;
/** The outcome of a call that did not end at all: no Docker, or a Buzz that cannot start a process. */
function notRun(ran) {
	if (ran.kind === "unsupported") return {
		tone: "problem",
		text: WORDS.unsupported
	};
	if (ran.kind === "unavailable") return {
		tone: "problem",
		text: WORDS.dockerUnavailable
	};
}
/**
* `gp update request`, or `gp update rollback`. Resolves with `undefined` when the caller left first.
* The answers are the interface note's (answer 4, and `no-updater`): `GP_UPDATE=requested` or `rollback-requested` on exit 0, and on a
* failure a `GP_ERROR` that is `no-updater`, `no-update-available`, `update-in-progress` or `no-previous-version`, or another code.
*/
async function askToUpdate(run, slug, which) {
	const ran = await run(which === "update" ? updateArgs(slug) : rollbackArgs(slug), GP_MS);
	if (ran === void 0) return void 0;
	const failed = notRun(ran);
	if (failed) return failed;
	if (ran.kind !== "exit") return void 0;
	const lines = gpLines(ran.stdout);
	if (ran.code === 0) {
		const answer = lines.get("UPDATE");
		if (which === "update" && answer === "requested") return {
			tone: "ok",
			text: WORDS.updateRequested
		};
		if (which === "rollback" && answer === "rollback-requested") return {
			tone: "ok",
			text: WORDS.rollbackRequested
		};
		return {
			tone: "problem",
			text: WORDS.gpNotUnderstood
		};
	}
	const code = lines.get("ERROR");
	if (code === void 0) return {
		tone: "problem",
		text: withDetail(WORDS.dockerFailed, firstLine(ran.stderr))
	};
	if (code === "no-updater") return {
		tone: "info",
		text: which === "update" ? WORDS.noUpdaterTitle : WORDS.noUpdaterRollback,
		noUpdater: true
	};
	if (code === "no-update-available") return {
		tone: "info",
		text: WORDS.noUpdateAvailable
	};
	if (code === "update-in-progress") return {
		tone: "info",
		text: WORDS.updateInProgress
	};
	if (code === "no-previous-version") return {
		tone: "info",
		text: WORDS.noPreviousVersion
	};
	const message = lines.get("ERROR_MESSAGE");
	return {
		tone: "problem",
		text: message === void 0 || message === "" ? WORDS.gpRefused(code) : `${message} (${code})`
	};
}
/** `docker restart gp-<slug>` or `docker stop gp-<slug>`. Resolves with `undefined` when the caller left first. */
async function askDocker(run, slug, which) {
	const container = containerOf(slug);
	const ran = await run(which === "restart" ? restartArgs(slug) : stopArgs(slug), DOCKER_MS);
	if (ran === void 0) return void 0;
	const failed = notRun(ran);
	if (failed) return failed;
	if (ran.kind !== "exit") return void 0;
	if (ran.code === 0) return {
		tone: "ok",
		text: which === "restart" ? WORDS.restarted(container) : WORDS.stoppedNow(container)
	};
	return {
		tone: "problem",
		text: withDetail(which === "restart" ? WORDS.restartFailed(container) : WORDS.stopFailed(container), firstLine(ran.stderr))
	};
}
// src/observe.ts
/** About how often the screen looks, in milliseconds. */
var POLL_MS = 1e4;
var NOTHING_YET = {
	lastState: void 0,
	gapSince: void 0,
	asked: void 0
};
/** The memory after the screen asked for an update or a roll back, while the agent was on `version`. */
var askedFor = (before, version) => ({
	...before,
	asked: {
		from: version,
		sawUpdating: false
	}
});
/** What a status does to an ask that is under way: the new version ends it, and so does an update that ended on the old one. */
function afterStatus(asked, status) {
	if (asked === void 0 || status.version !== asked.from) return void 0;
	if (status.state === "updating") return {
		from: asked.from,
		sawUpdating: true
	};
	return asked.sawUpdating ? void 0 : asked;
}
/** What Docker says of a container that is not there: `Error: No such object: gp-x`, or `No such container: gp-x`. */
var NOT_THERE = /No such (object|container)/i;
/** Looks once. Resolves with `undefined` when the caller left first (the runner returns nothing). */
async function observe(run, slug, before, now) {
	const asked = await run(statusArgs(slug));
	if (asked === void 0) return void 0;
	if (asked.kind === "unsupported") return {
		view: { kind: "unsupported" },
		memory: before
	};
	if (asked.kind === "unavailable") return {
		view: { kind: "docker-unavailable" },
		memory: before
	};
	if (asked.code === 0) {
		const read = readStatus(asked.stdout);
		if (read.kind === "status") {
			const memory = {
				lastState: read.status.state,
				gapSince: void 0,
				asked: afterStatus(before.asked, read.status)
			};
			return {
				view: {
					kind: "status",
					status: read.status
				},
				memory
			};
		}
		return {
			view: { kind: read.kind },
			memory: before
		};
	}
	const inspected = await run(stateArgs(slug));
	if (inspected === void 0) return void 0;
	if (inspected.kind === "unsupported") return {
		view: { kind: "unsupported" },
		memory: before
	};
	if (inspected.kind === "unavailable") return {
		view: { kind: "docker-unavailable" },
		memory: before
	};
	let view;
	if (inspected.code === 0) {
		const dockerState = inspected.stdout.trim();
		if (dockerState === "running") {
			const lines = gpLines(asked.stdout);
			view = {
				kind: "not-answering",
				code: lines.get("ERROR"),
				message: lines.get("ERROR_MESSAGE")
			};
		} else view = {
			kind: "stopped",
			dockerState
		};
	} else if (NOT_THERE.test(inspected.stderr)) view = { kind: "gone" };
	else return {
		view: { kind: "docker-unavailable" },
		memory: before
	};
	if (before.lastState !== "updating" && before.asked === void 0) return {
		view,
		memory: before
	};
	const gapSince = before.gapSince ?? now;
	return {
		view: now - gapSince < 12e4 ? { kind: "swapping" } : view,
		memory: {
			...before,
			gapSince
		}
	};
}
/**
* The image the container was made from, as Docker prints it (`registry/ghost-protocol:1.2.3`), or undefined when it cannot be read.
* Resolves with `undefined` as well when the caller left first.
*/
async function imageOf(run, slug) {
	const ran = await run(imageArgs(slug));
	if (ran === void 0 || ran.kind !== "exit" || ran.code !== 0) return void 0;
	const image = ran.stdout.trim();
	return image === "" ? void 0 : image;
}
var NAME = /^[a-z0-9][a-z0-9._/:-]*$/;
var TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
/** The image's name without its tag (`registry.example.com:5000/team/ghost-protocol` from `…/ghost-protocol:1.2.3`), when it is safe. */
function imageNameOf(image) {
	if (image === void 0) return void 0;
	const colon = image.lastIndexOf(":");
	const name = colon > image.lastIndexOf("/") ? image.slice(0, colon) : image;
	return NAME.test(name) ? name : void 0;
}
var versionIfSafe = (version) => version !== null && version !== void 0 && TAG.test(version) ? version : void 0;
/** The three commands, in order: pull the new version, remove the container, start it again on the same data volume. */
function updateByHand(slug, image, newVersion) {
	const container = containerOf(slug);
	const reference = `${imageNameOf(image) ?? "<agent image>"}:${versionIfSafe(newVersion) ?? "<new version>"}`;
	return [
		`docker pull ${reference}`,
		`docker rm -f ${container}`,
		`docker run -d --name ${container} --restart unless-stopped -v ${container}-data:/data ${reference}`
	];
}
// src/ui/copy.ts
/**
* Puts `text` on the clipboard and says whether it got there. The webview may refuse the async clipboard (a click that came too long
* after the press, or no permission), so the older copy command is the second try.
*/
async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {}
	try {
		const area = document.createElement("textarea");
		area.value = text;
		area.setAttribute("readonly", "");
		area.style.position = "fixed";
		area.style.opacity = "0";
		document.body.append(area);
		area.select();
		const copied = document.execCommand("copy");
		area.remove();
		return copied;
	} catch {
		return false;
	}
}
// src/ui/StatusScreen.tsx
/** The most of a text from GHOST Protocol that the screen shows: a long one is cut, so it cannot fill the page. */
var SHOWN_MAX = 300;
var clip = (text) => text.length > SHOWN_MAX ? `${text.slice(0, SHOWN_MAX)}…` : text;
/** A line of what the screen has to say, and whether it is a problem (it is then an alert). */
var lineOf = (view, container) => {
	if (view === void 0) return {
		text: WORDS.looking(container),
		problem: false
	};
	switch (view.kind) {
		case "status": return {
			text: STATE_WORDS[view.status.state],
			problem: view.status.state === "error"
		};
		case "other-interface": return {
			text: OTHER_INTERFACE,
			problem: true
		};
		case "unreadable": return {
			text: WORDS.unreadable,
			problem: true
		};
		case "swapping": return {
			text: WORDS.swapping,
			problem: false
		};
		case "stopped": return {
			text: WORDS.stopped(container, view.dockerState),
			problem: true
		};
		case "gone": return {
			text: WORDS.gone(container),
			problem: true
		};
		case "not-answering": return {
			text: WORDS.notAnswering(container),
			problem: true
		};
		case "docker-unavailable": return {
			text: WORDS.dockerUnavailable,
			problem: true
		};
		case "unsupported": return {
			text: WORDS.unsupported,
			problem: true
		};
	}
};
/** One command to run in a terminal, with a button that copies it. */
function CopyBlock({ text }) {
	const [result, setResult] = React.useState();
	return /* @__PURE__ */ React.createElement("div", { className: "gp-copy" }, /* @__PURE__ */ React.createElement("code", { className: "gp-code" }, text), /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "gp-button",
		onClick: () => void copyText(text).then((copied) => setResult(copied ? "copied" : "failed"))
	}, result === "copied" ? WORDS.copied : WORDS.copy), result === "failed" && /* @__PURE__ */ React.createElement("span", { role: "alert" }, WORDS.copyFailed));
}
function Facts({ status }) {
	return /* @__PURE__ */ React.createElement("dl", { className: "gp-facts" }, /* @__PURE__ */ React.createElement("dt", null, WORDS.state), /* @__PURE__ */ React.createElement("dd", null, STATE_WORDS[status.state]), /* @__PURE__ */ React.createElement("dt", null, WORDS.version), /* @__PURE__ */ React.createElement("dd", { className: "gp-mono" }, clip(status.version)), /* @__PURE__ */ React.createElement("dt", null, WORDS.relay), /* @__PURE__ */ React.createElement("dd", null, RELAY_WORDS[status.relay]), /* @__PURE__ */ React.createElement("dt", null, WORDS.relayUrl), /* @__PURE__ */ React.createElement("dd", { className: "gp-mono" }, clip(status.relayUrl)), /* @__PURE__ */ React.createElement("dt", null, WORDS.claude), /* @__PURE__ */ React.createElement("dd", null, CLAUDE_WORDS[status.claude]), /* @__PURE__ */ React.createElement("dt", null, WORDS.update), /* @__PURE__ */ React.createElement("dd", null, status.update.available ? WORDS.updateAvailable(status.update.version === null ? null : clip(status.update.version)) : WORDS.noUpdate), /* @__PURE__ */ React.createElement("dt", null, WORDS.previousVersion), /* @__PURE__ */ React.createElement("dd", { className: status.previousVersion === null ? void 0 : "gp-mono" }, status.previousVersion === null ? WORDS.noPrevious : clip(status.previousVersion)));
}
/**
* The status of one agent, found by the `<slug>` of its container `gp-<slug>`: what `gp status --json` says, and the four buttons. It
* looks about every ten seconds for as long as it is on the page, and its calls end with it.
*/
function createStatusScreen(host) {
	return function StatusScreen({ slug }) {
		const container = containerOf(slug);
		const [view, setView] = React.useState();
		const [looks, setLooks] = React.useState(0);
		const memory = React.useRef(NOTHING_YET);
		React.useEffect(() => {
			const abort = new AbortController();
			const run = runnerFor(host, abort.signal);
			let timer;
			const look = async () => {
				const seen = await observe(run, slug, memory.current, Date.now());
				if (seen === void 0 || abort.signal.aborted) return;
				memory.current = seen.memory;
				setView(seen.view);
				timer = setTimeout(() => void look(), POLL_MS);
			};
			look();
			return () => {
				abort.abort();
				clearTimeout(timer);
			};
		}, [slug, looks]);
		const life = React.useRef(void 0);
		React.useEffect(() => {
			const abort = new AbortController();
			life.current = abort;
			return () => abort.abort();
		}, []);
		const [working, setWorking] = React.useState();
		const [outcome, setOutcome] = React.useState();
		const [byHand, setByHand] = React.useState();
		const press = async (job) => {
			const signal = life.current?.signal;
			if (signal === void 0 || signal.aborted || working !== void 0) return;
			const run = runnerFor(host, signal);
			setWorking(job);
			setOutcome(void 0);
			const done = job === "update" || job === "rollback" ? await askToUpdate(run, slug, job) : await askDocker(run, slug, job);
			if (done === void 0 || signal.aborted) return;
			const byHandNow = done.noUpdater === true && job === "update";
			const image = byHandNow ? await imageOf(run, slug) : void 0;
			if (signal.aborted) return;
			if (byHandNow) setByHand({ image });
			if (done.tone === "ok" && (job === "update" || job === "rollback") && status !== void 0) memory.current = askedFor(memory.current, status.version);
			setWorking(void 0);
			setOutcome(byHandNow ? void 0 : done);
			setLooks((n) => n + 1);
		};
		const { text, problem } = lineOf(view, container);
		const status = view?.kind === "status" ? view.status : void 0;
		const kind = view?.kind;
		const buttons = {
			update: kind === "status" && byHand === void 0,
			rollback: kind === "status",
			restart: kind === "status" || kind === "not-answering" || kind === "stopped",
			stop: kind === "status" || kind === "not-answering"
		};
		const busy = working !== void 0;
		const button = (job, label, disabled = false) => /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "gp-button",
			disabled: busy || disabled,
			onClick: () => void press(job)
		}, label);
		return /* @__PURE__ */ React.createElement("section", {
			className: "gp-panel gp-agent",
			"aria-labelledby": "gp-agent-title"
		}, /* @__PURE__ */ React.createElement("h2", { id: "gp-agent-title" }, container), /* @__PURE__ */ React.createElement("p", {
			className: "gp-status",
			role: problem ? "alert" : "status"
		}, text), view?.kind === "not-answering" && (view.code !== void 0 || view.message !== void 0) && /* @__PURE__ */ React.createElement("p", { className: "gp-note" }, clip([view.message, view.code === void 0 ? void 0 : `(${view.code})`].filter(Boolean).join(" "))), status && /* @__PURE__ */ React.createElement(Facts, { status }), status?.error && /* @__PURE__ */ React.createElement("dl", { className: "gp-facts gp-problem" }, /* @__PURE__ */ React.createElement("dt", null, WORDS.errorCode), /* @__PURE__ */ React.createElement("dd", { className: "gp-mono" }, clip(status.error.code)), /* @__PURE__ */ React.createElement("dt", null, WORDS.errorMessage), /* @__PURE__ */ React.createElement("dd", null, clip(status.error.message))), status?.relay === "refused-not-member" && /* @__PURE__ */ React.createElement("div", {
			className: "gp-refused",
			role: "alert"
		}, /* @__PURE__ */ React.createElement("p", null, "Your relay does not accept owner attestations. Ask its admin to turn them on, or to add this agent as a relay member."), /* @__PURE__ */ React.createElement("p", { className: "gp-label" }, WORDS.publicKey), /* @__PURE__ */ React.createElement(CopyBlock, { text: status.agentPubkey })), (buttons.update || buttons.rollback || buttons.restart || buttons.stop) && /* @__PURE__ */ React.createElement("div", { className: "gp-buttons" }, buttons.update && button("update", WORDS.buttons.update), buttons.rollback && button("rollback", WORDS.buttons.rollback, status?.previousVersion === null), buttons.restart && button("restart", WORDS.buttons.restart), buttons.stop && button("stop", WORDS.buttons.stop)), busy && /* @__PURE__ */ React.createElement("p", { role: "status" }, WORDS.working), outcome && /* @__PURE__ */ React.createElement("p", {
			className: outcome.tone === "problem" ? "gp-problem" : void 0,
			role: outcome.tone === "problem" ? "alert" : "status"
		}, outcome.text), byHand && status && /* @__PURE__ */ React.createElement("div", { className: "gp-steps" }, /* @__PURE__ */ React.createElement("p", null, WORDS.noUpdaterTitle), /* @__PURE__ */ React.createElement("ol", null, updateByHand(slug, byHand.image, status.update.version).map((step) => /* @__PURE__ */ React.createElement("li", { key: step }, /* @__PURE__ */ React.createElement(CopyBlock, { text: step })))), /* @__PURE__ */ React.createElement("p", { className: "gp-note" }, WORDS.noUpdaterNote(`${container}-data`))));
	};
}
// src/ui/Page.tsx
function createPage(host) {
	const StatusScreen = createStatusScreen(host);
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
		const [typed, setTyped] = React.useState("");
		const [shown, setShown] = React.useState();
		const [rejected, setRejected] = React.useState(false);
		const show = () => {
			const slug = slugOf(typed);
			setRejected(slug === void 0);
			if (slug !== void 0) setShown(slug);
		};
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
		}, "Check again")), /* @__PURE__ */ React.createElement("section", {
			className: "gp-panel",
			"aria-labelledby": "gp-agent-form"
		}, /* @__PURE__ */ React.createElement("h2", { id: "gp-agent-form" }, "Agent"), /* @__PURE__ */ React.createElement("form", {
			className: "gp-form",
			onSubmit: (event) => {
				event.preventDefault();
				show();
			}
		}, /* @__PURE__ */ React.createElement("label", { htmlFor: "gp-slug" }, WORDS.slugLabel), /* @__PURE__ */ React.createElement("input", {
			id: "gp-slug",
			className: "gp-input",
			type: "text",
			value: typed,
			autoComplete: "off",
			spellCheck: false,
			maxLength: 80,
			"aria-invalid": rejected,
			"aria-describedby": "gp-slug-help",
			onChange: (event) => setTyped(event.target.value)
		}), /* @__PURE__ */ React.createElement("p", {
			id: "gp-slug-help",
			className: "gp-note"
		}, WORDS.slugHelp), rejected && /* @__PURE__ */ React.createElement("p", {
			className: "gp-problem",
			role: "alert"
		}, WORDS.slugBad), /* @__PURE__ */ React.createElement("button", {
			type: "submit",
			className: "gp-button"
		}, WORDS.show))), shown !== void 0 && /* @__PURE__ */ React.createElement(StatusScreen, {
			key: shown,
			slug: shown
		}), /* @__PURE__ */ React.createElement("p", { className: "gp-note" }, "GHOST Protocol runs as a container in Docker on this computer. This page checks Docker and shows an agent's status.")));
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
