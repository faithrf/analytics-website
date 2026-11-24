import { isCryptoId, isNonEquityId } from "@/lib/symbols";

/**
 * Sector baskets for testing a model hypothesis one sector at a time. Equities use the app's
 * "AAPL.US" ids; spot crypto uses Yahoo's "BTC-USD" ids (see isCryptoId in lib/symbols.ts).
 * Today's constituents, so survivorship bias applies.
 */
export interface Sector {
  id: string;
  label: string;
  ids: string[];
  /** spot crypto: trades 7 days a week, no earnings, no listed options */
  crypto?: boolean;
}

const us = (codes: string) => codes.split(" ").map((c) => `${c}.US`);

export const SECTORS: Sector[] = [
  {
    id: "finance",
    label: "Finance",
    ids: us(
      "JPM BAC WFC C GS MS USB PNC SCHW BLK AXP V MA PYPL MET PRU CB AIG TRV ALL SPGI ICE CME",
    ),
  },
  {
    id: "tech",
    label: "Tech",
    ids: us(
      "AAPL MSFT NVDA AVGO ORCL CRM ADBE AMD INTC QCOM TXN CSCO IBM MU AMAT NOW INTU PANW",
    ),
  },
  {
    id: "healthcare",
    label: "Healthcare",
    ids: us(
      "UNH LLY JNJ PFE MRK ABBV TMO ABT ISRG SYK MDT DHR GILD AMGN REGN VRTX BMY CVS",
    ),
  },
  {
    id: "energy",
    label: "Energy",
    ids: us("XOM CVX COP SLB EOG OXY PSX MPC VLO HAL"),
  },
  {
    id: "consumer",
    label: "Consumer",
    ids: us(
      "AMZN TSLA WMT COST HD LOW MCD NKE SBUX KO PEP PG TGT TJX MDLZ DIS NFLX BKNG",
    ),
  },
  {
    id: "industrials",
    label: "Industrials",
    ids: us(
      "CAT DE BA GE HON UPS LMT RTX UNP CSX NSC FDX GD NOC EMR ETN ITW MMM",
    ),
  },
  {
    id: "crypto",
    label: "Crypto (spot)",
    crypto: true,
    ids: [
      "BTC-USD",
      "ETH-USD",
      "SOL-USD",
      "XRP-USD",
      "ADA-USD",
      "DOGE-USD",
      "LINK-USD",
      "LTC-USD",
      "AVAX-USD",
    ],
  },
  {
    id: "cryptostocks",
    label: "Crypto stocks",
    ids: us("COIN MSTR MARA RIOT"),
  },
];

const BY_TICKER = new Map<string, string>();
for (const s of SECTORS) for (const id of s.ids) BY_TICKER.set(id, s.id);

/**
 * Sector id for a ticker id ("JPM.US" or bare "JPM"), or null when unclassified. Names in
 * US_LIQUID outside the baskets are left unclassified rather than guessed.
 */
export function tickerSector(id: string): string | null {
  const key = /[.-]/.test(id) ? id : `${id}.US`;
  return BY_TICKER.get(key) ?? null;
}

export const sectorById = (id: string) => SECTORS.find((s) => s.id === id);

/**
 * Index used for the abnormal-move and regime filters: US ids -> S&P 500, bare ASX codes -> ASX 200,
 * crypto -> BTC-USD (BTC itself has none, so its beta filters drop it), others none.
 */
export function indexSymbolFor(id: string): string | null {
  if (isCryptoId(id)) return id === "BTC-USD" ? null : "BTC-USD";
  if (id.endsWith(".US")) return "^GSPC";
  return !id.includes(".") && !isNonEquityId(id) ? "^AXJO" : null;
}
