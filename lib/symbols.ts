import type { RegionId } from "@/lib/markets";

/**
 * Stock ids used in URLs and saved dashboards.
 *  - ASX codes stay bare ("BHP"), so older links and watchlists keep working.
 *  - US listings get a ".US" pseudo-suffix ("AAPL.US"); Yahoo itself uses "AAPL".
 *  - Everything else is the Yahoo symbol ("VOD.L", "SAP.DE", "7203.T", "0700.HK").
 */
const SUFFIX: Record<string, { region: RegionId; market: string }> = {
  AX: { region: "au", market: "ASX" },
  US: { region: "us", market: "US" },
  L: { region: "uk", market: "LSE" },
  DE: { region: "eu", market: "Xetra" },
  PA: { region: "eu", market: "Paris" },
  AS: { region: "eu", market: "Amsterdam" },
  T: { region: "jp", market: "Tokyo" },
  HK: { region: "hk", market: "HKEX" },
};

const ASX_RE = /^[A-Z0-9]{1,6}$/;
const SUFFIXED_RE = /^[A-Z0-9][A-Z0-9-]{0,7}\.(US|L|DE|PA|AS|T|HK)$/;

const FUTURES_RE = /^[A-Z0-9]{1,6}=F$/;
const INDEX_RE = /^\^[A-Z0-9]{1,8}$/;

/** Futures ("CL=F") and indices ("^GSPC"): no company, options or fundamentals. */
export const isFuturesId = (id: string) => FUTURES_RE.test(id);
export const isIndexId = (id: string) => INDEX_RE.test(id);
export const isNonEquityId = (id: string) => isFuturesId(id) || isIndexId(id);

export function isValidId(id: string): boolean {
  return ASX_RE.test(id) || SUFFIXED_RE.test(id) || isNonEquityId(id);
}

/** URL-safe path segment for an id ("CL%3DF", "%5EGSPC"). */
export const idPath = (id: string) => encodeURIComponent(id);

const suffixOf = (id: string) => (id.includes(".") ? id.slice(id.lastIndexOf(".") + 1) : "AX");

export function regionOf(id: string): RegionId {
  if (isNonEquityId(id)) return "us";
  return SUFFIX[suffixOf(id)]?.region ?? "au";
}

/** Short exchange label, e.g. "ASX", "US", "LSE". */
export function marketOf(id: string): string {
  if (isFuturesId(id)) return "Futures";
  if (isIndexId(id)) return "Index";
  return SUFFIX[suffixOf(id)]?.market ?? "ASX";
}

/** Code as people write it: "BHP", "AAPL", "VOD", "7203". */
export function displayCode(id: string): string {
  if (isNonEquityId(id)) return id;
  return id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : id;
}

export function toYahoo(id: string): string {
  if (isNonEquityId(id)) return id;
  if (!id.includes(".")) return `${id}.AX`;
  return id.endsWith(".US") ? id.slice(0, -3) : id;
}

/**
 * Id for a Yahoo symbol. Indices and FX ("^AXJO", "AUDUSD=X") and symbols on
 * exchanges we do not cover come back unchanged; check them with isValidId.
 */
export function fromYahoo(symbol: string): string {
  if (symbol.endsWith(".AX")) return symbol.slice(0, -3);
  if (/[\^=]/.test(symbol)) return symbol;
  if (!symbol.includes(".")) return `${symbol}.US`;
  return symbol;
}
