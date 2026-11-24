/** Fund lists and URLs shared by fund-snapshot.ts and fund-signals.ts. */

export const ARK_FUNDS: { id: string; name: string; file: string }[] = [
  { id: "ARKK", name: "ARK Innovation", file: "ARK_INNOVATION_ETF_ARKK" },
  { id: "ARKW", name: "ARK Next Generation Internet", file: "ARK_NEXT_GENERATION_INTERNET_ETF_ARKW" },
  { id: "ARKG", name: "ARK Genomic Revolution", file: "ARK_GENOMIC_REVOLUTION_ETF_ARKG" },
  { id: "ARKQ", name: "ARK Autonomous Tech & Robotics", file: "ARK_AUTONOMOUS_TECH._&_ROBOTICS_ETF_ARKQ" },
  { id: "ARKF", name: "ARK Blockchain & Fintech", file: "ARK_BLOCKCHAIN_&_FINTECH_INNOVATION_ETF_ARKF" },
  { id: "ARKX", name: "ARK Space & Defense", file: "ARK_SPACE_&_DEFENSE_INNOVATION_ETF_ARKX" },
];

export const arkCsvUrl = (f: { file: string }) => `https://assets.ark-funds.com/fund-documents/funds-etf-csv/${f.file}_HOLDINGS.csv`;
export const arkPage = (id: string) => `https://www.ark-funds.com/funds/${id.toLowerCase()}`;
/** Unofficial mirror of ARK's published daily trades and holdings, back to 2020-09. Not ARK itself. */
export const arkTradesApi = (id: string, from: string) => `https://arkfunds.io/api/v2/etf/trades?symbol=${id}&date_from=${from}`;

/** 13F filers, CIKs checked against EDGAR submissions JSON (names match). */
export const FILERS: { id: string; name: string; cik: string }[] = [
  { id: "ARK", name: "ARK Investment Management", cik: "0001697748" },
  { id: "SCION", name: "Scion Asset Management (Burry)", cik: "0001649339" },
  { id: "BRK", name: "Berkshire Hathaway", cik: "0001067983" },
  { id: "PSH", name: "Pershing Square (Ackman)", cik: "0001336528" },
  { id: "DUQ", name: "Duquesne Family Office (Druckenmiller)", cik: "0001536411" },
  { id: "APPA", name: "Appaloosa (Tepper)", cik: "0001656456" },
  { id: "RENT", name: "Renaissance Technologies", cik: "0001037389" },
  { id: "BRDG", name: "Bridgewater Associates", cik: "0001350694" },
  { id: "TIGER", name: "Tiger Global Management", cik: "0001167483" },
  { id: "TP", name: "Third Point", cik: "0001040273" },
];

export const edgarFilerUrl = (cik: string) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=13F-HR`;
