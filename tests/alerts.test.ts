import { describe, expect, it } from "vitest";
import { decideAlerts, isLive, parseAlertSettings, sentKey, tradingDay, type AlertQuote, type AlertSettings } from "@/lib/alerts";

const NOW = Date.UTC(2026, 10, 24, 1, 0); // 12:00 Sydney
const on: AlertSettings = { enabled: true, movePct: 5, bigMovePct: 10, hiLo: true };
const quote = (o: Partial<AlertQuote> = {}): AlertQuote => ({
  symbol: "BHP.AX",
  price: 45.1,
  changePct: 6.2,
  high52: 50,
  low52: 30,
  dayHigh: 45.3,
  dayLow: 42,
  marketState: "REGULAR",
  time: NOW - 60_000,
  ...o,
});

describe("parseAlertSettings", () => {
  it("defaults to 5 / 10 / hi-lo on / disabled", () => {
    expect(parseAlertSettings(null)).toEqual({ enabled: false, movePct: 5, bigMovePct: 10, hiLo: true });
  });
  it("clamps and keeps big >= move", () => {
    const s = parseAlertSettings({ enabled: true, movePct: 99, bigMovePct: 1, hiLo: false });
    expect(s).toEqual({ enabled: true, movePct: 50, bigMovePct: 50, hiLo: false });
    expect(parseAlertSettings({ movePct: 0 }).movePct).toBe(0.5);
    expect(parseAlertSettings({ movePct: "x" }).movePct).toBe(5);
  });
});

describe("isLive", () => {
  it("needs an open market and a recent trade", () => {
    expect(isLive(quote(), NOW)).toBe(true);
    expect(isLive(quote({ marketState: "CLOSED" }), NOW)).toBe(false);
    expect(isLive(quote({ marketState: "POST" }), NOW)).toBe(false);
    expect(isLive(quote({ time: NOW - 2 * 3600_000 }), NOW)).toBe(false);
    expect(isLive(quote({ time: null }), NOW)).toBe(false);
  });
});

describe("decideAlerts", () => {
  it("fires a move alert with the example wording", () => {
    const [a] = decideAlerts(quote(), on, NOW);
    expect(a.level).toBe("move");
    expect(a.body).toBe("BHP.AX +6.2% to $45.10 (day high $45.30)");
  });
  it("uses the day low and a minus for falls", () => {
    const [a] = decideAlerts(quote({ changePct: -5.5, price: 42.5, dayLow: 42.4 }), on, NOW);
    expect(a.body).toBe("BHP.AX −5.5% to $42.50 (day low $42.40)");
    expect(a.dir).toBe("down");
  });
  it("stays quiet below the threshold, when disabled, or when the market is shut or stale", () => {
    expect(decideAlerts(quote({ changePct: 4.9 }), on, NOW)).toEqual([]);
    expect(decideAlerts(quote(), { ...on, enabled: false }, NOW)).toEqual([]);
    expect(decideAlerts(quote({ marketState: "CLOSED" }), on, NOW)).toEqual([]);
    expect(decideAlerts(quote({ time: NOW - 3 * 3600_000 }), on, NOW)).toEqual([]);
  });
  it("fires the big alert at bigMovePct and uses up the smaller level", () => {
    const alerts = decideAlerts(quote({ changePct: 11 }), on, NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe("big");
    expect(alerts[0].keys).toEqual(["big:up", "move:up"]);
  });
  it("does not repeat a level already sent, but still sends the next one up", () => {
    expect(decideAlerts(quote(), on, NOW, new Set(["move:up"]))).toEqual([]);
    expect(decideAlerts(quote({ changePct: 12 }), on, NOW, new Set(["move:up"]))[0].level).toBe("big");
    expect(decideAlerts(quote({ changePct: 6 }), on, NOW, new Set(["big:up", "move:up"]))).toEqual([]);
  });
  it("a fall is deduped separately from a rise", () => {
    expect(decideAlerts(quote({ changePct: -6 }), on, NOW, new Set(["move:up"]))).toHaveLength(1);
  });
  it("alerts on a new 52-week high or low and respects the toggle", () => {
    const hi = decideAlerts(quote({ changePct: 1, price: 50.2, high52: 50 }), on, NOW);
    expect(hi.map((a) => a.level)).toEqual(["high52"]);
    const lo = decideAlerts(quote({ changePct: -1, price: 29.9, low52: 30 }), on, NOW);
    expect(lo.map((a) => a.level)).toEqual(["low52"]);
    expect(decideAlerts(quote({ changePct: 1, price: 50.2, high52: 50 }), { ...on, hiLo: false }, NOW)).toEqual([]);
    expect(decideAlerts(quote({ changePct: 1, price: 50.2, high52: 50 }), on, NOW, new Set(["high52:up"]))).toEqual([]);
  });
});

describe("dedupe key", () => {
  it("uses the exchange-local trading day", () => {
    // 2026-11-24 23:30 UTC is already 25 Nov in Sydney but still 24 Nov in New York
    const t = Date.UTC(2026, 10, 24, 23, 30);
    expect(tradingDay("BHP.AX", t)).toBe("2026-11-25");
    expect(tradingDay("AAPL", t)).toBe("2026-11-24");
    expect(sentKey("u1", "BHP.AX", "move:up", "2026-11-25")).toBe("alerts:sent:u1:BHP.AX:move:up:2026-11-25");
  });
});
