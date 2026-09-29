import { blake2b } from "@noble/hashes/blake2b";
import { decodeKaspaAddress } from "../auth/kaspa";

/**
 * Does this address run a dawns covenant with this mandate? Rebuild the exact bytecode
 * from the mandate and the vault's state, hash it, and compare with the address the
 * vault's coin sits at. No key, no trust in who published the ledger.
 *
 * A form (credit-forms.json, nav-forms.json) is the covenant with every mandate and
 * state value cut out as a named slot; `dawns-vault credit|nav template` makes it and
 * proves it against the compiler on hundreds of random cases, and the *-vectors.json
 * files hold full mandate → address cases this code is tested on.
 */

export type Enc = "b32" | "num" | "i64" | "bool" | "len";
export type Seg = string | { slot: string; enc: Enc };
export type Forms = { forms: Record<string, { segments: Seg[] }>; paramInts: string[]; latest: string };

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const unhex = (h: string) => { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16); return o; };
export const cat = (xs: Uint8Array[]) => { const o = new Uint8Array(xs.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of xs) { o.set(x, i); i += x.length; } return o; };
export const b2b = (b: Uint8Array) => blake2b(b, { dkLen: 32 });

/** A script number, minimal, as the compiler pushes an int argument. */
export function pushNum(v: bigint): Uint8Array {
  if (v === BigInt(0)) return Uint8Array.of(0x00);
  if (v >= BigInt(1) && v <= BigInt(16)) return Uint8Array.of(0x50 + Number(v));
  if (v === BigInt(-1)) return Uint8Array.of(0x4f);
  const neg = v < BigInt(0);
  let m = neg ? -v : v;
  const d: number[] = [];
  while (m > BigInt(0)) { d.push(Number(m & BigInt(0xff))); m >>= BigInt(8); }
  if (d[d.length - 1] & 0x80) d.push(neg ? 0x80 : 0); else if (neg) d[d.length - 1] |= 0x80;
  return Uint8Array.of(d.length, ...d);
}
/** A state int: 8 bytes little-endian magnitude, sign in the top bit. */
export function pushI64(v: bigint): Uint8Array {
  const neg = v < BigInt(0);
  let m = neg ? -v : v;
  const d = new Uint8Array(9);
  d[0] = 0x08;
  for (let i = 1; i <= 8; i++) { d[i] = Number(m & BigInt(0xff)); m >>= BigInt(8); }
  if (neg) d[8] |= 0x80;
  return d;
}
export const pushB32 = (x: Uint8Array) => { if (x.length !== 32) throw new Error("not 32 bytes"); return cat([Uint8Array.of(0x20), x]); };
export const pushBool = (b: boolean) => Uint8Array.of(0x01, b ? 1 : 0);

/** The mandate document hashed as the deploy tool hashes it: compact JSON, keys sorted. */
export function sortedJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => `${JSON.stringify(k)}:${sortedJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const mandateHashOf = (doc: unknown) => hex(b2b(new TextEncoder().encode(sortedJson(doc))));

/** A role or borrower key: a plain (Schnorr P2PK) address's 32-byte key. */
export function keyOf(a: unknown, what: string): Uint8Array {
  if (typeof a !== "string") throw new Error(`${what} missing`);
  const d = decodeKaspaAddress(a.trim().toLowerCase());
  if (d.version !== 0 || d.payload.length !== 32) throw new Error(`${what} is not a plain (P2PK) address`);
  return Uint8Array.from(d.payload);
}
/** blake2b of an address's script public key (version 0, then the script), as a destination is registered. */
export function destHash(a: unknown, what: string): Uint8Array {
  if (typeof a !== "string") throw new Error(`${what} missing`);
  const d = decodeKaspaAddress(a.trim().toLowerCase());
  const p = Uint8Array.from(d.payload);
  const script = d.version === 0 && p.length === 32 ? cat([Uint8Array.of(0x20), p, Uint8Array.of(0xac)])       // Schnorr key: <key> OP_CHECKSIG
    : d.version === 1 && p.length === 33 ? cat([Uint8Array.of(0x21), p, Uint8Array.of(0xab)])                   // ECDSA key: <key> OP_CHECKSIGECDSA
    : d.version === 8 && p.length === 32 ? cat([Uint8Array.of(0xaa, 0x20), p, Uint8Array.of(0x87)])             // script hash: OP_BLAKE2B <hash> OP_EQUAL
    : null;
  if (!script) throw new Error(`${what} is not an address a vault can pay`);
  return b2b(cat([Uint8Array.of(0, 0), script]));
}
export const intOf = (doc: Record<string, unknown>, k: string) => { const v = doc[k]; if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new Error(`mandate.${k} must be an integer`); return BigInt(v); };
/** A zero deposit deadline means none: the deploy tool compiles i64::MAX / 4. */
export const NO_DEADLINE = BigInt("2305843009213693951");

/** The covenant's bytecode for these slot values. Its own lengths sit inside it, so fill until they agree. */
export function fillForm(forms: Forms, version: string, vals: Map<string, Uint8Array>, lastState: string): Uint8Array {
  const f = forms.forms[version];
  if (!f) throw new Error(`unknown covenant ${version}`);
  let total = BigInt(0), after = BigInt(0);
  for (let round = 0; round < 8; round++) {
    const parts: Uint8Array[] = [];
    let n = 0, stateEnd = 0;
    for (const g of f.segments) {
      let b: Uint8Array;
      if (typeof g === "string") b = unhex(g);
      else if (g.enc === "len") b = pushNum({ codeAfterState: after, codeLength: total, minusCodeAfterState: -after, minusCodeLength: -total }[g.slot as "codeLength"]);
      else { const x = vals.get(g.slot); if (!x) throw new Error(`no value for ${g.slot}`); b = x; }
      parts.push(b); n += b.length;
      if (typeof g !== "string" && g.slot === lastState) stateEnd = n;
    }
    const t = BigInt(n), a = BigInt(n - stateEnd);
    if (t === total && a === after) return cat(parts);
    total = t; after = a;
  }
  throw new Error("code lengths did not settle");
}

export type CodeCheck = { ok: true; scriptHash: string } | { ok: false; why: string };
/** Does `address` hold exactly this bytecode? */
export function checkAddress(address: string, build: () => Uint8Array, what: string): CodeCheck {
  try {
    const d = decodeKaspaAddress(address);
    if (d.version !== 8 || d.payload.length !== 32) return { ok: false, why: "the vault's address is not a script address" };
    const h = hex(b2b(build()));
    return h === hex(Uint8Array.from(d.payload)) ? { ok: true, scriptHash: h } : { ok: false, why: `the address does not hold ${what}` };
  } catch (e) { return { ok: false, why: (e as Error).message }; }
}
