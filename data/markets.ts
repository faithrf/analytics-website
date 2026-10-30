import type { Constituent } from "@/lib/aggregate";
import type { RegionId } from "@/lib/markets";
import { ASX200 } from "@/data/asx200";

/**
 * Large caps per non-ASX market, with GICS-style sectors. Codes are stock ids
 * (see lib/symbols.ts), e.g. "AAPL.US", "SHEL.L", "7203.T".
 *
 * AS OF: 2026-10-30. Hand-picked and approximate: these are NOT the official
 * S&P 500, FTSE 100, Euro Stoxx, Nikkei or Hang Seng memberships. Run
 * `npm run verify-tickers` whenever you edit this file.
 */
type Row = [id: string, name: string, sector: string];

const IT = "Information Technology";
const CD = "Consumer Discretionary";
const CS = "Consumer Staples";
const COM = "Communication Services";
const FIN = "Financials";
const HC = "Health Care";
const IND = "Industrials";
const MAT = "Materials";
const EN = "Energy";
const UT = "Utilities";
const RE = "Real Estate";

const US: Row[] = [
  ["AAPL.US", "Apple", IT],
  ["MSFT.US", "Microsoft", IT],
  ["NVDA.US", "Nvidia", IT],
  ["AVGO.US", "Broadcom", IT],
  ["ORCL.US", "Oracle", IT],
  ["CRM.US", "Salesforce", IT],
  ["AMD.US", "Advanced Micro Devices", IT],
  ["AMZN.US", "Amazon", CD],
  ["TSLA.US", "Tesla", CD],
  ["HD.US", "Home Depot", CD],
  ["GOOGL.US", "Alphabet", COM],
  ["META.US", "Meta Platforms", COM],
  ["NFLX.US", "Netflix", COM],
  ["DIS.US", "Walt Disney", COM],
  ["BRK-B.US", "Berkshire Hathaway", FIN],
  ["JPM.US", "JPMorgan Chase", FIN],
  ["V.US", "Visa", FIN],
  ["MA.US", "Mastercard", FIN],
  ["BAC.US", "Bank of America", FIN],
  ["LLY.US", "Eli Lilly", HC],
  ["UNH.US", "UnitedHealth", HC],
  ["JNJ.US", "Johnson & Johnson", HC],
  ["MRK.US", "Merck & Co", HC],
  ["ABBV.US", "AbbVie", HC],
  ["PG.US", "Procter & Gamble", CS],
  ["COST.US", "Costco", CS],
  ["WMT.US", "Walmart", CS],
  ["KO.US", "Coca-Cola", CS],
  ["PEP.US", "PepsiCo", CS],
  ["XOM.US", "Exxon Mobil", EN],
  ["CVX.US", "Chevron", EN],
  ["CAT.US", "Caterpillar", IND],
  ["GE.US", "GE Aerospace", IND],
  ["BA.US", "Boeing", IND],
  ["LIN.US", "Linde", MAT],
  ["FCX.US", "Freeport-McMoRan", MAT],
  ["NEE.US", "NextEra Energy", UT],
  ["DUK.US", "Duke Energy", UT],
  ["PLD.US", "Prologis", RE],
  ["AMT.US", "American Tower", RE],
];

const UK: Row[] = [
  ["SHEL.L", "Shell", EN],
  ["BP.L", "BP", EN],
  ["AZN.L", "AstraZeneca", HC],
  ["GSK.L", "GSK", HC],
  ["HSBA.L", "HSBC", FIN],
  ["LLOY.L", "Lloyds Banking Group", FIN],
  ["BARC.L", "Barclays", FIN],
  ["NWG.L", "NatWest Group", FIN],
  ["LSEG.L", "London Stock Exchange Group", FIN],
  ["PRU.L", "Prudential", FIN],
  ["LGEN.L", "Legal & General", FIN],
  ["ULVR.L", "Unilever", CS],
  ["DGE.L", "Diageo", CS],
  ["BATS.L", "British American Tobacco", CS],
  ["IMB.L", "Imperial Brands", CS],
  ["TSCO.L", "Tesco", CS],
  ["RIO.L", "Rio Tinto", MAT],
  ["GLEN.L", "Glencore", MAT],
  ["AAL.L", "Anglo American", MAT],
  ["REL.L", "RELX", IND],
  ["BA.L", "BAE Systems", IND],
  ["RR.L", "Rolls-Royce", IND],
  ["EXPN.L", "Experian", IND],
  ["CPG.L", "Compass Group", CD],
  ["VOD.L", "Vodafone", COM],
  ["BT-A.L", "BT Group", COM],
  ["NG.L", "National Grid", UT],
  ["SSE.L", "SSE", UT],
  ["LAND.L", "Land Securities", RE],
  ["SGRO.L", "Segro", RE],
];

const EU: Row[] = [
  ["SAP.DE", "SAP", IT],
  ["IFX.DE", "Infineon", IT],
  ["ASML.AS", "ASML", IT],
  ["SIE.DE", "Siemens", IND],
  ["AIR.PA", "Airbus", IND],
  ["SU.PA", "Schneider Electric", IND],
  ["ALV.DE", "Allianz", FIN],
  ["MUV2.DE", "Munich Re", FIN],
  ["DBK.DE", "Deutsche Bank", FIN],
  ["BNP.PA", "BNP Paribas", FIN],
  ["CS.PA", "AXA", FIN],
  ["INGA.AS", "ING Group", FIN],
  ["DTE.DE", "Deutsche Telekom", COM],
  ["MBG.DE", "Mercedes-Benz", CD],
  ["BMW.DE", "BMW", CD],
  ["VOW3.DE", "Volkswagen", CD],
  ["ADS.DE", "Adidas", CD],
  ["MC.PA", "LVMH", CD],
  ["RMS.PA", "Hermes", CD],
  ["KER.PA", "Kering", CD],
  ["PRX.AS", "Prosus", CD],
  ["OR.PA", "L'Oreal", CS],
  ["AD.AS", "Ahold Delhaize", CS],
  ["HEIA.AS", "Heineken", CS],
  ["SAN.PA", "Sanofi", HC],
  ["EL.PA", "EssilorLuxottica", HC],
  ["PHIA.AS", "Philips", HC],
  ["BAS.DE", "BASF", MAT],
  ["AI.PA", "Air Liquide", MAT],
  ["TTE.PA", "TotalEnergies", EN],
  ["RWE.DE", "RWE", UT],
  ["EOAN.DE", "E.ON", UT],
  ["VNA.DE", "Vonovia", RE],
];

const JP: Row[] = [
  ["7203.T", "Toyota Motor", CD],
  ["7267.T", "Honda Motor", CD],
  ["6758.T", "Sony Group", CD],
  ["9983.T", "Fast Retailing", CD],
  ["6902.T", "Denso", CD],
  ["8306.T", "Mitsubishi UFJ", FIN],
  ["8316.T", "Sumitomo Mitsui Financial", FIN],
  ["8411.T", "Mizuho Financial", FIN],
  ["8766.T", "Tokio Marine", FIN],
  ["6861.T", "Keyence", IT],
  ["8035.T", "Tokyo Electron", IT],
  ["6981.T", "Murata Manufacturing", IT],
  ["6702.T", "Fujitsu", IT],
  ["9984.T", "SoftBank Group", COM],
  ["9432.T", "NTT", COM],
  ["9433.T", "KDDI", COM],
  ["7974.T", "Nintendo", COM],
  ["6501.T", "Hitachi", IND],
  ["8058.T", "Mitsubishi Corp", IND],
  ["8001.T", "Itochu", IND],
  ["8031.T", "Mitsui & Co", IND],
  ["6098.T", "Recruit Holdings", IND],
  ["6367.T", "Daikin", IND],
  ["9020.T", "JR East", IND],
  ["4502.T", "Takeda", HC],
  ["4568.T", "Daiichi Sankyo", HC],
  ["4519.T", "Chugai Pharmaceutical", HC],
  ["4063.T", "Shin-Etsu Chemical", MAT],
  ["5401.T", "Nippon Steel", MAT],
  ["2914.T", "Japan Tobacco", CS],
  ["3382.T", "Seven & i", CS],
  ["5020.T", "ENEOS", EN],
  ["9501.T", "Tokyo Electric Power", UT],
  ["8801.T", "Mitsui Fudosan", RE],
];

const HK: Row[] = [
  ["0700.HK", "Tencent", COM],
  ["0941.HK", "China Mobile", COM],
  ["9999.HK", "NetEase", COM],
  ["9988.HK", "Alibaba", CD],
  ["3690.HK", "Meituan", CD],
  ["9618.HK", "JD.com", CD],
  ["1211.HK", "BYD", CD],
  ["2020.HK", "ANTA Sports", CD],
  ["0027.HK", "Galaxy Entertainment", CD],
  ["1928.HK", "Sands China", CD],
  ["0005.HK", "HSBC", FIN],
  ["1299.HK", "AIA Group", FIN],
  ["0939.HK", "China Construction Bank", FIN],
  ["1398.HK", "ICBC", FIN],
  ["3988.HK", "Bank of China", FIN],
  ["2318.HK", "Ping An Insurance", FIN],
  ["0388.HK", "HKEX", FIN],
  ["2388.HK", "BOC Hong Kong", FIN],
  ["1810.HK", "Xiaomi", IT],
  ["0883.HK", "CNOOC", EN],
  ["0857.HK", "PetroChina", EN],
  ["0386.HK", "Sinopec", EN],
  ["1088.HK", "China Shenhua", EN],
  ["2899.HK", "Zijin Mining", MAT],
  ["0001.HK", "CK Hutchison", IND],
  ["0669.HK", "Techtronic Industries", IND],
  ["0066.HK", "MTR Corp", IND],
  ["0002.HK", "CLP Holdings", UT],
  ["0003.HK", "HK and China Gas", UT],
  ["0016.HK", "Sun Hung Kai Properties", RE],
  ["1109.HK", "China Resources Land", RE],
  ["0823.HK", "Link REIT", RE],
  ["0288.HK", "WH Group", CS],
  ["2269.HK", "WuXi Biologics", HC],
  ["1093.HK", "CSPC Pharmaceutical", HC],
];

const toList = (rows: Row[]): Constituent[] => rows.map(([code, name, sector]) => ({ code, name, sector }));

export const CONSTITUENTS: Record<RegionId, Constituent[]> = {
  au: ASX200,
  us: toList(US),
  uk: toList(UK),
  eu: toList(EU),
  jp: toList(JP),
  hk: toList(HK),
};

export const CONSTITUENT_BY_ID = new Map(Object.values(CONSTITUENTS).flatMap((list) => list.map((c) => [c.code, c] as const)));
