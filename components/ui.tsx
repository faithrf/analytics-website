"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
      className={`flex min-h-0 min-w-0 flex-col rounded-lg border border-line bg-panel ${className}`}
    >
      {(title || right) && (
        <header className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-1">
          <h2 className="min-w-0 text-sm font-semibold tracking-tight whitespace-nowrap">{title}</h2>
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{right}</div>
        </header>
      )}
      {/* relative: screen-reader-only text in a scrolling table must not widen the page */}
      <div className={`relative min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export type DropdownOption<T extends string> = { id: T; label: string; group?: string; badge?: string };

/**
 * Styled replacement for <select>: the native phone picker can't be themed.
 * Phones get a bottom sheet; wider screens a popover anchored under the button
 * (fixed, so a scrolling panel can't clip it).
 */
export function Dropdown<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
}: {
  options: readonly DropdownOption<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const cur = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      setOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 240) });
    setOpen((o) => !o);
  };

  return (
    <div className={className}>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-line bg-panel2 px-2.5 py-1.5 text-left text-sm text-ink"
      >
        <span className="min-w-0 truncate">
          {cur?.group && <span className="text-muted">{cur.group} · </span>}
          {cur?.label ?? "Choose"}
        </span>
        <svg aria-hidden viewBox="0 0 20 20" className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          <button aria-label="Close" tabIndex={-1} className="fixed inset-0 z-[60] cursor-default bg-black/50 md:bg-transparent" onClick={() => setOpen(false)} />
          <ul
            role="listbox"
            aria-label={label}
            style={pos ? ({ "--dd-left": `${pos.left}px`, "--dd-top": `${pos.top}px`, "--dd-w": `${pos.width}px` } as React.CSSProperties) : undefined}
            className="fixed inset-x-0 bottom-0 z-[61] max-h-[70dvh] overflow-auto rounded-t-2xl border-t border-line bg-panel p-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-2xl md:inset-x-auto md:bottom-auto md:top-[var(--dd-top)] md:left-[var(--dd-left)] md:max-h-[60vh] md:w-[var(--dd-w)] md:rounded-lg md:border md:pb-1.5"
          >
            {options.map((o, i) => {
              const header = o.group && o.group !== options[i - 1]?.group ? o.group : null;
              const sel = o.id === value;
              return (
                <li key={o.id} role="presentation">
                  {header && (
                    <div className="px-2.5 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-muted uppercase first:pt-1">
                      {header}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={sel}
                    onClick={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm md:py-1.5 ${sel ? "bg-panel2 font-medium text-accent" : "text-ink hover:bg-panel2"}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.badge && (
                      <span className="shrink-0 rounded bg-accent px-1 py-px text-[10px] font-semibold text-accentink">{o.badge}</span>
                    )}
                    <svg aria-hidden viewBox="0 0 20 20" className={`size-4 shrink-0 ${sel ? "" : "invisible"}`} fill="none" stroke="currentColor" strokeWidth={2.2}>
                      <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
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
  // Many tabs overflow a phone header and hide off-screen, so phones get a dropdown instead.
  const many = tabs.length > 5;
  return (
    <>
    {many && (
      <Dropdown
        label={label}
        value={value}
        onChange={onChange}
        options={tabs}
        className="md:hidden"
      />
    )}
    <div
      role="tablist"
      aria-label={label}
      className={`${many ? "hidden md:flex" : "flex"} max-w-full gap-0.5 overflow-x-auto rounded-md bg-panel2 p-0.5 whitespace-nowrap [scrollbar-width:none]`}
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
            className={`shrink-0 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              active ? "bg-accent text-accentink" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
    </>
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
    "inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted";
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
