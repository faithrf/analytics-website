import "server-only";
import { Redis } from "@upstash/redis";
import type { BoardsState } from "@/lib/boards";

export interface SyncRecord extends BoardsState {
  updatedAt: number;
}

export const TTL_SECONDS = 365 * 24 * 60 * 60;

interface Store {
  getRecord(code: string): Promise<SyncRecord | null>;
  /** "create" writes only if the key is absent, "update" only if present; returns whether it wrote. */
  setRecord(code: string, rec: SyncRecord, mode: "create" | "update"): Promise<boolean>;
  deleteRecord(code: string): Promise<void>;
  /** Increments a counter, starting its expiry on first use; returns the new count. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

const recKey = (code: string) => `sync:${code}`;

function redisConfig(): { url: string; token: string } | null {
  const e = process.env;
  const url = e.UPSTASH_REDIS_REST_URL || e.KV_REST_API_URL;
  const token = e.UPSTASH_REDIS_REST_TOKEN || e.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

function redisStore(cfg: { url: string; token: string }): Store {
  const redis = new Redis(cfg);
  return {
    async getRecord(code) {
      const v = await redis.get<unknown>(recKey(code));
      if (v === null || v === undefined) return null;
      await redis.expire(recKey(code), TTL_SECONDS);
      return (typeof v === "string" ? JSON.parse(v) : v) as SyncRecord;
    },
    async setRecord(code, rec, mode) {
      const value = JSON.stringify(rec);
      const r = await redis.set(recKey(code), value, mode === "create" ? { nx: true, ex: TTL_SECONDS } : { xx: true, ex: TTL_SECONDS });
      return r === "OK";
    },
    async deleteRecord(code) {
      await redis.del(recKey(code));
    },
    async incr(key, ttl) {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, ttl);
      return n;
    },
  };
}

type Mem = { recs: Map<string, SyncRecord>; counters: Map<string, { n: number; exp: number }> };
const g = globalThis as unknown as { __meridianSyncMem?: Mem };

function memoryStore(): Store {
  const mem = (g.__meridianSyncMem ??= { recs: new Map(), counters: new Map() });
  return {
    async getRecord(code) {
      return mem.recs.get(code) ?? null;
    },
    async setRecord(code, rec, mode) {
      if ((mode === "create") === mem.recs.has(code)) return false;
      mem.recs.set(code, rec);
      return true;
    },
    async deleteRecord(code) {
      mem.recs.delete(code);
    },
    async incr(key, ttl) {
      const now = Date.now();
      const c = mem.counters.get(key);
      if (!c || c.exp <= now) {
        mem.counters.set(key, { n: 1, exp: now + ttl * 1000 });
        return 1;
      }
      return ++c.n;
    },
  };
}

let store: Store | null | undefined;

/** The active store, or null when none is configured (production without Redis env vars). */
export function getStore(): Store | null {
  if (store !== undefined) return store;
  const cfg = redisConfig();
  if (cfg) store = redisStore(cfg);
  else store = process.env.NODE_ENV === "production" ? null : memoryStore();
  return store;
}
