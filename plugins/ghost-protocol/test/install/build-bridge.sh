#!/usr/bin/env bash
# Builds bridge.rs as an example of the `buzzodz-plugins` crate in a block/buzz-app checkout, `--locked` as the app's own CI builds its
# native fixture, and prints the path of the binary (the only thing on stdout; cargo's output goes to stderr).
#
#   plugins/ghost-protocol/test/install/build-bridge.sh /path/to/block/buzz-app/checkout
#
# Needs the Rust toolchain of the checkout (its rust-toolchain.toml, or $RUSTUP_TOOLCHAIN). The example file is copied in for the build and
# taken out again; the binary stays in the checkout's target folder.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
[ $# -eq 1 ] || { echo "usage: $0 <block/buzz-app checkout>" >&2; exit 2; }
app=$(cd "$1" && pwd)
example=ghost-protocol-install-bridge
file="$app/crates/plugin-manager/examples/$example.rs"
trap 'rm -f "$file"' EXIT
cp "$here/bridge.rs" "$file"
(cd "$app" && cargo build --locked -p buzzodz-plugins --example "$example" >&2)
target=$(cd "$app" && cargo metadata --locked --no-deps --format-version=1 | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).target_directory)')
echo "$target/debug/examples/$example"
