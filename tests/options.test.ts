import { describe, expect, it } from "vitest";
import { CONTRACT_RE, mapChain, midPrice, parseOptionsParams, trimStrikes, type OptionRow } from "@/lib/options";

const SYMBOL_RE = /^[A-Z0-9.^=-]{1,14}$/;
const NOW = Date.UTC(2026, 10, 2);
const DAY = 86_400_000;
const p = (qs: string) => parseOptionsParams(new URLSearchParams(qs), SYMBOL_RE, NOW);

describe("CONTRACT_RE", () => {
  it("accepts OCC-style symbols", () => {
    for (const s of ["AAPL261104C00275000", "SPY261120P00450000", "BRKB261120C00500000", "F261120C00012500"]) expect(CONTRACT_RE.test(s)).toBe(true);
  });
  it("rejects junk", () => {
    for (const s of ["", "AAPL", "aapl261104c00275000", "AAPL261104X00275000", "AAPL26110C00275000", "AAPL261104C0027500", "A B261104C00275000", "AAPL261104C00275000,", "../etc"]) {
      expect(CONTRACT_RE.test(s)).toBe(false);
    }
  });
});

describe("midPrice", () => {
  it("mid of bid/ask when both above zero, else last", () => {
    expect(midPrice(1, 1.2, 5)).toBeCloseTo(1.1);
    expect(midPrice(0, 1.2, 0.9)).toBe(0.9);
    expect(midPrice(null, null, 0.5)).toBe(0.5);
    expect(midPrice(0, 0, 0)).toBeNull();
    expect(midPrice(2, 1, null)).toBeNull(); // crossed quote is not trusted
  });
});

describe("trimStrikes / mapChain", () => {
  const rows: OptionRow[] = Array.from({ length: 80 }, (_, i) => ({ strike: 100 + i, call: null, put: null }));
  it("keeps ~30 strikes centred on spot, ascending", () => {
    const out = trimStrikes(rows, 140);
    expect(out).toHaveLength(30);
    expect(out[0].strike).toBeLessThanOrEqual(140);
    expect(out[out.length - 1].strike).toBeGreaterThanOrEqual(140);
    expect(trimStrikes(rows, 5)[0].strike).toBe(100);
    expect(trimStrikes(rows, 1e6).at(-1)!.strike).toBe(179);
  });
  it("maps a Yahoo chain and returns empty expiries when there are none", () => {
    expect(mapChain("BHP.AX", { expirationDates: [], strikes: [], quote: { regularMarketPrice: 50 }, options: [] })).toMatchObject({ expiries: [], expiry: null, strikes: [] });
    const leg = (cs: string, strike: number) => ({ contractSymbol: cs, strike, bid: 1, ask: 1.2, lastPrice: 1.1, impliedVolatility: 0.3 });
    const c = mapChain("AAPL", {
      expirationDates: [new Date(NOW + DAY), new Date(NOW + 8 * DAY)],
      quote: { regularMarketPrice: 100 },
      options: [{ expirationDate: new Date(NOW + DAY), calls: [leg("AAPL261103C00100000", 100), leg("bad", 105)], puts: [leg("AAPL261103P00100000", 100)] }],
    });
    expect(c.expiries).toEqual([NOW + DAY, NOW + 8 * DAY]);
    expect(c.expiry).toBe(NOW + DAY);
    expect(c.strikes).toHaveLength(1);
    expect(c.strikes[0].call?.iv).toBe(0.3);
    expect(c.strikes[0].put?.contractSymbol).toBe("AAPL261103P00100000");
  });
});

describe("parseOptionsParams", () => {
  it("validates the symbol and optional date", () => {
    expect(p("symbol=aapl")).toEqual({ kind: "chain", symbol: "AAPL" });
    expect(p("symbol=AAPL&date=" + (NOW + 7 * DAY))).toEqual({ kind: "chain", symbol: "AAPL", date: NOW + 7 * DAY });
    expect(p("")).toHaveProperty("error");
    expect(p("symbol=bad%20sym")).toHaveProperty("error");
    expect(p("symbol=AAPL&date=abc")).toHaveProperty("error");
    expect(p("symbol=AAPL&date=" + (NOW - 30 * DAY))).toHaveProperty("error");
  });
  it("validates contracts: strict regex, 1-50, de-duplicated", () => {
    const one = "AAPL261120C00250000";
    expect(p(`contracts=${one},${one}`)).toMatchObject({ kind: "contracts", contracts: [one] });
    expect(p("contracts=")).toHaveProperty("error");
    expect(p(`contracts=${one},nope`)).toHaveProperty("error");
    const many = Array.from({ length: 51 }, (_, i) => `AAPL261120C${String(i + 1).padStart(8, "0")}`).join(",");
    expect(p(`contracts=${many}`)).toHaveProperty("error");
    expect(p(`contracts=${one}&from=${NOW + DAY}`)).toHaveProperty("error");
    expect(p(`contracts=${one}&from=${NOW - 5 * DAY}`)).toMatchObject({ from: NOW - 5 * DAY });
  });
});
