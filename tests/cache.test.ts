import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "@/lib/cache";

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("TtlCache", () => {
  it("returns a value until it expires", () => {
    const c = clock();
    const cache = new TtlCache<number>(10, c.now);
    cache.set("a", 1, 60_000);
    expect(cache.get("a")).toBe(1);
    c.advance(59_999);
    expect(cache.get("a")).toBe(1);
    c.advance(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.getStale("a")).toBe(1);
  });

  it("evicts the oldest entry beyond maxEntries", () => {
    const cache = new TtlCache<number>(2, clock().now);
    cache.set("a", 1, 1000);
    cache.set("b", 2, 1000);
    cache.set("c", 3, 1000);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("getOrLoad caches and only calls the loader once per TTL", async () => {
    const c = clock();
    const cache = new TtlCache<string>(10, c.now);
    const loader = vi.fn().mockResolvedValue("x");
    expect(await cache.getOrLoad("k", 1000, loader)).toBe("x");
    expect(await cache.getOrLoad("k", 1000, loader)).toBe("x");
    expect(loader).toHaveBeenCalledTimes(1);
    c.advance(1001);
    await cache.getOrLoad("k", 1000, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("de-duplicates concurrent loads for the same key", async () => {
    const cache = new TtlCache<number>(10, clock().now);
    const loader = vi.fn(() => new Promise<number>((r) => setTimeout(() => r(7), 5)));
    const [a, b] = await Promise.all([cache.getOrLoad("k", 1000, loader), cache.getOrLoad("k", 1000, loader)]);
    expect([a, b]).toEqual([7, 7]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("propagates loader errors and does not cache them", async () => {
    const cache = new TtlCache<number>(10, clock().now);
    const loader = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(5);
    await expect(cache.getOrLoad("k", 1000, loader)).rejects.toThrow("boom");
    expect(await cache.getOrLoad("k", 1000, loader)).toBe(5);
  });

  it("serves stale data on error when staleOnError is set", async () => {
    const c = clock();
    const cache = new TtlCache<number>(10, c.now);
    cache.set("k", 9, 1000);
    c.advance(5000);
    const loader = vi.fn().mockRejectedValue(new Error("down"));
    expect(await cache.getOrLoad("k", 1000, loader, { staleOnError: true })).toBe(9);
    await expect(cache.getOrLoad("z", 1000, loader, { staleOnError: true })).rejects.toThrow("down");
  });

  it("serves a stale value at once and refreshes in the background with swrMs", async () => {
    const c = clock();
    const cache = new TtlCache<number>(10, c.now);
    cache.set("k", 1, 1000);
    c.advance(2000);
    let resolve!: (v: number) => void;
    const loader = vi.fn(() => new Promise<number>((r) => (resolve = r)));
    expect(await cache.getOrLoad("k", 1000, loader, { swrMs: 60_000 })).toBe(1);
    expect(await cache.getOrLoad("k", 1000, loader, { swrMs: 60_000 })).toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);
    resolve(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.get("k")).toBe(2);
  });

  it("waits for the loader once a value is past the swr window", async () => {
    const c = clock();
    const cache = new TtlCache<number>(10, c.now);
    cache.set("k", 1, 1000);
    c.advance(120_000);
    expect(await cache.getOrLoad("k", 1000, async () => 3, { swrMs: 60_000 })).toBe(3);
  });

  it("getWithin serves a value until the grace period after expiry ends", () => {
    const c = clock();
    const cache = new TtlCache<number>(10, c.now);
    cache.set("k", 1, 1000);
    c.advance(1500);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.getWithin("k", 1000)).toBe(1);
    c.advance(600);
    expect(cache.getWithin("k", 1000)).toBeUndefined();
  });
});
