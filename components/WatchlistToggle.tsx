"use client";
import { useWatchlist } from "@/lib/use-watchlist";

export function WatchlistToggle({ code }: { code: string }) {
  const { has, toggle } = useWatchlist();
  const on = has(code);
  return (
    <button
      onClick={() => toggle(code)}
      aria-pressed={on}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
        on ? "border-accent bg-accent text-accentink" : "border-line hover:border-accent hover:text-accent"
      }`}
    >
      {on ? "★ Watching" : "☆ Watch"}
    </button>
  );
}
