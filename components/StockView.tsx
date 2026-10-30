"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { ChartDTO, NewsItem, QuoteDTO, StockDetails } from "@/lib/yahoo";
import { RANGES, type Range } from "@/lib/ranges";
import {
  direction,
  fmtCompact,
  fmtNum,
  isNum,
  priceDigits,
} from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useRefreshMs } from "@/lib/use-market-status";
import {
  Change,
  ErrorBox,
  Panel,
  Skeleton,
  Freshness,
  newest,
  Tabs,
} from "@/components/ui";
import { PriceChart } from "@/components/PriceChart";
import { PinMenu } from "@/components/PinMenu";
import { region } from "@/lib/markets";
import { displayCode, marketOf, regionOf, toYahoo } from "@/lib/symbols";

interface StockData {
  quote: QuoteDTO;
  details: StockDetails;
  sector: string | null;
  industry: string | null;
}

const RANGE_TABS = RANGES.map((r) => ({ id: r, label: r }));
const SIDE_TABS = [
  { id: "stats", label: "Stats" },
  { id: "financials", label: "Financials" },
  { id: "analysts", label: "Analysts" },
  { id: "profile", label: "Profile" },
  { id: "news", label: "News" },
] as const;
type SideTab = (typeof SIDE_TABS)[number]["id"];

export function StockView({ code }: { code: string }) {
  const refresh = useRefreshMs(regionOf(code));
  const stock = useApi<StockData>(`/api/stock/${code}`, refresh);
  const [range, setRange] = useState<Range>("6M");
  const [side, setSide] = useState<SideTab>("stats");
  const chart = useApi<ChartDTO>(
    `/api/chart?symbol=${toYahoo(code)}&range=${range}`,
    range === "1D" ? refresh : 0,
  );

  if (stock.error && !stock.data) {
    const notFound = stock.error.code === "not_found";
    return (
      <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-3">
        <ErrorBox
          error={
            notFound
              ? {
                  code: "not_found",
                  message: `We couldn't find a ${marketOf(code)} stock with the code "${displayCode(code)}". Check the spelling or use the search box.`,
                }
              : stock.error
          }
          onRetry={notFound ? undefined : stock.reload}
          compact
        />
        <Link href="/" className="text-sm text-accent hover:underline">
          Back to the market overview
        </Link>
      </div>
    );
  }

  const q = stock.data?.quote;
  const digits = priceDigits(q?.price);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border border-line bg-panel px-4 py-2.5">
        {q ? (
          <>
            <div className="flex min-w-0 items-baseline gap-3">
              <h1 className="text-xl font-bold tracking-tight">
                {displayCode(code)}
              </h1>
              <span className="text-xs text-muted">{marketOf(code)}</span>
              <span className="truncate text-sm text-muted">{q.name}</span>
              {stock.data?.sector && (
                <span className="rounded border border-line px-1.5 py-0.5 text-xs text-muted">
                  {stock.data.sector}
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-3xl leading-none font-semibold tracking-tight">
                {fmtNum(q.price, digits)}
              </span>
              <span className="text-xs text-muted">
                {q.currency ?? region(regionOf(code)).currency}
              </span>
              <Change
                value={q.change}
                pct={q.changePct}
                digits={digits}
                className="text-base font-medium"
              />
              <Freshness
                dataTime={q.time}
                updatedAt={stock.updatedAt}
                refreshMs={refresh}
                stale={stock.stale}
                onRefresh={stock.reload}
              />
            </div>
            <PinMenu id={code} />
          </>
        ) : (
          <div className="flex w-full items-center gap-4">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-9 w-40" />
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Panel
          title="Price and volume"
          right={
            <>
              {chart.data?.range === range && (
                <Freshness
                  kind="chart"
                  dataTime={chart.data.points.at(-1)?.t}
                  updatedAt={chart.updatedAt}
                  refreshMs={range === "1D" ? refresh : 0}
                  stale={chart.stale}
                  onRefresh={chart.reload}
                />
              )}
              <Tabs
                tabs={RANGE_TABS}
                value={range}
                onChange={setRange}
                label="Chart range"
              />
            </>
          }
          bodyClass="p-2 min-h-[320px]"
          className="min-h-[360px]"
        >
          {chart.error && !chart.data ? (
            <ErrorBox error={chart.error} onRetry={chart.reload} compact />
          ) : !chart.data || chart.data.range !== range ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <PriceChart chart={chart.data} range={range} />
          )}
        </Panel>

        <Panel
          title={undefined}
          right={undefined}
          className="min-h-[300px]"
          bodyClass="overflow-auto"
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
            <Tabs
              tabs={SIDE_TABS}
              value={side}
              onChange={setSide}
              label="Stock details"
            />
            {side === "stats" && q && (
              <Freshness
                dataTime={q.time}
                updatedAt={stock.updatedAt}
                refreshMs={refresh}
                stale={stock.stale}
                onRefresh={stock.reload}
              />
            )}
          </div>
          {side === "news" ? (
            <News code={code} />
          ) : !stock.data ? (
            <StatsSkeleton />
          ) : side === "stats" ? (
            <Stats data={stock.data} />
          ) : side === "financials" ? (
            <Financials details={stock.data.details} />
          ) : side === "analysts" ? (
            <Analysts details={stock.data.details} quote={stock.data.quote} />
          ) : (
            <Profile data={stock.data} />
          )}
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 px-3 py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function RangeBar({
  low,
  high,
  value,
}: {
  low: number;
  high: number;
  value: number | null;
}) {
  const pct =
    isNum(value) && high > low
      ? Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100))
      : null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted">{fmtNum(low)}</span>
      <div className="relative h-1.5 w-28 rounded-full bg-panel2">
        {pct !== null && (
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent"
            style={{ left: `${pct}%` }}
            aria-hidden
          />
        )}
      </div>
      <span className="text-xs text-muted">{fmtNum(high)}</span>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-3 p-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}

/** A row that disappears when Yahoo has no value, instead of showing a dash. */
function OptRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode | null | undefined;
}) {
  if (children === null || children === undefined || children === false)
    return null;
  return <Row label={label}>{children}</Row>;
}

/** Small muted uppercase heading that groups rows. */
function SubHead({ children }: { children: ReactNode }) {
  return (
    <h3 className="border-b border-line/60 bg-panel2/50 px-3 py-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
      {children}
    </h3>
  );
}

const dateFmt = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const fmtDate = (ms: number | null) =>
  isNum(ms) ? dateFmt.format(new Date(ms)) : null;
const num2 = (n: number | null, digits = 2) =>
  isNum(n) ? fmtNum(n, digits) : null;
/** Fraction (0.12) as a percent string. */
const pctOf = (n: number | null) =>
  isNum(n) ? `${fmtNum(n * 100, 1)}%` : null;
const compact = (n: number | null) => (isNum(n) ? fmtCompact(n) : null);

function Stats({ data }: { data: StockData }) {
  const { quote: q, details: d } = data;
  const { valuation: v, dividends: dv, ownership: o } = d;
  const volRatio =
    isNum(q.volume) && isNum(q.avgVolume) && q.avgVolume > 0
      ? q.volume / q.avgVolume
      : null;
  const dp = priceDigits(q.price);
  return (
    <dl>
      <Row label="Market cap">
        {isNum(q.marketCap)
          ? `${fmtCompact(q.marketCap)} ${q.currency ?? ""}`.trim()
          : "—"}
      </Row>
      <Row label="P/E (trailing)">{fmtNum(q.pe)}</Row>
      <OptRow label="P/E (forward)">{num2(v.forwardPE)}</OptRow>
      <OptRow label="EPS (ttm / forward)">
        {isNum(v.trailingEps) || isNum(v.forwardEps)
          ? `${fmtNum(v.trailingEps)} / ${fmtNum(v.forwardEps)}`
          : null}
      </OptRow>
      <OptRow label="PEG ratio">{num2(v.peg)}</OptRow>
      <OptRow label="Price / book">{num2(v.priceToBook)}</OptRow>
      <OptRow label="Beta">{num2(v.beta)}</OptRow>
      <Row label="Dividend yield">
        {isNum(q.dividendYield) ? `${fmtNum(q.dividendYield)}%` : "—"}
      </Row>
      <OptRow label="Dividend rate">{num2(dv.rate)}</OptRow>
      <OptRow label="Payout ratio">{pctOf(dv.payoutRatio)}</OptRow>
      <OptRow label="Ex-dividend date">{fmtDate(dv.exDate)}</OptRow>
      <Row label="52-week range">
        {isNum(q.low52) && isNum(q.high52) ? (
          <RangeBar low={q.low52} high={q.high52} value={q.price} />
        ) : (
          "—"
        )}
      </Row>
      <OptRow label="52-week change">
        {isNum(v.change52w) ? (
          <Change pct={v.change52w * 100} className="font-medium" />
        ) : null}
      </OptRow>
      <OptRow label="50-day average">{num2(v.fiftyDayAvg, dp)}</OptRow>
      <OptRow label="200-day average">{num2(v.twoHundredDayAvg, dp)}</OptRow>
      <Row label="Day range">
        {isNum(q.dayLow) && isNum(q.dayHigh)
          ? `${fmtNum(q.dayLow)} – ${fmtNum(q.dayHigh)}`
          : "—"}
      </Row>
      <Row label="Volume vs average">
        {isNum(q.volume) ? (
          <span>
            {fmtCompact(q.volume)}{" "}
            <span className="text-muted">vs {fmtCompact(q.avgVolume)}</span>
            {volRatio !== null && (
              <span
                className={`ml-2 ${direction(volRatio - 1, 1) === "up" ? "text-gain" : direction(volRatio - 1, 1) === "down" ? "text-loss" : "text-muted"}`}
              >
                {volRatio >= 1 ? "▲" : "▼"} {fmtNum(volRatio, 2)}x
              </span>
            )}
          </span>
        ) : (
          "—"
        )}
      </Row>
      <Row label="Previous close">
        {fmtNum(q.prevClose, priceDigits(q.prevClose))}
      </Row>
      <OptRow label="Next earnings">
        {d.events.earningsDate !== null
          ? `${fmtDate(d.events.earningsDate)}${d.events.earningsEstimate ? " (est.)" : ""}`
          : null}
      </OptRow>
      <OptRow label="Insider ownership">{pctOf(o.insidersPct)}</OptRow>
      <OptRow label="Institutional ownership">
        {pctOf(o.institutionsPct)}
      </OptRow>
      <OptRow label="Shares outstanding">{compact(o.sharesOutstanding)}</OptRow>
      <OptRow label="Float">{compact(o.floatShares)}</OptRow>
      <Row label="Sector">{data.sector ?? "—"}</Row>
      {data.industry && <Row label="Industry">{data.industry}</Row>}
    </dl>
  );
}

function Financials({ details: d }: { details: StockDetails }) {
  const f = d.financials;
  const groups: { title: string; rows: [string, string | null][] }[] = [
    {
      title: "Income",
      rows: [
        ["Revenue", compact(f.revenue)],
        ["Revenue growth", pctOf(f.revenueGrowth)],
        ["EBITDA", compact(f.ebitda)],
        ["Net income", compact(f.netIncome)],
        ["Earnings growth", pctOf(f.earningsGrowth)],
        ["Operating cash flow", compact(f.operatingCashflow)],
        ["Free cash flow", compact(f.freeCashflow)],
      ],
    },
    {
      title: "Margins",
      rows: [
        ["Gross margin", pctOf(f.grossMargins)],
        ["Operating margin", pctOf(f.operatingMargins)],
        ["Profit margin", pctOf(f.profitMargins)],
      ],
    },
    {
      title: "Balance sheet",
      rows: [
        ["Total cash", compact(f.totalCash)],
        ["Total debt", compact(f.totalDebt)],
        [
          "Debt / equity",
          isNum(f.debtToEquity) ? `${fmtNum(f.debtToEquity)}%` : null,
        ],
        ["Current ratio", num2(f.currentRatio)],
        ["Quick ratio", num2(f.quickRatio)],
      ],
    },
    {
      title: "Returns",
      rows: [
        ["Return on equity", pctOf(f.roe)],
        ["Return on assets", pctOf(f.roa)],
      ],
    },
    {
      title: "Reporting",
      rows: [
        ["Latest quarter", fmtDate(f.mostRecentQuarter)],
        ["Fiscal year end", fmtDate(f.lastFiscalYearEnd)],
      ],
    },
  ];
  const shown = groups
    .map((g) => ({ ...g, rows: g.rows.filter(([, v]) => v !== null) }))
    .filter((g) => g.rows.length > 0);
  if (shown.length === 0)
    return (
      <p className="p-3 text-sm text-muted">No financial data available.</p>
    );
  return (
    <div>
      {d.financialCurrency && (
        <p className="border-b border-line/60 px-3 py-1.5 text-xs text-muted">
          Figures in {d.financialCurrency}
        </p>
      )}
      {shown.map((g) => (
        <section key={g.title}>
          <SubHead>{g.title}</SubHead>
          <dl>
            {g.rows.map(([label, v]) => (
              <Row key={label} label={label}>
                {v}
              </Row>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

const TREND_SEGMENTS = [
  { key: "strongBuy", label: "Strong buy", bar: "bg-gain" },
  { key: "buy", label: "Buy", bar: "bg-gain/60" },
  { key: "hold", label: "Hold", bar: "bg-muted/60" },
  { key: "sell", label: "Sell", bar: "bg-loss/60" },
  { key: "strongSell", label: "Strong sell", bar: "bg-loss" },
] as const;

function Analysts({
  details: d,
  quote: q,
}: {
  details: StockDetails;
  quote: QuoteDTO;
}) {
  const a = d.analysts;
  const trend = a.trend;
  const { targetLow: lo, targetHigh: hi, targetMean: mean } = a;
  const upside =
    isNum(mean) && isNum(q.price) && q.price > 0
      ? ((mean - q.price) / q.price) * 100
      : null;
  const total = trend
    ? TREND_SEGMENTS.reduce((n, sg) => n + trend[sg.key], 0)
    : 0;
  if (!a.recommendationKey && !isNum(mean) && total === 0)
    return (
      <p className="p-3 text-sm text-muted">No analyst coverage available.</p>
    );
  const label = a.recommendationKey
    ? a.recommendationKey
        .replace(/_/g, " ")
        .replace(/^./, (c) => c.toUpperCase())
    : null;
  // Position of a price along the low-high target bar, clamped to the bar.
  const at = (v: number | null) =>
    isNum(v) && isNum(lo) && isNum(hi) && hi > lo
      ? Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))
      : null;
  const pricePos = at(q.price);
  const meanPos = at(mean);
  const dp = priceDigits(q.price);
  return (
    <div>
      <dl>
        <OptRow label="Consensus">
          {label && (
            <span>
              {label}
              {isNum(a.recommendationMean) && (
                <span className="text-muted">
                  {" "}
                  ({fmtNum(a.recommendationMean)} of 5
                  {isNum(a.count) ? `, ${a.count} analysts` : ""})
                </span>
              )}
            </span>
          )}
        </OptRow>
        <OptRow label="Mean target">
          {isNum(mean) ? (
            <span>
              {fmtNum(mean, dp)}
              {upside !== null && (
                <Change pct={upside} showValue={false} className="ml-2" />
              )}
            </span>
          ) : null}
        </OptRow>
        <OptRow label="Median target">{num2(a.targetMedian, dp)}</OptRow>
      </dl>

      {pricePos !== null && isNum(lo) && isNum(hi) && (
        <div className="border-b border-line/60 px-3 py-3">
          <div className="mb-2 text-xs text-muted">Price target range</div>
          <div className="relative h-1.5 rounded-full bg-panel2">
            {meanPos !== null && (
              <span
                className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-ink"
                style={{ left: `${meanPos}%` }}
                aria-hidden
              />
            )}
            <span
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent"
              style={{ left: `${pricePos}%` }}
              aria-hidden
            />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-muted">
            <span>Low {fmtNum(lo, dp)}</span>
            <span>High {fmtNum(hi, dp)}</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-accent" aria-hidden />
              Price {fmtNum(q.price, dp)}
            </span>
            {isNum(mean) && (
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-0.5 bg-ink" aria-hidden />
                Mean {fmtNum(mean, dp)}
              </span>
            )}
          </div>
        </div>
      )}

      {trend && total > 0 && (
        <div className="px-3 py-3">
          <div className="mb-2 text-xs text-muted">Recommendations</div>
          <div
            className="flex h-2.5 overflow-hidden rounded-full bg-panel2"
            role="img"
            aria-label={TREND_SEGMENTS.map(
              (sg) => `${sg.label} ${trend[sg.key]}`,
            ).join(", ")}
          >
            {TREND_SEGMENTS.map((sg) =>
              trend[sg.key] > 0 ? (
                <span
                  key={sg.key}
                  className={sg.bar}
                  style={{ width: `${(trend[sg.key] / total) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          <ul className="mt-2 grid grid-cols-5 gap-1 text-center text-xs">
            {TREND_SEGMENTS.map((sg) => (
              <li key={sg.key}>
                <div className="text-sm font-medium">{trend[sg.key]}</div>
                <div className="flex items-center justify-center gap-1 text-muted">
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${sg.bar}`}
                    aria-hidden
                  />
                  {sg.label}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Profile({ data }: { data: StockData }) {
  const p = data.details.profile;
  const where = [p.city, p.country].filter(Boolean).join(", ");
  return (
    <div>
      <dl>
        <OptRow label="Sector">{data.sector}</OptRow>
        <OptRow label="Industry">{data.industry}</OptRow>
        <OptRow label="Location">{where || null}</OptRow>
        <OptRow label="Employees">
          {isNum(p.employees) ? p.employees.toLocaleString("en-AU") : null}
        </OptRow>
        <OptRow label="Website">
          {p.website ? (
            <a
              href={p.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              {p.website
                .replace(/^https?:\/\/(www\.)?/i, "")
                .replace(/\/$/, "")}
            </a>
          ) : null}
        </OptRow>
      </dl>
      {p.summary ? (
        <p className="px-3 py-3 text-sm leading-relaxed whitespace-pre-line">
          {p.summary}
        </p>
      ) : (
        <p className="p-3 text-sm text-muted">
          No company description available.
        </p>
      )}
    </div>
  );
}

const newsDate = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function News({ code }: { code: string }) {
  const { data, error, loading, reload, updatedAt } = useApi<{
    news: NewsItem[];
  }>(`/api/news?code=${code}`);
  if (error && !data) {
    return (
      <div className="p-3">
        <ErrorBox error={error} onRetry={reload} compact />
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="space-y-3 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (data.news.length === 0)
    return (
      <p className="p-3 text-sm text-muted">
        No recent headlines for {displayCode(code)}.
      </p>
    );
  return (
    <>
      <div className="flex justify-end border-b border-line px-3 py-1">
        <Freshness
          kind="news"
          dataTime={newest(data.news.map((n) => n.time))}
          updatedAt={updatedAt}
          refreshMs={0}
          onRefresh={reload}
        />
      </div>
      <ul>
        {data.news.map((n) => (
          <li
            key={n.link}
            className="border-b border-line/60 px-3 py-2 last:border-0"
          >
            <a
              href={n.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm leading-snug font-medium hover:text-accent hover:underline"
            >
              {n.title}
            </a>
            <div className="mt-0.5 text-xs text-muted">
              {n.publisher}
              {n.time ? `, ${newsDate.format(new Date(n.time))}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
