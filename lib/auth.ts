import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_ID, isAdminSession, SESSION_SECONDS, signSession, verifySession, type Session } from "@/lib/session";
import { personaById } from "@/lib/personas";
import { getAccount } from "@/lib/accounts";
import type { TrackUser } from "@/lib/track";

export const COOKIE = "meridian_session";

/** AUTH_SECRET, or a fixed throwaway in development only. Null means login is switched off. */
export function authSecret(): string | null {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  return process.env.NODE_ENV === "production" ? null : "dev-only-insecure-secret-do-not-use";
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  isPersona: boolean;
}
export interface Who {
  session: Session;
  user: CurrentUser;
  /** The real admin behind an impersonated session, else null. */
  impersonatedBy: string | null;
}

export function userFor(id: string): CurrentUser | null {
  if (id === ADMIN_ID) return { id, name: process.env.ADMIN_NAME?.trim() || "Admin", email: process.env.ADMIN_EMAIL ?? "", isPersona: false };
  const p = personaById(id);
  return p ? { id: p.id, name: p.name, email: p.email, isPersona: true } : null;
}

/** userFor plus self-serve accounts (a storage lookup). */
export async function resolveUser(id: string): Promise<CurrentUser | null> {
  const known = userFor(id);
  if (known) return known;
  const a = await getAccount(id).catch(() => null);
  return a ? { id: a.id, name: a.name || a.email, email: a.email, isPersona: false } : null;
}

export const trackUser = (u: CurrentUser): TrackUser => ({ id: u.id, email: u.email, name: u.name });

export async function getSession(): Promise<Session | null> {
  const secret = authSecret();
  if (!secret) return null;
  return verifySession((await cookies()).get(COOKIE)?.value, secret);
}

/** The signed-in subject, or null when logged out (or the persona no longer exists). */
export async function getWho(): Promise<Who | null> {
  const session = await getSession();
  const user = session && (await resolveUser(session.subjectId));
  if (!session || !user) return null;
  return { session, user, impersonatedBy: session.actorId !== session.subjectId ? session.actorId : null };
}

/** The real admin behind this request, regardless of who they are impersonating. */
export async function getAdminSession(): Promise<Session | null> {
  const s = await getSession();
  return isAdminSession(s) ? s : null;
}

const NO_STORE = { "Cache-Control": "no-store" };
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/** CSRF defence on top of SameSite=Lax: a browser-sent Origin must match the request host. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.get("host") ?? new URL(req.url).host);
  } catch {
    return false;
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (text.length > 16 * 1024) return {};
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function withSessionCookie(res: NextResponse, s: Pick<Session, "actorId" | "subjectId">): NextResponse {
  const secret = authSecret();
  if (!secret) return res;
  res.cookies.set(COOKIE, signSession(s, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return res;
}

export function withoutSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
