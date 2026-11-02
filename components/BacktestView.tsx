"use client";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { fmtNum, priceDigits } from "@/lib/format";
import { toYahoo } from "@/lib/symbols";
import { DAY_MS, evaluate, MAX_SOLD_STOP_PCT, MAX_STOP_PCT, MAX_TARGET_PCT, type Bar, type Side, type Trade, type TradeResult, type TradeStatus } from "@/lib/trades";
import { useApi } from "@/lib/use-api";
import type { QuoteDTO, SearchHit } from "@/lib/yahoo";
import { Change, Panel, Skeleton } from "@/components/ui";
import { EXPLAIN, fmtDay, input, label, MODES, OPT_KINDS, parseDay, Seg, SymbolPicker, type Mode, type OptKind } from "@/components/TradesView";

// the history API reaches back 10 years; keep a day of slack
const HISTORY_MS = 3650 * DAY_MS - DAY_MS;
const MAX_HOLD_DAYS = 730;
const MAX_RUNS = 600;

const isoUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

type Period = "range" | "single";
type Step = "week" | "month";

const RANGES: { v: number; l: string }[] = [
  { v: 1, l: "1Y" },
  { v: 3, l: "3Y" },
  { v: 5, l: "5Y" },
  { v: 10, l: "10Y" },
];

/** Well-known market moments to replay a single trade from. */
const SCENARIOS: { day: string; l: string }[] = [
  { day: "2018-10-01", l: "Q4 2018 sell-off (Oct 2018)" },
  { day: "2020-02-19", l: "COVID crash, market top (19 Feb 2020)" },
  { day: "2020-03-23", l: "COVID bottom (23 Mar 2020)" },
  { day: "2021-11-08", l: "2021 peak (8 Nov 2021)" },
  { day: "2022-01-03", l: "2022 rate-hike sell-off (3 Jan 2022)" },
  { day: "2022-10-12", l: "2022 bottom (12 Oct 2022)" },
  { day: "2023-01-03", l: "2023 AI rally begins (3 Jan 2023)" },
  { day: "2025-04-02", l: "April 2025 tariff shock (2 Apr 2025)" },
];

const STATUS_LABEL: Record<TradeStatus, string> = {
  open: "Open",
  target: "Hit target",
  stop: "Hit stop",
  ended: "Held to end",
  closed: "Closed",
  expired: "Expired",
};

interface Run {
  startMs: number;
  entryMs: number;
  exitMs: number;
  spot: number;
  spotExit: number;
  r: TradeResult;
}

/** Start dates from `from` to `to`, weekly or monthly. */
function startDates(from: number, to: number, step: Step): number[] {
  const out: number[] = [];
  if (step === "week") {
    for (let t = from; t <= to && out.length < MAX_RUNS; t += 7 * DAY_MS) out.push(t);
  } else {
    const d = new Date(from);
    for (let i = 0; out.length < MAX_RUNS; i++) {
      const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, d.getUTCDate());
      if (t > to) break;
      out.push(t);
    }
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** P/L % per start date as bars above/below zero, over the stock's closing price. */
function RunChart({ runs, bars, selected, onSelect }: { runs: Run[]; bars: Bar[]; selected: number | null; onSelect: (i: number) => void }) {
  const W = 1000;
  const H = 160;
  const vals = runs.map((r) => r.r.plPct ?? 0);
  const top = Math.max(1, ...vals);
  const bot = Math.min(-1, ...vals);
  const y = (v: number) => ((top - v) / (top - bot)) * H;
  // Time axis from the first entry to the last exit, so bars line up with the price line.
  const t0 = runs[0].entryMs;
  const t1 = Math.max(...runs.map((r) => r.exitMs), t0 + DAY_MS);
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const gap = runs.slice(1).reduce((g, r, i) => Math.min(g, x(r.entryMs) - x(runs[i].entryMs)), W / 50);
  const bw = Math.max(gap * 0.8, 1);
  const price = bars.filter((b) => b.t >= t0 && b.t <= t1);
  const pHi = Math.max(...price.map((b) => b.close));
  const pLo = Math.min(...price.map((b) => b.close));
  const py = (c: number) => (pHi === pLo ? H / 2 : ((pHi - c) / (pHi - pLo)) * (H - 8) + 4);
  const sel = selected === null ? null : runs[selected];
  // Drag across the chart to pick a period; a plain click still selects a bar.
  const [span, setSpan] = useState<[number, number] | null>(null);
  const drag = useRef<{ x: number; t: number; moved: boolean } | null>(null);
  const tAt = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return t0 + Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * (t1 - t0);
  };
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    drag.current = { x: e.clientX, t: tAt(e), moved: false };
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x) < 4) return;
    if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
    d.moved = true;
    const t = tAt(e);
    setSpan([Math.min(d.t, t), Math.max(d.t, t)]);
  };
  const onUp = () => {
    // keep `moved` visible to the click that follows, then reset
    setTimeout(() => (drag.current = null));
  };
  const dragged = () => drag.current?.moved === true;
  return (
    <div>
      <div className="flex gap-1.5">
        <div className="flex w-10 shrink-0 flex-col justify-between text-right text-[10px] text-muted tabular-nums">
          <span>+{fmtNum(top, 0)}%</span>
          <span>{fmtNum(bot, 0)}%</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 min-w-0 flex-1 cursor-crosshair touch-none select-none"
          role="img"
          aria-label="Profit or loss for each start date, with the stock price. Drag to pick a period."
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {span && <rect x={x(span[0])} width={Math.max(x(span[1]) - x(span[0]), 1)} y={0} height={H} className="fill-ink opacity-10" />}
          {sel && <rect x={x(sel.entryMs)} width={Math.max(x(sel.exitMs) - x(sel.entryMs), 1)} y={0} height={H} className="fill-accent opacity-10" />}
          {runs.map((run, i) => {
            const v = vals[i];
            const y0 = y(0);
            const y1 = y(v);
            return (
              <rect
                key={run.startMs}
                x={x(run.entryMs)}
                width={bw}
                y={Math.min(y0, y1)}
                height={Math.max(Math.abs(y1 - y0), 0.5)}
                className={`cursor-pointer ${v >= 0 ? "fill-gain" : "fill-loss"} ${selected === null || selected === i ? "opacity-70" : "opacity-30"} hover:opacity-100`}
                onClick={() => !dragged() && onSelect(i)}
              >
                <title>{`${fmtDay(run.entryMs)}: ${v >= 0 ? "+" : ""}${fmtNum(v, 1)}%`}</title>
              </rect>
            );
          })}
          <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {price.length > 1 && (
            <polyline
              points={price.map((b) => `${x(b.t).toFixed(1)},${py(b.close).toFixed(1)}`).join(" ")}
              fill="none"
              className="pointer-events-none stroke-ink"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <div className="flex w-12 shrink-0 flex-col justify-between text-[10px] text-muted tabular-nums">
          <span>{fmtNum(pHi, 2)}</span>
          <span>{fmtNum(pLo, 2)}</span>
        </div>
      </div>
      <div className="flex justify-between px-12 text-[10px] text-muted">
        <span>{fmtDay(t0)}</span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-3 bg-ink" /> Stock price (right axis)
        </span>
        <span>{fmtDay(t1)}</span>
      </div>
      {span ? (
        <PeriodStats span={span} runs={runs} bars={price} onClear={() => setSpan(null)} />
      ) : (
        <p className="mt-1 text-center text-[10px] text-muted">Drag across the chart to see figures for a period.</p>
      )}
    </div>
  );
}

/** Simple figures for a dragged period: the stock's move and the trades started inside it. */
function PeriodStats({ span: [a, b], runs, bars, onClear }: { span: [number, number]; runs: Run[]; bars: Bar[]; onClear: () => void }) {
  const p = bars.filter((x) => x.t >= a && x.t <= b);
  const inside = runs.filter((r) => r.entryMs >= a && r.entryMs <= b && r.r.plPct !== null);
  const pls = inside.map((r) => r.r.plPct as number);
  const first = p[0]?.close;
  const last = p[p.length - 1]?.close;
  const d = first ? priceDigits(first) : 2;
  const cell = "rounded-md bg-panel2 px-2 py-1";
  const k = "text-[10px] text-muted";
  const v = "text-xs font-semibold tabular-nums";
  const pct = (n: number) => `${n >= 0 ? "+" : ""}${fmtNum(n, 1)}%`;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <div className="text-xs font-semibold">
        {fmtDay(a)} to {fmtDay(b)} <span className="font-normal text-muted">({Math.round((b - a) / DAY_MS)} days)</span>
      </div>
      {first !== undefined && last !== undefined && (
        <>
          <div className={cell}>
            <div className={k}>Stock</div>
            <div className={v}>
              {fmtNum(first, d)} to {fmtNum(last, d)} <Change pct={((last - first) / first) * 100} />
            </div>
          </div>
          <div className={cell}>
            <div className={k}>High / low</div>
            <div className={v}>
              {fmtNum(Math.max(...p.map((x) => x.high)), d)} / {fmtNum(Math.min(...p.map((x) => x.low)), d)}
            </div>
          </div>
        </>
      )}
      <div className={cell}>
        <div className={k}>Trades started</div>
        <div className={v}>{inside.length}</div>
      </div>
      {pls.length > 0 && (
        <>
          <div className={cell}>
            <div className={k}>Won</div>
            <div className={v}>{fmtNum((pls.filter((n) => n > 0).length / pls.length) * 100, 0)}%</div>
          </div>
          <div className={cell}>
            <div className={k}>Avg / median P/L</div>
            <div className={v}>
              {pct(pls.reduce((s, n) => s + n, 0) / pls.length)} / {pct(median(pls))}
            </div>
          </div>
          <div className={cell}>
            <div className={k}>Best / worst</div>
            <div className={v}>
              <span className="text-gain">{pct(Math.max(...pls))}</span> / <span className="text-loss">{pct(Math.min(...pls))}</span>
            </div>
          </div>
        </>
      )}
      <button onClick={onClear} className="ml-auto rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent">
        Clear
      </button>
    </div>
  );
}

function Fig({ name, children, hint }: { name: string; children: ReactNode; hint?: string }) {
  return (
    <div className="rounded-md bg-panel2 px-2.5 py-1.5" title={hint}>
      <div className="text-[11px] text-muted">{name}</div>
      <div className="text-sm font-semibold tabular-nums">{children}</div>
    </div>
  );
}

export function BacktestView() {
  const [picked, setPicked] = useState<SearchHit | null>(null);
  const [mode, setMode] = useState<Mode>("buy");
  const [optKind, setOptKind] = useState<OptKind>("buy-call");
  const [amount, setAmount] = useState("1000");
  const [hold, setHold] = useState("30");
  const [strikePct, setStrikePct] = useState("100");
  const [target, setTarget] = useState("");
  const [stop, setStop] = useState("");
  const [period, setPeriod] = useState<Period>("range");
  const [years, setYears] = useState<number | null>(3);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [step, setStep] = useState<Step>("week");
  const [single, setSingle] = useState("2020-02-19");
  const [selected, setSelected] = useState<number | null>(null);

  const [hist, setHist] = useState<{ id: string; bars: Bar[] } | { id: string; error: string } | null>(null);
  const sym = picked ? toYahoo(picked.id) : null;
  useEffect(() => {
    if (!picked) return;
    const ctrl = new AbortController();
    const id = picked.id;
    void (async () => {
      try {
        const res = await fetch(`/api/history?symbol=${encodeURIComponent(toYahoo(id))}&from=${Date.now() - HISTORY_MS}`, { signal: ctrl.signal });
        const body = (await res.json().catch(() => null)) as { bars?: Bar[]; message?: string } | null;
        if (!res.ok || !body?.bars?.length) throw new Error(body?.message ?? "No price history.");
        setHist({ id, bars: body.bars });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setHist({ id, error: (e as Error).message });
      }
    })();
    return () => ctrl.abort();
  }, [picked]);
  const quote = useApi<{ quotes: QuoteDTO[] }>(sym ? `/api/quotes?symbols=${encodeURIComponent(sym)}` : null);
  const ccy = quote.data?.quotes[0]?.currency ?? "";

  const bars = hist && picked && hist.id === picked.id && "bars" in hist ? hist.bars : null;
  const histError = hist && picked && hist.id === picked.id && "error" in hist ? hist.error : null;
  const option = mode === "option";
  const sold = option && optKind.startsWith("sell");
  const side: Side = option ? (optKind.endsWith("call") ? "call" : "put") : mode === "short" ? "short" : "long";

  const firstMs = bars ? bars[0].t : 0;
  const lastMs = bars ? bars[bars.length - 1].t : 0;

  const pickRange = (y: number) => {
    setYears(y);
    setFrom("");
    setTo("");
    setSelected(null);
  };

  const sim = useMemo((): { runs: Run[] } | { error: string } | null => {
    if (!bars) return null;
    const amt = Number(amount);
    const days = Math.round(Number(hold));
    const k = Number(strikePct);
    const tp = target.trim() === "" ? undefined : Number(target);
    const sl = stop.trim() === "" ? undefined : Number(stop);
    if (!(amt > 0)) return { error: "Enter an amount above zero." };
    if (!(days >= 1 && days <= MAX_HOLD_DAYS)) return { error: `Hold for 1 to ${MAX_HOLD_DAYS} days.` };
    if (option && !(k >= 50 && k <= 150)) return { error: "Strike % must be between 50 and 150." };
    if (tp !== undefined && !(tp > 0 && tp <= (sold ? 100 : MAX_TARGET_PCT))) return { error: `Take profit must be above 0 and at most ${sold ? 100 : MAX_TARGET_PCT}%.` };
    const maxStop = sold || mode === "short" ? MAX_SOLD_STOP_PCT : MAX_STOP_PCT;
    if (sl !== undefined && !(sl > 0 && sl <= maxStop)) return { error: `Stop loss must be above 0 and at most ${maxStop}%.` };

    const holdMs = days * DAY_MS;
    // options need ~60 days of earlier prices for the volatility estimate
    const earliest = firstMs + (option ? 90 * DAY_MS : 0);
    const latest = lastMs - holdMs;
    let starts: number[];
    if (period === "single") {
      const s = parseDay(single);
      if (!Number.isFinite(s)) return { error: "Choose a start date." };
      if (s < earliest) return { error: `Price history starts ${fmtDay(earliest)}. Pick a later date.` };
      if (s > latest) return { error: `A ${days}-day trade from that date hasn't finished yet. Pick a date before ${fmtDay(latest)}.` };
      starts = [s];
    } else {
      const f = years !== null ? dayStart(lastMs - years * 365 * DAY_MS) : parseDay(from);
      const t = years !== null ? latest : parseDay(to);
      if (!Number.isFinite(f) || !Number.isFinite(t)) return { error: "Choose both dates." };
      starts = startDates(Math.max(f, earliest), Math.min(t, latest), step);
      if (!starts.length) return { error: "No finished trades in that range. Widen it or shorten the hold." };
    }

    const runs: Run[] = [];
    for (const s of starts) {
      const trade: Trade = {
        id: "bt",
        side,
        symbol: picked!.id,
        amount: amt,
        startMs: s,
        targetPct: tp,
        stopPct: sl,
        createdMs: s,
        ...(option ? { sold: sold || undefined, strikePct: k, expiryMs: s + holdMs } : { endMs: s + holdMs }),
      };
      const r = evaluate(trade, bars, null, lastMs);
      const entryBar = bars.find((b) => b.t >= s);
      if (!entryBar || r.pl === null || r.status === "open") continue;
      const exitMs = entryBar.t + r.days * DAY_MS;
      const exitBar = [...bars].reverse().find((b) => b.t <= exitMs) ?? entryBar;
      runs.push({ startMs: s, entryMs: entryBar.t, exitMs, spot: entryBar.close, spotExit: exitBar.close, r });
    }
    if (!runs.length) return { error: "No finished trades for those settings." };
    return { runs };
  }, [bars, amount, hold, strikePct, target, stop, option, sold, mode, side, period, single, years, from, to, step, firstMs, lastMs, picked]);

  const runs = sim && "runs" in sim ? sim.runs : null;
  const stats = useMemo(() => {
    if (!runs) return null;
    const pls = runs.map((r) => r.r.pl!);
    const pcts = runs.map((r) => r.r.plPct!);
    const wins = pls.filter((p) => p > 0).length;
    const best = runs.reduce((a, b) => (b.r.pl! > a.r.pl! ? b : a));
    const worst = runs.reduce((a, b) => (b.r.pl! < a.r.pl! ? b : a));
    const count = (s: TradeStatus) => runs.filter((r) => r.r.status === s).length;
    return {
      n: runs.length,
      winRate: (wins / runs.length) * 100,
      avgPl: pls.reduce((a, b) => a + b, 0) / runs.length,
      avgPct: pcts.reduce((a, b) => a + b, 0) / runs.length,
      medPct: median(pcts),
      best,
      worst,
      avgDays: runs.reduce((a, r) => a + r.r.days, 0) / runs.length,
      targets: count("target"),
      stops: count("stop"),
    };
  }, [runs]);
  const sel = runs && runs.length === 1 ? runs[0] : runs && selected !== null ? runs[selected] : null;

  const px = (v: number) => fmtNum(v, priceDigits(v, picked?.id ?? ""));
  const money = (v: number) => `${fmtNum(v)}${ccy ? ` ${ccy}` : ""}`;
  const optUnit = option ? " (option, per share)" : "";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <p className="shrink-0 rounded-md border border-line bg-panel px-3 py-1.5 text-xs leading-snug text-muted">
        <strong className="font-semibold text-ink">Backtest: what would have happened.</strong> Replays a trade against real daily prices (Yahoo, last 10 years). Option prices are
        Black-Scholes estimates from past volatility, not real quotes. Ignores fees, dividends and tax. Past results don&apos;t predict future ones.
      </p>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[26rem_minmax(0,1fr)]">
        <Panel title="Backtest setup" bodyClass="flex flex-col gap-3 overflow-auto p-3">
          <div>
            <span className={label}>Stock</span>
            <SymbolPicker
              picked={picked}
              onPick={(h) => {
                setPicked(h);
                setSelected(null);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <span className={label}>Strategy</span>
            <Seg name="Strategy" options={MODES} value={mode} onChange={(v) => (setMode(v), setSelected(null))} />
            {option && <Seg name="Option type" options={OPT_KINDS} value={optKind} onChange={(v) => (setOptKind(v), setSelected(null))} />}
            <p className="text-xs leading-snug text-muted">{EXPLAIN[option ? optKind : mode]}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className={label}>{sold ? "Premium to collect" : option ? "Premium to pay" : "Amount"}</span>
              <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label>
              <span className={label}>{option ? "Days to expiry" : "Hold for (days)"}</span>
              <input className={input} inputMode="numeric" value={hold} onChange={(e) => (setHold(e.target.value), setSelected(null))} />
            </label>
          </div>
          <div className="flex flex-wrap gap-1">
            {[7, 30, 90, 180, 365].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => (setHold(String(d)), setSelected(null))}
                className={`rounded px-2 py-0.5 text-xs ${hold === String(d) ? "bg-accent text-accentink" : "bg-panel2 text-muted hover:text-ink"}`}
              >
                {d < 365 ? `${d}d` : "1y"}
              </button>
            ))}
          </div>
          {option && (
            <label>
              <span className={label}>Strike % (of price on the start date)</span>
              <input className={input} inputMode="decimal" value={strikePct} onChange={(e) => setStrikePct(e.target.value)} />
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className={label}>Take profit % (opt.)</span>
              <input className={input} inputMode="decimal" placeholder="e.g. 20" value={target} onChange={(e) => setTarget(e.target.value)} />
            </label>
            <label>
              <span className={label}>Stop loss % (opt.)</span>
              <input className={input} inputMode="decimal" placeholder="e.g. 10" value={stop} onChange={(e) => setStop(e.target.value)} />
            </label>
          </div>
          <div className="space-y-1.5 border-t border-line pt-3">
            <span className={label}>When</span>
            <Seg
              name="Period"
              options={[
                { v: "range" as Period, l: "Every start date in a range" },
                { v: "single" as Period, l: "One date" },
              ]}
              value={period}
              onChange={(v) => (setPeriod(v), setSelected(null))}
            />
            {period === "range" ? (
              <>
                <div className="flex gap-1">
                  {RANGES.map((r) => (
                    <button
                      key={r.v}
                      type="button"
                      onClick={() => pickRange(r.v)}
                      className={`flex-1 rounded px-2 py-1 text-xs ${years === r.v ? "bg-accent text-accentink" : "bg-panel2 text-muted hover:text-ink"}`}
                    >
                      Last {r.l}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className={label}>From</span>
                    <input
                      type="date"
                      className={input}
                      value={years !== null && bars ? isoUtc(lastMs - years * 365 * DAY_MS) : from}
                      onChange={(e) => {
                        setYears(null);
                        setFrom(e.target.value);
                        if (!to && bars) setTo(isoUtc(lastMs));
                        setSelected(null);
                      }}
                    />
                  </label>
                  <label>
                    <span className={label}>To</span>
                    <input
                      type="date"
                      className={input}
                      value={years !== null && bars ? isoUtc(lastMs) : to}
                      onChange={(e) => {
                        if (years !== null && bars) setFrom(isoUtc(lastMs - years * 365 * DAY_MS));
                        setYears(null);
                        setTo(e.target.value);
                        setSelected(null);
                      }}
                    />
                  </label>
                </div>
                <Seg
                  name="Start a new test trade"
                  options={[
                    { v: "week" as Step, l: "New trade every week" },
                    { v: "month" as Step, l: "Every month" },
                  ]}
                  value={step}
                  onChange={(v) => (setStep(v), setSelected(null))}
                />
              </>
            ) : (
              <>
                <input type="date" className={input} value={single} onChange={(e) => setSingle(e.target.value)} />
                <label>
                  <span className={label}>Or replay a market moment</span>
                  <select className={input} value={SCENARIOS.some((s) => s.day === single) ? single : ""} onChange={(e) => e.target.value && setSingle(e.target.value)}>
                    <option value="">Choose…</option>
                    {SCENARIOS.map((s) => (
                      <option key={s.day} value={s.day}>
                        {s.l}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        </Panel>

        <Panel title={picked ? `Results: ${picked.code}` : "Results"} bodyClass="flex flex-col gap-3 overflow-auto p-3">
          {!picked ? (
            <p className="text-sm text-muted">Choose a stock to see how a trade would have gone over the past years.</p>
          ) : histError ? (
            <p className="text-sm text-loss">{histError}</p>
          ) : !bars ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : sim && "error" in sim ? (
            <p className="text-sm text-warn">{sim.error}</p>
          ) : runs && stats ? (
            <>
              {runs.length > 1 && (
                <>
                  <p className="text-sm leading-snug">
                    Starting a {option ? OPT_KINDS.find((o) => o.v === optKind)!.l.toLowerCase() : MODES.find((m) => m.v === mode)!.l.toLowerCase()} trade of{" "}
                    <strong>{money(Number(amount))}</strong> {step === "week" ? "every week" : "every month"} from {fmtDay(runs[0].entryMs)} to {fmtDay(runs[runs.length - 1].entryMs)},{" "}
                    <strong className={stats.winRate >= 50 ? "text-gain" : "text-loss"}>{fmtNum(stats.winRate, 0)}%</strong> of {stats.n} trades made money. The average trade{" "}
                    {stats.avgPl >= 0 ? "gained" : "lost"} <strong className={stats.avgPl >= 0 ? "text-gain" : "text-loss"}>{money(Math.abs(stats.avgPl))}</strong>.
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                    <Fig name="Trades">{stats.n}</Fig>
                    <Fig name="Win rate">{fmtNum(stats.winRate, 0)}%</Fig>
                    <Fig name="Average P/L">
                      <Change value={stats.avgPl} pct={stats.avgPct} />
                    </Fig>
                    <Fig name="Median P/L" hint="Half the trades did better than this, half worse.">
                      <Change pct={stats.medPct} />
                    </Fig>
                    <Fig name="Best" hint={`Started ${fmtDay(stats.best.entryMs)}`}>
                      <Change value={stats.best.r.pl!} />
                    </Fig>
                    <Fig name="Worst" hint={`Started ${fmtDay(stats.worst.entryMs)}`}>
                      <Change value={stats.worst.r.pl!} />
                    </Fig>
                    <Fig name="Avg days held" hint={`${stats.targets} hit take profit, ${stats.stops} hit stop loss`}>
                      {fmtNum(stats.avgDays, 0)}
                    </Fig>
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted">P/L % by start date. Click a bar for details.</div>
                    <RunChart runs={runs} bars={bars} selected={selected} onSelect={setSelected} />
                  </div>
                </>
              )}
              {sel && (
                <div className="rounded-md border border-line p-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {fmtDay(sel.entryMs)} to {fmtDay(sel.exitMs)} <span className="font-normal text-muted">({sel.r.days} days, {STATUS_LABEL[sel.r.status].toLowerCase()})</span>
                    </span>
                    <span className="text-base font-semibold">
                      <Change value={sel.r.pl!} pct={sel.r.plPct!} />
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Fig name="Stock at start">{px(sel.spot)}</Fig>
                    <Fig name="Stock at end">
                      {px(sel.spotExit)} <Change pct={((sel.spotExit - sel.spot) / sel.spot) * 100} className="text-xs" />
                    </Fig>
                    {option ? (
                      <>
                        <Fig name="Strike">{px(sel.r.strike!)}</Fig>
                        <Fig name={`Option price start → end`} hint={`Estimated${optUnit}`}>
                          {fmtNum(sel.r.entry!, 2)} → {fmtNum(sel.r.exit!, 2)}
                        </Fig>
                      </>
                    ) : (
                      <>
                        <Fig name="Shares">{fmtNum(sel.r.shares!, 2)}</Fig>
                        <Fig name="Value at end">{money(sel.r.value!)}</Fig>
                      </>
                    )}
                  </div>
                  {option && (
                    <p className="mt-2 text-xs text-muted">
                      {sold ? `Collected ${money(Number(amount))} premium.` : `Paid ${money(Number(amount))} premium.`}{" "}
                      {sel.r.maxLoss === null ? "Worst case: no limit." : `Worst case: ${money(sel.r.maxLoss!)}.`} Volatility used {fmtNum((sel.r.sigma ?? 0) * 100, 0)}%.
                    </p>
                  )}
                </div>
              )}
              {runs.length > 1 && (
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-panel">
                    <tr className="border-b border-line">
                      {["Start", "End", "Stock", "Result", "P/L"].map((h) => (
                        <th key={h} className="px-2 py-1 text-left text-xs font-medium text-muted">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {runs
                      .map((run, i) => ({ run, i }))
                      .reverse()
                      .map(({ run, i }) => (
                        <tr key={run.startMs} onClick={() => setSelected(i)} className={`cursor-pointer border-b border-line/60 hover:bg-panel2 ${selected === i ? "bg-panel2" : ""}`}>
                          <td className="px-2 py-1 tabular-nums">{fmtDay(run.entryMs)}</td>
                          <td className="px-2 py-1 tabular-nums">{fmtDay(run.exitMs)}</td>
                          <td className="px-2 py-1 tabular-nums">
                            {px(run.spot)} → {px(run.spotExit)}
                          </td>
                          <td className="px-2 py-1 text-muted">{STATUS_LABEL[run.r.status]}</td>
                          <td className="px-2 py-1">
                            <Change value={run.r.pl!} pct={run.r.plPct!} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
