//! Dawns mandate vault — execution proof.
//!
//! Compiles dawns_vault.sil and runs transactions through `TxScriptEngine`, the
//! same engine a Kaspa node uses. Method and helpers follow Warda's harness
//! (covenant/harness in the warda repo), which learned them the hard way:
//! compute budget, 65-byte signatures, covenant-aware Rust signing, per-state
//! P2SH successors.

use kaspa_consensus_core::hashing::sighash::{calc_schnorr_signature_hash, SigHashReusedValuesUnsync};
use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
use kaspa_consensus_core::tx::{
    CovenantBinding, MutableTransaction, PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId,
    TransactionInput, TransactionOutpoint, TransactionOutput, UtxoEntry, VerifiableTransaction,
};
use kaspa_consensus_core::Hash;
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::script_builder::ScriptBuilder;
use kaspa_txscript::{pay_to_script_hash_script, EngineCtx, EngineFlags, TxScriptEngine};
use kaspa_txscript_errors::TxScriptError;
use secp256k1::{Keypair, Secp256k1};
use silverscript_lang::ast::Expr;
use silverscript_lang::compiler::{compile_contract, struct_object, CompileOptions, CompiledContract, CovenantDeclCallOptions};

pub const SOURCE: &str = include_str!("../../dawns_vault.sil");
pub const COV: Hash = Hash::from_bytes(*b"DAWNSDAWNSDAWNSDAWNSDAWNSDAWNSDA");
pub const KAS: i64 = 100_000_000;
pub const MAX_FEE: i64 = 100_000;

// ---------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------
pub fn kp(seed: u8) -> Keypair { Keypair::from_seckey_slice(&Secp256k1::new(), &[seed; 32]).expect("key") }
pub fn allocator() -> Keypair { kp(0x41) }
pub fn guardian() -> Keypair { kp(0x47) }
pub fn depositor() -> Keypair { kp(0x44) }
pub fn stranger() -> Keypair { kp(0x7f) }
pub fn xonly(k: &Keypair) -> [u8; 32] { k.x_only_public_key().0.serialize() }

pub fn b2b(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(blake2b_simd::Params::new().hash_length(32).to_state().update(data).finalize().as_bytes());
    out
}

/// A P2PK destination (stands in for a strategy account or bridge entry).
pub fn p2pk_spk(x: [u8; 32]) -> ScriptPublicKey {
    let mut s = vec![0x20];
    s.extend_from_slice(&x);
    s.push(0xac); // OP_CHECKSIG
    ScriptPublicKey::new(0, s.into())
}
/// The hash the covenant compares: blake2b over the scriptPubKey exactly as
/// OpTxOutputSpk pushes it (`ScriptPublicKey::to_bytes`, version included).
pub fn spk_bytes(spk: &ScriptPublicKey) -> Vec<u8> {
    // txscript's private SpkEncoding: version (u16 big-endian) ++ script
    spk.version.to_be_bytes().into_iter().chain(spk.script().iter().copied()).collect()
}
pub fn dest_hash(spk: &ScriptPublicKey) -> [u8; 32] { b2b(&spk_bytes(spk)) }

pub fn dest_keys() -> [Keypair; 4] { [kp(0xd0), kp(0xd1), kp(0xd2), kp(0xd3)] }

// ---------------------------------------------------------------------------
// the mandate a test vault runs under
// ---------------------------------------------------------------------------
#[derive(Clone, Debug)]
pub struct Mandate {
    pub dests: [[u8; 32]; 4],
    pub caps: [i64; 4],
    pub reserve_floor_bps: i64,
    pub max_per_move: i64,
    pub epoch_limit: i64,
    pub epoch_length: i64,
    pub not_before: i64,
    pub mandate_hash: [u8; 32],
}

impl Default for Mandate {
    fn default() -> Self {
        let d = dest_keys();
        Mandate {
            // three live destinations, the fourth slot unused (zero hash)
            dests: [dest_hash(&p2pk_spk(xonly(&d[0]))), dest_hash(&p2pk_spk(xonly(&d[1]))), dest_hash(&p2pk_spk(xonly(&d[2]))), [0u8; 32]],
            caps: [4_000, 3_000, 2_000, 0], // 40%, 30%, 20% of vault value
            reserve_floor_bps: 1_000,       // 10% stays liquid
            max_per_move: 300 * KAS,
            epoch_limit: 500 * KAS,
            epoch_length: 1_000,
            not_before: 1_000,
            mandate_hash: b2b(b"dawns mandate v0 test"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Acct { pub deployed: [i64; 4], pub principal: i64, pub epoch_index: i64, pub epoch_spent: i64 }

pub fn ctor(m: &Mandate, a: &Acct) -> Vec<Expr<'static>> {
    vec![
        Expr::bytes(xonly(&allocator()).to_vec()),
        Expr::bytes(xonly(&guardian()).to_vec()),
        Expr::bytes(xonly(&depositor()).to_vec()),
        Expr::int(MAX_FEE),
        Expr::bytes(m.dests[0].to_vec()),
        Expr::bytes(m.dests[1].to_vec()),
        Expr::bytes(m.dests[2].to_vec()),
        Expr::bytes(m.dests[3].to_vec()),
        Expr::int(m.caps[0]),
        Expr::int(m.caps[1]),
        Expr::int(m.caps[2]),
        Expr::int(m.caps[3]),
        Expr::int(m.reserve_floor_bps),
        Expr::int(m.max_per_move),
        Expr::int(m.epoch_limit),
        Expr::int(m.epoch_length),
        Expr::int(m.not_before),
        Expr::bytes(m.mandate_hash.to_vec()),
        Expr::int(a.deployed[0]),
        Expr::int(a.deployed[1]),
        Expr::int(a.deployed[2]),
        Expr::int(a.deployed[3]),
        Expr::int(a.principal),
        Expr::int(a.epoch_index),
        Expr::int(a.epoch_spent),
    ]
}

pub fn compile(m: &Mandate, a: &Acct) -> CompiledContract<'static> {
    compile_contract(SOURCE, &ctor(m, a), CompileOptions::default()).expect("dawns_vault.sil compiles")
}

pub fn state(a: &Acct) -> Expr<'static> {
    struct_object(
        "State",
        vec![
            ("deployed0", Expr::int(a.deployed[0])),
            ("deployed1", Expr::int(a.deployed[1])),
            ("deployed2", Expr::int(a.deployed[2])),
            ("deployed3", Expr::int(a.deployed[3])),
            ("principal", Expr::int(a.principal)),
            ("epochIndex", Expr::int(a.epoch_index)),
            ("epochSpent", Expr::int(a.epoch_spent)),
        ],
    )
}

// ---------------------------------------------------------------------------
// transaction plumbing (Warda's, unchanged in substance)
// ---------------------------------------------------------------------------
pub fn push_redeem_script(bytecode: &[u8]) -> Vec<u8> {
    ScriptBuilder::with_flags(EngineFlags { covenants_enabled: true, ..Default::default() }).add_data(bytecode).expect("push").drain()
}
pub fn decl_sigscript(c: &CompiledContract<'_>, function: &str, args: Vec<Expr<'_>>) -> Vec<u8> {
    let mut s = c.build_sig_script_for_covenant_decl(function, args, CovenantDeclCallOptions { is_leader: false }).expect("decl sigscript");
    s.extend_from_slice(&push_redeem_script(&c.bytecode));
    s
}
pub fn entry_sigscript(c: &CompiledContract<'_>, function: &str, args: Vec<Expr<'_>>) -> Vec<u8> {
    let mut s = c.build_sig_script(function, args).expect("entry sigscript");
    s.extend_from_slice(&push_redeem_script(&c.bytecode));
    s
}
pub fn vault_utxo(c: &CompiledContract<'_>, value: u64) -> UtxoEntry {
    UtxoEntry::new(value, pay_to_script_hash_script(&c.bytecode), 0, false, Some(COV))
}
pub fn plain_utxo(value: u64, spk: ScriptPublicKey) -> UtxoEntry { UtxoEntry::new(value, spk, 0, false, None) }
pub fn tx_input(index: u32, sigscript: Vec<u8>) -> TransactionInput {
    TransactionInput::new_with_compute_budget(
        TransactionOutpoint { transaction_id: TransactionId::from_bytes([index as u8 + 1; 32]), index },
        sigscript,
        0,
        1000,
    )
}
pub fn continuation(c: &CompiledContract<'_>, value: u64) -> TransactionOutput {
    TransactionOutput { value, script_public_key: pay_to_script_hash_script(&c.bytecode), covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: COV }) }
}
pub fn out_to(value: u64, spk: ScriptPublicKey) -> TransactionOutput { TransactionOutput { value, script_public_key: spk, covenant: None } }

pub fn execute(tx: &Transaction, entries: Vec<UtxoEntry>, input_idx: usize) -> Result<(), TxScriptError> {
    let reused = SigHashReusedValuesUnsync::new();
    let sig_cache = Cache::new(10_000);
    let input = tx.inputs[input_idx].clone();
    let populated = PopulatedTransaction::new(tx, entries);
    let cov_ctx = CovenantsContext::from_tx(&populated).map_err(TxScriptError::from)?;
    let utxo = populated.utxo(input_idx).expect("utxo");
    let mut vm = TxScriptEngine::from_transaction_input(
        &populated, &input, input_idx, utxo,
        EngineCtx::new(&sig_cache).with_reused(&reused).with_covenants_ctx(&cov_ctx),
        EngineFlags { covenants_enabled: true, sigop_script_units: 0.into() },
    );
    vm.execute()
}

/// 64-byte Schnorr + SIG_HASH_ALL = 65 bytes, over the covenant-aware sighash.
pub fn sign(tx: &Transaction, entries: Vec<UtxoEntry>, input_idx: usize, k: &Keypair) -> Vec<u8> {
    let mtx = MutableTransaction::with_entries(tx.clone(), entries);
    let reused = SigHashReusedValuesUnsync::new();
    let h = calc_schnorr_signature_hash(&mtx.as_verifiable(), input_idx, SIG_HASH_ALL, &reused);
    let msg = secp256k1::Message::from_digest_slice(h.as_bytes().as_slice()).expect("sighash");
    let mut sig = k.sign_schnorr(msg).as_ref().to_vec();
    sig.push(SIG_HASH_ALL.to_u8());
    sig
}

/// Build, sign and run: the signature commits to the transaction, so the
/// sigscript is built twice — once with a placeholder to fix the shape, once
/// with the real signature. (Schnorr sighash excludes signature scripts.)
pub fn run_signed<F>(
    mut tx: Transaction,
    entries: Vec<UtxoEntry>,
    signer: &Keypair,
    build: F,
) -> Result<(), TxScriptError>
where
    F: Fn(Vec<u8>) -> Vec<u8>,
{
    tx.inputs[0].signature_script = build(vec![0u8; 65]);
    let sig = sign(&tx, entries.clone(), 0, signer);
    tx.inputs[0].signature_script = build(sig);
    execute(&tx, entries, 0)
}

pub fn new_tx(inputs: Vec<TransactionInput>, outputs: Vec<TransactionOutput>, lock_time: u64) -> Transaction {
    Transaction::new(1, inputs, outputs, lock_time, Default::default(), 0, vec![])
}
pub mod nav;
