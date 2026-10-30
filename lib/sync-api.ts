import "server-only";
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "@/lib/api";
import { parseBoards, type BoardsState } from "@/lib/boards";
import { codeFromBytes, normaliseCode } from "@/lib/sync-code";
import { getStore } from "@/lib/sync-store";

export const MAX_BODY_BYTES = 16 * 1024;
const PER_MINUTE = 60;
const CREATES_PER_HOUR = 10;

const NO_STORE = { "Cache-Control": "no-store" };

export function newCode(): string {
  return codeFromBytes(randomBytes(10));
}

export function parseCode(raw: string): string {
  const code = normaliseCode(decodeURIComponent(raw));
  if (!code) throw new ApiError(400, "bad_request", "That is not a valid sync code.");
  return code;
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

/** Returns the store (503 when not configured) after applying the per-IP rate limits. */
export async function guard(req: NextRequest, creating = false) {
  const store = getStore();
  if (!store) throw new ApiError(503, "not_configured", "Sync isn't set up on this server.");
  const ip = clientIp(req);
  const tooMany = () => new ApiError(429, "rate_limited", "Too many sync requests. Try again in a minute.");
  if ((await store.incr(`rl:sync:${ip}`, 60)) > PER_MINUTE) throw tooMany();
  if (creating && (await store.incr(`rl:sync-create:${ip}`, 3600)) > CREATES_PER_HOUR) throw tooMany();
  return store;
}

/** Reads the JSON body (413 over 16 KB) and sanitises it to boards + active. */
export async function readBoards(req: NextRequest): Promise<BoardsState> {
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new ApiError(413, "too_large", "Dashboards are too large to sync.");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, "bad_request", "Body must be JSON.");
  }
  if (!body || typeof body !== "object" || !Array.isArray((body as { boards?: unknown }).boards)) {
    throw new ApiError(400, "bad_request", "Body needs a boards array.");
  }
  return parseBoards(JSON.stringify(body));
}

/** Like lib/api respond(), but uncached and with the retry hint for 429. */
export async function syncRespond<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn(), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ApiError) {
      const headers: Record<string, string> = { ...NO_STORE };
      if (err.status === 429) headers["Retry-After"] = "60";
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status, headers });
    }
    console.error("[api] sync error:", err instanceof Error ? err.message.slice(0, 300) : String(err));
    return NextResponse.json(
      { error: "upstream", message: "Sync storage is unavailable. Try again shortly." },
      { status: 502, headers: NO_STORE },
    );
  }
}
