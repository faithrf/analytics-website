"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiErr {
  code: string;
  message: string;
}

interface State<T> {
  url: string | null;
  data?: T;
  error?: ApiErr;
  at?: number;
}

function normalise(e: unknown): ApiErr {
  if (e && typeof e === "object" && "message" in e && "code" in e)
    return e as ApiErr;
  return {
    code: "network",
    message: "Could not reach the server. Check your connection and retry.",
  };
}

/**
 * Fetch JSON from our own API. Keeps the last good data when a refresh fails,
 * and never throws into React. `refreshMs` of 0 disables polling.
 */
export function useApi<T>(url: string | null, refreshMs = 0) {
  const [state, setState] = useState<State<T>>({ url: null });
  const [tick, setTick] = useState(0);
  const force = useRef(false);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const ctrl = new AbortController();
    const run = async () => {
      // a manual reload skips the browser's HTTP cache so it really asks the server
      const cache: RequestCache = force.current ? "no-store" : "default";
      force.current = false;
      try {
        const res = await fetch(url, { signal: ctrl.signal, cache });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw {
            code: body?.error ?? "http",
            message: body?.message ?? `Request failed (${res.status}).`,
          };
        }
        if (!cancelled) setState({ url, data: body as T, at: Date.now() });
      } catch (e) {
        if (cancelled || (e as Error)?.name === "AbortError") return;
        setState((prev) => ({
          url,
          data: prev.url === url ? prev.data : undefined,
          at: prev.at,
          error: normalise(e),
        }));
      }
    };
    void run();
    const id = refreshMs > 0 ? setInterval(run, refreshMs) : undefined;
    return () => {
      cancelled = true;
      ctrl.abort();
      if (id) clearInterval(id);
    };
  }, [url, refreshMs, tick]);

  const cur: State<T> = state.url === url ? state : { url };
  const reload = useCallback(() => {
    force.current = true;
    setTick((t) => t + 1);
  }, []);
  return {
    data: cur.data,
    error: cur.error,
    loading: !!url && !cur.data && !cur.error,
    /** a refresh failed but older data is still shown */
    stale: !!cur.error && !!cur.data,
    updatedAt: cur.at,
    reload,
  };
}
