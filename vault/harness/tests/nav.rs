//! NAV vault: the accepted baselines first, then one flip per guard.

use dawns_vault_harness::nav::*;
use dawns_vault_harness::*;
use kaspa_consensus_core::tx::{Transaction, TransactionOutpoint, TransactionOutput, UtxoEntry, TransactionId};
use kaspa_consensus_core::Hash;
use silverscript_lang::ast::Expr;

const FEE: i64 = 5_000;
const MINTER_DUST: i64 = KAS / 5;

fn ok(r: Result<(), (usize, kaspa_txscript_errors::TxScriptError)>, what: &str) {
    assert!(r.is_ok(), "{what}: expected ACCEPT, got {r:?}");
}
fn no(r: Result<(), (usize, kaspa_txscript_errors::TxScriptError)>, what: &str) {
    assert!(r.is_err(), "{what}: expected REFUSE, engine accepted");
    if std::env::var("WHY").is_ok() { eprintln!("REFUSED {what}: {:?}", r.unwrap_err()); }
}

// ---------------------------------------------------------------------------
// deposit
// ---------------------------------------------------------------------------
#[derive(Clone)]
pub struct Dep {
    pub m: NavMandate,
    pub prev: Nav,
    pub held: i64,
    pub paid: i64,
    pub owner: [u8; 32],
    pub acct_kind: i64,
    pub acct_vault: Hash,
    pub claimed: i64,
    pub lock_time: u64,
    pub minted: Option<i64>,       // shares the note declares (None = correct)
    pub note_owner: Option<[u8; 32]>,
    pub note_type: u8,
    pub note_minter: bool,
    pub minter_out_amount: i64,
    pub next: Option<Nav>,
    pub vault_out: Option<i64>,
    pub note_out_value: Option<i64>,
    pub layout: u8, // 0 normal; 1 extra input (a second account); 2 extra output to a stranger; 3 continuation at index 1
    pub vault_only: bool,          // run the vault input alone: its own checks must refuse
    pub minter_owner: Option<[u8; 32]>,
    pub minter_in_amount: i64,
    pub minter_in_type: u8,
    pub minter_in_is_minter: bool,
    pub minter_out_value: Option<i64>,
    pub token_cov: Option<Hash>,   // covenant id the token inputs/outputs carry
}
impl Dep {
    pub fn valid(prev: Nav, held: i64) -> Self {
        Dep { m: NavMandate::default(), prev, held, paid: 100 * KAS, owner: xonly(&user()), acct_kind: 0, acct_vault: VCOV, claimed: 1_500, lock_time: 1_500,
            minted: None, note_owner: None, note_type: ID_SCRIPT_HASH, note_minter: false, minter_out_amount: 0, next: None, vault_out: None, note_out_value: None, layout: 0,
            vault_only: false, minter_owner: None, minter_in_amount: 0, minter_in_type: ID_COVENANT, minter_in_is_minter: true, minter_out_value: None, token_cov: None }
    }
    pub fn credit(&self) -> i64 { self.paid - self.m.note_value - self.m.max_fee }
    pub fn correct_minted(&self) -> i64 { self.credit() / price_up(self.prev.nav(self.held), self.prev.shares) }
    pub fn correct_next(&self) -> Nav { Nav { shares: self.prev.shares + self.correct_minted(), ..self.prev } }
    pub fn build(&self) -> (Transaction, Vec<UtxoEntry>) {
        let cur = compile_nav(&self.m, &self.prev);
        let next = self.next.unwrap_or_else(|| self.correct_next());
        let succ = compile_nav(&self.m, &next);
        let acct = compile_account(self.owner, self.acct_vault, self.acct_kind);
        let minter = compile_kcc(&self.minter_owner.unwrap_or(VCOV.as_bytes()), self.minter_in_type, self.minter_in_amount, self.minter_in_is_minter);
        let minter_out = compile_kcc(&VCOV.as_bytes(), ID_COVENANT, self.minter_out_amount, true);
        let tcov = self.token_cov.unwrap_or(SCOV);
        let minted = self.minted.unwrap_or_else(|| self.correct_minted());
        let note_owner = self.note_owner.unwrap_or_else(|| redeem_hash(self.owner, VCOV));
        let note = compile_kcc(&note_owner, self.note_type, minted, self.note_minter);
        let mut entries = vec![cov_utxo(&cur, self.held as u64, VCOV), plain_utxo(self.paid as u64, pay_to_script_hash_script_(&acct)), cov_utxo(&minter, MINTER_DUST as u64, tcov)];
        let mut inputs = vec![tx_input(0, decl_sigscript(&cur, "deposit", vec![nav_state(&next), Expr::int(self.claimed)])),
            tx_input(1, entry_sigscript(&acct, "enter", vec![])),
            tx_input(2, leader_sigscript(&minter, "transfer", vec![
                kcc_states(vec![(VCOV.as_bytes().to_vec(), ID_COVENANT, self.minter_out_amount, true), (note_owner.to_vec(), self.note_type, minted, self.note_minter)]),
                sigs(vec![]), Expr::dynamic_bytes(vec![0])]))];
        let vault_out = self.vault_out.unwrap_or(self.held + self.paid - self.m.note_value - FEE);
        let mut outputs = vec![cov_out(&succ, vault_out as u64, 0, VCOV), cov_out(&minter_out, self.minter_out_value.unwrap_or(MINTER_DUST) as u64, 2, tcov), cov_out(&note, self.note_out_value.unwrap_or(self.m.note_value) as u64, 2, tcov)];
        if self.layout == 3 { outputs.swap(0, 1); }
        if self.layout == 1 {
            let other = compile_account(xonly(&user2()), VCOV, 0);
            entries.push(plain_utxo((50 * KAS) as u64, pay_to_script_hash_script_(&other)));
            inputs.push(tx_input(3, entry_sigscript(&other, "enter", vec![])));
        }
        if self.layout == 2 { outputs.push(out_to(KAS as u64, p2pk_spk(xonly(&stranger())))); }
        (new_tx(inputs, outputs, self.lock_time), entries)
    }
    pub fn run(&self) -> Result<(), (usize, kaspa_txscript_errors::TxScriptError)> {
        let (t, e) = self.build();
        if self.vault_only { execute(&t, e, 0).map_err(|x| (0, x)) } else { run_all(&t, &e) }
    }
}
pub fn pay_to_script_hash_script_(c: &silverscript_lang::compiler::CompiledContract<'_>) -> kaspa_consensus_core::tx::ScriptPublicKey { kaspa_txscript::pay_to_script_hash_script(&c.bytecode) }

#[test]
fn deposit_first_and_second() {
    let d = Dep::valid(Nav::default(), 2 * KAS);
    ok(d.run(), "first deposit");
    assert_eq!(d.correct_minted(), (100 * KAS - KAS / 5 - MAX_FEE) / FIRST_PRICE);
    let after = d.correct_next();
    let held = d.held + d.paid - d.m.note_value - FEE;
    let mut d2 = Dep::valid(after, held);
    d2.owner = xonly(&user2());
    ok(d2.run(), "second deposit, priced at NAV");
}

#[test]
fn deposit_flips() {
    let base = Dep::valid(Nav::default(), 2 * KAS);
    ok(base.run(), "baseline");
    let f = |g: &dyn Fn(&mut Dep), what: &str| { let mut d = base.clone(); g(&mut d); no(d.run(), what); };
    f(&|d| d.minted = Some(d.correct_minted() + 1), "mints one share too many");
    f(&|d| { d.minted = Some(d.correct_minted() + 1); d.next = Some(Nav { shares: d.correct_minted() + 1, ..d.prev }); }, "mints too many and books them");
    f(&|d| d.note_owner = Some(redeem_hash(xonly(&stranger()), VCOV)), "shares to someone else");
    f(&|d| d.note_owner = Some(b2b(b"anything")), "shares to an arbitrary script");
    f(&|d| d.note_type = ID_COVENANT, "note owned by a covenant id");
    f(&|d| d.note_minter = true, "note made a minter");
    f(&|d| d.minter_out_amount = 5, "minter branch keeps a balance");
    f(&|d| d.acct_kind = 1, "a redeem account used as a deposit");
    f(&|d| d.acct_vault = Hash::from_bytes([9; 32]), "an account for another vault");
    f(&|d| d.vault_out = Some(d.held + d.paid - d.m.note_value - FEE - 10 * KAS), "vault keeps less than it received");
    f(&|d| d.note_out_value = Some(d.m.note_value + KAS), "note takes more KAS");
    f(&|d| d.paid = 1 * KAS, "below the minimum deposit");
    f(&|d| d.prev.halted = true, "deposit into a halted vault");
    f(&|d| { d.m.deposit_until = 1_400; }, "deposit after the window closed");
    f(&|d| d.lock_time = 1_000, "claims a DAA the chain has not reached");
    f(&|d| d.next = Some(Nav { marks: [5, 0, 0, 0], ..d.correct_next() }), "moves a mark");
    f(&|d| d.layout = 1, "a second account rides along");
    f(&|d| d.layout = 2, "an extra output pays a stranger");
}

// ---------------------------------------------------------------------------
// redeem
// ---------------------------------------------------------------------------
#[derive(Clone)]
pub struct Red {
    pub m: NavMandate,
    pub prev: Nav,
    pub held: i64,
    pub note_shares: i64,
    pub note_owner_key: [u8; 32],   // whose redeem account owns the note
    pub acct_owner: [u8; 32],       // whose redeem account is spent
    pub acct_kind: i64,
    pub acct_value: i64,
    pub pay_to: Option<[u8; 32]>,
    pub payout: Option<i64>,
    pub next: Option<Nav>,
    pub vault_out: Option<i64>,
    pub claimed: i64,
    pub lock_time: u64,
    pub note_minter: bool,
    pub layout: u8, // 0 normal; 1 note kept (not burned: re-created to a stranger); 2 extra output; 3 extra input; 4 continuation at index 1
    pub vault_only: bool,
    pub note_type: u8,
    pub note_owner_hash: Option<[u8; 32]>,
    pub minter_owner: Option<[u8; 32]>,
    pub minter_in_amount: i64,
    pub minter_in_is_minter: bool,
    pub minter_in_type: u8,
    pub minter_out_value: Option<i64>,
    pub owner_extra: i64,          // pay the owner this much more
    pub token_cov: Option<Hash>,
    pub note_cov: Option<Hash>,
    pub note_coin: Option<i64>,
}
impl Red {
    pub fn valid(prev: Nav, held: i64, note_shares: i64) -> Self {
        Red { m: NavMandate::default(), prev, held, note_shares, note_owner_key: xonly(&user()), acct_owner: xonly(&user()), acct_kind: 1, acct_value: KAS,
            pay_to: None, payout: None, next: None, vault_out: None, claimed: 1_500, lock_time: 1_500, note_minter: false, layout: 0,
            vault_only: false, note_type: ID_SCRIPT_HASH, note_owner_hash: None, minter_owner: None, minter_in_amount: 0, minter_in_is_minter: true, minter_in_type: ID_COVENANT, minter_out_value: None, owner_extra: 0, token_cov: None, note_cov: None, note_coin: None }
    }
    pub fn correct_payout(&self) -> i64 { let g = self.note_shares * price_down(self.prev.nav(self.held), self.prev.shares); g - g * self.m.exit_fee_bps / 10_000 }
    pub fn correct_next(&self) -> Nav { Nav { shares: self.prev.shares - self.note_shares, ..self.prev } }
    pub fn build(&self) -> (Transaction, Vec<UtxoEntry>) {
        let cur = compile_nav(&self.m, &self.prev);
        let next = self.next.unwrap_or_else(|| self.correct_next());
        let succ = compile_nav(&self.m, &next);
        let acct = compile_account(self.acct_owner, VCOV, self.acct_kind);
        let minter = compile_kcc(&self.minter_owner.unwrap_or(VCOV.as_bytes()), self.minter_in_type, self.minter_in_amount, self.minter_in_is_minter);
        let minter_out = compile_kcc(&VCOV.as_bytes(), ID_COVENANT, 0, true);
        let note = compile_kcc(&self.note_owner_hash.unwrap_or_else(|| redeem_hash(self.note_owner_key, VCOV)), self.note_type, self.note_shares, self.note_minter);
        let payout = self.payout.unwrap_or_else(|| self.correct_payout());
        let tcov = self.token_cov.unwrap_or(SCOV);
        let mut entries = vec![cov_utxo(&cur, self.held as u64, VCOV), plain_utxo(self.acct_value as u64, pay_to_script_hash_script_(&acct)),
            cov_utxo(&minter, MINTER_DUST as u64, tcov), cov_utxo(&note, self.note_coin.unwrap_or(self.m.note_value) as u64, self.note_cov.unwrap_or(tcov))];
        let mut new_kcc = vec![(VCOV.as_bytes().to_vec(), ID_COVENANT, 0, true)];
        if self.layout == 1 { new_kcc.push((redeem_hash(xonly(&stranger()), VCOV).to_vec(), ID_SCRIPT_HASH, self.note_shares, false)); }
        let mut inputs = vec![tx_input(0, decl_sigscript(&cur, "redeem", vec![nav_state(&next), Expr::int(self.claimed)])),
            tx_input(1, entry_sigscript(&acct, "enter", vec![])),
            tx_input(2, leader_sigscript(&minter, "transfer", vec![kcc_states(new_kcc.clone()), sigs(vec![]), Expr::dynamic_bytes(vec![0, 1])])),
            tx_input(3, decl_sigscript(&note, "transfer", vec![]))];
        let vault_out = self.vault_out.unwrap_or(self.held - payout);
        let mut outputs = vec![cov_out(&succ, vault_out.max(0) as u64, 0, VCOV), cov_out(&minter_out, self.minter_out_value.unwrap_or(MINTER_DUST) as u64, 2, tcov),
            out_to((payout + self.acct_value + self.note_coin.unwrap_or(self.m.note_value) - self.m.max_fee + self.owner_extra).max(0) as u64, p2pk_spk(self.pay_to.unwrap_or(self.acct_owner)))];
        if self.layout == 3 { entries.push(plain_utxo(KAS as u64, p2pk_spk(xonly(&stranger())))); inputs.push(tx_input(4, vec![])); }
        if self.layout == 4 { outputs.swap(0, 1); }
        if self.layout == 1 { let kept = compile_kcc(&redeem_hash(xonly(&stranger()), VCOV), ID_SCRIPT_HASH, self.note_shares, false); outputs.insert(2, cov_out(&kept, self.m.note_value as u64, 2, SCOV)); }
        if self.layout == 2 { outputs.push(out_to(KAS as u64, p2pk_spk(xonly(&stranger())))); }
        (new_tx(inputs, outputs, self.lock_time), entries)
    }
    pub fn run(&self) -> Result<(), (usize, kaspa_txscript_errors::TxScriptError)> {
        let (t, e) = self.build();
        if self.vault_only { execute(&t, e, 0).map_err(|x| (0, x)) } else { run_all(&t, &e) }
    }
}

fn funded() -> (Nav, i64, i64) {
    // two holders: 99.79 KAS each at the first price, vault holds their KAS + 2 KAS seed
    let s = 2 * (100 * KAS - KAS / 5 - MAX_FEE) / FIRST_PRICE;
    (Nav { shares: s, ..Nav::default() }, 2 * KAS + 2 * (100 * KAS - KAS / 5 - FEE), s / 2)
}

#[test]
fn redeem_pays_at_nav() {
    let (prev, held, mine) = funded();
    let r = Red::valid(prev, held, mine);
    ok(r.run(), "redeem half the shares");
    // a profit on a position raises what each share pays
    let mut up = Red::valid(Nav { marks: [50 * KAS, 0, 0, 0], deployed: [40 * KAS, 0, 0, 0], ..prev }, held - 40 * KAS, mine);
    ok(up.run(), "redeem at a higher NAV");
    assert!(up.correct_payout() > r.correct_payout());
    up.prev.halted = true;
    ok(up.run(), "redeem from a halted vault");
}

#[test]
fn redeem_flips() {
    let (prev, held, mine) = funded();
    let base = Red::valid(prev, held, mine);
    ok(base.run(), "baseline");
    let f = |g: &dyn Fn(&mut Red), what: &str| { let mut r = base.clone(); g(&mut r); no(r.run(), what); };
    f(&|r| r.payout = Some(r.correct_payout() + 1), "pays one sompi too much");
    f(&|r| { r.payout = Some(r.correct_payout() + KAS); r.vault_out = Some(r.held - r.correct_payout() - KAS); }, "pays more and books it");
    f(&|r| r.pay_to = Some(xonly(&stranger())), "pays a stranger");
    f(&|r| r.acct_owner = xonly(&stranger()), "a stranger's account redeems my note");
    f(&|r| r.acct_kind = 0, "a deposit account used to redeem");
    f(&|r| r.next = Some(Nav { shares: r.prev.shares, ..r.prev }), "burns nothing on the books");
    f(&|r| r.next = Some(Nav { shares: r.prev.shares - r.note_shares + 1, ..r.prev }), "books one share fewer burned");
    f(&|r| r.layout = 1, "the note is re-created instead of burned");
    f(&|r| r.layout = 2, "an extra output");
    f(&|r| r.m.maturity = 2_000, "before maturity (fixed term)");
    f(&|r| r.vault_out = Some(r.held - r.correct_payout() - KAS), "vault gives up more than the payout");
    f(&|r| r.note_minter = true, "burns a minter branch as a note");
    // payout larger than the KAS in the vault (the rest is deployed): wait for a recall
    f(&|r| { r.prev.marks = [150 * KAS, 0, 0, 0]; r.prev.deployed = [150 * KAS, 0, 0, 0]; r.held = 30 * KAS; r.note_shares = r.prev.shares; }, "pays out KAS the vault does not hold");
}

#[test]
fn last_holder_leaves_in_full() {
    let s = 50 * KAS / FIRST_PRICE;
    let prev = Nav { shares: s, ..Nav::default() };
    let r = Red::valid(prev, 50 * KAS + NavMandate::default().min_keep, s);
    ok(r.run(), "the only holder redeems everything");
    assert_eq!(r.correct_payout(), 50 * KAS - 50 * KAS * 50 / 10_000);
}

#[test]
fn fixed_term_redeems_at_maturity() {
    let (prev, held, mine) = funded();
    let mut r = Red::valid(prev, held, mine);
    r.m.maturity = 1_500;
    ok(r.run(), "redeem at maturity");
}

// ---------------------------------------------------------------------------
// allocate, recall, mark, halt (signed paths)
// ---------------------------------------------------------------------------
fn signed_run(cur: &silverscript_lang::compiler::CompiledContract<'_>, f: &str, args: impl Fn(Vec<u8>) -> Vec<Expr<'static>>, inputs_rest: Vec<(kaspa_consensus_core::tx::TransactionInput, UtxoEntry)>, vault_value: i64, outputs: Vec<TransactionOutput>, lock: u64, k: &secp256k1::Keypair) -> Result<(), (usize, kaspa_txscript_errors::TxScriptError)> {
    let mut entries = vec![cov_utxo(cur, vault_value as u64, VCOV)];
    let mut inputs = vec![tx_input(0, vec![])];
    for (i, e) in inputs_rest { inputs.push(i); entries.push(e); }
    let mut tx = new_tx(inputs, outputs, lock);
    tx.inputs[0].signature_script = decl_sigscript(cur, f, args(vec![0u8; 65]));
    let s = sign(&tx, entries.clone(), 0, k);
    tx.inputs[0].signature_script = decl_sigscript(cur, f, args(s));
    // other inputs that need the owner's key sign after the shape is fixed
    run_all(&tx, &entries)
}

#[test]
fn allocate_recall_mark_halt() {
    let m = NavMandate::default();
    let (prev, held, _) = funded();
    let nav0 = prev.nav(held);
    // allocate 40 KAS to slot 0
    let amt = 40 * KAS;
    let next = Nav { deployed: [amt, 0, 0, 0], marks: [amt, 0, 0, 0], epoch_index: 0, epoch_spent: amt, ..prev };
    let (cur, succ) = (compile_nav(&m, &prev), compile_nav(&m, &next));
    let dest = p2pk_spk(xonly(&dest_keys()[0]));
    let outs = |v: i64, to: kaspa_consensus_core::tx::ScriptPublicKey, n: &silverscript_lang::compiler::CompiledContract<'_>| vec![cov_out(n, v as u64, 0, VCOV), out_to(amt as u64, to)];
    ok(signed_run(&cur, "allocate", |s| vec![nav_state(&next), Expr::int(0), Expr::int(amt), Expr::int(1_500), Expr::bytes(s)], vec![], held, outs(held - amt - FEE, dest.clone(), &succ), 1_500, &allocator()), "allocate");
    assert_eq!(next.nav(held - amt), nav0, "allocation leaves NAV unchanged");
    no(signed_run(&cur, "allocate", |s| vec![nav_state(&next), Expr::int(0), Expr::int(amt), Expr::int(1_500), Expr::bytes(s)], vec![], held, outs(held - amt - FEE, dest.clone(), &succ), 1_500, &valuer()), "valuer allocates");
    no(signed_run(&cur, "allocate", |s| vec![nav_state(&next), Expr::int(0), Expr::int(amt), Expr::int(1_500), Expr::bytes(s)], vec![], held, outs(held - amt - FEE, p2pk_spk(xonly(&stranger())), &succ), 1_500, &allocator()), "allocate to an unapproved address");
    let skip_mark = Nav { marks: [0, 0, 0, 0], ..next };
    no(signed_run(&cur, "allocate", |s| vec![nav_state(&skip_mark), Expr::int(0), Expr::int(amt), Expr::int(1_500), Expr::bytes(s)], vec![], held, outs(held - amt - FEE, dest.clone(), &compile_nav(&m, &skip_mark)), 1_500, &allocator()), "allocate without marking the position");
    let halted = Nav { halted: true, ..prev };
    let hnext = Nav { halted: true, ..next };
    no(signed_run(&compile_nav(&m, &halted), "allocate", |s| vec![nav_state(&hnext), Expr::int(0), Expr::int(amt), Expr::int(1_500), Expr::bytes(s)], vec![], held, outs(held - amt - FEE, dest.clone(), &compile_nav(&m, &hnext)), 1_500, &allocator()), "allocate from a halted vault");
    // a deposit account cannot be pulled into an allocation or a recall
    let acct = compile_account(xonly(&user()), VCOV, 0);
    let acct_in = (tx_input(1, entry_sigscript(&acct, "enter", vec![])), plain_utxo((100 * KAS) as u64, pay_to_script_hash_script_(&acct)));
    no(signed_run(&cur, "allocate", |s| vec![nav_state(&next), Expr::int(0), Expr::int(amt), Expr::int(1_500), Expr::bytes(s)], vec![acct_in.clone()], held, outs(held - amt - FEE + 100 * KAS, dest.clone(), &succ), 1_500, &allocator()), "allocate swallows a deposit account");

    // mark: +20% on slot 0 in epoch 0 (never marked before)
    let up = Nav { marks: [amt + amt / 5, 0, 0, 0], mark_epoch: 0, ..next };
    let (cur2, succ2) = (compile_nav(&m, &next), compile_nav(&m, &up));
    let held2 = held - amt - FEE;
    ok(signed_run(&cur2, "mark", |s| vec![nav_state(&up), Expr::int(1_500), Expr::bytes(s)], vec![], held2, vec![cov_out(&succ2, (held2 - FEE) as u64, 0, VCOV)], 1_500, &valuer()), "mark +20%");
    let too = Nav { marks: [amt + amt / 5 + 1, 0, 0, 0], mark_epoch: 0, ..next };
    no(signed_run(&cur2, "mark", |s| vec![nav_state(&too), Expr::int(1_500), Expr::bytes(s)], vec![], held2, vec![cov_out(&compile_nav(&m, &too), (held2 - FEE) as u64, 0, VCOV)], 1_500, &valuer()), "mark past the step");
    no(signed_run(&cur2, "mark", |s| vec![nav_state(&up), Expr::int(1_500), Expr::bytes(s)], vec![], held2, vec![cov_out(&succ2, (held2 - FEE) as u64, 0, VCOV)], 1_500, &allocator()), "allocator marks its own position");
    let again = Nav { marks: [amt + amt / 5 + amt / 10, 0, 0, 0], mark_epoch: 0, ..up };
    no(signed_run(&succ2, "mark", |s| vec![nav_state(&again), Expr::int(1_600), Expr::bytes(s)], vec![], held2 - FEE, vec![cov_out(&compile_nav(&m, &again), (held2 - 2 * FEE) as u64, 0, VCOV)], 1_600, &valuer()), "second mark in the same epoch");
    let moved = Nav { deployed: [amt + 1, 0, 0, 0], ..up };
    no(signed_run(&cur2, "mark", |s| vec![nav_state(&moved), Expr::int(1_500), Expr::bytes(s)], vec![], held2, vec![cov_out(&compile_nav(&m, &moved), (held2 - FEE) as u64, 0, VCOV)], 1_500, &valuer()), "valuer rewrites cost");

    // recall 48 KAS (the marked value) from slot 0: cost and mark to zero, NAV unchanged
    let back = 48 * KAS;
    let rnext = Nav { deployed: [0; 4], marks: [0; 4], ..up };
    let (cur3, succ3) = (compile_nav(&m, &up), compile_nav(&m, &rnext));
    let held3 = held2 - FEE;
    let coin = (tx_input(1, vec![]), plain_utxo(back as u64, p2pk_spk(xonly(&dest_keys()[0]))));
    // the returning coin is a P2PK input: sign it too
    let run_recall = |k: &secp256k1::Keypair, n: &Nav, s3: &silverscript_lang::compiler::CompiledContract<'_>, out_v: i64| {
        let entries = vec![cov_utxo(&cur3, held3 as u64, VCOV), coin.1.clone()];
        let mut tx = new_tx(vec![tx_input(0, vec![]), coin.0.clone()], vec![cov_out(s3, out_v as u64, 0, VCOV)], 0);
        tx.inputs[0].signature_script = decl_sigscript(&cur3, "recall", vec![nav_state(n), Expr::int(0), Expr::int(back), Expr::bytes(vec![0u8; 65])]);
        tx.inputs[1].signature_script = vec![0x41; 1];
        let s0 = sign(&tx, entries.clone(), 0, k);
        let s1 = sign(&tx, entries.clone(), 1, &dest_keys()[0]);
        tx.inputs[0].signature_script = decl_sigscript(&cur3, "recall", vec![nav_state(n), Expr::int(0), Expr::int(back), Expr::bytes(s0)]);
        let mut p = vec![s1.len() as u8]; p.extend_from_slice(&s1);
        tx.inputs[1].signature_script = p;
        run_all(&tx, &entries)
    };
    ok(run_recall(&allocator(), &rnext, &succ3, held3 + back - FEE), "recall at the mark");
    assert_eq!(rnext.nav(held3 + back), up.nav(held3), "a recall at the mark keeps NAV");
    no(run_recall(&allocator(), &Nav { marks: [KAS, 0, 0, 0], ..rnext }, &compile_nav(&m, &Nav { marks: [KAS, 0, 0, 0], ..rnext }), held3 + back - FEE), "recall leaves a phantom mark");
    no(run_recall(&allocator(), &rnext, &succ3, held3 + back - 10 * KAS), "recall keeps part of the coin out");
    no(run_recall(&valuer(), &rnext, &succ3, held3 + back - FEE), "valuer recalls");

    // halt: guardian only; then recall and redeem still work (tested above), allocate does not
    let h = Nav { halted: true, ..up };
    let hs = compile_nav(&m, &h);
    ok(signed_run(&cur3, "halt", |s| vec![nav_state(&h), Expr::bytes(s)], vec![], held3, vec![cov_out(&hs, (held3 - FEE) as u64, 0, VCOV)], 0, &guardian()), "guardian halts");
    no(signed_run(&cur3, "halt", |s| vec![nav_state(&h), Expr::bytes(s)], vec![], held3, vec![cov_out(&hs, (held3 - FEE) as u64, 0, VCOV)], 0, &allocator()), "allocator halts");
    no(signed_run(&cur3, "halt", |s| vec![nav_state(&h), Expr::bytes(s)], vec![], held3, vec![cov_out(&hs, (held3 - 10 * KAS) as u64, 0, VCOV)], 0, &guardian()), "halt takes value");
    let hshares = Nav { shares: 1, ..h };
    no(signed_run(&cur3, "halt", |s| vec![nav_state(&hshares), Expr::bytes(s)], vec![], held3, vec![cov_out(&compile_nav(&m, &hshares), (held3 - FEE) as u64, 0, VCOV)], 0, &guardian()), "halt rewrites shares");
}

// ---------------------------------------------------------------------------
// init: the share token is born owned by the vault
// ---------------------------------------------------------------------------
#[test]
fn init_binds_the_share_token() {
    let m = NavMandate::default();
    let pre = Nav { share_covid: [0; 32], ..Nav::default() };
    let cur = compile_nav(&m, &pre);
    let seed = 2 * KAS;
    let outpoint = TransactionOutpoint { transaction_id: TransactionId::from_bytes([1; 32]), index: 0 };
    let (kp_, ks, _) = kcc_template();
    let try_init = |owner: [u8; 32], is_minter: bool, amount: i64, k: &secp256k1::Keypair, fake_covid: bool| {
        let token = compile_kcc(&owner, ID_COVENANT, amount, is_minter);
        let placeholder = cov_out(&token, MINTER_DUST as u64, 0, Hash::from_bytes([0; 32]));
        let covid = genesis_covid(outpoint, &placeholder, 0);
        let recorded = if fake_covid { Hash::from_bytes([7; 32]) } else { covid };
        let next = Nav { share_covid: recorded.as_bytes(), ..pre };
        let succ = compile_nav(&m, &next);
        let outputs = vec![cov_out(&token, MINTER_DUST as u64, 0, covid), cov_out(&succ, (seed - MINTER_DUST - FEE) as u64, 0, VCOV)];
        let entries = vec![cov_utxo(&cur, seed as u64, VCOV)];
        let mut tx = new_tx(vec![kaspa_consensus_core::tx::TransactionInput::new_with_compute_budget(outpoint, vec![], 0, 1000)], outputs, 0);
        let args = |s: Vec<u8>| vec![nav_state(&next), Expr::dynamic_bytes(kp_.clone()), Expr::dynamic_bytes(ks.clone()), Expr::bytes(s)];
        tx.inputs[0].signature_script = decl_sigscript(&cur, "init", args(vec![0u8; 65]));
        let s = sign(&tx, entries.clone(), 0, k);
        tx.inputs[0].signature_script = decl_sigscript(&cur, "init", args(s));
        run_all(&tx, &entries)
    };
    ok(try_init(VCOV.as_bytes(), true, 0, &guardian(), false), "init");
    no(try_init(xonly(&stranger()), true, 0, &guardian(), false), "token minter owned by someone else");
    no(try_init(VCOV.as_bytes(), true, 1_000, &guardian(), false), "token born with supply");
    no(try_init(VCOV.as_bytes(), false, 0, &guardian(), false), "token born without a minter");
    no(try_init(VCOV.as_bytes(), true, 0, &guardian(), true), "records the wrong token");
    no(try_init(VCOV.as_bytes(), true, 0, &allocator(), false), "allocator initialises");
}

// An account protects itself: pulled into any shape but a deposit (3 in, 3 out)
// or a redemption (4 in, 3 out) led by its own vault, it refuses.
#[test]
fn account_refuses_foreign_shapes() {
    let (prev, held, _) = funded();
    let m = NavMandate::default();
    let cur = compile_nav(&m, &prev);
    let acct = compile_account(xonly(&user()), VCOV, 0);
    let entries = vec![cov_utxo(&cur, held as u64, VCOV), plain_utxo((100 * KAS) as u64, pay_to_script_hash_script_(&acct))];
    let shape = |n_out: usize| {
        let mut outs = vec![cov_out(&cur, (held + 100 * KAS - FEE) as u64, 0, VCOV)];
        for _ in 1..n_out { outs.push(out_to(1_000, p2pk_spk(xonly(&stranger())))); }
        let mut tx = new_tx(vec![tx_input(0, vec![]), tx_input(1, entry_sigscript(&acct, "enter", vec![]))], outs, 0);
        tx.inputs[0].signature_script = vec![];
        execute(&tx, entries.clone(), 1)
    };
    assert!(shape(1).is_err(), "a recall-shaped spend (2 in, 1 out)");
    assert!(shape(2).is_err(), "2 in, 2 out");
    assert!(shape(3).is_err(), "2 in, 3 out");
    // led by a different covenant at input 0
    let other = cov_utxo(&cur, held as u64, Hash::from_bytes([3; 32]));
    let acct_in = plain_utxo((100 * KAS) as u64, pay_to_script_hash_script_(&acct));
    let minter = compile_kcc(&VCOV.as_bytes(), ID_COVENANT, 0, true);
    let tx = new_tx(vec![tx_input(0, vec![]), tx_input(1, entry_sigscript(&acct, "enter", vec![])), tx_input(2, vec![])],
        vec![out_to(1, p2pk_spk(xonly(&stranger()))), out_to(1, p2pk_spk(xonly(&stranger()))), out_to(1, p2pk_spk(xonly(&stranger())))], 0);
    assert!(execute(&tx, vec![other, acct_in, cov_utxo(&minter, 1, SCOV)], 1).is_err(), "another covenant leads");
    // the owner can always take it back
    let acct_e = plain_utxo((100 * KAS) as u64, pay_to_script_hash_script_(&acct));
    let mut tx = new_tx(vec![tx_input(0, vec![])], vec![out_to((100 * KAS - FEE) as u64, p2pk_spk(xonly(&user())))], 0);
    tx.inputs[0].signature_script = entry_sigscript(&acct, "reclaim", vec![Expr::bytes(vec![0u8; 65])]);
    let s = sign(&tx, vec![acct_e.clone()], 0, &user());
    tx.inputs[0].signature_script = entry_sigscript(&acct, "reclaim", vec![Expr::bytes(s)]);
    assert!(execute(&tx, vec![acct_e.clone()], 0).is_ok(), "owner reclaims");
    let s = sign(&tx, vec![acct_e.clone()], 0, &stranger());
    tx.inputs[0].signature_script = entry_sigscript(&acct, "reclaim", vec![Expr::bytes(s)]);
    assert!(execute(&tx, vec![acct_e], 0).is_err(), "a stranger reclaims");
}

// ---------------------------------------------------------------------------
// every path: the successor state is exactly what the rules say. Each field of
// the declared successor is tampered with in turn; each must be refused.
// ---------------------------------------------------------------------------
type R = Result<(), (usize, kaspa_txscript_errors::TxScriptError)>;

fn tampers(n: Nav, skip: &[&str]) -> Vec<(String, Nav)> {
    let mut v = Vec::new();
    let mut add = |name: &str, t: Nav| if !skip.contains(&name) { v.push((name.to_string(), t)); };
    add("shareCovid", Nav { share_covid: [9; 32], ..n });
    add("shares", Nav { shares: n.shares + 1, ..n });
    for i in 0..4 { let mut t = n; t.deployed[i] += 1; add(&format!("deployed{i}"), t); }
    for i in 0..4 { let mut t = n; t.marks[i] += 1; add(&format!("mark{i}"), t); }
    add("epochIndex", Nav { epoch_index: n.epoch_index + 1, ..n });
    add("epochSpent", Nav { epoch_spent: n.epoch_spent + 1, ..n });
    add("markEpoch", Nav { mark_epoch: n.mark_epoch + 1, ..n });
    add("halted", Nav { halted: !n.halted, ..n });
    v
}

fn alloc_run(m: &NavMandate, prev: Nav, next: Nav, slot: usize, amount: i64, claimed: i64, lock: u64, held: i64, k: &secp256k1::Keypair) -> R {
    let (cur, succ) = (compile_nav(m, &prev), compile_nav(m, &next));
    let to = p2pk_spk(xonly(&dest_keys()[slot]));
    signed_run(&cur, "allocate", |s| vec![nav_state(&next), Expr::int(slot as i64), Expr::int(amount), Expr::int(claimed), Expr::bytes(s)], vec![], held,
        vec![cov_out(&succ, (held - amount - FEE) as u64, 0, VCOV), out_to(amount as u64, to)], lock, k)
}
fn alloc_next(m: &NavMandate, prev: Nav, slot: usize, amount: i64, claimed: i64) -> Nav {
    let e = (claimed - m.not_before) / m.epoch_length;
    let spent = if e == prev.epoch_index { prev.epoch_spent } else { 0 };
    let mut n = prev; n.deployed[slot] += amount; n.marks[slot] += amount; n.epoch_index = e; n.epoch_spent = spent + amount; n
}
fn recall_run(m: &NavMandate, prev: Nav, next: Nav, slot: usize, back: i64, held: i64, out_v: i64) -> R {
    let (cur, succ) = (compile_nav(m, &prev), compile_nav(m, &next));
    let coin = plain_utxo(back as u64, p2pk_spk(xonly(&dest_keys()[slot])));
    let entries = vec![cov_utxo(&cur, held as u64, VCOV), coin];
    let mut tx = new_tx(vec![tx_input(0, vec![]), tx_input(1, vec![])], vec![cov_out(&succ, out_v as u64, 0, VCOV)], 0);
    tx.inputs[0].signature_script = decl_sigscript(&cur, "recall", vec![nav_state(&next), Expr::int(slot as i64), Expr::int(back), Expr::bytes(vec![0u8; 65])]);
    let s0 = sign(&tx, entries.clone(), 0, &allocator());
    let s1 = sign(&tx, entries.clone(), 1, &dest_keys()[slot]);
    tx.inputs[0].signature_script = decl_sigscript(&cur, "recall", vec![nav_state(&next), Expr::int(slot as i64), Expr::int(back), Expr::bytes(s0)]);
    let mut p = vec![s1.len() as u8]; p.extend_from_slice(&s1);
    tx.inputs[1].signature_script = p;
    run_all(&tx, &entries)
}
fn mark_run(m: &NavMandate, prev: Nav, next: Nav, claimed: i64, lock: u64, held: i64, k: &secp256k1::Keypair) -> R {
    let (cur, succ) = (compile_nav(m, &prev), compile_nav(m, &next));
    signed_run(&cur, "mark", |s| vec![nav_state(&next), Expr::int(claimed), Expr::bytes(s)], vec![], held, vec![cov_out(&succ, (held - FEE) as u64, 0, VCOV)], lock, k)
}
fn halt_run(m: &NavMandate, prev: Nav, next: Nav, held: i64) -> R {
    let (cur, succ) = (compile_nav(m, &prev), compile_nav(m, &next));
    signed_run(&cur, "halt", |s| vec![nav_state(&next), Expr::bytes(s)], vec![], held, vec![cov_out(&succ, (held - FEE) as u64, 0, VCOV)], 0, &guardian())
}

/// A funded vault with capital out in two slots, marked once.
fn working() -> (Nav, i64) {
    let (p, held, _) = funded();
    (Nav { deployed: [40 * KAS, 20 * KAS, 0, 0], marks: [44 * KAS, 19 * KAS, 0, 0], epoch_index: 0, epoch_spent: 60 * KAS, mark_epoch: 0, ..p }, held - 60 * KAS)
}

#[test]
fn successor_state_is_exact_on_every_path() {
    let m = NavMandate::default();
    let (prev, held) = working();
    // allocate, slot 2, next epoch
    let n = alloc_next(&m, prev, 2, 10 * KAS, 2_500);
    ok(alloc_run(&m, prev, n, 2, 10 * KAS, 2_500, 2_500, held, &allocator()), "allocate baseline");
    for (f, t) in tampers(n, &[]) { no(alloc_run(&m, prev, t, 2, 10 * KAS, 2_500, 2_500, held, &allocator()), &format!("allocate tampers {f}")); }
    // recall, slot 1, a loss (back below the mark)
    let mut n = prev; n.deployed[1] = 5 * KAS; n.marks[1] = 4 * KAS;
    ok(recall_run(&m, prev, n, 1, 15 * KAS, held, held + 15 * KAS - FEE), "recall baseline");
    for (f, t) in tampers(n, &[]) { no(recall_run(&m, prev, t, 1, 15 * KAS, held, held + 15 * KAS - FEE), &format!("recall tampers {f}")); }
    // mark, next epoch: only the marks may move
    let mut n = prev; n.marks = [48 * KAS, 17 * KAS, 0, 0]; n.mark_epoch = 1;
    ok(mark_run(&m, prev, n, 2_500, 2_500, held, &valuer()), "mark baseline");
    for (f, t) in tampers(n, &["mark0", "mark1"]) { no(mark_run(&m, prev, t, 2_500, 2_500, held, &valuer()), &format!("mark tampers {f}")); }
    // halt
    let n = Nav { halted: true, ..prev };
    ok(halt_run(&m, prev, n, held), "halt baseline");
    for (f, t) in tampers(n, &["halted"]) { no(halt_run(&m, prev, t, held), &format!("halt tampers {f}")); }
    no(halt_run(&m, prev, prev, held), "halt that does not halt");
    // deposit and redeem
    let d = Dep::valid(prev, held);
    ok(d.run(), "deposit baseline");
    for (f, t) in tampers(d.correct_next(), &[]) { let mut x = d.clone(); x.next = Some(t); no(x.run(), &format!("deposit tampers {f}")); }
    let r = Red::valid(prev, held, prev.shares / 4);
    ok(r.run(), "redeem baseline");
    for (f, t) in tampers(r.correct_next(), &[]) { let mut x = r.clone(); x.next = Some(t); no(x.run(), &format!("redeem tampers {f}")); }
}

#[test]
fn epoch_claims_are_proven() {
    let m = NavMandate::default();
    let (prev, held) = working();
    let n = alloc_next(&m, prev, 2, 10 * KAS, 2_500);
    no(alloc_run(&m, prev, n, 2, 10 * KAS, 2_500, 2_000, held, &allocator()), "allocate claims a DAA the chain has not reached");
    let early = alloc_next(&m, prev, 2, 10 * KAS, 900);
    no(alloc_run(&m, prev, early, 2, 10 * KAS, 900, 900, held, &allocator()), "allocate claims a DAA before the mandate starts");
    let back = Nav { epoch_index: 3, epoch_spent: 100 * KAS, ..prev };
    let n = alloc_next(&m, back, 2, 10 * KAS, 2_500); // epoch 1 < 3: a fresh allowance by going back in time
    no(alloc_run(&m, back, n, 2, 10 * KAS, 2_500, 2_500, held, &allocator()), "allocate claims an earlier epoch");
    let over = Nav { epoch_spent: 480 * KAS, ..prev };
    let n = alloc_next(&m, over, 2, 30 * KAS, 1_500);
    no(alloc_run(&m, over, n, 2, 30 * KAS, 1_500, 1_500, held, &allocator()), "allocate past the epoch limit");
    let mut mk = prev; mk.marks = [48 * KAS, 17 * KAS, 0, 0]; mk.mark_epoch = 1;
    no(mark_run(&m, prev, mk, 2_500, 2_000, held, &valuer()), "mark claims a DAA the chain has not reached");
    let mut mk0 = prev; mk0.marks = [48 * KAS, 17 * KAS, 0, 0]; mk0.mark_epoch = 0;
    no(mark_run(&m, prev, mk0, 1_500, 1_500, held, &valuer()), "second mark in epoch 0");
    let mut mk2 = prev; mk2.marks = [48 * KAS, 17 * KAS, 0, 0]; mk2.mark_epoch = 0;
    no(mark_run(&m, Nav { mark_epoch: 2, ..prev }, mk2, 1_500, 1_500, held, &valuer()), "mark claims an earlier epoch");
    let mut mk3 = prev; mk3.marks = [48 * KAS, 17 * KAS, 0, 0]; mk3.mark_epoch = 1;
    no(mark_run(&m, prev, mk3, 900, 900, held, &valuer()), "mark before the mandate starts");
}

/// A state no rule could have produced (out of range) is never acted on.
#[test]
fn out_of_range_state_is_refused() {
    let m = NavMandate::default();
    let (prev, held) = working();
    let big = 100_000_000_000_000 + 1;
    let mut bad: Vec<(String, Nav)> = vec![("shares<0".into(), Nav { shares: -1, ..prev }), ("shares>max".into(), Nav { shares: big, ..prev })];
    for i in 0..4 {
        let mut t = prev; t.deployed[i] = -1; bad.push((format!("deployed{i}<0"), t));
        let mut t = prev; t.deployed[i] = big; bad.push((format!("deployed{i}>max"), t));
        let mut t = prev; t.marks[i] = -1; bad.push((format!("mark{i}<0"), t));
        let mut t = prev; t.marks[i] = big; bad.push((format!("mark{i}>max"), t));
    }
    for (f, p) in bad {
        let d = Dep::valid(p, held);
        no(d.run(), &format!("deposit from {f}"));
        let r = Red::valid(p, held, 1_000);
        no(r.run(), &format!("redeem from {f}"));
        let n = alloc_next(&m, p, 2, 10 * KAS, 2_500);
        no(alloc_run(&m, p, n, 2, 10 * KAS, 2_500, 2_500, held, &allocator()), &format!("allocate from {f}"));
        let mut n = p; n.mark_epoch = 1;
        no(mark_run(&m, p, n, 2_500, 2_500, held, &valuer()), &format!("mark from {f}"));
        let mut n = p; n.deployed[2] = 0; n.marks[2] = 0;
        no(recall_run(&m, p, n, 2, 5 * KAS, held, held + 5 * KAS - FEE), &format!("recall from {f}"));
    }
}

// ---------------------------------------------------------------------------
// compute, at the real signature price: what deploy/src/nav.rs must commit
// ---------------------------------------------------------------------------
fn units_all(tx: &Transaction, entries: &[UtxoEntry]) -> Vec<u64> {
    use kaspa_consensus_core::hashing::sighash::SigHashReusedValuesUnsync;
    use kaspa_consensus_core::tx::{PopulatedTransaction, VerifiableTransaction};
    use kaspa_txscript::{caches::Cache, covenants::CovenantsContext, EngineCtx, EngineFlags, TxScriptEngine};
    let reused = SigHashReusedValuesUnsync::new();
    let cache = Cache::new(100);
    let p = PopulatedTransaction::new(tx, entries.to_vec());
    let cov = CovenantsContext::from_tx(&p).expect("cov ctx");
    (0..tx.inputs.len()).map(|i| {
        let input = tx.inputs[i].clone();
        let mut vm = TxScriptEngine::from_transaction_input(&p, &input, i, p.utxo(i).unwrap(), EngineCtx::new(&cache).with_reused(&reused).with_covenants_ctx(&cov), EngineFlags { covenants_enabled: true, ..Default::default() });
        vm.execute().expect("valid path");
        vm.used_script_units().0
    }).collect()
}

#[test]
fn budget_report() {
    let (prev, held) = working();
    let d = Dep::valid(prev, held);
    let (t, e) = d.build();
    let r = Red::valid(prev, held, prev.shares / 4);
    let (t2, e2) = r.build();
    let dep = units_all(&t, &e);
    let red = units_all(&t2, &e2);
    println!("deposit units per input {dep:?}  sigscript bytes {:?}", t.inputs.iter().map(|i| i.signature_script.len()).collect::<Vec<_>>());
    println!("redeem  units per input {red:?}  sigscript bytes {:?}", t2.inputs.iter().map(|i| i.signature_script.len()).collect::<Vec<_>>());
    // signed paths: allocate carries one checksig (100k units at the real price)
    for (name, u) in [("deposit.vault", dep[0]), ("deposit.account", dep[1]), ("deposit.kcc", dep[2]), ("redeem.vault", red[0]), ("redeem.account", red[1]), ("redeem.kcc", red[2]), ("redeem.note", red[3])] {
        println!("{name:<16} {u:>9} units → budget {}", u.div_ceil(10_000));
    }
}

// ---------------------------------------------------------------------------
// Each contract defends itself. These flips run the VAULT INPUT ALONE (or
// target a guard no other contract in the transaction shares), so a refusal
// is the vault's own. Written against the mutation check's survivors.
// ---------------------------------------------------------------------------
fn vo(mut d: Dep) -> Dep { d.vault_only = true; d }
fn vr(mut r: Red) -> Red { r.vault_only = true; r }

#[test]
fn deposit_vault_guards_alone() {
    let (prev, held) = working();
    let base = vo(Dep::valid(prev, held));
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
    f(&|d| d.token_cov = Some(Hash::from_bytes([8; 32])), "another token's branch");
    f(&|d| { d.paid = 100_000_000_000_000 + 1; }, "an account coin above the 1M KAS bound");
    f(&|d| { d.held = 100_000_000_000_000 + 1; }, "a vault above the 1M KAS bound");
    // a deposit worth less than one share at a high price
    f(&|d| { d.prev = Nav { marks: [500_000 * KAS, 0, 0, 0], deployed: [500_000 * KAS, 0, 0, 0], shares: 10, ..d.prev }; d.paid = 6 * KAS; d.m.min_deposit = KAS; }, "mints zero shares");
    // held below the seed while marks keep NAV positive
    f(&|d| { d.held = KAS / 10; d.prev = Nav { marks: [200 * KAS, 0, 0, 0], deployed: [200 * KAS, 0, 0, 0], ..d.prev }; }, "vault below its own seed");
}

#[test]
fn redeem_vault_guards_alone() {
    let (prev, held) = working();
    let base = vr(Red::valid(prev, held, prev.shares / 4));
    ok(base.run(), "vault alone accepts the baseline");
    let f = |g: &dyn Fn(&mut Red), what: &str| { let mut r = base.clone(); g(&mut r); no(r.run(), what); };
    f(&|r| r.layout = 3, "an extra input");
    f(&|r| r.layout = 2, "an extra output");
    f(&|r| r.layout = 4, "continuation not at output 0");
    f(&|r| r.lock_time = 1_000, "claims a DAA the chain has not reached");
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
    f(&|r| { r.note_shares = r.prev.shares + 1; }, "burns more than the supply");
    f(&|r| r.owner_extra = 1, "pays the owner one sompi more");
    f(&|r| r.acct_value = 100_000_000_000_000 + 1, "an account coin above the bound");
    f(&|r| r.held = 100_000_000_000_000 + 1, "a vault above the bound");
    f(&|r| { r.prev.marks = [150 * KAS, 0, 0, 0]; r.prev.deployed = [150 * KAS, 0, 0, 0]; r.held = 30 * KAS; r.note_shares = r.prev.shares; r.vault_out = Some(0); }, "pays out KAS the vault does not hold");
    f(&|r| r.m.exit_fee_bps = 20_000, "an exit fee over 100% (bad parameter)");
    f(&|r| r.m.exit_fee_bps = -100, "a negative exit fee (bad parameter)");
}

// allocate / recall / mark / halt / init: general builders
#[derive(Clone)]
struct AT { m: NavMandate, prev: Nav, next: Option<Nav>, slot: i64, pay_slot: usize, amount: i64, pay: Option<i64>, claimed: i64, lock: u64, held: i64, extra_in: bool, extra_out: bool, swap: bool, keep: Option<i64> }
impl AT {
    fn valid() -> AT { let (prev, held) = working(); AT { m: NavMandate::default(), prev, next: None, slot: 2, pay_slot: 2, amount: 10 * KAS, pay: None, claimed: 2_500, lock: 2_500, held, extra_in: false, extra_out: false, swap: false, keep: None } }
    fn run(&self) -> R {
        let s = self.slot.clamp(0, 3) as usize;
        let next = self.next.unwrap_or_else(|| alloc_next(&self.m, self.prev, s, self.amount, self.claimed));
        let (cur, succ) = (compile_nav(&self.m, &self.prev), compile_nav(&self.m, &next));
        let mut outs = vec![cov_out(&succ, self.keep.unwrap_or(self.held - self.amount - FEE) as u64, 0, VCOV), out_to(self.pay.unwrap_or(self.amount) as u64, p2pk_spk(xonly(&dest_keys()[self.pay_slot])))];
        if self.extra_out { outs.push(out_to(KAS as u64, p2pk_spk(xonly(&stranger())))); }
        if self.swap { outs.swap(0, 1); }
        let rest = if self.extra_in { vec![(tx_input(1, vec![]), plain_utxo(KAS as u64, p2pk_spk(xonly(&stranger()))))] } else { vec![] };
        let entries_n = if self.extra_in { 2 } else { 1 };
        let mut entries = vec![cov_utxo(&cur, self.held as u64, VCOV)];
        let mut inputs = vec![tx_input(0, vec![])];
        for (i, e) in rest { inputs.push(i); entries.push(e); }
        let mut tx = new_tx(inputs, outs, self.lock);
        let args = |sg: Vec<u8>| vec![nav_state(&next), Expr::int(self.slot), Expr::int(self.amount), Expr::int(self.claimed), Expr::bytes(sg)];
        tx.inputs[0].signature_script = decl_sigscript(&cur, "allocate", args(vec![0u8; 65]));
        let sg = sign(&tx, entries.clone(), 0, &allocator());
        tx.inputs[0].signature_script = decl_sigscript(&cur, "allocate", args(sg));
        let _ = entries_n;
        execute(&tx, entries, 0).map_err(|e| (0, e))
    }
}

#[test]
fn allocate_guards() {
    let base = AT::valid();
    ok(base.run(), "baseline");
    let f = |g: &dyn Fn(&mut AT), what: &str| { let mut a = base.clone(); g(&mut a); no(a.run(), what); };
    f(&|a| a.extra_in = true, "an extra input");
    f(&|a| a.extra_out = true, "an extra output");
    f(&|a| a.swap = true, "continuation not at output 0");
    f(&|a| { a.slot = -1; a.next = Some(alloc_next(&a.m, a.prev, 0, a.amount, a.claimed)); a.pay_slot = 0; }, "slot below 0");
    f(&|a| { a.slot = 4; a.next = Some(alloc_next(&a.m, a.prev, 3, a.amount, a.claimed)); a.pay_slot = 3; }, "slot above 3");
    f(&|a| { a.amount = 0; }, "zero amount");
    f(&|a| { a.amount = -KAS; a.pay = Some(0); }, "negative amount");
    f(&|a| { a.amount = 301 * KAS; }, "more than the per-move limit");
    f(&|a| { a.m.max_per_move = i64::MAX / 2; a.m.epoch_limit = i64::MAX / 2; a.amount = 100_000_000_000_000 + 1; a.held = 100_000_000_000_000 + 2 * KAS; }, "an amount above the 1M KAS bound");
    f(&|a| { a.held = 100_000_000_000_000 + 1; }, "a vault above the bound");
    f(&|a| { a.m.reserve_floor_bps = 0; a.m.caps = [10_000; 4]; a.m.max_per_move = 1_000 * KAS; a.m.epoch_limit = 1_000 * KAS; a.amount = a.held + KAS; a.keep = Some(0); }, "more than the vault holds");
    f(&|a| a.pay = Some(a.amount + KAS), "the destination is paid more than booked");
    f(&|a| { a.amount = 290 * KAS; a.m.caps[2] = 3_000; a.m.reserve_floor_bps = 0; }, "past the destination's cap");
    f(&|a| { a.m.caps[2] = 9_000; a.m.reserve_floor_bps = 9_500; }, "below the reserve floor");
    f(&|a| { a.m.caps[2] = 20_000; a.m.reserve_floor_bps = 0; a.m.max_per_move = 1_000 * KAS; a.m.epoch_limit = 1_000 * KAS; a.amount = 250 * KAS; }, "a cap above 100% (bad parameter)");
    f(&|a| { a.m.reserve_floor_bps = -5_000; a.m.caps[2] = 9_000; a.amount = 250 * KAS; }, "a negative reserve floor (bad parameter)");
    f(&|a| a.keep = Some(a.held - a.amount - 10 * KAS), "the vault keeps less than it should");
}

fn recall_with(m: &NavMandate, prev: Nav, next: Nav, slot: i64, back: i64, held: i64, out_v: i64, extra_in: bool, extra_out: bool, swap: bool) -> R {
    let (cur, succ) = (compile_nav(m, &prev), compile_nav(m, &next));
    let coin = plain_utxo(back.max(1) as u64, p2pk_spk(xonly(&dest_keys()[slot.clamp(0, 3) as usize])));
    let mut entries = vec![cov_utxo(&cur, held as u64, VCOV), coin];
    let mut inputs = vec![tx_input(0, vec![]), tx_input(1, vec![])];
    if extra_in { entries.push(plain_utxo(KAS as u64, p2pk_spk(xonly(&stranger())))); inputs.push(tx_input(2, vec![])); }
    let mut outs = vec![cov_out(&succ, out_v as u64, 0, VCOV)];
    if extra_out { outs.push(out_to(1, p2pk_spk(xonly(&stranger())))); outs.push(out_to(1, p2pk_spk(xonly(&stranger())))); }
    if swap { outs.insert(0, out_to(1, p2pk_spk(xonly(&stranger())))); }
    let mut tx = new_tx(inputs, outs, 0);
    let args = |sg: Vec<u8>| vec![nav_state(&next), Expr::int(slot), Expr::int(back), Expr::bytes(sg)];
    tx.inputs[0].signature_script = decl_sigscript(&cur, "recall", args(vec![0u8; 65]));
    let s0 = sign(&tx, entries.clone(), 0, &allocator());
    tx.inputs[0].signature_script = decl_sigscript(&cur, "recall", args(s0));
    execute(&tx, entries, 0).map_err(|e| (0, e))
}

#[test]
fn recall_guards() {
    let m = NavMandate::default();
    let (prev, held) = working();
    let mut n = prev; n.deployed[1] = 5 * KAS; n.marks[1] = 4 * KAS;
    ok(recall_with(&m, prev, n, 1, 15 * KAS, held, held + 15 * KAS - FEE, false, false, false), "baseline");
    no(recall_with(&m, prev, n, 1, 15 * KAS, held, held + 15 * KAS - FEE, true, false, false), "an extra input");
    no(recall_with(&m, prev, n, 1, 15 * KAS, held, held + 15 * KAS - FEE, false, true, false), "extra outputs");
    no(recall_with(&m, prev, n, 1, 15 * KAS, held, held + 15 * KAS - FEE, false, false, true), "continuation not at output 0");
    no(recall_with(&m, prev, prev, -1, 15 * KAS, held, held + 15 * KAS - FEE, false, false, false), "slot below 0 (books nothing)");
    no(recall_with(&m, prev, prev, 4, 15 * KAS, held, held + 15 * KAS - FEE, false, false, false), "slot above 3 (books nothing)");
    no(recall_with(&m, prev, prev, 1, 0, held, held - FEE, false, false, false), "zero amount");
    let mut big = prev; big.deployed[1] = 0; big.marks[1] = 0;
    no(recall_with(&m, prev, big, 1, 100_000_000_000_000 + 1, held, held + KAS, false, false, false), "an amount above the bound (claims a huge return)");
    no(recall_with(&m, prev, n, 1, 15 * KAS, 100_000_000_000_000 + 1, 100_000_000_000_000 + 15 * KAS, false, false, false), "a vault above the bound");
}

fn mark_with(m: &NavMandate, prev: Nav, next: Nav, held: i64, out_v: i64, extra_in: bool, extra_out: bool, swap: bool) -> R {
    let (cur, succ) = (compile_nav(m, &prev), compile_nav(m, &next));
    let mut entries = vec![cov_utxo(&cur, held as u64, VCOV)];
    let mut inputs = vec![tx_input(0, vec![])];
    if extra_in { entries.push(plain_utxo(KAS as u64, p2pk_spk(xonly(&stranger())))); inputs.push(tx_input(1, vec![])); }
    let mut outs = vec![cov_out(&succ, out_v as u64, 0, VCOV)];
    if extra_out || swap { outs.push(out_to(1, p2pk_spk(xonly(&stranger())))); }
    if swap { outs.swap(0, 1); }
    let mut tx = new_tx(inputs, outs, 2_500);
    let args = |sg: Vec<u8>| vec![nav_state(&next), Expr::int(2_500), Expr::bytes(sg)];
    tx.inputs[0].signature_script = decl_sigscript(&cur, "mark", args(vec![0u8; 65]));
    let s0 = sign(&tx, entries.clone(), 0, &valuer());
    tx.inputs[0].signature_script = decl_sigscript(&cur, "mark", args(s0));
    execute(&tx, entries, 0).map_err(|e| (0, e))
}

#[test]
fn mark_guards() {
    let m = NavMandate::default();
    let (prev, held) = working();
    let mut n = prev; n.marks = [48 * KAS, 17 * KAS, 0, 0]; n.mark_epoch = 1;
    ok(mark_with(&m, prev, n, held, held - FEE, false, false, false), "baseline");
    no(mark_with(&m, prev, n, held, held - FEE, true, false, false), "an extra input");
    no(mark_with(&m, prev, n, held, held - FEE, false, true, false), "an extra output");
    no(mark_with(&m, prev, n, held, held - FEE, false, false, true), "continuation not at output 0");
    no(mark_with(&m, prev, n, held, held - 10 * KAS, false, false, false), "a mark that takes value");
    let mut s1 = n; s1.marks[1] = 19 * KAS + 4 * KAS + 1; // step base = max(mark 19, cost 20) → 4 KAS
    no(mark_with(&m, prev, s1, held, held - FEE, false, false, false), "slot 1 past the step");
    let mut wild = m.clone(); wild.max_mark_step_bps = 20_000;
    let mut w = n; w.marks[0] = 44 * KAS * 5 / 2; // +150%: the covenant must not honour a step above 100%
    no(mark_with(&wild, prev, w, held, held - FEE, false, false, false), "a step above 100% (bad parameter)");
    let mut neg = m.clone(); neg.max_mark_step_bps = -1;
    no(mark_with(&neg, prev, n, held, held - FEE, false, false, false), "a negative step (bad parameter)");
}

#[test]
fn halt_guards() {
    let m = NavMandate::default();
    let (prev, held) = working();
    let n = Nav { halted: true, ..prev };
    let (cur, succ) = (compile_nav(&m, &prev), compile_nav(&m, &n));
    let run = |extra_in: bool, extra_out: bool, swap: bool| {
        let mut entries = vec![cov_utxo(&cur, held as u64, VCOV)];
        let mut inputs = vec![tx_input(0, vec![])];
        if extra_in { entries.push(plain_utxo(KAS as u64, p2pk_spk(xonly(&stranger())))); inputs.push(tx_input(1, vec![])); }
        let mut outs = vec![cov_out(&succ, (held - FEE) as u64, 0, VCOV)];
        if extra_out || swap { outs.push(out_to(1, p2pk_spk(xonly(&stranger())))); }
        if swap { outs.swap(0, 1); }
        let mut tx = new_tx(inputs, outs, 0);
        tx.inputs[0].signature_script = decl_sigscript(&cur, "halt", vec![nav_state(&n), Expr::bytes(vec![0u8; 65])]);
        let s0 = sign(&tx, entries.clone(), 0, &guardian());
        tx.inputs[0].signature_script = decl_sigscript(&cur, "halt", vec![nav_state(&n), Expr::bytes(s0)]);
        execute(&tx, entries, 0).map_err(|e| (0, e))
    };
    ok(run(false, false, false), "baseline");
    no(run(true, false, false), "an extra input");
    no(run(false, true, false), "an extra output");
    no(run(false, false, true), "continuation not at output 0");
}

#[test]
fn init_guards() {
    let m = NavMandate::default();
    let (kp_, ks, _) = kcc_template();
    let outpoint = TransactionOutpoint { transaction_id: TransactionId::from_bytes([1; 32]), index: 0 };
    let seed = 3 * KAS;
    let token = compile_kcc(&VCOV.as_bytes(), ID_COVENANT, 0, true);
    let placeholder = cov_out(&token, MINTER_DUST as u64, 0, Hash::from_bytes([0; 32]));
    let sc = genesis_covid(outpoint, &placeholder, 0);
    let pre = Nav { share_covid: [0; 32], ..Nav::default() };
    let good = Nav { share_covid: sc.as_bytes(), ..pre };
    let run = |prev: Nav, next: Nav, extra_in: bool, extra_out: bool, swap: bool, keep: i64| {
        let (cur, succ) = (compile_nav(&m, &prev), compile_nav(&m, &next));
        let mut entries = vec![cov_utxo(&cur, seed as u64, VCOV)];
        let mut inputs = vec![kaspa_consensus_core::tx::TransactionInput::new_with_compute_budget(outpoint, vec![], 0, 1000)];
        if extra_in { entries.push(plain_utxo(KAS as u64, p2pk_spk(xonly(&stranger())))); inputs.push(tx_input(1, vec![])); }
        let mut outs = vec![cov_out(&token, MINTER_DUST as u64, 0, sc), cov_out(&succ, keep as u64, 0, VCOV)];
        if extra_out { outs.push(out_to(1, p2pk_spk(xonly(&stranger())))); }
        if swap { outs.swap(0, 1); }
        let mut tx = new_tx(inputs, outs, 0);
        let args = |sg: Vec<u8>| vec![nav_state(&next), Expr::dynamic_bytes(kp_.clone()), Expr::dynamic_bytes(ks.clone()), Expr::bytes(sg)];
        tx.inputs[0].signature_script = decl_sigscript(&cur, "init", args(vec![0u8; 65]));
        let s0 = sign(&tx, entries.clone(), 0, &guardian());
        tx.inputs[0].signature_script = decl_sigscript(&cur, "init", args(s0));
        execute(&tx, entries, 0).map_err(|e| (0, e))
    };
    let keep = seed - MINTER_DUST - FEE;
    ok(run(pre, good, false, false, false, keep), "baseline");
    no(run(pre, good, true, false, false, keep), "an extra input");
    no(run(pre, good, false, true, false, keep), "an extra output");
    no(run(pre, good, false, false, true, keep), "token and vault swapped");
    no(run(pre, good, false, false, false, keep - 10_000_000), "the vault keeps less than it should");
    no(run(Nav { share_covid: [5; 32], ..pre }, Nav { share_covid: sc.as_bytes(), ..pre }, false, false, false, keep), "a second token for a vault that has one");
    no(run(Nav { shares: 7, ..pre }, Nav { shares: 7, ..good }, false, false, false, keep), "init with shares outstanding (kept)");
    no(run(Nav { shares: 7, ..pre }, good, false, false, false, keep), "init with shares outstanding (zeroed)");
    for (f, t) in tampers(good, &["shareCovid"]) { no(run(pre, t, false, false, false, keep), &format!("init tampers {f}")); }
}

// written against the second mutation pass: each flip isolates one guard
#[test]
fn isolated_guards() {
    let (prev, held) = working();
    // allocate: a slot outside 0..3 books nothing while money leaves
    for bad in [-1i64, 4] {
        let mut a = AT::valid();
        a.slot = bad; a.pay_slot = 0;
        let e = (a.claimed - a.m.not_before) / a.m.epoch_length;
        a.next = Some(Nav { epoch_index: e, epoch_spent: a.amount, ..a.prev });
        no(a.run(), &format!("allocate to slot {bad}, booked nowhere"));
    }
    // per-move limit alone
    let mut a = AT::valid(); a.m.max_per_move = 30 * KAS; a.m.caps[2] = 5_000; a.amount = 50 * KAS;
    no(a.run(), "allocate past the per-move limit");
    let mut a2 = a.clone(); a2.m.max_per_move = 60 * KAS; ok(a2.run(), "the same move under a larger per-move limit");
    // the cap alone
    let mut a = AT::valid(); a.amount = 45 * KAS;
    no(a.run(), "allocate past the cap (20% of NAV)");
    let mut a2 = a.clone(); a2.m.caps[2] = 3_000; ok(a2.run(), "the same move under a 30% cap");
    // a cap above 100% must not be honoured: cost exposure above NAV
    let mut a = AT::valid(); a.m.caps[2] = 20_000; a.prev.deployed[2] = 150 * KAS; a.prev.marks[2] = 0;
    no(a.run(), "a cap above 100% (bad parameter)");
    // a negative epochSpent must not widen the allowance
    let mut a = AT::valid(); a.m.epoch_limit = 100 * KAS; a.m.max_per_move = 1_000 * KAS; a.m.caps[2] = 9_000; a.m.reserve_floor_bps = 0;
    a.claimed = 1_500; a.lock = 1_500; a.prev.epoch_index = 0; a.prev.epoch_spent = -500 * KAS; a.amount = 120 * KAS;
    no(a.run(), "a negative epochSpent widens the allowance");
    // recall: the continuation must be output 0
    let m = NavMandate::default();
    let mut n = prev; n.deployed[1] = 5 * KAS; n.marks[1] = 4 * KAS;
    {
        let (cur, succ) = (compile_nav(&m, &prev), compile_nav(&m, &n));
        let entries = vec![cov_utxo(&cur, held as u64, VCOV), plain_utxo((15 * KAS) as u64, p2pk_spk(xonly(&dest_keys()[1])))];
        let outs = vec![out_to((held + 15 * KAS - FEE) as u64, p2pk_spk(xonly(&allocator()))), cov_out(&succ, 1_000, 0, VCOV)];
        let mut tx = new_tx(vec![tx_input(0, vec![]), tx_input(1, vec![])], outs, 0);
        let args = |sg: Vec<u8>| vec![nav_state(&n), Expr::int(1), Expr::int(15 * KAS), Expr::bytes(sg)];
        tx.inputs[0].signature_script = decl_sigscript(&cur, "recall", args(vec![0u8; 65]));
        let s0 = sign(&tx, entries.clone(), 0, &allocator());
        tx.inputs[0].signature_script = decl_sigscript(&cur, "recall", args(s0));
        no(execute(&tx, entries, 0).map_err(|e| (0, e)), "recall pays the vault's value out at output 0 and keeps dust in the vault");
    }
    // recall: a claimed return above the 1M KAS bound
    let big = 100_000_000_000_000 + KAS;
    let mut z = prev; z.deployed[1] = 0; z.marks[1] = 0;
    no(recall_with(&m, prev, z, 1, big, held, held + big - FEE, false, false, false), "recall of an amount above the bound");
    // mark: a negative step is refused even when nothing moves
    let flat = Nav { deployed: [0; 4], marks: [0; 4], ..prev };
    let mut neg = m.clone(); neg.max_mark_step_bps = -1;
    let fnext = Nav { mark_epoch: 1, ..flat };
    ok(mark_with(&m, flat, fnext, held, held - FEE, false, false, false), "an empty mark");
    no(mark_with(&neg, flat, fnext, held, held - FEE, false, false, false), "an empty mark under a negative step (bad parameter)");
    // redeem: an exit fee above 100% (small note so the payout stays representable)
    let mut r = vr(Red::valid(prev, held, 100)); r.m.exit_fee_bps = 10_001;
    no(r.run(), "an exit fee above 100% (bad parameter)");
    let mut r2 = r.clone(); r2.m.exit_fee_bps = 10_000; ok(r2.run(), "an exit fee of exactly 100% (edge)");
    // redeem: a note coin above the bound
    let mut r = vr(Red::valid(prev, held, prev.shares / 4)); r.note_coin = Some(100_000_000_000_000 + 1);
    no(r.run(), "a note coin above the bound");
}

// A closed position (cost fully returned above its mark... or below) can be
// marked down at once, never up; an open one keeps the step.
#[test]
fn closed_position_mark() {
    let m = NavMandate::default();
    let (prev, held) = working();
    let closed = Nav { deployed: [0, 20 * KAS, 0, 0], marks: [5 * KAS, 19 * KAS, 0, 0], ..prev }; // slot 0 fully returned, 5 KAS of mark left over
    let down = Nav { marks: [0, 19 * KAS, 0, 0], mark_epoch: 1, ..closed };
    ok(mark_with(&m, closed, down, held, held - FEE, false, false, false), "a closed position marked to zero at once");
    let up = Nav { marks: [7 * KAS, 19 * KAS, 0, 0], mark_epoch: 1, ..closed };
    no(mark_with(&m, closed, up, held, held - FEE, false, false, false), "a closed position marked up past the step");
    let open_down = Nav { marks: [5 * KAS, 0, 0, 0], mark_epoch: 1, ..closed };
    no(mark_with(&m, closed, open_down, held, held - FEE, false, false, false), "an open position marked to zero at once");
}
