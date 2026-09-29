# Dawns credit vault — testnet-10 only, not audited

A NAV vault whose three slots are fixed-term loans to named borrowers.

- `dawns_credit.sil`: the vault. Shares, personal accounts, deposit and redeem work as in the NAV vault (`../nav`).
- `dawns_repay.sil`: a borrower's repayment account.

## What the network enforces

- **Where loans go.** A loan leaves only to its slot's registered borrower address. Each slot holds one loan at a time.
- **Lending limits.** A loan is never above the slot's cap of NAV. The reserve floor, per-move limit and per-epoch limit all hold. On a fixed-term vault, a loan falls due before maturity.
- **Repayments.** Repayments go only into the vault, and no key is needed to sweep them. The borrower pays the slot's repayment account, which can only be spent in the vault's `repay` shape. The one exception: the borrower can take back a payment that hasn't been swept yet.
- **Late loans lose value on a schedule.** After the grace period, a loan counts for at most principal × (1 − step × n), where n is the number of periods it is late.
  - Every deposit and redemption prices NAV with that cap.
  - Anyone can write the cap into the state (`markdown`).
  - A valuer can't hold a defaulted loan at full value, and a late redeemer can't leave at the old price.
- **Marks.** A mark rises by at most one step per epoch, and never above principal plus the contract interest. It can fall freely. A loan can be written off only once its mark is zero and its grace period is over.

## What is trusted

That the borrower repays at all. That is an off-chain loan agreement.

## Keys

Each key has one power, and no key has two:

| Key | Can | Cannot |
|---|---|---|
| Allocator | Lend | Take funds |
| Valuer | Mark and write off loans | Move funds |
| Guardian | Create the share token, halt the vault | Take funds |

Deposit, redeem, repay and markdown need no key.

## Tests

`vault/harness/tests/credit.rs` has 7 tests: every path, the flipped conditions on each, and exact successor state. Run them with `cargo test --offline --release --test credit`.

`DAWNS_UNITS=1` prints script units per input. The results:

| Path | Script units |
|---|---|
| Deposit | 141k |
| Redeem | 147k |
| Lend, mark, write-off | 98k + one signature check |
| Repay, markdown | 98k |
| Repayment account | 0.4k |

The deploy tool uses budget 28.

### Mutation test

The mutation test replaces each `require` with `require(true)` and reruns the suite. The run was partial when this was written.

Survivors so far:

- **The `bounded()` range checks** (shares, principal, due, mark ≥ 0 and ≤ bounds). These are defensive: every path computes the successor exactly from the previous state, so none can go out of range. The tests don't construct a malformed previous state, which only genesis could create.
- **`claimedDaa >= notBefore`, `epochLength > 0`, `e >= prevEpoch`, `inValue >= minKeep`, `markdownPeriod > 0`.** These are constructor constants or monotonic values the tests never violate. They stay as belt and braces.

## Deploy

The TN10 deploy runs from your own Terminal, in `vault/deploy`, using the `cargo run --release -- credit …` subcommand. Command reference: the header of `src/credit.rs`.

1. `credit init`
2. Fund the depositor key.
3. `credit genesis 20`
4. `credit token`
5. `credit keeper`

To exercise the full loan cycle, run:

1. `credit lend 2 5`
2. `credit repay 2 5.005`
3. Let slot 2's one-hour term lapse and watch the keeper mark it down.
