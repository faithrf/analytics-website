"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtNum } from "@/lib/format";
import {
  ASX_20,
  ASX_50,
  BASE_HYPOTHESES,
  HYPOTHESES,
  isOptionInstrument,
  liveSignals,
  MAX_TICKERS,
  runModel,
  US_LIQUID,
  US_MEGA,
  type EntryAt,
  type EventKind,
  type EventRule,
  type Instrument,
  type MBar,
  type Summary,
  type TradeSpec,
} from "@/lib/model";
import {
  STRATEGY_FAMILY_OF,
  STRATEGY_RULES,
  STRATEGY_STUDY,
  type StrategyFamily,
  type StrategyVerdict,
} from "@/lib/strategy-rules";
import { displayCode, idPath, isValidId, toYahoo } from "@/lib/symbols";
import { DAY_MS } from "@/lib/trades";
import {
  TRAIN_MS,
  tuneFamily,
  WINDOW_MS,
  type Candidate,
  type TuneResult,
  type TuneStats,
} from "@/lib/model-tune";
import {
  MOMENTUM_RULES,
  MOMENTUM_STUDY,
  type RuleVerdict,
} from "@/lib/momentum-rules";
import { type Accuracy } from "@/lib/stats";
import paperData from "@/data/paper-momentum.json";
import type { PaperLedger } from "@/lib/paper-momentum";
import { Panel, Tabs } from "@/components/ui";
import { fmtDay, input, label, Seg } from "@/components/TradesView";

const MAX_HISTORY_MS = 3650 * DAY_MS - DAY_MS;
const WARMUP_MS = 100 * DAY_MS; // earlier bars for the volume average and option volatility
const CONCURRENCY = 4;
const YEARS = [1, 3, 5, 10] as const;
const TRAIN_SHARE = 0.7; // first 70% of the period trains, last 30% is out-of-sample
type Sample = "all" | "train" | "test";
const SAMPLES: { v: Sample; l: string }[] = [
  { v: "all", l: "All" },
  { v: "train", l: "Train (first 70%)" },
  { v: "test", l: "Test (last 30%)" },
];
const REGIMES: { v: "" | "bull" | "bear"; l: string }[] = [
  { v: "", l: "Any" },
  { v: "bull", l: "Index up-trend" },
  { v: "bear", l: "Index down-trend" },
];
const CONFIRMS: { v: "" | "fade" | "follow"; l: string }[] = [
  { v: "", l: "Any" },
  { v: "fade", l: "Closed against" },
  { v: "follow", l: "Closed with" },
];
/** Index used for the abnormal-move and regime filters: US ids -> S&P 500, bare ASX codes -> ASX 200, others none. */
const INDEX_SYMBOL = (id: string): string | null =>
  id.endsWith(".US") ? "^GSPC" : !id.includes(".") ? "^AXJO" : null;

const UNIVERSES = {
  usliq: { l: "US liquid (~125)", ids: US_LIQUID.map((c) => `${c}.US`) },
  us: { l: "US mega-caps (20)", ids: US_MEGA.map((c) => `${c}.US`) },
  asx50: { l: "ASX 50", ids: ASX_50 },
  asx: { l: "ASX 20", ids: ASX_20 },
  custom: { l: "Custom list", ids: [] as string[] },
} as const;
type UniverseId = keyof typeof UNIVERSES;

const KINDS: { v: EventKind; l: string }[] = [
  { v: "gap-up", l: "Gap up" },
  { v: "gap-down", l: "Gap down" },
  { v: "day-up", l: "Day up" },
  { v: "day-down", l: "Day down" },
  { v: "earn-up", l: "Earnings up*" },
  { v: "earn-down", l: "Earnings down*" },
];
const INSTRUMENTS: { v: Instrument; l: string }[] = [
  { v: "short", l: "Short stock" },
  { v: "long", l: "Long stock" },
  { v: "put", l: "Buy put" },
  { v: "call", l: "Buy call" },
  { v: "covered-call", l: "Covered call" },
  { v: "cash-put", l: "Cash put" },
];
const ENTRIES: { v: EntryAt; l: string }[] = [
  { v: "close", l: "Event close" },
  { v: "next-open", l: "Next open" },
];
const REASON = { hold: "Held", stop: "Stop", target: "Target" } as const;

type TabId =
  "summary" | "split" | "tune" | "rules" | "paper" | "events" | "ticker" | "live";
const TABS: { id: TabId; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "split", label: "Train vs test" },
  { id: "tune", label: "Auto-tune" },
  { id: "rules", label: "Rules" },
  { id: "paper", label: "Paper" },
  { id: "events", label: "Events" },
  { id: "ticker", label: "By ticker" },
  { id: "live", label: "Live signals" },
];

const pct = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${fmtNum(n, d)}%`;
const tone = (n: number) =>
  n > 0 ? "text-gain" : n < 0 ? "text-loss" : "text-muted";
const signedOrUndef = (s: string) =>
  s.trim() === "" || !Number.isFinite(Number(s)) ? undefined : Number(s);
const numOrUndef = (s: string) =>
  s.trim() === "" || !Number.isFinite(Number(s)) || Number(s) <= 0
    ? undefined
    : Number(s);

function parseCustom(text: string): { ids: string[]; bad: string[] } {
  const ids: string[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const id = raw.trim().toUpperCase();
    if (!id) continue;
    if (!isValidId(id)) bad.push(id);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, bad };
}

function ruleExtras(r: EventRule) {
  return {
    minAbn: String(r.minAbnormalPct ?? ""),
    maxAbn: String(r.maxAbnormalPct ?? ""),
    minRun: String(r.minRunUpPct ?? ""),
    maxRun: String(r.maxRunUpPct ?? ""),
    regime: (r.regime ?? "") as "" | "bull" | "bear",
    confirm: (r.confirm ?? "") as "" | "fade" | "follow",
  };
}

function Fig({
  name,
  children,
  hint,
}: {
  name: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-md bg-panel2 px-2.5 py-1.5" title={hint}>
      <div className="text-[11px] text-muted">{name}</div>
      <div className="text-sm font-semibold tabular-nums">{children}</div>
    </div>
  );
}

function Num({
  name,
  value,
  onChange,
  placeholder,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label>
      <span className={label}>{name}</span>
      <input
        className={input}
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Curve({ points }: { points: { t: number; pl: number }[] }) {
  const W = 1000;
  const H = 150;
  if (points.length < 2)
    return <p className="text-xs text-muted">Not enough trades for a curve.</p>;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const hi = Math.max(0, ...points.map((p) => p.pl));
  const lo = Math.min(0, ...points.map((p) => p.pl));
  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W);
  const y = (v: number) =>
    hi === lo ? H / 2 : ((hi - v) / (hi - lo)) * (H - 6) + 3;
  return (
    <div>
      <div className="flex gap-1.5">
        <div className="flex w-14 shrink-0 flex-col justify-between text-right text-[10px] text-muted tabular-nums">
          <span>${fmtNum(hi, 0)}</span>
          <span>${fmtNum(lo, 0)}</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-36 min-w-0 flex-1"
          role="img"
          aria-label="Cumulative profit if $100 went into every trade"
        >
          <line
            x1={0}
            x2={W}
            y1={y(0)}
            y2={y(0)}
            className="stroke-line"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={points
              .map((p) => `${x(p.t).toFixed(1)},${y(p.pl).toFixed(1)}`)
              .join(" ")}
            fill="none"
            className="stroke-accent"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="flex justify-between pl-[3.9rem] text-[10px] text-muted">
        <span>{fmtDay(t0)}</span>
        <span>Cumulative profit, $100 in every trade</span>
        <span>{fmtDay(t1)}</span>
      </div>
    </div>
  );
}

function StatRow({ s }: { s: Summary }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      <Fig name="Events">{s.count}</Fig>
      <Fig name="Win rate">{fmtNum(s.winRate, 0)}%</Fig>
      <Fig name="Average">
        <span className={tone(s.avg)}>{pct(s.avg)}</span>
      </Fig>
      <Fig name="Median">
        <span className={tone(s.median)}>{pct(s.median)}</span>
      </Fig>
      <Fig name="Best">
        <span className="text-gain">{pct(s.best)}</span>
      </Fig>
      <Fig name="Worst">
        <span className="text-loss">{pct(s.worst)}</span>
      </Fig>
      <Fig
        name="Compounded"
        hint="Every trade's return multiplied together, as if all were taken one after another. Overlapping trades make this unrealistic; use it to compare settings."
      >
        <span className={tone(s.compounded)}>{pct(s.compounded, 0)}</span>
      </Fig>
    </div>
  );
}

const hitText = (a: Accuracy) =>
  a.n
    ? `${fmtNum(a.hit, 0)}% (${fmtNum(a.hitLo, 0)}-${fmtNum(a.hitHi, 0)})`
    : "-";
const pText = (p: number) => (p < 0.001 ? "<0.001" : p.toFixed(3));

/** Accuracy of the current run: hit rate with its 95% interval, and whether the edge over the baseline is statistically real. */
function AccuracyRow({ a }: { a: Accuracy }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <Fig
        name="Hit rate (95% CI)"
        hint="Share of trades that made money, with a Wilson 95% confidence interval. If the interval includes 50% the hit rate says little."
      >
        {hitText(a)}
      </Fig>
      <Fig
        name="t-stat vs baseline"
        hint="Event average minus baseline average, in standard errors. Beyond about 2 is notable, but see the p-value and the out-of-sample test."
      >
        <span className={tone(a.t)}>{fmtNum(a.t, 1)}</span>
      </Fig>
      <Fig
        name="p-value vs baseline"
        hint="Bootstrap, two-sided. How often chance alone would give an average this far from the baseline. Trying many settings makes small p-values easy to find by luck."
      >
        <span className={a.p < 0.05 ? "text-ink" : "text-muted"}>
          {pText(a.p)}
        </span>
      </Fig>
      <Fig
        name="Profit factor"
        hint="Total gains divided by total losses. Above 1 is profitable."
      >
        {Number.isFinite(a.pf) ? fmtNum(a.pf, 2) : "n/a"}
      </Fig>
      <Fig
        name="Max drawdown"
        hint="Largest fall of the running total of trade returns, in percentage points, trades in exit order."
      >
        {fmtNum(a.maxDD, 0)} pts
      </Fig>
    </div>
  );
}

const VERDICT: Record<RuleVerdict, { l: string; c: string }> = {
  matters: { l: "Matters", c: "text-gain" },
  small: { l: "Small", c: "text-ink" },
  none: { l: "No effect", c: "text-muted" },
  hurts: { l: "Hurts", c: "text-loss" },
};

const VERDICT_STUDY: Record<StrategyVerdict, { l: string; c: string }> = {
  confirmed: { l: "Confirmed", c: "text-gain" },
  unproven: { l: "Unproven", c: "text-ink" },
  dead: { l: "Dead", c: "text-loss" },
};

/** Rule card for the earnings-drift and sold-option families (scripts/strategy-study.ts). */
function StrategyCard({
  preset,
  family,
}: {
  preset: string;
  family: StrategyFamily;
}) {
  const st = STRATEGY_STUDY[preset];
  const h = st.holdout;
  return (
    <div className="space-y-2">
      <p className="rounded-md border border-line px-3 py-2 text-sm">
        <strong>
          {st.label}: {st.rule}.
        </strong>{" "}
        Train (3 years) {st.train.n} trades, edge {pct(st.train.edge, 1)},
        clustered t {fmtNum(st.train.tClustered, 1)}. Out of sample (12 months){" "}
        {st.oos.n} trades, hit {st.oos.hit}% ({st.oos.hitLo}-{st.oos.hitHi}),
        average {pct(st.oos.mean, 1)}, edge {pct(st.oos.edge, 1)}, clustered t{" "}
        {fmtNum(st.oos.tClustered, 1)}.{" "}
        <span className="text-loss">
          Untouched holdout {h.from} to {h.to}: {h.n} trades, hit {h.hit}% (
          {h.hitLo}-{h.hitHi}), average {pct(h.mean, 1)}, edge {pct(h.edge, 1)}.
        </span>{" "}
        <strong className={VERDICT_STUDY[st.verdict].c}>
          {VERDICT_STUDY[st.verdict].l}.
        </strong>{" "}
        {st.note} {st.cellsTried} cells were tried, so the best one flatters.
      </p>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Rule", "Setting", "Effect", "Why"].map((x) => (
                <th key={x} className={th}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STRATEGY_RULES[family].map((r) => (
              <tr key={r.rule} className="border-b border-line/60 align-top">
                <td className={`${td} font-medium`}>{r.rule}</td>
                <td className={td}>{r.setting}</td>
                <td className={`${td} font-medium ${VERDICT[r.verdict].c}`}>
                  {VERDICT[r.verdict].l}
                </td>
                <td className={`${td} text-xs text-muted`}>{r.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-snug text-muted">
        Edge = percentage points above the same trade on ordinary days in the
        same month and market regime. Clustered t = t-test over monthly means.
        Costs included (stock 10 bps; sold options give up 10% of the premium).
        Option prices are Black-Scholes estimates. Full write-up:
        docs/model-research.md.
      </p>
    </div>
  );
}

/** The momentum study's rule card: each rule, the setting, and why. Shown for the momentum preset only. */
function RulesPanel({ preset }: { preset: string }) {
  const fam = STRATEGY_FAMILY_OF[preset];
  if (fam) return <StrategyCard preset={preset} family={fam} />;
  if (preset !== "momentum")
    return (
      <p className="text-sm text-muted">
        Rule cards cover the momentum, earnings-drift, covered-call and
        cash-put presets. Pick one on the left.
      </p>
    );
  const h = MOMENTUM_STUDY.holdout;
  return (
    <div className="space-y-2">
      <p className="rounded-md border border-line px-3 py-2 text-sm">
        <strong>{MOMENTUM_STUDY.rule}.</strong> 10 years, 198 large caps:{" "}
        {MOMENTUM_STUDY.dev.n} trades, hit {MOMENTUM_STUDY.dev.hit}% (
        {MOMENTUM_STUDY.dev.hitLo}-{MOMENTUM_STUDY.dev.hitHi}), edge{" "}
        {pct(MOMENTUM_STUDY.dev.edge, 1)}
        (without 2020: {pct(MOMENTUM_STUDY.exTwentyTwenty.edge, 1)}).{" "}
        <span className="text-loss">
          Untouched holdout {h.from} to {h.to}: {h.n} trades, hit {h.hit}% (
          {h.hitLo}-{h.hitHi}), average {pct(h.mean, 1)}.
        </span>{" "}
        {MOMENTUM_STUDY.verdict}
      </p>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Rule", "Setting", "Effect", "Why"].map((x) => (
                <th key={x} className={th}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOMENTUM_RULES.map((r) => (
              <tr key={r.rule} className="border-b border-line/60 align-top">
                <td className={`${td} font-medium`}>{r.rule}</td>
                <td className={td}>{r.setting}</td>
                <td className={`${td} font-medium ${VERDICT[r.verdict].c}`}>
                  {VERDICT[r.verdict].l}
                </td>
                <td className={`${td} text-xs text-muted`}>{r.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-snug text-muted">
        Edge = percentage points above the same trade on ordinary days. Full
        evidence and caveats: docs/momentum-rules.md.
      </p>
    </div>
  );
}

const PAPER_DATA = paperData as unknown as PaperLedger & { updatedAt: string };

function PaperCurve({ pts }: { pts: PaperLedger["curve"] }) {
  const W = 1000;
  const H = 110;
  if (pts.length < 2) return null;
  const vals = pts.flatMap((p) => [p.port, p.spx]);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) =>
    hi === lo ? H / 2 : ((hi - v) / (hi - lo)) * (H - 6) + 3;
  const line = (k: "port" | "spx") =>
    pts
      .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`)
      .join(" ");
  return (
    <div>
      <div className="mb-0.5 flex gap-3 text-[11px] text-muted">
        <span>Paper portfolio {fmtNum(pts[pts.length - 1].port, 1)}</span>
        <span>S&amp;P 500 {fmtNum(pts[pts.length - 1].spx, 1)}</span>
        <span>(100 = {PAPER_DATA.start})</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        role="img"
        aria-label="Paper portfolio against S&P 500"
      >
        <path d={line("spx")} fill="none" stroke="currentColor" className="text-muted" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={line("port")} fill="none" stroke="currentColor" className="text-gain" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function PaperPanel() {
  const L = PAPER_DATA;
  const s = L.summary;
  const startNice = "9 Nov 2026";
  const stat = (name: string, v: string, cls = "") => (
    <div className="rounded-md border border-line px-2.5 py-1">
      <div className="text-[10px] uppercase tracking-wide text-muted">{name}</div>
      <div className={`text-sm font-medium tabular-nums ${cls}`}>{v}</div>
    </div>
  );
  const none = s.open + s.closed === 0;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Forward paper test since {startNice}: day up 8%+, buy next open, sell
        the close of day 20, max 10 positions, 10 bps cost. Bars to{" "}
        {L.asOf ?? "-"}; updated {L.updatedAt?.slice(0, 16).replace("T", " ")}{" "}
        UTC (weekly, Saturdays).
      </p>
      <div className="flex flex-wrap gap-2">
        {stat("Closed", String(s.closed))}
        {stat("Open", `${s.open} / 10`)}
        {stat("Hit rate", s.hit === null ? "-" : `${fmtNum(s.hit, 0)}%`)}
        {stat("Mean return", s.mean === null ? "-" : pct(s.mean, 2), s.mean === null ? "" : tone(s.mean))}
        {stat("Baseline", s.baseline === null ? "-" : pct(s.baseline, 2))}
        {stat("Edge", s.edge === null ? "-" : pct(s.edge, 2), s.edge === null ? "" : tone(s.edge))}
        {stat("Skipped (full)", String(s.skipped))}
        {stat("Pending entry", String(s.pending))}
      </div>
      {none ? (
        <p className="rounded-md border border-line px-3 py-2 text-sm text-muted">
          No signals yet since {startNice}.
          {s.pending > 0
            ? ` ${s.pending} signal(s) wait for the next open.`
            : ""}
        </p>
      ) : (
        <>
          <PaperCurve pts={L.curve} />
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="overflow-auto">
              <h4 className="text-xs font-medium text-muted">Open positions</h4>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line">
                    {["Stock", "Entered", "Entry", "Days", "Now", "Unrealised"].map((x) => (
                      <th key={x} className={th}>
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {L.open.map((t) => (
                    <tr key={t.sym + t.entryDate} className="border-b border-line/60">
                      <td className={`${td} font-medium`}>{displayCode(t.sym)}</td>
                      <td className={td}>{t.entryDate}</td>
                      <td className={td}>{fmtNum(t.entry, 2)}</td>
                      <td className={td}>{t.days}/20</td>
                      <td className={td}>{fmtNum(t.last, 2)}</td>
                      <td className={`${td} ${tone(t.ret)}`}>{pct(t.ret, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-auto">
              <h4 className="text-xs font-medium text-muted">Closed trades</h4>
              {L.closed.length === 0 ? (
                <p className="text-sm text-muted">
                  None closed yet. The first can close 20 trading days after
                  entry.
                </p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      {["Stock", "Entered", "Exited", "Return", "Edge"].map((x) => (
                        <th key={x} className={th}>
                          {x}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {L.closed.map((t) => (
                      <tr key={t.sym + t.entryDate} className="border-b border-line/60">
                        <td className={`${td} font-medium`}>{displayCode(t.sym)}</td>
                        <td className={td}>{t.entryDate}</td>
                        <td className={td}>{t.exitDate}</td>
                        <td className={`${td} ${tone(t.ret)}`}>{pct(t.ret, 1)}</td>
                        <td className={`${td} ${t.edge === undefined ? "" : tone(t.edge)}`}>
                          {t.edge === undefined ? "-" : pct(t.edge, 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TunePanel({
  res,
  running,
}: {
  res: TuneResult | null;
  running: boolean;
}) {
  if (!res)
    return (
      <p className="text-sm text-muted">
        {running
          ? "Tuning…"
          : "Press Auto-tune this preset (left). Load the 5Y period first. It tries a few hundred settings, tuning on the 3 years before each month and scoring only the last 12 months."}
      </p>
    );
  const rows: { name: string; note: string; s: TuneStats | null }[] = [
    {
      name: "Tuned (walk-forward)",
      note: "each month traded with the setting that scored best on earlier months",
      s: res.oos,
    },
    {
      name: "Default (same months)",
      note: "the preset as it was",
      s: res.defaultOos,
    },
    {
      name: "Best setting, in-sample",
      note: "chosen looking at the whole year: flattering, not accuracy",
      s: res.inSample,
    },
  ];
  return (
    <div className="space-y-2">
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              {[
                "Result",
                "Trades",
                "Hit rate (95% CI)",
                "Average",
                "Edge",
                "t",
                "p",
              ].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ name, note, s }) => (
              <tr key={name} className="border-b border-line/60">
                <td className={td}>
                  <div className="font-medium">{name}</div>
                  <div className="text-[11px] text-muted">{note}</div>
                </td>
                {s && s.n > 0 ? (
                  <>
                    <td className={td}>{s.n}</td>
                    <td className={td}>{hitText(s)}</td>
                    <td className={`${td} ${tone(s.mean)}`}>{pct(s.mean)}</td>
                    <td className={`${td} font-medium ${tone(s.edge)}`}>
                      {pct(s.edge, 2)}
                    </td>
                    <td className={td}>{fmtNum(s.t, 1)}</td>
                    <td className={td}>{pText(s.p)}</td>
                  </>
                ) : (
                  <td className={`${td} text-muted`} colSpan={6}>
                    No trades
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        className={`rounded-md border px-3 py-2 text-sm ${res.promoted ? "border-accent" : "border-line"}`}
      >
        {res.promoted
          ? "Applied the tuned setting. "
          : "Kept the default setting. "}
        {res.reason}
      </p>
      <p className="text-[11px] leading-snug text-muted">
        Tried {res.tested} settings; {res.foldsTraded} of {res.folds} test
        months had a trade. Twelve months is a small sample: read the interval,
        not the average. Many settings were tried, so a lucky one is likely to
        exist; only the Tuned row (never tuned on the months it trades) is
        accuracy.
      </p>
    </div>
  );
}

interface SplitRun {
  stats: Accuracy;
  edge: number;
  baseline: Summary;
}

/** Same settings, scored on the first 70% of the period and on the last 30% they were never tuned on. */
function SplitTable({
  train,
  test,
  splitMs,
  fromMs,
}: {
  train: SplitRun;
  test: SplitRun;
  splitMs: number;
  fromMs: number;
}) {
  const rows = [
    {
      name: "Train",
      span: `${fmtDay(fromMs)} to ${fmtDay(splitMs)}`,
      r: train,
    },
    {
      name: "Test (out of sample)",
      span: `${fmtDay(splitMs)} to now`,
      r: test,
    },
  ];
  const holds = test.stats.n >= 15 && test.edge > 0 && test.stats.p < 0.05;
  const verdict =
    test.stats.n < 15
      ? "Too few test trades (under 15) to say anything."
      : holds
        ? train.edge > 0
          ? "The edge held out of sample. Still one test: treat it as a lead, not proof."
          : "Edge is positive and significant in the test period, but it was not there in training."
        : train.edge > 0 && train.stats.p < 0.05
          ? "In-sample edge did not hold up out of sample. That is what overfitting looks like."
          : "No reliable edge in either period.";
  return (
    <div className="space-y-2">
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              {[
                "Period",
                "Trades",
                "Hit rate (95% CI)",
                "Average",
                "Baseline",
                "Edge",
                "t",
                "p",
                "Profit factor",
                "Max DD",
              ].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ name, span, r }) => (
              <tr key={name} className="border-b border-line/60">
                <td className={td}>
                  <div className="font-medium">{name}</div>
                  <div className="text-[11px] text-muted">{span}</div>
                </td>
                <td className={td}>{r.stats.n}</td>
                <td className={td}>{hitText(r.stats)}</td>
                <td className={`${td} ${tone(r.stats.mean)}`}>
                  {pct(r.stats.mean)}
                </td>
                <td className={`${td} ${tone(r.baseline.avg)}`}>
                  {pct(r.baseline.avg)}
                </td>
                <td className={`${td} font-medium ${tone(r.edge)}`}>
                  {pct(r.edge, 2)}
                </td>
                <td className={td}>{fmtNum(r.stats.t, 1)}</td>
                <td className={td}>{pText(r.stats.p)}</td>
                <td className={td}>
                  {Number.isFinite(r.stats.pf) ? fmtNum(r.stats.pf, 2) : "n/a"}
                </td>
                <td className={td}>{fmtNum(r.stats.maxDD, 0)} pts</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rounded-md border border-line px-3 py-2 text-sm">
        {verdict}
      </p>
      <p className="text-[11px] leading-snug text-muted">
        Settings that look good in the Train row were picked by looking at it,
        so only the Test row counts as accuracy. Today&apos;s large caps only
        (survivorship bias flatters long trades). Option prices are estimates;
        no fees or borrow cost.
      </p>
    </div>
  );
}

type SortKey =
  | "ticker"
  | "t"
  | "move"
  | "vol"
  | "abn"
  | "runUp"
  | "entry"
  | "exit"
  | "ret"
  | "reason";

const th = "px-2 py-1 text-left text-xs font-medium text-muted";
const td = "px-2 py-1 tabular-nums";

function StockLink({ id }: { id: string }) {
  return (
    <Link
      href={`/stock/${idPath(id)}`}
      className="font-medium text-accent hover:underline"
    >
      {displayCode(id)}
    </Link>
  );
}

export function ModelView() {
  const [hypo, setHypo] = useState(HYPOTHESES[0].id);
  const [rule, setRule] = useState({
    kind: HYPOTHESES[0].rule.kind as EventKind,
    minPct: String(HYPOTHESES[0].rule.minPct),
    volMult: String(HYPOTHESES[0].rule.volMult ?? ""),
    minGap: String(HYPOTHESES[0].rule.minGapDays),
    ...ruleExtras(HYPOTHESES[0].rule),
  });
  const s0 = HYPOTHESES[0].spec;
  const [instrument, setInstrument] = useState<Instrument>(s0.instrument);
  const [entry, setEntry] = useState<EntryAt>(s0.entry);
  const [hold, setHold] = useState(String(s0.holdDays));
  const [stop, setStop] = useState(String(s0.stopPct ?? ""));
  const [target, setTarget] = useState(String(s0.targetPct ?? ""));
  const [otm, setOtm] = useState(String(s0.otmPct));
  const [dte, setDte] = useState(String(s0.dte));
  const [iv, setIv] = useState(String(s0.ivBump));

  const [universe, setUniverse] = useState<UniverseId>("usliq");
  const [custom, setCustom] = useState("");
  const [years, setYears] = useState<(typeof YEARS)[number]>(1);

  const [data, setData] = useState<Record<string, MBar[]> | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [indexes, setIndexes] = useState<Record<string, MBar[]>>({});
  const [sample, setSample] = useState<Sample>("all");
  const [fromMs, setFromMs] = useState(0); // start of the analysed period, fixed when the data loaded
  const [endMs, setEndMs] = useState(0);
  const [failed, setFailed] = useState<{ id: string; msg: string }[]>([]);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [tab, setTab] = useState<TabId>("summary");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "t",
    dir: -1,
  });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const parsed = useMemo(
    () =>
      universe === "custom"
        ? parseCustom(custom)
        : { ids: [...UNIVERSES[universe].ids], bad: [] as string[] },
    [universe, custom],
  );
  const ids = parsed.ids.slice(0, MAX_TICKERS);
  const key = `${ids.join(",")}|${years}`;
  const stale = data !== null && key !== loadedKey;

  const applyCand = (c: Candidate) => {
    setRule({
      kind: c.rule.kind,
      minPct: String(c.rule.minPct),
      volMult: String(c.rule.volMult ?? ""),
      minGap: String(c.rule.minGapDays),
      ...ruleExtras(c.rule),
    });
    setInstrument(c.spec.instrument);
    setEntry(c.spec.entry);
    setHold(String(c.spec.holdDays));
    setStop(String(c.spec.stopPct ?? ""));
    setTarget(String(c.spec.targetPct ?? ""));
    setOtm(String(c.spec.otmPct));
    setDte(String(c.spec.dte));
    setIv(String(c.spec.ivBump));
  };
  const pickHypo = (id: string) => {
    const h = HYPOTHESES.find((x) => x.id === id);
    if (!h) return;
    setHypo(id);
    setTuneRes(null);
    applyCand(h);
  };

  const canTune = data !== null && endMs - fromMs >= 4 * 365 * DAY_MS;
  const [tuneRes, setTuneRes] = useState<TuneResult | null>(null);
  const [tuning, setTuning] = useState<{ done: number; total: number } | null>(
    null,
  );
  async function autoTune() {
    if (!data || tuning) return;
    const fam = BASE_HYPOTHESES.find((x) => x.id === hypo);
    if (!fam) return;
    setTuning({ done: 0, total: 1 });
    try {
      const res = await tuneFamily(
        fam,
        data,
        indexFor,
        { startMs: Math.max(fromMs, endMs - WINDOW_MS - TRAIN_MS), endMs },
        {
          candidates: 150,
          tick: async (done, total) => {
            setTuning({ done, total });
            await new Promise((r) => setTimeout(r, 0));
          },
        },
      );
      setTuneRes(res);
      applyCand(res.promoted && res.best ? res.best : res.default);
      setTab("tune");
    } finally {
      setTuning(null);
    }
  }

  async function load() {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const list = [...ids];
    const from = Math.max(
      Date.now() - years * 365 * DAY_MS - WARMUP_MS,
      Date.now() - MAX_HISTORY_MS,
    );
    const out: Record<string, MBar[]> = {};
    const bad: { id: string; msg: string }[] = [];
    let done = 0;
    let next = 0;
    setProgress({ done: 0, total: list.length });
    setFailed([]);
    const worker = async () => {
      while (next < list.length && !ctrl.signal.aborted) {
        const id = list[next++];
        try {
          const res = await fetch(
            `/api/history?symbol=${encodeURIComponent(toYahoo(id))}&from=${Math.floor(from)}`,
            { signal: ctrl.signal },
          );
          const body = (await res.json().catch(() => null)) as {
            bars?: MBar[];
            message?: string;
          } | null;
          if (!res.ok || !body?.bars?.length)
            throw new Error(body?.message ?? "No price history.");
          out[id] = body.bars;
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          bad.push({ id, msg: (e as Error).message });
        }
        setProgress({ done: ++done, total: list.length });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker),
    );
    if (ctrl.signal.aborted) return;
    // index bars for the abnormal-move and regime filters; the 200-day average needs a year of warm-up
    const idxOut: Record<string, MBar[]> = {};
    const idxFrom = Math.max(from - 300 * DAY_MS, Date.now() - MAX_HISTORY_MS);
    for (const sym of new Set(
      list.map(INDEX_SYMBOL).filter((x): x is string => x !== null),
    )) {
      try {
        const res = await fetch(
          `/api/history?symbol=${encodeURIComponent(sym)}&from=${Math.floor(idxFrom)}`,
          { signal: ctrl.signal },
        );
        const body = (await res.json().catch(() => null)) as {
          bars?: MBar[];
        } | null;
        if (res.ok && body?.bars?.length) idxOut[sym] = body.bars;
        else
          bad.push({
            id: sym,
            msg: "index unavailable, so the abnormal-move and regime filters drop its stocks",
          });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        bad.push({ id: sym, msg: "index unavailable" });
      }
    }
    if (ctrl.signal.aborted) return;
    setIndexes(idxOut);
    setEndMs(Date.now());
    setData(out);
    setLoadedKey(key);
    setFromMs(Date.now() - years * 365 * DAY_MS);
    setFailed(bad);
    setProgress(null);
  }

  const ruleObj = useMemo((): EventRule | string => {
    const m = Number(rule.minPct);
    if (!(m > 0 && m <= 100)) return "Move must be between 0 and 100%.";
    const g = Math.round(Number(rule.minGap));
    return {
      kind: rule.kind,
      minPct: m,
      volMult: numOrUndef(rule.volMult),
      minGapDays: Number.isFinite(g) && g >= 1 ? g : 1,
      minAbnormalPct: signedOrUndef(rule.minAbn),
      maxAbnormalPct: signedOrUndef(rule.maxAbn),
      minRunUpPct: signedOrUndef(rule.minRun),
      maxRunUpPct: signedOrUndef(rule.maxRun),
      regime: rule.regime || undefined,
      confirm: rule.confirm || undefined,
    };
  }, [rule]);
  const specObj = useMemo((): TradeSpec | string => {
    const h = Math.round(Number(hold));
    if (!(h >= 1 && h <= 250)) return "Hold for 1 to 250 trading days.";
    const o = Number(otm);
    const d = Number(dte);
    const b = Number(iv);
    if (!(o >= 0 && o <= 50)) return "Strike OTM must be 0 to 50%.";
    if (!(d >= 1 && d <= 730)) return "Days to expiry must be 1 to 730.";
    if (!(b >= 0.3 && b <= 5)) return "IV bump must be 0.3 to 5.";
    return {
      instrument,
      entry,
      holdDays: h,
      stopPct: numOrUndef(stop),
      targetPct: numOrUndef(target),
      otmPct: o,
      dte: d,
      ivBump: b,
    };
  }, [instrument, entry, hold, stop, target, otm, dte, iv]);

  const err =
    typeof ruleObj === "string"
      ? ruleObj
      : typeof specObj === "string"
        ? specObj
        : null;
  const indexFor = useCallback(
    (id: string) => {
      const sym = INDEX_SYMBOL(id);
      return sym ? indexes[sym] : undefined;
    },
    [indexes],
  );
  const splitMs = fromMs + (endMs - fromMs) * TRAIN_SHARE;
  const runs = useMemo(() => {
    if (!data || err) return null;
    const r = ruleObj as EventRule;
    const sp = specObj as TradeSpec;
    return {
      all: runModel(data, r, sp, fromMs, { indexFor }),
      train: runModel(data, r, sp, fromMs, { indexFor, toMs: splitMs }),
      test: runModel(data, r, sp, splitMs, { indexFor }),
    };
  }, [data, err, ruleObj, specObj, fromMs, splitMs, indexFor]);
  const result = runs ? runs[sample] : null;
  const signals = useMemo(
    () =>
      data && !err ? liveSignals(data, ruleObj as EventRule, indexFor) : [],
    [data, err, ruleObj, indexFor],
  );

  const rows = useMemo(() => {
    if (!result) return [];
    const val = (e: (typeof result.events)[number]): number | string =>
      sort.key === "ticker"
        ? e.ticker
        : sort.key === "reason"
          ? e.reason
          : sort.key === "t"
            ? e.t
            : sort.key === "vol"
              ? (e.vol ?? -1)
              : sort.key === "abn"
                ? (e.abn ?? -999)
                : sort.key === "runUp"
                  ? (e.runUp ?? -999)
                  : e[sort.key];
    return [...result.events].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (
        (typeof x === "string"
          ? x.localeCompare(y as string)
          : (x as number) - (y as number)) * sort.dir
      );
    });
  }, [result, sort]);
  const sortBy = (k: SortKey) =>
    setSort((s) =>
      s.key === k
        ? { key: k, dir: -s.dir as 1 | -1 }
        : { key: k, dir: k === "ticker" ? 1 : -1 },
    );
  const head = (k: SortKey, text: string) => (
    <th
      className={th}
      aria-sort={
        sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => sortBy(k)}
        className="hover:text-ink"
      >
        {text}
        {sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  const opt = isOptionInstrument(instrument);
  const loading = progress !== null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <p className="shrink-0 rounded-md border border-line bg-panel px-3 py-1.5 text-xs leading-snug text-muted">
        <strong className="font-semibold text-ink">
          Model: test a hypothesis.
        </strong>{" "}
        There is no news archive, so a &ldquo;news event&rdquo; here is a
        price/volume shock found in daily bars (Yahoo, up to 10 years).
        {opt &&
          " Option prices are Black-Scholes estimates, not real quotes."}{" "}
        Ignores fees and tax. Past results don&apos;t predict future ones.
      </p>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <Panel
          title="Hypothesis"
          bodyClass="flex flex-col gap-2.5 overflow-auto p-3"
        >
          <label>
            <span className={label}>Preset</span>
            <select
              className={input}
              value={hypo}
              onChange={(e) => pickHypo(e.target.value)}
            >
              {HYPOTHESES.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                  {h.tuned ? " (tuned)" : ""}
                </option>
              ))}
            </select>
            {(() => {
              const h = HYPOTHESES.find((x) => x.id === hypo);
              if (h?.tuned) {
                const t = h.tuned.stats;
                return (
                  <span className="mt-1 block text-[11px] leading-snug text-muted">
                    <span className="mr-1 rounded bg-accent px-1 py-px font-semibold text-accentink">
                      Tuned
                    </span>
                    {h.tuned.window.from} to {h.tuned.window.to}: out of sample{" "}
                    {t.n} trades, hit {fmtNum(t.hit, 0)}% ({fmtNum(t.hitLo, 0)}-
                    {fmtNum(t.hitHi, 0)}), edge {pct(t.edge, 2)}, p={pText(t.p)}
                    .
                  </span>
                );
              }
              return h?.tunedNote ? (
                <span className="mt-1 block text-[11px] leading-snug text-muted">
                  Defaults kept: {h.tunedNote}
                </span>
              ) : null;
            })()}
          </label>
          <button
            type="button"
            onClick={() => void autoTune()}
            disabled={!data || stale || tuning !== null || loading || !canTune}
            title={
              canTune
                ? "Tunes on 3 years of history before each month and scores the last 12 months out of sample"
                : "Load the 5Y period first: 3 years to train on plus 12 months to test"
            }
            className="h-8 rounded-md border border-line bg-panel2 px-3 text-sm font-medium hover:border-accent disabled:opacity-50"
          >
            {tuning
              ? `Tuning ${tuning.done}/${tuning.total}…`
              : "Auto-tune this preset"}
          </button>

          <div className="space-y-1.5 border-t border-line pt-2.5">
            <span className={label}>Event</span>
            <Seg
              name="Event type"
              options={KINDS}
              value={rule.kind}
              onChange={(v) => setRule({ ...rule, kind: v })}
            />
            <div className="grid grid-cols-3 gap-2">
              <Num
                name="Move ≥ %"
                value={rule.minPct}
                onChange={(v) => setRule({ ...rule, minPct: v })}
              />
              <Num
                name="Volume ≥ × avg"
                value={rule.volMult}
                placeholder="off"
                onChange={(v) => setRule({ ...rule, volMult: v })}
              />
              <Num
                name="Min days apart"
                value={rule.minGap}
                onChange={(v) => setRule({ ...rule, minGap: v })}
              />
            </div>
          </div>

          <div className="space-y-1.5 border-t border-line pt-2.5">
            <span className={label}>Filters (optional)</span>
            <div className="grid grid-cols-4 gap-2">
              <Num
                name="Abn. ≥ %"
                value={rule.minAbn}
                placeholder="off"
                onChange={(v) => setRule({ ...rule, minAbn: v })}
              />
              <Num
                name="Abn. ≤ %"
                value={rule.maxAbn}
                placeholder="off"
                onChange={(v) => setRule({ ...rule, maxAbn: v })}
              />
              <Num
                name="Run ≥ %"
                value={rule.minRun}
                placeholder="off"
                onChange={(v) => setRule({ ...rule, minRun: v })}
              />
              <Num
                name="Run ≤ %"
                value={rule.maxRun}
                placeholder="off"
                onChange={(v) => setRule({ ...rule, maxRun: v })}
              />
            </div>
            <Seg
              name="Market regime"
              options={REGIMES}
              value={rule.regime}
              onChange={(v) => setRule({ ...rule, regime: v })}
            />
            <Seg
              name="Day close vs open"
              options={CONFIRMS}
              value={rule.confirm}
              onChange={(v) => setRule({ ...rule, confirm: v })}
            />
            <p className="text-[11px] leading-snug text-muted">
              Abnormal = stock move minus beta × index move that day
              (stock-specific news vs market-wide). Run-up = return over the 20
              days before the event. Close vs open: did the event day fade or
              hold.
            </p>
          </div>

          <div className="space-y-1.5 border-t border-line pt-2.5">
            <span className={label}>Trade</span>
            <Seg
              name="Instrument"
              options={INSTRUMENTS}
              value={instrument}
              onChange={setInstrument}
            />
            <Seg
              name="Entry"
              options={ENTRIES}
              value={entry}
              onChange={setEntry}
            />
            <div className="grid grid-cols-3 gap-2">
              <Num name="Hold (days)" value={hold} onChange={setHold} />
              <Num
                name="Stop %"
                value={stop}
                placeholder="off"
                onChange={setStop}
              />
              <Num
                name="Target %"
                value={target}
                placeholder="off"
                onChange={setTarget}
              />
            </div>
            {opt && (
              <div className="grid grid-cols-3 gap-2">
                <Num name="Strike OTM %" value={otm} onChange={setOtm} />
                <Num name="Expiry (days)" value={dte} onChange={setDte} />
                <Num name="IV bump ×" value={iv} onChange={setIv} />
              </div>
            )}
            {opt && (
              <p className="text-[11px] leading-snug text-muted">
                Stop/target are % of the premium, checked on closes. IV bump
                applies at entry only; the exit uses normal volatility.
              </p>
            )}
          </div>

          <div className="space-y-1.5 border-t border-line pt-2.5">
            <span className={label}>Universe</span>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select
                className={input}
                value={universe}
                onChange={(e) => setUniverse(e.target.value as UniverseId)}
                aria-label="Universe"
              >
                {(Object.keys(UNIVERSES) as UniverseId[]).map((u) => (
                  <option key={u} value={u}>
                    {UNIVERSES[u].l}
                  </option>
                ))}
              </select>
              <select
                className={input}
                value={years}
                onChange={(e) =>
                  setYears(Number(e.target.value) as (typeof YEARS)[number])
                }
                aria-label="Period"
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}Y
                  </option>
                ))}
              </select>
            </div>
            {universe === "custom" && (
              <>
                <textarea
                  className={`${input} h-16 py-1`}
                  placeholder="BHP, CBA, AAPL.US, VOD.L (US needs .US; max 40)"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
                {parsed.bad.length > 0 && (
                  <p className="text-[11px] text-warn">
                    Ignored: {parsed.bad.join(", ")}
                  </p>
                )}
              </>
            )}
            {parsed.ids.length > MAX_TICKERS && (
              <p className="text-[11px] text-warn">
                Only the first {MAX_TICKERS} tickers are used.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || ids.length === 0}
            className="h-9 rounded-md bg-accent px-3 text-sm font-semibold text-accentink disabled:opacity-50"
          >
            {loading
              ? `Loading ${progress.done}/${progress.total}…`
              : data
                ? stale
                  ? "Reload for new universe/period"
                  : "Reload data"
                : `Load ${ids.length} stocks and run`}
          </button>
          {loading && (
            <div
              className="h-1.5 overflow-hidden rounded bg-panel2"
              role="progressbar"
              aria-valuenow={progress.done}
              aria-valuemax={progress.total}
            >
              <div
                className="h-full bg-accent transition-[width]"
                style={{
                  width: `${(progress.done / Math.max(progress.total, 1)) * 100}%`,
                }}
              />
            </div>
          )}
          {failed.length > 0 && (
            <p className="text-[11px] leading-snug text-warn">
              Failed ({failed.length}):{" "}
              {failed.map((f) => `${displayCode(f.id)} (${f.msg})`).join("; ")}
            </p>
          )}
        </Panel>

        <Panel
          title="Results"
          right={
            <Tabs
              tabs={TABS}
              value={tab}
              onChange={setTab}
              label="Results view"
            />
          }
          bodyClass="flex flex-col gap-3 overflow-auto p-3"
        >
          {err ? (
            <p className="text-sm text-warn">{err}</p>
          ) : !data && tab === "rules" ? (
            <RulesPanel preset={hypo} />
          ) : !data && tab === "paper" ? (
            <PaperPanel />
          ) : !data ? (
            <p className="text-sm text-muted">
              {loading
                ? "Loading price history…"
                : "Pick a hypothesis and a universe, then load the data."}
            </p>
          ) : (
            <>
              {stale && (
                <p className="text-xs text-warn">
                  Universe or period changed. Reload to apply.
                </p>
              )}
              {tab === "summary" && result && (
                <>
                  {result.summary.count === 0 ? (
                    <p className="text-sm text-muted">
                      No events matched this rule in {Object.keys(data).length}{" "}
                      stocks. Try a smaller move or turn the volume filter off.
                    </p>
                  ) : (
                    <>
                      <Seg
                        name="Sample"
                        options={SAMPLES}
                        value={sample}
                        onChange={setSample}
                      />
                      <StatRow s={result.summary} />
                      <AccuracyRow a={result.stats} />
                      <div className="rounded-md border border-line p-3">
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                          <span>
                            Event avg{" "}
                            <strong className={tone(result.summary.avg)}>
                              {pct(result.summary.avg)}
                            </strong>
                          </span>
                          <span>
                            Baseline avg{" "}
                            <strong className={tone(result.baseline.avg)}>
                              {pct(result.baseline.avg)}
                            </strong>{" "}
                            <span className="text-xs text-muted">
                              ({result.baseline.count} same trades on non-event
                              days, win {fmtNum(result.baseline.winRate, 0)}%)
                            </span>
                          </span>
                          <span>
                            Edge{" "}
                            <strong className={tone(result.edge)}>
                              {pct(result.edge, 2)}
                            </strong>{" "}
                            per trade
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted">
                          Edge = event average − baseline average. Near zero
                          means the event adds nothing over trading any random
                          day.
                        </p>
                      </div>
                      <Curve points={result.curve} />
                    </>
                  )}
                </>
              )}
              {tab === "rules" && <RulesPanel preset={hypo} />}
              {tab === "paper" && <PaperPanel />}
              {tab === "tune" && (
                <TunePanel res={tuneRes} running={tuning !== null} />
              )}
              {tab === "split" && runs && (
                <SplitTable
                  train={runs.train}
                  test={runs.test}
                  splitMs={splitMs}
                  fromMs={fromMs}
                />
              )}
              {tab === "events" &&
                result &&
                (rows.length === 0 ? (
                  <p className="text-sm text-muted">No events.</p>
                ) : (
                  <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead className="sticky top-0 bg-panel">
                        <tr className="border-b border-line">
                          {head("ticker", "Ticker")}
                          {head("t", "Event day")}
                          {head("move", "Move")}
                          {head("vol", "Volume ×")}
                          {head("abn", "Abnormal")}
                          {head("runUp", "Run-up")}
                          {head("entry", opt ? "Premium in" : "Entry")}
                          {head("exit", opt ? "Premium out" : "Exit")}
                          {head("reason", "Exit")}
                          {head("ret", "Return")}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((e) => (
                          <tr
                            key={`${e.ticker}-${e.t}`}
                            className="border-b border-line/60 hover:bg-panel2"
                          >
                            <td className={td}>
                              <StockLink id={e.ticker} />
                            </td>
                            <td className={td}>{fmtDay(e.t)}</td>
                            <td className={`${td} ${tone(e.move)}`}>
                              {pct(e.move)}
                            </td>
                            <td className={td}>
                              {e.vol === null ? "-" : fmtNum(e.vol, 1)}
                            </td>
                            <td
                              className={`${td} ${e.abn === null ? "" : tone(e.abn)}`}
                            >
                              {e.abn === null ? "-" : pct(e.abn)}
                            </td>
                            <td
                              className={`${td} ${e.runUp === null ? "" : tone(e.runUp)}`}
                            >
                              {e.runUp === null ? "-" : pct(e.runUp, 0)}
                            </td>
                            <td className={td}>{fmtNum(e.entry, 2)}</td>
                            <td className={td}>
                              {fmtNum(e.exit, 2)}{" "}
                              <span className="text-xs text-muted">
                                {fmtDay(e.exitT)}
                              </span>
                            </td>
                            <td className={`${td} text-muted`}>
                              {REASON[e.reason]}
                            </td>
                            <td className={`${td} font-medium ${tone(e.ret)}`}>
                              {pct(e.ret)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              {tab === "ticker" &&
                result &&
                (result.byTicker.length === 0 ? (
                  <p className="text-sm text-muted">No events.</p>
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 bg-panel">
                      <tr className="border-b border-line">
                        {[
                          "Ticker",
                          "Events",
                          "Win rate",
                          "Average",
                          "Median",
                          "Best",
                          "Worst",
                        ].map((h) => (
                          <th key={h} className={th}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.byTicker.map((r) => (
                        <tr
                          key={r.ticker}
                          className="border-b border-line/60 hover:bg-panel2"
                        >
                          <td className={td}>
                            <StockLink id={r.ticker} />
                          </td>
                          <td className={td}>{r.count}</td>
                          <td className={td}>{fmtNum(r.winRate, 0)}%</td>
                          <td className={`${td} ${tone(r.avg)}`}>
                            {pct(r.avg)}
                          </td>
                          <td className={`${td} ${tone(r.median)}`}>
                            {pct(r.median)}
                          </td>
                          <td className={`${td} text-gain`}>{pct(r.best)}</td>
                          <td className={`${td} text-loss`}>{pct(r.worst)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              {tab === "live" &&
                (signals.length === 0 ? (
                  <p className="text-sm text-muted">
                    No stock&apos;s latest bar triggers this rule right now.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted">
                      Latest bar triggers the rule. Open the stock page to see
                      what the news says.
                    </p>
                    <table className="w-full border-collapse text-sm">
                      <thead className="sticky top-0 bg-panel">
                        <tr className="border-b border-line">
                          {["Ticker", "Day", "Move", "Volume ×", "Close"].map(
                            (h) => (
                              <th key={h} className={th}>
                                {h}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {signals.map((s) => (
                          <tr
                            key={s.ticker}
                            className="border-b border-line/60 hover:bg-panel2"
                          >
                            <td className={td}>
                              <StockLink id={s.ticker} />
                            </td>
                            <td className={td}>{fmtDay(s.t)}</td>
                            <td className={`${td} ${tone(s.move)}`}>
                              {pct(s.move)}
                            </td>
                            <td className={td}>
                              {s.vol === null ? "-" : fmtNum(s.vol, 1)}
                            </td>
                            <td className={td}>{fmtNum(s.close, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ))}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
