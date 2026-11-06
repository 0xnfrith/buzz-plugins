#!/usr/bin/env bash
# Which plugin test workflows a change calls: the `changes` job of tests.yml runs it, and .github/tests-to-run.test.mjs tests it in
# made-up repositories. Run from the root of the repository whose change it reads.
#
# Reads EVENT (the event's name), BASE and HEAD (commits) from the environment:
#   pull_request   the files GitHub lists as changed: `git diff BASE...HEAD`, from their merge base
#   push           `git diff BASE HEAD`, the commit before the push and the commit pushed
#   merge_group    `git diff BASE HEAD`, the group's base and the group's commit
#   anything else  (a run by hand) every test workflow
# A change to any file under .github/ calls every test workflow: check-app-ref.sh reads every workflow file, and this script decides
# what runs. So does a BASE or HEAD that is not in the history (a force push, say).
#
# Appends to $GITHUB_OUTPUT one line per row below, `<name>=true` or `<name>=false`, and `rows=<every name>`, which `all-tests`
# compares with its jobs. Writes a table to $GITHUB_STEP_SUMMARY when that is set. Fails, and writes no output, when a file the change
# adds or edits is in a folder under plugins/ that no row names and that is not in the list of plugins without tests.
set -euo pipefail

# The test workflows: the output (and job) name in tests.yml, then the folders (or files) whose changes call it. A change under .github/
# calls every row anyway; the AI sorter's paths there name what its tests cover.
rows=(
  "agent-skills-highlighter  plugins/agent-skills-highlighter/"
  "ai-sorter                 .github/sorter/ .github/workflows/ai-sorter.yml .github/workflows/ai-sorter-tests.yml"
  "artifacts                 plugins/artifacts/"
  "artifacts-browser         plugins/artifacts/"
  "beeper                    plugins/beeper/"
  "linear                    plugins/linear/"
  "megatech-support          plugins/megatech-support/"
  "megatech-support-browser  plugins/megatech-support/"
  "vim-tests                 plugins/vim/"
  "vim-latency               plugins/vim/"
)
# The plugin folders that have no test workflow, on purpose:
#   key-probe  a measuring tool for the Vim tests that are run by hand in the desktop app (plugins/vim/test/real-app); no tests of its own
untested=(key-probe)

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is not set}"
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
zero=0000000000000000000000000000000000000000
have() { [ -n "$1" ] && [ "$1" != "$zero" ] && git cat-file -e "$1^{commit}" 2>/dev/null; }
# A file name as it is shown in the log and the table: one line, and no | to break a table row.
shown() { local s=${1//$'\n'/ }; printf '%s' "${s//|/\\|}"; }

everything=""
range=()
case "${EVENT:-}" in
  pull_request)
    if have "${BASE:-}" && have "${HEAD:-}" && git merge-base "$BASE" "$HEAD" >/dev/null 2>&1; then
      range=("$BASE...$HEAD")
    else
      everything="the base or the head of the pull request is not in the history"
    fi ;;
  push | merge_group)
    if have "${BASE:-}" && have "${HEAD:-}"; then
      range=("$BASE" "$HEAD")
    else
      everything="the commit before the change is not in the history"
    fi ;;
  *) everything="run by hand (${EVENT:-no event})" ;;
esac

# The changed files, NUL-separated (-z), so that no name is quoted: without -z, git quotes a name with a non-ASCII character, a " or
# a \, and the quoted name would match no folder. --no-renames lists a moved file at both its old and its new place.
files=()
kept=() # the changed files that are still there after the change (not deleted)
if [ ${#range[@]} -gt 0 ]; then
  list=$(mktemp)
  trap 'rm -f "$list"' EXIT
  git diff -z --no-renames --name-only "${range[@]}" >"$list"
  while IFS= read -r -d '' file; do files+=("$file"); done <"$list"
  git diff -z --no-renames --name-only --diff-filter=d "${range[@]}" >"$list"
  while IFS= read -r -d '' file; do kept+=("$file"); done <"$list"
fi

for file in "${files[@]}"; do
  if [[ $file == .github/* ]]; then
    everything="a file under .github/ changed ($(shown "$file"))"
    break
  fi
done

# A plugin folder that no row names and that is not in `untested` would never be tested: fail, and say which.
missing=()
for file in "${kept[@]}"; do
  [[ $file == plugins/*/* ]] || continue
  dir=${file#plugins/}
  dir=${dir%%/*}
  known=false
  for row in "${rows[@]}"; do
    read -r -a fields <<<"$row"
    for folder in "${fields[@]:1}"; do [ "$folder" != "plugins/$dir/" ] || known=true; done
  done
  for name in "${untested[@]}"; do [ "$name" != "$dir" ] || known=true; done
  if ! $known && [[ " ${missing[*]-} " != *" $dir "* ]]; then missing+=("$dir"); fi
done
if [ ${#missing[@]} -gt 0 ]; then
  for dir in "${missing[@]}"; do
    echo "::error::plugins/$(shown "$dir")/ changed, but no test workflow runs for it: add a row for it to .github/tests-to-run.sh (and its job to tests.yml), or add it to the list of plugins without tests there, with the reason."
  done
  exit 1
fi

{
  echo "### Which plugin tests apply"
  echo
  if [ -n "$everything" ]; then echo "All of them: $everything."; else echo "${#files[@]} files changed."; fi
  echo
  echo "| Tests | Run | Because of |"
  echo "| --- | --- | --- |"
} >>"$summary"
if [ -n "$everything" ]; then echo "All of them: $everything."; else echo "${#files[@]} files changed."; fi

names=()
out=""
for row in "${rows[@]}"; do
  read -r -a fields <<<"$row"
  name=${fields[0]}
  names+=("$name")
  run=false
  why=""
  if [ -n "$everything" ]; then
    run=true
    why=$everything
  else
    for folder in "${fields[@]:1}"; do
      for file in "${files[@]}"; do
        if [[ $file == "$folder"* ]]; then
          run=true
          why=$(shown "$file")
          break 2
        fi
      done
    done
  fi
  out+="$name=$run"$'\n'
  echo "| $name | $run | $why |" >>"$summary"
  echo "$name: $run${why:+ ($why)}"
done
out+="rows=${names[*]}"$'\n'
printf '%s' "$out" >>"$GITHUB_OUTPUT"
