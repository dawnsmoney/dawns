# Dawns credit vault — testnet-10 only, not audited

A NAV vault whose three slots are fixed-term loans to named borrowers.

- `dawns_credit.sil`: the vault, v0.2. Shares, personal accounts, deposit and redeem work as in the NAV vault (`../nav`).
- `dawns_credit_v01.sil`, `dawns_credit_v0.sil`: earlier versions, kept byte for byte because vaults run them (the first TN10 vault runs v0).
- `dawns_repay.sil`: a borrower's repayment account.
- `credit-vectors.json`: mandates and states with the bytecode and address the compiler gives them (see Verifying a vault).

## Versions

| Version | Adds |
|---|---|
| v0 | The first TN10 credit vault |
| v0.1 | No loan and no fee may take the vault below its seed (`minKeep`) |
| v0.2 | The address commits to the mandate hash. The compiler drops a constructor argument no path reads, so v0 and v0.1 addresses commit to the terms the covenant checks (keys, borrowers, caps, schedule, limits) but not to the mandate document (name, strategy, labels). v0.2 reads `mandateHash` in `halt`. |

New vaults launch on v0.2 (`credit genesis` writes `"covenant": "dawns-credit/0.2"` into the ledger).

## Verifying a vault

A vault's address is blake2b-256 of its bytecode, so anyone who can rebuild the bytecode from the mandate and state can check it.

`cargo run --release -- credit template [forms.json] [vectors.json]` compiles each version once with a unique sentinel in every mandate argument and cuts the bytecode into literal bytes and named slots. Slots are filled as: `b32` (0x20 + 32 bytes), `num` (a minimal script number), `i64` (a state field: 0x08 + 8 bytes little-endian sign-magnitude), `bool` (0x01 + 00/01), and `len` (the code's own lengths, which the script pushes inside itself; the filler repeats until they settle). Each form is checked against the compiler on 200 random mandates and states per version before it is written.

The site keeps the forms in `src/lib/vaults/credit-forms.json` and fills them in `src/lib/vaults/verify-credit.ts`, which reproduces every vector here and the live TN10 vault's address. On every vault page it checks the mandate hash, the address, and (through a testnet-10 node's wRPC) that the coin at the address carries the vault's covenant id. A ledger publish from anyone is accepted if the address check passes: there is no curator list.

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

`vault/harness/tests/credit.rs` has 13 tests: every path, the flipped conditions on each, exact successor state, the lending limits, output shapes, slots that do not exist, and one mark per epoch. Run them with `cargo test --offline --release --test credit`.

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

The mutation test replaces one `require` at a time with `require(1 == 1)` and runs the suite against the mutated covenant (`DAWNS_CREDIT_SIL` points the harness at it). A mutant the suite still passes is a condition no test depends on.

The first full run (v0.1, 200 conditions) caught 133. The 67 survivors split into two kinds.

**Real gaps, now tested and caught:** the per-move limit, the per-epoch limit, the loan paid to the borrower being exactly the amount booked, the vault keeping all but the fee on a loan, one mark per epoch, and slot numbers outside 0 to 2 in `lend`, `markdown` and `writeOff`. A slot outside 0 to 2 would otherwise have fallen through to slot 0's destination while booking nothing.

**Redundant, kept as belt and braces:**

- `OpAuthOutputIdx(...) == 0` on every path: `#[covenant.singleton]` already binds the continuation output.
- Input and output counts on paths whose accounts pin the same shape (`dawns_account.sil`, `dawns_repay.sil` check them too).
- Slot bounds in `repay`: an account for a slot outside 0 to 2 is refused by the other repay checks before the bound matters.
- `MAX_VALUE` caps, `cap > 0` and `cap <= BPS`, `term > 0`, the reserve-floor range, `epochLength > 0`, `markdownPeriod > 0`: constructor constants the deploy tool validates, or conditions implied by others (`amount * BPS <= cap * nav` already refuses a zero cap).
- The `bounded()` range checks: every path computes the successor exactly from the previous state, so none can go out of range; only a malformed genesis could, and `out_of_range_state_is_refused` covers that.

## Deploy

The TN10 deploy runs from your own Terminal, in `vault/deploy`, using the `cargo run --release -- credit …` subcommand. Command reference: the header of `src/credit.rs`.

1. `credit init`
2. Fund the depositor key.
3. `credit genesis` (seeds exactly what the vault must keep, so NAV is 0 until the first deposit)
4. `credit token`
5. `credit keeper`

To exercise the full loan cycle, run:

1. `credit lend 2 5`
2. `credit repay 2 5.005`
3. Let slot 2's one-hour term lapse and watch the keeper mark it down.
