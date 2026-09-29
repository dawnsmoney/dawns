import "server-only";
import { mandate as mm, ledger as ml, figures as mandateFigures, SOMPI } from "@/lib/vault";
import { getNav, navFigures, FIRST_PRICE } from "./nav";
import { getCredit, creditFigures } from "./credit";

/**
 * Every vault dawns knows, whatever its state, and the managers who run them.
 * A vault's facts come from its own ledger and mandate; nothing here is typed in
 * by hand except what a document cannot state (who a manager is).
 */
export type VaultKind = "mandate" | "nav" | "fixed" | "credit";
export type VaultStatus = "live" | "ready" | "designed";

export interface VaultCard {
  id: string; kind: VaultKind; name: string; href: string | null; manager: string; network: string; status: VaultStatus;
  pitch: string; figures: { label: string; value: string }[];
  guarantees: string[];
}

const kas = (x: number, d = 0) => `${x.toLocaleString("en-US", { maximumFractionDigits: d })} KAS`;

export const KIND: Record<VaultKind, { label: string; color: string; one: string }> = {
  mandate: { label: "Mandate", color: "#9085e9", one: "One owner. The manager allocates inside rules the network enforces." },
  nav: { label: "NAV", color: "#3987e5", one: "Anyone deposits and gets shares at NAV; anyone redeems at NAV." },
  fixed: { label: "Fixed term", color: "#c98500", one: "Shares at NAV, redeemable only from a maturity date fixed at launch." },
  credit: { label: "Credit", color: "#199e70", one: "Lends to approved borrowers with an amount, a rate and a due date." },
};

export async function vaults(): Promise<VaultCard[]> {
  const { l: navLedger, m: navMandate } = await getNav();
  const mf = mandateFigures();
  const out: VaultCard[] = [{
    id: "mandate-tn10", kind: "mandate", name: mm.name, href: "/vaults/mandate-tn10", manager: "dawns", network: "testnet-10", status: ml.closed ? "designed" : "live",
    pitch: "The first covenant vault: every path exercised on testnet, with the network's refusals on the record.",
    figures: [{ label: "Value", value: kas(mf.value) }, { label: "Moves", value: String(ml.moves.length) }, { label: "Refused", value: String(ml.refusals.length) }],
    guarantees: ["Approved destinations only", `Caps ${mm.destinations.map((d) => `${d.capBps / 100}%`).join(" / ")}`, `${mm.reserveFloorBps / 100}% reserve`],
  }];
  if (navLedger && navMandate) {
    const f = navFigures(navLedger, navMandate);
    out.push({
      id: "nav-tn10", kind: "nav", name: navMandate.name, href: "/vaults/nav-tn10", manager: navMandate.manager ?? "dawns", network: "testnet-10", status: "live",
      pitch: "Open to anyone on testnet-10: send KAS from your wallet, get shares at NAV, redeem at NAV.",
      figures: [{ label: "NAV", value: kas(f.nav) }, { label: "Per share", value: f.price.toFixed(4) }, { label: "Holders", value: String(f.holders) }],
      guarantees: ["Shares minted only against KAS received", "Payout only to the owner's address", `${navMandate.exitFeeBps / 100}% exit fee stays with holders`],
    });
  } else {
    out.push({
      id: "nav-tn10", kind: "nav", name: "Dawns TN10 NAV vault", href: "/vaults/nav-tn10", manager: "dawns", network: "testnet-10", status: "ready",
      pitch: "Covenant written and engine-tested; launching on testnet-10. Deposits from any wallet, shares at NAV.",
      figures: [{ label: "Launch price", value: `${(FIRST_PRICE / SOMPI).toFixed(2)} KAS / share` }],
      guarantees: ["Shares minted only against KAS received", "Payout only to the owner's address", "Exit fee stays with holders"],
    });
  }
  out.push(
    { id: "fixed-term", kind: "fixed", name: "Fixed-term vault", href: null, manager: "dawns", network: "testnet-10", status: "designed",
      pitch: "The NAV covenant with a maturity date and a deposit window: the same code, two parameters.",
      figures: [], guarantees: ["No redemption before maturity", "Deposits only in the window", "Everything else as NAV"] },
  );
  const { l: cl, m: cm } = await getCredit();
  if (cl && cm) {
    const f = creditFigures(cl, cm, null);
    out.push({
      id: "credit-tn10", kind: "credit", name: cm.name, href: "/vaults/credit-tn10", manager: cm.manager ?? "dawns", network: "testnet-10", status: "live",
      pitch: "Loans to named borrowers. Repayments can only come back into the vault; a late loan loses value on a schedule nobody can stop.",
      figures: [{ label: "NAV", value: kas(f.nav) }, { label: "Loans", value: `${f.loans.filter((x) => x.status !== "free").length} of ${f.loans.length}` }, { label: "Holders", value: String(f.holders) }],
      guarantees: ["Only registered borrowers", "Repayments only into the vault", `Late loans −${cm.markdownStepBps / 100}% per period`],
    });
  } else {
    out.push({ id: "credit", kind: "credit", name: "Credit vault", href: null, manager: "dawns", network: "testnet-10", status: "designed",
      pitch: "Approved borrowers as destinations, each with an amount, a rate and a due date. Repayments can only come back into the vault.",
      figures: [], guarantees: ["Only approved borrowers", "Per-borrower cap", "Overdue loans marked down on schedule"] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// managers
// ---------------------------------------------------------------------------
export interface Manager {
  id: string; name: string; letter: string; kind: string; about: string; site: string | null; since: string;
  checks: [string, boolean][]; // what dawns has verified about the manager
}
export const MANAGERS: Manager[] = [{
  id: "dawns", name: "Dawns", letter: "D", kind: "Protocol team", since: "2026-09",
  about: "Builds dawns.money and runs its reference vaults on testnet-10 to prove every covenant path before any outside capital. Holds allocator, valuer and guardian keys as separate keys.",
  site: "https://www.dawns.money",
  checks: [["Keys separated by role", true], ["Every vault engine-tested and mutation-checked", true], ["Mandates published and hash-committed", true], ["Independent audit", false], ["Legal review for outside capital", false]],
}];

/** What a manager has done, from its vaults' ledgers. */
export async function trackRecord(id: string) {
  const { l: navLedger, m: navMandate } = await getNav();
  const vs = (await vaults()).filter((v) => v.manager === id);
  const sent = ml.moves.filter((x) => x.kind === "allocate").reduce((s, x) => s + (x.amount ?? 0), 0) / SOMPI
    + (navLedger?.moves.filter((x) => x.kind === "allocate").reduce((s, x) => s + (x.amount ?? 0), 0) ?? 0) / SOMPI;
  const back = ml.moves.filter((x) => x.kind === "recall").reduce((s, x) => s + (x.amount ?? 0), 0) / SOMPI
    + (navLedger?.moves.filter((x) => x.kind === "recall").reduce((s, x) => s + (x.amount ?? 0), 0) ?? 0) / SOMPI;
  const { l: cl, m: cm } = await getCredit();
  const moves = ml.moves.length + (navLedger?.moves.length ?? 0) + (cl?.moves.length ?? 0);
  const refusals = ml.refusals.length;
  const nav = navLedger && navMandate ? navFigures(navLedger, navMandate) : null;
  return {
    vaults: vs, live: vs.filter((v) => v.status === "live").length, moves, refusals, sent, back,
    navReturn: nav && nav.shares > 0 ? nav.price / (FIRST_PRICE / SOMPI) - 1 : null,
    keys: [
      { role: "Allocator", vault: "Mandate vault", address: mm.roles.allocator },
      { role: "Guardian", vault: "Mandate vault", address: mm.roles.guardian },
      ...(navMandate ? [
        { role: "Allocator", vault: "NAV vault", address: navMandate.roles.allocator },
        { role: "Valuer", vault: "NAV vault", address: navMandate.roles.valuer },
        { role: "Guardian", vault: "NAV vault", address: navMandate.roles.guardian },
      ] : []),
      ...(cm ? [
        { role: "Allocator", vault: "Credit vault", address: cm.roles.allocator },
        { role: "Valuer", vault: "Credit vault", address: cm.roles.valuer },
        { role: "Guardian", vault: "Credit vault", address: cm.roles.guardian },
      ] : []),
    ],
  };
}
