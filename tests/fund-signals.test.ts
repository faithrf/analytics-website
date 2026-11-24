import { describe, expect, it } from "vitest";
import type { MBar } from "@/lib/model";
import {
  classifyChange,
  csvLine,
  dateMs,
  diff13F,
  diffSnapshots,
  excessReturn,
  fwdReturn,
  isLikelySplit,
  isSignificant,
  lastBarOnOrBefore,
  monthlyCurve,
  normName,
  parseArkCsv,
  parseInfoTable,
  testedSummary,
  valueUsd,
} from "@/lib/fund-signals";

const D = 86_400_000;
const bars = (n: number, start = "2026-01-05", px = (i: number) => 100 + i): MBar[] =>
  Array.from({ length: n }, (_, i) => ({ t: dateMs(start) + i * D, open: px(i), high: px(i) + 1, low: px(i) - 1, close: px(i) + 0.5 }));

describe("classifyChange", () => {
  it("labels new, exit, big increase and big trim only", () => {
    expect(classifyChange(0, 100)).toBe("new");
    expect(classifyChange(100, 0)).toBe("exit");
    expect(classifyChange(100, 150)).toBe("increase");
    expect(classifyChange(100, 149)).toBeNull();
    expect(classifyChange(100, 50)).toBe("trim");
    expect(classifyChange(100, 51)).toBeNull();
    expect(classifyChange(0, 0)).toBeNull();
  });
});

describe("parseInfoTable", () => {
  const xml = (rows: string) => `<informationTable xmlns="x">${rows}</informationTable>`;
  const row = (name: string, cls: string, cusip: string, v: number, sh: number, extra = "", type = "SH") =>
    `<infoTable><nameOfIssuer>${name}</nameOfIssuer><titleOfClass>${cls}</titleOfClass><cusip>${cusip}</cusip><value>${v}</value><shrsOrPrnAmt><sshPrnamt>${sh}</sshPrnamt><sshPrnamtType>${type}</sshPrnamtType></shrsOrPrnAmt>${extra}</infoTable>`;

  it("sums lines of one CUSIP and drops options, notes and principal amounts", () => {
    const h = parseInfoTable(
      xml(
        row("APPLE INC", "COM", "037833100", 1000, 10) +
          row("APPLE INC", "COM", "037833100", 500, 5) +
          row("APPLE INC", "COM", "037833100", 900, 9, "<putCall>Put</putCall>") +
          row("ACME", "NOTE 1.0% 2030", "111", 10, 10) +
          row("BOND CO", "COM", "222", 10, 10, "", "PRN"),
      ),
    );
    expect(h).toEqual([{ cusip: "037833100", name: "APPLE INC", shares: 15, value: 1500 }]);
  });

  it("reads namespace-prefixed tags and decodes entities", () => {
    const h = parseInfoTable(`<ns1:infoTable><ns1:nameOfIssuer>AT&amp;T INC</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>00206R102</ns1:cusip><ns1:value>7</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>1,000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt></ns1:infoTable>`);
    expect(h[0]).toMatchObject({ name: "AT&T INC", shares: 1000 });
  });
});

describe("13F values and names", () => {
  it("treats pre-2023 values as thousands", () => {
    expect(valueUsd(5, "2022-11-14")).toBe(5000);
    expect(valueUsd(5, "2023-02-14")).toBe(5);
  });
  it("normalises issuer names across forms", () => {
    expect(normName("Apple Inc.")).toBe(normName("APPLE INC"));
    expect(normName("Alphabet Inc. Class A")).toBe(normName("ALPHABET INC CL A"));
    expect(normName("Berkshire Hathaway Inc")).toBe("BERKSHIRE HATHAWAY");
  });
});

describe("diff13F", () => {
  const h = (cusip: string, shares: number, value = shares * 10) => ({ cusip, name: cusip, shares, value });
  it("finds the four event types and skips small moves", () => {
    const out = diff13F([h("A", 100), h("B", 100), h("C", 100), h("D", 100)], [h("A", 200), h("B", 40), h("D", 110), h("E", 5)]);
    const by = Object.fromEntries(out.map((c) => [c.cusip, c.type]));
    expect(by).toEqual({ A: "increase", B: "trim", C: "exit", E: "new" });
  });
  it("ignores a 2-for-1 split (shares double, value flat)", () => {
    expect(isLikelySplit({ shares: 100, value: 1000 }, { shares: 200, value: 1010 })).toBe(true);
    expect(isLikelySplit({ shares: 100, value: 1000 }, { shares: 200, value: 2000 })).toBe(false);
    expect(diff13F([h("A", 100, 1000)], [h("A", 200, 1000)])).toEqual([]);
  });
});

describe("ARK CSV and snapshot diff", () => {
  const csv = `date,fund,company,ticker,cusip,shares,market value ($),weight (%)
11/20/2026,ARKK,TESLA INC,TSLA,88160R101,"6,179,930","$2,313,827,591.30",12.90%
11/20/2026,ARKK,GOLDMAN FS TRSY,,X9USDGSFT,"1,158,702,366","$1,158,702,365.88",6.46%
11/20/2026,ARKK,ROKU INC,ROKU,77543R102,"1,000","$100.00",1.00%
`;
  it("parses quoted numbers, drops rows without a ticker", () => {
    const s = parseArkCsv(csv)!;
    expect(s).toMatchObject({ fund: "ARKK", date: "2026-11-20" });
    expect(s.rows).toEqual([
      { t: "TSLA", s: 6179930, w: 12.9 },
      { t: "ROKU", s: 1000, w: 1 },
    ]);
    expect(parseArkCsv("<html>")).toBeNull();
    expect(csvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });
  it("derives buy, add, trim and sell, ignoring rounding and splits", () => {
    const row = (t: string, s: number, w: number) => ({ t, s, w });
    const prev = { fund: "ARKK", date: "2026-11-19", rows: [row("A", 100, 1), row("B", 100, 1), row("C", 100, 1), row("D", 100, 1), row("E", 100, 1), row("F", 100, 1)] };
    const cur = { fund: "ARKK", date: "2026-11-20", rows: [row("A", 120, 1.2), row("B", 80, 0.8), row("C", 100.2, 1), row("E", 200, 1.02), row("G", 50, 0.5), row("F", 100, 1)] };
    const t = Object.fromEntries(diffSnapshots(prev, cur).map((x) => [x.sym, x.action]));
    expect(t).toEqual({ A: "add", B: "trim", D: "sell", G: "buy" });
  });
});

describe("returns", () => {
  it("finds the last bar on or before a date", () => {
    const b = bars(10);
    expect(lastBarOnOrBefore(b, dateMs("2026-01-07"))).toBe(2);
    expect(lastBarOnOrBefore(b, dateMs("2026-01-01"))).toBe(-1);
    expect(lastBarOnOrBefore(b, dateMs("2027-01-01"))).toBe(9);
  });
  it("measures from the open of the entry bar to the close h-1 bars later", () => {
    const b = bars(10, "2026-01-05", () => 100);
    b[3].open = 100;
    b[3].close = 110;
    expect(fwdReturn(b, 3, 1)).toBeCloseTo(10);
    expect(fwdReturn(b, 9, 5)).toBeNull();
  });
  it("enters the day after the filing date and subtracts the market", () => {
    const stock = bars(10, "2026-01-05", (i) => 100 + i * 2);
    const mkt = bars(10, "2026-01-05", () => 100);
    // filed on bar 2, entry bar 3 (open 106), 1-day close 106.5
    const r = excessReturn(stock, mkt, dateMs("2026-01-07"), 1)!;
    expect(r.ret).toBeCloseTo((106.5 / 106 - 1) * 100);
    expect(r.ex).toBeCloseTo(r.ret - 0.5);
    expect(excessReturn(stock, mkt, dateMs("2026-02-01"), 1)).toBeNull();
  });
});

describe("significance and curve", () => {
  it("needs n >= 30 and |t| >= 2", () => {
    expect(isSignificant({ n: 29, t: 5 })).toBe(false);
    expect(isSignificant({ n: 30, t: 1.9 })).toBe(false);
    expect(isSignificant({ n: 30, t: -2.1 })).toBe(true);
  });
  it("counts cells tested and expected false positives", () => {
    const c = (n: number, t: number) => ({ f: "ALL", k: "new", h: 1 as const, n, m: 0, hit: 50, t });
    expect(testedSummary([c(10, 9), c(40, 3), c(50, 0.1)])).toEqual({ cells: 3, testable: 2, flagged: 1, expectedByChance: 0.1 });
  });
  it("accumulates $100-per-trade profit by month", () => {
    const c = monthlyCurve([
      { exitMs: dateMs("2026-02-10"), ret: 5, mkt: 1 },
      { exitMs: dateMs("2026-01-10"), ret: -2, mkt: 1 },
      { exitMs: dateMs("2026-01-20"), ret: 4, mkt: 0 },
    ]);
    expect(c).toEqual([
      { d: "2026-01", rule: 2, mkt: 1 },
      { d: "2026-02", rule: 7, mkt: 2 },
    ]);
  });
});
