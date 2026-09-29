//! dawns-vault: run a Dawns mandate vault on testnet-10.
//!
//!   status                 node, network, readiness
//!   init                   make the role keys and a draft mandate.json
//!   genesis <kas>          the depositor opens the vault under mandate.json
//!   show                   the vault as the chain holds it
//!   allocate <slot> <kas>  allocator sends capital to an approved destination
//!   recall <slot> <kas>    a strategy wallet returns capital to the vault
//!   deposit <kas>          depositor adds capital
//!   withdraw <kas>         depositor takes liquid capital out
//!   breach <cap|dest|floor|epoch>
//!                          build a move the mandate forbids, sign it with the
//!                          real allocator key, and put the network's refusal
//!                          on the record
//!   halt                   guardian stops the vault: everything to the depositor
//!   close                  depositor closes the vault
//!   nav …                  the NAV vault: see src/nav.rs
//!
//! Connects through the public Kaspa resolver (testnet-10) unless DAWNS_RPC
//! names a node (ws://host:17210). wRPC Borsh straight to a node: covenant
//! transactions must never go through a REST proxy, whose pre-covenant JSON
//! model drops the covenant binding.
//!
//! DAWNS_DRY=1 builds, signs and runs every move through the local engine
//! without broadcasting anything.
//!
//! TESTNET ONLY. Keys live in ./keys as hex, one file per role, and never
//! leave this machine.

use kaspa_addresses::{Address, Prefix, Version};
use kaspa_consensus_core::hashing::covenant_id::covenant_id;
use kaspa_consensus_core::hashing::sighash::{calc_schnorr_signature_hash, SigHashReusedValuesUnsync};
use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
use kaspa_consensus_core::subnets::SUBNETWORK_ID_NATIVE;
use kaspa_consensus_core::tx::{
    CovenantBinding, MutableTransaction, PopulatedTransaction, ScriptPublicKey, Transaction, TransactionInput,
    TransactionOutpoint, TransactionOutput, UtxoEntry, VerifiableTransaction,
};
use kaspa_consensus_core::Hash;
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::script_builder::ScriptBuilder;
use kaspa_txscript::{extract_script_pub_key_address, pay_to_address_script, pay_to_script_hash_script};
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine};
use kaspa_txscript_errors::TxScriptError;
use kaspa_wrpc_client::prelude::*;
use secp256k1::{Keypair, Secp256k1};
use serde_json::{json, Value};
use silverscript_lang::ast::Expr;
use silverscript_lang::compiler::{compile_contract, struct_object, CompileOptions, CompiledContract, CovenantDeclCallOptions};
use std::error::Error;
use std::path::PathBuf;
use std::time::Duration;

mod nav;
mod credit;

type Res<T> = Result<T, Box<dyn Error>>;

/// The covenant the harness proves — the same file, not a copy.
const SOURCE: &str = include_str!("../../dawns_vault.sil");
const KAS: i64 = 100_000_000;
const MAX_VALUE: i64 = 100_000_000_000_000; // the covenant's v0 bound: 1M KAS
const STANDARD: &str = "dawns-mandate/0";
const NETWORK: &str = "testnet-10";

/// Fee every transaction pays. Mass is dominated by the redeem script the
/// covenant input carries; 0.01 KAS clears it with room. The mandate's
/// maxFeeSompi must exceed this or the covenant refuses our own moves.
const FEE: u64 = 1_000_000;

/// Compute budget per input, in units of 10,000 script units. One signature
/// check costs 100,000 on its own. Measured by the harness (tests/budget.rs)
/// at the real sigop price: every vault path uses 106–119k units, so needs 12;
/// 16 leaves ~40% headroom. Budget is charged as mass, so more is not free.
/// Local validation below enforces the same limit the node will.
const P2PK_BUDGET: u16 = 12;
const VAULT_BUDGET: u16 = 16;

/// Claim a DAA score this far behind the tip: the claim compiles to a CLTV lock
/// and a lock at the tip is not final yet (~10 s at 10 blocks per second).
/// Understating only costs epoch headroom; overstating is impossible.
const DAA_BACKOFF: i64 = 100;

const ROLES: [&str; 6] = ["depositor", "allocator", "guardian", "strategy-0", "strategy-1", "strategy-2"];

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
fn b2b(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(blake2b_simd::Params::new().hash_length(32).to_state().update(data).finalize().as_bytes());
    out
}
fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{x:02x}")).collect() }
fn unhex(s: &str) -> Res<Vec<u8>> {
    let s = s.trim();
    if s.len() % 2 != 0 { return Err("odd-length hex".into()); }
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|e| e.into())).collect()
}
fn kas(sompi: i64) -> String { format!("{:.8} KAS", sompi as f64 / KAS as f64).replace(".00000000", "") }
fn parse_kas(s: &str) -> Res<i64> {
    let v: f64 = s.parse().map_err(|_| format!("not an amount: {s}"))?;
    if !(v > 0.0) || v * KAS as f64 > MAX_VALUE as f64 { return Err(format!("amount out of range: {s}").into()); }
    Ok((v * KAS as f64).round() as i64)
}
/// The bytes OpTxOutputSpk pushes: version (u16 big-endian) then the script.
fn spk_bytes(spk: &ScriptPublicKey) -> Vec<u8> {
    spk.version.to_be_bytes().into_iter().chain(spk.script().iter().copied()).collect()
}
fn now() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

// ---------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------
fn keys_dir() -> PathBuf { PathBuf::from(std::env::var("DAWNS_KEYS").unwrap_or_else(|_| "keys".into())) }
fn load_key(role: &str) -> Res<Keypair> {
    let p = keys_dir().join(format!("{role}.key"));
    let raw = std::fs::read_to_string(&p).map_err(|_| format!("missing {} — run `init`", p.display()))?;
    let b = unhex(&raw)?;
    if b.len() != 32 { return Err(format!("{} must hold 32 bytes of hex", p.display()).into()); }
    Ok(Keypair::from_seckey_slice(&Secp256k1::new(), &b)?)
}
fn make_key(role: &str) -> Res<bool> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::create_dir_all(keys_dir())?;
    let p = keys_dir().join(format!("{role}.key"));
    if p.exists() { return Ok(false); } // never overwrite a key
    let kp = Keypair::new(&Secp256k1::new(), &mut secp256k1::rand::thread_rng());
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&p)?;
    writeln!(f, "{}", hex(&kp.secret_bytes()))?;
    Ok(true)
}
fn address_of(k: &Keypair) -> Address { Address::new(Prefix::Testnet, Version::PubKey, &k.x_only_public_key().0.serialize()) }
fn xonly_of(a: &Address) -> Res<[u8; 32]> {
    if a.version != Version::PubKey || a.payload.len() != 32 { return Err(format!("{a} is not a Schnorr pay-to-pubkey address").into()); }
    let mut x = [0u8; 32];
    x.copy_from_slice(&a.payload);
    Ok(x)
}
fn parse_addr(s: &str) -> Res<Address> {
    let a = Address::try_from(s).map_err(|e| format!("bad address {s}: {e}"))?;
    if a.prefix != Prefix::Testnet { return Err(format!("{s} is not a testnet address").into()); }
    Ok(a)
}

// ---------------------------------------------------------------------------
// the mandate: one document that the covenant, the allocator and the reports
// all come from. Its hash is baked into the vault.
// ---------------------------------------------------------------------------
struct Dest { label: String, address: Address, cap_bps: i64 }
struct Mandate {
    doc: Value,
    depositor: Address,
    allocator: Address,
    guardian: Address,
    dests: Vec<Dest>,
    reserve_floor_bps: i64,
    max_per_move: i64,
    epoch_limit: i64,
    epoch_length: i64,
    max_fee: i64,
    not_before: i64,
}

/// Canonical form: keys sorted at every depth (serde_json's map is ordered),
/// no whitespace. The site recomputes this in the browser to prove the
/// published mandate is the one the vault runs.
fn mandate_hash(doc: &Value) -> [u8; 32] { b2b(serde_json::to_string(doc).expect("json").as_bytes()) }

fn int(doc: &Value, k: &str) -> Res<i64> { doc[k].as_i64().ok_or_else(|| format!("mandate.{k} must be an integer").into()) }

fn read_mandate() -> Res<Mandate> {
    let doc: Value = serde_json::from_str(&std::fs::read_to_string("mandate.json").map_err(|_| "no mandate.json — run `init`")?)?;
    if doc["standard"] != STANDARD { return Err(format!("mandate.standard must be \"{STANDARD}\"").into()); }
    if doc["network"] != NETWORK { return Err(format!("mandate.network must be \"{NETWORK}\"").into()); }
    let role = |k: &str| -> Res<Address> { parse_addr(doc["roles"][k].as_str().ok_or(format!("mandate.roles.{k} missing"))?) };
    let (depositor, allocator, guardian) = (role("depositor")?, role("allocator")?, role("guardian")?);
    for a in [&depositor, &allocator, &guardian] { xonly_of(a)?; }
    if depositor == allocator || depositor == guardian || allocator == guardian {
        return Err("depositor, allocator and guardian must be three different keys".into());
    }
    let list = doc["destinations"].as_array().ok_or("mandate.destinations must be a list")?;
    if list.is_empty() || list.len() > 4 { return Err("a v0 vault has 1 to 4 destinations".into()); }
    let mut dests = Vec::new();
    for (i, d) in list.iter().enumerate() {
        let address = parse_addr(d["address"].as_str().ok_or(format!("destinations[{i}].address missing"))?)?;
        if address == allocator || address == guardian {
            return Err(format!("destinations[{i}] is a role key: capital could leave to a signer").into());
        }
        let cap_bps = d["capBps"].as_i64().ok_or(format!("destinations[{i}].capBps missing"))?;
        if !(1..=10_000).contains(&cap_bps) { return Err(format!("destinations[{i}].capBps must be 1..10000").into()); }
        dests.push(Dest { label: d["label"].as_str().unwrap_or("").to_string(), address, cap_bps });
    }
    let m = Mandate {
        depositor, allocator, guardian, dests,
        reserve_floor_bps: int(&doc, "reserveFloorBps")?,
        max_per_move: int(&doc, "maxPerMoveSompi")?,
        epoch_limit: int(&doc, "epochLimitSompi")?,
        epoch_length: int(&doc, "epochLengthDaa")?,
        max_fee: int(&doc, "maxFeeSompi")?,
        not_before: int(&doc, "notBeforeDaa")?,
        doc,
    };
    if !(0..=10_000).contains(&m.reserve_floor_bps) { return Err("reserveFloorBps must be 0..10000".into()); }
    for (k, v) in [("maxPerMoveSompi", m.max_per_move), ("epochLimitSompi", m.epoch_limit)] {
        if !(KAS..=MAX_VALUE).contains(&v) { return Err(format!("{k} must be between 1 KAS and 1M KAS").into()); }
    }
    if m.epoch_length <= 0 { return Err("epochLengthDaa must be positive".into()); }
    if m.max_fee <= FEE as i64 || m.max_fee > KAS { return Err(format!("maxFeeSompi must exceed the tool's fee ({FEE}) and stay under 1 KAS").into()); }
    if m.not_before < 0 { return Err("notBeforeDaa must not be negative".into()); }
    Ok(m)
}

// ---------------------------------------------------------------------------
// vault state and the manifest that remembers where the vault lives
// ---------------------------------------------------------------------------
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
struct Acct { deployed: [i64; 4], principal: i64, epoch_index: i64, epoch_spent: i64 }

impl Acct {
    fn to_json(self) -> Value {
        json!({ "deployed": self.deployed, "principal": self.principal, "epochIndex": self.epoch_index, "epochSpent": self.epoch_spent })
    }
    fn from_json(v: &Value) -> Res<Acct> {
        let d = v["deployed"].as_array().ok_or("state.deployed")?;
        if d.len() != 4 { return Err("state.deployed must have 4 entries".into()); }
        let mut deployed = [0i64; 4];
        for (i, x) in d.iter().enumerate() { deployed[i] = x.as_i64().ok_or("state.deployed")?; }
        Ok(Acct { deployed, principal: int(v, "principal")?, epoch_index: int(v, "epochIndex")?, epoch_spent: int(v, "epochSpent")? })
    }
}

fn dest_hash(m: &Mandate, i: usize) -> [u8; 32] {
    m.dests.get(i).map(|d| b2b(&spk_bytes(&pay_to_address_script(&d.address)))).unwrap_or([0u8; 32])
}
fn cap(m: &Mandate, i: usize) -> i64 { m.dests.get(i).map(|d| d.cap_bps).unwrap_or(0) }

fn ctor(m: &Mandate, a: &Acct) -> Res<Vec<Expr<'static>>> {
    Ok(vec![
        Expr::bytes(xonly_of(&m.allocator)?.to_vec()),
        Expr::bytes(xonly_of(&m.guardian)?.to_vec()),
        Expr::bytes(xonly_of(&m.depositor)?.to_vec()),
        Expr::int(m.max_fee),
        Expr::bytes(dest_hash(m, 0).to_vec()),
        Expr::bytes(dest_hash(m, 1).to_vec()),
        Expr::bytes(dest_hash(m, 2).to_vec()),
        Expr::bytes(dest_hash(m, 3).to_vec()),
        Expr::int(cap(m, 0)),
        Expr::int(cap(m, 1)),
        Expr::int(cap(m, 2)),
        Expr::int(cap(m, 3)),
        Expr::int(m.reserve_floor_bps),
        Expr::int(m.max_per_move),
        Expr::int(m.epoch_limit),
        Expr::int(m.epoch_length),
        Expr::int(m.not_before),
        Expr::bytes(mandate_hash(&m.doc).to_vec()),
        Expr::int(a.deployed[0]),
        Expr::int(a.deployed[1]),
        Expr::int(a.deployed[2]),
        Expr::int(a.deployed[3]),
        Expr::int(a.principal),
        Expr::int(a.epoch_index),
        Expr::int(a.epoch_spent),
    ])
}
fn compile(m: &Mandate, a: &Acct) -> Res<CompiledContract<'static>> {
    compile_contract(SOURCE, &ctor(m, a)?, CompileOptions::default()).map_err(|e| format!("compile: {e:?}").into())
}
fn state_expr(a: &Acct) -> Expr<'static> {
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
fn vault_address(c: &CompiledContract<'_>) -> Res<Address> {
    Ok(extract_script_pub_key_address(&pay_to_script_hash_script(&c.bytecode), Prefix::Testnet)?)
}

struct Manifest { v: Value }
impl Manifest {
    fn read() -> Res<Manifest> {
        let v: Value = serde_json::from_str(&std::fs::read_to_string("vault.json").map_err(|_| "no vault.json — run `genesis`")?)?;
        Ok(Manifest { v })
    }
    fn write(&self) -> Res<()> {
        // write-then-rename: a crash mid-write must not lose where the vault is
        std::fs::write("vault.json.tmp", serde_json::to_string_pretty(&self.v)? + "\n")?;
        std::fs::rename("vault.json.tmp", "vault.json")?;
        Ok(())
    }
    fn state(&self) -> Res<Acct> { Acct::from_json(&self.v["state"]) }
    fn cov(&self) -> Res<Hash> { Ok(self.v["covenantId"].as_str().ok_or("covenantId")?.parse()?) }
}

// ---------------------------------------------------------------------------
// node
// ---------------------------------------------------------------------------
async fn connect() -> Res<KaspaRpcClient> {
    let net = NetworkId::with_suffix(NetworkType::Testnet, 10);
    let client = match std::env::var("DAWNS_RPC") {
        Ok(url) => KaspaRpcClient::new(WrpcEncoding::Borsh, Some(&url), None, Some(net), None)?,
        Err(_) => KaspaRpcClient::new(WrpcEncoding::Borsh, None, Some(Resolver::default()), Some(net), None)?,
    };
    let opts = ConnectOptions {
        block_async_connect: true,
        strategy: ConnectStrategy::Fallback,
        connect_timeout: Some(Duration::from_secs(15)),
        ..Default::default()
    };
    client.connect(Some(opts)).await.map_err(|e| format!("could not reach a testnet-10 node: {e}"))?;
    Ok(client)
}
async fn ready(client: &KaspaRpcClient) -> Res<i64> {
    let info = client.get_info().await?;
    if !info.is_utxo_indexed { return Err("node has no UTXO index".into()); }
    if !info.is_synced { return Err("node is not synced".into()); }
    let dag = client.get_block_dag_info().await?;
    if dag.network.to_string() != NETWORK { return Err(format!("node is on {}, not {NETWORK}", dag.network).into()); }
    Ok(dag.virtual_daa_score as i64)
}
struct Coin { outpoint: TransactionOutpoint, entry: UtxoEntry }
async fn coins(client: &KaspaRpcClient, a: &Address) -> Res<Vec<Coin>> {
    let r = client.get_utxos_by_addresses(vec![a.clone()]).await?;
    Ok(r.into_iter()
        .map(|u| Coin {
            outpoint: TransactionOutpoint { transaction_id: u.outpoint.transaction_id, index: u.outpoint.index },
            entry: UtxoEntry::new(u.utxo_entry.amount, u.utxo_entry.script_public_key, u.utxo_entry.block_daa_score, u.utxo_entry.is_coinbase, u.utxo_entry.covenant_id),
        })
        .collect())
}
async fn largest(client: &KaspaRpcClient, a: &Address, need: u64) -> Res<Coin> {
    let mut c = coins(client, a).await?;
    c.retain(|c| c.entry.covenant_id.is_none());
    c.sort_by_key(|c| std::cmp::Reverse(c.entry.amount));
    let c = c.into_iter().next().ok_or_else(|| format!("no coins at {a} — fund it from https://faucet-tn10.kaspanet.io/"))?;
    if c.entry.amount < need { return Err(format!("largest coin at {a} is {}, need {}", kas(c.entry.amount as i64), kas(need as i64)).into()); }
    Ok(c)
}

/// The vault's coin at the address its current state compiles to. Exactly one.
async fn vault_coin(client: &KaspaRpcClient, addr: &Address, cov: Hash) -> Res<Coin> {
    let mut c = coins(client, addr).await?;
    c.retain(|c| c.entry.covenant_id == Some(cov));
    match c.len() {
        1 => Ok(c.remove(0)),
        0 => Err(format!("no vault coin at {addr} — run `show` (a move may still be confirming)").into()),
        n => Err(format!("{n} vault coins at {addr}: a singleton vault must have exactly one").into()),
    }
}

// ---------------------------------------------------------------------------
// signing and local validation
// ---------------------------------------------------------------------------
fn sighash_sig(tx: &Transaction, entries: &[UtxoEntry], idx: usize, k: &Keypair) -> Res<Vec<u8>> {
    let mtx = MutableTransaction::with_entries(tx.clone(), entries.to_vec());
    let reused = SigHashReusedValuesUnsync::new();
    let h = calc_schnorr_signature_hash(&mtx.as_verifiable(), idx, SIG_HASH_ALL, &reused);
    let msg = secp256k1::Message::from_digest_slice(h.as_bytes().as_slice())?;
    let mut sig = k.sign_schnorr(msg).as_ref().to_vec();
    sig.push(SIG_HASH_ALL.to_u8()); // 65 bytes, never 64
    Ok(sig)
}
fn p2pk_sigscript(sig: &[u8]) -> Res<Vec<u8>> { Ok(ScriptBuilder::new().add_data(sig)?.drain()) }
fn push_redeem(bytecode: &[u8]) -> Res<Vec<u8>> {
    Ok(ScriptBuilder::with_flags(EngineFlags { covenants_enabled: true, ..Default::default() }).add_data(bytecode)?.drain())
}
fn decl_sigscript(c: &CompiledContract<'_>, f: &str, args: Vec<Expr<'_>>) -> Res<Vec<u8>> {
    let mut s = c.build_sig_script_for_covenant_decl(f, args, CovenantDeclCallOptions { is_leader: false }).map_err(|e| format!("{f} sigscript: {e:?}"))?;
    s.extend_from_slice(&push_redeem(&c.bytecode)?);
    Ok(s)
}
fn entry_sigscript(c: &CompiledContract<'_>, f: &str, args: Vec<Expr<'_>>) -> Res<Vec<u8>> {
    let mut s = c.build_sig_script(f, args).map_err(|e| format!("{f} sigscript: {e:?}"))?;
    s.extend_from_slice(&push_redeem(&c.bytecode)?);
    Ok(s)
}

/// Every input through the engine with the real signature price and the real
/// per-input limit consensus derives from the input's compute budget
/// (budget × 10,000 plus the free per-input allowance). Returns units used.
fn validate(tx: &Transaction, entries: &[UtxoEntry]) -> Result<Vec<u64>, TxScriptError> {
    let reused = SigHashReusedValuesUnsync::new();
    let sig_cache = Cache::new(10_000);
    let populated = PopulatedTransaction::new(tx, entries.to_vec());
    let cov_ctx = CovenantsContext::from_tx(&populated).map_err(TxScriptError::from)?;
    let mut used = Vec::new();
    for idx in 0..tx.inputs.len() {
        let input = tx.inputs[idx].clone();
        let limit = input.compute_commit.allowed_script_units();
        let utxo = populated.utxo(idx).expect("utxo");
        let mut vm = TxScriptEngine::from_transaction_input_with_script_units_limit(
            &populated, &input, idx, utxo,
            EngineCtx::new(&sig_cache).with_reused(&reused).with_covenants_ctx(&cov_ctx),
            EngineFlags { covenants_enabled: true, ..Default::default() },
            limit,
        );
        vm.execute()?;
        used.push(vm.used_script_units().0);
    }
    Ok(used)
}

fn input(c: &Coin, budget: u16) -> TransactionInput { TransactionInput::new_with_compute_budget(c.outpoint, vec![], 0, budget) }
fn out(value: i64, spk: ScriptPublicKey) -> TransactionOutput { TransactionOutput { value: value as u64, script_public_key: spk, covenant: None } }
fn cont(c: &CompiledContract<'_>, value: i64, cov: Hash) -> TransactionOutput {
    TransactionOutput { value: value as u64, script_public_key: pay_to_script_hash_script(&c.bytecode), covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: cov }) }
}
// VERSION 1: covenant bindings and compute budgets exist only from v1.
fn tx_of(inputs: Vec<TransactionInput>, outputs: Vec<TransactionOutput>, lock_time: u64) -> Transaction {
    Transaction::new(1, inputs, outputs, lock_time, SUBNETWORK_ID_NATIVE, 0, vec![])
}

/// A change output below 1 KAS inflates storage mass; fold it into the fee's side instead.
fn change_ok(v: i64) -> Res<()> {
    if v != 0 && v < KAS { return Err(format!("this would leave {} of change; use an amount that leaves 0 or at least 1 KAS", kas(v)).into()); }
    Ok(())
}

// ---------------------------------------------------------------------------
// one move, end to end
// ---------------------------------------------------------------------------
struct Move {
    kind: &'static str,
    tx: Transaction,
    entries: Vec<UtxoEntry>,
    next: Option<Acct>,        // None: the vault ends (halt, close)
    slot: Option<usize>,
    amount: i64,
    claimed_daa: Option<i64>,
    value_after: i64,
}

async fn submit(client: &KaspaRpcClient, mut man: Manifest, m: &Mandate, mv: Move, expect_refusal: bool) -> Res<()> {
    let local = validate(&mv.tx, &mv.entries);
    match (&local, expect_refusal) {
        (Ok(u), false) => println!("local engine   : ACCEPTED (script units per input {u:?})"),
        (Err(e), false) => return Err(format!("local engine refused a move that should pass: {e:?} — not broadcast").into()),
        (Err(e), true) => println!("local engine   : REFUSED, as the mandate requires ({e:?})"),
        (Ok(_), true) => return Err("UNEXPECTED: the local engine ACCEPTED a mandate breach. Not broadcast. Investigate the covenant.".into()),
    }
    let txid = mv.tx.id();
    if std::env::var("DAWNS_DRY").is_ok() {
        println!("dry run        : not broadcast (txid would be {txid})");
        return Ok(());
    }

    if expect_refusal {
        println!("broadcasting so the network's own refusal is on the record…");
        match client.submit_transaction((&mv.tx).into(), false).await {
            Ok(id) => return Err(format!("UNEXPECTED: the network ACCEPTED the breach, txid {id}").into()),
            Err(e) => {
                println!("REFUSED by the network, as designed:\n  {e}");
                let breaches = man.v["refusals"].as_array().cloned().unwrap_or_default();
                let mut breaches = breaches;
                breaches.push(json!({ "kind": mv.kind, "txid": txid.to_string(), "slot": mv.slot, "amount": mv.amount, "at": now(), "error": e.to_string() }));
                man.v["refusals"] = Value::Array(breaches);
                man.write()?;
            }
        }
        return Ok(());
    }

    // Persist BEFORE broadcasting: the vault's address comes from its state,
    // so a move that lands while its new state is lost strands the coin.
    let next_addr = match mv.next { Some(n) => Some(vault_address(&compile(m, &n)?)?.to_string()), None => None };
    man.v["pending"] = json!({ "txid": txid.to_string(), "kind": mv.kind, "state": mv.next.map(|n| n.to_json()), "address": next_addr, "value": mv.value_after });
    man.write()?;

    match client.submit_transaction((&mv.tx).into(), false).await {
        Ok(id) => {
            println!("accepted. txid : {id}");
            let mut moves = man.v["moves"].as_array().cloned().unwrap_or_default();
            moves.push(json!({ "kind": mv.kind, "txid": id.to_string(), "slot": mv.slot, "amount": mv.amount, "claimedDaa": mv.claimed_daa, "at": now(), "valueAfter": mv.value_after, "stateAfter": mv.next.map(|n| n.to_json()) }));
            man.v["moves"] = Value::Array(moves);
            match mv.next {
                Some(n) => {
                    man.v["state"] = n.to_json();
                    man.v["address"] = json!(next_addr);
                    man.v["value"] = json!(mv.value_after);
                }
                None => {
                    man.v["closed"] = json!({ "kind": mv.kind, "txid": id.to_string(), "at": now() });
                    man.v["value"] = json!(0);
                }
            }
            man.v["pending"] = Value::Null;
            man.write()?;
            if let Some(a) = next_addr { println!("vault moved to : {a}"); }
            Ok(())
        }
        Err(e) => {
            man.v["pending"] = Value::Null;
            man.write()?;
            Err(format!("rejected by the node: {e}").into())
        }
    }
}

/// A move whose broadcast result never got recorded (crash, lost connection):
/// the chain says which state is live.
async fn resolve_pending(client: &KaspaRpcClient, man: &mut Manifest, m: &Mandate) -> Res<()> {
    if man.v["pending"].is_null() { return Ok(()); }
    let cov = man.cov()?;
    let p = man.v["pending"].clone();
    if let (Some(addr), Some(state)) = (p["address"].as_str(), p.get("state").filter(|s| !s.is_null())) {
        let a = parse_addr(addr)?;
        let found = coins(client, &a).await?.into_iter().any(|c| c.entry.covenant_id == Some(cov));
        if found {
            let st = Acct::from_json(state)?;
            if vault_address(&compile(m, &st)?)?.to_string() != addr { return Err("pending state does not compile to its address".into()); }
            man.v["state"] = state.clone();
            man.v["address"] = json!(addr);
            man.v["value"] = p["value"].clone();
            let mut moves = man.v["moves"].as_array().cloned().unwrap_or_default();
            moves.push(json!({ "kind": p["kind"], "txid": p["txid"], "at": now(), "valueAfter": p["value"], "stateAfter": state, "recovered": true }));
            man.v["moves"] = Value::Array(moves);
            println!("recovered a move that landed: {}", p["txid"]);
        }
    }
    man.v["pending"] = Value::Null;
    man.write()
}

struct Ctx { client: KaspaRpcClient, m: Mandate, man: Manifest, state: Acct, cur: CompiledContract<'static>, coin: Coin, cov: Hash, daa: i64 }

async fn open() -> Res<Ctx> {
    let m = read_mandate()?;
    let mut man = Manifest::read()?;
    if man.v["mandateHash"].as_str() != Some(&hex(&mandate_hash(&m.doc))) {
        return Err("mandate.json no longer matches the vault's mandate hash. The mandate is fixed at genesis.".into());
    }
    if !man.v["closed"].is_null() { return Err("this vault is closed".into()); }
    let client = connect().await?;
    let daa = ready(&client).await?;
    resolve_pending(&client, &mut man, &m).await?;
    let state = man.state()?;
    let cur = compile(&m, &state)?;
    let addr = vault_address(&cur)?;
    if man.v["address"].as_str() != Some(&addr.to_string()) { return Err("vault.json address does not match its state".into()); }
    let cov = man.cov()?;
    let coin = vault_coin(&client, &addr, cov).await?;
    Ok(Ctx { client, m, man, state, cur, coin, cov, daa })
}

fn claimed(c: &Ctx) -> Res<i64> {
    let d = c.daa - DAA_BACKOFF;
    if d < c.m.not_before { return Err(format!("the mandate starts at DAA {}; the chain is at {}", c.m.not_before, c.daa).into()); }
    Ok(d)
}

/// allocate, honest or deliberately breaching
fn build_allocate(c: &Ctx, slot: usize, amount: i64, pay_to: ScriptPublicKey) -> Res<Move> {
    let in_value = c.coin.entry.amount as i64;
    let daa = claimed(c)?;
    let epoch = (daa - c.m.not_before) / c.m.epoch_length;
    let spent = if epoch == c.state.epoch_index { c.state.epoch_spent } else { 0 };
    let mut n = c.state;
    n.deployed[slot] += amount;
    n.epoch_index = epoch;
    n.epoch_spent = spent + amount;
    let succ = compile(&c.m, &n)?;
    let keep = in_value - amount - FEE as i64;
    if keep < KAS { return Err("that would empty the vault".into()); }
    let mut tx = tx_of(vec![input(&c.coin, VAULT_BUDGET)], vec![cont(&succ, keep, c.cov), out(amount, pay_to)], daa as u64);
    let entries = vec![c.coin.entry.clone()];
    let sig = sighash_sig(&tx, &entries, 0, &load_key("allocator")?)?;
    tx.inputs[0].signature_script = decl_sigscript(&c.cur, "allocate", vec![state_expr(&n), Expr::int(slot as i64), Expr::int(amount), Expr::int(daa), Expr::bytes(sig)])?;
    tx.finalize();
    Ok(Move { kind: "allocate", tx, entries, next: Some(n), slot: Some(slot), amount, claimed_daa: Some(daa), value_after: keep })
}

fn print_state(m: &Mandate, a: &Acct, value: i64) {
    let deployed: i64 = a.deployed.iter().sum();
    let nav = value + deployed;
    println!("in vault       : {}", kas(value));
    println!("deployed       : {} (at cost)", kas(deployed));
    println!("vault value    : {}", kas(nav));
    for (i, d) in m.dests.iter().enumerate() {
        let share = if nav > 0 { a.deployed[i] as f64 / nav as f64 * 100.0 } else { 0.0 };
        println!("  [{i}] {:<24} {:>18}  {:>5.1}% of {:>5.1}% cap", d.label, kas(a.deployed[i]), share, d.cap_bps as f64 / 100.0);
    }
    let floor = if nav > 0 { value as f64 / nav as f64 * 100.0 } else { 100.0 };
    println!("liquid reserve : {:.1}% (floor {:.1}%)", floor, m.reserve_floor_bps as f64 / 100.0);
    println!("principal      : {}", kas(a.principal));
    println!("epoch          : #{} — {} of {} used", a.epoch_index, kas(a.epoch_spent), kas(m.epoch_limit));
}

// ---------------------------------------------------------------------------
#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

async fn run() -> Res<()> {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(String::as_str).unwrap_or("status");
    let arg = |i: usize| -> Res<&str> { args.get(i).map(String::as_str).ok_or_else(|| format!("usage: see `{cmd}` in the header of src/main.rs").into()) };

    match cmd {
        "status" => {
            let client = connect().await?;
            let info = client.get_info().await?;
            let dag = client.get_block_dag_info().await?;
            println!("node           : {}", std::env::var("DAWNS_RPC").unwrap_or_else(|_| "public resolver".into()));
            println!("server version : {}", info.server_version);
            println!("network        : {}", dag.network);
            println!("synced         : {}", info.is_synced);
            println!("utxo indexed   : {}", info.is_utxo_indexed);
            println!("virtual daa    : {}", dag.virtual_daa_score);
        }

        "init" => {
            for r in ROLES {
                let made = make_key(r)?;
                println!("{:<11} {} {}", r, address_of(&load_key(r)?), if made { "(new)" } else { "(kept)" });
            }
            if std::path::Path::new("mandate.json").exists() {
                println!("\nmandate.json exists — left as is.");
            } else {
                let a = |r: &str| -> Res<String> { Ok(address_of(&load_key(r)?).to_string()) };
                let doc = json!({
                    "standard": STANDARD,
                    "network": NETWORK,
                    "name": "Dawns TN10 test mandate",
                    "objective": "Exercise every covenant path on testnet-10 with small amounts. Destinations are Dawns-held strategy wallets standing in for real strategies.",
                    "roles": { "depositor": a("depositor")?, "allocator": a("allocator")?, "guardian": a("guardian")? },
                    "destinations": [
                        { "label": "Strategy A (test wallet)", "address": a("strategy-0")?, "capBps": 4000 },
                        { "label": "Strategy B (test wallet)", "address": a("strategy-1")?, "capBps": 3000 },
                        { "label": "Strategy C (test wallet)", "address": a("strategy-2")?, "capBps": 2000 }
                    ],
                    "reserveFloorBps": 1000,
                    "maxPerMoveSompi": 50 * KAS,
                    "epochLimitSompi": 100 * KAS,
                    "epochLengthDaa": 36_000,
                    "maxFeeSompi": 5_000_000,
                    "notBeforeDaa": 0
                });
                std::fs::write("mandate.json", serde_json::to_string_pretty(&doc)? + "\n")?;
                println!("\nwrote mandate.json (draft — edit before genesis; it is fixed after).");
            }
            println!("\nfund the depositor at https://faucet-tn10.kaspanet.io/");
        }

        "genesis" => {
            if std::path::Path::new("vault.json").exists() { return Err("vault.json exists: one vault per directory".into()); }
            let value = parse_kas(arg(2)?)?;
            let client = connect().await?;
            let daa = ready(&client).await?;
            // Fix the start before hashing: notBefore is part of the mandate.
            let mut doc: Value = serde_json::from_str(&std::fs::read_to_string("mandate.json")?)?;
            if doc["notBeforeDaa"].as_i64() == Some(0) {
                doc["notBeforeDaa"] = json!(daa - DAA_BACKOFF);
                std::fs::write("mandate.json", serde_json::to_string_pretty(&doc)? + "\n")?;
            }
            let m = read_mandate()?;
            let dep = load_key("depositor")?;
            if address_of(&dep) != m.depositor { return Err("keys/depositor.key is not the mandate's depositor".into()); }
            let funding = largest(&client, &m.depositor, (value + FEE as i64) as u64).await?;
            let change = funding.entry.amount as i64 - value - FEE as i64;
            change_ok(change)?;

            let st = Acct { principal: value, ..Default::default() };
            let contract = compile(&m, &st)?;
            // covenant id = f(funding outpoint, the unbound output); then bind it
            let unbound = out(value, pay_to_script_hash_script(&contract.bytecode));
            let cov = covenant_id(funding.outpoint, std::iter::once((0u32, &unbound)));
            let mut outs = vec![cont(&contract, value, cov)];
            if change > 0 { outs.push(out(change, pay_to_address_script(&m.depositor))); }
            let mut tx = tx_of(vec![input(&funding, P2PK_BUDGET)], outs, 0);
            let entries = vec![funding.entry.clone()];
            tx.inputs[0].signature_script = p2pk_sigscript(&sighash_sig(&tx, &entries, 0, &dep)?)?;
            tx.finalize();
            let used = validate(&tx, &entries).map_err(|e| format!("local engine refused genesis: {e:?}"))?;
            let addr = vault_address(&contract)?;
            println!("covenant bytes : {}", contract.bytecode.len());
            println!("mandate hash   : {}", hex(&mandate_hash(&m.doc)));
            println!("covenant id    : {cov}");
            println!("vault address  : {addr}");
            println!("local engine   : ACCEPTED ({used:?})");

            let man = Manifest { v: json!({
                "network": NETWORK,
                "covenantId": cov.to_string(),
                "mandateHash": hex(&mandate_hash(&m.doc)),
                "genesisTx": tx.id().to_string(),
                "createdAt": now(),
                "state": st.to_json(),
                "address": addr.to_string(),
                "value": value,
                "pending": Value::Null,
                "moves": [],
                "refusals": []
            })};
            man.write()?; // before broadcasting, always
            match client.submit_transaction((&tx).into(), false).await {
                Ok(id) => println!("\nsubmitted. txid: {id}"),
                Err(e) => {
                    std::fs::rename("vault.json", "vault.failed.json")?;
                    return Err(format!("genesis rejected: {e} (manifest moved to vault.failed.json)").into());
                }
            }
        }

        "show" => {
            let m = read_mandate()?;
            let mut man = Manifest::read()?;
            let client = connect().await?;
            let daa = ready(&client).await?;
            resolve_pending(&client, &mut man, &m).await?;
            let st = man.state()?;
            let addr = vault_address(&compile(&m, &st)?)?;
            println!("mandate        : {} ({})", m.doc["name"].as_str().unwrap_or(""), &hex(&mandate_hash(&m.doc))[..16]);
            println!("vault address  : {addr}");
            println!("chain daa      : {daa}");
            if !man.v["closed"].is_null() { println!("CLOSED         : {}", man.v["closed"]); return Ok(()); }
            match vault_coin(&client, &addr, man.cov()?).await {
                Ok(c) => {
                    if c.entry.amount as i64 != man.v["value"].as_i64().unwrap_or(-1) { println!("note: chain holds {}, vault.json says {}", kas(c.entry.amount as i64), man.v["value"]); }
                    print_state(&m, &st, c.entry.amount as i64);
                }
                Err(e) => println!("{e}"),
            }
            println!("moves          : {}", man.v["moves"].as_array().map(|a| a.len()).unwrap_or(0));
            println!("refusals       : {}", man.v["refusals"].as_array().map(|a| a.len()).unwrap_or(0));
        }

        "allocate" => {
            let c = open().await?;
            let slot: usize = arg(2)?.parse()?;
            let amount = parse_kas(arg(3)?)?;
            let d = c.m.dests.get(slot).ok_or("no such destination")?;
            println!("allocate       : {} to [{slot}] {} ({})", kas(amount), d.label, d.address);
            let mv = build_allocate(&c, slot, amount, pay_to_address_script(&d.address))?;
            submit(&c.client, c.man, &c.m, mv, false).await?;
        }

        "breach" => {
            let c = open().await?;
            let kind = arg(2)?;
            let in_value = c.coin.entry.amount as i64;
            let nav = in_value + c.state.deployed.iter().sum::<i64>();
            let (slot, amount, pay_to) = match kind {
                // one sompi over destination 0's cap (or the per-move / epoch limit, whichever binds first — the covenant checks all)
                "cap" => {
                    let room = c.m.dests[0].cap_bps as i128 * nav as i128 / 10_000 - c.state.deployed[0] as i128;
                    (0, (room as i64 + KAS).max(KAS), pay_to_address_script(&c.m.dests[0].address))
                }
                // an address the mandate never approved: the allocator's own
                "dest" => (0, KAS, pay_to_address_script(&c.m.allocator)),
                // leaves the vault one KAS under its liquid floor
                "floor" => {
                    let min_left = c.m.reserve_floor_bps as i128 * nav as i128 / 10_000;
                    (0, (in_value as i128 - min_left) as i64 + KAS, pay_to_address_script(&c.m.dests[0].address))
                }
                // more than this epoch has left
                "epoch" => {
                    let daa = claimed(&c)?;
                    let epoch = (daa - c.m.not_before) / c.m.epoch_length;
                    let spent = if epoch == c.state.epoch_index { c.state.epoch_spent } else { 0 };
                    (0, c.m.epoch_limit - spent + KAS, pay_to_address_script(&c.m.dests[0].address))
                }
                _ => return Err("breach cap|dest|floor|epoch".into()),
            };
            println!("breach         : {kind}: {} to {}", kas(amount), extract_script_pub_key_address(&pay_to, Prefix::Testnet)?);
            let mut mv = build_allocate(&c, slot, amount, pay_to)?;
            mv.kind = match kind { "cap" => "breach-cap", "dest" => "breach-dest", "floor" => "breach-floor", _ => "breach-epoch" };
            submit(&c.client, c.man, &c.m, mv, true).await?;
        }

        "recall" => {
            let c = open().await?;
            let slot: usize = arg(2)?.parse()?;
            let amount = parse_kas(arg(3)?)?;
            let role = format!("strategy-{slot}");
            let k = load_key(&role)?;
            let from = address_of(&k);
            let coin = largest(&c.client, &from, amount as u64).await?;
            let change = coin.entry.amount as i64 - amount;
            change_ok(change)?;
            let in_value = c.coin.entry.amount as i64;
            let mut n = c.state;
            n.deployed[slot] = (n.deployed[slot] - amount).max(0);
            let succ = compile(&c.m, &n)?;
            let landed = in_value + amount - FEE as i64;
            let mut outs = vec![cont(&succ, landed, c.cov)];
            if change > 0 { outs.push(out(change, pay_to_address_script(&from))); }
            let mut tx = tx_of(vec![input(&c.coin, VAULT_BUDGET), input(&coin, P2PK_BUDGET)], outs, 0);
            let entries = vec![c.coin.entry.clone(), coin.entry.clone()];
            let s0 = sighash_sig(&tx, &entries, 0, &load_key("allocator")?)?;
            let s1 = sighash_sig(&tx, &entries, 1, &k)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "recall", vec![state_expr(&n), Expr::int(slot as i64), Expr::int(amount), Expr::bytes(s0)])?;
            tx.inputs[1].signature_script = p2pk_sigscript(&s1)?;
            tx.finalize();
            println!("recall         : {} from {role} ({from})", kas(amount));
            let mv = Move { kind: "recall", tx, entries, next: Some(n), slot: Some(slot), amount, claimed_daa: None, value_after: landed };
            submit(&c.client, c.man, &c.m, mv, false).await?;
        }

        "deposit" => {
            let c = open().await?;
            let amount = parse_kas(arg(2)?)?;
            let k = load_key("depositor")?;
            let coin = largest(&c.client, &c.m.depositor, amount as u64).await?;
            let change = coin.entry.amount as i64 - amount;
            change_ok(change)?;
            let in_value = c.coin.entry.amount as i64;
            let mut n = c.state;
            n.principal += amount;
            let succ = compile(&c.m, &n)?;
            let landed = in_value + amount - FEE as i64;
            let mut outs = vec![cont(&succ, landed, c.cov)];
            if change > 0 { outs.push(out(change, pay_to_address_script(&c.m.depositor))); }
            let mut tx = tx_of(vec![input(&c.coin, VAULT_BUDGET), input(&coin, P2PK_BUDGET)], outs, 0);
            let entries = vec![c.coin.entry.clone(), coin.entry.clone()];
            let s0 = sighash_sig(&tx, &entries, 0, &k)?;
            let s1 = sighash_sig(&tx, &entries, 1, &k)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "deposit", vec![state_expr(&n), Expr::int(amount), Expr::bytes(s0)])?;
            tx.inputs[1].signature_script = p2pk_sigscript(&s1)?;
            tx.finalize();
            println!("deposit        : {}", kas(amount));
            let mv = Move { kind: "deposit", tx, entries, next: Some(n), slot: None, amount, claimed_daa: None, value_after: landed };
            submit(&c.client, c.man, &c.m, mv, false).await?;
        }

        "withdraw" => {
            let c = open().await?;
            let amount = parse_kas(arg(2)?)?;
            let in_value = c.coin.entry.amount as i64;
            let keep = in_value - amount - FEE as i64;
            if keep < KAS { return Err("use `close` to take everything".into()); }
            let mut n = c.state;
            n.principal = (n.principal - amount).max(0);
            let succ = compile(&c.m, &n)?;
            let mut tx = tx_of(vec![input(&c.coin, VAULT_BUDGET)], vec![cont(&succ, keep, c.cov), out(amount, pay_to_address_script(&c.m.depositor))], 0);
            let entries = vec![c.coin.entry.clone()];
            let sig = sighash_sig(&tx, &entries, 0, &load_key("depositor")?)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "withdraw", vec![state_expr(&n), Expr::int(amount), Expr::bytes(sig)])?;
            tx.finalize();
            println!("withdraw       : {} to the depositor", kas(amount));
            let mv = Move { kind: "withdraw", tx, entries, next: Some(n), slot: None, amount, claimed_daa: None, value_after: keep };
            submit(&c.client, c.man, &c.m, mv, false).await?;
        }

        cmd @ ("halt" | "close") => {
            let c = open().await?;
            let signer = if cmd == "halt" { "guardian" } else { "depositor" };
            let in_value = c.coin.entry.amount as i64;
            let paid = in_value - FEE as i64;
            let mut tx = tx_of(vec![input(&c.coin, VAULT_BUDGET)], vec![out(paid, pay_to_address_script(&c.m.depositor))], 0);
            let entries = vec![c.coin.entry.clone()];
            let sig = sighash_sig(&tx, &entries, 0, &load_key(signer)?)?;
            tx.inputs[0].signature_script = entry_sigscript(&c.cur, cmd, vec![Expr::bytes(sig)])?;
            tx.finalize();
            println!("{cmd:<15}: {} to the depositor, signed by the {signer}", kas(paid));
            let mv = Move { kind: if cmd == "halt" { "halt" } else { "close" }, tx, entries, next: None, slot: None, amount: paid, claimed_daa: None, value_after: 0 };
            submit(&c.client, c.man, &c.m, mv, false).await?;
        }

        "nav" => nav::run_nav(&args).await?,
        "credit" => credit::run_credit(&args).await?,

        _ => return Err(format!("unknown command {cmd}").into()),
    }
    Ok(())
}
