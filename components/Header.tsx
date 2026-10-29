"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useMarketStatus } from "@/lib/use-market-status";
import { SearchBox } from "@/components/SearchBox";

function MarketBadge() {
  const s = useMarketStatus();
  if (!s) return <div className="h-7 w-44 rounded-full border border-line" aria-hidden />;
  return (
    <div
      className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs whitespace-nowrap"
      role="status"
      title="ASX trading hours: 10:00-16:00 Sydney time, Monday to Friday. National ASX holidays are closed; early close 14:10 on Christmas Eve and New Year's Eve."
    >
      <span
        aria-hidden
        className={`inline-block size-2 ${s.open ? "rounded-full bg-gain" : "rounded-[2px] border border-muted"}`}
      />
      <span className="font-semibold">{s.open ? "Market open" : s.holiday ? `Closed \u2014 ${s.holiday}` : "Market closed"}</span>
      <span className="hidden text-muted md:inline">{s.holiday ? s.label.slice(s.label.indexOf(". ") + 2) : s.label}</span>
    </div>
  );
}

const themeListeners = new Set<() => void>();
const getTheme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function ThemeToggle() {
  const theme = useSyncExternalStore(
    (cb) => {
      themeListeners.add(cb);
      return () => themeListeners.delete(cb);
    },
    getTheme,
    () => "dark",
  );
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("asx-theme", next);
        } catch {
          /* ignore: theme just will not persist */
        }
        themeListeners.forEach((l) => l());
      }}
      className="rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium hover:border-accent hover:text-accent"
      aria-label={`Switch to ${next} theme`}
    >
      {theme === "dark" ? "Light theme" : "Dark theme"}
    </button>
  );
}

export function Header() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-3">
      <Link href="/" className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="text-base font-bold tracking-tight">Bellwether</span>
        <span className="hidden text-xs text-muted sm:inline">ASX dashboard</span>
      </Link>
      <div className="flex min-w-0 flex-1 justify-center">
        <SearchBox />
      </div>
      <MarketBadge />
      <ThemeToggle />
    </header>
  );
}
