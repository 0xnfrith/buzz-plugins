# AGENTS.md

For any agent that builds or reviews in this repository.

## Production, and the pipeline every change needs

- **`main` is production.** People install plugins straight from this repository's default branch through the Buzz desktop app's Git importer (`docs/install.md`), so whatever lands on `main` reaches every user who installs or updates from it. A plugin must work in the real Buzz desktop app.
- **What a change needs before it is done:**
  1. It reaches users only by a merge to `main`. Nobody publishes a plugin by hand or from a branch.
  2. For a plugin built from source, CI checks that the committed `plugin.js` is the build of that source.
  3. The plugin's tests run in CI and `all-tests` (`.github/workflows/tests.yml`) is green.
  4. The tests include a run in Buzz's own web build (not the desktop app): the plugin's browser suite, in headless Chromium against block/buzz-app's own production web build at the pinned `BUZZ_APP_REF`. The examples are `vim-tests.yml`, `artifacts-browser-tests.yml` and `megatech-support-browser-tests.yml`. Agent Skills Highlighter and Agent Stats run theirs inside their `-tests.yml`. Linear and Beeper have browser suites that CI does not run yet (run by hand with `test/run.sh`): wiring them into CI is required, and until then a change to either says in the pull request what was run. `plugins/key-probe`, a measuring tool for the Vim tests, has no tests on purpose (`.github/tests-to-run.sh`). Any other plugin without such a suite needs one. Until it has one, the pull request says what was tried in the desktop app by hand.
- **Not built yet, and required:** a run of each plugin in the Buzz desktop app itself, in CI; and, in the pinned desktop build, the check after a change reaches `main` that installs the plugin from `main` and proves it loads. Say so in a pull request that needs them; do not claim they exist. What exists is the web-build version: `after-merge.yml` loads each plugin that changed on `main` in Buzz's **web** build and tags the commit where it loaded `good/<plugin>`, and `docs/known-good.md` describes the way back to a tag. It proves the built plugin loads there, not that the desktop app's Git importer imports it or that it works in the desktop app.
- **Done means piped.** A change that ships to users includes its tests and checks, or it is not done.
- **The exemption** is a prototype or an experiment, named as such in its folder's README, kept out of the importer's list (no built `plugin.js` on `main`), and never offered to users. A plugin with a built `plugin.js` on `main` is never exempt, whatever its README calls it.
- **Every ready report** carries one line: `Pipeline: yes (<workflow>)` or `Exempt: prototype`.
- **A reviewer** treats a change to what users install that has no pipeline as a finding.
