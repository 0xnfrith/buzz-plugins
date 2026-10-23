# Trying the plugin in the real desktop app against the fake Linear

`ctx.host.request` exists only in the desktop app, and it speaks HTTPS to the exact origin the manifest declares, so the
fake Linear has to look like `https://api.linear.app` to it. Without root and without touching DNS or the system trust store:

1. `test/real-app/certs.sh test/real-app/out` makes a throwaway CA and a certificate for `api.linear.app`, and a bundle
   (`out/bundle.crt`) of the system roots plus that CA. `out/` is git-ignored.
2. `node test/real-app/serve.mjs test/real-app/out` serves the fake over HTTPS on 8443 and runs a CONNECT proxy on 8080 that
   sends only `api.linear.app` to it and tunnels every other host to where it really is. A plain-HTTP control port on 8081
   reports what the fake saw and can make the next request fail (see the header of `serve.mjs`).
3. Start the app with `HTTPS_PROXY=http://127.0.0.1:8080 SSL_CERT_FILE=<out/bundle.crt>` (and `NO_PROXY=127.0.0.1,localhost`).
   Buzz's HTTP client then trusts the throwaway CA and nothing else changes.
4. Settings, Plugins, Manage plugins, Add, load this folder or import this repository (with the branch), enable it, paste
   the fixture key from `test/fake-linear/world.mjs` in the Linear card, and open **Linear** in the page navigation.

The key in the fixture is made up and opens nothing. The CA key never leaves `out/`.
