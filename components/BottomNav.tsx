"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const isActive = (href: string, path: string) =>
  href === "/" ? path === "/" || path.startsWith("/stock/") : path.startsWith(href);

const ICON: Record<string, string> = {
  markets: "M4 19h16M6 15l4-4 3 3 6-6",
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  trades: "M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3",
  news: "M5 5h11v14H6a1 1 0 0 1-1-1zM16 9h3v9a1 1 0 0 1-2 0M8 9h5M8 12h5M8 15h3",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  backtest: "M12 8v4l3 2M4 12a8 8 0 1 0 2.3-5.7M4 4v3h3",
  model: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  leaders: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-5M16 14a5 5 0 0 1 6 6",
};

const MAIN = [
  { href: "/", label: "Markets", icon: "markets" },
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/trades", label: "Trades", icon: "trades" },
  { href: "/news", label: "News", icon: "news" },
] as const;

const MORE = [
  { href: "/backtest", label: "Backtest", icon: "backtest" },
  { href: "/model", label: "Model", icon: "model" },
  { href: "/leaders", label: "Leaders", icon: "leaders" },
] as const;

function Icon({ name }: { name: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3.5 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICON[name]} />
    </svg>
  );
}

/** Phone-only tab bar fixed to the bottom of the screen, thumb-reachable. */
export function BottomNav() {
  const path = usePathname();
  // Remember which page the sheet was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) =>
    setOpenOn((typeof v === "function" ? v(open) : v) ? path : null);
  const moreActive = MORE.some((m) => isActive(m.href, path));
  const tab = (active: boolean) =>
    `flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium ${active ? "text-accent" : "text-muted"}`;

  return (
    <>
      <div aria-hidden className="h-[calc(3.75rem+env(safe-area-inset-bottom))] shrink-0 md:hidden" />
      {open && <button aria-label="Close menu" className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}
      {open && (
        <nav
          aria-label="More"
          className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-50 rounded-t-2xl border-t border-line bg-panel p-2 md:hidden"
        >
          {MORE.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              aria-current={isActive(m.href, path) ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-4 py-3.5 text-base ${isActive(m.href, path) ? "bg-panel2 font-semibold text-ink" : "text-ink"}`}
            >
              <Icon name={m.icon} />
              {m.label}
            </Link>
          ))}
        </nav>
      )}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 flex h-[calc(3.75rem+env(safe-area-inset-bottom))] border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {MAIN.map((m) => {
          const active = isActive(m.href, path) && !open;
          return (
            <Link key={m.href} href={m.href} aria-current={active ? "page" : undefined} className={tab(active)}>
              <Icon name={m.icon} />
              {m.label}
            </Link>
          );
        })}
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className={tab(open || moreActive)}>
          <Icon name="more" />
          More
        </button>
      </nav>
    </>
  );
}
