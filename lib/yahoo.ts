import "server-only";
import YahooFinance from "yahoo-finance2";
import { TtlCache } from "@/lib/cache";
import { keepLastSessions, rangeParams, rangeTtlMs, type Range } from "@/lib/ranges";
import { calcChange } from "@/lib/aggregate";
import { getStockFeedItems, mergeNews } from "@/lib/feeds";
import { displayCode, fromYahoo, isValidId, marketOf } from "@/lib/symbols";

/* ---------- config ---------- */

const seconds = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return (Number.isFinite(n) && n > 0 ? n : fallback) * 1000;
};
const QUOTE_TTL = seconds("QUOTE_TTL_SECONDS", 60);
const HISTORY_TTL_S = Number(process.env.HISTORY_TTL_SECONDS) > 0 ? Number(process.env.HISTORY_TTL_SECONDS) : 600;
const NEWS_TTL = seconds("NEWS_TTL_SECONDS", 300);
const DETAILS_TTL = 6 * 3600_000;
// How long past expiry a cached value is still served instantly while a background refresh runs.
const QUOTE_SWR = 10 * 60_000;
const HISTORY_SWR = 3600_000;
const NEWS_SWR = 30 * 60_000;
const DETAILS_SWR = 24 * 3600_000;

/* ---------- shared singletons (survive dev HMR) ---------- */

interface Shared {
  yf: InstanceType<typeof YahooFinance>;
  quotes: TtlCache<QuoteDTO>;
  charts: TtlCache<ChartDTO>;
  news: TtlCache<NewsItem[]>;
  marketNews: TtlCache<MarketNewsItem[]>;
  search: TtlCache<SearchHit[]>;
  details: TtlCache<StockDetails>;
}
const g = globalThis as unknown as { __asx4?: Shared };
// Bump the key when Shared gains a field, so a dev server keeps no stale shape across HMR.
const shared: Shared = (g.__asx4 ??= {
  yf: new YahooFinance({ suppressNotices: ["yahooSurvey"] }),
  quotes: new TtlCache<QuoteDTO>(1000),
  charts: new TtlCache<ChartDTO>(300),
  news: new TtlCache<NewsItem[]>(300),
  marketNews: new TtlCache<MarketNewsItem[]>(50),
  search: new TtlCache<SearchHit[]>(300),
  details: new TtlCache<StockDetails>(500),
});
const { yf } = shared;
const OPTS = { validateResult: false } as const;

/* ---------- types ---------- */

export interface QuoteDTO {
  symbol: string;
  /** stock id ("BHP", "AAPL.US"); indices and FX keep their Yahoo symbol */
  code: string;
  name: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  prevClose: number | null;
  volume: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  pe: number | null;
  /** percent, e.g. 4.2 means 4.2% */
  dividendYield: number | null;
  high52: number | null;
  low52: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  currency: string | null;
  marketState: string | null;
  time: number | null;
}

export interface ChartPoint {
  t: number;
  close: number;
  volume: number | null;
}
export interface ChartDTO {
  symbol: string;
  range: Range;
  points: ChartPoint[];
  prevClose: number | null;
}
export interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  time: number | null;
  /** which feed supplied it, when not Yahoo */
  source?: string;
}
export interface SearchHit {
  /** stock id, see lib/symbols.ts */
  id: string;
  code: string;
  market: string;
  symbol: string;
  name: string;
  type: string;
}

/** Everything below is nullable: Yahoo omits fields per stock and per market. */
export interface StockDetails {
  profile: {
    summary: string | null;
    website: string | null;
    employees: number | null;
    city: string | null;
    country: string | null;
    sector: string | null;
    industry: string | null;
  };
  valuation: {
    forwardPE: number | null;
    peg: number | null;
    priceToBook: number | null;
    priceToSales: number | null;
    enterpriseValue: number | null;
    evToEbitda: number | null;
    evToRevenue: number | null;
    trailingEps: number | null;
    forwardEps: number | null;
    beta: number | null;
    fiftyDayAvg: number | null;
    twoHundredDayAvg: number | null;
    /** fraction, 0.12 = +12% */
    change52w: number | null;
    open: number | null;
  };
  dividends: {
    rate: number | null;
    /** fraction */
    yield: number | null;
    payoutRatio: number | null;
    exDate: number | null;
    /** already a percent in Yahoo, e.g. 3.1 */
    fiveYearAvgYield: number | null;
    lastValue: number | null;
    lastDate: number | null;
  };
  /** May differ from the quote currency (BHP reports in USD). */
  financialCurrency: string | null;
  financials: {
    revenue: number | null;
    revenueGrowth: number | null;
    grossMargins: number | null;
    operatingMargins: number | null;
    profitMargins: number | null;
    ebitda: number | null;
    netIncome: number | null;
    freeCashflow: number | null;
    operatingCashflow: number | null;
    totalCash: number | null;
    totalDebt: number | null;
    /** Yahoo's percent-ish number, e.g. 50.47 */
    debtToEquity: number | null;
    currentRatio: number | null;
    quickRatio: number | null;
    roe: number | null;
    roa: number | null;
    earningsGrowth: number | null;
    mostRecentQuarter: number | null;
    lastFiscalYearEnd: number | null;
  };
  analysts: {
    recommendationKey: string | null;
    /** 1 = strong buy ... 5 = strong sell */
    recommendationMean: number | null;
    count: number | null;
    targetLow: number | null;
    targetMean: number | null;
    targetMedian: number | null;
    targetHigh: number | null;
    trend: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
  };
  events: {
    earningsDate: number | null;
    earningsEstimate: boolean | null;
  };
  ownership: {
    insidersPct: number | null;
    institutionsPct: number | null;
    sharesOutstanding: number | null;
    floatShares: number | null;
  };
}

/* ---------- helpers ---------- */

type Raw = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  return null;
}

export function mapQuote(r: Raw): QuoteDTO {
  const symbol = String(r.symbol ?? "");
  const price = num(r.regularMarketPrice);
  const prevClose = num(r.regularMarketPreviousClose);
  const derived = calcChange(price, prevClose);
  const dy = num(r.dividendYield) ?? (num(r.trailingAnnualDividendYield) !== null ? num(r.trailingAnnualDividendYield)! * 100 : null);
  return {
    symbol,
    code: fromYahoo(symbol),
    name: str(r.longName) ?? str(r.shortName) ?? symbol,
    price,
    change: num(r.regularMarketChange) ?? derived.change,
    changePct: num(r.regularMarketChangePercent) ?? derived.changePct,
    prevClose,
    volume: num(r.regularMarketVolume),
    avgVolume: num(r.averageDailyVolume3Month) ?? num(r.averageDailyVolume10Day),
    marketCap: num(r.marketCap),
    pe: num(r.trailingPE),
    dividendYield: dy,
    high52: num(r.fiftyTwoWeekHigh),
    low52: num(r.fiftyTwoWeekLow),
    dayHigh: num(r.regularMarketDayHigh),
    dayLow: num(r.regularMarketDayLow),
    currency: str(r.currency),
    marketState: str(r.marketState),
    time: toMs(r.regularMarketTime),
  };
}

/* ---------- quotes ---------- */

const BATCH = 50;

export interface QuotesResult {
  quotes: QuoteDTO[];
  /** symbols that could not be fetched because an upstream batch failed */
  failed: string[];
}

/**
 * Batched multi-symbol quote with a per-symbol cache. Symbols Yahoo does not
 * know are simply absent from the result.
 */
export async function getQuotes(symbols: string[]): Promise<QuotesResult> {
  const unique = [...new Set(symbols)];
  const found = new Map<string, QuoteDTO>();
  const missing: string[] = [];
  const revalidate: string[] = [];
  for (const s of unique) {
    const hit = shared.quotes.get(s);
    const recent = hit ? undefined : shared.quotes.getWithin(s, QUOTE_SWR);
    if (hit) found.set(s, hit);
    else if (recent) {
      // slightly old: answer now, refresh after the response
      found.set(s, recent);
      if (!refreshing.has(s)) revalidate.push(s);
    } else missing.push(s);
  }
  if (revalidate.length > 0) {
    revalidate.forEach((s) => refreshing.add(s));
    TtlCache.defer(
      fetchQuotes(revalidate, new Map())
        .catch(() => {})
        .finally(() => revalidate.forEach((s) => refreshing.delete(s))),
    );
  }

  const { failed, lastError } = await fetchQuotes(missing, found);
  if (failed.length > 0 && found.size === 0) throw lastError;
  return { quotes: unique.map((s) => found.get(s)).filter((q): q is QuoteDTO => !!q), failed };
}

/** Symbols with a background quote refresh in flight, so concurrent requests do not repeat it. */
const refreshing = new Set<string>();

/** Fetches quotes from Yahoo into the cache and `found`; falls back to stale values for failed batches. */
async function fetchQuotes(missing: string[], found: Map<string, QuoteDTO>) {
  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));

  const failed: string[] = [];
  let lastError: unknown;
  // Small concurrency to stay polite to Yahoo.
  for (let i = 0; i < batches.length; i += 3) {
    const group = batches.slice(i, i + 3);
    const results = await Promise.allSettled(group.map((b) => yf.quote(b, {}, OPTS) as Promise<Raw[]>));
    results.forEach((res, idx) => {
      const batch = group[idx];
      if (res.status === "fulfilled") {
        for (const raw of res.value) {
          const q = mapQuote(raw);
          shared.quotes.set(q.symbol, q, QUOTE_TTL);
          found.set(q.symbol, q);
        }
      } else {
        lastError = res.reason;
        for (const s of batch) {
          const stale = shared.quotes.getStale(s);
          if (stale) found.set(s, stale);
          else failed.push(s);
        }
      }
    });
  }
  return { failed, lastError };
}

export async function getQuote(symbol: string): Promise<QuoteDTO | null> {
  const { quotes } = await getQuotes([symbol]);
  return quotes[0] ?? null;
}

/* ---------- charts ---------- */

export async function getChart(symbol: string, range: Range): Promise<ChartDTO> {
  const key = `${symbol}|${range}`;
  return shared.charts.getOrLoad(
    key,
    rangeTtlMs(range, HISTORY_TTL_S),
    async () => {
      const p = rangeParams(range);
      const res = (await yf.chart(symbol, { period1: p.period1, interval: p.interval }, OPTS)) as unknown as {
        meta?: Raw;
        quotes?: Raw[];
      };
      let points: ChartPoint[] = [];
      for (const q of res.quotes ?? []) {
        const t = toMs(q.date);
        const close = num(q.close);
        if (t !== null && close !== null) points.push({ t, close, volume: num(q.volume) });
      }
      // meta.chartPreviousClose is the close before the whole fetched window (days
      // earlier for intraday ranges), not the previous session's close. Derive it
      // from the last bar before the first kept session instead.
      let prevClose = num(res.meta?.chartPreviousClose);
      if (p.sessions) {
        const kept = keepLastSessions(points, p.sessions);
        const before = kept.length ? points.filter((x) => x.t < kept[0].t) : [];
        if (before.length) prevClose = before[before.length - 1].close;
        points = kept;
      }
      return { symbol, range, points, prevClose };
    },
    { staleOnError: true, swrMs: HISTORY_SWR },
  );
}

/* ---------- news, search, profile ---------- */

const NEWS_MAX = 25;

export async function getNews(symbol: string): Promise<NewsItem[]> {
  return shared.news.getOrLoad(
    symbol,
    NEWS_TTL,
    async () => {
      // Yahoo and the extra feeds load in parallel; either may fail on its own.
      const yahoo = (async () => {
        // Yahoo's news search returns nothing for "BHP.AX"; "ASX:BHP" works.
        const terms = symbol.endsWith(".AX") ? [`ASX:${symbol.slice(0, -3)}`, symbol.slice(0, -3)] : [symbol];
        let news: Raw[] = [];
        for (const term of terms) {
          const res = (await yf.search(term, { quotesCount: 0, newsCount: 10 }, OPTS)) as unknown as { news?: Raw[] };
          news = res.news ?? [];
          if (news.length > 0) break;
        }
        return news
          .map((n) => ({
            title: str(n.title) ?? "",
            publisher: str(n.publisher) ?? "",
            link: str(n.link) ?? "",
            time: toMs(n.providerPublishTime),
            source: "Yahoo Finance",
          }))
          .filter((n) => n.title && /^https?:\/\//.test(n.link));
      })();
      const extra = (async (): Promise<NewsItem[]> => {
        try {
          const name = (await getQuote(symbol))?.name || displayCode(fromYahoo(symbol));
          const us = /^[A-Z]{1,5}(-[A-Z])?$/.test(symbol) ? symbol : null;
          return await getStockFeedItems(name, us);
        } catch {
          return [];
        }
      })();
      const [y, e] = await Promise.allSettled([yahoo, extra]);
      if (y.status === "rejected" && (e.status === "rejected" || e.value.length === 0)) throw y.reason;
      return mergeNews([...(y.status === "fulfilled" ? y.value : []), ...(e.status === "fulfilled" ? e.value : [])], NEWS_MAX);
    },
    { staleOnError: true, swrMs: NEWS_SWR },
  );
}

export interface MarketNewsItem extends NewsItem {
  /** Yahoo symbols Yahoo links to the story */
  tickers: string[];
}

const TICKER_RE = /^[A-Z0-9.^=-]{1,14}$/;

/** Headlines for one search term, with the tickers Yahoo tags them with. */
export async function getTermNews(term: string): Promise<MarketNewsItem[]> {
  return shared.marketNews.getOrLoad(
    term,
    NEWS_TTL,
    async () => {
      const res = (await yf.search(term, { quotesCount: 0, newsCount: 12 }, OPTS)) as unknown as { news?: Raw[] };
      return (res.news ?? [])
        .map((n) => ({
          title: str(n.title) ?? "",
          publisher: str(n.publisher) ?? "",
          link: str(n.link) ?? "",
          time: toMs(n.providerPublishTime),
          source: "Yahoo Finance",
          tickers: [
            ...new Set(
              (Array.isArray(n.relatedTickers) ? n.relatedTickers : []).filter(
                (t): t is string => typeof t === "string" && TICKER_RE.test(t),
              ),
            ),
          ].slice(0, 8),
        }))
        .filter((n) => n.title && /^https?:\/\//.test(n.link));
    },
    { staleOnError: true, swrMs: NEWS_SWR },
  );
}

/** Yahoo exchange codes for the US listings we accept (others, e.g. OTC, are dropped). */
const US_EXCHANGES = new Set(["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BTS", "NAS"]);

/** Equities and ETFs on the markets in lib/markets.ts. */
export async function searchStocks(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  return shared.search.getOrLoad(
    q,
    NEWS_TTL,
    async () => {
      const res = (await yf.search(q, { quotesCount: 20, newsCount: 0 }, OPTS)) as unknown as { quotes?: Raw[] };
      const hits: SearchHit[] = [];
      for (const r of res.quotes ?? []) {
        const symbol = str(r.symbol);
        const type = str(r.quoteType) ?? "";
        if (!symbol || (type !== "EQUITY" && type !== "ETF")) continue;
        if (!symbol.includes(".") && !US_EXCHANGES.has(str(r.exchange) ?? "")) continue;
        const id = fromYahoo(symbol);
        if (!isValidId(id)) continue;
        hits.push({
          id,
          symbol,
          code: displayCode(id),
          market: marketOf(id),
          name: str(r.longname) ?? str(r.shortname) ?? symbol,
          type,
        });
      }
      return hits.slice(0, 10);
    },
    { staleOnError: true, swrMs: HISTORY_SWR },
  );
}


/* ---------- details ---------- */

const rec = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});

/** Pure mapping of a quoteSummary result, so it can be tested without the network. */
export function mapDetails(res: Raw): StockDetails {
  const a = rec(res.assetProfile);
  const b = rec(res.summaryProfile);
  const sd = rec(res.summaryDetail);
  const ks = rec(res.defaultKeyStatistics);
  const fd = rec(res.financialData);
  const ce = rec(res.calendarEvents);
  const earn = rec(ce.earnings);
  const earnDates = Array.isArray(earn.earningsDate) ? earn.earningsDate : [];
  const trendRows = rec(res.recommendationTrend).trend;
  const t = Array.isArray(trendRows) && trendRows[0] ? rec(trendRows[0]) : null;
  const site = str(a.website) ?? str(b.website);
  return {
    profile: {
      summary: str(a.longBusinessSummary) ?? str(b.longBusinessSummary),
      website: site && /^https?:\/\//i.test(site) ? site : null,
      employees: num(a.fullTimeEmployees) ?? num(b.fullTimeEmployees),
      city: str(a.city) ?? str(b.city),
      country: str(a.country) ?? str(b.country),
      sector: str(a.sector) ?? str(b.sector),
      industry: str(a.industry) ?? str(b.industry),
    },
    valuation: {
      forwardPE: num(sd.forwardPE) ?? num(ks.forwardPE),
      peg: num(ks.pegRatio),
      priceToBook: num(ks.priceToBook),
      priceToSales: num(sd.priceToSalesTrailing12Months),
      enterpriseValue: num(ks.enterpriseValue),
      evToEbitda: num(ks.enterpriseToEbitda),
      evToRevenue: num(ks.enterpriseToRevenue),
      trailingEps: num(ks.trailingEps),
      forwardEps: num(ks.forwardEps),
      beta: num(sd.beta) ?? num(ks.beta),
      fiftyDayAvg: num(sd.fiftyDayAverage),
      twoHundredDayAvg: num(sd.twoHundredDayAverage),
      change52w: num(ks["52WeekChange"]),
      open: num(sd.open),
    },
    dividends: {
      rate: num(sd.dividendRate),
      yield: num(sd.dividendYield),
      payoutRatio: num(sd.payoutRatio),
      exDate: toMs(sd.exDividendDate) ?? toMs(ce.exDividendDate),
      fiveYearAvgYield: num(sd.fiveYearAvgDividendYield),
      lastValue: num(ks.lastDividendValue),
      lastDate: toMs(ks.lastDividendDate),
    },
    financialCurrency: str(fd.financialCurrency),
    financials: {
      revenue: num(fd.totalRevenue),
      revenueGrowth: num(fd.revenueGrowth),
      grossMargins: num(fd.grossMargins),
      operatingMargins: num(fd.operatingMargins),
      profitMargins: num(fd.profitMargins),
      ebitda: num(fd.ebitda),
      netIncome: num(ks.netIncomeToCommon),
      freeCashflow: num(fd.freeCashflow),
      operatingCashflow: num(fd.operatingCashflow),
      totalCash: num(fd.totalCash),
      totalDebt: num(fd.totalDebt),
      debtToEquity: num(fd.debtToEquity),
      currentRatio: num(fd.currentRatio),
      quickRatio: num(fd.quickRatio),
      roe: num(fd.returnOnEquity),
      roa: num(fd.returnOnAssets),
      earningsGrowth: num(fd.earningsGrowth),
      mostRecentQuarter: toMs(ks.mostRecentQuarter),
      lastFiscalYearEnd: toMs(ks.lastFiscalYearEnd),
    },
    analysts: {
      recommendationKey: str(fd.recommendationKey),
      recommendationMean: num(fd.recommendationMean),
      count: num(fd.numberOfAnalystOpinions),
      targetLow: num(fd.targetLowPrice),
      targetMean: num(fd.targetMeanPrice),
      targetMedian: num(fd.targetMedianPrice),
      targetHigh: num(fd.targetHighPrice),
      trend: t
        ? {
            strongBuy: num(t.strongBuy) ?? 0,
            buy: num(t.buy) ?? 0,
            hold: num(t.hold) ?? 0,
            sell: num(t.sell) ?? 0,
            strongSell: num(t.strongSell) ?? 0,
          }
        : null,
    },
    events: {
      earningsDate: toMs(earnDates[0]),
      earningsEstimate: typeof earn.isEarningsDateEstimate === "boolean" ? earn.isEarningsDateEstimate : null,
    },
    ownership: {
      insidersPct: num(ks.heldPercentInsiders),
      institutionsPct: num(ks.heldPercentInstitutions),
      sharesOutstanding: num(ks.sharesOutstanding),
      floatShares: num(ks.floatShares),
    },
  };
}

export async function getDetails(symbol: string): Promise<StockDetails> {
  return shared.details.getOrLoad(
    symbol,
    DETAILS_TTL,
    async () => {
      try {
        const res = (await yf.quoteSummary(
          symbol,
          {
            modules: [
              "assetProfile",
              "summaryProfile",
              "summaryDetail",
              "defaultKeyStatistics",
              "financialData",
              "calendarEvents",
              "recommendationTrend",
            ],
          },
          OPTS,
        )) as unknown as Raw;
        return mapDetails(res);
      } catch {
        // All-null object, so the page renders without the extra tabs' data.
        return mapDetails({});
      }
    },
    { staleOnError: true, swrMs: DETAILS_SWR },
  );
}
