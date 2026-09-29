import "server-only";
import { sql, ensureSchema } from "./db";
import { getNav } from "./vaults/nav";
import { listCredit } from "./vaults/credit";
import { ownerHex } from "./vaults/account";
import { decodeKaspaAddress } from "./auth/kaspa";

/**
 * The tester path on /test. Every step ticks itself from what dawns already records:
 * the account's wallets, the vault ledgers (a share note owned by one of the
 * account's Kaspa keys), watch rules, plans, Telegram links and reports. Nothing
 * here is self-reported, except the survey.
 */

export type StepKey = "wallet" | "nav_in" | "nav_out" | "credit_in" | "follow" | "telegram" | "report" | "survey";
export const STEPS: { key: StepKey; title: string; how: string; href?: string; cta?: string }[] = [
  { key: "wallet", title: "Sign in with a Kaspa wallet", how: "KasWare or Kastle, set to Testnet 10. Signing proves the address is yours; it sends nothing and costs nothing.", cta: "Sign in" },
  { key: "nav_in", title: "Deposit into the NAV vault", how: "Get test KAS from the faucet, then deposit a few KAS. You receive shares at NAV.", href: "/vaults/nav-tn10#position", cta: "Open the NAV vault" },
  { key: "nav_out", title: "Withdraw from it", how: "Request a withdrawal. You are paid at NAV less the exit fee, in one transaction the network pays or refuses.", href: "/vaults/nav-tn10#position", cta: "Withdraw" },
  { key: "credit_in", title: "Deposit into a credit vault", how: "The vault that lends to named borrowers. Read what is enforced and what is trusted before you deposit.", href: "/vaults/credit-tn10#position", cta: "Open the credit vault" },
  { key: "follow", title: "Watch a protocol or follow a plan", how: "Pick what you want to hear about when something changes.", href: "/allocate", cta: "Build a plan" },
  { key: "telegram", title: "Link Telegram alerts", how: "Alerts for what you watch, in Telegram.", href: "/portfolio", cta: "Link Telegram" },
  { key: "report", title: "Report something", how: "Anything broken, slow or confusing. The button is at the bottom right of every page.", cta: "Report a problem" },
  { key: "survey", title: "Answer three questions", how: "At the bottom of this page. The answers decide what gets fixed first." },
];

/** The owner key (hex) of each Kaspa wallet: testnet and mainnet addresses of one key are one owner. */
function keysOf(addresses: string[]) {
  const out = new Set<string>();
  for (const a of addresses) {
    try { const d = decodeKaspaAddress(a); if (d.version === 0 && d.payload.length === 32) out.add(ownerHex(a)); } catch { /* not a Schnorr address */ }
  }
  return out;
}

/** What the vault ledgers say each owner key did: deposited into NAV, withdrew from NAV, deposited into a credit vault. */
export async function vaultActivity() {
  const [nav, credit] = await Promise.all([getNav().catch(() => ({ l: null })), listCredit().catch(() => [])]);
  const navIn = new Set<string>(), navOut = new Set<string>(), creditIn = new Set<string>();
  const key = (a: string) => { try { return ownerHex(a); } catch { return null; } };
  for (const n of nav.l?.notes ?? []) { const k = key(n.owner); if (!k) continue; navIn.add(k); if (n.redeemed) navOut.add(k); }
  for (const c of credit) for (const n of c.l.notes) { const k = key(n.owner); if (k) creditIn.add(k); }
  return { navIn, navOut, creditIn };
}

export type Progress = Record<StepKey, boolean>;

/** One account's progress through the tester path. */
export async function progressOf(userId: string, act?: Awaited<ReturnType<typeof vaultActivity>>): Promise<Progress> {
  await ensureSchema();
  const q = sql();
  const [w, f] = await Promise.all([
    q.query("select address from wallets where user_id = $1 and kind = 'kaspa'", [userId]) as unknown as Promise<{ address: string }[]>,
    q.query(`select exists (select 1 from watch_rules where user_id = $1) or exists (select 1 from profiles where user_id = $1 and plan is not null) as follow,
      exists (select 1 from telegram_chats where user_id = $1) as tg,
      exists (select 1 from feedback where user_id = $1 and kind <> 'survey') as report,
      exists (select 1 from feedback where user_id = $1 and kind = 'survey') as survey`, [userId]) as unknown as Promise<{ follow: boolean; tg: boolean; report: boolean; survey: boolean }[]>,
  ]);
  const keys = keysOf(w.map((x) => x.address));
  const a = act ?? await vaultActivity();
  const any = (s: Set<string>) => [...keys].some((k) => s.has(k));
  const x = f[0];
  return { wallet: keys.size > 0, nav_in: any(a.navIn), nav_out: any(a.navOut), credit_in: any(a.creditIn), follow: !!x?.follow, telegram: !!x?.tg, report: !!x?.report, survey: !!x?.survey };
}

/** The tester funnel for /admin: visitors of /test, then accounts at each step. */
export async function funnel() {
  await ensureSchema();
  const q = sql();
  const [vis, users] = await Promise.all([
    q.query("select count(distinct vid)::int as n from app_events where name = 'test_open'") as unknown as Promise<{ n: number }[]>,
    q.query("select distinct user_id from wallets where kind = 'kaspa' limit 2000") as unknown as Promise<{ user_id: string }[]>,
  ]);
  const act = await vaultActivity();
  const counts = Object.fromEntries(STEPS.map((s) => [s.key, 0])) as Record<StepKey, number>;
  for (const u of users) {
    const p = await progressOf(u.user_id, act);
    for (const s of STEPS) if (p[s.key]) counts[s.key]++;
  }
  return { visitors: vis[0]?.n ?? 0, counts };
}
