#!/usr/bin/env bash
# Downloads Linear's public GraphQL schema (the SDK's copy in github.com/linear/linear) at a
# pinned commit and checks its hash. The tests validate every query against it, and the fake
# Linear server executes against it. The file is not committed: it is 1.3 MB of Linear's.
#
#   test/fake-linear/fetch-schema.sh
set -euo pipefail
commit=618a737a4e6aa279b7853c650f79f209a5142bbc
sha256=20061a8427b66237c3e850775ddf0450b6d2de73a6250735d5e6b17070d4f7c8
here=$(cd "$(dirname "$0")" && pwd)
out="$here/schema.graphql"
if [ -f "$out" ] && [ "$(sha256sum "$out" | cut -d' ' -f1)" = "$sha256" ]; then exit 0; fi
curl -fsSL "https://raw.githubusercontent.com/linear/linear/$commit/packages/sdk/src/schema.graphql" -o "$out.tmp"
got=$(sha256sum "$out.tmp" | cut -d' ' -f1)
if [ "$got" != "$sha256" ]; then
  rm -f "$out.tmp"
  echo "schema.graphql hash mismatch: got $got, want $sha256" >&2
  exit 1
fi
mv "$out.tmp" "$out"
