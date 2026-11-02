import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { bsCall, bsPut, DAY_MS, evaluate, histVol, MAX_TRADES, normCdf, parseTrades, summarise, type Bar, type Trade } from "@/lib/trades";
import { applyPatch, parseUserData, seedFor } from "@/lib/user-store";

const D0 = Date.UTC(2026, 0, 5); // a Monday
const day = (n: number) => D0 + n * DAY_MS;
const bar = (n: number, low: number, high: number, close: number): Bar => ({ t: day(n), low, high, close });
const NOW = day(20);

const base: Trade = { id: "t1", side: "long", symbol: "BHP", amount: 1000, startMs: day(0), createdMs: day(0) };
const flat: Bar[] = [bar(0, 99, 101, 100), bar(1, 98, 102, 100), bar(2, 98, 102, 101)];

describe("parseTrades", () => {
  it("never throws on junk", () => {
    expect(parseTrades(null)).toEqual([]);
    expect(parseTrades("{nope")).toEqual([]);
    expect(parseTrades({})).toEqual([]);
    expect(parseTrades([1, "x", null, {}])).toEqual([]);
  });
  it("keeps a valid trade, uppercases the symbol and parses a JSON string", () => {
    const [t] = parseTrades(JSON.stringify([{ ...base, symbol: "aapl.us", targetPct: 10, stopPct: 5 }]));
    expect(t).toMatchObject({ id: "t1", symbol: "AAPL.US", amount: 1000, targetPct: 10, stopPct: 5 });
  });
  it("drops bad symbols, amounts and duplicate ids", () => {
    const list = parseTrades([{ ...base, symbol: "bad symbol!" }, { ...base, amount: -5 }, { ...base, amount: 0 }, base, base]);
    expect(list).toHaveLength(1);
  });
  it("clamps and drops invalid optional fields", () => {
    const [t] = parseTrades([{ ...base, amount: 1e15, targetPct: 99999, stopPct: 500, endMs: base.startMs - 1, closedMs: 5, closePrice: -1, entryPrice: 0 }]);
    expect(t.amount).toBe(1_000_000_000);
    expect(t.targetPct).toBe(1000);
    expect(t.stopPct).toBe(99);
    expect(t.endMs).toBeUndefined();
    expect(t.closedMs).toBeUndefined();
    expect(t.closePrice).toBeUndefined();
    expect(t.entryPrice).toBeUndefined();
  });
  it("caps the list at MAX_TRADES", () => {
    const many = Array.from({ length: MAX_TRADES + 10 }, (_, i) => ({ ...base, id: `x${i}` }));
    expect(parseTrades(many)).toHaveLength(MAX_TRADES);
  });
});

describe("evaluate", () => {
  it("today entry: uses the stored price, marks at the live price, ignores the entry day's bar", () => {
    const t = { ...base, entryPrice: 50, stopPct: 10 };
    // entry-day bar dipped to 1, but that was before the trade was placed
    const r = evaluate(t, [bar(0, 1, 60, 55), bar(1, 49, 52, 51)], 55, day(1));
    expect(r).toMatchObject({ status: "open", entry: 50, exit: null, mark: 55 });
    expect(r.shares).toBe(20);
    expect(r.pl).toBeCloseTo(100);
    expect(r.plPct).toBeCloseTo(10);
  });
  it("backdated entry: close of the first trading day on/after the start date", () => {
    const t = { ...base, startMs: day(5) }; // a Saturday
    const bars = [bar(4, 1, 1, 1), bar(7, 90, 96, 95), bar(8, 94, 100, 98)];
    const r = evaluate(t, bars, 120, NOW);
    expect(r.entry).toBe(95);
    expect(r.status).toBe("open");
    expect(r.mark).toBe(120);
  });
  it("backdated with no trading day yet has no entry", () => {
    const r = evaluate({ ...base, startMs: day(30) }, flat, 100, NOW);
    expect(r).toMatchObject({ status: "open", entry: null, pl: null });
  });
  it("target hit: exits at the target level on the first day the high reaches it", () => {
    const r = evaluate({ ...base, targetPct: 5 }, [...flat, bar(3, 100, 106, 104), bar(4, 100, 130, 125)], 200, NOW);
    expect(r).toMatchObject({ status: "target", exit: 105, mark: 105 });
    expect(r.pl).toBeCloseTo(50);
    expect(r.days).toBe(3);
  });
  it("stop hit: exits at the stop level", () => {
    const r = evaluate({ ...base, stopPct: 5 }, [...flat, bar(3, 90, 100, 92)], 50, NOW);
    expect(r).toMatchObject({ status: "stop", exit: 95 });
    expect(r.pl).toBeCloseTo(-50);
    expect(r.plPct).toBeCloseTo(-5);
  });
  it("both on the same day counts as the stop", () => {
    const r = evaluate({ ...base, targetPct: 5, stopPct: 5 }, [...flat, bar(3, 90, 110, 100)], 100, NOW);
    expect(r.status).toBe("stop");
    expect(r.exit).toBe(95);
  });
  it("end date: closes at the close of the first trading day on/after it", () => {
    const t = { ...base, endMs: day(3) }; // Thursday has no bar; Friday does
    const r = evaluate(t, [...flat, bar(4, 100, 110, 108)], 200, NOW);
    expect(r).toMatchObject({ status: "ended", exit: 108 });
  });
  it("end date not reached yet stays open", () => {
    expect(evaluate({ ...base, endMs: day(30) }, flat, 101, NOW).status).toBe("open");
  });
  it("a target hit before the end date wins", () => {
    const r = evaluate({ ...base, targetPct: 5, endMs: day(4) }, [...flat, bar(3, 100, 106, 101), bar(4, 100, 101, 100)], 100, NOW);
    expect(r.status).toBe("target");
  });
  it("manual close: exits at the stored price and ignores later bars", () => {
    const t = { ...base, closedMs: day(2), closePrice: 103, stopPct: 5 };
    const r = evaluate(t, [...flat, bar(3, 10, 100, 12)], 12, NOW);
    expect(r).toMatchObject({ status: "closed", exit: 103, mark: 103 });
    expect(r.pl).toBeCloseTo(30);
  });
  it("a rule that fired before the manual close still wins", () => {
    const t = { ...base, closedMs: day(5), closePrice: 100, stopPct: 5 };
    const r = evaluate(t, [...flat, bar(3, 90, 100, 92)], 100, NOW);
    expect(r.status).toBe("stop");
  });
  it("open: marks at the live price, else the latest close", () => {
    expect(evaluate(base, flat, 110, NOW)).toMatchObject({ status: "open", mark: 110 });
    expect(evaluate(base, flat, null, NOW)).toMatchObject({ status: "open", mark: 101 });
  });
});

describe("summarise", () => {
  it("counts trades, invested, P/L and win rate", () => {
    const win = evaluate(base, flat, 110, NOW);
    const loss = evaluate({ ...base, id: "t2" }, flat, 90, NOW);
    const s = summarise([win, loss, null]);
    expect(s.count).toBe(3);
    expect(s.invested).toBeCloseTo(2000);
    expect(s.pl).toBeCloseTo(0);
    expect(s.winRate).toBe(50);
    expect(summarise([]).winRate).toBeNull();
  });
});

describe("saved user data keeps trades across PUT-style merges", () => {
  const prev = parseUserData({
    boards: [{ id: "watchlist", name: "Watchlist", ids: ["BHP"] }],
    active: "watchlist",
    follows: ["NVDA"],
    trades: [base],
  });
  it("seeds an empty trades list", () => {
    expect(seedFor("someone").trades).toEqual([]);
    expect(prev.trades).toHaveLength(1);
  });
  it("a boards-only PUT preserves trades and follows", () => {
    const next = applyPatch(prev, { boards: [{ id: "b1", name: "Mine", ids: ["CBA"] }], active: "b1" });
    expect(next.boards[0].id).toBe("b1");
    expect(next.trades).toEqual(prev.trades);
    expect(next.follows).toEqual(["NVDA"]);
  });
  it("a follows-only PUT preserves boards and trades", () => {
    const next = applyPatch(prev, { follows: ["TSLA"] });
    expect(next.follows).toEqual(["TSLA"]);
    expect(next.boards).toEqual(prev.boards);
    expect(next.trades).toEqual(prev.trades);
  });
  it("a trades-only PUT preserves boards and follows, and cleans the list", () => {
    const next = applyPatch(prev, { trades: [{ ...base, id: "t9" }, { junk: true }] });
    expect(next.trades.map((t) => t.id)).toEqual(["t9"]);
    expect(next.boards).toEqual(prev.boards);
    expect(next.follows).toEqual(prev.follows);
  });
  it("an empty PUT changes nothing", () => {
    expect(applyPatch(prev, {})).toEqual(prev);
  });
});

describe("short", () => {
  const short: Trade = { ...base, side: "short" };
  it("P/L is positive when the price falls, negative when it rises", () => {
    expect(evaluate(short, flat, 90, NOW).pl).toBeCloseTo(100);
    expect(evaluate(short, flat, 110, NOW).pl).toBeCloseTo(-100);
    expect(evaluate(short, flat, 90, NOW).shares).toBeCloseTo(10);
  });
  it("target is a fall, exits at the level", () => {
    const r = evaluate({ ...short, targetPct: 5 }, [...flat, bar(3, 94, 100, 96)], 100, NOW);
    expect(r).toMatchObject({ status: "target", exit: 95 });
    expect(r.pl).toBeCloseTo(50);
  });
  it("stop is a rise, exits at the level", () => {
    const r = evaluate({ ...short, stopPct: 5 }, [...flat, bar(3, 99, 106, 104)], 100, NOW);
    expect(r).toMatchObject({ status: "stop", exit: 105 });
    expect(r.pl).toBeCloseTo(-50);
  });
  it("both on the same day counts as the stop", () => {
    expect(evaluate({ ...short, targetPct: 5, stopPct: 5 }, [...flat, bar(3, 90, 110, 100)], 100, NOW).status).toBe("stop");
  });
});

describe("Black-Scholes", () => {
  it("normCdf basics", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
  it("at-the-money put matches the textbook value", () => {
    expect(Math.abs(bsPut(100, 100, 1, 0.04, 0.2) - 5.98)).toBeLessThan(0.05);
  });
  it("deep in the money is near intrinsic, expiry is intrinsic", () => {
    expect(bsPut(50, 100, 0.25, 0.04, 0.2)).toBeGreaterThan(49);
    expect(bsPut(50, 100, 0.25, 0.04, 0.2)).toBeLessThan(51);
    expect(bsPut(90, 100, 0, 0.04, 0.2)).toBe(10);
    expect(bsPut(110, 100, 0, 0.04, 0.2)).toBe(0);
  });
  it("put-call parity", () => {
    const c = bsCall(100, 105, 0.5, 0.04, 0.3);
    const p = bsPut(100, 105, 0.5, 0.04, 0.3);
    expect(c - p).toBeCloseTo(100 - 105 * Math.exp(-0.04 * 0.5), 4);
  });
  it("histVol needs enough bars and annualises", () => {
    const few = Array.from({ length: 5 }, (_, i) => bar(i - 10, 1, 1, 100 + i));
    expect(histVol(few, day(0))).toBeNull();
    const flatBars = Array.from({ length: 30 }, (_, i) => bar(i - 40, 1, 1, 100));
    expect(histVol(flatBars, day(0))).toBe(0.05);
    const zig = Array.from({ length: 30 }, (_, i) => bar(i - 40, 1, 1, i % 2 ? 101 : 100));
    expect(histVol(zig, day(0))!).toBeGreaterThan(0.05);
  });
});

describe("put", () => {
  const sigma = 0.2;
  const put: Trade = { ...base, side: "put", entryPrice: 100, strikePct: 100, expiryMs: day(10), sigma };
  const prem = bsPut(100, 100, 10 / 365, 0.04, sigma);
  it("buys units = amount / premium and marks at BS value", () => {
    const r = evaluate(put, [bar(0, 99, 101, 100)], 100, day(0));
    expect(r.entry).toBeCloseTo(prem, 8);
    expect(r.shares).toBeCloseTo(1000 / prem, 6);
    expect(r.strike).toBe(100);
    expect(r.status).toBe("open");
    expect(r.pl).toBeCloseTo(0, 4);
  });
  it("at expiry settles at intrinsic and is expired; max loss is the amount", () => {
    const r = evaluate(put, [bar(0, 99, 101, 100), bar(10, 109, 111, 110)], 110, NOW);
    expect(r).toMatchObject({ status: "expired", exit: 0 });
    expect(r.pl).toBeCloseTo(-1000, 6);
    const itm = evaluate(put, [bar(0, 99, 101, 100), bar(10, 89, 91, 90)], 90, NOW);
    expect(itm.exit).toBe(10);
    expect(itm.pl).toBeGreaterThan(0);
  });
  it("target applies to option value vs premium on closes", () => {
    const t = { ...put, targetPct: 100 };
    const r = evaluate(t, [bar(0, 99, 101, 100), bar(1, 80, 100, 85), bar(2, 70, 90, 80)], 80, NOW);
    expect(r.status).toBe("target");
    expect(r.exit!).toBeGreaterThanOrEqual(2 * prem);
    expect(r.plPct!).toBeGreaterThanOrEqual(100);
  });
  it("stop applies on closes", () => {
    const r = evaluate({ ...put, stopPct: 50 }, [bar(0, 99, 101, 100), bar(1, 100, 125, 120)], 120, NOW);
    expect(r.status).toBe("stop");
    expect(r.plPct!).toBeLessThanOrEqual(-50);
  });
});

describe("call", () => {
  const sigma = 0.2;
  const call: Trade = { ...base, side: "call", entryPrice: 100, strikePct: 100, expiryMs: day(10), sigma };
  const prem = bsCall(100, 100, 10 / 365, 0.04, sigma);
  it("BS call sanity: ATM textbook value, intrinsic at expiry", () => {
    expect(Math.abs(bsCall(100, 100, 1, 0.04, 0.2) - 9.93)).toBeLessThan(0.05);
    expect(bsCall(110, 100, 0, 0.04, 0.2)).toBe(10);
    expect(bsCall(90, 100, 0, 0.04, 0.2)).toBe(0);
  });
  it("buys units = amount / premium and marks at the BS call value", () => {
    const r = evaluate(call, [bar(0, 99, 101, 100)], 100, day(0));
    expect(r.entry).toBeCloseTo(prem, 8);
    expect(r.shares).toBeCloseTo(1000 / prem, 6);
    expect(r.pl).toBeCloseTo(0, 4);
    expect(evaluate(call, [bar(0, 99, 101, 100)], 110, day(1)).pl!).toBeGreaterThan(0);
  });
  it("expiry settles at max(S-K, 0); max loss is the amount", () => {
    const otm = evaluate(call, [bar(0, 99, 101, 100), bar(10, 89, 91, 90)], 90, NOW);
    expect(otm).toMatchObject({ status: "expired", exit: 0, maxLoss: 1000 });
    expect(otm.pl).toBeCloseTo(-1000, 6);
    const itm = evaluate(call, [bar(0, 99, 101, 100), bar(10, 109, 111, 110)], 110, NOW);
    expect(itm.exit).toBe(10);
    expect(itm.pl).toBeCloseTo((10 - prem) * (1000 / prem), 6);
  });
});

describe("sold options", () => {
  const sigma = 0.2;
  const sp: Trade = { ...base, side: "put", sold: true, entryPrice: 100, strikePct: 100, expiryMs: day(10), sigma };
  const sc: Trade = { ...sp, side: "call" };
  const putPrem = bsPut(100, 100, 10 / 365, 0.04, sigma);
  const callPrem = bsCall(100, 100, 10 / 365, 0.04, sigma);
  it("amount is the premium collected: units = amount / premium, P/L is zero at entry", () => {
    const r = evaluate(sp, [bar(0, 99, 101, 100)], 100, day(0));
    expect(r.shares).toBeCloseTo(1000 / putPrem, 6);
    expect(r.pl).toBeCloseTo(0, 4);
    expect(r.sold).toBe(true);
  });
  it("sold put gains when the stock rises and loses when it falls", () => {
    expect(evaluate(sp, [bar(0, 99, 101, 100)], 110, day(1)).pl!).toBeGreaterThan(0);
    expect(evaluate(sp, [bar(0, 99, 101, 100)], 90, day(1)).pl!).toBeLessThan(0);
  });
  it("sold call gains when the stock falls and loses when it rises", () => {
    expect(evaluate(sc, [bar(0, 99, 101, 100)], 90, day(1)).pl!).toBeGreaterThan(0);
    expect(evaluate(sc, [bar(0, 99, 101, 100)], 110, day(1)).pl!).toBeLessThan(0);
  });
  it("max loss: sold call unlimited, sold put (strike - premium) x units", () => {
    expect(evaluate(sc, [bar(0, 99, 101, 100)], 100, day(0)).maxLoss).toBeNull();
    const r = evaluate(sp, [bar(0, 99, 101, 100)], 100, day(0));
    expect(r.maxLoss).toBeCloseTo((100 - putPrem) * (1000 / putPrem), 6);
  });
  it("take profit fires when the value falls by X% of the premium (direction flipped)", () => {
    // stock jumps: the sold put loses value
    const r = evaluate({ ...sp, targetPct: 50 }, [bar(0, 99, 101, 100), bar(1, 100, 125, 120)], 120, NOW);
    expect(r.status).toBe("target");
    expect(r.exit!).toBeLessThanOrEqual(putPrem * 0.5);
    expect(r.plPct!).toBeGreaterThanOrEqual(50);
  });
  it("stop loss fires when the value rises X% above the premium", () => {
    const r = evaluate({ ...sp, stopPct: 100 }, [bar(0, 99, 101, 100), bar(1, 60, 100, 80)], 80, NOW);
    expect(r.status).toBe("stop");
    expect(r.exit!).toBeGreaterThanOrEqual(putPrem * 2);
    expect(r.plPct!).toBeLessThanOrEqual(-100);
  });
  it("sold call stop fires on a rally, target on a drop", () => {
    expect(evaluate({ ...sc, stopPct: 100 }, [bar(0, 99, 101, 100), bar(1, 100, 130, 125)], 125, NOW).status).toBe("stop");
    expect(evaluate({ ...sc, targetPct: 50 }, [bar(0, 99, 101, 100), bar(1, 80, 100, 85)], 85, NOW).status).toBe("target");
  });
  it("at expiry P/L = (premium - intrinsic) x units", () => {
    const units = 1000 / callPrem;
    const worthless = evaluate(sc, [bar(0, 99, 101, 100), bar(10, 89, 91, 90)], 90, NOW);
    expect(worthless).toMatchObject({ status: "expired", exit: 0 });
    expect(worthless.pl).toBeCloseTo(1000, 6); // keeps the whole premium
    const itm = evaluate(sc, [bar(0, 99, 101, 100), bar(10, 119, 121, 120)], 120, NOW);
    expect(itm.exit).toBe(20);
    expect(itm.pl).toBeCloseTo((callPrem - 20) * units, 6);
    const putItm = evaluate(sp, [bar(0, 99, 101, 100), bar(10, 79, 81, 80)], 80, NOW);
    expect(putItm.pl).toBeCloseTo((putPrem - 20) * (1000 / putPrem), 6);
  });
  it("sold options count as 0 invested in the summary but P/L sums normally", () => {
    const sold = evaluate(sc, [bar(0, 99, 101, 100), bar(10, 89, 91, 90)], 90, NOW);
    const bought = evaluate(base, flat, 110, NOW);
    const s = summarise([sold, bought]);
    expect(s.invested).toBeCloseTo(1000);
    expect(s.pl).toBeCloseTo(sold.pl! + bought.pl!);
  });
});

describe("real-priced options", () => {
  const real: Trade = { ...base, side: "call", entryPrice: 100, expiryMs: day(30), sigma: 0.3, priceSource: "real", contractSymbol: "AAPL261120C00100000", premium: 5, strike: 100 };
  it("uses the stored premium and the live contract quote for the mark", () => {
    const r = evaluate(real, [bar(0, 99, 101, 100)], 100, day(1), { quote: 6 });
    expect(r.entry).toBe(5);
    expect(r.shares).toBe(200);
    expect(r.mark).toBe(6);
    expect(r.pl).toBeCloseTo(200);
  });
  it("target/stop use the contract's daily closes when present, else Black-Scholes", () => {
    const bars = [bar(0, 99, 101, 100), bar(1, 99, 101, 100)];
    const hit = evaluate({ ...real, targetPct: 50 }, bars, 100, NOW, { bars: [{ t: day(1), close: 8 }] });
    expect(hit).toMatchObject({ status: "target", exit: 8 });
    const miss = evaluate({ ...real, targetPct: 50 }, bars, 100, NOW, { bars: [{ t: day(1), close: 6 }] });
    expect(miss.status).toBe("open");
  });
  it("parseTrades keeps real fields only when complete and valid", () => {
    const ok = { ...real, startMs: base.startMs };
    expect(parseTrades([ok])[0]).toMatchObject({ priceSource: "real", contractSymbol: "AAPL261120C00100000", premium: 5, strike: 100 });
    expect(parseTrades([{ ...ok, contractSymbol: "nope" }])[0]).toMatchObject({ priceSource: "est" });
    expect(parseTrades([{ ...ok, contractSymbol: "nope" }])[0].contractSymbol).toBeUndefined();
    expect(parseTrades([{ ...ok, premium: 0 }])[0].priceSource).toBe("est");
  });
});

describe("parseTrades side/put", () => {
  it("old put trades (no sold/priceSource) still parse as bought estimated puts", () => {
    const old = { id: "old1", side: "put", symbol: "BHP", amount: 500, startMs: base.startMs, entryPrice: 40, expiryMs: base.startMs + 20 * DAY_MS, strikePct: 95, sigma: 0.25, createdMs: base.startMs };
    const [t] = parseTrades([old]);
    expect(t).toMatchObject({ side: "put", strikePct: 95, sigma: 0.25, priceSource: "est" });
    expect(t.sold).toBeUndefined();
    expect(t.contractSymbol).toBeUndefined();
  });
  it("sold flag only counts on options; sold clamps allow a larger stop", () => {
    const exp = base.startMs + 20 * DAY_MS;
    expect(parseTrades([{ ...base, sold: true }])[0].sold).toBeUndefined();
    const [s] = parseTrades([{ ...base, side: "call", sold: true, expiryMs: exp, stopPct: 300, targetPct: 500 }]);
    expect(s).toMatchObject({ side: "call", sold: true, stopPct: 300, targetPct: 100 });
    expect(parseTrades([{ ...base, side: "call", expiryMs: exp, stopPct: 300 }])[0].stopPct).toBe(99);
    expect(parseTrades([{ ...base, side: "call" }])).toEqual([]);
  });
  it("defaults missing or invalid side to long", () => {
    const noSide: Record<string, unknown> = { ...base };
    delete noSide.side;
    expect(parseTrades([noSide])[0].side).toBe("long");
    expect(parseTrades([{ ...base, side: "weird" }])[0].side).toBe("long");
    expect(parseTrades([{ ...base, side: "short" }])[0].side).toBe("short");
  });
  it("validates put fields", () => {
    const ok = { ...base, side: "put", expiryMs: base.startMs + 30 * DAY_MS, strikePct: 90, sigma: 0.4 };
    expect(parseTrades([ok])[0]).toMatchObject({ side: "put", strikePct: 90, sigma: 0.4 });
    expect(parseTrades([{ ...ok, strikePct: 10 }])[0].strikePct).toBe(100);
    expect(parseTrades([{ ...ok, sigma: 99 }])[0].sigma).toBe(3);
    expect(parseTrades([{ ...ok, expiryMs: undefined }])).toEqual([]);
    expect(parseTrades([{ ...ok, expiryMs: base.startMs + 1000 }])).toEqual([]);
    expect(parseTrades([{ ...ok, expiryMs: base.startMs + 800 * DAY_MS }])).toEqual([]);
  });
});
