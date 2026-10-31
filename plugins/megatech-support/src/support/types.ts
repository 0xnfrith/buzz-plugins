// The service's JSON contract, version 1 (proposed in the pull request; the service's team agrees it). Field names are the wire's.

/** `POST /v1/identity/challenge` */
/** `expires_in` is seconds from the reply (10 to 3600): a length of time, so the two clocks are never compared. */
export type Challenge = { challenge: string; expires_in: number };

/** `POST /v1/identity/verify` */
/** `expires_in` is seconds from the reply (10 to 86400). */
export type Session = { session: string; expires_in: number };

/** `POST /v1/ask` and `POST /v1/tickets`: a ticket always exists afterwards; `answer` only when the service had one within the call. */
export type Asked = { ticket_id: string; answer?: string };
export type Opened = { ticket_id: string; status: string };

export type TicketSummary = { ticket_id: string; subject: string; status: string; updated_at: string };

export type TicketMessage = { from: "you" | "support"; at: string; text: string };

export type TicketDetail = TicketSummary & { messages: TicketMessage[] };

/** Limits the plugin keeps to before it sends anything; the service may be stricter. */
export const LIMITS = { question: 4000, subject: 200, body: 8000 } as const;

/**
 * The identity proof the plugin sends: the owner attestation (NIP-OA) Buzz makes for the signed-in user, `["auth", owner, conditions, sig]`,
 * with no conditions. `sig` is the user's BIP-340 signature over `sha256("nostr:agent-auth:" + N + ":" + conditions)`, where N is
 * `sha256("megatech-support:v1:" + challenge)` in lowercase hex. N is a hash, never a public key.
 */
export type Attestation = readonly ["auth", string, "", string];
