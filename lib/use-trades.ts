"use client";
import { useSyncExternalStore } from "react";
import { MAX_TRADES, parseTrades, TRADES_KEY, type Trade } from "@/lib/trades";
import { whenAccountLoaded } from "@/lib/use-account";

/**
 * Test trades. Logged in: stored on the server under the user (PUT /api/me/data).
 * Logged out: localStorage. `ready` is false until we know which of the two applies.
 */
interface State {
  trades: Trade[];
  ready: boolean;
  /** Logged in but the saved trades could not be loaded: editing is blocked so nothing is overwritten. */
  error: boolean;
}
const SERVER: State = { trades: [], ready: false, error: false };
let state: State = SERVER;
let started = false;
let userMode = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const set = (next: State) => {
  state = next;
  emit();
};

function readLocal(): Trade[] {
  try {
    return parseTrades(window.localStorage.getItem(TRADES_KEY));
  } catch {
    return [];
  }
}

async function load() {
  try {
    const a = await whenAccountLoaded();
    if (!a.user) return set({ trades: readLocal(), ready: true, error: false });
    userMode = true;
    const res = await fetch("/api/me/data", { cache: "no-store" });
    if (!res.ok) return set({ trades: [], ready: true, error: true });
    const d = (await res.json()) as { trades?: unknown };
    set({ trades: parseTrades(d.trades), ready: true, error: false });
  } catch {
    set({ trades: [], ready: true, error: userMode });
  }
}

function subscribe(cb: () => void) {
  if (!started && typeof window !== "undefined") {
    started = true;
    void load();
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function save(trades: Trade[]) {
  set({ ...state, trades });
  if (userMode) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void fetch("/api/me/data", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trades: state.trades }),
        cache: "no-store",
      }).catch(() => {});
    }, 600);
    return;
  }
  try {
    window.localStorage.setItem(TRADES_KEY, JSON.stringify(trades));
  } catch {
    /* storage unavailable (private mode, quota): trades just will not persist */
  }
}

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function useTrades() {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  const locked = !s.ready || s.error;
  return {
    trades: s.trades,
    ready: s.ready,
    error: s.error,
    full: s.trades.length >= MAX_TRADES,
    /** Adds a trade (newest first). Returns false when blocked or at the limit. */
    add: (t: Omit<Trade, "id" | "createdMs">): boolean => {
      if (locked || s.trades.length >= MAX_TRADES) return false;
      const [clean] = parseTrades([{ ...t, id: newId(), createdMs: Date.now() }]);
      if (!clean) return false;
      save([clean, ...s.trades]);
      return true;
    },
    remove: (id: string) => {
      if (!locked) save(s.trades.filter((t) => t.id !== id));
    },
    /** Closes an open trade at the given price now (`optValue`: the contract's value, for real-priced options). */
    close: (id: string, price: number, optValue?: number) => {
      if (locked || !(price > 0)) return;
      const extra = optValue !== undefined && optValue > 0 ? { closeOptValue: optValue } : {};
      save(s.trades.map((t) => (t.id === id && t.closedMs === undefined ? { ...t, closedMs: Date.now(), closePrice: price, ...extra } : t)));
    },
  };
}
