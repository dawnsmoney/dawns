/**
 * Personal vault accounts (vault/nav/dawns_account.sil), derived in the browser.
 *
 * An account's redeem script is the compiled template with its state in the middle:
 *   prefix ‖ 0x20 owner(32) ‖ 0x20 vault covenant id(32) ‖ 0x08 kind(8-byte LE) ‖ suffix
 * Its address is the P2SH of that script (version 8, payload blake2b-256 of the script).
 * The vault covenant rebuilds the same bytes on-chain for the redeem account, so a
 * mismatch here could only produce an address the vault never pays: the tests in
 * vault/harness compile the template and check these bytes.
 */
import { blake2b } from "@noble/hashes/blake2b";
import { decodeKaspaAddress, encodeKaspaAddress } from "@/lib/auth/kaspa";

export interface AccountTemplate { prefix: string; suffix: string } // hex
export type Kind = 0 | 1; // 0 deposit, 1 redeem

const hex = (s: string) => Uint8Array.from((s.replace(/^0x/, "").match(/../g) ?? []).map((h) => parseInt(h, 16)));
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export function accountScript(t: AccountTemplate, owner: Uint8Array, vaultCovid: Uint8Array, kind: Kind): Uint8Array {
  if (owner.length !== 32 || vaultCovid.length !== 32) throw new Error("owner and vault must be 32 bytes");
  const kindLe = new Uint8Array(8); kindLe[0] = kind;
  const parts = [hex(t.prefix), Uint8Array.of(0x20), owner, Uint8Array.of(0x20), vaultCovid, Uint8Array.of(0x08), kindLe, hex(t.suffix)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function accountAddress(t: AccountTemplate, owner: Uint8Array, vaultCovid: Uint8Array, kind: Kind, prefix = "kaspatest"): string {
  return encodeKaspaAddress(prefix, 8, blake2b(accountScript(t, owner, vaultCovid, kind), { dkLen: 32 }));
}

/** The owner key behind a Schnorr (version 0) address: its payload is the x-only public key. */
export function ownerOf(address: string): { owner: Uint8Array; prefix: string } {
  const a = decodeKaspaAddress(address);
  if (a.version !== 0 || a.payload.length !== 32) throw new Error("Use a standard Schnorr address (it starts with kaspatest:q). ECDSA and script addresses cannot own vault shares.");
  return { owner: a.payload, prefix: a.prefix };
}

export const ownerHex = (address: string) => toHex(ownerOf(address).owner);
export { hex as fromHex, toHex };
