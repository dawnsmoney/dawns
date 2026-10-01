//! `credit …` — the credit vault (vault/credit/dawns_credit.sil) on testnet-10.
//!
//!   credit init                  role and borrower keys + draft credit-mandate.json
//!   credit genesis [kas] [--donate]
//!                                seed exactly minKeep + token dust + one fee (NAV 0 until the first
//!                                deposit); more only with --donate (it goes to the first holders)
//!   credit token                 guardian creates the share token (KCC-20) bound to the vault
//!   credit show                  the vault, its loans, NAV and share price
//!   credit verify                offline: this build compiles to the address credit.json records
//!   credit accounts <address>    a user's deposit and redeem addresses
//!   credit repay-address <slot>  where the slot's borrower pays the loan back (any wallet can pay it)
//!   credit pay <role> <kas> [redeem]
//!                                test helper: a role key pays its own deposit (or redeem) account
//!   credit repay <slot> <kas>    test helper: borrower-<slot> pays its repayment address
//!   credit keeper [once]         sweep repayments, write overdue markdowns, sweep deposits and redemptions;
//!                                with a credit-strategy.json it also lends idle cash to empty slots,
//!                                accrues interest in the marks and (testnet) has the test borrowers repay
//!   credit lend <slot> <kas>     allocator lends to the slot's borrower
//!   credit mark <k0> <k1> <k2>   valuer marks the loans (KAS; "-" keeps a mark)
//!   credit writeoff <slot>       valuer closes a late loan already marked to zero
//!   credit halt                  guardian stops new loans and deposits for good
//!   credit publish               send credit.json to the site now (signed by the allocator key)
//!   credit template [forms] [vectors]
//!                                the covenant as a fill-in form, proven against the compiler; the site
//!                                rebuilds each vault's address from its mandate with it
//!
//! Share token and personal accounts are the NAV vault's (same templates), so
//! the site's account and position code reads them unchanged. Accounts come from
//! the site's registry plus credit-accounts.txt.
//!
//! What the chain enforces and what it cannot is in the covenant's header. The
//! one thing this tool cannot make true: that a borrower repays at all.

use super::nav::*;
use super::*;

/// The covenant a vault runs is part of its address, so each version stays:
/// v0 is what the first TN10 credit vault runs; v0.1 adds the seed guards;
/// new vaults get v0.2, whose address also commits to the mandate hash.
pub(crate) const CREDIT_V0: &str = include_str!("../../credit/dawns_credit_v0.sil");
pub(crate) const CREDIT_V01: &str = include_str!("../../credit/dawns_credit_v01.sil");
pub(crate) const CREDIT_V02: &str = include_str!("../../credit/dawns_credit.sil");
const CREDIT_LATEST: &str = "dawns-credit/0.2";
static CREDIT_VERSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();
fn credit_source() -> &'static str {
    match CREDIT_VERSION.get().map(String::as_str) { Some("dawns-credit/0") => CREDIT_V0, Some("dawns-credit/0.1") => CREDIT_V01, _ => CREDIT_V02 }
}
const REPAY_SOURCE: &str = include_str!("../../credit/dawns_repay.sil");
const CREDIT_STANDARD: &str = "dawns-credit/0";
pub(crate) const SLOTS: usize = 3;
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

pub(crate) struct CreditMandate {
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
    parse_credit_mandate(serde_json::from_str(&std::fs::read_to_string(MANDATE).map_err(|_| format!("no {MANDATE} — run `credit init`"))?)?)
}
pub(crate) fn parse_credit_mandate(doc: Value) -> Res<CreditMandate> {
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
pub(crate) struct Credit { pub(crate) share_covid: [u8; 32], pub(crate) shares: i64, pub(crate) principal: [i64; SLOTS], pub(crate) due: [i64; SLOTS], pub(crate) marks: [i64; SLOTS], pub(crate) epoch_index: i64, pub(crate) epoch_spent: i64, pub(crate) mark_epoch: i64, pub(crate) halted: bool }
impl Credit {
    pub(crate) fn fresh() -> Credit { Credit { share_covid: [0; 32], shares: 0, principal: [0; SLOTS], due: [0; SLOTS], marks: [0; SLOTS], epoch_index: 0, epoch_spent: 0, mark_epoch: -1, halted: false } }
    pub(crate) fn to_json(self) -> Value {
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

/// Everything the credit covenant is compiled with that comes from the mandate:
/// the site rebuilds the same bytecode from the mandate and state (see `credit template`).
#[derive(Clone)]
pub(crate) struct CreditParams { pub(crate) keys: [[u8; 32]; 3], pub(crate) max_fee: i64, pub(crate) dests: [[u8; 32]; SLOTS], pub(crate) caps: [i64; SLOTS], pub(crate) terms: [i64; SLOTS], pub(crate) interests: [i64; SLOTS], pub(crate) ints: [i64; 15], pub(crate) mandate: [u8; 32] }
/// Names of the mandate parameters, in constructor order (the template's slot names).
pub(crate) const PARAM_INTS: [&str; 15] = ["graceDaa", "markdownStepBps", "markdownPeriodDaa", "reserveFloorBps", "maxPerMoveSompi", "epochLimitSompi", "epochLengthDaa", "notBeforeDaa", "maturityDaa", "depositUntilDaa", "minDepositSompi", "maxMarkStepBps", "noteValueSompi", "minKeepSompi", "exitFeeBps"];

pub(crate) fn credit_params(m: &CreditMandate) -> Res<CreditParams> {
    let b = |i: usize| m.borrowers.get(i);
    let mut dests = [[0u8; 32]; SLOTS];
    let (mut caps, mut terms, mut interests) = ([0i64; SLOTS], [0i64; SLOTS], [0i64; SLOTS]);
    for i in 0..SLOTS {
        if let Some(x) = b(i) { dests[i] = b2b(&spk_bytes(&pay_to_address_script(&x.address))); caps[i] = x.cap_bps; terms[i] = x.term; interests[i] = x.interest_bps; }
    }
    Ok(CreditParams {
        keys: [xonly_of(&m.allocator)?, xonly_of(&m.valuer)?, xonly_of(&m.guardian)?], max_fee: m.max_fee, dests, caps, terms, interests,
        ints: [m.grace, m.step_bps, m.period, m.reserve_floor_bps, m.max_per_move, m.epoch_limit, m.epoch_length, m.not_before, m.maturity, m.deposit_until, m.min_deposit, m.max_mark_step_bps, m.note_value, m.min_keep, m.exit_fee_bps],
        mandate: mandate_hash(&m.doc),
    })
}

fn credit_ctor_raw(p: &CreditParams, s: &Credit) -> Res<Vec<Expr<'static>>> {
    let (kp, ks, kh) = kcc_template()?;
    let (_ap, asuf, ah) = account_template()?;
    let (_rp, rsuf, rh) = repay_template()?;
    let mut v = vec![Expr::bytes(p.keys[0].to_vec()), Expr::bytes(p.keys[1].to_vec()), Expr::bytes(p.keys[2].to_vec()), Expr::int(p.max_fee)];
    for i in 0..SLOTS { v.push(Expr::bytes(p.dests[i].to_vec())); }
    for i in 0..SLOTS { v.push(Expr::int(p.caps[i])); }
    for i in 0..SLOTS { v.push(Expr::int(p.terms[i])); }
    for i in 0..SLOTS { v.push(Expr::int(p.interests[i])); }
    for x in p.ints { v.push(Expr::int(x)); }
    v.push(Expr::int(kp.len() as i64));
    v.push(Expr::int(ks.len() as i64));
    v.push(Expr::bytes(kh.to_vec()));
    v.push(Expr::int(asuf.len() as i64));
    v.push(Expr::bytes(ah.to_vec()));
    v.push(Expr::dynamic_bytes(asuf));
    v.push(Expr::int(rsuf.len() as i64));
    v.push(Expr::bytes(rh.to_vec()));
    v.push(Expr::bytes(p.mandate.to_vec()));
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
fn credit_ctor(m: &CreditMandate, s: &Credit) -> Res<Vec<Expr<'static>>> { credit_ctor_raw(&credit_params(m)?, s) }
pub(crate) fn compile_credit_src(src: &'static str, p: &CreditParams, s: &Credit) -> Res<CompiledContract<'static>> {
    compile_contract(src, &credit_ctor_raw(p, s)?, CompileOptions::default()).map_err(|e| format!("compile: {e:?}").into())
}
fn compile_credit(m: &CreditMandate, s: &Credit) -> Res<CompiledContract<'static>> {
    compile_contract(credit_source(), &credit_ctor(m, s)?, CompileOptions::default()).map_err(|e| format!("compile: {e:?}").into())
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
        let _ = CREDIT_VERSION.set(v["covenant"].as_str().unwrap_or("dawns-credit/0").to_string());
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
    if value_after < c.m.min_keep { return Err(format!("{kind} would leave the vault {} — below the {} it must always keep; not broadcast", kas(value_after), kas(c.m.min_keep)).into()); }
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
    let landed = held + amount - move_fee(c.m.max_fee, c.cur.bytecode.len());
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
    let keep = held - move_fee(c.m.max_fee, c.cur.bytecode.len());
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

// ---------------------------------------------------------------------------
// a key's holding in the credit vault, for a NAV vault's strategy wallet
// ---------------------------------------------------------------------------
/// What one key holds in the credit vault whose ledger and mandate sit in `dir`: its
/// live notes at the vault's price now (as a redemption would pay them, before the
/// exit fee) plus the KAS each note carries, and its two account addresses.
#[allow(dead_code)]
pub(crate) struct CreditHolding { pub value: i64, pub shares: i64, pub notes: usize, pub dep: Address, pub red: Address, pub price: i64, pub min_in: i64 }
pub(crate) fn credit_holding(dir: &std::path::Path, owner_addr: &str, daa: i64) -> Res<CreditHolding> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(LEDGER)).map_err(|_| format!("no {} in {}", LEDGER, dir.display()))?)?;
    let m = parse_credit_mandate(serde_json::from_str(&std::fs::read_to_string(dir.join(MANDATE))?)?)?;
    let s = Credit::from_json(&v["state"])?;
    let held = v["value"].as_i64().ok_or("credit.json: value")?;
    let cov: Hash = v["covenantId"].as_str().ok_or("credit.json: covenantId")?.parse()?;
    let at = daa - DAA_BACKOFF;
    let price = if s.shares > 0 { m.nav(&s, held, at) / s.shares } else { 0 };
    let mut shares = 0; let mut notes = 0; let mut carried = 0;
    for n in v["notes"].as_array().cloned().unwrap_or_default() {
        if n["owner"].as_str() != Some(owner_addr) || !n["redeemed"].is_null() { continue; }
        shares += n["shares"].as_i64().unwrap_or(0); notes += 1; carried += n["value"].as_i64().unwrap_or(0);
    }
    let (dep, red, _, _) = accounts_of(owner_of(owner_addr)?, &cov)?;
    Ok(CreditHolding { value: shares * price + carried, shares, notes, dep, red, price, min_in: m.min_deposit + m.note_value + m.max_fee })
}
/// Put a key's address on the credit keeper's list (the keeper in `dir` sweeps its accounts).
pub(crate) fn register_credit_account(dir: &std::path::Path, addr: &str) -> Res<()> {
    let p = dir.join(ACCOUNTS);
    let mut list = std::fs::read_to_string(&p).unwrap_or_default();
    if !list.lines().any(|l| l.trim() == addr) { list.push_str(&format!("{addr}\n")); std::fs::write(p, list)?; }
    Ok(())
}

pub(crate) async fn pay_from(role: &str, to: &Address, amount: i64) -> Res<(Address, String)> {
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
// allocator and valuer moves (by hand, or by the manager)
// ---------------------------------------------------------------------------
async fn do_lend(c: &mut CCtx, slot: usize, amount: i64) -> Res<String> {
    let b = c.m.borrowers.get(slot).ok_or("no borrower in that slot")?;
    if c.state.principal[slot] + c.state.marks[slot] != 0 { return Err(format!("slot {slot} has an open loan: one loan per slot at a time").into()); }
    let (to, label, term) = (pay_to_address_script(&b.address), b.label.clone(), b.term);
    let held = c.coin.entry.amount as i64;
    let at = claimed(c)?;
    let epoch = (at - c.m.not_before) / c.m.epoch_length;
    let spent = if epoch == c.state.epoch_index { c.state.epoch_spent } else { 0 };
    let mut n = c.state;
    n.principal[slot] = amount;
    n.due[slot] = at + term;
    n.marks[slot] = amount;
    n.epoch_index = epoch;
    n.epoch_spent = spent + amount;
    let succ = compile_credit(&c.m, &n)?;
    let keep = held - amount - move_fee(c.m.max_fee, c.cur.bytecode.len());
    let mut tx = tx_of(vec![input(&c.coin, CREDIT_BUDGET)], vec![cont(&succ, keep, c.cov), out(amount, to)], at as u64);
    let entries = vec![c.coin.entry.clone()];
    let sig = sighash_sig(&tx, &entries, 0, &load_key("allocator")?)?;
    tx.inputs[0].signature_script = decl_sigscript(&c.cur, "lend", vec![credit_state(&n), Expr::int(slot as i64), Expr::int(amount), Expr::int(at), Expr::bytes(sig)])?;
    tx.finalize();
    println!("lend           : {} to [{slot}] {label}, due at DAA {}", kas(amount), at + term);
    commit(c, "lend", tx, entries, n, keep, json!({ "slot": slot, "amount": amount, "due": at + term })).await
}

async fn do_cmark(c: &mut CCtx, marks: [i64; SLOTS]) -> Res<String> {
    let mut n = c.state;
    n.marks = marks;
    let at = claimed(c)?;
    n.mark_epoch = (at - c.m.not_before) / c.m.epoch_length;
    if n.mark_epoch <= c.state.mark_epoch { return Err(format!("one mark per epoch: the next opens at DAA {}", c.m.not_before + (c.state.mark_epoch + 1) * c.m.epoch_length).into()); }
    let succ = compile_credit(&c.m, &n)?;
    let held = c.coin.entry.amount as i64;
    let keep = held - move_fee(c.m.max_fee, c.cur.bytecode.len());
    let mut tx = tx_of(vec![input(&c.coin, CREDIT_BUDGET)], vec![cont(&succ, keep, c.cov)], at as u64);
    let entries = vec![c.coin.entry.clone()];
    let sig = sighash_sig(&tx, &entries, 0, &load_key("valuer")?)?;
    tx.inputs[0].signature_script = decl_sigscript(&c.cur, "mark", vec![credit_state(&n), Expr::int(at), Expr::bytes(sig)])?;
    tx.finalize();
    println!("mark           : {:?}", n.marks.iter().map(|x| kas(*x)).collect::<Vec<_>>());
    commit(c, "mark", tx, entries, n, keep, json!({ "marks": n.marks })).await
}

// ---------------------------------------------------------------------------
// the manager: lends idle cash to the borrowers, accrues interest in the marks, and
// (testnet only) has the test borrowers repay on schedule (credit-strategy.json)
// ---------------------------------------------------------------------------
/// credit-strategy.json: the share of NAV kept liquid for redemptions, the smallest
/// loan, and whether the test borrower keys repay their loans on schedule. On testnet
/// the borrowers are Dawns-held keys: the repayments are scripted, the interest comes
/// out of test KAS, and everything that follows (NAV, share price) is the covenant's.
struct CStrategy { liquid_bps: i64, min_loan: i64, test_borrowers_repay: bool }
fn read_cstrategy() -> Res<Option<CStrategy>> {
    let Ok(raw) = std::fs::read_to_string("credit-strategy.json") else { return Ok(None) };
    let v: Value = serde_json::from_str(&raw)?;
    Ok(Some(CStrategy { liquid_bps: v["liquidBps"].as_i64().unwrap_or(2500), min_loan: parse_kas(v["minLoanKas"].as_str().unwrap_or("5"))?, test_borrowers_repay: v["testBorrowersRepay"].as_bool().unwrap_or(false) }))
}

/// The open loan in a slot: what was lent, what it owes in all, what came back since.
fn loan_of(c: &CCtx, slot: usize) -> Option<(i64, i64, i64)> {
    if c.state.principal[slot] == 0 { return None; }
    let moves = c.led.v["moves"].as_array().cloned().unwrap_or_default();
    let last = moves.iter().rposition(|x| x["kind"] == "lend" && x["slot"].as_u64() == Some(slot as u64))?;
    let lent = moves[last]["amount"].as_i64()?;
    let back: i64 = moves[last + 1..].iter().filter(|x| x["kind"] == "repay" && x["slot"].as_u64() == Some(slot as u64)).filter_map(|x| x["amount"].as_i64()).sum();
    Some((lent, lent * (10_000 + c.m.interest(slot)) / 10_000, back))
}

/// Pay from a key with a coin that leaves no change or at least 1 KAS of it.
async fn pay_exact(client: &KaspaRpcClient, role: &str, to: &Address, want: i64) -> Res<Option<(i64, String)>> {
    let k = load_key(role)?;
    let from = address_of(&k);
    let mut cs = coins(client, &from).await?;
    cs.retain(|x| x.entry.covenant_id.is_none());
    cs.sort_by_key(|x| std::cmp::Reverse(x.entry.amount));
    let fee = FEE as i64;
    // one coin if one is enough; otherwise the largest few together, so a borrower
    // whose KAS is split across coins still repays in a single payment
    let fits = |v: i64| v - want - fee == 0 || v - want - fee >= KAS;
    let mut picked: Vec<&Coin> = Vec::new();
    if let Some(c1) = cs.iter().filter(|x| fits(x.entry.amount as i64)).last() { picked.push(c1); }
    else {
        let mut total = 0i64;
        for c1 in cs.iter().take(8) { picked.push(c1); total += c1.entry.amount as i64; if fits(total) { break; } }
    }
    let total: i64 = picked.iter().map(|x| x.entry.amount as i64).sum();
    if picked.is_empty() { return Ok(None); }
    let amount = if fits(total) { want } else { (total - fee - KAS).min(want) };
    if amount <= 0 { return Ok(None); }
    let change = total - amount - fee;
    let mut outs = vec![out(amount, pay_to_address_script(to))];
    if change > 0 { outs.push(out(change, pay_to_address_script(&from))); }
    let mut tx = tx_of(picked.iter().map(|c1| input(c1, P2PK_BUDGET)).collect(), outs, 0);
    let entries: Vec<_> = picked.iter().map(|x| x.entry.clone()).collect();
    for i in 0..picked.len() { tx.inputs[i].signature_script = p2pk_sigscript(&sighash_sig(&tx, &entries, i, &k)?)?; }
    tx.finalize();
    let id = client.submit_transaction((&tx).into(), false).await?;
    Ok(Some((amount, id.to_string())))
}

/// What waiting withdrawals will pay, at today's price: each account with a coin at its
/// redeem address, for its oldest live note (a fixed term pays nothing before maturity).
async fn waiting_redeems(c: &CCtx, nav: i64) -> Res<i64> {
    if c.state.shares == 0 { return Ok(0); }
    if c.m.maturity > 0 && c.daa - DAA_BACKOFF < c.m.maturity { return Ok(0); }
    let price = nav / c.state.shares;
    let notes = c.led.v["notes"].as_array().cloned().unwrap_or_default();
    let mut due = 0;
    for a in registered(&c.cov) {
        let Ok(owner) = owner_of(&a) else { continue };
        let (_, red_addr, _, _) = accounts_of(owner, &c.cov)?;
        if !coins(&c.client, &red_addr).await?.iter().any(|x| x.entry.covenant_id.is_none()) { continue; }
        if let Some(n) = notes.iter().find(|n| n["owner"].as_str() == Some(a.as_str()) && n["redeemed"].is_null()) { due += n["shares"].as_i64().unwrap_or(0) * price; }
    }
    Ok(due)
}

async fn credit_manage_pass(c: &mut CCtx, st: &CStrategy) -> Res<Option<String>> {
    if c.state.halted { return Ok(None); }
    let at = claimed(c)?;
    let slots = c.m.borrowers.len();

    // 1. test borrowers repay what they owe once the loan is due (testnet only)
    if st.test_borrowers_repay {
        for i in 0..slots {
            let Some((_, owed, back)) = loan_of(c, i) else { continue };
            // a little before the due time, so the sweep lands before any markdown can
            let lead = (c.m.borrowers[i].term / 20).min(3_000);
            if at < c.state.due[i] - lead { continue; }
            let (addr, _) = repay_account(&c.m, &c.cov, i)?;
            // wait while an earlier payment is still in the repayment account
            if coins(&c.client, &addr).await?.iter().any(|x| x.entry.covenant_id.is_none()) { continue; }
            let left = owed - back;
            if left <= 0 { continue; }
            if let Some((paid, id)) = pay_exact(&c.client, &format!("borrower-{i}"), &addr, left).await? {
                return Ok(Some(format!("test borrower [{i}] repaid {} of {} owed ({id}); the keeper sweeps it in", kas(paid), kas(left))));
            }
        }
    }

    // 2. interest accrues in the marks: each open loan at principal plus the share of
    //    its interest the term has run, within the mandate's step per period
    let epoch = (at - c.m.not_before) / c.m.epoch_length;
    if epoch > c.state.mark_epoch {
        let mut marks = c.state.marks;
        let mut moved = false;
        for i in 0..slots {
            let Some((lent, owed, back)) = loan_of(c, i) else { continue };
            let term = c.m.borrowers[i].term.max(1);
            let run = (at - (c.state.due[i] - term)).clamp(0, term);
            let accrued = lent + (owed - lent) * run / term;
            let target = (accrued - back).min(c.m.limit(i, &c.state, at)).max(0);
            let cur = c.state.marks[i];
            if (target - cur).abs() < KAS / 1000 { continue; }
            let base = cur.max(c.state.principal[i]);
            let step = c.m.max_mark_step_bps * base / 10_000;
            marks[i] = if target > cur { cur + (target - cur).min(step) } else { cur - (cur - target).min(step) };
            moved = moved || marks[i] != cur;
        }
        if moved {
            do_cmark(c, marks).await?;
            return Ok(Some(format!("interest accrued in the marks: {:?}", marks[..slots].iter().map(|x| kas(*x)).collect::<Vec<_>>())));
        }
    }

    // 3. idle cash above the liquid target and any withdrawal already waiting: lend to
    //    an empty slot, within its cap, the reserve floor, the per-move and per-period
    //    limits and any maturity. Holders waiting to leave come before new loans.
    let held = c.coin.entry.amount as i64;
    let nav = c.m.nav(&c.state, held, at);
    let waiting = waiting_redeems(c, nav).await?;
    if waiting > 0 && held - c.m.min_keep < waiting { return Ok(None); }
    let keep = st.liquid_bps.max(c.m.reserve_floor_bps) * nav / 10_000 + waiting;
    let spare = held - c.m.min_keep - c.m.max_fee - keep;
    let spent = if epoch == c.state.epoch_index { c.state.epoch_spent } else { 0 };
    for i in 0..slots {
        if c.state.principal[i] + c.state.marks[i] != 0 { continue; }
        let (label, term, cap_bps, rate) = { let b = &c.m.borrowers[i]; (b.label.clone(), b.term, b.cap_bps, b.interest_bps) };
        if c.m.maturity > 0 && at + term > c.m.maturity { continue; }
        let amount = spare.min(cap_bps * nav / 10_000).min(c.m.max_per_move).min(c.m.epoch_limit - spent) / KAS * KAS;
        if amount < st.min_loan { continue; }
        do_lend(c, i, amount).await?;
        return Ok(Some(format!("lent {} to [{i}] {label} for {term} DAA at {}%", kas(amount), rate as f64 / 100.0)));
    }
    Ok(None)
}

// ---------------------------------------------------------------------------
pub async fn run_credit(args: &[String]) -> Res<()> {
    let sub = args.get(2).map(String::as_str).unwrap_or("show");
    let arg = |i: usize| -> Res<&str> { args.get(i).map(String::as_str).ok_or_else(|| "usage: see the header of src/credit.rs".into()) };
    match sub {
        "template" => return crate::template::run(&credit_family(), args.get(3).map(String::as_str).unwrap_or("credit-forms.json"), args.get(4).map(String::as_str).unwrap_or("credit-vectors.json"), &PARAM_INTS),
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
            let asked = args.get(3).filter(|x| !x.starts_with("--")).map(|x| parse_kas(x)).transpose()?;
            let client = connect().await?;
            let daa = ready(&client).await?;
            let mut doc: Value = serde_json::from_str(&std::fs::read_to_string(MANDATE)?)?;
            if doc["notBeforeDaa"].as_i64() == Some(0) {
                // fixed term from a strategy: maturity and the deposit window count from launch
                let start = daa - DAA_BACKOFF;
                doc["notBeforeDaa"] = json!(start);
                if let Some(d) = doc["maturityDays"].as_i64().filter(|d| *d > 0) { if doc["maturityDaa"].as_i64() == Some(0) { doc["maturityDaa"] = json!(start + d * 864_000); } }
                if let Some(d) = doc["depositDays"].as_i64().filter(|d| *d > 0) { if doc["depositUntilDaa"].as_i64() == Some(0) { doc["depositUntilDaa"] = json!(start + d * 864_000); } }
                std::fs::write(MANDATE, serde_json::to_string_pretty(&doc)? + "\n")?;
            }
            let m = read_credit_mandate()?;
            // this tool signs with ./keys (or DAWNS_KEYS): the mandate's keys must be those
            for (role, a) in [("allocator", &m.allocator), ("valuer", &m.valuer), ("guardian", &m.guardian)] {
                let k = load_key(role).map_err(|_| format!("no {role} key in {} — this tool signs with it", keys_dir().display()))?;
                if &address_of(&k) != a { return Err(format!("the mandate's {role} is {a}, but {}/{role} is {}: run from the folder whose keys the mandate names (DAWNS_KEYS)", keys_dir().display(), address_of(&k)).into()); }
            }
            if let Some(st) = m.doc["strategy"].as_object() { println!("strategy       : {} v{} · {}", st.get("id").and_then(|v| v.as_str()).unwrap_or("?"), st.get("version").and_then(|v| v.as_i64()).unwrap_or(0), st.get("hash").and_then(|v| v.as_str()).unwrap_or("?")); }
            // The seed is exactly what the vault must keep (minKeep), the share token's
            // minter dust and the token transaction's fee: after `token` the vault holds
            // minKeep and its NAV is 0. Anything more would count in NAV before the first
            // share exists, and the first depositor (minted at the launch price) would
            // receive it. A larger seed is a donation to the first holders: --donate.
            let minimum = m.min_keep + MINTER_DUST + m.max_fee;
            let donate = args.iter().any(|a| a == "--donate");
            let seed = asked.unwrap_or(minimum);
            if seed < minimum { return Err(format!("the seed must be at least {} (minKeep {} + token dust {} + one vault fee {})", kas(minimum), kas(m.min_keep), kas(MINTER_DUST), kas(m.max_fee)).into()); }
            if seed > minimum && !donate { return Err(format!("a seed above {} counts in NAV before any share exists and goes to the first depositor. Leave the amount out to seed exactly {}, or add --donate if that is the intent", kas(minimum), kas(minimum)).into()); }
            println!("seed           : {}{}", kas(seed), if seed > minimum { format!(" ({} donated to the first holders)", kas(seed - minimum)) } else { " (NAV is 0 until the first deposit)".to_string() });
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
                "standard": CREDIT_STANDARD, "covenant": CREDIT_LATEST, "network": NETWORK, "name": m.doc["name"], "manager": m.doc["manager"],
                "covenantId": cov.to_string(), "mandateHash": hex(&mandate_hash(&m.doc)), "genesisTx": tx.id().to_string(), "createdAt": now(),
                "seed": seed, "state": st.to_json(), "address": addr.to_string(), "value": seed, "pending": Value::Null,
                "accountTemplate": { "prefix": hex(&ap), "suffix": hex(&asuf) },
                "repayTemplate": { "prefix": hex(&rp), "suffix": hex(&rsuf) },
                "repayAddresses": repay,
                // the mandate itself, so the site can check it hashes to mandateHash
                "mandate": m.doc,
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
            println!("covenant       : {}\ncompiles to    : {addr}\nledger says    : {}\n{}", CREDIT_VERSION.get().map(String::as_str).unwrap_or(CREDIT_LATEST), led.v["address"].as_str().unwrap_or(""), if ok { "MATCH" } else { "MISMATCH — do not move this vault with this build" });
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
                    Ok(mut c) => {
                        match keeper_pass(&mut c).await {
                            Ok(n) => println!("keeper         : {n} done · {}", now()),
                            Err(e) => println!("keeper pass    : {e} — retrying"),
                        }
                        // the lending strategy, when this vault has one: one move per pass
                        match read_cstrategy() {
                            Ok(Some(st)) => match open_credit().await {
                                Ok(mut c) => match credit_manage_pass(&mut c, &st).await {
                                    Ok(Some(what)) => { println!("manager        : {what}"); let _ = await_vault(&mut c).await; }
                                    Ok(None) => {}
                                    Err(e) => println!("manager        : {e} — retrying"),
                                },
                                Err(e) => println!("manager open   : {e} — retrying"),
                            },
                            Ok(None) => {}
                            Err(e) => println!("credit-strategy.json: {e}"),
                        }
                    }
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
            do_lend(&mut c, slot, amount).await?;
        }

        "mark" => {
            let mut c = open_credit().await?;
            let mut marks = c.state.marks;
            for i in 0..c.m.borrowers.len() {
                if let Some(v) = args.get(3 + i) { if v != "-" { marks[i] = (v.parse::<f64>()? * KAS as f64).round() as i64; } }
            }
            do_cmark(&mut c, marks).await?;
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
            if at < s.due[slot] + c.m.grace && s.marks[slot] == 0 {
                return Err(format!("slot {slot} is already marked to zero; the covenant allows the write-off once its grace ends at DAA {} (about {} min from now, chain at {}).", s.due[slot] + c.m.grace, mins(s.due[slot] + c.m.grace), c.daa).into());
            }
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
            let keep = held - move_fee(c.m.max_fee, c.cur.bytecode.len());
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
            let keep = held - move_fee(c.m.max_fee, c.cur.bytecode.len());
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

// ---------------------------------------------------------------------------
// the covenant as a form (`credit template`, see template.rs)
// ---------------------------------------------------------------------------
use crate::template::{Enc, Family, Named, Rng, Sv};

const CREDIT_STATE: [(&str, Enc); 15] = [
    ("shareCovid", Enc::B32), ("shares", Enc::I64), ("principal0", Enc::I64), ("principal1", Enc::I64), ("principal2", Enc::I64),
    ("due0", Enc::I64), ("due1", Enc::I64), ("due2", Enc::I64), ("mark0", Enc::I64), ("mark1", Enc::I64), ("mark2", Enc::I64),
    ("epochIndex", Enc::I64), ("epochSpent", Enc::I64), ("markEpoch", Enc::I64), ("halted", Enc::Bool),
];
fn credit_b32() -> Vec<String> { let mut v: Vec<String> = ["allocator", "valuer", "guardian"].iter().map(|s| s.to_string()).collect(); v.extend((0..SLOTS).map(|i| format!("dest{i}"))); v.push("mandateHash".into()); v }
fn credit_nums() -> Vec<String> {
    let mut v = vec!["maxFeeSompi".to_string()];
    for i in 0..SLOTS { v.push(format!("cap{i}")); v.push(format!("term{i}")); v.push(format!("interest{i}")); }
    v.extend(PARAM_INTS.iter().map(|s| s.to_string()));
    v
}
fn named_of_params(p: &CreditParams) -> Named {
    let mut n = Named::default();
    for (i, k) in ["allocator", "valuer", "guardian"].iter().enumerate() { n.b32.insert(k.to_string(), p.keys[i]); }
    for i in 0..SLOTS { n.b32.insert(format!("dest{i}"), p.dests[i]); n.num.insert(format!("cap{i}"), p.caps[i]); n.num.insert(format!("term{i}"), p.terms[i]); n.num.insert(format!("interest{i}"), p.interests[i]); }
    n.b32.insert("mandateHash".into(), p.mandate);
    n.num.insert("maxFeeSompi".into(), p.max_fee);
    for (i, k) in PARAM_INTS.iter().enumerate() { n.num.insert(k.to_string(), p.ints[i]); }
    n
}
fn params_of_named(n: &Named) -> CreditParams {
    CreditParams { keys: [n.b("allocator"), n.b("valuer"), n.b("guardian")], max_fee: n.n("maxFeeSompi"),
        dests: std::array::from_fn(|i| n.b(&format!("dest{i}"))), caps: std::array::from_fn(|i| n.n(&format!("cap{i}"))),
        terms: std::array::from_fn(|i| n.n(&format!("term{i}"))), interests: std::array::from_fn(|i| n.n(&format!("interest{i}"))),
        ints: std::array::from_fn(|i| n.n(PARAM_INTS[i])), mandate: n.b("mandateHash") }
}
fn credit_of_sv(s: &[Sv]) -> Credit {
    let i = |k: usize| match s[k] { Sv::I64(x) => x, _ => 0 };
    Credit { share_covid: match s[0] { Sv::B32(x) => x, _ => [0; 32] }, shares: i(1), principal: [i(2), i(3), i(4)], due: [i(5), i(6), i(7)], marks: [i(8), i(9), i(10)],
        epoch_index: i(11), epoch_spent: i(12), mark_epoch: i(13), halted: matches!(s[14], Sv::Bool(true)) }
}
fn sv_of_credit(c: &Credit) -> Vec<Sv> {
    let mut v = vec![Sv::B32(c.share_covid), Sv::I64(c.shares)];
    for x in c.principal.iter().chain(c.due.iter()).chain(c.marks.iter()) { v.push(Sv::I64(*x)); }
    v.extend([Sv::I64(c.epoch_index), Sv::I64(c.epoch_spent), Sv::I64(c.mark_epoch), Sv::Bool(c.halted)]);
    v
}
fn credit_random_doc(r: &mut Rng, slots: usize) -> Value {
    json!({
        "standard": "dawns-credit/0", "network": NETWORK, "name": format!("Vector {}", r.next() % 1000), "objective": "self-check",
        "roles": { "allocator": r.addr(), "valuer": r.addr(), "guardian": r.addr() },
        "borrowers": (0..slots).map(|i| json!({ "label": format!("B{i}"), "address": r.addr(), "capBps": r.pos(10_000), "termDaa": r.pos(900_000_000), "interestBps": (r.next() % 10_001) as i64 })).collect::<Vec<_>>(),
        "graceDaa": (r.next() % 90_000_000) as i64, "markdownStepBps": (r.next() % 10_001) as i64, "markdownPeriodDaa": r.pos(90_000_000),
        "reserveFloorBps": (r.next() % 10_001) as i64, "maxPerMoveSompi": (r.int() % (1 << 50)).max(1), "epochLimitSompi": (r.int() % (1 << 50)).max(1), "epochLengthDaa": r.pos(9_000_000),
        "maxFeeSompi": 1_000_000 + (r.next() % 90_000_000) as i64, "notBeforeDaa": (r.next() % 900_000_000) as i64,
        "maturityDaa": 0, "depositUntilDaa": if r.next() % 2 == 0 { 0 } else { r.pos(1 << 40) },
        "minDepositSompi": r.int() % (1 << 50), "maxMarkStepBps": (r.next() % 10_001) as i64, "noteValueSompi": 100_000_000 + (r.next() % 1_000_000_000) as i64,
        "minKeepSompi": 100_000_000 + (r.next() % 1_000_000_000) as i64, "exitFeeBps": (r.next() % 1_001) as i64,
    })
}
pub(crate) fn credit_family() -> Family {
    Family {
        name: "credit", latest: CREDIT_LATEST,
        versions: vec![("dawns-credit/0", CREDIT_V0, false), ("dawns-credit/0.1", CREDIT_V01, false), ("dawns-credit/0.2", CREDIT_V02, true)],
        b32: credit_b32(), nums: credit_nums(), state: CREDIT_STATE.to_vec(),
        compile: |src, n, s| compile_credit_src(src, &params_of_named(n), &credit_of_sv(s)),
        fresh: || sv_of_credit(&Credit::fresh()),
        state_json: |s| credit_of_sv(s).to_json(),
        random_doc: credit_random_doc,
        named_of: |doc| Ok(named_of_params(&credit_params(&parse_credit_mandate(doc)?)?)),
        slots: SLOTS,
    }
}
