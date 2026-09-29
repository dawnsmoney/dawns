import forms from "./nav-forms.json";
import { checkAddress, destHash, fillForm, intOf, keyOf, mandateHashOf, NO_DEADLINE, pushB32, pushBool, pushI64, pushNum, unhex, type CodeCheck, type Forms } from "./verify-vault";

/**
 * The NAV covenant, rebuilt from a mandate and state (see verify-vault.ts):
 * nav-forms.json comes from `dawns-vault nav template`, and
 * vault/nav/nav-vectors.json holds the cases it is tested on.
 */
const FORMS = forms as unknown as Forms;
export const NAV_VERSIONS = Object.keys(FORMS.forms);
export const NAV_LATEST = FORMS.latest;

type Doc = Record<string, unknown> & { roles?: Record<string, string>; destinations?: { address: string; capBps: number }[] };
export type NavStateDoc = { shareCovid: string | null; shares: number; deployed: number[]; marks: number[]; epochIndex: number; epochSpent: number; markEpoch: number; halted: boolean };

function values(doc: Doc, st: NavStateDoc): Map<string, Uint8Array> {
  const v = new Map<string, Uint8Array>();
  (["allocator", "valuer", "guardian"] as const).forEach((r) => v.set(r, pushB32(keyOf(doc.roles?.[r], `roles.${r}`))));
  v.set("maxFeeSompi", pushNum(intOf(doc, "maxFeeSompi")));
  const ds = doc.destinations ?? [];
  if (!Array.isArray(ds) || ds.length < 1 || ds.length > 4) throw new Error("1 to 4 destinations");
  for (let i = 0; i < 4; i++) {
    const d = ds[i];
    v.set(`dest${i}`, pushB32(d ? destHash(d.address, `destinations[${i}].address`) : new Uint8Array(32)));
    v.set(`cap${i}`, pushNum(d ? BigInt(d.capBps) : BigInt(0)));
  }
  for (const k of FORMS.paramInts) {
    const x = intOf(doc, k);
    v.set(k, pushNum(k === "depositUntilDaa" && x === BigInt(0) ? NO_DEADLINE : x));
  }
  v.set("mandateHash", pushB32(unhex(mandateHashOf(doc))));
  v.set("shareCovid", pushB32(st.shareCovid ? unhex(st.shareCovid) : new Uint8Array(32)));
  const ints: [string, number][] = [["shares", st.shares], ...st.deployed.map((x, i): [string, number] => [`deployed${i}`, x]), ...st.marks.map((x, i): [string, number] => [`mark${i}`, x]),
    ["epochIndex", st.epochIndex], ["epochSpent", st.epochSpent], ["markEpoch", st.markEpoch]];
  for (const [k, x] of ints) v.set(k, pushI64(BigInt(x)));
  v.set("halted", pushBool(st.halted));
  return v;
}

/** The NAV covenant's bytecode for this mandate and state. */
export const navBytecode = (version: string, doc: unknown, st: NavStateDoc) => fillForm(FORMS, version, values(doc as Doc, st), "halted");

/** Does `address` hold the NAV covenant `version` compiled with this mandate and state? */
export const checkNavAddress = (version: string, doc: unknown, st: NavStateDoc, address: string): CodeCheck =>
  checkAddress(address, () => navBytecode(version, doc, st), `${version} with this mandate and state`);
