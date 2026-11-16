// The "GHOST Protocol" agent type: a Remote type, so Buzz holds no key and runs nothing. It makes Buzz's `provision` and `activate` the two
// halves of src/gp/flow.ts, and its `remove` the flow's removal. The type is screens and docker commands only: the agent's key is made
// inside the agent's own data volume, and the plugin never sees it.
import type { AgentType, Relay } from "./agents.d";
import type { Host } from "./buzz";
import type { Book } from "./gp/book";
import { chosenFrom, startingConfig, type Config } from "./gp/config";
import { activate, CreateError, provision, remove, type Deps } from "./gp/flow";
import { checkDocker, startOn } from "./docker";
import { sleep } from "./gp/host";
import { slugFromName } from "./gp/names";
import type { Progress, Secrets } from "./gp/progress";

export const TYPE_ID = "ghost-protocol";

export type TypeDeps = Readonly<{
  host: Host;
  relay: Relay;
  progress: Progress;
  secrets: Secrets;
  book: Book;
  CreateConfiguration: AgentType<Config>["CreateConfiguration"];
  Create: AgentType<Config>["Create"];
}>;

export function agentType(deps: TypeDeps): AgentType<Config> {
  const { host, relay, progress, secrets, book } = deps;

  const startOrThrow = () => {
    const start = startOn(host);
    if (!start) throw new CreateError("This Buzz cannot start programs. Use the Buzz desktop app.");
    return start;
  };
  const flowDeps = (): Deps => ({
    start: startOrThrow(),
    checkDocker: (signal) => checkDocker(host, signal),
    progress,
    token: secrets.token,
    clearToken: secrets.clear,
    sleep,
    now: () => Date.now(),
  });
  /** The signed-in person, who becomes the agent's owner and only allowed sender. */
  const ownerOf = (): string => {
    const snapshot = relay.snapshot();
    const viewer = snapshot.status === "ready" ? snapshot.session?.viewer : undefined;
    if (viewer === undefined || !/^[0-9a-f]{64}$/.test(viewer)) throw new CreateError("Connect to your community and sign in before you make the agent.");
    return viewer;
  };
  const chosen = (config: unknown) => {
    const result = chosenFrom(config);
    if ("problem" in result) throw new CreateError(result.problem);
    return result;
  };

  return {
    id: TYPE_ID,
    title: "GHOST Protocol",
    description: "Your personal GHOST Protocol agent, running in Docker on this computer.",
    defaults: () => ({ config: startingConfig() }),
    summary: () => "On this computer",
    ...(deps.CreateConfiguration ? { CreateConfiguration: deps.CreateConfiguration } : {}),
    ...(deps.Create ? { Create: deps.Create } : {}),
    remote: {
      async provision({ name, community, config, signal }) {
        const { selfUpdate } = chosen(config);
        const made = await provision(flowDeps(), { name: name.trim(), community, owner: ownerOf(), selfUpdate, signal });
        book.set(made.pubkey, made.slug);
        return { pubkey: made.pubkey };
      },
      async activate({ pubkey, name, auth, config, signal }) {
        const { selfUpdate, claudeWay } = chosen(config);
        const slug = slugFromName(name.trim());
        await activate(flowDeps(), { name: name.trim(), pubkey, auth, selfUpdate, claudeWay, signal });
        // Written again: an agent whose first steps ran before this was installed, or before the storage was cleared, has no pair yet.
        if (slug !== undefined) book.set(pubkey, slug);
      },
      // GHOST Protocol's interface has no command that sets a profile, so the name and picture stay Buzz's. The agent publishes none.
      async profile() {},
      async remove({ pubkey, signal }) {
        const slug = book.get(pubkey);
        // Without the pair nothing here says which container is this agent's, so none is touched: it stays in Docker, in plain sight.
        if (slug === undefined) return;
        await remove(startOrThrow(), slug, signal);
        book.delete(pubkey);
      },
    },
  };
}
