import { SupportError, type SupportClient } from "./client";
import type { Identity } from "./identity";
import { LIMITS, type Asked, type TicketDetail } from "./types";

/** How many unfinished questions and forms are remembered, each with the key that makes its retry the same ticket. */
const REMEMBERED = 50;

/**
 * What the page, the agent type and the tools share: the two things an agent may do, on the verified session. A request the service
 * answers with 401 means the session is over, and the identity goes back to unverified so the page asks to verify again, unless a newer
 * session replaced the one the request was sent with (then the 401 is about the old one and nothing is ended).
 *
 * A question or a ticket gets an `Idempotency-Key` that is kept while its attempt has not succeeded: a retry of the same text, by the
 * person or by an agent whose call timed out, is the same ticket and not a second one. Different text, or the same text once it has
 * succeeded, is a new key.
 */
export function createSupport({ client, identity, newKey = () => crypto.randomUUID() }: { client: SupportClient; identity: Identity; newKey?: () => string }) {
  const keys = new Map<string, string>();
  const keyFor = (content: string): string => {
    let key = keys.get(content);
    if (!key) {
      key = newKey();
      keys.set(content, key);
      if (keys.size > REMEMBERED) keys.delete(keys.keys().next().value as string);
    }
    return key;
  };
  const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
    if (!identity.verified()) throw new SupportError("no-session");
    const session = client.epoch();
    try {
      return await work();
    } catch (error) {
      if (error instanceof SupportError && error.kind === "session-ended" && client.epoch() === session) identity.ended();
      throw error;
    }
  };
  const once = async <T>(content: string, work: (key: string) => Promise<T>): Promise<T> => {
    const key = keyFor(content);
    const done = await guarded(() => work(key));
    keys.delete(content);
    return done;
  };
  return {
    /** Whether a session is held, whether or not Buzz can say right now which key is signed in. */
    verified: (): boolean => identity.verified(),
    /** The key the identity is verified for, while it is and Buzz confirms it. */
    verifiedKey: (): string | undefined => identity.verifiedKey(),
    /** Asks, which opens a ticket if the service has no answer within the call. */
    async askOrOpen(question: string): Promise<Asked> {
      const text = question.trim();
      if (!text || text.length > LIMITS.question) throw new SupportError("invalid");
      return once(`ask\u0000${text}`, (key) => client.ask(text, key));
    },
    async open(subject: string, body: string) {
      const s = subject.trim();
      const b = body.trim();
      if (!s || s.length > LIMITS.subject || !b || b.length > LIMITS.body) throw new SupportError("invalid");
      return once(`open\u0000${s}\u0000${b}`, (key) => client.open(s, b, key));
    },
    list: () => guarded(() => client.list()),
    detail: (id: string): Promise<TicketDetail> => guarded(() => client.detail(id)),
    status: async (id: string): Promise<{ ticket_id: string; status: string }> => {
      const ticket = await guarded(() => client.detail(id));
      return { ticket_id: ticket.ticket_id, status: ticket.status };
    },
  };
}

export type Support = ReturnType<typeof createSupport>;
