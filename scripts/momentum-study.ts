/**
 * Momentum study: "buy after a big up day", tested dimension by dimension.
 *
 *   npx tsx scripts/momentum-study.ts            development scan (10y, last 3 months held out and never read)
 *   npx tsx scripts/momentum-study.ts --holdout  evaluates CANDIDATE once on the untouched last 3 months
 *
 * Uses the bars cached by scripts/research-data.ts (run `npm run model:train` once to fill the cache).
 * Output goes to stdout and research-out/momentum-study.txt (gitignored).
 *
 * Every number is gross of costs unless it says otherwise. "Edge" = trade return minus the average return
 * of the same exit rule entered on ordinary days in the same year and market.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ASX200_BY_CODE } from "../data/asx200";
import { ASX_50, computeFeatures, simulateTrade, US_LIQUID, volRatio, type Feat, type MBar, type TradeSpec } from "../lib/model";
import { rng, tStat, wilson } from "../lib/stats";
import { DAY_MS } from "../lib/trades";
import { fetchBars } from "./research-data";

/* ---------- configuration ---------- */

const HOLDOUT_DAYS = 91; // the last 3 months, never touched during development
const EMBARGO_DAYS = 45; // events this close to the holdout are dropped so no trade can reach into it
const MIN_GAP = 10;

interface Rule {
  trig: "close" | "gap" | "intra";
  T: number;
  vol?: number;
  abnMin?: number;
  abnMax?: number;
  locMin?: number;
  locMax?: number;
  first?: boolean;
  hi52?: boolean;
  runMin?: number;
  runMax?: number;
  b200?: boolean;
  b50?: boolean;
  ddMin?: number;
  ddMax?: number;
  vixMin?: number;
  vixMax?: number;
  pxMin?: number;
  pxMax?: number;
  dvLevel?: 0 | 1 | 2;
  earn?: boolean;
  mk?: "US" | "ASX";
  sector?: string;
}
interface Ex {
  entry: "open" | "close" | number; // number = pullback limit, percent below the event close
  hold: number;
  target?: number;
  stop?: number;
  trail?: number;
}

/** The setting the 12-month tuner promoted, and a plain version of it. */
const BASE_A: { rule: Rule; ex: Ex } = { rule: { trig: "close", T: 4, runMax: 0, b200: false }, ex: { entry: "open", hold: 10, target: 6 } };
const BASE_B: { rule: Rule; ex: Ex } = { rule: { trig: "close", T: 6, vol: 1.5 }, ex: { entry: "open", hold: 10 } };

/** Rule set carried into the portfolio, robustness and holdout sections. Edit after reading the development scan. */
const CANDIDATE: { rule: Rule; ex: Ex } = { rule: { trig: "close", T: 8 }, ex: { entry: "open", hold: 20 } };

/* ---------- output ---------- */

const lines: string[] = [];
const out = (s = "") => {
  lines.push(s);
  console.log(s);
};
const f = (x: number | null, d = 1) => (x === null || !Number.isFinite(x) ? "-" : x.toFixed(d));
const sg = (x: number | null, d = 2) => (x === null || !Number.isFinite(x) ? "-" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}`);
const erfc = (x: number) => {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const y = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? y : 2 - y;
};
const pFromT = (t: number) => erfc(Math.abs(t) / Math.SQRT2);
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
const yearOf = (t: number) => new Date(t).getUTCFullYear();

/* ---------- data ---------- */

interface Stock {
  sym: string;
  mk: "US" | "ASX";
  sector?: string;
  bars: MBar[];
  feats: Feat[];
  dayRet: (number | null)[];
  gap: (number | null)[];
  earn: boolean[];
  dv: number[];
  hi52: boolean[];
  prior10: number[];
  b50: (boolean | null)[];
  dd: (number | null)[];
  vix: (number | null)[];
}

interface Ev {
  s: number;
  i: number;
  t: number;
  yr: number;
  mk: "US" | "ASX";
  day: number;
  gap: number;
  intra: number;
  loc: number | null;
  abn: number | null;
  vol: number | null;
  run: number | null;
  b200: boolean | null;
  b50: boolean | null;
  dd: number | null;
  vix: number | null;
  hi52: boolean;
  px: number;
  dv: number;
  prior10: number;
  earn: boolean;
  sector?: string;
}

function earningsFlags(bars: MBar[]): boolean[] {
  const spike = bars.map((_, i) => (volRatio(bars, i) ?? 0) >= 2);
  const wins: [number, number][] = [[58, 68], [121, 133], [248, 258]];
  return bars.map((_, i) => wins.some(([lo, hi]) => { for (let l = lo; l <= hi; l++) if (i - l >= 0 && spike[i - l]) return true; return false; }));
}

/** Value of a date-sorted series on or before time t (pointer walk; call with ascending t). */
function aligned<T>(times: number[], vals: T[], ts: number[]): (T | null)[] {
  const res: (T | null)[] = [];
  let j = -1;
  for (const t of ts) {
    while (j + 1 < times.length && times[j + 1] <= t) j++;
    res.push(j >= 0 ? vals[j] : null);
  }
  return res;
}

async function load() {
  const syms = [...US_LIQUID, ...ASX_50.map((c) => `${c}.AX`)];
  const raw: Record<string, MBar[]> = {};
  for (const s of [...syms, "^GSPC", "^AXJO", "^VIX"]) {
    try {
      raw[s] = await fetchBars(s);
    } catch {
      /* skipped */
    }
  }
  const ctx = (index: MBar[]) => {
    const t = index.map((b) => b.t);
    const c = index.map((b) => b.close);
    const b50: (boolean | null)[] = c.map((_, i) => (i >= 49 ? c[i] > mean(c.slice(i - 49, i + 1)) : null));
    const dd: (number | null)[] = c.map((_, i) => (i >= 60 ? (1 - c[i] / Math.max(...c.slice(Math.max(0, i - 251), i + 1))) * 100 : null));
    return { t, b50, dd };
  };
  const cx = { US: ctx(raw["^GSPC"]), ASX: ctx(raw["^AXJO"]) };
  const vix = raw["^VIX"];
  const stocks: Stock[] = [];
  for (const sym of syms) {
    const bars = raw[sym];
    if (!bars || bars.length < 400) continue;
    const mk: "US" | "ASX" = sym.endsWith(".AX") ? "ASX" : "US";
    const index = raw[mk === "ASX" ? "^AXJO" : "^GSPC"];
    const feats = computeFeatures(bars, index);
    const ts = bars.map((b) => b.t);
    const dayRet = bars.map((b, i) => (i > 0 && bars[i - 1].close > 0 ? (b.close / bars[i - 1].close - 1) * 100 : null));
    const gap = bars.map((b, i) => (i > 0 && b.open && bars[i - 1].close > 0 ? (b.open / bars[i - 1].close - 1) * 100 : null));
    const dv = bars.map((b, i) => {
      const vs = bars.slice(Math.max(0, i - 20), i).map((x) => x.volume ?? 0);
      return vs.length >= 10 ? mean(vs) * b.close : 0;
    });
    const hi52 = bars.map((b, i) => i >= 252 && b.close > Math.max(...bars.slice(i - 252, i).map((x) => x.close)));
    const prior10 = dayRet.map((_, i) => Math.max(-99, ...dayRet.slice(Math.max(1, i - 10), i).map((x) => x ?? -99)));
    stocks.push({
      sym,
      mk,
      sector: mk === "ASX" ? ASX200_BY_CODE.get(sym.slice(0, -3))?.sector : undefined,
      bars,
      feats,
      dayRet,
      gap,
      earn: earningsFlags(bars),
      dv,
      hi52,
      prior10,
      b50: aligned(cx[mk].t, cx[mk].b50, ts),
      dd: aligned(cx[mk].t, cx[mk].dd, ts),
      vix: aligned(vix.map((b) => b.t), vix.map((b) => b.close), ts),
    });
  }
  return stocks;
}

/* ---------- trade simulation (long stock) ---------- */

interface Trade {
  entryI: number;
  exitI: number;
  entry: number;
  exit: number;
  ret: number;
  mae: number;
  mfe: number;
  reason: "hold" | "stop" | "target" | "trail";
}

function sim(bars: MBar[], i: number, ex: Ex): Trade | null {
  let entryI: number;
  let entry: number;
  if (ex.entry === "close") {
    entryI = i;
    entry = bars[i].close;
  } else if (ex.entry === "open") {
    if (i + 1 >= bars.length) return null;
    entryI = i + 1;
    entry = bars[entryI].open ?? bars[entryI].close;
  } else {
    if (i + 1 >= bars.length) return null;
    const lim = bars[i].close * (1 - ex.entry / 100);
    const nb = bars[i + 1];
    if (nb.low > lim) return null; // limit not reached: no trade
    entryI = i + 1;
    entry = (nb.open ?? nb.close) <= lim ? (nb.open ?? nb.close) : lim;
  }
  const exitI = entryI + ex.hold;
  if (exitI >= bars.length || !(entry > 0)) return null;
  const first = ex.entry === "close" ? entryI + 1 : entryI;
  const stopPx = ex.stop !== undefined ? entry * (1 - ex.stop / 100) : undefined;
  const tgtPx = ex.target !== undefined ? entry * (1 + ex.target / 100) : undefined;
  let peak = entry;
  let exit = bars[exitI].close;
  let at = exitI;
  let reason: Trade["reason"] = "hold";
  let lo = entry;
  let hi = entry;
  for (let j = first; j <= exitI; j++) {
    const b = bars[j];
    const trailPx = ex.trail !== undefined ? peak * (1 - ex.trail / 100) : undefined;
    const sp = Math.max(stopPx ?? -Infinity, trailPx ?? -Infinity);
    if (sp > -Infinity && b.low <= sp) {
      const gapped = b.open !== undefined && j > entryI && b.open < sp;
      exit = gapped ? (b.open as number) : sp;
      at = j;
      reason = stopPx !== undefined && sp === stopPx ? "stop" : "trail";
      lo = Math.min(lo, b.low);
      break;
    }
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
    if (tgtPx !== undefined && b.high >= tgtPx) {
      exit = tgtPx;
      at = j;
      reason = "target";
      break;
    }
    peak = Math.max(peak, b.high);
  }
  return { entryI, exitI: at, entry, exit, ret: (exit / entry - 1) * 100, mae: (lo / entry - 1) * 100, mfe: (hi / entry - 1) * 100, reason };
}

/* ---------- study state ---------- */

let stocks: Stock[] = [];
let cands: Ev[] = [];
let holdStart = 0;
let devEnd = 0;
let splitT = 0;
let trials = 0;
let dvCuts: [number, number] = [0, 0];

function buildEvents() {
  const evs: Ev[] = [];
  stocks.forEach((s, si) => {
    for (let i = 21; i < s.bars.length - 1; i++) {
      const b = s.bars[i];
      const day = s.dayRet[i];
      const gap = s.gap[i];
      const intra = b.open && b.open > 0 ? (b.close / b.open - 1) * 100 : null;
      if (day === null || gap === null || intra === null) continue;
      if (Math.max(day, gap, intra) < 2) continue;
      const f = s.feats[i];
      evs.push({
        s: si, i, t: b.t, yr: yearOf(b.t), mk: s.mk, day, gap, intra,
        loc: b.high > b.low ? (b.close - b.low) / (b.high - b.low) : null,
        abn: f.abn, vol: volRatio(s.bars, i), run: f.runUp, b200: f.bull, b50: s.b50[i], dd: s.dd[i], vix: s.vix[i],
        hi52: s.hi52[i], px: b.close, dv: s.dv[i], prior10: s.prior10[i], earn: s.earn[i], sector: s.sector,
      });
    }
  });
  const dvs = evs.map((e) => e.dv).filter((x) => x > 0).sort((a, b) => a - b);
  dvCuts = [dvs[Math.floor(dvs.length / 3)], dvs[Math.floor((2 * dvs.length) / 3)]];
  return evs;
}

function passes(e: Ev, r: Rule): boolean {
  const v = r.trig === "close" ? e.day : r.trig === "gap" ? e.gap : e.intra;
  if (v < r.T) return false;
  if (r.trig === "intra" && e.gap >= 1) return false;
  const rng2 = (x: number | null, lo?: number, hi?: number) => (lo === undefined && hi === undefined) || (x !== null && (lo === undefined || x >= lo) && (hi === undefined || x <= hi));
  if (r.vol !== undefined && (e.vol === null || e.vol < r.vol)) return false;
  if (!rng2(e.abn, r.abnMin, r.abnMax) || !rng2(e.loc, r.locMin, r.locMax) || !rng2(e.run, r.runMin, r.runMax)) return false;
  if (!rng2(e.dd, r.ddMin, r.ddMax) || !rng2(e.vix, r.vixMin, r.vixMax) || !rng2(e.px, r.pxMin, r.pxMax)) return false;
  if (r.first !== undefined && r.first !== (e.prior10 < r.T)) return false;
  if (r.hi52 !== undefined && r.hi52 !== e.hi52) return false;
  if (r.b200 !== undefined && e.b200 !== r.b200) return false;
  if (r.b50 !== undefined && e.b50 !== r.b50) return false;
  if (r.earn !== undefined && r.earn !== e.earn) return false;
  if (r.mk && e.mk !== r.mk) return false;
  if (r.sector && e.sector !== r.sector) return false;
  if (r.dvLevel !== undefined) {
    const lvl = e.dv < dvCuts[0] ? 0 : e.dv < dvCuts[1] ? 1 : 2;
    if (lvl !== r.dvLevel) return false;
  }
  return true;
}

/** Events passing the rule, thinned so one stock never has two trades overlapping, within [from, to). */
function select(r: Rule, hold: number, from = -Infinity, to = devEnd): Ev[] {
  const gap = Math.max(MIN_GAP, hold + 1);
  const res: Ev[] = [];
  let lastS = -1;
  let last = -Infinity;
  for (const e of cands) {
    if (!passes(e, r)) continue;
    if (e.s !== lastS) {
      lastS = e.s;
      last = -Infinity;
    }
    if (e.i - last < gap) continue;
    last = e.i;
    if (e.t >= from && e.t < to) res.push(e);
  }
  return res;
}

/* baseline: the same exit rule entered on ordinary days */
const baseCache = new Map<string, Map<string, { s: number; n: number }>>();
function baseline(ex: Ex, reg?: boolean): Map<string, { s: number; n: number }> {
  const key = JSON.stringify([ex, reg]);
  let m = baseCache.get(key);
  if (m) return m;
  m = new Map();
  for (const s of stocks) {
    for (let i = 25; i < s.bars.length - 1; i += 4) {
      if (s.bars[i].t >= devEnd) break;
      if (reg !== undefined && s.feats[i].bull !== reg) continue; // regime-matched: only days when the index is in the same state
      const tr = sim(s.bars, i, ex);
      if (!tr) continue;
      const k = `${yearOf(s.bars[i].t)}|${s.mk}`;
      const c = m.get(k) ?? { s: 0, n: 0 };
      c.s += tr.ret;
      c.n++;
      m.set(k, c);
    }
  }
  baseCache.set(key, m);
  return m;
}
const baseAt = (b: Map<string, { s: number; n: number }>, yr: number, mk: string) => {
  const c = b.get(`${yr}|${mk}`);
  return c && c.n ? c.s / c.n : 0;
};

interface Tr {
  e: Ev;
  tr: Trade;
  edge: number;
}
function trades(evs: Ev[], ex: Ex, reg?: boolean): Tr[] {
  const b = baseline(ex, reg);
  const res: Tr[] = [];
  for (const e of evs) {
    const tr = sim(stocks[e.s].bars, e.i, ex);
    if (tr) res.push({ e, tr, edge: tr.ret - baseAt(b, e.yr, e.mk) });
  }
  return res;
}

const HEAD = "n | hit% (95% CI) | mean | median | edge | t | p | edge train/test | yrs+ | US/ASX edge";
function row(label: string, ts: Tr[]): string {
  trials++;
  const n = ts.length;
  if (n < 5) return `${label} | ${n} | too few`;
  const rets = ts.map((x) => x.tr.ret);
  const edges = ts.map((x) => x.edge);
  const w = wilson(rets.filter((r) => r > 0).length, n);
  const t = tStat(edges, 0);
  const trn = edges.filter((_, i) => ts[i].e.t < splitT);
  const tst = edges.filter((_, i) => ts[i].e.t >= splitT);
  const yrs = new Map<number, number[]>();
  ts.forEach((x) => yrs.set(x.e.yr, [...(yrs.get(x.e.yr) ?? []), x.edge]));
  const ys = [...yrs.values()].filter((v) => v.length >= 8);
  const mk = (m: string) => {
    const v = ts.filter((x) => x.e.mk === m).map((x) => x.edge);
    return v.length >= 8 ? `${sg(mean(v), 1)}(${v.length})` : "-";
  };
  return `${label} | ${n} | ${f((rets.filter((r) => r > 0).length / n) * 100, 0)} (${f(w.lo * 100, 0)}-${f(w.hi * 100, 0)}) | ${sg(mean(rets))} | ${sg(median(rets))} | ${sg(mean(edges))} | ${f(t, 1)} | ${f(pFromT(t), 3)} | ${sg(mean(trn), 1)}/${sg(mean(tst), 1)} | ${ys.filter((v) => mean(v) > 0).length}/${ys.length} | ${mk("US")} ${mk("ASX")}`;
}

type Base = { rule: Rule; ex: Ex };
function dimension(title: string, levels: [string, (b: Base) => Base][]) {
  out(`\n### ${title}\n`);
  for (const [name, b] of [["A promoted", BASE_A], ["B plain", BASE_B]] as [string, Base][]) {
    out(`[base ${name}]  level | ${HEAD}`);
    for (const [label, mod] of levels) {
      const nb = mod({ rule: { ...b.rule }, ex: { ...b.ex } });
      out(row(label, trades(select(nb.rule, nb.ex.hold), nb.ex, nb.rule.b200)));
    }
    out("");
  }
}
const R = (patch: Partial<Rule>) => (b: Base): Base => ({ rule: { ...b.rule, ...patch }, ex: b.ex });
const X = (patch: Partial<Ex>) => (b: Base): Base => ({ rule: b.rule, ex: { ...b.ex, ...patch } });
const dropRule = (...keys: (keyof Rule)[]) => (b: Base): Base => {
  const r = { ...b.rule };
  for (const k of keys) delete r[k];
  return { rule: r, ex: b.ex };
};

/* ---------- portfolio ---------- */

interface PortRes {
  cagr: number;
  sharpe: number;
  maxDD: number;
  exposure: number;
  avgOpen: number;
  trades: number;
  skipped: number;
  idx: { sym: string; cagr: number; sharpe: number; maxDD: number }[];
}
function portfolio(ts: Tr[], K: number, costBps: number, from: number, to: number): PortRes {
  const dates = [...new Set(stocks.flatMap((s) => s.bars.filter((b) => b.t >= from && b.t < to).map((b) => b.t)))].sort((a, b) => a - b);
  const posIdx = stocks.map((s) => new Map(s.bars.map((b, j) => [b.t, j])));
  const sorted = [...ts].sort((a, b) => stocks[a.e.s].bars[a.tr.entryI].t - stocks[b.e.s].bars[b.tr.entryI].t);
  const open: Tr[] = [];
  let k = 0;
  let eq = 1;
  const curve = [1];
  const rets: number[] = [];
  let expo = 0;
  let skipped = 0;
  let taken = 0;
  for (const d of dates) {
    for (let x = open.length - 1; x >= 0; x--) if (stocks[open[x].e.s].bars[open[x].tr.exitI].t < d) open.splice(x, 1);
    while (k < sorted.length && stocks[sorted[k].e.s].bars[sorted[k].tr.entryI].t <= d) {
      const c = sorted[k++];
      if (stocks[c.e.s].bars[c.tr.entryI].t < d) continue;
      if (open.length >= K) skipped++;
      else {
        open.push(c);
        taken++;
      }
    }
    let r = 0;
    for (const p of open) {
      const s = stocks[p.e.s];
      const j = posIdx[p.e.s].get(d);
      if (j === undefined || j < p.tr.entryI || j > p.tr.exitI) continue;
      const px = j === p.tr.exitI ? p.tr.exit : s.bars[j].close;
      const ref = j === p.tr.entryI ? p.tr.entry : s.bars[j - 1].close;
      r += (px / ref - 1) / K;
      if (j === p.tr.exitI) r -= costBps / 10000 / K;
    }
    eq *= 1 + r;
    rets.push(r);
    curve.push(eq);
    expo += open.length / K;
  }
  const years = Math.max(0.1, (dates[dates.length - 1] - dates[0]) / (365.25 * DAY_MS));
  const stat = (c: number[], r: number[]) => {
    let peak = 1;
    let dd = 0;
    for (const v of c) {
      peak = Math.max(peak, v);
      dd = Math.max(dd, 1 - v / peak);
    }
    const m = mean(r);
    const sd = Math.sqrt(mean(r.map((x) => (x - m) ** 2)));
    return { cagr: (Math.pow(c[c.length - 1] / c[0], 1 / years) - 1) * 100, sharpe: sd > 0 ? (m / sd) * Math.sqrt(252) : 0, maxDD: dd * 100 };
  };
  const idxRes: PortRes["idx"] = [];
  for (const sym of ["^GSPC", "^AXJO"]) {
    const bars = INDEX[sym].filter((b) => b.t >= from && b.t < to);
    if (bars.length < 20) continue;
    const c = bars.map((b) => b.close / bars[0].close);
    const r = c.slice(1).map((v, i) => v / c[i] - 1);
    idxRes.push({ sym, ...stat(c, r) });
  }
  return { ...stat(curve, rets), exposure: (expo / Math.max(1, dates.length)) * 100, avgOpen: (expo / Math.max(1, dates.length)) * K, trades: taken, skipped, idx: idxRes };
}
const INDEX: Record<string, MBar[]> = {};

/* ---------- main ---------- */

async function main() {
  const holdoutMode = process.argv.includes("--holdout");
  stocks = await load();
  for (const s of ["^GSPC", "^AXJO"]) INDEX[s] = await fetchBars(s);
  const end = Math.max(...stocks.map((s) => s.bars[s.bars.length - 1].t));
  const start = Math.min(...stocks.map((s) => s.bars[0].t));
  holdStart = end - HOLDOUT_DAYS * DAY_MS;
  devEnd = holdStart - EMBARGO_DAYS * DAY_MS;
  splitT = start + 0.7 * (devEnd - start);
  cands = buildEvents().sort((a, b) => a.s - b.s || a.i - b.i);
  const d = (t: number) => new Date(t).toISOString().slice(0, 10);
  out(`# Momentum study. ${stocks.length} stocks (${stocks.filter((s) => s.mk === "US").length} US, ${stocks.filter((s) => s.mk === "ASX").length} ASX). Bars ${d(start)} to ${d(end)}.`);
  out(`# Development: events before ${d(devEnd)} (train/test split ${d(splitT)}). Holdout ${d(holdStart)} to ${d(end)} is ${holdoutMode ? "being read NOW, once" : "not read"}.`);
  out(`# Edge = trade return minus the same exit rule on ordinary days (same year and market). p is a t-test on edge; events cluster in time so it is optimistic.`);
  out(`# Base A = promoted setting: day-up>=4%, run-up<=0%, index below 200-day, hold 10, target 6%, buy next open. Base B = plain: day-up>=6%, volume>=1.5x, hold 10, no target, next open.`);

  if (holdoutMode) return holdout(d);

  dimension("1a. Trigger threshold (close-to-close %)", [2, 3, 4, 5, 6, 8, 10].map((T) => [`T>=${T}`, R({ T })]));
  dimension("1b. Trigger type (at the base threshold)", [
    ["close-to-close", R({ trig: "close" })],
    ["gap up", R({ trig: "gap" })],
    ["intraday rally (gap<1%)", R({ trig: "intra" })],
  ]);
  dimension("1c. Close location in the day's range (0 = low, 1 = high)", [
    ["any", dropRule("locMin", "locMax")],
    ["close >= 0.5", R({ locMin: 0.5 })],
    ["close >= 0.7", R({ locMin: 0.7 })],
    ["close >= 0.9", R({ locMin: 0.9 })],
    ["close < 0.5 (faded)", R({ locMax: 0.4999 })],
  ]);
  dimension("1d. Abnormal move vs index (stock-specific news vs market-wide)", [
    ["any", dropRule("abnMin", "abnMax")],
    ["abnormal >= 1", R({ abnMin: 1 })],
    ["abnormal >= 2", R({ abnMin: 2 })],
    ["abnormal >= 3", R({ abnMin: 3 })],
    ["abnormal >= 4", R({ abnMin: 4 })],
    ["abnormal <= 1 (market-wide)", R({ abnMax: 1 })],
    ["abnormal <= 2", R({ abnMax: 2 })],
  ]);
  dimension("1e. Volume multiple (x 20-day average)", [
    ["any", dropRule("vol")],
    ...[1, 1.5, 2, 3, 4].map((v) => [`vol >= ${v}x`, R({ vol: v })] as [string, (b: Base) => Base]),
  ]);
  dimension("1f. First big day vs repeated (no day-up >= T in the prior 10 bars)", [
    ["any", dropRule("first")],
    ["first big day", R({ first: true })],
    ["repeated", R({ first: false })],
  ]);
  dimension("1g. 52-week-high breakout", [
    ["any", dropRule("hi52")],
    ["closes at a 52-week high", R({ hi52: true })],
    ["not a breakout", R({ hi52: false })],
  ]);

  dimension("2a. Run-up over the prior 20 days (%)", [
    ["any", dropRule("runMin", "runMax")],
    ["< -10", R({ runMin: undefined, runMax: -10 })],
    ["-10 to 0", R({ runMin: -10, runMax: 0 })],
    ["0 to 10", R({ runMin: 0, runMax: 10 })],
    ["10 to 20", R({ runMin: 10, runMax: 20 })],
    ["> 20", R({ runMin: 20, runMax: undefined })],
    ["<= 0", R({ runMin: undefined, runMax: 0 })],
    ["<= 10", R({ runMin: undefined, runMax: 10 })],
  ]);
  dimension("2b. Market regime (index)", [
    ["any", dropRule("b200", "b50", "ddMin", "ddMax", "vixMin", "vixMax")],
    ["above 200-day", (b) => R({ b200: true })({ rule: { ...dropRule("b200", "b50")(b).rule }, ex: b.ex })],
    ["below 200-day", (b) => R({ b200: false })({ rule: { ...dropRule("b200", "b50")(b).rule }, ex: b.ex })],
    ["above 50-day", (b) => R({ b50: true })({ rule: { ...dropRule("b200", "b50")(b).rule }, ex: b.ex })],
    ["below 50-day", (b) => R({ b50: false })({ rule: { ...dropRule("b200", "b50")(b).rule }, ex: b.ex })],
    ["index drawdown < 5%", (b) => R({ ddMax: 5 })(dropRule("b200", "b50")(b))],
    ["index drawdown 5-10%", (b) => R({ ddMin: 5, ddMax: 10 })(dropRule("b200", "b50")(b))],
    ["index drawdown > 10%", (b) => R({ ddMin: 10 })(dropRule("b200", "b50")(b))],
    ["VIX < 15", (b) => R({ vixMax: 15 })(dropRule("b200", "b50")(b))],
    ["VIX 15-20", (b) => R({ vixMin: 15, vixMax: 20 })(dropRule("b200", "b50")(b))],
    ["VIX 20-30", (b) => R({ vixMin: 20, vixMax: 30 })(dropRule("b200", "b50")(b))],
    ["VIX > 30", (b) => R({ vixMin: 30 })(dropRule("b200", "b50")(b))],
  ]);
  const sectors = [...new Set(stocks.map((s) => s.sector).filter((x): x is string => !!x))].sort();
  dimension("2c. Sector (ASX only: no sector data for US names) and market", [
    ["US only", R({ mk: "US" })],
    ["ASX only", R({ mk: "ASX" })],
    ...sectors.map((s) => [`ASX ${s}`, R({ mk: "ASX", sector: s })] as [string, (b: Base) => Base]),
  ]);
  dimension("2d. Price level and liquidity (20-day dollar volume terciles)", [
    ["price < 20", R({ pxMax: 20 })],
    ["price 20-100", R({ pxMin: 20, pxMax: 100 })],
    ["price > 100", R({ pxMin: 100 })],
    ["liquidity: lowest third", R({ dvLevel: 0 })],
    ["liquidity: middle third", R({ dvLevel: 1 })],
    ["liquidity: top third", R({ dvLevel: 2 })],
  ]);
  dimension("2e. Likely earnings (volume spike ~1/2/4 quarters earlier; inferred)", [
    ["any", dropRule("earn")],
    ["earnings-like", R({ earn: true })],
    ["not earnings-like", R({ earn: false })],
  ]);

  dimension("3. Entry", [
    ["next open", X({ entry: "open" })],
    ["event close", X({ entry: "close" })],
    ["limit 1% below close, next day only", X({ entry: 1 })],
    ["limit 2% below close", X({ entry: 2 })],
    ["limit 3% below close", X({ entry: 3 })],
  ]);
  dimension("4a. Hold (trading days)", [3, 5, 7, 10, 15, 20, 30].map((h) => [`hold ${h}`, X({ hold: h })]));
  dimension("4b. Profit target (%)", [
    ["none", (b) => ({ rule: b.rule, ex: { ...b.ex, target: undefined } })],
    ...[3, 5, 6, 8, 10, 15].map((t) => [`target ${t}`, X({ target: t })] as [string, (b: Base) => Base]),
  ]);
  dimension("4c. Stop loss (%)", [
    ["none", (b) => ({ rule: b.rule, ex: { ...b.ex, stop: undefined } })],
    ...[3, 5, 8, 10, 15].map((t) => [`stop ${t}`, X({ stop: t })] as [string, (b: Base) => Base]),
  ]);
  dimension("4d. Trailing stop from the high (%)", [
    ["none", (b) => ({ rule: b.rule, ex: { ...b.ex, trail: undefined } })],
    ...[5, 8, 10].map((t) => [`trail ${t}`, X({ trail: t })] as [string, (b: Base) => Base]),
  ]);

  // 4e. excursions and time to target
  out("\n### 4e. Excursions and time to target (base trades, no stop; MAE = worst dip below entry before exit, MFE = best gain)\n");
  for (const [name, b] of [["A promoted", BASE_A], ["B plain", BASE_B]] as [string, Base][]) {
    const ex: Ex = { ...b.ex, stop: undefined };
    const ts = trades(select(b.rule, ex.hold), ex);
    const mae = ts.map((x) => x.tr.mae);
    const mfe = ts.map((x) => x.tr.mfe);
    out(`[${name}] n=${ts.length}  MAE median ${f(median(mae))}% p10 ${f(pctile(mae, 0.1))}% worst ${f(Math.min(...mae))}%   MFE median ${f(median(mfe))}% p90 ${f(pctile(mfe, 0.9))}%`);
    for (const tg of [3, 6, 10]) {
      const hit = trades(select(b.rule, ex.hold), { ...ex, target: tg }).filter((x) => x.tr.reason === "target");
      const days = hit.map((x) => x.tr.exitI - x.tr.entryI);
      out(`   target ${tg}%: reached in ${f((hit.length / ts.length) * 100, 0)}% of trades; days to target median ${f(median(days), 0)} p25 ${f(pctile(days, 0.25), 0)} p75 ${f(pctile(days, 0.75), 0)}`);
    }
  }

  // 5. calls
  out("\n### 5. Expression: buy calls (Black-Scholes estimates, hold 10 days, buy next open). Absolute returns, % of premium\n");
  out("Compare stock mean for the same events in the first row.");
  for (const [name, b] of [["A promoted", BASE_A], ["B plain", BASE_B]] as [string, Base][]) {
    const evs = select(b.rule, 10);
    const stockTs = trades(evs, { entry: "open", hold: 10 });
    out(`[base ${name}] stock (no target): n=${stockTs.length} mean ${sg(mean(stockTs.map((x) => x.tr.ret)))} median ${sg(median(stockTs.map((x) => x.tr.ret)))} hit ${f((stockTs.filter((x) => x.tr.ret > 0).length / Math.max(1, stockTs.length)) * 100, 0)}%`);
    out("  otm% dte ivBump | n | hit% | mean | median | p10 | random-day mean (edge)");
    for (const otm of [0, 3, 5, 10]) for (const dte of [30, 45, 60, 90]) for (const iv of dte === 45 ? [1, 1.3, 1.6] : [1.3]) {
      const spec: TradeSpec = { instrument: "call", entry: "next-open", holdDays: 10, otmPct: otm, dte, ivBump: iv };
      const rs: number[] = [];
      for (const e of evs) {
        const o = simulateTrade(stocks[e.s].bars, e.i, spec);
        if (o) rs.push(o.ret);
      }
      const br: number[] = [];
      for (const s of stocks) for (let i = 60; i < s.bars.length - 12; i += 16) {
        if (s.bars[i].t >= devEnd) break;
        const o = simulateTrade(s.bars, i, spec);
        if (o) br.push(o.ret);
      }
      trials++;
      out(`  ${otm} ${dte} ${iv} | ${rs.length} | ${f((rs.filter((r) => r > 0).length / Math.max(1, rs.length)) * 100, 0)} | ${sg(mean(rs), 1)} | ${sg(median(rs), 1)} | ${sg(pctile(rs, 0.1), 0)} | ${sg(mean(br), 1)} (${sg(mean(rs) - mean(br), 1)})`);
    }
  }

  // 7a. heatmap
  out("\n### 7a. Sensitivity heatmap: plain rule (volume >= 1.5x, buy next open, no stops), edge vs ordinary days, n in brackets\n");
  const holds = [3, 5, 10, 15, 20, 30];
  out(`threshold \\ hold | ${holds.join(" | ")}`);
  for (const T of [2, 3, 4, 5, 6, 8, 10]) {
    const cells = holds.map((h) => {
      const ts = trades(select({ trig: "close", T, vol: 1.5 }, h), { entry: "open", hold: h });
      trials++;
      return ts.length >= 5 ? `${sg(mean(ts.map((x) => x.edge)), 1)} (${ts.length})` : "-";
    });
    out(`${T}% | ${cells.join(" | ")}`);
  }

  // candidate ladder: simple combinations of what mattered, all with next-open entry and no stops or targets
  out("\n### 8. Candidate ladder (development data only)\n");
  out(`variant | ${HEAD}`);
  const lad: [string, Rule, number][] = [
    ["T8, hold 20, no filters", { trig: "close", T: 8 }, 20],
    ["T8, hold 20, index below 200-day", { trig: "close", T: 8, b200: false }, 20],
    ["T8, hold 20, VIX >= 20", { trig: "close", T: 8, vixMin: 20 }, 20],
    ["T8, hold 20, index drawdown > 10%", { trig: "close", T: 8, ddMin: 10 }, 20],
    ["T8, hold 15, index below 200-day", { trig: "close", T: 8, b200: false }, 15],
    ["T8, hold 30, index below 200-day", { trig: "close", T: 8, b200: false }, 30],
    ["T6, hold 20, index below 200-day", { trig: "close", T: 6, b200: false }, 20],
    ["T10, hold 20, index below 200-day", { trig: "close", T: 10, b200: false }, 20],
    ["T8, hold 20, below 200-day, US only", { trig: "close", T: 8, b200: false, mk: "US" }, 20],
    ["T8 gap-up, hold 20, below 200-day", { trig: "gap", T: 8, b200: false }, 20],
    ["T8, hold 20, below 200-day, volume >= 1.5x", { trig: "close", T: 8, b200: false, vol: 1.5 }, 20],
    ["T8, hold 20, below 200-day, run-up <= 10", { trig: "close", T: 8, b200: false, runMax: 10 }, 20],
  ];
  for (const [label, rule, hold] of lad) out(row(label, trades(select(rule, hold), { entry: "open", hold }, rule.b200)));

  // 6 + 7. candidate
  out("\n## Candidate rule set (carried into sections 6 and 7)");
  out(`rule ${JSON.stringify(CANDIDATE.rule)}  exit ${JSON.stringify(CANDIDATE.ex)}`);
  candidateSections();
  out(`\n## Multiple testing note: ${trials} rows/cells were evaluated. By chance alone the best of ${trials} independent tests reaches t about ${f(Math.sqrt(2 * Math.log(trials)), 1)}. Rows are correlated, so the true number of independent trials is smaller, but any single row with t below that is not distinguishable from luck on its own. Judge by plateaus and stability, not by single cells.`);
  mkdirSync("research-out", { recursive: true });
  writeFileSync("research-out/momentum-study.txt", lines.join("\n") + "\n");
}

function candidateSections() {
  const evs = select(CANDIDATE.rule, CANDIDATE.ex.hold);
  const ts = trades(evs, CANDIDATE.ex, CANDIDATE.rule.b200);
  out("\n### Candidate on development data\n");
  out(`level | ${HEAD}`);
  out(row("candidate", ts));

  out("\n### 6. Portfolio (equal weight, max K concurrent positions, each position 1/K of equity, daily mark to market), development period\n");
  const from = Math.min(...ts.map((x) => stocks[x.e.s].bars[x.tr.entryI].t));
  for (const K of [5, 10, 20]) {
    for (const bps of [0, 10, 25]) {
      const p = portfolio(ts, K, bps, from, devEnd);
      out(`K=${K} cost ${bps}bps round trip: CAGR ${f(p.cagr)}%  Sharpe ${f(p.sharpe, 2)}  maxDD ${f(p.maxDD)}%  exposure ${f(p.exposure, 0)}% (avg ${f(p.avgOpen, 1)} positions)  trades ${p.trades} skipped ${p.skipped}`);
    }
  }
  const p10 = portfolio(ts, 10, 0, from, devEnd);
  for (const i of p10.idx) out(`buy and hold ${i.sym}: CAGR ${f(i.cagr)}%  Sharpe ${f(i.sharpe, 2)}  maxDD ${f(i.maxDD)}%`);

  out("\n### 7b. Random-entry permutation test (same stocks and calendar years, random days, same exit rule; 2000 draws)\n");
  const rnd = rng(7);
  const all: Float64Array[] = stocks.map((s) => {
    const a = new Float64Array(s.bars.length).fill(NaN);
    for (let i = 25; i < s.bars.length - 1; i++) {
      if (s.bars[i].t >= devEnd) break;
      const tr = sim(s.bars, i, CANDIDATE.ex);
      if (tr) a[i] = tr.ret;
    }
    return a;
  });
  const byKey = new Map<string, number[]>();
  stocks.forEach((s, si) => s.bars.forEach((b, i) => { if (!Number.isNaN(all[si][i])) { const k = `${si}|${yearOf(b.t)}`; byKey.set(k, [...(byKey.get(k) ?? []), i]); } }));
  const obs = mean(ts.map((x) => x.tr.ret));
  let ge = 0;
  const draws: number[] = [];
  for (let it = 0; it < 2000; it++) {
    let s = 0;
    let n = 0;
    for (const x of ts) {
      const pool = byKey.get(`${x.e.s}|${x.e.yr}`);
      if (!pool?.length) continue;
      s += all[x.e.s][pool[(rnd() * pool.length) | 0]];
      n++;
    }
    const m = s / Math.max(1, n);
    draws.push(m);
    if (m >= obs) ge++;
  }
  out("(a) same stock and same calendar year as each event:");
  out(`observed mean ${sg(obs)}%; random-entry mean ${sg(mean(draws))}% (sd ${f(Math.sqrt(mean(draws.map((x) => (x - mean(draws)) ** 2))), 2)}); share of random draws >= observed: ${f(((ge + 1) / 2001) * 100, 2)}%`);

  {
    // (b) regime-matched: random days from any stock, same year and market, only when the index is in the same state
    const reg = CANDIDATE.rule.b200;
    const pools = new Map<string, { s: number; i: number }[]>();
    stocks.forEach((st, si) => st.bars.forEach((b, i) => {
      if (Number.isNaN(all[si][i])) return;
      if (reg !== undefined && st.feats[i].bull !== reg) return;
      const k = `${st.mk}|${yearOf(b.t)}`;
      const a = pools.get(k) ?? [];
      a.push({ s: si, i });
      pools.set(k, a);
    }));
    let ge2 = 0;
    const dr2: number[] = [];
    for (let it = 0; it < 2000; it++) {
      let sum = 0;
      let n = 0;
      for (const x of ts) {
        const pool = pools.get(`${x.e.mk}|${x.e.yr}`);
        if (!pool?.length) continue;
        const q = pool[(rnd() * pool.length) | 0];
        sum += all[q.s][q.i];
        n++;
      }
      const m = sum / Math.max(1, n);
      dr2.push(m);
      if (m >= obs) ge2++;
    }
    out("(b) any stock, same year and market, index in the same regime state as the event (the fair test of the event itself):");
    out(`observed mean ${sg(obs)}%; random-entry mean ${sg(mean(dr2))}% (sd ${f(Math.sqrt(mean(dr2.map((x) => (x - mean(dr2)) ** 2))), 2)}); share of random draws >= observed: ${f(((ge2 + 1) / 2001) * 100, 2)}%`);
  }

  out("\n### 7c. Leave-one-year-out (edge of the candidate with that year removed)\n");
  const years = [...new Set(ts.map((x) => x.e.yr))].sort();
  for (const y of years) {
    const rest = ts.filter((x) => x.e.yr !== y);
    const only = ts.filter((x) => x.e.yr === y);
    out(`${y}: n=${only.length} edge in year ${sg(mean(only.map((x) => x.edge)), 2)} | without it: n=${rest.length} edge ${sg(mean(rest.map((x) => x.edge)), 2)} t=${f(tStat(rest.map((x) => x.edge), 0), 1)}`);
  }
  const months = new Map<string, number[]>();
  ts.forEach((x) => months.set(new Date(x.e.t).toISOString().slice(0, 7), [...(months.get(new Date(x.e.t).toISOString().slice(0, 7)) ?? []), x.edge]));
  const mm = [...months.values()].map(mean);
  out(`\nMonth-cluster check: ${mm.length} months with events, mean of monthly edge ${sg(mean(mm))}, t=${f(tStat(mm, 0), 1)}, months positive ${mm.filter((x) => x > 0).length}/${mm.length}`);
}

function holdout(d: (t: number) => string) {
  const ex = CANDIDATE.ex;
  out(`\n## HOLDOUT: ${d(holdStart)} to the last bar. Rule ${JSON.stringify(CANDIDATE.rule)} exit ${JSON.stringify(ex)}`);
  const evs = select(CANDIDATE.rule, ex.hold, holdStart, Infinity);
  // baseline over the holdout period: all days from holdStart
  const b = new Map<string, { s: number; n: number }>();
  for (const s of stocks) for (let i = 25; i < s.bars.length - 1; i += 2) {
    if (s.bars[i].t < holdStart) continue;
    if (CANDIDATE.rule.b200 !== undefined && s.feats[i].bull !== CANDIDATE.rule.b200) continue;
    const tr = sim(s.bars, i, ex);
    if (!tr) continue;
    const k = `${yearOf(s.bars[i].t)}|${s.mk}`;
    const c = b.get(k) ?? { s: 0, n: 0 };
    c.s += tr.ret;
    c.n++;
    b.set(k, c);
  }
  const ts: Tr[] = [];
  for (const e of evs) {
    const tr = sim(stocks[e.s].bars, e.i, ex);
    if (tr) ts.push({ e, tr, edge: tr.ret - baseAt(b, e.yr, e.mk) });
  }
  out(`level | ${HEAD}`);
  out(row("holdout", ts));
  if (ts.length) {
    const rets = ts.map((x) => x.tr.ret);
    out(`holdout mean ${sg(mean(rets))}%, median ${sg(median(rets))}%, share winners ${f((rets.filter((r) => r > 0).length / rets.length) * 100, 0)}%, baseline (ordinary days, same exit) mean ${sg(mean(ts.map((x) => x.tr.ret - x.edge)))}%`);
    const to = Infinity;
    const p = portfolio(ts, 10, 10, holdStart, to);
    out(`portfolio K=10, 10bps: CAGR ${f(p.cagr)}% Sharpe ${f(p.sharpe, 2)} maxDD ${f(p.maxDD)}% exposure ${f(p.exposure, 0)}% (3 months: annualised figures are noisy)`);
    for (const i of p.idx) out(`buy and hold ${i.sym} same period: CAGR ${f(i.cagr)}% Sharpe ${f(i.sharpe, 2)} maxDD ${f(i.maxDD)}%`);
  }
  // secondary check: the 12 months before the embargo
  const sec = trades(select(CANDIDATE.rule, ex.hold, devEnd - 365 * DAY_MS, devEnd), ex, CANDIDATE.rule.b200);
  out(`\nSecondary 12-month window before the holdout (${d(devEnd - 365 * DAY_MS)} to ${d(devEnd)}):`);
  out(`level | ${HEAD}`);
  out(row("12m before", sec));
  mkdirSync("research-out", { recursive: true });
  writeFileSync("research-out/momentum-holdout.txt", lines.join("\n") + "\n");
}

void main();
