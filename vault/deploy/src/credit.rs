//! `credit …` — the credit vault (vault/credit/dawns_credit.sil) on testnet-10.
//!
//!   credit init                  role and borrower keys + draft credit-mandate.json
//!   credit genesis <kas>         seed the vault (the seed stays the vault's own)
//!   credit token                 guardian creates the share token (KCC-20) bound to the vault
//!   credit show                  the vault, its loans, NAV and share price
//!   credit verify                offline: this build compiles to the address credit.json records
//!   credit accounts <address>    a user's deposit and redeem addresses
//!   credit repay-address <slot>  where the slot's borrower pays the loan back (any wallet can pay it)
//!   credit pay <role> <kas> [redeem]
//!                                test helper: a role key pays its own deposit (or redeem) account
//!   credit repay <slot> <kas>    test helper: borrower-<slot> pays its repayment address
//!   credit keeper [once]         sweep repayments, write overdue markdowns, sweep deposits and redemptions
//!   credit lend <slot> <kas>     allocator lends to the slot's borrower
//!   credit mark <k0> <k1> <k2>   valuer marks the loans (KAS; "-" keeps a mark)
//!   credit writeoff <slot>       valuer closes a late loan already marked to zero
//!   credit halt                  guardian stops new loans and deposits for good
//!   credit publish               send credit.json to the site now (signed by the allocator key)
//!
//! Share token and personal accounts are the NAV vault's (same templates), so
//! the site's account and position code reads them unchanged. Accounts come from
//! the site's registry plus credit-accounts.txt.
//!
//! What the chain enforces and what it cannot is in the covenant's header. The
//! one thing this tool cannot make true: that a borrower repays at all.

use super::nav::*;
use super::*;

const CREDIT_SOURCE: &str = include_str!("../../credit/dawns_credit.sil");
const REPAY_SOURCE: &str = include_str!("../../credit/dawns_repay.sil");
const CREDIT_STANDARD: &str = "dawns-credit/0";
const SLOTS: usize = 3;
/// Compute budgets (×10,000 script units), measured with the harness
/// (DAWNS_UNITS=1): deposit 141k and redeem 147k units without a signature;
/// lend, mark, write-off 98k plus one checksig (100k); repay and markdown 98k
/// with none. Repayment accounts ~0.4k. The local engine refuses any move over
/// budget before it is broadcast.
const CREDIT_BUDGET: u16 = 28;
const REP_BUDGET: u16 = 1;
const LEDGER: &str = "credit.json";
const MANDATE: &str = "credit-mandate.json";
const ACCOUNTS: &str = "credit-accounts.txt";

// ---------------------------------------------------------------------------
// mandate
// ---------------------------------------------------------------------------
struct Borrower { label: String, address: Address, cap_bps: i64, term: i64, interest_bps: i64 }

struct CreditMandate {
    doc: Value,
    allocator: Address,
    valuer: Address,
    guardian: Address,
    borrowers: Vec<Borrower>,
    grace: i64,
    step_bps: i64,
    period: i64,
    reserve_floor_bps: i64,
    max_per_move: i64,
    epoch_limit: i64,
    epoch_length: i64,
    max_fee: i64,
    not_before: i64,
    maturity: i64,
    deposit_until: i64,
    min_deposit: i64,
    max_mark_step_bps: i64,
    note_value: i64,
    min_keep: i64,
    exit_fee_bps: i64,
}
impl CreditMandate {
    fn interest(&self, i: usize) -> i64 { self.borrowers.get(i).map(|b| b.interest_bps).unwrap_or(0) }
    /// The most a loan may count for at `at` (mirrors limitOf in the covenant).
    fn limit(&self, i: usize, s: &Credit, at: i64) -> i64 {
        let p = s.principal[i];
        let mut top = p * (10_000 + self.interest(i)) / 10_000;
        if s.due[i] > 0 && at - s.due[i] - self.grace >= 0 {
            let cut = (((at - s.due[i] - self.grace) / self.period + 1) * self.step_bps).min(10_000);
            top = p * (10_000 - cut) / 10_000;
        }
        top
    }
    /// NAV as every deposit and redemption prices it: late loans at their cap.
    fn nav(&self, s: &Credit, held: i64, at: i64) -> i64 {
        held - self.min_keep + (0..SLOTS).map(|i| s.marks[i].min(self.limit(i, s, at))).sum::<i64>()
    }
}

fn read_credit_mandate() -> Res<CreditMandate> {
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(MANDATE).map_err(|_| format!("no {MANDATE} — run `credit init`"))?)?;
    if doc["standard"] != CREDIT_STANDARD { return Err(format!("{MANDATE}: standard must be \"{CREDIT_STANDARD}\"").into()); }
    if doc["network"] != NETWORK { return Err(format!("{MANDATE}: network must be \"{NETWORK}\"").into()); }
    let role = |k: &str| -> Res<Address> { parse_addr(doc["roles"][k].as_str().ok_or(format!("roles.{k} missing"))?) };
    let (allocator, valuer, guardian) = (role("allocator")?, role("valuer")?, role("guardian")?);
    for a in [&allocator, &valuer, &guardian] { xonly_of(a)?; }
    if allocator == valuer || allocator == guardian || valuer == guardian { return Err("allocator, valuer and guardian must be three different keys".into()); }
    let list = doc["borrowers"].as_array().ok_or("borrowers must be a list")?;
    if list.is_empty() || list.len() > SLOTS { return Err(format!("1 to {SLOTS} borrowers").into()); }
    let mut borrowers = Vec::new();
    for (i, b) in list.iter().enumerate() {
        let address = parse_addr(b["address"].as_str().ok_or(format!("borrowers[{i}].address missing"))?)?;
        // a borrower's address must be a key: its repayment account is bound to it
        xonly_of(&address).map_err(|_| format!("borrowers[{i}].address must be a plain (P2PK) testnet address"))?;
        if [&allocator, &valuer, &guardian].contains(&&address) { return Err(format!("borrowers[{i}] is a role key").into()); }
        let cap_bps = b["capBps"].as_i64().ok_or(format!("borrowers[{i}].capBps missing"))?;
        let term = b["termDaa"].as_i64().ok_or(format!("borrowers[{i}].termDaa missing"))?;
        let interest_bps = b["interestBps"].as_i64().ok_or(format!("borrowers[{i}].interestBps missing"))?;
        if !(1..=10_000).contains(&cap_bps) { return Err(format!("borrowers[{i}].capBps must be 1..10000").into()); }
        if term <= 0 { return Err(format!("borrowers[{i}].termDaa must be positive").into()); }
        if !(0..=10_000).contains(&interest_bps) { return Err(format!("borrowers[{i}].interestBps must be 0..10000").into()); }
        borrowers.push(Borrower { label: b["label"].as_str().unwrap_or("").to_string(), address, cap_bps, term, interest_bps });
    }
    for i in 0..borrowers.len() { for j in 0..i { if borrowers[i].address == borrowers[j].address { return Err("each borrower slot needs its own address".into()); } } }
    let depu = int(&doc, "depositUntilDaa")?;
    let m = CreditMandate {
        allocator, valuer, guardian, borrowers,
        grace: int(&doc, "graceDaa")?,
        step_bps: int(&doc, "markdownStepBps")?,
        period: int(&doc, "markdownPeriodDaa")?,
        reserve_floor_bps: int(&doc, "reserveFloorBps")?,
        max_per_move: int(&doc, "maxPerMoveSompi")?,
        epoch_limit: int(&doc, "epochLimitSompi")?,
        epoch_length: int(&doc, "epochLengthDaa")?,
        max_fee: int(&doc, "maxFeeSompi")?,
        not_before: int(&doc, "notBeforeDaa")?,
        maturity: int(&doc, "maturityDaa")?,
        deposit_until: if depu == 0 { i64::MAX / 4 } else { depu },
        min_deposit: int(&doc, "minDepositSompi")?,
        max_mark_step_bps: int(&doc, "maxMarkStepBps")?,
        note_value: int(&doc, "noteValueSompi")?,
        min_keep: int(&doc, "minKeepSompi")?,
        exit_fee_bps: int(&doc, "exitFeeBps")?,
        doc,
    };
    if m.max_fee <= FEE as i64 || m.max_fee > KAS { return Err("maxFeeSompi must exceed the tool's fee and stay under 1 KAS".into()); }
    if m.note_value < KAS || m.min_keep < KAS { return Err("noteValueSompi and minKeepSompi must be at least 1 KAS (storage mass)".into()); }
    if m.epoch_length <= 0 || m.period <= 0 || m.grace < 0 { return Err("epochLengthDaa and markdownPeriodDaa must be positive, graceDaa not negative".into()); }
    if !(0..=10_000).contains(&m.reserve_floor_bps) || !(0..=10_000).contains(&m.max_mark_step_bps) || !(0..=10_000).contains(&m.step_bps) || !(0..=1_000).contains(&m.exit_fee_bps) { return Err("bad limits".into()); }
    if m.maturity > 0 { for (i, b) in m.borrowers.iter().enumerate() { if m.not_before + b.term > m.maturity { return Err(format!("borrowers[{i}]: a loan's term must fit before maturity").into()); } } }
    Ok(m)
}

// ---------------------------------------------------------------------------
// state and contracts
// ---------------------------------------------------------------------------
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Credit { share_covid: [u8; 32], shares: i64, principal: [i64; SLOTS], due: [i64; SLOTS], marks: [i64; SLOTS], epoch_index: i64, epoch_spent: i64, mark_epoch: i64, halted: bool }
impl Credit {
    fn fresh() -> Credit { Credit { share_covid: [0; 32], shares: 0, principal: [0; SLOTS], due: [0; SLOTS], marks: [0; SLOTS], epoch_index: 0, epoch_spent: 0, mark_epoch: -1, halted: false } }
    fn to_json(self) -> Value {
        json!({ "shareCovid": hex(&self.share_covid), "shares": self.shares, "principal": self.principal, "due": self.due, "marks": self.marks,
                "epochIndex": self.epoch_index, "epochSpent": self.epoch_spent, "markEpoch": self.mark_epoch, "halted": self.halted })
    }
    fn from_json(v: &Value) -> Res<Credit> {
        let arr = |k: &str| -> Res<[i64; SLOTS]> {
            let a = v[k].as_array().ok_or(format!("state.{k}"))?;
            if a.len() != SLOTS { return Err(format!("state.{k} must have {SLOTS} entries").into()); }
            let mut o = [0i64; SLOTS];
            for (i, x) in a.iter().enumerate() { o[i] = x.as_i64().ok_or(format!("state.{k}"))?; }
            Ok(o)
        };
        let mut sc = [0u8; 32];
        sc.copy_from_slice(&unhex(v["shareCovid"].as_str().ok_or("state.shareCovid")?)?);
        Ok(Credit { share_covid: sc, shares: int(v, "shares")?, principal: arr("principal")?, due: arr("due")?, marks: arr("marks")?,
                    epoch_index: int(v, "epochIndex")?, epoch_spent: int(v, "epochSpent")?, mark_epoch: int(v, "markEpoch")?, halted: v["halted"].as_bool().unwrap_or(false) })
    }
}

fn compile_repay(owner: [u8; 32], vault: &[u8], slot: i64) -> Res<CompiledContract<'static>> {
    compile_contract(REPAY_SOURCE, &[Expr::bytes(owner.to_vec()), Expr::bytes(vault.to_vec()), Expr::int(slot)], CompileOptions::default())
        .map_err(|e| format!("repay account: {e:?}").into())
}
fn repay_template() -> Res<(Vec<u8>, Vec<u8>, [u8; 32])> { Ok(template_parts(&compile_repay([0; 32], &[0; 32], 0)?)) }
/// The slot's repayment account: owned by the borrower (who may reclaim an
/// unswept payment), spendable otherwise only into this vault's repay path.
fn repay_account(m: &CreditMandate, cov: &Hash, slot: usize) -> Res<(Address, CompiledContract<'static>)> {
    let b = m.borrowers.get(slot).ok_or("no borrower in that slot")?;
    let c = compile_repay(xonly_of(&b.address)?, &cov.as_bytes(), slot as i64)?;
    Ok((p2sh_addr(&c)?, c))
}

fn credit_ctor(m: &CreditMandate, s: &Credit) -> Res<Vec<Expr<'static>>> {
    let (kp, ks, kh) = kcc_template()?;
    let (_ap, asuf, ah) = account_template()?;
    let (_rp, rsuf, rh) = repay_template()?;
    let b = |i: usize| m.borrowers.get(i);
    let mut v = vec![Expr::bytes(xonly_of(&m.allocator)?.to_vec()), Expr::bytes(xonly_of(&m.valuer)?.to_vec()), Expr::bytes(xonly_of(&m.guardian)?.to_vec()), Expr::int(m.max_fee)];
    for i in 0..SLOTS { v.push(Expr::bytes(b(i).map(|x| b2b(&spk_bytes(&pay_to_address_script(&x.address)))).unwrap_or([0u8; 32]).to_vec())); }
    for i in 0..SLOTS { v.push(Expr::int(b(i).map(|x| x.cap_bps).unwrap_or(0))); }
    for i in 0..SLOTS { v.push(Expr::int(b(i).map(|x| x.term).unwrap_or(0))); }
    for i in 0..SLOTS { v.push(Expr::int(b(i).map(|x| x.interest_bps).unwrap_or(0))); }
    for x in [m.grace, m.step_bps, m.period, m.reserve_floor_bps, m.max_per_move, m.epoch_limit, m.epoch_length, m.not_before, m.maturity, m.deposit_until, m.min_deposit, m.max_mark_step_bps, m.note_value, m.min_keep, m.exit_fee_bps] { v.push(Expr::int(x)); }
    v.push(Expr::int(kp.len() as i64));
    v.push(Expr::int(ks.len() as i64));
    v.push(Expr::bytes(kh.to_vec()));
    v.push(Expr::int(asuf.len() as i64));
    v.push(Expr::bytes(ah.to_vec()));
    v.push(Expr::dynamic_bytes(asuf));
    v.push(Expr::int(rsuf.len() as i64));
    v.push(Expr::bytes(rh.to_vec()));
    v.push(Expr::bytes(mandate_hash(&m.doc).to_vec()));
    v.push(Expr::bytes(s.share_covid.to_vec()));
    v.push(Expr::int(s.shares));
    for x in s.principal { v.push(Expr::int(x)); }
    for x in s.due { v.push(Expr::int(x)); }
    for x in s.marks { v.push(Expr::int(x)); }
    v.push(Expr::int(s.epoch_index));
    v.push(Expr::int(s.epoch_spent));
    v.push(Expr::int(s.mark_epoch));
    v.push(Expr::bool(s.halted));
    Ok(v)
}
fn compile_credit(m: &CreditMandate, s: &Credit) -> Res<CompiledContract<'static>> {
    compile_contract(CREDIT_SOURCE, &credit_ctor(m, s)?, CompileOptions::default()).map_err(|e| format!("compile: {e:?}").into())
}
fn credit_state(s: &Credit) -> Expr<'static> {
    let mut f: Vec<(&str, Expr<'static>)> = vec![("shareCovid", Expr::bytes(s.share_covid.to_vec())), ("shares", Expr::int(s.shares))];
    for (i, n) in ["principal0", "principal1", "principal2"].into_iter().enumerate() { f.push((n, Expr::int(s.principal[i]))); }
    for (i, n) in ["due0", "due1", "due2"].into_iter().enumerate() { f.push((n, Expr::int(s.due[i]))); }
    for (i, n) in ["mark0", "mark1", "mark2"].into_iter().enumerate() { f.push((n, Expr::int(s.marks[i]))); }
    f.push(("epochIndex", Expr::int(s.epoch_index)));
    f.push(("epochSpent", Expr::int(s.epoch_spent)));
    f.push(("markEpoch", Expr::int(s.mark_epoch)));
    f.push(("halted", Expr::bool(s.halted)));
    struct_object("State", f)
}

// ---------------------------------------------------------------------------
// ledger (credit.json)
// ---------------------------------------------------------------------------
struct Ledger { v: Value }
impl Ledger {
    fn read() -> Res<Ledger> {
        let v: Value = serde_json::from_str(&std::fs::read_to_string(LEDGER).map_err(|_| format!("no {LEDGER} — run `credit genesis`"))?)?;
        if v["status"] == "planned" { return Err(format!("{LEDGER} is the site's placeholder — run `credit genesis`").into()); }
        Ok(Ledger { v })
    }
    fn write(&self) -> Res<()> {
        let tmp = format!("{LEDGER}.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(&self.v)? + "\n")?;
        std::fs::rename(&tmp, LEDGER)?;
        Ok(())
    }
    fn state(&self) -> Res<Credit> { Credit::from_json(&self.v["state"]) }
    fn cov(&self) -> Res<Hash> { Ok(self.v["covenantId"].as_str().ok_or("covenantId")?.parse()?) }
    fn share_cov(&self) -> Res<Hash> { Ok(self.v["shareCovid"].as_str().ok_or("share token not created — run `credit token`")?.parse()?) }
    fn push(&mut self, k: &str, x: Value) { let mut a = self.v[k].as_array().cloned().unwrap_or_default(); a.push(x); self.v[k] = Value::Array(a); }
}

/// Publish the ledger to the site (POST /api/vaults/ledger?kind=credit), signed
/// by the allocator key over blake2b-256 of the exact body. Best effort.
fn publish(led: &Ledger) {
    let run = || -> Res<String> {
        let body = serde_json::to_string(&led.v)?;
        let k = load_key("allocator")?;
        let msg = secp256k1::Message::from_digest_slice(&b2b(body.as_bytes()))?;
        let sig = k.sign_schnorr(msg);
        let site = std::env::var("DAWNS_SITE").unwrap_or_else(|_| "https://www.dawns.money".into());
        let r = ureq::post(&format!("{site}/api/vaults/ledger?kind=credit")).set("content-type", "application/json").set("x-dawns-sig", &hex(sig.as_ref())).timeout(Duration::from_secs(15)).send_string(&body);
        match r { Ok(x) => Ok(x.into_string().unwrap_or_default()), Err(ureq::Error::Status(c, x)) => Err(format!("{c} {}", x.into_string().unwrap_or_default()).into()), Err(e) => Err(e.to_string().into()) }
    };
    match run() { Ok(r) => println!("published      : {r}"), Err(e) => println!("publish failed : {e} (git still works: commit {LEDGER})") }
}

struct CCtx { client: KaspaRpcClient, m: CreditMandate, led: Ledger, state: Credit, cur: CompiledContract<'static>, coin: Coin, cov: Hash, daa: i64 }

async fn open_credit() -> Res<CCtx> {
    let m = read_credit_mandate()?;
    let led = Ledger::read()?;
    if led.v["mandateHash"].as_str() != Some(&hex(&mandate_hash(&m.doc))) { return Err(format!("{MANDATE} no longer matches the vault's mandate hash").into()); }
    let client = connect().await?;
    let daa = ready(&client).await?;
    let state = led.state()?;
    let cur = compile_credit(&m, &state)?;
    let addr = p2sh_addr(&cur)?;
    if led.v["address"].as_str() != Some(&addr.to_string()) { return Err(format!("{LEDGER} address does not match its state").into()); }
    let cov = led.cov()?;
    let coin = vault_coin(&client, &addr, cov).await?;
    Ok(CCtx { client, m, led, state, cur, coin, cov, daa })
}

/// Broadcast a vault move and record the new state. The ledger is written
/// before broadcasting (with the move marked pending).
async fn commit(c: &mut CCtx, kind: &str, tx: Transaction, entries: Vec<UtxoEntry>, next: Credit, value_after: i64, extra: Value) -> Res<String> {
    let used = validate(&tx, &entries).map_err(|e| format!("local engine refused {kind}: {e:?} — not broadcast"))?;
    println!("local engine   : ACCEPTED (script units per input {used:?})");
    if std::env::var("DAWNS_DRY").is_ok() { println!("dry run        : not broadcast (txid would be {})", tx.id()); return Ok(tx.id().to_string()); }
    let next_addr = p2sh_addr(&compile_credit(&c.m, &next)?)?.to_string();
    let at = (c.daa - DAA_BACKOFF).max(c.m.not_before);
    c.led.v["pending"] = json!({ "txid": tx.id().to_string(), "kind": kind, "state": next.to_json(), "address": next_addr, "value": value_after });
    c.led.write()?;
    match c.client.submit_transaction((&tx).into(), false).await {
        Ok(id) => {
            let mut rec = json!({ "kind": kind, "txid": id.to_string(), "at": now(), "daa": c.daa, "valueAfter": value_after, "sharesAfter": next.shares, "navAfter": c.m.nav(&next, value_after, at) });
            if let (Some(o), Some(e)) = (rec.as_object_mut(), extra.as_object()) { for (k, v) in e { o.insert(k.clone(), v.clone()); } }
            c.led.push("moves", rec);
            c.led.v["state"] = next.to_json();
            c.led.v["address"] = json!(next_addr);
            c.led.v["value"] = json!(value_after);
            c.led.v["pending"] = Value::Null;
            c.led.write()?;
            println!("accepted. txid : {id}\nvault moved to : {next_addr}");
            publish(&c.led);
            Ok(id.to_string())
        }
        Err(e) => { c.led.v["pending"] = Value::Null; c.led.write()?; Err(format!("rejected by the node: {e}").into()) }
    }
}

/// After a move, wait until the vault's new coin is visible (the next move spends it).
async fn await_vault(c: &mut CCtx) -> Res<()> {
    let st = c.led.state()?;
    let cur = compile_credit(&c.m, &st)?;
    let addr = p2sh_addr(&cur)?;
    for _ in 0..60 {
        if let Ok(coin) = vault_coin(&c.client, &addr, c.cov).await { c.state = st; c.cur = cur; c.coin = coin; c.daa = ready(&c.client).await?; return Ok(()); }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
    Err("the vault's new coin did not appear within a minute".into())
}

fn claimed(c: &CCtx) -> Res<i64> {
    let d = c.daa - DAA_BACKOFF;
    if d < c.m.not_before { return Err(format!("the mandate starts at DAA {}; the chain is at {}", c.m.not_before, c.daa).into()); }
    Ok(d)
}

async fn minter_coin(c: &CCtx) -> Res<(Coin, CompiledContract<'static>)> {
    let sc = c.led.share_cov()?;
    let minter = compile_kcc(&c.cov.as_bytes(), ID_COVENANT, 0, true)?;
    let mut cs = coins(&c.client, &p2sh_addr(&minter)?).await?;
    cs.retain(|x| x.entry.covenant_id == Some(sc));
    if cs.len() != 1 { return Err(format!("expected one share-token minter coin, found {}", cs.len()).into()); }
    Ok((cs.remove(0), minter))
}

fn registered(cov: &Hash) -> Vec<String> {
    let mut out: Vec<String> = std::fs::read_to_string(ACCOUNTS).unwrap_or_default().lines().map(|l| l.trim().to_string()).filter(|l| l.starts_with("kaspatest:")).collect();
    let site = std::env::var("DAWNS_SITE").unwrap_or_else(|_| "https://www.dawns.money".into());
    match ureq::get(&format!("{site}/api/vaults/accounts?vault={cov}")).timeout(Duration::from_secs(10)).call() {
        Ok(r) => {
            if let Ok(v) = r.into_json::<Value>() {
                for a in v["accounts"].as_array().cloned().unwrap_or_default() { if let Some(s) = a.as_str() { out.push(s.to_string()); } }
            }
        }
        Err(e) => println!("registry       : {site} unavailable ({e}); using {ACCOUNTS} only"),
    }
    out.sort();
    out.dedup();
    out
}

// ---------------------------------------------------------------------------
// keyless moves the keeper runs: repayments, markdowns, deposits, redemptions
// ---------------------------------------------------------------------------
async fn sweep_repayment(c: &mut CCtx, slot: usize, acct: &CompiledContract<'static>, coin: Coin) -> Res<()> {
    let amount = coin.entry.amount as i64;
    if amount <= c.m.max_fee { println!("skip           : repayment of {} to slot {slot} is below the fee (the borrower can reclaim it)", kas(amount)); return Ok(()); }
    let mut n = c.state;
    n.principal[slot] -= amount;
    n.marks[slot] = (n.marks[slot] - amount).max(0);
    if n.principal[slot] <= 0 { n.principal[slot] = 0; n.due[slot] = 0; n.marks[slot] = 0; }
    let held = c.coin.entry.amount as i64;
    let landed = held + amount - c.m.max_fee;
    let succ = compile_credit(&c.m, &n)?;
    let mut tx = tx_of(vec![input(&c.coin, CREDIT_BUDGET), input(&coin, REP_BUDGET)], vec![cont(&succ, landed, c.cov)], 0);
    let entries = vec![c.coin.entry.clone(), coin.entry.clone()];
    tx.inputs[0].signature_script = decl_sigscript(&c.cur, "repay", vec![credit_state(&n)])?;
    tx.inputs[1].signature_script = entry_sigscript(acct, "enter", vec![])?;
    tx.finalize();
    let what = if c.state.principal[slot] == 0 { "recovery (no open loan: all of it is NAV gain)".to_string() } else if n.principal[slot] == 0 { "loan repaid in full".to_string() } else { format!("{} still owed", kas(n.principal[slot])) };
    println!("repay          : {} into slot {slot} ({}) · {what}", kas(amount), c.m.borrowers[slot].label);
    commit(c, "repay", tx, entries, n, landed, json!({ "slot": slot, "amount": amount })).await?;
    await_vault(c).await
}

async fn write_markdown(c: &mut CCtx, slot: usize) -> Res<bool> {
    let at = claimed(c)?;
    let cap = c.m.limit(slot, &c.state, at);
    if c.state.marks[slot] <= cap { return Ok(false); }
    let mut n = c.state;
    n.marks[slot] = cap;
    let held = c.coin.entry.amount as i64;
    let keep = held - c.m.max_fee;
    let succ = compile_credit(&c.m, &n)?;
    let mut tx = tx_of(vec![input(&c.coin, CREDIT_BUDGET)], vec![cont(&succ, keep, c.cov)], at as u64);
    let entries = vec![c.coin.entry.clone()];
    tx.inputs[0].signature_script = decl_sigscript(&c.cur, "markdown", vec![credit_state(&n), Expr::int(slot as i64), Expr::int(at)])?;
    tx.finalize();
    println!("markdown       : slot {slot} ({}) is late: mark {} → {}", c.m.borrowers[slot].label, kas(c.state.marks[slot]), kas(cap));
    commit(c, "markdown", tx, entries, n, keep, json!({ "slot": slot, "from": c.state.marks[slot], "to": cap, "claimedDaa": at })).await?;
    await_vault(c).await?;
    Ok(true)
}

async fn sweep_deposit(c: &mut CCtx, owner: [u8; 32], owner_addr: &str, acct: &CompiledContract<'static>, coin: Coin) -> Res<()> {
    let sc = c.led.share_cov()?;
    let (mcoin, minter) = minter_coin(c).await?;
    let paid = coin.entry.amount as i64;
    let credit = paid - c.m.note_value - c.m.max_fee;
    if credit < c.m.min_deposit { println!("skip           : {owner_addr} sent {} (below the minimum; the owner can reclaim it)", kas(paid)); return Ok(()); }
    let at = claimed(c)?;
    if at >= c.m.deposit_until { println!("skip           : {owner_addr}: deposits closed at DAA {} (the owner can reclaim)", c.m.deposit_until); return Ok(()); }
    let held = c.coin.entry.amount as i64;
    let price = price_up(c.m.nav(&c.state, held, at), c.state.shares);
    let minted = credit / price;
    if minted <= 0 { println!("skip           : {owner_addr}: {} buys no share at {price} sompi", kas(paid)); return Ok(()); }
    let next = Credit { shares: c.state.shares + minted, ..c.state };
    let succ = compile_credit(&c.m, &next)?;
    let rh = redeem_hash(owner, &c.cov.as_bytes())?;
    let note = compile_kcc(&rh, ID_SCRIPT_HASH, minted, false)?;
    let vault_out = held + paid - c.m.note_value - c.m.max_fee;
    let mut tx = tx_of(
        vec![input(&c.coin, CREDIT_BUDGET), input(&coin, ACC_BUDGET), input(&mcoin, KCC_BUDGET)],
        vec![cont(&succ, vault_out, c.cov), cov_out(&minter, mcoin.entry.amount as i64, 2, sc), cov_out(&note, c.m.note_value, 2, sc)],
        at as u64,
    );
    let entries = vec![c.coin.entry.clone(), coin.entry.clone(), mcoin.entry.clone()];
    tx.inputs[0].signature_script = decl_sigscript(&c.cur, "deposit", vec![credit_state(&next), Expr::int(at)])?;
    tx.inputs[1].signature_script = entry_sigscript(acct, "enter", vec![])?;
    tx.inputs[2].signature_script = leader_sigscript(&minter, "transfer", vec![
        kcc_states(vec![(c.cov.as_bytes().to_vec(), ID_COVENANT, 0, true), (rh.to_vec(), ID_SCRIPT_HASH, minted, false)]),
        empty_sigs(), Expr::dynamic_bytes(vec![0])])?;
    tx.finalize();
    println!("deposit        : {} from {owner_addr} → {minted} shares at {price} sompi", kas(paid));
    let id = commit(c, "deposit", tx, entries, next, vault_out, json!({ "owner": owner_addr, "paid": paid, "shares": minted, "price": price })).await?;
    c.led.push("notes", json!({ "owner": owner_addr, "shares": minted, "txid": id, "index": 2, "value": c.m.note_value, "at": now(), "price": price }));
    c.led.write()?;
    publish(&c.led);
    await_vault(c).await
}

async fn sweep_redeem(c: &mut CCtx, owner: [u8; 32], owner_addr: &str, acct: &CompiledContract<'static>, coin: Coin) -> Res<()> {
    let sc = c.led.share_cov()?;
    let notes = c.led.v["notes"].as_array().cloned().unwrap_or_default();
    let rh = redeem_hash(owner, &c.cov.as_bytes())?;
    let mut found = None;
    for (i, n) in notes.iter().enumerate() {
        if n["owner"].as_str() != Some(owner_addr) || !n["redeemed"].is_null() { continue; }
        let shares = n["shares"].as_i64().ok_or("note.shares")?;
        let note = compile_kcc(&rh, ID_SCRIPT_HASH, shares, false)?;
        let mut cs = coins(&c.client, &p2sh_addr(&note)?).await?;
        cs.retain(|x| x.entry.covenant_id == Some(sc) && x.outpoint.transaction_id.to_string() == n["txid"].as_str().unwrap_or(""));
        if let Some(nc) = cs.into_iter().next() { found = Some((i, shares, note, nc)); break; }
    }
    let Some((ni, shares, note, ncoin)) = found else { println!("skip           : {owner_addr} asked to redeem but holds no live note"); return Ok(()); };
    let at = claimed(c)?;
    if at < c.m.maturity { println!("wait           : {owner_addr}: fixed term, redemptions open at DAA {}", c.m.maturity); return Ok(()); }
    let (mcoin, minter) = minter_coin(c).await?;
    let held = c.coin.entry.amount as i64;
    let gross = shares * (c.m.nav(&c.state, held, at) / c.state.shares);
    let payout = gross - gross * c.m.exit_fee_bps / 10_000;
    if held - payout < c.m.min_keep { println!("wait           : {owner_addr}: {} due, the vault holds {} liquid — waits for repayments", kas(payout), kas(held - c.m.min_keep)); return Ok(()); }
    let next = Credit { shares: c.state.shares - shares, ..c.state };
    let succ = compile_credit(&c.m, &next)?;
    let to_owner = payout + coin.entry.amount as i64 + ncoin.entry.amount as i64 - c.m.max_fee;
    let vault_out = held - payout;
    let mut tx = tx_of(
        vec![input(&c.coin, CREDIT_BUDGET), input(&coin, ACC_BUDGET), input(&mcoin, KCC_BUDGET), input(&ncoin, KCC_BUDGET)],
        vec![cont(&succ, vault_out, c.cov), cov_out(&minter, mcoin.entry.amount as i64, 2, sc), out(to_owner, pay_to_address_script(&parse_addr(owner_addr)?))],
        at as u64,
    );
    let entries = vec![c.coin.entry.clone(), coin.entry.clone(), mcoin.entry.clone(), ncoin.entry.clone()];
    tx.inputs[0].signature_script = decl_sigscript(&c.cur, "redeem", vec![credit_state(&next), Expr::int(at)])?;
    tx.inputs[1].signature_script = entry_sigscript(acct, "enter", vec![])?;
    tx.inputs[2].signature_script = leader_sigscript(&minter, "transfer", vec![kcc_states(vec![(c.cov.as_bytes().to_vec(), ID_COVENANT, 0, true)]), empty_sigs(), Expr::dynamic_bytes(vec![0, 1])])?;
    tx.inputs[3].signature_script = decl_sigscript(&note, "transfer", vec![])?;
    tx.finalize();
    println!("redeem         : {shares} shares of {owner_addr} → {} to the owner", kas(to_owner));
    let id = commit(c, "redeem", tx, entries, next, vault_out, json!({ "owner": owner_addr, "shares": shares, "payout": to_owner })).await?;
    c.led.v["notes"][ni]["redeemed"] = json!({ "txid": id, "at": now(), "payout": to_owner });
    c.led.write()?;
    publish(&c.led);
    await_vault(c).await
}

async fn keeper_pass(c: &mut CCtx) -> Res<usize> {
    let mut done = 0;
    // 1. repayments first: they lower what is owed before anything is priced
    for slot in 0..c.m.borrowers.len() {
        let (addr, acct) = repay_account(&c.m, &c.cov, slot)?;
        for coin in coins(&c.client, &addr).await? {
            if coin.entry.covenant_id.is_some() { continue; }
            match sweep_repayment(c, slot, &acct, coin).await { Ok(()) => done += 1, Err(e) => println!("repay failed   : slot {slot}: {e}") }
        }
    }
    // 2. overdue loans: write the schedule's cap into the state
    for slot in 0..c.m.borrowers.len() {
        match write_markdown(c, slot).await { Ok(true) => done += 1, Ok(false) => {}, Err(e) => println!("markdown failed: slot {slot}: {e}") }
    }
    // 3. deposits and redemptions of every registered account
    for a in registered(&c.cov) {
        let Ok(owner) = owner_of(&a) else { continue };
        let (dep_addr, red_addr, dep, red) = accounts_of(owner, &c.cov)?;
        for coin in coins(&c.client, &dep_addr).await? {
            if coin.entry.covenant_id.is_some() { continue; }
            if c.state.halted { println!("skip           : {a}: the vault is halted, deposits are closed (the owner can reclaim)"); break; }
            match sweep_deposit(c, owner, &a, &dep, coin).await { Ok(()) => done += 1, Err(e) => println!("deposit failed : {a}: {e}") }
        }
        for coin in coins(&c.client, &red_addr).await? {
            if coin.entry.covenant_id.is_some() { continue; }
            match sweep_redeem(c, owner, &a, &red, coin).await { Ok(()) => done += 1, Err(e) => println!("redeem failed  : {a}: {e}") }
        }
    }
    Ok(done)
}

fn print_credit(c: &CCtx) {
    let held = c.coin.entry.amount as i64;
    let at = (c.daa - DAA_BACKOFF).max(c.m.not_before);
    println!("vault address  : {}", c.led.v["address"].as_str().unwrap_or(""));
    println!("share token    : {}", c.led.v["shareCovid"].as_str().unwrap_or("not created"));
    println!("held           : {} (of which the vault's own seed {})", kas(held), kas(c.m.min_keep));
    println!("chain DAA      : {}", c.daa);
    for (i, b) in c.m.borrowers.iter().enumerate() {
        let s = &c.state;
        if s.principal[i] == 0 { println!("  [{i}] {:<26} free · cap {}% of NAV, {}% over {} DAA", b.label, b.cap_bps as f64 / 100.0, b.interest_bps as f64 / 100.0, b.term); continue; }
        let late = at - s.due[i];
        let when = if late < 0 { format!("due in {} DAA", -late) } else if late < c.m.grace { format!("{late} DAA late, in grace") } else { format!("{late} DAA late") };
        println!("  [{i}] {:<26} owed {:>14}  mark {:>14}  counts {:>14}  {when}", b.label, kas(s.principal[i]), kas(s.marks[i]), kas(s.marks[i].min(c.m.limit(i, s, at))));
    }
    let nav = c.m.nav(&c.state, held, at);
    println!("NAV            : {} (late loans at their cap)", kas(nav));
    println!("shares         : {}", c.state.shares);
    if c.state.shares > 0 { println!("price / share  : {} sompi", nav / c.state.shares); }
    println!("halted         : {}", c.state.halted);
    let live = c.led.v["notes"].as_array().map(|a| a.iter().filter(|n| n["redeemed"].is_null()).count()).unwrap_or(0);
    println!("notes live     : {live}");
}

/// A plain payment from a role key (test helper).
async fn pay_from(role: &str, to: &Address, amount: i64) -> Res<(Address, String)> {
    let k = load_key(role)?;
    let from = address_of(&k);
    let client = connect().await?;
    ready(&client).await?;
    let coin = largest(&client, &from, (amount + FEE as i64) as u64).await?;
    let change = coin.entry.amount as i64 - amount - FEE as i64;
    change_ok(change)?;
    let mut outs = vec![out(amount, pay_to_address_script(to))];
    if change > 0 { outs.push(out(change, pay_to_address_script(&from))); }
    let mut tx = tx_of(vec![input(&coin, P2PK_BUDGET)], outs, 0);
    let entries = vec![coin.entry.clone()];
    tx.inputs[0].signature_script = p2pk_sigscript(&sighash_sig(&tx, &entries, 0, &k)?)?;
    tx.finalize();
    let id = client.submit_transaction((&tx).into(), false).await?;
    Ok((from, id.to_string()))
}

// ---------------------------------------------------------------------------
pub async fn run_credit(args: &[String]) -> Res<()> {
    let sub = args.get(2).map(String::as_str).unwrap_or("show");
    let arg = |i: usize| -> Res<&str> { args.get(i).map(String::as_str).ok_or_else(|| "usage: see the header of src/credit.rs".into()) };
    match sub {
        "init" => {
            for r in ["allocator", "guardian", "valuer", "depositor", "borrower-0", "borrower-1", "borrower-2"] {
                let made = make_key(r)?;
                println!("{:<11} {} {}", r, address_of(&load_key(r)?), if made { "(new)" } else { "(kept)" });
            }
            if std::path::Path::new(MANDATE).exists() { println!("\n{MANDATE} exists — left as is."); return Ok(()); }
            let a = |r: &str| -> Res<String> { Ok(address_of(&load_key(r)?).to_string()) };
            // testnet-10 runs 10 blocks a second: 36,000 DAA is an hour, 864,000 a day
            let doc = json!({
                "standard": CREDIT_STANDARD, "network": NETWORK,
                "name": "Dawns TN10 credit vault",
                "objective": "Open to anyone on testnet-10: deposit KAS, receive shares at NAV. Up to three fixed-term loans to named borrowers (Dawns-held test keys standing in for real institutions). Repayments come back through keyless repayment accounts; late loans are marked down on a schedule anyone can enforce.",
                "manager": "dawns",
                "roles": { "allocator": a("allocator")?, "valuer": a("valuer")?, "guardian": a("guardian")? },
                "borrowers": [
                    { "label": "Borrower A (test key)", "address": a("borrower-0")?, "capBps": 4000, "termDaa": 864_000, "interestBps": 100 },
                    { "label": "Borrower B (test key)", "address": a("borrower-1")?, "capBps": 3000, "termDaa": 3 * 864_000, "interestBps": 300 },
                    { "label": "Borrower C (test key)", "address": a("borrower-2")?, "capBps": 2000, "termDaa": 36_000, "interestBps": 10 }
                ],
                "graceDaa": 36_000, "markdownStepBps": 2500, "markdownPeriodDaa": 36_000,
                "reserveFloorBps": 2000, "maxPerMoveSompi": 50 * KAS, "epochLimitSompi": 100 * KAS, "epochLengthDaa": 36_000,
                "maxFeeSompi": 10_000_000, "notBeforeDaa": 0, "maturityDaa": 0, "depositUntilDaa": 0,
                "minDepositSompi": 5 * KAS, "maxMarkStepBps": 500, "noteValueSompi": KAS, "minKeepSompi": KAS, "exitFeeBps": 25
            });
            std::fs::write(MANDATE, serde_json::to_string_pretty(&doc)? + "\n")?;
            println!("\nwrote {MANDATE} (draft — fixed at genesis). Borrower C's one-hour term is there to exercise late loans on testnet.");
        }

        "genesis" => {
            if Ledger::read().is_ok() { return Err(format!("{LEDGER} exists: one credit vault per directory").into()); }
            let seed = parse_kas(arg(3)?)?;
            let client = connect().await?;
            let daa = ready(&client).await?;
            let mut doc: Value = serde_json::from_str(&std::fs::read_to_string(MANDATE)?)?;
            if doc["notBeforeDaa"].as_i64() == Some(0) { doc["notBeforeDaa"] = json!(daa - DAA_BACKOFF); std::fs::write(MANDATE, serde_json::to_string_pretty(&doc)? + "\n")?; }
            let m = read_credit_mandate()?;
            if seed < m.min_keep + MINTER_DUST + 2 * m.max_fee { return Err(format!("seed at least {}", kas(m.min_keep + MINTER_DUST + 2 * m.max_fee)).into()); }
            let payer = load_key("depositor")?;
            let from = address_of(&payer);
            let funding = largest(&client, &from, (seed + FEE as i64) as u64).await?;
            let change = funding.entry.amount as i64 - seed - FEE as i64;
            change_ok(change)?;
            let st = Credit::fresh();
            let contract = compile_credit(&m, &st)?;
            let unbound = out(seed, pay_to_script_hash_script(&contract.bytecode));
            let cov = covenant_id(funding.outpoint, std::iter::once((0u32, &unbound)));
            let mut outs = vec![cont(&contract, seed, cov)];
            if change > 0 { outs.push(out(change, pay_to_address_script(&from))); }
            let mut tx = tx_of(vec![input(&funding, P2PK_BUDGET)], outs, 0);
            let entries = vec![funding.entry.clone()];
            tx.inputs[0].signature_script = p2pk_sigscript(&sighash_sig(&tx, &entries, 0, &payer)?)?;
            tx.finalize();
            let used = validate(&tx, &entries).map_err(|e| format!("local engine refused genesis: {e:?}"))?;
            let addr = p2sh_addr(&contract)?;
            let (ap, asuf, _) = account_template()?;
            let (rp, rsuf, _) = repay_template()?;
            println!("covenant bytes : {}\nmandate hash   : {}\ncovenant id    : {cov}\nvault address  : {addr}\nlocal engine   : ACCEPTED ({used:?})", contract.bytecode.len(), hex(&mandate_hash(&m.doc)));
            let repay: Vec<Value> = (0..m.borrowers.len()).map(|i| repay_account(&m, &cov, i).map(|(a, _)| json!(a.to_string()))).collect::<Res<_>>()?;
            let led = Ledger { v: json!({
                "standard": CREDIT_STANDARD, "covenant": CREDIT_STANDARD, "network": NETWORK, "name": m.doc["name"], "manager": m.doc["manager"],
                "covenantId": cov.to_string(), "mandateHash": hex(&mandate_hash(&m.doc)), "genesisTx": tx.id().to_string(), "createdAt": now(),
                "seed": seed, "state": st.to_json(), "address": addr.to_string(), "value": seed, "pending": Value::Null,
                "accountTemplate": { "prefix": hex(&ap), "suffix": hex(&asuf) },
                "repayTemplate": { "prefix": hex(&rp), "suffix": hex(&rsuf) },
                "repayAddresses": repay,
                "shareCovid": Value::Null, "tokenTx": Value::Null, "notes": [], "moves": []
            })};
            led.write()?;
            match client.submit_transaction((&tx).into(), false).await {
                Ok(id) => println!("\nsubmitted. txid: {id}\nnext: cargo run --release -- credit token"),
                Err(e) => { std::fs::rename(LEDGER, "credit.failed.json")?; return Err(format!("genesis rejected: {e} (ledger moved to credit.failed.json)").into()); }
            }
        }

        "token" => {
            let mut c = open_credit().await?;
            if !c.led.v["shareCovid"].is_null() { return Err("the share token already exists".into()); }
            let (kp, ks, _) = kcc_template()?;
            let token = compile_kcc(&c.cov.as_bytes(), ID_COVENANT, 0, true)?;
            let held = c.coin.entry.amount as i64;
            let placeholder = TransactionOutput { value: MINTER_DUST as u64, script_public_key: pay_to_script_hash_script(&token.bytecode), covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: Hash::from_bytes([0; 32]) }) };
            let sc = covenant_id(c.coin.outpoint, std::iter::once((0u32, &placeholder)));
            let next = Credit { share_covid: sc.as_bytes(), ..c.state };
            let succ = compile_credit(&c.m, &next)?;
            let vault_out = held - MINTER_DUST - c.m.max_fee;
            if vault_out < c.m.min_keep { return Err("the seed cannot pay for the token".into()); }
            let mut tx = tx_of(vec![input(&c.coin, CREDIT_BUDGET)], vec![cov_out(&token, MINTER_DUST, 0, sc), cont(&succ, vault_out, c.cov)], 0);
            let entries = vec![c.coin.entry.clone()];
            let sig = sighash_sig(&tx, &entries, 0, &load_key("guardian")?)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "init", vec![credit_state(&next), Expr::dynamic_bytes(kp), Expr::dynamic_bytes(ks), Expr::bytes(sig)])?;
            tx.finalize();
            println!("share token    : {sc}");
            let id = commit(&mut c, "token", tx, entries, next, vault_out, json!({ "shareCovid": sc.to_string() })).await?;
            c.led.v["shareCovid"] = json!(sc.to_string());
            c.led.v["tokenTx"] = json!(id);
            c.led.write()?;
            publish(&c.led);
        }

        "show" => { let c = open_credit().await?; print_credit(&c); }

        "publish" => { publish(&Ledger::read()?); }

        "verify" => {
            let led = Ledger::read()?;
            let m = read_credit_mandate()?;
            let addr = p2sh_addr(&compile_credit(&m, &led.state()?)?)?;
            let cov = led.cov()?;
            let mut ok = led.v["address"].as_str() == Some(&addr.to_string()) && led.v["mandateHash"].as_str() == Some(&hex(&mandate_hash(&m.doc)));
            for i in 0..m.borrowers.len() {
                let (a, _) = repay_account(&m, &cov, i)?;
                ok &= led.v["repayAddresses"][i].as_str() == Some(&a.to_string());
            }
            println!("covenant       : {CREDIT_STANDARD}\ncompiles to    : {addr}\nledger says    : {}\n{}", led.v["address"].as_str().unwrap_or(""), if ok { "MATCH" } else { "MISMATCH — do not move this vault with this build" });
        }

        "accounts" => {
            let cov: Hash = match args.get(4) { Some(c) => c.parse()?, None => Ledger::read()?.cov()? };
            let owner = owner_of(arg(3)?)?;
            let (d, r, _, _) = accounts_of(owner, &cov)?;
            println!("deposit to     : {d}\nredeem via     : {r}");
        }

        "repay-address" => {
            let led = Ledger::read()?;
            let m = read_credit_mandate()?;
            let slot: usize = arg(3)?.parse()?;
            let (a, _) = repay_account(&m, &led.cov()?, slot)?;
            println!("slot {slot}         : {}\nrepay to       : {a}\n\nAny wallet can pay this address. The payment can only go into this vault's repay path (or back to the borrower, until it is swept); the keeper sweeps it.", m.borrowers[slot].label);
        }

        "pay" => {
            let led = Ledger::read()?;
            let role = arg(3)?;
            let amount = parse_kas(arg(4)?)?;
            let redeem = args.get(5).map(String::as_str) == Some("redeem");
            let k = load_key(role)?;
            let (d, r, _, _) = accounts_of(k.x_only_public_key().0.serialize(), &led.cov()?)?;
            let (from, id) = pay_from(role, if redeem { &r } else { &d }, amount).await?;
            println!("paid           : {} from {from} to its {} account\ntxid           : {id}", kas(amount), if redeem { "redeem" } else { "deposit" });
            let mut list = std::fs::read_to_string(ACCOUNTS).unwrap_or_default();
            if !list.contains(&from.to_string()) { list.push_str(&format!("{from}\n")); std::fs::write(ACCOUNTS, list)?; }
        }

        "repay" => {
            let led = Ledger::read()?;
            let m = read_credit_mandate()?;
            let slot: usize = arg(3)?.parse()?;
            let amount = parse_kas(arg(4)?)?;
            let (to, _) = repay_account(&m, &led.cov()?, slot)?;
            let (from, id) = pay_from(&format!("borrower-{slot}"), &to, amount).await?;
            println!("repaid         : {} from {from} to {to}\ntxid           : {id}\nnext           : credit keeper once", kas(amount));
        }

        "keeper" => {
            let once = args.get(3).map(String::as_str) == Some("once");
            loop {
                match open_credit().await {
                    Ok(mut c) => match keeper_pass(&mut c).await {
                        Ok(n) => println!("keeper         : {n} done · {}", now()),
                        Err(e) => println!("keeper pass    : {e} — retrying"),
                    },
                    Err(e) => println!("keeper open    : {e} — retrying"),
                }
                if once { break; }
                tokio::time::sleep(Duration::from_secs(20)).await;
            }
        }

        "lend" => {
            let mut c = open_credit().await?;
            let slot: usize = arg(3)?.parse()?;
            let amount = parse_kas(arg(4)?)?;
            let b = c.m.borrowers.get(slot).ok_or("no borrower in that slot")?;
            if c.state.principal[slot] + c.state.marks[slot] != 0 { return Err(format!("slot {slot} has an open loan: one loan per slot at a time").into()); }
            let (to, label, term) = (pay_to_address_script(&b.address), b.label.clone(), b.term);
            let held = c.coin.entry.amount as i64;
            let at = claimed(&c)?;
            let epoch = (at - c.m.not_before) / c.m.epoch_length;
            let spent = if epoch == c.state.epoch_index { c.state.epoch_spent } else { 0 };
            let mut n = c.state;
            n.principal[slot] = amount;
            n.due[slot] = at + term;
            n.marks[slot] = amount;
            n.epoch_index = epoch;
            n.epoch_spent = spent + amount;
            let succ = compile_credit(&c.m, &n)?;
            let keep = held - amount - c.m.max_fee;
            let mut tx = tx_of(vec![input(&c.coin, CREDIT_BUDGET)], vec![cont(&succ, keep, c.cov), out(amount, to)], at as u64);
            let entries = vec![c.coin.entry.clone()];
            let sig = sighash_sig(&tx, &entries, 0, &load_key("allocator")?)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "lend", vec![credit_state(&n), Expr::int(slot as i64), Expr::int(amount), Expr::int(at), Expr::bytes(sig)])?;
            tx.finalize();
            println!("lend           : {} to [{slot}] {label}, due at DAA {}", kas(amount), at + term);
            commit(&mut c, "lend", tx, entries, n, keep, json!({ "slot": slot, "amount": amount, "due": at + term })).await?;
        }

        "mark" => {
            let mut c = open_credit().await?;
            let mut n = c.state;
            for i in 0..c.m.borrowers.len() {
                if let Some(v) = args.get(3 + i) { if v != "-" { n.marks[i] = (v.parse::<f64>()? * KAS as f64).round() as i64; } }
            }
            let at = claimed(&c)?;
            n.mark_epoch = (at - c.m.not_before) / c.m.epoch_length;
            if n.mark_epoch <= c.state.mark_epoch { return Err(format!("one mark per epoch: the next opens at DAA {}", c.m.not_before + (c.state.mark_epoch + 1) * c.m.epoch_length).into()); }
            let succ = compile_credit(&c.m, &n)?;
            let held = c.coin.entry.amount as i64;
            let keep = held - c.m.max_fee;
            let mut tx = tx_of(vec![input(&c.coin, CREDIT_BUDGET)], vec![cont(&succ, keep, c.cov)], at as u64);
            let entries = vec![c.coin.entry.clone()];
            let sig = sighash_sig(&tx, &entries, 0, &load_key("valuer")?)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "mark", vec![credit_state(&n), Expr::int(at), Expr::bytes(sig)])?;
            tx.finalize();
            println!("mark           : {:?}", n.marks.iter().map(|x| kas(*x)).collect::<Vec<_>>());
            commit(&mut c, "mark", tx, entries, n, keep, json!({ "marks": n.marks })).await?;
        }

        "writeoff" => {
            let mut c = open_credit().await?;
            let slot: usize = arg(3)?.parse()?;
            let at = claimed(&c)?;
            let s = c.state;
            if slot >= SLOTS || s.principal[slot] == 0 { return Err("no open loan in that slot".into()); }
            let mins = |daa: i64| (daa - at).max(0) / 600; // 10 DAA a second
            let steps = (10_000 + c.m.step_bps - 1) / c.m.step_bps.max(1);
            let zero_at = s.due[slot] + c.m.grace + (steps - 1) * c.m.period;
            if at < s.due[slot] + c.m.grace {
                return Err(format!("slot {slot} is not past its grace yet: that is DAA {} (about {} min from now, chain at {}). A loan can be written off only once it counts for nothing: the schedule reaches zero at DAA {zero_at} (about {} min), or the valuer marks it to zero after the grace (`credit mark`).",
                    s.due[slot] + c.m.grace, mins(s.due[slot] + c.m.grace), c.daa, mins(zero_at)).into());
            }
            if s.marks[slot] != 0 {
                return Err(format!("slot {slot} still counts {}: a write-off needs its mark at zero. The keeper writes the schedule's cap in as it falls (zero at DAA {zero_at}, about {} min), or the valuer can mark it to zero now: `credit mark - - 0`.", kas(s.marks[slot]), mins(zero_at)).into());
            }
            let mut n = s;
            n.principal[slot] = 0;
            n.due[slot] = 0;
            let succ = compile_credit(&c.m, &n)?;
            let held = c.coin.entry.amount as i64;
            let keep = held - c.m.max_fee;
            let mut tx = tx_of(vec![input(&c.coin, CREDIT_BUDGET)], vec![cont(&succ, keep, c.cov)], at as u64);
            let entries = vec![c.coin.entry.clone()];
            let sig = sighash_sig(&tx, &entries, 0, &load_key("valuer")?)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "writeOff", vec![credit_state(&n), Expr::int(slot as i64), Expr::int(at), Expr::bytes(sig)])?;
            tx.finalize();
            println!("write off      : slot {slot} ({}): {} lost; later payments are recoveries", c.m.borrowers[slot].label, kas(s.principal[slot]));
            commit(&mut c, "writeoff", tx, entries, n, keep, json!({ "slot": slot, "principal": s.principal[slot] })).await?;
        }

        "halt" => {
            let mut c = open_credit().await?;
            let n = Credit { halted: true, ..c.state };
            let succ = compile_credit(&c.m, &n)?;
            let held = c.coin.entry.amount as i64;
            let keep = held - c.m.max_fee;
            let mut tx = tx_of(vec![input(&c.coin, CREDIT_BUDGET)], vec![cont(&succ, keep, c.cov)], 0);
            let entries = vec![c.coin.entry.clone()];
            let sig = sighash_sig(&tx, &entries, 0, &load_key("guardian")?)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "halt", vec![credit_state(&n), Expr::bytes(sig)])?;
            tx.finalize();
            commit(&mut c, "halt", tx, entries, n, keep, json!({})).await?;
        }

        _ => return Err(format!("unknown credit command {sub}").into()),
    }
    Ok(())
}
