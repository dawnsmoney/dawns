#!/bin/bash
# One-time setup of the demo pair on testnet-10, on an accelerated clock (an hour
# stands in for a month): a credit vault lending to the test borrowers for 1, 2 and
# 4 hours at 1%, 2% and 4%, and a NAV vault that lends 60% through it.
# The demo has its own strategy wallets (demo-keys); its role keys and test borrowers
# are copies of the ones in keys/, which are already funded.
set -e
cd "$(dirname "$0")"
mkdir -p demo demo-credit demo-keys
for k in allocator valuer guardian depositor borrower-0 borrower-1 borrower-2; do [ -f demo-keys/$k.key ] || cp keys/$k.key demo-keys/; done
export DAWNS_KEYS="$PWD/demo-keys"
cargo build --release -q
BIN="$PWD/target/release/dawns-vault"

no_token() { python3 -c "import json,sys; sys.exit(0 if not json.load(open('$1')).get('shareCovid') else 1)"; }
# each step runs only if not done yet: rerun the script after any failure
if [ ! -f demo-credit/credit.json ]; then
  (cd demo-credit && "$BIN" credit init >/dev/null)
  python3 demo-mandates.py credit
  (cd demo-credit && "$BIN" credit genesis)
  echo "waiting for the credit vault's coin…"; sleep 20
fi
if no_token demo-credit/credit.json; then (cd demo-credit && "$BIN" credit token && "$BIN" credit publish); fi
if grep -q '"planned"' demo/nav.json; then
  (cd demo && "$BIN" nav init >/dev/null)
  python3 demo-mandates.py nav
  (cd demo && "$BIN" nav genesis)
  echo "waiting for the NAV vault's coin…"; sleep 20
fi
if no_token demo/nav.json; then (cd demo && "$BIN" nav token); fi
echo
echo "done. Commit vault/deploy/demo and vault/deploy/demo-credit, push, and restart ./keepers.sh."
