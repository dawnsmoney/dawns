# Dawns mandate vault — v0 (testnet-10, not audited)

A vault runs one investment mandate. The mandate's hard rules are compiled
into a Kaspa covenant (`dawns_vault.sil`, Silverscript, Toccata), so the
allocator **cannot** move capital outside them. It is not a policy we promise
to follow; the network refuses the transaction.

| Rule | Enforced by |
|---|---|
| Capital leaves only to the mandate's approved destinations (up to 4) | `allocate`: output 1's scriptPubKey must hash to the slot's destination |
| Each destination is capped as a share of vault value | `allocate`: `(deployed + amount) × 10⁴ ≤ cap × value` |
| A liquid reserve stays in the vault | `allocate`: `(held − amount) × 10⁴ ≥ floor × value` |
| One move and each epoch's outflow are capped | `allocate`: `maxPerMove`, `epochLimit`, monotonic epoch ratchet |
| The allocator cannot withdraw, deposit, halt or close | each path checks its own key |
| The depositor can withdraw at any time, to their own address only | `withdraw`: output 1 is P2PK(depositor); the floor binds the allocator, not the owner |
| The guardian can stop the vault, and everything goes to the depositor | `halt`: output 0 is P2PK(depositor), ≥ value − maxFee |
| The published mandate is the one the vault runs | `mandateHash` is a constructor parameter, part of the vault's address |

Three keys, three powers, never collapsed: **allocator** moves capital within
the mandate; **guardian** stops the vault but cannot take; **depositor** owns
the capital but cannot allocate.

## Proof

`harness/` runs every path through `TxScriptEngine`, the engine a Kaspa node
uses, pinned to the same rusty-kaspa and silverscript revisions as the deploy
tool.

```
cd harness && cargo test
```

- **Flip tests** (`tests/vault.rs`): every refusal is one field changed on a
  transaction the engine accepts. A refusal means nothing without its accepted
  baseline.
- **Mutation check**: each `require` in the covenant was disabled one at a
  time and the suite re-run. Every guard is caught by a test except these,
  each of which is implied by another check (they stay as defence in depth):
  - `OpAuthOutputCount(...) == 1` in the four singleton paths: the compiler's
    singleton wrapper already requires exactly one authorised output.
  - allocate `amount <= MAX_VALUE`, `amount <= inValue`: implied by
    `inValue <= MAX_VALUE` and the reserve check with a floor ≥ 0.
  - withdraw `amount <= MAX_VALUE`: implied by `amount <= inValue <= MAX_VALUE`.
  - allocate `cap > 0`: a zero cap fails the cap check for any amount > 0.
  - allocate `reserveFloorBps <= BPS`: a floor above 100% fails the reserve
    check for any amount.
  - allocate `epochLength > 0`: division by zero already fails.
  - allocate `spentThisEpoch <= epochLimit`: implied by
    `amount <= epochLimit − spentThisEpoch` with amount > 0.
- **Compute budget** (`tests/budget.rs`): every path at the real signature
  price, held under the budget the deploy tool commits.

## Known limits of v0

- **Valuation is at cost.** `deployed[i]` is what went to destination *i*
  minus what came back. The covenant cannot see an L2 position's market value,
  so caps bind on capital sent. Dawns reports marks against cost off-chain.
- **Returns are attributed by the allocator.** A recall must actually bring
  the coin into the vault, but which slot it is credited to is the
  allocator's claim. Misattribution can free one destination's cap room at
  another's expense; it cannot take value out.
- **Deployed capital is outside the covenant.** `halt` and `close` return the
  vault's liquid coin. Capital already at a destination comes back only
  through that destination (a strategy wallet, a bridge exit).
- **Transaction payloads are not constrained.** That is fine for
  pay-to-pubkey destinations. A bridge-entry destination (Igra) carries its L2
  recipient in the payload, so that needs a payload rule before any bridge is
  a destination.
- **Bounded at 1M KAS per figure** so that cap × value stays below 2⁶³;
  Silverscript integer overflow is undefined behaviour. Mainnet needs
  division-first arithmetic.
- **Not audited. Testnet only.** No outside capital before a fund-management
  legal review.

## Running it on testnet-10

`deploy/` is the operator tool (Rust, wRPC Borsh). By default it connects
through the public Kaspa resolver; set `DAWNS_RPC=ws://host:17210` to use
your own node. `DAWNS_DRY=1` validates every move locally without
broadcasting it.

```
cd deploy
cargo run --release -- status
cargo run --release -- init              # keys/ (gitignored) + draft mandate.json
# fund the depositor address it prints: https://faucet-tn10.kaspanet.io/
cargo run --release -- genesis 500       # open the vault with 500 KAS
cargo run --release -- show
cargo run --release -- allocate 0 50
cargo run --release -- recall 0 20
cargo run --release -- breach cap        # the network's refusal, on the record
cargo run --release -- withdraw 10
cargo run --release -- halt
```

`mandate.json` is fixed at genesis: `notBeforeDaa` is set then, and the hash
of its canonical form goes into the vault. `vault.json` records where the vault
lives, since its address follows its state. It is written *before* each
broadcast, and a move whose result was lost is recovered from the chain on the
next run.

**Mandate hash:** blake2b-256 (32-byte output, no key) over the mandate JSON
with object keys sorted at every depth and no whitespace.
