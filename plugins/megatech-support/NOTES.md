# Megatech support: notes

What works through the plugin API, what the plugin does not do, what was verified and what was not. Read `docs/building.md` first; this page is the part that is particular to this plugin.

## What it is, and the status

An MVP built **against a mock**. The service it talks to is run by another team and has no address yet, so the origin is a placeholder (`https://support.megatech.invalid`; the `.invalid` top-level domain never resolves) kept in one constant, `src/support/origin.ts`, and in the manifest's `host.networkOrigins`. A test checks that the two are the same. The contract below is a **proposal**: the service's team has not agreed it yet. The plugin does nothing useful until the hosted service exists and the origin is changed.

## Design

- **One page** (`Megatech support`): Ask, Open a ticket, My tickets. Before the identity is verified the page shows one card that says what pressing **Verify** does, and nothing is sent until it is pressed.
- **One Settings card** (Settings, Plugins, Megatech support): the identity (Verify, Verify again, Forget) and the **agent switch**.
- **One origin**, reached only through `ctx.host.request` (Buzz's own HTTPS client: it refuses any other origin and follows no redirects). No commands, no processes, no files.
- **Verify again fails closed.** Pressing it while verified starts a new check; the page shows the Verify card while it runs, and if the new check fails the session that was held is dropped too, rather than kept on a footing the service has just refused. What was typed in the forms is kept above the card, so it is still there afterwards.
- **Forget, a lost session and leaving.** Forget (and the plugin being switched off) end the session here at once and ask the service to end it; a session the service says is over, or whose time is up, ends with a reason the page shows. A check that is still running when any of these happens keeps nothing.
- **Fixed error text.** Every failure shows one of a few fixed sentences (`ERROR_TEXT` in `src/support/client.ts`, and the identity check's own in `src/support/identity.ts`). The service's own wording, and the host's, are never shown, kept or logged, since a service's error can repeat what it was sent.
- **The session token is in memory only.** It is never persisted, rendered, logged, put in a URL or in an error; it goes into one `Authorization` header. Closing Buzz, disabling the plugin or pressing **Forget** ends it here, and Forget and disabling also ask the service to end it (`POST /v1/identity/logout`, answer ignored). The only thing the plugin keeps in `localStorage` is the agent switch (`megatech.support.agent.v1`).

## The identity check: a choice that needs a reviewer's eye

A plugin cannot sign anything itself, and Buzz gives it no signing call. Buzz's own relay service says so in a comment: "Plugins receive read models, never a signer or transport". What the host object does have is `prepareRemoteAgentAuthorization(agentPubkey)`, which Buzz's hosted agents use. It returns the signed-in user's **owner attestation** (NIP-OA), `["auth", owner, "", sig]`: a BIP-340 signature by the user's key over `sha256("nostr:agent-auth:" + agentPubkey + ":")`. It needs no manifest declaration and shows no prompt. This plugin uses it as a login proof:

1. `POST /v1/identity/challenge {pubkey}` returns a one-time code and how long it lives, in seconds (`expires_in`, five minutes). A length of time, not a date, so the plugin never compares its clock with the service's.
2. The plugin computes `N = sha256("megatech-support:v1:" + code)` (lowercase hex) and asks Buzz for the attestation over N. It sends **only N**, never the code and never a value the service chose.
3. `POST /v1/identity/verify {pubkey, challenge, auth}` sends the attestation. The service recomputes N from the code it issued, checks the signature against the key that asked, checks that the tag is exactly `["auth", pubkey, "", sig]`, and that the code is unused and fresh. A code is spent by its first use, right or wrong. It then answers with an opaque session token (about an hour).

**What is repurposed.** An attestation is an authorisation: "this key may act as my agent". Here it is a login proof.

**Why it is inert.** N is a hash of a code the service issued. Nobody holds a key whose public key is N, so the attestation authorises nobody to do anything. The plugin computes N itself, so even a service that sent a public key it holds, as its "code", would be handed nothing: N would be a hash of it. The service must never accept N as a key (N is never a pubkey), and must accept an attestation only for a code it issued, once, within five minutes. Empty conditions mean the attestation is **unconditional**: no expiry and no kinds. So its safety rests entirely on N being a hash nobody holds a key for, and the limits above are the service's to enforce. A unit test has a hostile service send a key it holds, the user's own key and look-alike fields, and checks that Buzz is only ever asked to sign the plugin's own hash.

**What Buzz does and does not do.** The call takes no conditions: Buzz always signs with empty ones, and its own code rejects any other form, so there is nothing to narrow. It publishes nothing. The plugin never sees a key.

**Fail closed.** The check fails, with fixed words and with nothing sent to the service's verify, if the host has no such call, if it throws or does not answer within 20 seconds, or if its answer is not exactly a four-item tag of `"auth"`, the signed-in user's key, `""` and 128 lowercase hex characters. Each of those has a test (`test/unit/identity.test.ts`).

**The risk.** The call is not in Buzz's plugin documentation: it is typed on the host object as optional. Block could restrict it or change what it returns. If it goes, the plugin stops verifying (it does not fall back to anything weaker) until it is changed. Any other installed plugin can ask for the same attestation, which is the model of unsandboxed plugins: a plugin is trusted code in the app.

**Fallbacks, not built.** B: a visible signed message. The plugin can publish an event through the host's outbox and send the signed event, but every kind a plugin may publish is a visible chat or status event, and the host refuses ephemeral kinds (20000-29999) and kind 30078 for plugins (found by reading `nativeWriteKinds` and `relay_sign` in block/buzz-app, and confirmed read-only with `outbox.supports()` in the installed app). C: no identity at all, so no account data. The identity call is behind one interface (`Prover` in `src/support/identity.ts`) so either could replace it.

## The contract (proposed)

```
POST /v1/identity/challenge   {pubkey}                      -> {challenge, expires_in}       expires_in: seconds, 10 to 3600
POST /v1/identity/verify      {pubkey, challenge, auth}     -> {session, expires_in}         expires_in: seconds, 10 to 86400
POST /v1/identity/logout      (no body)                     -> anything; the plugin ignores it
POST /v1/ask                  {question}                    -> {ticket_id, answer?}          Idempotency-Key header
POST /v1/tickets              {subject, body}               -> {ticket_id, status}           Idempotency-Key header
GET  /v1/tickets                                            -> {tickets: [{ticket_id, subject, status, updated_at}]}
GET  /v1/tickets/{ticket_id}                                -> {ticket_id, subject, status, updated_at, messages: [{from, at, text}]}
```

JSON in and out; `Authorization: Bearer <session>` on everything except the first two (and logout, which only needs the session it ends); errors are an HTTP status (401 unknown or ended session, 403 identity refused, 404 no such ticket, 422 or 400 unusable input, 429 with `Retry-After`, 5xx) with a body the plugin ignores. Limits the plugin keeps to: question 4,000 characters, subject 200, body 8,000; ticket ids start with a letter or digit and are `[A-Za-z0-9._:-]{1,64}` (so `.` and `..` are not ids); an answer or a message up to 20,000 characters; 200 tickets and 500 messages. `from` is `you` or `support`. `ask` always leaves a ticket behind and returns its id, with `answer` only when the service had one within the call (Buzz's request deadline is a fixed 30 seconds). A retry of `POST /v1/ask` or `POST /v1/tickets` with the same `Idempotency-Key` returns the same ticket. The plugin keeps a key for a question or form that has not succeeded yet, so its retry (by the person, or by an agent whose call timed out) is the same ticket; different text, or the same text once it has succeeded, is a new key.

`auth` is the four-item attestation tag. The service's rules, which `test/fake-support/server.mjs` carries out and `test/unit/service-check.test.ts` lists: **N is never a pubkey; an attestation is accepted only for a challenge the service issued, once, within 5 minutes.**

## The agent type and the tools

- **Off by default, and only at start.** The agent type `megatech.support/support` and the two tools are added only when the saved switch is on **as Buzz starts**; `apply` reads it once. The card says a restart is needed (turning the plugin off and on starts it again too). Why not live: an agent session lists its tools when it starts and replaces itself when the list changes (a Codex agent starts a new thread and loses its context), so adding or removing tools while Buzz runs would do that to every agent on the device. Turning the switch off afterwards stops the tools and the type at once, though they stay listed until the restart: each call asks the saved switch.
- **Tools** (`megatech_support_ask_or_open`, `megatech_support_ticket_status`): any of the user's agents may call them, while the switch is on and the identity is verified; otherwise they get a fixed error that says to verify first, or that the plugin is off. `ask_or_open({question})` returns `{ticket_id}` and `answer` when there is one; `ticket_status({ticket_id})` returns `{ticket_id, status}`. Their names, descriptions and schemas are frozen by a test, for the reason above. The names start with the plugin's, as `docs/agents.md` asks, and a name another plugin already has is caught, so the plugin still loads and the card lists what was not added.
- **The type has no model.** A type with `run` runs our code, not a language model, and the tools are only handed to harness sessions (Claude, Codex, Goose, Pi). So the support type's `run` answers a mention with the same code as `ask_or_open`, and replies in the thread as the agent. It answers **only the owner's own mention** (anyone in a channel can mention an agent, and the answer would come from the owner's verified session; Buzz's own agent types make the same check and its documentation asks every type to). `run` is tested with fakes in `test/unit/agent.test.ts`; the web build checks that the type is registered, not that it runs. It has **not** been run by a real harness session.

## What was verified

Where, and against what: `test/unit` (Node, vitest) and `test/web/support.spec.mjs` (the web build of block/buzz-app at `d92bfb2c`, headless Chromium, run by `test/run.sh`; CI runs both). In the real desktop app on Linux (see the README for the version): see "In the real app" below.

- Every request goes to the one origin; the session is sent only in `Authorization`; the identity calls carry no credential; nothing is sent before **Verify**; ask, open (once, even after a failed try), list, read, refresh; a lost session returns to the Verify card; fixed text for every error class, with the service's own words never on the page.
- Forget, a lost session or switching the plugin off while a check is running: the check keeps nothing and starts no timer (and tells the service if its answer arrives late); a late 401 for an old session does not end a newer one; a session that ends in the middle of a form says so and keeps what was typed.
- The attestation the service verifies is the one the host returned, over N, with a real BIP-340 check in the fake; Buzz is asked about exactly one value and it is a hash.
- The check fails closed for each wrong form of the host's answer, a missing call, a host that fails and one that never answers.
- Agent type and tools: not added when the switch is off (nothing saved, `off`, or any other word), added once when it is on as Buzz starts, usable by any agent while the switch is on and the identity verified, refused with fixed words otherwise, with no request made.
- No `fetch`, WebSocket, `eval`, remote image or other way out of the page in the source (a test scans it); nothing in storage but the switch; the one call that signs for the user is in one file.

## What was not verified

- **Against a real service.** There is none yet. The contract is a proposal.
- **In a real agent session.** No harness ran the tools, and no agent of the type was created: creating one publishes its profile on a relay.
- **macOS and Windows.** Linux only, and the web build.
- **The web build's own host call.** The browser tests give the plugin a fake host for the attestation (the web build's broker does not serve it); the real call ran only in the desktop app.
- **A later Buzz.** Everything was written against `d92bfb2c` and run in a desktop build that descends from it.

## In the real app

See the README's "Platforms" and the pull request for what was run in the desktop app and what it showed.
