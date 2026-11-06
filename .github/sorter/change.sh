#!/usr/bin/env bash
# usage: change.sh PR_REPOSITORY HEAD_SHA OUTPUT_FOLDER
#
# Writes the pull request's change for the sorter: OUTPUT_FOLDER/change.diff (the diff) and OUTPUT_FOLDER/change.numstat (lines added
# and removed per path, NUL-separated), from the merge commit's first parent (the base branch) to the merge commit checked out in
# PR_REPOSITORY. The workflow runs this file from the base branch's copy of the sorter, and
# the tests run the same file.
#
# It refuses unless the checkout is a merge commit whose second parent is HEAD_SHA, the pull request's head: the verdict is recorded
# for that commit, so the diff has to be that commit's.
#
# Every file is diffed as text (--text), whatever .gitattributes says: a pull request cannot hide a file's content from the model by
# marking it binary. No external diff programs, no text conversion, and no rename detection, so each changed path has its own section.
set -euo pipefail
usage="usage: change.sh PR_REPOSITORY HEAD_SHA OUTPUT_FOLDER"
repo=${1:?$usage}
head=${2:?$usage}
out=${3:?$usage}
fail() { echo "change.sh: $1" >&2; exit 1; }
[[ $head =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]] || fail "the head is not a commit id"
second=$(git -C "$repo" rev-parse --verify --quiet 'HEAD^2^{commit}') || fail "the checkout is not a merge commit"
[ "$second" = "$head" ] || fail "the merge commit's second parent is $second, not the pull request's head $head"
args=(--no-color --no-ext-diff --no-textconv --text --no-renames HEAD^1 HEAD)
git -C "$repo" diff "${args[@]}" > "$out/change.diff"
git -C "$repo" diff --numstat -z "${args[@]}" > "$out/change.numstat"
