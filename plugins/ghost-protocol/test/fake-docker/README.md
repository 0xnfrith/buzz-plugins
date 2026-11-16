# A fake `docker` for the GHOST Protocol plugin's tests

The plugin drives GHOST Protocol only through the `docker` command (one declared host process, the bare program name `docker`). This folder is a fake `docker` that answers every command of that interface, so the plugin's tests run before the image exists, on any machine, with no Docker installed.

It is for tests only. Nothing in it ships with the plugin, and the plugin never reads it.

- **One file to run**: `bin/docker`, a Node script (Node 22 or later, nothing to install). It runs the same on Linux and macOS.
- **State between commands** lives in a folder the test names with `FAKE_DOCKER_STATE`: what docker would know (images, volumes, containers), a log of every command, and the scenario.
- **A scenario** says what should go wrong, or differently, without editing the fake: Docker missing, the daemon down, a pull that fails, a Claude sign-in that fails, an update that is available, a relay that refuses the agent, an interface number the plugin does not know.
- **It is strict.** A command, flag or name that the interface does not list is refused (exit 64, `fake-docker: ...` on stderr, `refused: true` in the call log). A plugin that drifts from the interface fails its test instead of passing against a lenient fake.

## Using it from a test

```js
import { createFakeDocker, attestationTag, ownerKey } from "./fake-docker/index.mjs";

const fake = createFakeDocker({ scenario: "claude-signed-in" }); // a state folder of its own
// Put the fake first on the PATH of the process the plugin starts:
const env = fake.env(); // PATH with bin/ in front, and FAKE_DOCKER_STATE
fake.use("relay-refuses"); // change the scenario from now on
fake.tweak({ connectingPolls: 3 }); // or some keys of it
const calls = fake.calls(); // every command it was run with, in order
fake.cleanup();
```

| | |
| --- | --- |
| `fake.env(base?)` | `base` (default `process.env`) with the fake first on the `PATH` and `FAKE_DOCKER_STATE` set. Hand it to the host simulator that starts the plugin's declared process. |
| `fake.missingEnv(base?)` | `base` with a `PATH` that has no `docker`: starting `docker` then fails as it does when it is not installed (ENOENT). |
| `fake.use(scenario)` / `fake.tweak(changes)` | Replace the scenario, or change some keys. A preset name (several joined with commas), or an object. A name or key the fake does not know throws at once. |
| `fake.run(argv, { input?, env? })` | Runs the fake once and resolves `{ code, signal, stdout, stderr }`. `input` goes to stdin, which is then closed. |
| `fake.start(argv, { env?, timeoutMs? })` | The same, but gives a handle to write to stdin later and to kill it. For `gp claude login`, which prints an address and then waits for a code. A process still there after `timeoutMs` (30 s) is killed and ends with `timedOut: true`, and `cleanup()` kills any that are left, so a test that fails half way cannot hang the run. |
| `fake.calls()` | `[{ n, argv, exit, stdin: { attached, bytes, sha256, terminated }, refused?, tag? }]`. Only a digest of stdin is kept (except for the attestation tag, which is public), and after `gp` only the words of the interface are logged: an argument that is not one of them (a token given by mistake) is `<not logged>`. |
| `fake.state()` / `fake.patchState(change)` | What docker would know now: `{ images, volumes, containers }`. |
| `fake.seed({ condition, slug, name, version, previousVersion })` | Puts an agent in place without running its commands: `needs-auth-tag`, `needs-claude`, `running` or `stopped`. |
| `ownerKey(label?)`, `attestationTag(owner?, conditions?)` | A made-up owner public key, and a well-formed owner attestation for it. |

`contract.mjs` holds the rules of the interface as code (`parseGp`, `assertGpSuccess`, `assertGpFailure`, `assertStatusShape`), for the fake's own tests and for any test that wants to check what the plugin reads.

Every key and every value of a scenario is checked when it is set (`fake.use`, and every command): an unknown key, a value that is not one of the listed ones, a number of the wrong kind, or a step name that does not exist is an error and not a scenario that quietly does nothing. A scenario that is refused leaves the one in force in force.

The scenario is read at every command from, in order, the built-in defaults, the environment variable `FAKE_DOCKER_SCENARIO` (a preset name, several joined with commas, or a JSON object), and `scenario.json` in the state folder. The helper writes the last one, so a test can change the scenario between two commands.

## What it answers

Where the output is docker's own it follows real docker's text and exit codes. Where it is GHOST Protocol's own it follows the interface: `GP_INTERFACE=<n>` first, `GP_<KEY>=<value>` lines for the plugin, lines for people between them, and a failure as a non-zero exit with `GP_ERROR=<code>` and `GP_ERROR_MESSAGE=<one line>` on stdout.

| Command | Prints |
| --- | --- |
| `docker version --format {{.Server.Version}}` | The version alone (`27.3.1`). Without `--format`, the client and server blocks. |
| `docker pull <IMAGE>` | docker's progress lines, `Digest:`, `Status:` and the image. Create pulls one image, the agent's: any other (the update helper has none of its own) is refused. |
| `docker run --rm -v gp-<slug>-data:/data <IMAGE> init --name <name> --relay <url> --owner <hex>` | `GP_INTERFACE`, `GP_VERSION` (the image's tag) and `GP_AGENT_PUBKEY` (64 hex). The same key for the same volume. The key is never printed otherwise. |
| `docker run -d --name gp-<slug> --restart unless-stopped -v gp-<slug>-data:/data <IMAGE>` | The container id (64 hex). |
| `docker run -d --name gp-<slug>.updater --restart unless-stopped -v /var/run/docker.sock:/var/run/docker.sock <agent image>:<tag> <updater command> --target gp-<slug>` | The container id. The update helper: it runs the agent's own image and exact tag with a different command, and the plugin starts it after the agent's container, only when the user said yes to self-update. Refused if the image is not exactly the agent's, the socket mount is missing or there is another mount, the arguments do not end with `--target gp-<slug>` after a command, the agent's container is not there yet, or the scenario's `selfUpdate` is `no`. The updater command and its arguments are a placeholder (see below). |
| `docker exec -i gp-<slug> gp auth-tag set`, tag on stdin | `GP_AUTH_TAG=accepted`, or `GP_ERROR=bad-auth-tag`. |
| `docker exec gp-<slug> gp claude status` | `GP_CLAUDE=active` or `GP_CLAUDE=not-active`. |
| `docker exec -i gp-<slug> gp claude login` | `GP_CLAUDE_LOGIN_URL=<address>` at once, then waits for the code and a newline on stdin; `GP_CLAUDE=active`, or `GP_ERROR=claude-login-failed`. |
| `docker exec -i gp-<slug> gp claude token`, token on stdin | `GP_CLAUDE=active`, or `GP_ERROR=claude-token-invalid`. |
| `docker exec gp-<slug> gp status --json` | One JSON object, with no `GP_` line before it: `interface`, `version`, `state`, `agent_pubkey`, `relay_url`, `relay`, `claude`, `update`, `previous_version`, `error`. |
| `docker exec gp-<slug> gp update request` / `rollback` | `GP_UPDATE=requested` / `GP_UPDATE=rollback-requested`, or `GP_ERROR=no-updater` (no helper is running), `no-update-available`, `no-previous-version` or `update-in-progress`. |
| `docker restart` / `docker stop gp-<slug>` | The container's name. |
| `docker rm [-f] <name>...` | The name of each container removed (stdout), and docker's error for each that is not there (stderr). The exit code is 1 when any error remains; with `-f` a container that is not there is an error line and not a failure, so the exit code is 0, as in docker 29. |
| `docker inspect [--format <template>] gp-<slug>` | docker's JSON for the container, or the field the template names. When it is not there: `[]` on stdout, exit 1, and `Error: No such object: <name>` on stderr (docker 27) or `error: no such object: <name>` (docker 29, `dockerStyle: "current"`, which also prints an empty line for a formatted inspect). |
| `docker volume rm gp-<slug>-data` | The volume's name. docker's own errors when it is in use or not there. |

The attestation tag must be one JSON array of four strings, `["auth", <owner, 64 hex>, <conditions>, <signature, 128 hex>]`, with the owner the agent was set up for. The signature is not checked, only its shape. Run without `-i`, a command gets no stdin, as in docker, so `auth-tag set` then fails: the plugin must pass `-i` where it writes to stdin.

`gp claude login` and `gp auth-tag set` read one line, and the process ends after it even if the plugin keeps stdin open.

### The status

The state follows what the agent has: no attestation, `needs-auth-tag`; then no Claude sign-in, `needs-claude`; then `connecting` for `connectingPolls` status calls; then `running`, or `connecting` for as long as the relay refuses it. `relay` is the scenario's value once the agent has tried to connect, and `unreachable` before that. An update walks `running` (for `updateStartPolls` calls, the agent finishing its task), `updating` (for `updatingPolls` calls), the gap (below), and then `running` with the new `version`, `previous_version` set and `update` cleared. A rollback walks the same way back, with the update offered again.

**The gap.** While the helper container swaps the image, `gp-<slug>` can be missing or stopped for a few seconds. With `updateGapPolls` the fake does that: for that many status calls after the `updating` answers, every `docker exec` fails (`No such container: gp-<slug>`, or `container <id> is not running` with `updateGapKind: "stopped"`), and `docker inspect` finds nothing (or shows `exited`). A plugin that last saw `updating` should keep showing "updating" through this. `updateGapPolls: "forever"` never ends it.

## Scenario keys

| Key | Default | What it does |
| --- | --- | --- |
| `docker` | `ok` | `missing` (exit 127, `docker: command not found`), `daemon-down`, `permission-denied`: every command fails as docker does. |
| `dockerVersion` | `27.3.1` | What `docker version` prints. |
| `dockerStyle` | `classic` | `classic`: the wording of docker 27. `current`: the wording of docker 29 for inspect of a missing container (`error: no such object`) and for a daemon that is not there (`failed to connect to the docker API at ...`, with `[]` or an empty line still on stdout). The texts vary across docker versions, and Docker Desktop ships the newer ones: a plugin must not match them by case or by an exact sentence. |
| `interface` | `1` | The number in `GP_INTERFACE=` and in the status. |
| `pull` | `ok` | `not-found`, `unauthorized` or `network`: docker's error for each. |
| `authTag` | `accept` | `reject` refuses even a well-formed tag. |
| `claude` | `not-active` | What a new data volume starts with: `active` means signed in already. |
| `loginCode` | `null` | The code `gp claude login` wants. `null` accepts any non-empty line. |
| `relay` | `connected` | `refused-not-member` or `unreachable`: what the status says once the agent has tried to connect. |
| `connectingPolls` | `1` | Status calls that say `connecting` before `running`. |
| `update` | `{ available: false, version: null }` | What the status says about an update. |
| `updateStartPolls`, `updatingPolls`, `updateGapPolls`, `updateGapKind` | `0`, `2`, `0`, `gone` | The walk of an update, above. |
| `selfUpdate` | `yes` | What the user said to "Let GHOST Protocol update itself?". `yes`: the plugin starts the helper `gp-<slug>.updater` (the command above), which then runs beside the agent, through updates, and `docker rm -f gp-<slug> gp-<slug>.updater` removes both. `no`: the plugin never starts it, the fake refuses the command, `gp update request|rollback` is `GP_ERROR=no-updater`, and `rm -f` of the missing helper is docker's `No such container` on stderr and still exit 0 (the first name is removed all the same). |
| `statusFormat`, `statusPreamble` | `pretty`, `false` | Print the status JSON on one line, or with `GP_INTERFACE=<n>` before it. |
| `statusOverride` | `null` | An object merged over the status JSON, to force any value (`{ state: "error", error: { code, message } }`). |
| `fail` | `{}` | `{ init, authTag, claudeLogin, claudeToken, updateRequest, updateRollback: true \| { code, message } }`: that step fails with `GP_ERROR`. |
| `delayMs`, `hang` | `{}`, `[]` | A step (`version`, `pull`, `init`, `start`, `start-updater`, `auth-tag`, `claude-status`, `claude-login`, `claude-token`, `status`, `update-request`, `update-rollback`, `restart`, `stop`, `rm`, `inspect`, `volume-rm`) that answers late, or never. |
| `logLines` | `true` | The lines for people between the `GP_` lines. |

Presets, for `FAKE_DOCKER_SCENARIO` and `fake.use`: `ok`, `docker-missing`, `daemon-down`, `permission-denied`, `pull-not-found`, `pull-unauthorized`, `pull-offline`, `init-fails`, `bad-auth-tag`, `claude-signed-in`, `login-fails`, `token-rejected`, `relay-refuses`, `relay-unreachable`, `update-available`, `no-self-update`, `docker-29-wording`, `update-gap`, `update-gap-stopped`, `update-never-returns`, `unknown-interface`, `status-error`, `status-compact-with-preamble`.

## Secrets

A Claude token and a login code come in on stdin and go nowhere: not printed, not in a message, not in `state.json`, `calls.jsonl` or `scenario.json`. The call log keeps only a SHA-256 of what was read, so a test can still check what was sent. The attestation tag is the one input kept as text: it is public (the owner signs it and the relay sees it).

The same holds for a secret given as an argument by mistake (`gp claude token <token>`): the command is refused, the refusal says that an argument was left out and does not show it, and the call log keeps only the words of the interface after `gp`.

## Where the fake follows the interface, and where it assumes

The commands, their output rules, the status JSON and the error codes in the tables above come from the interface (draft 0.1). Where the interface is silent the fake makes a rule up. A test of the plugin should not rely on these as if GHOST Protocol guaranteed them, and each is a one-line change in `fake-docker.mjs`.

**The status**

- `relay` is `unreachable` until the agent has tried to connect (the interface lists three values and no "not yet"): in `needs-auth-tag`, `needs-claude` and the first `connecting` answers. After that it is the real value, also through `updating`.
- A new agent is `needs-auth-tag` first and `needs-claude` after it, as the create flow orders them.
- With both done, the state is `connecting` for `connectingPolls` calls, then `running`. It does not go through `connecting` again after an update.
- `agent_pubkey` and `relay_url` are in the status in every state. `error` is `null` unless a scenario forces it.
- `version` is the tag of the image the container runs; after an update, the update's version.
- The JSON is printed pretty by default, so a plugin must parse all of stdout.

**Update and way back**

- An update walks `running` (`updateStartPolls` calls), `updating` (`updatingPolls` calls), the gap, then `running` with the new `version`, `previous_version` set and `update` cleared. A rollback walks back, with `previous_version` `null` and `update` offering the version it left.
- The gap starts after the `updating` answers and lasts `updateGapPolls` status calls (default none).
- `update-in-progress` (a second request), `update-failed` and `rollback-failed` (forced by a test) are made-up error codes.
- The update helper's command and its arguments after the image are a placeholder until GHOST Protocol fixes them: while `UPDATER_COMMAND` at the top of `fake-docker.mjs` is `null` the fake takes any command words (the first not a flag) followed by `--target gp-<slug>`; set it to the real command and the fake requires exactly that. The image must be the agent's own, with its exact tag, the only mount the Docker socket, `--restart unless-stopped`, and no `--rm`.
- The helper is long-lived: once started it runs through updates and through the agent's container being removed and started again, and it is not an agent (no `gp` command runs in it). Its name has a dot, which no slug can have, so it can never be an agent's. After an update or a rollback the agent's container runs the new image (`docker inspect` shows the new tag) and the helper keeps the one it was started with.
- An update, and a rollback, need a running helper: without one `gp update request|rollback` is `GP_ERROR=no-updater`, before the answer about whether there is an update. With `selfUpdate: "no"` the plugin never starts the helper, so it is always that error.

**The GHOST Protocol commands**

- `init`: the name is one non-empty line, the relay is `ws://` or `wss://`, the owner is 64 lower-case hex. Running it again on the same volume keeps the key and takes the latest name, relay and owner. A new volume, also after `docker volume rm`, gets a new key.
- `auth-tag set` reads one line. It accepts a JSON array of four strings: `"auth"`, the owner given to `init`, any conditions, and a 128-hex signature (the signature is not verified). Anything else is `bad-auth-tag`, with a message for each reason. Without `-i` it gets empty input.
- `claude login` prints its address at once (`https://claude.example/login?state=<16 hex>`), as one process, then waits for one line. Any non-empty line is accepted (a test can require a code).
- `claude token` accepts any non-empty line with no whitespace.
- The attestation and the Claude sign-in live in the data volume, so a container started again on the same volume needs neither again. Setting the tag twice is accepted.
- `GP_ERROR_MESSAGE` texts and the lines for people between the `GP_` lines are made up, one line each.
- An unknown interface number changes only the number (`GP_INTERFACE=2`, `interface: 2`); the fields stay.

**Docker's side**

- The image is `<registry>[:port][/path]/ghost-protocol:<exact tag>`. No tag, `latest`, a digest only, or another name is refused.
- `docker run -d` on a volume that `init` never set up is refused (a guard against a plugin that skips it; the real image may behave differently).
- `docker inspect` prints the fields a plugin might read, with fixed timestamps; a stopped container is `exited` with exit code 0.
- docker's own texts: the ones for a missing container, volume or daemon were checked against docker 29.1.3 (and are the wording of docker 27 under `dockerStyle: "classic"`); the rest, such as the pull progress lines and the conflict and volume-in-use errors, are written from memory of real docker.

**The fake only**

- A command, flag or name outside the interface is refused: exit 64, `fake-docker:` on stderr. `run` takes `-d`, `--rm`, `--name`, `--restart` and `-v`; `exec` takes `-i` only; `gp status` takes only `--json`; `rm` takes `-f`; `inspect` and `version` take `--format`.

## What it does not cover

It is not Docker: no image is run, no network, no volumes on disk. It does not check that the plugin starts `docker` the way Buzz's desktop app does (the plugin's tests run the process through a host simulator, and the desktop app is a separate check). Windows is not covered (`bin/docker` is a Node script with a shebang line).

## Tests

```
node --test plugins/ghost-protocol/test/fake-docker/*.test.mjs
```

No install step and nothing from the plugin's `package.json`. The tests run the real `bin/docker` as a process, so they also prove the shebang, the file mode and the state handling on the machine they run on. They cover each command's output against the rules in `contract.mjs`, every state, relay and Claude value of the status, an update and a rollback with and without the gap, every failure, every refusal, that no secret is written anywhere, and many commands running at once.
