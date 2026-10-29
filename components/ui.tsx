"use client";
import type { ReactNode } from "react";
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
    <section className={`flex min-h-0 flex-col rounded-lg border border-line bg-panel ${className}`}>
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
    <div role="tablist" aria-label={label} className="flex gap-0.5 rounded-md bg-panel2 p-0.5">
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
              if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length].id);
              if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length].id);
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
const COLOUR = { up: "text-gain", down: "text-loss", flat: "text-muted" } as const;

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
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${COLOUR[dir]} ${className}`}>
      <span aria-hidden className="text-[0.7em]">
        {ARROW[dir]}
      </span>
      {showValue && value !== undefined && <span>{fmtSigned(value, digits)}</span>}
      {pct !== undefined && <span>{showValue && value !== undefined ? `(${fmtPct(pct)})` : fmtPct(pct)}</span>}
      <span className="sr-only">{dir === "up" ? "up" : dir === "down" ? "down" : "unchanged"}</span>
    </span>
  );
}

export function ErrorBox({ error, onRetry, compact = false }: { error: ApiErr; onRetry?: () => void; compact?: boolean }) {
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

export function StaleNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="text-xs text-muted">Refresh failed, showing last data</span>;
}
