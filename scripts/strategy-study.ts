/**
 * Strategy study: two new hypothesis families in the Model framework.
 *   (a) post-earnings drift: long after a positive earnings reaction, short after a negative one
 *   (b) selling options after spikes: covered call after a big up day, cash-secured put after a big down day
 *
 *   npx tsx scripts/strategy-study.ts            development: train 3 years, walk-forward, test the 12 months before the holdout
 *   npx tsx scripts/strategy-study.ts --holdout  reads the untouched last 3 months ONCE, for the cells chosen in development
 *
 * Reuses lib/model.ts (events, simulateTrade, Black-Scholes path), lib/stats.ts and the bars cached by scripts/research-data.ts.
 * Output: stdout plus research-out/strategy-*.txt (gitignored).
 *
 * Method
 *  - Edge = trade return minus the same trade on ordinary days in the same calendar month, market and index regime
 *    (index above/below its 200-day average). Costs are inside every return (stock 10 bps round trip; sold options give up
 *    10% of the premium to the spread).
 *  - Cells are tried on the 3 years before the test year; the best by month-clustered t is carried to the test year unchanged.
 *    A monthly walk-forward (re-pick before each test month, trades known only after they exit) is reported as well.
 *  - Trades must exit before the holdout starts, so nothing in development reaches into it.
 *  - Earnings dates are not available from Yahoo (quoteSummary earningsHistory returns only the last four quarters), so an
 *    earnings reaction is the proxy in lib/model.ts: a gap on >= 2x volume, with another volume spike one, two or four quarters earlier.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  ASX_50,
  computeFeatures,
  detectEvents,
  isSold,
  simulateTrade,
  US_LIQUID,
  type EventRule,
  type Feat,
  type MBar,
  type TradeSpec,
} from "../lib/model";
import { benjaminiHochberg, tStat, wilson } from "../lib/stats";
import { DAY_MS } from "../lib/trades";
import { fetchBars } from "./research-data";

/* ---------- configuration ---------- */

export const HOLDOUT_START = Date.UTC(2026, 7, 7); // 2026-08-07: the last 3 months, read once
const YEAR = 365.25 * DAY_MS;
const FOLD = YEAR / 12;
const TRAIN = 3 * YEAR;
const STOCK_COST_BPS = 10;
const OPT_HAIRCUT = 0.1;
const MIN_TRAIN_N = 30;
const MIN_TRAIN_MONTHS = 12;

export interface Cell {
  id: string;
  group: "earn-long" | "earn-short" | "covered-call" | "cash-put";
  rule: EventRule;
  spec: TradeSpec;
}

const stockSpec = (instrument: "long" | "short", hold: number): TradeSpec => ({
  instrument,
  entry: "next-open",
  holdDays: hold,
  otmPct: 0,
  dte: 30,
  ivBump: 1,
  costBps: STOCK_COST_BPS,
});

/** Every cell tried. Counting them is part of the result. */
export function makeCells(): Cell[] {
  const cells: Cell[] = [];
  const buckets: [number, number | undefined][] = [
    [3, undefined],
    [3, 5],
    [5, 8],
    [8, 12],
    [12, undefined],
  ];
  for (const up of [true, false])
    for (const [lo, hi] of buckets)
      for (const hold of [5, 10, 20, 40, 60]) {
        const rule: EventRule = {
          kind: up ? "earn-up" : "earn-down",
          minPct: lo,
          ...(hi !== undefined ? { maxPct: hi } : {}),
          volMult: 2,
          minGapDays: Math.max(21, hold + 1),
        };
        cells.push({
          id: `${up ? "earn-long" : "earn-short"} move ${lo}-${hi ?? "+"}% hold ${hold}`,
          group: up ? "earn-long" : "earn-short",
          rule,
          spec: stockSpec(up ? "long" : "short", hold),
        });
      }
  for (const call of [true, false])
    for (const T of [5, 8])
      for (const iv of [1, 1.3, 1.6])
        for (const otm of [2, 5, 10])
          for (const dte of [7, 14, 30, 45]) {
            cells.push({
              id: `${call ? "covered-call" : "cash-put"} move ${T}% iv x${iv} otm ${otm}% dte ${dte}`,
              group: call ? "covered-call" : "cash-put",
              rule: {
                kind: call ? "day-up" : "day-down",
                minPct: T,
                volMult: 1.5,
                minGapDays: Math.max(10, Math.round(dte * 0.7) + 1),
              },
              spec: {
                instrument: call ? "covered-call" : "cash-put",
                entry: "close",
                holdDays: Math.round(dte * 0.7),
                otmPct: otm,
                dte,
                ivBump: iv,
                costBps: STOCK_COST_BPS,
                optHaircut: OPT_HAIRCUT,
              },
            });
          }
  return cells;
}

/* ---------- small helpers ---------- */

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2;
};
const pctile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const sg = (x: number, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(d)}` : "-");
const erfc = (x: number) => {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const y = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? y : 2 - y;
};
export const pFromT = (t: number) => erfc(Math.abs(t) / Math.SQRT2);
const monthOf = (t: number) => new Date(t).toISOString().slice(0, 7);
const dstr = (t: number) => new Date(t).toISOString().slice(0, 10);

/* ---------- trades and statistics ---------- */

export interface Tr {
  cell: number;
  k: number;
  t: number;
  exitT: number;
  ret: number;
  edge: number;
  month: string;
  prem?: number;
  assigned?: boolean;
  stockRet?: number;
  cashRet?: number;
}

export interface Summary {
  n: number;
  hit: number;
  hitLo: number;
  hitHi: number;
  mean: number;
  median: number;
  edge: number;
  tPooled: number;
  /** t-test over monthly mean edges: months are the independent units, since events bunch in time */
  tClustered: number;
  months: number;
  worst: number;
  p5: number;
  prem: number;
  assign: number;
  stockMean: number;
  exStock: number;
  exCash: number;
}

export function clusterT(trs: Tr[]): { t: number; k: number } {
  const g = new Map<string, number[]>();
  for (const x of trs) g.set(x.month, [...(g.get(x.month) ?? []), x.edge]);
  const ms = [...g.values()].map(mean);
  return { t: ms.length >= 3 ? tStat(ms, 0) : 0, k: ms.length };
}

export function summarise(trs: Tr[]): Summary {
  const n = trs.length;
  const rets = trs.map((x) => x.ret);
  const wins = rets.filter((r) => r > 0).length;
  const w = wilson(wins, n);
  const c = clusterT(trs);
  const sold = trs.filter((x) => x.prem !== undefined);
  return {
    n,
    hit: n ? (wins / n) * 100 : 0,
    hitLo: w.lo * 100,
    hitHi: w.hi * 100,
    mean: mean(rets),
    median: median(rets),
    edge: mean(trs.map((x) => x.edge)),
    tPooled: tStat(trs.map((x) => x.edge), 0),
    tClustered: c.t,
    months: c.k,
    worst: n ? Math.min(...rets) : 0,
    p5: pctile(rets, 0.05),
    prem: mean(sold.map((x) => x.prem as number)),
    assign: sold.length ? (sold.filter((x) => x.assigned).length / sold.length) * 100 : 0,
    stockMean: mean(sold.map((x) => x.stockRet as number)),
    exStock: mean(sold.map((x) => x.ret - (x.stockRet as number))),
    exCash: mean(sold.map((x) => x.ret - (x.cashRet as number))),
  };
}

/** Training score: month-clustered t of the edge; disqualified without enough trades, months, or a positive mean and edge. */
export function trainScore(trs: Tr[]): number {
  if (trs.length < MIN_TRAIN_N) return -Infinity;
  const c = clusterT(trs);
  if (c.k < MIN_TRAIN_MONTHS) return -Infinity;
  if (mean(trs.map((x) => x.ret)) <= 0 || mean(trs.map((x) => x.edge)) <= 0) return -Infinity;
  return c.t;
}

/* ---------- data ---------- */

export interface Stock {
  sym: string;
  mk: "US" | "ASX";
  bars: MBar[];
  index: MBar[];
  feats: Feat[];
}

let stocks: Stock[] = [];
/** For tests: run the evaluation on synthetic stocks. */
export function setStocks(s: Stock[]) {
  stocks = s;
  evCache.clear();
  baseCache.clear();
}
const lines: string[] = [];
const out = (s = "") => {
  lines.push(s);
  console.log(s);
};

async function load(): Promise<Stock[]> {
  const syms = [...US_LIQUID, ...ASX_50.map((c) => `${c}.AX`)];
  const idx = { US: await fetchBars("^GSPC"), ASX: await fetchBars("^AXJO") };
  const res: Stock[] = [];
  for (const sym of syms) {
    try {
      const bars = await fetchBars(sym);
      if (bars.length < 400) continue;
      const mk = sym.endsWith(".AX") ? "ASX" : "US";
      res.push({ sym, mk, bars, index: idx[mk], feats: computeFeatures(bars, idx[mk]) });
    } catch {
      /* skipped */
    }
  }
  return res;
}

/* ---------- evaluation ---------- */

const evCache = new Map<string, { k: number; i: number; t: number }[]>();
function eventsFor(rule: EventRule) {
  const key = JSON.stringify(rule);
  let evs = evCache.get(key);
  if (!evs) {
    evs = [];
    stocks.forEach((s, k) => {
      for (const e of detectEvents(s.bars, rule, -Infinity, { index: s.index, feats: s.feats })) evs!.push({ k, i: e.i, t: e.t });
    });
    evCache.set(key, evs);
  }
  return evs;
}

type Base = Map<string, { s: number; n: number }>;
const baseCache = new Map<string, Base>();
const regimeKey = (b: boolean | null) => (b === null ? "n" : b ? "bull" : "bear");

/** Same trade entered on ordinary days (every few days per stock) in [lo, hi), keyed by month, market and index regime. */
function baseline(spec: TradeSpec, lo: number, hi: number): Base {
  const key = JSON.stringify([spec, String(lo), String(hi)]);
  let m = baseCache.get(key);
  if (m) return m;
  m = new Map();
  const step = isSold(spec.instrument) ? 10 : 4;
  const add = (k: string, r: number) => {
    const c = m!.get(k) ?? { s: 0, n: 0 };
    c.s += r;
    c.n++;
    m!.set(k, c);
  };
  stocks.forEach((s, k) => {
    for (let i = 25 + (k % step); i < s.bars.length - 1; i += step) {
      const t = s.bars[i].t;
      if (t < lo || t >= hi) continue;
      const o = simulateTrade(s.bars, i, spec);
      if (!o || o.exitT >= hi) continue;
      const rk = regimeKey(s.feats[i].bull);
      add(`${monthOf(t)}|${s.mk}|${rk}`, o.ret);
      add(`*|${s.mk}|${rk}`, o.ret);
    }
  });
  baseCache.set(key, m);
  return m;
}
const baseAt = (b: Base, month: string, mk: string, bull: boolean | null) => {
  const rk = regimeKey(bull);
  const c = b.get(`${month}|${mk}|${rk}`);
  if (c && c.n >= 10) return c.s / c.n;
  const d = b.get(`*|${mk}|${rk}`);
  return d && d.n ? d.s / d.n : 0;
};

/** Trades for one rule and spec with events in [lo, hi) that also exit before hi. */
export function evalCell(cell: number, rule: EventRule, spec: TradeSpec, lo: number, hi: number): Tr[] {
  const base = baseline(spec, lo, hi);
  const res: Tr[] = [];
  for (const e of eventsFor(rule)) {
    if (e.t < lo || e.t >= hi) continue;
    const s = stocks[e.k];
    const o = simulateTrade(s.bars, e.i, spec);
    if (!o || o.exitT >= hi) continue;
    const month = monthOf(e.t);
    res.push({
      cell,
      k: e.k,
      t: e.t,
      exitT: o.exitT,
      ret: o.ret,
      edge: o.ret - baseAt(base, month, s.mk, s.feats[e.i].bull),
      month,
      ...(o.premiumPct !== undefined ? { prem: o.premiumPct, assigned: o.assigned, stockRet: o.stockRet, cashRet: o.cashRet } : {}),
    });
  }
  return res;
}

const HEAD = "n | hit% (95% CI) | mean | median | edge | t pooled | t clustered (months) | worst | p5";
function row(label: string, s: Summary): string {
  if (s.n < 3) return `${label} | ${s.n} | too few`;
  return `${label} | ${s.n} | ${f(s.hit, 0)} (${f(s.hitLo, 0)}-${f(s.hitHi, 0)}) | ${sg(s.mean)} | ${sg(s.median)} | ${sg(s.edge)} | ${f(s.tPooled, 1)} | ${f(s.tClustered, 1)} (${s.months}) | ${f(s.worst, 1)} | ${f(s.p5, 1)}`;
}
const SOLD_HEAD = "premium yield % | assigned % | plain stock mean | return minus stock | return minus cash";
const soldRow = (s: Summary) => `${f(s.prem, 2)} | ${f(s.assign, 0)} | ${sg(s.stockMean)} | ${sg(s.exStock)} | ${sg(s.exCash)}`;

/* ---------- development ---------- */

const GROUPS: Cell["group"][] = ["earn-long", "earn-short", "covered-call", "cash-put"];

function dev() {
  const cells = makeCells();
  const testStart = HOLDOUT_START - YEAR;
  const trainStart = testStart - TRAIN;
  out(`# Strategy study. ${stocks.length} stocks (${stocks.filter((s) => s.mk === "US").length} US, ${stocks.filter((s) => s.mk === "ASX").length} ASX).`);
  out(`# Train ${dstr(trainStart)} to ${dstr(testStart)} (3 years). Out-of-sample test ${dstr(testStart)} to ${dstr(HOLDOUT_START)} (12 months). Holdout ${dstr(HOLDOUT_START)} onward: NOT read in this run.`);
  out(`# Costs inside every return: stock ${STOCK_COST_BPS} bps round trip; sold options give up ${OPT_HAIRCUT * 100}% of the premium to the spread (assumed: a 20%-wide quote on liquid large-cap options). No borrow cost on shorts, no tax, no early assignment.`);
  out(`# Edge = return minus the same trade on ordinary days in the same month, market and index-200-day regime. Clustered t = t-test over monthly mean edges.`);
  out(`# Cells tried: ${cells.length} (${GROUPS.map((g) => `${g} ${cells.filter((c) => c.group === g).length}`).join(", ")}).`);

  const all: Tr[][] = cells.map((c, i) => evalCell(i, c.rule, c.spec, -Infinity, HOLDOUT_START));
  const inWin = (trs: Tr[], a: number, b: number, exitBy = Infinity) => trs.filter((x) => x.t >= a && x.t < b && x.exitT < exitBy);
  const train = (i: number) => inWin(all[i], trainStart, testStart, testStart);
  const test = (i: number) => inWin(all[i], testStart, HOLDOUT_START);

  out("\n## All cells: train (3y) vs out-of-sample (12m)\n");
  out(`cell | train ${HEAD} || test ${HEAD}`);
  const trainSum = cells.map((_, i) => summarise(train(i)));
  const testSum = cells.map((_, i) => summarise(test(i)));
  cells.forEach((c, i) => out(`${row(c.id, trainSum[i])} || ${row("test", testSum[i])}`));

  // multiple testing
  const ps = trainSum.map((s) => (s.n >= MIN_TRAIN_N && s.months >= MIN_TRAIN_MONTHS ? pFromT(s.tClustered) : 1));
  const q = benjaminiHochberg(ps);
  const surv = cells.map((_, i) => i).filter((i) => q[i] < 0.05 && trainSum[i].edge > 0);
  out(`\n## Multiple testing\n`);
  out(`${cells.length} cells tried. By chance alone the best of ${cells.length} independent tests reaches t about ${f(Math.sqrt(2 * Math.log(cells.length)), 1)}. Cells cells are strongly correlated (shared events), so the effective number is smaller.`);
  out(`Benjamini-Hochberg q<0.05 on training clustered t, edge>0: ${surv.length} cells. Of those, positive out-of-sample edge: ${surv.filter((i) => testSum[i].n >= 10 && testSum[i].edge > 0).length}; with test clustered t > 2: ${surv.filter((i) => testSum[i].tClustered > 2).length}.`);
  for (const g of GROUPS) {
    const ids = cells.map((_, i) => i).filter((i) => cells[i].group === g);
    const pos = ids.filter((i) => trainSum[i].n >= MIN_TRAIN_N && trainSum[i].edge > 0);
    const posTest = pos.filter((i) => testSum[i].n >= 10 && testSum[i].edge > 0);
    out(`${g}: ${ids.length} cells, ${pos.length} with positive training edge, of which ${posTest.length} still positive out of sample (a coin flip would give about half).`);
  }

  // selection
  const chosen: Record<string, number> = {};
  out("\n## Best cells by training score (month-clustered t of edge), with their out-of-sample result\n");
  for (const g of GROUPS) {
    const ids = cells.map((_, i) => i).filter((i) => cells[i].group === g);
    const ranked = ids.map((i) => ({ i, s: trainScore(train(i)) })).filter((x) => x.s > -Infinity).sort((a, b) => b.s - a.s);
    out(`\n### ${g}  (${ranked.length} of ${ids.length} cells qualified)`);
    out(`cell | train ${HEAD} || test ${HEAD}${g.startsWith("earn") ? "" : ` | ${SOLD_HEAD}`}`);
    for (const x of ranked.slice(0, 6)) {
      const extra = g.startsWith("earn") ? "" : ` | train: ${soldRow(trainSum[x.i])} | test: ${soldRow(testSum[x.i])}`;
      out(`${row(cells[x.i].id, trainSum[x.i])} || ${row("test", testSum[x.i])}${extra}`);
    }
    if (ranked.length) chosen[g] = ranked[0].i;
  }

  // walk-forward: re-pick before each test month using only trades that had exited
  out("\n## Walk-forward (re-pick the best cell before each of the 12 test months, trades known only after exit, 3y training)\n");
  const wfAll: Record<string, Tr[]> = {};
  for (const g of [...GROUPS, "earn", "sell"] as string[]) {
    const gids = cells.map((_, i) => i).filter((i) => g === "earn" ? cells[i].group.startsWith("earn") : g === "sell" ? !cells[i].group.startsWith("earn") : cells[i].group === g);
    const wf: Tr[] = [];
    const picks: string[] = [];
    for (let m = 0; m < 12; m++) {
      const a = testStart + m * FOLD;
      const b = m === 11 ? HOLDOUT_START : a + FOLD;
      let best = -1;
      let bs = -Infinity;
      for (const i of gids) {
        const s = trainScore(inWin(all[i], a - TRAIN, a, a));
        if (s > bs) {
          bs = s;
          best = i;
        }
      }
      if (best >= 0) {
        picks.push(cells[best].id);
        wf.push(...inWin(all[best], a, b));
      }
    }
    wfAll[g] = wf;
    out(row(`walk-forward ${g}`, summarise(wf)) + (g.startsWith("earn-") || g === "earn" ? "" : ` | ${SOLD_HEAD}: ${soldRow(summarise(wf))}`));
    out(`   picks: ${[...new Set(picks)].length} distinct cells over ${picks.length} months`);
  }

  // robustness for the chosen cells
  out("\n## Robustness of the chosen cells (out-of-sample 12 months)\n");
  for (const g of GROUPS) {
    const ci = chosen[g];
    if (ci === undefined) continue;
    const c = cells[ci];
    out(`\n### ${g}: ${c.id}`);
    for (const bps of [0, 10, 25]) {
      const sp = { ...c.spec, costBps: bps };
      out(row(`stock cost ${bps} bps`, summarise(evalCell(ci, c.rule, sp, testStart, HOLDOUT_START))));
    }
    if (isSold(c.spec.instrument))
      for (const h of [0, 0.1, 0.25]) {
        const sp = { ...c.spec, optHaircut: h };
        const s = summarise(evalCell(ci, c.rule, sp, testStart, HOLDOUT_START));
        out(`${row(`option haircut ${h * 100}%`, s)} | ${SOLD_HEAD}: ${soldRow(s)}`);
      }
    // by half-year and by market
    const t = test(ci);
    const mid = testStart + YEAR / 2;
    out(row("first half of test year", summarise(t.filter((x) => x.t < mid))));
    out(row("second half of test year", summarise(t.filter((x) => x.t >= mid))));
    for (const mk of ["US", "ASX"]) out(row(`${mk} only`, summarise(t.filter((x) => stocks[x.k].mk === mk))));
  }

  // option families: sensitivity to the IV assumption, at the chosen strike and expiry
  out("\n## Sold options: out-of-sample result by IV bump, all strikes and expiries pooled (n-weighted over cells)\n");
  for (const g of ["covered-call", "cash-put"] as const)
    for (const iv of [1, 1.3, 1.6]) {
      const ids = cells.map((_, i) => i).filter((i) => cells[i].group === g && cells[i].spec.ivBump === iv);
      const pooled = ids.flatMap((i) => test(i));
      out(`${g} iv x${iv}: ${row("all cells pooled", summarise(pooled))} | ${SOLD_HEAD}: ${soldRow(summarise(pooled))}`);
    }

  // size buckets for the earnings family
  out("\n## Earnings: out-of-sample edge by move bucket and hold (n)\n");
  for (const g of ["earn-long", "earn-short"] as const) {
    out(`${g}: bucket \\ hold | 5 | 10 | 20 | 40 | 60`);
    for (const b of ["3-+", "3-5", "5-8", "8-12", "12-+"]) {
      const cellsRow = [5, 10, 20, 40, 60].map((h) => {
        const i = cells.findIndex((c) => c.group === g && c.id === `${g} move ${b}% hold ${h}`);
        const s = testSum[i];
        return s.n >= 5 ? `${sg(s.edge, 1)} (${s.n})` : `- (${s.n})`;
      });
      out(`   ${b}% | ${cellsRow.join(" | ")}`);
    }
  }

  mkdirSync("research-out", { recursive: true });
  writeFileSync(
    "research-out/strategy-selected.json",
    JSON.stringify({ chosen: Object.fromEntries(Object.entries(chosen).map(([g, i]) => [g, { index: i, id: cells[i].id }])), cellsTried: cells.length }, null, 2),
  );
  writeFileSync("research-out/strategy-study.txt", lines.join("\n") + "\n");
}

/* ---------- holdout (read once) ---------- */

function holdout() {
  const cells = makeCells();
  const sel = JSON.parse(readFileSync("research-out/strategy-selected.json", "utf8")) as { chosen: Record<string, { index: number; id: string }> };
  out(`# HOLDOUT ${dstr(HOLDOUT_START)} onward, cells chosen in development. Read once. Trades that have not finished by the last bar are not counted.`);
  out(`cell | ${HEAD}`);
  for (const g of GROUPS) {
    const pick = sel.chosen[g];
    if (!pick) continue;
    const c = cells[pick.index];
    if (c.id !== pick.id) throw new Error("cell grid changed since development");
    const s = summarise(evalCell(pick.index, c.rule, c.spec, HOLDOUT_START, Infinity));
    out(`${row(`${g}: ${c.id}`, s)}${isSold(c.spec.instrument) ? ` | ${SOLD_HEAD}: ${soldRow(s)}` : ""}`);
  }
  mkdirSync("research-out", { recursive: true });
  writeFileSync("research-out/strategy-holdout.txt", lines.join("\n") + "\n");
}

async function main() {
  stocks = await load();
  if (process.argv.includes("--holdout")) holdout();
  else dev();
}

if (process.argv[1]?.includes("strategy-study")) void main();
