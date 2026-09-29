//! Credit vault (credit/dawns_credit.sil) — harness helpers.
//!
//! The vault, its share token and personal accounts are the NAV vault's (same
//! templates); loans go out to registered borrowers and come back through a
//! repayment account (credit/dawns_repay.sil).

use crate::nav::*;
use crate::*;
use kaspa_consensus_core::tx::ScriptPublicKey;
use kaspa_consensus_core::Hash;
use kaspa_txscript::pay_to_script_hash_script;
use silverscript_lang::ast::Expr;
use silverscript_lang::compiler::{compile_contract, struct_object, CompileOptions, CompiledContract};

pub fn credit_source() -> &'static str {
    static SRC: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    SRC.get_or_init(|| {
        let p = std::env::var("DAWNS_CREDIT_SIL").unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../credit/dawns_credit.sil").to_string());
        std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p}: {e}"))
    })
}
pub const REPAY_SOURCE: &str = include_str!("../../credit/dawns_repay.sil");

pub fn borrower(i: usize) -> secp256k1::Keypair { dest_keys()[i] }

pub fn compile_repay(owner: [u8; 32], vault: Hash, slot: i64) -> CompiledContract<'static> {
    compile_contract(REPAY_SOURCE, &[Expr::bytes(owner.to_vec()), Expr::bytes(vault.as_bytes().to_vec()), Expr::int(slot)], CompileOptions::default())
        .expect("dawns_repay.sil compiles")
}
pub fn repay_template() -> (Vec<u8>, Vec<u8>, [u8; 32]) {
    static T: std::sync::OnceLock<(Vec<u8>, Vec<u8>, [u8; 32])> = std::sync::OnceLock::new();
    T.get_or_init(|| template_parts(&compile_repay([0; 32], Hash::from_bytes([0; 32]), 0))).clone()
}
pub fn repay_spk(owner: [u8; 32], vault: Hash, slot: i64) -> ScriptPublicKey { pay_to_script_hash_script(&compile_repay(owner, vault, slot).bytecode) }

#[derive(Clone, Debug)]
pub struct CreditMandate {
    pub base: NavMandate,
    pub terms: [i64; 3],
    pub interest: [i64; 3],
    pub grace: i64,
    pub step_bps: i64,
    pub period: i64,
}
impl Default for CreditMandate {
    fn default() -> Self {
        CreditMandate {
            base: NavMandate { mandate_hash: b2b(b"dawns credit mandate test"), ..NavMandate::default() },
            terms: [10_000, 10_000, 5_000],
            interest: [250, 250, 100],     // 2.5% over the term for slots 0 and 1, 1% for slot 2
            grace: 1_000,
            step_bps: 2_500,                  // −25% of principal per period late
            period: 1_000,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Credit {
    pub share_covid: [u8; 32],
    pub shares: i64,
    pub principal: [i64; 3],
    pub due: [i64; 3],
    pub marks: [i64; 3],
    pub epoch_index: i64,
    pub epoch_spent: i64,
    pub mark_epoch: i64,
    pub halted: bool,
}
impl Default for Credit {
    fn default() -> Self {
        Credit { share_covid: SCOV.as_bytes(), shares: 0, principal: [0; 3], due: [0; 3], marks: [0; 3], epoch_index: 0, epoch_spent: 0, mark_epoch: -1, halted: false }
    }
}

impl CreditMandate {
    /// The most a loan may count for at `at` (mirrors limitOf in the covenant).
    pub fn limit(&self, slot: usize, s: &Credit, at: i64) -> i64 {
        let p = s.principal[slot];
        let mut top = p * (10_000 + self.interest[slot]) / 10_000;
        if s.due[slot] > 0 {
            let late = at - s.due[slot] - self.grace;
            if late >= 0 {
                let cut = ((late / self.period + 1) * self.step_bps).min(10_000);
                top = p * (10_000 - cut) / 10_000;
            }
        }
        top
    }
    pub fn nav(&self, s: &Credit, held: i64, at: i64) -> i64 {
        held - self.base.min_keep + (0..3).map(|i| s.marks[i].min(self.limit(i, s, at))).sum::<i64>()
    }
}

pub fn credit_ctor(m: &CreditMandate, s: &Credit) -> Vec<Expr<'static>> {
    let b = &m.base;
    let (kp_, ks, kh) = kcc_template();
    let (_ap, asuf, ah) = account_template();
    let (_rp, rsuf, rh) = repay_template();
    let mut v = vec![
        Expr::bytes(xonly(&allocator()).to_vec()),
        Expr::bytes(xonly(&valuer()).to_vec()),
        Expr::bytes(xonly(&guardian()).to_vec()),
        Expr::int(b.max_fee),
    ];
    for d in &b.dests[..3] { v.push(Expr::bytes(d.to_vec())); }
    for c in &b.caps[..3] { v.push(Expr::int(*c)); }
    for t in m.terms { v.push(Expr::int(t)); }
    for i in m.interest { v.push(Expr::int(i)); }
    for x in [m.grace, m.step_bps, m.period, b.reserve_floor_bps, b.max_per_move, b.epoch_limit, b.epoch_length, b.not_before, b.maturity, b.deposit_until, b.min_deposit, b.max_mark_step_bps, b.note_value, b.min_keep, b.exit_fee_bps] {
        v.push(Expr::int(x));
    }
    v.push(Expr::int(kp_.len() as i64));
    v.push(Expr::int(ks.len() as i64));
    v.push(Expr::bytes(kh.to_vec()));
    v.push(Expr::int(asuf.len() as i64));
    v.push(Expr::bytes(ah.to_vec()));
    v.push(Expr::dynamic_bytes(asuf));
    v.push(Expr::int(rsuf.len() as i64));
    v.push(Expr::bytes(rh.to_vec()));
    v.push(Expr::bytes(b.mandate_hash.to_vec()));
    v.push(Expr::bytes(s.share_covid.to_vec()));
    v.push(Expr::int(s.shares));
    for x in s.principal { v.push(Expr::int(x)); }
    for x in s.due { v.push(Expr::int(x)); }
    for x in s.marks { v.push(Expr::int(x)); }
    v.push(Expr::int(s.epoch_index));
    v.push(Expr::int(s.epoch_spent));
    v.push(Expr::int(s.mark_epoch));
    v.push(Expr::bool(s.halted));
    v
}

pub fn compile_credit(m: &CreditMandate, s: &Credit) -> CompiledContract<'static> {
    compile_contract(credit_source(), &credit_ctor(m, s), CompileOptions::default()).expect("dawns_credit.sil compiles")
}

pub fn credit_state(s: &Credit) -> Expr<'static> {
    let mut f: Vec<(&str, Expr<'static>)> = vec![("shareCovid", Expr::bytes(s.share_covid.to_vec())), ("shares", Expr::int(s.shares))];
    let names_p = ["principal0", "principal1", "principal2"];
    let names_d = ["due0", "due1", "due2"];
    let names_k = ["mark0", "mark1", "mark2"];
    for i in 0..3 { f.push((names_p[i], Expr::int(s.principal[i]))); }
    for i in 0..3 { f.push((names_d[i], Expr::int(s.due[i]))); }
    for i in 0..3 { f.push((names_k[i], Expr::int(s.marks[i]))); }
    f.push(("epochIndex", Expr::int(s.epoch_index)));
    f.push(("epochSpent", Expr::int(s.epoch_spent)));
    f.push(("markEpoch", Expr::int(s.mark_epoch)));
    f.push(("halted", Expr::bool(s.halted)));
    struct_object("State", f)
}
