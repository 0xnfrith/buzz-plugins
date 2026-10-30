var ENDPOINT = `https://api.linear.app/graphql`;
var LinearError = class extends Error {
	kind;
	/** Epoch milliseconds before which asking again is pointless. */
	retryAt;
	constructor(kind, message, retryAt) {
		super(message);
		this.name = "LinearError";
		this.kind = kind;
		this.retryAt = retryAt;
	}
};
/**
* One GraphQL call to Linear, through the host's declared-origin HTTP client. The key is
* read when the call starts and goes nowhere but the Authorization header: it is not in
* a URL, an error message, or a log line. Every error's text is fixed here, never taken from Linear's reply.
*/
function createClient(transport, readKey, now = Date.now) {
	return { async request(operationName, query, variables = {}, candidate) {
		const key = candidate ?? await readKey();
		if (!key) throw new LinearError("no-key", "No Linear API key is saved.");
		let response;
		try {
			response = await transport({
				url: ENDPOINT,
				method: "POST",
				headers: {
					authorization: key,
					"content-type": "application/json"
				},
				body: JSON.stringify({
					operationName,
					query,
					variables
				})
			});
		} catch {
			throw new LinearError("network", "Could not reach Linear.");
		}
		return parse(response, now());
	} };
}
function parse(response, now) {
	const headers = lowercaseKeys(response.headers);
	let body;
	try {
		body = JSON.parse(response.body);
	} catch {
		body = void 0;
	}
	const first = body?.errors?.[0];
	const code = first?.extensions?.code ?? first?.extensions?.type ?? "";
	if (response.status === 429 || /rate.?limit/i.test(code)) throw new LinearError("rate-limited", "Linear is rate limiting this key.", retryAt(headers, now));
	if (response.status === 401 || /authenticat|forbidden/i.test(code)) throw new LinearError("auth", /forbidden/i.test(code) ? "This key is not allowed to do that. It needs Read and Write access." : "Linear did not accept the API key.");
	if (response.status >= 500) throw new LinearError("server", `Linear is having trouble right now (${response.status}).`);
	if (first) throw new LinearError("rejected", "Linear refused the request.");
	if (response.status < 200 || response.status >= 300 || !body || body.data == null) throw new LinearError("server", `Linear answered with an unexpected response (${response.status}).`);
	return body.data;
}
function lowercaseKeys(headers) {
	return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}
/** Linear says when the window resets in `X-RateLimit-*-Reset`; wait a minute if it does not. */
function retryAt(headers, now) {
	const stamps = ["x-ratelimit-requests-reset", "x-ratelimit-complexity-reset"].map((name) => Number(headers[name])).filter((n) => Number.isFinite(n) && n > 0).map((n) => n < 0xe8d4a51000 ? n * 1e3 : n);
	const at = stamps.length ? Math.max(...stamps) : now + 6e4;
	return Math.min(Math.max(at, now + 1e3), now + 36e5);
}
// src/linear/keys.ts
var KEY = "megatech.linear.api-key.v1";
/** How each store is driven, and what a save that is not confirmed means there. */
var STORES = {
	keychain: {
		read: "keychain-read",
		save: "keychain-save",
		delete: "keychain-delete",
		input: (value) => `${value}\n${value}\n`,
		plainFallback: false
	},
	"secret-service": {
		read: "secret-read",
		save: "secret-save",
		delete: "secret-delete",
		input: (value) => value,
		plainFallback: true
	}
};
/** What the card calls each store. */
var STORE_NAME = {
	keychain: "your Keychain",
	"secret-service": "the system secret store (Secret Service)"
};
/** Which store this system has, from what the page says it runs on. */
function detectStore(platform, userAgent) {
	const [p, ua] = [platform ?? "", userAgent ?? ""];
	if (/^Mac/i.test(p) || /Macintosh/.test(ua)) return "keychain";
	if ((/^Linux/i.test(p) || /Linux/.test(ua)) && !/Android/i.test(ua)) return "secret-service";
}
var withoutLineBreak = (text) => text?.replace(/\r?\n$/, "");
function createKeyStore(storage, { run, store } = {}) {
	const listeners = /* @__PURE__ */ new Set();
	let version = 0;
	const notify = (restart) => {
		if (restart) version += 1;
		listeners.forEach((listener) => listener());
	};
	const kind = run !== void 0 ? store : void 0;
	const driver = kind ? STORES[kind] : void 0;
	const secret = (command, input) => run ? run(command, input).catch(() => null) : Promise.resolve(null);
	const profileCopy = () => {
		try {
			return storage.getItem(KEY) || void 0;
		} catch {
			return;
		}
	};
	const dropProfileCopy = () => {
		try {
			storage.removeItem(KEY);
		} catch {}
	};
	let key;
	let place;
	let tail = Promise.resolve();
	const serial = (task) => {
		const next = tail.then(task, task);
		tail = next.catch(() => void 0);
		return next;
	};
	const readStore = async () => driver ? withoutLineBreak(await secret(driver.read)) || void 0 : void 0;
	/** Puts a key in the store and reads it back to be sure: the program's own exit status is not trusted to say. */
	async function toStore(value) {
		if (!driver) return false;
		await secret(driver.save, driver.input(value));
		if (await readStore() !== value) return false;
		dropProfileCopy();
		return true;
	}
	/**
	* Looks for the key: the store first, then the profile. A key in the profile where there is a store is moved to it. When both
	* hold a key and they differ, the profile's is the newer one: a key reaches the profile only when the store could not be
	* reached (or, in an earlier version, always), so the store holds an older key. It is moved the same way, and the store keeps
	* the older key until the read-back says the newer one is there.
	*/
	async function load(initial) {
		const [before, placeBefore] = [key, place];
		const kept = await readStore();
		const plain = profileCopy();
		if (kept && (plain === void 0 || plain === kept)) {
			[key, place] = [kept, kind];
			if (plain !== void 0) dropProfileCopy();
		} else if (plain !== void 0) {
			[key, place] = [plain, "profile"];
			if (driver && await toStore(plain)) place = kind;
		} else [key, place] = [void 0, void 0];
		if (initial || key !== before || place !== placeBefore) notify(!initial && key !== before);
	}
	let started;
	const begin = () => started ??= serial(() => load(true));
	return {
		/** Changes whenever the key is another one, for effects that must start over. */
		version: () => version,
		/** Settles when the first look for the key (and the move out of the profile) is over; asking for it makes the look. */
		get ready() {
			return begin();
		},
		/** Looks again (the store may have been given the key from outside). */
		reload: () => {
			begin();
			return serial(() => load(false));
		},
		/** The saved key, for the client only. Nothing else should hold on to it. */
		read: () => key,
		has: () => key !== void 0,
		place: () => place,
		/** The store this system has and the plugin can drive, if any. */
		store: () => kind,
		/**
		* Keeps a key, in the store where there is one, otherwise in the profile as plain text. When the store does not confirm it:
		* on a Mac nothing is kept (`kept: false`, a saved key unchanged); on Linux the key goes to the profile, labelled
		* (`degraded: true`), unless the store already holds a key, which a plain copy would only shadow (`kept: false`).
		*/
		save: (value) => {
			begin();
			return serial(async () => {
				let degraded = false;
				if (driver) {
					if (await toStore(value)) [key, place] = [value, kind];
					else if (driver.plainFallback && place !== kind) {
						storage.setItem(KEY, value);
						[key, place] = [value, "profile"];
						degraded = true;
					} else return {
						kept: false,
						degraded: false
					};
				} else {
					storage.setItem(KEY, value);
					[key, place] = [value, "profile"];
				}
				notify(true);
				return {
					kept: true,
					degraded
				};
			});
		},
		/** Moves a key kept in the profile to the store; false when it would not take it and the key stays where it was. */
		moveToStore: () => {
			begin();
			return serial(async () => {
				if (key === void 0 || place !== "profile" || !await toStore(key)) return false;
				place = kind;
				notify(false);
				return true;
			});
		},
		/** Removes the key from the store and the profile. False when one still has it afterwards (it then stays in use). */
		clear: () => {
			begin();
			return serial(async () => {
				dropProfileCopy();
				let left = profileCopy();
				let where = left === void 0 ? void 0 : "profile";
				if (driver) {
					await secret(driver.delete);
					const kept = await readStore();
					if (kept) [left, where] = [kept, kind];
				}
				[key, place] = [left, where];
				notify(true);
				return left === void 0;
			});
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}
/**
* What to do with a pasted key once Linear has been asked about it. A key Linear refuses is never saved. A key Linear
* could not be asked about (unreachable, down, rate limiting) replaces nothing: when a key is already saved it stays and
* the user is told to try again; only when there is no key yet is the new one saved, and the message says it was not checked.
* `message` is the whole text to show, or null to show the client's own text for the refusal.
*/
function judgeKey(verdict, hadKey, clientText) {
	if (verdict === "ok") return {
		save: true,
		message: null
	};
	if (verdict === "auth" || verdict === "rejected") return {
		save: false,
		message: null
	};
	if (!hadKey) return {
		save: true,
		message: `${clientText} The key was saved without being checked; test it again in a moment.`
	};
	return {
		save: false,
		message: `${verdict === "network" ? "Couldn't reach Linear to check the new key." : verdict === "rate-limited" ? "Linear is rate limiting requests, so the new key could not be checked." : "Linear is having trouble right now, so the new key could not be checked."} Your saved key is unchanged; try again${verdict === "rate-limited" ? " in a minute" : ""}.`
	};
}
/** What was pasted, made safe to put in a header: no `Bearer`, no spaces or line breaks. */
function checkKey(pasted) {
	const key = pasted.trim().replace(/^bearer\s+/i, "");
	if (!key) return {
		ok: false,
		message: "Paste your Linear API key."
	};
	if (key.length < 8 || key.length > 200 || !/^[\x21-\x7e]+$/.test(key)) return {
		ok: false,
		message: "That does not look like a Linear API key."
	};
	return {
		ok: true,
		key
	};
}
// src/linear/model.ts
/** Linear's board order: triage first, then the lifecycle, then its own `position`. */
var TYPE_ORDER = {
	triage: 0,
	backlog: 1,
	unstarted: 2,
	started: 3,
	completed: 4,
	canceled: 5,
	duplicate: 6
};
/** A state type this plugin does not know sorts after the ones it does, rather than breaking the order. */
var rank = (type) => TYPE_ORDER[type] ?? Object.keys(TYPE_ORDER).length;
/** Linear moves an issue into Duplicate only by marking it a duplicate of another, which the board cannot do. */
var acceptsMoves = (type) => type !== "duplicate";
function sortStates(states) {
	return [...states].sort((a, b) => rank(a.type) - rank(b.type) || a.position - b.position);
}
function toIssue(raw) {
	return {
		id: raw.id,
		identifier: raw.identifier,
		title: raw.title,
		priority: raw.priority >= 0 && raw.priority <= 4 ? raw.priority : 0,
		createdAt: raw.createdAt,
		updatedAt: raw.updatedAt,
		url: raw.url,
		sortOrder: raw.sortOrder,
		stateId: raw.state.id,
		parent: raw.parent,
		assignee: raw.assignee,
		project: raw.project,
		labels: raw.labels.nodes,
		pullRequests: pullRequests(raw.attachments.nodes),
		progress: progress(raw.children.nodes)
	};
}
function toDetail(raw) {
	return {
		description: raw.description ?? "",
		creator: raw.creator?.name ?? null,
		dueDate: raw.dueDate,
		estimate: raw.estimate,
		subIssues: raw.subIssues.nodes
	};
}
/** GitHub pull requests Linear linked to the issue, found by their URL. */
function pullRequests(attachments) {
	const found = [];
	for (const attachment of attachments) {
		const match = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/.exec(attachment.url);
		if (!match) continue;
		found.push({
			url: attachment.url,
			number: Number(match[1]),
			status: prStatus$1(attachment.metadata)
		});
	}
	return found;
}
function prStatus$1(metadata) {
	if (!metadata || typeof metadata !== "object") return "unknown";
	const meta = metadata;
	if (meta.draft === true) return "draft";
	const status = typeof meta.status === "string" ? meta.status.toLowerCase() : "";
	if (status === "merged" || meta.merged === true) return "merged";
	if (status === "closed" || meta.closed === true) return "closed";
	if (status === "open" || status === "opened") return "open";
	if (status === "draft") return "draft";
	return "unknown";
}
/** Done out of all sub-issues that were not cancelled or marked duplicates; none when there are no sub-issues. */
function progress(children) {
	const live = children.filter((child) => child.state.type !== "canceled" && child.state.type !== "duplicate");
	if (live.length === 0) return null;
	return {
		done: live.filter((child) => child.state.type === "completed").length,
		total: live.length
	};
}
/** Columns that are mostly history show what changed last; the others keep Linear's manual order. */
function sortColumn(issues, type) {
	const history = type === "completed" || type === "canceled" || type === "duplicate";
	return [...issues].sort((a, b) => history ? b.updatedAt.localeCompare(a.updatedAt) : a.sortOrder - b.sortOrder || b.createdAt.localeCompare(a.createdAt));
}
// src/linear/queries.ts
var ISSUE_CARD = `
  fragment IssueCard on Issue {
    id
    identifier
    title
    priority
    createdAt
    updatedAt
    url
    sortOrder
    state { id }
    parent { identifier title }
    assignee { id name }
    project { id name color }
    labels(first: 6) { nodes { id name color } }
    attachments(first: 10) { nodes { sourceType url metadata } }
    children(first: 50) { nodes { state { type } } }
  }
`;
var VIEWER = `
  query Viewer {
    viewer { id name displayName }
    organization { name }
  }
`;
var TEAMS = `
  query Teams {
    teams(first: 100) { nodes { id key name color } }
  }
`;
var TEAM_SETUP = `
  query TeamSetup($teamId: String!, $teamFilterId: ID!) {
    team(id: $teamId) {
      id
      states(first: 100) { nodes { id name type color position } }
      projects(first: 100) { nodes { id name color } }
    }
    customViews(first: 100, filter: { team: { id: { eq: $teamFilterId } } }) {
      nodes { id name color }
    }
  }
`;
var COLUMN_ISSUES = `
  ${ISSUE_CARD}
  query ColumnIssues($filter: IssueFilter!, $first: Int!, $after: String) {
    issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
      nodes { ...IssueCard }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
var VIEW_COLUMN_ISSUES = `
  ${ISSUE_CARD}
  query ViewColumnIssues($viewId: String!, $filter: IssueFilter!, $first: Int!, $after: String) {
    customView(id: $viewId) {
      issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
        nodes { ...IssueCard }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;
/** One cheap question for the refresh timer: did anything in the team change, and what is the newest change? */
var CHANGED_SINCE = `
  query ChangedSince($filter: IssueFilter!) {
    issues(filter: $filter, first: 1, includeArchived: true, orderBy: updatedAt) { nodes { id updatedAt } }
  }
`;
var ISSUE_DETAIL = `
  query IssueDetail($id: String!) {
    issue(id: $id) {
      id
      description
      dueDate
      estimate
      creator { name }
      subIssues: children(first: 50) {
        nodes { id identifier title state { name type color } }
      }
    }
  }
`;
var MOVE_ISSUE = `
  ${ISSUE_CARD}
  mutation MoveIssue($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) {
      success
      issue { ...IssueCard }
    }
  }
`;
var PREFS = "megatech.linear.board.v1";
var initial = {
	phase: "idle",
	problem: null,
	teams: [],
	choice: null,
	states: [],
	projects: [],
	views: [],
	issues: {},
	columns: {},
	refreshing: false,
	moving: [],
	notice: null,
	settled: null,
	refreshedAt: null
};
/**
* Everything the board knows, outside React so the refresh timer, a move in flight and a
* page that mounts and unmounts all see one state. Requests that come back after the team
* or filter changed are dropped (`generation`), and a refresh never overwrites an issue
* that is mid-move.
*/
function createBoardStore(client, storage, now = Date.now) {
	let state = initial;
	let generation = 0;
	let refreshing;
	/** The strongest kind of reload asked for while one was running (`true` = also re-read the team's setup). */
	let pendingFull;
	/** The newest `updatedAt` the board has seen, which the refresh timer asks Linear to beat. */
	let watermark = null;
	let probing = false;
	let lastProbeAt = 0;
	/** Each move bumps a counter, so a read that began before a move cannot undo it. */
	let moveSeq = 0;
	const movedAt = /* @__PURE__ */ new Map();
	const listeners = /* @__PURE__ */ new Set();
	const details = /* @__PURE__ */ new Map();
	const newer = (a, b) => a !== null && a >= b ? a : b;
	const set = (patch) => {
		state = {
			...state,
			...typeof patch === "function" ? patch(state) : patch
		};
		listeners.forEach((listener) => listener());
	};
	const fail = (error) => {
		if (error instanceof LinearError) return {
			kind: error.kind,
			message: error.message,
			...error.retryAt ? { retryAt: error.retryAt } : {}
		};
		return {
			kind: "server",
			message: "Something went wrong talking to Linear."
		};
	};
	/** A refused key, or nothing loaded yet, leaves the board blocked; any other failure keeps what is on screen and says so. */
	const settleFailure = (error) => {
		const problem = fail(error);
		const unusable = problem.kind === "no-key" || problem.kind === "auth";
		set({
			problem,
			phase: unusable || Object.keys(state.columns).length === 0 ? "blocked" : "ready"
		});
	};
	const readPrefs = () => {
		try {
			const saved = JSON.parse(storage.getItem(PREFS) ?? "null");
			if (saved && typeof saved.teamId === "string" && saved.scope && typeof saved.scope.kind === "string") return saved;
		} catch {}
		return null;
	};
	const writePrefs = (choice) => {
		try {
			storage.setItem(PREFS, JSON.stringify(choice));
		} catch {}
	};
	const filterFor = (choice, stateId) => ({
		team: { id: { eq: choice.teamId } },
		state: { id: { eq: stateId } },
		...choice.scope.kind === "project" ? { project: { id: { eq: choice.scope.id } } } : {}
	});
	async function fetchColumn(choice, stateId, after) {
		const variables = {
			first: 50,
			after,
			filter: filterFor(choice, stateId)
		};
		const page = choice.scope.kind === "view" ? (await client.request("ViewColumnIssues", VIEW_COLUMN_ISSUES, {
			...variables,
			viewId: choice.scope.id
		})).customView.issues : (await client.request("ColumnIssues", COLUMN_ISSUES, variables)).issues;
		return {
			issues: page.nodes.map(toIssue),
			page: page.pageInfo
		};
	}
	async function loadSetup(teamId) {
		const data = await client.request("TeamSetup", TEAM_SETUP, {
			teamId,
			teamFilterId: teamId
		});
		return {
			states: sortStates(data.team.states.nodes),
			projects: [...data.team.projects.nodes].sort((a, b) => a.name.localeCompare(b.name)),
			views: [...data.customViews.nodes].sort((a, b) => a.name.localeCompare(b.name))
		};
	}
	/** Loads the first page of every column. `full` also re-reads the team's states, projects and views. */
	async function load(full) {
		let choice = state.choice;
		if (!choice) return;
		const mine = generation;
		const since = moveSeq;
		const setup = full ? await loadSetup(choice.teamId) : null;
		if (mine !== generation) return;
		let dropped = false;
		if (setup && choice.scope.kind !== "team") {
			const scopeId = choice.scope.id;
			if (!(choice.scope.kind === "project" ? setup.projects : setup.views).some((x) => x.id === scopeId)) {
				choice = {
					teamId: choice.teamId,
					scope: { kind: "team" }
				};
				writePrefs(choice);
				dropped = true;
			}
		}
		const loading = choice;
		const states = setup?.states ?? state.states;
		const pages = await Promise.all(states.map((s) => fetchColumn(loading, s.id, null)));
		if (mine !== generation) return;
		set((current) => {
			const issues = {};
			const columns = {};
			states.forEach((s, index) => {
				const result = pages[index];
				columns[s.id] = {
					ids: result.issues.map((issue) => issue.id),
					hasMore: result.page.hasNextPage,
					cursor: result.page.endCursor,
					loadingMore: false
				};
				for (const issue of result.issues) issues[issue.id] = issue;
			});
			const keep = new Set(current.moving);
			for (const [id, at] of movedAt) if (at > since) keep.add(id);
			for (const id of keep) {
				const local = current.issues[id];
				if (!local) continue;
				for (const column of Object.values(columns)) column.ids = column.ids.filter((x) => x !== id);
				const target = columns[local.stateId];
				if (target) target.ids.push(id);
				issues[id] = local;
			}
			for (const issue of Object.values(issues)) watermark = newer(watermark, issue.updatedAt);
			return {
				...setup ? {
					states: setup.states,
					projects: setup.projects,
					views: setup.views
				} : {},
				...dropped ? {
					choice: loading,
					notice: "The saved filter no longer exists, so the board shows all issues."
				} : {},
				issues,
				columns,
				phase: "ready",
				problem: null,
				refreshedAt: now()
			};
		});
	}
	/** Runs `load`, or after the one already running if one is. Failures become `problem`. */
	function refresh(full = false) {
		if (refreshing) {
			pendingFull = (pendingFull ?? false) || full;
			return refreshing;
		}
		const mine = generation;
		set({
			refreshing: true,
			...state.phase === "idle" || state.phase === "blocked" ? { phase: "loading" } : {}
		});
		refreshing = (async () => {
			try {
				await load(full);
			} catch (error) {
				if (mine === generation) settleFailure(error);
			} finally {
				refreshing = void 0;
				set({ refreshing: false });
			}
			if (pendingFull !== void 0) {
				const again = pendingFull;
				pendingFull = void 0;
				await refresh(again);
			}
		})();
		return refreshing;
	}
	async function choose(choice, full = true) {
		generation += 1;
		writePrefs(choice);
		if (full) {
			watermark = null;
			details.clear();
		}
		set({
			choice,
			...full ? {
				states: [],
				projects: [],
				views: [],
				issues: {},
				columns: {}
			} : {},
			phase: "loading",
			problem: null
		});
		await refresh(full);
	}
	/** Loads the teams and opens the remembered (or first) one. Safe to call again after a key change. */
	async function start() {
		generation += 1;
		const mine = generation;
		watermark = null;
		set({
			...initial,
			phase: "loading",
			notice: state.notice
		});
		try {
			const data = await client.request("Teams", TEAMS);
			if (mine !== generation) return;
			const teams = [...data.teams.nodes].sort((a, b) => a.name.localeCompare(b.name));
			const saved = readPrefs();
			const team = teams.find((t) => t.id === saved?.teamId) ?? teams[0];
			set({ teams });
			if (!team) {
				set({
					phase: "ready",
					problem: {
						kind: "rejected",
						message: "This key can see no Linear teams."
					}
				});
				return;
			}
			await choose({
				teamId: team.id,
				scope: team.id === saved?.teamId ? saved.scope : { kind: "team" }
			});
		} catch (error) {
			if (mine === generation) settleFailure(error);
		}
	}
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		snapshot: () => state,
		start,
		selectTeam: (teamId) => choose({
			teamId,
			scope: { kind: "team" }
		}),
		selectScope: (scope) => state.choice ? choose({
			teamId: state.choice.teamId,
			scope
		}, false) : Promise.resolve(),
		/** Reads everything again; with nothing loaded yet (the first load failed) that means starting over. */
		refresh: () => state.choice ? refresh(true) : start(),
		/** The refresh timer's tick: one small query, and a reload only when something changed. */
		async tick() {
			const choice = state.choice;
			if (!choice || state.phase !== "ready" || refreshing || probing || state.moving.length) return;
			if (now() - lastProbeAt < 2e3) return;
			if (state.problem?.retryAt && state.problem.retryAt > now()) return;
			lastProbeAt = now();
			probing = true;
			const mine = generation;
			const since = watermark ?? (/* @__PURE__ */ new Date((state.refreshedAt ?? now()) - 6e4)).toISOString();
			try {
				const data = await client.request("ChangedSince", CHANGED_SINCE, { filter: {
					team: { id: { eq: choice.teamId } },
					updatedAt: { gt: since }
				} });
				if (mine !== generation) return;
				const latest = data.issues.nodes[0];
				if (latest) {
					watermark = newer(watermark, latest.updatedAt);
					probing = false;
					await refresh(false);
				} else if (state.problem) set({ problem: null });
			} catch (error) {
				if (mine === generation) set({ problem: fail(error) });
			} finally {
				probing = false;
			}
		},
		async loadMore(stateId) {
			const choice = state.choice;
			const column = state.columns[stateId];
			if (!choice || !column?.hasMore || column.loadingMore) return;
			const mine = generation;
			const since = moveSeq;
			const patch = (next) => set((current) => ({ columns: {
				...current.columns,
				[stateId]: {
					...current.columns[stateId],
					...next
				}
			} }));
			patch({ loadingMore: true });
			try {
				const result = await fetchColumn(choice, stateId, column.cursor);
				if (mine !== generation) return;
				set((current) => {
					const existing = current.columns[stateId];
					const known = new Set(existing.ids);
					const fresh = result.issues.filter((issue) => !known.has(issue.id) && !current.moving.includes(issue.id) && !((movedAt.get(issue.id) ?? 0) > since));
					for (const issue of fresh) watermark = newer(watermark, issue.updatedAt);
					return {
						issues: {
							...current.issues,
							...Object.fromEntries(fresh.map((issue) => [issue.id, issue]))
						},
						columns: {
							...current.columns,
							[stateId]: {
								ids: [...existing.ids, ...fresh.map((issue) => issue.id)],
								hasMore: result.page.hasNextPage,
								cursor: result.page.endCursor,
								loadingMore: false
							}
						}
					};
				});
			} catch (error) {
				if (mine !== generation) return;
				patch({ loadingMore: false });
				set({ notice: fail(error).message });
			}
		},
		/** Moves a card to another column: shown at once, then sent; put back if Linear says no. */
		async move(issueId, stateId) {
			const issue = state.issues[issueId];
			const target = state.states.find((s) => s.id === stateId);
			if (!issue || !target || issue.stateId === stateId || state.moving.includes(issueId)) return;
			if (!acceptsMoves(target.type)) {
				set({ notice: `${issue.identifier} was not moved to ${target.name}: Linear only does that when the issue is marked a duplicate of another, which the board cannot do.` });
				return;
			}
			const mine = generation;
			const before = state;
			movedAt.set(issueId, moveSeq += 1);
			const relocate = (current, from, to, next) => {
				const columns = { ...current.columns };
				if (from !== to) {
					const source = columns[from];
					const dest = columns[to];
					if (source) columns[from] = {
						...source,
						ids: source.ids.filter((id) => id !== issueId)
					};
					if (dest && !dest.ids.includes(issueId)) columns[to] = {
						...dest,
						ids: [...dest.ids, issueId]
					};
				}
				return {
					columns,
					issues: {
						...current.issues,
						[issueId]: next
					}
				};
			};
			set((current) => ({
				...relocate(current, issue.stateId, stateId, {
					...issue,
					stateId
				}),
				moving: [...current.moving, issueId],
				notice: null
			}));
			const done = () => {
				movedAt.set(issueId, moveSeq += 1);
				set((current) => ({ moving: current.moving.filter((id) => id !== issueId) }));
			};
			try {
				const data = await client.request("MoveIssue", MOVE_ISSUE, {
					id: issueId,
					stateId
				});
				if (!data.issueUpdate.success || !data.issueUpdate.issue) throw new LinearError("rejected", "Linear did not accept the move.");
				if (mine !== generation) return done();
				const saved = toIssue(data.issueUpdate.issue);
				set((current) => ({
					...relocate(current, current.issues[issueId]?.stateId ?? stateId, saved.stateId, saved),
					settled: issueId
				}));
				watermark = newer(watermark, saved.updatedAt);
				done();
			} catch (error) {
				if (mine === generation) set((current) => ({
					...relocate(current, current.issues[issueId]?.stateId ?? stateId, issue.stateId, before.issues[issueId]),
					notice: `${issue.identifier} was not moved to ${target.name}: ${fail(error).message}`,
					...error instanceof LinearError && error.kind === "auth" ? {
						phase: "blocked",
						problem: fail(error)
					} : {}
				}));
				done();
			}
		},
		clearSettled: () => set({ settled: null }),
		dismissNotice: () => set({ notice: null }),
		/** An issue's description and sub-issues, read again whenever the issue has changed since. */
		async detail(issueId) {
			const key = `${issueId}:${state.issues[issueId]?.updatedAt ?? ""}`;
			const cached = details.get(key);
			if (cached) return cached;
			const detail = toDetail((await client.request("IssueDetail", ISSUE_DETAIL, { id: issueId })).issue);
			details.set(key, detail);
			return detail;
		},
		/** Forget everything, for when the key is removed or replaced. */
		reset() {
			generation += 1;
			watermark = null;
			details.clear();
			movedAt.clear();
			set({
				...initial,
				notice: null
			});
		}
	};
}
// src/react.ts
var React;
function provideReact(react) {
	React = react;
}
// src/ui/color.ts
/** Used for a colour from Linear that is not a plain hex colour. */
var NEUTRAL_COLOR = "#8290a0";
var HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/**
* Linear's label, project and state colours go into a `style` or an SVG attribute. Only `#rgb`, `#rrggbb` and `#rrggbbaa` get
* through, so a `url(...)` (a remote image) or a `var(...)` can never come from the service; anything else is `fallback`.
*/
function safeColor(value, fallback = NEUTRAL_COLOR) {
	return typeof value === "string" && HEX.test(value) ? value : fallback;
}
// src/ui/format.ts
var MONTH_DAY = new Intl.DateTimeFormat(void 0, {
	month: "short",
	day: "numeric"
});
var FULL = new Intl.DateTimeFormat(void 0, {
	month: "short",
	day: "numeric",
	year: "numeric"
});
/** "Oct 21", with the year when it is not this year, as Linear's own cards write it. */
function shortDate(iso, now = /* @__PURE__ */ new Date()) {
	const date = new Date(iso);
	return date.getFullYear() === now.getFullYear() ? MONTH_DAY.format(date) : FULL.format(date);
}
function fullDate(iso) {
	return FULL.format(new Date(iso));
}
function initials(name) {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
/** A steady hue for a name, so the same person is the same colour every time. */
function hue(name) {
	let h = 0;
	for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
	return h;
}
function ago(from, now) {
	const seconds = Math.max(0, Math.round((now - from) / 1e3));
	if (seconds < 45) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	return `${Math.round(minutes / 60)} h ago`;
}
function wait(until, now) {
	const minutes = Math.max(1, Math.ceil((until - now) / 6e4));
	return minutes === 1 ? "a minute" : `${minutes} minutes`;
}
var PRIORITY_LABEL = [
	"No priority",
	"Urgent",
	"High",
	"Medium",
	"Low"
];
// src/ui/icons.tsx
/** The three bars of the MEGATECH mark. */
function BrandMark({ size = 20 }) {
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 32 32",
		"aria-hidden": "true",
		className: "mtl-mark"
	}, /* @__PURE__ */ React.createElement("rect", {
		width: "32",
		height: "32",
		fill: "#06060a"
	}), /* @__PURE__ */ React.createElement("rect", {
		x: "6",
		y: "8",
		width: "20",
		height: "3",
		fill: "#00d4ff"
	}), /* @__PURE__ */ React.createElement("rect", {
		x: "6",
		y: "14.5",
		width: "14",
		height: "3",
		fill: "#e9eef4"
	}), /* @__PURE__ */ React.createElement("rect", {
		x: "6",
		y: "21",
		width: "20",
		height: "3",
		fill: "#e9eef4"
	}));
}
/**
* The page's entry in navigation and search: a board of three columns. It is one shape in one colour on purpose: Buzz
* draws a page's icon as an `<img>`, which cannot take the theme's colour, so `CSS` (ui/styles) paints this shape in the
* entry's own text colour instead and uses this image only as the mask.
*/
var PAGE_ICON = "data:image/svg+xml," + encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M4 4h3.5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM10.25 4h3.5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM16.5 4H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z\"/></svg>");
/** Linear's workflow-state glyphs: dashed backlog, open circle, part-filled started, tick, cross. */
function StatusIcon({ type, color, fraction = .5, size = 14 }) {
	const ink = safeColor(color);
	const c = 7;
	const common = {
		width: size,
		height: size,
		viewBox: "0 0 14 14",
		"aria-hidden": true,
		className: "mtl-status"
	};
	switch (type) {
		case "backlog": return /* @__PURE__ */ React.createElement("svg", common, /* @__PURE__ */ React.createElement("circle", {
			cx: c,
			cy: c,
			r: "5.5",
			fill: "none",
			stroke: ink,
			strokeWidth: "1.5",
			strokeDasharray: "1.9 1.9"
		}));
		case "unstarted": return /* @__PURE__ */ React.createElement("svg", common, /* @__PURE__ */ React.createElement("circle", {
			cx: c,
			cy: c,
			r: "5.5",
			fill: "none",
			stroke: ink,
			strokeWidth: "1.5"
		}));
		case "started": return /* @__PURE__ */ React.createElement("svg", common, /* @__PURE__ */ React.createElement("circle", {
			cx: c,
			cy: c,
			r: "5.5",
			fill: "none",
			stroke: ink,
			strokeWidth: "1.5"
		}), /* @__PURE__ */ React.createElement("path", {
			d: pie(c, c, 3, fraction),
			fill: ink
		}));
		case "completed": return /* @__PURE__ */ React.createElement("svg", common, /* @__PURE__ */ React.createElement("circle", {
			cx: c,
			cy: c,
			r: "7",
			fill: ink
		}), /* @__PURE__ */ React.createElement("path", {
			d: "M4 7.2l2 2 4-4.2",
			fill: "none",
			stroke: "#fff",
			strokeWidth: "1.5",
			strokeLinecap: "round",
			strokeLinejoin: "round"
		}));
		case "canceled":
		case "duplicate": return /* @__PURE__ */ React.createElement("svg", common, /* @__PURE__ */ React.createElement("circle", {
			cx: c,
			cy: c,
			r: "7",
			fill: ink
		}), /* @__PURE__ */ React.createElement("path", {
			d: "M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4",
			stroke: "#fff",
			strokeWidth: "1.5",
			strokeLinecap: "round"
		}));
		default: return /* @__PURE__ */ React.createElement("svg", common, /* @__PURE__ */ React.createElement("circle", {
			cx: c,
			cy: c,
			r: "7",
			fill: ink
		}), /* @__PURE__ */ React.createElement("path", {
			d: "M3.8 7.5h2l.6 1.2h1.2l.6-1.2h2M4.4 5.4h5.2l.9 2.1v2.1H3.5V7.5z",
			fill: "none",
			stroke: "#fff",
			strokeWidth: "1",
			strokeLinejoin: "round"
		}));
	}
}
/** A wedge from twelve o'clock, clockwise, covering `fraction` of a circle of radius `r`. */
function pie(cx, cy, r, fraction) {
	const f = Math.min(Math.max(fraction, 0), 1);
	if (f >= 1) return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
	if (f <= 0) return "";
	const angle = f * 2 * Math.PI;
	const x = cx + r * Math.sin(angle);
	const y = cy - r * Math.cos(angle);
	return `M${cx} ${cy}L${cx} ${cy - r}A${r} ${r} 0 ${f > .5 ? 1 : 0} 1 ${x.toFixed(3)} ${y.toFixed(3)}z`;
}
function PriorityIcon({ priority, size = 14 }) {
	if (priority === 1) return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 14 14",
		"aria-hidden": "true",
		className: "mtl-priority",
		"data-urgent": ""
	}, /* @__PURE__ */ React.createElement("rect", {
		width: "14",
		height: "14",
		rx: "3",
		fill: "#f2994a"
	}), /* @__PURE__ */ React.createElement("rect", {
		x: "6.1",
		y: "3",
		width: "1.8",
		height: "5.4",
		rx: ".9",
		fill: "#fff"
	}), /* @__PURE__ */ React.createElement("rect", {
		x: "6.1",
		y: "9.6",
		width: "1.8",
		height: "1.8",
		rx: ".9",
		fill: "#fff"
	}));
	const lit = priority === 2 ? 3 : priority === 3 ? 2 : priority === 4 ? 1 : 0;
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 14 14",
		"aria-hidden": "true",
		className: "mtl-priority"
	}, [
		0,
		1,
		2
	].map((i) => /* @__PURE__ */ React.createElement("rect", {
		key: i,
		x: 1.5 + i * 4,
		y: 9 - i * 3,
		width: "2.6",
		height: 3 + i * 3,
		rx: ".6",
		fill: "currentColor",
		opacity: i < lit ? 1 : .28
	})));
}
function PullRequestIcon({ status, size = 13 }) {
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		"aria-hidden": "true",
		className: "mtl-pr-icon",
		"data-status": status
	}, /* @__PURE__ */ React.createElement("g", {
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.5",
		strokeLinecap: "round",
		strokeLinejoin: "round"
	}, /* @__PURE__ */ React.createElement("circle", {
		cx: "4",
		cy: "3.5",
		r: "1.7"
	}), /* @__PURE__ */ React.createElement("circle", {
		cx: "4",
		cy: "12.5",
		r: "1.7"
	}), /* @__PURE__ */ React.createElement("circle", {
		cx: "12",
		cy: "12.5",
		r: "1.7"
	}), /* @__PURE__ */ React.createElement("path", { d: "M4 5.2v5.6M12 10.8V6.5a2 2 0 0 0-2-2H8.2M9.6 2.8L8 4.5l1.6 1.7" })));
}
/** A ring filled clockwise by how much of the work is done. */
function ProgressIcon({ done, total, size = 13 }) {
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 14 14",
		"aria-hidden": "true",
		className: "mtl-progress-icon"
	}, /* @__PURE__ */ React.createElement("circle", {
		cx: "7",
		cy: "7",
		r: "5.5",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.5",
		opacity: "0.35"
	}), /* @__PURE__ */ React.createElement("path", {
		d: pie(7, 7, 3, total ? done / total : 0),
		fill: "currentColor"
	}));
}
function ProjectIcon({ color, size = 13 }) {
	const ink = safeColor(color, "currentColor");
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 14 14",
		"aria-hidden": "true",
		className: "mtl-project-icon"
	}, /* @__PURE__ */ React.createElement("path", {
		d: "M7 1.4l5 2.8v5.6L7 12.6 2 9.8V4.2z",
		fill: "none",
		stroke: ink,
		strokeWidth: "1.4",
		strokeLinejoin: "round"
	}), /* @__PURE__ */ React.createElement("path", {
		d: "M2.2 4.3L7 7l4.8-2.7M7 7v5.4",
		fill: "none",
		stroke: ink,
		strokeWidth: "1.2",
		strokeLinejoin: "round"
	}));
}
function UserIcon({ size = 18 }) {
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 18 18",
		"aria-hidden": "true",
		className: "mtl-user-icon"
	}, /* @__PURE__ */ React.createElement("circle", {
		cx: "9",
		cy: "9",
		r: "8",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.2",
		strokeDasharray: "2 2"
	}), /* @__PURE__ */ React.createElement("circle", {
		cx: "9",
		cy: "7.2",
		r: "2.1",
		fill: "currentColor"
	}), /* @__PURE__ */ React.createElement("path", {
		d: "M4.8 13.4c.8-2 2.4-2.8 4.2-2.8s3.4.8 4.2 2.8",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.3",
		strokeLinecap: "round"
	}));
}
function RefreshIcon({ size = 14 }) {
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		"aria-hidden": "true"
	}, /* @__PURE__ */ React.createElement("path", {
		d: "M13.2 8A5.2 5.2 0 1 1 11.6 4.3M13.4 2.2v2.6h-2.6",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.5",
		strokeLinecap: "round",
		strokeLinejoin: "round"
	}));
}
function CloseIcon({ size = 14 }) {
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		"aria-hidden": "true"
	}, /* @__PURE__ */ React.createElement("path", {
		d: "M4 4l8 8M12 4l-8 8",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.6",
		strokeLinecap: "round"
	}));
}
function ExternalIcon({ size = 13 }) {
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		"aria-hidden": "true"
	}, /* @__PURE__ */ React.createElement("path", {
		d: "M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9v3.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1H7",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.5",
		strokeLinecap: "round",
		strokeLinejoin: "round"
	}));
}
// src/ui/Card.tsx
function Avatar({ name, size = 18 }) {
	if (!name) return /* @__PURE__ */ React.createElement(UserIcon, { size });
	return /* @__PURE__ */ React.createElement("span", {
		className: "mtl-avatar",
		"aria-hidden": "true",
		style: {
			width: size,
			height: size,
			background: `hsl(${hue(name)} 45% 38%)`,
			fontSize: Math.round(size * .44)
		}
	}, initials(name));
}
/** One PR chip says its number; several say how many. */
function prLabel(prs) {
	const [only] = prs;
	return prs.length === 1 && only?.number != null ? `#${only.number}` : `${prs.length} PRs`;
}
/** The worst news among the PRs decides the chip's colour: open work first, then merged, then closed. */
function prStatus(prs) {
	for (const status of [
		"open",
		"draft",
		"merged",
		"closed"
	]) if (prs.some((pr) => pr.status === status)) return status;
	return "unknown";
}
function Card({ issue, state, fraction, selected, dragging, moving, settled, onOpen, onPointerDown }) {
	const chips = [];
	chips.push(/* @__PURE__ */ React.createElement("span", {
		key: "priority",
		className: "mtl-chip mtl-chip-icon",
		title: PRIORITY_LABEL[issue.priority],
		"data-priority": issue.priority
	}, /* @__PURE__ */ React.createElement(PriorityIcon, { priority: issue.priority })));
	for (const label of issue.labels.slice(0, 2)) chips.push(/* @__PURE__ */ React.createElement("span", {
		key: label.id,
		className: "mtl-chip"
	}, /* @__PURE__ */ React.createElement("span", {
		className: "mtl-dot",
		style: { background: safeColor(label.color) }
	}), label.name));
	if (issue.labels.length > 2) chips.push(/* @__PURE__ */ React.createElement("span", {
		key: "more-labels",
		className: "mtl-chip",
		title: issue.labels.slice(2).map((l) => l.name).join(", ")
	}, "+", issue.labels.length - 2));
	if (issue.project) chips.push(/* @__PURE__ */ React.createElement("span", {
		key: "project",
		className: "mtl-chip",
		title: issue.project.name
	}, /* @__PURE__ */ React.createElement(ProjectIcon, { color: issue.project.color }), /* @__PURE__ */ React.createElement("span", { className: "mtl-chip-text" }, issue.project.name)));
	if (issue.pullRequests.length) chips.push(/* @__PURE__ */ React.createElement("span", {
		key: "prs",
		className: "mtl-chip mtl-chip-pr",
		"data-status": prStatus(issue.pullRequests),
		title: "Pull requests"
	}, /* @__PURE__ */ React.createElement(PullRequestIcon, { status: prStatus(issue.pullRequests) }), prLabel(issue.pullRequests)));
	if (issue.progress) chips.push(/* @__PURE__ */ React.createElement("span", {
		key: "progress",
		className: "mtl-chip",
		title: "Sub-issues done"
	}, /* @__PURE__ */ React.createElement(ProgressIcon, {
		done: issue.progress.done,
		total: issue.progress.total
	}), issue.progress.done, "/", issue.progress.total));
	const summary = [
		issue.identifier,
		issue.title,
		state.name,
		PRIORITY_LABEL[issue.priority],
		issue.assignee ? `assigned to ${issue.assignee.name}` : "unassigned"
	].join(", ");
	return /* @__PURE__ */ React.createElement("div", {
		role: "button",
		tabIndex: 0,
		className: "mtl-card",
		"aria-label": summary,
		"aria-haspopup": "dialog",
		"aria-expanded": selected,
		"aria-busy": moving || void 0,
		"data-issue-id": issue.id,
		"data-identifier": issue.identifier,
		"data-selected": selected || void 0,
		"data-dragging": dragging || void 0,
		"data-moving": moving || void 0,
		"data-settled": settled || void 0,
		onClick: () => onOpen(issue),
		onKeyDown: (event) => {
			if (event.target !== event.currentTarget) return;
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				onOpen(issue);
			}
		},
		onPointerDown: (event) => onPointerDown(event, issue)
	}, /* @__PURE__ */ React.createElement("div", { className: "mtl-card-top" }, /* @__PURE__ */ React.createElement("span", { className: "mtl-card-id" }, /* @__PURE__ */ React.createElement("span", { className: "mtl-id" }, issue.identifier), issue.parent && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "mtl-crumb-sep" }, "›"), /* @__PURE__ */ React.createElement("span", { className: "mtl-crumb" }, issue.parent.title))), /* @__PURE__ */ React.createElement("span", {
		className: "mtl-card-assignee",
		title: issue.assignee?.name ?? "Unassigned"
	}, /* @__PURE__ */ React.createElement(Avatar, { name: issue.assignee?.name ?? null }))), /* @__PURE__ */ React.createElement("div", { className: "mtl-card-title" }, /* @__PURE__ */ React.createElement(StatusIcon, {
		type: state.type,
		color: state.color,
		fraction
	}), /* @__PURE__ */ React.createElement("span", { className: "mtl-title" }, issue.title)), /* @__PURE__ */ React.createElement("div", { className: "mtl-chips" }, chips), /* @__PURE__ */ React.createElement("div", { className: "mtl-card-foot" }, "Created ", shortDate(issue.createdAt)));
}
// src/ui/Details.tsx
var URL_PATTERN = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
/** Linear writes descriptions in Markdown; this shows them as plain text, with bare links made clickable. */
function Description({ text }) {
	if (!text.trim()) return /* @__PURE__ */ React.createElement("p", { className: "mtl-muted" }, "No description.");
	return /* @__PURE__ */ React.createElement("div", { className: "mtl-description" }, text.split(URL_PATTERN).map((part, index) => index % 2 === 1 ? /* @__PURE__ */ React.createElement("a", {
		key: index,
		href: part,
		target: "_blank",
		rel: "noopener noreferrer"
	}, part) : /* @__PURE__ */ React.createElement(React.Fragment, { key: index }, part)));
}
function Details({ issue, snapshot, store, onClose }) {
	const [loaded, setLoaded] = React.useState(null);
	const [failed, setFailed] = React.useState(false);
	const detail = loaded?.id === issue.id ? loaded.detail : null;
	const panel = React.useRef(null);
	const state = snapshot.states.find((s) => s.id === issue.stateId);
	const busy = snapshot.moving.includes(issue.id);
	React.useEffect(() => {
		let current = true;
		setFailed(false);
		store.detail(issue.id).then((value) => current && setLoaded({
			id: issue.id,
			detail: value
		}), () => current && setFailed(true));
		return () => {
			current = false;
		};
	}, [
		issue.id,
		issue.updatedAt,
		store
	]);
	React.useEffect(() => {
		panel.current?.focus();
	}, [issue.id]);
	return /* @__PURE__ */ React.createElement("aside", {
		ref: panel,
		tabIndex: -1,
		role: "dialog",
		"aria-modal": "false",
		"aria-label": `${issue.identifier} ${issue.title}`,
		className: "mtl-details",
		onKeyDown: (event) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
			}
		}
	}, /* @__PURE__ */ React.createElement("header", { className: "mtl-details-head" }, /* @__PURE__ */ React.createElement("span", { className: "mtl-id" }, issue.identifier), /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "mtl-icon-button",
		"aria-label": "Close details",
		onClick: onClose
	}, /* @__PURE__ */ React.createElement(CloseIcon, null))), /* @__PURE__ */ React.createElement("div", { className: "mtl-details-body" }, /* @__PURE__ */ React.createElement("h2", { className: "mtl-details-title" }, issue.title), /* @__PURE__ */ React.createElement("dl", { className: "mtl-fields" }, /* @__PURE__ */ React.createElement("dt", null, "Status"), /* @__PURE__ */ React.createElement("dd", null, state && /* @__PURE__ */ React.createElement(StatusIcon, {
		type: state.type,
		color: state.color
	}), /* @__PURE__ */ React.createElement("select", {
		"aria-label": "Status",
		value: issue.stateId,
		disabled: busy,
		onChange: (event) => void store.move(issue.id, event.target.value)
	}, snapshot.states.map((s) => /* @__PURE__ */ React.createElement("option", {
		key: s.id,
		value: s.id,
		disabled: !acceptsMoves(s.type)
	}, s.name)))), /* @__PURE__ */ React.createElement("dt", null, "Priority"), /* @__PURE__ */ React.createElement("dd", null, /* @__PURE__ */ React.createElement(PriorityIcon, { priority: issue.priority }), PRIORITY_LABEL[issue.priority]), /* @__PURE__ */ React.createElement("dt", null, "Assignee"), /* @__PURE__ */ React.createElement("dd", null, /* @__PURE__ */ React.createElement(Avatar, { name: issue.assignee?.name ?? null }), issue.assignee?.name ?? "Unassigned"), issue.project && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("dt", null, "Project"), /* @__PURE__ */ React.createElement("dd", null, issue.project.name)), issue.parent && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("dt", null, "Parent"), /* @__PURE__ */ React.createElement("dd", null, issue.parent.identifier, " ", issue.parent.title)), issue.labels.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("dt", null, "Labels"), /* @__PURE__ */ React.createElement("dd", { className: "mtl-wrap" }, issue.labels.map((label) => /* @__PURE__ */ React.createElement("span", {
		key: label.id,
		className: "mtl-chip"
	}, /* @__PURE__ */ React.createElement("span", {
		className: "mtl-dot",
		style: { background: safeColor(label.color) }
	}), label.name)))), /* @__PURE__ */ React.createElement("dt", null, "Created"), /* @__PURE__ */ React.createElement("dd", null, fullDate(issue.createdAt)), /* @__PURE__ */ React.createElement("dt", null, "Updated"), /* @__PURE__ */ React.createElement("dd", null, fullDate(issue.updatedAt)), detail?.creator && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("dt", null, "Creator"), /* @__PURE__ */ React.createElement("dd", null, detail.creator)), detail?.dueDate && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("dt", null, "Due"), /* @__PURE__ */ React.createElement("dd", null, fullDate(detail.dueDate))), detail?.estimate != null && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("dt", null, "Estimate"), /* @__PURE__ */ React.createElement("dd", null, detail.estimate))), issue.pullRequests.length > 0 && /* @__PURE__ */ React.createElement("section", {
		className: "mtl-section",
		"aria-label": "Pull requests"
	}, /* @__PURE__ */ React.createElement("h3", null, "Pull requests (", prLabel(issue.pullRequests), ")"), /* @__PURE__ */ React.createElement("ul", { className: "mtl-list" }, issue.pullRequests.map((pr) => /* @__PURE__ */ React.createElement("li", { key: pr.url }, /* @__PURE__ */ React.createElement("span", {
		className: "mtl-chip-pr",
		"data-status": pr.status
	}, /* @__PURE__ */ React.createElement(PullRequestIcon, { status: pr.status })), /* @__PURE__ */ React.createElement("a", {
		href: pr.url,
		target: "_blank",
		rel: "noopener noreferrer"
	}, "#", pr.number, " ", /* @__PURE__ */ React.createElement("span", { className: "mtl-muted" }, "(", pr.status, ")")))))), /* @__PURE__ */ React.createElement("section", {
		className: "mtl-section",
		"aria-label": "Description"
	}, /* @__PURE__ */ React.createElement("h3", null, "Description"), failed ? /* @__PURE__ */ React.createElement("p", { className: "mtl-muted" }, "The description could not be loaded.") : detail ? /* @__PURE__ */ React.createElement(Description, { text: detail.description }) : /* @__PURE__ */ React.createElement("p", { className: "mtl-muted" }, "Loading…")), detail && detail.subIssues.length > 0 && /* @__PURE__ */ React.createElement("section", {
		className: "mtl-section",
		"aria-label": "Sub-issues"
	}, /* @__PURE__ */ React.createElement("h3", null, "Sub-issues", issue.progress && /* @__PURE__ */ React.createElement("span", { className: "mtl-count" }, /* @__PURE__ */ React.createElement(ProgressIcon, {
		done: issue.progress.done,
		total: issue.progress.total
	}), " ", issue.progress.done, "/", issue.progress.total)), /* @__PURE__ */ React.createElement("ul", { className: "mtl-list" }, detail.subIssues.map((sub) => /* @__PURE__ */ React.createElement("li", { key: sub.id }, /* @__PURE__ */ React.createElement(StatusIcon, {
		type: sub.state.type,
		color: sub.state.color
	}), /* @__PURE__ */ React.createElement("span", { className: "mtl-id" }, sub.identifier), " ", sub.title))))), /* @__PURE__ */ React.createElement("footer", { className: "mtl-details-foot" }, /* @__PURE__ */ React.createElement("a", {
		className: "mtl-button",
		href: issue.url,
		target: "_blank",
		rel: "noopener noreferrer"
	}, "Open in Linear ", /* @__PURE__ */ React.createElement(ExternalIcon, null))));
}
// src/ui/Board.tsx
var REFRESH_EVERY = 6e4;
var DRAG_THRESHOLD = 5;
var EDGE = 64;
var MemoCard;
var card = () => MemoCard ??= React.memo(Card);
var encodeScope = (scope) => scope.kind === "team" ? "team" : `${scope.kind}:${scope.id}`;
var decodeScope = (value) => {
	const [kind, ...rest] = value.split(":");
	return kind === "project" || kind === "view" ? {
		kind,
		id: rest.join(":")
	} : { kind: "team" };
};
/** How far through its work a "started" column looks: the later the column, the fuller the circle. */
function fractions(states) {
	const started = states.filter((s) => s.type === "started");
	return Object.fromEntries(started.map((s, i) => [s.id, (i + 1) / (started.length + 1)]));
}
function createBoardPage({ store, keys, openSettings }) {
	return function BoardPage() {
		const snapshot = React.useSyncExternalStore(store.subscribe, store.snapshot);
		const keyVersion = React.useSyncExternalStore(keys.subscribe, keys.version);
		const [selectedId, setSelectedId] = React.useState(null);
		const [drag, setDrag] = React.useState(null);
		const [clock, setClock] = React.useState(() => Date.now());
		const boardRef = React.useRef(null);
		const columnRefs = React.useRef(/* @__PURE__ */ new Map());
		const stopDrag = React.useRef(null);
		const suppressClick = React.useRef(false);
		const snapshotRef = React.useRef(snapshot);
		snapshotRef.current = snapshot;
		const startedFor = React.useRef(null);
		React.useEffect(() => {
			const changed = !(startedFor.current === null) && startedFor.current !== keyVersion;
			startedFor.current = keyVersion;
			if (store.snapshot().phase === "idle" || changed) store.start();
			else store.tick();
		}, [keyVersion]);
		React.useEffect(() => {
			const tick = () => {
				setClock(Date.now());
				if (document.visibilityState === "visible") store.tick();
			};
			const timer = window.setInterval(tick, REFRESH_EVERY);
			window.addEventListener("focus", tick);
			document.addEventListener("visibilitychange", tick);
			return () => {
				window.clearInterval(timer);
				window.removeEventListener("focus", tick);
				document.removeEventListener("visibilitychange", tick);
			};
		}, []);
		React.useEffect(() => {
			if (!snapshot.settled) return;
			const timer = window.setTimeout(() => store.clearSettled(), 1600);
			return () => window.clearTimeout(timer);
		}, [snapshot.settled]);
		React.useEffect(() => () => stopDrag.current?.(), []);
		const selected = selectedId ? snapshot.issues[selectedId] : void 0;
		React.useEffect(() => {
			if (selectedId && !selected && snapshot.phase === "ready" && !snapshot.refreshing) setSelectedId(null);
		}, [
			selectedId,
			selected,
			snapshot.phase,
			snapshot.refreshing
		]);
		const open = React.useCallback((issue) => {
			if (suppressClick.current) return;
			setSelectedId(issue.id);
		}, []);
		const close = React.useCallback(() => {
			const id = selectedId;
			setSelectedId(null);
			if (id) window.requestAnimationFrame(() => boardRef.current?.querySelector(`[data-issue-id="${CSS.escape(id)}"]`)?.focus());
		}, [selectedId]);
		/** The column under a point, but only inside the board: not over the toolbar, and not under the details panel. */
		const columnAt = (x, y) => {
			const board = boardRef.current;
			if (!board) return null;
			const box = board.getBoundingClientRect();
			if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) return null;
			if (document.elementFromPoint(x, y)?.closest(".mtl-details")) return null;
			for (const [id, el] of columnRefs.current) {
				const rect = el.getBoundingClientRect();
				if (x >= rect.left && x < rect.right) return id;
			}
			return null;
		};
		const press = React.useCallback((event, issue) => {
			if (event.button !== 0 || event.pointerType === "touch") return;
			if (snapshotRef.current.moving.includes(issue.id)) return;
			if (event.target.closest("a,button,select,input,textarea")) return;
			const rect = event.currentTarget.getBoundingClientRect();
			const origin = {
				x: event.clientX,
				y: event.clientY
			};
			const pointer = {
				x: event.clientX,
				y: event.clientY
			};
			let active = false;
			let cancelled = false;
			let frame = 0;
			const place = () => {
				setDrag({
					id: issue.id,
					x: pointer.x,
					y: pointer.y,
					dx: origin.x - rect.left,
					dy: origin.y - rect.top,
					width: rect.width,
					over: columnAt(pointer.x, pointer.y)
				});
			};
			const autoscroll = () => {
				frame = 0;
				if (!active) return;
				const board = boardRef.current;
				if (board) {
					const box = board.getBoundingClientRect();
					if (pointer.x < box.left + EDGE) board.scrollLeft -= Math.ceil((EDGE - (pointer.x - box.left)) / 4);
					else if (pointer.x > box.right - EDGE) board.scrollLeft += Math.ceil((EDGE - (box.right - pointer.x)) / 4);
				}
				const over = columnAt(pointer.x, pointer.y);
				const body = over ? columnRefs.current.get(over)?.querySelector(".mtl-cards") : null;
				if (body) {
					const box = body.getBoundingClientRect();
					if (pointer.y < box.top + EDGE) body.scrollTop -= Math.ceil((EDGE - (pointer.y - box.top)) / 4);
					else if (pointer.y > box.bottom - EDGE) body.scrollTop += Math.ceil((EDGE - (box.bottom - pointer.y)) / 4);
				}
				place();
				frame = window.requestAnimationFrame(autoscroll);
			};
			const finish = () => {
				window.removeEventListener("pointermove", move);
				window.removeEventListener("pointerup", up);
				window.removeEventListener("pointercancel", abandon);
				window.removeEventListener("keydown", key, true);
				if (frame) window.cancelAnimationFrame(frame);
				stopDrag.current = null;
				setDrag(null);
			};
			const move = (e) => {
				if (e.buttons === 0) return abandon();
				pointer.x = e.clientX;
				pointer.y = e.clientY;
				if (cancelled) return;
				if (!active) {
					if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_THRESHOLD) return;
					active = true;
					frame = window.requestAnimationFrame(autoscroll);
				}
				window.getSelection()?.removeAllRanges();
				place();
			};
			const up = () => {
				const target = active && !cancelled ? columnAt(pointer.x, pointer.y) : null;
				if (active || cancelled) {
					suppressClick.current = true;
					window.setTimeout(() => suppressClick.current = false, 0);
				}
				active = false;
				finish();
				if (target && target !== issue.stateId) store.move(issue.id, target);
			};
			const abandon = () => {
				active = false;
				finish();
			};
			const key = (e) => {
				if (e.key !== "Escape" || !active) return;
				e.preventDefault();
				e.stopPropagation();
				active = false;
				cancelled = true;
				if (frame) window.cancelAnimationFrame(frame);
				setDrag(null);
			};
			stopDrag.current?.();
			window.addEventListener("pointermove", move);
			window.addEventListener("pointerup", up);
			window.addEventListener("pointercancel", abandon);
			window.addEventListener("keydown", key, true);
			stopDrag.current = abandon;
		}, []);
		const fraction = React.useMemo(() => fractions(snapshot.states), [snapshot.states]);
		const Card = card();
		const draggedIssue = drag ? snapshot.issues[drag.id] : void 0;
		const state = (id) => snapshot.states.find((s) => s.id === id);
		const choice = snapshot.choice;
		const settledIssue = snapshot.settled ? snapshot.issues[snapshot.settled] : void 0;
		const settledState = settledIssue ? state(settledIssue.stateId) : void 0;
		return /* @__PURE__ */ React.createElement("div", {
			className: "mtl-root",
			"data-dragging": drag ? "" : void 0
		}, /* @__PURE__ */ React.createElement("header", { className: "mtl-bar" }, /* @__PURE__ */ React.createElement("div", {
			className: "mtl-brand",
			"aria-label": "MEGATECH Linear"
		}, /* @__PURE__ */ React.createElement(BrandMark, { size: 22 }), /* @__PURE__ */ React.createElement("span", { className: "mtl-wordmark" }, "MEGATECH"), /* @__PURE__ */ React.createElement("span", {
			className: "mtl-brand-sep",
			"aria-hidden": "true"
		}), /* @__PURE__ */ React.createElement("h1", { className: "mtl-page-title" }, "Linear")), snapshot.teams.length > 0 && choice && /* @__PURE__ */ React.createElement("div", { className: "mtl-pickers" }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mtl-visually-hidden" }, "Team"), /* @__PURE__ */ React.createElement("select", {
			"aria-label": "Team",
			className: "mtl-select",
			value: choice.teamId,
			onChange: (event) => void store.selectTeam(event.target.value)
		}, snapshot.teams.map((team) => /* @__PURE__ */ React.createElement("option", {
			key: team.id,
			value: team.id
		}, team.name)))), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mtl-visually-hidden" }, "Filter"), /* @__PURE__ */ React.createElement("select", {
			"aria-label": "Filter",
			className: "mtl-select",
			value: encodeScope(choice.scope),
			onChange: (event) => void store.selectScope(decodeScope(event.target.value))
		}, /* @__PURE__ */ React.createElement("option", { value: "team" }, "All issues"), snapshot.projects.length > 0 && /* @__PURE__ */ React.createElement("optgroup", { label: "Projects" }, snapshot.projects.map((project) => /* @__PURE__ */ React.createElement("option", {
			key: project.id,
			value: `project:${project.id}`
		}, project.name))), snapshot.views.length > 0 && /* @__PURE__ */ React.createElement("optgroup", { label: "Views" }, snapshot.views.map((view) => /* @__PURE__ */ React.createElement("option", {
			key: view.id,
			value: `view:${view.id}`
		}, view.name)))))), /* @__PURE__ */ React.createElement("div", { className: "mtl-bar-end" }, snapshot.refreshedAt && /* @__PURE__ */ React.createElement("span", { className: "mtl-muted mtl-updated" }, "Updated ", ago(snapshot.refreshedAt, clock)), /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtl-icon-button",
			"aria-label": "Refresh",
			title: "Refresh",
			"data-busy": snapshot.refreshing || void 0,
			disabled: snapshot.phase === "blocked" && snapshot.problem?.kind === "no-key",
			onClick: () => void store.refresh()
		}, /* @__PURE__ */ React.createElement(RefreshIcon, null)))), /* @__PURE__ */ React.createElement("div", {
			className: "mtl-visually-hidden",
			role: "status",
			"aria-live": "polite"
		}, settledIssue && settledState ? `${settledIssue.identifier} moved to ${settledState.name}` : ""), snapshot.notice && /* @__PURE__ */ React.createElement("div", {
			className: "mtl-banner",
			role: "alert",
			"data-tone": "error"
		}, /* @__PURE__ */ React.createElement("span", null, snapshot.notice), /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtl-icon-button",
			"aria-label": "Dismiss",
			onClick: () => store.dismissNotice()
		}, /* @__PURE__ */ React.createElement(CloseIcon, null))), snapshot.phase === "ready" && snapshot.problem && /* @__PURE__ */ React.createElement(ProblemBanner, {
			snapshot,
			clock,
			onRetry: () => void store.refresh()
		}), snapshot.phase === "blocked" ? /* @__PURE__ */ React.createElement(Blocked, {
			snapshot,
			openSettings,
			onRetry: () => void store.start()
		}) : snapshot.phase !== "ready" || snapshot.states.length === 0 ? /* @__PURE__ */ React.createElement("div", {
			className: "mtl-empty",
			role: "status"
		}, "Loading your Linear board…") : /* @__PURE__ */ React.createElement("div", { className: "mtl-main" }, /* @__PURE__ */ React.createElement("div", {
			className: "mtl-board",
			ref: boardRef,
			role: "list",
			"aria-label": "Board"
		}, snapshot.states.map((s) => {
			const column = snapshot.columns[s.id];
			const issues = sortColumn((column?.ids ?? []).map((id) => snapshot.issues[id]).filter((x) => !!x), s.type);
			const count = `${issues.length}${column?.hasMore ? "+" : ""}`;
			return /* @__PURE__ */ React.createElement("section", {
				key: s.id,
				role: "listitem",
				className: "mtl-column",
				"aria-label": `${s.name}, ${count} issues`,
				"data-column": s.id,
				"data-state-type": s.type,
				"data-over": drag?.over === s.id && acceptsMoves(s.type) ? "" : void 0,
				"data-refuses": drag && !acceptsMoves(s.type) ? "" : void 0,
				ref: (el) => {
					if (el) columnRefs.current.set(s.id, el);
					else columnRefs.current.delete(s.id);
				}
			}, /* @__PURE__ */ React.createElement("header", { className: "mtl-column-head" }, /* @__PURE__ */ React.createElement(StatusIcon, {
				type: s.type,
				color: s.color,
				fraction: fraction[s.id] ?? .5
			}), /* @__PURE__ */ React.createElement("h2", { className: "mtl-column-name" }, s.name), /* @__PURE__ */ React.createElement("span", {
				className: "mtl-count",
				"data-count": true
			}, count)), /* @__PURE__ */ React.createElement("div", {
				className: "mtl-cards",
				role: "group",
				"aria-label": `${s.name} issues`
			}, issues.map((issue) => /* @__PURE__ */ React.createElement(Card, {
				key: issue.id,
				issue,
				state: s,
				fraction: fraction[s.id] ?? .5,
				selected: issue.id === selectedId,
				dragging: drag?.id === issue.id,
				moving: snapshot.moving.includes(issue.id),
				settled: snapshot.settled === issue.id,
				onOpen: open,
				onPointerDown: press
			})), issues.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "mtl-column-empty" }, "No issues"), column?.hasMore && /* @__PURE__ */ React.createElement("button", {
				type: "button",
				className: "mtl-more",
				disabled: column.loadingMore,
				onClick: () => void store.loadMore(s.id)
			}, column.loadingMore ? "Loading…" : "Show more")));
		})), selected && /* @__PURE__ */ React.createElement(Details, {
			issue: selected,
			snapshot,
			store,
			onClose: close
		})), drag && draggedIssue && state(draggedIssue.stateId) && /* @__PURE__ */ React.createElement("div", {
			className: "mtl-lift",
			style: {
				left: drag.x - drag.dx,
				top: drag.y - drag.dy,
				width: drag.width
			},
			"aria-hidden": "true"
		}, /* @__PURE__ */ React.createElement(Card, {
			issue: draggedIssue,
			state: state(draggedIssue.stateId),
			fraction: fraction[draggedIssue.stateId] ?? .5,
			selected: false,
			dragging: false,
			moving: false,
			settled: false,
			onOpen: () => {},
			onPointerDown: () => {}
		})));
	};
}
function ProblemBanner({ snapshot, clock, onRetry }) {
	const problem = snapshot.problem;
	const limited = problem.kind === "rate-limited" && problem.retryAt;
	return /* @__PURE__ */ React.createElement("div", {
		className: "mtl-banner",
		role: "status",
		"data-tone": "warning"
	}, /* @__PURE__ */ React.createElement("span", null, limited ? `Linear is rate limiting this key. The board will check again in ${wait(problem.retryAt, clock)}.` : `${problem.message} Showing the last board.`), !limited && /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "mtl-button",
		onClick: onRetry
	}, "Try again"));
}
function Blocked({ snapshot, openSettings, onRetry }) {
	const kind = snapshot.problem?.kind;
	if (kind === "no-key" || kind === "auth") return /* @__PURE__ */ React.createElement("div", { className: "mtl-empty" }, /* @__PURE__ */ React.createElement("div", {
		className: "mtl-panel",
		role: "status"
	}, /* @__PURE__ */ React.createElement("h2", null, kind === "no-key" ? "Connect Linear" : "Linear did not accept your key"), /* @__PURE__ */ React.createElement("p", null, kind === "no-key" ? "Paste a personal API key in the Linear card in Settings. The key stays on this computer and is sent only to Linear." : `${snapshot.problem.message} Check it in the Linear card in Settings, or make a new one.`), /* @__PURE__ */ React.createElement("p", { className: "mtl-muted" }, "In Linear: Settings, Account, Security & access, Personal API keys. Give it Write access (Read comes with it), so cards can change state."), /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "mtl-button",
		"data-primary": true,
		onClick: openSettings
	}, "Open Linear settings")));
	return /* @__PURE__ */ React.createElement("div", { className: "mtl-empty" }, /* @__PURE__ */ React.createElement("div", {
		className: "mtl-panel",
		role: "alert"
	}, /* @__PURE__ */ React.createElement("h2", null, "The board could not load"), /* @__PURE__ */ React.createElement("p", null, snapshot.problem?.message ?? "Something went wrong."), /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "mtl-button",
		"data-primary": true,
		onClick: onRetry
	}, "Try again")));
}
// src/ui/Settings.tsx
function createSettingsCard({ keys, client }) {
	return function LinearSettings() {
		const saved = React.useSyncExternalStore(keys.subscribe, () => keys.has());
		const place = React.useSyncExternalStore(keys.subscribe, () => keys.place());
		const store = keys.store();
		const [draft, setDraft] = React.useState("");
		const [replacing, setReplacing] = React.useState(false);
		const [saving, setSaving] = React.useState(false);
		const [status, setStatus] = React.useState({ kind: "idle" });
		const [byHand, setByHand] = React.useState(false);
		const alive = React.useRef(true);
		React.useEffect(() => {
			keys.ready;
		}, []);
		React.useEffect(() => {
			alive.current = true;
			return () => {
				alive.current = false;
			};
		}, []);
		/** Asks Linear who the key belongs to. `candidate` checks a key that is not saved yet. What to show is up to the caller. */
		const ask = async (candidate) => {
			setStatus({ kind: "checking" });
			try {
				const data = await client.request("Viewer", VIEWER, {}, candidate);
				return {
					kind: "ok",
					text: `Connected as ${data.viewer.name} in ${data.organization.name}.`
				};
			} catch (error) {
				return error instanceof LinearError ? {
					kind: error.kind,
					text: error.message
				} : {
					kind: "server",
					text: "Something went wrong talking to Linear."
				};
			}
		};
		const show = (verdict, text = verdict.text) => {
			if (alive.current) setStatus({
				kind: verdict.kind === "ok" ? "ok" : "error",
				text
			});
		};
		/** Asks Linear, then the store, about a key that was typed: see judgeKey and the store's own rules for what is kept. */
		const keep = async (key) => {
			await keys.ready;
			setByHand(false);
			const verdict = await ask(key);
			const ruling = judgeKey(verdict.kind, keys.has(), verdict.text);
			show(verdict, ruling.message ?? verdict.text);
			if (!ruling.save) return;
			let result;
			try {
				result = await keys.save(key);
			} catch {
				if (alive.current) setStatus({
					kind: "error",
					text: "This app could not store the key."
				});
				return;
			}
			if (!result.kept) {
				if (!alive.current) return;
				if (store === "keychain") {
					setByHand(true);
					setStatus({
						kind: "error",
						text: `The Keychain would not take the key from here, and it has not been kept anywhere.${keys.has() ? " Your saved key is unchanged." : ""}`
					});
				} else setStatus({
					kind: "error",
					text: "The system secret store would not take the new key, so your saved key is unchanged."
				});
				return;
			}
			if (result.degraded && alive.current) setStatus({
				kind: "error",
				text: "The system secret store (Secret Service) did not take the key from here, so it is kept in this app's profile, as plain text: any other plugin you install could read it. Is a Secret Service such as gnome-keyring running and unlocked? Buzz tries again each time it starts, or press Move to secret store."
			});
			setDraft("");
			setReplacing(false);
		};
		const save = async (event) => {
			event.preventDefault();
			const checked = checkKey(draft);
			if (!checked.ok) {
				setStatus({
					kind: "error",
					text: checked.message
				});
				return;
			}
			setSaving(true);
			try {
				await keep(checked.key);
			} finally {
				if (alive.current) setSaving(false);
			}
		};
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
				setStatus({
					kind: "ok",
					text: "Found the key in your Keychain."
				});
			} else setStatus({
				kind: "error",
				text: "Nothing in the Keychain yet. Run the command in Terminal, type the key at the prompt, then check again."
			});
		};
		const move = async () => {
			setStatus({ kind: "checking" });
			const moved = await keys.moveToStore();
			if (!alive.current) return;
			if (moved) {
				setByHand(false);
				setStatus({
					kind: "ok",
					text: `Moved to ${store ? STORE_NAME[store] : "the store"}. The copy in this app's profile is gone.`
				});
			} else {
				setByHand(store === "keychain");
				setStatus({
					kind: "error",
					text: `${store === "keychain" ? "The Keychain" : "The system secret store"} would not take the key from here. It is still in this app's profile, as plain text.`
				});
			}
		};
		const remove = async () => {
			const gone = await keys.clear();
			if (!alive.current) return;
			setStatus(gone ? { kind: "idle" } : {
				kind: "error",
				text: keys.place() === "keychain" ? "The Keychain would not give the key up. Remove it in Keychain Access (search for buzz-linear)." : keys.place() === "secret-service" ? "The system secret store would not give the key up. Remove it with `secret-tool clear service buzz-linear account linear`, or in your keyring's own app (Passwords and Keys, KWalletManager)." : "This app could not remove the key from its profile."
			});
			setReplacing(false);
			setByHand(false);
			setDraft("");
		};
		const showInput = !saved || replacing;
		return /* @__PURE__ */ React.createElement("section", {
			className: "mtl-root mtl-settings",
			"aria-label": "Linear"
		}, /* @__PURE__ */ React.createElement("p", null, "Shows your Linear issues as a board. Each person pastes their own personal API key; it is kept on this computer and sent only to Linear."), saved && !replacing && /* @__PURE__ */ React.createElement("p", {
			className: "mtl-saved",
			"data-place": place
		}, /* @__PURE__ */ React.createElement("strong", null, "Key saved."), " ", place === "keychain" || place === "secret-service" ? `It is kept in ${STORE_NAME[place]}. It is not shown again.` : store ? `It is in this app's profile, as plain text, because ${store === "keychain" ? "the Keychain" : "the system secret store (Secret Service)"} would not take it yet (it is tried again each time Buzz starts). Any other plugin you install could read it. It is not shown again.` : "It is in this app's profile, as plain text, because this system has no secret store the plugin can use: any other plugin you install could read it. It is not shown again."), showInput && /* @__PURE__ */ React.createElement("form", {
			onSubmit: save,
			className: "mtl-key-form"
		}, /* @__PURE__ */ React.createElement("label", { htmlFor: "mtl-key" }, "Personal API key"), /* @__PURE__ */ React.createElement("input", {
			id: "mtl-key",
			type: "password",
			autoComplete: "off",
			autoCorrect: "off",
			autoCapitalize: "off",
			spellCheck: false,
			value: draft,
			placeholder: "Paste your Linear API key",
			onChange: (event) => setDraft(event.target.value)
		}), /* @__PURE__ */ React.createElement("div", { className: "mtl-actions" }, /* @__PURE__ */ React.createElement("button", {
			type: "submit",
			className: "mtl-button",
			"data-primary": true,
			disabled: status.kind === "checking" || saving
		}, "Save key"), replacing && /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtl-button",
			disabled: saving,
			onClick: cancel
		}, "Cancel"))), byHand && /* @__PURE__ */ React.createElement("div", {
			role: "group",
			"aria-label": "Save the key in the Keychain by hand",
			className: "mtl-key-form"
		}, /* @__PURE__ */ React.createElement("p", null, "To put it in the Keychain yourself, run this in Terminal. It asks for the key (twice, showing nothing as you type), so the key is not in the command:"), /* @__PURE__ */ React.createElement("code", { className: "mtl-code" }, "security add-generic-password -U -s buzz-linear -a linear -w"), /* @__PURE__ */ React.createElement("div", { className: "mtl-actions" }, /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtl-button",
			onClick: () => void checkKeychain()
		}, "Check Keychain"))), saved && !replacing && /* @__PURE__ */ React.createElement("div", { className: "mtl-actions" }, /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtl-button",
			disabled: status.kind === "checking",
			onClick: async () => show(await ask())
		}, "Test connection"), store && place === "profile" && /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtl-button",
			"data-primary": true,
			disabled: status.kind === "checking",
			onClick: () => void move()
		}, store === "keychain" ? "Move to Keychain" : "Move to secret store"), /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtl-button",
			onClick: () => setReplacing(true)
		}, "Replace key"), /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtl-button",
			onClick: () => void remove()
		}, "Remove key")), status.kind !== "idle" && /* @__PURE__ */ React.createElement("p", {
			role: status.kind === "error" ? "alert" : "status",
			"data-tone": status.kind === "error" ? "error" : void 0
		}, status.kind === "checking" ? "Checking with Linear…" : status.text), /* @__PURE__ */ React.createElement("p", { className: "mtl-muted" }, "Make a key in Linear under", " ", /* @__PURE__ */ React.createElement("a", {
			href: "https://linear.app/settings/account/security",
			target: "_blank",
			rel: "noopener noreferrer"
		}, "Settings, Account, Security & access"), ". Give it Write access (Read comes with it): Write is what lets a dragged card change state. If Linear lets you limit the key to certain teams, limit it to the teams you use."), store === "keychain" ? /* @__PURE__ */ React.createElement("p", { className: "mtl-muted" }, "On a Mac the key is kept in your Keychain, in an item named buzz-linear, not in this app's profile. Buzz plugins are not sandboxed: a plugin that declares the ", /* @__PURE__ */ React.createElement("code", null, "security"), " program could read it too, and its install review lists that. Install only plugins you trust.") : store === "secret-service" ? /* @__PURE__ */ React.createElement("p", { className: "mtl-muted" }, "On Linux the key is kept in the system secret store (the Secret Service: gnome-keyring, KWallet or another), in an item with the attributes service buzz-linear and account linear, not in this app's profile. Buzz plugins are not sandboxed: a plugin that declares the ", /* @__PURE__ */ React.createElement("code", null, "secret-tool"), " ", "program could read it too, and its install review lists that. If no Secret Service is running, the key is kept in this app's profile as plain text instead, and this card says so. Install only plugins you trust.") : /* @__PURE__ */ React.createElement("p", { className: "mtl-muted" }, "On this system the key is kept on this computer, in this app's profile, as plain text. Buzz plugins are not sandboxed, so any other plugin you install could read it: install only plugins you trust."));
	};
}
// src/ui/styles.ts
var CSS$1 = `
/* [DOM] The page's entry in navigation and search. The host draws its icon as an <img> of PAGE_ICON, which
   cannot follow the theme, so paint the same shape in the entry's text colour (a mask) and move the
   image's own pixels out of its box. It matches only an <img> whose src is exactly PAGE_ICON, so no
   other icon is touched. If a later host draws the icon some other way this stops matching and the
   icon is simply the plain black one. */
img[src="${PAGE_ICON}"] {
  background-color: currentColor;
  -webkit-mask: url("${PAGE_ICON}") center / contain no-repeat;
  mask: url("${PAGE_ICON}") center / contain no-repeat;
  object-position: 999px 0;
}
.mtl-root {
  --mtl-cyan: #00d4ff;
  --mtl-ink: var(--text-standard, #e9eef4);
  --mtl-muted: var(--text-metadata, #8290a0);
  --mtl-bg: var(--surface-base, #0b0d11);
  --mtl-col: color-mix(in srgb, var(--surface-panel, #12161c) 55%, transparent);
  --mtl-card: var(--surface-panel, #12161c);
  --mtl-line: var(--border-standard, #2b333d);
  --mtl-hover: var(--affordance-row-hover, rgba(128, 140, 160, 0.14));
  --mtl-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--mtl-bg);
  color: var(--mtl-ink);
  font-size: 13px;
  line-height: 1.4;
}
:root:not(.dark):not([data-color-mode="dark"]) .mtl-root { --mtl-cyan: #0090b8; }
.mtl-root *, .mtl-root *::before, .mtl-root *::after { box-sizing: border-box; }
/* WebKit (Buzz on macOS and Linux) still wants the prefixed form; without it a drag selects the text it passes over. */
.mtl-root[data-dragging], .mtl-root[data-dragging] * { cursor: grabbing !important; -webkit-user-select: none; user-select: none; }
.mtl-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.mtl-muted { color: var(--mtl-muted); }
.mtl-root a { color: var(--mtl-cyan); text-decoration: none; }
.mtl-root a:hover { text-decoration: underline; }
.mtl-root :focus-visible { outline: 2px solid var(--mtl-cyan); outline-offset: 2px; }

/* header */
.mtl-bar { display: flex; align-items: center; gap: 16px; flex: none; min-height: 44px; padding: 6px 16px;
  border-bottom: 1px solid var(--mtl-line); box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--mtl-cyan) 40%, transparent); }
.mtl-brand { display: flex; align-items: center; gap: 10px; }
.mtl-mark { display: block; }
.mtl-wordmark { font-weight: 700; font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; }
.mtl-brand-sep { width: 1px; height: 16px; background: var(--mtl-line); }
.mtl-page-title { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; }
.mtl-pickers { display: flex; align-items: center; gap: 8px; }
.mtl-bar-end { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.mtl-updated { font-size: 12px; }
.mtl-select, .mtl-details select, .mtl-key-form input {
  height: 28px; padding: 0 8px; border: 1px solid var(--mtl-line); border-radius: 2px;
  background: var(--mtl-card); color: var(--mtl-ink); font: inherit; color-scheme: inherit; }
.mtl-select:hover, .mtl-details select:hover, .mtl-key-form input:hover { border-color: color-mix(in srgb, var(--mtl-cyan) 50%, var(--mtl-line)); }
.mtl-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0;
  border: 1px solid transparent; border-radius: 2px; background: transparent; color: var(--mtl-muted); cursor: pointer; }
.mtl-icon-button:hover:not(:disabled) { background: var(--mtl-hover); color: var(--mtl-ink); }
.mtl-icon-button:disabled { opacity: 0.4; cursor: default; }
.mtl-icon-button[data-busy] svg { animation: mtl-spin 0.9s linear infinite; }
@keyframes mtl-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .mtl-icon-button[data-busy] svg { animation: none; } .mtl-card { transition: none !important; } }
.mtl-button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid var(--mtl-line);
  border-radius: 2px; background: transparent; color: var(--mtl-ink); font: inherit; font-weight: 500; cursor: pointer; text-decoration: none !important; }
.mtl-button:hover:not(:disabled) { background: var(--mtl-hover); border-color: color-mix(in srgb, var(--mtl-cyan) 50%, var(--mtl-line)); }
.mtl-button[data-primary] { border-color: var(--mtl-cyan); color: var(--mtl-cyan); }
.mtl-button:disabled { opacity: 0.5; cursor: default; }

/* banners and empty states */
.mtl-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: none; padding: 8px 16px;
  border-bottom: 1px solid var(--mtl-line); background: color-mix(in srgb, var(--mtl-cyan) 8%, transparent); }
.mtl-banner[data-tone="error"] { background: color-mix(in srgb, var(--red-9, #e5484d) 14%, transparent); }
.mtl-banner[data-tone="warning"] { background: color-mix(in srgb, var(--amber-9, #f5a524) 14%, transparent); }
.mtl-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; color: var(--mtl-muted); }
.mtl-panel { max-width: 440px; padding: 20px 22px; border: 1px solid var(--mtl-line); border-top: 2px solid var(--mtl-cyan);
  border-radius: 2px; background: var(--mtl-card); color: var(--mtl-ink); display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.mtl-panel h2 { margin: 0; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; }
.mtl-panel p { margin: 0; }

/* board */
.mtl-main { position: relative; flex: 1; min-height: 0; display: flex; }
.mtl-board { flex: 1; min-width: 0; display: flex; align-items: stretch; gap: 12px; padding: 12px 16px 0; overflow-x: auto; overflow-y: hidden; }
.mtl-column { flex: 0 0 316px; width: 316px; min-height: 0; display: flex; flex-direction: column; border-radius: 2px; background: var(--mtl-col); }
.mtl-column[data-over] { outline: 2px solid var(--mtl-cyan); outline-offset: -2px; background: color-mix(in srgb, var(--mtl-cyan) 8%, var(--mtl-col)); }
/* A column that takes no drop (Duplicate) is greyed out while a card is held, and the pointer says so. */
.mtl-column[data-refuses] { opacity: 0.5; filter: grayscale(1); }
.mtl-root[data-dragging] .mtl-column[data-refuses], .mtl-root[data-dragging] .mtl-column[data-refuses] * { cursor: not-allowed !important; }
.mtl-column-head { display: flex; align-items: center; gap: 8px; flex: none; padding: 10px 12px 8px; }
.mtl-column-name { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; }
.mtl-count { font-family: var(--mtl-mono); font-size: 12px; color: var(--mtl-muted); display: inline-flex; align-items: center; gap: 4px; }
.mtl-cards { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px 8px 12px; }
.mtl-column-empty { margin: 8px 4px; color: var(--mtl-muted); }
.mtl-more { align-self: center; padding: 6px 14px; border: 1px solid var(--mtl-line); border-radius: 2px; background: transparent; color: var(--mtl-ink); font: inherit; cursor: pointer; }
.mtl-more:hover:not(:disabled) { background: var(--mtl-hover); }

/* cards */
.mtl-card { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--mtl-line);
  border-radius: 2px; background: var(--mtl-card); cursor: grab; -webkit-user-select: none; user-select: none; touch-action: pan-y; transition: border-color 0.12s, box-shadow 0.12s; }
.mtl-card:hover { border-color: color-mix(in srgb, var(--mtl-cyan) 55%, var(--mtl-line)); }
.mtl-card[data-selected] { border-color: var(--mtl-cyan); box-shadow: 0 0 0 1px var(--mtl-cyan); }
.mtl-card[data-dragging] { opacity: 0.35; }
.mtl-card[data-moving] { opacity: 0.7; }
.mtl-card[data-settled] { border-color: var(--mtl-cyan); box-shadow: 0 0 0 2px color-mix(in srgb, var(--mtl-cyan) 45%, transparent); }
.mtl-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.mtl-card-id { display: flex; align-items: baseline; gap: 6px; min-width: 0; color: var(--mtl-muted); }
.mtl-id { font-family: var(--mtl-mono); font-size: 12px; color: var(--mtl-muted); white-space: nowrap; }
.mtl-crumb-sep { opacity: 0.6; }
.mtl-crumb { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.mtl-card-assignee { flex: none; color: var(--mtl-muted); display: inline-flex; }
.mtl-avatar { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; color: #fff; font-weight: 600; flex: none; }
.mtl-card-title { display: flex; align-items: flex-start; gap: 8px; }
.mtl-status { flex: none; margin-top: 2px; }
.mtl-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-weight: 500; overflow-wrap: anywhere; }
.mtl-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mtl-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; height: 22px; padding: 0 7px; border: 1px solid var(--mtl-line);
  border-radius: 2px; color: var(--mtl-muted); font-size: 12px; white-space: nowrap; }
.mtl-chip-icon { padding: 0 5px; }
.mtl-chip-text { overflow: hidden; text-overflow: ellipsis; max-width: 130px; }
.mtl-chip[data-priority="1"] { border-color: color-mix(in srgb, #f2994a 60%, var(--mtl-line)); }
.mtl-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.mtl-root [data-status="open"] { color: var(--green-9, #30a46c); }
.mtl-root [data-status="merged"] { color: var(--purple-9, #8e4ec6); }
.mtl-root [data-status="closed"] { color: var(--red-9, #e5484d); }
.mtl-root [data-status="draft"] { color: var(--mtl-muted); }
.mtl-card-foot { font-size: 12px; color: var(--mtl-muted); }
.mtl-lift { position: fixed; z-index: 1000; pointer-events: none; opacity: 0.95; transform: rotate(1.2deg);
  filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.35)); }
.mtl-lift .mtl-card { cursor: grabbing; border-color: var(--mtl-cyan); }

/* details */
.mtl-details { flex: 0 0 380px; width: 380px; min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--mtl-line);
  background: var(--mtl-card); outline: none; }
@media (max-width: 920px) { .mtl-details { position: absolute; right: 0; top: 0; bottom: 0; z-index: 5; box-shadow: -8px 0 24px rgba(0, 0, 0, 0.3); } }
.mtl-details-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--mtl-line); }
.mtl-details-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 16px; }
.mtl-details-title { margin: 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.mtl-fields { display: grid; grid-template-columns: 88px 1fr; gap: 8px 12px; margin: 0; align-items: center; }
.mtl-fields dt { color: var(--mtl-muted); }
.mtl-fields dd { margin: 0; display: flex; align-items: center; gap: 8px; min-width: 0; }
.mtl-wrap { flex-wrap: wrap; }
.mtl-section h3 { margin: 0 0 8px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mtl-muted); display: flex; align-items: center; gap: 8px; }
.mtl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mtl-list li { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mtl-description { white-space: pre-wrap; overflow-wrap: anywhere; }
.mtl-details-foot { padding: 12px 14px; border-top: 1px solid var(--mtl-line); }

/* settings card */
.mtl-settings { height: auto; background: transparent; display: flex; flex-direction: column; gap: 12px; max-width: 560px; padding: 0; }
.mtl-settings p { margin: 0; }
.mtl-settings [data-tone="error"] { color: var(--red-11, #e5484d); }
.mtl-key-form { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.mtl-key-form input { width: 100%; max-width: 420px; height: 32px; }
.mtl-code { display: block; padding: 8px 10px; border: 1px solid var(--mtl-line); border-radius: 2px; background: var(--mtl-card); font-family: var(--mtl-mono); font-size: 12px; overflow-wrap: anywhere; user-select: all; -webkit-user-select: all; }
.mtl-muted code { font-family: var(--mtl-mono); font-size: 12px; }
.mtl-actions { display: flex; flex-wrap: wrap; gap: 8px; }
`;
// src/index.tsx
var inject = [
	"react",
	"pages",
	"settingsCards",
	"navigation",
	"host"
];
function apply(ctx) {
	provideReact(ctx.react);
	const keys = createKeyStore(window.localStorage, {
		store: detectStore(navigator.platform, navigator.userAgent),
		run: (command, input) => ctx.host.runCommand(command, input)
	});
	const client = createClient((request) => ctx.host.request(request), async () => {
		await keys.ready;
		return keys.read();
	});
	const store = createBoardStore(client, window.localStorage);
	ctx.effect(() => {
		const style = document.createElement("style");
		style.dataset.megatechLinear = "";
		style.textContent = CSS$1;
		document.head.append(style);
		let seen = keys.version();
		const unsubscribe = keys.subscribe(() => {
			if (keys.version() === seen) return;
			seen = keys.version();
			store.reset();
		});
		return () => {
			unsubscribe();
			style.remove();
		};
	});
	const openSettings = () => {
		ctx.navigation.open({
			version: 1,
			kind: "settings",
			section: "megatech.linear/settings"
		}).catch(() => {});
	};
	ctx.pages.register({
		id: "board",
		title: "Linear",
		primary: true,
		layout: "workspace",
		icon: PAGE_ICON,
		component: createBoardPage({
			store,
			keys,
			openSettings
		})
	});
	ctx.settingsCards.register({
		id: "settings",
		title: "Linear",
		group: "Plugins",
		component: createSettingsCard({
			keys,
			client
		})
	});
}
export { apply, inject };
