#!/bin/bash
# Every dawns keeper in one terminal: the NAV vault, the fixed-term vault and the
# credit vault. Each line is prefixed with its vault; a keeper that exits is
# restarted after 15 seconds. Ctrl-C stops them all.
cd "$(dirname "$0")"
export DAWNS_KEYS="$PWD/keys"
cargo build --release -q || exit 1
BIN="$PWD/target/release/dawns-vault"
run() { # name, directory, command…
  local name=$1 dir=$2; shift 2
  ( cd "$dir" && while true; do "$BIN" "$@" 2>&1 | sed -u "s/^/[$name] /"; echo "[$name] stopped, restarting in 15 s"; sleep 15; done ) &
}
trap 'kill 0' EXIT
run nav    .     nav keeper
run fixed  fixed nav keeper
run credit .     credit keeper
wait
