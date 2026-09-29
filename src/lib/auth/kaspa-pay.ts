import "server-only";
import { sql, ensureSchema } from "../db";
import { normalize, startSession } from "./session";

/**
 * Sign in with a Kaspa wallet that cannot sign messages (Kaspium, most phone wallets):
 * the wallet sends a one-time exact amount from its address back to itself. Only the
 * holder of the address's keys can spend from it, and the amount ties the transaction
 * to this request. The KAS stays in the wallet; the only cost is the network fee.
 * Checked against the public Kaspa REST API.
 */
const API = "https://api.kaspa.org";
const TTL_MIN = 20;
const rand = (n = 12) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

type KasTx = {
  transaction_id: string; block_time: number; is_accepted?: boolean;
  inputs: { previous_outpoint_address?: string }[] | null;
  outputs: { amount: number | string; script_public_key_address: string }[] | null;
};

export async function issuePayChallenge(address: string) {
  const addr = normalize("kaspa", address);
  if (!addr) throw new Error("That is not a Kaspa address (kaspa:q…).");
  await ensureSchema();
  const nonce = rand();
  // 1 KAS plus 10,000–99,999 sompi: above the dust limit, unique enough for 20 minutes, and it stays in the wallet
  const extra = 10_000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90_000);
  const sompi = 100_000_000 + extra;
  const issued = Date.now();
  await sql().query("delete from auth_nonces where expires_at < now()");
  await sql().query("insert into auth_nonces (nonce, address, message, expires_at) values ($1, $2, $3, now() + ($4 || ' minutes')::interval)", [nonce, addr, `kaspa-pay:${sompi}:${issued}`, String(TTL_MIN)]);
  const kas = (sompi / 1e8).toFixed(8);
  return { nonce, address: addr, sompi, kas, uri: `${addr}?amount=${kas}`, expiresAt: issued + TTL_MIN * 60_000 };
}

/** Pending until the self-send is accepted on Kaspa L1; then signs in and returns the user id. */
export async function checkPayChallenge(nonce: string): Promise<{ status: "pending" | "expired" } | { status: "ok"; userId: string }> {
  if (!/^[0-9a-f]{24}$/.test(nonce)) return { status: "expired" };
  await ensureSchema();
  const q = sql();
  const row = ((await q.query("select address, message from auth_nonces where nonce = $1 and used = false and expires_at > now()", [nonce])) as { address: string; message: string }[])[0];
  const m = row?.message.match(/^kaspa-pay:(\d+):(\d+)$/);
  if (!row || !m) return { status: "expired" };
  const sompi = m[1], issued = Number(m[2]);
  const r = await fetch(`${API}/addresses/${row.address}/full-transactions?limit=20&resolve_previous_outpoints=light`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!r.ok) return { status: "pending" };
  const txs = (await r.json()) as KasTx[];
  const hit = txs.find((t) => t.is_accepted !== false && t.block_time >= issued - 60_000
    && (t.inputs ?? []).some((i) => i.previous_outpoint_address === row.address)
    && (t.outputs ?? []).some((o) => o.script_public_key_address === row.address && String(o.amount) === sompi));
  if (!hit) return { status: "pending" };
  const used = (await q.query("update auth_nonces set used = true where nonce = $1 and used = false returning nonce", [nonce])) as unknown[];
  if (!used.length) return { status: "expired" };
  return { status: "ok", userId: await startSession("kaspa", row.address) };
}
