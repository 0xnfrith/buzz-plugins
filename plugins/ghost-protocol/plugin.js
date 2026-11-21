var manifest_default = {
	id: "megatech.ghost-protocol",
	name: "GHOST Protocol",
	apiVersion: 1,
	description: "Makes a GHOST Protocol agent in Docker on your computer from New agent, and shows how it is doing: its state, version and relay, with Update, Roll back, Restart and Stop. Needs Docker Desktop.",
	discovery: {
		"category": "agents",
		"tags": [
			"GHOST Protocol",
			"Docker",
			"Agents"
		]
	},
	host: {
		"commands": [{
			"id": "version",
			"program": "docker",
			"args": [
				"version",
				"--format",
				"{{.Server.Version}}"
			]
		}],
		"processes": [
			{
				"id": "pull",
				"program": "docker",
				"args": ["pull", "ghcr.io/0xnfrith/ghost-protocol:0.15.2@sha256:256dda44a35cdc8306cccd940e66066fb614bad4ecd2d259066d8d32cf84acc0"]
			},
			{
				"id": "run-init",
				"program": "docker",
				"args": [
					"run",
					"--rm",
					"-v"
				]
			},
			{
				"id": "run-agent",
				"program": "docker",
				"args": [
					"run",
					"-d",
					"--restart",
					"unless-stopped",
					"--name"
				]
			},
			{
				"id": "run-updater",
				"program": "docker",
				"args": [
					"run",
					"-d",
					"--restart",
					"unless-stopped",
					"-v",
					"/var/run/docker.sock:/var/run/docker.sock",
					"--name"
				]
			},
			{
				"id": "exec",
				"program": "docker",
				"args": ["exec"]
			},
			{
				"id": "inspect-state",
				"program": "docker",
				"args": [
					"inspect",
					"--format",
					"{{.State.Status}}"
				]
			},
			{
				"id": "inspect-image",
				"program": "docker",
				"args": [
					"inspect",
					"--format",
					"{{.Config.Image}}"
				]
			},
			{
				"id": "restart",
				"program": "docker",
				"args": ["restart"]
			},
			{
				"id": "stop",
				"program": "docker",
				"args": ["stop"]
			},
			{
				"id": "rm",
				"program": "docker",
				"args": ["rm", "-f"]
			},
			{
				"id": "volume-rm",
				"program": "docker",
				"args": ["volume", "rm"]
			}
		]
	}
};
// src/docker.ts
/** The id of the command in manifest.json's `host.commands`: `docker version --format {{.Server.Version}}`, all of it fixed there. */
var COMMAND = { version: "version" };
/** The ids of the processes in manifest.json's `host.processes`, and the leading arguments each fixes there. */
var PROCESS = {
	/** `exec`: the container's name and the command in it follow. */
	exec: "exec",
	/** `inspect --format {{.State.Status}}`: the container's name follows. */
	inspectState: "inspect-state",
	/** `inspect --format {{.Config.Image}}`: the container's name follows. */
	inspectImage: "inspect-image",
	/** `restart`: the container's name follows. */
	restart: "restart",
	/** `stop`: the container's name follows. */
	stop: "stop",
	/** `pull <image>`: the one image, named in the manifest, so the call has no words of its own. */
	pull: "pull",
	/** `run --rm -v`: makes the agent's key in its data volume. The volume, the image and `init ...` follow. */
	runInit: "run-init",
	/** `run -d --restart unless-stopped --name`: starts the agent. Its name, volume and image follow. */
	runAgent: "run-agent",
	/** `run -d --restart unless-stopped -v /var/run/docker.sock:/var/run/docker.sock --name`: starts the update helper, the one entry that mounts the Docker socket. */
	runUpdater: "run-updater",
	/** `rm -f`: the agent's container and its helper follow. */
	rm: "rm",
	/** `volume rm`: the agent's data volume follows. */
	volumeRm: "volume-rm"
};
/** How long Docker has to answer before a call gives up. A daemon that is starting can leave a command waiting. */
var TIMEOUT_MS = 15e3;
/** Characters of output kept from each stream: a version or a one-line error is a few, so anything longer is not one. */
var KEPT$1 = 4096;
/** Characters kept of what a GHOST Protocol call prints: a status is a few hundred, written over several lines. */
var KEPT_OF_GP = 65536;
/** A runner for one host, which stops its calls with `signal`. */
var runnerFor = (host, signal) => (call, timeoutMs = TIMEOUT_MS) => runDocker(host, call, {
	signal,
	timeoutMs,
	keep: KEPT_OF_GP
});
/**
* Runs `call` and waits for it to end. Resolves with `undefined` when `options.signal` aborts first: the process is then stopped and the
* caller has gone. It never rejects.
*/
async function runDocker(host, call, options = {}) {
	const { signal, timeoutMs = TIMEOUT_MS, keep = KEPT$1 } = options;
	if (typeof host.spawn !== "function") return { kind: "unsupported" };
	let stdout = "";
	let stderr = "";
	let process;
	try {
		process = await host.spawn(call.process, {
			args: call.args,
			onStdout(text) {
				if (stdout.length < keep) stdout += text;
			},
			onStderr(text) {
				if (stderr.length < KEPT$1) stderr += text;
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
var WORDS$2 = {
	checking: "Checking Docker…",
	ready: "Docker is running",
	unavailable: "Docker didn't answer. Install or start Docker Desktop, then retry.",
	unsupported: "This Buzz cannot start programs. Use the Buzz desktop app."
};
var textOf = (state) => WORDS$2[state];
var VERSION = /^[0-9][0-9A-Za-z._+~-]{0,63}$/;
function versionOf(output) {
	const lines = output.trim().split(/\r?\n/);
	const [line] = lines;
	return lines.length === 1 && line !== void 0 && VERSION.test(line) ? line : void 0;
}
/**
* Asks Docker for its server's version, through the declared `version` command. The host gives it 5 seconds and says nothing of why it
* failed. Resolves with `undefined` when `signal` aborts first, and the answer is then ignored: a command cannot be stopped. It never
* rejects.
*/
async function checkDocker(host, signal) {
	if (typeof host.runCommand !== "function") return { state: "unsupported" };
	let output;
	try {
		output = await host.runCommand(COMMAND.version);
	} catch {
		output = null;
	}
	if (signal?.aborted) return void 0;
	const version = typeof output === "string" ? versionOf(output) : void 0;
	return version === void 0 ? { state: "unavailable" } : {
		state: "ready",
		version
	};
}
/**
* `spawn` for the create flow, which needs a process it can write to and read from as it runs. Undefined in a Buzz with no `spawn` (the
* web build). This is, with `runDocker`, the only place the plugin starts a process.
*/
function startOn(host) {
	if (typeof host.spawn !== "function") return void 0;
	return (call, handlers) => host.spawn(call.process, {
		args: call.args,
		onStdout: handlers.onStdout,
		onStderr: handlers.onStderr
	});
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
/** `refused-not-member` is GHOST Protocol's text for it, to the letter. */
var REFUSED_NOT_MEMBER = "Your relay does not accept owner attestations. Ask its admin to turn them on, or to add this agent as a relay member.";
var RELAY_WORDS = {
	connected: "Connected",
	"refused-not-member": "Refused: not a member",
	unreachable: "Cannot be reached"
};
var CLAUDE_WORDS = {
	active: "Active",
	"not-active": "Not active"
};
/** The only thing shown when GHOST Protocol speaks an interface this plugin does not know (GHOST Protocol's interface). */
var OTHER_INTERFACE = "Update this plugin, or update GHOST Protocol";
var WORDS$1 = {
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
	dockerUnavailable: WORDS$2.unavailable,
	unsupported: WORDS$2.unsupported,
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
	noUpdaterDigest: "Before you run anything, replace <digest of that version> in steps 1 and 3 with the sha256 digest of the new version's image: the image is pinned by digest, so a tag that is moved later cannot change what runs. Step 1 does not run until you have. Run step 2 only once step 1 has pulled the image without an error, because step 2 removes the container.",
	noUpdaterPinned: "The image is pinned by digest, so a tag that is moved later cannot change what runs. Run step 2 only once step 1 has pulled the image without an error, because step 2 removes the container.",
	noUpdaterRefusedTitle: "This agent has no update helper, so update it by hand.",
	noUpdaterRefused: "GHOST Protocol named an image for this update that is not pinned by digest, so this plugin shows no commands for it. Nothing was run.",
	noUpdaterChanged: "The update on offer has changed since these steps were shown. They are still for the earlier one: leave this screen and open it again to see the new one.",
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
// src/gp/constants.ts
/**
* The image's form: a registry (with a port, if it has one) and a path ending in `ghost-protocol`, a tag that is not `latest`, and a sha256
* digest of 64 lower-case hex digits. A bare tag, a bare digest, a short or upper-case digest and anything after the digest are not it.
*/
var PINNED_IMAGE = /^(?!.*\/ghost-protocol:latest@)[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*\/ghost-protocol:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}@sha256:[0-9a-f]{64}$/;
/**
* The agent's one image, pinned: `<registry>/ghost-protocol:<exact tag>@sha256:<64 lower-case hex>`, as the `pull` process in manifest.json
* names it (that is the only place it is written, so the review shows the image the plugin may pull and the code runs the same one). The
* tag tells a person which version it is; the digest is what Docker checks, and a tag can be moved after it was tested where a digest
* cannot. A bare tag and a bare digest are refused: the image is then an empty name, so the pull does not begin with the words the manifest
* declares and Create stops before it runs anything. The manifest names the public image `ghcr.io/0xnfrith/ghost-protocol` at version
* 0.15.2 by the digest that release pins, so Docker finds it by that digest: the plain `0.15.2` tag only exists once the release is
* promoted from a pre-release. A new release is a new tag and digest in that one entry.
*/
var IMAGE = pinnedOrNothing((manifest_default.host.processes.find((process) => process.id === "pull")?.args ?? [])[1]);
function pinnedOrNothing(image) {
	return image !== void 0 && PINNED_IMAGE.test(image) ? image : "";
}
/**
* What the update helper runs, after the image and before `--target gp-<slug>`: the agent's own image with a different command, which
* GHOST Protocol has fixed as `updater --target gp-<slug>`.
*/
var UPDATER_COMMAND = ["updater"];
var CLAUDE_LEADS = "token";
/** The words the interface and the brief fix; the three that the status screen shows too are its own constants. */
var WORDS = {
	selfUpdateQuestion: "Let GHOST Protocol update itself? It needs control of Docker to swap in new versions. You can say no and update by hand.",
	docker: WORDS$2.unavailable,
	unknownInterface: OTHER_INTERFACE,
	refused: REFUSED_NOT_MEMBER,
	hostedSoon: "Hosted is coming soon."
};
/** How long each command may take before Create gives up on it. */
var LIMITS = {
	/** The image is large. */
	pull: 9e5,
	init: 12e4,
	start: 6e4,
	quick: 3e4,
	/** The person has to sign in with Claude and copy a code back. */
	login: 9e5,
	/** From the agent starting to `running`. */
	running: 12e4,
	/** Between two looks at `gp status --json` while Create waits. */
	pollMs: 1500
};
// src/gp/config.ts
/** A new agent's settings: the way Claude leads with is `leads`, which is `CLAUDE_LEADS` unless a test asks for the other. */
var startingConfig = (leads = CLAUDE_LEADS) => ({
	place: "local",
	selfUpdate: null,
	claudeWay: leads
});
function chosenFrom(config) {
	const value = typeof config === "object" && config !== null ? config : {};
	if (value.place === "hosted") return { problem: "Hosted is coming soon." };
	if (value.place !== "local") return { problem: "Choose where the agent runs." };
	if (typeof value.selfUpdate !== "boolean") return { problem: "Answer the question about updating itself." };
	if (value.claudeWay !== "login" && value.claudeWay !== "token") return { problem: "Choose how to sign in to Claude." };
	return {
		selfUpdate: value.selfUpdate,
		claudeWay: value.claudeWay
	};
}
var SLUG = /^[a-z0-9][a-z0-9-]*$/;
var isSlug = (text) => text.length <= 40 && SLUG.test(text);
/** What a person typed, as a slug: trimmed, and in lower case, since the names are. Undefined when it is not one. */
function slugOf(typed) {
	const slug = typed.trim().toLowerCase();
	return isSlug(slug) ? slug : void 0;
}
// src/commands.ts
/** `gp-<slug>`: the agent's container. */
var containerOf = (slug) => {
	if (!isSlug(slug)) throw new Error("not a slug");
	return `gp-${slug}`;
};
/** `docker exec gp-<slug> gp status --json`: the status, one JSON object (several lines when it is printed for people). */
var statusCall = (slug) => ({
	process: PROCESS.exec,
	args: [
		containerOf(slug),
		"gp",
		"status",
		"--json"
	]
});
/** `docker exec gp-<slug> gp update request`: asks GHOST Protocol to update itself once the agent has finished its task. */
var updateCall = (slug) => ({
	process: PROCESS.exec,
	args: [
		containerOf(slug),
		"gp",
		"update",
		"request"
	]
});
/** `docker exec gp-<slug> gp update rollback`: asks GHOST Protocol to go back to the version before the last update. */
var rollbackCall = (slug) => ({
	process: PROCESS.exec,
	args: [
		containerOf(slug),
		"gp",
		"update",
		"rollback"
	]
});
/** `docker restart gp-<slug>` */
var restartCall = (slug) => ({
	process: PROCESS.restart,
	args: [containerOf(slug)]
});
/** `docker stop gp-<slug>` */
var stopCall = (slug) => ({
	process: PROCESS.stop,
	args: [containerOf(slug)]
});
/** `docker inspect --format {{.State.Status}} gp-<slug>`: what the container is doing (`running`, `exited`…). It fails when there is no such container. */
var stateCall = (slug) => ({
	process: PROCESS.inspectState,
	args: [containerOf(slug)]
});
/** `docker inspect --format {{.Config.Image}} gp-<slug>`: the image the container was made from, with its tag. */
var imageCall = (slug) => ({
	process: PROCESS.inspectImage,
	args: [containerOf(slug)]
});
// src/gp/names.ts
/**
* Lower-case letters, digits and `-`, made from the agent's name: accents drop to their letter, every other run of characters becomes one
* `-`, and none stands at either end. `undefined` when nothing is left (a name with no letter or digit docker accepts). What it makes is
* always a slug in src/slug.ts's sense, which `containerOf` checks.
*/
function slugFromName(name) {
	const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 40).replace(/-+$/, "");
	return slug === "" ? void 0 : slug;
}
/** The update helper beside the agent. Its dot is a character no slug has, so it can never be an agent's name. */
var updaterOf = (slug) => `${containerOf(slug)}.updater`;
/** The data volume: the agent's key, memory, attestation and Claude sign-in. */
var volumeOf = (slug) => `${containerOf(slug)}-data`;
/** The agent's name as `init --name` takes it: one line, with no flag-like start. */
function nameForInit(name, slug) {
	const line = name.replace(/\s+/g, " ").trim().replace(/^[-\s]+/, "");
	return line === "" ? slug : line;
}
// src/gp/processes.ts
/** The words after `docker` that a process fixes, by its id. */
var DECLARED = Object.fromEntries(manifest_default.host.processes.map((process) => [process.id, process.args]));
// src/gp/commands.ts
/** The Docker socket, as Docker Desktop on macOS and Windows and Docker on Linux all take it. */
var SOCKET = "/var/run/docker.sock";
function make(process, ...line) {
	const fixed = DECLARED[process] ?? [];
	if (fixed.some((word, at) => line[at] !== word)) throw new Error(`"${line.join(" ")}" does not begin with the words of ${process}`);
	return {
		process,
		args: line.slice(fixed.length)
	};
}
/**
* The agent's image, pinned by tag and digest. An image that is not (constants.ts) is an empty name, and no command is built with an empty
* name: not the pull, which would not begin with the manifest's words, and not a `docker run` either, which would get an empty image.
*/
function pinned() {
	if (IMAGE === "") throw new Error("the agent's image is not pinned by tag and digest");
	return IMAGE;
}
var commands$1 = {
	/** The agent's image. */
	pull: () => make(PROCESS.pull, "pull", pinned()),
	/** Makes the agent's key in its data volume and prints its public key. The same volume gives the same key. */
	init: (slug, name, relay, owner) => make(PROCESS.runInit, "run", "--rm", "-v", `${volumeOf(slug)}:/data`, pinned(), "init", "--name", name, "--relay", relay, "--owner", owner),
	/** The container's state, or docker's "no such object" when it is not there. The helper's too: it is a container. */
	state: (container) => make(PROCESS.inspectState, "inspect", "--format", "{{.State.Status}}", container),
	/** The agent. */
	start: (slug) => make(PROCESS.runAgent, "run", "-d", "--restart", "unless-stopped", "--name", containerOf(slug), "-v", `${volumeOf(slug)}:/data`, pinned()),
	/** The update helper: the agent's own image and tag with another command, and the Docker socket. Only after a yes. */
	startUpdater: (slug) => make(PROCESS.runUpdater, "run", "-d", "--restart", "unless-stopped", "-v", `${SOCKET}:${SOCKET}`, "--name", updaterOf(slug), pinned(), ...UPDATER_COMMAND, "--target", containerOf(slug)),
	/** A container that exists and is not running. */
	restart: (container) => make(PROCESS.restart, "restart", container),
	/** The owner's attestation on stdin. */
	authTagSet: (slug) => make(PROCESS.exec, "exec", "-i", containerOf(slug), "gp", "auth-tag", "set"),
	claudeStatus: (slug) => make(PROCESS.exec, "exec", containerOf(slug), "gp", "claude", "status"),
	/** Way A: prints an address, then waits for the code on stdin. */
	claudeLogin: (slug) => make(PROCESS.exec, "exec", "-i", containerOf(slug), "gp", "claude", "login"),
	/** Way B: a setup token on stdin. */
	claudeToken: (slug) => make(PROCESS.exec, "exec", "-i", containerOf(slug), "gp", "claude", "token"),
	status: (slug) => make(PROCESS.exec, "exec", containerOf(slug), "gp", "status", "--json"),
	/** The agent and its helper. `-f` makes a missing container no failure. */
	remove: (slug) => make(PROCESS.rm, "rm", "-f", containerOf(slug), updaterOf(slug)),
	/** The agent's key and memory, for good. Only after the person was warned. */
	removeData: (slug) => make(PROCESS.volumeRm, "volume", "rm", volumeOf(slug))
};
// src/gp/protocol.ts
var LINE = /^GP_([A-Z0-9_]+)=(.*)$/;
function parseGp(stdout) {
	const values = /* @__PURE__ */ new Map();
	for (const raw of stdout.split(/\r?\n/)) {
		const match = LINE.exec(raw);
		if (match) values.set(match[1], match[2].trim());
	}
	const code = values.get("ERROR");
	const number = values.get("INTERFACE");
	return {
		interface: number !== void 0 && /^\d+$/.test(number) ? Number(number) : void 0,
		values,
		error: code === void 0 ? void 0 : {
			code,
			message: values.get("ERROR_MESSAGE") ?? ""
		}
	};
}
/** True when a command printed an interface number and it is not the one this plugin knows. */
var unknownInterface = (gp) => gp.interface !== void 0 && gp.interface !== 1;
var STATES$1 = [
	"needs-claude",
	"needs-auth-tag",
	"connecting",
	"running",
	"updating",
	"error"
];
var RELAYS$1 = [
	"connected",
	"refused-not-member",
	"unreachable"
];
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isOneOf$1 = (list, value) => typeof value === "string" && list.includes(value);
/**
* Reads `gp status --json`: one JSON object, on several lines or one, which the note's section 14 says has no `GP_` line before it. A
* `GP_` line before it is dropped all the same. `undefined` for anything else. The interface number is the one field that must be there
* and a number: when it is not the one this plugin knows, the caller stops before it reads anything else.
*/
function parseStatus(stdout) {
	const text = stdout.split(/\r?\n/).filter((line) => !LINE.test(line)).join("\n").trim();
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		return;
	}
	if (!isRecord(value) || typeof value.interface !== "number" || !Number.isInteger(value.interface)) return void 0;
	const found = value.interface;
	if (found !== 1) return {
		interface: found,
		status: void 0
	};
	const { version, state, agent_pubkey: agentPubkey, relay_url: relayUrl, relay, claude, update, previous_version: previous, error } = value;
	if (typeof version !== "string" || !isOneOf$1(STATES$1, state) || typeof agentPubkey !== "string" || typeof relayUrl !== "string" || !isOneOf$1(RELAYS$1, relay) || claude !== "active" && claude !== "not-active" || !isRecord(update) || typeof update.available !== "boolean" || update.version !== null && typeof update.version !== "string" || previous !== null && typeof previous !== "string") return void 0;
	let failure = null;
	if (error !== null && error !== void 0) {
		if (!isRecord(error) || typeof error.code !== "string") return void 0;
		failure = {
			code: error.code,
			message: typeof error.message === "string" ? error.message : ""
		};
	}
	return {
		interface: found,
		status: {
			interface: found,
			version,
			state,
			agentPubkey,
			relayUrl,
			relay,
			claude,
			update: {
				available: update.available,
				version: update.version
			},
			previousVersion: previous,
			error: failure
		}
	};
}
// src/gp/run.ts
/** Characters of each stream kept: a status or a GP answer is a few hundred; a pull's progress is the rest. */
var KEPT = 262144;
var lines = (emit) => {
	let pending = "";
	return {
		push(data) {
			pending += data;
			const parts = pending.split(/\r\n|\n|\r/);
			pending = parts.pop() ?? "";
			for (const line of parts) if (line !== "") emit(line);
		},
		flush() {
			if (pending !== "") emit(pending);
			pending = "";
		}
	};
};
async function startRun(start, command, options) {
	const { signal, timeoutMs, onLine } = options;
	let stdout = "";
	let stderr = "";
	const reader = lines((line) => onLine?.(line));
	let proc;
	try {
		proc = await start(command, {
			onStdout(data) {
				if (stdout.length < KEPT) stdout += data;
				reader.push(data);
			},
			onStderr(data) {
				if (stderr.length < KEPT) stderr += data;
			}
		});
	} catch {
		const outcome = signal?.aborted ? { kind: "aborted" } : { kind: "cannot-start" };
		const gone = () => Promise.resolve();
		return {
			write: gone,
			end: gone,
			kill: gone,
			done: Promise.resolve(outcome)
		};
	}
	const stop = () => proc.kill().catch(() => void 0);
	return {
		write: (data) => proc.write(data),
		end: (data) => proc.end(data),
		kill: stop,
		done: (async () => {
			let timer;
			let onAbort;
			try {
				const interrupted = new Promise((resolve) => {
					timer = setTimeout(() => resolve("timeout"), timeoutMs);
					if (signal?.aborted) resolve("abort");
					else {
						onAbort = () => resolve("abort");
						signal?.addEventListener("abort", onAbort, { once: true });
					}
				});
				const result = await Promise.race([proc.exited, interrupted]);
				if (result === "timeout" || result === "abort") {
					await stop();
					return { kind: result === "abort" ? "aborted" : "timeout" };
				}
				reader.flush();
				return {
					kind: "exit",
					code: result,
					stdout,
					stderr,
					gp: parseGp(stdout)
				};
			} catch {
				await stop();
				return signal?.aborted ? { kind: "aborted" } : { kind: "cannot-start" };
			} finally {
				clearTimeout(timer);
				if (onAbort) signal?.removeEventListener("abort", onAbort);
			}
		})()
	};
}
/** Runs the command to its end. */
async function run(start, command, options) {
	const running = await startRun(start, command, options);
	await (options.stdin === void 0 ? running.end() : running.end(options.stdin)).catch(() => void 0);
	return running.done;
}
/** The last non-empty line docker or GP printed on stderr, trimmed to one short line for a message. */
function lastLine(text, max = 160) {
	const line = text.split(/\r?\n/).map((part) => part.trim()).filter((part) => part !== "").pop();
	return line === void 0 ? "" : line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
// src/gp/claude.ts
var stopped = {
	ok: false,
	message: "Stopped.",
	stopped: true
};
var fail = (message, said) => said === void 0 ? {
	ok: false,
	message
} : {
	ok: false,
	message,
	said
};
/** The most of GHOST Protocol's own line that is shown: a long one is cut, so it cannot fill the panel. */
var SAID_MAX = 200;
/**
* GHOST Protocol's refusal as the person sees it. It never prints a secret, but this is the one place its words reach the screen
* from a command that was given one, so any piece of `secrets` that turns up in them is taken out before anything is shown.
*/
function saidBy(gp, secrets) {
	if (gp.error === void 0) return void 0;
	const clean = (text) => secrets.filter((secret) => secret !== "").reduce((rest, secret) => rest.split(secret).join("…"), text);
	const line = clean(gp.error.message).trim();
	return {
		code: clean(gp.error.code).trim(),
		message: line.length > SAID_MAX ? `${line.slice(0, SAID_MAX)}…` : line
	};
}
/** Whether the agent has a Claude sign-in: `gp claude status`. */
async function isSignedIn(claude, slug, signal) {
	const outcome = await run(claude.start, commands$1.claudeStatus(slug), {
		timeoutMs: LIMITS.quick,
		signal
	});
	if (outcome.kind === "aborted") return stopped;
	if (outcome.kind === "cannot-start") return {
		ok: false,
		message: WORDS.docker
	};
	if (outcome.kind === "timeout") return {
		ok: false,
		message: "GHOST Protocol did not answer in time."
	};
	if (unknownInterface(outcome.gp)) return {
		ok: false,
		message: WORDS.unknownInterface
	};
	return {
		ok: true,
		active: outcome.gp.values.get("CLAUDE") === "active"
	};
}
/** Way B: the setup token goes to `gp claude token` on stdin. The caller forgets the token afterwards, whatever this says. */
async function signInWithToken(claude, slug, token, signal) {
	const text = token.trim();
	if (text === "" || /\s/.test(text)) return fail("Paste a Claude setup token first (run claude setup-token in a terminal).");
	const outcome = await run(claude.start, commands$1.claudeToken(slug), {
		stdin: `${text}\n`,
		timeoutMs: LIMITS.quick,
		signal
	});
	if (outcome.kind === "aborted") return stopped;
	if (outcome.kind === "cannot-start") return fail(WORDS.docker);
	if (outcome.kind === "timeout") return fail("GHOST Protocol did not answer in time.");
	if (unknownInterface(outcome.gp)) return fail(WORDS.unknownInterface);
	if (outcome.code !== 0 || outcome.gp.error || outcome.gp.values.get("CLAUDE") !== "active") return fail("Claude did not accept that token. Make a new one and paste it.", saidBy(outcome.gp, [text]));
	return { ok: true };
}
var LOGIN_LINE = /^GP_CLAUDE_LOGIN_URL=(.*)$/;
/** The only kind of address shown to the person: a web address, never another scheme. */
var WEB_ADDRESS = /^https:\/\/[^\s<>"']+$/;
/**
* Way A: `gp claude login` prints an address and waits for a code on stdin. `askCode` shows the address and resolves with the code the
* person copies back, or rejects when they give up.
*/
async function signInByAddress(claude, slug, askCode, signal) {
	let cancelled = false;
	let badAddress = false;
	let asked = false;
	let given = "";
	let resolveRunning;
	const running = new Promise((resolve) => resolveRunning = resolve);
	const answer = async (url) => {
		const process = await running;
		try {
			const code = await askCode(url, signal);
			given = code;
			await process.end(`${code}\n`);
		} catch {
			cancelled = true;
			await process.kill();
		}
	};
	const refuse = async () => {
		badAddress = true;
		await (await running).kill();
	};
	const started = await startRun(claude.start, commands$1.claudeLogin(slug), {
		signal,
		timeoutMs: LIMITS.login,
		onLine(line) {
			const address = LOGIN_LINE.exec(line)?.[1]?.trim();
			if (address === void 0 || asked) return;
			asked = true;
			if (WEB_ADDRESS.test(address)) answer(address);
			else refuse();
		}
	});
	resolveRunning(started);
	const waitForAddress = setTimeout(() => {
		if (!asked) refuse();
	}, LIMITS.quick);
	const outcome = await started.done.finally(() => clearTimeout(waitForAddress));
	if (outcome.kind === "cannot-start") return fail(WORDS.docker);
	if (outcome.kind === "aborted") return stopped;
	if (badAddress) return fail("GHOST Protocol did not give an address to sign in at. Try again.");
	if (outcome.kind === "timeout") return fail("Signing in to Claude took too long. Try again.");
	if (cancelled) return fail("Signing in to Claude was cancelled.");
	if (unknownInterface(outcome.gp)) return fail(WORDS.unknownInterface);
	if (outcome.code !== 0 || outcome.gp.error || outcome.gp.values.get("CLAUDE") !== "active") return fail("Claude did not accept the sign-in. Try again.", saidBy(outcome.gp, [given]));
	return { ok: true };
}
// src/gp/flow.ts
var CreateError = class extends Error {
	name = "CreateError";
};
var HEX64 = /^[0-9a-f]{64}$/;
function stop(d, step, message) {
	d.progress.set(step, "failed", message);
	d.progress.fail(message);
	throw new CreateError(message);
}
/** Runs one command for a step. Anything but an exit (no docker, too slow, stopped) ends the step. */
async function docker(d, step, command, signal, options) {
	const outcome = await run(d.start, command, {
		...options,
		signal
	});
	switch (outcome.kind) {
		case "exit": return outcome;
		case "cannot-start": return stop(d, step, WORDS.docker);
		case "timeout": return stop(d, step, "Docker did not answer in time.");
		case "aborted": throw new CreateError("Stopped.");
	}
}
/** GP printed an interface number this plugin does not know: nothing else of its answer is read. */
function checkInterface(d, step, exit) {
	if (unknownInterface(exit.gp)) stop(d, step, WORDS.unknownInterface);
}
/** Whether a container is there, and running. docker's "no such object" is its answer for a missing one, in whatever case it writes it. */
async function whereIs(d, step, container, signal) {
	const exit = await docker(d, step, commands$1.state(container), signal, { timeoutMs: LIMITS.quick });
	if (exit.code === 0) {
		const status = exit.stdout.trim().toLowerCase();
		return status === "running" || status === "restarting" ? "running" : "stopped";
	}
	if (/no such (object|container)/i.test(`${exit.stderr}\n${exit.stdout}`)) return "missing";
	return stop(d, step, WORDS.docker);
}
/** Makes sure a container runs: starts it when it is not there, starts it again when it stopped, leaves it when it runs. */
async function ensureRunning(d, step, container, create, what, signal) {
	const where = await whereIs(d, step, container, signal);
	if (where === "running") {
		d.progress.set(step, "done", "Already running");
		return;
	}
	const exit = await docker(d, step, where === "missing" ? create : commands$1.restart(container), signal, { timeoutMs: LIMITS.start });
	if (exit.code !== 0) {
		const why = lastLine(exit.stderr);
		stop(d, step, `Docker could not start ${what}${why === "" ? "." : `: ${why}`}`);
	}
	d.progress.set(step, "done");
}
/** Steps 1 to 3. Resolves with the slug and the agent's public key. */
async function provision(d, input) {
	const { name, community, owner, selfUpdate, signal } = input;
	const slug = slugFromName(name);
	if (slug === void 0) throw new CreateError("Give the agent a name with at least one letter or number, as docker names are made of them.");
	if (!HEX64.test(owner)) throw new CreateError("Sign in to Buzz before you make the agent.");
	d.progress.begin({ skipUpdater: !selfUpdate });
	d.progress.set("docker", "running");
	const checked = await d.checkDocker(signal);
	if (checked === void 0) throw new CreateError("Stopped.");
	if (checked.state !== "ready") stop(d, "docker", checked.state === "unsupported" ? WORDS$2.unsupported : WORDS.docker);
	d.progress.set("docker", "done", `Docker ${checked.version}`);
	d.progress.set("pull", "running");
	const pulled = await docker(d, "pull", commands$1.pull(), signal, {
		timeoutMs: LIMITS.pull,
		onLine: (line) => d.progress.set("pull", "running", line.length > 120 ? `${line.slice(0, 119)}…` : line)
	});
	if (pulled.code !== 0) {
		const why = lastLine(pulled.stderr);
		stop(d, "pull", `Docker could not download GHOST Protocol${why === "" ? "." : `: ${why}`}`);
	}
	d.progress.set("pull", "done");
	d.progress.set("init", "running");
	if (await whereIs(d, "init", containerOf(slug), signal) !== "missing") stop(d, "init", `A GHOST Protocol agent with the name "${containerOf(slug)}" is already on this computer. Choose another name, or remove it with: docker rm -f ${containerOf(slug)}`);
	const made = await docker(d, "init", commands$1.init(slug, nameForInit(name, slug), community, owner), signal, { timeoutMs: LIMITS.init });
	checkInterface(d, "init", made);
	const pubkey = made.gp.values.get("AGENT_PUBKEY");
	if (made.code !== 0 || made.gp.error) {
		const why = made.gp.error?.message || lastLine(made.stderr);
		stop(d, "init", `GHOST Protocol could not set up the agent${why === "" ? "." : `: ${why}`}`);
	}
	if (pubkey === void 0 || !HEX64.test(pubkey)) stop(d, "init", "GHOST Protocol did not return the agent's public key.");
	d.progress.set("init", "done");
	return {
		slug,
		pubkey
	};
}
/** Steps 4 to 8. Resolves with the agent's status once it runs. */
async function activate(d, input) {
	const { name, pubkey, auth, selfUpdate, signal } = input;
	const slug = slugFromName(name);
	if (slug === void 0) throw new CreateError("Give the agent a name with at least one letter or number, as docker names are made of them.");
	d.progress.resume({ skipUpdater: !selfUpdate });
	d.progress.set("start", "running");
	await ensureRunning(d, "start", containerOf(slug), commands$1.start(slug), "the agent", signal);
	if (selfUpdate) {
		d.progress.set("updater", "running");
		await ensureRunning(d, "updater", updaterOf(slug), commands$1.startUpdater(slug), "the update helper", signal);
	}
	d.progress.set("tag", "running");
	if (auth.length !== 4 || auth.some((part) => typeof part !== "string")) stop(d, "tag", "Buzz did not give a well-formed attestation. Try again.");
	const tagged = await docker(d, "tag", commands$1.authTagSet(slug), signal, {
		stdin: `${JSON.stringify(auth)}\n`,
		timeoutMs: LIMITS.quick
	});
	checkInterface(d, "tag", tagged);
	if (tagged.code !== 0 || tagged.gp.error || tagged.gp.values.get("AUTH_TAG") !== "accepted") stop(d, "tag", `GHOST Protocol did not accept your attestation${tagged.gp.error ? ` (${tagged.gp.error.code})` : ""}. Press Create to try again.`);
	d.progress.set("tag", "done");
	d.progress.set("claude", "running");
	const later = await signIn(d, slug, input);
	d.progress.set("wait", "running");
	return await waitUntilRunning(d, slug, pubkey, signal, later);
}
/** Step 7. Resolves true when the sign-in is left for later, from the agent's panel. */
async function signIn(d, slug, input) {
	const { signal } = input;
	const claude = { start: d.start };
	const current = await isSignedIn(claude, slug, signal);
	if (!current.ok) return stop(d, "claude", current.message);
	if (current.active) {
		d.clearToken();
		d.progress.set("claude", "done", "Already signed in");
		return false;
	}
	const held = d.token();
	if (input.claudeWay === "token" && held.trim() !== "" && /\s/.test(held.trim())) {
		d.clearToken();
		return stop(d, "claude", "That is not a Claude setup token: it has a space in it. Make one with claude setup-token, paste it, and press Create again.");
	}
	if (input.claudeWay === "login" || held.trim() === "") {
		d.clearToken();
		d.progress.set("claude", "skipped", "Sign in from the agent's panel");
		return true;
	}
	let result;
	try {
		result = await signInWithToken(claude, slug, d.token(), signal);
	} finally {
		d.clearToken();
	}
	if (!result.ok) {
		if (result.stopped) throw new CreateError("Stopped.");
		return stop(d, "claude", result.message === WORDS.docker || result.message === WORDS.unknownInterface ? result.message : `${result.message} Then press Create again.`);
	}
	d.progress.set("claude", "done");
	return false;
}
/** Looks at the status until the agent runs, the relay refuses it, it reports an error, or the time is up. */
async function waitUntilRunning(d, slug, pubkey, signal, atNeedsClaude) {
	const deadline = d.now() + LIMITS.running;
	let last = "GHOST Protocol did not answer.";
	for (;;) {
		const exit = await docker(d, "wait", commands$1.status(slug), signal, { timeoutMs: LIMITS.quick });
		const read = exit.code === 0 ? parseStatus(exit.stdout) : void 0;
		if (read && read.interface !== 1) stop(d, "wait", WORDS.unknownInterface);
		const status = read?.status;
		if (status) {
			if (status.agentPubkey !== pubkey) stop(d, "wait", `The container ${containerOf(slug)} belongs to another agent.`);
			if (status.state === "running" || atNeedsClaude && status.state === "needs-claude") {
				d.progress.set("wait", "done", status.state === "running" ? `Version ${status.version}` : "Waiting for you to sign in to Claude");
				return status;
			}
			if (status.relay === "refused-not-member") {
				d.progress.refused(pubkey);
				stop(d, "wait", `${WORDS.refused} The agent's public key is ${pubkey}.`);
			}
			if (status.state === "error") stop(d, "wait", `GHOST Protocol reports an error${status.error?.message ? `: ${status.error.message}` : "."}`);
			last = status.relay === "unreachable" ? `GHOST Protocol could not reach your relay (${status.relayUrl}).` : `GHOST Protocol is still ${status.state.replace(/-/g, " ")}.`;
			d.progress.set("wait", "running", status.state.replace(/-/g, " "));
		} else last = lastLine(exit.stderr) || "GHOST Protocol did not answer.";
		if (d.now() >= deadline) stop(d, "wait", `${last} Press Create to try again.`);
		await d.sleep(LIMITS.pollMs, signal);
		if (signal.aborted) throw new CreateError("Stopped.");
	}
}
/**
* Removes an agent: its container and helper, then its data volume (the key, memory and sign-ins). One that is already gone counts as
* removed. `-f` makes a missing container exit 0; a volume that is not there is docker's "no such volume".
*/
async function remove(start, slug, signal) {
	const gone = await run(start, commands$1.remove(slug), {
		timeoutMs: LIMITS.start,
		signal
	});
	if (gone.kind === "aborted") throw new CreateError("Stopped.");
	if (gone.kind !== "exit" || gone.code !== 0) throw new CreateError(gone.kind === "cannot-start" ? WORDS.docker : `Docker could not remove the agent's container${gone.kind === "exit" && lastLine(gone.stderr) ? `: ${lastLine(gone.stderr)}` : "."}`);
	const data = await run(start, commands$1.removeData(slug), {
		timeoutMs: LIMITS.start,
		signal
	});
	if (data.kind === "aborted") throw new CreateError("Stopped.");
	if (data.kind === "exit" && data.code === 0) return;
	if (data.kind === "exit" && /no such volume/i.test(`${data.stderr}\n${data.stdout}`)) return;
	throw new CreateError(data.kind === "cannot-start" ? WORDS.docker : `Docker could not remove the agent's data${data.kind === "exit" && lastLine(data.stderr) ? `: ${lastLine(data.stderr)}` : "."}`);
}
// src/gp/host.ts
/** Waits `ms`, or less when `signal` aborts. */
var sleep = (ms, signal) => new Promise((resolve) => {
	if (signal.aborted) return resolve();
	const done = () => {
		clearTimeout(timer);
		signal.removeEventListener("abort", done);
		resolve();
	};
	const timer = setTimeout(done, ms);
	signal.addEventListener("abort", done, { once: true });
});
// src/agent-type.ts
var TYPE_ID = "ghost-protocol";
function agentType(deps) {
	const { host, relay, progress, secrets, book } = deps;
	const startOrThrow = () => {
		const start = startOn(host);
		if (!start) throw new CreateError("This Buzz cannot start programs. Use the Buzz desktop app.");
		return start;
	};
	const flowDeps = () => ({
		start: startOrThrow(),
		checkDocker: (signal) => checkDocker(host, signal),
		progress,
		token: secrets.token,
		clearToken: secrets.clear,
		sleep,
		now: () => Date.now()
	});
	/** The signed-in person, who becomes the agent's owner and only allowed sender. */
	const ownerOf = () => {
		const snapshot = relay.snapshot();
		const viewer = snapshot.status === "ready" ? snapshot.session?.viewer : void 0;
		if (viewer === void 0 || !/^[0-9a-f]{64}$/.test(viewer)) throw new CreateError("Connect to your community and sign in before you make the agent.");
		return viewer;
	};
	const chosen = (config) => {
		const result = chosenFrom(config);
		if ("problem" in result) throw new CreateError(result.problem);
		return result;
	};
	return {
		id: TYPE_ID,
		title: "GHOST Protocol",
		description: "Your personal GHOST Protocol agent, running in Docker on this computer.",
		defaults: () => ({ config: startingConfig() }),
		summary: () => "On this computer",
		...deps.CreateConfiguration ? { CreateConfiguration: deps.CreateConfiguration } : {},
		...deps.Create ? { Create: deps.Create } : {},
		remote: {
			async provision({ name, community, config, signal }) {
				const { selfUpdate } = chosen(config);
				const made = await provision(flowDeps(), {
					name: name.trim(),
					community,
					owner: ownerOf(),
					selfUpdate,
					signal
				});
				book.set(made.pubkey, made.slug);
				return { pubkey: made.pubkey };
			},
			async activate({ pubkey, name, auth, config, signal }) {
				const { selfUpdate, claudeWay } = chosen(config);
				const slug = slugFromName(name.trim());
				await activate(flowDeps(), {
					name: name.trim(),
					pubkey,
					auth,
					selfUpdate,
					claudeWay,
					signal
				});
				if (slug !== void 0) book.set(pubkey, slug);
			},
			async profile() {},
			async remove({ pubkey, signal }) {
				const slug = book.get(pubkey);
				if (slug === void 0) return;
				await remove(startOrThrow(), slug, signal);
				book.delete(pubkey);
			}
		}
	};
}
// src/gp/book.ts
var KEY = "megatech.ghost-protocol.agents";
function createBook(storage = defaultStorage) {
	const read = () => {
		try {
			const parsed = JSON.parse(storage()?.getItem(KEY) ?? "{}");
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
			return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => /^[0-9a-f]{64}$/.test(key) && typeof value === "string" && isSlug(value)));
		} catch {
			return {};
		}
	};
	const write = (next) => {
		try {
			storage()?.setItem(KEY, JSON.stringify(next));
		} catch {}
	};
	return {
		get: (pubkey) => read()[pubkey],
		set(pubkey, slug) {
			write({
				...read(),
				[pubkey]: slug
			});
		},
		delete(pubkey) {
			const { [pubkey]: _gone, ...rest } = read();
			write(rest);
		}
	};
}
function defaultStorage() {
	try {
		return typeof localStorage === "undefined" ? void 0 : localStorage;
	} catch {
		return;
	}
}
// src/gp/progress.ts
var STEP_LABELS = {
	docker: "Check Docker",
	pull: "Download GHOST Protocol",
	init: "Make the agent's key",
	start: "Start the agent",
	updater: "Start the update helper",
	tag: "Give it your attestation",
	claude: "Sign in to Claude",
	wait: "Wait for it to connect"
};
var STEP_ORDER = [
	"docker",
	"pull",
	"init",
	"start",
	"updater",
	"tag",
	"claude",
	"wait"
];
var blank = () => ({
	active: false,
	steps: STEP_ORDER.map((id) => ({
		id,
		label: STEP_LABELS[id],
		state: "waiting",
		note: ""
	})),
	login: void 0,
	refused: void 0,
	failure: void 0
});
function createProgress() {
	let view = blank();
	const listeners = /* @__PURE__ */ new Set();
	let waiting;
	const publish = (next) => {
		view = next;
		for (const listener of [...listeners]) listener();
	};
	const patch = (id, change) => ({
		...view,
		steps: view.steps.map((step) => step.id === id ? {
			...step,
			...change
		} : step)
	});
	return {
		view: () => view,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		reset() {
			publish(blank());
		},
		begin({ skipUpdater }) {
			const fresh = blank();
			publish({
				...fresh,
				active: true,
				steps: fresh.steps.map((step) => step.id === "updater" && skipUpdater ? {
					...step,
					state: "skipped"
				} : step)
			});
		},
		resume({ skipUpdater }) {
			const fresh = blank();
			const earlier = /* @__PURE__ */ new Set([
				"docker",
				"pull",
				"init"
			]);
			publish({
				...fresh,
				active: true,
				steps: fresh.steps.map((step) => earlier.has(step.id) ? {
					...step,
					state: "done"
				} : step.id === "updater" && skipUpdater ? {
					...step,
					state: "skipped"
				} : step)
			});
		},
		set(id, state, note = "") {
			publish(patch(id, {
				state,
				note
			}));
		},
		refused(pubkey) {
			publish({
				...view,
				refused: { pubkey }
			});
		},
		fail(message) {
			publish({
				...view,
				failure: message,
				login: void 0
			});
		},
		askCode(url, signal) {
			waiting?.reject(/* @__PURE__ */ new Error("Another sign-in started."));
			return new Promise((resolve, reject) => {
				const settle = () => {
					waiting = void 0;
					signal.removeEventListener("abort", onAbort);
					publish({
						...view,
						login: void 0
					});
				};
				const onAbort = () => {
					settle();
					reject(/* @__PURE__ */ new Error("Stopped."));
				};
				if (signal.aborted) return reject(/* @__PURE__ */ new Error("Stopped."));
				signal.addEventListener("abort", onAbort, { once: true });
				waiting = {
					resolve: (code) => {
						settle();
						resolve(code);
					},
					reject: (error) => {
						settle();
						reject(error);
					}
				};
				publish({
					...view,
					login: { url }
				});
			});
		},
		submitCode(code) {
			const trimmed = code.trim();
			if (!waiting || trimmed === "") return false;
			waiting.resolve(trimmed);
			return true;
		},
		cancelCode() {
			waiting?.reject(/* @__PURE__ */ new Error("Signing in to Claude was cancelled."));
		}
	};
}
function createSecrets() {
	let token = "";
	const listeners = /* @__PURE__ */ new Set();
	const change = (next) => {
		if (next === token) return;
		token = next;
		for (const listener of [...listeners]) listener();
	};
	return {
		token: () => token,
		setToken: (value) => change(value),
		clear: () => change(""),
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		}
	};
}
// src/react.ts
var React;
function provideReact(react) {
	React = react;
}
// src/gp/guard.ts
/**
* Asks `gp status --json` of `gp-<slug>` and compares the key it names with the agent's. Resolves with `undefined` when `signal` aborts
* first. `written` is true when the slug is the pair the plugin wrote down.
*/
async function verifyContainer(host, slug, pubkey, written, signal) {
	const ran = await runnerFor(host, signal)(statusCall(slug));
	if (ran === void 0) return void 0;
	const read = ran.kind === "exit" && ran.code === 0 ? parseStatus(ran.stdout) : void 0;
	if (read?.status) return read.status.agentPubkey === pubkey ? "ok" : "other";
	return written ? "ok" : "unknown";
}
// src/claude-words.ts
var CLAUDE_STATUS = {
	checking: "Checking Claude…",
	active: "Claude: active",
	notActive: "Claude: not active",
	/** After a sign-in the agent accepted, until the person does something else. */
	accepted: "Claude accepted the sign-in."
};
/** The commands of the guide, each shown in a copy block. */
var COMMANDS = {
	check: "claude --version",
	installUnix: "curl -fsSL https://claude.ai/install.sh | bash",
	installWindows: "irm https://claude.ai/install.ps1 | iex",
	token: "claude setup-token"
};
var LINKS = {
	plans: "https://claude.com/pricing",
	install: "https://code.claude.com/docs/en/setup"
};
/** The codes GHOST Protocol answers with when Claude refuses, as the interface note names them. */
var CODES = {
	token: "claude-token-invalid",
	login: "claude-login-failed"
};
var GUIDE = {
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
		fails: `If Claude refuses the token, you see "Claude did not accept that token" and GHOST Protocol's code ${CODES.token}. The field empties either way. Make a new token and paste it.`
	},
	login: {
		title: "Option 2: sign in at an address",
		why: "Use this if you cannot run the terminal command above.",
		press: "Press Sign in with an address. The agent gives an address.",
		open: "Open the address and sign in to Claude in your browser. Claude then shows a code.",
		code: "Copy the code, paste it into the box under the address, and press Continue.",
		start: "Sign in with an address",
		works: "When it works, the address and box go away and this section says Claude: active.",
		fails: `If the code is wrong or has run out, you see "Claude did not accept the sign-in" and GHOST Protocol's code ${CODES.login}. Press Sign in with an address again for a new address.`
	},
	said: (code, message) => message === "" ? `GHOST Protocol answered ${code}.` : `GHOST Protocol said: ${message} (${code})`
};
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
var NO_UPDATE_IMAGE = { kind: "none" };
var PUBKEY = /^[0-9a-fA-F]{64}$/;
var GP_LINE = /^GP_[A-Z][A-Z0-9_]*=/;
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isOneOf = (list, value) => typeof value === "string" && list.includes(value);
var isText = (value) => typeof value === "string" && value !== "";
var isTextOrNull = (value) => value === null || typeof value === "string";
/**
* `image` and `digest` of the status's `update`, as they were printed (`undefined` when the key is not there). The rule is the one the
* agent's own image has (`PINNED_IMAGE`): a registry, a path ending in `ghost-protocol`, a tag that is not `latest`, and a sha256 digest of 64
* lower-case hex digits, alone. On top of it, the same two checks GHOST Protocol makes before it names an image: the tag is the version on
* offer, and the digest is the one in `digest`. Without them the steps would pull another version than the screen says is on offer.
*/
function updateImageOf(version, image, digest) {
	if (image === void 0 || image === null) return NO_UPDATE_IMAGE;
	if (typeof image !== "string" || !PINNED_IMAGE.test(image) || version === null) return { kind: "refused" };
	const at = image.lastIndexOf("@");
	const reference = image.slice(0, at);
	if (reference.slice(reference.lastIndexOf(":") + 1) !== version) return { kind: "refused" };
	if (digest !== void 0 && digest !== null && digest !== image.slice(at + 1)) return { kind: "refused" };
	return {
		kind: "pinned",
		image
	};
}
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
				version: update.version,
				image: updateImageOf(update.version, update.image, update.digest)
			},
			previousVersion,
			error: error === null ? null : {
				code: error.code,
				message: error.message
			}
		}
	};
}
/** The `GP_<KEY>=<value>` lines of stdout (GHOST Protocol's interface), by key. A key printed twice keeps its last value. */
function gpLines(stdout) {
	const lines = /* @__PURE__ */ new Map();
	for (const line of stdout.split(/\r?\n/)) {
		const found = /^GP_([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
		if (found?.[1] !== void 0 && found[2] !== void 0) lines.set(found[1], found[2]);
	}
	return lines;
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
/**
* What a button that Docker or GHOST Protocol accepted does to what the screen knows. An Update or a Roll back is under way from then on
* (`version` is the one the agent was on). A Stop or a Restart is the user's own doing and ends any update that was under way: the next
* look says what it finds, so a container that is stopped is shown as stopped, with its Restart, and not as being swapped.
*/
function afterButton(before, job, accepted, version) {
	if (!accepted) return before;
	if (job === "restart" || job === "stop") return NOTHING_YET;
	return version === void 0 ? before : askedFor(before, version);
}
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
	const asked = await run(statusCall(slug));
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
	const inspected = await run(stateCall(slug));
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
* The image the container was made from, as Docker prints it (`registry/ghost-protocol:1.2.3@sha256:<64 hex>`, or without the digest for a container someone started by hand), or undefined when it cannot be read.
* Resolves with `undefined` as well when the caller left first.
*/
async function imageOf(run, slug) {
	const ran = await run(imageCall(slug));
	if (ran === void 0 || ran.kind !== "exit" || ran.code !== 0) return void 0;
	const image = ran.stdout.trim();
	return image === "" ? void 0 : image;
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
// src/ui/Login.tsx
/** Way A: the address `gp claude login` printed, and the code the person copies back from it. */
function Login({ progress, url }) {
	const [code, setCode] = React.useState("");
	const [copied, setCopied] = React.useState(false);
	const send = () => {
		if (progress.submitCode(code)) setCode("");
	};
	return /* @__PURE__ */ React.createElement("div", {
		className: "gp-login",
		role: "group",
		"aria-label": "Sign in to Claude",
		"data-gp": "login"
	}, /* @__PURE__ */ React.createElement("p", { className: "gp-question" }, "Sign in to Claude at this address, then paste the code it gives you."), /* @__PURE__ */ React.createElement("p", { className: "gp-address" }, /* @__PURE__ */ React.createElement("a", {
		href: url,
		target: "_blank",
		rel: "noopener noreferrer"
	}, url)), /* @__PURE__ */ React.createElement("div", { className: "gp-row" }, /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "gp-button",
		onClick: () => {
			copyText(url).then((done) => setCopied(done));
		}
	}, copied ? "Copied" : "Copy address")), /* @__PURE__ */ React.createElement("div", { className: "gp-row" }, /* @__PURE__ */ React.createElement("input", {
		className: "gp-input",
		type: "text",
		autoComplete: "off",
		spellCheck: false,
		"aria-label": "Code from Claude",
		value: code,
		onChange: (event) => setCode(event.target.value),
		onKeyDown: (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				send();
			}
		}
	}), /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "gp-button",
		disabled: code.trim() === "",
		onClick: send
	}, "Continue"), /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "gp-button",
		onClick: () => progress.cancelCode()
	}, "Cancel")));
}
/** The relay does not accept the agent: its public key, for the person to give to the relay's admin. */
function Refused({ pubkey }) {
	const [copied, setCopied] = React.useState(false);
	return /* @__PURE__ */ React.createElement("div", {
		className: "gp-refused",
		role: "group",
		"aria-label": "The relay does not accept the agent",
		"data-gp": "refused"
	}, /* @__PURE__ */ React.createElement("p", { className: "gp-question" }, "Give this public key to your relay's admin:"), /* @__PURE__ */ React.createElement("p", { className: "gp-address" }, /* @__PURE__ */ React.createElement("code", { "data-gp": "agent-key" }, pubkey)), /* @__PURE__ */ React.createElement("div", { className: "gp-row" }, /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "gp-button",
		onClick: () => {
			copyText(pubkey).then((done) => setCopied(done));
		}
	}, copied ? "Copied" : "Copy public key")));
}
// src/ui/CreateForm.tsx
/** A token is one word: it is whatever `claude setup-token` printed, with no space in it. */
var tokenFit = (token) => token.trim() !== "" && !/\s/.test(token.trim());
var WAYS = {
	token: { label: "Paste a setup token" },
	login: { label: "Sign in with an address" }
};
/** The two ways to sign in to Claude, the leading one first. */
var waysFor = (leads) => leads === "token" ? ["token", "login"] : ["login", "token"];
var ORDER = waysFor(CLAUDE_LEADS);
function createParts(progress, secrets) {
	function Configuration({ config, onChange, disabled, harnessControl, onReadyChange }) {
		const token = React.useSyncExternalStore(secrets.subscribe, secrets.token);
		const claude = React.useSyncExternalStore(progress.subscribe, progress.view).steps.find((step) => step.id === "claude");
		const signedIn = claude?.state === "done";
		const ready = config.selfUpdate !== null && (config.claudeWay === "login" || signedIn || tokenFit(token));
		React.useEffect(() => {
			onReadyChange?.(ready);
		}, [ready, onReadyChange]);
		React.useEffect(() => {
			progress.reset();
			return () => secrets.clear();
		}, []);
		return /* @__PURE__ */ React.createElement("div", {
			className: "gp-create",
			"data-gp": "configuration"
		}, harnessControl, /* @__PURE__ */ React.createElement("fieldset", {
			className: "gp-create-group",
			disabled
		}, /* @__PURE__ */ React.createElement("legend", null, "Where it runs"), /* @__PURE__ */ React.createElement("label", { className: "gp-choice" }, /* @__PURE__ */ React.createElement("input", {
			type: "radio",
			name: "gp-where",
			value: "local",
			checked: true,
			readOnly: true
		}), /* @__PURE__ */ React.createElement("span", null, "This computer")), /* @__PURE__ */ React.createElement("label", {
			className: "gp-choice",
			"aria-disabled": "true"
		}, /* @__PURE__ */ React.createElement("input", {
			type: "radio",
			name: "gp-where",
			value: "hosted",
			checked: false,
			disabled: true,
			readOnly: true
		}), /* @__PURE__ */ React.createElement("span", null, "Hosted"), /* @__PURE__ */ React.createElement("span", { className: "gp-soon" }, "coming soon"))), /* @__PURE__ */ React.createElement("fieldset", { className: "gp-create-group" }, /* @__PURE__ */ React.createElement("legend", null, "Your Claude account"), /* @__PURE__ */ React.createElement("p", {
			className: "gp-hint",
			role: "status",
			"data-gp": "claude-status"
		}, signedIn ? "Signed in to Claude." : claude?.state === "running" ? "Signing in to Claude…" : "Not signed in yet. You connect Claude as the agent is made."), ORDER.map((way) => /* @__PURE__ */ React.createElement("label", {
			className: "gp-choice",
			key: way
		}, /* @__PURE__ */ React.createElement("input", {
			type: "radio",
			name: "gp-claude",
			value: way,
			checked: config.claudeWay === way,
			disabled,
			onChange: () => onChange({
				...config,
				claudeWay: way
			})
		}), /* @__PURE__ */ React.createElement("span", null, WAYS[way].label))), config.claudeWay === "token" ? /* @__PURE__ */ React.createElement("div", { className: "gp-create-fields" }, /* @__PURE__ */ React.createElement("p", { className: "gp-hint" }, "Run ", /* @__PURE__ */ React.createElement("code", null, "claude setup-token"), " in a terminal and paste the token here. It goes to the agent and nowhere else: this plugin does not store it."), /* @__PURE__ */ React.createElement("input", {
			className: "gp-input",
			type: "password",
			autoComplete: "off",
			spellCheck: false,
			"aria-label": "Claude setup token",
			value: token,
			disabled,
			onChange: (event) => secrets.setToken(event.target.value)
		})) : /* @__PURE__ */ React.createElement("p", { className: "gp-hint" }, "Once the agent is made, open it and sign in at an address from its GHOST Protocol tab.")), /* @__PURE__ */ React.createElement("fieldset", {
			className: "gp-create-group",
			disabled,
			"aria-labelledby": "gp-self-update-question"
		}, /* @__PURE__ */ React.createElement("p", {
			id: "gp-self-update-question",
			className: "gp-question"
		}, WORDS.selfUpdateQuestion), /* @__PURE__ */ React.createElement("label", { className: "gp-choice" }, /* @__PURE__ */ React.createElement("input", {
			type: "radio",
			name: "gp-self-update",
			value: "yes",
			checked: config.selfUpdate === true,
			onChange: () => onChange({
				...config,
				selfUpdate: true
			})
		}), /* @__PURE__ */ React.createElement("span", null, "Yes")), /* @__PURE__ */ React.createElement("label", { className: "gp-choice" }, /* @__PURE__ */ React.createElement("input", {
			type: "radio",
			name: "gp-self-update",
			value: "no",
			checked: config.selfUpdate === false,
			onChange: () => onChange({
				...config,
				selfUpdate: false
			})
		}), /* @__PURE__ */ React.createElement("span", null, "No"))));
	}
	function Steps({ steps }) {
		return /* @__PURE__ */ React.createElement("ol", {
			className: "gp-steps",
			"aria-label": "What Create does"
		}, steps.map((step) => /* @__PURE__ */ React.createElement("li", {
			key: step.id,
			className: "gp-step",
			"data-state": step.state,
			"data-step": step.id
		}, /* @__PURE__ */ React.createElement("span", {
			className: "gp-mark",
			"aria-hidden": "true"
		}, MARKS[step.state]), /* @__PURE__ */ React.createElement("span", { className: "gp-step-label" }, step.label), /* @__PURE__ */ React.createElement("span", { className: "gp-step-state" }, step.state === "skipped" ? "skipped" : step.state === "failed" ? "stopped" : ""), step.note !== "" && step.state !== "failed" && /* @__PURE__ */ React.createElement("span", { className: "gp-step-note" }, step.note))));
	}
	function Progression() {
		const view = React.useSyncExternalStore(progress.subscribe, progress.view);
		if (!view.active) return /* @__PURE__ */ React.createElement("p", { className: "gp-hint gp-create" }, "Press Create and the steps show here.");
		return /* @__PURE__ */ React.createElement("div", {
			className: "gp-create",
			"data-gp": "progress"
		}, /* @__PURE__ */ React.createElement(Steps, { steps: view.steps }), view.refused && /* @__PURE__ */ React.createElement(Refused, { pubkey: view.refused.pubkey }));
	}
	return {
		CreateConfiguration: Configuration,
		Create: Progression
	};
}
var MARKS = {
	waiting: "·",
	running: "…",
	done: "✓",
	skipped: "–",
	failed: "✕"
};
// src/ui/CopyBlock.tsx
/** One command, key or address to put on the clipboard, shown as text with a button that copies it. */
function CopyBlock({ text, label }) {
	const [result, setResult] = React.useState();
	return /* @__PURE__ */ React.createElement("div", { className: "gp-copy" }, /* @__PURE__ */ React.createElement("code", { className: "gp-code" }, text), /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "gp-button",
		"aria-label": label === void 0 ? void 0 : `${WORDS$1.copy} ${label}`,
		onClick: () => void copyText(text).then((copied) => setResult(copied ? "copied" : "failed"))
	}, result === "copied" ? WORDS$1.copied : WORDS$1.copy), result === "failed" && /* @__PURE__ */ React.createElement("span", { role: "alert" }, WORDS$1.copyFailed));
}
// src/ui/ClaudeGuide.tsx
var Link = ({ href, children }) => /* @__PURE__ */ React.createElement("a", {
	href,
	target: "_blank",
	rel: "noopener noreferrer"
}, children);
function Refusal({ failure, way }) {
	if (failure?.way !== way) return null;
	return /* @__PURE__ */ React.createElement("div", {
		className: "gp-refusal",
		role: "alert",
		"data-gp": "claude-problem",
		"data-code": failure.said?.code
	}, /* @__PURE__ */ React.createElement("p", { className: "gp-problem" }, failure.message), failure.said && /* @__PURE__ */ React.createElement("p", {
		className: "gp-note",
		"data-gp": "claude-said"
	}, GUIDE.said(failure.said.code, failure.said.message)));
}
function ClaudeGuide({ busy, token, onToken, canSend, onSend, onStartLogin, login, failure }) {
	return /* @__PURE__ */ React.createElement("div", {
		className: "gp-guide",
		"data-gp": "guide"
	}, /* @__PURE__ */ React.createElement("p", { className: "gp-hint" }, GUIDE.intro), /* @__PURE__ */ React.createElement("p", { className: "gp-hint" }, GUIDE.subscription, " ", /* @__PURE__ */ React.createElement(Link, { href: LINKS.plans }, GUIDE.plans)), /* @__PURE__ */ React.createElement("section", {
		className: "gp-way",
		"aria-labelledby": "gp-way-token",
		"data-gp": "guide-token"
	}, /* @__PURE__ */ React.createElement("h4", { id: "gp-way-token" }, GUIDE.token.title), /* @__PURE__ */ React.createElement("ol", null, /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("p", null, GUIDE.token.terminal), /* @__PURE__ */ React.createElement("p", null, GUIDE.token.check), /* @__PURE__ */ React.createElement(CopyBlock, { text: COMMANDS.check }), /* @__PURE__ */ React.createElement("p", { className: "gp-hint" }, GUIDE.token.checkOk), /* @__PURE__ */ React.createElement("p", null, GUIDE.token.install), /* @__PURE__ */ React.createElement("p", { className: "gp-os" }, GUIDE.token.unix), /* @__PURE__ */ React.createElement(CopyBlock, {
		text: COMMANDS.installUnix,
		label: GUIDE.token.unix
	}), /* @__PURE__ */ React.createElement("p", { className: "gp-os" }, GUIDE.token.windows), /* @__PURE__ */ React.createElement(CopyBlock, {
		text: COMMANDS.installWindows,
		label: GUIDE.token.windows
	}), /* @__PURE__ */ React.createElement("p", { className: "gp-hint" }, GUIDE.token.installDone, " ", /* @__PURE__ */ React.createElement(Link, { href: LINKS.install }, GUIDE.token.installHelp))), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("p", null, GUIDE.token.make), /* @__PURE__ */ React.createElement(CopyBlock, { text: COMMANDS.token }), /* @__PURE__ */ React.createElement("p", { className: "gp-hint" }, GUIDE.token.makeHow)), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("p", null, GUIDE.token.paste), /* @__PURE__ */ React.createElement("input", {
		className: "gp-input",
		type: "password",
		autoComplete: "off",
		spellCheck: false,
		"aria-label": GUIDE.token.field,
		value: token,
		disabled: busy,
		onChange: (event) => onToken(event.target.value)
	}), /* @__PURE__ */ React.createElement("div", { className: "gp-row" }, /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "gp-button",
		disabled: busy || !canSend,
		onClick: onSend
	}, GUIDE.token.send)))), /* @__PURE__ */ React.createElement(Refusal, {
		failure,
		way: "token"
	}), /* @__PURE__ */ React.createElement("p", {
		className: "gp-hint",
		"data-gp": "guide-token-expect"
	}, GUIDE.token.works, " ", GUIDE.token.fails)), /* @__PURE__ */ React.createElement("section", {
		className: "gp-way",
		"aria-labelledby": "gp-way-login",
		"data-gp": "guide-login"
	}, /* @__PURE__ */ React.createElement("h4", { id: "gp-way-login" }, GUIDE.login.title), /* @__PURE__ */ React.createElement("p", { className: "gp-hint" }, GUIDE.login.why), /* @__PURE__ */ React.createElement("ol", null, /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("p", null, GUIDE.login.press), /* @__PURE__ */ React.createElement("div", { className: "gp-row" }, /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "gp-button",
		disabled: busy,
		onClick: onStartLogin
	}, GUIDE.login.start))), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("p", null, GUIDE.login.open)), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("p", null, GUIDE.login.code))), login, /* @__PURE__ */ React.createElement(Refusal, {
		failure,
		way: "login"
	}), /* @__PURE__ */ React.createElement("p", {
		className: "gp-hint",
		"data-gp": "guide-login-expect"
	}, GUIDE.login.works, " ", GUIDE.login.fails)));
}
// src/ui/ClaudePanel.tsx
function createClaudePanel(host) {
	return function ClaudePanel({ slug, onSignedIn }) {
		const start = React.useMemo(() => startOn(host), []);
		const secrets = React.useMemo(createSecrets, []);
		const progress = React.useMemo(createProgress, []);
		const token = React.useSyncExternalStore(secrets.subscribe, secrets.token);
		const view = React.useSyncExternalStore(progress.subscribe, progress.view);
		const [state, setState] = React.useState({ kind: "checking" });
		const [round, setRound] = React.useState(0);
		const [busy, setBusy] = React.useState(false);
		const [failure, setFailure] = React.useState();
		const [accepted, setAccepted] = React.useState(false);
		const work = React.useRef(void 0);
		const signingIn = React.useRef(false);
		React.useEffect(() => {
			if (!start) return;
			const abort = new AbortController();
			let timer;
			setState({ kind: "checking" });
			const look = async () => {
				if (!signingIn.current) {
					const answer = await isSignedIn({ start }, slug, abort.signal);
					if (abort.signal.aborted) return;
					setState(answer.ok ? {
						kind: "answer",
						active: answer.active
					} : {
						kind: "problem",
						message: answer.message
					});
					if (answer.ok && answer.active) setFailure(void 0);
					if (answer.ok && !answer.active) setAccepted(false);
				}
				timer = setTimeout(() => void look(), POLL_MS);
			};
			look();
			return () => {
				abort.abort();
				clearTimeout(timer);
			};
		}, [
			slug,
			round,
			start
		]);
		React.useEffect(() => () => {
			work.current?.abort();
			secrets.clear();
		}, [secrets]);
		if (!start) return /* @__PURE__ */ React.createElement("section", {
			className: "gp-create",
			"aria-labelledby": "gp-claude-title",
			"data-gp": "claude"
		}, /* @__PURE__ */ React.createElement("h3", { id: "gp-claude-title" }, "Claude"), /* @__PURE__ */ React.createElement("p", {
			className: "gp-hint",
			role: "alert"
		}, "This Buzz cannot start programs. Use the Buzz desktop app."));
		const run = (way, job) => {
			const abort = new AbortController();
			work.current = abort;
			signingIn.current = true;
			setBusy(true);
			setFailure(void 0);
			setAccepted(false);
			job(abort.signal).then((result) => {
				work.current = void 0;
				signingIn.current = false;
				setBusy(false);
				secrets.clear();
				if (result.ok) {
					setAccepted(true);
					setRound((n) => n + 1);
					onSignedIn?.();
				} else if (!result.stopped) setFailure({
					way,
					message: result.message,
					...result.said === void 0 ? {} : { said: result.said }
				});
			});
		};
		const active = state.kind === "answer" && state.active;
		const notActive = state.kind === "answer" && !state.active;
		const headline = state.kind === "checking" ? CLAUDE_STATUS.checking : state.kind === "problem" ? state.message : active ? CLAUDE_STATUS.active : CLAUDE_STATUS.notActive;
		return /* @__PURE__ */ React.createElement("section", {
			className: "gp-create",
			"aria-labelledby": "gp-claude-title",
			"data-gp": "claude"
		}, /* @__PURE__ */ React.createElement("h3", { id: "gp-claude-title" }, "Claude"), /* @__PURE__ */ React.createElement("p", {
			className: "gp-question",
			role: state.kind === "problem" ? "alert" : "status",
			"data-gp": "claude-state"
		}, headline), accepted && active && /* @__PURE__ */ React.createElement("p", {
			className: "gp-hint",
			role: "status",
			"data-gp": "claude-accepted"
		}, CLAUDE_STATUS.accepted), (state.kind === "problem" || notActive) && !busy && /* @__PURE__ */ React.createElement("div", { className: "gp-row" }, /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "gp-button",
			onClick: () => setRound((n) => n + 1)
		}, "Check again")), notActive && /* @__PURE__ */ React.createElement(ClaudeGuide, {
			busy,
			token,
			onToken: secrets.setToken,
			canSend: tokenFit(token),
			onSend: () => {
				const sent = token;
				secrets.clear();
				run("token", (signal) => signInWithToken({ start }, slug, sent, signal));
			},
			onStartLogin: () => run("login", (signal) => signInByAddress({ start }, slug, progress.askCode, signal)),
			login: view.login && /* @__PURE__ */ React.createElement(Login, {
				key: view.login.url,
				progress,
				url: view.login.url
			}),
			failure
		}));
	};
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
		text: WORDS$1.unsupported
	};
	if (ran.kind === "unavailable") return {
		tone: "problem",
		text: WORDS$1.dockerUnavailable
	};
}
/**
* `gp update request`, or `gp update rollback`. Resolves with `undefined` when the caller left first.
* The answers are GHOST Protocol's: `GP_UPDATE=requested` or `rollback-requested` on exit 0, and on a
* failure a `GP_ERROR` that is `no-updater`, `no-update-available`, `update-in-progress` or `no-previous-version`, or another code.
*/
async function askToUpdate(run, slug, which) {
	const ran = await run(which === "update" ? updateCall(slug) : rollbackCall(slug), GP_MS);
	if (ran === void 0) return void 0;
	const failed = notRun(ran);
	if (failed) return failed;
	if (ran.kind !== "exit") return void 0;
	const lines = gpLines(ran.stdout);
	if (ran.code === 0) {
		const answer = lines.get("UPDATE");
		if (which === "update" && answer === "requested") return {
			tone: "ok",
			text: WORDS$1.updateRequested
		};
		if (which === "rollback" && answer === "rollback-requested") return {
			tone: "ok",
			text: WORDS$1.rollbackRequested
		};
		return {
			tone: "problem",
			text: WORDS$1.gpNotUnderstood
		};
	}
	const code = lines.get("ERROR");
	if (code === void 0) return {
		tone: "problem",
		text: withDetail(WORDS$1.dockerFailed, firstLine(ran.stderr))
	};
	if (code === "no-updater") return {
		tone: "info",
		text: which === "update" ? WORDS$1.noUpdaterTitle : WORDS$1.noUpdaterRollback,
		noUpdater: true
	};
	if (code === "no-update-available") return {
		tone: "info",
		text: WORDS$1.noUpdateAvailable
	};
	if (code === "update-in-progress") return {
		tone: "info",
		text: WORDS$1.updateInProgress
	};
	if (code === "no-previous-version") return {
		tone: "info",
		text: WORDS$1.noPreviousVersion
	};
	const message = lines.get("ERROR_MESSAGE");
	return {
		tone: "problem",
		text: message === void 0 || message === "" ? WORDS$1.gpRefused(code) : `${message} (${code})`
	};
}
/** `docker restart gp-<slug>` or `docker stop gp-<slug>`. Resolves with `undefined` when the caller left first. */
async function askDocker(run, slug, which) {
	const container = containerOf(slug);
	const ran = await run(which === "restart" ? restartCall(slug) : stopCall(slug), DOCKER_MS);
	if (ran === void 0) return void 0;
	const failed = notRun(ran);
	if (failed) return failed;
	if (ran.kind !== "exit") return void 0;
	if (ran.code === 0) return {
		tone: "ok",
		text: which === "restart" ? WORDS$1.restarted(container) : WORDS$1.stoppedNow(container)
	};
	return {
		tone: "problem",
		text: withDetail(which === "restart" ? WORDS$1.restartFailed(container) : WORDS$1.stopFailed(container), firstLine(ran.stderr))
	};
}
var DIGEST_PLACEHOLDER = "<digest of that version>";
var NAME = /^[a-z0-9][a-z0-9._/:-]*$/;
var TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
var DIGEST = /@sha256:[0-9a-f]{64}$/;
/**
* The image's name without its tag or its digest (`registry.example.com:5000/team/ghost-protocol` from
* `…/ghost-protocol:1.2.3@sha256:<64 hex>`), when it is safe.
*/
function imageNameOf(image) {
	if (image === void 0) return void 0;
	const pinned = image.replace(DIGEST, "");
	const colon = pinned.lastIndexOf(":");
	const name = colon > pinned.lastIndexOf("/") ? pinned.slice(0, colon) : pinned;
	return NAME.test(name) ? name : void 0;
}
var versionIfSafe = (version) => version !== null && version !== void 0 && TAG.test(version) ? version : void 0;
/** The three commands, in order: pull the new version, remove the container, start it again on the same data volume. */
var commands = (slug, reference) => {
	const container = containerOf(slug);
	return [
		`docker pull ${reference}`,
		`docker rm -f ${container}`,
		`docker run -d --name ${container} --restart unless-stopped -v ${container}-data:/data ${reference}`
	];
};
/**
* The steps for the update on offer (`version` and `image` of the status's `update`). `containerImage` is the image the container was made
* from, read only for the placeholder steps. Where it or the version is not known the placeholder steps show a placeholder for it.
*/
function updateByHand(slug, containerImage, offer) {
	if (offer.image.kind === "pinned") return {
		kind: "pinned",
		steps: commands(slug, offer.image.image)
	};
	if (offer.image.kind === "refused") return { kind: "refused" };
	return {
		kind: "placeholder",
		steps: commands(slug, `${imageNameOf(containerImage) ?? "<agent image>"}:${versionIfSafe(offer.version) ?? "<new version>"}@sha256:${DIGEST_PLACEHOLDER}`)
	};
}
/** Whether two offers are the same update: the same version, and the same image (or none, or a refused one). */
function sameOffer(a, b) {
	if (a.version !== b.version || a.image.kind !== b.image.kind) return false;
	return a.image.kind !== "pinned" || b.image.kind === "pinned" && a.image.image === b.image.image;
}
// src/ui/StatusScreen.tsx
/** The most of a text from GHOST Protocol that the screen shows: a long one is cut, so it cannot fill the page. */
var SHOWN_MAX = 300;
var clip = (text) => text.length > SHOWN_MAX ? `${text.slice(0, SHOWN_MAX)}…` : text;
/** A line of what the screen has to say, and whether it is a problem (it is then an alert). */
var lineOf = (view, container) => {
	if (view === void 0) return {
		text: WORDS$1.looking(container),
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
			text: WORDS$1.unreadable,
			problem: true
		};
		case "swapping": return {
			text: WORDS$1.swapping,
			problem: false
		};
		case "stopped": return {
			text: WORDS$1.stopped(container, view.dockerState),
			problem: true
		};
		case "gone": return {
			text: WORDS$1.gone(container),
			problem: true
		};
		case "not-answering": return {
			text: WORDS$1.notAnswering(container),
			problem: true
		};
		case "docker-unavailable": return {
			text: WORDS$1.dockerUnavailable,
			problem: true
		};
		case "unsupported": return {
			text: WORDS$1.unsupported,
			problem: true
		};
	}
};
function Facts({ status }) {
	return /* @__PURE__ */ React.createElement("dl", { className: "gp-facts" }, /* @__PURE__ */ React.createElement("dt", null, WORDS$1.state), /* @__PURE__ */ React.createElement("dd", null, STATE_WORDS[status.state]), /* @__PURE__ */ React.createElement("dt", null, WORDS$1.version), /* @__PURE__ */ React.createElement("dd", { className: "gp-mono" }, clip(status.version)), /* @__PURE__ */ React.createElement("dt", null, WORDS$1.relay), /* @__PURE__ */ React.createElement("dd", null, RELAY_WORDS[status.relay]), /* @__PURE__ */ React.createElement("dt", null, WORDS$1.relayUrl), /* @__PURE__ */ React.createElement("dd", { className: "gp-mono" }, clip(status.relayUrl)), /* @__PURE__ */ React.createElement("dt", null, WORDS$1.claude), /* @__PURE__ */ React.createElement("dd", null, CLAUDE_WORDS[status.claude]), /* @__PURE__ */ React.createElement("dt", null, WORDS$1.update), /* @__PURE__ */ React.createElement("dd", null, status.update.available ? WORDS$1.updateAvailable(status.update.version === null ? null : clip(status.update.version)) : WORDS$1.noUpdate), /* @__PURE__ */ React.createElement("dt", null, WORDS$1.previousVersion), /* @__PURE__ */ React.createElement("dd", { className: status.previousVersion === null ? void 0 : "gp-mono" }, status.previousVersion === null ? WORDS$1.noPrevious : clip(status.previousVersion)));
}
/**
* The status of one agent, found by the `<slug>` of its container `gp-<slug>`: what `gp status --json` says, and the four buttons. It
* looks about every ten seconds for as long as it is on the page, and its calls end with it.
*/
function createStatusScreen(host) {
	return function StatusScreen({ slug, again = 0 }) {
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
		}, [
			slug,
			looks,
			again
		]);
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
			const offer = done.noUpdater === true && job === "update" && status !== void 0 ? {
				version: status.update.version,
				image: status.update.image
			} : void 0;
			const image = offer?.image.kind === "none" ? await imageOf(run, slug) : void 0;
			if (signal.aborted) return;
			if (offer !== void 0) setByHand({
				steps: updateByHand(slug, image, offer),
				offer
			});
			memory.current = afterButton(memory.current, job, done.tone === "ok", status?.version);
			setWorking(void 0);
			setOutcome(offer !== void 0 ? void 0 : done);
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
		}, text), view?.kind === "not-answering" && (view.code !== void 0 || view.message !== void 0) && /* @__PURE__ */ React.createElement("p", { className: "gp-note" }, clip([view.message, view.code === void 0 ? void 0 : `(${view.code})`].filter(Boolean).join(" "))), status && /* @__PURE__ */ React.createElement(Facts, { status }), status?.error && /* @__PURE__ */ React.createElement("dl", { className: "gp-facts gp-problem" }, /* @__PURE__ */ React.createElement("dt", null, WORDS$1.errorCode), /* @__PURE__ */ React.createElement("dd", { className: "gp-mono" }, clip(status.error.code)), /* @__PURE__ */ React.createElement("dt", null, WORDS$1.errorMessage), /* @__PURE__ */ React.createElement("dd", null, clip(status.error.message))), status?.relay === "refused-not-member" && /* @__PURE__ */ React.createElement("div", {
			className: "gp-refused",
			role: "alert"
		}, /* @__PURE__ */ React.createElement("p", null, "Your relay does not accept owner attestations. Ask its admin to turn them on, or to add this agent as a relay member."), /* @__PURE__ */ React.createElement("p", { className: "gp-label" }, WORDS$1.publicKey), /* @__PURE__ */ React.createElement(CopyBlock, { text: status.agentPubkey })), (buttons.update || buttons.rollback || buttons.restart || buttons.stop) && /* @__PURE__ */ React.createElement("div", { className: "gp-buttons" }, buttons.update && button("update", WORDS$1.buttons.update), buttons.rollback && button("rollback", WORDS$1.buttons.rollback, status?.previousVersion === null), buttons.restart && button("restart", WORDS$1.buttons.restart), buttons.stop && button("stop", WORDS$1.buttons.stop)), busy && /* @__PURE__ */ React.createElement("p", { role: "status" }, WORDS$1.working), outcome && /* @__PURE__ */ React.createElement("p", {
			className: outcome.tone === "problem" ? "gp-problem" : void 0,
			role: outcome.tone === "problem" ? "alert" : "status"
		}, outcome.text), byHand && /* @__PURE__ */ React.createElement("div", { className: "gp-steps" }, /* @__PURE__ */ React.createElement("p", null, byHand.steps.kind === "refused" ? WORDS$1.noUpdaterRefusedTitle : WORDS$1.noUpdaterTitle), byHand.steps.kind === "refused" ? /* @__PURE__ */ React.createElement("p", {
			className: "gp-problem",
			role: "alert"
		}, WORDS$1.noUpdaterRefused) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "gp-note" }, byHand.steps.kind === "pinned" ? WORDS$1.noUpdaterPinned : WORDS$1.noUpdaterDigest), /* @__PURE__ */ React.createElement("ol", null, byHand.steps.steps.map((step) => /* @__PURE__ */ React.createElement("li", { key: step }, /* @__PURE__ */ React.createElement(CopyBlock, { text: step })))), /* @__PURE__ */ React.createElement("p", { className: "gp-note" }, WORDS$1.noUpdaterNote(`${container}-data`))), status?.update.available === true && !sameOffer(byHand.offer, status.update) && /* @__PURE__ */ React.createElement("p", {
			className: "gp-note",
			role: "status"
		}, WORDS$1.noUpdaterChanged)));
	};
}
// src/ui/AgentTab.tsx
function createAgentTab(host, book) {
	const ClaudePanel = createClaudePanel(host);
	const StatusScreen = createStatusScreen(host);
	return function GhostProtocolTab({ agent }) {
		const written = book.get(agent.pubkey);
		const slug = written ?? slugFromName(agent.name);
		const [guard, setGuard] = React.useState("checking");
		const [signedIn, setSignedIn] = React.useState(0);
		React.useEffect(() => {
			if (slug === void 0) return;
			const abort = new AbortController();
			setGuard("checking");
			verifyContainer(host, slug, agent.pubkey, written !== void 0, abort.signal).then((answer) => {
				if (answer !== void 0 && !abort.signal.aborted) setGuard(answer);
			});
			return () => abort.abort();
		}, [
			slug,
			agent.pubkey,
			written !== void 0
		]);
		if (slug === void 0) return /* @__PURE__ */ React.createElement("p", {
			className: "gp-create gp-hint",
			"data-gp": "no-container"
		}, "This computer has no GHOST Protocol container for this agent.");
		if (guard !== "ok") return /* @__PURE__ */ React.createElement("p", {
			className: "gp-create gp-hint",
			role: guard === "checking" ? "status" : "alert",
			"data-gp": guard === "checking" ? "checking" : `container-${guard}`
		}, guard === "checking" ? "Looking at this agent's container…" : guard === "other" ? `This container belongs to another agent: gp-${slug} on this computer is not this agent's, so nothing here acts on it.` : `Nothing here acts on gp-${slug}: this computer has no record of which container is this agent's, and Docker did not say whose it is.`);
		return /* @__PURE__ */ React.createElement("div", {
			className: "gp-root gp-in-tab",
			"data-gp": "agent-tab"
		}, /* @__PURE__ */ React.createElement(StatusScreen, {
			key: slug,
			slug,
			again: signedIn
		}), /* @__PURE__ */ React.createElement(ClaudePanel, {
			key: `claude-${slug}`,
			slug,
			onSignedIn: () => setSignedIn((n) => n + 1)
		}));
	};
}
// src/ui/create-styles.ts
var CREATE_CSS = `
.gp-create {
  --gp-ink: var(--text-standard, #e9eef4);
  --gp-muted: var(--text-metadata, #8290a0);
  --gp-line: var(--border-standard, #2b333d);
  --gp-focus: var(--border-focus, var(--accent-9, #4f9cf9));
  --gp-hover: var(--affordance-row-hover, rgba(128, 140, 160, 0.14));
  display: flex; flex-direction: column; gap: 10px; min-width: 0; color: var(--gp-ink); font-size: 13px; line-height: 1.45;
}
.gp-root.gp-in-tab { height: auto; background: transparent; gap: 14px; padding: 0 0 16px; }
.gp-in-tab .gp-create { padding: 18px 20px; border: 1px solid var(--gp-line); border-radius: 4px; background: var(--gp-card, transparent); }
.gp-create *, .gp-create *::before, .gp-create *::after { box-sizing: border-box; }
.gp-create :focus-visible { outline: 2px solid var(--gp-focus); outline-offset: 2px; }
.gp-create-group { margin: 0; padding: 10px 0 0; border: 0; border-top: 1px solid var(--gp-line); min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.gp-create-group legend { padding: 0 6px 0 0; font-weight: 600; }
.gp-create-fields { display: flex; flex-direction: column; gap: 6px; }
.gp-choice { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.gp-choice[aria-disabled="true"] { opacity: 0.6; cursor: default; }
.gp-soon { color: var(--gp-muted); font-size: 12px; }
.gp-hint { margin: 0; color: var(--gp-muted); overflow-wrap: anywhere; }
.gp-question { margin: 0; font-weight: 500; overflow-wrap: anywhere; }
.gp-input { width: 100%; min-width: 0; height: 30px; padding: 0 8px; border: 1px solid var(--gp-line); border-radius: 4px; background: transparent; color: inherit; font: inherit; }
.gp-create code { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.gp-steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.gp-step { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.gp-step[data-state="waiting"], .gp-step[data-state="skipped"] { color: var(--gp-muted); }
.gp-mark { width: 1.2em; text-align: center; flex: none; }
.gp-step-state, .gp-step-note { color: var(--gp-muted); font-size: 12px; overflow-wrap: anywhere; min-width: 0; }
.gp-login, .gp-refused { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--gp-line); border-radius: 4px; }
.gp-address { margin: 0; overflow-wrap: anywhere; }
.gp-guide { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.gp-guide a { color: inherit; text-decoration: underline; }
.gp-way { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding-top: 12px; border-top: 1px solid var(--gp-line); }
.gp-way h4 { margin: 0; font-size: 13px; font-weight: 600; }
.gp-way ol { margin: 0; padding-left: 20px; list-style: decimal outside; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.gp-way li { min-width: 0; }
.gp-way li > * + * { margin-top: 6px; }
.gp-way p { margin: 0; overflow-wrap: anywhere; }
.gp-os { color: var(--gp-muted); font-size: 12px; }
.gp-refusal { display: flex; flex-direction: column; gap: 4px; }
.gp-way .gp-input { max-width: 100%; }
.gp-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.gp-create .gp-button { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border: 1px solid var(--gp-line); border-radius: 4px;
  background: transparent; color: var(--gp-ink); font: inherit; font-weight: 500; cursor: pointer; }
.gp-create .gp-button:hover:not(:disabled) { background: var(--gp-hover); }
.gp-create .gp-button:disabled { opacity: 0.5; cursor: default; }
`;
// src/ui/icons.ts
/**
* The page's entry in navigation and search: a ghost. It is one shape in one colour on purpose: Buzz draws a page's icon as an `<img>`,
* which cannot take the theme's colour, so `CSS` (ui/styles) paints this shape in the entry's own text colour instead and uses this
* image only as the mask. The eyes are holes in the shape (even-odd), so they show the entry's background.
*/
var PAGE_ICON = "data:image/svg+xml," + encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill-rule=\"evenodd\" d=\"M12 3a7 7 0 0 0-7 7v10.5l2.33-1.75L9.67 20.5 12 18.75l2.33 1.75 2.34-1.75L19 20.5V10a7 7 0 0 0-7-7zM9.5 9.3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm5 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z\"/></svg>");
// src/ui/styles.ts
var CSS = `
/* [DOM] The page's entry in navigation and search. The host draws its icon as an <img> of PAGE_ICON, which cannot follow the theme, so
   paint the same shape in the entry's text colour (a mask) and move the image's own pixels out of its box. It matches only an <img>
   whose src is exactly PAGE_ICON, so no other icon is touched. If a later host draws the icon some other way this stops matching and the
   icon is simply the plain black one. */
img[src="${PAGE_ICON}"] {
  background-color: currentColor;
  -webkit-mask: url("${PAGE_ICON}") center / contain no-repeat;
  mask: url("${PAGE_ICON}") center / contain no-repeat;
  object-position: 999px 0;
}
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
		}, /* @__PURE__ */ React.createElement("label", { htmlFor: "gp-slug" }, WORDS$1.slugLabel), /* @__PURE__ */ React.createElement("input", {
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
		}, WORDS$1.slugHelp), rejected && /* @__PURE__ */ React.createElement("p", {
			className: "gp-problem",
			role: "alert"
		}, WORDS$1.slugBad), /* @__PURE__ */ React.createElement("button", {
			type: "submit",
			className: "gp-button"
		}, WORDS$1.show))), shown !== void 0 && /* @__PURE__ */ React.createElement(StatusScreen, {
			key: shown,
			slug: shown
		}), /* @__PURE__ */ React.createElement("p", { className: "gp-note" }, "GHOST Protocol runs as a container in Docker on this computer. This page checks Docker and shows an agent's status.")));
	};
}
// src/index.tsx
var inject = [
	"react",
	"pages",
	"host",
	"agents",
	"relay"
];
/** The id in manifest.json: Buzz keys an agent type `<plugin id>/<type id>`. A unit test holds the two equal. */
var PLUGIN_ID = "megatech.ghost-protocol";
function apply(ctx) {
	provideReact(ctx.react);
	ctx.effect(() => {
		const style = document.createElement("style");
		style.dataset.ghostProtocol = "";
		style.textContent = CSS + CREATE_CSS;
		document.head.append(style);
		return () => style.remove();
	});
	ctx.pages.register({
		id: "ghost-protocol",
		title: "GHOST Protocol",
		icon: PAGE_ICON,
		primary: true,
		layout: "workspace",
		component: createPage(ctx.host)
	});
	const progress = createProgress();
	const secrets = createSecrets();
	const book = createBook();
	ctx.agents.register(agentType({
		host: ctx.host,
		relay: ctx.relay,
		progress,
		secrets,
		book,
		...createParts(progress, secrets)
	}));
	ctx.agents.registerTab({
		id: "ghost-protocol",
		title: "GHOST Protocol",
		component: createAgentTab(ctx.host, book),
		when: (agent) => agent.type === `${PLUGIN_ID}/${TYPE_ID}`
	});
}
export { PLUGIN_ID, apply, inject };
