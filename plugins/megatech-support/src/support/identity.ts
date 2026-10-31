import type { RelayData } from "../buzz";
import { ERROR_TEXT, SupportError, type SupportClient } from "./client";
import type { Attestation } from "./types";

/**
 * The identity check. The service sends a one-time code; the plugin asks Buzz for the signed-in user's owner attestation (NIP-OA) over
 * a hash of that code; the service checks the signature offline. Nothing is published, and the plugin never sees a key: Buzz signs.
 *
 * Why this is safe to use as a login proof. An attestation is Buzz's way of saying "this key may act as an agent of mine": a signature
 * by the user over `sha256("nostr:agent-auth:" + <64 hex> + ":")`. The 64 hex asked for here is N = sha256("megatech-support:v1:" +
 * code), a hash that nobody holds a key for, so the attestation authorises nothing. The plugin computes N itself and never signs a
 * value the service chose, which is what keeps it inert: a service that sent a public key it holds would otherwise be handed the
 * user's authority. The attestation has no expiry of its own (Buzz always signs it with empty conditions: the call takes none), so
 * the service enforces single use and a five-minute life of the code.
 *
 * The call is not in Buzz's plugin documentation: it is on the host object (`Host.prepareRemoteAgentAuthorization`) because Buzz's
 * hosted agents need it. If a later Buzz removes it or changes what it returns, the check fails closed (see `checkAttestation`).
 */
export const DOMAIN = "megatech-support:v1:";
/** How long the host may take to sign before the check gives up. */
const SIGN_WAIT_MS = 20_000;
/** A code with less than this left is not worth sending. */
const FRESH_MS = 30_000;

/**
 * The one call of Buzz's host the check uses, behind an interface so another route (a signed message, say) can take its place.
 * `available` says whether the route exists at all, so a Buzz without it is found out before anything is sent to the service.
 */
export type Prover = ((viewer: string, challenge: string, signal: AbortSignal) => Promise<Attestation>) & { available?: () => boolean };

export type IdentityState =
  /** `ended` is set when a session was lost, not asked to end: the page says so and keeps what was typed. */
  | { status: "unverified"; ended?: true }
  | { status: "verifying" }
  | { status: "verified"; expiresAt: number }
  | { status: "failed"; text: string };

export type IdentityDeps = {
  client: SupportClient;
  relay: RelayData;
  prove: Prover;
  now?: () => number;
  /** Test seam: how long to wait for the host to sign. */
  signWaitMs?: number;
};

/** A check that failed for a reason of ours, with the words to show. */
export class IdentityError extends Error {
  constructor(text: string) {
    super(text);
    this.name = "IdentityError";
  }
}

export const CANNOT_CHECK = "This version of Buzz cannot check your identity for Megatech support.";
export const COULD_NOT_SIGN = "Buzz could not sign the identity check.";
export const ODD_ANSWER = "Buzz answered the identity check in a form Megatech support does not accept.";

/** N: the hash the user's key attests to. Lowercase hex, 64 characters. */
export async function derive(challenge: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(DOMAIN + challenge));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What a host's answer has to look like for the plugin to pass it on; anything else fails the check. */
export function checkAttestation(tag: unknown, viewer: string): Attestation {
  if (
    !Array.isArray(tag) ||
    tag.length !== 4 ||
    tag[0] !== "auth" ||
    tag[1] !== viewer ||
    tag[2] !== "" ||
    typeof tag[3] !== "string" ||
    !/^[0-9a-f]{128}$/.test(tag[3])
  )
    throw new IdentityError(ODD_ANSWER);
  return ["auth", tag[1], "", tag[3]];
}

/**
 * The prover for Buzz's host. It asks for the attestation over N and checks what comes back: the form, and that the owner is the
 * signed-in user, so a host that answers for someone else, with conditions, or with anything but a signature fails the check.
 */
export function hostProver(host: { prepareRemoteAgentAuthorization?: (agentPubkey: string, signal?: AbortSignal) => Promise<unknown> }): Prover {
  const prove: Prover = async (viewer, challenge, signal) => {
    if (typeof host.prepareRemoteAgentAuthorization !== "function") throw new IdentityError(CANNOT_CHECK);
    const n = await derive(challenge);
    let tag: unknown;
    try {
      tag = await host.prepareRemoteAgentAuthorization(n, signal);
    } catch {
      // The host's own failure text can say more than a person needs ("set up your identity first"); ours is fixed.
      throw new IdentityError(COULD_NOT_SIGN);
    }
    return checkAttestation(tag, viewer);
  };
  prove.available = () => typeof host.prepareRemoteAgentAuthorization === "function";
  return prove;
}

export function createIdentity({ client, relay, prove, now = Date.now, signWaitMs = SIGN_WAIT_MS }: IdentityDeps) {
  let state: IdentityState = { status: "unverified" };
  const listeners = new Set<() => void>();
  let running: Promise<void> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  // Bumped each time the person or the clock ends things (Forget, a lost session, leaving): a check that was already running then
  // finds its answer is out of date and keeps nothing, instead of putting a session back.
  let epoch = 0;
  let gone = false;

  const set = (next: IdentityState) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const watchExpiry = (at: number) => {
    clearTimeout(expiry);
    // A session the service ended while the page was open is noticed by the next request; this notices the clock.
    expiry = setTimeout(() => {
      epoch += 1;
      client.forget();
      set({ status: "unverified", ended: true });
    }, Math.max(0, Math.min(at - now(), 2 ** 31 - 1)));
  };

  async function run(mine: number): Promise<void> {
    // A Buzz without the call is found out first: the service is not even asked for a code, and so is not sent the key.
    if (prove.available && !prove.available()) throw new IdentityError(CANNOT_CHECK);
    const viewer = relay.snapshot().viewer;
    if (!viewer || !/^[0-9a-f]{64}$/.test(viewer)) throw new IdentityError("Buzz is not signed in yet. Open a community and try again.");
    const { challenge, lifetimeMs } = await client.challenge(viewer);
    if (lifetimeMs < FRESH_MS) throw new IdentityError("Megatech support sent a code that expires too soon. Try again.");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), signWaitMs);
    let auth: Attestation;
    try {
      auth = await Promise.race([
        prove(viewer, challenge, abort.signal),
        new Promise<never>((_resolve, reject) => {
          abort.signal.addEventListener("abort", () => reject(new IdentityError("Buzz did not sign the identity check in time.")), { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (mine !== epoch) return; // Forget, a lost session or leaving came first: nothing is sent.
    const sessionEnds = await client.verify(viewer, challenge, auth);
    if (mine !== epoch) {
      // The answer came after the person ended things: the session it brought is not kept, and the service is told.
      void client.logout();
      return;
    }
    watchExpiry(sessionEnds);
    set({ status: "verified", expiresAt: sessionEnds });
  }

  const end = (next: IdentityState) => {
    epoch += 1;
    running = undefined;
    clearTimeout(expiry);
    set(next);
  };

  return {
    state: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Whether a request may be made now. */
    verified: () => state.status === "verified" && client.hasSession(),
    /** Starts the check once; callers that arrive while one runs wait for it. */
    verify(): Promise<void> {
      if (running) return running;
      const mine = epoch;
      set({ status: "verifying" });
      const check: Promise<void> = run(mine)
        .catch((error: unknown) => {
          if (mine === epoch && !gone) {
            client.forget();
            set({ status: "failed", text: wording(error) });
          }
          throw error;
        })
        .finally(() => {
          if (running === check) running = undefined;
        });
      running = check;
      return check;
    },
    /** The service said the session is over (a request got a 401): back to unverified, with a reason to show. */
    ended() {
      client.forget();
      end({ status: "unverified", ended: true });
    },
    /** The person's own choice: the session ends here, and the service is told. */
    forget() {
      void client.logout();
      end({ status: "unverified" });
    },
    dispose() {
      gone = true;
      epoch += 1;
      running = undefined;
      clearTimeout(expiry);
      void client.logout();
      listeners.clear();
    },
  };
}

export type Identity = ReturnType<typeof createIdentity>;

/** The words for any failure of the check: ours or the service's, and nothing else (no host or service text). */
export function wording(error: unknown): string {
  if (error instanceof IdentityError) return error.message;
  if (error instanceof SupportError) return ERROR_TEXT[error.kind];
  return "Something went wrong with the identity check.";
}
