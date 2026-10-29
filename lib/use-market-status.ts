"use client";
import { useMemo, useSyncExternalStore } from "react";
import { getMarketStatus, type MarketStatus } from "@/lib/market-hours";

const BUCKET = 30_000;

function subscribe(cb: () => void) {
  const id = setInterval(cb, BUCKET);
  return () => clearInterval(id);
}
const snapshot = () => Math.floor(Date.now() / BUCKET);
const serverSnapshot = () => 0;

/** Live ASX status, recomputed every 30s. null until mounted (avoids SSR mismatch). */
export function useMarketStatus(): MarketStatus | null {
  const bucket = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return useMemo(() => (bucket === 0 ? null : getMarketStatus(new Date(bucket * BUCKET))), [bucket]);
}

/** Polling interval for quote refreshes: 60s while open, none while closed. */
export function useRefreshMs(): number {
  const s = useMarketStatus();
  return s?.open ? 60_000 : 0;
}
