"use client";
import Link from "next/link";
import type { QuoteDTO } from "@/lib/yahoo";
import { fmtNum, priceDigits } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useRefreshMs } from "@/lib/use-market-status";
import { useWatchlist } from "@/lib/use-watchlist";
import { Change, ErrorBox, Panel, Skeleton, StaleNote } from "@/components/ui";

export function WatchlistPanel() {
  const { list, remove } = useWatchlist();
  const refresh = useRefreshMs();
  const url = list.length ? `/api/quotes?symbols=${list.map((c) => `${c}.AX`).join(",")}` : null;
  const { data, error, loading, stale, reload } = useApi<{ quotes: QuoteDTO[] }>(url, refresh);
  const byCode = new Map((data?.quotes ?? []).map((q) => [q.code, q]));

  return (
    <Panel
      className="min-h-[160px] flex-1"
      title="Watchlist"
      right={<StaleNote show={stale} />}
      bodyClass="overflow-auto"
    >
      {list.length === 0 ? (
        <div className="space-y-1 p-3 text-sm">
          <p className="font-medium">Nothing watched yet</p>
          <p className="text-muted">
            Open a stock and press Watch to track it here. Saved in this browser only. Try{" "}
            {["BHP", "CBA", "CSL"].map((c, i) => (
              <span key={c}>
                {i > 0 && ", "}
                <Link href={`/stock/${c}`} className="font-semibold text-accent hover:underline">
                  {c}
                </Link>
              </span>
            ))}
            .
          </p>
        </div>
      ) : error && !data ? (
        <div className="p-3">
          <ErrorBox error={error} onRetry={reload} compact />
        </div>
      ) : loading && !data ? (
        <div className="space-y-2 p-3">
          {list.map((c) => (
            <Skeleton key={c} className="h-6 w-full" />
          ))}
        </div>
      ) : (
        <ul>
          {list.map((code) => {
            const q = byCode.get(code);
            return (
              <li key={code} className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-sm last:border-0">
                <Link href={`/stock/${code}`} className="w-14 font-semibold text-accent hover:underline">
                  {code}
                </Link>
                {q ? (
                  <>
                    <span className="flex-1 text-right">{fmtNum(q.price, priceDigits(q.price))}</span>
                    <span className="w-28 text-right font-medium">
                      <Change pct={q.changePct} showValue={false} />
                    </span>
                  </>
                ) : (
                  <span className="flex-1 text-right text-muted">No quote</span>
                )}
                <button
                  onClick={() => remove(code)}
                  aria-label={`Remove ${code} from watchlist`}
                  className="rounded px-1.5 text-muted hover:text-loss"
                >
                  {"×"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
