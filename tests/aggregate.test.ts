import { describe, expect, it } from "vitest";
import { MIN_ACTIVE_VOLUME, calcChange, rankMovers, sectorAverages, type Constituent, type MoverRow } from "@/lib/aggregate";
import { direction, fmtPct, fmtSigned } from "@/lib/format";
import { keepLastSessions } from "@/lib/ranges";
import { parseWatchlist } from "@/lib/watchlist";

describe("calcChange", () => {
  it("computes change and percent", () => {
    const r = calcChange(110, 100);
    expect(r.change).toBeCloseTo(10);
    expect(r.changePct).toBeCloseTo(10);
    expect(calcChange(90, 120).changePct).toBeCloseTo(-25);
  });
  it("returns nulls for missing or zero previous close", () => {
    expect(calcChange(null, 100)).toEqual({ change: null, changePct: null });
    expect(calcChange(100, 0)).toEqual({ change: null, changePct: null });
    expect(calcChange(100, undefined)).toEqual({ change: null, changePct: null });
  });
});

const constituents: Constituent[] = [
  { code: "AAA", name: "A", sector: "Materials" },
  { code: "BBB", name: "B", sector: "Materials" },
  { code: "CCC", name: "C", sector: "Financials" },
];

describe("sectorAverages", () => {
  it("averages % change per sector, skipping nulls and unknown codes", () => {
    const out = sectorAverages(
      [
        { code: "AAA", changePct: 2 },
        { code: "BBB", changePct: -1 },
        { code: "CCC", changePct: 0.25 },
        { code: "ZZZ", changePct: 99 },
        { code: "AAA", changePct: null },
      ],
      constituents,
    );
    expect(out).toEqual([
      { sector: "Materials", avgPct: 0.5, count: 2 },
      { sector: "Financials", avgPct: 0.25, count: 1 },
    ]);
  });
  it("sorts best sector first", () => {
    const out = sectorAverages([{ code: "AAA", changePct: -3 }, { code: "CCC", changePct: 1 }], constituents);
    expect(out.map((s) => s.sector)).toEqual(["Financials", "Materials"]);
  });
});

describe("rankMovers", () => {
  const row = (code: string, changePct: number | null, volume: number | null): MoverRow => ({
    code,
    name: code,
    price: 1,
    change: null,
    changePct,
    volume,
  });
  const rows = [
    row("A", 3, 20_000),
    row("B", -4, 50_000),
    row("C", 1, 30_000),
    row("D", null, 99_000),
    row("E", 0, 5_000),
  ];
  it("ranks gainers, excluding zero and null", () => {
    expect(rankMovers(rows, "gainers").map((r) => r.code)).toEqual(["A", "C"]);
  });
  it("ranks losers most negative first", () => {
    expect(rankMovers(rows, "losers").map((r) => r.code)).toEqual(["B"]);
  });
  it("ranks most active by volume and respects the limit", () => {
    expect(rankMovers(rows, "active", 2).map((r) => r.code)).toEqual(["D", "B"]);
  });
  it("ranks most active by traded value (price x volume), not share count", () => {
    const r = [
      { ...row("PENNY", 1, 5_000_000), price: 0.1 }, // $500k
      { ...row("BLUE", 1, 100_000), price: 50 }, // $5m
    ];
    expect(rankMovers(r, "active").map((x) => x.code)).toEqual(["BLUE", "PENNY"]);
  });
  it("excludes tiny-volume lines such as a dual-listed stock trading 96 shares", () => {
    const r = [{ ...row("MCY", 1, 96), price: 5000 }, row("OK", 1, MIN_ACTIVE_VOLUME)];
    expect(rankMovers(r, "active").map((x) => x.code)).toEqual(["OK"]);
  });
});

describe("formatting", () => {
  it("uses explicit signs and a true minus", () => {
    expect(fmtSigned(1.234)).toBe("+1.23");
    expect(fmtSigned(-1.234)).toBe("−1.23");
    expect(fmtSigned(0.001)).toBe("0.00");
    expect(fmtPct(-0.5)).toBe("−0.50%");
    expect(fmtPct(null)).toBe("—");
  });
  it("treats rounding-to-zero as flat", () => {
    expect(direction(0.004)).toBe("flat");
    expect(direction(-2)).toBe("down");
    expect(direction(2)).toBe("up");
  });
});

describe("keepLastSessions", () => {
  it("keeps only points from the last N Sydney days", () => {
    const pts = [
      { t: Date.parse("2026-07-14T01:00:00Z") },
      { t: Date.parse("2026-07-15T01:00:00Z") },
      { t: Date.parse("2026-07-15T02:00:00Z") },
      { t: Date.parse("2026-07-16T01:00:00Z") },
    ];
    expect(keepLastSessions(pts, 1)).toHaveLength(1);
    expect(keepLastSessions(pts, 2)).toHaveLength(3);
  });
});

describe("parseWatchlist", () => {
  it("accepts valid codes, drops junk and duplicates", () => {
    expect(parseWatchlist('["BHP","CBA","BHP","bad code",5]')).toEqual(["BHP", "CBA"]);
  });
  it("survives bad input", () => {
    expect(parseWatchlist(null)).toEqual([]);
    expect(parseWatchlist("{not json")).toEqual([]);
    expect(parseWatchlist('{"a":1}')).toEqual([]);
  });
});
