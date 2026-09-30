# Fixed-term vault (testnet-10)

The NAV covenant with a deposit window and a maturity date. One NAV vault per
directory, so this one lives here; it uses the same keys as the NAV vault.

Launch, from this directory:

```
export DAWNS_KEYS=../keys
cargo run --release --manifest-path ../Cargo.toml -- nav genesis --window-days 3 --term-days 7
cargo run --release --manifest-path ../Cargo.toml -- nav token
cargo run --release --manifest-path ../Cargo.toml -- nav publish
```

`--window-days` and `--term-days` are counted from now and written into
`nav-mandate.json` as DAA scores (`depositUntilDaa`, `maturityDaa`) before the
mandate is fixed. Commit `nav.json` and `nav-mandate.json` and push: the site
shows the vault at /vaults/fixed-tn10.

Run its keeper alongside the NAV vault's:

```
cargo run --release --manifest-path ../Cargo.toml -- nav keeper
```

The keeper sweeps deposits only while the window is open and redemptions only
from maturity; the covenant refuses anything else.
