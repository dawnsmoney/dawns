import "server-only";
import { currentUser, accountOf } from "./auth/session";
import { hasDb } from "./db";

/** Wallets allowed into /admin (ADMIN_WALLETS, comma separated, any case). */
const ADMINS = (process.env.ADMIN_WALLETS ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);

/** Is the signed-in user one of the admin wallets? */
export async function isAdmin(): Promise<boolean> {
  if (!hasDb() || !ADMINS.length) return false;
  const u = await currentUser().catch(() => null);
  if (!u) return false;
  const acct = await accountOf(u.id);
  return acct.wallets.some((w) => ADMINS.includes(w.address.toLowerCase()));
}
