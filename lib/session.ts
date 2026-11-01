import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Session tokens (HS256 JWT built on node:crypto, no dependency) and password
 * hashing (scrypt). Pure, so it can be unit tested. The cookie plumbing lives in
 * lib/auth.ts.
 *
 * actorId is who really logged in (always the admin for impersonation);
 * subjectId is whose data the site shows. They differ while impersonating.
 */
export interface Session {
  actorId: string;
  subjectId: string;
  iat: number;
  exp: number;
}

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const ADMIN_ID = "admin";

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const HEADER = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function mac(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function signSession(s: Pick<Session, "actorId" | "subjectId">, secret: string, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const payload = b64u(JSON.stringify({ actorId: s.actorId, subjectId: s.subjectId, iat, exp: iat + SESSION_SECONDS }));
  const body = `${HEADER}.${payload}`;
  return `${body}.${b64u(mac(body, secret))}`;
}

/** Returns the session, or null for any bad, tampered or expired token. Never throws. */
export function verifySession(token: string | undefined | null, secret: string, nowMs = Date.now()): Session | null {
  try {
    if (!token || !secret) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== HEADER) return null;
    const want = mac(`${parts[0]}.${parts[1]}`, secret);
    const got = Buffer.from(parts[2], "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Partial<Session>;
    if (typeof p.actorId !== "string" || typeof p.subjectId !== "string" || typeof p.exp !== "number" || typeof p.iat !== "number") return null;
    if (p.exp * 1000 <= nowMs) return null;
    return p as Session;
  } catch {
    return null;
  }
}

/** "scrypt:<saltHex>:<hashHex>" - see .env.example for the one-line command that makes one. */
export function hashPassword(password: string, salt: Buffer): string {
  return `scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  try {
    const [kind, saltHex, hashHex] = (stored ?? "").split(":");
    if (kind !== "scrypt" || !saltHex || !hashHex) return false;
    const want = Buffer.from(hashHex, "hex");
    const got = scryptSync(password, Buffer.from(saltHex, "hex"), want.length);
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

/**
 * Impersonation guard: only a session whose real actor is the admin may act, and
 * only on a known persona or (via `isAccountId`) an account id. `personaIds` is passed in to keep this pure.
 */
export function canImpersonate(
  session: Session | null,
  personaId: unknown,
  personaIds: readonly string[],
  isAccountId: (id: string) => boolean = () => false,
): boolean {
  return (
    !!session && session.actorId === ADMIN_ID && typeof personaId === "string" && (personaIds.includes(personaId) || isAccountId(personaId))
  );
}

export const isAdminSession = (s: Session | null): s is Session => !!s && s.actorId === ADMIN_ID;
