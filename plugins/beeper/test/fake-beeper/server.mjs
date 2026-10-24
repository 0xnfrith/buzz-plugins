// A fake Beeper Desktop API, enough of the real one for the plugin: /v1/info (no token),
// /v1/chats, /v1/chats/{id}/messages (list and send), /v1/chats/{id}/read. Shapes follow
// beeper/desktop-api-js. It listens on loopback only.
import http from "node:http";
import { makeWorld } from "./world.mjs";

export const TEST_TOKEN = "test-token-not-real";
const PAGE = 20;

/**
 * @param {{ token?: string, scopes?: boolean, world?: ReturnType<typeof makeWorld>, port?: number, confirmAfterMs?: number, now?: () => number }} [options]
 *   `listLimit` is the most chats it gives in one page (Beeper's is 200).
 *   `chatPadding` adds that many bytes to each chat in the list, as Beeper's participants do, to test a reply that does not fit.
 *   `now` stamps the messages it creates; a browser test with a fixed clock passes the same instant.
 *   `scopes: false` makes every authorized call answer 403, for the missing-permission state.
 */
export async function startFake({ token = TEST_TOKEN, scopes = true, world = makeWorld(), port = 0, confirmAfterMs = 0, chatPadding = 0, listLimit = 200, now = () => Date.now() } = {}) {
  const requests = [];
  let pendingCounter = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method, path: url.pathname, query: url.search, authorization: req.headers.authorization, contentType: req.headers["content-type"], body: raw });
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(body === undefined ? "" : JSON.stringify(body));
      };
      const path = url.pathname;
      // Test-only: a reply bigger than the host's output limit, and one that never ends.
      if (path === "/__big") return send(200, { items: [], pad: "x".repeat(2 * 1024 * 1024) });
      if (path === "/__slow") return void setTimeout(() => send(200, {}), 8000);
      if (req.method === "GET" && path === "/v1/info")
        return send(200, { app: { name: "Beeper Desktop (fake)", version: "0.0.0", bundle_id: "example.fake" }, endpoints: {}, platform: {}, server: {} });
      if (req.headers.authorization === undefined || req.headers.authorization !== `Bearer ${token}`)
        return send(401, { code: "UNAUTHORIZED", message: "missing or invalid token" });
      if (!scopes) return send(403, { code: "FORBIDDEN", message: "missing scope" });
      const chatMatch = /^\/v1\/chats\/([^/]+)(\/messages|\/read)?$/.exec(path);
      if (req.method === "GET" && path === "/v1/chats") {
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 25), listLimit);
        const sorted = [...world.chats].sort((a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity)));
        const items = sorted.slice(0, limit).map((chat) => (chatPadding ? { ...chat, padding: "x".repeat(chatPadding) } : chat));
        return send(200, { items, hasMore: sorted.length > items.length, oldestCursor: null, newestCursor: null });
      }
      if (!chatMatch) return send(404, { code: "NOT_FOUND", message: "no such route" });
      const id = decodeURIComponent(chatMatch[1]);
      const chat = world.chats.find((candidate) => candidate.id === id);
      const messages = world.messages.get(id);
      if (!chat || !messages) return send(404, { code: "NOT_FOUND", message: "no such chat" });
      if (chatMatch[2] === "/read" && req.method === "POST") {
        chat.unreadCount = 0;
        chat.isMarkedUnread = false;
        return send(200, chat);
      }
      if (chatMatch[2] === "/messages" && req.method === "GET") {
        // Newest first, a page at a time; the cursor is the index of the oldest message sent so far.
        const ordered = [...messages].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.sortKey.localeCompare(a.sortKey));
        const cursor = url.searchParams.get("cursor");
        const start = cursor ? Number(cursor) : 0;
        const items = ordered.slice(start, start + PAGE);
        const end = start + items.length;
        return send(200, { items, hasMore: end < ordered.length, oldestCursor: String(end), newestCursor: String(start) });
      }
      if (chatMatch[2] === "/messages" && req.method === "POST") {
        if (chat.isReadOnly) return send(400, { code: "READ_ONLY", message: "chat is read-only" });
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return send(400, { code: "BAD_REQUEST", message: "bad json" });
        }
        if (typeof body.text !== "string" || !body.text) return send(400, { code: "BAD_REQUEST", message: "text is required" });
        pendingCounter += 1;
        const message = {
          id: `sent-${pendingCounter}`,
          accountID: chat.accountID,
          chatID: id,
          senderID: "@you:beeper.example",
          senderName: "You",
          sortKey: String(50000 + pendingCounter).padStart(8, "0"),
          timestamp: new Date(now()).toISOString(),
          text: body.text,
          type: "TEXT",
          isSender: true,
        };
        const land = () => {
          messages.push(message);
          chat.lastActivity = message.timestamp;
        };
        if (confirmAfterMs > 0) setTimeout(land, confirmAfterMs);
        else land();
        return send(200, { chatID: id, pendingMessageID: `pending-${pendingCounter}` });
      }
      return send(404, { code: "NOT_FOUND", message: "no such route" });
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`;
  return {
    origin,
    token,
    world,
    requests,
    /** A message arrives from someone else. */
    receive(chatID, text) {
      const chat = world.chats.find((candidate) => candidate.id === chatID);
      const messages = world.messages.get(chatID);
      const message = {
        id: `in-${messages.length}`,
        accountID: chat.accountID,
        chatID,
        senderID: "@them:beeper.example",
        senderName: chat.title,
        sortKey: String(60000 + messages.length).padStart(8, "0"),
        timestamp: new Date(now()).toISOString(),
        text,
        type: "TEXT",
        isSender: false,
      };
      messages.push(message);
      chat.lastActivity = message.timestamp;
      chat.unreadCount += 1;
      return message;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // PORT, CHATS and MESSAGES (per chat) shape the fake when it is run by hand, for the desktop app.
  const world = makeWorld({ chats: Number(process.env.CHATS ?? 12), messages: Number(process.env.MESSAGES ?? 30), now: Date.now() });
  const fake = await startFake({ port: Number(process.env.PORT ?? 0), world });
  console.log(`fake Beeper Desktop API on ${fake.origin} (token ${fake.token})`);
}
