//! Credit vault: accepted baselines, then one flip per guard, then every field
//! of every successor state tampered in turn.

use dawns_vault_harness::credit::*;
use dawns_vault_harness::nav::*;
use dawns_vault_harness::*;
use kaspa_consensus_core::tx::{TransactionId, TransactionInput, TransactionOutpoint, TransactionOutput, UtxoEntry};
use kaspa_consensus_core::Hash;
use silverscript_lang::ast::Expr;
use silverscript_lang::compiler::CompiledContract;

const FEE: i64 = 5_000;
const MINTER_DUST: i64 = KAS / 5;
type R = Result<(), (usize, kaspa_txscript_errors::TxScriptError)>;

fn ok(r: R, what: &str) { assert!(r.is_ok(), "{what}: expected ACCEPT, got {r:?}"); }
fn no(r: R, what: &str) {
    assert!(r.is_err(), "{what}: expected REFUSE, engine accepted");
    if std::env::var("WHY").is_ok() { eprintln!("REFUSED {what}: {:?}", r.unwrap_err()); }
}
fn p2sh(c: &CompiledContract<'_>) -> kaspa_consensus_core::tx::ScriptPublicKey { kaspa_txscript::pay_to_script_hash_script(&c.bytecode) }

/// Two holders, 200 KAS in the vault.
fn funded() -> (Credit, i64) {
    let s = 2 * (100 * KAS - KAS / 5 - MAX_FEE) / FIRST_PRICE;
    (Credit { shares: s, ..Credit::default() }, 2 * KAS + 2 * (100 * KAS - KAS / 5 - FEE))
}
/// Slot 0 lent 40 KAS at DAA 1500 (due 11 500), slot 1 lent 20 KAS (due 11 500), marked once.
fn lent() -> (Credit, i64) {
    let (p, held) = funded();
    (Credit { principal: [40 * KAS, 20 * KAS, 0], due: [11_500, 11_500, 0], marks: [40 * KAS, 20 * KAS, 0], epoch_index: 0, epoch_spent: 60 * KAS, mark_epoch: 0, ..p }, held - 60 * KAS)
}

fn signed(cur: &CompiledContract<'_>, f: &str, args: impl Fn(Vec<u8>) -> Vec<Expr<'static>>, rest: Vec<(TransactionInput, UtxoEntry)>, held: i64, outputs: Vec<TransactionOutput>, lock: u64, k: &secp256k1::Keypair) -> R {
    let mut entries = vec![cov_utxo(cur, held as u64, VCOV)];
    let mut inputs = vec![tx_input(0, vec![])];
    for (i, e) in rest { inputs.push(i); entries.push(e); }
    let mut tx = new_tx(inputs, outputs, lock);
    tx.inputs[0].signature_script = decl_sigscript(cur, f, args(vec![0u8; 65]));
    let s = sign(&tx, entries.clone(), 0, k);
    tx.inputs[0].signature_script = decl_sigscript(cur, f, args(s));
    run_all(&tx, &entries)
}
fn unsigned(cur: &CompiledContract<'_>, f: &str, args: Vec<Expr<'static>>, rest: Vec<(TransactionInput, UtxoEntry)>, held: i64, outputs: Vec<TransactionOutput>, lock: u64) -> R {
    let mut entries = vec![cov_utxo(cur, held as u64, VCOV)];
    let mut inputs = vec![tx_input(0, decl_sigscript(cur, f, args))];
    for (i, e) in rest { inputs.push(i); entries.push(e); }
    run_all(&new_tx(inputs, outputs, lock), &entries)
}

// ---------------------------------------------------------------------------
// lend
// ---------------------------------------------------------------------------
fn lend_next(m: &CreditMandate, prev: Credit, slot: usize, amount: i64, claimed: i64) -> Credit {
    let b = &m.base;
    let e = (claimed - b.not_before) / b.epoch_length;
    let spent = if e == prev.epoch_index { prev.epoch_spent } else { 0 };
    let mut n = prev;
    n.principal[slot] = amount; n.due[slot] = claimed + m.terms[slot]; n.marks[slot] = amount;
    n.epoch_index = e; n.epoch_spent = spent + amount;
    n
}
#[allow(clippy::too_many_arguments)]
fn lend_run(m: &CreditMandate, prev: Credit, next: Credit, slot: usize, amount: i64, claimed: i64, lock: u64, held: i64, to: kaspa_consensus_core::tx::ScriptPublicKey, k: &secp256k1::Keypair) -> R {
    let (cur, succ) = (compile_credit(m, &prev), compile_credit(m, &next));
    signed(&cur, "lend", |s| vec![credit_state(&next), Expr::int(slot as i64), Expr::int(amount), Expr::int(claimed), Expr::bytes(s)], vec![], held,
        vec![cov_out(&succ, (held - amount - FEE) as u64, 0, VCOV), out_to(amount as u64, to)], lock, k)
}
fn to_borrower(i: usize) -> kaspa_consensus_core::tx::ScriptPublicKey { p2pk_spk(xonly(&borrower(i))) }

#[test]
fn lend_baseline_and_flips() {
    let m = CreditMandate::default();
    let (prev, held) = funded();
    let amt = 40 * KAS;
    let n = lend_next(&m, prev, 0, amt, 1_500);
    ok(lend_run(&m, prev, n, 0, amt, 1_500, 1_500, held, to_borrower(0), &allocator()), "lend 40 KAS to borrower 0");
    assert_eq!(n.due[0], 11_500);
    assert_eq!(m.nav(&n, held - amt, 1_500), m.nav(&prev, held, 1_500), "a loan at cost leaves NAV unchanged");
    no(lend_run(&m, prev, n, 0, amt, 1_500, 1_500, held, p2pk_spk(xonly(&stranger())), &allocator()), "lend to someone else");
    no(lend_run(&m, prev, n, 0, amt, 1_500, 1_500, held, to_borrower(1), &allocator()), "lend to another slot's borrower");
    no(lend_run(&m, prev, n, 0, amt, 1_500, 1_500, held, to_borrower(0), &valuer()), "valuer lends");
    let big = 90 * KAS; // cap 40% of ~200 KAS
    no(lend_run(&m, prev, lend_next(&m, prev, 0, big, 1_500), 0, big, 1_500, 1_500, held, to_borrower(0), &allocator()), "lend above the slot cap");
    let (l, lheld) = lent();
    no(lend_run(&m, l, lend_next(&m, l, 0, 10 * KAS, 2_500), 0, 10 * KAS, 2_500, 2_500, lheld, to_borrower(0), &allocator()), "lend into a slot with a loan out");
    let h = Credit { halted: true, ..prev };
    no(lend_run(&m, h, lend_next(&m, h, 0, amt, 1_500), 0, amt, 1_500, 1_500, held, to_borrower(0), &allocator()), "lend from a halted vault");
    no(lend_run(&m, prev, Credit { due: [11_400, 0, 0], ..n }, 0, amt, 1_500, 1_500, held, to_borrower(0), &allocator()), "books an earlier due date");
    no(lend_run(&m, prev, Credit { marks: [amt + KAS, 0, 0], ..n }, 0, amt, 1_500, 1_500, held, to_borrower(0), &allocator()), "books the loan above cost");
    no(lend_run(&m, prev, n, 0, amt, 1_500, 1_000, held, to_borrower(0), &allocator()), "claims a DAA the chain has not reached");
    let mut fixed = m.clone(); fixed.base.maturity = 5_000;
    no(lend_run(&fixed, prev, n, 0, amt, 1_500, 1_500, held, to_borrower(0), &allocator()), "a loan due after the vault matures");
    fixed.base.maturity = 20_000;
    ok(lend_run(&fixed, prev, n, 0, amt, 1_500, 1_500, held, to_borrower(0), &allocator()), "a loan due before maturity");
    let mut tight = m.clone(); tight.base.reserve_floor_bps = 8_500;
    no(lend_run(&tight, prev, n, 0, amt, 1_500, 1_500, held, to_borrower(0), &allocator()), "lend below the reserve floor");
    let mut closed = m.clone(); closed.base.caps[2] = 0;
    let unused = lend_next(&closed, prev, 2, 10 * KAS, 1_500);
    no(lend_run(&closed, prev, unused, 2, 10 * KAS, 1_500, 1_500, held, to_borrower(2), &allocator()), "lend from an unused slot (cap 0)");
}

/// A lend with the outputs spelled out, to try shapes the helper would never build.
#[allow(clippy::too_many_arguments)]
fn lend_outs(m: &CreditMandate, prev: Credit, next: Credit, slot: i64, amount: i64, claimed: i64, held: i64, outputs: impl Fn(&CompiledContract<'_>) -> Vec<TransactionOutput>) -> R {
    let (cur, succ) = (compile_credit(m, &prev), compile_credit(m, &next));
    signed(&cur, "lend", |s| vec![credit_state(&next), Expr::int(slot), Expr::int(amount), Expr::int(claimed), Expr::bytes(s)], vec![], held, outputs(&succ), claimed as u64, &allocator())
}

#[test]
fn lend_limits_and_shapes() {
    let m = CreditMandate::default();
    let (prev, held) = funded();
    let amt = 40 * KAS;
    let n = lend_next(&m, prev, 0, amt, 1_500);
    let good = |succ: &CompiledContract<'_>| vec![cov_out(succ, (held - amt - FEE) as u64, 0, VCOV), out_to(amt as u64, to_borrower(0))];
    ok(lend_outs(&m, prev, n, 0, amt, 1_500, held, good), "baseline, outputs spelled out");
    // per move and per epoch
    let mut small = m.clone(); small.base.max_per_move = 30 * KAS;
    no(lend_run(&small, prev, n, 0, amt, 1_500, 1_500, held, to_borrower(0), &allocator()), "a loan above the per-move limit");
    let spent = Credit { epoch_spent: 20 * KAS, ..prev };
    let mut tight = m.clone(); tight.base.epoch_limit = 50 * KAS;
    no(lend_run(&tight, spent, lend_next(&tight, spent, 0, amt, 1_500), 0, amt, 1_500, 1_500, held, to_borrower(0), &allocator()), "a loan past the epoch's limit");
    tight.base.epoch_limit = 60 * KAS;
    ok(lend_run(&tight, spent, lend_next(&tight, spent, 0, amt, 1_500), 0, amt, 1_500, 1_500, held, to_borrower(0), &allocator()), "a loan that fills the epoch's limit exactly");
    ok(lend_run(&tight, spent, lend_next(&tight, spent, 0, amt, 2_500), 0, amt, 2_500, 2_500, held, to_borrower(0), &allocator()), "a new epoch starts from zero");
    // a slot that does not exist would book nothing while paying slot 0's borrower
    let unbooked = Credit { epoch_index: 0, epoch_spent: amt, ..prev };
    for bad in [3i64, -1] {
        no(lend_outs(&m, prev, unbooked, bad, amt, 1_500, held, good), &format!("lend from slot {bad}"));
    }
    // the borrower gets exactly the loan, and the vault pays at most the fee
    no(lend_outs(&m, prev, n, 0, amt, 1_500, held, |succ| vec![cov_out(succ, (held - amt - FEE) as u64, 0, VCOV), out_to((amt + FEE / 2) as u64, to_borrower(0))]), "pays the borrower more than it books");
    no(lend_outs(&m, prev, n, 0, amt, 1_500, held, |succ| vec![cov_out(succ, (held - amt - MAX_FEE - KAS) as u64, 0, VCOV), out_to(amt as u64, to_borrower(0))]), "the vault keeps less than value less loan less fee");
}

#[test]
fn markdown_and_marks_keep_their_bounds() {
    let m = CreditMandate::default();
    let (prev, held) = lent();
    let at = 13_700;
    let cap = m.limit(0, &prev, at);
    let n = Credit { marks: [cap, 20 * KAS, 0], ..prev };
    for bad in [3usize, 7] {
        no(md_run(&m, prev, n, bad, at, at as u64, held, held - FEE), &format!("markdown slot {bad}"));
        no(md_run(&m, prev, prev, bad, at, at as u64, held, held - FEE), &format!("markdown slot {bad}, state untouched"));
    }
    // one mark per epoch
    let up = Credit { marks: [41 * KAS, 20 * KAS, 0], mark_epoch: 1, ..prev };
    ok(mark_run(&m, prev, up, 2_500, 2_500, held, &valuer()), "the epoch's mark");
    no(mark_run(&m, up, Credit { marks: [40 * KAS, 20 * KAS, 0], ..up }, 2_600, 2_600, held, &valuer()), "a second mark in the same epoch");
    ok(mark_run(&m, up, Credit { marks: [40 * KAS, 20 * KAS, 0], mark_epoch: 2, ..up }, 3_500, 3_500, held, &valuer()), "the next epoch's mark");
}

// ---------------------------------------------------------------------------
// repay: a borrower's payment, swept in with no key
// ---------------------------------------------------------------------------
fn repay_next(prev: Credit, slot: usize, amount: i64) -> Credit {
    let mut n = prev;
    n.principal[slot] -= amount; n.marks[slot] = (n.marks[slot] - amount).max(0);
    if n.principal[slot] <= 0 { n.principal[slot] = 0; n.due[slot] = 0; n.marks[slot] = 0; }
    n
}
#[allow(clippy::too_many_arguments)]
fn repay_run(m: &CreditMandate, prev: Credit, next: Credit, acct_slot: i64, acct_vault: Hash, amount: i64, held: i64, out_v: i64) -> R {
    let (cur, succ) = (compile_credit(m, &prev), compile_credit(m, &next));
    let rep = compile_repay(xonly(&borrower(acct_slot.clamp(0, 3) as usize)), acct_vault, acct_slot);
    unsigned(&cur, "repay", vec![credit_state(&next)], vec![(tx_input(1, entry_sigscript(&rep, "enter", vec![])), plain_utxo(amount as u64, p2sh(&rep)))], held,
        vec![cov_out(&succ, out_v as u64, 0, VCOV)], 0)
}

#[test]
fn repay_baseline_and_flips() {
    let m = CreditMandate::default();
    let (prev, held) = lent();
    // part: 15 KAS on slot 0
    let n = repay_next(prev, 0, 15 * KAS);
    ok(repay_run(&m, prev, n, 0, VCOV, 15 * KAS, held, held + 15 * KAS - FEE), "part repayment");
    // in full with interest: 41 KAS on 40 principal closes the loan, the extra KAS is NAV gain
    let full = repay_next(prev, 0, 41 * KAS);
    assert_eq!((full.principal[0], full.due[0], full.marks[0]), (0, 0, 0));
    ok(repay_run(&m, prev, full, 0, VCOV, 41 * KAS, held, held + 41 * KAS - FEE), "repaid in full with interest");
    assert!(m.nav(&full, held + 41 * KAS, 2_000) > m.nav(&prev, held, 2_000), "interest raises NAV");
    // a recovery on a written-off slot: all NAV gain
    let off = Credit { principal: [0, 20 * KAS, 0], due: [0, 11_500, 0], marks: [0, 20 * KAS, 0], ..prev };
    ok(repay_run(&m, off, repay_next(off, 0, 5 * KAS), 0, VCOV, 5 * KAS, held, held + 5 * KAS - FEE), "recovery after a write-off");
    ok(repay_run(&m, Credit { halted: true, ..prev }, Credit { halted: true, ..n }, 0, VCOV, 15 * KAS, held, held + 15 * KAS - FEE), "repay into a halted vault");

    no(repay_run(&m, prev, repay_next(prev, 1, 15 * KAS), 0, VCOV, 15 * KAS, held, held + 15 * KAS - FEE), "books slot 0's money against slot 1");
    no(repay_run(&m, prev, n, 0, Hash::from_bytes([9; 32]), 15 * KAS, held, held + 15 * KAS - FEE), "another vault's repayment account");
    no(repay_run(&m, prev, n, 0, VCOV, 15 * KAS, held, held + 5 * KAS), "the vault keeps less than was repaid");
    no(repay_run(&m, prev, Credit { marks: [prev.marks[0], 20 * KAS, 0], ..n }, 0, VCOV, 15 * KAS, held, held + 15 * KAS - FEE), "repayment leaves the mark untouched");
    no(repay_run(&m, prev, Credit { due: [0, 11_500, 0], ..n }, 0, VCOV, 15 * KAS, held, held + 15 * KAS - FEE), "part repayment closes the loan");
    no(repay_run(&m, prev, repay_next(prev, 0, 1_000), 0, VCOV, 1_000, held, held + 1_000 - FEE), "dust repayment (fee drain)");
    // a deposit account cannot be swept as a repayment
    let (cur, succ) = (compile_credit(&m, &prev), compile_credit(&m, &n));
    let acct = compile_account(xonly(&user()), VCOV, 0);
    no(unsigned(&cur, "repay", vec![credit_state(&n)], vec![(tx_input(1, entry_sigscript(&acct, "enter", vec![])), plain_utxo((15 * KAS) as u64, p2sh(&acct)))], held,
        vec![cov_out(&succ, (held + 15 * KAS - FEE) as u64, 0, VCOV)], 0), "a deposit account swept as a repayment");
    // a repayment can't be diverted: an extra output paying a stranger
    let rep = compile_repay(xonly(&borrower(0)), VCOV, 0);
    no(unsigned(&cur, "repay", vec![credit_state(&n)], vec![(tx_input(1, entry_sigscript(&rep, "enter", vec![])), plain_utxo((15 * KAS) as u64, p2sh(&rep)))], held,
        vec![cov_out(&succ, held as u64, 0, VCOV), out_to((15 * KAS - FEE) as u64, p2pk_spk(xonly(&stranger())))], 0), "repayment diverted to a stranger");
}

#[test]
fn repayment_account_only_goes_to_its_vault() {
    let (prev, held) = lent();
    let m = CreditMandate::default();
    let cur = compile_credit(&m, &prev);
    let rep = compile_repay(xonly(&borrower(0)), VCOV, 0);
    let coin = plain_utxo((15 * KAS) as u64, p2sh(&rep));
    let run = |lead: UtxoEntry, outs: usize| {
        let mut o = vec![out_to(1_000, p2pk_spk(xonly(&stranger())))];
        for _ in 1..outs { o.push(out_to(1_000, p2pk_spk(xonly(&stranger())))); }
        let tx = new_tx(vec![tx_input(0, vec![]), tx_input(1, entry_sigscript(&rep, "enter", vec![]))], o, 0);
        execute(&tx, vec![lead, coin.clone()], 1)
    };
    assert!(run(cov_utxo(&cur, held as u64, Hash::from_bytes([3; 32])), 1).is_err(), "led by another covenant");
    assert!(run(cov_utxo(&cur, held as u64, VCOV), 2).is_err(), "a two-output shape");
    // the borrower can take back a payment not yet swept; nobody else can
    let mut tx = new_tx(vec![tx_input(0, vec![])], vec![out_to((15 * KAS - FEE) as u64, p2pk_spk(xonly(&borrower(0))))], 0);
    tx.inputs[0].signature_script = entry_sigscript(&rep, "reclaim", vec![Expr::bytes(vec![0u8; 65])]);
    let s = sign(&tx, vec![coin.clone()], 0, &borrower(0));
    tx.inputs[0].signature_script = entry_sigscript(&rep, "reclaim", vec![Expr::bytes(s)]);
    assert!(execute(&tx, vec![coin.clone()], 0).is_ok(), "borrower reclaims an unswept payment");
    let s = sign(&tx, vec![coin.clone()], 0, &allocator());
    tx.inputs[0].signature_script = entry_sigscript(&rep, "reclaim", vec![Expr::bytes(s)]);
    assert!(execute(&tx, vec![coin], 0).is_err(), "allocator takes a repayment");
}

// ---------------------------------------------------------------------------
// markdown: anyone lowers a late loan to its schedule cap
// ---------------------------------------------------------------------------
fn md_run(m: &CreditMandate, prev: Credit, next: Credit, slot: usize, claimed: i64, lock: u64, held: i64, out_v: i64) -> R {
    let (cur, succ) = (compile_credit(m, &prev), compile_credit(m, &next));
    unsigned(&cur, "markdown", vec![credit_state(&next), Expr::int(slot as i64), Expr::int(claimed)], vec![], held, vec![cov_out(&succ, out_v as u64, 0, VCOV)], lock)
}

#[test]
fn late_loans_are_marked_down_by_anyone() {
    let m = CreditMandate::default();
    let (prev, held) = lent();
    // due 11 500, grace 1 000: at 12 500 the first period starts (−25%), at 13 700 the second (−50%)
    let at = 13_700;
    let cap = m.limit(0, &prev, at);
    assert_eq!(cap, 40 * KAS / 2);
    let n = Credit { marks: [cap, 20 * KAS, 0], ..prev };
    ok(md_run(&m, prev, n, 0, at, at as u64, held, held - FEE), "markdown to the schedule cap");
    assert!(m.nav(&prev, held, at) == m.nav(&n, held, at), "NAV already used the cap: writing it down changes nothing for holders");
    no(md_run(&m, prev, n, 0, at, 12_000, held, held - FEE), "claims a DAA the chain has not reached");
    no(md_run(&m, prev, Credit { marks: [cap - KAS, 20 * KAS, 0], ..prev }, 0, at, at as u64, held, held - FEE), "marks below the cap");
    no(md_run(&m, prev, Credit { marks: [cap + KAS, 20 * KAS, 0], ..prev }, 0, at, at as u64, held, held - FEE), "stops short of the cap");
    no(md_run(&m, prev, prev, 0, 12_000, 12_000, held, held - FEE), "within the grace: nothing to mark down");
    no(md_run(&m, prev, Credit { marks: [cap, 10 * KAS, 0], ..prev }, 0, at, at as u64, held, held - FEE), "lowers another slot too");
    no(md_run(&m, prev, Credit { principal: [30 * KAS, 20 * KAS, 0], ..n }, 0, at, at as u64, held, held - FEE), "rewrites the principal");
    no(md_run(&m, prev, n, 0, at, at as u64, held, held - 10 * KAS), "markdown takes value");
    // far past due: the cap reaches zero
    let z = Credit { marks: [0, 20 * KAS, 0], ..prev };
    ok(md_run(&m, prev, z, 0, 20_000, 20_000, held, held - FEE), "a long-late loan marked to zero");
}

// ---------------------------------------------------------------------------
// mark and write-off (valuer)
// ---------------------------------------------------------------------------
fn mark_run(m: &CreditMandate, prev: Credit, next: Credit, claimed: i64, lock: u64, held: i64, k: &secp256k1::Keypair) -> R {
    let (cur, succ) = (compile_credit(m, &prev), compile_credit(m, &next));
    signed(&cur, "mark", |s| vec![credit_state(&next), Expr::int(claimed), Expr::bytes(s)], vec![], held, vec![cov_out(&succ, (held - FEE) as u64, 0, VCOV)], lock, k)
}
fn wo_run(m: &CreditMandate, prev: Credit, next: Credit, slot: usize, claimed: i64, lock: u64, held: i64, k: &secp256k1::Keypair) -> R {
    let (cur, succ) = (compile_credit(m, &prev), compile_credit(m, &next));
    signed(&cur, "writeOff", |s| vec![credit_state(&next), Expr::int(slot as i64), Expr::int(claimed), Expr::bytes(s)], vec![], held, vec![cov_out(&succ, (held - FEE) as u64, 0, VCOV)], lock, k)
}

#[test]
fn marks_follow_the_contract() {
    let m = CreditMandate::default();
    let (prev, held) = lent();
    // accrued interest: up to principal + 2.5%, within the 20% step
    let up = Credit { marks: [41 * KAS, 20 * KAS, 0], mark_epoch: 1, ..prev };
    ok(mark_run(&m, prev, up, 2_500, 2_500, held, &valuer()), "mark up to the contract interest");
    no(mark_run(&m, prev, Credit { marks: [41 * KAS + 1, 20 * KAS, 0], ..up }, 2_500, 2_500, held, &valuer()), "mark above principal + interest");
    no(mark_run(&m, prev, up, 2_500, 2_500, held, &allocator()), "allocator marks its own loan");
    ok(mark_run(&m, prev, Credit { marks: [KAS, 20 * KAS, 0], mark_epoch: 1, ..prev }, 2_500, 2_500, held, &valuer()), "mark down any amount");
    // late: the valuer cannot mark above the schedule cap
    let late = Credit { marks: [20 * KAS, 20 * KAS, 0], mark_epoch: 1, ..prev };
    no(mark_run(&m, late, Credit { marks: [25 * KAS, 20 * KAS, 0], mark_epoch: 2, ..late }, 13_700 - 1_000 + 1_000, 13_700, held, &valuer()), "mark a late loan back up");
    // an unused slot cannot gain a mark
    no(mark_run(&m, prev, Credit { marks: [40 * KAS, 20 * KAS, KAS], mark_epoch: 1, ..prev }, 2_500, 2_500, held, &valuer()), "mark an empty slot");
    // write-off: late and at zero
    let zero = Credit { marks: [0, 20 * KAS, 0], ..prev };
    let off = Credit { principal: [0, 20 * KAS, 0], due: [0, 11_500, 0], ..zero };
    ok(wo_run(&m, zero, off, 0, 20_000, 20_000, held, &valuer()), "write off a defaulted loan");
    no(wo_run(&m, zero, off, 0, 20_000, 20_000, held, &allocator()), "allocator writes off");
    no(wo_run(&m, prev, Credit { principal: [0, 20 * KAS, 0], due: [0, 11_500, 0], ..prev }, 0, 20_000, 20_000, held, &valuer()), "write off a loan still marked");
    no(wo_run(&m, zero, off, 0, 12_000, 12_000, held, &valuer()), "write off before the grace ends");
    no(wo_run(&m, zero, off, 0, 20_000, 12_000, held, &valuer()), "write off claiming a DAA not reached");
}

// ---------------------------------------------------------------------------
// deposit and redeem, priced with late loans capped
// ---------------------------------------------------------------------------
#[derive(Clone)]
struct Dep { m: CreditMandate, prev: Credit, held: i64, paid: i64, claimed: i64, minted: Option<i64>, next: Option<Credit> }
impl Dep {
    fn valid(prev: Credit, held: i64, claimed: i64) -> Self { Dep { m: CreditMandate::default(), prev, held, paid: 100 * KAS, claimed, minted: None, next: None } }
    fn correct_minted(&self) -> i64 { (self.paid - self.m.base.note_value - self.m.base.max_fee) / price_up(self.m.nav(&self.prev, self.held, self.claimed), self.prev.shares) }
    fn correct_next(&self) -> Credit { Credit { shares: self.prev.shares + self.correct_minted(), ..self.prev } }
    fn run(&self) -> R {
        let cur = compile_credit(&self.m, &self.prev);
        let next = self.next.unwrap_or_else(|| self.correct_next());
        let succ = compile_credit(&self.m, &next);
        let owner = xonly(&user());
        let acct = compile_account(owner, VCOV, 0);
        let minter = compile_kcc(&VCOV.as_bytes(), ID_COVENANT, 0, true);
        let minted = self.minted.unwrap_or_else(|| self.correct_minted());
        let note_owner = redeem_hash(owner, VCOV);
        let note = compile_kcc(&note_owner, ID_SCRIPT_HASH, minted, false);
        let entries = vec![cov_utxo(&cur, self.held as u64, VCOV), plain_utxo(self.paid as u64, p2sh(&acct)), cov_utxo(&minter, MINTER_DUST as u64, SCOV)];
        let inputs = vec![tx_input(0, decl_sigscript(&cur, "deposit", vec![credit_state(&next), Expr::int(self.claimed)])),
            tx_input(1, entry_sigscript(&acct, "enter", vec![])),
            tx_input(2, leader_sigscript(&minter, "transfer", vec![kcc_states(vec![(VCOV.as_bytes().to_vec(), ID_COVENANT, 0, true), (note_owner.to_vec(), ID_SCRIPT_HASH, minted, false)]), sigs(vec![]), Expr::dynamic_bytes(vec![0])]))];
        let outputs = vec![cov_out(&succ, (self.held + self.paid - self.m.base.note_value - FEE) as u64, 0, VCOV), cov_out(&minter, MINTER_DUST as u64, 2, SCOV), cov_out(&note, self.m.base.note_value as u64, 2, SCOV)];
        run_all(&new_tx(inputs, outputs, self.claimed as u64), &entries)
    }
}

#[derive(Clone)]
struct Red { m: CreditMandate, prev: Credit, held: i64, shares: i64, claimed: i64, payout: Option<i64>, next: Option<Credit> }
impl Red {
    fn valid(prev: Credit, held: i64, shares: i64, claimed: i64) -> Self { Red { m: CreditMandate::default(), prev, held, shares, claimed, payout: None, next: None } }
    fn correct_payout(&self) -> i64 { let g = self.shares * price_down(self.m.nav(&self.prev, self.held, self.claimed), self.prev.shares); g - g * self.m.base.exit_fee_bps / 10_000 }
    fn correct_next(&self) -> Credit { Credit { shares: self.prev.shares - self.shares, ..self.prev } }
    fn run(&self) -> R {
        let cur = compile_credit(&self.m, &self.prev);
        let next = self.next.unwrap_or_else(|| self.correct_next());
        let succ = compile_credit(&self.m, &next);
        let owner = xonly(&user());
        let acct = compile_account(owner, VCOV, 1);
        let minter = compile_kcc(&VCOV.as_bytes(), ID_COVENANT, 0, true);
        let note = compile_kcc(&redeem_hash(owner, VCOV), ID_SCRIPT_HASH, self.shares, false);
        let payout = self.payout.unwrap_or_else(|| self.correct_payout());
        let nv = self.m.base.note_value;
        let entries = vec![cov_utxo(&cur, self.held as u64, VCOV), plain_utxo(KAS as u64, p2sh(&acct)), cov_utxo(&minter, MINTER_DUST as u64, SCOV), cov_utxo(&note, nv as u64, SCOV)];
        let inputs = vec![tx_input(0, decl_sigscript(&cur, "redeem", vec![credit_state(&next), Expr::int(self.claimed)])),
            tx_input(1, entry_sigscript(&acct, "enter", vec![])),
            tx_input(2, leader_sigscript(&minter, "transfer", vec![kcc_states(vec![(VCOV.as_bytes().to_vec(), ID_COVENANT, 0, true)]), sigs(vec![]), Expr::dynamic_bytes(vec![0, 1])])),
            tx_input(3, decl_sigscript(&note, "transfer", vec![]))];
        let outputs = vec![cov_out(&succ, (self.held - payout) as u64, 0, VCOV), cov_out(&minter, MINTER_DUST as u64, 2, SCOV),
            out_to((payout + KAS + nv - self.m.base.max_fee) as u64, p2pk_spk(owner))];
        run_all(&new_tx(inputs, outputs, self.claimed as u64), &entries)
    }
}

#[test]
fn deposits_and_redemptions_see_late_loans_at_their_cap() {
    let (prev, held) = lent();
    // current: loans count in full
    let r = Red::valid(prev, held, prev.shares / 4, 2_000);
    ok(r.run(), "redeem while loans are current");
    // 50% down on slot 0 at 13 700: the payout already reflects it, before anyone marks it down
    let late = Red::valid(prev, held, prev.shares / 4, 13_700);
    ok(late.run(), "redeem at NAV with a late loan capped");
    assert!(late.correct_payout() < r.correct_payout());
    let mut greedy = late.clone(); greedy.payout = Some(r.correct_payout());
    no(greedy.run(), "redeem a late loan at its full mark");
    // a depositor buys at the capped NAV too, never below it
    let d = Dep::valid(prev, held, 13_700);
    ok(d.run(), "deposit with a late loan capped");
    let mut cheap = d.clone(); cheap.minted = Some(d.correct_minted() + 1); cheap.next = Some(Credit { shares: d.prev.shares + d.correct_minted() + 1, ..d.prev });
    no(cheap.run(), "mints a share more than the capped NAV allows");
    // halted: deposits stop, redemptions go on
    let h = Credit { halted: true, ..prev };
    no(Dep::valid(h, held, 2_000).run(), "deposit into a halted vault");
    ok(Red::valid(h, held, h.shares / 4, 2_000).run(), "redeem from a halted vault");
}

// ---------------------------------------------------------------------------
// every successor field tampered, on every path
// ---------------------------------------------------------------------------
fn tampers(n: Credit, skip: &[&str]) -> Vec<(String, Credit)> {
    let mut v = Vec::new();
    let mut add = |name: &str, t: Credit| if !skip.contains(&name) { v.push((name.to_string(), t)); };
    add("shareCovid", Credit { share_covid: [9; 32], ..n });
    add("shares", Credit { shares: n.shares + 1, ..n });
    for i in 0..3 { let mut t = n; t.principal[i] += 1; add(&format!("principal{i}"), t); }
    for i in 0..3 { let mut t = n; t.due[i] += 1; add(&format!("due{i}"), t); }
    for i in 0..3 { let mut t = n; t.marks[i] += 1; add(&format!("mark{i}"), t); }
    add("epochIndex", Credit { epoch_index: n.epoch_index + 1, ..n });
    add("epochSpent", Credit { epoch_spent: n.epoch_spent + 1, ..n });
    add("markEpoch", Credit { mark_epoch: n.mark_epoch + 1, ..n });
    add("halted", Credit { halted: !n.halted, ..n });
    v
}

#[test]
fn successor_state_is_exact_on_every_path() {
    let m = CreditMandate::default();
    let (prev, held) = lent();
    let n = lend_next(&m, prev, 2, 10 * KAS, 2_500);
    ok(lend_run(&m, prev, n, 2, 10 * KAS, 2_500, 2_500, held, to_borrower(2), &allocator()), "lend baseline");
    for (f, t) in tampers(n, &[]) { no(lend_run(&m, prev, t, 2, 10 * KAS, 2_500, 2_500, held, to_borrower(2), &allocator()), &format!("lend tampers {f}")); }
    let n = repay_next(prev, 1, 5 * KAS);
    ok(repay_run(&m, prev, n, 1, VCOV, 5 * KAS, held, held + 5 * KAS - FEE), "repay baseline");
    for (f, t) in tampers(n, &[]) { no(repay_run(&m, prev, t, 1, VCOV, 5 * KAS, held, held + 5 * KAS - FEE), &format!("repay tampers {f}")); }
    let n = Credit { marks: [20 * KAS, 20 * KAS, 0], ..prev };
    ok(md_run(&m, prev, n, 0, 13_700, 13_700, held, held - FEE), "markdown baseline");
    for (f, t) in tampers(n, &[]) { no(md_run(&m, prev, t, 0, 13_700, 13_700, held, held - FEE), &format!("markdown tampers {f}")); }
    let n = Credit { marks: [41 * KAS, 20 * KAS, 0], mark_epoch: 1, ..prev };
    ok(mark_run(&m, prev, n, 2_500, 2_500, held, &valuer()), "mark baseline");
    // a mark may fall to anything, so lowering tampers stay legal: only raise them
    for (f, t) in tampers(n, &["mark1", "mark2"]) { no(mark_run(&m, prev, t, 2_500, 2_500, held, &valuer()), &format!("mark tampers {f}")); }
    let zero = Credit { marks: [0, 20 * KAS, 0], ..prev };
    let n = Credit { principal: [0, 20 * KAS, 0], due: [0, 11_500, 0], ..zero };
    ok(wo_run(&m, zero, n, 0, 20_000, 20_000, held, &valuer()), "write-off baseline");
    for (f, t) in tampers(n, &[]) { no(wo_run(&m, zero, t, 0, 20_000, 20_000, held, &valuer()), &format!("write-off tampers {f}")); }
    let d = Dep::valid(prev, held, 2_000);
    ok(d.run(), "deposit baseline");
    for (f, t) in tampers(d.correct_next(), &[]) { let mut x = d.clone(); x.next = Some(t); no(x.run(), &format!("deposit tampers {f}")); }
    let r = Red::valid(prev, held, prev.shares / 4, 2_000);
    ok(r.run(), "redeem baseline");
    for (f, t) in tampers(r.correct_next(), &[]) { let mut x = r.clone(); x.next = Some(t); no(x.run(), &format!("redeem tampers {f}")); }
    let h = Credit { halted: true, ..prev };
    let (cur, succ) = (compile_credit(&m, &prev), compile_credit(&m, &h));
    ok(signed(&cur, "halt", |s| vec![credit_state(&h), Expr::bytes(s)], vec![], held, vec![cov_out(&succ, (held - FEE) as u64, 0, VCOV)], 0, &guardian()), "halt baseline");
    no(signed(&cur, "halt", |s| vec![credit_state(&h), Expr::bytes(s)], vec![], held, vec![cov_out(&succ, (held - FEE) as u64, 0, VCOV)], 0, &allocator()), "allocator halts");
}

// ---------------------------------------------------------------------------
// init: the guardian binds the share token, once, and nothing else changes
// ---------------------------------------------------------------------------
#[test]
fn init_binds_the_share_token_once() {
    let m = CreditMandate::default();
    let (kp_, ks, _) = kcc_template();
    let outpoint = TransactionOutpoint { transaction_id: TransactionId::from_bytes([1; 32]), index: 0 };
    let seed = 3 * KAS;
    let pre = Credit { share_covid: [0; 32], ..Credit::default() };
    #[allow(clippy::too_many_arguments)]
    let run = |prev: Credit, owner: [u8; 32], is_minter: bool, amount: i64, fake: bool, next_of: &dyn Fn(Hash) -> Credit, k: &secp256k1::Keypair, extra_in: bool, extra_out: bool, swap: bool, keep: i64| -> R {
        let token = compile_kcc(&owner, ID_COVENANT, amount, is_minter);
        let placeholder = cov_out(&token, MINTER_DUST as u64, 0, Hash::from_bytes([0; 32]));
        let covid = genesis_covid(outpoint, &placeholder, 0);
        let next = next_of(if fake { Hash::from_bytes([7; 32]) } else { covid });
        let (cur, succ) = (compile_credit(&m, &prev), compile_credit(&m, &next));
        let mut entries = vec![cov_utxo(&cur, seed as u64, VCOV)];
        let mut inputs = vec![TransactionInput::new_with_compute_budget(outpoint, vec![], 0, 1000)];
        if extra_in { entries.push(plain_utxo(KAS as u64, p2pk_spk(xonly(&stranger())))); inputs.push(tx_input(1, vec![])); }
        let mut outs = vec![cov_out(&token, MINTER_DUST as u64, 0, covid), cov_out(&succ, keep as u64, 0, VCOV)];
        if extra_out { outs.push(out_to(1, p2pk_spk(xonly(&stranger())))); }
        if swap { outs.swap(0, 1); }
        let mut tx = new_tx(inputs, outs, 0);
        let args = |sg: Vec<u8>| vec![credit_state(&next), Expr::dynamic_bytes(kp_.clone()), Expr::dynamic_bytes(ks.clone()), Expr::bytes(sg)];
        tx.inputs[0].signature_script = decl_sigscript(&cur, "init", args(vec![0u8; 65]));
        let s = sign(&tx, entries.clone(), 0, k);
        tx.inputs[0].signature_script = decl_sigscript(&cur, "init", args(s));
        run_all(&tx, &entries)
    };
    let keep = seed - MINTER_DUST - FEE;
    let bind = |c: Hash| Credit { share_covid: c.as_bytes(), ..pre };
    let v = VCOV.as_bytes();
    ok(run(pre, v, true, 0, false, &bind, &guardian(), false, false, false, keep), "init");
    no(run(pre, xonly(&stranger()), true, 0, false, &bind, &guardian(), false, false, false, keep), "token minter owned by someone else");
    no(run(pre, v, true, 1_000, false, &bind, &guardian(), false, false, false, keep), "token born with supply");
    no(run(pre, v, false, 0, false, &bind, &guardian(), false, false, false, keep), "token born without a minter");
    no(run(pre, v, true, 0, true, &bind, &guardian(), false, false, false, keep), "records the wrong token");
    no(run(pre, v, true, 0, false, &bind, &allocator(), false, false, false, keep), "allocator initialises");
    no(run(pre, v, true, 0, false, &bind, &guardian(), true, false, false, keep), "an extra input");
    no(run(pre, v, true, 0, false, &bind, &guardian(), false, true, false, keep), "an extra output");
    no(run(pre, v, true, 0, false, &bind, &guardian(), false, false, true, keep), "token and vault swapped");
    no(run(pre, v, true, 0, false, &bind, &guardian(), false, false, false, keep - 10_000_000), "the vault keeps less than it should");
    let had = Credit { share_covid: [5; 32], ..pre };
    no(run(had, v, true, 0, false, &|c: Hash| Credit { share_covid: c.as_bytes(), ..had }, &guardian(), false, false, false, keep), "a second token for a vault that has one");
    let sh = Credit { shares: 7, ..pre };
    no(run(sh, v, true, 0, false, &|c: Hash| Credit { share_covid: c.as_bytes(), ..sh }, &guardian(), false, false, false, keep), "init with shares outstanding (kept)");
    no(run(sh, v, true, 0, false, &bind, &guardian(), false, false, false, keep), "init with shares outstanding (zeroed)");
    // every other field must pass through untouched
    let token = compile_kcc(&v, ID_COVENANT, 0, true);
    let covid = genesis_covid(outpoint, &cov_out(&token, MINTER_DUST as u64, 0, Hash::from_bytes([0; 32])), 0);
    for (f, t) in tampers(bind(covid), &["shareCovid"]) {
        no(run(pre, v, true, 0, false, &move |_| t, &guardian(), false, false, false, keep), &format!("init tampers {f}"));
    }
}

// ---------------------------------------------------------------------------
// a malformed state (only a hand-made genesis could create one) moves nowhere
// ---------------------------------------------------------------------------
#[test]
fn out_of_range_state_is_refused() {
    let m = CreditMandate::default();
    let (base, held) = lent();
    const MAXV: i64 = 100_000_000_000_000;
    const MAXD: i64 = 10_000_000_000_000;
    // repay carries every field but its own slot unchanged: a clean way to reach bounded()
    let bad: Vec<(String, Credit, usize)> = {
        let mut v = Vec::new();
        for (name, val) in [("low", -1i64), ("high", 0)] {
            let sh = if val < 0 { -1 } else { MAXV + 1 };
            v.push((format!("shares {name}"), Credit { shares: sh, ..base }, 2));
            for i in 0..3 {
                let slot = if i == 2 { 0 } else { 2 };
                let mut p = base; p.principal[i] = if val < 0 { -1 } else { MAXV + 1 }; v.push((format!("principal{i} {name}"), p, slot));
                let mut d = base; d.due[i] = if val < 0 { -1 } else { MAXD + 1 }; v.push((format!("due{i} {name}"), d, slot));
                let mut k = base; k.marks[i] = if val < 0 { -1 } else { MAXV + 1 }; v.push((format!("mark{i} {name}"), k, slot));
            }
        }
        v
    };
    ok(repay_run(&m, base, repay_next(base, 2, 5 * KAS), 2, VCOV, 5 * KAS, held, held + 5 * KAS - FEE), "baseline recovery on slot 2");
    for (what, prev, slot) in bad {
        let n = repay_next(prev, slot, 5 * KAS);
        no(repay_run(&m, prev, n, slot as i64, VCOV, 5 * KAS, held, held + 5 * KAS - FEE), &format!("state with {what}"));
    }
}

// ---------------------------------------------------------------------------
// time: no DAA before the mandate starts, no going back an epoch, no vault below its seed
// ---------------------------------------------------------------------------
#[test]
fn claimed_time_only_moves_forward() {
    let m = CreditMandate::default();
    let (prev, held) = funded();
    let amt = 10 * KAS;
    // not_before is 1 000: DAA 999 rounds to epoch 0, so only the start check catches it
    let early = lend_next(&m, prev, 2, amt, 999);
    no(lend_run(&m, prev, early, 2, amt, 999, 999, held, to_borrower(2), &allocator()), "claims a DAA before the mandate starts");
    // spent near the limit in epoch 3; a claim from epoch 1 would reset the budget
    let late = Credit { epoch_index: 3, epoch_spent: m.base.epoch_limit - KAS, ..prev };
    let back = lend_next(&m, late, 2, amt, 1_500);
    assert_eq!((back.epoch_index, back.epoch_spent), (0, amt));
    no(lend_run(&m, late, back, 2, amt, 1_500, 3_500, held, to_borrower(2), &allocator()), "claims an earlier epoch to reset the budget");
    // the valuer cannot re-mark within an epoch by claiming an old one
    let (l, lheld) = lent();
    let marked = Credit { mark_epoch: 4, ..l };
    no(mark_run(&m, marked, Credit { marks: [KAS, 20 * KAS, 0], mark_epoch: 1, ..marked }, 2_500, 5_500, lheld, &valuer()), "marks again claiming an old epoch");
    // a vault holding less than its seed prices nothing
    let mut open = m.clone(); open.base.reserve_floor_bps = 0;
    let (l, _) = lent();
    let n = lend_next(&open, l, 2, 1_000, 2_500);
    ok(lend_run(&open, l, n, 2, 1_000, 2_500, 2_500, open.base.min_keep + 1_000 + MAX_FEE, to_borrower(2), &allocator()), "lends down to exactly its seed");
    no(lend_run(&open, l, n, 2, 1_000, 2_500, 2_500, open.base.min_keep + 1_000 + MAX_FEE - 1, to_borrower(2), &allocator()), "lends into its seed (reserve floor 0)");
    no(lend_run(&open, l, n, 2, 1_000, 2_500, 2_500, open.base.min_keep - 1, to_borrower(2), &allocator()), "lends from a vault below its seed");

    // fees come out of NAV, never out of the seed: at minKeep + maxFee the vault can still pay one, below it nothing moves
    let (l, _) = lent();
    let edge = m.base.min_keep + MAX_FEE;
    let md = Credit { marks: [20 * KAS, 20 * KAS, 0], ..l };
    ok(md_run(&m, l, md, 0, 13_700, 13_700, edge, edge - FEE), "markdown with exactly one fee above the seed");
    no(md_run(&m, l, md, 0, 13_700, 13_700, edge - 1, edge - 1 - FEE), "markdown paid out of the seed");
    let up = Credit { marks: [KAS, 20 * KAS, 0], mark_epoch: 1, ..l };
    no(mark_run(&m, l, up, 2_500, 2_500, edge - 1, &valuer()), "mark paid out of the seed");
    let zero = Credit { marks: [0, 20 * KAS, 0], ..l };
    no(wo_run(&m, zero, Credit { principal: [0, 20 * KAS, 0], due: [0, 11_500, 0], ..zero }, 0, 20_000, 20_000, edge - 1, &valuer()), "write-off paid out of the seed");
    let h = Credit { halted: true, ..l };
    let (cur, succ) = (compile_credit(&m, &l), compile_credit(&m, &h));
    no(signed(&cur, "halt", |s| vec![credit_state(&h), Expr::bytes(s)], vec![], edge - 1, vec![cov_out(&succ, (edge - 1 - FEE) as u64, 0, VCOV)], 0, &guardian()), "halt paid out of the seed");
}
