/**
 * Kaspa addresses and personal-message signatures, verified without the Kaspa WASM SDK.
 *
 * Address: "kaspa:" + base32(version byte ‖ payload) + 8-char checksum (CashAddr polymod).
 *   version 0 = Schnorr pubkey (32-byte x-only), 1 = ECDSA pubkey (33-byte compressed), 8 = script hash.
 * Message: blake2b-256 keyed with "PersonalMessageSigningHash" over the UTF-8 text,
 *   signed with BIP-340 Schnorr (rusty-kaspa wallet/core/src/message.rs); ECDSA for ECDSA addresses.
 */
import { schnorr, secp256k1 } from "@noble/curves/secp256k1";
import { blake2b } from "@noble/hashes/blake2b";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [BigInt("0x98f2bc8e61"), BigInt("0x79b76d99e2"), BigInt("0xf33e5fb3c4"), BigInt("0xae2eabe2a8"), BigInt("0x1e4f43e470")];

function polymod(values: number[]) {
  let c = BigInt(1);
  const mask = BigInt("0x07ffffffff");
  for (const d of values) {
    const c0 = Number(c >> BigInt(35));
    c = ((c & mask) << BigInt(5)) ^ BigInt(d);
    for (let i = 0; i < 5; i++) if ((c0 >> i) & 1) c ^= GEN[i];
  }
  return c ^ BigInt(1);
}

function convertBits(data: number[], from: number, to: number, pad: boolean) {
  let acc = 0, bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & maxv);
  else if (!pad && (bits >= from || ((acc << (to - bits)) & maxv))) {
    if (bits >= from) throw new Error("bad padding");
  }
  return out;
}

export type KaspaAddress = { prefix: string; version: number; payload: Uint8Array };

/** Decode and checksum-verify a Kaspa address. Throws on anything malformed. */
export function decodeKaspaAddress(addr: string): KaspaAddress {
  const a = addr.trim();
  if (a !== a.toLowerCase()) throw new Error("mixed case");
  const i = a.indexOf(":");
  if (i < 1) throw new Error("no prefix");
  const prefix = a.slice(0, i), body = a.slice(i + 1);
  if (!["kaspa", "kaspatest", "kaspadev", "kaspasim"].includes(prefix)) throw new Error("unknown prefix");
  const data = [...body].map((ch) => { const v = CHARSET.indexOf(ch); if (v < 0) throw new Error("bad character"); return v; });
  if (data.length < 9) throw new Error("too short");
  const pre = [...prefix].map((ch) => ch.charCodeAt(0) & 31);
  if (polymod([...pre, 0, ...data]) !== BigInt(0)) throw new Error("bad checksum");
  const bytes = convertBits(data.slice(0, -8), 5, 8, false);
  return { prefix, version: bytes[0], payload: Uint8Array.from(bytes.slice(1)) };
}

/** Encode (used for tests and for printing an address from a key). */
export function encodeKaspaAddress(prefix: string, version: number, payload: Uint8Array) {
  const data = convertBits([version, ...payload], 8, 5, true);
  const pre = [...prefix].map((ch) => ch.charCodeAt(0) & 31);
  const c = polymod([...pre, 0, ...data, 0, 0, 0, 0, 0, 0, 0, 0]);
  const chk = Array.from({ length: 8 }, (_, k) => Number((c >> BigInt(5 * (7 - k))) & BigInt(31)));
  return `${prefix}:${[...data, ...chk].map((v) => CHARSET[v]).join("")}`;
}

export function personalMessageHash(message: string) {
  return blake2b(new TextEncoder().encode(message), { dkLen: 32, key: new TextEncoder().encode("PersonalMessageSigningHash") });
}

function sigBytes(sig: string): Uint8Array | null {
  const s = sig.trim().replace(/^0x/, "");
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) return Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch { return null; }
}

/** True when `signature` over `message` was made by the key behind `address`. */
export function verifyKaspaMessage(address: string, message: string, signature: string): boolean {
  let a: KaspaAddress;
  try { a = decodeKaspaAddress(address); } catch { return false; }
  const sig = sigBytes(signature);
  if (!sig) return false;
  const hash = personalMessageHash(message);
  try {
    if (a.version === 0 && a.payload.length === 32 && sig.length === 64) return schnorr.verify(sig, hash, a.payload);
    if (a.version === 1 && a.payload.length === 33) {
      const compact = sig.length === 65 ? sig.slice(1) : sig; // tolerate a recovery byte in front
      return compact.length === 64 && secp256k1.verify(compact, hash, a.payload, { prehash: false });
    }
  } catch { return false; }
  return false;
}
