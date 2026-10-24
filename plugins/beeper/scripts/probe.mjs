#!/usr/bin/env node
// Checks a real Beeper Desktop the way the plugin reaches it: the manifest's own curl command, with
// the request on stdin (test/host-sim.mjs runs it as Buzz would). It reads, and prints the shape of
// what came back: status, field names, counts. It never prints a message, a chat title, a name, an
// id or the token, so the output is safe to paste into a bug report. It sends nothing and changes
// nothing; `--mark-read` is the one exception and says so.
//
//   BEEPER_ACCESS_TOKEN=... node scripts/probe.mjs [--base-url http://127.0.0.1:23373] [--mark-read]
//
// Needs Node 22.18 or later (it loads the plugin's TypeScript directly).
import { createClient, BeeperError } from "../src/beeper/client.ts";
import { checkBaseUrl, DEFAULT_BASE_URL } from "../src/beeper/config.ts";
import { runCommand } from "../test/host-sim.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const token = process.env.BEEPER_ACCESS_TOKEN;
const base = checkBaseUrl(valueOf("--base-url") ?? DEFAULT_BASE_URL);
if (!base.ok) {
  console.error(base.message);
  process.exit(1);
}
if (!token) {
  console.error("Set BEEPER_ACCESS_TOKEN to an access token from Beeper Desktop (Settings, Developers, Approved connections).");
  process.exit(1);
}

const client = createClient({ run: (command, input) => runCommand(command, input), token: () => token, baseUrl: () => base.value });

const say = (text = "") => console.log(text);
const kind = (value) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);

/** For each field the plugin reads: on how many of the items it is, and what type it has. */
function fields(label, items, names) {
  say(`   ${label} (${items.length}):`);
  for (const name of names) {
    const path = name.split(".");
    const seen = items.map((item) => path.reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), item));
    const present = seen.filter((value) => value !== undefined);
    const types = [...new Set(present.map(kind))].join("|") || "-";
    const how = present.length === items.length ? "always" : present.length === 0 ? "never" : `${present.length}/${items.length}`;
    say(`     ${name.padEnd(22)} ${how.padEnd(8)} ${types}`);
  }
}

async function step(title, fn) {
  try {
    const result = await fn();
    say(`${title} -> ok`);
    return result;
  } catch (error) {
    say(`${title} -> FAILED: ${error instanceof BeeperError ? `${error.kind} (${error.message})` : "unexpected error"}`);
    if (error instanceof BeeperError && error.kind === "unreachable") {
      const found = await client.diagnose();
      say(`   diagnosis: ${found === "curl-missing" ? "the curl program was not found" : found === "unreachable" ? "Beeper Desktop is not answering on this address (not running, or its API is off)" : "Beeper answers, but this reply was too big, too slow, or cut off"}`);
    }
    return undefined;
  }
}

say(`Probing ${base.value} through curl (nothing below is message text, a name or an id)`);
say();
const info = await step("1. GET /v1/info, no token", () => client.info());
if (info) say(`   app: ${info.app?.name} ${info.app?.version}`);

const listed = await step("2. GET /v1/chats", () => client.chats());
const chats = listed?.items;
let first;
if (chats) {
  say(`   ${chats.length} chats; older ones not listed: ${listed.hasMore}`);
  fields("chat fields the plugin reads", chats, ["id", "accountID", "network", "title", "type", "unreadCount", "lastActivity", "isArchived", "isMuted", "isPinned", "isReadOnly", "isMarkedUnread", "merge", "mergedIntoChatID", "participants.total"]);
  const count = (test) => chats.filter(test).length;
  say(`   archived ${count((c) => c.isArchived)}, merged shells ${count((c) => c.merge)}, in a merged chat ${count((c) => c.mergedIntoChatID)}, read-only ${count((c) => c.isReadOnly)}, with unread ${count((c) => c.unreadCount > 0)}`);
  say(`   networks: ${new Set(chats.map((c) => c.network)).size} different`);
  first = chats.find((c) => !c.isArchived && !c.merge);
}
say();

if (first) {
  const page = await step("3. GET /v1/chats/{id}/messages, first listed chat", () => client.messages(first.id));
  if (page) {
    const items = page.items;
    say(`   ${items.length} messages; hasMore ${page.hasMore}; oldestCursor ${page.oldestCursor ? "present" : "absent"}; newestCursor ${page.newestCursor ? "present" : "absent"}`);
    fields("message fields the plugin reads", items, ["id", "chatID", "senderID", "senderName", "sortKey", "timestamp", "text", "type", "isSender", "isDeleted", "isHidden", "attachments"]);
    let down = 0;
    let up = 0;
    for (let i = 1; i < items.length; i += 1) {
      const a = Date.parse(items[i - 1].timestamp);
      const b = Date.parse(items[i].timestamp);
      if (a > b) down += 1;
      else if (a < b) up += 1;
    }
    say(`   order by timestamp: ${down} newer-first steps, ${up} older-first steps (the plugin sorts, so either is fine)`);
    say(`   message types: ${[...new Set(items.map((m) => m.type))].join(", ")}`);
    if (page.hasMore && page.oldestCursor) {
      const older = await step("4. same, one page back (cursor, direction=before)", () => client.messages(first.id, page.oldestCursor));
      if (older) {
        const ids = new Set(items.map((m) => m.id));
        say(`   ${older.items.length} messages; ${older.items.filter((m) => ids.has(m.id)).length} of them also on the first page`);
      }
    } else say("4. paging back -> skipped (the chat fits on one page)");
  }
  say();
  if (flag("--mark-read")) {
    await step("5. POST /v1/chats/{id}/read, first listed chat (changes Beeper: marks it read)", () => client.markRead(first.id));
  } else say("5. POST /v1/chats/{id}/read -> not run (pass --mark-read to run it; it marks the first listed chat read)");
  say("6. POST /v1/chats/{id}/messages (send) -> never run by this script; test sending by hand in the plugin, in a chat you do not mind");
}
