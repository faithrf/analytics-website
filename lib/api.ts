import "server-only";
import { after, NextResponse } from "next/server";
import { TtlCache } from "@/lib/cache";

// Background cache refreshes (stale-while-revalidate) finish after the response is sent.
TtlCache.defer = (task) => {
  try {
    after(() => task);
  } catch {
    /* outside a request: the promise still runs, just unguarded */
  }
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const CODE_RE = /^[A-Z0-9]{1,6}$/;
export const SYMBOL_RE = /^[A-Z0-9.^=-]{1,14}$/;

/** Map any thrown error to a safe JSON response (never leaks stack traces). */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
  }
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/429|too many requests|rate.?limit/i.test(text)) {
    return NextResponse.json(
      { error: "rate_limited", message: "Yahoo Finance is rate limiting requests. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  if (/not found|no data found|delisted/i.test(text)) {
    return NextResponse.json({ error: "not_found", message: "No data found for that ticker." }, { status: 404 });
  }
  console.error("[api] upstream error:", text.slice(0, 300));
  return NextResponse.json(
    { error: "upstream", message: "Could not reach Yahoo Finance. Data will retry shortly." },
    { status: 502 },
  );
}

/**
 * Browsers keep a response 15 s. Vercel's CDN keeps it 30 s and may serve it up
 * to 5 min stale while it refetches, so most visitors never wait on the function.
 */
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=15, stale-while-revalidate=45",
  "CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
};

/** Wrap a route body: JSON on success, structured error otherwise. */
export async function respond<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn(), { headers: CACHE_HEADERS });
  } catch (err) {
    return toErrorResponse(err);
  }
}
