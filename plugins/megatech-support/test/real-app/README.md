# Trying the plugin in the real desktop app against the fake service

`ctx.host.request` exists only in the desktop app, and it speaks HTTPS to the exact origin the manifest declares, so the fake service has to look like `https://support.megatech.invalid` to it. Without root and without touching DNS or the system trust store:

1. `CERTS=$(mktemp -d)`, then `test/real-app/certs.sh "$CERTS"` makes a throwaway CA and a certificate for `support.megatech.invalid`, and a bundle (`$CERTS/bundle.crt`) of the system roots plus that CA.
2. `node test/real-app/serve.mjs "$CERTS"` serves the fake over HTTPS on 8447 and runs a CONNECT proxy on 8087 that sends only `support.megatech.invalid` to it and tunnels every other host to where it really is. A plain-HTTP control port on 8088 reports what the fake saw and can make the next request fail (see the header of `serve.mjs`).
3. Start the app with `HTTPS_PROXY=http://127.0.0.1:8087 NO_PROXY=127.0.0.1,localhost SSL_CERT_FILE=<$CERTS/bundle.crt>`. Buzz's HTTP client then trusts the throwaway CA and nothing else changes.
4. Settings, Plugins, Manage plugins, Add, load this plugin's folder, enable it, and open **Megatech support** in the page navigation. Press **Verify**: the app's own host signs the attestation with the signed-in key, and the fake service checks the signature.

The service is made up and holds nothing real. The CA key never leaves that folder, which is kept outside the plugin folder so installing the plugin from its folder cannot take it along. Nothing is published to any relay by the plugin.
