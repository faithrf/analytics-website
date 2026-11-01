import "server-only";
import { randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import { ADMIN_ID, hashPassword, verifyPassword } from "@/lib/session";
import { personaById } from "@/lib/personas";
import { redisConfig } from "@/lib/sync-store";

/** A self-serve account. passwordHash must never leave the server: use toPublic(). */
export interface Account {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}
export type PublicAccount = Omit<Account, "passwordHash">;

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;
export const signupDisabled = () => process.env.SIGNUP_DISABLED === "1";

export const normaliseEmail = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
export const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@.][^\s@]*\.[^\s@.]+$/.test(e);
export const cleanName = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 60) : "");

export const toPublic = ({ id, email, name, createdAt }: Account): PublicAccount => ({ id, email, name, createdAt });

/** `u_` + random hex; the prefix keeps it clear of persona ids and "admin". */
export function newAccountId(): string {
  for (;;) {
    const id = `u_${randomBytes(8).toString("hex")}`;
    if (id !== ADMIN_ID && !personaById(id)) return id;
  }
}
export const isAccountId = (id: unknown): id is string => typeof id === "string" && /^u_[0-9a-f]{16}$/.test(id);

export const makeHash = (password: string) => hashPassword(password, randomBytes(16));
/** Verified against when the email is unknown, so timing does not reveal which emails exist. */
const DUMMY_HASH = makeHash("not-a-real-password");

interface Store {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  /** Atomic set-if-not-exists; returns whether it wrote. */
  setNx(key: string, value: string): Promise<boolean>;
  add(setKey: string, member: string): Promise<void>;
  members(setKey: string): Promise<string[]>;
}

function redisStore(cfg: { url: string; token: string }): Store {
  const redis = new Redis(cfg);
  return {
    async get(key) {
      const v = await redis.get<unknown>(key);
      return typeof v === "string" && v.startsWith("{") ? JSON.parse(v) : (v ?? null);
    },
    async set(key, value) {
      await redis.set(key, JSON.stringify(value));
    },
    async setNx(key, value) {
      return (await redis.set(key, value, { nx: true })) === "OK";
    },
    async add(setKey, member) {
      await redis.sadd(setKey, member);
    },
    async members(setKey) {
      return redis.smembers(setKey);
    },
  };
}

type Mem = { kv: Map<string, unknown>; sets: Map<string, Set<string>> };
const g = globalThis as unknown as { __meridianAccountMem?: Mem };
function memoryStore(): Store {
  const mem = (g.__meridianAccountMem ??= { kv: new Map(), sets: new Map() });
  return {
    get: async (k) => mem.kv.get(k) ?? null,
    set: async (k, v) => void mem.kv.set(k, structuredClone(v)),
    async setNx(k, v) {
      if (mem.kv.has(k)) return false;
      mem.kv.set(k, v);
      return true;
    },
    async add(s, m) {
      let set = mem.sets.get(s);
      if (!set) mem.sets.set(s, (set = new Set()));
      set.add(m);
    },
    members: async (s) => [...(mem.sets.get(s) ?? [])],
  };
}

let store: Store | null | undefined;
/** Redis when configured, memory in development, null in production without Redis. */
function getAccountStore(): Store | null {
  if (store !== undefined) return store;
  const cfg = redisConfig();
  if (cfg) store = redisStore(cfg);
  else store = process.env.NODE_ENV === "production" ? null : memoryStore();
  return store;
}

export const accountsAvailable = () => getAccountStore() !== null;

const accountKey = (id: string) => `account:${id}`;
const emailKey = (email: string) => `account-email:${email}`;
const INDEX = "account-index";

export type CreateResult = { ok: true; account: Account } | { ok: false; reason: "duplicate" | "unavailable" };

/** Claims the email atomically first, so two racing sign-ups cannot both win. */
export async function createAccount(input: { email: string; name: string; password: string }): Promise<CreateResult> {
  const s = getAccountStore();
  if (!s) return { ok: false, reason: "unavailable" };
  const id = newAccountId();
  if (!(await s.setNx(emailKey(input.email), id))) return { ok: false, reason: "duplicate" };
  const account: Account = {
    id,
    email: input.email,
    name: input.name,
    passwordHash: makeHash(input.password),
    createdAt: new Date().toISOString(),
  };
  await s.set(accountKey(id), account);
  await s.add(INDEX, id);
  return { ok: true, account };
}

export async function getAccount(id: string): Promise<Account | null> {
  const s = getAccountStore();
  if (!s || !isAccountId(id)) return null;
  const v = await s.get(accountKey(id));
  return v && typeof v === "object" ? (v as Account) : null;
}

export async function getAccountByEmail(email: string): Promise<Account | null> {
  const s = getAccountStore();
  if (!s) return null;
  const id = await s.get(emailKey(email));
  return typeof id === "string" ? getAccount(id) : null;
}

/** Looks the account up and checks the password; always does one hash so timing is flat. */
export async function verifyLogin(email: string, password: string): Promise<Account | null> {
  const acct = await getAccountByEmail(email).catch(() => null);
  const ok = verifyPassword(password, acct?.passwordHash ?? DUMMY_HASH);
  return acct && ok ? acct : null;
}

/** All accounts, newest first. Public fields only. */
export async function listAccounts(): Promise<PublicAccount[]> {
  const s = getAccountStore();
  if (!s) return [];
  const ids = await s.members(INDEX);
  const all = await Promise.all(ids.map((id) => getAccount(id)));
  return all
    .filter((a): a is Account => !!a)
    .map(toPublic)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
