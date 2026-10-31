import type { HostRequest, HostResponse } from "../buzz";

export const LINEAR_ORIGIN = "https://api.linear.app";
const ENDPOINT = `${LINEAR_ORIGIN}/graphql`;

export type Transport = (request: HostRequest) => Promise<HostResponse>;

export type LinearErrorKind =
  | "no-key" // nothing saved yet
  | "auth" // Linear refused the key (revoked, mistyped, too narrow)
  | "rate-limited"
  | "network" // the host could not reach Linear
  | "rejected" // Linear understood the request and said no (a GraphQL error)
  | "server"; // anything else: an HTTP error or a body that is not GraphQL

export class LinearError extends Error {
  readonly kind: LinearErrorKind;
  /** Epoch milliseconds before which asking again is pointless. */
  readonly retryAt: number | undefined;
  constructor(kind: LinearErrorKind, message: string, retryAt?: number) {
    super(message);
    this.name = "LinearError";
    this.kind = kind;
    this.retryAt = retryAt;
  }
}

type GraphQLBody = {
  data?: unknown;
  // Only the codes are read; the message is Linear's wording and is never shown.
  errors?: { extensions?: { code?: string; type?: string } }[];
};

/**
 * One GraphQL call to Linear, through the host's declared-origin HTTP client. The key is
 * read when the call starts and goes nowhere but the Authorization header: it is not in
 * a URL, an error message, or a log line. Every error's text is fixed here, never taken from Linear's reply.
 */
export function createClient(
  transport: Transport,
  /** The saved key; a promise lets a request wait for the first look at where the key is kept. */
  readKey: () => string | undefined | Promise<string | undefined>,
  now: () => number = Date.now,
) {
  return {
    async request<T>(
      operationName: string,
      query: string,
      variables: Record<string, unknown> = {},
      /** A key to try instead of the saved one, to check a new key before it is kept. */
      candidate?: string,
    ): Promise<T> {
      const key = candidate ?? (await readKey());
      if (!key) throw new LinearError("no-key", "No Linear API key is saved.");
      let response: HostResponse;
      try {
        response = await transport({
          url: ENDPOINT,
          method: "POST",
          // A personal API key is sent as is: `Bearer` is for OAuth tokens.
          headers: { authorization: key, "content-type": "application/json" },
          body: JSON.stringify({ operationName, query, variables }),
        });
      } catch {
        // The host's own failure text can name the request; keep ours generic.
        throw new LinearError("network", "Could not reach Linear.");
      }
      return parse<T>(response, now());
    },
  };
}

export type LinearClient = ReturnType<typeof createClient>;

function parse<T>(response: HostResponse, now: number): T {
  const headers = lowercaseKeys(response.headers);
  let body: GraphQLBody | undefined;
  try {
    body = JSON.parse(response.body) as GraphQLBody;
  } catch {
    body = undefined;
  }
  const first = body?.errors?.[0];
  const code = first?.extensions?.code ?? first?.extensions?.type ?? "";
  if (response.status === 429 || /rate.?limit/i.test(code))
    throw new LinearError(
      "rate-limited",
      "Linear is rate limiting this key.",
      retryAt(headers, now),
    );
  if (response.status === 401 || /authenticat|forbidden/i.test(code))
    throw new LinearError(
      "auth",
      /forbidden/i.test(code)
        ? "This key is not allowed to do that. It needs Read and Write access."
        : "Linear did not accept the API key.",
    );
  if (response.status >= 500)
    throw new LinearError("server", `Linear is having trouble right now (${response.status}).`);
  // Linear's own wording is never shown: a service's error text can repeat what it was sent, the key among it.
  if (first) throw new LinearError("rejected", "Linear refused the request.");
  if (response.status < 200 || response.status >= 300 || !body || body.data == null)
    throw new LinearError("server", `Linear answered with an unexpected response (${response.status}).`);
  return body.data as T;
}

function lowercaseKeys(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

/** Linear says when the window resets in `X-RateLimit-*-Reset`; wait a minute if it does not. */
function retryAt(headers: Record<string, string>, now: number): number {
  const stamps = ["x-ratelimit-requests-reset", "x-ratelimit-complexity-reset"]
    .map((name) => Number(headers[name]))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => (n < 1e12 ? n * 1000 : n)); // seconds or milliseconds since the epoch
  const at = stamps.length ? Math.max(...stamps) : now + 60_000;
  return Math.min(Math.max(at, now + 1000), now + 3_600_000);
}
