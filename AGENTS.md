# AGENTS.md

For any agent that builds or reviews in this repository.

## Production, and the pipeline every change needs

- **`main` is production.** People install plugins straight from this repository's default branch through the Buzz desktop app's Git importer (`docs/install.md`), so whatever lands on `main` reaches users. A plugin must work in the real Buzz desktop app.
- **What a change needs before it is done:**
  1. It reaches users only by a merge to `main`. Nobody publishes a plugin by hand or from a branch.
  2. CI checks that the committed `plugin.js` is the build of its source.
  3. The plugin's tests run in CI and `all-tests` (`.github/workflows/tests.yml`) is green.
  4. The tests include a run against the real app: the plugin's browser suite, in headless Chromium against block/buzz-app's own production web build at the pinned `BUZZ_APP_REF`. The examples are `vim-tests.yml`, `artifacts-browser-tests.yml` and `megatech-support-browser-tests.yml`. A plugin without such a suite needs one. Until it has one, the pull request says what was tried in the desktop app by hand.
- **Not built yet, and required:** a check after a change reaches `main` that installs the plugin from `main` into the pinned desktop build and proves it loads, and a stated way back to the last good commit for each plugin. Say so in a pull request that needs them; do not claim they exist.
- **Done means piped.** A change that ships to users includes its tests and checks, or it is not done.
- **The exemption** is a prototype or an experiment, named as such in its folder's README, kept out of the importer's list (no built `plugin.js` on `main`), and never offered to users.
- **Every ready report** carries one line: `Pipeline: yes (<workflow>)` or `Exempt: prototype`.
- **A reviewer** treats a change to what users install that has no pipeline as a finding.
