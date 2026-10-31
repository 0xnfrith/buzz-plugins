// A stand-in for the Megatech support service: the proposed contract (see the plugin's NOTES.md), with the identity check done
// for real. It verifies the user's owner attestation (NIP-OA) with @noble: a BIP-340 signature over
// sha256("nostr:agent-auth:" + N + ":"), where N is sha256("megatech-support:v1:" + challenge) in hex. So a test that passes here has shown
// that what the plugin sends is what a real service could check offline. Everything is in memory and runs in-process: `handle(request)`
// takes what `ctx.host.request` takes and returns what it returns. Made-up data only.
import { schnorr } from "@noble/curves/secp256k1.js";
import { createHash, randomBytes } from "node:crypto";

const sha256 = (data) => createHash("sha256").update(data).digest();
const bytesToHex = (bytes) => Buffer.from(bytes).toString("hex");
const hexToBytes = (hex) => {
  if (typeof hex !== "string" || !/^(?:[0-9a-f]{2})+$/.test(hex)) throw new Error("not hex");
  return Uint8Array.from(Buffer.from(hex, "hex"));
};

export const ORIGIN = "https://support.megatech.invalid";
export const DOMAIN = "megatech-support:v1:";
/** How long a code lives: it is used once, within this. */
export const CODE_SECONDS = 300;
const SESSION_SECONDS = 3600;

/** N: what the user's key attests to. A hash, never a public key. */
export const derive = (challenge) => bytesToHex(sha256(Buffer.from(DOMAIN + challenge, "utf8")));
/** What an owner attestation signs (NIP-OA): the agent key and the conditions, here none. */
export const digestOf = (agent, conditions = "") => sha256(Buffer.from(`nostr:agent-auth:${agent}:${conditions}`, "utf8"));

/** What the service does with the attestation; returns the reason it refuses, or undefined. */
export function checkAttestation(auth, { pubkey, challenge }) {
  if (!Array.isArray(auth) || auth.length !== 4) return "not a tag of four";
  const [name, owner, conditions, sig] = auth;
  if (name !== "auth") return "wrong tag";
  if (owner !== pubkey) return "wrong key";
  if (conditions !== "") return "conditions";
  if (typeof sig !== "string" || !/^[0-9a-f]{128}$/.test(sig)) return "bad signature";
  const n = derive(challenge);
  // N is never accepted as a key: it is only ever the hash of a code this service issued.
  if (n === pubkey) return "N is a key";
  try {
    return schnorr.verify(hexToBytes(sig), digestOf(n, conditions), hexToBytes(pubkey)) ? undefined : "bad signature";
  } catch {
    return "bad signature";
  }
}

const json = (status, body, headers = {}) => ({ status, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const refuse = (status, code) => json(status, { error: { code, message: "SECRET-SERVICE-WORDING: never shown" } });

/**
 * `now` is epoch milliseconds and can be moved by the test (`fake.clock.advance`). `modes` lets a test make the service misbehave:
 *   fake.fail("/v1/ask", { status: 500 })      the next call of that path fails (once, or `times`)
 *   fake.refuseVerify = true                    the identity check is refused whatever is sent
 */
export function createFakeSupport({ now = () => Date.now() } = {}) {
  let offset = 0;
  const clock = { now: () => now() + offset, advance: (ms) => void (offset += ms) };
  const challenges = new Map(); // code -> { pubkey, expiresAt, used }
  const sessions = new Map(); // token -> { pubkey, expiresAt }
  const tickets = new Map(); // pubkey -> ticket[]
  const keyed = new Map(); // `${pubkey}:${idempotency key}` -> ticket_id
  const failures = [];
  let counter = 1000;
  const fake = {
    clock,
    log: [], // every request: { method, path, headers, body }
    refuseVerify: false,
    /** Answers the next `times` calls of `path` with `reply` instead. */
    fail(path, reply, times = 1) {
      failures.push({ path, reply, times });
    },
    sessions,
    tickets,
    challenges,
    ticketsOf: (pubkey) => tickets.get(pubkey) ?? [],
    async handle(request) {
      const url = new URL(request.url);
      const entry = {
        method: request.method ?? "GET",
        origin: url.origin,
        path: url.pathname + url.search,
        headers: Object.fromEntries(Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
        body: request.body === undefined ? undefined : JSON.parse(request.body),
      };
      fake.log.push(entry);
      if (url.origin !== ORIGIN) throw new Error("fake service: wrong origin");
      const failing = failures.find((f) => f.path === url.pathname && f.times > 0);
      if (failing) {
        failing.times -= 1;
        if (failing.reply === "throw") throw new Error("SECRET-HOST-WORDING: connection refused");
        return typeof failing.reply === "string" ? { status: 200, headers: {}, body: failing.reply } : json(failing.reply.status, failing.reply.body ?? { error: { code: "x" } }, failing.reply.headers);
      }
      const nowMs = clock.now();
      const send = (status, body) => json(status, body);
      const path = url.pathname;
      const input = entry.body;

      if (entry.method === "POST" && path === "/v1/identity/challenge") {
        if (typeof input?.pubkey !== "string" || !/^[0-9a-f]{64}$/.test(input.pubkey)) return refuse(400, "bad_request");
        const challenge = randomBytes(24).toString("base64url");
        const expiresAt = nowMs + CODE_SECONDS * 1000;
        challenges.set(challenge, { pubkey: input.pubkey, expiresAt, used: false });
        return send(200, { challenge, expires_in: CODE_SECONDS });
      }
      if (entry.method === "POST" && path === "/v1/identity/verify") {
        const known = challenges.get(input?.challenge);
        if (!known) return refuse(403, "identity_refused");
        // Single use: spent by the first attempt, right or wrong.
        const spent = known.used;
        known.used = true;
        const reason =
          fake.refuseVerify || spent || known.expiresAt < nowMs || known.pubkey !== input.pubkey
            ? "refused"
            : checkAttestation(input.auth, { pubkey: input.pubkey, challenge: input.challenge });
        if (reason) {
          fake.lastRefusal = reason;
          return refuse(403, "identity_refused");
        }
        const token = randomBytes(24).toString("base64url");
        const expiresAt = nowMs + SESSION_SECONDS * 1000;
        sessions.set(token, { pubkey: input.pubkey, expiresAt });
        return send(200, { session: token, expires_in: SESSION_SECONDS });
      }

      // Everything else needs the session.
      const bearer = /^Bearer (.+)$/.exec(entry.headers.authorization ?? "")?.[1];
      const session = bearer ? sessions.get(bearer) : undefined;
      if (!session || session.expiresAt < nowMs) return refuse(401, "unauthorized");
      const mine = tickets.get(session.pubkey) ?? tickets.set(session.pubkey, []).get(session.pubkey);
      const summary = (t) => ({ ticket_id: t.ticket_id, subject: t.subject, status: t.status, updated_at: t.updated_at });
      const newTicket = (subject, text, key) => {
        const ticket = {
          ticket_id: `T-${++counter}`,
          subject,
          status: "open",
          updated_at: new Date(nowMs).toISOString(),
          messages: [{ from: "you", at: new Date(nowMs).toISOString(), text }],
        };
        mine.unshift(ticket);
        if (key) keyed.set(`${session.pubkey}:${key}`, ticket.ticket_id);
        return ticket;
      };

      if (entry.method === "POST" && path === "/v1/identity/logout") {
        sessions.delete(bearer);
        return send(200, {});
      }
      if (entry.method === "POST" && path === "/v1/ask") {
        if (typeof input?.question !== "string" || !input.question.trim() || input.question.length > 4000) return refuse(422, "invalid");
        // A retry with the same Idempotency-Key is the same ticket, whatever the text of the retry.
        const askKey = entry.headers["idempotency-key"];
        const seen = askKey && keyed.get(`ask:${session.pubkey}:${askKey}`);
        const first = seen && mine.find((t) => t.ticket_id === seen);
        if (first) {
          const answered = first.messages.find((m) => m.from === "support");
          return send(200, answered ? { ticket_id: first.ticket_id, answer: answered.text } : { ticket_id: first.ticket_id });
        }
        const ticket = newTicket(input.question.slice(0, 80), input.question);
        if (askKey) keyed.set(`ask:${session.pubkey}:${askKey}`, ticket.ticket_id);
        // The service has an answer only for some questions, and only within the call.
        if (/password|reset|invoice/i.test(input.question)) {
          const answer = "You can reset it from Account, then Security. If that does not work, reply here.";
          ticket.status = "answered";
          ticket.messages.push({ from: "support", at: new Date(nowMs).toISOString(), text: answer });
          return send(200, { ticket_id: ticket.ticket_id, answer });
        }
        return send(200, { ticket_id: ticket.ticket_id });
      }
      if (entry.method === "POST" && path === "/v1/tickets") {
        if (typeof input?.subject !== "string" || !input.subject.trim() || typeof input?.body !== "string" || !input.body.trim()) return refuse(422, "invalid");
        const key = entry.headers["idempotency-key"];
        const again = key && keyed.get(`${session.pubkey}:${key}`);
        const ticket = again ? mine.find((t) => t.ticket_id === again) : newTicket(input.subject, input.body, key);
        return send(200, { ticket_id: ticket.ticket_id, status: ticket.status });
      }
      if (entry.method === "GET" && path === "/v1/tickets") return send(200, { tickets: mine.map(summary) });
      const one = /^\/v1\/tickets\/([^/]+)$/.exec(path);
      if (entry.method === "GET" && one) {
        const ticket = mine.find((t) => t.ticket_id === decodeURIComponent(one[1]));
        return ticket ? send(200, { ...summary(ticket), messages: ticket.messages }) : refuse(404, "not_found");
      }
      return refuse(404, "not_found");
    },
    /** What support does by hand: replies on a ticket. */
    reply(pubkey, ticketId, text, status = "answered") {
      const ticket = tickets.get(pubkey)?.find((t) => t.ticket_id === ticketId);
      if (!ticket) throw new Error("no such ticket");
      ticket.messages.push({ from: "support", at: new Date(clock.now()).toISOString(), text });
      ticket.status = status;
      ticket.updated_at = new Date(clock.now()).toISOString();
    },
  };
  return fake;
}

/** A user for tests: a made-up key, and the attestation Buzz makes for it. */
export function createUser(seed = "megatech-support-test-user") {
  const secret = sha256(Buffer.from(seed, "utf8"));
  const pubkey = bytesToHex(schnorr.getPublicKey(secret));
  /** The tag the host returns for an agent key: `["auth", owner, "", sig]`, signed over sha256("nostr:agent-auth:<agent>:"). */
  const authorize = (agent, conditions = "") => ["auth", pubkey, conditions, bytesToHex(schnorr.sign(digestOf(agent, conditions), secret))];
  return { pubkey, authorize, secret };
}

/**
 * The part of Buzz's host the plugin uses for the identity check, with the host's behaviour (`prepareRemoteAgentAuthorization` in
 * block/buzz-app's src/features/host/service.ts): it refuses an agent key that is not 64 lowercase hex or is the owner's own, and
 * answers `["auth", owner, "", sig]`. `mode` makes it answer in a form the plugin has to refuse, or fail, or stall.
 */
export function createFakeHost({ user, mode = "", missing = false } = {}) {
  const calls = [];
  const answers = []; // what it returned, as it returned it
  const host = {
    calls,
    answers,
    mode,
    async prepareRemoteAgentAuthorization(agent, signal) {
      calls.push(agent);
      if (host.mode === "throw") throw new Error("SECRET-HOST-WORDING: set up your identity first");
      if (host.mode === "hang")
        return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      if (!/^[0-9a-f]{64}$/.test(agent)) throw new Error("Agent pubkey must be 64 lowercase hex characters");
      if (agent === user.pubkey) throw new Error("Owner and agent pubkeys must differ");
      const tag = user.authorize(agent);
      switch (host.mode) {
        case "":
          answers.push(tag);
          return tag;
        case "other-owner":
          return ["auth", createUser("somebody-else").pubkey, "", tag[3]];
        case "conditions":
          return ["auth", tag[1], "kind=1", tag[3]];
        case "short-signature":
          return ["auth", tag[1], "", tag[3].slice(0, 100)];
        case "upper-signature":
          return ["auth", tag[1], "", tag[3].toUpperCase()];
        case "not-hex":
          return ["auth", tag[1], "", "z".repeat(128)];
        case "three":
          return tag.slice(0, 3);
        case "five":
          return [...tag, "extra"];
        case "wrong-name":
          return ["nope", tag[1], "", tag[3]];
        case "object":
          return { tag };
        case "string":
          return tag.join(",");
        case "null":
          return null;
        case "signature-for-another-value":
          return user.authorize("f".repeat(64));
        default:
          throw new Error(`unknown mode ${host.mode}`);
      }
    },
  };
  if (missing) delete host.prepareRemoteAgentAuthorization;
  return host;
}
