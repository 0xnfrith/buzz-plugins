// The part of Beeper Desktop's API the plugin reads, from the official TypeScript SDK
// (beeper/desktop-api-js at 9d2d14d, generated from Beeper's OpenAPI spec). Fields the plugin
// does not use are left out; every field the plugin uses but the API marks optional is optional.

export type Chat = {
  id: string;
  accountID: string;
  /** Display-only name of the network ("WhatsApp", "Signal"), not a stable key. */
  network: string;
  title: string;
  type: "single" | "group";
  unreadCount: number;
  lastActivity?: string;
  isArchived?: boolean;
  isMuted?: boolean;
  isPinned?: boolean;
  isLowPriority?: boolean;
  isReadOnly?: boolean;
  isMarkedUnread?: boolean;
  /** Present on a merged chat: one person's chats across networks, with no messages of its own. */
  merge?: { chatIDs: string[] };
  /** Set on a chat that belongs to a merged chat. */
  mergedIntoChatID?: string;
  participants?: { total: number };
};

export type MessageType = "TEXT" | "NOTICE" | "IMAGE" | "VIDEO" | "VOICE" | "AUDIO" | "FILE" | "STICKER" | "LOCATION" | "REACTION";

export type Attachment = { fileName?: string; type?: string; isVoiceNote?: boolean; isSticker?: boolean };

export type Message = {
  id: string;
  chatID: string;
  senderID: string;
  senderName?: string;
  /** A unique key that orders messages. */
  sortKey: string;
  timestamp: string;
  text?: string;
  type?: MessageType;
  isSender?: boolean;
  isDeleted?: boolean;
  isHidden?: boolean;
  attachments?: Attachment[];
};

/** The page of items every list endpoint returns. */
export type Page<T> = {
  items: T[];
  hasMore?: boolean;
  oldestCursor?: string | null;
  newestCursor?: string | null;
};

export type Info = { app: { name: string; version: string } };

export type SendResult = { chatID: string; pendingMessageID: string };
