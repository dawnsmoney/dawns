import forms from "./credit-forms.json";
import { checkAddress, destHash, fillForm, intOf, keyOf, mandateHashOf, NO_DEADLINE, pushB32, pushBool, pushI64, pushNum, unhex, type CodeCheck, type Forms } from "./verify-vault";

/**
 * The credit covenant, rebuilt from a mandate and state (see verify-vault.ts):
 * credit-forms.json comes from `dawns-vault credit template`, and
 * vault/credit/credit-vectors.json holds the cases it is tested on.
 */
const FORMS = forms as unknown as Forms;
export const CREDIT_VERSIONS = Object.keys(FORMS.forms);
export const CREDIT_LATEST = FORMS.latest;
export { mandateHashOf, sortedJson, pushNum, pushI64, type CodeCheck } from "./verify-vault";

type Doc = Record<string, unknown> & { roles?: Record<string, string>; borrowers?: { address: string; capBps: number; termDaa: number; interestBps: number }[] };
export type CreditStateDoc = { shareCovid: string | null; shares: number; principal: number[]; due: number[]; marks: number[]; epochIndex: number; epochSpent: number; markEpoch: number; halted: boolean };

function values(doc: Doc, st: CreditStateDoc): Map<string, Uint8Array> {
  const v = new Map<string, Uint8Array>();
  (["allocator", "valuer", "guardian"] as const).forEach((r) => v.set(r, pushB32(keyOf(doc.roles?.[r], `roles.${r}`))));
  v.set("maxFeeSompi", pushNum(intOf(doc, "maxFeeSompi")));
  const bs = doc.borrowers ?? [];
  if (!Array.isArray(bs) || bs.length < 1 || bs.length > 3) throw new Error("1 to 3 borrowers");
  for (let i = 0; i < 3; i++) {
    const b = bs[i];
    if (b) keyOf(b.address, `borrowers[${i}].address`);      // a borrower must be a plain key: its repayment account is bound to it
    v.set(`dest${i}`, pushB32(b ? destHash(b.address, `borrowers[${i}].address`) : new Uint8Array(32)));
    v.set(`cap${i}`, pushNum(b ? BigInt(b.capBps) : BigInt(0)));
    v.set(`term${i}`, pushNum(b ? BigInt(b.termDaa) : BigInt(0)));
    v.set(`interest${i}`, pushNum(b ? BigInt(b.interestBps) : BigInt(0)));
  }
  for (const k of FORMS.paramInts) {
    const x = intOf(doc, k);
    v.set(k, pushNum(k === "depositUntilDaa" && x === BigInt(0) ? NO_DEADLINE : x));
  }
  v.set("mandateHash", pushB32(unhex(mandateHashOf(doc))));
  v.set("shareCovid", pushB32(st.shareCovid ? unhex(st.shareCovid) : new Uint8Array(32)));
  const ints: [string, number][] = [["shares", st.shares], ...st.principal.map((x, i): [string, number] => [`principal${i}`, x]), ...st.due.map((x, i): [string, number] => [`due${i}`, x]), ...st.marks.map((x, i): [string, number] => [`mark${i}`, x]),
    ["epochIndex", st.epochIndex], ["epochSpent", st.epochSpent], ["markEpoch", st.markEpoch]];
  for (const [k, x] of ints) v.set(k, pushI64(BigInt(x)));
  v.set("halted", pushBool(st.halted));
  return v;
}

/** The credit covenant's bytecode for this mandate and state. */
export const creditBytecode = (version: string, doc: unknown, st: CreditStateDoc) => fillForm(FORMS, version, values(doc as Doc, st), "halted");

/** Does `address` hold the credit covenant `version` compiled with this mandate and state? */
export const checkCreditAddress = (version: string, doc: unknown, st: CreditStateDoc, address: string): CodeCheck =>
  checkAddress(address, () => creditBytecode(version, doc, st), `${version} with this mandate and state`);
