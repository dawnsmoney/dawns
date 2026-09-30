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

/// Markdown and write-off with any slot number, to try the ones that do not exist.
fn md_any(m: &CreditMandate, prev: Credit, next: Credit, slot: i64, at: i64, held: i64) -> R {
    let (cur, succ) = (compile_credit(m, &prev), compile_credit(m, &next));
    unsigned(&cur, "markdown", vec![credit_state(&next), Expr::int(slot), Expr::int(at)], vec![], held, vec![cov_out(&succ, (held - FEE) as u64, 0, VCOV)], at as u64)
}
fn wo_any(m: &CreditMandate, prev: Credit, next: Credit, slot: i64, at: i64, held: i64) -> R {
    let (cur, succ) = (compile_credit(m, &prev), compile_credit(m, &next));
    signed(&cur, "writeOff", |s| vec![credit_state(&next), Expr::int(slot), Expr::int(at), Expr::bytes(s)], vec![], held, vec![cov_out(&succ, (held - FEE) as u64, 0, VCOV)], at as u64, &valuer())
}

#[test]
fn slots_outside_0_to_2_are_refused() {
    let m = CreditMandate::default();
    let (prev, held) = lent();
    let at = 13_700;
    let cap = m.limit(0, &prev, at);
    let md = Credit { marks: [cap, 20 * KAS, 0], ..prev };
    ok(md_any(&m, prev, md, 0, at, held), "markdown slot 0");
    let zero = Credit { marks: [0, 20 * KAS, 0], ..prev };
    let off = Credit { principal: [0, 20 * KAS, 0], due: [0, 11_500, 0], ..zero };
    ok(wo_any(&m, zero, off, 0, 20_000, held), "write off slot 0");
    let pay = 10 * KAS;
    ok(repay_run(&m, prev, repay_next(prev, 0, pay), 0, VCOV, pay, held, held + pay - FEE), "repay slot 0");
    for bad in [-1i64, 3] {
        // a slot that does not exist must not fall through to slot 0's figures, nor change nothing and pass
        no(md_any(&m, prev, md, bad, at, held), &format!("markdown slot {bad}, as slot 0"));
        no(md_any(&m, prev, prev, bad, at, held), &format!("markdown slot {bad}, state untouched"));
        no(wo_any(&m, zero, off, bad, 20_000, held), &format!("write off slot {bad}, as slot 0"));
        no(wo_any(&m, zero, zero, bad, 20_000, held), &format!("write off slot {bad}, state untouched"));
        no(repay_run(&m, prev, repay_next(prev, 0, pay), bad, VCOV, pay, held, held + pay - FEE), &format!("repay from a slot {bad} account, as slot 0"));
        no(repay_run(&m, prev, prev, bad, VCOV, pay, held, held + pay - FEE), &format!("repay from a slot {bad} account, state untouched"));
    }
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
struct Dep {
    m: CreditMandate, prev: Credit, held: i64, paid: i64, claimed: i64, minted: Option<i64>, next: Option<Credit>,
    lock: Option<u64>, owner: [u8; 32], acct_kind: i64, acct_vault: Hash,
    note_owner: Option<[u8; 32]>, note_type: u8, note_minter: bool, minter_out_amount: i64,
    vault_out: Option<i64>, note_out_value: Option<i64>,
    layout: u8, // 0 normal; 1 a second account rides along; 2 an extra output to a stranger; 3 continuation at index 1
    vault_only: bool, // run the vault input alone: its own checks must refuse
    minter_owner: Option<[u8; 32]>, minter_in_amount: i64, minter_in_type: u8, minter_in_is_minter: bool, minter_out_value: Option<i64>, token_cov: Option<Hash>,
}
impl Dep {
    fn valid(prev: Credit, held: i64, claimed: i64) -> Self {
        Dep { m: CreditMandate::default(), prev, held, paid: 100 * KAS, claimed, minted: None, next: None,
            lock: None, owner: xonly(&user()), acct_kind: 0, acct_vault: VCOV, note_owner: None, note_type: ID_SCRIPT_HASH, note_minter: false, minter_out_amount: 0,
            vault_out: None, note_out_value: None, layout: 0, vault_only: false,
            minter_owner: None, minter_in_amount: 0, minter_in_type: ID_COVENANT, minter_in_is_minter: true, minter_out_value: None, token_cov: None }
    }
    fn correct_minted(&self) -> i64 { (self.paid - self.m.base.note_value - self.m.base.max_fee) / price_up(self.m.nav(&self.prev, self.held, self.claimed), self.prev.shares) }
    fn correct_next(&self) -> Credit { Credit { shares: self.prev.shares + self.correct_minted(), ..self.prev } }
    fn run(&self) -> R {
        let cur = compile_credit(&self.m, &self.prev);
        let next = self.next.unwrap_or_else(|| self.correct_next());
        let succ = compile_credit(&self.m, &next);
        let acct = compile_account(self.owner, self.acct_vault, self.acct_kind);
        let minter = compile_kcc(&self.minter_owner.unwrap_or(VCOV.as_bytes()), self.minter_in_type, self.minter_in_amount, self.minter_in_is_minter);
        let minter_out = compile_kcc(&VCOV.as_bytes(), ID_COVENANT, self.minter_out_amount, true);
        let tcov = self.token_cov.unwrap_or(SCOV);
        let minted = self.minted.unwrap_or_else(|| self.correct_minted());
        let note_owner = self.note_owner.unwrap_or_else(|| redeem_hash(self.owner, VCOV));
        let note = compile_kcc(&note_owner, self.note_type, minted, self.note_minter);
        let mut entries = vec![cov_utxo(&cur, self.held as u64, VCOV), plain_utxo(self.paid as u64, p2sh(&acct)), cov_utxo(&minter, MINTER_DUST as u64, tcov)];
        let mut inputs = vec![tx_input(0, decl_sigscript(&cur, "deposit", vec![credit_state(&next), Expr::int(self.claimed)])),
            tx_input(1, entry_sigscript(&acct, "enter", vec![])),
            tx_input(2, leader_sigscript(&minter, "transfer", vec![kcc_states(vec![(VCOV.as_bytes().to_vec(), ID_COVENANT, self.minter_out_amount, true), (note_owner.to_vec(), self.note_type, minted, self.note_minter)]), sigs(vec![]), Expr::dynamic_bytes(vec![0])]))];
        let vault_out = self.vault_out.unwrap_or(self.held + self.paid - self.m.base.note_value - FEE);
        let mut outputs = vec![cov_out(&succ, vault_out.max(0) as u64, 0, VCOV), cov_out(&minter_out, self.minter_out_value.unwrap_or(MINTER_DUST) as u64, 2, tcov),
            cov_out(&note, self.note_out_value.unwrap_or(self.m.base.note_value) as u64, 2, tcov)];
        if self.layout == 3 { outputs.swap(0, 1); }
        if self.layout == 1 {
            let other = compile_account(xonly(&user2()), VCOV, 0);
            entries.push(plain_utxo((50 * KAS) as u64, p2sh(&other)));
            inputs.push(tx_input(3, entry_sigscript(&other, "enter", vec![])));
        }
        if self.layout == 2 { outputs.push(out_to(KAS as u64, p2pk_spk(xonly(&stranger())))); }
        let tx = new_tx(inputs, outputs, self.lock.unwrap_or(self.claimed as u64));
        if self.vault_only { execute(&tx, entries, 0).map_err(|e| (0, e)) } else { run_all(&tx, &entries) }
    }
}

#[derive(Clone)]
struct Red {
    m: CreditMandate, prev: Credit, held: i64, shares: i64, claimed: i64, payout: Option<i64>, next: Option<Credit>,
    lock: Option<u64>, note_owner_key: [u8; 32], acct_owner: [u8; 32], acct_kind: i64, acct_value: i64, pay_to: Option<[u8; 32]>, vault_out: Option<i64>,
    note_minter: bool,
    layout: u8, // 0 normal; 1 note re-created to a stranger instead of burned; 2 extra output; 3 extra input; 4 continuation at index 1
    vault_only: bool, note_type: u8, note_owner_hash: Option<[u8; 32]>,
    minter_owner: Option<[u8; 32]>, minter_in_amount: i64, minter_in_is_minter: bool, minter_in_type: u8, minter_out_value: Option<i64>,
    owner_extra: i64, token_cov: Option<Hash>, note_cov: Option<Hash>,
}
impl Red {
    fn valid(prev: Credit, held: i64, shares: i64, claimed: i64) -> Self {
        Red { m: CreditMandate::default(), prev, held, shares, claimed, payout: None, next: None,
            lock: None, note_owner_key: xonly(&user()), acct_owner: xonly(&user()), acct_kind: 1, acct_value: KAS, pay_to: None, vault_out: None,
            note_minter: false, layout: 0, vault_only: false, note_type: ID_SCRIPT_HASH, note_owner_hash: None,
            minter_owner: None, minter_in_amount: 0, minter_in_is_minter: true, minter_in_type: ID_COVENANT, minter_out_value: None, owner_extra: 0, token_cov: None, note_cov: None }
    }
    fn correct_payout(&self) -> i64 { let g = self.shares * price_down(self.m.nav(&self.prev, self.held, self.claimed), self.prev.shares); g - g * self.m.base.exit_fee_bps / 10_000 }
    fn correct_next(&self) -> Credit { Credit { shares: self.prev.shares - self.shares, ..self.prev } }
    fn run(&self) -> R {
        let cur = compile_credit(&self.m, &self.prev);
        let next = self.next.unwrap_or_else(|| self.correct_next());
        let succ = compile_credit(&self.m, &next);
        let acct = compile_account(self.acct_owner, VCOV, self.acct_kind);
        let minter = compile_kcc(&self.minter_owner.unwrap_or(VCOV.as_bytes()), self.minter_in_type, self.minter_in_amount, self.minter_in_is_minter);
        let minter_out = compile_kcc(&VCOV.as_bytes(), ID_COVENANT, 0, true);
        let note = compile_kcc(&self.note_owner_hash.unwrap_or_else(|| redeem_hash(self.note_owner_key, VCOV)), self.note_type, self.shares, self.note_minter);
        let payout = self.payout.unwrap_or_else(|| self.correct_payout());
        let nv = self.m.base.note_value;
        let tcov = self.token_cov.unwrap_or(SCOV);
        let mut entries = vec![cov_utxo(&cur, self.held as u64, VCOV), plain_utxo(self.acct_value as u64, p2sh(&acct)), cov_utxo(&minter, MINTER_DUST as u64, tcov), cov_utxo(&note, nv as u64, self.note_cov.unwrap_or(tcov))];
        let mut new_kcc = vec![(VCOV.as_bytes().to_vec(), ID_COVENANT, 0, true)];
        if self.layout == 1 { new_kcc.push((redeem_hash(xonly(&stranger()), VCOV).to_vec(), ID_SCRIPT_HASH, self.shares, false)); }
        let mut inputs = vec![tx_input(0, decl_sigscript(&cur, "redeem", vec![credit_state(&next), Expr::int(self.claimed)])),
            tx_input(1, entry_sigscript(&acct, "enter", vec![])),
            tx_input(2, leader_sigscript(&minter, "transfer", vec![kcc_states(new_kcc), sigs(vec![]), Expr::dynamic_bytes(vec![0, 1])])),
            tx_input(3, decl_sigscript(&note, "transfer", vec![]))];
        let vault_out = self.vault_out.unwrap_or(self.held - payout);
        let mut outputs = vec![cov_out(&succ, vault_out.max(0) as u64, 0, VCOV), cov_out(&minter_out, self.minter_out_value.unwrap_or(MINTER_DUST) as u64, 2, tcov),
            out_to((payout + self.acct_value + nv - self.m.base.max_fee + self.owner_extra).max(0) as u64, p2pk_spk(self.pay_to.unwrap_or(self.acct_owner)))];
        if self.layout == 3 { entries.push(plain_utxo(KAS as u64, p2pk_spk(xonly(&stranger())))); inputs.push(tx_input(4, vec![])); }
        if self.layout == 4 { outputs.swap(0, 1); }
        if self.layout == 1 { let kept = compile_kcc(&redeem_hash(xonly(&stranger()), VCOV), ID_SCRIPT_HASH, self.shares, false); outputs.insert(2, cov_out(&kept, nv as u64, 2, SCOV)); }
        if self.layout == 2 { outputs.push(out_to(KAS as u64, p2pk_spk(xonly(&stranger())))); }
        let tx = new_tx(inputs, outputs, self.lock.unwrap_or(self.claimed as u64));
        if self.vault_only { execute(&tx, entries, 0).map_err(|e| (0, e)) } else { run_all(&tx, &entries) }
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

// ---------------------------------------------------------------------------
// deposit and redeem, one flip per guard. The full transaction first; then the
// VAULT INPUT ALONE, so a refusal is the vault's own and not the token's or the
// account's. Written against the v0.2 mutation run's survivors (the deposit and
// redeem code is the NAV vault's, but copied, so the credit suite must hold it).
// ---------------------------------------------------------------------------
fn vo(mut d: Dep) -> Dep { d.vault_only = true; d }
fn vr(mut r: Red) -> Red { r.vault_only = true; r }

#[test]
fn deposit_flips() {
    let (prev, held) = funded();
    let base = Dep::valid(prev, held, 2_000);
    ok(base.run(), "baseline");
    let f = |g: &dyn Fn(&mut Dep), what: &str| { let mut d = base.clone(); g(&mut d); no(d.run(), what); };
    f(&|d| d.minted = Some(d.correct_minted() + 1), "mints one share too many");
    f(&|d| { d.minted = Some(d.correct_minted() + 1); d.next = Some(Credit { shares: d.prev.shares + d.correct_minted() + 1, ..d.prev }); }, "mints too many and books them");
    f(&|d| d.note_owner = Some(redeem_hash(xonly(&stranger()), VCOV)), "shares to someone else");
    f(&|d| d.note_owner = Some(b2b(b"anything")), "shares to an arbitrary script");
    f(&|d| d.note_type = ID_COVENANT, "note owned by a covenant id");
    f(&|d| d.note_minter = true, "note made a minter");
    f(&|d| d.minter_out_amount = 5, "minter branch keeps a balance");
    f(&|d| d.acct_kind = 1, "a redeem account used as a deposit");
    f(&|d| d.acct_vault = Hash::from_bytes([9; 32]), "an account for another vault");
    f(&|d| d.vault_out = Some(d.held + d.paid - d.m.base.note_value - FEE - 10 * KAS), "vault keeps less than it received");
    f(&|d| d.note_out_value = Some(d.m.base.note_value + KAS), "note takes more KAS");
    f(&|d| d.paid = KAS, "below the minimum deposit");
    f(&|d| d.prev.halted = true, "deposit into a halted vault");
    f(&|d| d.m.base.deposit_until = 1_900, "deposit after the window closed");
    f(&|d| d.lock = Some(1_000), "claims a DAA the chain has not reached");
    f(&|d| d.next = Some(Credit { marks: [5, 0, 0], ..d.correct_next() }), "moves a mark");
    f(&|d| d.layout = 1, "a second account rides along");
    f(&|d| d.layout = 2, "an extra output pays a stranger");
}

#[test]
fn deposit_vault_guards_alone() {
    let (prev, held) = funded();
    let base = vo(Dep::valid(prev, held, 2_000));
    ok(base.run(), "vault alone accepts the baseline");
    let f = |g: &dyn Fn(&mut Dep), what: &str| { let mut d = base.clone(); g(&mut d); no(d.run(), what); };
    f(&|d| d.layout = 1, "an extra input");
    f(&|d| d.layout = 2, "an extra output");
    f(&|d| d.layout = 3, "continuation not at output 0");
    f(&|d| d.acct_vault = Hash::from_bytes([9; 32]), "an account for another vault");
    f(&|d| d.acct_kind = 1, "a redeem account");
    f(&|d| d.minter_owner = Some(xonly(&stranger())), "a minter branch owned by someone else");
    f(&|d| d.minter_in_type = ID_SCRIPT_HASH, "a minter branch owned by script");
    f(&|d| d.minter_in_is_minter = false, "a branch that is not the minter");
    f(&|d| d.minter_in_amount = 5, "a minter branch with a balance");
    f(&|d| d.minter_out_value = Some(MINTER_DUST - KAS / 10), "the minter branch's KAS skimmed");
    f(&|d| d.note_out_value = Some(d.m.base.note_value + KAS), "the note takes more KAS");
    f(&|d| d.token_cov = Some(Hash::from_bytes([8; 32])), "another token's branch");
    f(&|d| d.vault_out = Some(d.held + d.paid - d.m.base.note_value - d.m.base.max_fee - 1), "the vault keeps less than the deposit less the fee cap");
    f(&|d| d.paid = 100_000_000_000_000 + 1, "an account coin above the 1M KAS bound");
    f(&|d| d.held = 100_000_000_000_000 + 1, "a vault above the 1M KAS bound");
    f(&|d| d.paid = KAS, "below the minimum deposit");
    f(&|d| d.m.base.deposit_until = 1_900, "after the deposit window");
    f(&|d| d.lock = Some(1_000), "claims a DAA the chain has not reached");
    // a deposit worth less than one share at a high price
    f(&|d| { d.prev = Credit { principal: [500_000 * KAS, 0, 0], marks: [500_000 * KAS, 0, 0], due: [11_500, 0, 0], shares: 10, ..d.prev }; d.paid = 6 * KAS; d.m.base.min_deposit = KAS; }, "mints zero shares");
    // held below the seed while loans keep NAV positive
    f(&|d| { d.held = KAS / 10; d.prev = Credit { principal: [200 * KAS, 0, 0], marks: [200 * KAS, 0, 0], due: [11_500, 0, 0], ..d.prev }; }, "vault below its own seed");
    f(&|d| d.m.period = 0, "a zero markdown period (bad parameter)");
}

#[test]
fn redeem_flips() {
    let (prev, held) = funded();
    let base = Red::valid(prev, held, prev.shares / 2, 2_000);
    ok(base.run(), "baseline");
    let f = |g: &dyn Fn(&mut Red), what: &str| { let mut r = base.clone(); g(&mut r); no(r.run(), what); };
    f(&|r| r.payout = Some(r.correct_payout() + 1), "pays one sompi too much");
    f(&|r| { r.payout = Some(r.correct_payout() + KAS); r.vault_out = Some(r.held - r.correct_payout() - KAS); }, "pays more and books it");
    f(&|r| r.pay_to = Some(xonly(&stranger())), "pays a stranger");
    f(&|r| r.acct_owner = xonly(&stranger()), "a stranger's account redeems my note");
    f(&|r| r.acct_kind = 0, "a deposit account used to redeem");
    f(&|r| r.next = Some(Credit { shares: r.prev.shares, ..r.prev }), "burns nothing on the books");
    f(&|r| r.next = Some(Credit { shares: r.prev.shares - r.shares + 1, ..r.prev }), "books one share fewer burned");
    f(&|r| r.layout = 1, "the note is re-created instead of burned");
    f(&|r| r.layout = 2, "an extra output");
    f(&|r| r.m.base.maturity = 3_000, "before maturity (fixed term)");
    f(&|r| r.vault_out = Some(r.held - r.correct_payout() - KAS), "vault gives up more than the payout");
    f(&|r| r.note_minter = true, "burns a minter branch as a note");
    f(&|r| { r.prev = Credit { principal: [150 * KAS, 0, 0], marks: [150 * KAS, 0, 0], due: [11_500, 0, 0], ..r.prev }; r.held = 30 * KAS; r.shares = r.prev.shares; }, "pays out KAS the vault does not hold");
}

#[test]
fn redeem_vault_guards_alone() {
    let (prev, held) = funded();
    let base = vr(Red::valid(prev, held, prev.shares / 4, 2_000));
    ok(base.run(), "vault alone accepts the baseline");
    let f = |g: &dyn Fn(&mut Red), what: &str| { let mut r = base.clone(); g(&mut r); no(r.run(), what); };
    f(&|r| r.layout = 3, "an extra input");
    f(&|r| r.layout = 2, "an extra output");
    f(&|r| r.layout = 4, "continuation not at output 0");
    f(&|r| r.lock = Some(1_000), "claims a DAA the chain has not reached");
    f(&|r| r.m.base.maturity = 3_000, "before maturity");
    f(&|r| r.acct_owner = xonly(&stranger()), "another owner's account");
    f(&|r| r.acct_kind = 0, "a deposit account");
    f(&|r| r.minter_owner = Some(xonly(&stranger())), "a minter branch owned by someone else");
    f(&|r| r.minter_in_type = ID_SCRIPT_HASH, "a minter branch owned by script");
    f(&|r| r.minter_in_is_minter = false, "a branch that is not the minter");
    f(&|r| r.minter_in_amount = 5, "a minter branch with a balance");
    f(&|r| r.minter_out_value = Some(MINTER_DUST - KAS / 10), "the minter branch's KAS skimmed");
    f(&|r| r.token_cov = Some(Hash::from_bytes([8; 32])), "another token");
    f(&|r| r.note_cov = Some(Hash::from_bytes([8; 32])), "a note of another token");
    f(&|r| r.note_type = ID_COVENANT, "a note owned by a covenant id");
    f(&|r| r.note_owner_hash = Some(b2b(b"not the account")), "a note owned by another script");
    f(&|r| r.shares = r.prev.shares + 1, "burns more than the supply");
    f(&|r| r.owner_extra = 1, "pays the owner one sompi more");
    f(&|r| r.acct_value = 100_000_000_000_000 + 1, "an account coin above the bound");
    f(&|r| r.held = 100_000_000_000_000 + 1, "a vault above the bound");
    f(&|r| { r.prev = Credit { principal: [150 * KAS, 0, 0], marks: [150 * KAS, 0, 0], due: [11_500, 0, 0], ..r.prev }; r.held = 30 * KAS; r.shares = r.prev.shares; r.vault_out = Some(0); }, "pays out KAS the vault does not hold");
    f(&|r| r.m.base.exit_fee_bps = 20_000, "an exit fee over 100% (bad parameter)");
    f(&|r| r.m.base.exit_fee_bps = -100, "a negative exit fee (bad parameter)");
}

#[test]
fn halt_guards() {
    let m = CreditMandate::default();
    let (prev, held) = lent();
    let n = Credit { halted: true, ..prev };
    let (cur, succ) = (compile_credit(&m, &prev), compile_credit(&m, &n));
    let run = |next: Credit, extra_in: bool, extra_out: bool, swap: bool, k: &secp256k1::Keypair| -> R {
        let s2 = compile_credit(&m, &next);
        let mut entries = vec![cov_utxo(&cur, held as u64, VCOV)];
        let mut inputs = vec![tx_input(0, vec![])];
        if extra_in { entries.push(plain_utxo(KAS as u64, p2pk_spk(xonly(&stranger())))); inputs.push(tx_input(1, vec![])); }
        let mut outs = vec![cov_out(&s2, (held - FEE) as u64, 0, VCOV)];
        if extra_out || swap { outs.push(out_to(1, p2pk_spk(xonly(&stranger())))); }
        if swap { outs.swap(0, 1); }
        let mut tx = new_tx(inputs, outs, 0);
        tx.inputs[0].signature_script = decl_sigscript(&cur, "halt", vec![credit_state(&next), Expr::bytes(vec![0u8; 65])]);
        let s0 = sign(&tx, entries.clone(), 0, k);
        tx.inputs[0].signature_script = decl_sigscript(&cur, "halt", vec![credit_state(&next), Expr::bytes(s0)]);
        execute(&tx, entries, 0).map_err(|e| (0, e))
    };
    let _ = succ;
    ok(run(n, false, false, false, &guardian()), "baseline");
    no(run(n, true, false, false, &guardian()), "an extra input");
    no(run(n, false, true, false, &guardian()), "an extra output");
    no(run(n, false, false, true, &guardian()), "continuation not at output 0");
    no(run(n, false, false, false, &valuer()), "the valuer halts");
    no(run(prev, false, false, false, &guardian()), "a halt that doesn't halt");
    no(run(Credit { shares: n.shares + 1, ..n }, false, false, false, &guardian()), "a halt that mints a share on the books");
}

// ---------------------------------------------------------------------------
// v0.1: no loan and no fee takes the vault below its seed, and a signed move
// keeps everything but the fee. Each path alone, at the edge: exactly enough
// is accepted, one sompi less is refused.
// ---------------------------------------------------------------------------
#[test]
fn the_seed_stays_and_only_the_fee_leaves() {
    let m = CreditMandate::default();
    let (keep, fee) = (m.base.min_keep, m.base.max_fee);
    let (prev, _) = lent();
    let edge = keep + fee;
    let vault_alone = |f: &str, args: &dyn Fn(Vec<u8>) -> Vec<Expr<'static>>, next: &Credit, held: i64, out_v: i64, k: &secp256k1::Keypair, lock: u64| -> R {
        let (cur, succ) = (compile_credit(&m, &prev), compile_credit(&m, next));
        let mut tx = new_tx(vec![tx_input(0, vec![])], vec![cov_out(&succ, out_v.max(0) as u64, 0, VCOV)], lock);
        let entries = vec![cov_utxo(&cur, held as u64, VCOV)];
        tx.inputs[0].signature_script = decl_sigscript(&cur, f, args(vec![0u8; 65]));
        let sg = sign(&tx, entries.clone(), 0, k);
        tx.inputs[0].signature_script = decl_sigscript(&cur, f, args(sg));
        execute(&tx, entries, 0).map_err(|e| (0, e))
    };
    // mark
    let up = Credit { marks: [41 * KAS, 20 * KAS, 0], mark_epoch: 1, ..prev };
    let mk = |s: Vec<u8>| vec![credit_state(&up), Expr::int(2_500), Expr::bytes(s)];
    ok(vault_alone("mark", &mk, &up, edge, edge - FEE, &valuer(), 2_500), "mark with the seed and a fee in the vault");
    no(vault_alone("mark", &mk, &up, edge - 1, edge - 1 - FEE, &valuer(), 2_500), "mark whose fee would come out of the seed");
    no(vault_alone("mark", &mk, &up, 50 * KAS, 50 * KAS - fee - 1, &valuer(), 2_500), "mark that takes more than the fee");
    no(mark_run(&m, prev, Credit { marks: [40 * KAS, 30 * KAS, 0], mark_epoch: 1, ..prev }, 2_500, 2_500, 50 * KAS, &valuer()), "mark slot 1 up past its step and its contract");
    // halt
    let h = Credit { halted: true, ..prev };
    let hk = |s: Vec<u8>| vec![credit_state(&h), Expr::bytes(s)];
    ok(vault_alone("halt", &hk, &h, edge, edge - FEE, &guardian(), 0), "halt with the seed and a fee in the vault");
    no(vault_alone("halt", &hk, &h, edge - 1, edge - 1 - FEE, &guardian(), 0), "halt whose fee would come out of the seed");
    no(vault_alone("halt", &hk, &h, 50 * KAS, 50 * KAS - fee - 1, &guardian(), 0), "halt that takes more than the fee");
    // write-off: slot 0 late and marked to zero
    let zero = Credit { marks: [0, 20 * KAS, 0], ..prev };
    let off = Credit { principal: [0, 20 * KAS, 0], due: [0, 11_500, 0], ..zero };
    let wo_alone = |held: i64, out_v: i64| -> R {
        let (cur, succ) = (compile_credit(&m, &zero), compile_credit(&m, &off));
        let mut tx = new_tx(vec![tx_input(0, vec![])], vec![cov_out(&succ, out_v.max(0) as u64, 0, VCOV)], 20_000);
        let entries = vec![cov_utxo(&cur, held as u64, VCOV)];
        let args = |s: Vec<u8>| vec![credit_state(&off), Expr::int(0), Expr::int(20_000), Expr::bytes(s)];
        tx.inputs[0].signature_script = decl_sigscript(&cur, "writeOff", args(vec![0u8; 65]));
        let sg = sign(&tx, entries.clone(), 0, &valuer());
        tx.inputs[0].signature_script = decl_sigscript(&cur, "writeOff", args(sg));
        execute(&tx, entries, 0).map_err(|e| (0, e))
    };
    ok(wo_alone(edge, edge - FEE), "write off with the seed and a fee in the vault");
    no(wo_alone(edge - 1, edge - 1 - FEE), "write off whose fee would come out of the seed");
    no(wo_alone(50 * KAS, 50 * KAS - fee - 1), "write off that takes more than the fee");
    // markdown: anyone may write it in, so only the seed guards the fee
    let md_next = Credit { marks: [20 * KAS, 20 * KAS, 0], ..prev };
    ok(md_run(&m, prev, md_next, 0, 13_700, 13_700, edge, edge - FEE), "markdown with the seed and a fee in the vault");
    no(md_run(&m, prev, md_next, 0, 13_700, 13_700, edge - 1, edge - 1 - FEE), "markdown whose fee would come out of the seed");
    // lend with no reserve floor and full caps: the seed is the only floor left
    let mut open = m.clone(); open.base.reserve_floor_bps = 0; open.base.caps = [10_000; 4];
    let (fp, fheld) = funded();
    let most = fheld - keep - fee;
    ok(lend_run(&open, fp, lend_next(&open, fp, 0, most, 1_500), 0, most, 1_500, 1_500, fheld, to_borrower(0), &allocator()), "lend all but the seed and a fee");
    no(lend_run(&open, fp, lend_next(&open, fp, 0, most + 1, 1_500), 0, most + 1, 1_500, 1_500, fheld, to_borrower(0), &allocator()), "lend one sompi into the seed");
}
