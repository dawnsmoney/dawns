//! `credit template`: the credit covenant as a fill-in form, so anyone can rebuild a
//! vault's exact bytecode from its mandate and state, hash it, and compare the address.
//!
//! The compiler inlines each constructor argument as a push wherever it is used, so the
//! bytecode is fixed bytes with holes. We find the holes by compiling once with a unique
//! sentinel in every mandate argument, then prove the form right: for many random
//! mandates and states, filling it gives the same bytes as the compiler.

use super::*;
use super::credit::*;

const B32_TAG: [u8; 4] = [0x3C, 0xA5, 0x5A, 0x00];
fn b32_sentinel(k: u8) -> [u8; 32] { let mut x = [0xC3u8; 32]; x[28] = k; x[29..].copy_from_slice(&B32_TAG[..3]); x }
fn int_sentinel(k: u8) -> i64 { 0x5A5A_0000_0000 + k as i64 }

/// A script number, minimally encoded and pushed (what the compiler emits for an int argument).
pub(crate) fn push_num(v: i64) -> Vec<u8> {
    if v == 0 { return vec![0x00]; }
    if (1..=16).contains(&v) { return vec![0x50 + v as u8]; }
    if v == -1 { return vec![0x4f]; }
    let neg = v < 0;
    let mut m = v.unsigned_abs();
    let mut d = Vec::new();
    while m > 0 { d.push((m & 0xff) as u8); m >>= 8; }
    if d.last().unwrap() & 0x80 != 0 { d.push(if neg { 0x80 } else { 0 }); } else if neg { *d.last_mut().unwrap() |= 0x80; }
    let mut out = vec![d.len() as u8];
    out.extend(d);
    out
}
/// A state int: always 8 bytes, little-endian magnitude with the sign in the top bit.
pub(crate) fn push_i64(v: i64) -> Vec<u8> {
    let mut d = v.unsigned_abs().to_le_bytes();
    if v < 0 { d[7] |= 0x80; }
    let mut out = vec![0x08];
    out.extend(d);
    out
}
fn push_b32(x: &[u8; 32]) -> Vec<u8> { let mut o = vec![0x20]; o.extend(x); o }
/// Which of the code's own lengths a number is: 0 after the state, 1 the whole code, 2 and 3 their negatives.
fn len_kind(v: i64, total: i64, after: i64) -> Option<u8> { [after, total, -after, -total].iter().position(|x| *x == v).map(|k| k as u8) }
fn decode_num(d: &[u8]) -> Option<i64> {
    if d.is_empty() || d.len() > 8 { return None; }
    let mut v: u64 = 0;
    for (i, b) in d.iter().enumerate() { v |= (*b as u64 & if i == d.len() - 1 { 0x7f } else { 0xff }) << (8 * i); }
    let v = v as i64;
    Some(if d[d.len() - 1] & 0x80 != 0 { -v } else { v })
}

/// Pushes and other ops: (start, data start, end).
fn ops(b: &[u8]) -> Res<Vec<(usize, usize, usize)>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let op = b[i];
        let (ds, n) = match op {
            0x01..=0x4b => (i + 1, op as usize),
            0x4c => (i + 2, *b.get(i + 1).ok_or("truncated")? as usize),
            0x4d => (i + 3, u16::from_le_bytes([b[i + 1], b[i + 2]]) as usize),
            0x4e => (i + 5, u32::from_le_bytes([b[i + 1], b[i + 2], b[i + 3], b[i + 4]]) as usize),
            _ => (i + 1, 0),
        };
        if ds + n > b.len() { return Err("push runs past the end".into()); }
        out.push((i, ds, ds + n));
        i = ds + n;
    }
    Ok(out)
}

#[derive(Clone, Copy)]
enum Enc { B32, Num, I64, Bool, Len(u8) }
enum Seg { Lit(Vec<u8>), Slot(String, Enc) }

const STATE: [(&str, Enc); 15] = [
    ("shareCovid", Enc::B32), ("shares", Enc::I64), ("principal0", Enc::I64), ("principal1", Enc::I64), ("principal2", Enc::I64),
    ("due0", Enc::I64), ("due1", Enc::I64), ("due2", Enc::I64), ("mark0", Enc::I64), ("mark1", Enc::I64), ("mark2", Enc::I64),
    ("epochIndex", Enc::I64), ("epochSpent", Enc::I64), ("markEpoch", Enc::I64), ("halted", Enc::Bool),
];

/// Every named value that goes into the covenant, from mandate parameters and state.
fn values(p: &CreditParams, s: &Credit) -> std::collections::BTreeMap<String, Vec<u8>> {
    let mut v = std::collections::BTreeMap::new();
    for (i, n) in ["allocator", "valuer", "guardian"].iter().enumerate() { v.insert(n.to_string(), push_b32(&p.keys[i])); }
    v.insert("maxFeeSompi".into(), push_num(p.max_fee));
    for i in 0..SLOTS {
        v.insert(format!("dest{i}"), push_b32(&p.dests[i]));
        v.insert(format!("cap{i}"), push_num(p.caps[i]));
        v.insert(format!("term{i}"), push_num(p.terms[i]));
        v.insert(format!("interest{i}"), push_num(p.interests[i]));
    }
    for (i, n) in PARAM_INTS.iter().enumerate() { v.insert(n.to_string(), push_num(p.ints[i])); }
    v.insert("mandateHash".into(), push_b32(&p.mandate));
    v.insert("shareCovid".into(), push_b32(&s.share_covid));
    let ints = [s.shares, s.principal[0], s.principal[1], s.principal[2], s.due[0], s.due[1], s.due[2], s.marks[0], s.marks[1], s.marks[2], s.epoch_index, s.epoch_spent, s.mark_epoch];
    for (k, x) in STATE[1..14].iter().zip(ints) { v.insert(k.0.to_string(), push_i64(x)); }
    v.insert("halted".into(), vec![0x01, s.halted as u8]);
    v
}

/// Fill the form. The code's own lengths are pushed inside it, so their width changes the
/// length: start from a guess and repeat until the lengths agree with the result.
fn fill(segs: &[Seg], p: &CreditParams, s: &Credit) -> Vec<u8> {
    let vals = values(p, s);
    let (mut total, mut after) = (0i64, 0i64);
    for _ in 0..8 {
        let mut out = Vec::new();
        let mut state_end = 0;
        for g in segs {
            match g {
                Seg::Lit(b) => out.extend(b),
                Seg::Slot(n, Enc::Len(k)) => { let _ = n; out.extend(push_num([after, total, -after, -total][*k as usize])); }
                Seg::Slot(n, e) => { out.extend(&vals[n]); if matches!(e, Enc::Bool) && n == "halted" { state_end = out.len(); } }
            }
        }
        let (t, a) = (out.len() as i64, (out.len() - state_end) as i64);
        if t == total && a == after { return out; }
        total = t; after = a;
    }
    panic!("code lengths did not settle")
}

/// Compile with sentinels and cut the bytecode into literal bytes and named slots.
fn build(src: &'static str) -> Res<Vec<Seg>> {
    let mut p = CreditParams { keys: [[0; 32]; 3], max_fee: 0, dests: [[0; 32]; SLOTS], caps: [0; SLOTS], terms: [0; SLOTS], interests: [0; SLOTS], ints: [0; 15], mandate: [0; 32] };
    let mut b32 = Vec::new();
    let mut nums = Vec::new();
    let mut k = 1u8;
    let mut b = |name: String, slot: &mut [u8; 32]| { *slot = b32_sentinel(k); b32.push((b32_sentinel(k), name)); k += 1; };
    for (i, n) in ["allocator", "valuer", "guardian"].iter().enumerate() { b(n.to_string(), &mut p.keys[i]); }
    for i in 0..SLOTS { b(format!("dest{i}"), &mut p.dests[i]); }
    b("mandateHash".into(), &mut p.mandate);
    let mut n = |name: String, slot: &mut i64| { *slot = int_sentinel(k); nums.push((int_sentinel(k), name)); k += 1; };
    n("maxFeeSompi".into(), &mut p.max_fee);
    for i in 0..SLOTS { n(format!("cap{i}"), &mut p.caps[i]); n(format!("term{i}"), &mut p.terms[i]); n(format!("interest{i}"), &mut p.interests[i]); }
    for (i, name) in PARAM_INTS.iter().enumerate() { n(name.to_string(), &mut p.ints[i]); }
    let c = compile_credit_src(src, &p, &Credit::fresh())?;
    let code = &c.bytecode;
    let (ss, se) = (c.state_layout.start, c.state_layout.start + c.state_layout.len);

    let mut segs: Vec<Seg> = Vec::new();
    let mut lit: Vec<u8> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let mut state_i = 0;
    for (st, ds, en) in ops(code)? {
        let data = &code[ds..en];
        let slot: Option<(String, Enc)> = if st >= ss && en <= se {
            let (name, enc) = STATE.get(state_i).ok_or("more pushes in the state region than state fields")?;
            let shape = match enc { Enc::B32 => code[st] == 0x20, Enc::I64 => code[st] == 0x08, Enc::Bool => code[st] == 0x01, _ => false };
            if !shape { return Err(format!("state field {name} is not pushed as expected").into()); }
            state_i += 1;
            Some((name.to_string(), *enc))
        } else if code[st] == 0x20 {
            b32.iter().find(|(x, _)| x == data).map(|(_, nm)| (nm.clone(), Enc::B32))
        } else if code[st] == 0x06 && nums.iter().any(|(x, _)| push_num(*x)[1..] == *data) {
            nums.iter().find(|(x, _)| push_num(*x)[1..] == *data).map(|(_, nm)| (nm.clone(), Enc::Num))
        } else if let Some(k) = (0x01..=0x08).contains(&code[st]).then(|| decode_num(data)).flatten().and_then(|v| len_kind(v, code.len() as i64, (code.len() - se) as i64)) {
            // the script reads its own code: those lengths move with the width of the pushes
            Some((["codeAfterState", "codeLength", "minusCodeAfterState", "minusCodeLength"][k as usize].into(), Enc::Len(k)))
        } else { None };
        match slot {
            Some((name, enc)) => {
                if !lit.is_empty() { segs.push(Seg::Lit(std::mem::take(&mut lit))); }
                seen.insert(name.clone());
                segs.push(Seg::Slot(name, enc));
            }
            None => lit.extend(&code[st..en]),
        }
    }
    if !lit.is_empty() { segs.push(Seg::Lit(lit)); }
    if state_i != STATE.len() { return Err(format!("state region has {state_i} pushes, expected {}", STATE.len()).into()); }
    // every mandate argument must be found, and no sentinel may hide inside other bytes
    for nm in b32.iter().map(|(_, n)| n).chain(nums.iter().map(|(_, n)| n)) {
        // v0 and v0.1 never read the mandate hash, so the compiler leaves it out
        if !seen.contains(nm) && !(nm == "mandateHash" && !src.contains("require(mandateHash == mandateHash)")) { return Err(format!("argument {nm} does not appear in the bytecode as a push").into()); }
    }
    for g in &segs {
        if let Seg::Lit(bytes) = g {
            if bytes.windows(8).any(|w| w.iter().all(|x| *x == 0xC3)) || bytes.windows(4).any(|w| w == [0, 0, 0x5A, 0x5A]) {
                return Err("a sentinel is left in literal bytes: the compiler used an argument other than as a push".into());
            }
        }
    }
    Ok(segs)
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 { self.0 ^= self.0 << 13; self.0 ^= self.0 >> 7; self.0 ^= self.0 << 17; self.0 }
    fn int(&mut self) -> i64 {
        // every encoding width: 0, small, one byte, sign-bit edges, up to 8 bytes, and i64::MAX/4
        match self.next() % 10 { 0 => 0, 1 => (self.next() % 17) as i64, 2 => (self.next() % 256) as i64, 3 => 127 + (self.next() % 3) as i64, 4 => 32767 + (self.next() % 3) as i64,
            5 => (self.next() % 10_000) as i64, 6 => (self.next() % (1 << 40)) as i64, 7 => i64::MAX / 4, 8 => (self.next() >> 2) as i64, _ => 864_000 * (self.next() % 400) as i64 }
    }
    fn signed(&mut self) -> i64 { let v = self.int(); if self.next() % 4 == 0 { -v.min(i64::MAX / 2) } else { v } }
    fn b32(&mut self) -> [u8; 32] { let mut x = [0u8; 32]; for c in x.chunks_mut(8) { c.copy_from_slice(&self.next().to_le_bytes()); } x }
}

fn seg_json(segs: &[Seg]) -> Value {
    Value::Array(segs.iter().map(|g| match g {
        Seg::Lit(b) => json!(hex(b)),
        Seg::Slot(n, e) => json!({ "slot": n, "enc": match e { Enc::B32 => "b32", Enc::Num => "num", Enc::I64 => "i64", Enc::Bool => "bool", Enc::Len(_) => "len" } }),
    }).collect())
}

/// A mandate document the way `credit init` writes one, with random keys and terms.
fn random_doc(r: &mut Rng, slots: usize) -> Value {
    let addr = |r: &mut Rng| Address::new(Prefix::Testnet, Version::PubKey, &r.b32()).to_string();
    let pos = |r: &mut Rng, hi: u64| 1 + (r.next() % hi) as i64;
    json!({
        "standard": "dawns-credit/0", "network": NETWORK, "name": format!("Vector {}", r.next() % 1000), "objective": "self-check",
        "roles": { "allocator": addr(r), "valuer": addr(r), "guardian": addr(r) },
        "borrowers": (0..slots).map(|i| json!({ "label": format!("B{i}"), "address": addr(r), "capBps": pos(r, 10_000), "termDaa": pos(r, 900_000_000), "interestBps": (r.next() % 10_001) as i64 })).collect::<Vec<_>>(),
        "graceDaa": (r.next() % 90_000_000) as i64, "markdownStepBps": (r.next() % 10_001) as i64, "markdownPeriodDaa": pos(r, 90_000_000),
        "reserveFloorBps": (r.next() % 10_001) as i64, "maxPerMoveSompi": (r.int() % (1 << 50)).max(1), "epochLimitSompi": (r.int() % (1 << 50)).max(1), "epochLengthDaa": pos(r, 9_000_000),
        "maxFeeSompi": 1_000_000 + (r.next() % 90_000_000) as i64, "notBeforeDaa": (r.next() % 900_000_000) as i64,
        "maturityDaa": 0, "depositUntilDaa": if r.next() % 2 == 0 { 0 } else { pos(r, 1 << 40) },
        "minDepositSompi": r.int() % (1 << 50), "maxMarkStepBps": (r.next() % 10_001) as i64, "noteValueSompi": 100_000_000 + (r.next() % 1_000_000_000) as i64,
        "minKeepSompi": 100_000_000 + (r.next() % 1_000_000_000) as i64, "exitFeeBps": (r.next() % 1_001) as i64,
    })
}
fn random_state(r: &mut Rng) -> Credit {
    Credit { share_covid: if r.next() % 5 == 0 { [0; 32] } else { r.b32() }, shares: r.int(), principal: [r.int(), r.int(), r.int()], due: [r.int(), r.int(), r.int()], marks: [r.int(), r.int(), r.int()],
        epoch_index: r.int(), epoch_spent: r.int(), mark_epoch: if r.next() % 3 == 0 { -1 } else { r.signed() }, halted: r.next() % 2 == 0 }
}

pub async fn run(args: &[String]) -> Res<()> {
    let out_path = args.get(3).cloned().unwrap_or_else(|| "credit-forms.json".into());
    let vec_path = args.get(4).cloned().unwrap_or_else(|| "credit-vectors.json".into());
    let mut r = Rng(0x0DA7_5C0F_FEE5_EED5);
    let mut forms = serde_json::Map::new();
    let mut vectors = Vec::new();
    for (version, src) in [("dawns-credit/0", CREDIT_V0), ("dawns-credit/0.1", CREDIT_V01), ("dawns-credit/0.2", CREDIT_V02)] {
        let segs = build(src)?;
        let slots = segs.iter().filter(|g| matches!(g, Seg::Slot(..))).count();
        // the proof: random mandate parameters and states, form against compiler
        for i in 0..200 {
            let p = CreditParams { keys: [r.b32(), r.b32(), r.b32()], max_fee: r.int(), dests: [r.b32(), r.b32(), r.b32()], caps: [r.int(), r.int(), r.int()], terms: [r.int(), r.int(), r.int()],
                interests: [r.int(), r.int(), r.int()], ints: std::array::from_fn(|_| r.int()), mandate: r.b32() };
            let s = random_state(&mut r);
            let real = compile_credit_src(src, &p, &s)?.bytecode;
            let f = fill(&segs, &p, &s);
            if f != real {
                let at = f.iter().zip(real.iter()).position(|(a, b)| a != b).unwrap_or(f.len().min(real.len()));
                return Err(format!("{version}: the form differs from the compiler on random case {i} at byte {at} (form {} vs compiler {}): form {} / compiler {}", f.len(), real.len(), hex(&f[at.saturating_sub(4)..(at + 16).min(f.len())]), hex(&real[at.saturating_sub(4)..(at + 16).min(real.len())])).into());
            }
        }
        // vectors for the site: whole mandate documents, through parsing, to an address
        for i in 0..3 {
            let doc = random_doc(&mut r, 1 + i % SLOTS);
            let m = parse_credit_mandate(doc.clone())?;
            // JSON numbers the site reads are safe below 2^53, as real sompi and DAA values are
            let s = if i == 0 { Credit::fresh() } else { let mut s = random_state(&mut r); for x in s.principal.iter_mut().chain(s.due.iter_mut()).chain(s.marks.iter_mut()).chain([&mut s.shares, &mut s.epoch_index, &mut s.epoch_spent, &mut s.mark_epoch]) { *x %= 1 << 50; } s };
            let c = compile_credit_src(src, &credit_params(&m)?, &s)?;
            if fill(&segs, &credit_params(&m)?, &s) != c.bytecode { return Err(format!("{version}: vector {i} differs").into()); }
            vectors.push(json!({ "covenant": version, "mandate": doc, "state": s.to_json(), "bytecode": hex(&c.bytecode), "address": crate::nav::p2sh_addr(&c)?.to_string() }));
        }
        println!("{version:<17}: {} bytes, {slots} slots, 200 random cases match the compiler", compile_credit_src(src, &credit_params(&parse_credit_mandate(random_doc(&mut r, 3))?)?, &Credit::fresh())?.bytecode.len());
        forms.insert(version.into(), json!({ "segments": seg_json(&segs) }));
    }
    let out = json!({
        "about": "The dawns credit covenant as a form: literal bytes and named slots. Fill each slot from the mandate and state (b32: 0x20 + 32 bytes; num: minimal script number push; i64: 0x08 + 8-byte little-endian sign-magnitude; bool: 0x01 + 00/01), hash with blake2b-256, and the result is the vault's P2SH address. Generated by `dawns-vault credit template`; each form was checked against the compiler on 200 random cases.",
        "compiler": "silverscript 84eb797abdae4a67a46bcd1e7b97e4393e07e3b6",
        "paramInts": PARAM_INTS, "latest": "dawns-credit/0.2", "forms": forms,
    });
    std::fs::write(&out_path, serde_json::to_string(&out)? + "\n")?;
    std::fs::write(&vec_path, serde_json::to_string_pretty(&json!({ "about": "Mandates, states and the bytecode and address the compiler gives them: a filler of credit-forms.json must reproduce each.", "vectors": vectors }))? + "\n")?;
    println!("wrote          : {out_path}, {vec_path} ({} vectors)", vectors.len());
    Ok(())
}
