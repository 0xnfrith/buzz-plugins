/** A double-quoted value in a curl config file. Anything that could end the line or the quote is escaped. */
function quote(value) {
	let out = "\"";
	for (const char of value) {
		const code = char.codePointAt(0);
		if (char === "\\") out += "\\\\";
		else if (char === "\"") out += "\\\"";
		else if (char === "\n") out += "\\n";
		else if (char === "\r") out += "\\r";
		else if (char === "	") out += "\\t";
		else if (code < 32 || code === 127) throw new Error("A control character cannot be sent");
		else out += char;
	}
	return out + "\"";
}
function byteLength(text) {
	return new TextEncoder().encode(text).length;
}
/** The stdin for the `request` command, or `undefined` when it would not fit. */
function curlConfig(request) {
	const lines = [`url = ${quote(request.url)}`, `header = ${quote("Accept: application/json")}`];
	if (request.token !== void 0) lines.push(`header = ${quote(`Authorization: Bearer ${request.token}`)}`);
	if (request.method !== "GET") lines.push(`request = ${quote(request.method)}`);
	if (request.body !== void 0) {
		lines.push(`header = ${quote("Content-Type: application/json")}`);
		lines.push(`data-raw = ${quote(JSON.stringify(request.body).replace(/\u007f/g, "\\u007f"))}`);
	}
	const config = lines.join("\n") + "\n";
	return byteLength(config) <= 65536 ? config : void 0;
}
/** The manifest has curl print the body, a line break, then the status code. */
function parseReply(stdout) {
	const cut = stdout.lastIndexOf("\n");
	if (cut < 0) return void 0;
	const status = Number(stdout.slice(cut + 1));
	if (!Number.isInteger(status) || status < 100 || status > 599) return void 0;
	return {
		status,
		body: stdout.slice(0, cut)
	};
}
var OVERHEAD = "http://127.0.0.1:65535/v1/chats/" + "x".repeat(900) + "/messages";
/** Whether `text` can travel in one request, for the composer to say so before sending. */
function fitsInRequest(text) {
	try {
		return curlConfig({
			url: OVERHEAD,
			method: "POST",
			token: "x".repeat(500),
			body: { text }
		}) !== void 0;
	} catch {
		return false;
	}
}
// src/beeper/client.ts
var MESSAGES = {
	"no-token": "No Beeper access token is saved yet.",
	"curl-missing": "The curl program was not found on this computer.",
	unreachable: "Beeper Desktop did not answer.",
	unauthorized: "Beeper rejected the access token.",
	forbidden: "The access token does not have permission for this.",
	"not-found": "Beeper could not find that chat or message.",
	"too-long": "That message is too long to send in one piece.",
	unconfirmed: "Beeper did not answer. The message may still have been sent: check the chat before sending it again.",
	rejected: "Beeper refused the request.",
	server: "Beeper Desktop reported an error.",
	"bad-reply": "Beeper Desktop answered with something this plugin does not understand."
};
/** The message is fixed text by kind. It never carries a token, a URL or anything Beeper sent back. */
var BeeperError = class extends Error {
	kind;
	constructor(kind) {
		super(MESSAGES[kind]);
		this.name = "BeeperError";
		this.kind = kind;
	}
};
var segment = (value) => value.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
/** How many chats the list asks for: the most the API gives, and the fewest worth showing. */
var MAX_CHATS = 200;
var MIN_CHATS = 25;
function createClient({ run, token, baseUrl }) {
	let chatLimit = MAX_CHATS;
	async function request(method, path, options = {}) {
		const authorized = options.authorized ?? true;
		const secret = authorized ? options.token ?? token() : void 0;
		if (authorized && !secret) throw new BeeperError("no-token");
		const query = Object.entries(options.query ?? {}).filter((entry) => entry[1] !== void 0).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&");
		const config = curlConfig({
			url: `${baseUrl()}${path}${query ? `?${query}` : ""}`,
			method,
			token: secret,
			body: options.body
		});
		if (config === void 0) throw new BeeperError("too-long");
		const stdout = await run("request", config).catch(() => null);
		if (stdout === null) throw new BeeperError("unreachable");
		const reply = parseReply(stdout);
		if (!reply) throw new BeeperError("bad-reply");
		const { status } = reply;
		if (status === 401) throw new BeeperError("unauthorized");
		if (status === 403) throw new BeeperError("forbidden");
		if (status === 404) throw new BeeperError("not-found");
		if (status >= 500) throw new BeeperError("server");
		if (status < 200 || status >= 300) throw new BeeperError("rejected");
		if (!reply.body.trim()) return void 0;
		try {
			return JSON.parse(reply.body);
		} catch {
			throw new BeeperError("bad-reply");
		}
	}
	const chatPath = (chatID) => `/v1/chats/${segment(chatID)}`;
	/** After `unreachable`: is it curl, or Beeper? */
	async function diagnose() {
		if (await run("curl-version").catch(() => null) === null) return "curl-missing";
		try {
			await request("GET", "/v1/info", { authorized: false });
			return "reachable";
		} catch (error) {
			return error instanceof BeeperError && error.kind === "unreachable" ? "unreachable" : "reachable";
		}
	}
	return {
		/** Needs no token: it tells whether Beeper Desktop is up and has its API on. */
		info: () => request("GET", "/v1/info", { authorized: false }),
		/** The most recent chats, and whether there are older ones that are not here. */
		async chats() {
			let misses = 0;
			for (;;) try {
				const page = await request("GET", "/v1/chats", { query: { limit: chatLimit } });
				if (!Array.isArray(page?.items)) throw new BeeperError("bad-reply");
				return {
					items: page.items,
					hasMore: !!page.hasMore
				};
			} catch (error) {
				if (!(error instanceof BeeperError) || error.kind !== "unreachable" || chatLimit <= MIN_CHATS) throw error;
				misses += 1;
				if (misses < 2) continue;
				if (await diagnose() !== "reachable") throw error;
				chatLimit = Math.max(MIN_CHATS, chatLimit >> 1);
				misses = 0;
			}
		},
		/** One page of a chat's messages, the newest first; `cursor` is `oldestCursor` of the page before. */
		async messages(chatID, cursor) {
			const page = await request("GET", `${chatPath(chatID)}/messages`, { query: cursor ? {
				cursor,
				direction: "before"
			} : void 0 });
			if (!Array.isArray(page?.items)) throw new BeeperError("bad-reply");
			return page;
		},
		async send(chatID, text) {
			const result = await request("POST", `${chatPath(chatID)}/messages`, { body: { text } }).catch((error) => {
				throw error instanceof BeeperError && error.kind === "unreachable" ? new BeeperError("unconfirmed") : error;
			});
			if (typeof result?.pendingMessageID !== "string") throw new BeeperError("bad-reply");
			return result;
		},
		async markRead(chatID) {
			await request("POST", `${chatPath(chatID)}/read`, { body: {} });
		},
		/**
		* The settings card's check: does Beeper answer, and does it accept this token for what the
		* page needs? `candidate` tries a token that is not saved yet.
		*/
		async probe(candidate) {
			const info = await request("GET", "/v1/info", { authorized: false });
			await request("GET", "/v1/chats", {
				query: { limit: 1 },
				token: candidate
			});
			return info;
		},
		diagnose
	};
}
// src/beeper/config.ts
var TOKEN = "megatech.beeper.token.v1";
var BASE_URL = "megatech.beeper.base-url.v1";
/** Where Beeper Desktop listens by default. */
var DEFAULT_BASE_URL = "http://127.0.0.1:23373";
var withoutLineBreak = (text) => text?.replace(/\r?\n$/, "");
function createConfigStore(storage, { run, keychain = false } = {}) {
	const listeners = /* @__PURE__ */ new Set();
	let version = 0;
	const changed = () => {
		version += 1;
		listeners.forEach((listener) => listener());
	};
	const read = (name) => {
		try {
			return storage.getItem(name) || void 0;
		} catch {
			return;
		}
	};
	const usable = keychain && run !== void 0;
	const secret = (command, input) => run ? run(command, input).catch(() => null) : Promise.resolve(null);
	let token;
	let place;
	const signature = () => `${place ?? ""}:${token ?? ""}`;
	/** Looks for the token again: the Keychain first, then the profile. */
	async function load() {
		const before = signature();
		let found;
		let where;
		if (usable) {
			const kept = withoutLineBreak(await secret("keychain-read"));
			if (kept) [found, where] = [kept, "keychain"];
		}
		if (!found) {
			const stored = read(TOKEN);
			if (stored) [found, where] = [stored, "profile"];
		}
		[token, place] = [found, where];
		if (signature() !== before) changed();
	}
	/** Puts a token in the Keychain, and reads it back to be sure: the program's own exit status is not trusted to say. */
	async function toKeychain(value) {
		if (!usable) return false;
		await secret("keychain-save", `${value}\n${value}\n`);
		if (withoutLineBreak(await secret("keychain-read")) !== value) return false;
		try {
			storage.removeItem(TOKEN);
		} catch {}
		[token, place] = [value, "keychain"];
		changed();
		return true;
	}
	return {
		/** Changes whenever the token or the address changes, for effects that must start over. */
		version: () => version,
		/** Settles when the first look for the token is over. */
		ready: load(),
		/** Looks again (the Keychain may have been given the token from outside, or have asked and been answered). */
		reload: load,
		/** The saved token, for the client only. Nothing else should hold on to it. */
		token: () => token,
		hasToken: () => token !== void 0,
		place: () => place,
		keychainAvailable: () => usable,
		/** False when the Keychain would not keep it (the caller then shows how to put it there by hand). */
		saveToKeychain: toKeychain,
		/** The explicit fallback: plain text in the app's profile. */
		async saveToProfile(value) {
			storage.setItem(TOKEN, value);
			if (usable) await secret("keychain-delete");
			[token, place] = [value, "profile"];
			changed();
		},
		/** Moves a token kept in the profile to the Keychain. */
		async moveToKeychain() {
			return token !== void 0 && place === "profile" ? toKeychain(token) : false;
		},
		/** False when the Keychain still has it afterwards. */
		async clearToken() {
			storage.removeItem(TOKEN);
			if (usable) {
				await secret("keychain-delete");
				const left = withoutLineBreak(await secret("keychain-read"));
				if (left) {
					[token, place] = [left, "keychain"];
					changed();
					return false;
				}
			}
			[token, place] = [void 0, void 0];
			changed();
			return true;
		},
		baseUrl() {
			const stored = read(BASE_URL);
			const checked = stored === void 0 ? void 0 : checkBaseUrl(stored);
			return checked?.ok ? checked.value : DEFAULT_BASE_URL;
		},
		/** `undefined` puts the default back. */
		saveBaseUrl(url) {
			if (url === void 0 || url === "http://127.0.0.1:23373") storage.removeItem(BASE_URL);
			else storage.setItem(BASE_URL, url);
			changed();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}
/** What was pasted, made safe to put in a header: no `Bearer`, no spaces or line breaks. */
/** Longer than any real token; the cap leaves room in one request for a long message. */
var MAX_TOKEN = 500;
function checkToken(pasted) {
	const token = pasted.trim().replace(/^bearer\s+/i, "");
	if (!token) return {
		ok: false,
		message: "Paste your Beeper access token."
	};
	if (token.length < 8 || token.length > MAX_TOKEN || !/^[\x21-\x7e]+$/.test(token)) return {
		ok: false,
		message: "That does not look like a Beeper access token."
	};
	return {
		ok: true,
		value: token
	};
}
var LOOPBACK = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"localhost",
	"[::1]"
]);
/** The address of Beeper Desktop: plain http, on this computer only, nothing after the port. */
function checkBaseUrl(typed) {
	const text = typed.trim();
	if (!text) return {
		ok: true,
		value: DEFAULT_BASE_URL
	};
	let url;
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
	} catch {
		return {
			ok: false,
			message: `Type an address like ${DEFAULT_BASE_URL}.`
		};
	}
	if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname) || url.username || url.password) return {
		ok: false,
		message: "Beeper Desktop runs on this computer: use http://127.0.0.1 or http://localhost with its port."
	};
	if (url.pathname !== "/" && url.pathname !== "" || url.search || url.hash) return {
		ok: false,
		message: "Give only the address and port, nothing after it."
	};
	return {
		ok: true,
		value: url.origin
	};
}
// src/beeper/store.ts
var realTimers = {
	every: (fn, ms) => {
		const id = setInterval(fn, ms);
		return () => clearInterval(id);
	},
	after: (fn, ms) => {
		const id = setTimeout(fn, ms);
		return () => clearTimeout(id);
	}
};
var TICK_MS = 3e3;
/** How long a message Beeper has accepted waits to show up in the chat before it is forgotten. */
var CONFIRM_MS = 6e4;
/** Failures of one request that say Beeper cannot be reached or will not talk to us. Any other failure is about that request alone. */
var CONNECTIVITY = /* @__PURE__ */ new Set([
	"unreachable",
	"curl-missing",
	"unauthorized",
	"forbidden",
	"no-token"
]);
var CONNECTION_OF = {
	"no-token": "no-token",
	"curl-missing": "curl-missing",
	unreachable: "unavailable",
	unauthorized: "unauthorized",
	forbidden: "forbidden"
};
var time = (value) => {
	const parsed = value ? Date.parse(value) : NaN;
	return Number.isNaN(parsed) ? 0 : parsed;
};
/** Pinned first, then the most recent activity. Archived chats and merged shells are not listed. */
function listable(chats) {
	return chats.filter((chat) => !chat.isArchived && !chat.merge).map((chat, index) => ({
		chat,
		index
	})).sort((a, b) => Number(!!b.chat.isPinned) - Number(!!a.chat.isPinned) || time(b.chat.lastActivity) - time(a.chat.lastActivity) || a.index - b.index).map(({ chat }) => chat);
}
function applyFilter(chats, filter, unreadOnly) {
	const needle = filter.trim().toLowerCase();
	return chats.filter((chat) => (!unreadOnly || chat.unreadCount > 0 || chat.isMarkedUnread) && (!needle || chat.title.toLowerCase().includes(needle) || chat.network.toLowerCase().includes(needle)));
}
var numeric = /^\d+$/;
function bySortKey(a, b) {
	if (numeric.test(a) && numeric.test(b)) return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
	return a < b ? -1 : a > b ? 1 : 0;
}
/**
* What a poll brings is new objects with the same content. Keeping the old object when nothing changed
* is what lets the page skip drawing a row or a bubble again (it compares objects, not content).
*/
var unchanged = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
/** Oldest first. Reactions, deleted and hidden messages are not shown; a newer copy of a message replaces the older. */
function mergeMessages(...groups) {
	const byId = /* @__PURE__ */ new Map();
	for (const group of groups) for (const message of group) {
		const old = byId.get(message.id);
		byId.set(message.id, old && unchanged(old, message) ? old : message);
	}
	return [...byId.values()].filter((message) => message.type !== "REACTION" && !message.isDeleted && !message.isHidden).sort((a, b) => time(a.timestamp) - time(b.timestamp) || bySortKey(a.sortKey, b.sortKey));
}
function createInbox({ client, hasToken, ready = Promise.resolve(), timers = realTimers, now = Date.now }) {
	let state = {
		connection: "checking",
		stale: false,
		chats: [],
		list: [],
		moreChats: false,
		filter: "",
		unreadOnly: false,
		pending: []
	};
	const listeners = /* @__PURE__ */ new Set();
	let epoch = 0;
	let openSerial = 0;
	let failures = 0;
	let sendCounter = 0;
	let ticks = 0;
	let busy = false;
	let markingRead = false;
	let active = true;
	let stopTicking;
	let stopSoon;
	let cursor;
	let paged = false;
	const seen = /* @__PURE__ */ new Set();
	let pageGeneration = 0;
	let running = false;
	const set = (patch) => {
		state = {
			...state,
			...patch
		};
		listeners.forEach((listener) => listener());
	};
	const relist = (patch = {}) => {
		const next = {
			...state,
			...patch
		};
		const list = applyFilter(next.chats, next.filter, next.unreadOnly);
		let cursorId = next.cursorId;
		if (!list.some((chat) => chat.id === cursorId)) {
			const was = state.list.findIndex((chat) => chat.id === cursorId);
			cursorId = list[Math.min(Math.max(was, 0), list.length - 1)]?.id;
		}
		set({
			...patch,
			list,
			cursorId
		});
	};
	const connectionFailed = async (error, fromEpoch) => {
		if (fromEpoch !== epoch) return;
		const kind = error instanceof BeeperError ? error.kind : "bad-reply";
		let connection = CONNECTION_OF[kind] ?? "error";
		let problem = error instanceof BeeperError ? error.message : "Something went wrong talking to Beeper.";
		if (kind === "unreachable") {
			const found = await client.diagnose().catch(() => "unreachable");
			if (fromEpoch !== epoch) return;
			connection = found === "curl-missing" ? "curl-missing" : found === "unreachable" ? "unavailable" : "error";
			if (found === "reachable") problem = "Beeper Desktop is running, but its answer was too slow or too large to use.";
		}
		failures += 1;
		if (state.connection === "ready" && (connection === "unavailable" || connection === "error") && failures < 2) return set({ stale: true });
		set({
			connection,
			stale: false,
			problem: connection === "error" ? problem : void 0
		});
	};
	const refreshChats = async () => {
		const mine = epoch;
		await ready;
		if (mine !== epoch) return;
		if (!hasToken()) return connectionFailed(new BeeperError("no-token"), mine);
		try {
			const { items: fetched, hasMore } = await client.chats();
			if (mine !== epoch) return;
			failures = 0;
			const known = new Map(state.chats.map((chat) => [chat.id, chat]));
			const all = fetched.map((chat) => {
				const old = known.get(chat.id);
				return old && unchanged(old, chat) ? old : chat;
			});
			relist({
				chats: listable(all),
				moreChats: hasMore,
				connection: "ready",
				stale: false,
				problem: void 0
			});
			const open = state.openId && state.chats.find((chat) => chat.id === state.openId);
			const shown = !!state.thread && !state.thread.loading && !state.thread.failed;
			if (open && open.unreadCount > 0 && active && shown) markRead(open.id);
		} catch (error) {
			await connectionFailed(error, mine);
		}
	};
	/** Reads the newest page of the open chat. True if it was read and is still the chat being shown. */
	const loadMessages = async (chatID, serial) => {
		const mine = epoch;
		try {
			const page = await client.messages(chatID);
			if (mine !== epoch || serial !== openSerial) return false;
			failures = 0;
			const thread = state.thread;
			const fresh = !paged || seen.size > 0 && !page.items.some((message) => seen.has(message.id));
			paged = true;
			if (fresh) {
				cursor = page.oldestCursor ?? void 0;
				seen.clear();
				pageGeneration += 1;
			}
			for (const message of page.items) seen.add(message.id);
			set({
				stale: false,
				thread: {
					items: fresh ? mergeMessages(page.items) : mergeMessages(thread?.items ?? [], page.items),
					loading: false,
					loadingEarlier: fresh ? false : thread?.loadingEarlier ?? false,
					failed: false,
					hasMore: fresh ? !!page.hasMore && !!cursor : thread?.hasMore ?? false
				}
			});
			settlePending();
			return true;
		} catch (error) {
			if (mine !== epoch || serial !== openSerial) return false;
			const thread = state.thread;
			set({ thread: {
				items: thread?.items ?? [],
				loading: false,
				loadingEarlier: false,
				failed: true,
				hasMore: thread?.hasMore ?? false
			} });
			if (error instanceof BeeperError && CONNECTIVITY.has(error.kind)) await connectionFailed(error, mine);
			return false;
		}
	};
	const markRead = async (chatID) => {
		if (markingRead) return;
		markingRead = true;
		const mine = epoch;
		try {
			await client.markRead(chatID);
			if (mine === epoch) relist({ chats: state.chats.map((chat) => chat.id === chatID ? {
				...chat,
				unreadCount: 0,
				isMarkedUnread: false
			} : chat) });
		} catch {} finally {
			markingRead = false;
		}
	};
	/** Drops the sends that now show up in the open chat, and the ones Beeper took long ago and never listed. */
	const settlePending = () => {
		const items = state.thread?.items ?? [];
		const taken = /* @__PURE__ */ new Set();
		const pending = state.pending.filter((send) => {
			if (send.status !== "sent") return true;
			if (now() - send.at > CONFIRM_MS) return false;
			if (send.chatID !== state.openId) return true;
			const match = items.find((message) => !taken.has(message.id) && (message.id === send.pendingMessageID || message.isSender && message.text === send.text && time(message.timestamp) >= send.at - 5e3));
			if (match) taken.add(match.id);
			return !match;
		});
		if (pending.length !== state.pending.length) set({ pending });
	};
	const refreshOpen = async () => {
		if (state.openId) await loadMessages(state.openId, openSerial);
	};
	const tick = async () => {
		if (!active || busy) return;
		busy = true;
		try {
			ticks += 1;
			settlePending();
			if (state.connection === "ready") {
				if (state.openId) await refreshOpen();
				if (!state.openId || ticks % 3 === 0) await refreshChats();
			} else if (ticks % 2 === 0) await refreshChats();
		} finally {
			busy = false;
		}
	};
	/** Sends `text` to a chat. It shows at once as "sending" and settles when Beeper lists it. */
	async function sendTo(chatID, text) {
		const body = text.replace(/\s+$/, "");
		if (!body.trim()) return;
		const key = `send-${sendCounter += 1}`;
		set({ pending: [...state.pending, {
			key,
			chatID,
			text: body,
			at: now(),
			status: "sending"
		}] });
		const update = (patch) => set({ pending: state.pending.map((entry) => entry.key === key ? {
			...entry,
			...patch
		} : entry) });
		const mine = epoch;
		try {
			const result = await client.send(chatID, body);
			if (mine !== epoch) return;
			update({
				status: "sent",
				pendingMessageID: result.pendingMessageID
			});
			if (state.openId === chatID) {
				stopSoon?.();
				stopSoon = timers.after(() => void refreshOpen(), 800);
			}
		} catch (error) {
			if (mine !== epoch) return;
			update({
				status: "failed",
				error: error instanceof BeeperError ? error.message : "The message was not sent."
			});
		}
	}
	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		/** Starts polling; call the returned function to stop. The first look happens at once. */
		start() {
			running = true;
			refreshChats();
			stopTicking?.();
			stopTicking = timers.every(() => void tick(), TICK_MS);
			return () => {
				running = false;
				stopTicking?.();
				stopSoon?.();
				stopTicking = stopSoon = void 0;
			};
		},
		/** Whether Buzz is showing the page; nothing is asked of Beeper while it is not. */
		setActive(value) {
			const was = active;
			active = value;
			if (value && !was) tick();
		},
		/** Read the list and the open chat now, for the refresh button. */
		async refresh() {
			await refreshChats();
			await refreshOpen();
		},
		/** Check now, for the Try again button. */
		async retry() {
			set({
				connection: "checking",
				stale: false
			});
			await refreshChats();
		},
		/** A new token or address means a different Beeper: forget everything and look again. */
		reset() {
			epoch += 1;
			openSerial += 1;
			failures = 0;
			cursor = void 0;
			paged = false;
			seen.clear();
			pageGeneration += 1;
			set({
				connection: "checking",
				stale: false,
				problem: void 0,
				chats: [],
				list: [],
				moreChats: false,
				cursorId: void 0,
				openId: void 0,
				thread: void 0,
				pending: []
			});
			if (running) refreshChats();
		},
		setFilter: (filter) => relist({ filter }),
		setUnreadOnly: (unreadOnly) => relist({ unreadOnly }),
		moveCursor(delta) {
			const { list, cursorId } = state;
			if (!list.length) return;
			const at = list.findIndex((chat) => chat.id === cursorId);
			const next = Math.min(Math.max((at < 0 ? delta > 0 ? -1 : list.length : at) + delta, 0), list.length - 1);
			set({ cursorId: list[next].id });
		},
		moveCursorTo(chatID) {
			if (state.list.some((chat) => chat.id === chatID)) set({ cursorId: chatID });
		},
		async open(chatID) {
			if (state.openId === chatID) return;
			openSerial += 1;
			cursor = void 0;
			paged = false;
			seen.clear();
			pageGeneration += 1;
			set({
				openId: chatID,
				cursorId: chatID,
				thread: {
					items: [],
					loading: true,
					loadingEarlier: false,
					failed: false,
					hasMore: false
				}
			});
			const chat = state.chats.find((candidate) => candidate.id === chatID);
			if (await loadMessages(chatID, openSerial) && chat && (chat.unreadCount > 0 || chat.isMarkedUnread) && active && state.openId === chatID) await markRead(chatID);
		},
		close() {
			openSerial += 1;
			cursor = void 0;
			paged = false;
			seen.clear();
			pageGeneration += 1;
			set({
				openId: void 0,
				thread: void 0
			});
		},
		async loadEarlier() {
			const thread = state.thread;
			const chatID = state.openId;
			if (!thread || !chatID || !thread.hasMore || thread.loadingEarlier || !cursor) return;
			const serial = openSerial;
			const generation = pageGeneration;
			const mine = epoch;
			set({ thread: {
				...thread,
				loadingEarlier: true
			} });
			try {
				const page = await client.messages(chatID, cursor);
				if (mine !== epoch || serial !== openSerial || generation !== pageGeneration) return;
				cursor = page.oldestCursor ?? void 0;
				for (const message of page.items) seen.add(message.id);
				const current = state.thread;
				set({ thread: {
					...current,
					items: mergeMessages(current.items, page.items),
					loadingEarlier: false,
					failed: false,
					hasMore: !!page.hasMore && !!cursor
				} });
			} catch {
				if (mine !== epoch || serial !== openSerial || generation !== pageGeneration) return;
				set({ thread: {
					...state.thread,
					loadingEarlier: false,
					failed: true
				} });
			}
		},
		/** Sends `text` to the open chat. */
		async send(text) {
			if (state.openId) await sendTo(state.openId, text);
		},
		/** Tries a failed send again, to the chat it was for. */
		async retrySend(key) {
			const failed = state.pending.find((entry) => entry.key === key && entry.status === "failed");
			if (!failed) return;
			set({ pending: state.pending.filter((entry) => entry.key !== key) });
			await sendTo(failed.chatID, failed.text);
		},
		dismissSend(key) {
			set({ pending: state.pending.filter((send) => send.key !== key) });
		}
	};
}
// src/react.ts
var React;
function provideReact(react) {
	React = react;
}
// src/ui/format.ts
var DAY = 864e5;
/** The calendar day of `ms` in the zone, as a number that compares and subtracts like days. */
function dayNumber(ms, timeZone) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	}).format(ms).split("-").map(Number);
	return Date.UTC(parts[0], parts[1] - 1, parts[2]) / DAY;
}
/** The clock time of a message: "14:05" or "2:05 PM", as the person's locale writes it. */
function clock(iso, { locale, timeZone } = {}) {
	const ms = iso ? Date.parse(iso) : NaN;
	if (Number.isNaN(ms)) return "";
	return new Intl.DateTimeFormat(locale, {
		timeZone,
		hour: "numeric",
		minute: "2-digit"
	}).format(ms);
}
/** For the chat list: the time today, "Yesterday", the weekday this week, otherwise the date. */
function listTime(iso, now, { locale, timeZone } = {}) {
	const ms = iso ? Date.parse(iso) : NaN;
	if (Number.isNaN(ms)) return "";
	const ago = dayNumber(now, timeZone) - dayNumber(ms, timeZone);
	if (ago <= 0) return clock(iso, {
		locale,
		timeZone
	});
	if (ago === 1) return "Yesterday";
	if (ago < 7) return new Intl.DateTimeFormat(locale, {
		timeZone,
		weekday: "short"
	}).format(ms);
	return new Intl.DateTimeFormat(locale, {
		timeZone,
		month: "short",
		day: "numeric",
		...ago > 300 ? { year: "numeric" } : {}
	}).format(ms);
}
/** The heading above a day's messages; nothing for a time that cannot be read. */
function dayLabel(iso, now, { locale, timeZone } = {}) {
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) return "";
	const ago = dayNumber(now, timeZone) - dayNumber(ms, timeZone);
	if (ago === 0) return "Today";
	if (ago === 1) return "Yesterday";
	return new Intl.DateTimeFormat(locale, {
		timeZone,
		weekday: "short",
		month: "short",
		day: "numeric",
		...ago > 300 ? { year: "numeric" } : {}
	}).format(ms);
}
/** Whether two messages are from one day. A time that cannot be read is no reason for a new heading. */
function sameDay(a, b, timeZone) {
	const first = Date.parse(a);
	const second = Date.parse(b);
	if (Number.isNaN(first) || Number.isNaN(second)) return true;
	return dayNumber(first, timeZone) === dayNumber(second, timeZone);
}
/** Two letters at most, for a network's badge: "WhatsApp" is W, "Google Messages" is GM. */
function initials(name) {
	const words = name.trim().split(/[\s_-]+/).filter(Boolean);
	if (!words.length) return "?";
	return (words.length === 1 ? words[0].slice(0, 1) : words[0].slice(0, 1) + words[1].slice(0, 1)).toLocaleUpperCase();
}
/** A hue from the name, so each network keeps one colour from run to run. */
function hueOf(name) {
	let hash = 0;
	for (const char of name.toLowerCase()) hash = hash * 31 + char.codePointAt(0) >>> 0;
	return hash % 360;
}
var ATTACHMENT_LABEL = {
	IMAGE: "Image",
	VIDEO: "Video",
	VOICE: "Voice message",
	AUDIO: "Audio",
	FILE: "File",
	STICKER: "Sticker",
	LOCATION: "Location"
};
/** What stands in for media the plugin does not load: the kind, and a file name when there is one. */
function mediaLabel(message) {
	const base = message.type ? ATTACHMENT_LABEL[message.type] : void 0;
	if (!base) return void 0;
	const name = message.attachments?.find((attachment) => attachment.fileName)?.fileName;
	return name ? `${base}: ${name}` : base;
}
// src/ui/icons.tsx
/** The page's entry in navigation and search: a speech bubble. */
var PAGE_ICON = "data:image/svg+xml," + encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H11l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z\" fill=\"#6366f1\"/><rect x=\"6\" y=\"8\" width=\"12\" height=\"2\" rx=\"1\" fill=\"#fff\"/><rect x=\"6\" y=\"12\" width=\"8\" height=\"2\" rx=\"1\" fill=\"#fff\"/></svg>");
/**
* A network's badge: its initials on a colour taken from its name. Beeper's API gives a network as
* a display name only, and the networks' own logos are theirs, so none is bundled.
*/
function NetworkBadge({ network, size = 28 }) {
	return /* @__PURE__ */ React.createElement("span", {
		className: "mtb-badge",
		title: network,
		"aria-hidden": "true",
		style: {
			width: size,
			height: size,
			fontSize: Math.round(size * .4),
			background: `hsl(${hueOf(network)} 52% 38%)`
		}
	}, initials(network));
}
function RefreshIcon({ size = 16 }) {
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.5",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		"aria-hidden": "true"
	}, /* @__PURE__ */ React.createElement("path", { d: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9" }), /* @__PURE__ */ React.createElement("path", { d: "M13.5 2.5v3h-3" }));
}
function CloseIcon({ size = 16 }) {
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.5",
		strokeLinecap: "round",
		"aria-hidden": "true"
	}, /* @__PURE__ */ React.createElement("path", { d: "M4 4l8 8M12 4l-8 8" }));
}
function MuteIcon({ size = 12 }) {
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "1.5",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		"aria-hidden": "true"
	}, /* @__PURE__ */ React.createElement("path", { d: "M2 6v4h3l4 3V3L5 6H2zM12 5.5l3 5M15 5.5l-3 5" }));
}
function PinIcon({ size = 12 }) {
	return /* @__PURE__ */ React.createElement("svg", {
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		fill: "currentColor",
		"aria-hidden": "true"
	}, /* @__PURE__ */ React.createElement("path", { d: "M9.5 1.5l5 5-1.8.6-2.4 2.4.3 3.1-1 1-3-3-4 4-.7-.7 4-4-3-3 1-1 3.1.3 2.4-2.4z" }));
}
// src/ui/States.tsx
var setup = () => /* @__PURE__ */ React.createElement("ol", null, /* @__PURE__ */ React.createElement("li", null, "Open Beeper Desktop and go to Settings, then Developers."), /* @__PURE__ */ React.createElement("li", null, "Turn on Beeper Desktop API."), /* @__PURE__ */ React.createElement("li", null, "Under Approved connections, press + to make an access token."), /* @__PURE__ */ React.createElement("li", null, "Paste the token in this plugin's settings."));
/** What the page says when Beeper cannot be read: what is wrong, and what to do about it. Every text is fixed. */
function Problem({ connection, problem, onRetry, onSettings }) {
	if (connection === "checking") return /* @__PURE__ */ React.createElement("div", {
		className: "mtb-empty",
		role: "status"
	}, "Connecting to Beeper Desktop…");
	const retry = /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "mtb-button",
		onClick: onRetry
	}, "Check again");
	const settings = (primary) => /* @__PURE__ */ React.createElement("button", {
		type: "button",
		className: "mtb-button",
		"data-primary": primary ? "" : void 0,
		onClick: onSettings
	}, "Open settings");
	let body;
	switch (connection) {
		case "no-token":
			body = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("h2", null, "Connect Beeper"), /* @__PURE__ */ React.createElement("p", null, "This page shows your Beeper chats and lets you reply. It needs an access token from Beeper Desktop on this computer."), setup(), /* @__PURE__ */ React.createElement("div", { className: "mtb-actions" }, settings(true), retry));
			break;
		case "unavailable":
			body = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("h2", null, "Beeper is not running, or its API is off"), /* @__PURE__ */ React.createElement("p", null, "Beeper Desktop has to be open on this computer, with its Desktop API turned on: Settings, then Developers, then Beeper Desktop API."), /* @__PURE__ */ React.createElement("p", { className: "mtb-muted" }, "If you changed the API's port, set the address in this plugin's settings."), /* @__PURE__ */ React.createElement("div", { className: "mtb-actions" }, retry, settings(false)));
			break;
		case "curl-missing":
			body = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("h2", null, "curl was not found"), /* @__PURE__ */ React.createElement("p", null, "Buzz cannot reach Beeper Desktop directly, because it only allows secure connections. So this plugin asks the ", /* @__PURE__ */ React.createElement("code", null, "curl"), " program on this computer to do it. macOS, Windows 10 and later and most Linux systems have it; install it, then check again."), /* @__PURE__ */ React.createElement("div", { className: "mtb-actions" }, retry));
			break;
		case "unauthorized":
			body = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("h2", null, "Beeper did not accept the token"), /* @__PURE__ */ React.createElement("p", null, "It may have been removed in Beeper. Make a new one under Settings, Developers, Approved connections, and paste it in this plugin's settings."), /* @__PURE__ */ React.createElement("div", { className: "mtb-actions" }, settings(true), retry));
			break;
		case "forbidden":
			body = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("h2", null, "The token cannot do this"), /* @__PURE__ */ React.createElement("p", null, "Beeper accepted the token but would not let it read or send chats. Make a new token that allows both, and paste it in this plugin's settings."), /* @__PURE__ */ React.createElement("div", { className: "mtb-actions" }, settings(true), retry));
			break;
		default: body = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("h2", null, "Something went wrong"), /* @__PURE__ */ React.createElement("p", null, problem ?? "Beeper Desktop gave an answer this plugin could not use."), /* @__PURE__ */ React.createElement("div", { className: "mtb-actions" }, retry));
	}
	return /* @__PURE__ */ React.createElement("div", { className: "mtb-empty" }, /* @__PURE__ */ React.createElement("div", {
		className: "mtb-panel",
		role: "alert"
	}, body));
}
function contentHeight(total) {
	return total * 56 + 8;
}
function rowTop(index) {
	return 4 + index * 56;
}
/** The rows to draw, as `[start, end)`. */
function visibleRange(scrollTop, viewHeight, total) {
	const first = Math.floor((scrollTop - 4) / 56) - 6;
	const last = Math.ceil((scrollTop + viewHeight - 4) / 56) + 6;
	return [Math.min(Math.max(first, 0), total), Math.min(Math.max(last, 0), total)];
}
/** The scroll position that brings row `index` fully into view with the least movement. */
function scrollToReveal(index, scrollTop, viewHeight) {
	const top = rowTop(index);
	const bottom = top + 56;
	if (top - 4 < scrollTop) return Math.max(0, top - 4);
	if (bottom + 4 > scrollTop + viewHeight) return bottom + 4 - viewHeight;
	return scrollTop;
}
// src/ui/Inbox.tsx
/** The time, refreshed each minute, for "Yesterday" and the like to change on their own. */
function useNow() {
	const [now, setNow] = React.useState(() => Date.now());
	React.useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 6e4);
		return () => clearInterval(id);
	}, []);
	return now;
}
var rowId = (chatID) => `mtb-row-${chatID}`;
function createInboxPage({ inbox, openSettings, reloadToken }) {
	const Row = React.memo(function Row({ chat, cursor, open, unsent, now, top, position, total }) {
		const unread = chat.unreadCount > 0 ? chat.unreadCount : 0;
		return /* @__PURE__ */ React.createElement("div", {
			id: rowId(chat.id),
			role: "option",
			"aria-selected": open,
			"aria-posinset": position,
			"aria-setsize": total,
			className: "mtb-row",
			style: { top },
			"data-chat-id": chat.id,
			"data-cursor": cursor ? "" : void 0,
			"data-open": open ? "" : void 0,
			"data-unread": unread || chat.isMarkedUnread ? "" : void 0,
			onClick: () => void inbox.open(chat.id)
		}, /* @__PURE__ */ React.createElement(NetworkBadge, { network: chat.network }), /* @__PURE__ */ React.createElement("span", { className: "mtb-row-text" }, /* @__PURE__ */ React.createElement("span", { className: "mtb-row-name" }, chat.title), /* @__PURE__ */ React.createElement("span", { className: "mtb-row-meta" }, chat.isPinned && /* @__PURE__ */ React.createElement(PinIcon, null), chat.isMuted && /* @__PURE__ */ React.createElement(MuteIcon, null), /* @__PURE__ */ React.createElement("span", null, chat.network), unsent && /* @__PURE__ */ React.createElement("span", { className: "mtb-unsent" }, "Not sent"))), /* @__PURE__ */ React.createElement("span", { className: "mtb-row-end" }, /* @__PURE__ */ React.createElement("span", null, listTime(chat.lastActivity, now)), unread > 0 ? /* @__PURE__ */ React.createElement("span", {
			className: "mtb-unread",
			"data-muted": chat.isMuted ? "" : void 0,
			"aria-label": `${unread} unread`
		}, unread > 99 ? "99+" : unread) : chat.isMarkedUnread ? /* @__PURE__ */ React.createElement("span", {
			className: "mtb-unread",
			"data-muted": chat.isMuted ? "" : void 0,
			"aria-label": "Marked unread"
		}, "•") : null));
	});
	const Bubble = React.memo(function Bubble({ message, showFrom }) {
		const media = mediaLabel(message);
		const notice = message.type === "NOTICE";
		return /* @__PURE__ */ React.createElement("div", {
			className: "mtb-msg",
			"data-mine": message.isSender ? "" : void 0,
			"data-notice": notice ? "" : void 0,
			"data-message-id": message.id
		}, showFrom && !message.isSender && /* @__PURE__ */ React.createElement("div", { className: "mtb-msg-from" }, message.senderName ?? "Someone"), media && /* @__PURE__ */ React.createElement("div", { className: "mtb-msg-media" }, media), message.text ? /* @__PURE__ */ React.createElement("div", { className: "mtb-msg-text" }, message.text) : null, !media && !message.text && /* @__PURE__ */ React.createElement("div", { className: "mtb-msg-media" }, "Message"), /* @__PURE__ */ React.createElement("div", { className: "mtb-msg-meta" }, clock(message.timestamp)));
	});
	function PendingBubble({ send }) {
		return /* @__PURE__ */ React.createElement("div", {
			className: "mtb-msg",
			"data-mine": "",
			"data-pending": send.status !== "failed" ? "" : void 0,
			"data-failed": send.status === "failed" ? "" : void 0,
			"data-send-status": send.status
		}, /* @__PURE__ */ React.createElement("div", { className: "mtb-msg-text" }, send.text), /* @__PURE__ */ React.createElement("div", { className: "mtb-msg-meta" }, send.status === "sending" ? "Sending…" : send.status === "sent" ? "Sent, waiting for Beeper to list it" : "Not sent"), send.status === "failed" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", {
			className: "mtb-msg-error",
			role: "alert"
		}, send.error), /* @__PURE__ */ React.createElement("div", { className: "mtb-actions" }, /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-button",
			onClick: () => void inbox.retrySend(send.key)
		}, "Try again"), /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-button",
			onClick: () => inbox.dismissSend(send.key)
		}, "Dismiss"))));
	}
	const Composer = React.memo(function Composer({ chat, draft, onDraft, onSent, composerRef, focusList, focusNext }) {
		const [text, setText] = React.useState(draft);
		React.useEffect(() => {
			if (focusNext.current) composerRef.current?.focus();
			focusNext.current = false;
		}, [focusNext, composerRef]);
		React.useEffect(() => {
			const box = composerRef.current;
			if (!box || typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content")) return;
			if (!text) {
				box.style.height = "";
				return;
			}
			const timer = setTimeout(() => {
				box.style.height = "auto";
				box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
			}, 80);
			return () => clearTimeout(timer);
		}, [text, composerRef]);
		const fits = text.length < 2e3 || fitsInRequest(text);
		const submit = () => {
			if (!text.trim() || !fits) return;
			inbox.send(text);
			setText("");
			onDraft(chat.id, "");
			onSent();
		};
		if (chat.isReadOnly) return /* @__PURE__ */ React.createElement("div", { className: "mtb-composer-note" }, "You cannot send messages in this chat.");
		return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", {
			className: "mtb-composer",
			"data-mtb": "composer"
		}, /* @__PURE__ */ React.createElement("textarea", {
			ref: composerRef,
			rows: 1,
			"aria-label": `Reply to ${chat.title}`,
			placeholder: "Reply…",
			value: text,
			onChange: (event) => {
				setText(event.target.value);
				onDraft(chat.id, event.target.value);
			},
			onKeyDown: (event) => {
				if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					submit();
				} else if (event.key === "Escape") {
					event.preventDefault();
					event.currentTarget.blur();
					focusList();
				}
			}
		}), /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-button",
			"data-primary": "",
			disabled: !text.trim() || !fits,
			onClick: submit
		}, "Send")), /* @__PURE__ */ React.createElement("div", {
			className: "mtb-composer-note",
			"data-tone": fits ? void 0 : "error"
		}, fits ? "Enter sends, Shift+Enter adds a line. Opening a chat marks it read in Beeper." : "That message is too long to send from here."));
	});
	const Pane = React.memo(function Pane({ chat, thread, pending, now, draft, onDraft, composerRef, focusList, focusNext }) {
		const threadRef = React.useRef(null);
		const stick = React.useRef(true);
		const items = thread?.items ?? [];
		const first = items[0]?.id;
		const last = items[items.length - 1]?.id;
		const pendingState = pending.map((send) => send.status).join();
		const before = React.useRef({ height: 0 });
		const onSent = React.useCallback(() => void (stick.current = true), []);
		React.useLayoutEffect(() => {
			const box = threadRef.current;
			if (!box || !first && !pending.length) return;
			const prev = before.current;
			if (prev.first !== void 0 && first !== prev.first && prev.height) box.scrollTop += box.scrollHeight - prev.height;
			else if (stick.current) box.scrollTop = box.scrollHeight;
			before.current = {
				first,
				height: box.scrollHeight
			};
		}, [
			first,
			last,
			pending.length,
			pendingState,
			thread?.loading
		]);
		let previousDay;
		let previousSender;
		const rows = [];
		for (const message of items) {
			const heading = !previousDay || !sameDay(previousDay, message.timestamp) ? dayLabel(message.timestamp, now) : "";
			if (heading) {
				rows.push(/* @__PURE__ */ React.createElement("div", {
					key: `day-${message.id}`,
					className: "mtb-day"
				}, heading));
				previousSender = void 0;
			}
			if (!Number.isNaN(Date.parse(message.timestamp))) previousDay = message.timestamp;
			rows.push(/* @__PURE__ */ React.createElement(Bubble, {
				key: message.id,
				message,
				showFrom: chat.type === "group" && previousSender !== message.senderID
			}));
			previousSender = message.senderID;
		}
		return /* @__PURE__ */ React.createElement("section", {
			className: "mtb-chat",
			"aria-label": chat.title
		}, /* @__PURE__ */ React.createElement("header", { className: "mtb-chat-head" }, /* @__PURE__ */ React.createElement(NetworkBadge, {
			network: chat.network,
			size: 32
		}), /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("h2", { className: "mtb-chat-name" }, chat.title), /* @__PURE__ */ React.createElement("div", { className: "mtb-chat-sub" }, chat.network, chat.type === "group" && chat.participants ? ` · ${chat.participants.total} people` : "")), /* @__PURE__ */ React.createElement("div", { className: "mtb-bar-end" }, /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-icon-button",
			"aria-label": "Close chat",
			title: "Close chat (Esc)",
			onClick: () => inbox.close()
		}, /* @__PURE__ */ React.createElement(CloseIcon, null)))), /* @__PURE__ */ React.createElement("div", {
			className: "mtb-thread",
			ref: threadRef,
			role: "log",
			"aria-label": "Messages",
			"aria-live": "polite",
			onScroll: (event) => {
				const box = event.currentTarget;
				stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
			}
		}, thread?.loading && /* @__PURE__ */ React.createElement("div", {
			className: "mtb-muted",
			role: "status"
		}, "Loading messages…"), thread?.hasMore && /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-more",
			disabled: thread.loadingEarlier,
			onClick: () => void inbox.loadEarlier()
		}, thread.loadingEarlier ? "Loading…" : "Load earlier messages"), thread?.failed && /* @__PURE__ */ React.createElement("div", {
			className: "mtb-msg-error",
			role: "alert"
		}, "Could not read this chat just now. Trying again."), thread && !thread.loading && !items.length && !pending.length && !thread.failed && /* @__PURE__ */ React.createElement("div", { className: "mtb-muted" }, "No messages yet."), rows, pending.map((send) => /* @__PURE__ */ React.createElement(PendingBubble, {
			key: send.key,
			send
		}))), /* @__PURE__ */ React.createElement(Composer, {
			chat,
			draft,
			onDraft,
			onSent,
			composerRef,
			focusList,
			focusNext
		}));
	});
	/** The list of chats. It draws only the rows in view; rows are one height, so where a row is, is arithmetic. */
	const ChatList = React.memo(function ChatList({ list, cursorId, openId, unsent, more, now, listRef, empty }) {
		const [view, setView] = React.useState({
			top: 0,
			height: 600
		});
		const frame = React.useRef(0);
		const latest = React.useRef(list);
		latest.current = list;
		const measure = React.useCallback(() => {
			const box = listRef.current;
			if (box) setView((was) => was.top === box.scrollTop && was.height === box.clientHeight ? was : {
				top: box.scrollTop,
				height: box.clientHeight
			});
		}, [listRef]);
		React.useEffect(() => {
			measure();
			const box = listRef.current;
			const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : void 0;
			if (box) observer?.observe(box);
			return () => {
				observer?.disconnect();
				if (frame.current) cancelAnimationFrame(frame.current);
				frame.current = 0;
			};
		}, [measure, listRef]);
		React.useLayoutEffect(() => {
			const box = listRef.current;
			const at = cursorId ? latest.current.findIndex((chat) => chat.id === cursorId) : -1;
			if (!box || at < 0) return;
			const next = scrollToReveal(at, box.scrollTop, box.clientHeight);
			if (next !== box.scrollTop) {
				box.scrollTop = next;
				measure();
			}
		}, [
			cursorId,
			listRef,
			measure
		]);
		const [start, end] = visibleRange(view.top, view.height, list.length);
		return /* @__PURE__ */ React.createElement("div", {
			ref: listRef,
			className: "mtb-list",
			role: "listbox",
			tabIndex: 0,
			"aria-label": "Chats",
			"aria-activedescendant": cursorId ? rowId(cursorId) : void 0,
			onScroll: () => {
				if (frame.current) return;
				frame.current = requestAnimationFrame(() => {
					frame.current = 0;
					measure();
				});
			}
		}, /* @__PURE__ */ React.createElement("div", {
			className: "mtb-list-inner",
			style: { height: contentHeight(list.length) }
		}, list.slice(start, end).map((chat, offset) => /* @__PURE__ */ React.createElement(Row, {
			key: chat.id,
			chat,
			cursor: chat.id === cursorId,
			open: chat.id === openId,
			unsent: unsent.has(chat.id),
			now,
			top: rowTop(start + offset),
			position: start + offset + 1,
			total: list.length
		}))), !list.length && /* @__PURE__ */ React.createElement("div", { className: "mtb-list-empty" }, empty), more && /* @__PURE__ */ React.createElement("div", { className: "mtb-list-foot" }, "Older chats are not listed."));
	});
	const unreadTotal = (chats) => chats.reduce((sum, chat) => sum + (chat.isMuted ? 0 : chat.unreadCount), 0);
	return function BeeperPage() {
		const state = React.useSyncExternalStore(inbox.subscribe, inbox.getState);
		const now = useNow();
		const listRef = React.useRef(null);
		const filterRef = React.useRef(null);
		const composerRef = React.useRef(null);
		const drafts = React.useRef(/* @__PURE__ */ new Map());
		const onDraft = React.useCallback((chatID, text) => void (text ? drafts.current.set(chatID, text) : drafts.current.delete(chatID)), []);
		const focusList = React.useCallback(() => listRef.current?.focus(), []);
		React.useEffect(() => {
			const visible = () => inbox.setActive(document.visibilityState === "visible");
			visible();
			const stop = inbox.start();
			document.addEventListener("visibilitychange", visible);
			return () => {
				document.removeEventListener("visibilitychange", visible);
				stop();
			};
		}, []);
		const stateRef = React.useRef(state);
		stateRef.current = state;
		const rootRef = React.useRef(null);
		const focusComposerNext = React.useRef(false);
		const focusedOnce = React.useRef(false);
		const ready = state.connection === "ready";
		React.useEffect(() => {
			if (!ready || focusedOnce.current) return;
			focusedOnce.current = true;
			const at = document.activeElement;
			if (!(at instanceof HTMLElement && (at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName))) && !rootRef.current?.contains(at) && !document.querySelector("[role=\"dialog\"]")) listRef.current?.focus({ preventScroll: true });
		}, [ready]);
		React.useEffect(() => {
			const onKey = (event) => {
				if (event.defaultPrevented || event.isComposing) return;
				if (document.querySelector("[role=\"dialog\"], [aria-modal=\"true\"]") || event.getModifierState?.("AltGraph")) return;
				const target = event.target instanceof HTMLElement ? event.target : null;
				const current = stateRef.current;
				if (target?.closest("[data-mtb=composer]")) return;
				if (target?.closest("[data-mtb=filter]")) {
					if (event.key === "Escape" || event.key === "Enter" || event.key === "ArrowDown") {
						event.preventDefault();
						if (event.key === "Escape" && current.filter) inbox.setFilter("");
						listRef.current?.focus();
					}
					return;
				}
				if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
				if (event.ctrlKey || event.metaKey || event.altKey) return;
				if (current.connection !== "ready") return;
				const used = () => event.preventDefault();
				switch (event.key) {
					case "j":
					case "ArrowDown":
						used();
						inbox.moveCursor(1);
						break;
					case "k":
					case "ArrowUp":
						used();
						inbox.moveCursor(-1);
						break;
					case "Enter":
						if (target?.closest("button, a")) break;
						if (current.cursorId) {
							used();
							if (current.openId === current.cursorId) composerRef.current?.focus();
							else {
								focusComposerNext.current = true;
								inbox.open(current.cursorId).finally(() => void (focusComposerNext.current = false));
							}
						}
						break;
					case "r":
						if (current.openId) {
							used();
							composerRef.current?.focus();
						}
						break;
					case "Escape":
						if (current.openId) {
							used();
							inbox.close();
							listRef.current?.focus();
						}
						break;
					case "/":
						used();
						filterRef.current?.focus();
						break;
					case "u":
						used();
						inbox.setUnreadOnly(!current.unreadOnly);
				}
			};
			window.addEventListener("keydown", onKey);
			return () => window.removeEventListener("keydown", onKey);
		}, []);
		const openChat = state.openId ? state.chats.find((chat) => chat.id === state.openId) : void 0;
		const openPending = React.useMemo(() => state.pending.filter((send) => send.chatID === state.openId), [state.pending, state.openId]);
		const unsent = React.useMemo(() => new Set(state.pending.filter((send) => send.status === "failed").map((send) => send.chatID)), [state.pending]);
		const total = unreadTotal(state.chats);
		return /* @__PURE__ */ React.createElement("div", {
			className: "mtb-root",
			"data-mtb": "root",
			ref: rootRef
		}, /* @__PURE__ */ React.createElement("header", { className: "mtb-bar" }, /* @__PURE__ */ React.createElement("h1", { className: "mtb-title" }, "Beeper"), state.connection === "ready" && total > 0 && /* @__PURE__ */ React.createElement("span", { className: "mtb-muted" }, total, " unread"), /* @__PURE__ */ React.createElement("div", { className: "mtb-bar-end" }, /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-icon-button",
			"aria-label": "Refresh",
			title: "Refresh",
			disabled: state.connection !== "ready",
			onClick: () => void inbox.refresh()
		}, /* @__PURE__ */ React.createElement(RefreshIcon, null)), /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-button",
			onClick: openSettings
		}, "Settings"))), state.stale && /* @__PURE__ */ React.createElement("div", {
			className: "mtb-banner",
			role: "status"
		}, "Beeper is not answering. Showing what was read a moment ago."), state.connection !== "ready" ? /* @__PURE__ */ React.createElement(Problem, {
			connection: state.connection,
			problem: state.problem,
			onRetry: () => void reloadToken().then(() => inbox.retry()),
			onSettings: openSettings
		}) : /* @__PURE__ */ React.createElement("div", { className: "mtb-main" }, /* @__PURE__ */ React.createElement("div", { className: "mtb-side" }, /* @__PURE__ */ React.createElement("div", { className: "mtb-tools" }, /* @__PURE__ */ React.createElement("input", {
			ref: filterRef,
			className: "mtb-input",
			"data-mtb": "filter",
			type: "search",
			"aria-label": "Filter chats",
			placeholder: "Filter chats  ( / )",
			value: state.filter,
			onChange: (event) => inbox.setFilter(event.target.value)
		}), /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-toggle",
			"aria-pressed": state.unreadOnly,
			title: "Show only unread chats (u)",
			onClick: () => inbox.setUnreadOnly(!state.unreadOnly)
		}, "Unread")), /* @__PURE__ */ React.createElement(ChatList, {
			list: state.list,
			cursorId: state.cursorId,
			openId: state.openId,
			unsent,
			more: state.moreChats,
			now,
			listRef,
			empty: state.chats.length ? "No chats match." : "No chats yet. Chats from your Beeper accounts show here."
		})), openChat ? /* @__PURE__ */ React.createElement(Pane, {
			key: openChat.id,
			chat: openChat,
			thread: state.thread,
			pending: openPending,
			now,
			draft: drafts.current.get(openChat.id) ?? "",
			onDraft,
			composerRef,
			focusList,
			focusNext: focusComposerNext
		}) : /* @__PURE__ */ React.createElement("div", { className: "mtb-empty" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", null, "Pick a chat to read it and reply."), /* @__PURE__ */ React.createElement("p", { className: "mtb-muted" }, "j and k move, Enter opens, Esc closes, / filters, u shows unread.")))));
	};
}
// src/ui/Settings.tsx
var TEXT = {
	unauthorized: "Beeper did not accept that token.",
	forbidden: "Beeper accepted the token but it is not allowed to read chats.",
	"bad-reply": "Beeper answered with something this plugin does not understand.",
	server: "Beeper Desktop reported an error."
};
function createSettingsCard({ config, client }) {
	return function BeeperSettings() {
		const saved = React.useSyncExternalStore(config.subscribe, () => config.hasToken());
		const place = React.useSyncExternalStore(config.subscribe, () => config.place());
		const address = React.useSyncExternalStore(config.subscribe, () => config.baseUrl());
		const keychain = config.keychainAvailable();
		const [draft, setDraft] = React.useState("");
		const [replacing, setReplacing] = React.useState(false);
		const [addressDraft, setAddressDraft] = React.useState(void 0);
		const [status, setStatus] = React.useState({ kind: "idle" });
		const [byHand, setByHand] = React.useState(false);
		const alive = React.useRef(true);
		React.useEffect(() => {
			alive.current = true;
			return () => {
				alive.current = false;
			};
		}, []);
		/** Asks Beeper; `candidate` tries a token that is not saved yet. Returns the kind of failure, if any. */
		const check = async (candidate) => {
			setStatus({ kind: "checking" });
			try {
				const info = await client.probe(candidate);
				if (alive.current) setStatus({
					kind: "ok",
					text: `Connected to ${info.app.name} ${info.app.version}.`
				});
				return "ok";
			} catch (error) {
				const kind = error instanceof BeeperError ? error.kind : "bad-reply";
				let text = TEXT[kind] ?? (error instanceof BeeperError ? error.message : "Something went wrong talking to Beeper.");
				if (kind === "unreachable") {
					const found = await client.diagnose().catch(() => "unreachable");
					text = found === "curl-missing" ? "The curl program was not found on this computer. This plugin needs it to reach Beeper." : found === "unreachable" ? "Beeper Desktop did not answer. Open it and turn on Settings, Developers, Beeper Desktop API." : "Beeper Desktop is running, but its answer was too slow or too large to use.";
				}
				if (alive.current) setStatus({
					kind: "error",
					text
				});
				return kind;
			}
		};
		/** What a save does first: the token is checked as a token, then Beeper is asked, so a mistyped replacement never costs the one that works. */
		const accepted = async () => {
			const checked = checkToken(draft);
			if (!checked.ok) {
				setStatus({
					kind: "error",
					text: checked.message
				});
				return;
			}
			const verdict = await check(checked.value);
			return verdict === "unauthorized" || verdict === "forbidden" ? void 0 : checked.value;
		};
		const saveToKeychain = async (event) => {
			event?.preventDefault();
			const value = await accepted();
			if (value === void 0) return;
			setByHand(false);
			if (await config.saveToKeychain(value)) {
				setDraft("");
				setReplacing(false);
			} else if (alive.current) {
				setByHand(true);
				setStatus({
					kind: "error",
					text: "The Keychain would not take the token from here, and it has not been kept anywhere."
				});
			}
		};
		const saveToProfile = async (event) => {
			event?.preventDefault();
			const value = await accepted();
			if (value === void 0) return;
			setByHand(false);
			try {
				await config.saveToProfile(value);
			} catch {
				setStatus({
					kind: "error",
					text: "This app could not store the token."
				});
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
				setStatus({
					kind: "ok",
					text: "Found the token in your Keychain."
				});
			} else setStatus({
				kind: "error",
				text: "Nothing in the Keychain yet. Run the command in Terminal, type the token at the prompt, then check again."
			});
		};
		const move = async () => {
			setStatus({ kind: "checking" });
			const moved = await config.moveToKeychain();
			if (alive.current) setStatus(moved ? {
				kind: "ok",
				text: "Moved to your Keychain. The copy in this app's profile is gone."
			} : {
				kind: "error",
				text: "The Keychain would not take the token from here. It is still in this app's profile."
			});
		};
		const remove = async () => {
			const gone = await config.clearToken();
			if (!alive.current) return;
			setStatus(gone ? { kind: "idle" } : {
				kind: "error",
				text: "The Keychain would not give the token up. Remove it in Keychain Access (search for buzz-beeper)."
			});
			setReplacing(false);
			setByHand(false);
			setDraft("");
		};
		const saveAddress = (event) => {
			event.preventDefault();
			const checked = checkBaseUrl(addressDraft ?? "");
			if (!checked.ok) {
				setStatus({
					kind: "error",
					text: checked.message
				});
				return;
			}
			config.saveBaseUrl(checked.value === "http://127.0.0.1:23373" ? void 0 : checked.value);
			setAddressDraft(void 0);
			setStatus({
				kind: "ok",
				text: `Using ${checked.value}.`
			});
		};
		const showInput = !saved || replacing;
		const busy = status.kind === "checking";
		return /* @__PURE__ */ React.createElement("section", {
			className: "mtb-root mtb-settings",
			"aria-label": "Beeper"
		}, /* @__PURE__ */ React.createElement("p", null, "Shows your Beeper chats as an inbox and lets you reply. It talks only to Beeper Desktop on this computer, using an access token you make there. Your messages are not sent anywhere else."), saved && !replacing && /* @__PURE__ */ React.createElement("p", { "data-place": place }, place === "keychain" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("strong", null, "Token saved in your Keychain."), " It is not shown again.") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("strong", null, "Token saved in this app's profile, as plain text."), " It is not shown again, but any other plugin you install could read it.")), showInput && /* @__PURE__ */ React.createElement("form", {
			onSubmit: (event) => void (keychain ? saveToKeychain(event) : saveToProfile(event)),
			className: "mtb-form"
		}, /* @__PURE__ */ React.createElement("label", { htmlFor: "mtb-token" }, "Beeper access token"), /* @__PURE__ */ React.createElement("input", {
			id: "mtb-token",
			className: "mtb-input",
			type: "password",
			autoComplete: "off",
			autoCorrect: "off",
			autoCapitalize: "off",
			spellCheck: false,
			value: draft,
			placeholder: "Paste your access token",
			onChange: (event) => setDraft(event.target.value)
		}), /* @__PURE__ */ React.createElement("div", { className: "mtb-actions" }, /* @__PURE__ */ React.createElement("button", {
			type: "submit",
			className: "mtb-button",
			"data-primary": "",
			disabled: busy
		}, keychain ? "Save to Keychain" : "Save token"), keychain && /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-button",
			disabled: busy,
			onClick: () => void saveToProfile()
		}, "Keep it in this app's profile instead"), replacing && /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-button",
			onClick: () => (setReplacing(false), setDraft(""), setByHand(false))
		}, "Cancel")), /* @__PURE__ */ React.createElement("p", { className: "mtb-muted" }, keychain ? "Your Keychain is the safe place. The profile copy is plain text that any other plugin you install could read." : "On this system the token is kept in this app's profile, as plain text. Any other plugin you install could read it: install only plugins you trust.")), byHand && /* @__PURE__ */ React.createElement("div", {
			role: "group",
			"aria-label": "Save the token in the Keychain by hand",
			className: "mtb-form"
		}, /* @__PURE__ */ React.createElement("p", null, "To put it in the Keychain yourself, run this in Terminal. It asks for the token (twice, showing nothing as you type), so the token is not in the command:"), /* @__PURE__ */ React.createElement("code", { className: "mtb-code" }, "security add-generic-password -U -s buzz-beeper -a beeper -w"), /* @__PURE__ */ React.createElement("div", { className: "mtb-actions" }, /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-button",
			onClick: () => void checkKeychain()
		}, "Check Keychain"))), saved && !replacing && /* @__PURE__ */ React.createElement("div", { className: "mtb-actions" }, /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-button",
			disabled: busy,
			onClick: () => void check()
		}, "Test connection"), keychain && place === "profile" && /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-button",
			"data-primary": "",
			disabled: busy,
			onClick: () => void move()
		}, "Move to Keychain"), /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-button",
			onClick: () => setReplacing(true)
		}, "Replace token"), /* @__PURE__ */ React.createElement("button", {
			type: "button",
			className: "mtb-button",
			onClick: () => void remove()
		}, "Remove token")), status.kind !== "idle" && /* @__PURE__ */ React.createElement("p", {
			role: status.kind === "error" ? "alert" : "status",
			"data-tone": status.kind === "error" ? "error" : void 0
		}, status.kind === "checking" ? "Asking Beeper…" : status.text), /* @__PURE__ */ React.createElement("p", { className: "mtb-muted" }, "Make a token in Beeper Desktop: Settings, then Developers. Turn on Beeper Desktop API, then under Approved connections press + and follow the steps."), /* @__PURE__ */ React.createElement("details", null, /* @__PURE__ */ React.createElement("summary", null, "Address"), /* @__PURE__ */ React.createElement("form", {
			onSubmit: saveAddress,
			className: "mtb-form"
		}, /* @__PURE__ */ React.createElement("label", { htmlFor: "mtb-address" }, "Where Beeper Desktop listens"), /* @__PURE__ */ React.createElement("input", {
			id: "mtb-address",
			className: "mtb-input",
			type: "text",
			autoComplete: "off",
			spellCheck: false,
			value: addressDraft ?? address,
			onChange: (event) => setAddressDraft(event.target.value)
		}), /* @__PURE__ */ React.createElement("p", { className: "mtb-muted" }, "Only this computer is allowed: http://127.0.0.1 or http://localhost, with the port. The default is ", DEFAULT_BASE_URL, "."), /* @__PURE__ */ React.createElement("div", { className: "mtb-actions" }, /* @__PURE__ */ React.createElement("button", {
			type: "submit",
			className: "mtb-button",
			disabled: addressDraft === void 0
		}, "Save address")))));
	};
}
// src/ui/styles.ts
var CSS$1 = `
.mtb-root {
  --mtb-accent: var(--accent-9, #3e63dd);
  --mtb-ink: var(--text-standard, #e9eef4);
  --mtb-muted: var(--text-metadata, #8290a0);
  --mtb-bg: var(--surface-base, #0b0d11);
  --mtb-panel: var(--surface-panel, #12161c);
  --mtb-line: var(--border-standard, #2b333d);
  --mtb-hover: var(--affordance-row-hover, rgba(128, 140, 160, 0.14));
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--mtb-bg);
  color: var(--mtb-ink);
  font-size: 13px;
  line-height: 1.4;
}
.mtb-root *, .mtb-root *::before, .mtb-root *::after { box-sizing: border-box; }
.mtb-root :focus-visible { outline: 2px solid var(--border-focus, var(--mtb-accent)); outline-offset: -2px; }
.mtb-muted { color: var(--mtb-muted); }
.mtb-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.mtb-button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid var(--mtb-line);
  border-radius: 6px; background: transparent; color: var(--mtb-ink); font: inherit; font-weight: 500; cursor: pointer; }
.mtb-button:hover:not(:disabled) { background: var(--mtb-hover); }
.mtb-button[data-primary] { border-color: var(--mtb-accent); background: color-mix(in srgb, var(--mtb-accent) 14%, transparent); font-weight: 600; }
.mtb-button:disabled { opacity: 0.5; cursor: default; }
.mtb-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0;
  border: 0; border-radius: 6px; background: transparent; color: var(--mtb-muted); cursor: pointer; }
.mtb-icon-button:hover:not(:disabled) { background: var(--mtb-hover); color: var(--mtb-ink); }
.mtb-icon-button:disabled { opacity: 0.4; cursor: default; }
.mtb-input { height: 28px; padding: 0 8px; border: 1px solid var(--mtb-line); border-radius: 6px; background: var(--mtb-panel);
  color: var(--mtb-ink); font: inherit; color-scheme: inherit; }
.mtb-badge { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; color: #fff; font-weight: 600; flex: none; }

/* header */
.mtb-bar { display: flex; align-items: center; gap: 12px; flex: none; min-height: 44px; padding: 6px 16px; border-bottom: 1px solid var(--mtb-line); }
.mtb-title { margin: 0; font-size: 14px; font-weight: 600; }
.mtb-bar-end { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.mtb-banner { flex: none; padding: 6px 16px; border-bottom: 1px solid var(--mtb-line); background: color-mix(in srgb, var(--amber-9, #f5a524) 14%, transparent); }

/* states */
.mtb-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; color: var(--mtb-muted); text-align: center; }
.mtb-panel { max-width: 460px; padding: 20px 22px; border: 1px solid var(--mtb-line); border-top: 2px solid var(--mtb-accent);
  border-radius: 6px; background: var(--mtb-panel); color: var(--mtb-ink); display: flex; flex-direction: column; align-items: flex-start; gap: 10px; text-align: left; }
.mtb-panel h2 { margin: 0; font-size: 15px; }
.mtb-panel p, .mtb-panel ol { margin: 0; }
.mtb-panel ol { padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
.mtb-actions { display: flex; flex-wrap: wrap; gap: 8px; }

/* split */
.mtb-main { flex: 1; min-height: 0; display: flex; }
.mtb-side { flex: 0 0 320px; width: 320px; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--mtb-line); }
.mtb-tools { display: flex; gap: 6px; padding: 8px 10px; flex: none; border-bottom: 1px solid var(--mtb-line); }
.mtb-tools .mtb-input { flex: 1; min-width: 0; }
.mtb-toggle { height: 28px; padding: 0 10px; border: 1px solid var(--mtb-line); border-radius: 6px; background: transparent; color: var(--mtb-muted); font: inherit; cursor: pointer; }
.mtb-toggle[aria-pressed="true"] { border-color: var(--mtb-accent); color: var(--mtb-accent); }
.mtb-list { position: relative; flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 0; outline: none; }
.mtb-list-inner { position: relative; }
/* The list as a whole takes the keys; what shows it is the highlighted row, not a ring round everything. */
.mtb-root .mtb-list:focus-visible { outline: none; }
.mtb-root .mtb-list:focus-visible .mtb-row[data-cursor] { box-shadow: 0 0 0 2px var(--border-focus, var(--mtb-accent)); }
.mtb-list-foot { padding: 10px 14px 14px; color: var(--mtb-muted); font-size: 12px; }
.mtb-list-empty { padding: 20px 14px; color: var(--mtb-muted); }

/* a chat row */
.mtb-row { position: absolute; left: 4px; right: 4px; height: 56px; display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 0; border-radius: 6px;
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.mtb-row:hover { background: var(--mtb-hover); }
.mtb-row[data-cursor] { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mtb-accent) 60%, transparent); }
.mtb-row[data-open] { background: color-mix(in srgb, var(--mtb-accent) 16%, transparent); }
.mtb-row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.mtb-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mtb-row[data-unread] .mtb-row-name { font-weight: 700; }
.mtb-row-meta { display: flex; align-items: center; gap: 4px; color: var(--mtb-muted); font-size: 12px; white-space: nowrap; overflow: hidden; }
.mtb-row-end { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; color: var(--mtb-muted); font-size: 12px; }
.mtb-unsent { color: var(--red-11, #e5484d); font-weight: 600; }
.mtb-unread { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--mtb-accent); color: var(--text-on-accent, #fff); font-size: 12px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center; }
.mtb-unread[data-muted] { background: var(--mtb-muted); }

/* a chat */
.mtb-chat { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.mtb-chat-head { display: flex; align-items: center; gap: 10px; flex: none; min-height: 52px; padding: 6px 16px; border-bottom: 1px solid var(--mtb-line); }
.mtb-chat-name { margin: 0; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mtb-chat-sub { color: var(--mtb-muted); font-size: 12px; }
.mtb-thread { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 4px; }
.mtb-day { align-self: center; margin: 10px 0 4px; padding: 2px 10px; border-radius: 10px; background: var(--mtb-hover); color: var(--mtb-muted); font-size: 12px; }
.mtb-msg { max-width: min(560px, 80%); align-self: flex-start; padding: 6px 10px; border-radius: 10px; background: var(--surface-message, var(--mtb-panel)); border: 1px solid var(--mtb-line); }
.mtb-msg[data-mine] { align-self: flex-end; background: var(--surface-message-own, color-mix(in srgb, var(--mtb-accent) 20%, var(--mtb-panel))); color: var(--text-message-own, var(--mtb-ink)); border-color: transparent; }
.mtb-msg[data-mine] .mtb-msg-meta, .mtb-msg[data-mine] .mtb-msg-media { color: inherit; opacity: 0.8; }
.mtb-msg[data-notice] { align-self: center; background: transparent; border-style: dashed; color: var(--mtb-muted); font-style: italic; }
.mtb-msg[data-pending] { opacity: 0.7; }
.mtb-msg[data-failed] { border-color: var(--red-9, #e5484d); opacity: 1; }
.mtb-msg-from { font-size: 12px; font-weight: 600; color: var(--mtb-muted); }
.mtb-msg-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.mtb-msg-media { color: var(--mtb-muted); font-style: italic; }
.mtb-msg-meta { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; font-size: 11px; color: var(--mtb-muted); }
.mtb-msg-error { color: var(--red-11, #e5484d); font-size: 12px; margin-top: 2px; }
.mtb-more { align-self: center; padding: 4px 12px; border: 1px solid var(--mtb-line); border-radius: 6px; background: transparent; color: var(--mtb-ink); font: inherit; cursor: pointer; }
.mtb-more:hover:not(:disabled) { background: var(--mtb-hover); }
.mtb-composer { flex: none; display: flex; align-items: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--mtb-line); }
.mtb-composer textarea { flex: 1; field-sizing: content; min-height: 34px; max-height: 160px; resize: none; padding: 7px 10px; border: 1px solid var(--mtb-line); border-radius: 8px;
  background: var(--mtb-panel); color: var(--mtb-ink); font: inherit; color-scheme: inherit; }
.mtb-composer-note { flex: none; padding: 0 16px 8px; color: var(--mtb-muted); font-size: 12px; }
.mtb-composer-note[data-tone="error"] { color: var(--red-11, #e5484d); }

/* settings card */
.mtb-settings { height: auto; background: transparent; display: flex; flex-direction: column; gap: 12px; max-width: 560px; padding: 0; }
.mtb-settings p { margin: 0; }
.mtb-settings [data-tone="error"] { color: var(--red-11, #e5484d); }
.mtb-form { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.mtb-form .mtb-input { width: 100%; max-width: 420px; height: 32px; }
.mtb-code { display: block; padding: 8px 10px; border: 1px solid var(--mtb-line); border-radius: 6px; background: var(--mtb-panel); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; user-select: all; -webkit-user-select: all; }
.mtb-settings details summary { cursor: pointer; color: var(--mtb-muted); }
@media (max-width: 720px) { .mtb-side { flex-basis: 240px; width: 240px; } }
@media (prefers-reduced-motion: reduce) { .mtb-root * { transition: none !important; animation: none !important; } }
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
	const mac = /^Mac/i.test(navigator.platform ?? "") || /Macintosh/.test(navigator.userAgent ?? "");
	const config = createConfigStore(window.localStorage, {
		keychain: mac,
		run: (command, input) => ctx.host.runCommand(command, input)
	});
	const client = createClient({
		run: (command, input) => ctx.host.runCommand(command, input),
		token: () => config.token(),
		baseUrl: () => config.baseUrl()
	});
	const inbox = createInbox({
		client,
		hasToken: () => config.hasToken(),
		ready: config.ready
	});
	ctx.effect(() => {
		const style = document.createElement("style");
		style.dataset.megatechBeeper = "";
		style.textContent = CSS$1;
		document.head.append(style);
		const unsubscribe = config.subscribe(() => inbox.reset());
		return () => {
			unsubscribe();
			style.remove();
		};
	});
	const openSettings = () => {
		ctx.navigation.open({
			version: 1,
			kind: "settings",
			section: "megatech.beeper/settings"
		}).catch(() => {});
	};
	ctx.pages.register({
		id: "inbox",
		title: "Beeper",
		primary: true,
		layout: "workspace",
		icon: PAGE_ICON,
		component: createInboxPage({
			inbox,
			openSettings,
			reloadToken: config.reload
		})
	});
	ctx.settingsCards.register({
		id: "settings",
		title: "Beeper",
		group: "Plugins",
		component: createSettingsCard({
			config,
			client
		})
	});
}
export { apply, inject };
