"use client";
import { useMemo, useSyncExternalStore } from "react";
import { getMarketStatus, type MarketStatus } from "@/lib/market-hours";
import type { RegionId } from "@/lib/markets";

const BUCKET = 30_000;

function subscribe(cb: () => void) {
  const id = setInterval(cb, BUCKET);
  return () => clearInterval(id);
}
const snapshot = () => Math.floor(Date.now() / BUCKET);
const serverSnapshot = () => 0;

/** Live status for one market, recomputed every 30s. null until mounted (avoids SSR mismatch). */
export function useMarketStatus(region: RegionId = "au"): MarketStatus | null {
  const bucket = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return useMemo(() => (bucket === 0 ? null : getMarketStatus(new Date(bucket * BUCKET), region)), [bucket, region]);
}

/** Polling interval for quote refreshes: 60s while any of these markets is open, none otherwise. */
export function useRefreshMsFor(regions: RegionId[]): number {
  const bucket = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const key = [...new Set(regions)].sort().join(",");
  return useMemo(() => {
    if (bucket === 0 || !key) return 0;
    const now = new Date(bucket * BUCKET);
    return key.split(",").some((r) => getMarketStatus(now, r as RegionId).open) ? 60_000 : 0;
  }, [bucket, key]);
}

export function useRefreshMs(region: RegionId = "au"): number {
  return useRefreshMsFor([region]);
}
