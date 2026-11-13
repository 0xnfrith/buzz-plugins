# AGENTS.md

For any agent that builds or reviews in this repository.

## Production, and the pipeline every change needs

- **`main` is production.** People install plugins straight from this repository's default branch through the Buzz desktop app's Git importer (`docs/install.md`), so whatever lands on `main` reaches every user who installs or updates from it. A plugin must work in the real Buzz desktop app.
- **What a change needs before it is done:**
  1. It reaches users only by a merge to `main`. Nobody publishes a plugin by hand or from a branch.
  2. For a plugin built from source, CI checks that the committed `plugin.js` is the build of that source.
  3. The plugin's tests run in CI and `all-tests` (`.github/workflows/tests.yml`) is green.
  4. The tests include a run in Buzz's own web build (not the desktop app): the plugin's browser suite, in headless Chromium against block/buzz-app's own production web build at the pinned `BUZZ_APP_REF`. The examples are `vim-tests.yml`, `artifacts-browser-tests.yml` and `megatech-support-browser-tests.yml`. Agent Skills Highlighter and Agent Stats run theirs inside their `-tests.yml`. Linear and Beeper run theirs as a `browser` job inside `linear-tests.yml` and `beeper-tests.yml`. `plugins/key-probe`, a measuring tool for the Vim tests, has no tests on purpose (`.github/tests-to-run.sh`). Any other plugin without such a suite needs one. Until it has one, the pull request says what was tried in the desktop app by hand.
- **Not built yet, and required:** a run of each plugin in the Buzz desktop app itself, in CI; and, in the pinned desktop build, the check after a change reaches `main` that installs the plugin from `main` and proves it loads. Say so in a pull request that needs them; do not claim they exist. What exists is the web-build version: `after-merge.yml` loads each plugin that differs from its `good/<plugin>` tag in Buzz's **web** build and tags the commit where it loaded `good/<plugin>`, and `docs/known-good.md` describes the way back to a tag. It proves the built plugin loads there, not that the desktop app's Git importer imports it or that it works in the desktop app.
- **Done means piped.** A change that ships to users includes its tests and checks, or it is not done.
- **The exemption** is a prototype or an experiment, named as such in its folder's README, kept out of the importer's list (no built `plugin.js` on `main`), and never offered to users. A plugin with a built `plugin.js` on `main` is never exempt, whatever its README calls it.
- **Every ready report** carries one line: `Pipeline: yes (<workflow>)` or `Exempt: prototype`.
- **A reviewer** treats a change to what users install that has no pipeline as a finding.

## How a change lands

- **One change, one pull request into `main`,** from a branch of this repository. Open it ready, never as a draft. A pull request that has to wait opens with `HOLD: ` at the start of its title, or carries the `hold` label: nothing merges it while either is there. It lands as one squash commit.
- **Commits** use the GitHub noreply identity `0xnfrith <1100287+0xnfrith@users.noreply.github.com>`. A builder that cannot push here hands its commit to a maintainer, who pushes the branch and opens or updates the pull request.
- **This repository is public.** Code, comments, commit messages, branch names, pull request titles and bodies, and review bodies carry nothing private: no internal tracker ids, no chat room, channel or agent names, no keys, no internal hostnames or URLs, no customer names, no paths from your machine. A pull request body opens with a neutral `Origin:` line, then says what was wrong, what changes and how it was checked, and carries the `Pipeline:` line above.
- **Review.** Each review reads one exact head commit. An approval on GitHub counts only for that head, from a login on the repository variable `MERGE_REVIEWER_LOGINS`, never from the pull request's author. A push after it needs a new review. Approve only a head with no finding left open, at any rank; otherwise request changes.
- **What waits for the owner.** Only a change to `.github/CODEOWNERS`: it needs the code owner's review (the file says why), and `main`'s ruleset asks for it. The AI sorter (`ai-sorter.yml`) reads every pull request and reports whether it changes that file ([`.github/sorter/list.md`](.github/sorter/list.md)); it is not a required check, so its report never blocks a merge. Every other change, the workflows and the sorter itself included, merges on the required checks without the owner.
- **Merge.** [`merge-by-policy.yml`](.github/workflows/merge-by-policy.yml) switches GitHub's squash auto-merge on, as the merge App, once a pull request qualifies: approved on its head as above, every required check green (`all-tests` among them), no CODEOWNERS path, not a draft, not held. Its header lists every condition, including the rules `main`'s ruleset must ask for, an approval among them. While the ruleset asks for less, the job switches nothing on and its run summary says why; a maintainer then merges by hand once the review is clean and `all-tests` is green.
- **After the merge,** `after-merge.yml` checks each changed plugin and moves its `good/<plugin>` tag, as above. The way back is a revert of the squash commit, or a restore of the plugin's folder from its tag ([`docs/known-good.md`](docs/known-good.md#way-back)).
