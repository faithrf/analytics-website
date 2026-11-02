"use client";
import Link from "next/link";
import { useState } from "react";
import type { QuoteDTO } from "@/lib/yahoo";
import { MAX_BOARDS, MAX_NAME, type Board } from "@/lib/boards";
import { BOARD_PRESETS, PRESET_GROUPS } from "@/lib/board-presets";
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
  const [browsing, setBrowsing] = useState(false);
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
                aria-selected={!browsing && x.id === board.id}
                onClick={() => {
                  b.setActive(x.id);
                  setConfirmDelete(false);
                  setBrowsing(false);
                }}
                onDoubleClick={() => setRenaming(x.id)}
                title="Double-click to rename"
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  !browsing && x.id === board.id
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
        <button
          onClick={() => setBrowsing((v) => !v)}
          aria-pressed={browsing}
          className={`${smallButton} ${browsing ? "border-accent text-accent" : ""}`}
        >
          Browse ready-made
        </button>
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
      {browsing ? (
        <PresetBrowser
          added={new Set(b.boards.map((x) => x.name))}
          canAdd={b.boards.length < MAX_BOARDS}
          onAdd={(name, ids) => {
            if (b.create(name, ids)) setBrowsing(false);
          }}
        />
      ) : (
        <BoardGrid
          board={board}
          onUnpin={(id) => b.unpin(board.id, id)}
          onMove={(id, d) => b.move(board.id, id, d)}
        />
      )}
    </div>
  );
}

/** Scrollable list of ready-made dashboards with a live preview of the one picked. */
function PresetBrowser({
  added,
  canAdd,
  onAdd,
}: {
  added: Set<string>;
  canAdd: boolean;
  onAdd: (name: string, ids: string[]) => void;
}) {
  const [i, setI] = useState(0);
  const p = BOARD_PRESETS[i];
  const go = (d: number) => setI((x) => (x + d + BOARD_PRESETS.length) % BOARD_PRESETS.length);
  const have = added.has(p.name);
  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <nav
        aria-label="Ready-made dashboards"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            go(e.key === "ArrowDown" ? 1 : -1);
          }
        }}
        className="w-56 shrink-0 overflow-auto rounded-lg border border-line bg-panel p-1 outline-none focus-visible:border-accent"
      >
        {PRESET_GROUPS.map((g) => (
          <div key={g}>
            <div className="sticky top-0 bg-panel px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-muted uppercase">{g}</div>
            {BOARD_PRESETS.map((x, j) =>
              x.group === g ? (
                <button
                  key={x.name}
                  onClick={() => setI(j)}
                  ref={j === i ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                  aria-current={j === i}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                    j === i ? "bg-accent text-accentink" : "text-ink hover:bg-panel2"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  {added.has(x.name) && <span aria-label="added">✓</span>}
                  <span className="opacity-60">{x.ids.length}</span>
                </button>
              ) : null,
            )}
          </div>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
          <button onClick={() => go(-1)} aria-label="Previous dashboard" className={smallButton}>
            {"‹"}
          </button>
          <button onClick={() => go(1)} aria-label="Next dashboard" className={smallButton}>
            {"›"}
          </button>
          <span className="text-sm font-semibold">{p.name}</span>
          <span className="text-xs text-muted">
            {p.group} · {p.ids.length} stocks · {i + 1} of {BOARD_PRESETS.length}
          </span>
          <button
            onClick={() => onAdd(p.name, p.ids)}
            disabled={have || !canAdd}
            className="ml-auto rounded bg-accent px-2.5 py-1 text-xs font-semibold text-accentink disabled:opacity-50"
          >
            {have ? "Added" : canAdd ? "+ Add to my dashboards" : `Limit of ${MAX_BOARDS} dashboards reached`}
          </button>
        </div>
        <BoardGrid board={{ id: "preset", name: p.name, ids: p.ids }} />
      </div>
    </div>
  );
}

function BoardGrid({
  board,
  onUnpin,
  onMove,
}: {
  board: Board;
  /** Left out for read-only previews. */
  onUnpin?: (id: string) => void;
  onMove?: (id: string, delta: number) => void;
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
                {onMove && onUnpin && (
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
                )}
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
