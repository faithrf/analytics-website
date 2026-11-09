/**
 * Forward paper test of the momentum rule (docs/momentum-rules.md): a stock closes up 8% or more,
 * buy the next open, sell the close of trading day 20 after entry. No stop, target or filter.
 * Equal weight, at most 10 positions at once (same-day signals ranked by size of the move).
 * The ledger is recomputed from the start date every time, so it is deterministic. Pure functions only;
 * scripts/paper-momentum.ts feeds it bars and writes data/paper-momentum.json.
 */
import type { MBar } from "./model";

export const PAPER_START = "2026-11-09";
export const PAPER = { trigger: 8, hold: 20, slots: 10, costBps: 10 } as const;

export interface PaperStock {
  sym: string;
  mk: "US" | "ASX";
  bars: MBar[];
  /** index above its 200-day average per bar (same length as bars), null if unknown */
  bull?: (boolean | null)[];
}

export interface PaperTrade {
  sym: string;
  signalDate: string;
  entryDate: string;
  entry: number;
  move: number;
  /** trading days since entry (open trades) or held (closed) */
  days: number;
  last: number;
  /** percent: unrealised for open, realised and net of the round-trip cost for closed */
  ret: number;
  exitDate?: string;
  /** closed only: matched-regime baseline mean and edge (gross percentage points) */
  baseline?: number;
  edge?: number;
}

export interface PaperSummary {
  closed: number;
  open: number;
  hit: number | null;
  mean: number | null;
  baseline: number | null;
  edge: number | null;
  skipped: number;
  pending: number;
}

export interface PaperLedger {
  start: string;
  asOf: string | null;
  open: PaperTrade[];
  closed: PaperTrade[];
  pending: { sym: string; signalDate: string; move: number }[];
  summary: PaperSummary;
  curve: { date: string; port: number; spx: number }[];
}

export const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const yearOf = (t: number) => new Date(t).getUTCFullYear();
const r2 = (x: number) => Math.round(x * 100) / 100;

interface Pos {
  s: number;
  entryI: number;
  signalI: number;
  move: number;
  entryT: number;
  exitT: number; // Infinity while open
  exitI: number | null;
}

/** Mean 20-day open-entry return on ordinary days (every 4th bar), keyed by year, market and regime. */
export function baselineMap(stocks: PaperStock[], hold = PAPER.hold): Map<string, { s: number; n: number }> {
  const m = new Map<string, { s: number; n: number }>();
  for (const st of stocks) {
    for (let i = 25; i + 1 + hold < st.bars.length; i += 4) {
      const a = st.bars[i + 1];
      const entry = a.open ?? a.close;
      if (!(entry > 0)) continue;
      const ret = (st.bars[i + 1 + hold].close / entry - 1) * 100;
      const k = `${yearOf(st.bars[i].t)}|${st.mk}|${st.bull?.[i] ?? "x"}`;
      const c = m.get(k) ?? { s: 0, n: 0 };
      c.s += ret;
      c.n++;
      m.set(k, c);
    }
  }
  return m;
}

export function computeLedger(stocks: PaperStock[], spx: MBar[], startStr = PAPER_START): PaperLedger {
  const start = Date.parse(`${startStr}T00:00:00Z`);
  const { trigger, hold, slots, costBps } = PAPER;
  const cost = costBps / 100; // percent per round trip

  // 1. signals: close up >= trigger% on a day on or after the start date
  interface Sig {
    s: number;
    i: number;
    move: number;
  }
  const sigs: Sig[] = [];
  stocks.forEach((st, s) => {
    for (let i = 1; i < st.bars.length; i++) {
      if (st.bars[i].t < start || !(st.bars[i - 1].close > 0)) continue;
      const move = (st.bars[i].close / st.bars[i - 1].close - 1) * 100;
      if (move >= trigger) sigs.push({ s, i, move });
    }
  });

  // 2. walk entry days in order, apply the slot cap and one-position-per-stock rule
  const pending: PaperLedger["pending"] = [];
  const cands: (Sig & { entryT: number })[] = [];
  for (const g of sigs) {
    const bars = stocks[g.s].bars;
    if (g.i + 1 >= bars.length) pending.push({ sym: stocks[g.s].sym, signalDate: dayStr(bars[g.i].t), move: r2(g.move) });
    else cands.push({ ...g, entryT: bars[g.i + 1].t });
  }
  cands.sort((a, b) => a.entryT - b.entryT || b.move - a.move || stocks[a.s].sym.localeCompare(stocks[b.s].sym));
  const taken: Pos[] = [];
  let skipped = 0;
  for (const c of cands) {
    const st = stocks[c.s];
    const entryI = c.i + 1;
    const live = taken.filter((p) => p.exitT >= c.entryT); // a position holds its slot through its exit day
    if (live.some((p) => p.s === c.s)) continue;
    if (live.length >= slots) {
      skipped++;
      continue;
    }
    const exitI = entryI + hold < st.bars.length ? entryI + hold : null;
    taken.push({
      s: c.s,
      entryI,
      signalI: c.i,
      move: c.move,
      entryT: c.entryT,
      exitT: exitI === null ? Infinity : st.bars[exitI].t,
      exitI,
    });
  }

  // 3. trades
  const base = baselineMap(stocks, hold);
  const open: PaperTrade[] = [];
  const closed: PaperTrade[] = [];
  for (const p of taken) {
    const st = stocks[p.s];
    const eb = st.bars[p.entryI];
    const entry = eb.open ?? eb.close;
    const endI = p.exitI ?? st.bars.length - 1;
    const last = st.bars[endI].close;
    const gross = (last / entry - 1) * 100;
    const t: PaperTrade = {
      sym: st.sym,
      signalDate: dayStr(st.bars[p.signalI].t),
      entryDate: dayStr(eb.t),
      entry: r2(entry),
      move: r2(p.move),
      days: endI - p.entryI,
      last: r2(last),
      ret: r2(p.exitI === null ? gross : gross - cost),
    };
    if (p.exitI === null) open.push(t);
    else {
      t.exitDate = dayStr(st.bars[p.exitI].t);
      const c = base.get(`${yearOf(st.bars[p.signalI].t)}|${st.mk}|${st.bull?.[p.signalI] ?? "x"}`);
      if (c && c.n) {
        t.baseline = r2(c.s / c.n);
        t.edge = r2(gross - c.s / c.n);
      }
      closed.push(t);
    }
  }
  open.sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.sym.localeCompare(b.sym));
  closed.sort((a, b) => a.exitDate!.localeCompare(b.exitDate!) || a.sym.localeCompare(b.sym));

  const avg = (xs: number[]) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const withBase = closed.filter((t) => t.edge !== undefined);
  const summary: PaperSummary = {
    closed: closed.length,
    open: open.length,
    hit: closed.length ? r2((closed.filter((t) => t.ret > 0).length / closed.length) * 100) : null,
    mean: avg(closed.map((t) => t.ret)),
    baseline: avg(withBase.map((t) => t.baseline!)),
    edge: avg(withBase.map((t) => t.edge!)),
    skipped,
    pending: pending.length,
  };

  // 4. equity curve: each position carries weight 1/slots, cash earns nothing
  const dates = new Set<number>();
  for (const b of spx) if (b.t >= start) dates.add(b.t);
  const retAt = new Map<number, number>();
  for (const p of taken) {
    const bars = stocks[p.s].bars;
    const end = p.exitI ?? bars.length - 1;
    for (let j = p.entryI; j <= end; j++) {
      const b = bars[j];
      dates.add(b.t);
      const from = j === p.entryI ? (b.open ?? b.close) : bars[j - 1].close;
      let r = b.close / from - 1;
      if (j === p.exitI) r -= costBps / 10000;
      retAt.set(b.t, (retAt.get(b.t) ?? 0) + r / slots);
    }
  }
  const spxBase = [...spx].reverse().find((b) => b.t < start)?.close;
  const curve: PaperLedger["curve"] = [];
  let eq = 100;
  let si = 0;
  let spxNow = spxBase;
  for (const t of [...dates].sort((a, b) => a - b)) {
    eq *= 1 + (retAt.get(t) ?? 0);
    while (si < spx.length && spx[si].t <= t) spxNow = spx[si++].close;
    if (spxBase && spxNow) curve.push({ date: dayStr(t), port: r2(eq), spx: r2((spxNow / spxBase) * 100) });
  }
  const lastT = Math.max(-Infinity, ...stocks.map((s) => s.bars[s.bars.length - 1]?.t ?? -Infinity));
  return { start: startStr, asOf: Number.isFinite(lastT) ? dayStr(lastT) : null, open, closed, pending, summary, curve };
}
