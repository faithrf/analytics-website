"use client";
import Link from "next/link";
import { useState } from "react";
import type { MarketNewsItem, QuoteDTO } from "@/lib/yahoo";
import { direction, fmtNum, fmtPct, isNum, priceDigits } from "@/lib/format";
import { GLOBAL_GAUGES, REGIONS, region, type RegionId } from "@/lib/markets";
import { displayCode, fromYahoo, isValidId } from "@/lib/symbols";
import { useApi } from "@/lib/use-api";
import { useRefreshMsFor } from "@/lib/use-market-status";
import {
  Change,
  ErrorBox,
  Freshness,
  newest,
  Panel,
  QuoteTime,
  Skeleton,
  Tabs,
} from "@/components/ui";

interface GlobalTile {
  symbol: string;
  label: string;
  region: string | null;
  quote: QuoteDTO | null;
}
interface NewsData {
  news: (MarketNewsItem & { regions: RegionId[] })[];
  mentions: { symbol: string; count: number }[];
  quotes: QuoteDTO[];
}

const ALL_REGIONS = REGIONS.map((r) => r.id);
const FEED_TABS = [
  { id: "all", label: "All markets" },
  ...REGIONS.map((r) => ({ id: r.id, label: r.label })),
] as const;
type Feed = (typeof FEED_TABS)[number]["id"];

/** Friendly names for the index, FX and commodity symbols Yahoo tags stories with. */
const KNOWN_LABELS = new Map<string, string>([
  ...REGIONS.flatMap((r) =>
    r.tiles.map((t) => [t.symbol, t.label] as [string, string]),
  ),
  ...GLOBAL_GAUGES.map((g) => [g.symbol, g.label] as [string, string]),
  ["^NDX", "Nasdaq 100"],
]);

function tickerLabel(symbol: string): string {
  const known = KNOWN_LABELS.get(symbol);
  if (known) return known;
  const id = fromYahoo(symbol);
  return isValidId(id) ? displayCode(id) : symbol;
}

function ago(t: number | null): string {
  if (!t) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function TickerChip({ symbol, quote }: { symbol: string; quote?: QuoteDTO }) {
  const id = fromYahoo(symbol);
  const dir = direction(quote?.changePct);
  const body = (
    <>
      <span className="font-semibold">{tickerLabel(symbol)}</span>
      {quote && isNum(quote.changePct) && (
        <span
          className={
            dir === "up"
              ? "text-gain"
              : dir === "down"
                ? "text-loss"
                : "text-muted"
          }
        >
          {dir === "up" ? "▲" : dir === "down" ? "▼" : "▬"}{" "}
          {fmtPct(quote.changePct)}
        </span>
      )}
    </>
  );
  const cls =
    "inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-xs";
  return isValidId(id) ? (
    <Link
      href={`/stock/${id}`}
      className={`${cls} hover:border-accent`}
      title={quote?.name}
    >
      {body}
    </Link>
  ) : (
    <span className={cls} title={quote?.name}>
      {body}
    </span>
  );
}

export function NewsView() {
  const refresh = useRefreshMsFor(ALL_REGIONS);
  const [feed, setFeed] = useState<Feed>("all");
  const global = useApi<{ tiles: GlobalTile[] }>("/api/global", refresh);
  const news = useApi<NewsData>(
    `/api/market-news?region=${feed}`,
    refresh ? 300_000 : 0,
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="-mb-1.5 flex shrink-0 items-center justify-between text-xs text-muted">
        <span>Global markets, commodities and currencies</span>
        <Freshness
          dataTime={newest(
            (global.data?.tiles ?? []).map((t) => t.quote?.time),
          )}
          updatedAt={global.updatedAt}
          refreshMs={refresh}
          stale={global.stale}
          onRefresh={global.reload}
        />
      </div>
      <GlobalStrip {...global} />
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-12">
        <Panel
          className="min-h-[320px] lg:col-span-8"
          title="Market headlines"
          right={
            <>
              <Freshness
                kind="news"
                dataTime={newest((news.data?.news ?? []).map((n) => n.time))}
                updatedAt={news.updatedAt}
                refreshMs={refresh ? 300_000 : 0}
                stale={news.stale}
                onRefresh={news.reload}
              />
              <Tabs
                tabs={FEED_TABS}
                value={feed}
                onChange={setFeed}
                label="Headline market"
              />
            </>
          }
          bodyClass="overflow-auto"
        >
          <Headlines {...news} />
        </Panel>
        <Panel
          className="min-h-[260px] lg:col-span-4"
          title="Most named in the news"
          bodyClass="overflow-auto"
        >
          <Mentions {...news} />
        </Panel>
      </div>
    </div>
  );
}

function GlobalStrip({
  data,
  error,
  loading,
  reload,
}: ReturnType<typeof useApi<{ tiles: GlobalTile[] }>>) {
  if (error && !data)
    return <ErrorBox error={error} onRetry={reload} compact />;
  const tiles = loading || !data ? null : data.tiles;
  return (
    <ul className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-11">
      {(tiles ?? Array.from({ length: 11 }, () => null)).map((t, i) =>
        t === null ? (
          <li
            key={i}
            className="h-[68px] rounded-lg border border-line bg-panel p-2"
          >
            <Skeleton className="mb-1.5 h-3 w-16" />
            <Skeleton className="h-5 w-20" />
          </li>
        ) : (
          <li
            key={t.symbol}
            className={`flex h-[68px] min-w-0 flex-col justify-between rounded-lg border border-line p-2 ${t.region ? "bg-panel" : "bg-panel2"}`}
            title={t.quote?.name}
          >
            <span className="flex items-baseline justify-between gap-1 text-xs text-muted">
              <span className="truncate">
                {t.region ? `${t.region}: ${t.label}` : t.label}
              </span>
              <QuoteTime t={t.quote?.time} className="hidden 2xl:inline" />
            </span>
            {t.quote ? (
              <>
                <span className="text-sm leading-none font-semibold">
                  {fmtNum(t.quote.price, priceDigits(t.quote.price, t.symbol))}
                </span>
                <Change
                  pct={t.quote.changePct}
                  showValue={false}
                  className="text-xs font-medium"
                />
              </>
            ) : (
              <span className="text-xs text-muted">Unavailable</span>
            )}
          </li>
        ),
      )}
    </ul>
  );
}

type NewsState = ReturnType<typeof useApi<NewsData>>;

function Headlines({ data, error, loading, reload }: NewsState) {
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
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (data.news.length === 0)
    return (
      <p className="p-3 text-sm text-muted">
        No market headlines right now. Try another market.
      </p>
    );

  const quotes = new Map(data.quotes.map((q) => [q.symbol, q]));
  // Breadth of the stocks the headlines name: how today's news-linked names are trading.
  const named = data.quotes.filter(
    (q) => isValidId(fromYahoo(q.symbol)) && isNum(q.changePct),
  );
  const up = named.filter((q) => q.changePct! > 0).length;
  const down = named.filter((q) => q.changePct! < 0).length;
  const avg = named.length
    ? named.reduce((s, q) => s + q.changePct!, 0) / named.length
    : null;

  return (
    <>
      {named.length > 0 && (
        <p className="sticky top-0 z-10 border-b border-line bg-panel px-3 py-1.5 text-xs text-muted">
          {named.length} stocks named in these stories today:{" "}
          <span className="text-gain">{up} up</span>,{" "}
          <span className="text-loss">{down} down</span>, average{" "}
          <Change pct={avg} showValue={false} className="font-medium" />
        </p>
      )}
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
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span>
                {n.publisher}
                {n.time ? `, ${ago(n.time)}` : ""}
              </span>
              {n.regions.map((r) => (
                <span key={r} className="rounded bg-panel2 px-1.5 py-0.5">
                  {region(r).label}
                </span>
              ))}
              {n.tickers.map((t) => (
                <TickerChip key={t} symbol={t} quote={quotes.get(t)} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Mentions({ data, loading, error }: NewsState) {
  if (loading || (!data && !error)) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }
  if (!data || data.mentions.length === 0)
    return (
      <p className="p-3 text-sm text-muted">
        No stocks are tagged in the current headlines.
      </p>
    );
  const quotes = new Map(data.quotes.map((q) => [q.symbol, q]));
  return (
    <>
      <ul>
        {data.mentions.map((m) => {
          const q = quotes.get(m.symbol);
          const id = fromYahoo(m.symbol);
          const label = tickerLabel(m.symbol);
          return (
            <li
              key={m.symbol}
              className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-sm last:border-0"
            >
              {isValidId(id) ? (
                <Link
                  href={`/stock/${id}`}
                  className="w-20 truncate font-semibold text-accent hover:underline"
                >
                  {label}
                </Link>
              ) : (
                <span className="w-20 truncate font-semibold">{label}</span>
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-muted">
                {q?.name ?? ""}
              </span>
              <span className="w-16 text-right text-xs text-muted">
                {m.count} {m.count === 1 ? "story" : "stories"}
              </span>
              <span className="w-20 text-right font-medium">
                {q ? (
                  <Change pct={q.changePct} showValue={false} />
                ) : (
                  <span className="text-xs text-muted">No quote</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="px-3 py-2 text-xs text-muted">
        Today&apos;s move for each stock Yahoo links to the headlines. A stock
        being named in a story does not mean the story caused the move.
      </p>
    </>
  );
}
