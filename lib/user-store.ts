import "server-only";
import { Redis } from "@upstash/redis";
import { defaultState, parseBoards, type BoardsState } from "@/lib/boards";
import { ADMIN_ID } from "@/lib/session";
import { personaById } from "@/lib/personas";
import { redisConfig } from "@/lib/sync-store";

/** Per-user saved data: boards plus the Leaders names/tickers they follow. */
export interface UserData extends BoardsState {
  follows: string[];
}

export const MAX_FOLLOWS = 40;
const MAX_FOLLOW_LEN = 40;

export function cleanFollows(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.replace(/\s+/g, " ").trim().slice(0, MAX_FOLLOW_LEN);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.slice(0, MAX_FOLLOWS);
}

export function parseUserData(raw: unknown): UserData {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { ...parseBoards(JSON.stringify(obj)), follows: cleanFollows(obj.follows) };
}

/** What a user starts with: a persona's seeded data, or an empty watchlist. */
export function seedFor(userId: string): UserData {
  const p = personaById(userId);
  return p ? parseUserData({ boards: p.boards.boards, active: p.boards.active, follows: p.follows }) : { ...defaultState(), follows: [] };
}

interface Store {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

function redisStore(cfg: { url: string; token: string }): Store {
  const redis = new Redis(cfg);
  return {
    async get(key) {
      const v = await redis.get<unknown>(key);
      return typeof v === "string" ? JSON.parse(v) : (v ?? null);
    },
    async set(key, value) {
      await redis.set(key, JSON.stringify(value));
    },
    async del(key) {
      await redis.del(key);
    },
  };
}

const g = globalThis as unknown as { __meridianUserMem?: Map<string, unknown> };
function memoryStore(): Store {
  const mem = (g.__meridianUserMem ??= new Map());
  return {
    get: async (k) => mem.get(k) ?? null,
    set: async (k, v) => void mem.set(k, structuredClone(v)),
    del: async (k) => void mem.delete(k),
  };
}

let store: Store | null | undefined;
/** Redis when configured, memory in development, null in production without Redis (matches the sync store). */
function getUserStore(): Store | null {
  if (store !== undefined) return store;
  const cfg = redisConfig();
  if (cfg) store = redisStore(cfg);
  else store = process.env.NODE_ENV === "production" ? null : memoryStore();
  return store;
}

const key = (id: string) => `user:${id}`;
export const userStoreAvailable = () => getUserStore() !== null;

/** Loads the user's data, seeding it on first use. Falls back to the seed when storage is unavailable. */
export async function getUserData(userId: string): Promise<UserData> {
  const s = getUserStore();
  if (!s) return seedFor(userId);
  const raw = await s.get(key(userId));
  if (raw) return parseUserData(raw);
  const seed = seedFor(userId);
  await s.set(key(userId), seed);
  return seed;
}

export async function setUserData(userId: string, data: UserData): Promise<boolean> {
  const s = getUserStore();
  if (!s) return false;
  await s.set(key(userId), data);
  return true;
}

/** Clears a signed-up user's boards and follows back to an empty watchlist. */
export async function resetUserData(userId: string): Promise<boolean> {
  return setUserData(userId, seedFor(userId));
}

/** Restores a persona to its seed. The admin has no seed to reset to, so only personas. */
export async function resetPersona(personaId: string): Promise<boolean> {
  if (!personaById(personaId) || personaId === ADMIN_ID) return false;
  return setUserData(personaId, seedFor(personaId));
}
