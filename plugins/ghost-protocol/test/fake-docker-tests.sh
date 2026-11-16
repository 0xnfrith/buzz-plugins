#!/usr/bin/env bash
# Runs the node:test files of the fake `docker` (test/fake-docker/*.test.mjs) and fails when they did not really run. Needs only node.
#
#   plugins/ghost-protocol/test/fake-docker-tests.sh [folder]
#
# The folder defaults to test/fake-docker beside this script. Until it exists there is nothing to run, and the script says so and passes.
# Once it exists it must hold at least one *.test.mjs file (`node --test` with a glob that matches nothing exits 0 with "tests 0", so a
# renamed file or a wrong glob would otherwise pass green with nothing run: a folder with a test file always runs at least one test), and the
# run must pass: a failing test fails it (node's exit code), and a test that is skipped or left as a todo did not run, so it fails it too.
# test/unit/fake-docker-tests.test.ts runs this script on made-up folders.
set -euo pipefail
dir=${1:-$(cd "$(dirname "$0")" && pwd)/fake-docker}
if [ ! -d "$dir" ]; then
  echo "$dir is not there yet: nothing to run."
  exit 0
fi
if ! compgen -G "$dir/*.test.mjs" >/dev/null; then
  echo "::error::$dir has no *.test.mjs file, so none of its tests would run"
  exit 1
fi
report=$(mktemp)
trap 'rm -f "$report"' EXIT
# The result for people on stdout, and the same run as TAP in a file, whose totals are checked below. A failing test fails the run here.
node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=tap --test-reporter-destination="$report" "$dir"/*.test.mjs
tests=$(sed -n 's/^# tests \([0-9][0-9]*\)$/\1/p' "$report")
skipped=$(sed -n 's/^# skipped \([0-9][0-9]*\)$/\1/p' "$report")
todo=$(sed -n 's/^# todo \([0-9][0-9]*\)$/\1/p' "$report")
if [ "${skipped:-x}" != 0 ] || [ "${todo:-x}" != 0 ]; then
  echo "::error::the fake docker's tests are not all run: ${skipped:-an unreadable number of} skipped, ${todo:-an unreadable number of} left as a todo"
  exit 1
fi
echo "Fake docker tests: ${tests:-?} ran, all passed."
