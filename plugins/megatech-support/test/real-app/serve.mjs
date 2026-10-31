// The fake service over HTTPS, plus a CONNECT proxy that sends only support.megatech.invalid to it, so the real desktop app can be
// pointed at the fake without touching DNS or the system trust store:
//
//   test/real-app/certs.sh "$CERTS"
//   node test/real-app/serve.mjs "$CERTS"        # HTTPS fake on 8447, proxy on 8087, control on 8088
//   HTTPS_PROXY=http://127.0.0.1:8087 NO_PROXY=127.0.0.1,localhost SSL_CERT_FILE="$CERTS/bundle.crt" buzz-foundation
//
// Every other host is tunnelled to where it really is. The service checks the attestation for real (it is the same fake the tests
// use). Control (plain HTTP, localhost only):
//   GET /log                  what the fake saw: method, path, and the body of the identity calls, with no credential
//   GET /sessions             how many sessions it holds
//   GET /tickets              every ticket it holds, with its messages
//   GET /reply/<ticket>/<text>   support answers a ticket (the text is URL-encoded)
//   GET /refuse/<on|off>      refuse every identity check
//   GET /fail/<path>/<status> the next request to /<path> (e.g. v1/ask) answers with that status
//   GET /forget               the service forgets every session
//   GET /delay/<path>/<ms>    every request to /<path> (e.g. v1/ask) waits that long before the service answers; 0 ends it
import { createServer as https } from "node:https";
import { createServer as http } from "node:http";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeSupport } from "../fake-support/server.mjs";

const dir = process.argv[2] ?? "out";
const HOST = "support.megatech.invalid";
const fake = createFakeSupport();
const delays = new Map(); // path -> milliseconds, set from the control port

const service = https({ key: readFileSync(join(dir, "leaf.key")), cert: readFileSync(join(dir, "leaf.crt")) }, (req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    try {
      const body = Buffer.concat(chunks).toString("utf8");
      const wait = delays.get(req.url.split("?")[0]);
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      const answer = await fake.handle({ url: `https://${HOST}${req.url}`, method: req.method, headers: req.headers, ...(body ? { body } : {}) });
      res.writeHead(answer.status, answer.headers);
      res.end(answer.body);
    } catch {
      res.writeHead(502);
      res.end();
    }
  });
});
service.listen(8447, "127.0.0.1");

const proxy = http();
proxy.on("connect", (req, client, head) => {
  const [host, port] = req.url.split(":");
  const upstream = host === HOST ? connect(8447, "127.0.0.1") : connect(Number(port), host);
  upstream.on("connect", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
});
proxy.listen(8087, "127.0.0.1");

const control = http((req, res) => {
  const [, verb, a, b] = req.url.split("/").map((part) => decodeURIComponent(part));
  let body;
  if (verb === "log") body = fake.log.map(({ method, path, body }) => ({ method, path, ...(path.startsWith("/v1/identity") ? { body } : {}) }));
  else if (verb === "sessions") body = fake.sessions.size;
  else if (verb === "tickets") body = [...fake.tickets.values()].flat();
  else if (verb === "reply") {
    const [pubkey] = [...fake.tickets.keys()];
    fake.reply(pubkey, a, b);
    body = "ok";
  } else if (verb === "refuse") (fake.refuseVerify = a === "on"), (body = "ok");
  else if (verb === "fail") (fake.fail(`/${a}`, { status: Number(b), body: {} }), (body = "ok"));
  else if (verb === "delay") (delays.set(`/${a}`, Number(b)), (body = "ok"));
  else if (verb === "forget") (fake.sessions.clear(), (body = "ok"));
  else body = "unknown";
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});
control.listen(8088, "127.0.0.1");
console.log("fake support service on https://127.0.0.1:8447, proxy on 8087, control on 8088");
