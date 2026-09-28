# Dawns NAV vault — v1 (testnet-10, not audited)

Anyone can deposit and redeem. Ownership is in **shares**: a KCC-20 token whose
minting branch belongs to the vault (the vault is the token's *controller
covenant*, the pattern of the reference `KCC20Minter`). The vault mints shares
only against KAS that arrives, and burns them only against KAS it pays to the
share owner, both at NAV:

```
NAV            = KAS held − the vault's own seed (minKeep) + marks of deployed positions
price / share  = NAV ÷ shares        (rounded up to mint, down to pay; 1 share = 0.01 KAS at launch)
```

| File | What it is |
|---|---|
| `dawns_nav.sil` | the vault covenant: init, allocate, recall, mark, deposit, redeem, halt |
| `dawns_account.sil` | a personal account: a plain P2SH address any wallet can pay (kind 0 deposit, 1 redeem) |
| `kcc20.sil` | the reference KCC-20 token, vendored unchanged from silverscript@84eb797 |

## How a deposit and a withdrawal work

A user never signs a covenant transaction. They send plain KAS from any wallet:

- **Deposit**: to their deposit account `Account(owner, vault, 0)`. A keeper
  (anyone) spends it into the vault. The vault reads the account's state under
  a template check, mints `(paid − note − fee) ÷ price` shares and gives them to
  a note owned by the hash of the owner's *redeem* account script.
- **Withdraw**: 1 KAS to their redeem account `Account(owner, vault, 1)`. The
  keeper spends it with one of the owner's notes. The vault checks the note is
  owned by exactly that account, burns it, and pays NAV (less the exit fee),
  plus the note's KAS and the 1 KAS, to `P2PK(owner)` and nowhere else.

The account's `enter` path only allows the two transaction shapes that read it
(deposit: 3 inputs, 3 outputs; redemption: 4 inputs, 3 outputs) led by its own
vault at input 0. Every vault path pins its exact input and output counts, so
no other path can consume an account coin. The owner can always `reclaim`.

## Guarantees

| Rule | Where |
|---|---|
| Shares minted only against KAS received, at NAV rounded up (no dilution) | `deposit` |
| Shares go to a note owned by the depositor's own redeem account | `deposit`: `redeemAccountHash(acct.owner, me)` |
| A note is burned only with its own account's coin, payout only to its owner | `redeem` |
| Exit fee stays in the vault for remaining holders | `redeem`: `exitFeeBps` |
| The share token is born owned by the vault, empty, with a minter branch | `init`: `validateOutputStateWithTemplate` |
| Allocator bound by destinations, caps, reserve, per-move and per-epoch limits | `allocate` (as v0) |
| Marks move at most `maxMarkStepBps` per epoch, by a valuer key only | `mark` |
| Halt stops allocations and deposits; recalls and redemptions go on | `halt`, `allocate`, `deposit` |
| Fixed term: redemptions from `maturity`, deposits before `depositUntil` | `redeem`, `deposit` |
| The last holder can leave in full: the seed (`minKeep`) is never in NAV | `navOf` |

Keys: **allocator** moves capital, **valuer** marks, **guardian** creates the
token and halts. Deposits and redemptions need no key.

## Proof

`../harness/tests/nav.rs` runs every path through `TxScriptEngine`:
accepted baselines, one-field flips for every guard, every field of every
successor state tampered in turn, epoch-claim abuse, out-of-range states, an
account pulled into foreign shapes, and init with a forged token. Every
`require` in `dawns_nav.sil` was then disabled one at a time (the harness reads
the covenant at run time, `DAWNS_NAV_SIL`) to show a test catches it. Of 206
guards, 177 are caught on their own. The 29 that are not are each implied by
another check, and stay as defence in depth:

- **Overlapping token checks.** In `deposit` (5 checks: token input count and
  index, output count and indices) and in `redeem` (5 likewise), any one can go
  because the others still pin the layout. Disabled *as a group*, each group
  is caught.
- **Continuation index** (`OpAuthOutputIdx … == 0/1`) in init, allocate, mark,
  deposit, redeem, halt: the other outputs are pinned (token genesis, the
  destination, token outputs) or there is only one output, so the continuation
  has nowhere else to be. (In `recall`, where it matters, it is caught.)
- **Implied by the reserve and cap checks, as in v0:** allocate `amount <= inValue`,
  `amount <= MAX_VALUE`, `cap > 0`, `reserveFloorBps >= 0`, `reserveFloorBps <= BPS`.
- **Arithmetic that fails anyway:** `epochLength > 0` (division by zero),
  deposit `price > 0` (division by zero), deposit `credit > 0` (implied by
  `minted > 0`), redeem `gross >= 0` (NAV is never negative).
- **Implied by how notes are made:** redeem `acct.vault == me`, `acct.kind == 1`,
  `burned > 0`, `burned <= shares`. Notes only come from this vault's deposit
  path, which owns each note by the depositor's redeem-account hash for this
  vault and mints at least one share; the note-ownership check then pins the
  account. (Disabled together they survive: the invariant, not the check,
  carries it.)

Compute at the real signature price (`budget_report`): the vault input uses
109–115k script units without a signature; token inputs 13–20k; accounts
under 1k. The deploy tool commits 28 / 3 / 1.

## Known limits of v1

- **One note per deposit, burned whole.** A holder with three deposits sends
  three withdrawal requests. (KCC-20 is compiled for 2 covenant inputs.)
- **Redemptions wait for liquidity.** If the payout exceeds the KAS in the
  vault, it waits until the allocator recalls capital.
- **Marks are a valuer's statement,** bounded per epoch, not an oracle.
- **No management or performance fee yet**; that needs minting to the manager.
- **The keeper is a process** (deploy tool `nav keeper`), fed by the site's
  account registry. Anyone can run one; the outcome is fixed by the covenant.
- **Bounded at 1M KAS per figure**, as v0. Testnet only, not audited, no
  outside capital before a legal review.
