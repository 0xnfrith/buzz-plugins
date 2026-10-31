#!/usr/bin/env bash
# The workflows that build block/buzz-app name the commit they test against in `env: BUZZ_APP_REF:` and check it out as
# `${{ env.BUZZ_APP_REF }}`. Fails unless every workflow that uses it also defines it (an undefined one checks out the default branch),
# every definition is one 40-character commit, and they are all the same commit. Run from the repository root, in the first step of each
# of those workflows; the optional argument is the folder of workflow files (the test points it at made-up ones).
set -euo pipefail
shopt -s nullglob
fail() { echo "::error::$1"; exit 1; }

definition='^  BUZZ_APP_REF:'
commit='^  BUZZ_APP_REF: ([0-9a-f]{40})( .*)?$'
commits=""
for file in "${1:-.github/workflows}"/*.yml "${1:-.github/workflows}"/*.yaml; do
  defined=$(grep -c -E "$definition" "$file" || true)
  used=$(grep -c -E '^[^#]*env\.BUZZ_APP_REF' "$file" || true)
  [ "$used" = 0 ] || [ "$defined" != 0 ] || fail "$file uses env.BUZZ_APP_REF but does not define it, so its checkout would fall back to the default branch"
  [ "$defined" -le 1 ] || fail "$file defines BUZZ_APP_REF more than once"
  [ "$defined" = 0 ] && continue
  [[ $(grep -E "$definition" "$file") =~ $commit ]] || fail "$file: BUZZ_APP_REF is not a 40-character commit"
  commits+="${BASH_REMATCH[1]}"$'\n'
done
[ -n "$commits" ] || fail "no workflow defines BUZZ_APP_REF"
[ "$(sort -u <<<"$commits" | grep -c .)" = 1 ] || fail "BUZZ_APP_REF is not the same commit in every workflow that names it: change them together"
