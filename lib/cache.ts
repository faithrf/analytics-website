/**
 * Small in-memory TTL cache with in-flight de-duplication and optional
 * stale-on-error fallback. No external dependencies.
 */
interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<V = unknown> {
  private store = new Map<string, Entry<V>>();
  private inflight = new Map<string, Promise<V>>();

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.store.size;
  }

  /** Fresh value, or undefined if missing/expired. */
  get(key: string): V | undefined {
    const e = this.store.get(key);
    if (!e || e.expiresAt <= this.now()) return undefined;
    return e.value;
  }

  /** Value even if expired (used as a fallback when upstream fails). */
  getStale(key: string): V | undefined {
    return this.store.get(key)?.value;
  }

  /** Value that expired less than `graceMs` ago (or is still fresh). */
  getWithin(key: string, graceMs: number): V | undefined {
    const e = this.store.get(key);
    if (!e || e.expiresAt + graceMs <= this.now()) return undefined;
    return e.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.store.delete(key); // re-insert so Map order tracks recency
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  /**
   * Keeps a background refresh alive after the response is sent. A no-op by
   * default; lib/api.ts points it at Next's `after()` for route handlers.
   */
  static defer: (task: Promise<unknown>) => void = () => {};

  /**
   * Return the cached value or run `loader`. Concurrent calls for the same key
   * share one loader run. If the loader throws and a stale value exists, the
   * stale value is returned (and kept for a short retry window).
   *
   * With `swrMs`, a value up to that long past its TTL is returned at once
   * while a refresh runs in the background, so callers rarely wait on upstream.
   */
  async getOrLoad(
    key: string,
    ttlMs: number,
    loader: () => Promise<V>,
    opts: { staleOnError?: boolean; swrMs?: number } = {},
  ): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const entry = this.store.get(key);
    const pending = this.inflight.get(key);
    if (entry && opts.swrMs && entry.expiresAt + opts.swrMs > this.now()) {
      if (!pending) {
        const refresh = this.load(key, ttlMs, loader, true);
        refresh.catch(() => {}); // the stale value stays; the next caller retries
        TtlCache.defer(refresh);
      }
      return entry.value;
    }
    return pending ?? this.load(key, ttlMs, loader, !!opts.staleOnError);
  }

  private load(key: string, ttlMs: number, loader: () => Promise<V>, staleOnError: boolean): Promise<V> {
    const run = (async () => {
      try {
        const value = await loader();
        this.set(key, value, ttlMs);
        return value;
      } catch (err) {
        const stale = staleOnError ? this.getStale(key) : undefined;
        if (stale !== undefined) {
          this.set(key, stale, Math.min(ttlMs, 10_000));
          return stale;
        }
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, run);
    return run;
  }
}
