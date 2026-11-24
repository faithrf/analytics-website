import "server-only";
import { Redis } from "@upstash/redis";
import { DEDUPE_TTL_SECONDS, parseAlertSettings, type AlertSettings } from "@/lib/alerts";
import { redisConfig } from "@/lib/sync-store";

/** A browser's Web Push subscription (PushSubscription.toJSON()). */
export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export const MAX_DEVICES = 8;

export function parsePushSub(raw: unknown): PushSub | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const keys = o?.keys && typeof o.keys === "object" ? (o.keys as Record<string, unknown>) : null;
  if (!o || !keys || typeof o.endpoint !== "string" || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  if (o.endpoint.length > 1000 || !/^https:\/\//.test(o.endpoint) || keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint: o.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

interface Store {
  getSettings(uid: string): Promise<AlertSettings>;
  setSettings(uid: string, s: AlertSettings): Promise<void>;
  subs(uid: string): Promise<PushSub[]>;
  addSub(uid: string, sub: PushSub): Promise<boolean>;
  removeSub(uid: string, endpoint: string): Promise<void>;
  users(): Promise<string[]>;
  addUser(uid: string): Promise<void>;
  removeUser(uid: string): Promise<void>;
  /** True the first time a key is claimed within its TTL (set-if-absent). */
  claim(key: string): Promise<boolean>;
}

const settingsKey = (uid: string) => `alerts:settings:${uid}`;
const subsKey = (uid: string) => `alerts:subs:${uid}`;
const USERS = "alerts:users";
const asObj = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);

function redisStore(cfg: { url: string; token: string }): Store {
  const r = new Redis(cfg);
  return {
    async getSettings(uid) {
      return parseAlertSettings(asObj(await r.get<unknown>(settingsKey(uid))));
    },
    async setSettings(uid, s) {
      await r.set(settingsKey(uid), JSON.stringify(s));
    },
    async subs(uid) {
      const h = await r.hgetall<Record<string, unknown>>(subsKey(uid));
      return Object.values(h ?? {})
        .map((v) => parsePushSub(asObj(v)))
        .filter((s): s is PushSub => !!s);
    },
    async addSub(uid, sub) {
      const key = subsKey(uid);
      const known = await r.hexists(key, sub.endpoint);
      if (!known && (await r.hlen(key)) >= MAX_DEVICES) return false;
      await r.hset(key, { [sub.endpoint]: JSON.stringify(sub) });
      return true;
    },
    async removeSub(uid, endpoint) {
      await r.hdel(subsKey(uid), endpoint);
    },
    users: async () => r.smembers(USERS),
    async addUser(uid) {
      await r.sadd(USERS, uid);
    },
    async removeUser(uid) {
      await r.srem(USERS, uid);
    },
    async claim(key) {
      return (await r.set(key, "1", { nx: true, ex: DEDUPE_TTL_SECONDS })) === "OK";
    },
  };
}

interface Mem {
  settings: Map<string, AlertSettings>;
  subs: Map<string, Map<string, PushSub>>;
  users: Set<string>;
  claims: Map<string, number>;
}
const g = globalThis as unknown as { __meridianAlertsMem?: Mem };

function memoryStore(): Store {
  const m = (g.__meridianAlertsMem ??= { settings: new Map(), subs: new Map(), users: new Set(), claims: new Map() });
  return {
    getSettings: async (uid) => parseAlertSettings(m.settings.get(uid)),
    setSettings: async (uid, s) => void m.settings.set(uid, s),
    subs: async (uid) => [...(m.subs.get(uid)?.values() ?? [])],
    async addSub(uid, sub) {
      const map = m.subs.get(uid) ?? new Map<string, PushSub>();
      if (!map.has(sub.endpoint) && map.size >= MAX_DEVICES) return false;
      map.set(sub.endpoint, sub);
      m.subs.set(uid, map);
      return true;
    },
    removeSub: async (uid, endpoint) => void m.subs.get(uid)?.delete(endpoint),
    users: async () => [...m.users],
    addUser: async (uid) => void m.users.add(uid),
    removeUser: async (uid) => void m.users.delete(uid),
    async claim(key) {
      const now = Date.now();
      const exp = m.claims.get(key);
      if (exp && exp > now) return false;
      m.claims.set(key, now + DEDUPE_TTL_SECONDS * 1000);
      return true;
    },
  };
}

let store: Store | null | undefined;
/** Redis when configured, memory in development, null in production without Redis. */
export function getAlertStore(): Store | null {
  if (store !== undefined) return store;
  const cfg = redisConfig();
  if (cfg) store = redisStore(cfg);
  else store = process.env.NODE_ENV === "production" ? null : memoryStore();
  return store;
}
