import { curlConfig, parseReply } from "./curl.ts";
import type { Chat, Info, Message, Page, SendResult } from "./types.ts";

/** `ctx.host.runCommand`, narrowed to the two commands the manifest declares. */
export type Run = (command: "request" | "curl-version", input?: string) => Promise<string | null>;

export type ErrorKind =
  | "no-token" // nothing saved yet
  | "curl-missing" // the curl program is not on this computer
  | "unreachable" // curl got no answer: Beeper is closed, its API is off, or the reply was too big or too slow
  | "unauthorized" // 401: the token is wrong or revoked
  | "forbidden" // 403: the token lacks a permission
  | "not-found" // 404
  | "too-long" // the message does not fit in one request
  | "unconfirmed" // a send got no answer: Beeper may or may not have taken the message
  | "rejected" // another 4xx
  | "server" // 5xx
  | "bad-reply"; // an answer that is not the JSON the API describes

const MESSAGES: Record<ErrorKind, string> = {
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
  "bad-reply": "Beeper Desktop answered with something this plugin does not understand.",
};

/** The message is fixed text by kind. It never carries a token, a URL or anything Beeper sent back. */
export class BeeperError extends Error {
  readonly kind: ErrorKind;
  constructor(kind: ErrorKind) {
    super(MESSAGES[kind]);
    this.name = "BeeperError";
    this.kind = kind;
  }
}

export type ClientOptions = {
  run: Run;
  /** Read when a request is made, so a changed token takes effect at once. */
  token(): string | undefined;
  baseUrl(): string;
};

/** What a failed attempt to reach Beeper means, found by asking curl and then Beeper itself. */
export type Diagnosis = "curl-missing" | "unreachable" | "reachable";

// Path segments the way Beeper's own SDK writes them: chat ids look like `!abc:beeper.com`.
const segment = (value: string) => value.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);

/** How many chats the list asks for: the most the API gives, and the fewest worth showing. */
const MAX_CHATS = 200;
const MIN_CHATS = 25;

export function createClient({ run, token, baseUrl }: ClientOptions) {
  // Buzz lets a program print 1 MiB, and a chat in Beeper's list comes with up to 20 of its participants. When Beeper is
  // there but the answer does not fit, the list asks for half as many chats, and remembers.
  let chatLimit = MAX_CHATS;
  async function request<T>(
    method: "GET" | "POST",
    path: string,
    options: { query?: Record<string, string | number | undefined>; body?: unknown; authorized?: boolean; token?: string } = {},
  ): Promise<T> {
    const authorized = options.authorized ?? true;
    const secret = authorized ? (options.token ?? token()) : undefined;
    if (authorized && !secret) throw new BeeperError("no-token");
    const query = Object.entries(options.query ?? {})
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");
    const config = curlConfig({ url: `${baseUrl()}${path}${query ? `?${query}` : ""}`, method, token: secret, body: options.body });
    if (config === undefined) throw new BeeperError("too-long");
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
    if (!reply.body.trim()) return undefined as T;
    try {
      return JSON.parse(reply.body) as T;
    } catch {
      throw new BeeperError("bad-reply");
    }
  }

  const chatPath = (chatID: string) => `/v1/chats/${segment(chatID)}`;

  /** After `unreachable`: is it curl, or Beeper? */
  async function diagnose(): Promise<Diagnosis> {
    const version = await run("curl-version").catch(() => null);
    if (version === null) return "curl-missing";
    try {
      await request<Info>("GET", "/v1/info", { authorized: false });
      return "reachable";
    } catch (error) {
      return error instanceof BeeperError && error.kind === "unreachable" ? "unreachable" : "reachable";
    }
  }

  return {
    /** Needs no token: it tells whether Beeper Desktop is up and has its API on. */
    info: () => request<Info>("GET", "/v1/info", { authorized: false }),

    /** The most recent chats, and whether there are older ones that are not here. */
    async chats(): Promise<{ items: Chat[]; hasMore: boolean }> {
      let misses = 0;
      for (;;) {
        try {
          const page = await request<Page<Chat>>("GET", "/v1/chats", { query: { limit: chatLimit } });
          if (!Array.isArray(page?.items)) throw new BeeperError("bad-reply");
          return { items: page.items, hasMore: !!page.hasMore };
        } catch (error) {
          if (!(error instanceof BeeperError) || error.kind !== "unreachable" || chatLimit <= MIN_CHATS) throw error;
          // One slow or lost answer is not a reason to show fewer chats; two in a row from a Beeper that is there is.
          misses += 1;
          if (misses < 2) continue;
          if ((await diagnose()) !== "reachable") throw error;
          chatLimit = Math.max(MIN_CHATS, chatLimit >> 1);
          misses = 0;
        }
      }
    },

    /** One page of a chat's messages, the newest first; `cursor` is `oldestCursor` of the page before. */
    async messages(chatID: string, cursor?: string): Promise<Page<Message>> {
      const page = await request<Page<Message>>("GET", `${chatPath(chatID)}/messages`, {
        query: cursor ? { cursor, direction: "before" } : undefined,
      });
      if (!Array.isArray(page?.items)) throw new BeeperError("bad-reply");
      return page;
    },

    async send(chatID: string, text: string): Promise<SendResult> {
      const result = await request<SendResult>("POST", `${chatPath(chatID)}/messages`, { body: { text } }).catch((error: unknown) => {
        // With no answer there is no knowing whether Beeper took the message before the request ended.
        throw error instanceof BeeperError && error.kind === "unreachable" ? new BeeperError("unconfirmed") : error;
      });
      if (typeof result?.pendingMessageID !== "string") throw new BeeperError("bad-reply");
      return result;
    },

    async markRead(chatID: string): Promise<void> {
      await request<unknown>("POST", `${chatPath(chatID)}/read`, { body: {} });
    },

    /**
     * The settings card's check: does Beeper answer, and does it accept this token for what the
     * page needs? `candidate` tries a token that is not saved yet.
     */
    async probe(candidate?: string): Promise<Info> {
      const info = await request<Info>("GET", "/v1/info", { authorized: false });
      await request<unknown>("GET", "/v1/chats", { query: { limit: 1 }, token: candidate });
      return info;
    },

    diagnose,
  };
}

export type BeeperClient = ReturnType<typeof createClient>;
