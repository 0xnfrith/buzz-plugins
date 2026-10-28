# Contributing

Pull requests go to `main`. Keep one change to a pull request, say what you tried in the app, and say what you did not.

## A plugin's built file is committed

Buzz loads `plugin.js` and never runs a build, so a plugin written in TypeScript commits its built `plugin.js` next to the source. Rebuild before you push (see [`docs/building.md`](docs/building.md) and the plugin's own README), and run the plugin's tests.

## Vim mode: every key has a latency budget

A key that the plugin handles must answer fast, in a channel with thousands of messages as well as in an empty one. The suite that holds it is [`plugins/vim/test/budget.spec.mjs`](plugins/vim/test/budget.spec.mjs). It presses a set of keys (`j k 5j 5k Ctrl-e Ctrl-y gg G` in the lists, `h l` between panes, `o` in the message list, `w b 5w 5b 0 $ h l` in the message box, `l` and `h` in Settings; the table is in the plugin's README, with the keys it does **not** press yet) on the channel list, the message list of a channel loaded with its whole history, a thread, the message box, the Reminders, Agents and Workflows pages and the Settings dialog, in headless Chromium against Buzz's own production web build, and reports p50, p95, p99 and the maximum of the time from the key press to the painted frame. How it measures, how to run it and how to read the table: [`plugins/vim/README.md`](plugins/vim/README.md#key-latency-budget).

**The rule: a pull request that adds or changes a key binding adds those keys to the suite**, on each surface where the key does something, in the same pull request. A key that the suite does not press has no budget and nobody notices when it gets slow. A new surface (a new page, a new dialog) gets a `surface(...)` of its own.

**The gate and the target**

| | Limit | What happens |
| --- | --- | --- |
| Gate | p99 ≤ 50 ms | The `Key latency budget` job fails the pull request. A row has to be over the limit in all three attempts to fail (a real regression repeats, a stall of the machine does not). |
| Target | p95 ≤ 16 ms (one frame) | Reported in the job summary, with the rows that are over it marked. It does not block. |

Run the suite on your own machine before you push, with nothing else running (on a small machine another program is enough to double the numbers): `plugins/vim/test/budget.sh PATH_TO_BLOCK_BUZZ_APP_CHECKOUT`. Local numbers are for comparing your branch with `main` (`BUDGET_PLUGIN` measures another build of the plugin); the gate is the CI job's, on its own runner, and a local run can go red on rows that are green there. A new row must be valid: the suite fails a row whose presses do not move anything, or do not have the focus on the row's surface, because its numbers would say nothing about the key. If your change makes a key slower than it was, the table shows where the time went (`script`, `style`, `layout`, in milliseconds per press), and `BUDGET_TRACE=full` shows it per handler of the plugin.
