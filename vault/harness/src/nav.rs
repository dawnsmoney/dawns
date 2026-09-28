//! NAV vault (nav/dawns_nav.sil) — harness helpers.
//!
//! Three contracts meet in a deposit or a redemption: the vault, a personal
//! account (nav/dawns_account.sil, a plain P2SH coin) and the share token
//! (nav/kcc20.sil, vendored reference KCC-20). The helpers here compile each
//! with a given state and build the exact transaction shapes the vault pins.

use crate::*;
use kaspa_consensus_core::hashing;
use kaspa_consensus_core::tx::{CovenantBinding, ScriptPublicKey, Transaction, TransactionOutpoint, TransactionOutput, UtxoEntry};
use kaspa_consensus_core::Hash;
use kaspa_txscript::pay_to_script_hash_script;
use silverscript_lang::ast::{parse_type_ref, Expr};
use silverscript_lang::compiler::{compile_contract, struct_object, CompileOptions, CompiledContract};

/// Read at run time (not include_str!) so the mutation check can swap the file
/// without rebuilding the harness. DAWNS_NAV_SIL overrides the path.
pub fn nav_source() -> &'static str {
    static SRC: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    SRC.get_or_init(|| {
        let p = std::env::var("DAWNS_NAV_SIL").unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../nav/dawns_nav_v11.sil").to_string());
        std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p}: {e}"))
    })
}
pub const KCC_SOURCE: &str = include_str!("../../nav/kcc20.sil");
pub const ACC_SOURCE: &str = include_str!("../../nav/dawns_account.sil");

/// The vault's covenant id and the share token's, for tests that start after genesis.
pub const VCOV: Hash = Hash::from_bytes(*b"VAULTVAULTVAULTVAULTVAULTVAULTVA");
pub const SCOV: Hash = Hash::from_bytes(*b"SHARESHARESHARESHARESHARESHARESH");

pub const MAX_COV: i64 = 2;
pub const ID_SCRIPT_HASH: u8 = 0x01;
pub const ID_COVENANT: u8 = 0x02;
pub const FIRST_PRICE: i64 = 1_000_000;

pub fn valuer() -> secp256k1::Keypair { kp(0x56) }
pub fn user() -> secp256k1::Keypair { kp(0x55) }
pub fn user2() -> secp256k1::Keypair { kp(0x57) }

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------
pub fn template_parts(c: &CompiledContract) -> (Vec<u8>, Vec<u8>, [u8; 32]) {
    let l = c.state_layout;
    (c.bytecode[..l.start].to_vec(), c.bytecode[l.start + l.len..].to_vec(), c.template_hash())
}

pub fn compile_kcc(owner: &[u8], id_type: u8, amount: i64, is_minter: bool) -> CompiledContract<'static> {
    compile_contract(
        KCC_SOURCE,
        &[Expr::bytes(owner.to_vec()), Expr::int(amount), Expr::byte(id_type), Expr::bool(is_minter), Expr::int(MAX_COV), Expr::int(MAX_COV)],
        CompileOptions::default(),
    )
    .expect("kcc20.sil compiles")
}
pub fn kcc_template() -> (Vec<u8>, Vec<u8>, [u8; 32]) {
    static T: std::sync::OnceLock<(Vec<u8>, Vec<u8>, [u8; 32])> = std::sync::OnceLock::new();
    T.get_or_init(|| template_parts(&compile_kcc(&[0; 32], ID_COVENANT, 0, true))).clone()
}

pub fn compile_account(owner: [u8; 32], vault: Hash, kind: i64) -> CompiledContract<'static> {
    compile_contract(ACC_SOURCE, &[Expr::bytes(owner.to_vec()), Expr::bytes(vault.as_bytes().to_vec()), Expr::int(kind)], CompileOptions::default())
        .expect("dawns_account.sil compiles")
}
pub fn account_template() -> (Vec<u8>, Vec<u8>, [u8; 32]) {
    static T: std::sync::OnceLock<(Vec<u8>, Vec<u8>, [u8; 32])> = std::sync::OnceLock::new();
    T.get_or_init(|| template_parts(&compile_account([0; 32], Hash::from_bytes([0; 32]), 0))).clone()
}
/// The script hash that owns a user's share notes: their redeem account's redeem script.
pub fn redeem_hash(owner: [u8; 32], vault: Hash) -> [u8; 32] { b2b(&compile_account(owner, vault, 1).bytecode) }
pub fn account_spk(owner: [u8; 32], vault: Hash, kind: i64) -> ScriptPublicKey { pay_to_script_hash_script(&compile_account(owner, vault, kind).bytecode) }

// ---------------------------------------------------------------------------
// the NAV mandate and state
// ---------------------------------------------------------------------------
#[derive(Clone, Debug)]
pub struct NavMandate {
    pub dests: [[u8; 32]; 4],
    pub caps: [i64; 4],
    pub reserve_floor_bps: i64,
    pub max_per_move: i64,
    pub epoch_limit: i64,
    pub epoch_length: i64,
    pub not_before: i64,
    pub maturity: i64,
    pub deposit_until: i64,
    pub min_deposit: i64,
    pub max_mark_step_bps: i64,
    pub note_value: i64,
    pub min_keep: i64,
    pub exit_fee_bps: i64,
    pub max_fee: i64,
    pub mandate_hash: [u8; 32],
}

impl Default for NavMandate {
    fn default() -> Self {
        let m = Mandate::default();
        NavMandate {
            dests: m.dests,
            caps: m.caps,
            reserve_floor_bps: 1_000,
            max_per_move: 300 * KAS,
            epoch_limit: 500 * KAS,
            epoch_length: 1_000,
            not_before: 1_000,
            maturity: 0,
            deposit_until: i64::MAX / 4,
            min_deposit: KAS,
            max_mark_step_bps: 2_000,
            note_value: KAS / 5,
            min_keep: KAS / 5,
            exit_fee_bps: 50,
            max_fee: MAX_FEE,
            mandate_hash: b2b(b"dawns nav mandate test"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Nav {
    pub share_covid: [u8; 32],
    pub shares: i64,
    pub deployed: [i64; 4],
    pub marks: [i64; 4],
    pub epoch_index: i64,
    pub epoch_spent: i64,
    pub mark_epoch: i64,
    pub halted: bool,
}
impl Default for Nav {
    fn default() -> Self {
        Nav { share_covid: SCOV.as_bytes(), shares: 0, deployed: [0; 4], marks: [0; 4], epoch_index: 0, epoch_spent: 0, mark_epoch: -1, halted: false }
    }
}
impl Nav {
    pub fn nav(&self, held: i64) -> i64 { held - NavMandate::default().min_keep + self.marks.iter().sum::<i64>() }
}

pub fn nav_ctor(m: &NavMandate, s: &Nav) -> Vec<Expr<'static>> {
    let (kp_, ks, kh) = kcc_template();
    let (_ap, asuf, ah) = account_template();
    let mut v = vec![
        Expr::bytes(xonly(&allocator()).to_vec()),
        Expr::bytes(xonly(&valuer()).to_vec()),
        Expr::bytes(xonly(&guardian()).to_vec()),
        Expr::int(m.max_fee),
    ];
    for d in m.dests { v.push(Expr::bytes(d.to_vec())); }
    for c in m.caps { v.push(Expr::int(c)); }
    for x in [m.reserve_floor_bps, m.max_per_move, m.epoch_limit, m.epoch_length, m.not_before, m.maturity, m.deposit_until, m.min_deposit, m.max_mark_step_bps, m.note_value, m.min_keep, m.exit_fee_bps] {
        v.push(Expr::int(x));
    }
    v.push(Expr::int(kp_.len() as i64));
    v.push(Expr::int(ks.len() as i64));
    v.push(Expr::bytes(kh.to_vec()));
    v.push(Expr::int(asuf.len() as i64));
    v.push(Expr::bytes(ah.to_vec()));
    v.push(Expr::dynamic_bytes(asuf));
    v.push(Expr::bytes(m.mandate_hash.to_vec()));
    v.push(Expr::bytes(s.share_covid.to_vec()));
    v.push(Expr::int(s.shares));
    for d in s.deployed { v.push(Expr::int(d)); }
    for k in s.marks { v.push(Expr::int(k)); }
    v.push(Expr::int(s.epoch_index));
    v.push(Expr::int(s.epoch_spent));
    v.push(Expr::int(s.mark_epoch));
    v.push(Expr::bool(s.halted));
    v
}

pub fn compile_nav(m: &NavMandate, s: &Nav) -> CompiledContract<'static> {
    compile_contract(nav_source(), &nav_ctor(m, s), CompileOptions::default()).expect("dawns_nav.sil compiles")
}

pub fn nav_state(s: &Nav) -> Expr<'static> {
    struct_object(
        "State",
        vec![
            ("shareCovid", Expr::bytes(s.share_covid.to_vec())),
            ("shares", Expr::int(s.shares)),
            ("deployed0", Expr::int(s.deployed[0])),
            ("deployed1", Expr::int(s.deployed[1])),
            ("deployed2", Expr::int(s.deployed[2])),
            ("deployed3", Expr::int(s.deployed[3])),
            ("mark0", Expr::int(s.marks[0])),
            ("mark1", Expr::int(s.marks[1])),
            ("mark2", Expr::int(s.marks[2])),
            ("mark3", Expr::int(s.marks[3])),
            ("epochIndex", Expr::int(s.epoch_index)),
            ("epochSpent", Expr::int(s.epoch_spent)),
            ("markEpoch", Expr::int(s.mark_epoch)),
            ("halted", Expr::bool(s.halted)),
        ],
    )
}

pub fn kcc_states(v: Vec<(Vec<u8>, u8, i64, bool)>) -> Expr<'static> {
    Expr::array(
        parse_type_ref("State[]").unwrap(),
        v.into_iter()
            .map(|(o, t, a, m)| struct_object("State", vec![("ownerIdentifier", Expr::bytes(o)), ("identifierType", Expr::byte(t)), ("amount", Expr::int(a)), ("isMinter", Expr::bool(m))]))
            .collect(),
    )
}
pub fn sigs(v: Vec<Vec<u8>>) -> Expr<'static> { Expr::array(parse_type_ref("sig[]").unwrap(), v.into_iter().map(Expr::bytes).collect()) }

pub fn leader_sigscript(c: &CompiledContract<'_>, function: &str, args: Vec<Expr<'_>>) -> Vec<u8> {
    let mut s = c.build_sig_script_for_covenant_decl(function, args, silverscript_lang::compiler::CovenantDeclCallOptions { is_leader: true }).expect("leader sigscript");
    s.extend_from_slice(&push_redeem_script(&c.bytecode));
    s
}

pub fn cov_utxo(c: &CompiledContract<'_>, value: u64, cov: Hash) -> UtxoEntry { UtxoEntry::new(value, pay_to_script_hash_script(&c.bytecode), 0, false, Some(cov)) }
pub fn cov_out(c: &CompiledContract<'_>, value: u64, auth: u16, cov: Hash) -> TransactionOutput {
    TransactionOutput { value, script_public_key: pay_to_script_hash_script(&c.bytecode), covenant: Some(CovenantBinding { authorizing_input: auth, covenant_id: cov }) }
}

pub fn run_all(tx: &Transaction, entries: &[UtxoEntry]) -> Result<(), (usize, kaspa_txscript_errors::TxScriptError)> {
    for i in 0..tx.inputs.len() {
        execute(tx, entries.to_vec(), i).map_err(|e| (i, e))?;
    }
    Ok(())
}

pub fn genesis_covid(outpoint: TransactionOutpoint, out: &TransactionOutput, index: u32) -> Hash {
    hashing::covenant_id::covenant_id(outpoint, std::iter::once((index, out)))
}

pub fn price_up(nav: i64, shares: i64) -> i64 { if shares > 0 { (nav + shares - 1) / shares } else { FIRST_PRICE } }
pub fn price_down(nav: i64, shares: i64) -> i64 { nav / shares }
