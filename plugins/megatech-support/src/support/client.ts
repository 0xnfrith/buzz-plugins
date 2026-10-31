import type { HostRequest, HostResponse } from "../buzz";
import { SUPPORT_ORIGIN } from "./origin";
import type { Asked, Attestation, Challenge, Opened, Session, TicketDetail, TicketMessage, TicketSummary } from "./types";

export type Transport = (request: HostRequest) => Promise<HostResponse>;

export type SupportErrorKind =
  | "no-session" // nothing verified yet, so no request was made
  | "session-ended" // the service no longer knows the session
  | "identity-refused" // the service did not accept the identity check
  | "rate-limited"
  | "invalid" // the service would not take what was sent
  | "not-found"
  | "network" // the host could not reach the service
  | "unavailable"; // a server error, or a reply that is not the contract's

/** The words shown for each kind. The service's own text is never shown or kept: it can repeat what it was sent. */
export const ERROR_TEXT: Record<SupportErrorKind, string> = {
  "no-session": "Megatech support is not verified yet. Verify your identity first.",
  "session-ended": "Your Megatech support session has ended. Verify again.",
  "identity-refused": "Megatech support did not accept the identity check.",
  "rate-limited": "Megatech support is busy. Try again in a minute.",
  invalid: "Megatech support could not use that. Check what you wrote and try again.",
  "not-found": "That ticket was not found.",
  network: "Could not reach Megatech support.",
  unavailable: "Megatech support is having trouble right now.",
};

export class SupportError extends Error {
  readonly kind: SupportErrorKind;
  /** Epoch milliseconds before which asking again is pointless, when the service said. */
  readonly retryAt: number | undefined;
  constructor(kind: SupportErrorKind, retryAt?: number) {
    super(ERROR_TEXT[kind]);
    this.name = "SupportError";
    this.kind = kind;
    this.retryAt = retryAt;
  }
}

// Starts with a letter or digit: "." and ".." are not ids (they would climb out of /v1/tickets/ in a URL).
const TICKET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{16,256}$/;
const SESSION = /^[\x21-\x7e]{16,2048}$/; // printable ASCII, no space: it goes into one header
const MAX_ANSWER = 20_000;
const MAX_MESSAGES = 500;

/**
 * Calls to the one origin, through the host's declared-origin HTTP client. The session token is kept here in memory only: it is
 * never persisted, rendered, logged, put in a URL or in an error. It goes into one `Authorization` header and nowhere else.
 */
export function createClient(transport: Transport, now: () => number = Date.now, origin: string = SUPPORT_ORIGIN) {
  let token: { value: string; expiresAt: number } | undefined;
  // Counts the sessions this client has held, and ends of them by hand: a request that was sent with an older session must not end
  // a newer one when its 401 comes back late.
  let epoch = 0;

  const call = async (method: "GET" | "POST", path: string, body?: unknown, extra: Record<string, string> = {}, authed = true): Promise<unknown> => {
    if (authed && !token) throw new SupportError("no-session");
    const sentIn = epoch;
    const request: HostRequest = {
      url: origin + path,
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(authed && token ? { authorization: `Bearer ${token.value}` } : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    let response: HostResponse;
    try {
      response = await transport(request);
    } catch {
      // The host's own failure text can name the request; keep ours fixed.
      throw new SupportError("network");
    }
    return parse(response, now(), authed, () => {
      if (authed && sentIn === epoch) token = undefined;
    });
  };

  return {
    hasSession: () => !!token && token.expiresAt > now(),
    sessionExpiresAt: () => token?.expiresAt,
    /** Changes whenever a session is stored or dropped by hand; a request compares it before and after. */
    epoch: () => epoch,
    forget: () => {
      epoch += 1;
      token = undefined;
    },
    /** Drops the session here at once, then tells the service to end it. The service's answer, or none, changes nothing. */
    async logout(): Promise<void> {
      const held = token;
      epoch += 1;
      token = undefined;
      if (!held) return;
      try {
        await transport({ url: origin + "/v1/identity/logout", method: "POST", headers: { accept: "application/json", authorization: `Bearer ${held.value}` } });
      } catch {
        // Ending it here is what matters; the service lets it lapse by itself.
      }
    },

    /** The code, and how long it lives in milliseconds from now (the service says it in seconds, so no clock is compared with ours). */
    async challenge(pubkey: string): Promise<{ challenge: string; lifetimeMs: number }> {
      const reply = obj(await call("POST", "/v1/identity/challenge", { pubkey }, {}, false)) as Partial<Challenge>;
      // The attestation has no expiry of its own, so a code may live five minutes (the contract) and the plugin gives ten at most.
      const seconds = lifetime(reply.expires_in, 600);
      if (typeof reply.challenge !== "string" || !CHALLENGE.test(reply.challenge) || seconds === undefined) throw new SupportError("unavailable");
      return { challenge: reply.challenge, lifetimeMs: seconds * 1000 };
    },

    /** Sends the user's attestation over the one-time code. On success the session is kept (in memory) and its expiry returned. */
    async verify(pubkey: string, challenge: string, auth: Attestation): Promise<number> {
      const reply = obj(await call("POST", "/v1/identity/verify", { pubkey, challenge, auth }, {}, false)) as Partial<Session>;
      const seconds = lifetime(reply.expires_in, 86_400);
      if (typeof reply.session !== "string" || !SESSION.test(reply.session) || seconds === undefined) throw new SupportError("unavailable");
      const expiresAt = now() + seconds * 1000;
      epoch += 1;
      token = { value: reply.session, expiresAt };
      return expiresAt;
    },

    /** `key` makes a retry of the same question the same ticket, not a second one. */
    async ask(question: string, key: string): Promise<Asked> {
      const reply = obj(await call("POST", "/v1/ask", { question }, { "idempotency-key": key })) as Partial<Asked>;
      if (!ticketId(reply.ticket_id)) throw new SupportError("unavailable");
      if (reply.answer !== undefined && (typeof reply.answer !== "string" || reply.answer.length > MAX_ANSWER)) throw new SupportError("unavailable");
      return reply.answer === undefined ? { ticket_id: reply.ticket_id } : { ticket_id: reply.ticket_id, answer: reply.answer };
    },

    /** `key` makes a retry of the same form the same ticket, not a second one. */
    async open(subject: string, body: string, key: string): Promise<Opened> {
      const reply = obj(await call("POST", "/v1/tickets", { subject, body }, { "idempotency-key": key })) as Partial<Opened>;
      if (!ticketId(reply.ticket_id) || !word(reply.status)) throw new SupportError("unavailable");
      return { ticket_id: reply.ticket_id, status: reply.status };
    },

    async list(): Promise<TicketSummary[]> {
      const reply = obj(await call("GET", "/v1/tickets")) as { tickets?: unknown };
      if (!Array.isArray(reply.tickets) || reply.tickets.length > 200) throw new SupportError("unavailable");
      return reply.tickets.map(summary);
    },

    async detail(id: string): Promise<TicketDetail> {
      if (!ticketId(id)) throw new SupportError("invalid");
      const reply = obj(await call("GET", `/v1/tickets/${encodeURIComponent(id)}`)) as { messages?: unknown };
      const base = summary(reply);
      if (!Array.isArray(reply.messages) || reply.messages.length > MAX_MESSAGES) throw new SupportError("unavailable");
      return { ...base, messages: reply.messages.map(message) };
    },
  };
}

export type SupportClient = ReturnType<typeof createClient>;

function parse(response: HostResponse, now: number, authed: boolean, endSession: () => void): unknown {
  const status = response.status;
  if (status === 401 && authed) {
    endSession();
    throw new SupportError("session-ended");
  }
  // The two identity calls have no ticket to find and nothing of the person's to check: whatever the service refuses them with is a
  // refusal of the identity check, in those words.
  if (!authed && [400, 401, 403, 404, 409, 413, 422].includes(status)) throw new SupportError("identity-refused");
  if (status === 401 || status === 403) throw new SupportError("identity-refused");
  if (status === 429) throw new SupportError("rate-limited", retryAt(response.headers, now));
  if (status === 404) throw new SupportError("not-found");
  if (status === 400 || status === 409 || status === 413 || status === 422) throw new SupportError("invalid");
  if (status < 200 || status >= 300) throw new SupportError("unavailable");
  try {
    return JSON.parse(response.body);
  } catch {
    throw new SupportError("unavailable");
  }
}

function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SupportError("unavailable");
  return value as Record<string, unknown>;
}

const ticketId = (value: unknown): value is string => typeof value === "string" && TICKET_ID.test(value);
const word = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9 _-]{1,32}$/.test(value);

/** A lifetime in whole seconds, from 10 s to `max`: the service says how long, not until when, so a skewed clock cannot matter. */
function lifetime(value: unknown, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= max ? value : undefined;
}

function time(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : undefined;
}

function summary(value: unknown): TicketSummary {
  const row = obj(value);
  const updated = time(row.updated_at);
  if (!ticketId(row.ticket_id) || typeof row.subject !== "string" || row.subject.length > 500 || !word(row.status) || updated === undefined)
    throw new SupportError("unavailable");
  return { ticket_id: row.ticket_id, subject: row.subject, status: row.status, updated_at: new Date(updated).toISOString() };
}

function message(value: unknown): TicketMessage {
  const row = obj(value);
  const at = time(row.at);
  if ((row.from !== "you" && row.from !== "support") || typeof row.text !== "string" || row.text.length > MAX_ANSWER || at === undefined)
    throw new SupportError("unavailable");
  return { from: row.from, at: new Date(at).toISOString(), text: row.text };
}

/** `Retry-After` in seconds (the form the service is asked to use); a minute when it is absent or odd. */
function retryAt(headers: Readonly<Record<string, string>>, now: number): number {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === "retry-after");
  const seconds = Number(entry?.[1]);
  const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
  return now + Math.min(Math.max(wait, 1000), 3_600_000);
}
