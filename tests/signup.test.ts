import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let cookieValue: string | undefined;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }) }));

import { NextRequest } from "next/server";
import { hashPassword, verifyPassword, verifySession } from "@/lib/session";
import { randomBytes } from "node:crypto";
import { COOKIE } from "@/lib/auth";
import { listAccounts, newAccountId, isAccountId } from "@/lib/accounts";
import { PERSONA_IDS } from "@/lib/personas";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/auth/me/route";
import { GET as myData } from "@/app/api/me/data/route";
import { POST as impersonate } from "@/app/api/admin/impersonate/route";

const SECRET = "test-secret-0123456789";
let ipCounter = 0;
const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ipCounter}` },
    body: JSON.stringify(body),
  });
const sessionOf = (res: Response) => {
  const m = /meridian_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  return m ? verifySession(m[1], SECRET) : null;
};

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("SIGNUP_DISABLED", "");
  vi.stubEnv("ADMIN_EMAIL", "");
  vi.stubEnv("ADMIN_PASSWORD_HASH", "");
  cookieValue = undefined;
});

describe("account ids and hashing", () => {
  it("round-trips scrypt hashes in the shared format", () => {
    const h = hashPassword("correct horse", randomBytes(16));
    expect(h).toMatch(/^scrypt:[0-9a-f]+:[0-9a-f]+$/);
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong horse", h)).toBe(false);
  });
  it("makes ids that cannot collide with personas or admin", () => {
    const id = newAccountId();
    expect(isAccountId(id)).toBe(true);
    expect(PERSONA_IDS).not.toContain(id);
    expect(isAccountId("admin")).toBe(false);
    expect(isAccountId("daytrader")).toBe(false);
  });
});

describe("signup and login", () => {
  it("creates an account, signs in, rejects duplicates, and never leaks the hash", async () => {
    const res = await signup(post("/api/auth/signup", { name: "  Sam   Test ", email: "  Sam@Example.TEST ", password: "password123" }));
    expect(res.status).toBe(200);
    const s = sessionOf(res);
    expect(s).not.toBeNull();
    expect(s!.actorId).toBe(s!.subjectId);
    expect(isAccountId(s!.subjectId)).toBe(true);
    expect(JSON.stringify(await res.json())).not.toMatch(/scrypt|passwordHash/);

    // the new session shows name/email on /me and has per-user data
    cookieValue = res.headers.get("set-cookie")!.match(/meridian_session=([^;]+)/)![1];
    const who = await (await me()).json();
    expect(who.user).toMatchObject({ id: s!.subjectId, name: "Sam Test", email: "sam@example.test", isPersona: false });
    expect(JSON.stringify(who)).not.toMatch(/scrypt|passwordHash/);
    expect((await myData()).status).toBe(200);
    cookieValue = undefined;

    const dup = await signup(post("/api/auth/signup", { email: "SAM@example.test", password: "another-pass1" }));
    expect(dup.status).toBe(409);

    const ok = await login(post("/api/auth/login", { email: "sam@example.test", password: "password123" }));
    expect(ok.status).toBe(200);
    expect(sessionOf(ok)!.subjectId).toBe(s!.subjectId);
    const bad = await login(post("/api/auth/login", { email: "sam@example.test", password: "nope-nope-1" }));
    const unknown = await login(post("/api/auth/login", { email: "nobody@example.test", password: "password123" }));
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await bad.json()).toEqual(await unknown.json());

    const listed = await listAccounts();
    expect(listed.find((a) => a.id === s!.subjectId)).toBeTruthy();
    expect(JSON.stringify(listed)).not.toMatch(/scrypt|passwordHash/);
  });

  it("validates input and honours SIGNUP_DISABLED", async () => {
    expect((await signup(post("/api/auth/signup", { email: "not-an-email", password: "password123" }))).status).toBe(400);
    expect((await signup(post("/api/auth/signup", { email: "short@example.test", password: "short" }))).status).toBe(400);
    vi.stubEnv("SIGNUP_DISABLED", "1");
    expect((await signup(post("/api/auth/signup", { email: "off@example.test", password: "password123" }))).status).toBe(403);
    expect((await (await me()).json()).signupEnabled).toBe(false);
  });

  it("lets only the admin impersonate an account", async () => {
    const res = await signup(post("/api/auth/signup", { email: "imp@example.test", password: "password123" }));
    const id = sessionOf(res)!.subjectId;
    // a regular user cannot
    cookieValue = res.headers.get("set-cookie")!.match(/meridian_session=([^;]+)/)![1];
    expect((await impersonate(post("/api/admin/impersonate", { personaId: id }))).status).toBe(403);
    // admin can
    const { signSession } = await import("@/lib/session");
    cookieValue = signSession({ actorId: "admin", subjectId: "admin" }, SECRET);
    const r = await impersonate(post("/api/admin/impersonate", { personaId: id }));
    expect(r.status).toBe(200);
    expect(sessionOf(r)).toMatchObject({ actorId: "admin", subjectId: id });
    expect((await impersonate(post("/api/admin/impersonate", { personaId: "u_0000000000000000" }))).status).toBe(400);
    expect(COOKIE).toBe("meridian_session");
  });
});
