"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MoverRow, SectorAverage } from "@/lib/aggregate";
import {
  direction,
  fmtCompact,
  fmtNum,
  fmtPct,
  priceDigits,
} from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useRefreshMs } from "@/lib/use-market-status";
import { IndexTiles } from "@/components/IndexTiles";
import { PinnedPanel } from "@/components/PinnedPanel";
import { REGIONS, region, type RegionId } from "@/lib/markets";
import { displayCode } from "@/lib/symbols";
import {
  Change,
  ErrorBox,
  Freshness,
  Panel,
  Skeleton,
  Tabs,
} from "@/components/ui";

interface MoversData {
  gainers: MoverRow[];
  losers: MoverRow[];
  active: MoverRow[];
  sectors: SectorAverage[];
  covered: number;
  total: number;
  missing: number;
  asOf: string;
  quoteTime: number | null;
}

const MOVER_TABS = [
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
  { id: "active", label: "Most active" },
] as const;
type MoverTab = (typeof MOVER_TABS)[number]["id"];

const REGION_TABS = REGIONS.map((r) => ({ id: r.id, label: r.label }));

export function Markets({ regionId }: { regionId: RegionId }) {
  const router = useRouter();
  const refresh = useRefreshMs(regionId);
  const movers = useApi<MoversData>(`/api/movers?region=${regionId}`, refresh);

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-12 lg:grid-rows-1">
      <div className="flex min-h-0 flex-col gap-3 lg:col-span-8">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <Tabs
            tabs={REGION_TABS}
            value={regionId}
            onChange={(id) =>
              router.replace(id === "au" ? "/" : `/?region=${id}`, {
                scroll: false,
              })
            }
            label="Market"
          />
          <span className="truncate text-xs text-muted">
            Prices in {region(regionId).currency}
          </span>
        </div>
        <IndexTiles regionId={regionId} />
        <MoversPanel {...movers} regionId={regionId} refresh={refresh} />
      </div>
      <div className="flex min-h-0 flex-col gap-3 lg:col-span-4">
        <SectorHeatmap {...movers} refresh={refresh} />
        <PinnedPanel />
      </div>
    </div>
  );
}

type MoversState = ReturnType<typeof useApi<MoversData>>;

function MoversPanel({
  data,
  error,
  loading,
  stale,
  reload,
  updatedAt,
  regionId,
  refresh,
}: MoversState & { regionId: RegionId; refresh: number }) {
  const [tab, setTab] = useState<MoverTab>("gainers");
  const rows = data?.[tab] ?? [];

  return (
    <Panel
      className="min-h-[260px] flex-1"
      title={`${region(regionId).listName} movers`}
      right={
        <>
          <Freshness
            dataTime={data?.quoteTime}
            updatedAt={updatedAt}
            refreshMs={refresh}
            stale={stale}
            onRefresh={reload}
          />
          <Tabs
            tabs={MOVER_TABS}
            value={tab}
            onChange={setTab}
            label="Movers"
          />
        </>
      }
      bodyClass="overflow-auto"
    >
      {error && !data ? (
        <div className="p-3">
          <ErrorBox error={error} onRetry={reload} compact />
        </div>
      ) : loading || !data ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">
          {tab === "active"
            ? "No volume data yet."
            : `No ${tab} right now. Prices are unchanged or the market has not opened.`}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-panel text-xs text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-1.5 text-left font-medium">Code</th>
              <th className="px-2 py-1.5 text-left font-medium">Name</th>
              <th className="px-2 py-1.5 text-right font-medium">Price</th>
              <th className="px-2 py-1.5 text-right font-medium">Change</th>
              <th className="px-2 py-1.5 text-right font-medium">% Change</th>
              <th className="px-3 py-1.5 text-right font-medium">Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.code}
                className="border-b border-line/60 last:border-0 hover:bg-panel2"
              >
                <td className="px-3 py-1.5">
                  <Link
                    href={`/stock/${r.code}`}
                    className="font-semibold text-accent hover:underline"
                  >
                    {displayCode(r.code)}
                  </Link>
                </td>
                <td className="max-w-[260px] truncate px-2 py-1.5 text-muted">
                  {r.name}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {fmtNum(r.price, priceDigits(r.price))}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Change value={r.change} digits={priceDigits(r.price)} />
                </td>
                <td className="px-2 py-1.5 text-right font-medium">
                  <Change pct={r.changePct} showValue={false} />
                </td>
                <td className="px-3 py-1.5 text-right text-muted">
                  {fmtCompact(r.volume)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function SectorHeatmap({
  data,
  error,
  loading,
  reload,
  stale,
  updatedAt,
  refresh,
}: MoversState & { refresh: number }) {
  const sectors = data?.sectors ?? [];
  return (
    <Panel
      className="min-h-[220px] flex-[1.15]"
      title="Sectors, average % change"
      right={
        data && (
          <>
            <span className="text-xs text-muted">
              {data.covered}/{data.total} stocks
            </span>
            <Freshness
              dataTime={data.quoteTime}
              updatedAt={updatedAt}
              refreshMs={refresh}
              stale={stale}
              onRefresh={reload}
            />
          </>
        )
      }
      bodyClass="p-2"
    >
      {error && !data ? (
        <ErrorBox error={error} onRetry={reload} compact />
      ) : loading || !data ? (
        <div className="grid h-full grid-cols-3 gap-1.5">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-full min-h-10" />
          ))}
        </div>
      ) : sectors.length === 0 ? (
        <p className="p-2 text-sm text-muted">No sector data available.</p>
      ) : (
        <ul className="grid h-full auto-rows-fr grid-cols-3 gap-1.5">
          {sectors.map((s) => {
            const dir = direction(s.avgPct);
            const strength = Math.min(1, Math.abs(s.avgPct) / 2); // saturates at +/-2%
            const base =
              dir === "up"
                ? "var(--gain)"
                : dir === "down"
                  ? "var(--loss)"
                  : "var(--muted)";
            return (
              <li
                key={s.sector}
                className="flex min-h-0 flex-col justify-between rounded-md border border-line px-2 py-1.5"
                style={{
                  background: `color-mix(in oklab, ${base} ${Math.round(10 + strength * 32)}%, var(--panel))`,
                }}
                title={`${s.sector}: ${fmtPct(s.avgPct)} across ${s.count} stocks`}
              >
                <span className="text-xs leading-tight font-medium">
                  {s.sector}
                </span>
                <Change
                  pct={s.avgPct}
                  showValue={false}
                  className="text-sm font-semibold !text-ink"
                />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
