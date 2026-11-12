# The sensitive list

A pull request that changes an area below waits for the owner's approval of its latest commit. The AI sorter reads this file and puts it
in the model's instructions, word for word, and reports whether a change touches it; it is not a required check. `always.txt` names the
paths that count as touching it without asking the model.

1. **Who owns what**: `.github/CODEOWNERS`, the file that names the paths whose changes wait for the owner. A change that adds, removes
   or rewrites a line of it, or deletes or renames the file, is on the list.

Not on the list by itself: everything else. Since the owner's ruling of 2026-11-11 the plugins (their source, built `plugin.js`, tests,
manifests and READMEs), the workflows and CI configuration (`.github/workflows/`, `.github/tests-to-run.sh` and its tests,
`.github/check-app-ref.sh`, the pinned `BUZZ_APP_REF`), the merge job (`merge-by-policy.yml`, `merge-by-policy-wake.yml` and
`.github/merge-by-policy/`), `after-merge.yml` and `.github/after-merge/` with the `good/<plugin>` tags, this sorter (its workflow, code,
tests, README and these two files), `docs/`, `assets/`, `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `LICENSE`, and code, notes and
documents of any kind merge on the required checks, without the owner. So do changes about credentials and secret handling, prices and
billing, legal text, deleting user data, and release and publishing settings: none of them is a gate here. A change is on the list only
when it changes `.github/CODEOWNERS`; a change that describes it, names a key or quotes a rule is not.
