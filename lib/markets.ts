/**
 * Markets the dashboard covers. Pure data, safe on client and server.
 * Trading hours are the regular continuous session in local time, weekdays only.
 */
export type RegionId = "au" | "us" | "uk" | "eu" | "jp" | "hk";

export interface Region {
  id: RegionId;
  /** tab label */
  label: string;
  /** short exchange name for the open/closed badge */
  exchange: string;
  /** what the movers list covers */
  listName: string;
  currency: string;
  tz: string;
  /** locale whose short zone name reads well, e.g. "EDT", "HKT" */
  zoneLocale: string;
  open: number;
  close: number;
  /** midday break, in minutes */
  lunch?: [number, number];
  tiles: { symbol: string; label: string }[];
}

const hm = (h: number, m = 0) => h * 60 + m;

export const REGIONS: Region[] = [
  {
    id: "au",
    label: "ASX",
    exchange: "ASX",
    listName: "ASX 200",
    currency: "AUD",
    tz: "Australia/Sydney",
    zoneLocale: "en-AU",
    open: hm(10),
    close: hm(16),
    tiles: [
      { symbol: "^AXJO", label: "ASX 200" },
      { symbol: "^AORD", label: "All Ordinaries" },
      { symbol: "AUDUSD=X", label: "AUD/USD" },
    ],
  },
  {
    id: "us",
    label: "US",
    exchange: "NYSE/Nasdaq",
    listName: "US large-cap",
    currency: "USD",
    tz: "America/New_York",
    zoneLocale: "en-US",
    open: hm(9, 30),
    close: hm(16),
    tiles: [
      { symbol: "^GSPC", label: "S&P 500" },
      { symbol: "^IXIC", label: "Nasdaq Composite" },
      { symbol: "^DJI", label: "Dow Jones" },
    ],
  },
  {
    id: "uk",
    label: "UK",
    exchange: "LSE",
    listName: "UK large-cap",
    currency: "GBP",
    tz: "Europe/London",
    zoneLocale: "en-GB",
    open: hm(8),
    close: hm(16, 30),
    tiles: [
      { symbol: "^FTSE", label: "FTSE 100" },
      { symbol: "^FTMC", label: "FTSE 250" },
      { symbol: "GBPUSD=X", label: "GBP/USD" },
    ],
  },
  {
    id: "eu",
    label: "Europe",
    exchange: "Xetra/Euronext",
    listName: "European large-cap",
    currency: "EUR",
    tz: "Europe/Berlin",
    zoneLocale: "en-GB",
    open: hm(9),
    close: hm(17, 30),
    tiles: [
      { symbol: "^STOXX50E", label: "Euro Stoxx 50" },
      { symbol: "^GDAXI", label: "DAX" },
      { symbol: "^FCHI", label: "CAC 40" },
    ],
  },
  {
    id: "jp",
    label: "Japan",
    exchange: "Tokyo",
    listName: "Japan large-cap",
    currency: "JPY",
    tz: "Asia/Tokyo",
    zoneLocale: "ja-JP",
    open: hm(9),
    close: hm(15, 30),
    lunch: [hm(11, 30), hm(12, 30)],
    tiles: [
      { symbol: "^N225", label: "Nikkei 225" },
      { symbol: "JPY=X", label: "USD/JPY" },
      { symbol: "AUDJPY=X", label: "AUD/JPY" },
    ],
  },
  {
    id: "hk",
    label: "Hong Kong",
    exchange: "HKEX",
    listName: "Hong Kong large-cap",
    currency: "HKD",
    tz: "Asia/Hong_Kong",
    zoneLocale: "en-HK",
    open: hm(9, 30),
    close: hm(16),
    lunch: [hm(12), hm(13)],
    tiles: [
      { symbol: "^HSI", label: "Hang Seng" },
      { symbol: "^HSCE", label: "HS China Enterprises" },
      { symbol: "000001.SS", label: "Shanghai Composite" },
    ],
  },
];

export const REGION_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

export function isRegion(v: unknown): v is RegionId {
  return typeof v === "string" && REGION_BY_ID.has(v as RegionId);
}

export const region = (id: RegionId): Region => REGION_BY_ID.get(id)!;

/** Search terms behind each market's headline feed on the News page. */
export const NEWS_TERMS: Record<RegionId, string[]> = {
  au: ["ASX 200", "Australian shares"],
  us: ["Wall Street", "S&P 500"],
  uk: ["FTSE 100"],
  eu: ["DAX", "European stocks"],
  jp: ["Nikkei"],
  hk: ["Hang Seng"],
};

/** Cross-market gauges shown beside each market's main index on the News page. */
export const GLOBAL_GAUGES = [
  { symbol: "GC=F", label: "Gold" },
  { symbol: "CL=F", label: "Crude oil" },
  { symbol: "^TNX", label: "US 10-year yield" },
  { symbol: "^VIX", label: "VIX" },
  { symbol: "BTC-USD", label: "Bitcoin" },
];
