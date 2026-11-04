"use client";
import { useMemo, useState } from "react";
import { fmtNum } from "@/lib/format";
import { midPrice, type OptionLeg, type OptionRow } from "@/lib/options";
import { breakeven, compareStrikes, eventsBeforeExpiry, exposure, gammaWarning, payoffCurve, probs, quoteQuality, scenarios, type RiskPos } from "@/lib/trade-risk";
import { Tabs } from "@/components/ui";

type Tab = "payoff" | "scen" | "strikes" | "quote";
const TABS = [
  { id: "payoff", label: "Payoff" },
  { id: "scen", label: "Scenarios" },
  { id: "strikes", label: "Strikes" },
  { id: "quote", label: "Quote" },
] as const;

export interface TradeRiskProps {
  spot: number;
  call: boolean;
  sold: boolean;
  strike: number;
  /** premium per share */
  premium: number;
  /** dollars put into the trade */
  amount: number;
  /** annualised volatility used for the maths */
  sigma: number;
  /** expiry close, ms */
  expiryMs: number;
  now: number;
  /** real chain leg for the chosen strike (null when estimated) */
  leg: OptionLeg | null;
  rows: OptionRow[] | null;
  marketState: string | null;
  earningsMs: number | null;
  exDivMs: number | null;
}

const money = (v: number) => `${v < 0 ? "−" : ""}$${fmtNum(Math.abs(v), 0)}`;
const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "n/a" : `${fmtNum(v * 100, 0)}%`);
const pnlCls = (v: number) => (v > 0.5 ? "text-gain" : v < -0.5 ? "text-loss" : "text-muted");
const day = (ms: number) => new Date(ms).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

function PayoffChart({ pos, spot, tYears }: { pos: RiskPos; spot: number; tYears: number }) {
  const W = 320;
  const H = 150;
  const pad = { l: 4, r: 4, t: 8, b: 16 };
  const be = breakeven(pos);
  const lo = Math.max(Math.min(spot, pos.strike, be) * 0.85, 0.01);
  const hi = Math.max(spot, pos.strike, be) * 1.15;
  const pts = useMemo(() => payoffCurve(pos, lo, hi, tYears, 80), [pos, lo, hi, tYears]);
  const ys = pts.flatMap((p) => [p.expiry, p.today]);
  const yMin = Math.min(...ys, 0);
  const yMax = Math.max(...ys, 0);
  const span = yMax - yMin || 1;
  const x = (s: number) => pad.l + ((s - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - yMin) / span) * (H - pad.t - pad.b);
  const line = (k: "expiry" | "today") => pts.map((p, i) => `${i ? "L" : "M"}${x(p.s).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const marks = [
    { s: spot, l: "Now", c: "var(--color-ink, currentColor)" },
    { s: pos.strike, l: "Strike", c: "var(--color-muted, gray)" },
    { s: be, l: "B/E", c: "var(--color-accent, currentColor)" },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-0" role="img" aria-label="Profit and loss at different stock prices">
      <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="3 3" />
      {marks.map((m, i) => (
        <g key={m.l}>
          <line x1={x(m.s)} x2={x(m.s)} y1={pad.t} y2={H - pad.b} stroke={m.c} strokeOpacity="0.6" strokeDasharray="2 2" />
          <text x={Math.min(Math.max(x(m.s), 14), W - 14)} y={H - 4 - (i === 2 ? 0 : 0)} fontSize="9" textAnchor="middle" fill="currentColor" opacity="0.7">
            {m.l} {fmtNum(m.s, m.s < 10 ? 2 : 1)}
          </text>
        </g>
      ))}
      <path d={line("today")} fill="none" stroke="var(--color-accent, currentColor)" strokeWidth="1.5" strokeOpacity="0.7" strokeDasharray="4 2" />
      <path d={line("expiry")} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function TradeRisk(p: TradeRiskProps) {
  const [tab, setTab] = useState<Tab>("payoff");
  const tYears = Math.max((p.expiryMs - p.now) / (365 * 86_400_000), 1 / (365 * 24));
  const pos: RiskPos = useMemo(
    () => ({ call: p.call, sold: p.sold, strike: p.strike, premium: p.premium, shares: p.premium > 0 ? p.amount / p.premium : 0, sigma: p.sigma }),
    [p.call, p.sold, p.strike, p.premium, p.amount, p.sigma],
  );
  const pr = probs(pos, p.spot, tYears);
  const ex = exposure(pos, p.spot, tYears);
  const warn = gammaWarning(pos, p.spot, tYears);
  const ev = eventsBeforeExpiry(p.now, p.expiryMs, p.earningsMs, p.exDivMs);
  const sc = scenarios(pos, p.spot, tYears);
  const be = breakeven(pos);
  const compare = useMemo(
    () =>
      p.rows
        ? compareStrikes(
            p.rows.flatMap((r) => {
              const l = p.call ? r.call : r.put;
              return l ? [{ strike: r.strike, mid: midPrice(l.bid, l.ask, l.last), iv: null }] : [];
            }),
            { call: p.call, sold: p.sold, spot: p.spot, t: tYears, k: p.strike, sigma: p.sigma },
          )
        : [],
    [p.rows, p.call, p.sold, p.spot, p.strike, p.sigma, tYears],
  );
  const q = quoteQuality(p.leg?.bid, p.leg?.ask);
  const closed = p.marketState !== null && p.marketState !== "REGULAR";
  const th = "px-1.5 py-1 text-right font-medium text-muted";
  const td = "px-1.5 py-1 text-right tabular-nums";

  return (
    <div className="min-w-0 space-y-1.5 rounded-md bg-panel2 px-2 py-1.5 text-xs leading-snug">
      {(ev.earnings !== null || ev.exDiv !== null) && (
        <div role="alert" className="rounded border border-loss/60 bg-loss/10 px-2 py-1 font-medium text-loss">
          {ev.earnings !== null && <p>Earnings on {day(ev.earnings)}, before expiry: expect a big price jump either way.</p>}
          {ev.exDiv !== null && <p>Ex-dividend on {day(ev.exDiv)}, before expiry: the stock drops by the dividend, which can trigger early assignment on sold calls.</p>}
        </div>
      )}
      {warn && <p className="rounded border border-loss/40 px-2 py-1 text-loss">{warn}</p>}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="font-medium text-muted">Risk picture</span>
        <Tabs tabs={TABS} value={tab} onChange={setTab} label="Risk views" />
      </div>
      {tab === "payoff" && (
        <div className="min-w-0 space-y-1">
          <PayoffChart pos={pos} spot={p.spot} tYears={tYears} />
          <p className="text-[11px] text-muted">Solid line: profit/loss at expiry. Dashed: if you closed today (estimate). Breakeven {fmtNum(be, 2)}.</p>
          {pr && (
            <>
              <p>
                <span className="text-muted">{p.sold ? "Keep the full premium" : "Finish in the money"}:</span>{" "}
                <span className="font-semibold text-ink">{pct(p.sold ? pr.otm : 1 - pr.otm)}</span>
                <span className="text-muted"> · Any profit: </span>
                <span className="font-semibold text-ink">{pct(pr.profit)}</span>
              </p>
              <p className="text-[11px] text-muted">Chances use the volatility above and a bell-curve model. They are estimates, not forecasts.</p>
            </>
          )}
          {ex && (
            <p>
              <span className="text-muted">Acts like</span>{" "}
              <span className="font-semibold text-ink">
                {ex.shares < 0 ? "short" : "long"} ≈{fmtNum(Math.abs(ex.shares), 0)} shares ≈ ${fmtNum(Math.abs(ex.dollars), 0)}
              </span>{" "}
              <span className="text-muted">of the stock right now.</span>
            </p>
          )}
        </div>
      )}
      {tab === "scen" && (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-0 border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Stock</th>
                <th className={th}>Price</th>
                <th className={th} title="Profit or loss if the move happens and one day passes">+1 day</th>
                <th className={th}>At expiry</th>
              </tr>
            </thead>
            <tbody>
              {sc.map((r) => (
                <tr key={r.pct} className="border-t border-line">
                  <td className={`${td} text-left`}>{r.pct > 0 ? "+" : r.pct < 0 ? "−" : ""}{Math.abs(r.pct)}%</td>
                  <td className={td}>{fmtNum(r.price, r.price < 10 ? 3 : 2)}</td>
                  <td className={`${td} ${pnlCls(r.today)}`}>{money(r.today)}</td>
                  <td className={`${td} ${pnlCls(r.expiry)}`}>{money(r.expiry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === "strikes" &&
        (compare.length === 0 ? (
          <p className="text-muted">Strike comparison needs real option prices (Today start with a listed chain).</p>
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-0 border-collapse">
              <thead>
                <tr>
                  <th className={`${th} text-left`}>Strike</th>
                  <th className={th}>Premium</th>
                  <th className={th}>Breakeven</th>
                  {p.sold && <th className={th} title="Chance the option expires worthless and you keep it all">Keep all</th>}
                  <th className={th}>{p.sold ? "Any profit" : "Profit"}</th>
                </tr>
              </thead>
              <tbody>
                {compare.map((r) => (
                  <tr key={r.strike} className={`border-t border-line ${r.strike === p.strike ? "font-semibold text-ink" : ""}`}>
                    <td className={`${td} text-left`}>{fmtNum(r.strike, 2)}</td>
                    <td className={td}>{fmtNum(r.premium, r.premium < 1 ? 3 : 2)}</td>
                    <td className={td}>{fmtNum(r.breakeven, 2)}</td>
                    {p.sold && <td className={td}>{pct(r.otm)}</td>}
                    <td className={td}>{pct(r.safe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {tab === "quote" && (
        <div className="min-w-0">
          {closed && <p className="mb-1 rounded border border-line px-2 py-1 font-medium text-muted">Market closed — price may be stale.</p>}
          {p.leg ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {[
                ["Bid / Ask", `${p.leg.bid !== null ? fmtNum(p.leg.bid, 2) : "n/a"} / ${p.leg.ask !== null ? fmtNum(p.leg.ask, 2) : "n/a"}`],
                ["Spread", q.spread !== null ? `${fmtNum(q.spread, 2)} (${pct(q.spreadPct)} of mid)` : "n/a"],
                ["Volume", p.leg.volume != null ? fmtNum(p.leg.volume, 0) : "n/a"],
                ["Open interest", p.leg.openInterest != null ? fmtNum(p.leg.openInterest, 0) : "n/a"],
                ["Last trade", p.leg.lastTradeMs ? new Date(p.leg.lastTradeMs).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "n/a"],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right font-semibold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-muted">No live quote: this price is a Black-Scholes estimate.</p>
          )}
          {q.spreadPct !== null && q.spreadPct > 0.1 && <p className="mt-1 text-loss">Wide spread: you would likely get a worse price than the mid used here.</p>}
        </div>
      )}
    </div>
  );
}
