// The variables the shell is started with, built from what Buzz tells a channel panel (`channelContext`): the public ones Buzz's own
// Terminal sets, minus its two session ones. Every value is checked first and left out when it is not what it should be, because a
// value that is not (a newline, a credential in a URL) must never reach a shell's environment.
//
// This is only what the plugin asks for. The bridge then drops everything outside its allowlist (src/bridge.py), so the shell gets
// these and a short list of the app's own variables, and never the rest of the app's environment.

/** `ChannelPanelContext` of block/buzz-app, src/features/panels/service.ts. Public presentation context, not authentication. */
export type ChannelContext = Readonly<{
  scope?: string;
  channelId: string;
  channelName: string;
  viewer: string;
  relayUrl: string;
  threadId?: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ID = /^[0-9a-f]{64}$/i;
/** Buzz's rule for a channel name in a shell's environment (docs/terminal.md): alphanumeric, space, `-_.`, 1-64 characters. */
const SAFE_NAME = /^[A-Za-z0-9 _.-]{1,64}$/;

export const TERMINAL_ENV = { TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Buzz" } as const;

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let check = 1;
  for (const value of values) {
    const top = check >>> 25;
    check = ((check & 0x1ffffff) << 5) ^ value;
    GENERATOR.forEach((generator, bit) => {
      if ((top >>> bit) & 1) check ^= generator;
    });
  }
  return check;
}

/** Bech32 (BIP-173) of `bytes` under `hrp`, as NIP-19 encodes a public key. */
export function bech32(hrp: string, bytes: Uint8Array): string {
  const words: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    for (; bits >= 5; bits -= 5) words.push((accumulator >>> (bits - 5)) & 31);
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) words.push((accumulator << (5 - bits)) & 31);
  const expanded = [...hrp].map((char) => char.charCodeAt(0) >> 5).concat(0, [...hrp].map((char) => char.charCodeAt(0) & 31));
  const mod = polymod([...expanded, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, at) => (mod >>> (5 * (5 - at))) & 31);
  return `${hrp}1${[...words, ...checksum].map((word) => CHARSET[word]).join("")}`;
}

export function npub(hexPublicKey: string): string | undefined {
  if (!HEX_ID.test(hexPublicKey)) return undefined;
  return bech32("npub", Uint8Array.from(hexPublicKey.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16)));
}

/** A WebSocket URL without credentials, a query or a fragment, or nothing if it is not one. */
export function relayUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const text = url.toString();
    return /^[\x21-\x7e]+$/.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/** What the plugin asks the host to start the bridge with. Variables whose value does not check out are left out. */
export function shellEnv(context: ChannelContext): Record<string, string> {
  const env: Record<string, string> = { ...TERMINAL_ENV };
  const channelId = UUID.test(context.channelId) ? context.channelId : undefined;
  if (channelId) env.BUZZ_CHANNEL_ID = channelId;
  const name = SAFE_NAME.test(context.channelName) ? context.channelName : channelId;
  if (name) env.BUZZ_CHANNEL = name;
  const key = npub(context.viewer);
  if (key) env.BUZZ_NPUB = key;
  const relay = relayUrl(context.relayUrl);
  if (relay) env.BUZZ_RELAY_URL = relay;
  if (context.threadId && HEX_ID.test(context.threadId)) env.BUZZ_THREAD_ID = context.threadId.toLowerCase();
  return env;
}
