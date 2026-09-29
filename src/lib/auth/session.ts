import "server-only";
import { cookies } from "next/headers";
import { verifyMessage, isAddress, getAddress } from "viem";
import { sha256 } from "@noble/hashes/sha256";
import { sql, ensureSchema } from "../db";
import { SITE } from "../telegram";
import { decodeKaspaAddress, verifyKaspaMessage } from "./kaspa";

/**
 * Wallet sign-in. dawns issues a one-time message, the wallet signs it, dawns checks the
 * signature against the address. Nothing is sent on-chain and nothing costs gas.
 */
export type WalletKind = "kaspa" | "evm";
const COOKIE = "dawns_session";
const SESSION_DAYS = 30;

const rand = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const hashToken = (t: string) => [...sha256(new TextEncoder().encode(t))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Canonical form of an address, or null if it is not a valid address of that kind. */
export function normalize(kind: WalletKind, address: string): string | null {
  const a = address.trim();
  if (kind === "evm") return isAddress(a) ? getAddress(a) : null;
  try { const d = decodeKaspaAddress(a.toLowerCase()); return d.prefix === "kaspa" && (d.version === 0 || d.version === 1) ? a.toLowerCase() : null; } catch { return null; }
}

export async function issueNonce(kind: WalletKind, address: string) {
  const addr = normalize(kind, address);
  if (!addr) throw new Error("That is not a valid address.");
  await ensureSchema();
  const nonce = rand(12);
  const host = new URL(SITE).host;
  const message = [
    `${host} wants you to sign in with your ${kind === "kaspa" ? "Kaspa" : "EVM"} account:`,
    addr,
    "",
    "Sign in to save your dawns profile. This does not send a transaction or cost any fee.",
    "",
    `Nonce: ${nonce}`,
    `Issued at: ${new Date().toISOString()}`,
  ].join("\n");
  await sql().query("delete from auth_nonces where expires_at < now()");
  await sql().query("insert into auth_nonces (nonce, address, message, expires_at) values ($1, $2, $3, now() + interval '10 minutes')", [nonce, addr, message]);
  return { message, address: addr };
}

async function checkSignature(kind: WalletKind, address: string, message: string, signature: string) {
  if (kind === "evm") return verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` }).catch(() => false);
  return verifyKaspaMessage(address, message, signature);
}

/** Verify a signed nonce message. Signs in (or links the wallet to the current user) and sets the session cookie. */
export async function verifyAndSignIn(kind: WalletKind, address: string, message: string, signature: string) {
  const addr = normalize(kind, address);
  if (!addr) throw new Error("That is not a valid address.");
  const nonce = message.match(/^Nonce: ([0-9a-f]+)$/m)?.[1];
  if (!nonce) throw new Error("The message is not a dawns sign-in message.");
  await ensureSchema();
  const q = sql();
  const rows = (await q.query("update auth_nonces set used = true where nonce = $1 and used = false and expires_at > now() returning address, message", [nonce])) as { address: string; message: string }[];
  const n = rows[0];
  if (!n || n.address !== addr || n.message !== message) throw new Error("This sign-in request expired. Please try again.");
  if (!(await checkSignature(kind, addr, message, signature))) throw new Error("The signature does not match this address.");
  return startSession(kind, addr);
}

/** Sign in as a wallet whose control was just proven (or link it to the current user) and set the session cookie. */
export async function startSession(kind: WalletKind, addr: string) {
  const q = sql();
  const current = await currentUser();
  const existing = ((await q.query("select user_id from wallets where address = $1", [addr])) as { user_id: string }[])[0];
  let userId = existing?.user_id ?? current?.id ?? null;
  if (!userId) { userId = `u_${rand(10)}`; await q.query("insert into users (id) values ($1)", [userId]); }
  if (!existing) await q.query("insert into wallets (address, kind, user_id, last_seen) values ($1, $2, $3, now())", [addr, kind, userId]);
  else await q.query("update wallets set last_seen = now() where address = $1", [addr]);

  if (!current || current.id !== userId) {
    const token = rand(32);
    await q.query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)", [hashToken(token), userId, String(SESSION_DAYS)]);
    (await cookies()).set(COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
  }
  return userId;
}

export async function currentUser(): Promise<{ id: string } | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  await ensureSchema();
  const r = (await sql().query("select user_id from sessions where token_hash = $1 and expires_at > now()", [hashToken(token)])) as { user_id: string }[];
  return r[0] ? { id: r[0].user_id } : null;
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await sql().query("delete from sessions where token_hash = $1", [hashToken(token)]);
  jar.delete(COOKIE);
}

export async function accountOf(userId: string) {
  const q = sql();
  const [w, pr, tg] = await Promise.all([
    q.query("select address, kind from wallets where user_id = $1 order by created_at", [userId]),
    q.query("select policy, plan, updated_at from profiles where user_id = $1", [userId]),
    q.query("select count(*)::int as n from telegram_chats where user_id = $1", [userId]),
  ]).then(([a, b, c]) => [a, b, c] as const);
  const wallets = w as { address: string; kind: WalletKind }[];
  const prof = pr as { policy: unknown; plan: unknown; updated_at: string }[];
  const telegram = ((tg as { n: number }[])[0]?.n ?? 0) > 0;
  return { id: userId, wallets, policy: prof[0]?.policy ?? null, plan: prof[0]?.plan ?? null, telegram, updatedAt: prof[0]?.updated_at ?? null };
}

/** Same-origin check for state-changing requests (cookies are SameSite=Lax; this closes the rest). */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { return new URL(origin).host === host; } catch { return false; }
}
