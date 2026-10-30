"use client";
import { useCallback, useSyncExternalStore } from "react";
import * as ops from "@/lib/boards";
import { BOARDS_KEY, defaultState, LEGACY_WATCHLIST_KEY, mergeLegacy, parseBoards, type BoardsState } from "@/lib/boards";

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

function commit(next: BoardsState) {
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
