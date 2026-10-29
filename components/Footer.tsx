export function Footer() {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-line bg-panel px-3 text-xs text-muted">
      <span>Data delayed ~20 min. Not financial advice.</span>
      <span className="hidden sm:inline">Unofficial Yahoo Finance data, for personal and educational use. Open source (MIT).</span>
    </footer>
  );
}
