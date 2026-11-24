"use client";
import { useMemo, useState } from "react";
import signals from "@/data/fund-signals.json";
import trades from "@/data/fund-trades.json";
import { HORIZONS, KIND_LABEL, MIN_N, isSignificant, type Cell, type FundSignalsFile, type FundTradesFile } from "@/lib/fund-signals";
import { fmtNum } from "@/lib/format";
import { input } from "@/components/TradesView";
import { Tabs } from "@/components/ui";

const S = signals as unknown as FundSignalsFile;
const T = trades as unknown as FundTradesFile;
const pct = (n: number | null, d = 1) => (n === null ? "-" : `${n >= 0 ? "+" : ""}${fmtNum(n, d)}%`);
const tone = (n: number | null) => (n === null || n === 0 ? "text-muted" : n > 0 ? "text-gain" : "text-loss");
const th = "px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wide text-muted";
const td = "px-2 py-1 tabular-nums";
const link = "text-accent underline-offset-2 hover:underline";
const usd = (n: number) => (n >= 1e9 ? `$${fmtNum(n / 1e9, 1)}B` : `$${fmtNum(n / 1e6, 0)}M`);
const KINDS_13F = ["new", "increase", "trim", "exit"];
const KINDS_ARK = ["ark-buy", "ark-sell"];
const ARK_IDS = ["ARKK", "ARKW", "ARKG", "ARKQ", "ARKF", "ARKX"];

type View = "study" | "fund" | "rule" | "changes" | "daily";
const VIEWS: { id: View; label: string }[] = [
  { id: "study", label: "Event study" },
  { id: "fund", label: "By fund" },
  { id: "rule", label: "Rule backtest" },
  { id: "changes", label: "Latest 13F" },
  { id: "daily", label: "Daily ARK trades" },
];

function CellTd({ c }: { c: Cell | undefined }) {
  if (!c || !c.n) return <td className={`${td} text-muted`}>-</td>;
  const sig = isSignificant(c);
  return (
    <td
      className={`${td} ${sig ? "bg-accent/15 font-semibold" : ""} ${c.n < MIN_N ? "opacity-60" : ""}`}
      title={`n=${c.n}, hit ${fmtNum(c.hit, 0)}%, t=${fmtNum(c.t, 2)}${sig ? " (passes on its own; see the multiple-testing note)" : ""}`}
    >
      <span className={tone(c.m)}>{pct(c.m, 2)}</span> <span className="text-[10px] font-normal text-muted">t {fmtNum(c.t, 1)} n {c.n}</span>
    </td>
  );
}

function Grid({ rows, label, find }: { rows: { id: string; label: string }[]; label: string; find: (id: string, h: Cell["h"]) => Cell | undefined }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line">
          <th className={th}>{label}</th>
          {HORIZONS.map((h) => (
            <th key={h} className={th}>
              {h} day{h > 1 ? "s" : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-line/50">
            <td className={`${td} whitespace-nowrap`}>{r.label}</td>
            {HORIZONS.map((h) => (
              <CellTd key={h} c={find(r.id, h)} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Curve({ pts }: { pts: { d: string; rule: number; mkt: number }[] }) {
  if (pts.length < 2) return <p className="text-xs text-muted">Not enough trades for a curve.</p>;
  const W = 1000;
  const H = 120;
  const vals = pts.flatMap((p) => [p.rule, p.mkt, 0]);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => (hi === lo ? H / 2 : ((hi - v) / (hi - lo)) * (H - 6) + 3);
  const path = (k: "rule" | "mkt") => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div>
      <div className="mb-0.5 flex flex-wrap gap-3 text-[11px] text-muted">
        <span className="text-gain">Rule ${fmtNum(last.rule, 0)}</span>
        <span>S&amp;P 500 on the same trades ${fmtNum(last.mkt, 0)}</span>
        <span>
          Cumulative profit with $100 into every trade, {pts[0].d} to {last.d}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-28 w-full" role="img" aria-label="Cumulative profit of the rule against the market on the same trades">
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-line" vectorEffect="non-scaling-stroke" />
        <path d={path("mkt")} fill="none" stroke="currentColor" className="text-muted" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={path("rule")} fill="none" stroke="currentColor" className="text-gain" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export default function FundsPanel() {
  const [view, setView] = useState<View>("study");
  const [src, setSrc] = useState<"13f" | "ark">("13f");
  const [kind, setKind] = useState("new");
  const [ruleId, setRuleId] = useState(S.rules[0]?.id ?? "");
  const [fund, setFund] = useState(S.latest[0]?.fund ?? "");
  const [dFund, setDFund] = useState("all");
  const nameOf = useMemo(() => new Map(S.funds.map((f) => [f.id, f.name])), []);
  const cik = useMemo(() => new Map(S.funds.map((f) => [f.id, f.cik])), []);

  if (!S.study.length)
    return (
      <p className="text-sm text-muted">
        No data yet. Run <code>npm run funds:signals</code> to build data/fund-signals.json.
      </p>
    );

  const all = [...S.study, ...S.ark];
  const kinds = src === "13f" ? KINDS_13F : KINDS_ARK;
  const rule = S.rules.find((r) => r.id === ruleId) ?? S.rules[0];
  const lat = S.latest.find((l) => l.fund === fund);
  const dailyFunds = [...new Set(T.trades.map((t) => t.fund))].sort();
  const daily = T.trades.filter((t) => dFund === "all" || t.fund === dFund);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs tabs={VIEWS} value={view} onChange={setView} label="Funds view" />
        <span className="text-[11px] text-muted">
          13F lines matched to tickers: {fmtNum(S.match.pct, 0)}% ({fmtNum(S.match.valuePct, 0)}% of value). Updated {S.updatedAt?.slice(0, 10)}.
        </span>
      </div>

      {view === "study" && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted">
              Source
              <select className={`${input} ml-1 !w-auto`} value={src} onChange={(e) => setSrc(e.target.value as typeof src)}>
                <option value="13f">13F filings, all funds pooled</option>
                <option value="ark">ARK daily trades, all ARK funds pooled</option>
              </select>
            </label>
            <span className="text-xs text-muted">
              Mean excess return vs S&amp;P 500 from the next open, with t-stat and event count. Highlighted: n of {MIN_N}+ and |t| of 2+.
            </span>
          </div>
          <Grid label="Event" rows={kinds.map((k) => ({ id: k, label: KIND_LABEL[k] }))} find={(k, h) => all.find((c) => c.f === "ALL" && c.k === k && c.h === h)} />
          <p className="text-xs text-muted">
            {S.tested.cells} cells tested across all views, {S.tested.testable} with n of {MIN_N}+, {S.tested.flagged} pass |t| of 2+; about {S.tested.expectedByChance} would pass by chance alone. Events cluster on the same filing
            days, so the real evidence is weaker than the t-stats suggest.
          </p>
        </>
      )}

      {view === "fund" && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted">
              Event
              <select className={`${input} ml-1 !w-auto`} value={kind} onChange={(e) => setKind(e.target.value)}>
                {[...KINDS_13F, ...KINDS_ARK].map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xs text-muted">Faded cells have fewer than {MIN_N} events.</span>
          </div>
          <Grid
            label="Fund"
            rows={(kind.startsWith("ark") ? ARK_IDS : S.funds.map((f) => f.id)).map((f) => ({ id: f, label: nameOf.get(f) ?? f }))}
            find={(f, h) => all.find((c) => c.f === f && c.k === kind && c.h === h)}
          />
        </>
      )}

      {view === "rule" && rule && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted">
              Rule
              <select className={`${input} ml-1 !w-auto`} value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
                {S.rules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xs text-muted">{rule.desc}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ["Trades", String(rule.trades), ""],
              ["Avg per trade", pct(rule.stats.avg, 2), tone(rule.stats.avg)],
              ["S&P 500, same days", pct(rule.bench.avg, 2), tone(rule.bench.avg)],
              ["Excess per trade", pct(rule.excess, 2), tone(rule.excess)],
              ["Win rate", `${fmtNum(rule.stats.winRate, 0)}%`, ""],
            ].map(([n, v, c]) => (
              <div key={n} className="rounded-md border border-line px-2.5 py-1">
                <div className="text-[10px] uppercase tracking-wide text-muted">{n}</div>
                <div className={`text-sm font-medium tabular-nums ${c}`}>{v}</div>
              </div>
            ))}
          </div>
          <Curve pts={rule.curve} />
          <p className="text-xs text-muted">Trades overlap in time and the curve adds up equal $100 bets, so it is not a portfolio return. Entry is the open after the filing was public.</p>
        </>
      )}

      {view === "changes" && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted">
              Fund
              <select className={`${input} ml-1 !w-auto`} value={fund} onChange={(e) => setFund(e.target.value)}>
                {S.latest.map((l) => (
                  <option key={l.fund} value={l.fund}>
                    {nameOf.get(l.fund) ?? l.fund}
                  </option>
                ))}
              </select>
            </label>
            {lat && (
              <span className="text-xs text-muted">
                Filed {lat.filed} for the quarter ended {lat.period}.{" "}
                <a className={link} href={lat.url} target="_blank" rel="noreferrer">
                  EDGAR filing
                </a>
                {" · "}
                <a className={link} href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik.get(fund)}&type=13F-HR`} target="_blank" rel="noreferrer">
                  all 13Fs
                </a>
              </span>
            )}
          </div>
          <div className="max-h-[42vh] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-line">
                  <th className={th}>Change</th>
                  <th className={th}>Ticker</th>
                  <th className={th}>Issuer</th>
                  <th className={th}>Shares before</th>
                  <th className={th}>Shares after</th>
                  <th className={th}>Moved</th>
                  <th className={th}>Position</th>
                </tr>
              </thead>
              <tbody>
                {(lat?.changes ?? []).map((c, i) => (
                  <tr key={i} className="border-b border-line/50">
                    <td className={`${td} ${c.type === "new" || c.type === "increase" ? "text-gain" : "text-loss"}`}>{KIND_LABEL[c.type]}</td>
                    <td className={td}>{c.sym ?? "-"}</td>
                    <td className="px-2 py-1 text-xs text-muted">{c.name}</td>
                    <td className={td}>{fmtNum(c.prev, 0)}</td>
                    <td className={td}>{fmtNum(c.cur, 0)}</td>
                    <td className={`${td} ${tone(c.pct)}`}>{c.pct === null ? (c.type === "new" ? "new" : "exit") : pct(c.pct, 0)}</td>
                    <td className={td}>{usd(c.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "daily" && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted">
              Fund
              <select className={`${input} ml-1 !w-auto`} value={dFund} onChange={(e) => setDFund(e.target.value)}>
                <option value="all">All</option>
                {dailyFunds.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <span className="text-xs text-muted">
              From ARK&apos;s own daily holdings files, diffed day to day:{" "}
              {Object.entries(T.funds).map(([f, v], i) => (
                <span key={f}>
                  {i ? ", " : ""}
                  <a className={link} href={v.url} target="_blank" rel="noreferrer">
                    {f} {v.asOf}
                  </a>
                </span>
              ))}
              . Rows marked * are history back-filled from the arkfunds.io mirror (buy or sell, no add/trim split).
            </span>
          </div>
          <div className="max-h-[42vh] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-line">
                  <th className={th}>Date</th>
                  <th className={th}>Fund</th>
                  <th className={th}>Ticker</th>
                  <th className={th}>Action</th>
                  <th className={th}>Shares</th>
                  <th className={th}>Moved</th>
                  <th className={th}>Weight</th>
                </tr>
              </thead>
              <tbody>
                {daily.slice(0, 400).map((t, i) => (
                  <tr key={i} className="border-b border-line/50">
                    <td className={`${td} whitespace-nowrap`}>{t.date}</td>
                    <td className={td}>{t.fund}</td>
                    <td className={td}>{t.sym}</td>
                    <td className={`${td} capitalize ${t.action === "buy" || t.action === "add" ? "text-gain" : "text-loss"}`}>
                      {t.action}
                      {t.src ? <span className="text-[10px] text-muted"> *</span> : null}
                    </td>
                    <td className={td}>{fmtNum(t.shares, 0)}</td>
                    <td className={`${td} ${tone(t.pct)}`}>{t.pct === null ? "-" : pct(t.pct, 1)}</td>
                    <td className={td}>{fmtNum(t.weight, 2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-[11px] leading-snug text-muted">
        13F filings arrive up to 45 days after quarter end, so these are old positions by the time they are public; every 13F event here is dated at the filing date, not the quarter end. ARK discloses its trades daily. Past results do
        not predict future returns. Sources:{" "}
        {S.sources.map((s, i) => (
          <span key={s.url}>
            {i ? " · " : ""}
            <a className={link} href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          </span>
        ))}
        .
      </p>
    </div>
  );
}
