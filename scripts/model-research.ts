/**
 * Offline research for the /model page. Fetches 10 years of daily bars once (cached in .cache/research,
 * which is gitignored), then runs a grid of event rules and trade variants, scoring each on a 7-year
 * training period and a 3-year out-of-sample test period.
 *
 *   npx tsx scripts/model-research.ts           uses the cache, fetches what is missing
 *   npx tsx scripts/model-research.ts --refresh  re-download everything
 *
 * Writes .cache/research/results.json and prints the tables used in docs/model-research.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASX_20,
  computeFeatures,
  detectEvents,
  HYPOTHESES,
  simulateTrade,
  volRatio,
  type EventRule,
  type Feat,
  type Instrument,
  type MBar,
  type TradeSpec,
} from "../lib/model";
import { DIR, fetchBars } from "./research-data";
import { accuracy, benjaminiHochberg, type Accuracy } from "../lib/stats";
import { DAY_MS } from "../lib/trades";

const TEST_YEARS = 3;

const refresh = process.argv.includes("--refresh");
const US = (
  "AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO JPM V UNH XOM LLY WMT MA COST NFLX AMD ORCL CRM BAC WFC GS MS C HD LOW MCD NKE SBUX KO PEP PG JNJ PFE MRK ABBV TMO ABT CVX COP SLB " +
  "CAT DE BA GE HON UPS LMT RTX T VZ DIS CMCSA INTC QCOM TXN CSCO ADBE IBM MU AMAT PYPL"
).split(" ");
const ASX = ASX_20.map((c) => `${c}.AX`);
const INDICES = ["^GSPC", "^AXJO"];

/* ---------- configuration grid ---------- */

type Level<T> = { name: string; v: T };
const ABN: Level<Partial<EventRule>>[] = [
  { name: "any", v: {} },
  { name: "idio>=3", v: { minAbnormalPct: 3 } },
  { name: "macro<=1.5", v: { maxAbnormalPct: 1.5 } },
];
const RUNUP: Level<Partial<EventRule>>[] = [
  { name: "any", v: {} },
  { name: "runup>=8", v: { minRunUpPct: 8 } },
  { name: "runup<=0", v: { maxRunUpPct: 0 } },
];
const REGIME: Level<Partial<EventRule>>[] = [
  { name: "any", v: {} },
  { name: "bull", v: { regime: "bull" } },
  { name: "bear", v: { regime: "bear" } },
];
const CONFIRM: Level<Partial<EventRule>>[] = [
  { name: "any", v: {} },
  { name: "fade", v: { confirm: "fade" } },
  { name: "follow", v: { confirm: "follow" } },
];
const EARN = ["any", "earnings-like", "not-earnings"] as const;
const HOLDS = [5, 10];
const MIRROR: Record<Instrument, Instrument> = { short: "long", long: "short", put: "call", call: "put", "covered-call": "cash-put", "cash-put": "covered-call" };

interface Config {
  id: string;
  preset: string;
  mirrored: boolean;
  hold: number;
  filters: string;
  rule: EventRule;
  earn: (typeof EARN)[number];
  spec: TradeSpec;
}

function buildGrid(): Config[] {
  const out: Config[] = [];
  for (const h of HYPOTHESES) {
    for (const mirrored of [false, true]) {
      for (const hold of HOLDS) {
        for (const a of ABN) for (const r of RUNUP) for (const g of REGIME) for (const c of CONFIRM) for (const earn of EARN) {
          const rule: EventRule = { ...h.rule, minGapDays: Math.max(h.rule.minGapDays, hold + 1), ...a.v, ...r.v, ...g.v, ...c.v };
          const spec: TradeSpec = { ...h.spec, holdDays: hold, instrument: mirrored ? MIRROR[h.spec.instrument] : h.spec.instrument };
          if (mirrored && spec.stopPct !== undefined) spec.stopPct = h.spec.stopPct;
          const filters = [a.name, r.name, g.name, c.name, earn].filter((x) => x !== "any").join(" + ") || "none";
          out.push({ id: `${h.id}|${spec.instrument}|h${hold}|${filters}`, preset: h.id, mirrored, hold, filters, rule, earn, spec });
        }
      }
    }
  }
  return out;
}

/* ---------- evaluation ---------- */

interface Series {
  sym: string;
  bars: MBar[];
  feats: Feat[];
  earn: boolean[];
}

/** An event looks like earnings when the same ticker had a volume spike ~1, 2 or 4 quarters earlier. Inferred, not a calendar. */
function earningsFlags(bars: MBar[]): boolean[] {
  const spike = bars.map((_, i) => (volRatio(bars, i) ?? 0) >= 2);
  const windows: [number, number][] = [[58, 68], [121, 133], [248, 258]];
  return bars.map((_, i) => windows.some(([lo, hi]) => { for (let l = lo; l <= hi; l++) if (i - l >= 0 && spike[i - l]) return true; return false; }));
}

const specKey = (s: TradeSpec) => JSON.stringify(s);
const baseCache = new Map<string, number>();

/** Mean return of the same trade on a spread of ordinary days (every k-th day, up to 300 per ticker). */
function baselineMean(all: Series[], spec: TradeSpec, from: number, to: number): number {
  const key = `${specKey(spec)}|${from}|${to}`;
  const hit = baseCache.get(key);
  if (hit !== undefined) return hit;
  let sum = 0;
  let n = 0;
  for (const s of all) {
    const days: number[] = [];
    for (let i = 1; i < s.bars.length; i++) if (s.bars[i].t >= from && s.bars[i].t < to) days.push(i);
    const step = Math.max(1, Math.ceil(days.length / 300));
    for (let k = 0; k < days.length; k += step) {
      const o = simulateTrade(s.bars, days[k], spec);
      if (o) { sum += o.ret; n++; }
    }
  }
  const m = n ? sum / n : 0;
  baseCache.set(key, m);
  return m;
}

interface PeriodStats extends Accuracy {
  edge: number;
  base: number;
}
interface Row {
  c: Config;
  train: PeriodStats;
  test: PeriodStats;
  qTrain: number;
  qTest: number;
}

function evaluate(all: Series[], c: Config, idx: Record<string, MBar[]>, split: number, start: number, end: number, iters: number): { train: PeriodStats; test: PeriodStats } {
  const tr: { ret: number; exitT: number }[] = [];
  const te: { ret: number; exitT: number }[] = [];
  for (const s of all) {
    const evs = detectEvents(s.bars, c.rule, -Infinity, { index: idx[s.sym], feats: s.feats });
    for (const e of evs) {
      if (c.earn === "earnings-like" && !s.earn[e.i]) continue;
      if (c.earn === "not-earnings" && s.earn[e.i]) continue;
      const o = simulateTrade(s.bars, e.i, c.spec);
      if (!o) continue;
      (e.t < split ? tr : te).push({ ret: o.ret, exitT: o.exitT });
    }
  }
  const mk = (xs: { ret: number; exitT: number }[], from: number, to: number): PeriodStats => {
    const base = baselineMean(all, c.spec, from, to);
    const a = accuracy(xs.sort((x, y) => x.exitT - y.exitT).map((x) => x.ret), base, iters);
    return { ...a, base, edge: a.n ? a.mean - base : 0 };
  };
  return { train: mk(tr, start, split), test: mk(te, split, end) };
}

/* ---------- output helpers ---------- */

const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "inf");
const sgn = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${f(x, d)}`;
const cell = (p: PeriodStats) => `${p.n} | ${f(p.hit, 0)}% (${f(p.hitLo, 0)}-${f(p.hitHi, 0)}) | ${sgn(p.mean)} | ${sgn(p.edge)} | ${f(p.t, 1)} | ${p.p.toFixed(3)} | ${f(p.pf, 2)} | ${f(p.maxDD, 0)}`;
const HEAD = "n | hit (95% CI) | mean | edge | t | p | PF | maxDD";

async function main() {
  mkdirSync(DIR, { recursive: true });
  const syms = [...US, ...ASX, ...INDICES];
  const raw: Record<string, MBar[]> = {};
  const failed: string[] = [];
  for (const s of syms) {
    try {
      raw[s] = await fetchBars(s, refresh);
    } catch (e) {
      failed.push(`${s} (${(e as Error).message})`);
    }
  }
  if (failed.length) console.log(`Failed to fetch: ${failed.join(", ")}`);
  const idx: Record<string, MBar[]> = {};
  const all: Series[] = [];
  for (const s of [...US, ...ASX]) {
    const bars = raw[s];
    if (!bars) continue;
    const index = raw[s.endsWith(".AX") ? "^AXJO" : "^GSPC"];
    if (index) idx[s] = index;
    all.push({ sym: s, bars, feats: computeFeatures(bars, index), earn: earningsFlags(bars) });
  }
  const end = Math.max(...all.map((s) => s.bars[s.bars.length - 1].t));
  const start = Math.min(...all.map((s) => s.bars[0].t));
  const split = end - TEST_YEARS * 365.25 * DAY_MS;
  const d = (t: number) => new Date(t).toISOString().slice(0, 10);
  console.log(`# Universe: ${all.length} stocks (${all.filter((s) => !s.sym.endsWith(".AX")).length} US, ${all.filter((s) => s.sym.endsWith(".AX")).length} ASX). Data ${d(start)} to ${d(end)}; train < ${d(split)} <= test\n`);

  const grid = buildGrid();
  console.log(`# Grid: ${grid.length} configurations\n`);
  const rows: Row[] = [];
  const t0 = Date.now();
  for (const c of grid) {
    const { train, test } = evaluate(all, c, idx, split, start, end, 1000);
    rows.push({ c, train, test, qTrain: 1, qTest: 1 });
  }
  console.log(`# Grid done in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

  // multiple-testing control over configs with enough trades
  const MIN_TRAIN = 30;
  const MIN_TEST = 15;
  const ok = rows.filter((r) => r.train.n >= MIN_TRAIN && r.test.n >= MIN_TEST);
  const qa = benjaminiHochberg(ok.map((r) => r.train.p));
  const qb = benjaminiHochberg(ok.map((r) => r.test.p));
  ok.forEach((r, i) => { r.qTrain = qa[i]; r.qTest = qb[i]; });
  console.log(`# Tested ${ok.length} of ${rows.length} configs (train n>=${MIN_TRAIN}, test n>=${MIN_TEST}). Expected false positives at p<0.05: ~${(ok.length * 0.05).toFixed(0)}\n`);

  const sig = (p: PeriodStats, q: number) => p.edge > 0 && p.mean > 0 && q < 0.1; // must also make money outright: option baselines are negative by construction
  const trainSig = ok.filter((r) => sig(r.train, r.qTrain));
  const persist = trainSig.filter((r) => r.test.edge > 0 && r.test.mean > 0 && r.test.p < 0.05);
  const persistFdr = trainSig.filter((r) => r.test.edge > 0 && r.test.mean > 0 && r.qTest < 0.1);
  console.log(`# In-sample edge>0 with FDR q<0.1: ${trainSig.length}. Of those, test edge>0 and p<0.05: ${persist.length}; test FDR q<0.1: ${persistFdr.length}\n`);
  const sameSign = trainSig.length ? (trainSig.filter((r) => r.test.edge > 0 && r.test.mean > 0).length / trainSig.length) * 100 : 0;
  console.log(`# Of the in-sample winners, ${f(sameSign, 0)}% kept a positive edge out of sample\n`);

  const show = (title: string, list: Row[], n = 15) => {
    console.log(`## ${title}\n`);
    console.log(`config | TRAIN ${HEAD} | q | TEST ${HEAD} | q`);
    for (const r of list.slice(0, n)) console.log(`${r.c.id} | ${cell(r.train)} | ${r.qTrain.toFixed(3)} | ${cell(r.test)} | ${r.qTest.toFixed(3)}`);
    console.log("");
  };
  show("Top by in-sample t-stat (what a naive search would pick)", [...ok].sort((a, b) => b.train.t - a.train.t));
  show("Top by out-of-sample t-stat", [...ok].sort((a, b) => b.test.t - a.test.t));
  show("In-sample winners that held out of sample (test p<0.05, edge>0)", [...persist].sort((a, b) => b.test.t - a.test.t), 25);

  // baseline presets (no extra filters), both directions
  console.log("## Presets with no extra filters\n");
  console.log(`config | TRAIN ${HEAD} | TEST ${HEAD}`);
  for (const r of rows.filter((x) => x.c.filters === "none")) console.log(`${r.c.id} | ${cell(r.train)} | ${cell(r.test)}`);
  console.log("");

  // marginal value of each filter: average test edge by level, over the original (non-mirrored) presets only, all with enough trades
  console.log("## Average out-of-sample edge by filter level (pooled over configs with enough trades; not independent)\n");
  const dims: [string, (r: Row) => string][] = [
    ["abnormal", (r) => (r.c.rule.minAbnormalPct !== undefined ? "idio>=3" : r.c.rule.maxAbnormalPct !== undefined ? "macro<=1.5" : "any")],
    ["runup", (r) => (r.c.rule.minRunUpPct !== undefined ? "runup>=8" : r.c.rule.maxRunUpPct !== undefined ? "runup<=0" : "any")],
    ["regime", (r) => r.c.rule.regime ?? "any"],
    ["confirm", (r) => r.c.rule.confirm ?? "any"],
    ["earnings", (r) => r.c.earn],
  ];
  for (const [name, key] of dims) {
    const g = new Map<string, Row[]>();
    for (const r of ok) g.set(key(r), [...(g.get(key(r)) ?? []), r]);
    const parts = [...g].map(([k, rs]) => `${k}: train ${sgn(rs.reduce((a, r) => a + r.train.edge, 0) / rs.length)} / test ${sgn(rs.reduce((a, r) => a + r.test.edge, 0) / rs.length)} (${rs.length})`);
    console.log(`- ${name}: ${parts.join("; ")}`);
  }
  console.log("");

  focus(all, idx, split, start, end);

  writeFileSync(
    join(DIR, "results.json"),
    JSON.stringify({ universe: all.map((s) => s.sym), start, end, split, rows: rows.map((r) => ({ id: r.c.id, rule: r.c.rule, earn: r.c.earn, spec: r.c.spec, train: r.train, test: r.test, qTrain: r.qTrain, qTest: r.qTest })) }),
  );
  console.log(`Saved ${join(DIR, "results.json")}`);
}

/** Follow-up on the one family that survived: stock longs after a big up day. Hold sweep, single filters, calendar-year and month-cluster checks. */
function focus(all: Series[], idx: Record<string, MBar[]>, split: number, start: number, end: number) {
  const base = HYPOTHESES.find((h) => h.id === "momentum")!;
  const cfg = (hold: number, extra: Partial<EventRule> = {}, earn: Config["earn"] = "any"): Config => ({
    id: `momentum|long|h${hold}|${JSON.stringify(extra)}${earn === "any" ? "" : earn}`,
    preset: base.id, mirrored: false, hold, filters: "", earn,
    rule: { ...base.rule, minGapDays: Math.max(base.rule.minGapDays, hold + 1), ...extra },
    spec: { ...base.spec, holdDays: hold },
  });
  console.log("## Focus: momentum long (day-up >= 6%, volume >= 1.5x, buy next open). Hold sweep\n");
  console.log(`hold | TRAIN ${HEAD} | TEST ${HEAD}`);
  for (const h of [1, 2, 3, 5, 10, 15, 20]) {
    const r = evaluate(all, cfg(h), idx, split, start, end, 2000);
    console.log(`${h} | ${cell(r.train)} | ${cell(r.test)}`);
  }
  console.log("\n## Focus: single filters at hold 10\n");
  console.log(`filter | TRAIN ${HEAD} | TEST ${HEAD}`);
  const singles: [string, Partial<EventRule>, Config["earn"]][] = [
    ["none", {}, "any"], ["idio>=3", { minAbnormalPct: 3 }, "any"], ["macro<=1.5", { maxAbnormalPct: 1.5 }, "any"], ["runup>=8", { minRunUpPct: 8 }, "any"], ["runup<=0", { maxRunUpPct: 0 }, "any"],
    ["bull", { regime: "bull" }, "any"], ["bear", { regime: "bear" }, "any"], ["follow", { confirm: "follow" }, "any"], ["fade", { confirm: "fade" }, "any"],
    ["earnings-like", {}, "earnings-like"], ["not-earnings", {}, "not-earnings"], ["vol>=3x", { volMult: 3 }, "any"], ["move>=8", { minPct: 8 }, "any"], ["move>=4", { minPct: 4 }, "any"],
  ];
  for (const [name, extra, earn] of singles) {
    const r = evaluate(all, cfg(10, extra, earn), idx, split, start, end, 2000);
    console.log(`${name} | ${cell(r.train)} | ${cell(r.test)}`);
  }
  // per-year and month-cluster view for the base config
  const c = cfg(10);
  const trades: { t: number; ret: number }[] = [];
  for (const s of all) for (const e of detectEvents(s.bars, c.rule, -Infinity, { index: idx[s.sym], feats: s.feats })) {
    const o = simulateTrade(s.bars, e.i, c.spec);
    if (o) trades.push({ t: e.t, ret: o.ret });
  }
  console.log("\n## Focus: base config by calendar year (mean return, raw; baseline not subtracted)\n");
  const byYear = new Map<number, number[]>();
  for (const x of trades) byYear.set(new Date(x.t).getUTCFullYear(), [...(byYear.get(new Date(x.t).getUTCFullYear()) ?? []), x.ret]);
  for (const [y, rs] of [...byYear].sort((a, b) => a[0] - b[0])) console.log(`${y}: n=${rs.length} mean ${sgn(rs.reduce((a, b) => a + b, 0) / rs.length)} hit ${f((rs.filter((r) => r > 0).length / rs.length) * 100, 0)}%`);
  const byMonth = new Map<string, number[]>();
  for (const x of trades) {
    const k = new Date(x.t).toISOString().slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), x.ret]);
  }
  const mm = [...byMonth].map(([k, rs]) => ({ k, m: rs.reduce((a, b) => a + b, 0) / rs.length, t: new Date(k + "-01").getTime() }));
  const test = mm.filter((x) => x.t >= split).map((x) => x.m);
  const ms = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + (b - ms(xs)) ** 2, 0) / Math.max(1, xs.length - 1));
  console.log(`\nMonth-cluster check (test period): ${test.length} months with events, mean of monthly means ${sgn(ms(test))}, t = ${f(ms(test) / (sd(test) / Math.sqrt(test.length)), 1)}, months positive ${test.filter((x) => x > 0).length}/${test.length}\n`);
}

void main();
