// What the build holds the one dependency that ships in plugin.js to. pnpm's frozen lockfile already pins ghostty-web 0.4.0 by the
// integrity hash of its tarball; these pin what is inside it, so a different tarball or a different file inside one fails the build.
export const GHOSTTY_WEB = "0.4.0";
/** sha256 of ghostty-vt.wasm in that package, the file inlined into plugin.js. */
export const WASM_SHA256 = "d6f0326f1874ad2ce9f289e3a4a0c5f3507d4cb38d8747e4b287def470a0c60a";
