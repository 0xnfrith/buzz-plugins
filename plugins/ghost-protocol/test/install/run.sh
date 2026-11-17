#!/usr/bin/env bash
# Runs install.spec.mjs: the GHOST Protocol plugin, installed through Buzz's own "Add a plugin" dialog, started by Buzz's own loader and
# runtime, and listed in Search and in the Messages sidebar, in Buzz's production web build (headless Chromium, the app's fixture relay).
# The plugin commands go to the `buzzodz-plugins` crate of the same checkout, built here as the example bridge.rs (a pass-through; it lists
# the functions it calls). Nothing is stubbed. See install.spec.mjs for what is checked and where it fails.
#
#   plugins/ghost-protocol/test/install/run.sh /path/to/block/buzz-app/checkout [extra playwright args]
#
# The checkout needs `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium` done once, and a Rust toolchain: the one in
# its rust-toolchain.toml, or $RUSTUP_TOOLCHAIN. It must be at the BUZZ_APP_REF of .github/workflows/ghost-protocol-tests.yml. The script
# copies the spec into it (a scratch clone, not a place to commit) and takes it out again; build-bridge.sh does the same for the bridge.
#
# Where the plugin comes from, with INSTALL_SOURCE:
#   git (the default)  the repository on GitHub, as a person adds it: $INSTALL_REPOSITORY (default https://github.com/0xnfrith/buzz-plugins),
#                      branch $INSTALL_REFERENCE (default: the branch this checkout is on), folder plugins/ghost-protocol. The commit the
#                      importer reads has to be the one this checkout is at, so the checkout must be a pushed commit at the tip of that
#                      branch. This needs the network.
#   folder             the folder $INSTALL_FOLDER, as the folder picker would answer. breaks.sh uses this for copies it has broken.
# Either way the review is held to the manifest.json in this repository's plugins/ghost-protocol, as committed.
#
# $INSTALL_BRIDGE names an already built bridge; without it the script builds one (build-bridge.sh, `cargo build --locked`).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
plugin=$(cd "$here/../.." && pwd)
repo=$(cd "$plugin/../.." && pwd)
[ $# -ge 1 ] || { echo "usage: $0 <block/buzz-app checkout> [playwright args]" >&2; exit 2; }
app=$(cd "$1" && pwd); shift
[ -f "$plugin/plugin.js" ] && [ -f "$plugin/manifest.json" ] || { echo "plugins/ghost-protocol has no plugin.js and manifest.json" >&2; exit 1; }

source_kind=${INSTALL_SOURCE:-git}
export INSTALL_SOURCE=$source_kind INSTALL_COMMITTED_DIR=$plugin
case $source_kind in
  git)
    export INSTALL_SOURCE_DIR=$plugin
    export INSTALL_REPOSITORY=${INSTALL_REPOSITORY:-https://github.com/0xnfrith/buzz-plugins}
    export INSTALL_REFERENCE=${INSTALL_REFERENCE:-$(git -C "$repo" symbolic-ref --short -q HEAD || true)}
    [ -n "$INSTALL_REFERENCE" ] || { echo "::error::INSTALL_REFERENCE is the branch the importer reads, and this checkout is on no branch" >&2; exit 1; }
    export INSTALL_FOLDER_PATH=plugins/ghost-protocol
    INSTALL_EXPECTED_COMMIT=$(git -C "$repo" rev-parse HEAD)
    export INSTALL_EXPECTED_COMMIT
    # The importer reads GitHub, so a file here that differs from the commit is a plugin the importer will not install.
    if [ -n "$(git -C "$repo" status --porcelain --untracked-files=no -- plugins/ghost-protocol)" ]; then
      echo "::error::plugins/ghost-protocol differs from the commit $INSTALL_EXPECTED_COMMIT; the importer reads the commit, not this folder" >&2
      exit 1
    fi
    ;;
  folder)
    [ -n "${INSTALL_FOLDER:-}" ] && [ -f "$INSTALL_FOLDER/plugin.js" ] || { echo "INSTALL_FOLDER names a folder with plugin.js and manifest.json" >&2; exit 2; }
    INSTALL_SOURCE_DIR=$(cd "$INSTALL_FOLDER" && pwd)
    export INSTALL_SOURCE_DIR
    ;;
  *) echo "INSTALL_SOURCE is git or folder" >&2; exit 2 ;;
esac

tidy() { rm -f "$app/tests/browser/ghost-protocol-install.spec.mjs"; }
trap tidy EXIT
tidy
export INSTALL_BRIDGE=${INSTALL_BRIDGE:-$("$here/build-bridge.sh" "$app")}
[ -x "$INSTALL_BRIDGE" ] || { echo "no bridge at $INSTALL_BRIDGE" >&2; exit 1; }

cp "$here/install.spec.mjs" "$app/tests/browser/ghost-protocol-install.spec.mjs"
cd "$app"
# Not `exec`: the shell stays to take the spec out of the checkout, whatever the result.
nice -n 10 pnpm exec playwright test --config tests/browser/playwright.config.mjs \
  tests/browser/ghost-protocol-install.spec.mjs --project chromium --no-deps --workers=1 "$@"
