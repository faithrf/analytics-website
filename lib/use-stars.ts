"use client";
import { useSyncExternalStore } from "react";
import { whenAccountLoaded } from "@/lib/use-account";

/** Names of ready-made boards the user starred. Saved to the account when signed in, else localStorage. */
const KEY = "meridian-preset-stars";
const MAX = 100;
const NONE: string[] = [];
let stars: string[] = NONE;
let signedIn = false;
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const clean = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX) : NONE);

async function load() {
  try {
    const a = await whenAccountLoaded();
    signedIn = !!a.user;
    if (signedIn) {
      const res = await fetch("/api/me/data", { cache: "no-store" });
      if (!res.ok) return;
      stars = clean(((await res.json()) as { stars?: unknown }).stars);
    } else {
      stars = clean(JSON.parse(window.localStorage.getItem(KEY) ?? "[]"));
    }
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
  stars = next;
  emit();
  if (!signedIn) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(stars));
    } catch {
      /* private window: keep for this visit only */
    }
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => {
    void fetch("/api/me/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stars }),
      cache: "no-store",
    }).catch(() => {});
  }, 600);
}

export function useStars() {
  const list = useSyncExternalStore(subscribe, () => stars, () => NONE);
  return {
    stars: list,
    isStarred: (name: string) => list.includes(name),
    toggle: (name: string) =>
      save(list.includes(name) ? list.filter((s) => s !== name) : list.length < MAX ? [...list, name] : list),
  };
}
