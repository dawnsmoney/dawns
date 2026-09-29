//! `credit template` / `nav template`: a covenant as a fill-in form, so anyone can
//! rebuild a vault's exact bytecode from its mandate and state, hash it, and compare
//! the address.
//!
//! The compiler inlines each constructor argument as a push wherever it is used, so the
//! bytecode is fixed bytes with holes. We find the holes by compiling once with a unique
//! sentinel in every mandate argument, then prove the form right: for many random
//! mandates and states, filling it gives the same bytes as the compiler.

use super::*;
use std::collections::{BTreeMap, BTreeSet};

/// Mandate arguments by name: 32-byte values and integers.
#[derive(Clone, Default)]
pub(crate) struct Named { pub(crate) b32: BTreeMap<String, [u8; 32]>, pub(crate) num: BTreeMap<String, i64> }
impl Named {
    pub(crate) fn b(&self, k: &str) -> [u8; 32] { self.b32[k] }
    pub(crate) fn n(&self, k: &str) -> i64 { self.num[k] }
}
/// A state field's value, in the covenant's state order.
#[derive(Clone, Copy)]
pub(crate) enum Sv { B32([u8; 32]), I64(i64), Bool(bool) }

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Enc { B32, Num, I64, Bool, Len(u8) }

/// One covenant family: its argument and state names, and how to compile and parse it.
pub(crate) struct Family {
    pub(crate) name: &'static str,
    pub(crate) latest: &'static str,
    /// (version, source, whether its paths read the mandate hash)
    pub(crate) versions: Vec<(&'static str, &'static str, bool)>,
    pub(crate) b32: Vec<String>,
    pub(crate) nums: Vec<String>,
    pub(crate) state: Vec<(&'static str, Enc)>,
    pub(crate) compile: fn(&'static str, &Named, &[Sv]) -> Res<CompiledContract<'static>>,
    pub(crate) fresh: fn() -> Vec<Sv>,
    pub(crate) state_json: fn(&[Sv]) -> Value,
    /// a mandate document as its `init` writes one, with random keys and terms
    pub(crate) random_doc: fn(&mut Rng, usize) -> Value,
    /// parse and validate a mandate document into its arguments
    pub(crate) named_of: fn(Value) -> Res<Named>,
    pub(crate) slots: usize,
}

const B32_TAG: [u8; 3] = [0x3C, 0xA5, 0x5A];
fn b32_sentinel(k: u8) -> [u8; 32] { let mut x = [0xC3u8; 32]; x[28] = k; x[29..].copy_from_slice(&B32_TAG); x }
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
fn push_sv(v: &Sv) -> Vec<u8> { match v { Sv::B32(x) => push_b32(x), Sv::I64(x) => push_i64(*x), Sv::Bool(b) => vec![0x01, *b as u8] } }
fn decode_num(d: &[u8]) -> Option<i64> {
    if d.is_empty() || d.len() > 8 { return None; }
    let mut v: u64 = 0;
    for (i, b) in d.iter().enumerate() { v |= (*b as u64 & if i == d.len() - 1 { 0x7f } else { 0xff }) << (8 * i); }
    let v = v as i64;
    Some(if d[d.len() - 1] & 0x80 != 0 { -v } else { v })
}
/// Which of the code's own lengths a number is: 0 after the state, 1 the whole code, 2 and 3 their negatives.
fn len_kind(v: i64, total: i64, after: i64) -> Option<u8> { [after, total, -after, -total].iter().position(|x| *x == v).map(|k| k as u8) }

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

enum Seg { Lit(Vec<u8>), Slot(String, Enc) }

/// Fill a form. The code's own lengths are pushed inside it, so their width changes the
/// length: start from a guess and repeat until the lengths agree with the result.
fn fill(f: &Family, segs: &[Seg], p: &Named, s: &[Sv]) -> Vec<u8> {
    let mut vals: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    for (k, v) in &p.b32 { vals.insert(k.clone(), push_b32(v)); }
    for (k, v) in &p.num { vals.insert(k.clone(), push_num(*v)); }
    for ((k, _), v) in f.state.iter().zip(s) { vals.insert(k.to_string(), push_sv(v)); }
    let last = f.state.last().unwrap().0;
    let (mut total, mut after) = (0i64, 0i64);
    for _ in 0..8 {
        let mut out = Vec::new();
        let mut state_end = 0;
        for g in segs {
            match g {
                Seg::Lit(b) => out.extend(b),
                Seg::Slot(_, Enc::Len(k)) => out.extend(push_num([after, total, -after, -total][*k as usize])),
                Seg::Slot(n, _) => { out.extend(&vals[n]); if n == last { state_end = out.len(); } }
            }
        }
        let (t, a) = (out.len() as i64, (out.len() - state_end) as i64);
        if t == total && a == after { return out; }
        total = t; after = a;
    }
    panic!("code lengths did not settle")
}

/// Compile with sentinels and cut the bytecode into literal bytes and named slots.
fn build(f: &Family, src: &'static str, reads_mandate: bool) -> Res<Vec<Seg>> {
    let mut p = Named::default();
    let mut b32 = Vec::new();
    let mut nums = Vec::new();
    let mut k = 1u8;
    for n in &f.b32 { p.b32.insert(n.clone(), b32_sentinel(k)); b32.push((b32_sentinel(k), n.clone())); k += 1; }
    for n in &f.nums { p.num.insert(n.clone(), int_sentinel(k)); nums.push((int_sentinel(k), n.clone())); k += 1; }
    let c = (f.compile)(src, &p, &(f.fresh)())?;
    let code = &c.bytecode;
    let (ss, se) = (c.state_layout.start, c.state_layout.start + c.state_layout.len);

    let mut segs: Vec<Seg> = Vec::new();
    let mut lit: Vec<u8> = Vec::new();
    let mut seen = BTreeSet::new();
    let mut state_i = 0;
    for (st, ds, en) in ops(code)? {
        let data = &code[ds..en];
        let slot: Option<(String, Enc)> = if st >= ss && en <= se {
            let (name, enc) = f.state.get(state_i).ok_or("more pushes in the state region than state fields")?;
            let shape = match enc { Enc::B32 => code[st] == 0x20, Enc::I64 => code[st] == 0x08, Enc::Bool => code[st] == 0x01, _ => false };
            if !shape { return Err(format!("state field {name} is not pushed as expected").into()); }
            state_i += 1;
            Some((name.to_string(), *enc))
        } else if code[st] == 0x20 && b32.iter().any(|(x, _)| x == data) {
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
    if state_i != f.state.len() { return Err(format!("state region has {state_i} pushes, expected {}", f.state.len()).into()); }
    // every mandate argument must be found (the mandate hash only where a path reads it),
    // and no sentinel may hide inside other bytes
    for nm in f.b32.iter().chain(f.nums.iter()) {
        let expected = nm != "mandateHash" || reads_mandate;
        if seen.contains(nm) != expected {
            return Err(if expected { format!("argument {nm} does not appear in the bytecode as a push") } else { format!("argument {nm} appears though this version should not read it") }.into());
        }
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

pub(crate) struct Rng(pub(crate) u64);
impl Rng {
    pub(crate) fn next(&mut self) -> u64 { self.0 ^= self.0 << 13; self.0 ^= self.0 >> 7; self.0 ^= self.0 << 17; self.0 }
    /// every encoding width: 0, small, one byte, sign-bit edges, up to 8 bytes, and i64::MAX/4
    pub(crate) fn int(&mut self) -> i64 {
        match self.next() % 10 { 0 => 0, 1 => (self.next() % 17) as i64, 2 => (self.next() % 256) as i64, 3 => 127 + (self.next() % 3) as i64, 4 => 32767 + (self.next() % 3) as i64,
            5 => (self.next() % 10_000) as i64, 6 => (self.next() % (1 << 40)) as i64, 7 => i64::MAX / 4, 8 => (self.next() >> 2) as i64, _ => 864_000 * (self.next() % 400) as i64 }
    }
    pub(crate) fn signed(&mut self) -> i64 { let v = self.int(); if self.next() % 4 == 0 { -v.min(i64::MAX / 2) } else { v } }
    pub(crate) fn b32(&mut self) -> [u8; 32] { let mut x = [0u8; 32]; for c in x.chunks_mut(8) { c.copy_from_slice(&self.next().to_le_bytes()); } x }
    pub(crate) fn pos(&mut self, hi: u64) -> i64 { 1 + (self.next() % hi) as i64 }
    pub(crate) fn addr(&mut self) -> String { Address::new(Prefix::Testnet, Version::PubKey, &self.b32()).to_string() }
    /// a script-hash address, as a NAV destination may be
    pub(crate) fn p2sh(&mut self) -> String { Address::new(Prefix::Testnet, Version::ScriptHash, &self.b32()).to_string() }
}

fn random_state(f: &Family, r: &mut Rng, safe: bool) -> Vec<Sv> {
    let clamp = |v: i64| if safe { v % (1 << 50) } else { v };
    f.state.iter().map(|(name, enc)| match enc {
        Enc::B32 => Sv::B32(if r.next() % 5 == 0 { [0; 32] } else { r.b32() }),
        Enc::Bool => Sv::Bool(r.next() % 2 == 0),
        _ => Sv::I64(clamp(if *name == "markEpoch" { if r.next() % 3 == 0 { -1 } else { r.signed() } } else { r.int() })),
    }).collect()
}

fn seg_json(segs: &[Seg]) -> Value {
    Value::Array(segs.iter().map(|g| match g {
        Seg::Lit(b) => json!(hex(b)),
        Seg::Slot(n, e) => json!({ "slot": n, "enc": match e { Enc::B32 => "b32", Enc::Num => "num", Enc::I64 => "i64", Enc::Bool => "bool", Enc::Len(_) => "len" } }),
    }).collect())
}

/// Build, prove and write a family's forms and vectors.
pub(crate) fn run(f: &Family, forms_path: &str, vectors_path: &str, param_ints: &[&str]) -> Res<()> {
    let mut r = Rng(0x0DA7_5C0F_FEE5_EED5 ^ f.name.len() as u64);
    let mut forms = serde_json::Map::new();
    let mut vectors = Vec::new();
    for (version, src, reads) in &f.versions {
        let segs = build(f, src, *reads)?;
        let slots = segs.iter().filter(|g| matches!(g, Seg::Slot(..))).count();
        // the proof: random mandate arguments and states, form against compiler
        for i in 0..200 {
            let mut p = Named::default();
            for n in &f.b32 { p.b32.insert(n.clone(), r.b32()); }
            for n in &f.nums { p.num.insert(n.clone(), r.int()); }
            let s = random_state(f, &mut r, false);
            let real = (f.compile)(src, &p, &s)?.bytecode;
            let got = fill(f, &segs, &p, &s);
            if got != real {
                let at = got.iter().zip(real.iter()).position(|(a, b)| a != b).unwrap_or(got.len().min(real.len()));
                return Err(format!("{version}: the form differs from the compiler on random case {i} at byte {at}: form {} / compiler {}", hex(&got[at.saturating_sub(4)..(at + 16).min(got.len())]), hex(&real[at.saturating_sub(4)..(at + 16).min(real.len())])).into());
            }
        }
        // vectors for the site: whole mandate documents, through parsing, to an address
        for i in 0..3 {
            let doc = (f.random_doc)(&mut r, 1 + i % f.slots);
            let p = (f.named_of)(doc.clone())?;
            let s = if i == 0 { (f.fresh)() } else { random_state(f, &mut r, true) };
            let c = (f.compile)(src, &p, &s)?;
            if fill(f, &segs, &p, &s) != c.bytecode { return Err(format!("{version}: vector {i} differs").into()); }
            vectors.push(json!({ "covenant": version, "mandate": doc, "state": (f.state_json)(&s), "bytecode": hex(&c.bytecode), "address": crate::nav::p2sh_addr(&c)?.to_string() }));
        }
        println!("{version:<17}: {} slots, 200 random cases match the compiler", slots);
        forms.insert(version.to_string(), json!({ "segments": seg_json(&segs) }));
    }
    let out = json!({
        "about": format!("The dawns {} covenant as a form: literal bytes and named slots. Fill each slot from the mandate and state (b32: 0x20 + 32 bytes; num: minimal script number push; i64: 0x08 + 8-byte little-endian sign-magnitude; bool: 0x01 + 00/01; len: the code's own lengths, filled until they settle), hash with blake2b-256, and the result is the vault's P2SH address. Generated by `dawns-vault {} template`; each form was checked against the compiler on 200 random cases.", f.name, f.name),
        "compiler": "silverscript 84eb797abdae4a67a46bcd1e7b97e4393e07e3b6",
        "paramInts": param_ints, "latest": f.latest, "forms": forms,
    });
    std::fs::write(forms_path, serde_json::to_string(&out)? + "\n")?;
    std::fs::write(vectors_path, serde_json::to_string_pretty(&json!({ "about": format!("Mandates, states and the bytecode and address the compiler gives them: a filler of the {} forms must reproduce each.", f.name), "vectors": vectors }))? + "\n")?;
    println!("wrote          : {forms_path}, {vectors_path} ({} vectors)", vectors.len());
    Ok(())
}
