// vite inlines this file into plugin.js as a data: URL (`?inline`), the only way a plugin can carry a WASM: API v1 is one file.
declare module "ghostty-web/ghostty-vt.wasm?inline" {
  const dataUrl: string;
  export default dataUrl;
}
