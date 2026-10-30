"use client";
import Link from "next/link";
import { useState } from "react";
import type { QuoteDTO } from "@/lib/yahoo";
import { MAX_BOARDS, MAX_NAME, type Board } from "@/lib/boards";
import { direction, fmtNum, priceDigits } from "@/lib/format";
import { displayCode, marketOf, regionOf, toYahoo } from "@/lib/symbols";
import { useApi } from "@/lib/use-api";
import { useBoards } from "@/lib/use-boards";
import { useRefreshMsFor } from "@/lib/use-market-status";
import {
  Change,
  ErrorBox,
  Skeleton,
  Freshness,
  newest,
  QuoteTime,
} from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";
import { SyncMenu } from "@/components/SyncMenu";

type Spark = { points: { t: number; v: number }[]; prevClose: number | null };

const inputClass =
  "h-7 w-40 rounded border border-line bg-bg px-2 text-sm outline-none placeholder:text-muted focus:border-accent";
const smallButton =
  "rounded border border-line px-2 py-1 text-xs font-medium hover:border-accent hover:text-accent";

/** Inline text field: Enter saves, Escape or blur cancels. */
function NameField({
  initial,
  label,
  onSave,
  onCancel,
}: {
  initial: string;
  label: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <input
      autoFocus
      value={v}
      maxLength={MAX_NAME}
      aria-label={label}
      placeholder="Dashboard name"
      onChange={(e) => setV(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Enter" && v.trim()) onSave(v);
        if (e.key === "Escape") onCancel();
      }}
      className={inputClass}
    />
  );
}

export function BoardsView() {
  const b = useBoards();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const board = b.activeBoard;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
        <div
          role="tablist"
          aria-label="Dashboards"
          className="flex flex-wrap items-center gap-0.5 rounded-md bg-panel2 p-0.5"
        >
          {b.boards.map((x) =>
            renaming === x.id ? (
              <NameField
                key={x.id}
                initial={x.name}
                label={`Rename ${x.name}`}
                onSave={(n) => {
                  b.rename(x.id, n);
                  setRenaming(null);
                }}
                onCancel={() => setRenaming(null)}
              />
            ) : (
              <button
                key={x.id}
                role="tab"
                aria-selected={x.id === board.id}
                onClick={() => {
                  b.setActive(x.id);
                  setConfirmDelete(false);
                }}
                onDoubleClick={() => setRenaming(x.id)}
                title="Double-click to rename"
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  x.id === board.id
                    ? "bg-accent text-accentink"
                    : "text-muted hover:text-ink"
                }`}
              >
                {x.name} <span className="opacity-70">{x.ids.length}</span>
              </button>
            ),
          )}
        </div>
        {adding ? (
          <NameField
            initial=""
            label="New dashboard name"
            onSave={(n) => {
              b.create(n);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          b.boards.length < MAX_BOARDS && (
            <button onClick={() => setAdding(true)} className={smallButton}>
              + New dashboard
            </button>
          )
        )}
        <div className="ml-auto flex items-center gap-2">
          <SyncMenu />
          {confirmDelete ? (
            <>
              <span className="text-xs">
                Delete {board.name} and its {board.ids.length} pins?
              </span>
              <button
                onClick={() => {
                  b.remove(board.id);
                  setConfirmDelete(false);
                }}
                className="rounded border border-loss px-2 py-1 text-xs font-medium text-loss hover:bg-loss hover:text-accentink"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className={smallButton}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setRenaming(board.id)}
                className={smallButton}
              >
                Rename
              </button>
              {b.boards.length > 1 && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className={smallButton}
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <BoardGrid
        board={board}
        onUnpin={(id) => b.unpin(board.id, id)}
        onMove={(id, d) => b.move(board.id, id, d)}
      />
    </div>
  );
}

function BoardGrid({
  board,
  onUnpin,
  onMove,
}: {
  board: Board;
  onUnpin: (id: string) => void;
  onMove: (id: string, delta: number) => void;
}) {
  const ids = board.ids;
  const refresh = useRefreshMsFor(ids.map(regionOf));
  const symbols = ids.map(toYahoo).join(",");
  const quotes = useApi<{ quotes: QuoteDTO[] }>(
    ids.length ? `/api/quotes?symbols=${symbols}` : null,
    refresh,
  );
  const sparks = useApi<{ sparks: Record<string, Spark> }>(
    ids.length ? `/api/sparks?symbols=${symbols}` : null,
    refresh,
  );
  const byId = new Map((quotes.data?.quotes ?? []).map((q) => [q.code, q]));

  if (ids.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-sm">
        <p className="font-medium">{board.name} has no pins yet</p>
        <p className="text-muted">
          Search for a stock in any market and press Pin to add it here.
        </p>
      </div>
    );
  }
  if (quotes.error && !quotes.data)
    return <ErrorBox error={quotes.error} onRetry={quotes.reload} />;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mb-2 flex justify-end">
        <Freshness
          dataTime={newest((quotes.data?.quotes ?? []).map((q) => q.time))}
          updatedAt={quotes.updatedAt}
          refreshMs={refresh}
          stale={quotes.stale}
          onRefresh={() => {
            quotes.reload();
            sparks.reload();
          }}
        />
      </div>
      <ul className="grid auto-rows-[148px] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
        {ids.map((id, i) => {
          const q = byId.get(id);
          const spark = sparks.data?.sparks[toYahoo(id)];
          const digits = priceDigits(q?.price);
          return (
            <li
              key={id}
              className="flex min-w-0 flex-col rounded-lg border border-line bg-panel p-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <Link
                      href={`/stock/${id}`}
                      className="font-semibold text-accent hover:underline"
                    >
                      {displayCode(id)}
                    </Link>
                    <span className="text-xs text-muted">{marketOf(id)}</span>
                    <QuoteTime t={q?.time} />
                  </div>
                  <div className="truncate text-xs text-muted">
                    {q?.name ?? " "}
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5 text-muted">
                  <button
                    onClick={() => onMove(id, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${displayCode(id)} left`}
                    className="rounded px-1 hover:text-accent disabled:opacity-30"
                  >
                    {"‹"}
                  </button>
                  <button
                    onClick={() => onMove(id, 1)}
                    disabled={i === ids.length - 1}
                    aria-label={`Move ${displayCode(id)} right`}
                    className="rounded px-1 hover:text-accent disabled:opacity-30"
                  >
                    {"›"}
                  </button>
                  <button
                    onClick={() => onUnpin(id)}
                    aria-label={`Unpin ${displayCode(id)} from ${board.name}`}
                    className="rounded px-1 hover:text-loss"
                  >
                    {"×"}
                  </button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-end justify-between gap-2">
                {q ? (
                  <div className="flex flex-col">
                    <span className="text-xl leading-tight font-semibold tracking-tight">
                      {fmtNum(q.price, digits)}{" "}
                      <span className="text-xs font-normal text-muted">
                        {q.currency}
                      </span>
                    </span>
                    <Change
                      value={q.change}
                      pct={q.changePct}
                      digits={digits}
                      className="text-xs font-medium"
                    />
                  </div>
                ) : quotes.loading ? (
                  <Skeleton className="h-10 w-24" />
                ) : (
                  <span className="text-xs text-muted">No quote</span>
                )}
                <div className="h-14 w-1/2 min-w-0">
                  {spark ? (
                    <Sparkline
                      data={spark.points}
                      dir={direction(q?.changePct)}
                      prevClose={spark.prevClose}
                    />
                  ) : (
                    sparks.loading && <Skeleton className="h-full w-full" />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
