import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseForm4, parseEdgarAtom, parseHouseIndex, unzipEntry, mapBargo, parsePeriod } = await import("@/lib/leaders");
const { delayDays, delayLabel, delayTone, isFresh } = await import("@/lib/leaders-shared");

const FORM4 = `<SEC-DOCUMENT><XML><ownershipDocument>
<issuer><issuerCik>1</issuerCik><issuerName>ACME &amp; Co</issuerName><issuerTradingSymbol>acme</issuerTradingSymbol></issuer>
<reportingOwner><reportingOwnerId><rptOwnerName>DOE JANE</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>Chief Financial Officer</officerTitle></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable>
<nonDerivativeTransaction><transactionDate><value>2026-10-27</value></transactionDate><transactionCoding><transactionCode>P</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>10.5</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionDate><value>2026-10-27</value></transactionDate><transactionCoding><transactionCode>P</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>500</value></transactionShares><transactionPricePerShare><value>10.5</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionDate><value>2026-10-28</value></transactionDate><transactionCoding><transactionCode>G</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>200</value></transactionShares></transactionAmounts></nonDerivativeTransaction>
</nonDerivativeTable></ownershipDocument></XML></SEC-DOCUMENT>`;

describe("Form 4", () => {
  it("parses owner, issuer and merges same-day lines", () => {
    const rows = parseForm4(FORM4, { accession: "0000000001-26-000001", url: "u", filed: "2026-10-29", filedAt: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ who: "Doe Jane", sub: "Chief Financial Officer", ticker: "ACME", company: "ACME & Co", code: "P", side: "buy", traded: "2026-10-27" });
    expect(rows[0].size).toBe("1,500 sh @ $10.50 = $15.8K");
    expect(rows[1]).toMatchObject({ code: "G", side: "other", action: "Gift" });
  });
});

describe("EDGAR atom", () => {
  it("reads entries", () => {
    const xml = `<feed><entry><title>4 - ACME CORP (0001234567) (Issuer)</title><link rel="alternate" href="https://www.sec.gov/Archives/edgar/data/1/2/0000000001-26-000001-index.htm"/><updated>2026-10-29T16:25:12-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000001</id></entry></feed>`;
    expect(parseEdgarAtom(xml)).toEqual([
      expect.objectContaining({ accession: "0000000001-26-000001", form: "4", name: "ACME CORP", role: "Issuer", updated: "2026-10-29T16:25:12-04:00" }),
    ]);
  });
  it("reads the period of report", () => {
    expect(parsePeriod(`<div class="infoHead">Period of Report</div>\n<div class="info">2026-10-20</div>`)).toBe("2026-10-20");
  });
});

describe("House index", () => {
  const xml = `<FinancialDisclosure>
<Member><Prefix>Hon.</Prefix><Last>Roe</Last><First>Rae</First><Suffix /><FilingType>P</FilingType><StateDst>CA11</StateDst><Year>2026</Year><FilingDate>10/29/2026</FilingDate><DocID>20033</DocID></Member>
<Member><Last>Old</Last><First>Al</First><FilingType>P</FilingType><StateDst>TX01</StateDst><Year>2026</Year><FilingDate>9/1/2026</FilingDate><DocID>1</DocID></Member>
<Member><Last>Ann</Last><First>Al</First><FilingType>C</FilingType><StateDst>TX01</StateDst><Year>2026</Year><FilingDate>10/29/2026</FilingDate><DocID>2</DocID></Member></FinancialDisclosure>`;
  it("keeps recent type-P filings with a PDF link", () => {
    expect(parseHouseIndex(xml, "2026-10-27")).toEqual([
      { id: "20033", name: "Hon. Rae Roe", state: "CA11", filed: "2026-10-29", url: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20033.pdf" },
    ]);
  });
  it("unzips a deflated entry", () => {
    const name = Buffer.from("2026FD.xml");
    const body = Buffer.from(`﻿${xml}`);
    const data = deflateRawSync(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(0, 42);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(local.length + name.length + data.length, 16);
    const zip = Buffer.concat([local, name, data, cd, name, eocd]);
    expect(unzipEntry(zip, "2026FD.xml")).toBe(xml);
    expect(unzipEntry(zip, "missing.xml")).toBeNull();
  });
});

describe("Bargo mapping and delay", () => {
  it("maps trades and computes delay", () => {
    const rows = mapBargo({
      trades: [{ member: "Kevin Hern", member_slug: "kevin-hern", chamber: "house", state: "OK01", ticker: "STX", asset: "Seagate", type: "sale", amount_range: "$15,001 - $50,000", transaction_date: "2026-10-23", disclosure_date: "2026-10-28", filing_portal: "https://disclosures-clerk.house.gov/FinancialDisclosure" }, { member: "", disclosure_date: "x" }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ who: "Kevin Hern", sub: "House · OK01", side: "sell", action: "Sale", ticker: "STX" });
    expect(delayDays(rows[0].traded, rows[0].filed)).toBe(5);
  });
});

describe("delay pill buckets", () => {
  it("labels and colours", () => {
    expect(delayLabel(0)).toBe("same day");
    expect(delayLabel(1)).toBe("1 day");
    expect(delayLabel(12)).toBe("12 days");
    expect(delayLabel(null)).toBe("unknown");
    expect([0, 2, 3, 10, 11].map((d) => delayTone(d))).toEqual(["good", "good", "warn", "warn", "bad"]);
    expect(delayTone(null)).toBeNull();
    expect(isFresh(3)).toBe(true);
    expect(isFresh(4)).toBe(false);
    expect(isFresh(null)).toBe(false);
    expect(delayDays("2026-10-30", "2026-10-30")).toBe(0);
    expect(delayDays(null, "2026-10-30")).toBeNull();
  });
});

describe("rolling window", async () => {
  const { mergeRows, withinDays, applyRange, weekIncomplete } = await import("@/lib/leaders-shared");
  const DAY = 86_400_000;
  const now = Date.parse("2026-11-01T12:00:00Z");
  const row = (id: string, daysAgo: number) => ({
    id,
    who: "x",
    action: "Buy",
    side: "buy" as const,
    traded: null,
    filed: new Date(now - daysAgo * DAY).toISOString().slice(0, 10),
    filedAt: now - daysAgo * DAY,
    url: "u",
  });

  it("dedupes by id across refreshes, newest first", () => {
    const store = new Map();
    mergeRows(store, [row("a", 2), row("b", 1)], now);
    const out = mergeRows(store, [row("b", 1), row("c", 0)], now);
    expect(out.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
  it("prunes rows filed over 8 days ago", () => {
    const store = new Map();
    const out = mergeRows(store, [row("old", 9), row("edge", 7.5), row("new", 1)], now);
    expect(out.map((r) => r.id)).toEqual(["new", "edge"]);
    expect(mergeRows(store, [], now + 2 * DAY).map((r) => r.id)).toEqual(["new"]);
  });
  it("week filter keeps 7 days and sorts newest filed first", () => {
    const rows = [row("d6", 6), row("d8", 7.5), row("d1", 1), row("d0", 0)];
    expect(withinDays(rows, 7, now).map((r) => r.id)).toEqual(["d6", "d1", "d0"]);
    expect(applyRange(rows, "week", "congress", now).map((r) => r.id)).toEqual(["d0", "d1", "d6"]);
  });
  it("latest keeps only the newest N", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`r${i}`, i / 10));
    const out = applyRange(rows, "latest", "congress", now);
    expect(out).toHaveLength(20);
    expect(out[0].id).toBe("r0");
  });
  it("date-only rows use start of the filed day", () => {
    const r = { ...row("z", 0), filedAt: null, filed: "2026-10-26" };
    expect(withinDays([r], 7, now)).toHaveLength(1);
    expect(withinDays([{ ...r, filed: "2026-10-24" }], 7, now)).toHaveLength(0);
  });
  it("flags an incomplete week", () => {
    expect(weekIncomplete(now - DAY, now)).toBe(true);
    expect(weekIncomplete(now - 8 * DAY, now)).toBe(false);
  });
});
