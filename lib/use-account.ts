"use client";
import { useSyncExternalStore } from "react";

export interface AccountUser {
  id: string;
  name: string;
  email: string;
  isPersona: boolean;
}
export interface Account {
  /** False until the first /api/auth/me answer. */
  loaded: boolean;
  user: AccountUser | null;
  isAdmin: boolean;
  /** False when SIGNUP_DISABLED is set on the server. */
  signupEnabled: boolean;
  /** Admin id while impersonating, else null. */
  impersonatedBy: string | null;
}

const LOADING: Account = { loaded: false, user: null, isAdmin: false, signupEnabled: true, impersonatedBy: null };
let state: Account = LOADING;
let started = false;
const listeners = new Set<() => void>();
const waiters: Array<(a: Account) => void> = [];

function set(a: Account) {
  state = a;
  listeners.forEach((l) => l());
  waiters.splice(0).forEach((w) => w(a));
}

async function load() {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const d = (await res.json()) as { user?: AccountUser | null; isAdmin?: boolean; signupEnabled?: boolean; impersonatedBy?: string | null };
    set({ loaded: true, user: d.user ?? null, isAdmin: !!d.isAdmin, signupEnabled: d.signupEnabled !== false, impersonatedBy: d.impersonatedBy ?? null });
  } catch {
    set({ loaded: true, user: null, isAdmin: false, signupEnabled: true, impersonatedBy: null });
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

/** Resolves once the account is known (used by data hooks that must not guess). */
export function whenAccountLoaded(): Promise<Account> {
  if (state.loaded) return Promise.resolve(state);
  if (!started && typeof window !== "undefined") {
    started = true;
    void load();
  }
  return new Promise((r) => waiters.push(r));
}

export const useAccount = () => useSyncExternalStore(subscribe, () => state, () => LOADING);

async function post(url: string, body?: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const d = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: res.ok, message: d.message };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

/** Each of these reloads on success so boards and follows re-load for the new subject. */
export async function login(email: string, password: string) {
  const r = await post("/api/auth/login", { email, password });
  if (r.ok) window.location.assign("/dashboard");
  return r;
}
export async function signup(name: string, email: string, password: string) {
  const r = await post("/api/auth/signup", { name, email, password });
  if (r.ok) window.location.assign("/dashboard");
  return r;
}
export async function logout() {
  const r = await post("/api/auth/logout");
  if (r.ok) window.location.assign("/");
  return r;
}
export async function impersonate(personaId: string | null) {
  const r = await post("/api/admin/impersonate", { personaId });
  if (r.ok) window.location.assign(personaId ? "/dashboard" : "/admin");
  return r;
}
/** Resets a persona or a signed-up user's saved data. */
export async function resetPersona(personaId: string) {
  return post("/api/admin/reset", { personaId });
}

/** Fire-and-forget; the server ignores it when logged out. */
export function trackClient(event: "tab_viewed", props: Record<string, string | number | boolean> = {}) {
  if (!state.user) return;
  void fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, props }),
    keepalive: true,
  }).catch(() => {});
}
