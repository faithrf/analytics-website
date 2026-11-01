export function Footer() {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-line bg-panel px-3 text-xs text-muted">
      <span className="truncate">© 2026 Meridian · Data delayed ~20 min. Not financial advice.</span>
      <span
        className="hidden truncate lg:inline"
        title="Meridian is not affiliated with or endorsed by Yahoo, any exchange or any news publisher. Trademarks and headlines belong to their owners; stories link to the original source."
      >
        Unofficial Yahoo Finance data, for personal and educational use. Not affiliated with Yahoo, any exchange or
        publisher; trademarks belong to their owners. Open source (MIT).
      </span>
    </footer>
  );
}
