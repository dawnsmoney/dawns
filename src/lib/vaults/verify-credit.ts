import { blake2b } from "@noble/hashes/blake2b";
import { decodeKaspaAddress } from "../auth/kaspa";
import forms from "./credit-forms.json";

/**
 * Does this address run the dawns credit covenant with this mandate? Rebuild the exact
 * bytecode from the mandate and the vault's state, hash it, and compare with the
 * address the vault's coin sits at. No key, no trust in who published the ledger.
 *
 * The form (credit-forms.json) is the covenant with every mandate and state value cut
 * out as a named slot; `dawns-vault credit template` makes it and proves it against
 * the compiler on hundreds of random cases, and credit-vectors.json holds full
 * mandate → address cases this file is tested on.
 */

type Enc = "b32" | "num" | "i64" | "bool" | "len";
type Seg = string | { slot: string; enc: Enc };
const FORMS = (forms as unknown as { forms: Record<string, { segments: Seg[] }>; paramInts: string[]; latest: string });
export const CREDIT_VERSIONS = Object.keys(FORMS.forms);
export const CREDIT_LATEST = FORMS.latest;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16); return o; };
const cat = (xs: Uint8Array[]) => { const o = new Uint8Array(xs.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of xs) { o.set(x, i); i += x.length; } return o; };
const b2b = (b: Uint8Array) => blake2b(b, { dkLen: 32 });

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
const pushB32 = (x: Uint8Array) => { if (x.length !== 32) throw new Error("not 32 bytes"); return cat([Uint8Array.of(0x20), x]); };

type Doc = Record<string, unknown> & { roles?: Record<string, string>; borrowers?: { address: string; capBps: number; termDaa: number; interestBps: number }[] };
export type CreditStateDoc = { shareCovid: string | null; shares: number; principal: number[]; due: number[]; marks: number[]; epochIndex: number; epochSpent: number; markEpoch: number; halted: boolean };

/** The mandate document hashed as the deploy tool hashes it: compact JSON, keys sorted. */
export function sortedJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => `${JSON.stringify(k)}:${sortedJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const mandateHashOf = (doc: unknown) => hex(b2b(new TextEncoder().encode(sortedJson(doc))));

const key = (a: unknown, what: string) => {
  if (typeof a !== "string") throw new Error(`${what} missing`);
  const d = decodeKaspaAddress(a.trim().toLowerCase());
  if (d.version !== 0 || d.payload.length !== 32) throw new Error(`${what} is not a plain (P2PK) address`);
  return Uint8Array.from(d.payload);
};
const int = (doc: Doc, k: string) => { const v = doc[k]; if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new Error(`mandate.${k} must be an integer`); return BigInt(v); };

/** Every named value the covenant is compiled with, as the pushes the compiler emits. */
function values(doc: Doc, st: CreditStateDoc): Map<string, Uint8Array> {
  const v = new Map<string, Uint8Array>();
  (["allocator", "valuer", "guardian"] as const).forEach((r) => v.set(r, pushB32(key(doc.roles?.[r], `roles.${r}`))));
  v.set("maxFeeSompi", pushNum(int(doc, "maxFeeSompi")));
  const bs = doc.borrowers ?? [];
  if (!Array.isArray(bs) || bs.length < 1 || bs.length > 3) throw new Error("1 to 3 borrowers");
  for (let i = 0; i < 3; i++) {
    const b = bs[i];
    // a slot's destination: the hash of the borrower's script public key (version 0, <32-byte key> OP_CHECKSIG)
    v.set(`dest${i}`, pushB32(b ? b2b(cat([Uint8Array.of(0, 0, 0x20), key(b.address, `borrowers[${i}].address`), Uint8Array.of(0xac)])) : new Uint8Array(32)));
    v.set(`cap${i}`, pushNum(b ? BigInt(b.capBps) : BigInt(0)));
    v.set(`term${i}`, pushNum(b ? BigInt(b.termDaa) : BigInt(0)));
    v.set(`interest${i}`, pushNum(b ? BigInt(b.interestBps) : BigInt(0)));
  }
  for (const k of FORMS.paramInts) {
    let x = int(doc, k);
    if (k === "depositUntilDaa" && x === BigInt(0)) x = BigInt("2305843009213693951");   // i64::MAX / 4: no deposit deadline
    v.set(k, pushNum(x));
  }
  v.set("mandateHash", pushB32(unhex(mandateHashOf(doc))));
  v.set("shareCovid", pushB32(st.shareCovid ? unhex(st.shareCovid) : new Uint8Array(32)));
  const ints: [string, number][] = [["shares", st.shares], ...st.principal.map((x, i): [string, number] => [`principal${i}`, x]), ...st.due.map((x, i): [string, number] => [`due${i}`, x]), ...st.marks.map((x, i): [string, number] => [`mark${i}`, x]),
    ["epochIndex", st.epochIndex], ["epochSpent", st.epochSpent], ["markEpoch", st.markEpoch]];
  for (const [k, x] of ints) v.set(k, pushI64(BigInt(x)));
  v.set("halted", Uint8Array.of(0x01, st.halted ? 1 : 0));
  return v;
}

/** The covenant's bytecode for this mandate and state. Its own lengths sit inside it, so fill until they agree. */
export function creditBytecode(version: string, doc: unknown, st: CreditStateDoc): Uint8Array {
  const f = FORMS.forms[version];
  if (!f) throw new Error(`unknown covenant ${version}`);
  const vals = values(doc as Doc, st);
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
      if (typeof g !== "string" && g.slot === "halted") stateEnd = n;
    }
    const t = BigInt(n), a = BigInt(n - stateEnd);
    if (t === total && a === after) return cat(parts);
    total = t; after = a;
  }
  throw new Error("code lengths did not settle");
}

/** The P2SH payload (blake2b-256 of the bytecode) a vault with this mandate and state sits at. */
export const creditScriptHash = (version: string, doc: unknown, st: CreditStateDoc) => hex(b2b(creditBytecode(version, doc, st)));

export type CodeCheck = { ok: true; scriptHash: string } | { ok: false; why: string };
/** Does `address` hold the credit covenant `version` compiled with this mandate and state? */
export function checkCreditAddress(version: string, doc: unknown, st: CreditStateDoc, address: string): CodeCheck {
  try {
    const d = decodeKaspaAddress(address);
    if (d.version !== 8 || d.payload.length !== 32) return { ok: false, why: "the vault's address is not a script address" };
    const h = creditScriptHash(version, doc, st);
    return h === hex(Uint8Array.from(d.payload)) ? { ok: true, scriptHash: h } : { ok: false, why: `the address does not hold ${version} with this mandate and state` };
  } catch (e) { return { ok: false, why: (e as Error).message }; }
}
