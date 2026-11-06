#!/usr/bin/env bash
# Writes the pull request's change for the sorter, from the checked-out merge commit's first parent (the base branch) to the merge
# commit: OUTPUT_FOLDER/change.diff (the diff) and OUTPUT_FOLDER/change.numstat (lines added and removed per path, NUL-separated).
# Run from the repository root. The workflow and the tests both run this file, so they test the same git commands.
#
# Every file is diffed as text (--text), whatever .gitattributes says: a pull request cannot hide a file's content from the model by
# marking it binary. No external diff programs, no text conversion, and no rename detection, so each changed path has its own section.
set -euo pipefail
out=${1:?usage: change.sh OUTPUT_FOLDER}
args=(--no-color --no-ext-diff --no-textconv --text --no-renames HEAD^1 HEAD)
git diff "${args[@]}" > "$out/change.diff"
git diff --numstat -z "${args[@]}" > "$out/change.numstat"
