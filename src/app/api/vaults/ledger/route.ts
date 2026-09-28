import { schnorr } from "@noble/curves/secp256k1";
import { blake2b } from "@noble/hashes/blake2b";
import { sql, hasDb, ensureSchema } from "@/lib/db";
import { navLedger, navMandate } from "@/lib/vaults/nav";
import { decodeKaspaAddress } from "@/lib/auth/kaspa";

export const dynamic = "force-dynamic";

/**
 * The keeper publishes the NAV vault's ledger after each move, so the site does
 * not wait for a git push. The body is the ledger JSON exactly as signed;
 * x-dawns-sig is a BIP-340 signature by the vault's allocator key over
 * blake2b-256(body). Accepted only for this vault and mandate, and never with
 * fewer moves than what is stored.
 */
export async function POST(req: Request) {
  if (!navLedger || !navMandate) return Response.json({ error: "No NAV vault" }, { status: 404 });
  const body = await req.text();
  if (body.length > 2_000_000) return Response.json({ error: "Too large" }, { status: 413 });
  const sigHex = req.headers.get("x-dawns-sig") ?? "";
  if (!/^[0-9a-f]{128}$/i.test(sigHex)) return Response.json({ error: "Missing signature" }, { status: 401 });
  const key = decodeKaspaAddress(navMandate.roles.allocator).payload;
  const digest = blake2b(new TextEncoder().encode(body), { dkLen: 32 });
  let ok = false;
  try { ok = schnorr.verify(Uint8Array.from(sigHex.match(/../g)!.map((h) => parseInt(h, 16))), digest, key); } catch { ok = false; }
  if (!ok) return Response.json({ error: "Bad signature" }, { status: 401 });
  let doc: { covenantId?: string; mandateHash?: string; moves?: unknown[] };
  try { doc = JSON.parse(body); } catch { return Response.json({ error: "Not JSON" }, { status: 400 }); }
  if (doc.covenantId !== navLedger.covenantId || doc.mandateHash !== navLedger.mandateHash || !Array.isArray(doc.moves)) return Response.json({ error: "Another vault" }, { status: 400 });
  if (!hasDb()) return Response.json({ ok: true, stored: false });
  await ensureSchema();
  const cur = (await sql().query("select jsonb_array_length(doc->'moves') as n from vault_ledgers where vault = $1", [doc.covenantId])) as { n: number }[];
  const have = Math.max(cur[0]?.n ?? 0, navLedger.moves.length);
  if (doc.moves.length < have) return Response.json({ error: "Older than what is published" }, { status: 409 });
  await sql().query("insert into vault_ledgers (vault, doc, updated_at) values ($1, $2::jsonb, now()) on conflict (vault) do update set doc = excluded.doc, updated_at = now()", [doc.covenantId, body]);
  return Response.json({ ok: true, moves: doc.moves.length });
}
