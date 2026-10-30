"use client";
import { direction, fmtNum, priceDigits } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useRefreshMs } from "@/lib/use-market-status";
import type { RegionId } from "@/lib/markets";
import type { QuoteDTO } from "@/lib/yahoo";
import { Change, ErrorBox, QuoteTime, Skeleton } from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";

interface Tile {
  label: string;
  symbol: string;
  quote: QuoteDTO | null;
  spark: { t: number; v: number }[];
  prevClose: number | null;
}

export function IndexTiles({ regionId }: { regionId: RegionId }) {
  const refresh = useRefreshMs(regionId);
  const { data, error, loading, reload } = useApi<{ tiles: Tile[] }>(
    `/api/overview?region=${regionId}`,
    refresh,
  );

  if (error && !data) {
    return (
      <div className="h-[116px]">
        <ErrorBox error={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {(loading || !data ? [null, null, null] : data.tiles).map((t, i) =>
        t === null ? (
          <div
            key={i}
            className="h-[116px] rounded-lg border border-line bg-panel p-3"
          >
            <Skeleton className="mb-2 h-4 w-24" />
            <Skeleton className="mb-2 h-7 w-32" />
            <Skeleton className="h-4 w-28" />
          </div>
        ) : (
          <TileCard key={t.symbol} tile={t} />
        ),
      )}
    </div>
  );
}

function TileCard({ tile }: { tile: Tile }) {
  const q = tile.quote;
  const dir = direction(q?.changePct);
  const digits = priceDigits(q?.price, tile.symbol);
  return (
    <div className="flex h-[116px] items-stretch justify-between gap-2 rounded-lg border border-line bg-panel p-3">
      <div className="flex min-w-0 flex-col justify-between">
        <div className="flex items-baseline gap-2 text-sm text-muted">
          {tile.label}
          <QuoteTime t={q?.time} />
        </div>
        {q ? (
          <>
            <div className="text-[1.65rem] leading-none font-semibold tracking-tight">
              {fmtNum(q.price, digits)}
            </div>
            <Change
              value={q.change}
              pct={q.changePct}
              digits={digits}
              className="text-sm font-medium"
            />
          </>
        ) : (
          <div className="text-sm text-muted">Quote unavailable</div>
        )}
      </div>
      <div className="h-full w-[46%] min-w-0 self-end">
        <Sparkline data={tile.spark} dir={dir} prevClose={tile.prevClose} />
      </div>
    </div>
  );
}
