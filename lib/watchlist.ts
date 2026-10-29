export const WATCHLIST_KEY = "asx-watchlist-v1";

export function parseWatchlist(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const x of v) {
      if (typeof x === "string" && /^[A-Z0-9]{1,6}$/.test(x) && !out.includes(x)) out.push(x);
    }
    return out.slice(0, 100);
  } catch {
    return [];
  }
}

export function readRaw(): string | null {
  try {
    return window.localStorage.getItem(WATCHLIST_KEY);
  } catch {
    return null;
  }
}

export function writeWatchlist(codes: string[]): void {
  try {
    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(codes));
  } catch {
    /* storage unavailable (private mode, quota): the watchlist just will not persist */
  }
}
