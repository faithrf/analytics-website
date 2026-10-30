import { isValidId } from "@/lib/symbols";

/**
 * Dashboards ("boards") of pinned stocks, kept in localStorage. Everything here
 * is pure so it can be unit tested; lib/use-boards.ts wires it to storage.
 */
/** Named after the app's old name; kept so saved pins survive the rename. */
export const BOARDS_KEY = "bellwether-boards-v1";
/** The single watchlist from before dashboards existed; migrated once. */
export const LEGACY_WATCHLIST_KEY = "asx-watchlist-v1";

export const MAX_BOARDS = 12;
export const MAX_PINS = 40;
export const MAX_NAME = 24;

export interface Board {
  id: string;
  name: string;
  ids: string[];
}
export interface BoardsState {
  boards: Board[];
  active: string;
}

const BOARD_ID_RE = /^[a-z0-9-]{1,24}$/;

export function cleanName(name: string): string | null {
  const n = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim();
  return n || null;
}

function cleanIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const id = x.toUpperCase();
    if (isValidId(id) && !out.includes(id)) out.push(id);
  }
  return out.slice(0, MAX_PINS);
}

export function defaultState(ids: string[] = []): BoardsState {
  return { boards: [{ id: "watchlist", name: "Watchlist", ids }], active: "watchlist" };
}

/** Parse stored boards; with nothing stored, migrate the old watchlist. Never throws. */
export function parseBoards(raw: string | null, legacyRaw: string | null = null): BoardsState {
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const boards: Board[] = [];
  const list = parsed && typeof parsed === "object" ? (parsed as { boards?: unknown }).boards : null;
  if (Array.isArray(list)) {
    for (const b of list) {
      if (!b || typeof b !== "object" || boards.length >= MAX_BOARDS) continue;
      const { id, name, ids } = b as Record<string, unknown>;
      const clean = typeof name === "string" ? cleanName(name) : null;
      if (typeof id !== "string" || !BOARD_ID_RE.test(id) || !clean || boards.some((x) => x.id === id)) continue;
      boards.push({ id, name: clean, ids: cleanIds(ids) });
    }
  }
  if (boards.length === 0) {
    if (raw) return defaultState();
    let legacy: unknown = null;
    try {
      legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
    } catch {
      legacy = null;
    }
    return defaultState(cleanIds(legacy));
  }
  const active = (parsed as { active?: unknown }).active;
  return { boards, active: boards.some((b) => b.id === active) ? (active as string) : boards[0].id };
}

/**
 * Folds stocks starred with the old watchlist (e.g. from a tab opened before
 * dashboards existed) into the "Watchlist" board, or the first board.
 */
export function mergeLegacy(s: BoardsState, legacyRaw: string | null): BoardsState {
  let legacy: unknown = null;
  try {
    legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
  } catch {
    return s;
  }
  const target = (s.boards.find((b) => b.id === "watchlist") ?? s.boards[0]).id;
  return cleanIds(legacy).reduce((acc, id) => pin(acc, target, id), s);
}

const mapBoard = (s: BoardsState, id: string, fn: (b: Board) => Board): BoardsState => ({
  ...s,
  boards: s.boards.map((b) => (b.id === id ? fn(b) : b)),
});

/** Adds a board and makes it active. `newId` is passed in to keep this pure. */
export function createBoard(s: BoardsState, name: string, newId: string): BoardsState {
  const clean = cleanName(name);
  if (!clean || s.boards.length >= MAX_BOARDS || !BOARD_ID_RE.test(newId) || s.boards.some((b) => b.id === newId)) return s;
  return { boards: [...s.boards, { id: newId, name: clean, ids: [] }], active: newId };
}

export function renameBoard(s: BoardsState, id: string, name: string): BoardsState {
  const clean = cleanName(name);
  return clean ? mapBoard(s, id, (b) => ({ ...b, name: clean })) : s;
}

/** The last board cannot be deleted. */
export function deleteBoard(s: BoardsState, id: string): BoardsState {
  if (s.boards.length <= 1) return s;
  const i = s.boards.findIndex((b) => b.id === id);
  if (i < 0) return s;
  const boards = s.boards.filter((b) => b.id !== id);
  return { boards, active: s.active === id ? boards[Math.max(0, i - 1)].id : s.active };
}

export function setActive(s: BoardsState, id: string): BoardsState {
  return s.boards.some((b) => b.id === id) ? { ...s, active: id } : s;
}

export function pin(s: BoardsState, boardId: string, stockId: string): BoardsState {
  if (!isValidId(stockId)) return s;
  return mapBoard(s, boardId, (b) => (b.ids.includes(stockId) || b.ids.length >= MAX_PINS ? b : { ...b, ids: [...b.ids, stockId] }));
}

export function unpin(s: BoardsState, boardId: string, stockId: string): BoardsState {
  return mapBoard(s, boardId, (b) => ({ ...b, ids: b.ids.filter((x) => x !== stockId) }));
}

/** Moves a pin left (-1) or right (+1) within its board. */
export function move(s: BoardsState, boardId: string, stockId: string, delta: number): BoardsState {
  return mapBoard(s, boardId, (b) => {
    const i = b.ids.indexOf(stockId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= b.ids.length) return b;
    const ids = [...b.ids];
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return { ...b, ids };
  });
}
