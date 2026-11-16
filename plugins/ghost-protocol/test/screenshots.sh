#!/usr/bin/env bash
# Makes the pictures in the plugin's README again, into screenshots/, from the real Buzz web build, and checks them (see
# test/web/screenshots.spec.mjs for how each one is made). Run it when a Buzz screen the README shows changes, then read every picture
# before committing it.
#
#   plugins/ghost-protocol/test/screenshots.sh /path/to/block/buzz-app/checkout [extra playwright args]
#
# The checkout is the one test/run.sh takes: the commit BUZZ_APP_REF pins, with its own install and Chromium.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
export GHOST_PROTOCOL_SHOTS="$here/screenshots"
export GHOST_PROTOCOL_SPECS=tests/browser/ghost-protocol-screenshots.spec.mjs
exec "$here/test/run.sh" "$@"
