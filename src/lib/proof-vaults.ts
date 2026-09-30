import "server-only";
import { unstable_cache } from "next/cache";
import { NAV_VAULTS, getNav, navFigures, readNavLive, navVault, SOMPI, type NavSlug } from "./vaults/nav";
import { getCredit, creditFigures, readCreditLive } from "./vaults/credit";
import { accountAddress, fromHex, ownerOf } from "./vaults/account";
import { sql, hasDb } from "./db";
import { proofs, proofOf, type Proof } from "./proof";
import type { Signal, Snapshot, Status } from "./types";

/**
 * dawns' own vaults, read and rated by the same rules as every protocol: what the
 * chain shows is there against what holders are owed, how holders get out, where each
 * figure is read, who holds the keys. The vault's own ledger is never taken on trust:
 * its coin, the strategy wallets and the credit notes are read from a testnet node.
 */

const API = "https://api-tn10.kaspa.org";
const TN = (a: string) => `https://tn10.kaspa.stream/addresses/${a}`;
const kas = (x: number, d = 2) => `${x.toLocaleString("en-US", { maximumFractionDigits: d })} KAS`;

async function balance(addr: string): Promise<number | null> {
  try {
    const r = await fetch(`${API}/addresses/${addr}/balance`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8_000) });
    return r.ok ? ((await r.json()) as { balance: number }).balance / SOMPI : null;
  } catch { return null; }
}

/** Withdrawals asked for and not yet paid: registered accounts with KAS at their redeem address, each for its oldest live note. */
async function waiting(vault: string, template: { prefix: string; suffix: string }, notes: { owner: string; shares: number; redeemed?: unknown }[], price: number) {
  if (!hasDb()) return { count: 0, kas: 0 };
  let rows: { address: string }[] = [];
  try { rows = (await sql().query("select address from vault_accounts where vault = $1 limit 200", [vault])) as { address: string }[]; } catch { return { count: 0, kas: 0 }; }
  let count = 0, due = 0;
  await Promise.all(rows.map(async ({ address }) => {
    let red: string;
    try { red = accountAddress(template as never, ownerOf(address).owner, fromHex(vault), 1); } catch { return; }
    const b = await balance(red);
    if (!b) return;
    const n = notes.find((x) => !x.redeemed && x.owner === address);
    if (!n) return;
    count++; due += n.shares * price;
  }));
  return { count, kas: due };
}

async function navProof(slug: NavSlug): Promise<{ p: Proof; sig: Signal[] } | null> {
  const { l, m } = await getNav(slug);
  if (!l || !m) return null;
  const [live, all, credit] = await Promise.all([readNavLive(l), Promise.all(NAV_VAULTS.map((v) => getNav(v.slug))), getCredit()]);
  const f = navFigures(l, m);
  const held = live.coin ? live.coin.amount / SOMPI : f.held;
  const liquid = held - f.keep;
  const st = navVault(slug).strategy;
  const creditSlot = st?.credit?.slot ?? -1;
  // what a credit note of this wallet is worth at the credit vault's price now
  const cf = credit.l && credit.m ? creditFigures(credit.l, credit.m, null) : null;
  const rows = await Promise.all(m.destinations.map(async (d, i) => {
    const b = await balance(d.address);
    const bal = b ?? 0;
    const notes = i === creditSlot && credit.l && cf ? credit.l.notes.filter((n) => !n.redeemed && n.owner === d.address) : [];
    const inCredit = notes.reduce((a, n) => a + (n.shares * cf!.price) + n.value / SOMPI, 0);
    // the same wallet may hold other vaults' capital: this vault's part is its cost share
    const mine = l.state.deployed[i] ?? 0;
    const total = all.reduce((a, v) => a + (v.l?.moves && v.m?.destinations[i]?.address === d.address ? v.l.state.deployed[i] ?? 0 : 0), 0);
    const share = total > 0 ? mine / total : 0;
    const onchain = (bal + inCredit) * share;
    const mark = (l.state.marks[i] ?? 0) / SOMPI;
    // a wallet the node did not answer for is not a shortfall: it counts at its mark, and says so
    return { d, i, bal, inCredit, share, onchain, mark, unread: b == null, verified: b == null ? mark : Math.min(mark, onchain) };
  }));
  const reserves = Math.max(0, liquid) + rows.reduce((a, r) => a + r.verified, 0);
  const unread = !live.coin || rows.some((r) => r.unread);
  const owed = f.nav;
  const coverage = owed > 0 ? reserves / owed : 1;
  const w = await waiting(l.covenantId, l.accountTemplate, l.notes, f.price);
  const fixed = m.maturityDaa > 0;
  const matured = !fixed || (live.daa != null && live.daa - 100 >= m.maturityDaa);
  const status: Status = l.state.halted ? "crit" : coverage < 0.95 ? "crit" : coverage < 0.995 || (w.kas > liquid && matured) ? "warn" : "good";
  const statusText = l.state.halted ? "Halted" : coverage < 0.995 ? "Marks ahead of the chain" : w.kas > liquid && matured ? "Withdrawal waiting" : "Fully backed";
  const name = m.name;
  const sig: Signal[] = [];
  if (!unread && coverage < 0.995 && owed > 0) sig.push({ key: `${slug}:coverage`, t: coverage < 0.95 ? "crit" : "warn", p: slug, rule: "backing", strong: `${name}: marks run ${kas(owed - reserves)} ahead of what the chain shows`, rest: `. NAV is ${kas(owed)}; its cash and the strategy wallets hold ${kas(reserves)} for it.` });
  if (w.count > 0 && w.kas > liquid && matured) sig.push({ key: `${slug}:waiting`, t: "warn", p: slug, rule: "liq", strong: `${name}: ${kas(w.kas)} of withdrawals wait for cash`, rest: `. The vault holds ${kas(Math.max(0, liquid))} it can pay now; the rest comes back from the strategy wallets.` });
  if (l.state.halted) sig.push({ key: `${slug}:halted`, t: "crit", p: slug, rule: "contract", strong: `${name} is halted`, rest: ". The guardian stopped allocations and deposits; recalls and withdrawals go on." });

  const p: Proof = {
    id: slug, name, kind: "vault", href: `/vaults/${slug}`, site: null,
    unit: "KAS", kasUsd: null,
    reserves, owed, coverage,
    reservesLabel: "Held for holders, on-chain", reservesSub: "the vault coin's cash, plus what each strategy wallet actually holds for it",
    owedLabel: "Owed to holders", owedSub: "NAV: shares × the vault's own price, marks included",
    coverageSub: coverage >= 0.995 ? "the marks are backed by what the chain shows" : "the manager's marks run ahead of the chain",
    status, statusText,
    read: live.daa != null ? { chain: "tn10", block: live.daa, t: Date.now() } : null,
    usdValue: 0,
    breakdown: {
      title: "Where holders' money is", sub: "Read from a testnet node, not from the vault's ledger",
      rows: [
        { label: "Cash in the vault coin", sub: `the covenant's own coin, less its ${kas(f.keep, 0)} seed`, value: Math.max(0, liquid), share: owed ? Math.max(0, liquid) / owed : 0, chain: "Kaspa TN10", href: TN(l.address) },
        ...rows.map((r) => ({
          label: r.d.label.replace(" (test wallet)", ""),
          sub: r.unread ? `marked ${kas(r.mark)} · the node did not answer: counted at its mark` : `marked ${kas(r.mark)} · on-chain ${kas(r.onchain)}${r.inCredit ? ` (${kas(r.inCredit * r.share)} as credit-vault shares)` : ""}${r.share > 0 && r.share < 1 ? ` · ${Math.round(r.share * 100)}% of a shared wallet` : ""}`,
          value: r.verified, share: owed ? r.verified / owed : 0, chain: "Kaspa TN10", href: TN(r.d.address),
        })),
      ],
    },
    exits: {
      title: "Can holders get their KAS back?",
      lead: fixed ? "A fixed-term vault pays nothing before maturity: the network refuses an early withdrawal. From maturity, one transaction pays at NAV or is refused, from the cash in the vault coin." : "A withdrawal is one transaction the network pays at NAV or refuses, from the cash in the vault coin. There is no queue; what the manager has sent out comes back through recalls.",
      rows: [
        { label: "Payable now", value: kas(Math.max(0, liquid)), sub: `${owed ? Math.round((Math.max(0, liquid) / owed) * 100) : 0}% of NAV`, tone: owed && liquid / owed < 0.2 ? "warn" : "good" },
        { label: "Withdrawals waiting", value: w.count ? kas(w.kas) : "none", sub: w.count ? `${w.count} request${w.count > 1 ? "s" : ""}` : "every request so far was paid", tone: w.count && w.kas > liquid ? "warn" : undefined },
        ...(fixed ? [{ label: "Withdrawals open", value: matured ? "now" : "at maturity", sub: `DAA ${m.maturityDaa.toLocaleString("en-US")}` }] : []),
        { label: "Exit fee", value: `${m.exitFeeBps / 100}%`, sub: "stays with the holders who remain" },
      ],
      bars: [], waits: [],
    },
    loans: null,
    sources: [
      { name: "Vault coin", what: "its balance and covenant id, from a testnet node; the address is the covenant rebuilt from the mandate", type: "Covenant", side: "Reserves", chain: "Kaspa TN10", href: TN(l.address) },
      ...m.destinations.map((d, i) => ({ name: d.label.replace(" (test wallet)", ""), what: i === creditSlot ? "L1 balance, plus its notes in the credit vault at that vault's price" : "L1 balance of the strategy wallet", type: "L1 address", side: "Reserves" as const, chain: "Kaspa TN10", href: TN(d.address) })),
      { name: "Share notes", what: "every live note and its owner, from the ledger the keeper publishes, checked against the chain", type: "KCC-20", side: "Owed", chain: "Kaspa TN10", href: null },
      { name: "Redeem accounts", what: "KAS waiting at each holder's withdrawal address", type: "L1 addresses", side: "Exits", chain: "Kaspa TN10", href: null },
    ],
    control: [
      { n: "Vault covenant", addr: l.address, chain: "igra", up: "Not upgradeable: the rules are the address", admin: "No owner", pause: "Guardian can halt; withdrawals go on", t: "good" },
      { n: "Allocator", addr: m.roles.allocator, chain: "igra", up: "Moves capital, within caps and limits", admin: "One key, held by Dawns (testnet)", pause: "—", t: "warn" },
      { n: "Valuer", addr: m.roles.valuer, chain: "igra", up: "Marks positions, one step per period", admin: "One key, held by Dawns (testnet)", pause: "—", t: "warn" },
      { n: "Guardian", addr: m.roles.guardian, chain: "igra", up: "Can halt for good", admin: "One key, held by Dawns (testnet)", pause: "—", t: "warn" },
    ],
    owner: [],
    checks: [
      ["Cash in the vault", "the vault coin's balance, read from a testnet node", "Chain"],
      ["Strategy wallets", "each destination's balance, and its credit-vault notes at that vault's price", "Chain"],
      ["The covenant itself", "the vault page rebuilds the covenant from the mandate and checks the address", "Chain"],
    ],
    pending: [
      ["What a strategy wallet does", "the wallets are keys held by Dawns: the covenant can send only to them, but what they do next is trust"],
      ["Keys by role", "allocator, valuer and guardian are three keys, all held by Dawns on testnet"],
    ],
    series: { t: [l.createdAt * 1000, ...l.moves.map((x) => x.at * 1000)], v: [0, ...l.moves.map((x) => x.navAfter / SOMPI)] },
  };
  return { p, sig };
}

async function creditProof(): Promise<{ p: Proof; sig: Signal[] } | null> {
  const { l, m } = await getCredit();
  if (!l || !m) return null;
  const live = await readCreditLive(l);
  const f = creditFigures(l, m, live.daa);
  const held = live.coin ? live.coin.amount / SOMPI : f.held;
  const liquid = held - f.keep;
  const reserves = Math.max(0, liquid) + f.lent;
  const owed = f.nav;
  const w = await waiting(l.covenantId, l.accountTemplate, l.notes, f.price);
  const late = f.loans.filter((x) => x.status === "late" || x.status === "grace" || x.status === "zero");
  const status: Status = l.state.halted ? "crit" : late.some((x) => x.status === "late" || x.status === "zero") ? "crit" : late.length || w.kas > liquid ? "warn" : "good";
  const statusText = l.state.halted ? "Halted" : late.length ? "Loan overdue" : w.kas > liquid ? "Withdrawal waiting" : "Loans current";
  const name = m.name;
  const hrs = (s: number | null) => (s == null ? "" : s < 5400 ? `${Math.max(1, Math.round(s / 60))} min` : s < 172_800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86_400)} days`);
  const sig: Signal[] = [];
  for (const x of late) sig.push({ key: `credit-tn10:late:${x.slot}`, t: x.status === "grace" ? "warn" : "crit", p: "credit-tn10", rule: "contract", strong: `${name}: ${x.label}'s loan is ${hrs(x.lateSeconds)} past due`, rest: `. ${kas(x.principal)} lent; it now counts for ${kas(x.counts)}${x.status === "grace" ? " (still in its grace period)" : ", marked down on the mandate's schedule"}.` });
  if (w.count > 0 && w.kas > liquid) sig.push({ key: "credit-tn10:waiting", t: "warn", p: "credit-tn10", rule: "liq", strong: `${name}: ${kas(w.kas)} of withdrawals wait for loans to come back`, rest: `. The vault holds ${kas(Math.max(0, liquid))} in cash; ${kas(f.lent)} is out on loan.` });
  if (l.state.halted) sig.push({ key: "credit-tn10:halted", t: "crit", p: "credit-tn10", rule: "contract", strong: `${name} is halted`, rest: ". No new loans or deposits; repayments and withdrawals go on." });

  const p: Proof = {
    id: "credit-tn10", name, kind: "vault", href: "/vaults/credit-tn10", site: null,
    unit: "KAS", kasUsd: null,
    reserves, owed, coverage: owed > 0 ? reserves / owed : 1,
    reservesLabel: "Cash + loans", reservesSub: "the vault coin's cash, plus each open loan at what it counts for today",
    owedLabel: "Owed to holders", owedSub: "NAV: shares × the vault's price",
    coverageSub: "loans count at their mark, capped by the mandate's late schedule",
    status, statusText,
    read: live.daa != null ? { chain: "tn10", block: live.daa, t: Date.now() } : null,
    usdValue: 0,
    breakdown: {
      title: "Where holders' money is", sub: "Cash read from a testnet node; loans at what the covenant lets them count for",
      rows: [
        { label: "Cash in the vault coin", sub: `less its ${kas(f.keep, 0)} seed`, value: Math.max(0, liquid), share: owed ? Math.max(0, liquid) / owed : 0, chain: "Kaspa TN10", href: TN(l.address) },
        ...f.loans.filter((x) => x.principal > 0).map((x) => ({
          label: `Loan to ${x.label}`,
          sub: `${kas(x.principal)} lent at ${x.interestBps / 100}% · ${x.secondsToDue != null ? `due in ${hrs(x.secondsToDue)}` : `${hrs(x.lateSeconds)} past due`} · counts ${kas(x.counts, 4)}`,
          value: x.counts, share: owed ? x.counts / owed : 0, chain: "Kaspa TN10", href: TN(x.address),
        })),
      ],
    },
    exits: {
      title: "Can holders get their KAS back?",
      lead: "A withdrawal is one transaction the network pays at NAV or refuses, from the cash in the vault coin. What is lent out comes back only as borrowers repay: then waiting withdrawals are paid first.",
      rows: [
        { label: "Payable now", value: kas(Math.max(0, liquid)), sub: `${owed ? Math.round((Math.max(0, liquid) / owed) * 100) : 0}% of NAV`, tone: owed && liquid / owed < 0.2 ? "warn" : "good" },
        { label: "Out on loan", value: kas(f.lent), sub: `${f.loans.filter((x) => x.principal > 0).length} loan${f.loans.filter((x) => x.principal > 0).length === 1 ? "" : "s"}` },
        { label: "Withdrawals waiting", value: w.count ? kas(w.kas) : "none", sub: w.count ? `${w.count} request${w.count > 1 ? "s" : ""}` : "every request so far was paid", tone: w.count && w.kas > liquid ? "warn" : undefined },
        { label: "Repaid so far", value: kas(f.repaidTotal), sub: `of ${kas(f.lentTotal)} lent in all${f.markedDown ? ` · ${kas(f.markedDown)} marked down` : ""}` },
      ],
      bars: [], waits: [],
    },
    loans: null,
    sources: [
      { name: "Vault coin", what: "its balance and covenant id, from a testnet node; the address is the covenant rebuilt from the mandate", type: "Covenant", side: "Reserves", chain: "Kaspa TN10", href: TN(l.address) },
      ...f.loans.map((x) => ({ name: `Borrower ${x.label}`, what: "the loan's principal, due date and mark, in the covenant's state; repayments arrive at its repayment address", type: "Covenant state", side: "Reserves" as const, chain: "Kaspa TN10", href: x.repay ? TN(x.repay) : TN(x.address) })),
      { name: "Share notes", what: "every live note and its owner, from the ledger the keeper publishes, checked against the chain", type: "KCC-20", side: "Owed", chain: "Kaspa TN10", href: null },
      { name: "Redeem accounts", what: "KAS waiting at each holder's withdrawal address", type: "L1 addresses", side: "Exits", chain: "Kaspa TN10", href: null },
    ],
    control: [
      { n: "Vault covenant", addr: l.address, chain: "igra", up: "Not upgradeable: the rules are the address", admin: "No owner", pause: "Guardian can halt; repayments and withdrawals go on", t: "good" },
      { n: "Allocator", addr: m.roles.allocator, chain: "igra", up: "Lends to the named borrowers, within caps and limits", admin: "One key, held by Dawns (testnet)", pause: "—", t: "warn" },
      { n: "Valuer", addr: m.roles.valuer, chain: "igra", up: "Marks loans, one step per period; late loans fall on a schedule nobody can stop", admin: "One key, held by Dawns (testnet)", pause: "—", t: "warn" },
      { n: "Guardian", addr: m.roles.guardian, chain: "igra", up: "Can halt for good", admin: "One key, held by Dawns (testnet)", pause: "—", t: "warn" },
    ],
    owner: [],
    checks: [
      ["Cash in the vault", "the vault coin's balance, read from a testnet node", "Chain"],
      ["Loans", "principal, due date and mark in the covenant's state; a late loan's cap falls on the mandate's schedule", "Chain"],
      ["The covenant itself", "the vault page rebuilds the covenant from the mandate and checks the address", "Chain"],
    ],
    pending: [
      ["That borrowers repay", "the one thing no covenant can make true. On testnet the borrowers are Dawns-held keys that repay on schedule"],
      ["Keys by role", "allocator, valuer and guardian are three keys, all held by Dawns on testnet"],
    ],
    series: { t: [l.createdAt * 1000, ...l.moves.map((x) => x.at * 1000)], v: [0, ...l.moves.map((x) => x.navAfter / SOMPI)] },
  };
  return { p, sig };
}

async function build() {
  const out = await Promise.all([navProof("nav-tn10"), navProof("fixed-tn10"), creditProof()].map((x) => x.catch(() => null)));
  const ok = out.filter(Boolean) as { p: Proof; sig: Signal[] }[];
  return { proofs: ok.map((x) => x.p), signals: ok.flatMap((x) => x.sig) };
}

/** dawns' own vaults, cached a minute (each read touches a testnet node). */
export const vaultProofs = unstable_cache(build, ["dawns-vault-proofs-v1"], { revalidate: 60, tags: ["proof"] });

/** Every proof: the bridge and protocols (from the snapshot), then dawns' own vaults. */
export async function allProofs(s: Snapshot): Promise<Proof[]> {
  const v = await vaultProofs().catch(() => ({ proofs: [] as Proof[] }));
  return [...proofs(s), ...v.proofs];
}
export async function findProof(s: Snapshot, id: string): Promise<Proof | null> {
  return proofOf(s, id) ?? (await vaultProofs().catch(() => ({ proofs: [] as Proof[] }))).proofs.find((p) => p.id === id) ?? null;
}
