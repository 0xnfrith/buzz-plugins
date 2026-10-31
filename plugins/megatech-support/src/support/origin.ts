/**
 * The one origin the plugin talks to, and the one place it is written. A placeholder until the service has an address: the
 * `.invalid` top-level domain never resolves, so nothing here can reach a real host. manifest.json's `host.networkOrigins` must
 * name exactly this (a test checks it); change the two together.
 */
export const SUPPORT_ORIGIN = "https://support.megatech.invalid";
