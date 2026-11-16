// Shared by the fake's tests: the arguments of the commands as the note gives them, and the whole create flow.
import { createFakeDocker, attestationTag, imageOfVersion, ownerKey } from "./index.mjs";
import { assertGpSuccess } from "./contract.mjs";

// The one image of the interface, pinned: tag and digest. BARE_TAG is the same without the digest, which the fake refuses.
export const IMAGE = imageOfVersion("0.0.0");
export const DIGEST = IMAGE.slice(IMAGE.indexOf("@sha256:") + "@sha256:".length);
export const BARE_TAG = IMAGE.slice(0, IMAGE.indexOf("@"));
export { imageOfVersion };
/** A string as a pattern that matches only itself. */
export const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const RELAY = "wss://relay.example.com";
export const OWNER = ownerKey();

// Section 5, step by step.
export const versionArgs = ["version", "--format", "{{.Server.Version}}"];
export const pullArgs = (image = IMAGE) => ["pull", image];
export const initArgs = (slug = "maple", { name = "Maple", relay = RELAY, owner = OWNER, image = IMAGE } = {}) => [
  "run", "--rm", "-v", `gp-${slug}-data:/data`, image, "init", "--name", name, "--relay", relay, "--owner", owner,
];
export const startArgs = (slug = "maple", image = IMAGE) => [
  "run", "-d", "--name", `gp-${slug}`, "--restart", "unless-stopped", "-v", `gp-${slug}-data:/data`, image,
];
// The update helper, started by the plugin after the agent's container when the user said yes to self-update. It runs the agent's own image and
// exact tag with a different command; the command is a placeholder until GHOST Protocol fixes it (UPDATER_COMMAND in fake-docker.mjs is null,
// so the fake takes any command words).
export const UPDATER_COMMAND = ["updater"];
export const startHelperArgs = (slug = "maple", image = IMAGE, command = UPDATER_COMMAND) => [
  "run", "-d", "--name", `gp-${slug}.updater`, "--restart", "unless-stopped", "-v", "/var/run/docker.sock:/var/run/docker.sock", image, ...command, "--target", `gp-${slug}`,
];
export const gp = (slug, ...command) => ["exec", `gp-${slug}`, "gp", ...command];
export const gpInput = (slug, ...command) => ["exec", "-i", `gp-${slug}`, "gp", ...command];
export const statusArgs = (slug = "maple") => gp(slug, "status", "--json");

export const withFake = (scenario) => createFakeDocker({ scenario });

/** Runs a command and parses a GP answer that must succeed. */
export async function ok(fake, argv, input) {
  const result = await fake.run(argv, input === undefined ? undefined : { input });
  return { result, gp: assertGpSuccess(result) };
}

export async function status(fake, slug = "maple") {
  const result = await fake.run(statusArgs(slug));
  if (result.code !== 0) throw new Error(`status failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** Section 5, steps 2 to 5: pull, provision, start, attest. Returns what the agent is called in docker, and its key. */
export async function createAgent(fake, { slug = "maple", name = "Maple", owner = OWNER, image = IMAGE } = {}) {
  await fake.run(pullArgs(image));
  const init = await ok(fake, initArgs(slug, { name, owner, image }));
  const started = await fake.run(startArgs(slug, image));
  if (started.code !== 0) throw new Error(`start failed: ${started.stderr}`);
  return { container: `gp-${slug}`, volume: `gp-${slug}-data`, pubkey: init.gp.values.AGENT_PUBKEY, id: started.stdout.trim() };
}

export const attest = (fake, slug = "maple", owner = OWNER) => fake.run(gpInput(slug, "auth-tag", "set"), { input: `${attestationTag(owner)}\n` });

/**
 * Everything up to a running agent: attestation, Claude token, and the polls that end in `running`. With the update helper started after
 * the agent's container, as the plugin does when the user said yes to self-update (`helper: false` for a no).
 */
export async function runningAgent(fake, options = {}) {
  const agent = await createAgent(fake, options);
  const slug = options.slug ?? "maple";
  if (options.helper !== false) {
    const helper = await fake.run(startHelperArgs(slug));
    if (helper.code !== 0) throw new Error(`the update helper did not start: ${helper.stderr}`);
  }
  await attest(fake, slug, options.owner ?? OWNER);
  await fake.run(gpInput(slug, "claude", "token"), { input: "made-up-claude-setup-token\n" });
  for (let i = 0; i < 4; i++) if ((await status(fake, slug)).state === "running") break;
  return agent;
}
