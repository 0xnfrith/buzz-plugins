# Known-good versions: the `good/<plugin>` tags

Every plugin that reaches `main` is loaded once in Buzz's own web build, and the commit where it loaded is tagged `good/<folder>`: `good/vim`, `good/linear`, `good/beeper` and so on. A tag is a plain Git tag. It points at the last commit where that plugin passed the check below, so it can lag behind `main` and it never moves backwards.

## Installing from a tag

In the desktop app's **Settings → Plugins → Manage plugins → Add**, enter this repository as usual, type the tag in **Branch or tag** (for example `good/linear`) and press **Find** (see [`install.md`](install.md#from-a-git-repository)). The list shows the plugins as they were at that commit. Pick the one the tag is named after: the other plugins in the list are at that commit too, and were not checked by that tag.

## What the check does

The workflow [`after-merge.yml`](../.github/workflows/after-merge.yml) runs on every push to `main`, and on nothing else. At the pushed commit it checks each installable plugin (a folder under `plugins/` with a `manifest.json` and a built `plugin.js` beside it, the importer's own rule, so that includes `key-probe`) that

- has no `good/` tag yet, so the first run checks and tags them all, or
- differs from its own tag: `git diff good/<plugin> <pushed commit> -- plugins/<plugin>` shows a change.

It compares each plugin with its tag, not with what the push changed. A plugin that matches its tag is not checked and its tag does not move, so a push that changes no plugin moves no tag. A change is never lost when GitHub drops a waiting run, because the next run sees that the folder differs from its tag. A plugin that failed keeps its tag, so every later push checks it again until it passes.

For each plugin it registers the committed `plugin.js` and `manifest.json` in the production web build of [block/buzz-app](https://github.com/block/buzz-app) at the commit named by `BUZZ_APP_REF` in the workflow, through the harness's installed-fixture list (the registration path the plugins' own browser tests use), in headless Chromium. One build and one browser for each plugin, so a plugin that does not even load cannot hide another. The plugin passes when:

- `inject` is met and `apply` finishes without throwing, and the host calls the plugin active;
- no page error and no console error comes up while it runs;
- every page it registers that the host lists opens, shows no error screen and draws something.

The same check runs for every plugin; it is not a copy of the plugins' own suites. No plugin needed a stand-in for a host service: the web build's `runCommand` answers `null`, as the desktop app does when a command fails, and no plugin calls `request` before a person uses it. A plugin that did would fail the check and get a stand-in then.

A plugin that passes gets `good/<folder>` moved to the pushed commit, and only forward: the tag moves only to a commit that contains the commit it is at, and only when the plugin's folder differs between the two. A plugin that fails keeps its tag where it was, the other plugins are still checked and tagged, and the run goes red. The tags are pushed by one job, the only one with write access, using the workflow's own `GITHUB_TOKEN`, and the only thing it writes is `refs/tags/good/<folder>`.

## What it does not prove

It proves that the built plugin loads in Buzz's **web** build. It does not prove that the desktop app's Git importer imports it, that the plugin works when a person uses it (the web build has no command runner and no HTTP client), or that it works in the desktop app at all. A run of each plugin in the desktop app, and a way back to the last known-good commit, are not built yet.

## Known gaps

- A plugin that fails keeps its tag, and the run is red. Every later push checks it again, and goes red again, until it passes or is fixed.
- A plugin folder whose name is not lowercase letters, digits and hyphens cannot be named in a tag. The run fails, and says which folder.
- A tag that sits on a commit that is not in the history of `main` (after a force push that rewrote history) is not moved, and the run fails until a person fixes the tag.

## Running the check by hand

```
# once: a block/buzz-app checkout at the commit named in the workflow, with its dependencies and Chromium
pnpm install --frozen-lockfile && pnpm exec playwright install chromium

.github/after-merge/load-check/run.sh /path/to/block/buzz-app vim linear     # the plugins to load, by folder name
node .github/after-merge/load-check/canary.mjs /path/to/block/buzz-app          # the check must fail on broken plugins
node --test .github/after-merge/after-merge.test.mjs                             # picking the plugins, moving the tags
```

`run.sh` copies the plugin, a small wrapper and the spec into the checkout, so use a scratch clone; it puts everything back when it ends.
