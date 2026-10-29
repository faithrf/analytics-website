"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { ChartDTO, NewsItem, QuoteDTO } from "@/lib/yahoo";
import { RANGES, type Range } from "@/lib/ranges";
import { direction, fmtCompact, fmtNum, isNum, priceDigits } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useRefreshMs } from "@/lib/use-market-status";
import { Change, ErrorBox, Panel, Skeleton, StaleNote, Tabs } from "@/components/ui";
import { PriceChart } from "@/components/PriceChart";
import { WatchlistToggle } from "@/components/WatchlistToggle";

interface StockData {
  quote: QuoteDTO;
  sector: string | null;
  industry: string | null;
}

const RANGE_TABS = RANGES.map((r) => ({ id: r, label: r }));
const SIDE_TABS = [
  { id: "stats", label: "Key stats" },
  { id: "news", label: "News" },
] as const;
type SideTab = (typeof SIDE_TABS)[number]["id"];

export function StockView({ code }: { code: string }) {
  const refresh = useRefreshMs();
  const stock = useApi<StockData>(`/api/stock/${code}`, refresh);
  const [range, setRange] = useState<Range>("6M");
  const [side, setSide] = useState<SideTab>("stats");
  const chart = useApi<ChartDTO>(`/api/chart?symbol=${code}.AX&range=${range}`, range === "1D" ? refresh : 0);

  if (stock.error && !stock.data) {
    const notFound = stock.error.code === "not_found";
    return (
      <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-3">
        <ErrorBox
          error={notFound ? { code: "not_found", message: `We couldn't find an ASX stock with the code "${code}". Check the spelling or use the search box.` } : stock.error}
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
              <h1 className="text-xl font-bold tracking-tight">{q.code}</h1>
              <span className="truncate text-sm text-muted">{q.name}</span>
              {stock.data?.sector && (
                <span className="rounded border border-line px-1.5 py-0.5 text-xs text-muted">{stock.data.sector}</span>
              )}
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-3xl leading-none font-semibold tracking-tight">{fmtNum(q.price, digits)}</span>
              <span className="text-xs text-muted">{q.currency ?? "AUD"}</span>
              <Change value={q.change} pct={q.changePct} digits={digits} className="text-base font-medium" />
              <StaleNote show={stock.stale} />
            </div>
            <WatchlistToggle code={q.code} />
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
          right={<Tabs tabs={RANGE_TABS} value={range} onChange={setRange} label="Chart range" />}
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
            <Tabs tabs={SIDE_TABS} value={side} onChange={setSide} label="Stock details" />
          </div>
          {side === "stats" ? (
            <Stats data={stock.data} />
          ) : (
            <News code={code} />
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

function RangeBar({ low, high, value }: { low: number; high: number; value: number | null }) {
  const pct = isNum(value) && high > low ? Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100)) : null;
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

function Stats({ data }: { data?: StockData }) {
  if (!data) {
    return (
      <div className="space-y-3 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }
  const { quote: q } = data;
  const volRatio = isNum(q.volume) && isNum(q.avgVolume) && q.avgVolume > 0 ? q.volume / q.avgVolume : null;
  return (
    <dl>
      <Row label="Market cap">{isNum(q.marketCap) ? `$${fmtCompact(q.marketCap)}` : "—"}</Row>
      <Row label="P/E (trailing)">{fmtNum(q.pe)}</Row>
      <Row label="Dividend yield">{isNum(q.dividendYield) ? `${fmtNum(q.dividendYield)}%` : "—"}</Row>
      <Row label="52-week range">
        {isNum(q.low52) && isNum(q.high52) ? <RangeBar low={q.low52} high={q.high52} value={q.price} /> : "—"}
      </Row>
      <Row label="Day range">
        {isNum(q.dayLow) && isNum(q.dayHigh) ? `${fmtNum(q.dayLow)} – ${fmtNum(q.dayHigh)}` : "—"}
      </Row>
      <Row label="Volume vs average">
        {isNum(q.volume) ? (
          <span>
            {fmtCompact(q.volume)} <span className="text-muted">vs {fmtCompact(q.avgVolume)}</span>
            {volRatio !== null && (
              <span className={`ml-2 ${direction(volRatio - 1, 1) === "up" ? "text-gain" : direction(volRatio - 1, 1) === "down" ? "text-loss" : "text-muted"}`}>
                {volRatio >= 1 ? "▲" : "▼"} {fmtNum(volRatio, 2)}x
              </span>
            )}
          </span>
        ) : (
          "—"
        )}
      </Row>
      <Row label="Previous close">{fmtNum(q.prevClose, priceDigits(q.prevClose))}</Row>
      <Row label="Sector">{data.sector ?? "—"}</Row>
      {data.industry && <Row label="Industry">{data.industry}</Row>}
    </dl>
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
  const { data, error, loading, reload } = useApi<{ news: NewsItem[] }>(`/api/news?code=${code}`);
  if (error) {
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
  if (data.news.length === 0) return <p className="p-3 text-sm text-muted">No recent headlines for {code}.</p>;
  return (
    <ul>
      {data.news.map((n) => (
        <li key={n.link} className="border-b border-line/60 px-3 py-2 last:border-0">
          <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-sm leading-snug font-medium hover:text-accent hover:underline">
            {n.title}
          </a>
          <div className="mt-0.5 text-xs text-muted">
            {n.publisher}
            {n.time ? `, ${newsDate.format(new Date(n.time))}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

