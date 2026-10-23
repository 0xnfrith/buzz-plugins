// The fake Linear over HTTPS, plus a CONNECT proxy that sends only api.linear.app to it, so the
// real desktop app can be pointed at the fake without touching DNS or the system trust store:
//
//   test/real-app/certs.sh out
//   node test/real-app/serve.mjs out          # HTTPS fake on 8443, proxy on 8080, control on 8081
//   HTTPS_PROXY=http://127.0.0.1:8080 SSL_CERT_FILE=$PWD/out/bundle.crt buzz-foundation
//
// Every other host is tunnelled to where it really is. Control (plain HTTP, localhost only):
//   GET /ops              counts of the operations the fake has answered
//   GET /state/<ID>       the state slug of an issue, e.g. /state/PLT-110
//   GET /fail/<kind>[/<operation>]   the next request (of that operation) fails: network, server, rate-limit, forbidden, reject
//   GET /touch/<ID>/<slug>           move an issue in "Linear" behind the app's back
import { createServer as https } from "node:https";
import { createServer as http } from "node:http";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeLinear } from "../fake-linear/server.mjs";

const dir = process.argv[2] ?? "out";
const fake = createFakeLinear();

const linear = https({ key: readFileSync(join(dir, "leaf.key")), cert: readFileSync(join(dir, "leaf.crt")) }, (req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    try {
      const answer = await fake.handle({
        url: `https://api.linear.app${req.url}`,
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(answer.status, answer.headers);
      res.end(answer.body);
    } catch {
      res.writeHead(502);
      res.end();
    }
  });
});
linear.listen(8443, "127.0.0.1");

const proxy = http();
proxy.on("connect", (req, client, head) => {
  const [host, port] = req.url.split(":");
  const upstream = host === "api.linear.app" ? connect(8443, "127.0.0.1") : connect(Number(port), host);
  upstream.on("connect", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
});
proxy.listen(8080, "127.0.0.1");

const control = http((req, res) => {
  const [, verb, a, b] = req.url.split("/");
  const slug = (id) => fake.control.world.records.find((r) => r.identifier === id)?.stateId.split(":")[1];
  let body;
  if (verb === "ops") body = fake.control.log.operations;
  else if (verb === "state") body = slug(a);
  else if (verb === "fail") (fake.control.fail(a, b ? { operation: b } : {}), (body = "ok"));
  else if (verb === "touch") (fake.control.touch(a, { stateSlug: b }), (body = "ok"));
  else body = "unknown";
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});
control.listen(8081, "127.0.0.1");
console.log("fake Linear on https://127.0.0.1:8443, proxy on 8080, control on 8081");
