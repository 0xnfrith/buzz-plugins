// Made-up telemetry for the tests: the shape of Buzz's agent frames, with invented keys and ids.
import { dayKey, emptyState } from "../plugin.js";

export const AGENT = "ab".repeat(32);
export const OTHER = "cd".repeat(32);
/** Noon, local time, so a few hours either side stays on one calendar day whatever the time zone. */
export const NOON = new Date(2026, 10, 8, 12, 0, 0).getTime();
export const TODAY = dayKey(NOON);

const stamp = (offsetMs) => new Date(NOON + offsetMs).toISOString();

/** One event of the agent bridge's telemetry, `offsetMs` after noon. */
export const event = (kind, turnId, offsetMs, extra = {}) => ({ kind, seq: 1, turnId, channelId: "room-1", sessionId: "session-1", timestamp: stamp(offsetMs), ...extra });
export const started = (turnId, offsetMs, startedAtOffset = offsetMs) => event("turn_started", turnId, offsetMs, { startedAt: stamp(startedAtOffset), payload: { source: "mention", triggeringEventIds: [] } });
export const finished = (turnId, offsetMs, kind = "turn_completed") => event(kind, turnId, offsetMs, { payload: { outcome: "completed" } });
/** An ACP `session/update` notification arriving from the harness. */
export const update = (turnId, offsetMs, body) => event("acp_read", turnId, offsetMs, { payload: { method: "session/update", params: { update: body } } });
export const toolCall = (turnId, offsetMs, id, body = {}) => update(turnId, offsetMs, { sessionUpdate: "tool_call", toolCallId: id, title: "Read file", kind: "read", status: "in_progress", ...body });
export const toolUpdate = (turnId, offsetMs, id, body = {}) => update(turnId, offsetMs, { sessionUpdate: "tool_call_update", toolCallId: id, ...body });
export const batch = (...events) => ({ kind: "batch", seq: 1, timestamp: stamp(0), payload: { events } });

/** A frame as the session hands it over: the host has already decrypted `plaintext`. */
let counter = 0;
export const frame = (body, agent = AGENT) => ({ id: (++counter).toString(16).padStart(64, "0"), agent, createdAt: Math.floor(NOON / 1000), plaintext: JSON.stringify(body) });

/** Folds events into a fresh state and returns it with the live details. */
export function foldAll(events, agent = AGENT, now = NOON + 3 * 3600_000, foldItem) {
  const state = emptyState();
  const live = {};
  for (const item of events) foldItem(state, live, agent, item, now);
  return { state, live };
}
