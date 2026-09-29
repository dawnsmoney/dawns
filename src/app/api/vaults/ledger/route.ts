import { schnorr } from "@noble/curves/secp256k1";
import { blake2b } from "@noble/hashes/blake2b";
import { sql, hasDb, ensureSchema } from "@/lib/db";
import { navLedger, navMandate } from "@/lib/vaults/nav";
import { creditLedger, creditMandate, launchedOk, type CreditMandateDoc } from "@/lib/vaults/credit";
import { codeCheck } from "@/lib/vaults/credit-verify";
import { decodeKaspaAddress } from "@/lib/auth/kaspa";

export const dynamic = "force-dynamic";

/**
 * The keeper publishes the NAV vault's ledger after each move, so the site does
 * not wait for a git push. The body is the ledger JSON exactly as signed;
 * x-dawns-sig is a BIP-340 signature by the vault's allocator key over
 * blake2b-256(body). Accepted only for a known vault and mandate, or a credit
 * vault launched from a strategy that carries its mandate and whose address is
 * that mandate's covenant (rebuilt and hashed here), never with fewer moves than
 * what is stored.
 */
export async function POST(req: Request) {
  // ?kind=credit: a credit vault's ledger, signed by its own allocator key: the
  // reference vault's (mandate in git), or one launched from a strategy, whose
  // ledger carries its mandate (hash-checked, and its covenant rebuilt from it)
  const credit = new URL(req.url).searchParams.get("kind") === "credit";
  const body = await req.text();
  if (body.length > 2_000_000) return Response.json({ error: "Too large" }, { status: 413 });
  const sigHex = req.headers.get("x-dawns-sig") ?? "";
  if (!/^[0-9a-f]{128}$/i.test(sigHex)) return Response.json({ error: "Missing signature" }, { status: 401 });
  let doc: { covenantId?: string; mandateHash?: string; moves?: unknown[]; mandate?: { roles?: { allocator?: string } } };
  try { doc = JSON.parse(body); } catch { return Response.json({ error: "Not JSON" }, { status: 400 }); }

  let allocator: string | null = null, floor = 0, launched = false;
  if (!credit) {
    if (!navLedger || !navMandate) return Response.json({ error: "No NAV vault" }, { status: 404 });
    if (doc.covenantId !== navLedger.covenantId || doc.mandateHash !== navLedger.mandateHash) return Response.json({ error: "Another vault" }, { status: 400 });
    allocator = navMandate.roles.allocator; floor = navLedger.moves.length;
  } else if (creditLedger && doc.covenantId === creditLedger.covenantId) {
    if (!creditMandate || doc.mandateHash !== creditLedger.mandateHash) return Response.json({ error: "Another vault" }, { status: 400 });
    allocator = creditMandate.roles.allocator; floor = creditLedger.moves.length;
  } else {
    if (!launchedOk(doc as never)) return Response.json({ error: "A launched vault's ledger must carry its testnet mandate, hashing to its mandateHash" }, { status: 400 });
    allocator = doc.mandate?.roles?.allocator ?? null; launched = true;
    // Anyone may list a vault: the site rebuilds the covenant from the mandate and
    // state and hashes it, and the address must be that hash. A ledger cannot point
    // depositors at any other script. (Whether the coin is live there is checked
    // on every page view, from a testnet node.)
    const code = codeCheck(doc as never, (doc as { mandate: CreditMandateDoc }).mandate);
    if (!code.ok) return Response.json({ error: `The vault's address is not this mandate's covenant: ${code.why}` }, { status: 400 });
  }
  if (!Array.isArray(doc.moves) || !allocator) return Response.json({ error: "Not a ledger" }, { status: 400 });
  let key: Uint8Array;
  try { key = decodeKaspaAddress(allocator).payload; } catch { return Response.json({ error: "Bad allocator address" }, { status: 400 }); }
  const digest = blake2b(new TextEncoder().encode(body), { dkLen: 32 });
  let ok = false;
  try { ok = schnorr.verify(Uint8Array.from(sigHex.match(/../g)!.map((h) => parseInt(h, 16))), digest, key); } catch { ok = false; }
  if (!ok) return Response.json({ error: "Bad signature" }, { status: 401 });
  if (!hasDb()) return Response.json({ ok: true, stored: false });
  await ensureSchema();
  const cur = (await sql().query("select jsonb_array_length(doc->'moves') as n from vault_ledgers where vault = $1", [doc.covenantId])) as { n: number }[];
  if (launched && !cur.length) {
    const n = (await sql().query("select count(*)::int as n from vault_ledgers where doc->>'standard' = 'dawns-credit/0'", [])) as { n: number }[];
    if ((n[0]?.n ?? 0) >= 200) return Response.json({ error: "Too many testnet vaults" }, { status: 429 });
  }
  const have = Math.max(cur[0]?.n ?? 0, floor);
  if (doc.moves.length < have) return Response.json({ error: "Older than what is published" }, { status: 409 });
  await sql().query("insert into vault_ledgers (vault, doc, updated_at) values ($1, $2::jsonb, now()) on conflict (vault) do update set doc = excluded.doc, updated_at = now()", [doc.covenantId, body]);
  return Response.json({ ok: true, moves: doc.moves.length, ...(launched ? { launched: true } : {}) });
}
