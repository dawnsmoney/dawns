import Link from "next/link";
import { Banner } from "@/components/Banner";
import { Pill } from "@/components/bits";
import { SplitBar, CapBars, CopyId } from "@/components/viz";
import { NavPanel } from "@/components/nav-panel";
import { Basis, TokenFamily, type Stamp } from "@/components/research";
import { SharePriceChart, HoldingGrid, LiquidityChart } from "@/components/share-chart";
import { sharePoints, liquidPoints } from "@/lib/vaults/share-history";
import { getNav, navFigures, navVault, readNavLive, termView, SOMPI, FIRST_PRICE, type NavSlug, type NavMandateDoc } from "@/lib/vaults/nav";
import { VaultProof } from "@/components/vault-proof";


const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];
const LIQUID = "#9085e9";
const kas = (x: number, d = 2) => `${x.toLocaleString("en-US", { maximumFractionDigits: d })} KAS`;
const short = (s: string) => (s.length > 22 ? `${s.slice(0, 14)}…${s.slice(-6)}` : s);
const when = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

const STEPS: [string, string][] = [
  ["You send KAS", "to your personal deposit address, from any wallet. Only the vault or you can move that coin."],
  ["The vault mints shares", "at NAV, rounded up so no deposit dilutes existing holders. Your shares are a KCC-20 token note."],
  ["The manager allocates", "only to approved destinations, within caps and a reserve. A valuer marks what positions are worth."],
  ["You redeem", "by sending 1 KAS to your withdrawal address. The vault burns your note and pays NAV to your own address."],
];

function HowItWorks() {
  return (
    <div className="card">
      <div className="c-head"><h3>How your KAS moves</h3><span className="tag">every step checked by the network</span></div>
      <div className="flow">{STEPS.map(([h, p], i) => <div key={h} className="flow-step"><span>{i + 1}</span><b>{h}</b><small>{p}</small></div>)}</div>
    </div>
  );
}

function Keys({ roles }: { roles: { allocator: string; valuer: string; guardian: string } | null }) {
  const K: [string, string, string[], string[], string | null][] = [
    ["Allocator", "#3987e5", ["Moves capital to approved destinations", "Brings it back"], ["Cannot pay anyone else", "Cannot touch shares"], roles?.allocator ?? null],
    ["Valuer", "#c98500", ["Marks each position once per period", "Within a fixed step"], ["Cannot move a single sompi"], roles?.valuer ?? null],
    ["Guardian", "#e66767", ["Creates the share token", "Halts the vault for good"], ["Cannot take capital", "Cannot stop withdrawals"], roles?.guardian ?? null],
    ["Anyone", "#199e70", ["Runs deposits and withdrawals", "The outcome is fixed by the rules"], ["Cannot choose who gets shares or payouts"], null],
  ];
  return (
    <div className="card">
      <div className="c-head"><h3>Who can do what</h3><span className="tag">four roles, no key does two jobs</span></div>
      <div className="keys3 keys4">
        {K.map(([n, c, yes, no, a]) => (
          <div key={n} className="key3" style={{ ["--c" as string]: c }}>
            <h4><i />{n}</h4>
            <ul>{yes.map((y) => <li key={y}>{y}</li>)}{no.map((x) => <li key={x} className="no">{x}</li>)}</ul>
            {a && <small className="mono">{short(a)}</small>}
          </div>
        ))}
      </div>
    </div>
  );
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** A fixed-term vault's two dates, as the network enforces them: deposits until the window closes, withdrawals from maturity. */
function Term({ m, daa, createdAt }: { m: NavMandateDoc; daa: number | null; createdAt: number }) {
  if (!m.maturityDaa && !m.depositUntilDaa) return null;
  const t = termView(m, daa, createdAt);
  const open = !m.depositUntilDaa || (daa != null && daa + 100 < m.depositUntilDaa);
  const matured = !m.maturityDaa || (daa != null && daa - 100 >= m.maturityDaa);
  const unknown = daa == null && (!!m.depositUntilDaa || !!m.maturityDaa);
  const winEnd = t.winEnd, mat = t.mat;
  return (
    <div className="card">
      <div className="c-head"><h3>The term</h3><span className="tag">enforced by the network</span></div>
      <div className="term-line" aria-hidden>
        <i className="term-win" style={{ width: `${t.posWin}%` }} />
        <i className="term-now" style={{ left: `${t.posNow}%` }} />
        {winEnd != null && <span className="term-mark" style={{ left: `${t.posWin}%` }} />}
        {mat != null && <span className="term-mark end" style={{ left: `${t.posMat}%` }} />}
      </div>
      <div className="term-facts">
        <div><span className="eyebrow muted">Deposits</span><b className={open ? "up" : "muted"}>{unknown && m.depositUntilDaa ? "—" : open ? "Open" : "Closed"}</b><small>{m.depositUntilDaa ? <>{unknown ? "no testnet node answered; ends at" : open ? "until" : "closed at"} {winEnd != null ? day(winEnd) : `DAA ${m.depositUntilDaa.toLocaleString("en-US")}`}{open ? t.leftWin : ""}</> : "no window: open until the vault halts"}</small></div>
        <div><span className="eyebrow muted">Withdrawals</span><b className={matured ? "up" : ""}>{unknown && m.maturityDaa ? "—" : matured ? "Open" : "At maturity"}</b><small>{m.maturityDaa ? <>{unknown ? "no testnet node answered; from" : matured ? "since" : "from"} {mat != null ? day(mat) : `DAA ${m.maturityDaa.toLocaleString("en-US")}`}{matured ? "" : t.leftMat}</> : "any time"}</small></div>
        <div><span className="eyebrow muted">What the network does</span><b style={{ fontSize: 15 }}>Refuses early exits</b><small>a deposit after the window and a withdrawal before maturity are invalid transactions: no one, the manager included, can make them happen</small></div>
      </div>
      <p className="foot" style={{ marginBottom: 0 }}>Times are estimated from DAA score at 10 blocks a second; the covenant checks the DAA score itself ({m.depositUntilDaa ? `window ends at ${m.depositUntilDaa.toLocaleString("en-US")}` : "no window"}{m.maturityDaa ? `, maturity at ${m.maturityDaa.toLocaleString("en-US")}` : ""}).</p>
    </div>
  );
}

/** The strategy the keeper runs: each destination's weight now against its target and the mandate's cap. */
function Strategy({ slug, m, f }: { slug: NavSlug; m: NavMandateDoc; f: ReturnType<typeof navFigures> }) {
  const st = navVault(slug).strategy;
  if (!st) return null;
  const nav = f.nav || 1;
  const keep = Math.max(st.liquidBps, m.reserveFloorBps) / 1e4;
  return (
    <div className="card">
      <div className="c-head"><h3>The strategy, run automatically</h3><span className="tag">inside the mandate</span></div>
      <p className="muted" style={{ margin: "0 0 16px", fontSize: 14.5 }}>The keeper runs it after every deposit and withdrawal: it sends idle cash toward each destination&apos;s target, brings cash back when withdrawals wait, and marks each destination to what its wallet actually holds. The network still enforces the caps, the {pct(m.reserveFloorBps / 1e4)} reserve and the limits per move: the strategy can only ask for moves the mandate allows.</p>
      <div className="strat-rows">
        {m.destinations.map((d, i) => {
          const now = (f.marks[i] ?? 0) / nav, target = (st.targetsBps[i] ?? 0) / 1e4, cap = d.capBps / 1e4;
          return (
            <div key={d.address} className="strat-row">
              <b>{d.label.replace(" (test wallet)", "")}</b>
              <div className="strat-bar"><i style={{ width: `${Math.min(100, now * 100)}%`, background: COLORS[i] }} /><span className="strat-t" style={{ left: `${Math.min(100, target * 100)}%` }} title="target" /><span className="strat-c" style={{ left: `${Math.min(100, cap * 100)}%` }} title="cap" /></div>
              <small>{pct(now, 1)} now · target {pct(target)} · cap {pct(cap)}</small>
            </div>
          );
        })}
        <div className="strat-row">
          <b>Kept liquid</b>
          <div className="strat-bar"><i style={{ width: `${Math.min(100, (Math.max(0, f.liquid) / nav) * 100)}%`, background: LIQUID }} /><span className="strat-t" style={{ left: `${keep * 100}%` }} title="target" /></div>
          <small>{pct(Math.max(0, f.liquid) / nav, 1)} now · target {pct(keep)} · for withdrawals</small>
        </div>
      </div>
      <p className="foot" style={{ marginBottom: 0 }}>On testnet the destinations are Dawns-held wallets that earn nothing, so marks never go above cost. On mainnet a destination is a strategy wallet that bridges to Igra or Kasplex and deploys there; dawns marks it from the positions it reads.</p>
    </div>
  );
}

export async function NavVaultView({ slug }: { slug: NavSlug }) {
  const fixed = slug === "fixed-tn10";
  const crumb = fixed ? "Fixed term · testnet-10" : "NAV · testnet-10";
  const title = fixed ? "Fixed-term vault" : "NAV vault";
  const { l, m } = await getNav(slug);
  if (!l || !m) {
    return (
      <>
        <Banner short crumb={[{ href: "/vaults", label: "Vaults" }, { label: crumb }]} title={title}
          lede={fixed ? "The NAV covenant with a deposit window and a maturity date: deposit while the window is open, redeem at NAV from maturity. Written and tested against the Kaspa node's own script engine; it launches on testnet-10 next." : "Open to anyone: send KAS from your wallet, get shares at NAV, redeem at NAV. The covenant is written and tested against the Kaspa node's own script engine; it launches on testnet-10 next."} />
        <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
          <HowItWorks />
          <Keys roles={null} />
          <div className="card">
            <div className="c-head"><h3>What the covenant guarantees</h3><Pill t="info">Launching</Pill></div>
            <ul className="findings">
              <li>Shares are minted only against KAS that arrived, at NAV rounded up: a deposit never dilutes holders.</li>
              <li>A share note is burned only when its owner&apos;s own withdrawal account is spent, and the payout goes to the owner&apos;s address and nowhere else.</li>
              <li>An exit fee stays in the vault for the holders who remain.</li>
              <li>The allocator is bound by the same destinations, caps, reserve and limits as the mandate vault.</li>
              <li>Marks move at most a fixed step per period, set by a valuer key the allocator does not hold.</li>
              <li>A halt stops new allocations and deposits; recalls and withdrawals continue, so every holder can leave.</li>
              {fixed && <li>Deposits only while the window is open, withdrawals only from maturity: the network refuses either one outside its dates.</li>}
            </ul>
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Launch share price: {(FIRST_PRICE / SOMPI).toFixed(2)} KAS. Testnet only, not audited. <Link href="/vaults/mandate-tn10">See the mandate vault running now</Link>.</p>
          </div>
        </div>
      </>
    );
  }

  const live = await readNavLive(l);
  const f = navFigures(l, m);
  const daa = live.daa;
  const maturityOpen = m.maturityDaa === 0 || (daa != null && daa - 100 >= m.maturityDaa);
  const depositOpen = !m.depositUntilDaa || (daa != null && daa + 100 < m.depositUntilDaa);
  const valueTotal = f.liquid + f.marks.reduce((s, x) => s + x, 0);
  const since = f.price / (FIRST_PRICE / SOMPI) - 1;
  const lastAt = (l.moves[l.moves.length - 1]?.at ?? l.createdAt) * 1000;
  const vs: Stamp = live.matches ? { kind: "onchain", by: "the vault's coin matches this ledger", at: lastAt } : { kind: "reported", by: "the operator's ledger", at: lastAt };
  const dests = m.destinations;
  const name = (i: number | undefined) => (i != null ? dests[i]?.label.replace(" (test wallet)", "") ?? "" : "");
  const log = [...l.moves].reverse().map((x) => {
    const t = x.kind === "deposit" ? { c: "#199e70", title: `Deposit · ${(x.shares ?? 0).toLocaleString("en-US")} shares minted`, amt: `+${kas((x.paid ?? 0) / SOMPI)}` }
      : x.kind === "redeem" ? { c: "#e66767", title: `Withdrawal · ${(x.shares ?? 0).toLocaleString("en-US")} shares burned`, amt: `−${kas((x.payout ?? 0) / SOMPI)}` }
      : x.kind === "allocate" ? { c: COLORS[x.slot ?? 0], title: `Sent to ${name(x.slot)}`, amt: `−${kas((x.amount ?? 0) / SOMPI)}` }
      : x.kind === "recall" ? { c: COLORS[x.slot ?? 0], title: `Returned from ${name(x.slot)}`, amt: `+${kas((x.amount ?? 0) / SOMPI)}` }
      : x.kind === "mark" ? { c: "#c98500", title: "Positions marked", amt: "" }
      : x.kind === "halt" ? { c: "#e66767", title: "Guardian halted the vault", amt: "" }
      : x.kind === "token" ? { c: LIQUID, title: "Share token created", amt: "" }
      : { c: LIQUID, title: x.kind, amt: "" };
    return { ...t, key: x.txid, at: x.at, sub: `${x.txid.slice(0, 16)}… · NAV ${kas(x.navAfter / SOMPI)} after${x.owner ? ` · ${short(x.owner)}` : ""}` };
  });

  const firstDep = l.moves.findIndex((x) => x.kind === "deposit");
  const seedJump = firstDep >= 0 && l.moves[firstDep].sharesAfter > 0 && l.moves[firstDep].navAfter / l.moves[firstDep].sharesAfter > FIRST_PRICE * 1.005;
  const history = sharePoints(l.createdAt, l.moves, FIRST_PRICE / SOMPI, f.price, (x) => { const e = log.find((y) => y.key === x.txid); return { title: e?.title ?? x.kind, amt: e?.amt || undefined }; });
  const liquidity = liquidPoints(l.moves, m.minKeepSompi, { liquid: f.liquid, nav: f.nav }, (x) => log.find((y) => y.key === x.txid)?.title ?? x.kind);
  const redeems = l.moves.filter((x) => x.kind === "redeem").length;
  return (
    <>
      <Banner short crumb={[{ href: "/vaults", label: "Vaults" }, { label: crumb }]} title={title}
        lede={fixed ? "Fixed term on testnet-10: deposit while the window is open, get shares at NAV, redeem at NAV from maturity. The Kaspa network enforces both dates." : "Open to anyone on testnet-10: send KAS from your wallet, get shares at NAV, redeem at NAV. The Kaspa network enforces the rules."} />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        <div className="card vault-hero">
          <div className="vault-top">
            <h2>{m.name}</h2>
            <div className="vault-tags"><Pill t="info">testnet-10</Pill><Pill t="warn">Not audited</Pill>{l.state.halted ? <Pill t="crit">Halted</Pill> : !depositOpen ? <Pill t="info">{maturityOpen ? "Matured" : "Window closed"}</Pill> : <Pill t="good">Open</Pill>}</div>
          </div>
          <VaultProof kind="nav" l={l} m={m} />
          <div className="depth-top depth-4" style={{ margin: 0 }}>
            <div><span className="eyebrow muted">NAV</span><b>{kas(f.nav)}</b><small>{kas(f.liquid)} liquid · {kas(f.marks.reduce((s, x) => s + x, 0))} in positions</small><Basis stamp={vs} text={`KAS held by the vault's coin, less its ${kas(f.keep)} seed, plus each destination at the valuer's mark. The same formula prices every deposit and withdrawal, inside the covenant.`} /></div>
            <div><span className="eyebrow muted">Per share</span><b>{f.price.toFixed(6)}</b><small>{f.shares ? `${since >= 0 ? "+" : "−"}${pct(Math.abs(since), 2)} since launch at ${(FIRST_PRICE / SOMPI).toFixed(2)}` : "launch price"}</small><Basis stamp={vs} text={`NAV ÷ ${f.shares.toLocaleString("en-US")} shares. Deposits mint at this price rounded up; withdrawals pay it rounded down, less the ${m.exitFeeBps / 100}% exit fee that stays with holders.`} /></div>
            <div><span className="eyebrow muted">Holders</span><b>{f.holders}</b><small>{f.shares.toLocaleString("en-US")} shares in {f.liveNotes} notes</small><Basis stamp={vs} text="Owners of live share notes: each deposit mints one KCC-20 note to its owner's personal withdrawal account; each withdrawal burns a whole note." /></div>
            <div><span className="eyebrow muted">In / out</span><b>{kas(f.deposited, 0)}</b><small>deposited · {kas(f.paidOut, 0)} paid out</small><Basis stamp={vs} text="Sums of every recorded deposit and withdrawal in the ledger; each is a transaction you can open from the history below." /></div>
          </div>
          <div>
            <div className="eyebrow muted" style={{ marginBottom: 10 }}>Where the NAV is</div>
            <SplitBar label="NAV by place" parts={[...m.destinations.map((d, i) => ({ key: `d${i}`, label: d.label.replace(" (test wallet)", ""), color: COLORS[i], share: f.marks[i] ?? 0, note: `${kas(f.marks[i] ?? 0)} marked · ${kas(f.cost[i] ?? 0)} cost` })),
              { key: "liquid", label: "Liquid in the vault", color: LIQUID, share: Math.max(0, f.liquid), note: kas(f.liquid) }]} />
          </div>
        </div>

        <Term m={m} daa={daa} createdAt={l.createdAt} />
        <Strategy slug={slug} m={m} f={f} />

        <div className="card">
          <div className="c-head"><h3>Share price since launch</h3><span className="tag">after every move · KAS</span></div>
          <SharePriceChart points={history} launch={FIRST_PRICE / SOMPI} label="Share price since launch" />
          <p className="foot" style={{ marginBottom: 0 }}>The price moves only when value changes for everyone already in: interest, marks, markdowns and exit fees. Deposits and withdrawals happen at NAV and leave it where it is{seedJump ? <>, except the first deposit: shares were minted at the launch price while the vault&apos;s opening seed already counted in NAV, so the first holders received it</> : null}.</p>
        </div>

        <div className="card">
          <div className="c-head"><h3>What holders made</h3><span className="tag">every entry and exit pair</span></div>
          <HoldingGrid points={history} exitFeeBps={m.exitFeeBps} />
          <p className="foot" style={{ marginBottom: 0 }}>Each cell is one holder who came in at the start of a step and left at the end of another, at the share price then, less the exit fee that stays with the others. Not a forecast: it is what the recorded price did.</p>
        </div>

        <div className="card">
          <div className="c-head"><h3>Could holders leave?</h3><span className="tag">cash payable ÷ NAV, after every move</span></div>
          <LiquidityChart points={liquidity} floor={m.reserveFloorBps / 1e4} redeems={redeems} paid={kas(f.paidOut)} />
          <p className="foot" style={{ marginBottom: 0 }}>There is no withdrawal queue to time: a withdrawal is one transaction the network pays at once or refuses. What decides it is the cash in the vault, shown here. The allocator can&apos;t send capital out below the reserve floor.</p>
        </div>

        <div className="card">
          <div className="c-head"><h3>Tokens and coins</h3><span className="tag">everything this vault is made of</span></div>
          <TokenFamily caption="Outstanding claims and the coins behind them" rows={[
            { letter: "S", color: "#3987e5", name: "Share token", role: `KCC-20 bound to the vault · ${f.shares.toLocaleString("en-US")} shares in ${f.liveNotes} note${f.liveNotes === 1 ? "" : "s"} · at ${f.price.toFixed(6)} KAS`, amount: kas(f.nav), id: l.shareCovid, main: true },
            { letter: "V", color: LIQUID, name: "Vault coin", role: "the covenant itself: one coin, its state in its script, moved only by its rules", amount: kas(f.held), id: l.address, href: `https://tn10.kaspa.stream/addresses/${l.address}` },
            { letter: "K", color: "#6E6788", name: "Seed", role: "the vault's own, inside the vault coin: never shares", amount: kas(f.keep) },
            { letter: "N", color: "#9085e9", name: "Note deposits", role: `${kas(m.noteValueSompi / SOMPI)} held with each share note, returned with its withdrawal`, amount: kas((f.liveNotes * m.noteValueSompi) / SOMPI) },
            ...m.destinations.map((d, i) => ({ letter: String(i + 1), color: COLORS[i], name: `Destination · ${d.label.replace(" (test wallet)", "")}`, role: `at most ${d.capBps / 100}% of NAV · marked ${kas(f.marks[i] ?? 0)}, cost ${kas(f.cost[i] ?? 0)}`, amount: kas(f.marks[i] ?? 0), id: d.address, href: `https://tn10.kaspa.stream/addresses/${d.address}` })),
          ]} />
        </div>

        <div className="card">
          <div className="c-head"><h3>Your position</h3><span className="tag">testnet KAS only</span></div>
          <NavPanel vault={l.covenantId} template={l.accountTemplate} price={f.price} minDeposit={m.minDepositSompi / SOMPI} noteValue={m.noteValueSompi / SOMPI} maxFee={m.maxFeeSompi / SOMPI} exitFeeBps={m.exitFeeBps} halted={l.state.halted} maturityOpen={maturityOpen} depositOpen={depositOpen} />
        </div>

        <div className="grid gA">
          <div className="card">
            <div className="c-head"><h3>Caps per destination</h3><span className="tag">at cost, share of NAV</span></div>
            <CapBars rows={m.destinations.map((d, i) => ({ key: d.address, label: d.label.replace(" (test wallet)", ""), sub: short(d.address), share: valueTotal ? (f.cost[i] ?? 0) / valueTotal : 0, cap: d.capBps / 1e4, display: `${pct(valueTotal ? (f.cost[i] ?? 0) / valueTotal : 0, 1)} / ${pct(d.capBps / 1e4)}`, color: COLORS[i] }))} />
          </div>
          <div className="card">
            <div className="c-head"><h3>Entry and exit terms</h3><span className="tag">set in the mandate</span></div>
<dl className="kv">
              <dt>Exit fee</dt><dd>{m.exitFeeBps / 100}% of the payout, kept for remaining holders</dd>
              <dt>Minimum deposit</dt><dd>{kas(m.minDepositSompi / SOMPI)} after the note&apos;s {kas(m.noteValueSompi / SOMPI)} and the fee</dd>
              <dt>Mark step</dt><dd>at most {m.maxMarkStepBps / 100}% per position per period</dd>
              {m.depositUntilDaa > 0 && <><dt>Deposit window</dt><dd>deposits until DAA {m.depositUntilDaa.toLocaleString("en-US")}</dd></>}
              {m.maturityDaa > 0 && <><dt>Maturity</dt><dd>withdrawals from DAA {m.maturityDaa.toLocaleString("en-US")}</dd></>}
            </dl>
          </div>
        </div>

        <HowItWorks />
        <Keys roles={m.roles} />

        <div className="card">
          <div className="c-head"><h3>History</h3><span className="tag">{l.moves.length} moves</span></div>
          <div className="vlog">
            {log.map((x) => (
              <div key={x.key} className="vlog-row" style={{ ["--c" as string]: x.c }}>
                <i /><div><b>{x.title}</b><small>{when(x.at)} · {x.sub}</small></div><span className="amt">{x.amt}</span>
              </div>
            ))}
            <div className="vlog-row" style={{ ["--c" as string]: LIQUID }}><i /><div><b>Vault opened</b><small>{when(l.createdAt)} · {l.genesisTx.slice(0, 16)}… · seed {kas(l.seed / SOMPI)} (the vault&apos;s own, never shares)</small></div><span className="amt" /></div>
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>The mandate</h3><span className="tag">{m.standard}</span></div>
          <p style={{ marginTop: 0, color: "var(--ink-2)" }}>{m.objective}</p>
          <dl className="kv">
            <dt>Mandate hash</dt><dd><CopyId text={l.mandateHash} /></dd>
            <dt>Vault covenant</dt><dd><CopyId text={l.covenantId} /></dd>
            <dt>Share token</dt><dd>{l.shareCovid ? <CopyId text={l.shareCovid} /> : "not created yet"}</dd>
            <dt>Vault address now</dt><dd><CopyId text={l.address} /></dd>
          </dl>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Testnet only, not audited, no outside capital. Share notes are KCC-20 tokens owned by your personal withdrawal account; a deposit makes one note, a withdrawal burns one whole note.</p>
      </div>
    </>
  );
}
