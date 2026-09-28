//! Flip tests: every refusal is one field changed on a transaction the engine
//! ACCEPTS. A refusal only means something next to an accepted baseline.

use dawns_vault_harness::*;
use kaspa_consensus_core::tx::Transaction;
use silverscript_lang::ast::Expr;

const VAULT: i64 = 1_000 * KAS;
const FEE: i64 = 5_000;

fn ok(r: Result<(), kaspa_txscript_errors::TxScriptError>, what: &str) {
    assert!(r.is_ok(), "{what}: expected ACCEPT, got {r:?}");
}
fn no(r: Result<(), kaspa_txscript_errors::TxScriptError>, what: &str) {
    assert!(r.is_err(), "{what}: expected REFUSE, engine accepted");
    if std::env::var("WHY").is_ok() { eprintln!("REFUSED {what}: {:?}", r.unwrap_err()); }
}

// ---------------------------------------------------------------------------
// allocate
// ---------------------------------------------------------------------------
#[derive(Clone)]
struct Alloc {
    m: Mandate,
    prev: Acct,
    vault_value: i64,
    slot: i64,
    amount: i64,
    claimed_daa: i64,
    lock_time: u64,
    pay_to_slot: usize,   // which destination output 1 actually pays
    next: Option<Acct>,   // successor the transaction DECLARES (None = the correct one)
    fee: i64,
    signer: u8,           // 0 allocator, 1 depositor, 2 stranger
    pay_extra: i64,       // output 1 pays amount + this (continuation gives it up)
    layout: u8,           // 0 normal; 1 a second vault output splits off; 2 vault moved to index 2, output 0 pays a stranger
}

impl Alloc {
    fn valid() -> Self {
        Alloc {
            m: Mandate::default(),
            prev: Acct { principal: VAULT, ..Default::default() },
            vault_value: VAULT,
            slot: 0,
            amount: 300 * KAS,
            claimed_daa: 1_500,
            lock_time: 1_500,
            pay_to_slot: 0,
            next: None,
            fee: FEE,
            signer: 0,
            pay_extra: 0,
            layout: 0,
        }
    }
    fn correct_next(&self) -> Acct {
        let epoch = (self.claimed_daa - self.m.not_before) / self.m.epoch_length;
        let spent = if epoch == self.prev.epoch_index { self.prev.epoch_spent } else { 0 };
        let mut n = self.prev;
        n.deployed[self.slot.clamp(0, 3) as usize] += self.amount;
        n.epoch_index = epoch;
        n.epoch_spent = spent + self.amount;
        n
    }
    fn run(&self) -> Result<(), kaspa_txscript_errors::TxScriptError> {
        let cur = compile(&self.m, &self.prev);
        let next = self.next.unwrap_or_else(|| self.correct_next());
        let succ = compile(&self.m, &next);
        let d = dest_keys();
        let pay_spk = p2pk_spk(xonly(&d[self.pay_to_slot]));
        let tx: Transaction = new_tx(
            vec![tx_input(0, vec![])],
            {
                let keep = (self.vault_value - self.amount - self.pay_extra - self.fee) as u64;
                let pay = out_to((self.amount + self.pay_extra) as u64, pay_spk);
                match self.layout {
                    0 => vec![continuation(&succ, keep), pay],
                    1 => vec![continuation(&succ, keep - 1_000), pay, continuation(&succ, 1_000)],
                    _ => vec![out_to(keep - 1_000, p2pk_spk(xonly(&stranger()))), pay, continuation(&succ, 1_000)],
                }
            },
            self.lock_time,
        );
        let signer = match self.signer { 0 => allocator(), 1 => depositor(), _ => stranger() };
        let (slot, amount, daa) = (self.slot, self.amount, self.claimed_daa);
        run_signed(tx, vec![vault_utxo(&cur, self.vault_value as u64)], &signer, |sig| {
            decl_sigscript(&cur, "allocate", vec![state(&next), Expr::int(slot), Expr::int(amount), Expr::int(daa), Expr::bytes(sig)])
        })
    }
}

#[test]
fn allocate_baseline_accepted() { ok(Alloc::valid().run(), "valid allocation"); }

#[test]
fn allocate_over_destination_cap() {
    // 200 KAS already at destination 0; vault value still 1000. 200 more is 40%: allowed.
    let mut a = Alloc::valid();
    a.prev.deployed[0] = 200 * KAS;
    a.vault_value = 800 * KAS;
    a.amount = 200 * KAS;
    ok(a.run(), "exactly at the 40% cap");
    // one sompi more is refused
    a.amount = 200 * KAS + 1;
    no(a.run(), "one sompi over the cap");
}

#[test]
fn allocate_reserve_floor() {
    // Floor 70%: 300 out of 1000 leaves exactly 700 → allowed; 300 + 1 → refused.
    let mut a = Alloc::valid();
    a.m.reserve_floor_bps = 7_000;
    ok(a.run(), "leaves exactly the floor");
    a.amount = 300 * KAS + 1;
    a.m.max_per_move = 400 * KAS;
    a.m.caps[0] = 5_000;
    no(a.run(), "dips one sompi under the floor");
}

#[test]
fn allocate_wrong_destination() {
    let mut a = Alloc::valid();
    a.pay_to_slot = 1; // slot 0 declared, destination 1 paid
    no(a.run(), "pays a different approved destination than the slot it claims");
}

#[test]
fn allocate_unused_slot() {
    let mut a = Alloc::valid();
    a.slot = 3;
    a.pay_to_slot = 3;
    no(a.run(), "slot 3 has no destination and a zero cap");
}

#[test]
fn allocate_slot_out_of_range() {
    let mut a = Alloc::valid();
    a.slot = 4;
    no(a.run(), "slot 4 does not exist");
    a.slot = -1;
    no(a.run(), "negative slot");
    // The attack the bound stops: slot 4 selects no branch, so it would read
    // destination 0's rules but record the move in no slot at all.
    let mut b = Alloc::valid();
    b.slot = 4;
    b.pay_to_slot = 0;
    let mut n = b.prev;
    n.epoch_index = 0;
    n.epoch_spent = b.amount;
    b.next = Some(n);
    no(b.run(), "slot 4 paying destination 0 with nothing recorded");
}

#[test]
fn allocate_pays_exactly_the_amount() {
    let mut a = Alloc::valid();
    a.pay_extra = 1;
    no(a.run(), "destination receives one sompi more than recorded");
    a.pay_extra = -1;
    no(a.run(), "destination receives one sompi less than recorded");
}

#[test]
fn allocate_cannot_touch_principal() {
    let mut a = Alloc::valid();
    let mut n = a.correct_next();
    n.principal += 1;
    a.next = Some(n);
    no(a.run(), "allocator inflates principal");
}

#[test]
fn allocate_max_per_move() {
    let mut a = Alloc::valid();
    a.m.caps[0] = 5_000;
    a.amount = 300 * KAS + 1;
    no(a.run(), "one sompi over the per-move cap");
}

#[test]
fn allocate_epoch_limit_and_ratchet() {
    // 400 already spent this epoch: 100 more fits, 100 + 1 does not.
    let mut a = Alloc::valid();
    a.prev.epoch_spent = 400 * KAS;
    a.prev.deployed[1] = 400 * KAS; // where the earlier 400 went
    a.vault_value = 600 * KAS;
    a.amount = 100 * KAS;
    ok(a.run(), "fills the epoch exactly");
    a.amount = 100 * KAS + 1;
    no(a.run(), "one sompi over the epoch limit");

    // Next epoch: the allowance resets.
    let mut b = a.clone();
    b.amount = 200 * KAS;
    b.claimed_daa = 2_500;
    b.lock_time = 2_500;
    ok(b.run(), "fresh allowance in the next epoch");

    // Rewind: an allocator in epoch 2 claiming epoch 1 for a fresh allowance.
    let mut c = Alloc::valid();
    c.prev.epoch_index = 2;
    c.prev.epoch_spent = 500 * KAS;
    c.claimed_daa = 2_500; // epoch 1
    c.lock_time = 3_600;
    no(c.run(), "rewinding the epoch to reset the allowance");
}

#[test]
fn allocate_claimed_daa_must_be_reached() {
    let mut a = Alloc::valid();
    a.lock_time = 1_499; // claims 1500, chain proves only 1499
    no(a.run(), "claimed DAA beyond the transaction's lock time");
}

#[test]
fn allocate_successor_must_record_the_move() {
    let mut a = Alloc::valid();
    a.next = Some(Acct { principal: VAULT, epoch_index: 0, epoch_spent: 300 * KAS, ..Default::default() });
    no(a.run(), "successor forgets the deployed amount");
    let mut b = Alloc::valid();
    let mut n = b.correct_next();
    n.epoch_spent = 0;
    b.next = Some(n);
    no(b.run(), "successor resets the epoch counter");
}

#[test]
fn allocate_fee_is_bounded() {
    let mut a = Alloc::valid();
    a.fee = MAX_FEE + 1;
    no(a.run(), "continuation short by more than maxFee");
}

#[test]
fn allocate_needs_the_allocator() {
    let mut a = Alloc::valid();
    a.signer = 1;
    no(a.run(), "the depositor cannot allocate");
    a.signer = 2;
    no(a.run(), "a stranger cannot allocate");
}

// ---------------------------------------------------------------------------
// recall, deposit, withdraw
// ---------------------------------------------------------------------------
fn run_inflow(func: &str, prev: Acct, next: Acct, slot: Option<i64>, amount: i64, landed: i64, signer: u8) -> Result<(), kaspa_txscript_errors::TxScriptError> {
    let m = Mandate::default();
    let cur = compile(&m, &prev);
    let succ = compile(&m, &next);
    let incoming = plain_utxo(amount as u64, p2pk_spk(xonly(&stranger())));
    let tx = new_tx(
        vec![tx_input(0, vec![]), tx_input(1, vec![])],
        vec![continuation(&succ, landed as u64)],
        0,
    );
    let signer = match signer { 0 => allocator(), 1 => depositor(), _ => stranger() };
    let func = func.to_string();
    run_signed(tx, vec![vault_utxo(&cur, VAULT as u64), incoming], &signer, |sig| {
        let mut args = vec![state(&next)];
        if let Some(s) = slot { args.push(Expr::int(s)); }
        args.push(Expr::int(amount));
        args.push(Expr::bytes(sig));
        decl_sigscript(&cur, &func, args)
    })
}

#[test]
fn recall_brings_capital_home() {
    let prev = Acct { deployed: [300 * KAS, 0, 0, 0], principal: VAULT, ..Default::default() };
    let next = Acct { deployed: [100 * KAS, 0, 0, 0], ..prev };
    ok(run_inflow("recall", prev, next, Some(0), 200 * KAS, VAULT + 200 * KAS - FEE, 0), "200 back from destination 0");
    // a profit: 350 back against 300 at cost zeroes the slot, never negative
    let next = Acct { deployed: [0, 0, 0, 0], ..prev };
    ok(run_inflow("recall", prev, next, Some(0), 350 * KAS, VAULT + 350 * KAS - FEE, 0), "return above cost");
    let neg = Acct { deployed: [-50 * KAS, 0, 0, 0], ..prev };
    no(run_inflow("recall", prev, neg, Some(0), 350 * KAS, VAULT + 350 * KAS - FEE, 0), "slot driven negative");
    // the coin must actually land
    let next = Acct { deployed: [100 * KAS, 0, 0, 0], ..prev };
    no(run_inflow("recall", prev, next, Some(0), 200 * KAS, VAULT - FEE, 0), "claims a return that never arrived");
    no(run_inflow("recall", prev, next, Some(0), 200 * KAS, VAULT + 200 * KAS - FEE, 2), "stranger signs a recall");
}

#[test]
fn deposit_grows_principal() {
    let prev = Acct { principal: VAULT, ..Default::default() };
    let next = Acct { principal: VAULT + 50 * KAS, ..prev };
    ok(run_inflow("deposit", prev, next, None, 50 * KAS, VAULT + 50 * KAS - FEE, 1), "depositor tops up");
    no(run_inflow("deposit", prev, next, None, 50 * KAS, VAULT + 50 * KAS - FEE, 0), "the allocator cannot deposit");
    let wrong = Acct { principal: VAULT + 60 * KAS, ..prev };
    no(run_inflow("deposit", prev, wrong, None, 50 * KAS, VAULT + 50 * KAS - FEE, 1), "principal inflated beyond the deposit");
}

fn run_withdraw_paying(amount: i64, paid: i64, next: Acct, pay_to_depositor: bool, signer: u8) -> Result<(), kaspa_txscript_errors::TxScriptError> {
    let m = Mandate::default();
    let prev = Acct { deployed: [300 * KAS, 0, 0, 0], principal: VAULT, ..Default::default() };
    let cur = compile(&m, &prev);
    let succ = compile(&m, &next);
    let who = if pay_to_depositor { depositor() } else { stranger() };
    let tx = new_tx(
        vec![tx_input(0, vec![])],
        vec![continuation(&succ, (VAULT - paid - FEE) as u64), out_to(paid as u64, p2pk_spk(xonly(&who)))],
        0,
    );
    let signer = match signer { 0 => allocator(), 1 => depositor(), _ => stranger() };
    run_signed(tx, vec![vault_utxo(&cur, VAULT as u64)], &signer, |sig| {
        decl_sigscript(&cur, "withdraw", vec![state(&next), Expr::int(amount), Expr::bytes(sig)])
    })
}

fn run_withdraw(amount: i64, next: Acct, pay_to_depositor: bool, signer: u8) -> Result<(), kaspa_txscript_errors::TxScriptError> {
    run_withdraw_paying(amount, amount, next, pay_to_depositor, signer)
}

#[test]
fn withdraw_is_the_depositors_right() {
    let base = Acct { deployed: [300 * KAS, 0, 0, 0], principal: VAULT, ..Default::default() };
    let next = Acct { principal: VAULT - 600 * KAS, ..base };
    // 600 out of 1000 ignores the 10% floor: the floor binds the allocator, not the owner.
    ok(run_withdraw(600 * KAS, next, true, 1), "depositor withdraws below the allocator's floor");
    no(run_withdraw(600 * KAS, next, false, 1), "withdrawal paid to someone else");
    no(run_withdraw(600 * KAS, next, true, 0), "the allocator cannot withdraw");
    no(run_withdraw(600 * KAS, next, true, 2), "a stranger cannot withdraw");
    // principal must fall by what left, and exactly the recorded amount leaves
    let kept = Acct { principal: VAULT, ..base };
    no(run_withdraw(600 * KAS, kept, true, 1), "withdrawal leaves principal untouched");
    no(run_withdraw_paying(600 * KAS, 600 * KAS + 1, next, true, 1), "pays one sompi more than recorded");
}

// ---------------------------------------------------------------------------
// halt, close
// ---------------------------------------------------------------------------
fn run_exit(func: &str, to_depositor: bool, landed: i64, signer: u8) -> Result<(), kaspa_txscript_errors::TxScriptError> {
    let m = Mandate::default();
    let prev = Acct { deployed: [300 * KAS, 0, 0, 0], principal: VAULT, ..Default::default() };
    let cur = compile(&m, &prev);
    let who = if to_depositor { depositor() } else { guardian() };
    let tx = new_tx(vec![tx_input(0, vec![])], vec![out_to(landed as u64, p2pk_spk(xonly(&who)))], 0);
    let signer = match signer { 0 => allocator(), 1 => depositor(), 3 => guardian(), _ => stranger() };
    let func = func.to_string();
    run_signed(tx, vec![vault_utxo(&cur, VAULT as u64)], &signer, |sig| entry_sigscript(&cur, &func, vec![Expr::bytes(sig)]))
}

#[test]
fn halt_stops_but_cannot_take_or_burn() {
    ok(run_exit("halt", true, VAULT - FEE, 3), "guardian halts: everything to the depositor");
    no(run_exit("halt", false, VAULT - FEE, 3), "guardian pays itself");
    no(run_exit("halt", true, 1, 3), "guardian burns the balance to fees");
    no(run_exit("halt", true, VAULT - FEE, 0), "the allocator cannot halt");
}

#[test]
fn close_is_the_depositors() {
    ok(run_exit("close", true, VAULT - FEE, 1), "depositor closes the vault");
    no(run_exit("close", true, VAULT - FEE, 3), "the guardian cannot close to itself via close");
    no(run_exit("close", false, VAULT - FEE, 1), "close pays someone other than the depositor");
}

// ---------------------------------------------------------------------------
// guards found by mutation: each test below fails if its one line is removed
// ---------------------------------------------------------------------------
#[test]
fn allocate_negative_slot_records_nothing() {
    // slot -1 selects no branch: destination 0's rules, no slot recorded
    let mut a = Alloc::valid();
    a.slot = -1;
    let mut n = a.prev;
    n.epoch_spent = a.amount;
    a.next = Some(n);
    no(a.run(), "slot -1 paying destination 0 with nothing recorded");
}

#[test]
fn allocate_zero_is_not_a_move() {
    let mut a = Alloc::valid();
    a.amount = 0;
    no(a.run(), "a zero allocation");
}

#[test]
fn allocate_refuses_corrupt_prior_state() {
    for k in 0..4 {
        let mut a = Alloc::valid();
        a.prev.deployed[k] = -KAS;
        no(a.run(), "negative exposure in the prior state");
        if k > 0 {
            // floor 0 and a slot other than the one being paid, so only the bound can refuse
            let mut b = Alloc::valid();
            b.m.reserve_floor_bps = 0;
            b.prev.deployed[k] = 100_000_000_000_000; // exactly MAX_VALUE: legal
            ok(b.run(), "exposure at the value bound");
            b.prev.deployed[k] += 1;
            no(b.run(), "exposure above the value bound");
        }
    }
    let mut c = Alloc::valid();
    c.prev.epoch_spent = -1_000 * KAS;
    no(c.run(), "negative spend manufactures allowance");
}

#[test]
fn allocate_refuses_a_broken_mandate() {
    // a destination with a zero cap is closed, even with a real address
    let d = dest_keys();
    let mut a = Alloc::valid();
    a.m.dests[3] = dest_hash(&p2pk_spk(xonly(&d[3])));
    a.m.caps[3] = 1_000;
    a.slot = 3;
    a.pay_to_slot = 3;
    a.amount = 100 * KAS;
    ok(a.run(), "slot 3 open at 10%");
    a.m.caps[3] = 0;
    no(a.run(), "slot 3 with a zero cap");

    let mut b = Alloc::valid();
    b.m.caps[0] = 10_000;
    ok(b.run(), "a 100% cap is legal");
    b.m.caps[0] = 10_001;
    no(b.run(), "a cap above 100%");

    let mut c = Alloc::valid();
    c.m.reserve_floor_bps = 0;
    ok(c.run(), "a zero floor is legal");
    c.m.reserve_floor_bps = -1;
    no(c.run(), "a negative floor");

    let mut e = Alloc::valid();
    let mut n = e.correct_next();
    e.m.epoch_length = 0;
    n.epoch_index = 1 << 40; // whatever the successor claims
    e.next = Some(n);
    no(e.run(), "zero-length epochs");
}

#[test]
fn allocate_before_the_mandate_starts() {
    let mut a = Alloc::valid();
    a.claimed_daa = 999; // not_before is 1000
    no(a.run(), "claims a DAA score before notBefore");
}

#[test]
fn allocate_successor_touches_only_its_slot() {
    for k in 1..4 {
        let mut a = Alloc::valid();
        let mut n = a.correct_next();
        n.deployed[k] += 1;
        a.next = Some(n);
        no(a.run(), "successor also moves another slot");
    }
    let mut b = Alloc::valid();
    let mut n = b.correct_next();
    n.epoch_index += 1;
    b.next = Some(n);
    no(b.run(), "successor jumps the epoch ahead");
}

#[test]
fn allocate_vault_stays_one_output_at_index_0() {
    let mut a = Alloc::valid();
    a.layout = 1;
    no(a.run(), "the vault splits into two covenant outputs");
    a.layout = 2;
    no(a.run(), "output 0 pays a stranger, the vault continues as dust at index 2");
}

// recall, generalised
#[derive(Clone)]
struct Recall { prev: Acct, next: Acct, slot: i64, amount: i64, landed: i64, split: bool, vault_value: i64 }
impl Recall {
    fn valid() -> Self {
        let prev = Acct { deployed: [300 * KAS, 0, 0, 0], principal: VAULT, epoch_index: 1, epoch_spent: 300 * KAS };
        Recall { prev, next: Acct { deployed: [100 * KAS, 0, 0, 0], ..prev }, slot: 0, amount: 200 * KAS, landed: VAULT + 200 * KAS - FEE, split: false, vault_value: VAULT }
    }
    fn run(&self) -> Result<(), kaspa_txscript_errors::TxScriptError> {
        let m = Mandate::default();
        let cur = compile(&m, &self.prev);
        let succ = compile(&m, &self.next);
        let incoming = plain_utxo(self.amount.unsigned_abs(), p2pk_spk(xonly(&stranger())));
        let outs = if self.split {
            vec![continuation(&succ, self.landed as u64 - 1_000), continuation(&succ, 1_000)]
        } else {
            vec![continuation(&succ, self.landed as u64)]
        };
        let tx = new_tx(vec![tx_input(0, vec![]), tx_input(1, vec![])], outs, 0);
        let (next, slot, amount) = (self.next, self.slot, self.amount);
        run_signed(tx, vec![vault_utxo(&cur, self.vault_value as u64), incoming], &allocator(), |sig| {
            decl_sigscript(&cur, "recall", vec![state(&next), Expr::int(slot), Expr::int(amount), Expr::bytes(sig)])
        })
    }
}

#[test]
fn recall_baseline_accepted() { ok(Recall::valid().run(), "valid recall"); }

#[test]
fn recall_negative_amount_cannot_drain() {
    // -200 would pass "continuation >= inValue + amount - maxFee" with 200 KAS
    // missing, and inflate the slot's recorded exposure.
    let mut r = Recall::valid();
    r.amount = -200 * KAS;
    r.next = Acct { deployed: [500 * KAS, 0, 0, 0], ..r.prev };
    r.landed = VAULT - 200 * KAS - FEE;
    no(r.run(), "negative recall takes coin out");
}

#[test]
fn recall_slot_bounds() {
    for slot in [-1, 4] {
        let mut r = Recall::valid();
        r.slot = slot;
        r.next = r.prev;
        no(r.run(), "recall into a slot that does not exist");
    }
}

#[test]
fn recall_preserves_everything_else() {
    let mut r = Recall::valid();
    r.next.principal += 1;
    no(r.run(), "recall inflates principal");
    let mut r = Recall::valid();
    r.next.epoch_spent = 0;
    no(r.run(), "recall resets the epoch allowance");
    let mut r = Recall::valid();
    r.next.epoch_index += 1;
    no(r.run(), "recall moves the epoch");
    for k in 1..4 {
        let mut r = Recall::valid();
        r.next.deployed[k] += 1;
        no(r.run(), "recall touches another slot");
    }
}

#[test]
fn recall_refuses_corrupt_prior_state() {
    for k in 0..4 {
        let mut r = Recall::valid();
        // the slot being recalled floors at 0 either way; the others must be sane
        r.prev.deployed[k] = if k == 0 { -KAS } else { -1 };
        r.next = r.prev;
        r.next.deployed[0] = if k == 0 { 0 } else { 100 * KAS };
        no(r.run(), "negative exposure in the prior state");
    }
    for k in 1..4 {
        let mut r = Recall::valid();
        r.prev.deployed[k] = 100_000_000_000_000;
        r.next = Acct { deployed: [100 * KAS, 0, 0, 0], ..r.prev };
        r.next.deployed[k] = r.prev.deployed[k];
        ok(r.run(), "exposure at the value bound");
        r.prev.deployed[k] += 1;
        r.next.deployed[k] += 1;
        no(r.run(), "exposure above the value bound");
    }
}

#[test]
fn recall_vault_stays_one_output() {
    let mut r = Recall::valid();
    r.split = true;
    no(r.run(), "recall splits the vault");
}

const MAX_VALUE: i64 = 100_000_000_000_000;

#[test]
fn value_bounds_hold() {
    // A vault above the v0 bound (1M KAS) refuses to allocate: cap × nav must stay far below 2^63.
    let mut a = Alloc::valid();
    a.vault_value = MAX_VALUE;
    a.prev.principal = MAX_VALUE;
    ok(a.run(), "a vault exactly at the bound");
    a.vault_value = MAX_VALUE + 1;
    no(a.run(), "a vault above the bound");

    let mut r = Recall::valid();
    r.vault_value = MAX_VALUE;
    r.landed = MAX_VALUE + 200 * KAS - FEE;
    ok(r.run(), "recall into a vault at the bound");
    r.vault_value = MAX_VALUE + 1;
    r.landed += 1;
    no(r.run(), "recall into a vault above the bound");

    let mut r = Recall::valid();
    r.amount = MAX_VALUE;
    r.next.deployed[0] = 0;
    r.landed = VAULT + MAX_VALUE - FEE;
    ok(r.run(), "a recall of exactly the bound");
    r.amount = MAX_VALUE + 1;
    r.landed += 1;
    no(r.run(), "a recall above the bound");
}

// ---------------------------------------------------------------------------
// deposit, withdraw, close: the depositor's paths, guard by guard
// ---------------------------------------------------------------------------
fn base_acct() -> Acct { Acct { deployed: [300 * KAS, 0, 0, 0], principal: VAULT, epoch_index: 1, epoch_spent: 300 * KAS } }

#[derive(Clone)]
struct Deposit { prev: Acct, next: Acct, amount: i64, landed: i64, layout: u8, vault_value: i64 }
impl Deposit {
    fn valid() -> Self {
        let prev = base_acct();
        Deposit { prev, next: Acct { principal: prev.principal + 50 * KAS, ..prev }, amount: 50 * KAS, landed: VAULT + 50 * KAS - FEE, layout: 0, vault_value: VAULT }
    }
    fn run(&self) -> Result<(), kaspa_txscript_errors::TxScriptError> {
        let m = Mandate::default();
        let (cur, succ) = (compile(&m, &self.prev), compile(&m, &self.next));
        let incoming = plain_utxo(self.amount.unsigned_abs().max(1), p2pk_spk(xonly(&depositor())));
        let outs = match self.layout {
            0 => vec![continuation(&succ, self.landed as u64)],
            // vault moved to index 1; output 0 pays a stranger what the vault should hold
            _ => vec![out_to(self.landed as u64, p2pk_spk(xonly(&stranger()))), continuation(&succ, 1_000)],
        };
        let tx = new_tx(vec![tx_input(0, vec![]), tx_input(1, vec![])], outs, 0);
        let (next, amount) = (self.next, self.amount);
        run_signed(tx, vec![vault_utxo(&cur, self.vault_value as u64), incoming], &depositor(), |sig| {
            decl_sigscript(&cur, "deposit", vec![state(&next), Expr::int(amount), Expr::bytes(sig)])
        })
    }
}

#[test]
fn deposit_guards() {
    ok(Deposit::valid().run(), "valid deposit");

    // the coin must land
    let mut d = Deposit::valid();
    d.landed = VAULT - FEE;
    no(d.run(), "principal grows but no coin arrives");

    // a negative deposit would move vault coin anywhere, dodging withdraw's
    // pay-the-depositor rule
    let mut d = Deposit::valid();
    d.amount = -100 * KAS;
    d.next = Acct { principal: VAULT - 100 * KAS, ..d.prev };
    d.landed = VAULT - 100 * KAS - FEE;
    no(d.run(), "negative deposit takes coin out");
    let mut d = Deposit::valid();
    d.amount = 0;
    d.next = d.prev;
    d.landed = VAULT - FEE;
    no(d.run(), "zero deposit");

    // only principal moves
    for k in 0..4 {
        let mut d = Deposit::valid();
        d.next.deployed[k] += 1;
        no(d.run(), "deposit rewrites exposure");
    }
    let mut d = Deposit::valid();
    d.next.epoch_index += 1;
    no(d.run(), "deposit moves the epoch");
    let mut d = Deposit::valid();
    d.next.epoch_spent = 0;
    no(d.run(), "deposit resets the epoch allowance");

    // the vault stays at output 0
    let mut d = Deposit::valid();
    d.layout = 1;
    no(d.run(), "the vault continues as dust at index 1");

    // bounds
    let mut d = Deposit::valid();
    d.amount = MAX_VALUE;
    d.next.principal = d.prev.principal + MAX_VALUE;
    d.landed = VAULT + MAX_VALUE - FEE;
    ok(d.run(), "deposit of exactly the bound");
    d.amount += 1;
    d.next.principal += 1;
    d.landed += 1;
    no(d.run(), "deposit above the bound");

    let mut d = Deposit::valid();
    d.prev.principal = MAX_VALUE;
    d.next.principal = MAX_VALUE + 50 * KAS;
    ok(d.run(), "principal at the bound");
    d.prev.principal = MAX_VALUE + 1;
    d.next.principal = MAX_VALUE + 1 + 50 * KAS;
    no(d.run(), "principal above the bound");
    let mut d = Deposit::valid();
    d.prev.principal = -1;
    d.next.principal = 50 * KAS - 1;
    no(d.run(), "negative principal");

    let mut d = Deposit::valid();
    d.vault_value = MAX_VALUE;
    d.landed = MAX_VALUE + 50 * KAS - FEE;
    ok(d.run(), "vault at the bound");
    d.vault_value += 1;
    d.landed += 1;
    no(d.run(), "vault above the bound");
}

#[derive(Clone)]
struct Withdraw { prev: Acct, next: Acct, amount: i64, paid: i64, keep: i64, layout: u8, vault_value: i64, extra_input: bool }
impl Withdraw {
    fn valid() -> Self {
        let prev = base_acct();
        Withdraw { prev, next: Acct { principal: prev.principal - 100 * KAS, ..prev }, amount: 100 * KAS, paid: 100 * KAS, keep: VAULT - 100 * KAS - FEE, layout: 0, vault_value: VAULT, extra_input: false }
    }
    fn run(&self) -> Result<(), kaspa_txscript_errors::TxScriptError> {
        let m = Mandate::default();
        let (cur, succ) = (compile(&m, &self.prev), compile(&m, &self.next));
        let to_dep = out_to(self.paid.max(0) as u64, p2pk_spk(xonly(&depositor())));
        let outs = match self.layout {
            0 => vec![continuation(&succ, self.keep as u64), to_dep],
            // a third, unbound output drains what the continuation gave up
            1 => vec![continuation(&succ, self.keep as u64), to_dep, out_to(500 * KAS as u64, p2pk_spk(xonly(&stranger())))],
            // the vault moved to index 2; output 0 pays a stranger
            _ => vec![out_to(self.keep as u64, p2pk_spk(xonly(&stranger()))), to_dep, continuation(&succ, 1_000)],
        };
        let mut ins = vec![tx_input(0, vec![])];
        let mut entries = vec![vault_utxo(&cur, self.vault_value as u64)];
        if self.extra_input {
            ins.push(tx_input(1, vec![]));
            entries.push(plain_utxo((5_000 * KAS) as u64, p2pk_spk(xonly(&depositor()))));
        }
        let tx = new_tx(ins, outs, 0);
        let (next, amount) = (self.next, self.amount);
        run_signed(tx, entries, &depositor(), |sig| decl_sigscript(&cur, "withdraw", vec![state(&next), Expr::int(amount), Expr::bytes(sig)]))
    }
}

#[test]
fn withdraw_guards() {
    ok(Withdraw::valid().run(), "valid withdrawal");

    // the vault keeps the rest
    let mut w = Withdraw::valid();
    w.keep = VAULT - 600 * KAS - FEE;
    w.layout = 1;
    no(w.run(), "a third output drains the vault beyond the withdrawal");
    let mut w = Withdraw::valid();
    w.layout = 2;
    no(w.run(), "the vault continues as dust at index 2");

    let mut w = Withdraw::valid();
    w.amount = 0;
    w.paid = 0;
    w.next = w.prev;
    w.keep = VAULT - FEE;
    no(w.run(), "zero withdrawal");

    // more than the vault holds, topped up by another input: refused
    let mut w = Withdraw::valid();
    w.extra_input = true;
    w.amount = VAULT + KAS;
    w.paid = VAULT + KAS;
    w.next = Acct { principal: 0, ..w.prev };
    w.keep = 1_000;
    no(w.run(), "withdraws more than the vault holds");

    // only principal moves
    for k in 0..4 {
        let mut w = Withdraw::valid();
        w.next.deployed[k] += 1;
        no(w.run(), "withdrawal rewrites exposure");
    }
    let mut w = Withdraw::valid();
    w.next.epoch_index += 1;
    no(w.run(), "withdrawal moves the epoch");
    let mut w = Withdraw::valid();
    w.next.epoch_spent = 0;
    no(w.run(), "withdrawal resets the epoch allowance");

    // bounds
    let mut w = Withdraw::valid();
    w.prev.principal = -1;
    w.next.principal = 0;
    no(w.run(), "negative principal");
    let mut w = Withdraw::valid();
    w.prev.principal = MAX_VALUE;
    w.next.principal = MAX_VALUE - 100 * KAS;
    ok(w.run(), "principal at the bound");
    w.prev.principal += 1;
    w.next.principal += 1;
    no(w.run(), "principal above the bound");
    let mut w = Withdraw::valid();
    w.vault_value = MAX_VALUE;
    w.keep = MAX_VALUE - 100 * KAS - FEE;
    ok(w.run(), "vault at the bound");
    w.vault_value += 1;
    w.keep += 1;
    no(w.run(), "vault above the bound");
    let mut w = Withdraw::valid();
    w.extra_input = true;
    w.amount = MAX_VALUE + 1;
    w.paid = MAX_VALUE + 1;
    w.next = Acct { principal: 0, ..w.prev };
    w.keep = 1_000;
    no(w.run(), "withdrawal above the bound");
}

#[test]
fn close_cannot_burn() {
    ok(run_exit("close", true, VAULT - FEE, 1), "depositor closes");
    no(run_exit("close", true, VAULT - MAX_FEE - 1, 1), "close burns more than maxFee");
}

#[test]
fn recall_vault_stays_at_index_0() {
    // output 0 pays a stranger everything, the vault continues as dust at index 1
    let r = Recall::valid();
    let m = Mandate::default();
    let (cur, succ) = (compile(&m, &r.prev), compile(&m, &r.next));
    let incoming = plain_utxo(r.amount as u64, p2pk_spk(xonly(&stranger())));
    let tx = new_tx(
        vec![tx_input(0, vec![]), tx_input(1, vec![])],
        vec![out_to(r.landed as u64, p2pk_spk(xonly(&stranger()))), continuation(&succ, 1_000)],
        0,
    );
    let (next, slot, amount) = (r.next, r.slot, r.amount);
    no(
        run_signed(tx, vec![vault_utxo(&cur, VAULT as u64), incoming], &allocator(), |sig| {
            decl_sigscript(&cur, "recall", vec![state(&next), Expr::int(slot), Expr::int(amount), Expr::bytes(sig)])
        }),
        "recall with the vault moved off index 0",
    );
}

#[test]
fn bounds_on_the_slot_not_being_moved() {
    // allocate to slot 1 while slot 0's recorded exposure is out of bounds
    let mut a = Alloc::valid();
    a.m.reserve_floor_bps = 0;
    a.slot = 1;
    a.pay_to_slot = 1;
    a.amount = 100 * KAS;
    a.prev.deployed[0] = MAX_VALUE;
    ok(a.run(), "slot 0 at the bound");
    a.prev.deployed[0] += 1;
    no(a.run(), "slot 0 above the bound");

    // recall into slot 1 while slot 0 is out of bounds
    let mut r = Recall::valid();
    r.prev.deployed = [MAX_VALUE, 200 * KAS, 0, 0];
    r.next = Acct { deployed: [MAX_VALUE, 0, 0, 0], ..r.prev };
    r.slot = 1;
    ok(r.run(), "slot 0 at the bound");
    r.prev.deployed[0] += 1;
    r.next.deployed[0] += 1;
    no(r.run(), "slot 0 above the bound");
}
