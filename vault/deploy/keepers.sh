#!/bin/bash
# Every dawns keeper in one terminal: the NAV vault, the fixed-term vault, the credit
# vault and, once launched (demo-setup.sh), the demo pair. Each line is prefixed with
# its vault; a keeper that exits is restarted after 15 seconds. Ctrl-C stops them all.
cd "$(dirname "$0")"
cargo build --release -q || exit 1
BIN="$PWD/target/release/dawns-vault"
run() { # name, directory, keys directory, command…
  local name=$1 dir=$2 keys=$3; shift 3
  ( cd "$dir" && export DAWNS_KEYS="$keys" && while true; do "$BIN" "$@" 2>&1 | sed -u "s/^/[$name] /"; echo "[$name] stopped, restarting in 15 s"; sleep 15; done ) &
}
trap 'kill 0' EXIT
run nav    .     "$PWD/keys" nav keeper
run fixed  fixed "$PWD/keys" nav keeper
run credit .     "$PWD/keys" credit keeper
# the demo pair has its own strategy wallets (demo-keys)
[ -f demo-credit/credit.json ] && run demo-credit demo-credit "$PWD/demo-keys" credit keeper
[ -f demo/nav.json ] && ! grep -q '"planned"' demo/nav.json && run demo demo "$PWD/demo-keys" nav keeper
wait
