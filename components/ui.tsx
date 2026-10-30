"use client";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { direction, fmtPct, fmtSigned } from "@/lib/format";
import type { ApiErr } from "@/lib/use-api";

export function Panel({
  title,
  right,
  children,
  className = "",
  bodyClass = "",
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-lg border border-line bg-panel ${className}`}
    >
      {(title || right) && (
        <header className="flex min-h-10 items-center justify-between gap-3 border-b border-line px-3 py-1">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <div className="flex items-center gap-2">{right}</div>
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-0.5 rounded-md bg-panel2 p-0.5"
    >
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              const i = tabs.findIndex((x) => x.id === value);
              if (e.key === "ArrowRight")
                onChange(tabs[(i + 1) % tabs.length].id);
              if (e.key === "ArrowLeft")
                onChange(tabs[(i - 1 + tabs.length) % tabs.length].id);
            }}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              active ? "bg-accent text-accentink" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

const ARROW = { up: "▲", down: "▼", flat: "▬" } as const;
const COLOUR = {
  up: "text-gain",
  down: "text-loss",
  flat: "text-muted",
} as const;

/** Signed change with an arrow, so direction never relies on colour alone. */
export function Change({
  value,
  pct,
  digits = 2,
  showValue = true,
  className = "",
}: {
  value?: number | null;
  pct?: number | null;
  digits?: number;
  showValue?: boolean;
  className?: string;
}) {
  const dir = direction(pct ?? value);
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap ${COLOUR[dir]} ${className}`}
    >
      <span aria-hidden className="text-[0.7em]">
        {ARROW[dir]}
      </span>
      {showValue && value !== undefined && (
        <span>{fmtSigned(value, digits)}</span>
      )}
      {pct !== undefined && (
        <span>
          {showValue && value !== undefined ? `(${fmtPct(pct)})` : fmtPct(pct)}
        </span>
      )}
      <span className="sr-only">
        {dir === "up" ? "up" : dir === "down" ? "down" : "unchanged"}
      </span>
    </span>
  );
}

export function ErrorBox({
  error,
  onRetry,
  compact = false,
}: {
  error: ApiErr;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const title =
    error.code === "rate_limited"
      ? "Yahoo is rate limiting requests"
      : error.code === "not_found"
        ? "Not found"
        : error.code === "upstream" || error.code === "network"
          ? "Can't load data right now"
          : "Something went wrong";
  return (
    <div
      role="alert"
      className={`flex flex-col items-start justify-center gap-1.5 rounded-md border border-line bg-panel2 p-3 text-sm ${compact ? "" : "h-full"}`}
    >
      <p className="font-medium">{title}</p>
      <p className="text-muted">{error.message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 rounded border border-line px-2.5 py-1 text-xs font-medium hover:border-accent hover:text-accent"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

const NOW_STEP = 5_000;
function subscribeNow(cb: () => void) {
  const id = setInterval(cb, NOW_STEP);
  return () => clearInterval(id);
}
/** Current time in 5s steps, so "checked 20 s ago" labels tick. 0 during SSR. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeNow,
    () => Math.floor(Date.now() / NOW_STEP) * NOW_STEP,
    () => 0,
  );
}

export function agoShort(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** Clock time in the viewer's zone; adds the weekday or date when it is not today. */
export function whenShort(t: number, now: number): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  const days = (now - t) / 86_400_000;
  const day = d.toLocaleDateString(
    undefined,
    days < 6 ? { weekday: "short" } : { day: "numeric", month: "short" },
  );
  return `${day} ${time}`;
}

const whenLong = (t: number) =>
  new Date(t).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

/** Newest of a list of timestamps (ms), ignoring missing ones. */
export function newest(times: (number | null | undefined)[]): number | null {
  let m: number | null = null;
  for (const t of times) if (t && (m === null || t > m)) m = t;
  return m;
}

/**
 * How fresh a panel's data is: when the underlying prices/stories are from,
 * when this page last fetched them, and whether it is auto-refreshing.
 * Click to refresh now.
 */
export function Freshness({
  dataTime,
  updatedAt,
  refreshMs,
  stale = false,
  onRefresh,
  kind = "prices",
}: {
  /** time of the newest trade or story in the data (ms) */
  dataTime: number | null | undefined;
  /** when this page last fetched successfully (ms) */
  updatedAt: number | undefined;
  /** current auto-refresh interval; 0 means paused */
  refreshMs: number;
  stale?: boolean;
  onRefresh?: () => void;
  kind?: "prices" | "news" | "chart";
}) {
  const now = useNow();
  // manual refresh feedback: spin until new data lands (at least briefly), then confirm
  const [clickedAt, setClickedAt] = useState(0);
  const [minSpin, setMinSpin] = useState(false);
  if (!now || !updatedAt)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted">
        <span aria-hidden className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-muted" />
        Loading…
      </span>
    );
  const waiting = clickedAt > 0 && updatedAt < clickedAt && !stale;
  const spinning = minSpin || waiting;
  const done = clickedAt > 0 && !spinning;
  const refresh = () => {
    setClickedAt(Date.now());
    setMinSpin(true);
    setTimeout(() => setMinSpin(false), 700);
    setTimeout(() => setClickedAt(0), 4000);
    onRefresh?.();
  };
  const label =
    kind === "news"
      ? "Newest story"
      : kind === "chart"
        ? "Chart to"
        : "Last trade";
  const cacheFor =
    kind === "news" ? "5 min" : kind === "chart" ? "10 min" : "60 s";
  const lines = [
    dataTime
      ? kind === "news"
        ? `Newest story published ${whenLong(dataTime)} (your time).`
        : `Last trade in this data: ${whenLong(dataTime)} (your time). Source: Yahoo Finance; free quotes can lag the exchange by up to 15-20 min.`
      : "The source did not give a time for this data.",
    `Checked: this page last asked the server at ${whenLong(updatedAt)}. The server re-asks Yahoo at most every ${cacheFor}, so a refresh can return the same data.`,
    refreshMs > 0
      ? `Auto-refreshing every ${Math.round(refreshMs / 1000)} s${kind === "news" ? "" : " while the market is open"}.`
      : kind === "news"
        ? "Not auto-refreshing right now."
        : "Market closed, so not auto-refreshing: the last trade is from the last session.",
    stale
      ? "The last refresh failed, so you are seeing the previous data."
      : "",
    onRefresh ? "Click to refresh now." : "",
  ].filter(Boolean);
  const body = (
    <>
      <span
        aria-hidden
        className={`inline-block size-1.5 shrink-0 rounded-full ${stale ? "bg-loss" : refreshMs > 0 ? "bg-gain" : "bg-muted"}`}
      />
      <span className="truncate">
        {dataTime
          ? `${label} ${whenShort(dataTime, now)}`
          : `${label} time unknown`}
        {" · "}
        {spinning ? (
          "checking…"
        ) : done ? (
          <span className="text-gain">
            checked {whenShort(updatedAt, now)} ✓
          </span>
        ) : (
          `checked ${whenShort(updatedAt, now)}`
        )}
        {stale && <span className="text-loss"> · refresh failed</span>}
      </span>
      {onRefresh && (
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className={`size-3 shrink-0 ${spinning ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      )}
    </>
  );
  const NL = "\n";
  const cls =
    "inline-flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted";
  return onRefresh ? (
    <button
      type="button"
      onClick={refresh}
      disabled={spinning}
      aria-busy={spinning}
      title={lines.join(NL)}
      className={`${cls} rounded hover:text-accent disabled:cursor-wait`}
    >
      {body}
    </button>
  ) : (
    <span title={lines.join(NL)} className={cls}>
      {body}
    </span>
  );
}

/** Last-trade time for one quote, e.g. "3:42 pm" or "Thu 4:10 pm" when it is from an earlier day. */
export function QuoteTime({
  t,
  className = "",
}: {
  t: number | null | undefined;
  className?: string;
}) {
  const now = useNow();
  if (!now || !t) return null;
  return (
    <span
      className={`text-[11px] whitespace-nowrap text-muted ${className}`}
      title={`Last trade ${whenLong(t)} (your time)`}
    >
      {whenShort(t, now)}
    </span>
  );
}

/** Publish time for a story: clock time plus how long ago, full date on hover. */
export function StoryTime({
  t,
  className = "",
}: {
  t: number | null | undefined;
  className?: string;
}) {
  const now = useNow();
  if (!now || !t) return null;
  return (
    <time
      dateTime={new Date(t).toISOString()}
      className={`whitespace-nowrap ${className}`}
      title={`Published ${whenLong(t)} (your time)`}
    >
      {whenShort(t, now)} · {agoShort(t, now)}
    </time>
  );
}
