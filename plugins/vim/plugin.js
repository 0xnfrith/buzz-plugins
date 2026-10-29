// src/ctx.ts
var ctx;
var setContext = (next) => {
	ctx = next;
};
// src/constants.ts
var STORAGE_KEY = "megatech.vim-mode.settings.v2";
var OLD_STORAGE_KEY = "megatech.vim-mode.settings.v1";
var SETTING_KEYS = [
	"enabled",
	"statusLine",
	"composerNormal",
	"leader",
	"perf"
];
var PERF_LEVELS = [
	{
		id: "",
		label: "Off"
	},
	{
		id: "paint",
		label: "Key to paint"
	},
	{
		id: "full",
		label: "Full (every handler and DOM call)"
	}
];
var PENDING_MS = 1500;
var apple = /Mac|iPhone|iPad/.test(navigator.platform);
var LEADERS = {
	space: {
		label: "Space",
		key: " "
	},
	"ctrl-w": {
		label: "Ctrl-w",
		key: "w",
		ctrl: true,
		mac: true
	},
	"ctrl-b": {
		label: "Ctrl-b",
		key: "b",
		ctrl: true
	},
	"ctrl-space": {
		label: "Ctrl-Space",
		key: " ",
		ctrl: true
	},
	comma: {
		label: "Comma ( , )",
		key: ",",
		show: ","
	},
	backslash: {
		label: "Backslash ( \\ )",
		key: "\\",
		show: "\\"
	}
};
var ACCENT = "var(--accent-9, #e5a50a)";
var FOCUS_RING = "var(--border-focus, #1d1d1f)";
var mix = (colour, percent) => `color-mix(in srgb, ${colour} ${percent}%, transparent)`;
var MAIN = "[data-main-workspace], [data-solo-focus-pane]";
var SIDE = "[data-panel-workspace]";
var SIDEBAR_ROW = "[data-sidebar-section] button[data-channel-id]";
var SCROLLER = "[data-message-scroller]";
var MESSAGE = "[data-message-id]";
var COMPOSER = "[data-tab-focus]:is([role=\"textbox\"], input, textarea)";
var POPUP = "[role=\"menu\"], [role=\"listbox\"], [role=\"combobox\"], [role=\"dialog\"], [aria-modal=\"true\"], .xterm";
var COMMUNITY_TRIGGER = "nav[aria-label=\"Communities\"] button[aria-label^=\"Community switcher\"]";
var COMMUNITY_POPUP = "[role=\"dialog\"][aria-label=\"Switch community\"]";
var PANE_HANDLE = "hr[aria-label=\"Resize main and secondary panels\"]";
var PANE_TOGGLE = "[data-tab-pane-toggle]";
var BRANCH = "[data-depth]";
var BRANCH_PILL = "button[data-thread-summary][aria-controls]";
var FOLD_ATTR = "data-vim-fold";
// src/perf.ts
var RING = 5e3;
var MODIFIERS = /* @__PURE__ */ new Set([
	"Shift",
	"Control",
	"Alt",
	"Meta"
]);
var APIS = [
	["Element", "querySelectorAll"],
	["Document", "querySelectorAll"],
	["Element", "closest"],
	["Element", "getBoundingClientRect"],
	["Element", "getClientRects"],
	["Selection", "modify"],
	["Selection", "toString"],
	["Element", "scrollIntoView"],
	["HTMLElement", "focus"]
];
var level = "";
var current = "";
var cleanup = [];
var paint = [];
var lag = [];
var handlers = {};
var counters = {};
var host = {};
var hostMs = {};
var keep = (list, entry) => {
	list.push(entry);
	if (list.length > RING) list.shift();
};
var round = (x) => Math.round(x * 100) / 100;
var stat = (name) => handlers[name] ??= {
	n: 0,
	ms: 0,
	max: 0,
	api: {},
	apiMs: {}
};
var timed = (name, fn) => function(...args) {
	if (level !== "full") return fn.apply(this, args);
	const outer = current;
	current = name;
	const t0 = performance.now();
	try {
		return fn.apply(this, args);
	} finally {
		const ms = performance.now() - t0;
		current = outer;
		const entry = stat(name);
		entry.n++;
		entry.ms += ms;
		if (ms > entry.max) entry.max = ms;
	}
};
var count = (name, n = 1) => {
	if (level) counters[name] = (counters[name] ?? 0) + n;
};
var active = () => level !== "";
var quantiles = (values) => {
	if (!values.length) return { n: 0 };
	const sorted = [...values].sort((a, b) => a - b);
	const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
	return {
		n: sorted.length,
		median: round(at(.5)),
		p95: round(at(.95)),
		max: round(sorted[sorted.length - 1]),
		mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
	};
};
var pageCounts = () => ({
	nodes: document.getElementsByTagName("*").length,
	messageRows: document.querySelectorAll(MESSAGE).length,
	images: document.images.length,
	styleSheets: document.styleSheets.length,
	iframes: document.querySelectorAll("iframe").length,
	canvases: document.querySelectorAll("canvas").length,
	media: document.querySelectorAll("video, audio").length,
	threadTabs: document.querySelectorAll("[data-panel-workspace] [role=\"tab\"]").length,
	jsHeapMB: performance.memory ? round(performance.memory.usedJSHeapSize / 1048576) : null
});
var summary = () => {
	const byKey = {};
	for (const [key, ms] of paint) (byKey[key] ??= []).push(ms);
	return {
		level,
		at: (/* @__PURE__ */ new Date()).toISOString(),
		agent: navigator.userAgent,
		paint: quantiles(paint.map(([, ms]) => ms)),
		paintByKey: Object.fromEntries(Object.entries(byKey).map(([key, list]) => [key, quantiles(list)])),
		lag: quantiles(lag),
		handlers: Object.fromEntries(Object.entries(handlers).sort((a, b) => b[1].ms - a[1].ms).map(([name, h]) => [name, {
			n: h.n,
			ms: round(h.ms),
			max: round(h.max),
			api: h.api,
			apiMs: Object.fromEntries(Object.entries(h.apiMs).map(([label, ms]) => [label, round(ms)]))
		}])),
		revisions: window.__vimRevisions,
		page: pageCounts(),
		host,
		hostMs: Object.fromEntries(Object.entries(hostMs).map(([label, ms]) => [label, round(ms)])),
		counters,
		samples: paint
	};
};
var reset = () => {
	paint = [];
	lag = [];
	handlers = {};
	counters = {};
	host = {};
	for (const label of Object.keys(hostMs)) delete hostMs[label];
};
var copyText = (text) => {
	const box = document.createElement("textarea");
	box.value = text;
	Object.assign(box.style, {
		position: "fixed",
		left: "-9999px",
		top: "0"
	});
	document.body.append(box);
	const was = document.activeElement;
	box.select();
	let ok = false;
	try {
		ok = document.execCommand("copy");
	} catch {}
	box.remove();
	was?.focus?.({ preventScroll: true });
	return ok;
};
var dump = () => {
	const text = JSON.stringify(summary());
	copyText(text);
	return text;
};
var stop = () => {
	for (const undo of cleanup.splice(0)) undo();
	delete window.__vimPerf;
	level = "";
};
var start = (next) => {
	stop();
	if (!next) return;
	level = next;
	const onKey = (event) => {
		if (MODIFIERS.has(event.key)) return;
		const t0 = performance.now();
		window.requestAnimationFrame(() => {
			const channel = new MessageChannel();
			channel.port1.onmessage = () => {
				keep(paint, [event.key, round(performance.now() - t0)]);
				channel.port1.close();
			};
			channel.port2.postMessage(0);
		});
	};
	window.addEventListener("keydown", onKey, true);
	cleanup.push(() => window.removeEventListener("keydown", onKey, true));
	const onChord = (event) => {
		if (!event.ctrlKey || !event.altKey || !event.shiftKey) return;
		if (event.code === "KeyP") dump();
		else if (event.code === "KeyR") reset();
		else return;
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	document.addEventListener("keydown", onChord, true);
	cleanup.push(() => document.removeEventListener("keydown", onChord, true));
	let last = performance.now();
	const tick = setInterval(() => {
		const now = performance.now();
		keep(lag, round(now - last - 1e3));
		last = now;
	}, 1e3);
	cleanup.push(() => clearInterval(tick));
	if (next === "full") for (const [owner, name] of APIS) {
		const proto = window[owner].prototype;
		const original = proto[name];
		const label = `${owner}.${name}`;
		const wrapper = function(...args) {
			const entry = current ? stat(current) : void 0;
			const bucket = entry ? entry.api : host;
			const times = entry ? entry.apiMs : hostMs;
			bucket[label] = (bucket[label] ?? 0) + 1;
			const t0 = performance.now();
			try {
				return original.apply(this, args);
			} finally {
				times[label] = (times[label] ?? 0) + (performance.now() - t0);
			}
		};
		proto[name] = wrapper;
		cleanup.push(() => {
			if (proto[name] === wrapper) proto[name] = original;
		});
	}
	window.__vimPerf = {
		dump: () => JSON.parse(dump()),
		summary,
		reset,
		level: () => level
	};
};
// src/state.ts
var read = (key, names) => {
	try {
		const saved = JSON.parse(localStorage.getItem(key) || "{}");
		const valid = (name) => name === "leader" ? Object.hasOwn(LEADERS, saved.leader) : name === "perf" ? PERF_LEVELS.some((entry) => entry.id === saved.perf) : typeof saved[name] === "boolean";
		return Object.fromEntries(names.filter(valid).map((name) => [name, saved[name]]));
	} catch {
		return {};
	}
};
var load = () => ({
	...read(OLD_STORAGE_KEY, ["enabled", "statusLine"]),
	...read(STORAGE_KEY, SETTING_KEYS)
});
var initialState = () => Object.freeze({
	enabled: true,
	statusLine: true,
	composerNormal: true,
	mode: "normal",
	textMode: "insert",
	visual: "",
	region: "main",
	count: 0,
	operator: "",
	prefix: "",
	leader: apple ? "ctrl-w" : "space",
	perf: "",
	...load()
});
var state = initialState();
var listeners = /* @__PURE__ */ new Set();
var resetState = () => {
	state = initialState();
	listeners.clear();
	disposed = false;
};
var subscribe = (listener) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
var set = (patch) => {
	if (active()) {
		count("set");
		if (Object.keys(patch).every((name) => state[name] === patch[name])) count("set, nothing changed");
		count("set, listeners called", listeners.size);
	}
	state = Object.freeze({
		...state,
		...patch
	});
	for (const listener of [...listeners]) listener();
};
var setQuietly = (patch) => {
	state = Object.freeze({
		...state,
		...patch
	});
};
var setting = (patch) => {
	set(patch);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			...read(STORAGE_KEY, SETTING_KEYS),
			...patch
		}));
	} catch {}
};
var disposed = false;
var dispose = () => {
	disposed = true;
	clearTimeout(pendingTimer);
};
var keyEpoch = 0;
var bumpKeyEpoch = () => void keyEpoch++;
var onAnyKey = (event) => {
	if (!event.repeat) bumpKeyEpoch();
};
var pendingTimer;
var armPending = () => {
	clearTimeout(pendingTimer);
	pendingTimer = setTimeout(clearPending, PENDING_MS);
};
function clearPending() {
	clearTimeout(pendingTimer);
	if (state.count || state.operator || state.prefix) set({
		count: 0,
		operator: "",
		prefix: ""
	});
}
var takeCount = () => {
	const n = Math.max(1, state.count);
	clearPending();
	return n;
};
// src/dom.ts
var clamp = (n, low, high) => Math.max(low, Math.min(high, n));
var visible = (el) => !!el && el.getClientRects().length > 0 && !el.closest("[hidden], [inert], [aria-hidden=\"true\"]");
var isEditable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.getAttribute?.("role") === "textbox");
var inComposer = (el) => !!el?.closest?.("[data-tab-focus]");
var regionOf = (el) => !el?.closest ? void 0 : el.closest("[data-sidebar-section], [data-channel-sidebar-row]") ? "sidebar" : el.closest("[data-panel-workspace]") ? "side" : el.closest("[data-main-workspace], [data-solo-focus-pane]") ? "main" : void 0;
var workspaces = (region) => [...document.querySelectorAll(region === "side" ? SIDE : MAIN)].filter(visible);
var timelineOf = (region) => {
	for (const workspace of workspaces(region)) {
		const scroller = [...workspace.querySelectorAll(SCROLLER)].find(visible);
		if (scroller) return scroller;
	}
	return region === "side" ? void 0 : [...document.querySelectorAll(SCROLLER)].find(visible);
};
var activeTimeline = () => timelineOf(state.region === "side" ? "side" : "main") ?? timelineOf("main");
var composerOf = (region) => {
	for (const workspace of workspaces(region === "side" ? "side" : "main")) {
		const composer = [...workspace.querySelectorAll(COMPOSER)].find((box) => visible(box) && !box.matches("[aria-disabled=\"true\"], [disabled], [readonly], [contenteditable=\"false\"]"));
		if (composer) return composer;
	}
};
var channelRows = () => [...document.querySelectorAll(SIDEBAR_ROW)].filter(visible);
var selectedRow = () => channelRows().find((row) => row.getAttribute("aria-current") === "page");
var rowsOf = timed("rowsOf", (scroller) => [...scroller.querySelectorAll(MESSAGE)].filter((row) => !row.hasAttribute("data-membership-row") && !row.parentElement?.closest("[data-message-id]") && visible(row)));
var inView = (scroller, row) => {
	const box = scroller.getBoundingClientRect();
	const rect = row.getBoundingClientRect();
	return rect.bottom > box.top && rect.top < box.bottom;
};
var afterLayout = (fn) => requestAnimationFrame(() => requestAnimationFrame(() => {
	if (!disposed) fn();
}));
var nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
var focusEl = (el) => {
	if (!el) return false;
	el.focus({ preventScroll: true });
	el.scrollIntoView?.({ block: "nearest" });
	return document.activeElement === el;
};
var contextOk = () => !document.activeElement?.closest?.(POPUP);
var settle = (probe, ms = 1500) => new Promise((resolve) => {
	const started = performance.now();
	const tick = () => {
		const found = disposed ? void 0 : probe();
		if (found || disposed || performance.now() - started > ms) resolve(found || void 0);
		else requestAnimationFrame(tick);
	};
	tick();
});
var boxHasKeys = () => isEditable(document.activeElement) && inComposer(document.activeElement);
// src/caret.ts
var peek = (selection, direction) => {
	const { anchorNode, anchorOffset } = selection;
	selection.modify("extend", direction, "character");
	const adjacent = selection.toString() || (chipCrossed(selection) ? "￼" : "");
	selection.collapse(anchorNode, anchorOffset);
	return adjacent;
};
var chipCrossed = (selection) => {
	if (selection.isCollapsed || !selection.anchorNode) return false;
	const node = selection.anchorNode;
	const box = (node.nodeType === 1 ? node : node.parentElement)?.closest("[contenteditable=\"true\"]");
	return !!box && [...box.querySelectorAll("[contenteditable=\"false\"]")].some((island) => selection.containsNode(island, true));
};
var here = (selection) => peek(selection, "forward");
var prev = (selection) => peek(selection, "backward");
var isBreak = (c) => /^\n+$/.test(c);
var forward = (selection) => selection.modify("move", "forward", "character");
var backward = (selection) => selection.modify("move", "backward", "character");
var WORD_CHAR = /[\p{L}\p{N}_]/u;
var kind = (c, big) => c === "" ? -1 : /^\s+$/.test(c) ? 0 : big || WORD_CHAR.test(c) ? 1 : 2;
var onEmptyLine = (selection) => {
	const under = here(selection);
	const before = prev(selection);
	return (under === "" || isBreak(under)) && (before === "" || isBreak(before));
};
var LIMIT = 5e3;
var times = (n, run) => {
	for (let i = 0; i < n; i++) run(i);
};
var gap = (selection) => {
	const range = document.createRange();
	range.setStart(selection.focusNode, selection.focusOffset);
	return range;
};
var goto = (selection, range) => selection.collapse(range.startContainer, range.startOffset);
var charUnder = (selection) => {
	const next = peek(selection, "forward");
	return isBreak(next) ? "" : next;
};
var stepRight = (selection) => {
	if (charUnder(selection)) selection.modify("move", "forward", "character");
};
var clampCursor = (selection) => {
	if (!charUnder(selection)) {
		const before = peek(selection, "backward");
		if (before !== "" && !isBreak(before)) selection.modify("move", "backward", "character");
	}
	keepOutOfIslands(selection);
};
var islandOf = (node) => {
	let found;
	for (let el = node && (node.nodeType === 1 ? node : node.parentElement); el; el = el.parentElement) {
		if (el.getAttribute("contenteditable") === "true") break;
		if (el.getAttribute("contenteditable") === "false") found = el;
	}
	return found;
};
var besideIsland = (island, after) => {
	const parent = island.parentNode;
	return [parent, [...parent.childNodes].indexOf(island) + (after ? 1 : 0)];
};
var keepOutOfIslands = (selection, after = false) => {
	if (!selection.isCollapsed || !selection.anchorNode) return;
	const island = islandOf(selection.anchorNode);
	if (island) selection.collapse(...besideIsland(island, after));
};
var draftEdge = (box, at) => {
	const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
	let text = walker.nextNode();
	if (at === "end") for (let next = text; next; next = walker.nextNode()) text = next;
	if (!text) return void 0;
	const island = islandOf(text);
	return island ? besideIsland(island, at === "end") : [text, at === "end" ? text.length : 0];
};
var onFirstRow = (selection) => {
	const origin = gap(selection);
	selection.modify("move", "backward", "lineboundary");
	const first = peek(selection, "backward") === "";
	goto(selection, origin);
	return first;
};
var atDraftStart = (selection) => peek(selection, "backward") === "";
var atDraftEnd = (selection) => {
	const origin = gap(selection);
	const under = here(selection);
	if (under !== "" && !isBreak(under)) forward(selection);
	const end = peek(selection, "forward") === "";
	goto(selection, origin);
	return end;
};
var select = (selection, start, end, backward) => backward ? selection.setBaseAndExtent(end.startContainer, end.startOffset, start.startContainer, start.startOffset) : selection.setBaseAndExtent(start.startContainer, start.startOffset, end.startContainer, end.startOffset);
var lineStart = (selection) => {
	selection.modify("move", "backward", "paragraphboundary");
	for (let i = 0; i < 5e3 && peek(selection, "backward") === "￼"; i++) backward(selection);
};
var lineEnd = (selection) => selection.modify("move", "forward", "paragraphboundary");
var firstNonBlank = (selection) => {
	lineStart(selection);
	for (let i = 0; i < LIMIT; i++) {
		const c = here(selection);
		if (kind(c) !== 0 || isBreak(c)) return;
		forward(selection);
	}
};
var BLANK = /^[\s\u00a0]*$/;
var BLOCK = /^(P|DIV|LI|UL|OL|BLOCKQUOTE|PRE|H[1-6])$/;
var itemsIn = (fragment) => {
	const out = [];
	const visit = (node) => {
		if (node.nodeType === 3) {
			const text = node.textContent ?? "";
			if (text) out.push(BLANK.test(text) ? "space" : "text");
			return;
		}
		if (node.nodeType !== 1) return;
		const el = node;
		if (el.getAttribute("contenteditable") === "false") return void out.push("chip");
		if (el.tagName === "BR") return void (el.classList.contains("ProseMirror-trailingBreak") || out.push("break"));
		el.childNodes.forEach(visit);
	};
	let blocks = 0;
	fragment.childNodes.forEach((node) => {
		if (node.nodeType === 1 && BLOCK.test(node.tagName) && blocks++) out.push("break");
		visit(node);
	});
	return out;
};
var aroundCaret = (selection) => {
	const node = selection.focusNode;
	if (!selection.isCollapsed || !node) return void 0;
	const box = (node.nodeType === 1 ? node : node.parentElement)?.closest("[contenteditable=\"true\"]");
	if (!box) return void 0;
	const before = document.createRange();
	before.setStart(box, 0);
	before.setEnd(node, selection.focusOffset);
	const after = document.createRange();
	after.setStart(node, selection.focusOffset);
	after.setEnd(box, box.childNodes.length);
	return {
		before: itemsIn(before.cloneContents()),
		after: itemsIn(after.cloneContents())
	};
};
var insideLeadingRun = (selection) => {
	const around = aroundCaret(selection);
	if (!around) return false;
	const { before, after } = around;
	if (!before.includes("chip") || before.some((item) => item !== "chip" && item !== "space")) return false;
	return before.at(-1) === "chip" || after.find((item) => item !== "space") === "chip";
};
var stepsIntoTrailingRun = (selection) => {
	if (!charUnder(selection)) return false;
	const origin = gap(selection);
	forward(selection);
	const around = aroundCaret(selection);
	goto(selection, origin);
	if (!around) return false;
	const { before, after } = around;
	if (!after.includes("chip") || after.some((item) => item !== "chip" && item !== "space")) return false;
	return after[0] === "chip" || before.findLast((item) => item !== "space") === "chip";
};
// src/theme.ts
var FOCUS_CSS = `html[data-vim-region="sidebar"] ${SIDEBAR_ROW}:focus{outline:2px solid ${FOCUS_RING};outline-offset:-2px}html[data-vim-driving] ${COMMUNITY_POPUP}{opacity:0!important;transition:none!important;animation:none!important}`;
var around = (list, before, after = "") => list.split(",").map((part) => `${before}${part.trim()}${after}`).join(",");
var PANES = [["main", MAIN], ["side", SIDE]];
var PANE_HEADER = {
	main: "[data-main-workspace] > header",
	side: "[data-panel-workspace] > header"
};
var LINE_CSS = PANES.map(([pane]) => `html[data-vim-on][data-vim-panes][data-vim-region="${pane}"] ${PANE_HEADER[pane]}::after{inset-inline:0;height:2px;background:${ACCENT}}`).join("");
var BUBBLE = "[data-bubble] [data-message-action-anchor]:not([data-solo-cards])";
var LIFT = "var(--affordance-backdrop-pressed, #80808040)";
var MARK_ACTIVE = {
	bubble: `background-image:linear-gradient(${LIFT},${LIFT});outline:2px solid ${ACCENT}`,
	bare: `outline:2px solid ${ACCENT};outline-offset:-2px;border-radius:14px`
};
var MARK_RESTING = {
	bubble: `outline:1px solid ${mix(ACCENT, 45)}`,
	bare: `outline:1px solid ${mix(ACCENT, 45)};outline-offset:-1px;border-radius:14px`
};
var BOX_LIFT = mix(LIFT, 40);
var BOX_FOCUS_CSS = `html[data-vim-on] form:has(${COMPOSER}:focus){background-image:linear-gradient(${BOX_LIFT},${BOX_LIFT})}`;
var CURSOR_ATTR = "data-vim-cursor";
var ROW = `[${CURSOR_ATTR}]`;
var BARE = ":not(:has([data-bubble])) > [data-layout]";
var ACTIVE_MAIN = "html:not([data-vim-region=\"side\"]):not([data-vim-box]) ";
var ACTIVE_SIDE = "html[data-vim-region=\"side\"]:not([data-vim-box]) ";
var CURSOR_CSS = `${around(`${MAIN}, ${SIDE}`, "", ` ${ROW} ${BUBBLE}`)}{${MARK_RESTING.bubble}}${around(`${MAIN}, ${SIDE}`, "", ` ${ROW}${BARE}`)}{${MARK_RESTING.bare}}${ACTIVE_MAIN}${ROW}[${CURSOR_ATTR}="main"] ${BUBBLE}{${MARK_ACTIVE.bubble}}${ACTIVE_MAIN}${ROW}[${CURSOR_ATTR}="main"]${BARE}{${MARK_ACTIVE.bare}}${ACTIVE_SIDE}${ROW}[${CURSOR_ATTR}="side"] ${BUBBLE}{${MARK_ACTIVE.bubble}}${ACTIVE_SIDE}${ROW}[${CURSOR_ATTR}="side"]${BARE}{${MARK_ACTIVE.bare}}`;
var FOLD = `[${FOLD_ATTR}]`;
var FOLD_CSS = `${FOLD}>:last-child{display:none}${FOLD}>:first-child::after{display:none}${FOLD}::after{content:attr(${FOLD_ATTR});display:flex;align-items:center;min-height:var(--size-control-sm,2rem);margin-inline-start:calc(var(--size-control-sm,2rem) + var(--space-2,.5rem));padding-inline:var(--space-4,1rem);color:var(--text-standard,inherit);font-size:var(--text-body-sm,.875rem);line-height:var(--text-body-sm--line-height,1.43)}`;
var STATIC_CSS = FOCUS_CSS + LINE_CSS + BOX_FOCUS_CSS + CURSOR_CSS + FOLD_CSS;
// src/cursor.ts
var PANE_LIST = ["main", "side"];
var cursors = {
	main: void 0,
	side: void 0
};
var cursorPane = () => state.region === "side" ? "side" : "main";
var cursorStyle = document.createElement("style");
cursorStyle.setAttribute("data-vim-cursor-style", "");
cursorStyle.textContent = STATIC_CSS;
var marked = {
	main: void 0,
	side: void 0
};
var paneOf = (row) => row.closest("[data-panel-workspace]") ? "side" : "main";
var mark = (pane, row) => {
	if (marked[pane] === row) return;
	marked[pane]?.removeAttribute(CURSOR_ATTR);
	row?.setAttribute(CURSOR_ATTR, pane);
	marked[pane] = row;
};
var setCursor = (pane, id, row) => {
	cursors[pane] = id;
	mark(pane, row);
};
var clearCursor = (pane) => {
	cursors[pane] = void 0;
	mark(pane, void 0);
	stopFollow(pane);
};
var isCursorRow = (el, pane, id) => el.dataset.messageId === id && paneOf(el) === pane && !el.hasAttribute("data-membership-row") && !el.parentElement?.closest("[data-message-id]");
var onMutations = (records) => {
	for (const pane of PANE_LIST) if (marked[pane] && !marked[pane].isConnected) marked[pane] = void 0;
	const lost = PANE_LIST.filter((pane) => cursors[pane] && !marked[pane]);
	if (!lost.length) return;
	for (const pane of lost) {
		const id = cursors[pane];
		const selector = `[data-message-id="${CSS.escape(id)}"]`;
		const hunt = (el) => {
			for (const row of el.matches(selector) ? [el] : el.querySelectorAll(selector)) if (isCursorRow(row, pane, id)) return mark(pane, row);
		};
		for (const record of records) {
			if (marked[pane]) break;
			if (record.type === "attributes") hunt(record.target);
			else for (const node of record.addedNodes) if (node.nodeType === 1) hunt(node);
		}
	}
};
var onIdChange = (records) => {
	for (const record of records) {
		if (record.type !== "attributes") continue;
		for (const pane of PANE_LIST) if (record.target === marked[pane] && cursors[pane] !== record.target.dataset.messageId) mark(pane, void 0);
	}
	onMutations(records);
};
var observer = new MutationObserver(onIdChange);
var watchCursors = () => observer.observe(document.body, {
	childList: true,
	subtree: true,
	attributes: true,
	attributeFilter: ["data-message-id"]
});
var unwatchCursors = () => observer.disconnect();
var resetCursors = () => {
	for (const pane of PANE_LIST) clearCursor(pane);
};
var paintCursor = timed("paintCursor", () => {
	const publish = (name, value) => cursorStyle.dataset[name] !== value && (cursorStyle.dataset[name] = value);
	publish("messageId", cursors[cursorPane()] ?? "");
	publish("mainMessageId", cursors.main ?? "");
	publish("sideMessageId", cursors.side ?? "");
	document.documentElement.toggleAttribute("data-vim-box", boxHasKeys());
});
var clearCursors = () => {
	clearCursor("main");
	clearCursor("side");
	paintCursor();
};
var selectRow = (row, reveal = true) => {
	setCursor(paneOf(row), row.dataset.messageId, row);
	paintCursor();
	if (reveal) row.scrollIntoView({ block: "nearest" });
};
var nearestVisible = (scroller, fromEnd) => {
	const rows = rowsOf(scroller).filter((row) => inView(scroller, row));
	return fromEnd ? rows.at(-1) : rows[0];
};
var atBottom = (scroller) => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
var moveCursor = timed("moveCursor", (steps) => {
	const scroller = activeTimeline();
	if (!scroller) return;
	const rows = rowsOf(scroller);
	if (!rows.length) {
		if (steps > 0) enterBox(cursorPane(), "start");
		return;
	}
	const at = rows.findIndex((row) => row.dataset.messageId === cursors[cursorPane()]);
	if (at < 0) {
		const row = nearestVisible(scroller, steps < 0);
		if (row) selectRow(row);
		return;
	}
	const target = clamp(at + steps, 0, rows.length - 1);
	if (target === at) {
		if (steps > 0 && atBottom(scroller) && enterBox(cursorPane(), "start")) return;
		scroller.scrollBy({ top: Math.sign(steps) * scroller.clientHeight * .5 });
		return;
	}
	selectRow(rows[target]);
});
var jumpEdge = (end) => {
	if (state.region === "sidebar") {
		const rows = channelRows();
		focusEl(end ? rows.at(-1) : rows[0]);
		return;
	}
	const scroller = activeTimeline();
	if (!scroller) return;
	scroller.scrollTop = end ? scroller.scrollHeight : 0;
	afterLayout(() => markEdge(scroller, end));
};
var markEdge = (scroller, end) => {
	const row = nearestVisible(scroller, end);
	if (row) selectRow(row);
};
var LANDED_MS = 600;
var LANDING_MS = 3e3;
var landAtEnd = async (pane) => {
	stopFollow();
	const epoch = keyEpoch;
	let mine;
	let height = -1;
	let changed = performance.now();
	let moved = false;
	let list = timelineOf(pane);
	await settle(() => {
		if (keyEpoch !== epoch || cursors[pane] && cursors[pane] !== mine) return moved = true;
		const scroller = timelineOf(pane);
		list ??= scroller;
		if (scroller && scroller !== list) return moved = true;
		if (!scroller || scroller.getAttribute("aria-busy") === "true") return false;
		const now = performance.now();
		if (!atBottom(scroller)) {
			scroller.scrollTop = scroller.scrollHeight;
			changed = now;
		} else if (scroller.scrollHeight !== height || !mine) {
			height = scroller.scrollHeight;
			const row = nearestVisible(scroller, true);
			if (row && row.dataset.messageId !== cursors[pane]) selectRow(row);
			mine = cursors[pane];
			changed = now;
		}
		return now - changed > LANDED_MS;
	}, LANDING_MS);
	if (!moved) followEnd(pane, mine, epoch);
	return !moved;
};
var FOLLOW_MS = 3e4;
var following;
var stopFollow = (pane) => {
	if (!pane || following?.pane === pane) following?.stop();
};
var followEnd = (pane, placed, epoch) => {
	const scroller = timelineOf(pane);
	if (!scroller) return;
	let mine = placed;
	let queued = true;
	const stop = () => {
		watch.disconnect();
		clearTimeout(timer);
		if (following?.stop === stop) following = void 0;
	};
	const check = () => {
		queued = false;
		if (disposed || keyEpoch !== epoch || cursors[pane] !== mine || !scroller.isConnected) return stop();
		if (scroller.getAttribute("aria-busy") === "true") return;
		if (!atBottom(scroller)) {
			if (mine) return;
			scroller.scrollTop = scroller.scrollHeight;
		}
		const row = nearestVisible(scroller, true);
		if (!row || row.dataset.messageId === mine) return;
		selectRow(row);
		mine = row.dataset.messageId;
	};
	const watch = new MutationObserver(() => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(check);
	});
	const timer = setTimeout(stop, FOLLOW_MS);
	stopFollow();
	following = {
		pane,
		stop
	};
	watch.observe(scroller, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["aria-busy"]
	});
	requestAnimationFrame(check);
};
var keepCursorInView = (scroller, direction, still = false) => {
	if (still && !cursors[cursorPane()]) return;
	const current = rowsOf(scroller).find((row) => row.dataset.messageId === cursors[cursorPane()]);
	if (current && inView(scroller, current)) return;
	const fromEnd = direction < 0;
	const edge = scroller.getBoundingClientRect();
	const whole = (row) => row.getBoundingClientRect().top >= edge.top && row.getBoundingClientRect().bottom <= edge.bottom;
	const shown = rowsOf(scroller).filter((row) => inView(scroller, row));
	const row = still ? (fromEnd ? shown.filter(whole).at(-1) : shown.find(whole)) ?? (fromEnd ? shown.at(-1) : shown[0]) : nearestVisible(scroller, fromEnd);
	if (row) selectRow(row, !still);
};
var halfPage = (direction) => {
	const scroller = activeTimeline();
	if (!scroller) return;
	scroller.scrollBy({ top: direction * scroller.clientHeight / 2 });
	afterLayout(() => keepCursorInView(scroller, direction));
};
var cursorRow = () => {
	const scroller = activeTimeline();
	const id = cursors[cursorPane()];
	return scroller && id ? rowsOf(scroller).find((row) => row.dataset.messageId === id) : void 0;
};
// src/communities.ts
var communityTrigger = () => document.querySelector(COMMUNITY_TRIGGER);
var communityPopup = () => [...document.querySelectorAll(COMMUNITY_POPUP)].find(visible);
var communityRows = (popup) => [...popup.querySelectorAll("button:not([disabled])")].filter((row) => row.matches("[aria-label^=\"Switch to \"]") || row.textContent?.trim() === "Personal space");
async function openCommunityPicker() {
	const trigger = communityTrigger();
	if (!trigger) return;
	if (!communityPopup()) trigger.click();
	const popup = await settle(communityPopup);
	const rows = popup ? communityRows(popup) : [];
	focusEl(rows.find((row) => row.hasAttribute("aria-current")) ?? rows[0]);
}
var switching = false;
var resetCommunities = () => {
	switching = false;
};
var switchCommunity = async (direction) => {
	const steps = takeCount() * direction;
	const trigger = communityTrigger();
	if (!trigger || switching) return;
	switching = true;
	const root = document.documentElement;
	root.dataset.vimDriving = "";
	const region = state.region;
	const before = trigger.getAttribute("aria-label");
	const oldRows = new Set(channelRows());
	let switched = false;
	try {
		if (!communityPopup()) trigger.click();
		const popup = await settle(communityPopup);
		const rows = popup ? communityRows(popup) : [];
		const at = rows.findIndex((row) => row.hasAttribute("aria-current"));
		const target = rows[clamp(at + steps, 0, rows.length - 1)];
		if (at < 0 || !target || target === rows[at]) {
			if (popup) trigger.click();
			await settle(() => !communityPopup());
			if (available(region)) goRegion(region);
			return;
		}
		target.click();
		await settle(() => !communityPopup() && communityTrigger()?.getAttribute("aria-label") !== before);
		clearCursors();
		switched = true;
	} finally {
		delete root.dataset.vimDriving;
		switching = false;
	}
	if (!switched) return;
	const epoch = keyEpoch;
	if (await settle(() => {
		const first = channelRows()[0];
		return first && !oldRows.has(first);
	}, 5e3) && keyEpoch === epoch) goRegion("sidebar");
};
// src/panes.ts
var openChannel = async (row) => {
	const { status, viewer, origin } = ctx.relay.snapshot();
	if (status === "ready" && viewer && origin) try {
		if ((await ctx.navigation.open({
			version: 1,
			kind: "conversation",
			scope: {
				viewer,
				communityOrigin: origin
			},
			channelId: row.dataset.channelId
		}, { focus: "preserve" })).status === "opened") return true;
	} catch {}
	row.click();
	return false;
};
var REGIONS = [
	"sidebar",
	"main",
	"side"
];
var available = (region) => region === "sidebar" ? channelRows().length > 0 : !!timelineOf(region);
var ensureCursor = async (pane, atEnd) => {
	if (cursors[pane]) return;
	const list = timelineOf(pane);
	if (atEnd && await landAtEnd(pane)) return;
	if (atEnd && list && timelineOf(pane) !== list) return;
	const epoch = keyEpoch;
	const row = await settle(() => {
		const scroller = timelineOf(pane);
		return scroller && nearestVisible(scroller, pane === "main");
	}, 1e3);
	if (row && !cursors[pane] && !disposed && (!atEnd || keyEpoch === epoch && (!list || timelineOf(pane) === list))) selectRow(row);
};
var goRegion = (region, atEnd = false) => {
	const was = document.activeElement;
	if (isEditable(was) && inComposer(was)) {
		document.getSelection()?.removeAllRanges();
		set({
			textMode: "insert",
			visual: ""
		});
	}
	if (region === "sidebar") {
		const rows = channelRows();
		focusEl(rows.includes(document.activeElement) ? document.activeElement : selectedRow() ?? rows[0]);
	} else focusEl(timelineOf(region));
	set({ region });
	if (region !== "sidebar") ensureCursor(region, atEnd);
};
var shiftRegion = (direction) => {
	const order = REGIONS.filter(available);
	const from = order.includes(state.region) ? order.indexOf(state.region) : order.indexOf("main");
	const next = order[clamp(from + direction, 0, order.length - 1)];
	if (!next || next === state.region) {
		if (direction < 0 && from <= 0) openCommunityPicker();
		return;
	}
	const row = document.activeElement;
	if (state.region === "sidebar" && direction > 0 && row?.matches?.("[data-sidebar-section] button[data-channel-id]")) {
		(row.getAttribute("aria-current") === "page" ? Promise.resolve() : openChannel(row)).then(() => afterLayout(() => goRegion("main")));
		return;
	}
	goRegion(next);
};
var moveSidebar = (steps) => {
	const rows = channelRows();
	if (!rows.length) return;
	const base = rows.includes(document.activeElement) ? rows.indexOf(document.activeElement) : rows.indexOf(selectedRow());
	focusEl(rows[clamp(base < 0 ? 0 : base + steps, 0, rows.length - 1)]);
	set({ region: "sidebar" });
};
var step = (direction) => {
	const n = takeCount() * direction;
	if (state.region === "sidebar") moveSidebar(n);
	else moveCursor(n);
};
var switchChannel = (direction) => {
	const rows = channelRows();
	const at = rows.indexOf(selectedRow());
	const row = rows[clamp(at + direction * takeCount(), 0, rows.length - 1)];
	if (!row || row === rows[at]) return;
	clearCursors();
	openChannel(row).then(() => afterLayout(() => state.region === "main" && goRegion("main")));
};
// src/focus.ts
var syncFocus = timed("syncFocus", () => {
	if (disposed) return;
	const el = document.activeElement;
	set({
		mode: isEditable(el) && state.textMode === "insert" ? "insert" : "normal",
		visual: isEditable(el) ? state.visual : "",
		region: regionOf(el) ?? state.region
	});
});
var onFocusIn = (event) => {
	if (isEditable(event.target)) setQuietly({
		textMode: "insert",
		visual: ""
	});
	syncFocus();
};
var onFocusOut = () => void setTimeout(syncFocus, 0);
// src/motions.ts
var wordForward = (selection, big, operator) => {
	const first = kind(here(selection), big);
	if (first > 0) for (let i = 0; i < 5e3 && kind(here(selection), big) === first; i++) forward(selection);
	const endOfWord = gap(selection);
	let crossed = false;
	for (let i = 0; i < 5e3 && kind(here(selection), big) === 0; i++) {
		crossed ||= isBreak(here(selection));
		forward(selection);
		if (onEmptyLine(selection)) break;
	}
	if (operator && crossed && first > 0) goto(selection, endOfWord);
};
var wordBackward = (selection, big) => {
	if (!prev(selection)) return;
	backward(selection);
	for (let i = 0; i < 5e3 && kind(here(selection), big) === 0; i++) {
		if (onEmptyLine(selection) || !prev(selection)) return;
		backward(selection);
	}
	const k = kind(here(selection), big);
	for (let i = 0; i < 5e3 && kind(prev(selection), big) === k; i++) backward(selection);
};
var wordEnd = (selection, big) => {
	if (!here(selection)) return;
	forward(selection);
	for (let i = 0; i < 5e3 && kind(here(selection), big) === 0; i++) forward(selection);
	const k = kind(here(selection), big);
	if (k > 0) for (let i = 0; i < 5e3 && kind(here(selection), big) === k; i++) forward(selection);
	backward(selection);
};
var wordEndBackward = (selection, big) => {
	const first = kind(here(selection), big);
	if (!prev(selection)) return;
	backward(selection);
	if (first > 0) for (let i = 0; i < 5e3 && kind(here(selection), big) === first; i++) {
		if (!prev(selection)) return;
		backward(selection);
	}
	for (let i = 0; i < 5e3 && kind(here(selection), big) === 0; i++) {
		if (onEmptyLine(selection) || !prev(selection)) return;
		backward(selection);
	}
};
var gotoLine = (selection, n) => {
	if (n === Infinity) selection.modify("move", "forward", "documentboundary");
	else {
		selection.modify("move", "backward", "documentboundary");
		for (let i = 1; i < n; i++) {
			lineEnd(selection);
			if (!here(selection)) break;
			forward(selection);
		}
	}
	firstNonBlank(selection);
};
var lastFind;
var resetMotions = () => {
	lastFind = void 0;
};
var OPPOSITE = {
	f: "F",
	F: "f",
	t: "T",
	T: "t"
};
var findChar = (selection, key, ch, count, again) => {
	const backwards = key === "F" || key === "T";
	const till = key === "t" || key === "T";
	const hop = () => {
		if (backwards) {
			const before = prev(selection);
			if (before === "" || isBreak(before)) return false;
			backward(selection);
			return true;
		}
		const under = here(selection);
		if (under === "" || isBreak(under)) return false;
		forward(selection);
		const next = here(selection);
		if (next === "" || isBreak(next)) {
			backward(selection);
			return false;
		}
		return true;
	};
	const origin = gap(selection);
	if (again && till) {
		const at = gap(selection);
		const adjacent = hop() && here(selection) === ch;
		goto(selection, at);
		if (adjacent) hop();
	}
	for (let i = 0; i < count; i++) {
		let found = false;
		while (hop()) if (here(selection) === ch) {
			found = true;
			break;
		}
		if (!found) {
			goto(selection, origin);
			return false;
		}
	}
	if (till) (backwards ? forward : backward)(selection);
	return true;
};
var finder = (key, ch, again) => ({
	run: (selection, n) => void findChar(selection, key, ch, n, again),
	inclusive: key === "f" || key === "t"
});
var MOTIONS = {
	h: { run: (s, n) => times(n, () => backward(s)) },
	l: { run: (s, n) => times(n, () => forward(s)) },
	j: { run: (s, n) => times(n, () => s.modify("move", "forward", "line")) },
	k: { run: (s, n) => times(n, () => s.modify("move", "backward", "line")) },
	w: { run: (s, n, _typed, operator) => times(n, (i) => wordForward(s, false, operator && i === n - 1)) },
	W: { run: (s, n, _typed, operator) => times(n, (i) => wordForward(s, true, operator && i === n - 1)) },
	b: { run: (s, n) => times(n, () => wordBackward(s, false)) },
	B: { run: (s, n) => times(n, () => wordBackward(s, true)) },
	e: {
		run: (s, n) => times(n, () => wordEnd(s, false)),
		inclusive: true
	},
	E: {
		run: (s, n) => times(n, () => wordEnd(s, true)),
		inclusive: true
	},
	ge: {
		run: (s, n) => times(n, () => wordEndBackward(s, false)),
		inclusive: true
	},
	gE: {
		run: (s, n) => times(n, () => wordEndBackward(s, true)),
		inclusive: true
	},
	0: { run: (s) => lineStart(s) },
	"^": { run: (s) => firstNonBlank(s) },
	$: {
		run: (s, n) => {
			times(n - 1, () => {
				lineEnd(s);
				forward(s);
			});
			lineEnd(s);
		},
		inclusive: true
	},
	gg: {
		run: (s, _n, typed) => gotoLine(s, typed || 1),
		lines: true
	},
	G: {
		run: (s, _n, typed) => gotoLine(s, typed || Infinity),
		lines: true
	}
};
var FIND_KEYS = [
	"f",
	"F",
	"t",
	"T"
];
var PENDING = Symbol("pending");
var resolveMotion = (key) => {
	const prefix = state.prefix;
	if (prefix) {
		set({ prefix: "" });
		if (prefix === "g") return {
			g: MOTIONS.gg,
			e: MOTIONS.ge,
			E: MOTIONS.gE
		}[key];
		lastFind = {
			key: prefix,
			ch: key
		};
		return finder(prefix, key, false);
	}
	if (key === "g" || FIND_KEYS.includes(key)) {
		set({ prefix: key });
		armPending();
		return PENDING;
	}
	if ((key === ";" || key === ",") && lastFind) return finder(key === ";" ? lastFind.key : OPPOSITE[lastFind.key], lastFind.ch, true);
	return MOTIONS[key];
};
// src/visual.ts
var visualAnchor;
var visualCursor;
var visualSpan;
var resetVisual = () => {
	visualAnchor = visualCursor = visualSpan = void 0;
};
var paintVisual = () => {
	const selection = document.getSelection();
	const anchor = visualAnchor;
	const cursor = visualCursor;
	const backward = anchor.compareBoundaryPoints(Range.START_TO_START, cursor) > 0;
	const [first, last] = backward ? [cursor, anchor] : [anchor, cursor];
	let start = first;
	let end = last;
	if (state.visual === "line") {
		goto(selection, first);
		selection.modify("move", "backward", "paragraphboundary");
		start = gap(selection);
		goto(selection, last);
		selection.modify("move", "forward", "paragraphboundary");
		end = gap(selection);
	} else {
		goto(selection, last);
		stepRight(selection);
		end = gap(selection);
	}
	visualSpan = {
		start,
		end
	};
	select(selection, start, end, backward);
};
var startVisual = (kind) => {
	const selection = document.getSelection();
	selection.collapse(selection.focusNode, selection.focusOffset);
	clampCursor(selection);
	visualAnchor = gap(selection);
	visualCursor = gap(selection);
	set({ visual: kind });
	paintVisual();
};
var leaveVisual = (at) => {
	if (isEditable(document.activeElement) && visualCursor) {
		const selection = document.getSelection();
		goto(selection, at ?? visualCursor);
		clampCursor(selection);
	}
	set({ visual: "" });
};
var visualMove = (motion, n, typed) => {
	const selection = document.getSelection();
	goto(selection, visualCursor);
	motion.run(selection, n, typed);
	clampCursor(selection);
	visualCursor = gap(selection);
	paintVisual();
};
var copy = (text) => {
	if (!text) return;
	const put = (event) => {
		event.clipboardData?.setData("text/plain", text);
		event.preventDefault();
		event.stopPropagation();
	};
	let copied = false;
	document.addEventListener("copy", put, true);
	try {
		copied = document.execCommand("copy");
	} finally {
		document.removeEventListener("copy", put, true);
	}
	if (!copied) navigator.clipboard?.writeText(text).catch(() => {});
};
var visualAct = (key) => {
	const selection = document.getSelection();
	let { start, end } = visualSpan;
	if (key === "y") {
		copy(selection.toString());
		return leaveVisual(start);
	}
	if (state.visual === "line" && key !== "c") {
		goto(selection, end);
		if (peek(selection, "forward") === "\n") {
			selection.modify("move", "forward", "character");
			end = gap(selection);
		} else {
			goto(selection, start);
			if (peek(selection, "backward") === "\n") {
				selection.modify("move", "backward", "character");
				start = gap(selection);
			}
		}
	}
	select(selection, start, end, false);
	if (!selection.isCollapsed) document.execCommand("delete");
	if (key === "c") {
		set({ visual: "" });
		return enterInsert();
	}
	leaveVisual(gap(selection));
};
var visualKey = (key) => {
	const typed = state.count;
	const motion = resolveMotion(key);
	if (motion === PENDING) return;
	if (motion) return visualMove(motion, takeCount(), typed);
	clearPending();
	switch (key) {
		case "v": return state.visual === "char" ? leaveVisual() : (set({ visual: "char" }), paintVisual());
		case "V": return state.visual === "line" ? leaveVisual() : (set({ visual: "line" }), paintVisual());
		case "y":
		case "d":
		case "x":
		case "c": return visualAct(key);
	}
};
// src/status.ts
var bar = document.createElement("div");
bar.setAttribute("data-vim-status", "");
bar.setAttribute("aria-hidden", "true");
Object.assign(bar.style, {
	position: "fixed",
	right: "10px",
	bottom: "2px",
	zIndex: "2147483000",
	padding: "0 6px",
	borderRadius: "3px",
	font: "600 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace",
	letterSpacing: "-0.01em",
	background: "var(--surface-popover, #1d1d1f)",
	color: "var(--text-standard, #f5f5f7)",
	border: `1px solid ${ACCENT}`,
	pointerEvents: "none",
	whiteSpace: "pre"
});
var unknown = () => ({
	display: null,
	text: null,
	mode: null,
	region: null,
	on: null,
	panes: null
});
var written = unknown();
var resetBar = () => {
	written = unknown();
};
var renderBar = timed("renderBar", () => {
	const display = state.enabled && state.statusLine ? "" : "none";
	if (display !== written.display) bar.style.display = written.display = display;
	const text = state.composerNormal && isEditable(document.activeElement) && state.textMode === "normal";
	const line = `-- ${state.mode === "insert" ? "INSERT" : text ? {
		"": "NORMAL",
		char: "VISUAL",
		line: "VISUAL LINE"
	}[state.visual] : "NORMAL"} --  ${state.region}${state.count ? `  ${state.count}` : ""}${state.operator || state.prefix ? `  ${state.operator}${state.prefix}` : ""}`;
	if (line !== written.text) bar.textContent = written.text = line;
	if (state.mode !== written.mode) bar.dataset.mode = written.mode = state.mode;
	const root = document.documentElement;
	if (state.region !== written.region) root.dataset.vimRegion = written.region = state.region;
	if (state.enabled !== written.on) root.toggleAttribute("data-vim-on", written.on = state.enabled);
	const panes = state.enabled && workspaces("main").length > 0 && workspaces("side").length > 0;
	if (panes !== written.panes) root.toggleAttribute("data-vim-panes", written.panes = panes);
	paintCursor();
});
// src/box.ts
var bridges = /* @__PURE__ */ new Set();
var registerFocusBridge = () => {
	const React = ctx.react;
	const FocusBridge = (props) => {
		const { focus, channelId, threadRootId } = props;
		React.useEffect(() => {
			const entry = {
				focus,
				channelId,
				threadRootId
			};
			bridges.add(entry);
			return () => {
				bridges.delete(entry);
			};
		}, [
			focus,
			channelId,
			threadRootId
		]);
		return null;
	};
	ctx.conversation.registerTool({
		id: "focus-bridge",
		title: "Vim focus bridge",
		order: 1e3,
		component: FocusBridge
	});
};
var currentChannelId = () => {
	const target = ctx.navigation.snapshot().entry?.target;
	return target?.kind === "conversation" ? target.channelId : void 0;
};
var focusBox = (pane) => {
	const channelId = currentChannelId();
	const bridge = [...bridges].reverse().find((b) => pane === "side" ? b.threadRootId : !b.threadRootId && (!channelId || b.channelId === channelId));
	let via = "tool";
	if (bridge) bridge.focus();
	const active = document.activeElement;
	if (!isEditable(active) || !inComposer(active) || regionOf(active) !== pane) {
		via = "dom";
		const composer = composerOf(pane) ?? (pane === "side" ? void 0 : composerOf("main"));
		if (!composer) return false;
		composer.focus();
	}
	bar.dataset.focusVia = via;
	return true;
};
var caretBesideChips = () => {
	const selection = document.getSelection();
	if (selection && isEditable(document.activeElement) && inComposer(document.activeElement)) keepOutOfIslands(selection, true);
};
var settleInsertCaret = () => {
	const epoch = keyEpoch;
	setTimeout(() => {
		if (!disposed && keyEpoch <= epoch + 1 && state.textMode === "insert") caretBesideChips();
	}, 100);
};
var enterInsert = () => {
	caretBesideChips();
	set({ textMode: "insert" });
	syncFocus();
	settleInsertCaret();
};
var startInsert = (where) => {
	if (!focusBox(state.region === "side" ? "side" : "main")) return;
	if (where === "end") {
		const selection = document.getSelection();
		selection.selectAllChildren(document.activeElement);
		selection.collapseToEnd();
	} else if (where === "after") {
		const selection = document.getSelection();
		if (selection.isCollapsed) stepRight(selection);
	}
	caretBesideChips();
	set({ textMode: "insert" });
	syncFocus();
	settleInsertCaret();
};
var enterBox = (pane, at) => {
	if (!state.composerNormal || !focusBox(pane)) return false;
	const box = document.activeElement;
	const place = () => {
		const selection = document.getSelection();
		const spot = draftEdge(box, at);
		if (spot) selection.collapse(...spot);
		else selection.collapse(box.firstElementChild ?? box, 0);
		clampCursor(selection);
	};
	const put = () => {
		place();
		document.dispatchEvent(new Event("selectionchange"));
	};
	put();
	const epoch = keyEpoch;
	setTimeout(() => {
		if (!disposed && document.activeElement === box && keyEpoch <= epoch + 1 && state.textMode === "normal" && !state.visual) put();
	}, 80);
	set({
		textMode: "normal",
		visual: "",
		region: pane
	});
	syncFocus();
	return true;
};
var paneRight = () => state.region === "main" && !!timelineOf("side");
var boxStep = (direction) => {
	const beside = state.region === "main" && direction > 0 ? "side" : state.region === "side" && direction < 0 ? "main" : void 0;
	if (beside && composerOf(beside) && enterBox(beside, direction > 0 ? "start" : "end")) return;
	shiftRegion(direction);
};
var leaveBox = (el, pane) => {
	const caret = document.getSelection();
	if (caret) keepOutOfIslands(caret);
	el.blur();
	document.getSelection()?.removeAllRanges();
	set({
		textMode: "insert",
		visual: ""
	});
	focusEl(timelineOf(pane));
	syncFocus();
};
var boxUp = (pane) => {
	leaveBox(document.activeElement, pane);
	const scroller = timelineOf(pane);
	if (!scroller) return;
	scroller.scrollTop = scroller.scrollHeight;
	afterLayout(() => {
		const row = rowsOf(scroller).at(-1);
		if (row) selectRow(row);
	});
};
var escape = () => {
	const el = document.activeElement;
	if (state.prefix || state.operator === "d" && isEditable(el)) return clearPending();
	if (state.visual) return leaveVisual();
	if (!isEditable(el)) return clearPending();
	if (state.composerNormal && state.textMode === "insert" && inComposer(el)) {
		clearPending();
		set({ textMode: "normal" });
		const selection = document.getSelection();
		const before = selection.isCollapsed ? peek(selection, "backward") : "";
		if (before !== "" && !isBreak(before)) selection.modify("move", "backward", "character");
		return syncFocus();
	}
	if (state.composerNormal && inComposer(el)) return clearPending();
	leaveBox(el, regionOf(el) === "side" ? "side" : "main");
};
var pressHostChord = (key) => !(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", {
	key,
	metaKey: apple,
	ctrlKey: !apple,
	bubbles: true,
	cancelable: true,
	composed: true
}));
// src/threads.ts
var rowControl = async (label) => {
	const id = cursorRow()?.dataset.messageId;
	if (!id) return;
	const find = () => {
		const row = cursorRow();
		return row?.dataset.messageId === id ? row.querySelector(`[aria-label="Message actions"] button[aria-label="${label}"]`) : void 0;
	};
	if (!find()) window.dispatchEvent(new KeyboardEvent("keydown", {
		key: "Tab",
		bubbles: true,
		cancelable: true
	}));
	const control = await settle(find, 800);
	if (control && !control.disabled) control.click();
};
var threadRootOf = (messageId) => {
	try {
		const channelId = currentChannelId();
		return (channelId ? ctx.relay.snapshot().session.channels.window(channelId).rows : []).find((row) => row.id === messageId)?.threadRootId ?? messageId;
	} catch {
		return messageId;
	}
};
var beneath;
var leaving;
var cursorBack = () => {
	if (!beneath || visible(beneath.tab)) return;
	const scroller = timelineOf("main");
	if (!scroller) return;
	const { id } = beneath;
	beneath = void 0;
	leaving?.disconnect();
	const rows = rowsOf(scroller);
	const kept = rows.find((row) => row.dataset.messageId === cursors.main);
	if (kept) return selectRow(kept);
	clearCursor("main");
	const row = rows.find((row) => row.dataset.messageId === id);
	if (row) selectRow(row);
	paintCursor();
};
var watchBeneath = (tab) => {
	leaving?.disconnect();
	const workspace = tab.closest(MAIN);
	if (!workspace) return;
	let queued = false;
	const watch = new MutationObserver(() => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(() => {
			queued = false;
			if (disposed || !beneath) return watch.disconnect();
			cursorBack();
		});
	});
	watch.observe(workspace, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: [
			"inert",
			"aria-hidden",
			"data-covered",
			"hidden"
		]
	});
	leaving = watch;
};
var openThread = async () => {
	clearPending();
	stopFollow();
	const messageId = state.region === "main" ? cursorRow()?.dataset.messageId : void 0;
	const channelId = currentChannelId();
	const { status, viewer, origin } = ctx.relay.snapshot();
	if (!messageId || !channelId || status !== "ready" || !viewer || !origin) return;
	const before = timelineOf("main");
	const epoch = keyEpoch;
	try {
		if ((await ctx.navigation.open({
			version: 1,
			kind: "conversation",
			scope: {
				viewer,
				communityOrigin: origin
			},
			channelId,
			messageId,
			threadRootId: threadRootOf(messageId)
		}, { focus: "preserve" })).status !== "opened") return;
	} catch {
		return;
	}
	clearCursor("side");
	paintCursor();
	const region = await settle(() => timelineOf("side") ? "side" : timelineOf("main") !== before ? "main" : void 0, 3e3);
	if (!region || keyEpoch !== epoch) return;
	if (region === "main") {
		const tab = timelineOf("main");
		beneath = tab ? {
			id: messageId,
			tab
		} : void 0;
		if (tab) watchBeneath(tab);
		clearCursor("main");
		paintCursor();
	}
	goRegion(region, true);
};
var pillCount = (pill) => Number(/\d+/.exec(pill.getAttribute("aria-label") ?? "")?.[0] ?? 0);
var foldBranch = (branch, row) => {
	const panel = branch.lastElementChild;
	if (!panel || branch.getAttribute("data-open") !== "true") return;
	const count = rowsOf(panel).length + [...panel.querySelectorAll(BRANCH_PILL)].reduce((sum, pill) => sum + pillCount(pill), 0);
	if (!count) return;
	branch.setAttribute(FOLD_ATTR, `${count} ${count === 1 ? "reply" : "replies"}`);
	if (visible(panel)) branch.removeAttribute(FOLD_ATTR);
	else row.scrollIntoView({ block: "nearest" });
};
var toggleBranch = async () => {
	clearPending();
	try {
		const scroller = activeTimeline();
		const row = cursorRow();
		const branch = row?.closest(BRANCH);
		if (!scroller || !row || !branch) return;
		if (branch.hasAttribute("data-vim-fold")) return branch.removeAttribute(FOLD_ATTR);
		const pill = branch.querySelector(`:scope > * > ${BRANCH_PILL}`);
		if (!pill) return foldBranch(branch, row);
		const epoch = keyEpoch;
		pill.click();
		await nextFrame();
		if (keyEpoch === epoch && row.isConnected) {
			focusEl(scroller);
			row.scrollIntoView({ block: "nearest" });
		}
	} catch {}
};
var openOrFold = () => {
	const scroller = activeTimeline();
	if (scroller && !scroller.hasAttribute("data-channel-timeline") && state.region !== "sidebar") toggleBranch();
	else openThread();
};
var enterOpens = () => {
	const el = document.activeElement;
	return state.region === "main" && !!cursors.main && (!el || el === document.body || el.matches("[data-message-scroller]"));
};
var refocusAfter = (region) => afterLayout(() => {
	cursorBack();
	goRegion(available(region) ? region : "main");
});
var closeThread = () => {
	clearPending();
	stopFollow();
	if (document.querySelector("dialog[open], [aria-modal=\"true\"]")) return;
	const request = new Event("buzz:close-active-tab", { cancelable: true });
	window.dispatchEvent(request);
	if (request.defaultPrevented) refocusAfter(state.region);
};
var paneToggle = (expanded) => [...document.querySelectorAll(`${PANE_TOGGLE}[aria-expanded="${expanded}"]`)].find(visible);
var hidePane = () => {
	clearPending();
	const toggle = paneToggle(true);
	if (!toggle) return;
	toggle.click();
	refocusAfter("main");
};
var showPane = () => {
	clearPending();
	paneToggle(false)?.click();
};
var resizePane = async (change) => {
	const steps = takeCount();
	const handle = [...document.querySelectorAll(PANE_HANDLE)].find(visible);
	if (!handle) return;
	const send = (init) => handle.dispatchEvent(new KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		...init
	}));
	if (change === "reset") handle.dispatchEvent(new MouseEvent("dblclick", {
		bubbles: true,
		cancelable: true
	}));
	else if (change === "widest") send({ key: "End" });
	else for (let i = 0; i < steps && !disposed && handle.isConnected; i++) {
		send({
			key: change === "wider" ? "ArrowLeft" : "ArrowRight",
			shiftKey: true
		});
		await nextFrame();
	}
};
// src/leader.ts
var leaderSpec = () => LEADERS[state.leader] ?? LEADERS[apple ? "ctrl-w" : "space"];
var isLeader = (event) => {
	const spec = leaderSpec();
	if (event.metaKey || event.altKey || event.ctrlKey !== !!spec.ctrl) return false;
	return spec.ctrl ? event.key.toLowerCase() === spec.key : event.key === spec.key;
};
var leaderHere = (el) => {
	if (leaderSpec().ctrl) return true;
	if (!timelineOf("main")) return false;
	if (!el || el === document.body) return true;
	if (isEditable(el)) return inComposer(el) && state.composerNormal && state.textMode === "normal";
	return el.matches("[data-message-scroller]") || el.matches("[data-sidebar-section] button[data-channel-id]");
};
var leaderPane = (direction) => {
	clearPending();
	if (isEditable(document.activeElement) && inComposer(document.activeElement)) return boxStep(direction);
	shiftRegion(direction);
};
var LEADER_THEN = {
	h: () => leaderPane(-1),
	l: () => leaderPane(1),
	q: () => closeThread(),
	c: () => closeThread(),
	"<": () => void resizePane("narrower"),
	">": () => void resizePane("wider"),
	"|": () => void resizePane("widest"),
	"=": () => void resizePane("reset")
};
var leaderUp;
var resetLeader = () => {
	leaderUp = void 0;
};
var onLeaderKey = (event) => {
	if (!state.enabled || isHelpOpen() || event.isComposing || event.keyCode === 229) return;
	const swallow = () => {
		event.preventDefault();
		event.stopImmediatePropagation();
		leaderUp = event.key;
		bumpKeyEpoch();
	};
	if (state.operator === "leader") {
		if ([
			"Shift",
			"Control",
			"Alt",
			"Meta"
		].includes(event.key)) return;
		swallow();
		const run = event.ctrlKey || event.metaKey || event.altKey ? void 0 : LEADER_THEN[event.key];
		if (run) run();
		else clearPending();
		return;
	}
	if (event.repeat || !isLeader(event) || !contextOk() || !leaderHere(event.target)) return;
	swallow();
	set({ operator: "leader" });
	armPending();
};
var onLeaderKeyUp = (event) => {
	if (leaderUp === void 0 || event.key !== leaderUp) return;
	leaderUp = void 0;
	event.preventDefault();
	event.stopImmediatePropagation();
};
// src/key-list.ts
var groups = () => {
	const L = leaderSpec().show ?? leaderSpec().label;
	return [
		{
			title: "NORMAL, messages and panes",
			intro: `One normal mode. A pane is one column: its messages, then its message box at the bottom. The label says NORMAL and the pane that has the keys (main, side for a thread, sidebar for the channel list). This part is for the focus in a list: the message list, the channel list or a thread.`,
			rows: [
				[
					"j  k",
					"Next / previous message (message list) or channel (channel list). j past the newest message goes down into the pane's message box, in NORMAL",
					"DOM"
				],
				[
					"5j",
					"Counts: 0-9, then a motion",
					"API"
				],
				[
					"gg  G",
					"First / latest message or channel",
					"API + DOM"
				],
				[
					"Ctrl-d  Ctrl-u",
					"Scroll half a page (Control on a Mac too, not Command)",
					"DOM"
				],
				[
					"Ctrl-e  Ctrl-y",
					"Scroll one line down / up and leave the cursor where it is (5 Ctrl-e: five lines). The cursor moves only when it would leave the view, onto the nearest row still in it. Scrolls the pane that has the keys: the message list, the thread pane, the channel list, a page such as Reminders, Agents or Workflows, the Settings dialog. Control on a Mac too",
					"DOM"
				],
				[
					"h  l",
					"Move focus between the channel list, the message list and the thread pane. l on a channel opens it",
					"DOM"
				],
				[
					`${L}  then  h  l  q  <  >  |  =`,
					"The leader key, for pane commands that work from anywhere, the message box too: h and l move to the pane on the left or right (from a message box, to the box of the pane beside it, or to the channel list), q closes the thread, < > | = resize it. Change the leader on the Vim mode page",
					"DOM"
				],
				[
					"[  ]",
					"Previous / next channel without leaving the message list",
					"DOM"
				],
				[
					"{  }  C",
					"Previous / next community (counts work); C opens the community switcher. j / k move in it, Enter picks, Esc closes",
					"DOM"
				],
				[
					"o  Enter",
					"Open the thread of the message under the cursor and move into it, at its end: scrolled to the bottom, the newest message marked. In a thread, o opens the replies to the reply under the cursor, and again folds them (Enter does not). Enter only while the message list has focus",
					"API + DOM"
				],
				[
					"q",
					"Close the thread: the active tab of the pane you are in, or of the thread pane from the message list",
					"DOM"
				],
				[
					"zc  zo",
					"Hide / show the thread pane. Its threads stay open",
					"DOM"
				],
				[
					">  <",
					"Widen / narrow the thread pane by 48 px a press; a count multiplies (3> is 144 px)",
					"DOM"
				],
				[
					"|  =",
					"Thread pane as wide as it goes / back to its default width",
					"DOM"
				],
				[
					"r",
					"Reply in a thread to the message under the cursor; focus lands in the reply box",
					"DOM"
				],
				[
					"m",
					"Open the menu of the message under the cursor (copy, mark unread, ...). j / k move, Enter picks",
					"DOM"
				],
				[
					"gt  gT",
					"Next / previous page, cycling through the pages the app lists",
					"API"
				],
				[
					"gi gm ga gr gw gv gs",
					"Open Inbox, Messages, Agents, Reminders, Workflows, the Vim mode page (its switches), Settings (the page whose name starts with the letter). The app has Cmd+, or Ctrl+, for Settings too",
					"API"
				],
				[
					"gp",
					"Open Settings on Manage plugins",
					"API"
				],
				[
					"i  a  A",
					"Go to INSERT: focus the message box (a: after the character under the caret; A: at the end of the draft)",
					"API + DOM"
				],
				[
					"Esc",
					"Nothing. It does not close a thread: q does",
					"DOM"
				],
				[
					"/",
					"Search this conversation (presses the host's own chord)",
					"API-adjacent"
				],
				[
					"?",
					"Show this list over the page. j k, Ctrl-d Ctrl-u and gg G scroll it; q, Esc or ? closes it",
					"DOM"
				],
				[
					"j  k  l  Enter  h",
					"Only in the Settings dialog (every other dialog and menu keeps the keys off): j k move through its sections, l or Enter opens one and goes into it (j k then scroll it), h comes back to the list. Esc closes the dialog, as it always did",
					"DOM"
				],
				[
					apple ? "⌘⇧E" : "Ctrl+Shift+E",
					"Turn Vim keys on or off",
					"API"
				]
			]
		},
		{
			title: "NORMAL, the message box",
			intro: "Inside the message box (Esc from INSERT, or down from the messages with j). The label says NORMAL; plain keys move and edit, they never type.",
			rows: [
				["h  j  k  l", "Move the caret (counts work)"],
				["k  (on the first row)", "Go up out of the box into the newest message of the pane"],
				["Ctrl-e  Ctrl-y", "Scroll the pane's messages one line down / up, the draft untouched (counts work). Not in INSERT: there the editor keeps them"],
				["h  (at the very start)  l  (at the very end)", "Go one pane left or right: the thread's box is right of the channel's, which is right of the channel list (nothing lies right of the thread). A run of mentions at the start counts as the start (h from just right of it, or inside it, leaves), and one at the end as the end for l when a pane lies to the right"],
				[`${L}  then  h  l  q  <  >  |  =`, "The leader key works here too, from anywhere in the draft: h and l go one pane left or right, q closes the thread, < > | = resize it"],
				["w  b  e  ge", "Words: letters, digits and underscore are one word, any other run of characters is another"],
				["W  B  E  gE", "WORDs: any run of non-blank characters"],
				["0  ^  $", "Start of the line, first non-blank, end of the line. A line runs between two line breaks, however it wraps"],
				["gg  G  3G", "First line, last line, line 3 (of the draft)"],
				["f t F T + a character", "Find that character on this line: onto it, just before it, and the same backwards. 2fx finds the second x"],
				["; ,", "Repeat the last f t F T, and repeat it the other way"],
				["i  a  I  A", "Back to INSERT"],
				["x  dd  dw  de  df,  d$ ...", "Delete: d and any motion above (dd is the whole line). The motions that land on a character take it too"],
				["u", "Undo"],
				["v  V", "VISUAL: highlight by character / by line"],
				["?", "Show this list over the page"],
				["Esc", "Cancels a half-typed command (d, g, f ...); otherwise nothing: Esc stays in NORMAL. Leave the box with k on its first row, h or l at the ends of the draft, or the leader key"]
			]
		},
		{
			title: "INSERT",
			intro: "Typing in the message box. The label says INSERT; plain keys type, and the app's own shortcuts apply.",
			rows: [[
				"Esc",
				"Back to NORMAL, in the box. In a thread's reply box it does not close the thread",
				"API + DOM"
			]]
		},
		{
			title: "VISUAL",
			intro: "A highlight in the message box (v or V from NORMAL). The label says VISUAL or VISUAL LINE.",
			rows: [
				["every NORMAL motion", "Move the cursor end of the highlight (counts work)"],
				["v  V", "The same key again leaves; the other one switches between characters and lines"],
				["y", "Copy the highlight to the clipboard"],
				["d  x", "Delete the highlight (V takes the whole lines)"],
				["c", "Delete the highlight and go to INSERT"],
				["Esc", "Back to NORMAL, the caret on the cursor end"]
			]
		}
	];
};
// src/scroll.ts
var lineHeight = (el) => {
	const style = getComputedStyle(el);
	const lh = parseFloat(style.lineHeight);
	return Math.max(1, Math.round(Number.isFinite(lh) ? lh : (parseFloat(style.fontSize) || 16) * 1.5));
};
var scrollsY = (el) => /auto|scroll/.test(getComputedStyle(el).overflowY);
var canScroll = (el, direction) => scrollsY(el) && (direction > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0);
var scrollerAbove = (from, direction) => {
	for (let node = from ?? null; node && node !== document.body; node = node.parentElement) if (canScroll(node, direction)) return node;
};
var sidebarScroller = (direction) => {
	const active = document.activeElement;
	return scrollerAbove(regionOf(active) === "sidebar" ? active : channelRows()[0], direction);
};
var pageScroller = (direction) => {
	const firstRow = channelRows()[0] ?? null;
	const outside = (el) => !el.contains(firstRow) && regionOf(el) !== "sidebar" && !el.closest("[role=\"dialog\"]");
	const active = document.activeElement;
	const focused = active && active !== document.body && regionOf(active) !== "sidebar" ? scrollerAbove(active, direction) : void 0;
	if (focused && outside(focused)) return focused;
	let best;
	let area = 0;
	for (const el of document.body.querySelectorAll("*")) {
		if (el.clientHeight < 40 || el.scrollHeight <= el.clientHeight + 1 || !canScroll(el, direction) || !outside(el)) continue;
		if (el.clientHeight * el.clientWidth > area) [best, area] = [el, el.clientHeight * el.clientWidth];
	}
	return best;
};
var lineScroller = (direction) => {
	if (state.region !== "sidebar") {
		const list = timelineOf(state.region === "side" ? "side" : "main");
		if (list) return list;
	} else if (timelineOf("main")) return sidebarScroller(direction);
	return pageScroller(direction) ?? sidebarScroller(direction);
};
var keepFocusInView = (scroller, items, direction) => {
	const box = scroller.getBoundingClientRect();
	const within = (el, whole) => {
		const rect = el.getBoundingClientRect();
		return whole ? rect.top >= box.top && rect.bottom <= box.bottom : rect.bottom > box.top && rect.top < box.bottom;
	};
	const current = items.find((el) => el === document.activeElement);
	if (!current || within(current, false)) return;
	const shown = items.filter((el) => within(el, true));
	const next = direction > 0 ? shown[0] : shown.at(-1);
	if (!next) return;
	document.documentElement.dataset.keyboardNavigation = "";
	next.focus({
		preventScroll: true,
		focusVisible: true
	});
};
var scrollLines = (scroller, direction, lines) => {
	scroller.scrollTop += direction * lines * lineHeight(scroller);
};
var lineScroll = (direction) => {
	const lines = takeCount();
	const scroller = lineScroller(direction);
	if (!scroller) return;
	scrollLines(scroller, direction, lines);
	afterLayout(() => {
		if (scroller.matches("[data-message-scroller]")) {
			if (!boxHasKeys()) keepCursorInView(scroller, direction, true);
		} else keepFocusInView(scroller, [...scroller.querySelectorAll("button, a[href]")].filter(visible), direction);
	});
};
// src/help.ts
var helpEl;
var helpCard;
var helpReturn;
var helpReturnMode;
var helpOpenedBy;
var helpPending = "";
var helpCount = 0;
var isHelpOpen = () => !!helpEl;
var markHelpOpenedBy = (event) => {
	helpOpenedBy = event;
};
function closeHelp() {
	if (!helpEl) return;
	helpEl.remove();
	helpEl = helpCard = void 0;
	helpPending = "";
	helpCount = 0;
	const back = helpReturn;
	const mode = helpReturnMode;
	helpReturn = helpReturnMode = void 0;
	if (disposed) return;
	if (back?.isConnected && back !== document.body) {
		back.focus({ preventScroll: true });
		if (mode === "normal" && isEditable(back) && inComposer(back)) set({
			textMode: "normal",
			visual: ""
		});
	} else focusEl(timelineOf(state.region === "side" ? "side" : "main"));
	syncFocus();
}
function openHelp() {
	if (helpEl) return closeHelp();
	helpReturn = document.activeElement ?? void 0;
	helpReturnMode = state.textMode;
	const backdrop = document.createElement("div");
	backdrop.setAttribute("data-vim-help", "");
	Object.assign(backdrop.style, {
		position: "fixed",
		inset: "0",
		zIndex: "2147483001",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		background: "rgba(0, 0, 0, 0.45)"
	});
	const card = document.createElement("div");
	card.className = "ui-card";
	card.setAttribute("role", "dialog");
	card.setAttribute("aria-modal", "true");
	card.setAttribute("aria-label", "Vim keys");
	card.tabIndex = -1;
	Object.assign(card.style, {
		boxSizing: "border-box",
		width: "min(780px, calc(100vw - 48px))",
		maxHeight: "min(80vh, 760px)",
		overflow: "auto",
		padding: "20px 24px",
		outline: "none",
		font: "13px/1.5 system-ui, sans-serif"
	});
	const el = (tag, style, text) => {
		const node = document.createElement(tag);
		Object.assign(node.style, style);
		if (text !== void 0) node.textContent = text;
		return node;
	};
	card.append(el("h2", {
		margin: "0 0 4px",
		font: "600 16px/1.3 system-ui, sans-serif"
	}, "Vim keys"), el("p", {
		margin: "0 0 12px",
		opacity: "0.7"
	}, "j k scroll, Ctrl-d Ctrl-u half a page, gg G top and bottom. q, Esc or ? closes."));
	for (const group of groups()) {
		card.append(el("h3", {
			margin: "14px 0 2px",
			font: "700 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace",
			letterSpacing: "0.04em"
		}, `-- ${group.title} --`), el("p", {
			margin: "0 0 4px",
			opacity: "0.7"
		}, group.intro));
		const rows = el("div", {
			display: "grid",
			gridTemplateColumns: "max-content 1fr",
			columnGap: "16px",
			rowGap: "2px"
		});
		for (const [keys, what] of group.rows) rows.append(el("span", {
			font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
			whiteSpace: "nowrap"
		}, keys), el("span", {}, what));
		card.append(rows);
	}
	backdrop.append(card);
	backdrop.addEventListener("pointerdown", (event) => event.target === backdrop && closeHelp());
	document.body.append(backdrop);
	helpEl = backdrop;
	helpCard = card;
	card.focus({ preventScroll: true });
	syncFocus();
}
function onHelpKey(event) {
	if (!helpEl || event.isComposing || event === helpOpenedBy) return;
	if (event.metaKey || event.altKey) return;
	const card = helpCard;
	const half = () => Math.max(40, card.clientHeight / 2);
	if (event.ctrlKey) {
		if (event.shiftKey || ![
			"d",
			"u",
			"e",
			"y"
		].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const step = {
			d: half(),
			u: -half(),
			e: lineHeight(card),
			y: -lineHeight(card)
		}[event.key];
		card.scrollBy({ top: step });
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	const { key } = event;
	const first = helpPending === "g";
	helpPending = "";
	const n = Math.max(1, helpCount);
	if (/^[0-9]$/.test(key) && (key !== "0" || helpCount > 0)) {
		helpCount = Math.min(helpCount * 10 + Number(key), 999);
		return;
	}
	helpCount = 0;
	switch (key) {
		case "Escape":
		case "q":
		case "?": return closeHelp();
		case "j":
		case "ArrowDown": return card.scrollBy({ top: 48 * n });
		case "k":
		case "ArrowUp": return card.scrollBy({ top: -48 * n });
		case "PageDown":
		case " ": return card.scrollBy({ top: card.clientHeight * .9 });
		case "PageUp": return card.scrollBy({ top: -card.clientHeight * .9 });
		case "g":
			if (first) card.scrollTo({ top: 0 });
			else helpPending = "g";
			return;
		case "Home": return card.scrollTo({ top: 0 });
		case "G":
		case "End": return card.scrollTo({ top: card.scrollHeight });
	}
}
// src/menus.ts
var onMenuKey = (event) => {
	if (!state.enabled || event.defaultPrevented || event.isComposing) return;
	if (event.key !== "j" && event.key !== "k") return;
	const target = event.target;
	if (event.metaKey || event.ctrlKey || event.altKey || isEditable(target)) return;
	const list = target?.closest?.(`${COMMUNITY_POPUP}, [role="menu"]`);
	if (!list) return;
	const items = [...list.querySelectorAll(list.matches("[role=\"menu\"]") ? "[role=\"menuitem\"]:not([aria-disabled=\"true\"])" : "button:not([disabled])")].filter(visible);
	if (!items.length) return;
	event.preventDefault();
	event.stopPropagation();
	const down = event.key === "j";
	const at = items.indexOf(document.activeElement);
	items[at < 0 ? down ? 0 : items.length - 1 : (at + (down ? 1 : -1) + items.length) % items.length].focus();
};
// src/pages.ts
var TOPBAR = [
	"buzz.channels/channels",
	"buzz.reminders/reminders",
	"buzz.agents/agents",
	"buzz.workflows/workflows"
];
var BUNDLED_ORDER = [
	"buzz.channels/channels",
	"buzz.inbox/inbox",
	"buzz.reminders/reminders",
	"buzz.bestie/bestie"
];
var MESSAGES = "buzz.channels/channels";
var pageName = (page) => page.key === MESSAGES ? "Messages" : page.title;
var pageRank = (page) => {
	const slot = BUNDLED_ORDER.indexOf(page.key);
	return slot < 0 ? BUNDLED_ORDER.length : slot;
};
var byShell = (a, b) => pageRank(a) - pageRank(b) || pageName(a).localeCompare(pageName(b), "en") || a.key.localeCompare(b.key, "en");
var pageList = () => {
	const pages = ctx.pages.snapshot().filter((page) => page.primary);
	const top = (page) => TOPBAR.includes(page.key) || page.placement === "topbar";
	return [...pages.filter(top).sort(byShell), ...pages.filter((page) => !top(page)).sort(byShell)];
};
var openPage = (page) => void ctx.navigation.open({
	version: 1,
	kind: "page",
	pluginId: page.pluginId,
	pageId: page.id
}, { focus: "preserve" }).catch(() => {});
var cyclePage = (direction) => {
	const pages = pageList();
	if (!pages.length) return;
	const target = ctx.navigation.snapshot().entry?.target;
	const key = target?.kind === "page" ? `${target.pluginId}/${target.pageId}` : target?.kind === "conversation" ? MESSAGES : "";
	const here = pages.findIndex((page) => page.key === key);
	openPage(pages[((here < 0 ? direction > 0 ? -1 : 0 : here) + direction + pages.length) % pages.length]);
};
var openSettings = (section) => {
	const { status, viewer, origin } = ctx.relay.snapshot();
	const scope = status === "ready" && viewer && origin ? {
		viewer,
		communityOrigin: origin
	} : null;
	const open = (named) => ctx.navigation.open({
		version: 1,
		kind: "settings",
		...named ? { section: named } : {},
		scope
	});
	(async () => {
		try {
			const result = await open(section);
			if (!section || result.status !== "failed") return;
		} catch {
			if (!section) return;
		}
		await open();
	})().catch(() => {});
};
var goPage = (letter) => {
	clearPending();
	if (letter === "t" || letter === "T") return cyclePage(letter === "t" ? 1 : -1);
	if (letter === "s") return openSettings();
	if (letter === "p") return openSettings("plugins");
	const page = pageList().find((entry) => pageName(entry).toLowerCase().startsWith(letter));
	if (page) openPage(page);
};
var afterG = (letter, run) => () => state.operator === "g" ? goPage(letter) : run();
// src/normal.ts
var textKey = timed("textKey", (key) => {
	const selection = document.getSelection();
	if (!state.prefix && /^[0-9]$/.test(key) && (key !== "0" || state.count > 0)) {
		set({ count: Math.min(state.count * 10 + Number(key), 999) });
		return armPending();
	}
	if (state.visual) return visualKey(key);
	if (state.prefix === "g" && !state.operator && "imarwvtTsp".includes(key)) return goPage(key);
	const operator = state.operator;
	const typed = state.count;
	const motion = resolveMotion(key);
	if (motion === PENDING) return;
	const n = takeCount();
	if (operator === "d") {
		if (key === "d") {
			selection.modify("move", "backward", "paragraphboundary");
			selection.modify("extend", "forward", "paragraphboundary");
		} else if (motion && !motion.lines) {
			const origin = gap(selection);
			motion.run(selection, n, typed, true);
			const landed = gap(selection);
			const [start, end] = origin.compareBoundaryPoints(Range.START_TO_START, landed) > 0 ? [landed, origin] : [origin, landed];
			let stop = end;
			if (motion.inclusive) {
				goto(selection, end);
				const c = here(selection);
				if (c !== "" && !isBreak(c)) {
					forward(selection);
					stop = gap(selection);
				}
			}
			select(selection, start, stop, false);
		} else return;
		if (!selection.isCollapsed) document.execCommand("delete");
		return;
	}
	if (motion) {
		if (key === "k" && onFirstRow(selection)) return boxUp(state.region === "side" ? "side" : "main");
		if (key === "h" && (atDraftStart(selection) || insideLeadingRun(selection))) return boxStep(-1);
		if (key === "l" && (atDraftEnd(selection) || paneRight() && stepsIntoTrailingRun(selection))) return boxStep(1);
		motion.run(selection, n, typed);
		clampCursor(selection);
		return;
	}
	switch (key) {
		case "v":
		case "V": return startVisual(key === "v" ? "char" : "line");
		case "i": return enterInsert();
		case "a":
			stepRight(selection);
			return enterInsert();
		case "A":
			lineEnd(selection);
			return enterInsert();
		case "I":
			firstNonBlank(selection);
			return enterInsert();
		case "x":
			for (let i = 0; i < n; i++) {
				const c = here(selection);
				if (c === "" || isBreak(c)) return;
				selection.modify("extend", "forward", "character");
				if (!selection.isCollapsed) document.execCommand("delete");
			}
			return;
		case "d":
			set({ operator: "d" });
			return armPending();
		case "?": return openHelp();
		case "u":
			document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
				key: "z",
				metaKey: apple,
				ctrlKey: !apple,
				bubbles: true,
				cancelable: true
			}));
			if (!selection.isCollapsed) {
				selection.collapseToStart();
				clampCursor(selection);
			}
			return;
	}
});
var onTextKey = (event) => {
	const target = event.target;
	if (!state.enabled || !state.composerNormal || state.textMode !== "normal") return;
	if (!inComposer(target) || !isEditable(target)) return;
	if (event.isComposing || event.keyCode === 229) return;
	if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.key === "e" || event.key === "y")) {
		event.preventDefault();
		event.stopPropagation();
		return lineScroll(event.key === "e" ? 1 : -1);
	}
	if (event.metaKey || event.ctrlKey || event.altKey) return;
	if (event.key === "Escape" || event.key === "Tab") return;
	if (event.key.length > 1 && ![
		"Enter",
		"Backspace",
		"Delete"
	].includes(event.key)) return;
	event.preventDefault();
	event.stopPropagation();
	const helpWas = isHelpOpen();
	textKey(event.key === "Backspace" ? "h" : event.key === "Delete" ? "x" : event.key);
	if (isHelpOpen() && !helpWas) markHelpOpenedBy(event);
};
// src/settings-dialog.ts
var SETTINGS_NAV = "nav[aria-label=\"Settings sections\"]";
var SETTINGS_OWN_KEYS = "select, [role=\"combobox\"], [role=\"listbox\"], [role=\"menu\"], [role=\"menuitem\"], [role=\"option\"]";
var settingsDialog = () => document.querySelector(SETTINGS_NAV)?.closest("[role=\"dialog\"]");
var settingsItems = (dialog) => [...dialog.querySelectorAll(`${SETTINGS_NAV} button:not([aria-label])`)].filter(visible);
var focusSection = (item) => {
	if (!item) return;
	document.documentElement.dataset.keyboardNavigation = "";
	item.focus({
		preventScroll: true,
		focusVisible: true
	});
	item.scrollIntoView({ block: "nearest" });
};
var scrollParent = (el, stop) => {
	for (let node = el; node && node !== stop; node = node.parentElement) if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
	return stop;
};
var onSettingsKey = (event) => {
	if (!state.enabled || event.isComposing || event.keyCode === 229) return;
	if (event.metaKey || event.altKey || event.shiftKey) return;
	const { key } = event;
	const line = event.ctrlKey && (key === "e" || key === "y");
	if (event.ctrlKey && !line) return;
	const digit = !event.ctrlKey && /^[0-9]$/.test(key) && (key !== "0" || state.count > 0);
	if (!line && !digit && key !== "j" && key !== "k" && key !== "h" && key !== "l" && key !== "Enter") return;
	const dialog = settingsDialog();
	const el = event.target;
	if (!dialog || !dialog.contains(el) || isEditable(el) || el.closest?.(SETTINGS_OWN_KEYS)) return;
	if (digit) {
		set({ count: Math.min(state.count * 10 + Number(key), 999) });
		return armPending();
	}
	const items = settingsItems(dialog);
	const content = dialog.querySelector("#settings-content");
	const item = el.closest?.(`${SETTINGS_NAV} button`);
	const current = items.find((entry) => entry.hasAttribute("aria-current")) ?? items[0];
	const swallow = () => {
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	if (line) {
		swallow();
		const direction = key === "e" ? 1 : -1;
		const lines = takeCount();
		if (item) {
			const list = scrollParent(item, dialog);
			scrollLines(list, direction, lines);
			afterLayout(() => keepFocusInView(list, items, direction));
		} else scrollLines(scrollParent(content?.contains(el) ? el : content ?? el, dialog), direction, lines);
		return;
	}
	if (item) {
		if (key === "j" || key === "k") {
			swallow();
			focusSection(items[clamp(items.indexOf(item) + (key === "j" ? 1 : -1), 0, items.length - 1)]);
		} else if (key === "l" || key === "Enter") {
			swallow();
			if (!items.includes(item)) return;
			if (item.getAttribute("aria-current") !== "page" || !content || !visible(content)) item.click();
			afterLayout(() => content?.focus({ preventScroll: true }));
		} else swallow();
		return;
	}
	if (key === "Enter" || key === "l") return;
	swallow();
	if (key === "h") focusSection(current);
	else if (content?.contains(el)) scrollParent(el, dialog).scrollBy({ top: key === "j" ? 48 : -48 });
	else focusSection(current);
};
// src/escape.ts
var onEscapeCapture = (event) => {
	const el = event.target;
	if (event.key !== "Escape" || !state.enabled || event.defaultPrevented) return;
	if (event.isComposing || event.keyCode === 229) return;
	if (!el.closest?.(`[data-panel-workspace], [data-main-workspace], [data-solo-focus-pane]`)) return;
	if (!isEditable(el)) {
		if (!el.matches?.("[data-message-scroller]") || el.closest("[role=\"menu\"], [role=\"listbox\"], [role=\"combobox\"], [role=\"dialog\"], [aria-modal=\"true\"], .xterm")) return;
		event.preventDefault();
		event.stopPropagation();
		return clearPending();
	}
	if (el.closest("form[data-editing]") || el.hasAttribute("aria-activedescendant") || el.getAttribute("aria-expanded") === "true") return;
	event.preventDefault();
	event.stopPropagation();
	escape();
};
var onPointerDown = () => {
	if (state.visual) set({ visual: "" });
};
// src/lifecycle.ts
var mount = () => {
	resetBar();
	renderBar();
	const stopRender = subscribe(() => renderBar());
	document.head.append(cursorStyle);
	document.body.append(bar);
	watchCursors();
	const revisions = window.__vimRevisions ??= {
		applied: 0,
		disposed: 0
	};
	revisions.applied++;
	const undo = [];
	const listen = (type, name, fn) => {
		const wrapped = timed(name, fn);
		document.addEventListener(type, wrapped, true);
		undo.push(() => document.removeEventListener(type, wrapped, true));
	};
	listen("focusin", "onFocusIn", onFocusIn);
	listen("focusout", "onFocusOut", onFocusOut);
	listen("keydown", "onSettingsKey", onSettingsKey);
	listen("keydown", "onLeaderKey", onLeaderKey);
	listen("keyup", "onLeaderKeyUp", onLeaderKeyUp);
	listen("keydown", "onEscapeCapture", onEscapeCapture);
	listen("keydown", "onTextKey", onTextKey);
	listen("keydown", "onMenuKey", onMenuKey);
	listen("keydown", "onAnyKey", onAnyKey);
	listen("keydown", "onHelpKey", onHelpKey);
	listen("pointerdown", "onPointerDown", onPointerDown);
	let traced = state.perf;
	start(traced);
	const stopPerf = subscribe(() => {
		if (state.perf === traced) return;
		traced = state.perf;
		start(traced);
	});
	const stopNavigation = ctx.navigation.subscribe(() => setTimeout(syncFocus, 50));
	syncFocus();
	return () => {
		dispose();
		closeHelp();
		stopRender();
		revisions.disposed++;
		stopPerf();
		stop();
		stopNavigation();
		for (const remove of undo) remove();
		delete document.documentElement.dataset.vimDriving;
		cursorStyle.remove();
		unwatchCursors();
		resetCursors();
		bar.remove();
		resetBar();
		delete bar.dataset.focusVia;
		delete document.documentElement.dataset.vimRegion;
		document.documentElement.removeAttribute("data-vim-on");
		document.documentElement.removeAttribute("data-vim-panes");
		document.documentElement.removeAttribute("data-vim-box");
	};
};
// src/page.ts
var registerPage = () => {
	const React = ctx.react;
	const h = React.createElement;
	const useVim = () => React.useSyncExternalStore(subscribe, () => state);
	const ModeBadge = () => {
		const s = useVim();
		return s.enabled ? h("span", { "aria-label": `Vim ${s.mode} mode` }, s.mode === "insert" ? "I" : "N") : null;
	};
	const table = (rows) => {
		const tier = rows.some((row) => row[2]);
		return h("table", { style: {
			borderCollapse: "collapse",
			marginBottom: "1rem"
		} }, h("tbody", null, rows.map((row) => h("tr", { key: row[0] }, h("td", { style: {
			padding: "2px 16px 2px 0",
			fontFamily: "ui-monospace, monospace",
			whiteSpace: "nowrap",
			verticalAlign: "top"
		} }, row[0]), h("td", { style: { padding: "2px 16px 2px 0" } }, row[1]), tier && h("td", { style: {
			padding: "2px 0",
			opacity: .6,
			whiteSpace: "nowrap",
			verticalAlign: "top"
		} }, row[2])))));
	};
	const toggle = (s, label, field, hint) => h("label", { style: {
		display: "block",
		margin: "0.5rem 0"
	} }, h("input", {
		type: "checkbox",
		checked: s[field],
		onChange: (event) => setting({ [field]: event.target.checked })
	}), ` ${label}`, hint && h("span", { style: { opacity: .6 } }, ` ${hint}`));
	ctx.pages.register({
		id: "main",
		title: "Vim mode",
		primary: true,
		badge: ModeBadge,
		component: function VimPage() {
			const s = useVim();
			return h("section", {
				className: "ui-card",
				style: { padding: "var(--space-panel-inset)" }
			}, h("h1", null, "Vim mode"), h("p", { role: "status" }, `Mode: ${s.mode}. Region: ${s.region}.`), toggle(s, "Vim keys", "enabled"), toggle(s, "Status line", "statusLine", "(the -- NORMAL -- label under the message box)"), toggle(s, "Normal and visual mode inside the message box", "composerNormal", "(Esc in the box keeps the focus; switch this off for a plain box)"), h("label", { style: {
				display: "block",
				margin: "0.5rem 0"
			} }, "Leader key ", h("select", {
				"aria-label": "Leader key",
				value: s.leader,
				onChange: (event) => setting({ leader: event.target.value })
			}, Object.entries(LEADERS).filter(([id, spec]) => !spec.mac || apple || id === s.leader).map(([id, spec]) => h("option", {
				key: id,
				value: id
			}, spec.label))), h("span", { style: { opacity: .6 } }, " (then h or l: next pane; q: close the thread; < > | =: resize it. Works in the message box too)")), h("label", { style: {
				display: "block",
				margin: "0.5rem 0"
			} }, "Performance trace ", h("select", {
				"aria-label": "Performance trace",
				value: s.perf,
				onChange: (event) => setting({ perf: event.target.value })
			}, PERF_LEVELS.map((entry) => h("option", {
				key: entry.id || "off",
				value: entry.id
			}, entry.label))), h("span", { style: { opacity: .6 } }, " (for measuring the plugin; off by default. Ctrl+Alt+Shift+P copies the numbers as JSON, Ctrl+Alt+Shift+R starts over)")), h("p", { style: { opacity: .7 } }, "The same list opens over any page with ?. The last column says how each key reaches the app; see NOTES.md."), ...groups().flatMap((group) => [
				h("h2", { key: `${group.title}-title` }, group.title),
				h("p", {
					key: `${group.title}-intro`,
					style: { opacity: .7 }
				}, group.intro),
				h("div", { key: group.title }, table(group.rows))
			]), h("input", {
				"aria-label": "Vim typing check",
				placeholder: "Plain keys never act while you type here",
				style: { width: "100%" }
			}));
		}
	});
};
// src/shortcuts.ts
var eligible = () => state.enabled && contextOk();
var ctrl = (letter) => apple ? {
	key: letter,
	ctrl: true
} : {
	key: letter,
	mod: true
};
var registerShortcuts = () => {
	let order = 0;
	const key = (id, title, binding, run, extra = {}) => ctx.shortcuts.register({
		id,
		title,
		binding,
		run: timed(`key ${id}`, run),
		when: timed("eligible", eligible),
		order: order += 10,
		...extra
	});
	key("down", "Next message / channel", { key: "j" }, () => step(1), { repeat: true });
	key("up", "Previous message / channel", { key: "k" }, () => step(-1), { repeat: true });
	key("top", "Go to top (press twice)", { key: "g" }, () => {
		if (state.operator === "g") {
			clearPending();
			return jumpEdge(false);
		}
		set({ operator: "g" });
		armPending();
	});
	key("bottom", "Go to latest", {
		key: "G",
		shift: true
	}, () => jumpEdge(true));
	key("half-down", "Scroll half a page down", ctrl("d"), () => halfPage(1), { repeat: true });
	key("half-up", "Scroll half a page up", ctrl("u"), () => halfPage(-1), { repeat: true });
	key("line-down", "Scroll one line down, the cursor stays", ctrl("e"), () => lineScroll(1), { repeat: true });
	key("line-up", "Scroll one line up, the cursor stays", ctrl("y"), () => lineScroll(-1), { repeat: true });
	key("left", "Focus the region to the left", { key: "h" }, () => shiftRegion(-1));
	key("right", "Focus the region to the right (opens a channel)", { key: "l" }, () => shiftRegion(1));
	key("next-channel", "Next channel", { key: "]" }, () => switchChannel(1));
	key("previous-channel", "Previous channel", { key: "[" }, () => switchChannel(-1));
	key("insert", "Insert: focus the message box", { key: "i" }, afterG("i", () => startInsert()));
	key("insert-after", "Append: focus the message box, after the character under the caret", { key: "a" }, afterG("a", () => startInsert("after")));
	key("append", "Insert at the end of the draft", {
		key: "A",
		shift: true
	}, () => startInsert("end"));
	key("reply", "Reply in a thread to the message under the cursor", { key: "r" }, afterG("r", () => void rowControl("Reply")));
	key("message-menu", "Open the menu of the message under the cursor", { key: "m" }, afterG("m", () => void rowControl("More message actions")));
	key("page-next", "After g: next page", { key: "t" }, () => state.operator === "g" && goPage("t"));
	key("page-previous", "After g: previous page", {
		key: "T",
		shift: true
	}, () => state.operator === "g" && goPage("T"));
	key("page-workflows", "After g: Workflows", { key: "w" }, afterG("w", () => {}));
	key("page-vim", "After g: the Vim mode page (its switches)", { key: "v" }, afterG("v", () => {}));
	key("settings", "After g: open Settings (the host also has Cmd/Ctrl+,)", { key: "s" }, () => state.operator === "g" && goPage("s"));
	key("plugins", "After g: open Settings on Manage plugins", { key: "p" }, () => state.operator === "g" && goPage("p"));
	key("next-community", "Next community", {
		key: "}",
		shift: true
	}, () => void switchCommunity(1));
	key("previous-community", "Previous community", {
		key: "{",
		shift: true
	}, () => void switchCommunity(-1));
	key("communities", "Open the community switcher", {
		key: "C",
		shift: true
	}, () => void openCommunityPicker());
	key("open-thread", "Open the thread of the message under the cursor, at its end; in a thread, open or fold the replies to it (after z: show the thread pane)", { key: "o" }, afterG("o", () => state.operator === "z" ? showPane() : openOrFold()));
	key("open-thread-enter", "Open the thread of the message under the cursor", { key: "Enter" }, () => void openThread(), { when: () => eligible() && enterOpens() });
	key("close-thread", "Close the active thread", { key: "q" }, afterG("q", closeThread));
	key("fold", "Fold prefix: zc hides the thread pane, zo shows it", { key: "z" }, afterG("z", () => {
		set({ operator: "z" });
		armPending();
	}));
	key("close-pane", "After z: hide the thread pane", { key: "c" }, afterG("c", () => state.operator === "z" && hidePane()));
	key("pane-wider", "Widen the thread pane", {
		key: ">",
		shift: true
	}, () => void resizePane("wider"), { repeat: true });
	key("pane-narrower", "Narrow the thread pane", {
		key: "<",
		shift: true
	}, () => void resizePane("narrower"), { repeat: true });
	key("pane-widest", "Make the thread pane as wide as it goes", {
		key: "|",
		shift: true
	}, () => void resizePane("widest"));
	key("pane-reset", "Reset the thread pane width", { key: "=" }, () => void resizePane("reset"));
	key("search", "Search this conversation", { key: "/" }, () => {
		if (!pressHostChord("f")) pressHostChord("k");
	});
	key("help", "Show the Vim keys over the page", {
		key: "?",
		shift: true
	}, openHelp);
	key("normal", "Normal mode: leave the message box", { key: "Escape" }, escape, {
		allowInEditable: true,
		when: () => state.enabled && !!timelineOf("main")
	});
	for (const digit of "1234567890") key(`count-${digit}`, `Count prefix ${digit}`, { key: digit }, () => {
		set({ count: Math.min(state.count * 10 + Number(digit), 999) });
		armPending();
	}, { when: () => eligible() && (digit !== "0" || state.count > 0) });
	key("toggle", "Turn Vim keys on or off", {
		key: "e",
		mod: true,
		shift: true
	}, () => setting({ enabled: !state.enabled }), {
		when: () => true,
		allowInEditable: true
	});
};
// src/index.ts
var inject = [
	"react",
	"pages",
	"shortcuts",
	"navigation",
	"relay",
	"conversation"
];
function apply(ctx) {
	setContext(ctx);
	resetState();
	resetCursors();
	resetMotions();
	resetVisual();
	resetLeader();
	reset();
	resetCommunities();
	registerFocusBridge();
	ctx.effect(mount);
	registerShortcuts();
	registerPage();
}
export { apply, inject };
