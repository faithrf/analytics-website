import { describe, expect, it } from "vitest";
import { easterSunday, getMarketStatus, holidayName, isMarketOpen, nextTransition, sydneyClock } from "@/lib/market-hours";

const d = (iso: string) => new Date(iso);

describe("isMarketOpen (AEDT, UTC+11, Oct-Apr)", () => {
  it("is closed one minute before 10:00 and open at 10:00", () => {
    // Tue 2026-01-13 10:00 AEDT = 2026-01-12T23:00Z
    expect(isMarketOpen(d("2026-01-12T22:59:00Z"))).toBe(false);
    expect(isMarketOpen(d("2026-01-12T23:00:00Z"))).toBe(true);
  });
  it("is open at 15:59 and closed at 16:00", () => {
    expect(isMarketOpen(d("2026-01-13T04:59:00Z"))).toBe(true);
    expect(isMarketOpen(d("2026-01-13T05:00:00Z"))).toBe(false);
  });
});

describe("isMarketOpen (AEST, UTC+10, Apr-Oct)", () => {
  it("opens at 10:00 AEST = 00:00Z", () => {
    expect(isMarketOpen(d("2026-07-15T23:59:00Z"))).toBe(false); // Wed 09:59 AEST
    expect(isMarketOpen(d("2026-07-16T00:00:00Z"))).toBe(true); // Thu 10:00 AEST
  });
  it("closes at 16:00 AEST = 06:00Z", () => {
    expect(isMarketOpen(d("2026-07-16T05:59:00Z"))).toBe(true);
    expect(isMarketOpen(d("2026-07-16T06:00:00Z"))).toBe(false);
  });
});

describe("weekends", () => {
  it("is closed all day Saturday and Sunday in Sydney", () => {
    expect(isMarketOpen(d("2026-07-18T02:00:00Z"))).toBe(false); // Sat 12:00 AEST
    expect(isMarketOpen(d("2026-07-19T02:00:00Z"))).toBe(false); // Sun 12:00 AEST
  });
  it("uses the Sydney weekday, not the UTC weekday", () => {
    // Fri 2026-07-17 23:00Z is already Sat 09:00 in Sydney -> closed
    expect(isMarketOpen(d("2026-07-17T23:30:00Z"))).toBe(false);
    // Sun 2026-07-19 23:30Z is Mon 09:30 in Sydney -> still before open
    expect(isMarketOpen(d("2026-07-19T23:30:00Z"))).toBe(false);
    // Mon 10:00 AEST = Sun 2026-07-20T00:00Z -> open even though UTC says Sunday
    expect(isMarketOpen(d("2026-07-20T00:00:00Z"))).toBe(true);
  });
});

describe("DST edges", () => {
  it("DST starts Sun 2026-10-04 (02:00 AEST -> 03:00 AEDT)", () => {
    expect(sydneyClock(d("2026-10-03T15:59:00Z")).minutes).toBe(1 * 60 + 59); // 01:59 AEST
    expect(sydneyClock(d("2026-10-03T16:00:00Z")).minutes).toBe(3 * 60); // 03:00 AEDT
    // Friday 2026-10-02 close: 16:00 AEST = 06:00Z
    expect(isMarketOpen(d("2026-10-02T05:59:00Z"))).toBe(true);
    expect(isMarketOpen(d("2026-10-02T06:00:00Z"))).toBe(false);
    // Monday 2026-10-05 open: 10:00 AEDT = 2026-10-04T23:00Z (one hour earlier in UTC)
    expect(isMarketOpen(d("2026-10-04T22:59:00Z"))).toBe(false);
    expect(isMarketOpen(d("2026-10-04T23:00:00Z"))).toBe(true);
    // 00:00Z Monday is now 11:00 AEDT, still open
    expect(isMarketOpen(d("2026-10-05T00:00:00Z"))).toBe(true);
  });
  it("DST ends Sun 2026-04-05 (03:00 AEDT -> 02:00 AEST)", () => {
    // Thursday 2026-04-02 still AEDT (Good Friday is the 3rd): open 10:00 = 2026-04-01T23:00Z
    expect(isMarketOpen(d("2026-04-01T22:59:00Z"))).toBe(false);
    expect(isMarketOpen(d("2026-04-01T23:00:00Z"))).toBe(true);
    // Tuesday 2026-04-07 on AEST (Easter Monday is the 6th): open 10:00 = 2026-04-07T00:00Z
    expect(isMarketOpen(d("2026-04-06T23:59:00Z"))).toBe(false); // 09:59 AEST
    expect(isMarketOpen(d("2026-04-07T00:00:00Z"))).toBe(true);
    expect(isMarketOpen(d("2026-04-07T05:59:00Z"))).toBe(true);
    expect(isMarketOpen(d("2026-04-07T06:00:00Z"))).toBe(false);
  });
});

describe("nextTransition / getMarketStatus", () => {
  it("finds the next open across a weekend", () => {
    const fri = d("2026-07-17T07:00:00Z"); // Fri 17:00 AEST, closed
    expect(nextTransition(fri).toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });
  it("finds the next close while open", () => {
    const wed = d("2026-07-15T01:20:00Z"); // Wed 11:20 AEST
    expect(nextTransition(wed).toISOString()).toBe("2026-07-15T06:00:00.000Z");
  });
  it("crosses DST when looking for the next open", () => {
    const sat = d("2026-10-03T03:00:00Z"); // Sat 13:00 AEST, DST starts overnight
    expect(nextTransition(sat).toISOString()).toBe("2026-10-04T23:00:00.000Z");
  });
  it("labels with the Sydney zone abbreviation", () => {
    const open = getMarketStatus(d("2026-01-13T01:00:00Z"));
    expect(open.open).toBe(true);
    expect(open.label).toMatch(/^Closes 16:00/);
    const closed = getMarketStatus(d("2026-07-18T02:00:00Z"));
    expect(closed.open).toBe(false);
    expect(closed.label).toMatch(/^Opens Mon,? 10:00/);
  });
});

describe("easterSunday", () => {
  it("computes known dates", () => {
    expect(easterSunday(2026)).toEqual([4, 5]);
    expect(easterSunday(2027)).toEqual([3, 28]);
    expect(easterSunday(2024)).toEqual([3, 31]);
  });
});

describe("holidays 2026", () => {
  const h = (m: number, day: number) => holidayName(2026, m, day);
  it("lists the national closures", () => {
    expect(h(1, 1)).toBe("New Year's Day"); // Thu
    expect(h(1, 26)).toBe("Australia Day"); // Mon
    expect(h(4, 3)).toBe("Good Friday");
    expect(h(4, 6)).toBe("Easter Monday");
    expect(h(6, 8)).toBe("King's Birthday");
    expect(h(12, 25)).toBe("Christmas Day"); // Fri
  });
  it("has no Anzac Day substitute when it falls on a Saturday", () => {
    expect(h(4, 27)).toBeNull();
  });
  it("moves Boxing Day (Sat) to Monday 28 Dec", () => {
    expect(h(12, 28)).toBe("Boxing Day");
    expect(h(12, 26)).toBeNull();
  });
  it("closes the market on a holiday and says why", () => {
    const goodFriday = d("2026-04-03T01:00:00Z"); // Fri 12:00 AEDT
    expect(isMarketOpen(goodFriday)).toBe(false);
    const s = getMarketStatus(goodFriday);
    expect(s.holiday).toBe("Good Friday");
    expect(s.label).toMatch(/^Closed \u2014 Good Friday/);
  });
  it("reopens the Tuesday after Easter Monday", () => {
    expect(isMarketOpen(d("2026-04-06T01:00:00Z"))).toBe(false); // Easter Monday
    expect(isMarketOpen(d("2026-04-07T01:00:00Z"))).toBe(true); // Tue 11:00 AEST
  });
});

describe("holidays 2027", () => {
  const h = (m: number, day: number) => holidayName(2027, m, day);
  it("lists the national closures", () => {
    expect(h(1, 1)).toBe("New Year's Day"); // Fri
    expect(h(1, 26)).toBe("Australia Day"); // Tue
    expect(h(3, 26)).toBe("Good Friday");
    expect(h(3, 29)).toBe("Easter Monday");
    expect(h(6, 14)).toBe("King's Birthday");
  });
  it("moves Christmas (Sat) and Boxing Day (Sun) to Mon 27 and Tue 28 Dec", () => {
    expect(h(12, 27)).toBe("Christmas Day");
    expect(h(12, 28)).toBe("Boxing Day");
  });
  it("has no substitute for Anzac Day on a Sunday", () => {
    expect(h(4, 26)).toBeNull();
  });
  it("moves a weekend New Year's Day / Australia Day to Monday", () => {
    expect(holidayName(2028, 1, 3)).toBe("New Year's Day"); // 1 Jan 2028 is Sat
    expect(holidayName(2027, 1, 25)).toBeNull();
    expect(holidayName(2026, 12, 26)).toBeNull();
  });
});

describe("early close 14:10 on Christmas Eve and New Year's Eve", () => {
  it("2026-12-24 (Thu) closes at 14:10 AEDT", () => {
    expect(isMarketOpen(d("2026-12-24T03:09:00Z"))).toBe(true);
    expect(isMarketOpen(d("2026-12-24T03:10:00Z"))).toBe(false);
  });
  it("2026-12-31 (Thu) closes at 14:10 AEDT", () => {
    expect(isMarketOpen(d("2026-12-31T03:09:00Z"))).toBe(true);
    expect(isMarketOpen(d("2026-12-31T03:10:00Z"))).toBe(false);
  });
  it("2027-12-24 and 2027-12-31 (Fridays) close at 14:10", () => {
    expect(isMarketOpen(d("2027-12-24T03:09:00Z"))).toBe(true);
    expect(isMarketOpen(d("2027-12-24T03:10:00Z"))).toBe(false);
    expect(isMarketOpen(d("2027-12-31T03:09:00Z"))).toBe(true);
    expect(isMarketOpen(d("2027-12-31T03:10:00Z"))).toBe(false);
  });
  it("next close is reported as 14:10", () => {
    expect(nextTransition(d("2026-12-24T01:00:00Z")).toISOString()).toBe("2026-12-24T03:10:00.000Z");
  });
});

describe("other markets", () => {
  it("follows New York hours across US daylight saving", () => {
    // Thu 2026-10-29 09:30 EDT = 13:30Z
    expect(isMarketOpen(d("2026-10-29T13:29:00Z"), "us")).toBe(false);
    expect(isMarketOpen(d("2026-10-29T13:30:00Z"), "us")).toBe(true);
    // Thu 2026-11-12 09:30 EST = 14:30Z
    expect(isMarketOpen(d("2026-11-12T14:00:00Z"), "us")).toBe(false);
    expect(isMarketOpen(d("2026-11-12T20:59:00Z"), "us")).toBe(true);
    expect(isMarketOpen(d("2026-11-12T21:00:00Z"), "us")).toBe(false);
  });
  it("closes for the Tokyo and Hong Kong lunch breaks", () => {
    // Thu 2026-10-29 11:45 JST = 02:45Z; 13:00 JST = 04:00Z
    expect(isMarketOpen(d("2026-10-29T02:45:00Z"), "jp")).toBe(false);
    expect(isMarketOpen(d("2026-10-29T04:00:00Z"), "jp")).toBe(true);
    // 12:30 HKT = 04:30Z; 13:00 HKT = 05:00Z
    expect(isMarketOpen(d("2026-10-29T04:30:00Z"), "hk")).toBe(false);
    expect(isMarketOpen(d("2026-10-29T05:00:00Z"), "hk")).toBe(true);
  });
  it("is closed at weekends and labels times in the market's zone", () => {
    expect(isMarketOpen(d("2026-10-31T12:00:00Z"), "uk")).toBe(false); // Saturday
    const s = getMarketStatus(d("2026-10-29T13:00:00Z"), "us"); // 09:00 EDT
    expect(s.open).toBe(false);
    expect(s.label).toBe("Opens 09:30 EDT");
    expect(s.holiday).toBeNull();
    expect(getMarketStatus(d("2026-10-29T03:00:00Z"), "jp").label).toBe("Opens 12:30 JST");
  });
});
