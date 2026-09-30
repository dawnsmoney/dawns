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

`vault/harness/tests/credit.rs` has 19 tests: every path, the flipped conditions on each, exact successor state, the lending limits, output shapes, slots that do not exist, one mark per epoch, deposit and redeem guards with the vault input run alone, and the seed and fee edges. Run them with `cargo test --offline --release --test credit`.

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

**v0.2, 264 conditions: 197 caught, 67 survive.** Run on 30 September 2026 against the 19 tests. The first pass ran the tests for the mutated function; every survivor was then run against the whole suite.

Written against this run and now caught:

- **The seed (v0.1's change) and the fee.** No test proved that a loan, a markdown, a mark, a write-off or a halt refuses to take the vault below its seed, nor that a signed move keeps everything but the fee. `the_seed_stays_and_only_the_fee_leaves` runs each path at the edge: exactly the seed plus a fee is accepted, one sompi less is refused, and an output one sompi below `inValue − maxFee` is refused.
- **Deposit and redeem.** The credit suite only ran them as whole transactions, where the share token and the accounts refuse first. `deposit_flips`, `deposit_vault_guards_alone`, `redeem_flips` and `redeem_vault_guards_alone` port the NAV vault's flips and run the vault input alone. The code is the NAV vault's, but it is copied, so this suite must hold it too.
- **Halt.** `halt_guards`: shape, signer, a halt that doesn't halt, a halt that changes the share count.
- **A mark on slot 1** above its step and its contract (only slot 0's had a test).

The 67 survivors, and why each is safe to keep untested:

- **`OpAuthOutputIdx(...)` on every path, input and output counts on every path** (20): `#[covenant.singleton]` binds the continuation, and the accounts, the repayment account and the share token pin the same shape. Kept as belt and braces.
- **Constructor constants** (14): `cap > 0`, `cap <= BPS`, `term > 0`, `term <= MAX_DAA`, the reserve-floor range, `epochLength > 0`, `markdownPeriod > 0` (four places), `maxMarkStepBps` range, `exitFeeBps <= BPS`. The deploy tool validates them, and a bad value is refused by the arithmetic that uses it.
- **Bounds implied by other checks** (15): `amount > 0`, `amount <= inValue`, `MAX_VALUE` caps, `spent >= 0`, `claimedDaa <= MAX_DAA`, `nav > 0`, `nav >= 0`, `burned > 0`, `paid − noteValue − maxFee > 0` (the minimum deposit implies it), and the seed check, which `navAt` and `redeem` each make, so each guards the other (deposit's own copy is caught).
- **Accounts and the share token, checked twice** (15): the account's vault and kind in `repay` and `redeem`, the slot range in `repay` (an account for a slot outside 0 to 2 fails its other checks first), and the `OpCov…` counts and positions of the share token on deposit and redeem, which the minter branch checks already fix.
- **`p > 0`, `due > 0` in `writeOff`** (2): writing off an empty slot changes nothing but spends a fee the valuer signs for.
- **`mandateHash == mandateHash` in `halt`** (1): true by design. It exists so the compiler keeps the mandate hash in the address (see Versions).

History: the first full run (v0.1, 200 conditions) caught 133. Its real gaps, the per-move and per-epoch limits, the exact loan to the borrower, the vault keeping all but the fee on a loan, one mark per epoch and slot numbers outside 0 to 2 in `lend`, `markdown` and `writeOff`, each have a test since.

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
