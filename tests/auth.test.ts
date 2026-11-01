import { describe, expect, it, vi, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { ADMIN_ID, canImpersonate, hashPassword, signSession, verifyPassword, verifySession, SESSION_SECONDS } from "@/lib/session";
import { PERSONAS, PERSONA_IDS } from "@/lib/personas";
import { parseBoards } from "@/lib/boards";
import { buildIdentify, buildTrack, emit } from "@/lib/track";

const SECRET = "test-secret-0123456789";

describe("session", () => {
  it("round-trips actor and subject", () => {
    const t = signSession({ actorId: ADMIN_ID, subjectId: "daytrader" }, SECRET);
    expect(verifySession(t, SECRET)).toMatchObject({ actorId: "admin", subjectId: "daytrader" });
  });
  it("rejects tampering, wrong secret, expiry and junk", () => {
    const t = signSession({ actorId: ADMIN_ID, subjectId: ADMIN_ID }, SECRET, 1_000_000);
    const [h, p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ actorId: "admin", subjectId: "x", iat: 1, exp: 9e9 })).toString("base64url");
    expect(verifySession(`${h}.${forged}.${s}`, SECRET, 1_000_000)).toBeNull();
    expect(verifySession(`${h}.${p}.${s}`, "other-secret-0123456789", 1_000_000)).toBeNull();
    expect(verifySession(t, SECRET, 1_000_000 + (SESSION_SECONDS + 1) * 1000)).toBeNull();
    expect(verifySession("nope", SECRET)).toBeNull();
    expect(verifySession(undefined, SECRET)).toBeNull();
  });
  it("hashes and verifies passwords", () => {
    const h = hashPassword("hunter2", randomBytes(16));
    expect(verifyPassword("hunter2", h)).toBe(true);
    expect(verifyPassword("hunter3", h)).toBe(false);
    expect(verifyPassword("hunter2", undefined)).toBe(false);
    expect(verifyPassword("hunter2", "scrypt:zz")).toBe(false);
  });
});

describe("impersonation guard", () => {
  const admin = { actorId: ADMIN_ID, subjectId: ADMIN_ID, iat: 0, exp: 1 };
  it("allows only the real admin, only for known personas", () => {
    expect(canImpersonate(admin, "daytrader", PERSONA_IDS)).toBe(true);
    expect(canImpersonate({ ...admin, subjectId: "daytrader" }, "retiree", PERSONA_IDS)).toBe(true); // actor is still admin
    expect(canImpersonate(admin, "nobody", PERSONA_IDS)).toBe(false);
    expect(canImpersonate(admin, undefined, PERSONA_IDS)).toBe(false);
    expect(canImpersonate(null, "daytrader", PERSONA_IDS)).toBe(false);
    expect(canImpersonate({ ...admin, actorId: "daytrader" }, "retiree", PERSONA_IDS)).toBe(false);
  });
});

describe("personas", () => {
  it("has about a dozen fictional, well-formed users", () => {
    expect(PERSONAS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(PERSONA_IDS).size).toBe(PERSONAS.length);
    for (const p of PERSONAS) {
      expect(p.email).toMatch(/@example\.test$/);
      expect(p.name).toMatch(/^Test Persona - /);
      expect(["free", "pro", "team"]).toContain(p.plan);
      expect(["conservative", "balanced", "aggressive"]).toContain(p.risk);
      expect(["new", "active", "lapsed", "churned"]).toContain(p.stage);
      expect(p.signupDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.interests.length).toBeGreaterThan(0);
      // seeded boards survive the real parser unchanged (valid ids, names, limits)
      expect(parseBoards(JSON.stringify(p.boards))).toEqual(p.boards);
    }
    expect(new Set(PERSONAS.map((p) => p.stage))).toEqual(new Set(["new", "active", "lapsed", "churned"]));
  });
});

describe("track payloads", () => {
  it("builds identify and track with optional impersonatedBy", () => {
    const now = Date.UTC(2026, 0, 2);
    expect(buildIdentify({ id: "u1", email: "a@example.test" }, { plan: "pro" }, { now })).toEqual({
      type: "identify", userId: "u1", traits: { email: "a@example.test", plan: "pro" }, timestamp: "2026-01-02T00:00:00.000Z",
    });
    expect(buildTrack("u1", "board_saved", { boards: 2 }, { now, impersonatedBy: "admin" })).toEqual({
      type: "track", userId: "u1", event: "board_saved", props: { boards: 2 }, timestamp: "2026-01-02T00:00:00.000Z", impersonatedBy: "admin",
    });
  });
});

describe("emit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("POSTs JSON to CEP_WEBHOOK_URL and never throws", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("CEP_WEBHOOK_URL", "https://cep.example.test/hook");
    const f = vi.fn().mockResolvedValue({});
    vi.stubGlobal("fetch", f);
    emit(buildTrack("u1", "login"));
    expect(f).toHaveBeenCalledOnce();
    expect(f.mock.calls[0][0]).toBe("https://cep.example.test/hook");
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ type: "track", userId: "u1", event: "login" });
    vi.stubGlobal("fetch", () => {
      throw new Error("boom");
    });
    expect(() => emit(buildTrack("u1", "login"))).not.toThrow();
    vi.stubGlobal("fetch", () => Promise.reject(new Error("down")));
    expect(() => emit(buildTrack("u1", "login"))).not.toThrow();
  });
});
