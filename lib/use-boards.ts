"use client";
import { useCallback, useSyncExternalStore } from "react";
import * as ops from "@/lib/boards";
import { BOARDS_KEY, defaultState, LEGACY_WATCHLIST_KEY, mergeLegacy, parseBoards, type BoardsState } from "@/lib/boards";
import { formatCode, normaliseCode } from "@/lib/sync-code";

const SERVER = defaultState();
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: BoardsState = SERVER;
let memoryOnly = false; // storage unavailable: keep boards in memory for this tab

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function getSnapshot(): BoardsState {
  if (memoryOnly) return cached;
  const raw = read(BOARDS_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseBoards(raw, raw ? null : read(LEGACY_WATCHLIST_KEY));
  }
  return cached;
}

/** Moves anything saved under the old watchlist key into the boards, once per page load. */
let legacyChecked = false;
function migrateLegacy() {
  if (legacyChecked) return;
  legacyChecked = true;
  const legacy = read(LEGACY_WATCHLIST_KEY);
  if (legacy === null) return;
  commit(mergeLegacy(getSnapshot(), legacy));
  try {
    window.localStorage.removeItem(LEGACY_WATCHLIST_KEY);
  } catch {
    /* ignore: the merge is idempotent, so a leftover key does no harm */
  }
}

function subscribe(cb: () => void) {
  migrateLegacy();
  startSyncEngine();
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === BOARDS_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function commit(next: BoardsState, fromRemote = false) {
  const json = JSON.stringify(next);
  try {
    window.localStorage.setItem(BOARDS_KEY, json);
  } catch {
    /* storage unavailable (private mode, quota): boards just will not persist */
  }
  if (read(BOARDS_KEY) !== json) memoryOnly = true;
  cachedRaw = json;
  cached = next;
  listeners.forEach((l) => l());
  if (!fromRemote && syncState.code) schedulePush();
}

const newId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function useBoards() {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => SERVER);
  const apply = useCallback((fn: (s: BoardsState) => BoardsState) => commit(fn(getSnapshot())), []);
  return {
    ...state,
    activeBoard: state.boards.find((b) => b.id === state.active) ?? state.boards[0],
    /** Creates a board, makes it active and returns its id (null when the name is empty or the limit is hit). */
    create: (name: string) => {
      const id = newId();
      apply((s) => ops.createBoard(s, name, id));
      return getSnapshot().boards.some((b) => b.id === id) ? id : null;
    },
    rename: (id: string, name: string) => apply((s) => ops.renameBoard(s, id, name)),
    remove: (id: string) => apply((s) => ops.deleteBoard(s, id)),
    setActive: (id: string) => apply((s) => ops.setActive(s, id)),
    pin: (boardId: string, stockId: string) => apply((s) => ops.pin(s, boardId, stockId)),
    unpin: (boardId: string, stockId: string) => apply((s) => ops.unpin(s, boardId, stockId)),
    move: (boardId: string, stockId: string, delta: number) => apply((s) => ops.move(s, boardId, stockId, delta)),
  };
}

/* ---- Optional sync code: same dashboards on other devices (last write wins) ---- */

export const SYNC_CODE_KEY = "meridian-sync-code";
const SYNC_AT_KEY = "meridian-sync-at";
const PUSH_DELAY_MS = 1000;
const PULL_EVERY_MS = 60_000;
const RETRY_PUSH_MS = 30_000;

export type SyncStatus =
  | { kind: "off" }
  | { kind: "syncing" }
  | { kind: "synced"; at: number }
  | { kind: "error"; message: string }
  | { kind: "not_configured" };
export interface SyncSnapshot {
  /** Normalised 10-character code, or null when sync is off. */
  code: string | null;
  /** Display form, XXXXX-XXXXX. */
  display: string | null;
  status: SyncStatus;
}

const OFF: SyncSnapshot = { code: null, display: null, status: { kind: "off" } };
const syncListeners = new Set<() => void>();
let syncState: SyncSnapshot = OFF;
let syncLoaded = false;
let lastKnown = 0; // updatedAt of the version this browser last pulled or pushed
let halted = false; // the code was not found on the server: stop talking to it
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pushing = false;
let engineStarted = false;
let probed = false;

function setSync(code: string | null, status: SyncStatus) {
  syncState = { code, display: code ? formatCode(code) : null, status };
  syncListeners.forEach((l) => l());
}
function setStatus(status: SyncStatus) {
  setSync(syncState.code, status);
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: sync just will not survive a reload */
  }
}
function loadSync() {
  if (syncLoaded) return;
  syncLoaded = true;
  const code = normaliseCode(read(SYNC_CODE_KEY) ?? "");
  lastKnown = Number(read(SYNC_AT_KEY)) || 0;
  if (code) syncState = { code, display: formatCode(code), status: { kind: "syncing" } };
}
function getSyncSnapshot(): SyncSnapshot {
  if (typeof window !== "undefined") loadSync();
  return syncState;
}

type Reply = { ok: boolean; status: number; data: Record<string, unknown> };
async function call(method: string, code: string, body?: unknown): Promise<Reply> {
  const res = await fetch(`/api/sync${code ? `/${code}` : ""}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}
const failure = (r: Reply) =>
  r.status === 503
    ? "Sync isn't set up on this server."
    : typeof r.data.message === "string"
      ? r.data.message
      : "Sync failed. Will retry.";

function adoptRemote(data: Record<string, unknown>) {
  commit(parseBoards(JSON.stringify({ boards: data.boards, active: data.active })), true);
  lastKnown = Number(data.updatedAt) || Date.now();
  write(SYNC_AT_KEY, String(lastKnown));
}

async function pull() {
  const code = syncState.code;
  if (!code || halted || pushing || pushTimer) return;
  try {
    const r = await call("GET", code);
    if (code !== syncState.code) return;
    if (r.status === 404) {
      halted = true;
      setStatus({ kind: "error", message: "Code not found on the server." });
    } else if (!r.ok) {
      setStatus(r.status === 503 ? { kind: "not_configured" } : { kind: "error", message: failure(r) });
    } else {
      if (!pushTimer && !pushing && Number(r.data.updatedAt) > lastKnown) adoptRemote(r.data);
      setStatus({ kind: "synced", at: Date.now() });
    }
  } catch {
    setStatus({ kind: "error", message: "Offline. Will retry." });
  }
}

async function push() {
  pushTimer = undefined;
  const code = syncState.code;
  if (!code || halted) return;
  pushing = true;
  setStatus({ kind: "syncing" });
  try {
    const s = getSnapshot();
    const r = await call("PUT", code, { boards: s.boards, active: s.active, updatedAt: lastKnown });
    if (code !== syncState.code) return;
    if (r.status === 404) {
      halted = true;
      setStatus({ kind: "error", message: "Code not found on the server." });
    } else if (!r.ok) {
      setStatus({ kind: "error", message: failure(r) });
      retryPush();
    } else {
      lastKnown = Number(r.data.updatedAt) || Date.now();
      write(SYNC_AT_KEY, String(lastKnown));
      setStatus({ kind: "synced", at: Date.now() });
    }
  } catch {
    setStatus({ kind: "error", message: "Offline. Will retry." });
    retryPush();
  } finally {
    pushing = false;
  }
}

/** Keeps the unsent change pending (so pulls cannot overwrite it) and tries again later. */
function retryPush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, RETRY_PUSH_MS);
}

function schedulePush() {
  if (halted) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, PUSH_DELAY_MS);
}

function startSyncEngine() {
  if (engineStarted || typeof window === "undefined") return;
  engineStarted = true;
  loadSync();
  window.addEventListener("focus", pull);
  setInterval(pull, PULL_EVERY_MS);
  void pull();
}

function stopSync() {
  clearTimeout(pushTimer);
  pushTimer = undefined;
  halted = false;
  lastKnown = 0;
  write(SYNC_CODE_KEY, null);
  write(SYNC_AT_KEY, null);
  setSync(null, { kind: "off" });
}

function subscribeSync(cb: () => void) {
  syncListeners.add(cb);
  return () => {
    syncListeners.delete(cb);
  };
}

/** Result of a sync action: ok, or a message to show. */
export type SyncResult = { ok: true } | { ok: false; message: string };

export function useSync() {
  const state = useSyncExternalStore(subscribeSync, getSyncSnapshot, () => OFF);
  return {
    ...state,
    /** Asks the server once whether sync is available; sets not_configured when it is not. */
    probe: async () => {
      if (probed || getSyncSnapshot().code) return;
      probed = true;
      try {
        const r = await call("GET", "");
        if (r.status === 503 && !syncState.code) setStatus({ kind: "not_configured" });
      } catch {
        /* offline: leave the button enabled */
      }
    },
    /** Creates a new code holding this browser's dashboards and starts syncing. */
    enable: async (): Promise<SyncResult> => {
      try {
        const s = getSnapshot();
        const r = await call("POST", "", { boards: s.boards, active: s.active });
        if (!r.ok) {
          if (r.status === 503) setStatus({ kind: "not_configured" });
          return { ok: false, message: failure(r) };
        }
        const code = normaliseCode(String(r.data.code));
        if (!code) return { ok: false, message: "Sync failed. Try again." };
        halted = false;
        lastKnown = Number(r.data.updatedAt) || Date.now();
        write(SYNC_CODE_KEY, code);
        write(SYNC_AT_KEY, String(lastKnown));
        setSync(code, { kind: "synced", at: Date.now() });
        return { ok: true };
      } catch {
        return { ok: false, message: "Could not reach the server." };
      }
    },
    /** Replaces this browser's dashboards with the ones stored under `input` and starts syncing. */
    load: async (input: string): Promise<SyncResult> => {
      const code = normaliseCode(input);
      if (!code) return { ok: false, message: "That doesn't look like a sync code." };
      try {
        const r = await call("GET", code);
        if (r.status === 404) return { ok: false, message: "Code not found." };
        if (!r.ok) return { ok: false, message: failure(r) };
        clearTimeout(pushTimer);
        pushTimer = undefined;
        halted = false;
        adoptRemote(r.data);
        write(SYNC_CODE_KEY, code);
        setSync(code, { kind: "synced", at: Date.now() });
        return { ok: true };
      } catch {
        return { ok: false, message: "Could not reach the server." };
      }
    },
    /** Forgets the code in this browser only; the server copy stays. */
    stop: stopSync,
    /** Deletes the server copy, then stops syncing here. */
    deleteRemote: async (): Promise<SyncResult> => {
      const code = syncState.code;
      if (!code) return { ok: true };
      try {
        const r = await call("DELETE", code);
        if (!r.ok) return { ok: false, message: failure(r) };
        stopSync();
        return { ok: true };
      } catch {
        return { ok: false, message: "Could not reach the server." };
      }
    },
  };
}
