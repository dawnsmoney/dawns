//! Compute budget, measured. The flip tests run with the signature price
//! zeroed (like Warda's), which reads low; this runs every path at the real
//! price (1 checksig = 100,000 script units) and holds each under the budget
//! the deploy tool commits (deploy/src/main.rs VAULT_BUDGET).

use dawns_vault_harness::*;
use kaspa_consensus_core::hashing::sighash::SigHashReusedValuesUnsync;
use kaspa_consensus_core::tx::{PopulatedTransaction, Transaction, UtxoEntry, VerifiableTransaction};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine};
use silverscript_lang::ast::Expr;

const VAULT_BUDGET: u64 = 16; // keep in step with deploy/src/main.rs
const VAULT: i64 = 1_000 * KAS;
const FEE: i64 = 5_000;

fn units(tx: &Transaction, entries: Vec<UtxoEntry>) -> u64 {
    let reused = SigHashReusedValuesUnsync::new();
    let cache = Cache::new(100);
    let p = PopulatedTransaction::new(tx, entries);
    let cov = CovenantsContext::from_tx(&p).expect("cov ctx");
    let input = tx.inputs[0].clone();
    let mut vm = TxScriptEngine::from_transaction_input(
        &p, &input, 0, p.utxo(0).unwrap(),
        EngineCtx::new(&cache).with_reused(&reused).with_covenants_ctx(&cov),
        EngineFlags { covenants_enabled: true, ..Default::default() }, // real sigop price
    );
    vm.execute().expect("path must be valid to be measured");
    vm.used_script_units().0
}

fn signed(mut tx: Transaction, entries: &[UtxoEntry], k: &secp256k1::Keypair, build: impl Fn(Vec<u8>) -> Vec<u8>) -> Transaction {
    let sig = sign(&tx, entries.to_vec(), 0, k);
    tx.inputs[0].signature_script = build(sig);
    tx
}

#[test]
fn every_path_fits_the_committed_budget() {
    let m = Mandate::default();
    let limit = VAULT_BUDGET * 10_000 + 9_999;
    let mut report = Vec::new();

    // allocate
    let prev = Acct { principal: VAULT, ..Default::default() };
    let next = Acct { deployed: [300 * KAS, 0, 0, 0], epoch_index: 0, epoch_spent: 300 * KAS, ..prev };
    let (cur, succ) = (compile(&m, &prev), compile(&m, &next));
    let e = vec![vault_utxo(&cur, VAULT as u64)];
    let tx = new_tx(vec![tx_input(0, vec![])], vec![continuation(&succ, (VAULT - 300 * KAS - FEE) as u64), out_to((300 * KAS) as u64, p2pk_spk(xonly(&dest_keys()[0])))], 1_500);
    let tx = signed(tx, &e, &allocator(), |s| decl_sigscript(&cur, "allocate", vec![state(&next), Expr::int(0), Expr::int(300 * KAS), Expr::int(1_500), Expr::bytes(s)]));
    report.push(("allocate", units(&tx, e), tx.inputs[0].signature_script.len()));

    // recall
    let prev = next;
    let next = Acct { deployed: [100 * KAS, 0, 0, 0], ..prev };
    let (cur, succ) = (compile(&m, &prev), compile(&m, &next));
    let e = vec![vault_utxo(&cur, VAULT as u64), plain_utxo((200 * KAS) as u64, p2pk_spk(xonly(&stranger())))];
    let tx = new_tx(vec![tx_input(0, vec![]), tx_input(1, vec![])], vec![continuation(&succ, (VAULT + 200 * KAS - FEE) as u64)], 0);
    let tx = signed(tx, &e, &allocator(), |s| decl_sigscript(&cur, "recall", vec![state(&next), Expr::int(0), Expr::int(200 * KAS), Expr::bytes(s)]));
    report.push(("recall", units(&tx, e), tx.inputs[0].signature_script.len()));

    // deposit
    let next = Acct { principal: prev.principal + 50 * KAS, ..prev };
    let succ = compile(&m, &next);
    let e = vec![vault_utxo(&cur, VAULT as u64), plain_utxo((50 * KAS) as u64, p2pk_spk(xonly(&depositor())))];
    let tx = new_tx(vec![tx_input(0, vec![]), tx_input(1, vec![])], vec![continuation(&succ, (VAULT + 50 * KAS - FEE) as u64)], 0);
    let tx = signed(tx, &e, &depositor(), |s| decl_sigscript(&cur, "deposit", vec![state(&next), Expr::int(50 * KAS), Expr::bytes(s)]));
    report.push(("deposit", units(&tx, e), tx.inputs[0].signature_script.len()));

    // withdraw
    let next = Acct { principal: prev.principal - 100 * KAS, ..prev };
    let succ = compile(&m, &next);
    let e = vec![vault_utxo(&cur, VAULT as u64)];
    let tx = new_tx(vec![tx_input(0, vec![])], vec![continuation(&succ, (VAULT - 100 * KAS - FEE) as u64), out_to((100 * KAS) as u64, p2pk_spk(xonly(&depositor())))], 0);
    let tx = signed(tx, &e, &depositor(), |s| decl_sigscript(&cur, "withdraw", vec![state(&next), Expr::int(100 * KAS), Expr::bytes(s)]));
    report.push(("withdraw", units(&tx, e), tx.inputs[0].signature_script.len()));

    // halt, close
    for (f, k) in [("halt", guardian()), ("close", depositor())] {
        let e = vec![vault_utxo(&cur, VAULT as u64)];
        let tx = new_tx(vec![tx_input(0, vec![])], vec![out_to((VAULT - FEE) as u64, p2pk_spk(xonly(&depositor())))], 0);
        let tx = signed(tx, &e, &k, |s| entry_sigscript(&cur, f, vec![Expr::bytes(s)]));
        report.push((f, units(&tx, e), tx.inputs[0].signature_script.len()));
    }

    println!("covenant bytecode: {} bytes", cur.bytecode.len());
    for (f, u, sz) in &report {
        println!("{f:<9} {u:>8} script units  (budget {} covers {limit}; needs {})  sigscript {sz} bytes", VAULT_BUDGET, u.div_ceil(10_000));
        assert!(*u <= limit, "{f} uses {u} script units, over the committed budget's {limit}");
    }
}
