#!/usr/bin/env bash
# A check that cannot fail proves nothing. This runs the install check (run.sh, from a folder on disk, through the folder importer) on a copy of
# the committed GHOST Protocol plugin that is not broken, and on copies broken one way each (make-breaks.mjs). It fails unless the whole copy
# passes and every broken copy fails, and fails at the step that break is meant to reach, with that step's own text: a harness error, a network
# error or an earlier step failing would not count. Nothing broken leaves this machine: the copies are in a scratch folder.
#
#   plugins/ghost-protocol/test/install/breaks.sh /path/to/block/buzz-app/checkout
#
# The same checkout, and the same set-up, as run.sh needs. $INSTALL_BRIDGE names an already built bridge; without it one is built.
# $INSTALL_ARTIFACTS, if set, is a folder that gets the Playwright results of every copy that did not go as it should.
# Two cases read GitHub (the unreachable host and the commit that does not match), as run.sh does without INSTALL_SOURCE=folder: the branch is
# $INSTALL_REFERENCE, or the branch this checkout is on, and it has to be pushed.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
plugin=$(cd "$here/../.." && pwd)
[ $# -eq 1 ] || { echo "usage: $0 <block/buzz-app checkout>" >&2; exit 2; }
app=$(cd "$1" && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

export INSTALL_BRIDGE=${INSTALL_BRIDGE:-$("$here/build-bridge.sh" "$app")}
node "$here/make-breaks.mjs" "$plugin" "$scratch/copies" >"$scratch/breaks.tsv"

wrong=0
rows=()
# One run of the install check. `name` and `expect` say which and what it must say; the rest are the variables that set the source.
attempt() {
  local name=$1 expect=$2 verdict="" status=0 started=$SECONDS log="$scratch/$1.log"
  shift 2
  echo "::group::Install check on '$name'"
  env "$@" "$here/run.sh" "$app" >"$log" 2>&1 </dev/null || status=$?
  if [ "$expect" = "-" ]; then
    [ "$status" = 0 ] || verdict="the copy that is not broken failed"
  elif [ "$status" = 0 ]; then
    verdict="the check passed a broken copy"
  elif ! grep -Eq -- "$expect" "$log"; then
    verdict="it failed, but not where it should: the failure does not match /$expect/"
  fi
  if [ -n "$verdict" ]; then
    cat "$log"
    wrong=1
    [ -n "${INSTALL_ARTIFACTS:-}" ] && [ -d "$app/test-results" ] && mkdir -p "$INSTALL_ARTIFACTS/$name" && cp -r "$app/test-results/." "$INSTALL_ARTIFACTS/$name/" || true
    echo "::error::$name: $verdict"
  else
    # What the check said, in one line: Playwright's own words for it.
    grep -E -m1 -- "$([ "$expect" = "-" ] && echo '[0-9]+ passed' || echo "$expect")" "$log" || true
  fi
  echo "::endgroup::"
  local took=$((SECONDS - started))
  if [ -n "$verdict" ]; then rows+=("| $name | WRONG: $verdict | ${took}s |"); elif [ "$expect" = "-" ]; then rows+=("| $name | passed, as it must | ${took}s |"); else rows+=("| $name | failed at its step, as it must | ${took}s |"); fi
}

while IFS=$'\t' read -r name expect; do
  attempt "$name" "$expect" INSTALL_SOURCE=folder "INSTALL_FOLDER=$scratch/copies/$name"
done <"$scratch/breaks.tsv"

# GitHub cannot be reached. A host under .invalid never resolves, whatever the network is, so this needs none. The importer's own error says
# so, the clone is tried a second time (the log line), and the check ends in [network], not in a failure that looks like the plugin's.
attempt "github-unreachable" '\[network\] the Git importer could not reach GitHub, twice' \
  INSTALL_SOURCE=git INSTALL_REPOSITORY=https://github.invalid/0xnfrith/buzz-plugins INSTALL_REFERENCE=main
for text in 'retrying the clone once' 'Could not resolve host'; do
  grep -q "$text" "$scratch/github-unreachable.log" || { echo "::error::github-unreachable: the log does not say '$text'"; wrong=1; }
done

# The importer reads GitHub and gets a commit that is not the one the job is told it checked out (a commit id that is nobody's). The check has
# to end in [commit]: a guard that compared the wrong thing would let a branch that moved, or the wrong branch, pass. This one reads GitHub, so
# it needs the network, like the install check itself.
attempt "commit-mismatch" '\[commit\] the importer read' \
  INSTALL_SOURCE=git INSTALL_COMMIT_OVERRIDE=0123456789abcdef0123456789abcdef01234567

{
  echo "| Copy of the plugin | Install check | Time |"
  echo "| --- | --- | --- |"
  printf '%s\n' "${rows[@]}"
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
[ "$wrong" = 0 ]
