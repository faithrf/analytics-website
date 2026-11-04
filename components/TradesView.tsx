"use client";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { fmtNum, priceDigits } from "@/lib/format";
import { toYahoo } from "@/lib/symbols";
import { midPrice, type ContractQuote, type OptionChain } from "@/lib/options";
import { expiryCloseMs, greeks, hitRate, impliedMove, impliedVol, MIN_T, monthChange, moveStats, rangePosition, SHARE_HORIZON, tradingDaysBetween } from "@/lib/trade-insights";
import { bsOption, DAY_MS, DEFAULT_SIGMA, evaluate, histVol, RISK_FREE, YEAR_MS, isOption, MAX_AMOUNT, MAX_EXPIRY_MS, MAX_SOLD_STOP_PCT, MAX_STOP_PCT, MAX_REASON_LEN, MAX_TARGET_PCT, MAX_TRADES, MAX_SIGMA, MIN_SIGMA, summarise, todayStartMs, VOL_LOOKBACK_DAYS, type Bar, type Side, type Trade, type TradeResult, type TradeStatus } from "@/lib/trades";
import { useAccount } from "@/lib/use-account";
import { useApi } from "@/lib/use-api";
import { useTrades } from "@/lib/use-trades";
import type { QuoteDTO, SearchHit } from "@/lib/yahoo";
import { Change, Panel, Skeleton, Tabs, useNow } from "@/components/ui";
import { TradeRisk } from "@/components/TradeRisk";
import { TradeJournal } from "@/components/TradeJournal";

const TABS = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const STATUS: Record<TradeStatus, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-accent/15 text-accent" },
  target: { label: "Hit target", cls: "bg-gain/15 text-gain" },
  stop: { label: "Hit stop", cls: "bg-loss/15 text-loss" },
  ended: { label: "Ended", cls: "bg-panel2 text-muted" },
  closed: { label: "Closed", cls: "bg-panel2 text-muted" },
  expired: { label: "Expired", cls: "bg-panel2 text-muted" },
};

export type Mode = "buy" | "short" | "option";
export const MODES: { v: Mode; l: string }[] = [
  { v: "buy", l: "Buy shares" },
  { v: "short", l: "Short shares" },
  { v: "option", l: "Option" },
];
export type OptKind = "buy-call" | "buy-put" | "sell-call" | "sell-put";
export const OPT_KINDS: { v: OptKind; l: string }[] = [
  { v: "buy-call", l: "Buy call" },
  { v: "buy-put", l: "Buy put" },
  { v: "sell-call", l: "Sell call" },
  { v: "sell-put", l: "Sell put" },
];
export const EXPLAIN: Record<Mode | OptKind, string> = {
  buy: "Own the shares. You profit if the price rises. The most you can lose is what you put in, if the price goes to zero.",
  short: "Borrow shares and sell them now, then buy them back later. You profit if the price falls. If it keeps rising, losses have no ceiling.",
  option: "",
  "buy-call":
    "Pay a premium for the right to buy at the strike price until expiry. You profit if the stock ends above strike + premium. The most you can lose is the premium.",
  "buy-put":
    "Pay a premium for the right to sell at the strike price until expiry. You profit if the stock ends below strike − premium. The most you can lose is the premium.",
  "sell-call":
    "Collect a premium now, but you must sell at the strike if the buyer asks. You keep it all if the stock stays below the strike. If it soars, losses have no ceiling.",
  "sell-put":
    "Collect a premium now, but you must buy at the strike if the buyer asks. You keep it all if the stock stays above the strike. If it crashes, you can lose a lot.",
};
const TEN_YEARS_MS = 3650 * DAY_MS;
// the history API only reaches back 10 years; keep a day of slack
const histFrom = (startMs: number, side: Side) => Math.max(Math.min(startMs, Date.now()) - (isOption(side) ? VOL_LOOKBACK_DAYS * DAY_MS : 0), Date.now() - TEN_YEARS_MS + DAY_MS);

/** Small segmented toggle. */
export function Seg<T extends string | boolean>({ options, value, onChange, name }: { options: { v: T; l: string }[]; value: T; onChange: (v: T) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="flex gap-0.5 rounded-md bg-panel2 p-0.5">
      {options.map((o) => (
        <button
          key={o.l}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={`flex-1 rounded px-2.5 py-1 text-xs font-medium ${value === o.v ? "bg-accent text-accentink" : "text-muted hover:text-ink"}`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

const badgeOf = (t: Trade): string | null =>
  t.side === "long" ? null : t.side === "short" ? "short" : `${t.sold ? "Sold " : ""}${t.side}`.replace(/^./, (c) => c.toUpperCase());

export const input = "h-8 w-full rounded-md border border-line bg-bg px-2 text-sm outline-none placeholder:text-muted focus:border-accent";
export const label = "mb-1 block text-xs font-medium text-muted";

export const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const parseDay = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00Z`) : NaN);
export const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/* ---- price history: one fetch per symbol + start day, refreshed every few minutes ---- */

type Hist = { bars: Bar[] } | { error: string };
const histKey = (t: Trade) => `${t.symbol}|${t.startMs}|${t.side}`;
const needsBars = (t: Trade) => isOption(t.side) || t.entryPrice === undefined || t.targetPct !== undefined || t.stopPct !== undefined || t.endMs !== undefined;
const REFRESH_MS = 300_000;

function useHistories(trades: Trade[]) {
  const [hist, setHist] = useState<Record<string, Hist>>({});
  const [tick, setTick] = useState(0);
  // Which histories to load: the symbol and start of every trade that needs bars.
  const wanted = [...new Set(trades.filter(needsBars).map(histKey))].sort().join(",");
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!wanted) return;
    const ctrl = new AbortController();
    for (const key of wanted.split(",")) {
      const [symbol, startMs, side] = key.split("|");
      const from = histFrom(Number(startMs), side as Side);
      void (async () => {
        try {
          const res = await fetch(`/api/history?symbol=${encodeURIComponent(toYahoo(symbol))}&from=${from}`, { signal: ctrl.signal });
          const body = (await res.json().catch(() => null)) as { bars?: Bar[]; message?: string } | null;
          if (!res.ok || !body?.bars) throw new Error(body?.message ?? "No price history.");
          setHist((h) => ({ ...h, [key]: { bars: body.bars! } }));
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          setHist((h) => ("bars" in (h[key] ?? {}) ? h : { ...h, [key]: { error: (e as Error).message } }));
        }
      })();
    }
    return () => ctrl.abort();
  }, [wanted, tick]);
  return hist;
}

/* ---- symbol picker (same search API as the header box, but selects instead of navigating) ---- */

export function SymbolPicker({ picked, onPick }: { picked: SearchHit | null; onPick: (h: SearchHit | null) => void }) {
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = q.trim();

  useEffect(() => {
    if (!query) return;
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { results: SearchHit[] };
        setHits(body.results);
        setActive(0);
        setStatus("done");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setStatus("error");
      }
    }, 250);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const choose = (h: SearchHit) => {
    onPick(h);
    setOpen(false);
    setQ("");
  };

  if (picked) {
    return (
      <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-bg px-2 text-sm">
        <span className="font-semibold text-accent">{picked.code}</span>
        <span className="min-w-0 flex-1 truncate text-muted">{picked.name}</span>
        <button type="button" onClick={() => onPick(null)} className="text-xs text-muted hover:text-accent" aria-label="Choose a different stock">
          Change
        </button>
      </div>
    );
  }
  const showList = open && query.length > 0;
  const shown = query ? hits : [];
  return (
    <div ref={box} className="relative">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Escape") {
            setOpen(false);
          } else if (e.key === "Enter" && showList) {
            e.preventDefault();
            if (shown[active]) choose(shown[active]);
          }
        }}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Stock"
        placeholder="Company name or code"
        className={input}
      />
      {showList && (
        <ul id={listId} role="listbox" className="absolute top-full right-0 left-0 z-40 mt-1 max-h-64 overflow-auto rounded-md border border-line bg-panel shadow-lg">
          {status === "loading" && shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">Searching...</li>}
          {status === "error" && <li className="px-3 py-2 text-sm text-muted">Search is unavailable right now.</li>}
          {status === "done" && shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches for &ldquo;{query}&rdquo;.</li>}
          {shown.map((h, i) => (
            <li
              key={h.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(h);
              }}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${i === active ? "bg-panel2" : ""}`}
            >
              <span className="w-14 truncate font-semibold text-accent">{h.code}</span>
              <span className="min-w-0 flex-1 truncate">{h.name}</span>
              <span className="text-xs text-muted">{h.market}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---- new trade form ---- */

function NewTradeForm({ add, disabled, note }: { add: (t: Omit<Trade, "id" | "createdMs">) => boolean; disabled: boolean; note?: string }) {
  const now = useNow();
  const [picked, setPicked] = useState<SearchHit | null>(null);
  const [amount, setAmount] = useState("1000");
  const [mode, setMode] = useState<Mode>("buy");
  const [optSide, setOptSide] = useState<"put" | "call">("put");
  const [sold, setSold] = useState(false);
  const [realExpiry, setRealExpiry] = useState<number | null>(null);
  const [realStrike, setRealStrike] = useState("");
  const [chainRes, setChainRes] = useState<{ key: string; chain: OptionChain | null } | null>(null);
  const [strike, setStrike] = useState("100");
  const [expiry, setExpiry] = useState("");
  const [past, setPast] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [target, setTarget] = useState("");
  const [stop, setStop] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = now ? isoDay(now) : undefined;
  const oldest = now ? isoDay(now - 3650 * DAY_MS) : undefined;
  const side: Side = mode === "option" ? optSide : mode === "short" ? "short" : "long";
  const option = mode === "option";
  const isSold = option && sold;

  // Real option chain: only for an option started Today. No chain (common for ASX) -> estimate inputs.
  // realExpiry is the chosen expiry day (UTC midnight). Only a day Yahoo lists is fetched with `date`; any other day reuses the nearest chain for spot and strikes.
  const flr = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
  const knownExp = chainRes && picked && chainRes.key.startsWith(`${picked.id}|`) ? (chainRes.chain?.expiries ?? []) : [];
  const fetchMs = realExpiry !== null ? (knownExp.find((ms) => flr(ms) === realExpiry) ?? null) : null;
  const chainKey = option && !past && picked ? `${picked.id}|${fetchMs ?? ""}` : null;
  useEffect(() => {
    if (!chainKey || !picked) return;
    const ctrl = new AbortController();
    void (async () => {
      let chain: OptionChain | null = null;
      try {
        const q = `symbol=${encodeURIComponent(toYahoo(picked.id))}${fetchMs !== null ? `&date=${fetchMs}` : ""}`;
        const res = await fetch(`/api/options?${q}`, { signal: ctrl.signal });
        const body = (await res.json().catch(() => null)) as OptionChain | null;
        if (res.ok && body && Array.isArray(body.expiries) && Array.isArray(body.strikes)) {
          chain = body;
          // the nearest expiry may be today or already past the 1-day minimum: move on to the first usable one
          const first = todayStartMs(Date.now()) + DAY_MS;
          if (realExpiry === null && body.expiry !== null && flr(body.expiry) < first) {
            const next = body.expiries.find((ms) => flr(ms) >= first);
            if (next !== undefined) return setRealExpiry(flr(next));
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
      setChainRes({ key: chainKey, chain });
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chainKey already encodes picked and realExpiry
  }, [chainKey]);
  const chain = chainRes?.key === chainKey ? chainRes.chain : null;
  const chainLoading = !!chainKey && chainRes?.key !== chainKey;
  const t0 = now ? todayStartMs(now) : 0;
  const listedDays = useMemo(() => new Set((chain?.expiries ?? []).map(flr).filter((d) => d >= t0 + DAY_MS && d <= t0 + MAX_EXPIRY_MS)), [chain, t0]);
  // every weekday from tomorrow out to the furthest Yahoo expiry (2 years when none), plus every listed day
  const days = useMemo(() => {
    if (!now || !chain || chain.strikes.length === 0) return [];
    const last = listedDays.size > 0 ? Math.max(...listedDays) : t0 + MAX_EXPIRY_MS;
    const out = new Set(listedDays);
    for (let d = t0 + DAY_MS; d <= last; d += DAY_MS) {
      const wd = new Date(d).getUTCDay();
      if (wd !== 0 && wd !== 6) out.add(d);
    }
    return [...out].sort((x, y) => x - y);
  }, [chain, listedDays, t0, now]);
  const wanted = realExpiry ?? (chain?.expiry != null ? flr(chain.expiry) : null);
  const expirySel = wanted !== null && days.includes(wanted) ? wanted : (days[0] ?? null);
  const useReal = !!chain && chain.strikes.length > 0 && expirySel !== null && listedDays.has(expirySel) && chain.expiry != null && flr(chain.expiry) === expirySel;
  const estMode = !!chain && chain.strikes.length > 0 && expirySel !== null && !useReal;
  const legOf = (row: OptionChain["strikes"][number]) => (optSide === "call" ? row.call : row.put);
  const strikeRows = useReal ? chain.strikes.filter((r) => legOf(r)) : [];
  const atm = strikeRows.reduce<(typeof strikeRows)[number] | null>((best, r) => (best === null || Math.abs(r.strike - (chain?.spot ?? 0)) < Math.abs(best.strike - (chain?.spot ?? 0)) ? r : best), null);
  const rowSel = strikeRows.find((r) => String(r.strike) === realStrike) ?? atm;
  const legSel = rowSel ? legOf(rowSel) : null;
  // Analytics: daily bars from before the start date only (no hindsight)
  const insStart = past ? parseDay(start) : now ? todayStartMs(now) : NaN;
  const insSym = picked ? toYahoo(picked.id) : null;
  const insKey = insSym && Number.isFinite(insStart) ? `${insSym}|${insStart}` : null;
  const [insRes, setInsRes] = useState<{ key: string; bars: Bar[] } | null>(null);
  useEffect(() => {
    if (!insKey || !insSym) return;
    const ctrl = new AbortController();
    const from = Math.max(insStart - 400 * DAY_MS, Date.now() - TEN_YEARS_MS + DAY_MS);
    void (async () => {
      try {
        const res = await fetch(`/api/history?symbol=${encodeURIComponent(insSym)}&from=${from}`, { signal: ctrl.signal });
        const body = (await res.json().catch(() => null)) as { bars?: Bar[] } | null;
        setInsRes({ key: insKey, bars: res.ok && Array.isArray(body?.bars) ? body.bars : [] });
      } catch {
        // aborted or offline: the box simply stays hidden
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- insKey already encodes insSym and insStart
  }, [insKey]);
  const fmtPrem = (v: number | null) => (v === null ? "n/a" : fmtNum(v, v < 1 ? 3 : 2));
  const pickedQuote = useApi<{ quotes: QuoteDTO[] }>(picked ? `/api/quotes?symbols=${encodeURIComponent(toYahoo(picked.id))}` : null, 60_000);
  const pq = pickedQuote.data?.quotes?.[0];
  const optKind: OptKind = `${sold ? "sell" : "buy"}-${optSide}`;
  // dates Yahoo does not list: Black-Scholes at the stock's recent volatility, strikes taken from the nearest listed chain
  const hvNow = insRes?.key === insKey ? histVol(insRes.bars, insStart) : null;
  const estSigma = hvNow ?? DEFAULT_SIGMA;
  const spotNow = pq?.price ?? chain?.spot ?? null;
  const tSel = now && expirySel !== null ? Math.max((expiryCloseMs(expirySel) - now) / YEAR_MS, MIN_T) : null;
  const estStrikes = estMode && chain ? [...new Set(chain.strikes.map((r) => r.strike))].sort((x, y) => x - y) : [];
  const kEst = estStrikes.length === 0 ? null : (estStrikes.find((k) => String(k) === realStrike) ?? estStrikes.reduce((best, k) => (Math.abs(k - (spotNow ?? 0)) < Math.abs(best - (spotNow ?? 0)) ? k : best)));
  const estPrem = (k: number) => (spotNow !== null && tSel !== null ? bsOption(optSide === "call", spotNow, k, tSel, RISK_FREE, estSigma) : null);
  // what the trade looks like at expiry, priced off the chosen contract (real mid, or estimate)
  const kSel = option && !past ? (useReal ? (rowSel?.strike ?? null) : kEst) : null;
  const prem = option && !past && useReal && legSel ? midPrice(legSel.bid, legSel.ask, legSel.last) : option && !past && estMode && kEst !== null ? estPrem(kEst) : null;
  // implied volatility backed out of the mid price (Yahoo's own impliedVolatility is unreliable close to expiry)
  const solvedIv = useReal && prem !== null && spotNow !== null && tSel !== null && kSel !== null ? impliedVol(optSide === "call", prem, spotNow, kSel, tSel, RISK_FREE) : null;
  const legIv = solvedIv ?? (legSel?.iv && legSel.iv > MIN_SIGMA ? legSel.iv : null);
  const amt = Number(amount);
  const summary =
    prem !== null && prem > 0 && kSel !== null && amt > 0
      ? (() => {
          const shares = amt / prem;
          const k = kSel;
          const breakeven = optSide === "call" ? k + prem : k - prem;
          const putMax = (k - prem) * shares;
          return {
            contracts: shares / 100,
            breakeven,
            maxLoss: isSold ? (optSide === "call" ? null : putMax) : amt,
            maxProfit: isSold ? amt : optSide === "call" ? null : putMax,
          };
        })()
      : null;
  const money = (v: number | null) => (v === null ? "no limit" : `$${fmtNum(v, 0)}`);
  const earnApi = useApi<{ details?: { events?: { earningsDate: number | null; earningsEstimate: boolean | null }; dividends?: { exDate: number | null } } }>(option && picked ? `/api/stock/${encodeURIComponent(picked.id)}` : null);
  const analytics = (() => {
    if (!insKey || insRes?.key !== insKey) return null;
    const hist = insRes.bars.filter((b) => b.t < insStart && b.close > 0).sort((a, b) => a.t - b.t);
    const closes = hist.map((b) => b.close);
    const spot = past ? (closes[closes.length - 1] ?? null) : (pq?.price ?? null);
    if (closes.length < 30 || spot === null || !(spot > 0)) return null;
    const startRef = past ? insStart : (now ?? insStart);
    const expMs = option ? (useReal && !past && expirySel !== null ? expirySel : parseDay(expiry)) : NaN;
    // expiry is the exchange close (4pm New York) on the expiry day, not midnight
    const expClose = option && Number.isFinite(expMs) ? expiryCloseMs(expMs) : NaN;
    const hasExp = option && Number.isFinite(expClose) && expClose > startRef;
    const calDays = hasExp ? (expClose - startRef) / DAY_MS : 0;
    const horizon = hasExp ? tradingDaysBetween(startRef, expMs) : SHARE_HORIZON;
    const stats = moveStats(closes, horizon);
    const hv = histVol(hist, insStart);
    const iv = !past && useReal ? legIv : null;
    const sigma = iv !== null ? Math.min(Math.max(iv, MIN_SIGMA), MAX_SIGMA) : (hv ?? DEFAULT_SIGMA);
    const k = option ? (!past && kSel !== null ? kSel : (spot * Number(strike)) / 100) : 0;
    const t = Math.max(calDays / 365, MIN_T);
    const premium = prem !== null && prem > 0 ? prem : option && hasExp && k > 0 ? bsOption(optSide === "call", spot, k, t, RISK_FREE, sigma) : null;
    const be = option && premium !== null && k > 0 ? (optSide === "call" ? k + premium : k - premium) : null;
    const g = option && hasExp && k > 0 ? greeks(optSide === "call", spot, k, t, RISK_FREE, sigma) : null;
    const earn = earnApi.data?.details?.events;
    const earnMs = earn?.earningsDate ?? null;
    return {
      horizon, stats, hv, iv, g, premium, spot, hasExp, calDays, be,
      trend: monthChange(closes), range: rangePosition(closes),
      earnings: hasExp && earnMs !== null && earnMs > startRef && earnMs <= expMs + DAY_MS ? { ms: earnMs, est: !!earn?.earningsEstimate } : null,
    };
  })();
  const pickStock = (h: SearchHit | null) => {
    setPicked(h);
    setRealExpiry(null);
    setRealStrike("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!now) return;
    if (!picked) return setError("Choose a stock.");
    if (option && !past && chainLoading) return setError("Loading option prices. Try again in a moment.");
    if (!reason.trim()) return setError("Say why you are taking this trade.");
    const amt = Number(amount);
    if (!(amt > 0) || amt > MAX_AMOUNT) return setError("Enter an amount above zero.");
    const todayMs = todayStartMs(now);
    let startMs = todayMs;
    if (past) {
      startMs = parseDay(start);
      if (Number.isNaN(startMs)) return setError("Pick a start date.");
      if (startMs >= todayMs) return setError("Start date must be before today. Use Today instead.");
      if (startMs < todayMs - 3650 * DAY_MS) return setError("Start date can be at most 10 years ago.");
    }
    let endMs: number | undefined;
    let expiryMs: number | undefined;
    let strikePct: number | undefined;
    let realLeg: { contractSymbol: string; premium: number; strike: number; iv: number | null } | undefined;
    if (option && !past && useReal && expirySel !== null && rowSel && legSel) {
      const premium = midPrice(legSel.bid, legSel.ask, legSel.last);
      if (premium === null) return setError("That contract has no price right now. Pick another strike.");
      realLeg = { contractSymbol: legSel.contractSymbol, premium, strike: rowSel.strike, iv: legIv };
      expiryMs = expirySel;
    } else if (option && !past && estMode && expirySel !== null && kEst !== null && spotNow !== null) {
      strikePct = Math.round((kEst / spotNow) * 10000) / 100;
      if (!(strikePct >= 50 && strikePct <= 150)) return setError("Strike must be between 50% and 150% of the entry price.");
      expiryMs = expirySel;
    } else if (option) {
      strikePct = Number(strike);
      if (!(strikePct >= 50 && strikePct <= 150)) return setError("Strike must be between 50% and 150% of the entry price.");
      expiryMs = parseDay(expiry);
      if (Number.isNaN(expiryMs) || expiryMs < startMs + DAY_MS) return setError("Expiry must be at least a day after the start.");
      if (expiryMs > startMs + MAX_EXPIRY_MS) return setError("Expiry can be at most 2 years after the start.");
    } else if (end) {
      endMs = parseDay(end);
      if (Number.isNaN(endMs) || endMs <= startMs) return setError("End date must be after the start.");
    }
    const tp = target.trim() === "" ? undefined : Number(target);
    const sl = stop.trim() === "" ? undefined : Number(stop);
    if (tp !== undefined && !(tp > 0 && tp <= (isSold ? 100 : MAX_TARGET_PCT))) return setError(isSold ? "Take-profit must be between 0 and 100% of the premium." : `Take-profit must be between 0 and ${MAX_TARGET_PCT}%.`);
    const maxStop = isSold ? MAX_SOLD_STOP_PCT : MAX_STOP_PCT;
    if (sl !== undefined && !(sl > 0 && sl <= maxStop)) return setError(`Stop-loss must be between 0 and ${maxStop}%.`);

    setBusy(true);
    try {
      const sym = toYahoo(picked.id);
      let entryPrice: number | undefined;
      let sigma: number | undefined;
      if (past) {
        const res = await fetch(`/api/history?symbol=${encodeURIComponent(sym)}&from=${histFrom(startMs, side)}`);
        const body = (await res.json().catch(() => null)) as { bars?: Bar[]; message?: string } | null;
        if (!res.ok || !body?.bars) return setError(body?.message ?? "Could not load price history.");
        if (!body.bars.some((b) => b.t >= startMs)) return setError("No trading day on or after that date yet.");
        if (option) sigma = histVol(body.bars, startMs) ?? undefined;
      } else {
        const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(sym)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { quotes?: QuoteDTO[] } | null;
        const price = body?.quotes?.[0]?.price;
        if (!res.ok || typeof price !== "number" || !(price > 0)) return setError("Could not get a current price for that stock.");
        entryPrice = price;
        if (realLeg?.iv && realLeg.iv > 0) {
          sigma = Math.min(Math.max(realLeg.iv, MIN_SIGMA), MAX_SIGMA);
        } else if (option) {
          // volatility from the 30 bars before today; if this fails the trade falls back at evaluation time
          const hr = await fetch(`/api/history?symbol=${encodeURIComponent(sym)}&from=${histFrom(startMs, side)}`).catch(() => null);
          const hb = (await hr?.json().catch(() => null)) as { bars?: Bar[] } | null;
          if (hr?.ok && hb?.bars) sigma = histVol(hb.bars, startMs) ?? undefined;
        }
      }
      const ok = add({
        side,
        reason: reason.trim(),
        symbol: picked.id,
        amount: amt,
        startMs,
        ...(isSold ? { sold: true } : {}),
        ...(entryPrice !== undefined ? { entryPrice } : {}),
        ...(tp !== undefined ? { targetPct: tp } : {}),
        ...(sl !== undefined ? { stopPct: sl } : {}),
        ...(endMs !== undefined ? { endMs } : {}),
        ...(expiryMs !== undefined ? { expiryMs, ...(strikePct !== undefined ? { strikePct } : {}) } : {}),
        ...(option ? { priceSource: realLeg ? ("real" as const) : ("est" as const) } : {}),
        ...(realLeg ? { contractSymbol: realLeg.contractSymbol, premium: realLeg.premium, strike: realLeg.strike } : {}),
        ...(sigma !== undefined ? { sigma } : {}),
      });
      if (!ok) return setError("Could not add the trade.");
      pickStock(null);
      setEnd("");
      setExpiry("");
      setTarget("");
      setStop("");
      setReason("");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Seg name="Trade type" options={MODES} value={mode} onChange={setMode} />
      {option && (
        <Seg
          name="Option trade"
          options={OPT_KINDS}
          value={optKind}
          onChange={(k) => {
            setSold(k.startsWith("sell"));
            setOptSide(k.endsWith("put") ? "put" : "call");
          }}
        />
      )}
      <p className="text-xs leading-snug text-muted">{EXPLAIN[option ? optKind : mode]}</p>
      <div>
        <span className={label}>Stock</span>
        <SymbolPicker picked={picked} onPick={pickStock} />
        {picked && (
          <p className="mt-1 flex items-baseline gap-1.5 text-xs text-muted">
            Current price{" "}
            {pq?.price != null ? (
              <>
                <span className="font-semibold text-ink">
                  {fmtNum(pq.price, priceDigits(pq.price, picked.id))} {pq.currency ?? ""}
                </span>
                {pq.change != null && <Change value={pq.change} pct={pq.changePct} />}
                <span>today</span>
              </>
            ) : (
              <span>{pickedQuote.error ? "unavailable" : "…"}</span>
            )}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="trade-amount" className={label}>
          {isSold ? "Premium to collect" : "Amount to invest"}
        </label>
        <input id="trade-amount" type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} />
      </div>
      <fieldset>
        <legend className={label}>Start</legend>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Start" className="flex gap-0.5 rounded-md bg-panel2 p-0.5">
            {[
              { v: false, l: "Today" },
              { v: true, l: "Past date" },
            ].map((o) => (
              <button
                key={o.l}
                type="button"
                role="radio"
                aria-checked={past === o.v}
                onClick={() => setPast(o.v)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${past === o.v ? "bg-accent text-accentink" : "text-muted hover:text-ink"}`}
              >
                {o.l}
              </button>
            ))}
          </div>
          {past && (
            <input type="date" aria-label="Start date" value={start} min={oldest} max={today} onChange={(e) => setStart(e.target.value)} className={`${input} min-w-0 flex-1`} />
          )}
        </div>
        <p className="mt-1 text-xs text-muted">
          {past
            ? `Enters at the close of the first trading day on or after that date.${option ? " Option prices are Black-Scholes estimates." : ""}`
            : option && picked
              ? chainLoading
                ? "Looking for Yahoo option prices…"
                : useReal
                  ? "Enters at the current price, using the Yahoo option mid price."
                  : estMode
                    ? "Enters at the current price. This date has no Yahoo quotes: premium is a Black-Scholes estimate."
                    : "No Yahoo option prices for this stock: using a Black-Scholes estimate."
              : "Enters at the current price."}
        </p>
      </fieldset>
      {option && !past && chain && days.length > 0 && expirySel !== null ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="trade-rexpiry" className={label}>
              Expiry
            </label>
            <select id="trade-rexpiry" value={expirySel} onChange={(e) => setRealExpiry(Number(e.target.value))} className={input}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {fmtDay(d)}
                  {listedDays.has(d) ? " · Yahoo" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="trade-rstrike" className={label}>
              Strike <span className="font-normal">(premium)</span>
            </label>
            <select id="trade-rstrike" value={kSel !== null ? String(kSel) : ""} onChange={(e) => setRealStrike(e.target.value)} className={input}>
              {useReal
                ? strikeRows.map((r) => {
                    const l = legOf(r)!;
                    return (
                      <option key={r.strike} value={String(r.strike)}>
                        {fmtNum(r.strike, r.strike < 1 ? 3 : 2)} — {fmtPrem(midPrice(l.bid, l.ask, l.last))}
                      </option>
                    );
                  })
                : estStrikes.map((k) => (
                    <option key={k} value={String(k)}>
                      {fmtNum(k, k < 1 ? 3 : 2)} — {fmtPrem(estPrem(k))} est.
                    </option>
                  ))}
            </select>
          </div>
        </div>
      ) : option ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="trade-strike" className={label}>
              Strike % <span className="font-normal">(of entry)</span>
            </label>
            <input id="trade-strike" type="number" inputMode="decimal" min="50" max="150" step="any" value={strike} onChange={(e) => setStrike(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="trade-expiry" className={label}>
              Expiry date
            </label>
            <input id="trade-expiry" type="date" value={expiry} min={past && start ? start : today} onChange={(e) => setExpiry(e.target.value)} className={input} />
          </div>
        </div>
      ) : (
        <div>
          <label htmlFor="trade-end" className={label}>
            End date <span className="font-normal">(optional)</span>
          </label>
          <input id="trade-end" type="date" value={end} min={past && start ? start : today} onChange={(e) => setEnd(e.target.value)} className={input} />
        </div>
      )}
      {option && (
        <p className="rounded-md bg-panel2 px-2 py-1.5 text-xs leading-snug text-muted">
          {summary ? (
            <>
              ≈ <span className="font-semibold text-ink">{fmtNum(summary.contracts, summary.contracts < 10 ? 2 : 1)}</span> contracts (1 contract = 100 shares, costs{" "}
              {money((prem ?? 0) * 100)}) · Breakeven <span className="font-semibold text-ink">{fmtNum(summary.breakeven, 2)}</span> · Max loss{" "}
              <span className="font-semibold text-loss">{money(summary.maxLoss)}</span> · Max profit <span className="font-semibold text-gain">{money(summary.maxProfit)}</span>
            </>
          ) : (
            `Breakeven = strike ${optSide === "call" ? "+" : "−"} premium. 1 contract = 100 shares. Contracts and breakeven show here when real Yahoo option prices are available (Today start).`
          )}
        </p>
      )}
      {option && !past && now && analytics && analytics.premium !== null && kSel !== null && expirySel !== null && amt > 0 && (
        <TradeRisk
          spot={analytics.spot}
          call={optSide === "call"}
          sold={sold}
          strike={kSel}
          premium={analytics.premium}
          amount={amt}
          sigma={Math.min(Math.max(analytics.iv ?? analytics.hv ?? DEFAULT_SIGMA, MIN_SIGMA), MAX_SIGMA)}
          expiryMs={expiryCloseMs(expirySel)}
          now={now}
          leg={useReal ? legSel : null}
          rows={useReal ? (chain?.strikes ?? null) : null}
          marketState={pq?.marketState ?? null}
          earningsMs={earnApi.data?.details?.events?.earningsDate ?? null}
          exDivMs={earnApi.data?.details?.dividends?.exDate ?? null}
        />
      )}
      {analytics && (
        <div className="rounded-md bg-panel2 px-2 py-1.5 text-xs leading-snug">
          <p className="mb-0.5 font-medium text-muted">Analytics <span className="font-normal">(past data, not a prediction)</span></p>
          {(() => {
            const sp = (v: number) => `${v >= 0 ? "+" : "−"}${fmtNum(Math.abs(v) * 100, 1)}%`;
            const rows: { k: string; tip: string; v: ReactNode }[] = [];
            const { stats, g, be, spot, premium } = analytics;
            if (stats)
              rows.push({
                k: `Typical ${analytics.horizon === SHARE_HORIZON && !analytics.hasExp ? "1-week" : `${analytics.horizon}-day`} move`,
                tip: "How far this stock's price usually moved (up or down) over a period this long in the past year. The range shows where 80% of those periods ended up.",
                v: (
                  <>
                    <span className="font-semibold text-ink">±{fmtNum(stats.typical * 100, 1)}%</span> <span className="text-muted">(80%: {sp(stats.p10)} to {sp(stats.p90)})</span>
                  </>
                ),
              });
            if (stats && be !== null && option) {
              const d = be / spot - 1;
              const buyerHit = hitRate(stats.moves, d, optSide === "call");
              if (buyerHit !== null) {
                const p = isSold ? 1 - buyerHit : buyerHit;
                rows.push({
                  k: isSold ? "Chance it stays safe" : "Chance to pass breakeven",
                  tip: `Breakeven is ${fmtNum(be, 2)}, which needs the price to ${d >= 0 ? "rise" : "fall"} ${fmtNum(Math.abs(d) * 100, 1)}% from ${fmtNum(spot, 2)}. This is the share of past periods of the same length that moved at least that far. ${isSold ? "For a sold option you win when it does NOT get there, so this is the opposite share. " : ""}It is history, not a forecast.`,
                  v: (
                    <>
                      <span className="font-semibold text-ink">{fmtNum(p * 100, 0)}%</span> <span className="text-muted">({optSide === "call" ? "rise" : "fall"} of {fmtNum(Math.abs(d) * 100, 1)}% needed)</span>
                    </>
                  ),
                });
              }
            }
            if (analytics.iv !== null && analytics.hv !== null && option) {
              const ratio = analytics.iv / analytics.hv;
              const verdict = ratio > 1.25 ? "priced high" : ratio < 0.8 ? "priced low" : "fairly priced";
              const em = impliedMove(spot, analytics.iv, analytics.calDays);
              rows.push({
                k: "Implied vs past volatility",
                tip: "Implied volatility (IV) is how jumpy the options market expects the stock to be. Historical volatility (HV) is how jumpy it has actually been lately. IV well above HV means options are expensive (good for sellers); well below means they are cheap (good for buyers).",
                v: (
                  <>
                    <span className="font-semibold text-ink">{fmtNum(analytics.iv * 100, 0)}% vs {fmtNum(analytics.hv * 100, 0)}%</span> <span className="text-muted">({verdict})</span>
                  </>
                ),
              });
              rows.push({
                k: "Market-expected move",
                tip: "The typical move by expiry that option prices imply (one standard deviation, about a 68% range): price × IV × √(days/365).",
                v: (
                  <span className="font-semibold text-ink">
                    ±${fmtNum(em.dollars, 2)} (±{fmtNum(em.pct * 100, 1)}%)
                  </span>
                ),
              });
            }
            if (g && premium !== null && premium > 0 && amt > 0) {
              const sign = isSold ? -1 : 1;
              const theta = g.thetaDay * (amt / premium) * sign;
              rows.push({
                k: "Delta / time decay",
                tip: `Delta ${fmtNum(g.delta * sign, 2)}: the option's value moves about $${fmtNum(Math.abs(g.delta), 2)} for each $1 the stock moves${isSold ? " (shown for you as the seller)" : ""}. Also roughly the model's ${fmtNum(g.probItm * 100, 0)}% chance of finishing in the money (Black-Scholes estimate). Time decay is how much value your whole position gains or loses each calendar day just from time passing.`,
                v: (
                  <>
                    <span className="font-semibold text-ink">{g.delta * sign < 0 ? "−" : ""}{fmtNum(Math.abs(g.delta), 2)}</span> <span className="text-muted">(~{fmtNum(g.probItm * 100, 0)}% to expire in the money)</span>{" "}
                    <span className={`font-semibold ${theta < 0 ? "text-loss" : "text-gain"}`}>{theta < 0 ? "−" : "+"}${fmtNum(Math.abs(theta), 0)}/day</span>
                  </>
                ),
              });
            }
            if (analytics.trend !== null)
              rows.push({
                k: "1-month trend",
                tip: "How much the price changed over the last ~21 trading days. A strong trend can continue or reverse, so it is context, not a signal.",
                v: <span className={`font-semibold ${analytics.trend >= 0 ? "text-gain" : "text-loss"}`}>{sp(analytics.trend)}</span>,
              });
            if (analytics.range !== null)
              rows.push({
                k: "52-week range",
                tip: "Where the price sits between its lowest (0%) and highest (100%) close of the past year.",
                v: <span className="font-semibold text-ink">{fmtNum(analytics.range * 100, 0)}% of the way up</span>,
              });
            if (analytics.earnings)
              rows.push({
                k: "Earnings before expiry",
                tip: "Companies report results on this date. Prices often jump or drop sharply on the news, and option prices usually fall afterwards.",
                v: <span className="font-semibold text-loss">{new Date(analytics.earnings.ms).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}{analytics.earnings.est ? " (est.)" : ""}, big moves likely</span>,
              });
            return rows.map((r) => (
              <div key={r.k} title={r.tip} className="flex cursor-help items-baseline justify-between gap-2 py-px">
                <span className="shrink-0 text-muted">{r.k}</span>
                <span className="text-right">{r.v}</span>
              </div>
            ));
          })()}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="trade-target" className={label}>
            {isSold ? "Take profit % (value fell)" : option ? "Take profit % (value)" : "Take profit %"} <span className="font-normal">(opt.)</span>
          </label>
          <input id="trade-target" type="number" inputMode="decimal" min="0" step="any" placeholder={isSold ? "e.g. 50" : option ? "e.g. 100" : "e.g. 10"} value={target} onChange={(e) => setTarget(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="trade-stop" className={label}>
            {isSold ? "Stop loss % (value rose)" : option ? "Stop loss % (value)" : "Stop loss %"} <span className="font-normal">(opt.)</span>
          </label>
          <input id="trade-stop" type="number" inputMode="decimal" min="0" step="any" placeholder={isSold ? "e.g. 100" : option ? "e.g. 50" : "e.g. 5"} value={stop} onChange={(e) => setStop(e.target.value)} className={input} />
        </div>
      </div>
      <div>
        <label htmlFor="trade-reason" className={label}>
          Why am I taking this trade?
        </label>
        <textarea id="trade-reason" rows={2} maxLength={MAX_REASON_LEN} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Earnings beat, breaking resistance" className={`${input} h-auto resize-none py-1`} />
      </div>
      {(error || note) && (
        <p role={error ? "alert" : undefined} className={`text-xs ${error ? "text-loss" : "text-muted"}`}>
          {error || note}
        </p>
      )}
      <button type="submit" disabled={busy || disabled} className="h-8 w-full rounded-md bg-accent text-sm font-semibold text-accentink hover:opacity-90 disabled:opacity-50">
        {busy ? "Starting..." : "Start test trade"}
      </button>
    </form>
  );
}

/* ---- results ---- */

function Stat({ name, children, hint }: { name: string; children: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-1.5" title={hint}>
      <div className="text-xs text-muted">{name}</div>
      <div className="text-base font-semibold tabular-nums">{children}</div>
    </div>
  );
}

function rulesText(t: Trade): string {
  const parts: string[] = [];
  const [up, down] = t.side === "short" || t.sold ? ["−", "+"] : ["+", "−"];
  if (t.targetPct !== undefined) parts.push(`Target ${up}${fmtNum(t.targetPct, 1)}%`);
  if (t.stopPct !== undefined) parts.push(`Stop ${down}${fmtNum(t.stopPct, 1)}%`);
  if (t.endMs !== undefined) parts.push(`Ends ${fmtDay(t.endMs)}`);
  if (t.expiryMs !== undefined) parts.push(`Expires ${fmtDay(t.expiryMs)}`);
  return parts.join(" · ") || "No end rules";
}

const th = "px-2 py-1.5 text-left text-xs font-medium whitespace-nowrap text-muted";
const td = "px-2 py-1.5 align-middle whitespace-nowrap tabular-nums";

export function TradesView() {
  const acct = useAccount();
  const { trades, ready, error, full, add, remove, close, setReview } = useTrades();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("open");
  const hist = useHistories(trades);
  const symbols = [...new Set(trades.map((t) => toYahoo(t.symbol)))].join(",");
  const quotes = useApi<{ quotes: QuoteDTO[] }>(symbols ? `/api/quotes?symbols=${symbols}` : null, 60_000);
  const quoteOf = useMemo(() => new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q])), [quotes.data]);
  // Real-priced option trades that have not been closed by hand: fetch their contract quotes and daily closes.
  const live = trades.filter((t) => t.contractSymbol && t.closedMs === undefined && (!now || t.expiryMs! + 5 * DAY_MS > now));
  const contractsUrl = live.length
    ? `/api/options?contracts=${live.map((t) => t.contractSymbol).join(",")}&from=${Math.max(Math.min(...live.map((t) => t.startMs)) - 2 * DAY_MS, (now ?? 0) - 700 * DAY_MS)}`
    : null;
  const contracts = useApi<{ quotes: ContractQuote[] }>(contractsUrl, 120_000);
  const contractOf = useMemo(() => new Map((contracts.data?.quotes ?? []).map((c) => [c.contractSymbol, c])), [contracts.data]);

  const rows = useMemo(
    () =>
      trades.map((t) => {
        const q = quoteOf.get(toYahoo(t.symbol));
        const cq = t.contractSymbol ? contractOf.get(t.contractSymbol) : undefined;
        const h = hist[histKey(t)];
        const loading = needsBars(t) && !h;
        const bars = h && "bars" in h ? h.bars : [];
        const result: TradeResult | null = now && !loading ? evaluate(t, bars, q?.price, now, cq ? { quote: cq.mark, bars: cq.bars } : undefined) : null;
        return { t, q, cq, result, loading, failed: h && "error" in h ? h.error : null };
      }),
    [trades, quoteOf, contractOf, hist, now],
  );
  const stats = useMemo(() => summarise(rows.map((r) => r.result)), [rows]);
  const currencies = new Set(rows.map((r) => r.q?.currency).filter(Boolean));
  const unit = currencies.size === 1 ? ` ${[...currencies][0]}` : "";
  const shown = rows.filter((r) => (tab === "all" ? true : tab === "open" ? !r.result || r.result.status === "open" : !!r.result && r.result.status !== "open"));
  const ccy = (c: string | null | undefined) => (c ? ` ${c}` : "");

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <p className="shrink-0 rounded-md border border-line bg-panel px-3 py-1.5 text-xs leading-snug text-muted">
        <strong className="font-semibold text-ink">For testing and learning only.</strong> Simulated trades, no real money. Stock prices are real (Yahoo, delayed ~20 min). Full caveats at
        the bottom.
      </p>
      <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4">
        <Stat name="Trades">{stats.count}</Stat>
        <Stat name="Total invested" hint={`Sold options count as 0 cash out; the premium collected is not included.${currencies.size > 1 ? " Mixed currencies are added together without conversion." : ""}`}>
          {fmtNum(stats.invested)}
          {unit}
        </Stat>
        <Stat name="Total P/L" hint={currencies.size > 1 ? "Mixed currencies are added together without conversion." : undefined}>
          {stats.count ? <Change value={stats.pl} pct={stats.invested ? (stats.pl / stats.invested) * 100 : 0} /> : "—"}
        </Stat>
        <Stat name="Win rate" hint="Share of trades currently above their entry price.">
          {stats.winRate === null ? "—" : `${fmtNum(stats.winRate, 0)}%`}
        </Stat>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[28rem_minmax(0,1fr)]">
        <Panel title="New test trade" bodyClass="flex flex-col gap-3 overflow-auto p-3">
          <NewTradeForm
            add={add}
            disabled={!ready || error || full}
            note={full ? `You have ${MAX_TRADES} trades, the limit. Delete one to add another.` : error ? "Your saved trades could not be loaded, so adding is paused. Reload to retry." : undefined}
          />
        </Panel>
        <Panel title="Your trades" right={<Tabs tabs={TABS} value={tab} onChange={setTab} label="Trade filter" />} bodyClass="overflow-auto">
          {!ready || !now ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : shown.length === 0 ? (
            <p className="p-4 text-sm text-muted">
              {trades.length === 0
                ? "No trades yet. Pick a stock and an amount on the left to see how it would have played out."
                : `No ${tab} trades.`}
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-panel">
                <tr className="border-b border-line">
                  <th className={th}>Stock</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Invested</th>
                  <th className={`${th} text-right`} title="Price per share when the trade opened. For options, the premium per share.">
                    Entry / share
                  </th>
                  <th className={`${th} text-right`} title="Current price per share, or the exit price if closed.">
                    Now / share
                  </th>
                  <th className={`${th} text-right`}>P/L</th>
                  <th className={`${th} text-right`}>Days</th>
                  <th className={th}>Rules</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ t, q, cq, result: r, loading, failed }) => {
                  const digits = priceDigits(r?.entry ?? q?.price, t.symbol);
                  const c = ccy(q?.currency);
                  const st = r ? STATUS[r.status] : null;
                  const opt = isOption(t.side);
                  const stockNow = t.closePrice ?? q?.price ?? null;
                  return (
                    <tr key={t.id} className="border-b border-line/60 last:border-0">
                      <td className={`${td} font-sans`}>
                        <Link href={`/stock/${encodeURIComponent(t.symbol)}`} className="font-semibold text-accent hover:underline">
                          {q?.code ?? t.symbol}
                        </Link>
                        <div className="flex max-w-[22ch] items-center gap-1 text-xs text-muted">
                          {badgeOf(t) && (
                            <span className={`shrink-0 rounded px-1 text-[10px] font-semibold uppercase ${t.side === "short" || t.sold ? "bg-loss/15 text-loss" : "bg-accent/15 text-accent"}`}>{badgeOf(t)}</span>
                          )}
                          <span className="truncate" title={q?.name}>
                            {q?.name ?? " "}
                          </span>
                        </div>
                      </td>
                      <td className={td}>
                        {st ? (
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                        ) : (
                          <span className="text-xs text-muted">{loading ? "Loading…" : "—"}</span>
                        )}
                      </td>
                      <td className={`${td} text-right`}>
                        {fmtNum(t.amount)}
                        <span className="text-xs text-muted">{c}</span>
                        {t.sold && <div className="text-xs text-muted">premium</div>}
                      </td>
                      <td className={`${td} text-right`}>
                        {r?.entry != null ? fmtNum(r.entry, digits) : <span className="text-xs text-muted">{failed ? "No history" : loading ? "…" : "Waiting"}</span>}
                        {opt && r?.spot != null && <div className="text-xs text-muted">stock {fmtNum(r.spot, priceDigits(r.spot, t.symbol))}</div>}
                        <div className="text-xs text-muted">
                          {r?.strike != null ? `strike ${fmtNum(r.strike, priceDigits(r.spot, t.symbol))}` : fmtDay(t.startMs)}
                          {opt && (
                            <span className="ml-1 rounded bg-panel2 px-1 text-[10px]" title={t.priceSource === "real" ? "Priced from a Yahoo option contract" : "Black-Scholes estimate"}>
                              {t.priceSource === "real" ? "real" : "est."}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`${td} text-right`}>
                        {r?.mark != null ? fmtNum(r.mark, digits) : "—"}
                        {opt && stockNow != null && <div className="text-xs text-muted">stock {fmtNum(stockNow, priceDigits(stockNow, t.symbol))}</div>}
                        <div className="text-xs text-muted">{r?.exit != null ? "exit" : "current"}{opt ? " (option)" : ""}</div>
                      </td>
                      <td className={`${td} text-right`}>{r && r.pl !== null ? <Change value={r.pl} pct={r.plPct} /> : "—"}</td>
                      <td className={`${td} text-right`}>{r ? r.days : "—"}</td>
                      <td className={`${td} text-xs text-muted`}>
                        {rulesText(t)}
                        {t.sold && r && r.maxLoss !== undefined && <div className="text-loss">Max loss: {r.maxLoss === null ? "unlimited" : `${fmtNum(r.maxLoss)}${c}`}</div>}
                      </td>
                      <td className={`${td} text-right`}>
                        <div className="flex justify-end gap-1.5">
                          {r?.status === "open" && r.entry !== null && (
                            <button
                              type="button"
                              disabled={!(q?.price && q.price > 0)}
                              onClick={() => q?.price && close(t.id, q.price, cq?.mark ?? undefined)}
                              title="Close this trade at the current price"
                              className="rounded border border-line px-2 py-0.5 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                              Close
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => remove(t.id)}
                            aria-label={`Delete ${q?.code ?? t.symbol} trade`}
                            title="Delete this trade"
                            className="rounded border border-line px-2 py-0.5 text-xs font-medium text-muted hover:border-loss hover:text-loss"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
      {now && (
        <div className="shrink-0">
          <TradeJournal rows={rows.map((r) => ({ trade: r.t, result: r.result, price: r.q?.price ?? null, code: r.q?.code ?? r.t.symbol }))} now={now} onReview={setReview} />
        </div>
      )}
      <p className="shrink-0 rounded-md border border-line bg-panel px-3 py-1.5 text-xs leading-snug text-muted">
        Simulated: no real money. Ignores fees, dividends, tax and currency conversion. Option prices are Yahoo quotes (delayed) when a chain exists, otherwise Black-Scholes estimates.
        Selling options can lose more than the premium; sold calls have unlimited risk. Shorts ignore borrow fees and margin.
        {acct.loaded && !acct.user && " Saved in this browser only. Log in to keep your trades on your account."} Not financial advice (see the{" "}
        <Link href="/legal" className="text-accent hover:underline">
          disclaimer
        </Link>
        ).
      </p>
    </div>
  );
}
