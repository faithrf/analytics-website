"use client";
import { useCallback, useSyncExternalStore } from "react";
import { parseWatchlist, readRaw, writeWatchlist, WATCHLIST_KEY } from "@/lib/watchlist";

const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedList: string[] = EMPTY;
let memoryOnly = false; // storage unavailable: keep the list in memory for this tab

function getSnapshot(): string[] {
  if (memoryOnly) return cachedList;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parseWatchlist(raw);
  }
  return cachedList;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === WATCHLIST_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function commit(next: string[]) {
  const json = JSON.stringify(next);
  writeWatchlist(next);
  if (readRaw() !== json) memoryOnly = true;
  cachedRaw = json;
  cachedList = next;
  listeners.forEach((l) => l());
}

export function useWatchlist() {
  const list = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const toggle = useCallback((code: string) => {
    const cur = getSnapshot();
    commit(cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]);
  }, []);
  const remove = useCallback((code: string) => commit(getSnapshot().filter((c) => c !== code)), []);
  return { list, has: (code: string) => list.includes(code), toggle, remove };
}
