"use client";
import { useSyncExternalStore } from "react";
import { whenAccountLoaded } from "@/lib/use-account";

/** Leaders names/tickers the signed-in user follows. Empty and read-only when logged out. */
const MAX = 40;
const NONE: string[] = [];
let follows: string[] = NONE;
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

async function load() {
  try {
    const a = await whenAccountLoaded();
    if (!a.user) return;
    const res = await fetch("/api/me/data", { cache: "no-store" });
    if (!res.ok) return;
    const d = (await res.json()) as { follows?: unknown };
    follows = Array.isArray(d.follows) ? d.follows.filter((x): x is string => typeof x === "string") : NONE;
    emit();
  } catch {
    /* stay empty */
  }
}

function subscribe(cb: () => void) {
  if (!started) {
    started = true;
    void load();
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function save(next: string[]) {
  follows = next;
  emit();
  clearTimeout(timer);
  timer = setTimeout(() => {
    void fetch("/api/me/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ follows }),
      cache: "no-store",
    }).catch(() => {});
  }, 600);
}

export const sameLeader = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function useFollows() {
  const list = useSyncExternalStore(subscribe, () => follows, () => NONE);
  return {
    follows: list,
    isFollowing: (name: string) => list.some((f) => sameLeader(f, name)),
    follow: (name: string) => {
      const n = name.replace(/\s+/g, " ").trim().slice(0, 40);
      if (n && list.length < MAX && !list.some((f) => sameLeader(f, n))) save([...list, n]);
    },
    unfollow: (name: string) => save(list.filter((f) => !sameLeader(f, name))),
  };
}
