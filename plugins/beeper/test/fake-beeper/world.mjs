// Made-up people, chats and messages for tests and screenshots. Nothing here is, or is
// derived from, a real conversation. Names are the usual placeholders (Example, Sample,
// Test, Demo); there are no phone numbers, emails or real handles.

const NETWORKS = ["WhatsApp", "Signal", "Telegram", "Instagram", "iMessage", "Slack", "Discord", "Messenger"];

const PEOPLE = ["Alice Example", "Bob Sample", "Carol Test", "Dave Demo", "Erin Placeholder", "Frank Fixture", "Grace Mock", "Heidi Stub"];

const LINES = [
  "Are we still on for lunch tomorrow?",
  "Yes, noon works for me.",
  "I will bring the notes from last week.",
  "Great, see you there.",
  "Did you get a chance to look at the draft?",
  "Not yet, I will read it tonight.",
  "No rush.",
  "Thanks for sending that over.",
  "Can you move the call to 3?",
  "Sure, 3 is fine.",
  "The build is green again.",
  "Nice work.",
  "Reminder: the library closes early today.",
  "Heading out now.",
  "Running five minutes late.",
  "No problem, I will order for both of us.",
  "Happy birthday!",
  "Thank you!",
  "What time does the market open?",
  "Nine, I think.",
];

const START = Date.parse("2026-10-20T08:00:00Z");

/**
 * @param {{ chats?: number, messages?: number, now?: number }} [options]
 *   `now` is the clock the newest message is relative to (default: a fixed instant).
 */
export function makeWorld({ chats = 12, messages = 30, now = Date.parse("2026-10-24T12:00:00Z") } = {}) {
  const chatList = [];
  const byChat = new Map();
  for (let i = 0; i < chats; i += 1) {
    const person = PEOPLE[i % PEOPLE.length];
    const group = i % 5 === 2;
    const title = group ? `Project ${["Falcon", "Heron", "Osprey", "Kestrel"][i % 4]} crew ${i}` : i < PEOPLE.length ? person : `${person} ${i}`;
    const id = `!fake${String(i).padStart(3, "0")}:beeper.example`;
    const items = [];
    for (let n = 0; n < messages; n += 1) {
      const mine = (n + i) % 3 === 0;
      const at = now - (messages - n) * (i + 1) * 6 * 60_000;
      const sender = mine ? "You" : group ? PEOPLE[(i + n) % PEOPLE.length] : person;
      items.push({
        id: `m${i}-${n}`,
        accountID: `fake-${NETWORKS[i % NETWORKS.length].toLowerCase()}`,
        chatID: id,
        senderID: mine ? "@you:beeper.example" : `@${sender.split(" ")[0].toLowerCase()}:beeper.example`,
        senderName: sender,
        sortKey: String(1000 + n).padStart(8, "0"),
        timestamp: new Date(at).toISOString(),
        text: LINES[(i * 7 + n) % LINES.length],
        type: "TEXT",
        isSender: mine,
      });
    }
    const last = items[items.length - 1];
    chatList.push({
      id,
      accountID: last.accountID,
      network: NETWORKS[i % NETWORKS.length],
      title,
      type: group ? "group" : "single",
      unreadCount: i % 4 === 0 ? (i % 3) + 1 : 0,
      lastActivity: last.timestamp,
      isMuted: i % 6 === 3,
      isPinned: i === 1,
      participants: { total: group ? 4 : 2, hasMore: false, items: [] },
    });
    byChat.set(id, items);
  }
  // A read-only chat, an archived one, a chat with media and a reaction, and a merged shell
  // whose members are listed too: the cases the plugin has to treat differently.
  const readOnly = chatList[chats > 4 ? 4 : 0];
  readOnly.isReadOnly = true;
  const archived = chatList[chats > 6 ? 6 : 0];
  if (archived !== chatList[0]) archived.isArchived = true;
  const media = byChat.get(chatList[0].id);
  media.push(
    { ...media[0], id: "m-img", sortKey: "00009001", timestamp: new Date(now - 4 * 60_000).toISOString(), type: "IMAGE", text: undefined, isSender: false, attachments: [{ fileName: "photo.jpg", type: "img" }] },
    { ...media[0], id: "m-voice", sortKey: "00009002", timestamp: new Date(now - 3 * 60_000).toISOString(), type: "VOICE", text: undefined, isSender: false, attachments: [{ type: "audio", isVoiceNote: true }] },
    { ...media[0], id: "m-react", sortKey: "00009003", timestamp: new Date(now - 2 * 60_000).toISOString(), type: "REACTION", text: "👍", isSender: true },
    { ...media[0], id: "m-multi", sortKey: "00009004", timestamp: new Date(now - 60_000).toISOString(), type: "TEXT", text: "First line\nSecond line, with <b>markup</b> & an & ampersand", isSender: false },
  );
  chatList[0].lastActivity = new Date(now - 60_000).toISOString();
  if (chats > 8) {
    chatList[7].mergedIntoChatID = "!merged:beeper.example";
    chatList.push({
      id: "!merged:beeper.example",
      accountID: "merged",
      network: "Merged",
      title: chatList[7].title,
      type: "single",
      unreadCount: 0,
      lastActivity: chatList[7].lastActivity,
      merge: { chatIDs: [chatList[7].id] },
      participants: { total: 2, hasMore: false, items: [] },
    });
  }
  return { chats: chatList, messages: byChat, now };
}
