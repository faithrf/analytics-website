"use client";
import Link from "next/link";
import type { QuoteDTO } from "@/lib/yahoo";
import { fmtNum, priceDigits } from "@/lib/format";
import { displayCode, marketOf, regionOf, toYahoo } from "@/lib/symbols";
import { useApi } from "@/lib/use-api";
import { useBoards } from "@/lib/use-boards";
import { useRefreshMsFor } from "@/lib/use-market-status";
import {
  Change,
  ErrorBox,
  Panel,
  Skeleton,
  Freshness,
  newest,
  QuoteTime,
  Tabs,
} from "@/components/ui";

/** Home-page view of one dashboard's pins. */
export function PinnedPanel() {
  const { boards, activeBoard, setActive, unpin } = useBoards();
  const list = activeBoard.ids;
  const refresh = useRefreshMsFor(list.map(regionOf));
  const url = list.length
    ? `/api/quotes?symbols=${list.map(toYahoo).join(",")}`
    : null;
  const { data, error, loading, stale, reload, updatedAt } = useApi<{
    quotes: QuoteDTO[];
  }>(url, refresh);
  const byId = new Map((data?.quotes ?? []).map((q) => [q.code, q]));

  const picker =
    boards.length <= 3 ? (
      <Tabs
        tabs={boards.map((b) => ({ id: b.id, label: b.name }))}
        value={activeBoard.id}
        onChange={setActive}
        label="Dashboard"
      />
    ) : (
      <select
        value={activeBoard.id}
        onChange={(e) => setActive(e.target.value)}
        aria-label="Dashboard"
        className="h-7 max-w-40 rounded-md border border-line bg-panel2 px-1.5 text-xs"
      >
        {boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    );

  return (
    <Panel
      className="min-h-[160px] flex-1"
      title={
        <Link href="/dashboard" className="hover:text-accent hover:underline">
          Pinned
        </Link>
      }
      right={
        <>
          {list.length > 0 && (
            <Freshness
              dataTime={newest((data?.quotes ?? []).map((q) => q.time))}
              updatedAt={updatedAt}
              refreshMs={refresh}
              stale={stale}
              onRefresh={reload}
            />
          )}
          {picker}
        </>
      }
      bodyClass="overflow-auto"
    >
      {list.length === 0 ? (
        <div className="space-y-1 p-3 text-sm">
          <p className="font-medium">Nothing pinned to {activeBoard.name}</p>
          <p className="text-muted">
            Open a stock and press Pin to add it here. Saved in this browser
            only. Try{" "}
            {["BHP", "AAPL.US", "7203.T"].map((c, i) => (
              <span key={c}>
                {i > 0 && ", "}
                <Link
                  href={`/stock/${c}`}
                  className="font-semibold text-accent hover:underline"
                >
                  {displayCode(c)}
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
          {list.map((id) => {
            const q = byId.get(id);
            return (
              <li
                key={id}
                className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-sm last:border-0"
              >
                <Link
                  href={`/stock/${id}`}
                  className="w-16 truncate font-semibold text-accent hover:underline"
                >
                  {displayCode(id)}
                </Link>
                <span className="w-10 text-xs text-muted">{marketOf(id)}</span>
                <QuoteTime t={q?.time} className="w-20" />
                {q ? (
                  <>
                    <span className="flex-1 text-right">
                      {fmtNum(q.price, priceDigits(q.price))}
                    </span>
                    <span className="w-24 text-right font-medium">
                      <Change pct={q.changePct} showValue={false} />
                    </span>
                  </>
                ) : (
                  <span className="flex-1 text-right text-muted">No quote</span>
                )}
                <button
                  onClick={() => unpin(activeBoard.id, id)}
                  aria-label={`Unpin ${displayCode(id)} from ${activeBoard.name}`}
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
