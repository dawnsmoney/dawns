//! `nav …` — the NAV vault (vault/nav/dawns_nav.sil) on testnet-10.
//!
//!   nav init                  valuer key + draft nav-mandate.json
//!   nav genesis <kas>         seed the vault (the seed stays the vault's own: minKeep + token dust)
//!   nav token                 guardian creates the share token (KCC-20) bound to the vault
//!   nav show                  the vault, its NAV and share price, notes outstanding
//!   nav accounts <address>    a user's deposit and redeem addresses
//!   nav pay <role> <kas> [redeem]
//!                             test helper: a role key pays its own deposit (or redeem) account
//!   nav keeper [once]         sweep deposits and redemptions of every registered account
//!   nav allocate <slot> <kas> allocator sends capital to an approved destination
//!   nav recall <slot> <kas>   a strategy wallet returns capital
//!   nav mark <k0> <k1> <k2>   valuer marks the positions (KAS)
//!   nav halt                  guardian stops allocations and deposits for good
//!
//! Accounts come from the site's registry (DAWNS_SITE, default https://www.dawns.money)
//! plus any addresses listed one per line in nav-accounts.txt.

use super::*;

const NAV_SOURCE: &str = include_str!("../../nav/dawns_nav.sil");
const KCC_SOURCE: &str = include_str!("../../nav/kcc20.sil");
const ACC_SOURCE: &str = include_str!("../../nav/dawns_account.sil");
const NAV_STANDARD: &str = "dawns-nav/1";
const MAX_COV: i64 = 2;
const ID_SCRIPT_HASH: u8 = 0x01;
const ID_COVENANT: u8 = 0x02;
const FIRST_PRICE: i64 = 1_000_000;
/// Compute budgets (×10,000 script units), from the harness's budget_report at
/// the real signature price: vault deposit 115k / redeem 109k units without a
/// signature, signed paths add one checksig (100k); token inputs 13–20k,
/// accounts under 1k. Headroom ~25%; budget is charged as mass.
const NAV_BUDGET: u16 = 28;
const KCC_BUDGET: u16 = 3;
const ACC_BUDGET: u16 = 1;
/// Vault-path transactions carry a ~10.5 KB covenant script; the node asks
/// 100 sompi per gram of transient mass (~2.5 M sompi for the token tx), so
/// every vault move pays the mandate's maxFee (0.05 KAS on testnet), the most
/// the covenant allows. Plain P2PK transactions keep the small FEE.
/// KAS the share token's minter branch carries (paid once, at token creation).
const MINTER_DUST: i64 = KAS;

// ---------------------------------------------------------------------------
// mandate
// ---------------------------------------------------------------------------
pub struct NavMandate {
    pub doc: Value,
    pub allocator: Address,
    pub valuer: Address,
    pub guardian: Address,
    pub dests: Vec<Dest>,
    pub reserve_floor_bps: i64,
    pub max_per_move: i64,
    pub epoch_limit: i64,
    pub epoch_length: i64,
    pub max_fee: i64,
    pub not_before: i64,
    pub maturity: i64,
    pub deposit_until: i64,
    pub min_deposit: i64,
    pub max_mark_step_bps: i64,
    pub note_value: i64,
    pub min_keep: i64,
    pub exit_fee_bps: i64,
}

fn read_nav_mandate() -> Res<NavMandate> {
    let doc: Value = serde_json::from_str(&std::fs::read_to_string("nav-mandate.json").map_err(|_| "no nav-mandate.json — run `nav init`")?)?;
    if doc["standard"] != NAV_STANDARD { return Err(format!("nav-mandate.standard must be \"{NAV_STANDARD}\"").into()); }
    if doc["network"] != NETWORK { return Err(format!("nav-mandate.network must be \"{NETWORK}\"").into()); }
    let role = |k: &str| -> Res<Address> { parse_addr(doc["roles"][k].as_str().ok_or(format!("roles.{k} missing"))?) };
    let (allocator, valuer, guardian) = (role("allocator")?, role("valuer")?, role("guardian")?);
    for a in [&allocator, &valuer, &guardian] { xonly_of(a)?; }
    if allocator == valuer || allocator == guardian || valuer == guardian { return Err("allocator, valuer and guardian must be three different keys".into()); }
    let list = doc["destinations"].as_array().ok_or("destinations must be a list")?;
    if list.is_empty() || list.len() > 4 { return Err("1 to 4 destinations".into()); }
    let mut dests = Vec::new();
    for (i, d) in list.iter().enumerate() {
        let address = parse_addr(d["address"].as_str().ok_or(format!("destinations[{i}].address missing"))?)?;
        if address == allocator || address == guardian || address == valuer { return Err(format!("destinations[{i}] is a role key").into()); }
        let cap_bps = d["capBps"].as_i64().ok_or(format!("destinations[{i}].capBps missing"))?;
        if !(1..=10_000).contains(&cap_bps) { return Err(format!("destinations[{i}].capBps must be 1..10000").into()); }
        dests.push(Dest { label: d["label"].as_str().unwrap_or("").to_string(), address, cap_bps });
    }
    let depu = int(&doc, "depositUntilDaa")?;
    let m = NavMandate {
        allocator, valuer, guardian, dests,
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
    if m.epoch_length <= 0 || !(0..=10_000).contains(&m.reserve_floor_bps) || !(0..=10_000).contains(&m.max_mark_step_bps) || !(0..=1_000).contains(&m.exit_fee_bps) { return Err("bad limits".into()); }
    Ok(m)
}

// ---------------------------------------------------------------------------
// state and contracts
// ---------------------------------------------------------------------------
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Nav { pub share_covid: [u8; 32], pub shares: i64, pub deployed: [i64; 4], pub marks: [i64; 4], pub epoch_index: i64, pub epoch_spent: i64, pub mark_epoch: i64, pub halted: bool }
impl Nav {
    fn fresh() -> Nav { Nav { share_covid: [0; 32], shares: 0, deployed: [0; 4], marks: [0; 4], epoch_index: 0, epoch_spent: 0, mark_epoch: -1, halted: false } }
    fn to_json(self) -> Value {
        json!({ "shareCovid": hex(&self.share_covid), "shares": self.shares, "deployed": self.deployed, "marks": self.marks, "epochIndex": self.epoch_index, "epochSpent": self.epoch_spent, "markEpoch": self.mark_epoch, "halted": self.halted })
    }
    fn from_json(v: &Value) -> Res<Nav> {
        let arr = |k: &str| -> Res<[i64; 4]> {
            let a = v[k].as_array().ok_or(format!("state.{k}"))?;
            let mut o = [0i64; 4];
            for (i, x) in a.iter().enumerate().take(4) { o[i] = x.as_i64().ok_or(format!("state.{k}"))?; }
            Ok(o)
        };
        let mut sc = [0u8; 32];
        sc.copy_from_slice(&unhex(v["shareCovid"].as_str().ok_or("state.shareCovid")?)?);
        Ok(Nav { share_covid: sc, shares: int(v, "shares")?, deployed: arr("deployed")?, marks: arr("marks")?, epoch_index: int(v, "epochIndex")?, epoch_spent: int(v, "epochSpent")?, mark_epoch: int(v, "markEpoch")?, halted: v["halted"].as_bool().unwrap_or(false) })
    }
    fn nav(&self, held: i64, m: &NavMandate) -> i64 { held - m.min_keep + self.marks.iter().sum::<i64>() }
}

fn template_parts(c: &CompiledContract) -> (Vec<u8>, Vec<u8>, [u8; 32]) {
    let l = c.state_layout;
    (c.bytecode[..l.start].to_vec(), c.bytecode[l.start + l.len..].to_vec(), c.template_hash())
}
fn compile_kcc(owner: &[u8], id_type: u8, amount: i64, is_minter: bool) -> Res<CompiledContract<'static>> {
    compile_contract(KCC_SOURCE, &[Expr::bytes(owner.to_vec()), Expr::int(amount), Expr::byte(id_type), Expr::bool(is_minter), Expr::int(MAX_COV), Expr::int(MAX_COV)], CompileOptions::default())
        .map_err(|e| format!("kcc20: {e:?}").into())
}
fn compile_account(owner: [u8; 32], vault: &[u8], kind: i64) -> Res<CompiledContract<'static>> {
    compile_contract(ACC_SOURCE, &[Expr::bytes(owner.to_vec()), Expr::bytes(vault.to_vec()), Expr::int(kind)], CompileOptions::default())
        .map_err(|e| format!("account: {e:?}").into())
}
fn kcc_template() -> Res<(Vec<u8>, Vec<u8>, [u8; 32])> { Ok(template_parts(&compile_kcc(&[0; 32], ID_COVENANT, 0, true)?)) }
fn account_template() -> Res<(Vec<u8>, Vec<u8>, [u8; 32])> { Ok(template_parts(&compile_account([0; 32], &[0; 32], 0)?)) }
fn redeem_hash(owner: [u8; 32], vault: &[u8]) -> Res<[u8; 32]> { Ok(b2b(&compile_account(owner, vault, 1)?.bytecode)) }
fn p2sh_addr(c: &CompiledContract<'_>) -> Res<Address> { Ok(extract_script_pub_key_address(&pay_to_script_hash_script(&c.bytecode), Prefix::Testnet)?) }

fn nav_ctor(m: &NavMandate, s: &Nav) -> Res<Vec<Expr<'static>>> {
    let (kp, ks, kh) = kcc_template()?;
    let (_ap, asuf, ah) = account_template()?;
    let dh = |i: usize| m.dests.get(i).map(|d| b2b(&spk_bytes(&pay_to_address_script(&d.address)))).unwrap_or([0u8; 32]);
    let cp = |i: usize| m.dests.get(i).map(|d| d.cap_bps).unwrap_or(0);
    let mut v = vec![Expr::bytes(xonly_of(&m.allocator)?.to_vec()), Expr::bytes(xonly_of(&m.valuer)?.to_vec()), Expr::bytes(xonly_of(&m.guardian)?.to_vec()), Expr::int(m.max_fee)];
    for i in 0..4 { v.push(Expr::bytes(dh(i).to_vec())); }
    for i in 0..4 { v.push(Expr::int(cp(i))); }
    for x in [m.reserve_floor_bps, m.max_per_move, m.epoch_limit, m.epoch_length, m.not_before, m.maturity, m.deposit_until, m.min_deposit, m.max_mark_step_bps, m.note_value, m.min_keep, m.exit_fee_bps] { v.push(Expr::int(x)); }
    v.push(Expr::int(kp.len() as i64));
    v.push(Expr::int(ks.len() as i64));
    v.push(Expr::bytes(kh.to_vec()));
    v.push(Expr::int(asuf.len() as i64));
    v.push(Expr::bytes(ah.to_vec()));
    v.push(Expr::dynamic_bytes(asuf));
    v.push(Expr::bytes(mandate_hash(&m.doc).to_vec()));
    v.push(Expr::bytes(s.share_covid.to_vec()));
    v.push(Expr::int(s.shares));
    for d in s.deployed { v.push(Expr::int(d)); }
    for k in s.marks { v.push(Expr::int(k)); }
    v.push(Expr::int(s.epoch_index));
    v.push(Expr::int(s.epoch_spent));
    v.push(Expr::int(s.mark_epoch));
    v.push(Expr::bool(s.halted));
    Ok(v)
}
fn compile_nav(m: &NavMandate, s: &Nav) -> Res<CompiledContract<'static>> {
    compile_contract(NAV_SOURCE, &nav_ctor(m, s)?, CompileOptions::default()).map_err(|e| format!("compile: {e:?}").into())
}
fn nav_state(s: &Nav) -> Expr<'static> {
    struct_object("State", vec![
        ("shareCovid", Expr::bytes(s.share_covid.to_vec())), ("shares", Expr::int(s.shares)),
        ("deployed0", Expr::int(s.deployed[0])), ("deployed1", Expr::int(s.deployed[1])), ("deployed2", Expr::int(s.deployed[2])), ("deployed3", Expr::int(s.deployed[3])),
        ("mark0", Expr::int(s.marks[0])), ("mark1", Expr::int(s.marks[1])), ("mark2", Expr::int(s.marks[2])), ("mark3", Expr::int(s.marks[3])),
        ("epochIndex", Expr::int(s.epoch_index)), ("epochSpent", Expr::int(s.epoch_spent)), ("markEpoch", Expr::int(s.mark_epoch)), ("halted", Expr::bool(s.halted)),
    ])
}
fn kcc_states(v: Vec<(Vec<u8>, u8, i64, bool)>) -> Expr<'static> {
    Expr::array(
        silverscript_lang::ast::parse_type_ref("State[]").expect("type"),
        v.into_iter().map(|(o, t, a, mi)| struct_object("State", vec![("ownerIdentifier", Expr::bytes(o)), ("identifierType", Expr::byte(t)), ("amount", Expr::int(a)), ("isMinter", Expr::bool(mi))])).collect(),
    )
}
fn empty_sigs() -> Expr<'static> { Expr::array(silverscript_lang::ast::parse_type_ref("sig[]").expect("type"), vec![]) }
fn leader_sigscript(c: &CompiledContract<'_>, f: &str, args: Vec<Expr<'_>>) -> Res<Vec<u8>> {
    let mut s = c.build_sig_script_for_covenant_decl(f, args, CovenantDeclCallOptions { is_leader: true }).map_err(|e| format!("{f} leader sigscript: {e:?}"))?;
    s.extend_from_slice(&push_redeem(&c.bytecode)?);
    Ok(s)
}
fn cov_out(c: &CompiledContract<'_>, value: i64, auth: u16, cov: Hash) -> TransactionOutput {
    TransactionOutput { value: value as u64, script_public_key: pay_to_script_hash_script(&c.bytecode), covenant: Some(CovenantBinding { authorizing_input: auth, covenant_id: cov }) }
}

// ---------------------------------------------------------------------------
// ledger (nav.json)
// ---------------------------------------------------------------------------
struct Ledger { v: Value }
impl Ledger {
    fn read() -> Res<Ledger> {
        let v: Value = serde_json::from_str(&std::fs::read_to_string("nav.json").map_err(|_| "no nav.json — run `nav genesis`")?)?;
        if v["status"] == "planned" { return Err("nav.json is the site's placeholder — run `nav genesis`".into()); }
        Ok(Ledger { v })
    }
    fn write(&self) -> Res<()> {
        std::fs::write("nav.json.tmp", serde_json::to_string_pretty(&self.v)? + "\n")?;
        std::fs::rename("nav.json.tmp", "nav.json")?;
        Ok(())
    }
    fn state(&self) -> Res<Nav> { Nav::from_json(&self.v["state"]) }
    fn cov(&self) -> Res<Hash> { Ok(self.v["covenantId"].as_str().ok_or("covenantId")?.parse()?) }
    fn share_cov(&self) -> Res<Hash> { Ok(self.v["shareCovid"].as_str().ok_or("share token not created — run `nav token`")?.parse()?) }
    fn push(&mut self, k: &str, x: Value) { let mut a = self.v[k].as_array().cloned().unwrap_or_default(); a.push(x); self.v[k] = Value::Array(a); }
}

struct NCtx { client: KaspaRpcClient, m: NavMandate, led: Ledger, state: Nav, cur: CompiledContract<'static>, coin: Coin, cov: Hash, daa: i64 }

async fn open_nav() -> Res<NCtx> {
    let m = read_nav_mandate()?;
    let led = Ledger::read()?;
    if led.v["mandateHash"].as_str() != Some(&hex(&mandate_hash(&m.doc))) { return Err("nav-mandate.json no longer matches the vault's mandate hash".into()); }
    let client = connect().await?;
    let daa = ready(&client).await?;
    let state = led.state()?;
    let cur = compile_nav(&m, &state)?;
    let addr = p2sh_addr(&cur)?;
    if led.v["address"].as_str() != Some(&addr.to_string()) { return Err("nav.json address does not match its state".into()); }
    let cov = led.cov()?;
    let coin = vault_coin(&client, &addr, cov).await?;
    Ok(NCtx { client, m, led, state, cur, coin, cov, daa })
}

/// Broadcast a vault move and record the new state. The ledger is written
/// before broadcasting (with the move marked pending), as for the v0 vault.
async fn commit(c: &mut NCtx, kind: &str, tx: Transaction, entries: Vec<UtxoEntry>, next: Nav, value_after: i64, extra: Value) -> Res<String> {
    let used = validate(&tx, &entries).map_err(|e| format!("local engine refused {kind}: {e:?} — not broadcast"))?;
    println!("local engine   : ACCEPTED (script units per input {used:?})");
    if std::env::var("DAWNS_DRY").is_ok() { println!("dry run        : not broadcast (txid would be {})", tx.id()); return Ok(tx.id().to_string()); }
    let next_addr = p2sh_addr(&compile_nav(&c.m, &next)?)?.to_string();
    c.led.v["pending"] = json!({ "txid": tx.id().to_string(), "kind": kind, "state": next.to_json(), "address": next_addr, "value": value_after });
    c.led.write()?;
    match c.client.submit_transaction((&tx).into(), false).await {
        Ok(id) => {
            let mut rec = json!({ "kind": kind, "txid": id.to_string(), "at": now(), "valueAfter": value_after, "sharesAfter": next.shares, "navAfter": next.nav(value_after, &c.m) });
            if let (Some(o), Some(e)) = (rec.as_object_mut(), extra.as_object()) { for (k, v) in e { o.insert(k.clone(), v.clone()); } }
            c.led.push("moves", rec);
            c.led.v["state"] = next.to_json();
            c.led.v["address"] = json!(next_addr);
            c.led.v["value"] = json!(value_after);
            c.led.v["pending"] = Value::Null;
            c.led.write()?;
            println!("accepted. txid : {id}\nvault moved to : {next_addr}");
            Ok(id.to_string())
        }
        Err(e) => { c.led.v["pending"] = Value::Null; c.led.write()?; Err(format!("rejected by the node: {e}").into()) }
    }
}

/// After a move, wait until the vault's new coin is visible (next move spends it).
async fn await_vault(c: &mut NCtx) -> Res<()> {
    let st = c.led.state()?;
    let cur = compile_nav(&c.m, &st)?;
    let addr = p2sh_addr(&cur)?;
    for _ in 0..60 {
        if let Ok(coin) = vault_coin(&c.client, &addr, c.cov).await { c.state = st; c.cur = cur; c.coin = coin; c.daa = ready(&c.client).await?; return Ok(()); }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
    Err("the vault's new coin did not appear within a minute".into())
}

fn claimed_nav(c: &NCtx) -> Res<i64> {
    let d = c.daa - DAA_BACKOFF;
    if d < c.m.not_before { return Err(format!("the mandate starts at DAA {}; the chain is at {}", c.m.not_before, c.daa).into()); }
    Ok(d)
}

fn price_up(nav: i64, shares: i64) -> i64 { if shares > 0 { (nav + shares - 1) / shares } else { FIRST_PRICE } }

async fn minter_coin(c: &NCtx) -> Res<(Coin, CompiledContract<'static>)> {
    let sc = c.led.share_cov()?;
    let minter = compile_kcc(&c.cov.as_bytes(), ID_COVENANT, 0, true)?;
    let mut coins_ = coins(&c.client, &p2sh_addr(&minter)?).await?;
    coins_.retain(|x| x.entry.covenant_id == Some(sc));
    if coins_.len() != 1 { return Err(format!("expected one share-token minter coin, found {}", coins_.len()).into()); }
    Ok((coins_.remove(0), minter))
}

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------
fn owner_of(addr: &str) -> Res<[u8; 32]> { xonly_of(&parse_addr(addr)?) }
fn accounts_of(owner: [u8; 32], cov: &Hash) -> Res<(Address, Address, CompiledContract<'static>, CompiledContract<'static>)> {
    let d = compile_account(owner, &cov.as_bytes(), 0)?;
    let r = compile_account(owner, &cov.as_bytes(), 1)?;
    Ok((p2sh_addr(&d)?, p2sh_addr(&r)?, d, r))
}
fn registered(cov: &Hash) -> Vec<String> {
    let mut out: Vec<String> = std::fs::read_to_string("nav-accounts.txt").unwrap_or_default().lines().map(|l| l.trim().to_string()).filter(|l| l.starts_with("kaspatest:")).collect();
    let site = std::env::var("DAWNS_SITE").unwrap_or_else(|_| "https://www.dawns.money".into());
    match ureq::get(&format!("{site}/api/vaults/accounts?vault={cov}")).timeout(Duration::from_secs(10)).call() {
        Ok(r) => {
            if let Ok(v) = r.into_json::<Value>() {
                for a in v["accounts"].as_array().cloned().unwrap_or_default() { if let Some(s) = a.as_str() { out.push(s.to_string()); } }
            }
        }
        Err(e) => println!("registry       : {site} unavailable ({e}); using nav-accounts.txt only"),
    }
    out.sort();
    out.dedup();
    out
}

// ---------------------------------------------------------------------------
// deposit and redeem, as the keeper runs them
// ---------------------------------------------------------------------------
async fn sweep_deposit(c: &mut NCtx, owner: [u8; 32], owner_addr: &str, acct: &CompiledContract<'static>, coin: Coin) -> Res<()> {
    let sc = c.led.share_cov()?;
    let (mcoin, minter) = minter_coin(c).await?;
    let paid = coin.entry.amount as i64;
    let credit = paid - c.m.note_value - c.m.max_fee;
    if credit < c.m.min_deposit { println!("skip           : {owner_addr} sent {} (below the minimum; the owner can reclaim it)", kas(paid)); return Ok(()); }
    let held = c.coin.entry.amount as i64;
    let price = price_up(c.state.nav(held, &c.m), c.state.shares);
    let minted = credit / price;
    let next = Nav { shares: c.state.shares + minted, ..c.state };
    let succ = compile_nav(&c.m, &next)?;
    let rh = redeem_hash(owner, &c.cov.as_bytes())?;
    let note = compile_kcc(&rh, ID_SCRIPT_HASH, minted, false)?;
    let daa = claimed_nav(c)?;
    let vault_out = held + paid - c.m.note_value - c.m.max_fee;
    let mut tx = tx_of(
        vec![input(&c.coin, NAV_BUDGET), input(&coin, ACC_BUDGET), input(&mcoin, KCC_BUDGET)],
        vec![cont(&succ, vault_out, c.cov), cov_out(&minter, mcoin.entry.amount as i64, 2, sc), cov_out(&note, c.m.note_value, 2, sc)],
        daa as u64,
    );
    let entries = vec![c.coin.entry.clone(), coin.entry.clone(), mcoin.entry.clone()];
    tx.inputs[0].signature_script = decl_sigscript(&c.cur, "deposit", vec![nav_state(&next), Expr::int(daa)])?;
    tx.inputs[1].signature_script = entry_sigscript(acct, "enter", vec![])?;
    tx.inputs[2].signature_script = leader_sigscript(&minter, "transfer", vec![
        kcc_states(vec![(c.cov.as_bytes().to_vec(), ID_COVENANT, 0, true), (rh.to_vec(), ID_SCRIPT_HASH, minted, false)]),
        empty_sigs(), Expr::dynamic_bytes(vec![0])])?;
    tx.finalize();
    println!("deposit        : {} from {owner_addr} → {minted} shares at {} sompi", kas(paid), price);
    let id = commit(c, "deposit", tx, entries, next, vault_out, json!({ "owner": owner_addr, "paid": paid, "shares": minted, "price": price })).await?;
    c.led.push("notes", json!({ "owner": owner_addr, "shares": minted, "txid": id, "index": 2, "value": c.m.note_value, "at": now(), "price": price }));
    c.led.write()?;
    await_vault(c).await
}

async fn sweep_redeem(c: &mut NCtx, owner: [u8; 32], owner_addr: &str, acct: &CompiledContract<'static>, coin: Coin) -> Res<()> {
    let sc = c.led.share_cov()?;
    // the owner's oldest live note
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
    if c.m.maturity > 0 && c.daa - DAA_BACKOFF < c.m.maturity { println!("wait           : {owner_addr}: fixed term, redemptions open at DAA {}", c.m.maturity); return Ok(()); }
    let (mcoin, minter) = minter_coin(c).await?;
    let held = c.coin.entry.amount as i64;
    let price = c.state.nav(held, &c.m) / c.state.shares;
    let gross = shares * price;
    let payout = gross - gross * c.m.exit_fee_bps / 10_000;
    if held - payout < c.m.min_keep { println!("wait           : {owner_addr}: {} due, the vault holds {} liquid — waits for a recall", kas(payout), kas(held - c.m.min_keep)); return Ok(()); }
    let next = Nav { shares: c.state.shares - shares, ..c.state };
    let succ = compile_nav(&c.m, &next)?;
    let daa = claimed_nav(c)?;
    let to_owner = payout + coin.entry.amount as i64 + ncoin.entry.amount as i64 - c.m.max_fee;
    let vault_out = held - payout;
    let mut tx = tx_of(
        vec![input(&c.coin, NAV_BUDGET), input(&coin, ACC_BUDGET), input(&mcoin, KCC_BUDGET), input(&ncoin, KCC_BUDGET)],
        vec![cont(&succ, vault_out, c.cov), cov_out(&minter, mcoin.entry.amount as i64, 2, sc), out(to_owner, pay_to_address_script(&parse_addr(owner_addr)?))],
        daa as u64,
    );
    let entries = vec![c.coin.entry.clone(), coin.entry.clone(), mcoin.entry.clone(), ncoin.entry.clone()];
    tx.inputs[0].signature_script = decl_sigscript(&c.cur, "redeem", vec![nav_state(&next), Expr::int(daa)])?;
    tx.inputs[1].signature_script = entry_sigscript(acct, "enter", vec![])?;
    tx.inputs[2].signature_script = leader_sigscript(&minter, "transfer", vec![kcc_states(vec![(c.cov.as_bytes().to_vec(), ID_COVENANT, 0, true)]), empty_sigs(), Expr::dynamic_bytes(vec![0, 1])])?;
    tx.inputs[3].signature_script = decl_sigscript(&note, "transfer", vec![])?;
    tx.finalize();
    println!("redeem         : {shares} shares of {owner_addr} at {price} sompi → {} to the owner", kas(to_owner));
    let id = commit(c, "redeem", tx, entries, next, vault_out, json!({ "owner": owner_addr, "shares": shares, "price": price, "payout": to_owner })).await?;
    c.led.v["notes"][ni]["redeemed"] = json!({ "txid": id, "at": now(), "payout": to_owner, "price": price });
    c.led.write()?;
    await_vault(c).await
}

async fn keeper_pass(c: &mut NCtx) -> Res<usize> {
    let mut done = 0;
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

fn print_nav(c: &NCtx) {
    let held = c.coin.entry.amount as i64;
    let nav = c.state.nav(held, &c.m);
    println!("vault address  : {}", c.led.v["address"].as_str().unwrap_or(""));
    println!("share token    : {}", c.led.v["shareCovid"].as_str().unwrap_or("not created"));
    println!("held           : {} (of which the vault's own seed {})", kas(held), kas(c.m.min_keep));
    for (i, d) in c.m.dests.iter().enumerate() { println!("  [{i}] {:<24} cost {:>14}  mark {:>14}", d.label, kas(c.state.deployed[i]), kas(c.state.marks[i])); }
    println!("NAV            : {}", kas(nav));
    println!("shares         : {}", c.state.shares);
    if c.state.shares > 0 { println!("price / share  : {} sompi ({:.6} KAS per 1.00 share-unit of 0.01)", nav / c.state.shares, (nav as f64 / c.state.shares as f64) / KAS as f64); }
    println!("halted         : {}", c.state.halted);
    let live = c.led.v["notes"].as_array().map(|a| a.iter().filter(|n| n["redeemed"].is_null()).count()).unwrap_or(0);
    println!("notes live     : {live}");
}

// ---------------------------------------------------------------------------
pub async fn run_nav(args: &[String]) -> Res<()> {
    let sub = args.get(2).map(String::as_str).unwrap_or("show");
    let arg = |i: usize| -> Res<&str> { args.get(i).map(String::as_str).ok_or_else(|| "usage: see the header of src/nav.rs".into()) };
    match sub {
        "init" => {
            for r in ["allocator", "guardian", "valuer", "depositor", "strategy-0", "strategy-1", "strategy-2"] {
                let made = make_key(r)?;
                println!("{:<11} {} {}", r, address_of(&load_key(r)?), if made { "(new)" } else { "(kept)" });
            }
            let placeholder = std::fs::read_to_string("nav-mandate.json").map(|s| s.contains("\"planned\"")).unwrap_or(true);
            if !placeholder { println!("\nnav-mandate.json exists — left as is."); return Ok(()); }
            let a = |r: &str| -> Res<String> { Ok(address_of(&load_key(r)?).to_string()) };
            let doc = json!({
                "standard": NAV_STANDARD, "network": NETWORK,
                "name": "Dawns TN10 NAV vault",
                "objective": "Open to anyone on testnet-10: deposit KAS, receive shares at NAV, redeem at NAV. Destinations are Dawns-held strategy wallets standing in for real strategies.",
                "manager": "dawns",
                "roles": { "allocator": a("allocator")?, "valuer": a("valuer")?, "guardian": a("guardian")? },
                "destinations": [
                    { "label": "Strategy A (test wallet)", "address": a("strategy-0")?, "capBps": 4000 },
                    { "label": "Strategy B (test wallet)", "address": a("strategy-1")?, "capBps": 3000 },
                    { "label": "Strategy C (test wallet)", "address": a("strategy-2")?, "capBps": 2000 }
                ],
                "reserveFloorBps": 2000, "maxPerMoveSompi": 50 * KAS, "epochLimitSompi": 100 * KAS, "epochLengthDaa": 36_000,
                "maxFeeSompi": 5_000_000, "notBeforeDaa": 0, "maturityDaa": 0, "depositUntilDaa": 0,
                "minDepositSompi": 5 * KAS, "maxMarkStepBps": 1000, "noteValueSompi": KAS, "minKeepSompi": KAS, "exitFeeBps": 25
            });
            std::fs::write("nav-mandate.json", serde_json::to_string_pretty(&doc)? + "\n")?;
            println!("\nwrote nav-mandate.json (draft — fixed at genesis).");
        }

        "genesis" => {
            if Ledger::read().is_ok() { return Err("nav.json exists: one NAV vault per directory".into()); }
            let seed = parse_kas(arg(3)?)?;
            let client = connect().await?;
            let daa = ready(&client).await?;
            let mut doc: Value = serde_json::from_str(&std::fs::read_to_string("nav-mandate.json")?)?;
            if doc["notBeforeDaa"].as_i64() == Some(0) { doc["notBeforeDaa"] = json!(daa - DAA_BACKOFF); std::fs::write("nav-mandate.json", serde_json::to_string_pretty(&doc)? + "\n")?; }
            let m = read_nav_mandate()?;
            if seed < m.min_keep + MINTER_DUST + 2 * FEE as i64 { return Err(format!("seed at least {}", kas(m.min_keep + MINTER_DUST + 2 * FEE as i64)).into()); }
            let payer = load_key("depositor")?;
            let from = address_of(&payer);
            let funding = largest(&client, &from, (seed + FEE as i64) as u64).await?;
            let change = funding.entry.amount as i64 - seed - FEE as i64;
            change_ok(change)?;
            let st = Nav::fresh();
            let contract = compile_nav(&m, &st)?;
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
            println!("covenant bytes : {}\nmandate hash   : {}\ncovenant id    : {cov}\nvault address  : {addr}\nlocal engine   : ACCEPTED ({used:?})", contract.bytecode.len(), hex(&mandate_hash(&m.doc)));
            let led = Ledger { v: json!({
                "standard": NAV_STANDARD, "network": NETWORK, "name": m.doc["name"], "manager": m.doc["manager"],
                "covenantId": cov.to_string(), "mandateHash": hex(&mandate_hash(&m.doc)), "genesisTx": tx.id().to_string(), "createdAt": now(),
                "seed": seed, "state": st.to_json(), "address": addr.to_string(), "value": seed, "pending": Value::Null,
                "accountTemplate": { "prefix": hex(&ap), "suffix": hex(&asuf) },
                "shareCovid": Value::Null, "tokenTx": Value::Null, "notes": [], "moves": []
            })};
            led.write()?;
            match client.submit_transaction((&tx).into(), false).await {
                Ok(id) => println!("\nsubmitted. txid: {id}\nnext: cargo run --release -- nav token"),
                Err(e) => { std::fs::rename("nav.json", "nav.failed.json")?; return Err(format!("genesis rejected: {e} (ledger moved to nav.failed.json)").into()); }
            }
        }

        "token" => {
            let mut c = open_nav().await?;
            if !c.led.v["shareCovid"].is_null() { return Err("the share token already exists".into()); }
            let (kp, ks, _) = kcc_template()?;
            let token = compile_kcc(&c.cov.as_bytes(), ID_COVENANT, 0, true)?;
            let held = c.coin.entry.amount as i64;
            let placeholder = TransactionOutput { value: MINTER_DUST as u64, script_public_key: pay_to_script_hash_script(&token.bytecode), covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: Hash::from_bytes([0; 32]) }) };
            let sc = covenant_id(c.coin.outpoint, std::iter::once((0u32, &placeholder)));
            let next = Nav { share_covid: sc.as_bytes(), ..c.state };
            let succ = compile_nav(&c.m, &next)?;
            let vault_out = held - MINTER_DUST - c.m.max_fee;
            if vault_out < c.m.min_keep { return Err("the seed cannot pay for the token".into()); }
            let mut tx = tx_of(vec![input(&c.coin, NAV_BUDGET)], vec![cov_out(&token, MINTER_DUST, 0, sc), cont(&succ, vault_out, c.cov)], 0);
            let entries = vec![c.coin.entry.clone()];
            let args = |s: Vec<u8>| vec![nav_state(&next), Expr::dynamic_bytes(kp.clone()), Expr::dynamic_bytes(ks.clone()), Expr::bytes(s)];
            let sig = sighash_sig(&tx, &entries, 0, &load_key("guardian")?)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "init", args(sig))?;
            tx.finalize();
            println!("share token    : {sc}");
            let id = commit(&mut c, "token", tx, entries, next, vault_out, json!({ "shareCovid": sc.to_string() })).await?;
            c.led.v["shareCovid"] = json!(sc.to_string());
            c.led.v["tokenTx"] = json!(id);
            c.led.write()?;
        }

        "show" => { let c = open_nav().await?; print_nav(&c); }

        "accounts" => {
            // nav accounts <address> [vault covenant id — defaults to nav.json's]
            let cov: Hash = match args.get(4) { Some(c) => c.parse()?, None => Ledger::read()?.cov()? };
            let owner = owner_of(arg(3)?)?;
            let (d, r, _, _) = accounts_of(owner, &cov)?;
            let (ap, asuf, _) = account_template()?;
            println!("deposit to     : {d}\nredeem via     : {r}\ntemplate       : prefix {} suffix {}", hex(&ap), hex(&asuf));
        }

        "pay" => {
            let led = Ledger::read()?;
            let role = arg(3)?;
            let amount = parse_kas(arg(4)?)?;
            let kind = if args.get(5).map(String::as_str) == Some("redeem") { 1 } else { 0 };
            let k = load_key(role)?;
            let from = address_of(&k);
            let (d, r, _, _) = accounts_of(k.x_only_public_key().0.serialize(), &led.cov()?)?;
            let to = if kind == 1 { r } else { d };
            let client = connect().await?;
            ready(&client).await?;
            let coin = largest(&client, &from, (amount + FEE as i64) as u64).await?;
            let change = coin.entry.amount as i64 - amount - FEE as i64;
            change_ok(change)?;
            let mut outs = vec![out(amount, pay_to_address_script(&to))];
            if change > 0 { outs.push(out(change, pay_to_address_script(&from))); }
            let mut tx = tx_of(vec![input(&coin, P2PK_BUDGET)], outs, 0);
            let entries = vec![coin.entry.clone()];
            tx.inputs[0].signature_script = p2pk_sigscript(&sighash_sig(&tx, &entries, 0, &k)?)?;
            tx.finalize();
            let id = client.submit_transaction((&tx).into(), false).await?;
            println!("paid           : {} from {from} to {to}\ntxid           : {id}", kas(amount));
            let mut list = std::fs::read_to_string("nav-accounts.txt").unwrap_or_default();
            if !list.contains(&from.to_string()) { list.push_str(&format!("{from}\n")); std::fs::write("nav-accounts.txt", list)?; }
        }

        "keeper" => {
            let once = args.get(3).map(String::as_str) == Some("once");
            loop {
                let mut c = open_nav().await?;
                let n = keeper_pass(&mut c).await?;
                println!("keeper         : {n} done · {}", now());
                if once { break; }
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        }

        "allocate" => {
            let mut c = open_nav().await?;
            let slot: usize = arg(3)?.parse()?;
            let amount = parse_kas(arg(4)?)?;
            let d = c.m.dests.get(slot).ok_or("no such destination")?;
            let to = pay_to_address_script(&d.address);
            let held = c.coin.entry.amount as i64;
            let daa = claimed_nav(&c)?;
            let epoch = (daa - c.m.not_before) / c.m.epoch_length;
            let spent = if epoch == c.state.epoch_index { c.state.epoch_spent } else { 0 };
            let mut n = c.state;
            n.deployed[slot] += amount;
            n.marks[slot] += amount;
            n.epoch_index = epoch;
            n.epoch_spent = spent + amount;
            let succ = compile_nav(&c.m, &n)?;
            let keep = held - amount - c.m.max_fee;
            let mut tx = tx_of(vec![input(&c.coin, NAV_BUDGET)], vec![cont(&succ, keep, c.cov), out(amount, to)], daa as u64);
            let entries = vec![c.coin.entry.clone()];
            let sig = sighash_sig(&tx, &entries, 0, &load_key("allocator")?)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "allocate", vec![nav_state(&n), Expr::int(slot as i64), Expr::int(amount), Expr::int(daa), Expr::bytes(sig)])?;
            tx.finalize();
            println!("allocate       : {} to [{slot}] {}", kas(amount), c.m.dests[slot].label);
            commit(&mut c, "allocate", tx, entries, n, keep, json!({ "slot": slot, "amount": amount })).await?;
        }

        "recall" => {
            let mut c = open_nav().await?;
            let slot: usize = arg(3)?.parse()?;
            let amount = parse_kas(arg(4)?)?;
            let k = load_key(&format!("strategy-{slot}"))?;
            let from = address_of(&k);
            let coin = largest(&c.client, &from, amount as u64).await?;
            let change = coin.entry.amount as i64 - amount;
            change_ok(change)?;
            let held = c.coin.entry.amount as i64;
            let mut n = c.state;
            n.deployed[slot] = (n.deployed[slot] - amount).max(0);
            n.marks[slot] = (n.marks[slot] - amount).max(0);
            let succ = compile_nav(&c.m, &n)?;
            let landed = held + amount - c.m.max_fee;
            let mut outs = vec![cont(&succ, landed, c.cov)];
            if change > 0 { outs.push(out(change, pay_to_address_script(&from))); }
            let mut tx = tx_of(vec![input(&c.coin, NAV_BUDGET), input(&coin, P2PK_BUDGET)], outs, 0);
            let entries = vec![c.coin.entry.clone(), coin.entry.clone()];
            let s0 = sighash_sig(&tx, &entries, 0, &load_key("allocator")?)?;
            let s1 = sighash_sig(&tx, &entries, 1, &k)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "recall", vec![nav_state(&n), Expr::int(slot as i64), Expr::int(amount), Expr::bytes(s0)])?;
            tx.inputs[1].signature_script = p2pk_sigscript(&s1)?;
            tx.finalize();
            println!("recall         : {} from strategy-{slot}", kas(amount));
            commit(&mut c, "recall", tx, entries, n, landed, json!({ "slot": slot, "amount": amount })).await?;
        }

        "mark" => {
            let mut c = open_nav().await?;
            let mut n = c.state;
            for i in 0..c.m.dests.len() { if let Some(v) = args.get(3 + i) { n.marks[i] = (v.parse::<f64>()? * KAS as f64).round() as i64; } }
            let daa = claimed_nav(&c)?;
            n.mark_epoch = (daa - c.m.not_before) / c.m.epoch_length;
            let succ = compile_nav(&c.m, &n)?;
            let held = c.coin.entry.amount as i64;
            let keep = held - c.m.max_fee;
            let mut tx = tx_of(vec![input(&c.coin, NAV_BUDGET)], vec![cont(&succ, keep, c.cov)], daa as u64);
            let entries = vec![c.coin.entry.clone()];
            let sig = sighash_sig(&tx, &entries, 0, &load_key("valuer")?)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "mark", vec![nav_state(&n), Expr::int(daa), Expr::bytes(sig)])?;
            tx.finalize();
            println!("mark           : {:?}", n.marks.iter().map(|x| kas(*x)).collect::<Vec<_>>());
            commit(&mut c, "mark", tx, entries, n, keep, json!({ "marks": n.marks })).await?;
        }

        "halt" => {
            let mut c = open_nav().await?;
            let n = Nav { halted: true, ..c.state };
            let succ = compile_nav(&c.m, &n)?;
            let held = c.coin.entry.amount as i64;
            let keep = held - c.m.max_fee;
            let mut tx = tx_of(vec![input(&c.coin, NAV_BUDGET)], vec![cont(&succ, keep, c.cov)], 0);
            let entries = vec![c.coin.entry.clone()];
            let sig = sighash_sig(&tx, &entries, 0, &load_key("guardian")?)?;
            tx.inputs[0].signature_script = decl_sigscript(&c.cur, "halt", vec![nav_state(&n), Expr::bytes(sig)])?;
            tx.finalize();
            commit(&mut c, "halt", tx, entries, n, keep, json!({})).await?;
        }

        _ => return Err(format!("unknown nav command {sub}").into()),
    }
    Ok(())
}
