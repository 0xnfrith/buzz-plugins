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
- no page error and no console error comes up while it runs, and none comes in the two seconds after the last of its pages and settings cards has been looked at (every plugin waits the same time, whether it has a page or not);
- every page it registers that the host lists opens, shows no error screen and draws something;
- every settings card it registers is a section of Settings that opens, does not show the host's "unavailable" notice for a card that threw, and has something in it.

The same check runs for every plugin; it is not a copy of the plugins' own suites. No plugin needed a stand-in for a host service: the web build's `runCommand` answers `null`, as the desktop app does when a command fails, and no plugin calls `request` before a person uses it. A plugin that did would fail the check and get a stand-in then.

A plugin that passes gets `good/<folder>` moved to the pushed commit, and only forward: the tag moves only to a commit that contains the commit it is at, and only when the plugin's folder differs between the two. A plugin that fails keeps its tag where it was, and the other plugins are still checked and tagged. The run then goes red, in its last job (`verdict`), which can only read and which also goes red when a folder was refused or any job broke. The tags are pushed by one job, the only one with write access, using the workflow's own `GITHUB_TOKEN`, and the only thing it writes is `refs/tags/good/<folder>`.

## What it proves, and what it does not

It proves that the built plugin loads in Buzz's **web** build, that its pages and settings cards draw there, and that it leaves no error behind in the seconds after. It does not prove that the desktop app's Git importer imports it, that the plugin works when a person uses it (the web build has no command runner and no HTTP client), or that it works in the desktop app at all.

It does not look at agent tabs, conversation tools or shortcuts either. The pinned web build has no `ctx.agents.registerTab`, and a tool or a shortcut runs only when a person uses it, so a plugin that breaks there still passes.

A run of each plugin in the desktop app is not built yet. The way back to a known-good commit is [below](#way-back).

## Way back

When a plugin on `main` is broken and the last version that loaded is the quickest fix, restore the plugin's folder from its tag. The script [`restore-plugin.mjs`](../.github/after-merge/restore-plugin.mjs) opens a pull request that makes `plugins/<plugin>/` exactly what it was at `good/<plugin>`. It never changes `main` itself: the restore goes through the same pipeline as any change (`all-tests`, review, merge).

### When to use it

- A change that is on `main` broke a plugin for the people who install from `main`, and the tag still marks a version that worked.
- Not when a small fix forward is quicker: the restore throws away every change to that plugin since the tag, the fixes included, until someone applies them again.
- Not for anything outside `plugins/<plugin>/`. The script changes nothing else, so a bad change to the docs or the workflows is reverted the usual way.
- A tag only says the plugin loaded in Buzz's web build (see above). It does not say the plugin worked in the desktop app, and the restore has not been tried there.

### The dry run

Run it from a clone of the repository, with the working tree clean. With no flag it only reads:

```
.github/after-merge/restore-plugin.mjs vim
```

It prints the plugin, the commit `good/vim` points at, the commit `origin`'s `main` is at, the diff stat it would apply, and the branch and the pull request title it would use, and then says it is a dry run.

It writes no ref and no file. It asks `origin` which commits `main` and the tag point at, and if this clone does not have them yet, fetches those two commits by their ids. That stores no branch or tag: it does not update `origin/main`, it does not create or move any tag (a local `good/vim` that points somewhere else is left alone, and the output says so and uses `origin`'s tag), and it writes no `FETCH_HEAD`. In a clone that is up to date there is nothing to fetch and the dry run changes nothing in it. It makes no branch and no commit, changes no file, does not rewrite the index, and pushes nothing.

It refuses, with a message and a non-zero exit, when

- the name is not a plugin folder name (lowercase letters, digits and hyphens), or the command line is not understood;
- the working tree is not clean, there is no `origin`, this is a shallow clone (run `git fetch --unshallow` first, since a shallow clone cannot show whether the tag is in the history of `main`), or this is not a git repository;
- `origin` has no `good/<plugin>` tag;
- the tag's commit is not in the history of `origin/main` (history was rewritten: a person has to look at the tag);
- `plugins/<plugin>/` on `origin/main` already matches the tag, so there is nothing to restore;
- the branch it would use already exists, in the clone or on `origin`: a restore from these two commits was already made.

### `--open`

```
.github/after-merge/restore-plugin.mjs vim --open
```

Only this flag acts, and it needs `gh` installed and logged in. It builds one commit on top of `origin/main` whose tree is `origin/main`'s with `plugins/<plugin>/` replaced by the tag's, in a temporary index: the working tree, the current branch and every other branch of the clone are left alone. Files added to the folder since the tag are removed, and files deleted since are back. It checks that the folder in that commit is the tag's folder (the same Git tree, so the same bytes and file modes), that nothing outside the folder changed and that the parent is `origin/main`. Only then does it push the commit as a new branch named `restore-<plugin>-to-<tag commit>-on-<main commit>` (never forced, never `main`, and no tag, not even a local annotated tag that `push.followTags` would send along), and open a pull request against `main` with `gh pr create`. If `gh` fails after the push, the branch stays pushed and the message says so, so the pull request can be opened by hand.

The pull request has a neutral title, `Restore plugins/<plugin> to its known-good version (good/<plugin> at <short commit>)`. Its body names the plugin, the tag, the tag's commit and `main`'s commit, shows the diff stat, and says that the restore came from the known-good tag and that `plugin.js` is restored as built at that commit, together with its source, so the check that the committed `plugin.js` is the build of that source sees the pair that passed it then. It also says that a run in the desktop app is not built yet.

### After that

- The pull request runs the plugin's tests like any other change to the plugin, and `all-tests` has to pass. If the restored version fails them, the pull request is red and nothing is lost: nothing has been merged.
- A person reviews it and merges it. The script merges nothing.
- After the merge, `plugins/<plugin>/` is the same as at the tag, so the check after a merge finds nothing to do for it: it compares each plugin with its tag, and the tag stays where it is, at the older commit. A later change to the plugin is checked as usual, and moves the tag when it passes.
- If the tag itself is wrong (it points at a version that is broken), the restore does not help: fix the plugin forward, and the check after the next merge moves the tag when it passes.

## Known gaps

- A plugin that fails keeps its tag, and the run is red. Every later push checks it again, and goes red again, until it passes or is fixed.
- A plugin folder whose name is not lowercase letters, digits and hyphens cannot be named in a tag. It is left out and named, the other plugins are checked and tagged, and then the run goes red until the folder is renamed.
- A tag that sits on a commit that is not in the history of `main` (after a force push that rewrote history) is not moved, and the run fails until a person fixes the tag.

## Running the check by hand

```
# once: a block/buzz-app checkout at the commit named in the workflow, with its dependencies and Chromium
pnpm install --frozen-lockfile && pnpm exec playwright install chromium

.github/after-merge/load-check/run.sh /path/to/block/buzz-app vim linear     # the plugins to load, by folder name
node .github/after-merge/load-check/canary.mjs /path/to/block/buzz-app          # the check must fail on broken plugins
node --test .github/after-merge/after-merge.test.mjs                             # picking the plugins, moving the tags
node --test .github/after-merge/restore-plugin.test.mjs                          # the way back, in made-up repositories with a stand-in for gh
```

`run.sh` copies the plugin, a small wrapper and the spec into the checkout, so use a scratch clone; it puts everything back when it ends.
