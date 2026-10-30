"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useSyncExternalStore } from "react";
import { isRegion, region, type RegionId } from "@/lib/markets";
import { regionOf } from "@/lib/symbols";
import { useMarketStatus } from "@/lib/use-market-status";
import { SearchBox } from "@/components/SearchBox";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function hoursNote(id: RegionId): string {
  if (id === "au") {
    return "ASX trading hours: 10:00-16:00 Sydney time, Monday to Friday. National ASX holidays are closed; early close 14:10 on Christmas Eve and New Year's Eve.";
  }
  const r = region(id);
  const lunch = r.lunch ? `, with a break ${hhmm(r.lunch[0])}-${hhmm(r.lunch[1])}` : "";
  return `${r.exchange} trading hours: ${hhmm(r.open)}-${hhmm(r.close)} local time (${r.tz}), Monday to Friday${lunch}. Public holidays are not shown for this market.`;
}

/** The market being looked at: the home tab, or the open stock's exchange. */
function useViewedRegion(): RegionId {
  const path = usePathname();
  const params = useSearchParams();
  if (path.startsWith("/stock/")) return regionOf(decodeURIComponent(path.slice(7)).toUpperCase());
  const r = params.get("region");
  return path === "/" && isRegion(r) ? r : "au";
}

function MarketBadge() {
  const id = useViewedRegion();
  const s = useMarketStatus(id);
  if (!s) return <div className="h-7 w-44 rounded-full border border-line" aria-hidden />;
  const name = region(id).exchange;
  return (
    <div
      className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs whitespace-nowrap"
      role="status"
      title={hoursNote(id)}
    >
      <span
        aria-hidden
        className={`inline-block size-2 ${s.open ? "rounded-full bg-gain" : "rounded-[2px] border border-muted"}`}
      />
      <span className="font-semibold">{s.open ? `${name} open` : s.holiday ? `${name} closed \u2014 ${s.holiday}` : `${name} closed`}</span>
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
      className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted hover:border-accent hover:text-accent"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? (
        <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

function NavLink({ href, children }: { href: string; children: string }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" || path.startsWith("/stock/") : path.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-2.5 py-1 text-sm font-medium ${active ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}
    >
      {children}
    </Link>
  );
}

export function Header() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-3">
      <Link href="/" className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="text-base font-bold tracking-tight">Bellwether</span>
      </Link>
      <nav aria-label="Main" className="flex items-center gap-1">
        <NavLink href="/">Markets</NavLink>
        <NavLink href="/dashboard">Dashboard</NavLink>
        <NavLink href="/news">News</NavLink>
      </nav>
      <div className="flex min-w-0 flex-1 justify-center">
        <SearchBox />
      </div>
      <Suspense fallback={<div className="h-7 w-44 rounded-full border border-line" aria-hidden />}>
        <MarketBadge />
      </Suspense>
      <ThemeToggle />
    </header>
  );
}
