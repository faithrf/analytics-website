/** Ready-made dashboards anyone can add in one click. Ids use the format in lib/symbols.ts. */
export interface BoardPreset {
  group: string;
  name: string;
  ids: string[];
}

const us = (...t: string[]) => t.map((x) => `${x}.US`);

export const BOARD_PRESETS: BoardPreset[] = [
  // Technology
  { group: "Technology", name: "Magnificent 7", ids: us("AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA") },
  { group: "Technology", name: "AI leaders", ids: us("NVDA", "MSFT", "GOOGL", "META", "AMZN", "AMD", "AVGO", "ORCL", "PLTR", "TSM", "ARM", "SMCI") },
  {
    group: "Technology",
    name: "Semiconductors",
    ids: [...us("NVDA", "AMD", "AVGO", "TSM", "INTC", "QCOM", "MU", "TXN", "ARM", "AMAT", "LRCX", "KLAC", "MRVL"), "ASML.AS", "8035.T"],
  },
  {
    group: "Technology",
    name: "Cloud & software",
    ids: [...us("CRM", "NOW", "ADBE", "SNOW", "DDOG", "MDB", "WDAY", "TEAM", "SHOP", "NET"), "SAP.DE", "XRO"],
  },
  { group: "Technology", name: "Cybersecurity", ids: us("CRWD", "PANW", "FTNT", "ZS", "OKTA", "S", "CHKP", "NET") },
  { group: "Technology", name: "Data centres", ids: [...us("EQIX", "DLR", "VRT", "ETN", "ANET", "DELL", "SMCI", "CEG"), "NXT", "GMG"] },
  { group: "Technology", name: "Quantum computing", ids: us("IONQ", "RGTI", "QBTS", "QUBT", "IBM", "GOOGL", "HON") },
  {
    group: "Technology",
    name: "Robotics & automation",
    ids: [...us("ISRG", "ROK", "TER", "SYM", "ZBRA", "CGNX"), "6954.T", "6861.T", "6506.T"],
  },
  { group: "Technology", name: "Space", ids: us("RKLB", "ASTS", "LUNR", "PL", "IRDM", "BA", "LMT") },
  {
    group: "Technology",
    name: "Gaming & esports",
    ids: [...us("TTWO", "RBLX", "U", "NTES"), "7974.T", "6758.T", "9697.T", "0700.HK"],
  },
  { group: "Technology", name: "Social media", ids: [...us("META", "SNAP", "PINS", "RDDT"), "0700.HK"] },
  {
    group: "Technology",
    name: "China tech",
    ids: [...us("BIDU", "PDD"), "0700.HK", "9988.HK", "3690.HK", "1810.HK", "9618.HK", "1024.HK", "9999.HK"],
  },
  { group: "Technology", name: "ASX tech", ids: ["WTC", "XRO", "NXT", "CPU", "TNE", "MP1", "PME", "CAR", "SEK", "REA", "ALU"] },
  {
    group: "Technology",
    name: "EVs & batteries",
    ids: [...us("TSLA", "RIVN", "LCID", "NIO", "XPEV", "LI", "ALB"), "1211.HK", "PLS"],
  },

  // Fintech
  {
    group: "Fintech",
    name: "Fintech: payments",
    ids: [...us("PYPL", "XYZ", "V", "MA", "DLO", "FLYW", "FOUR", "CPAY", "GPN", "FISV"), "ADYEN.AS", "WISE.L"],
  },
  { group: "Fintech", name: "Fintech: neobanks & BNPL", ids: [...us("SOFI", "NU", "CHYM", "KLAR", "AFRM", "ALLY", "KSPI"), "ZIP"] },
  { group: "Fintech", name: "Fintech: investing", ids: us("HOOD", "COIN", "IBKR", "SCHW", "XP", "LPLA") },
  { group: "Fintech", name: "Fintech: infrastructure", ids: us("FIS", "JKHY", "NCNO", "BR", "SSNC", "BILL", "INTU", "BL", "TOST") },
  { group: "Fintech", name: "Fintech: ASX", ids: ["XYZ", "ZIP", "OFX", "TYR", "PPM", "PGL", "CCA", "CCR", "WZR", "JDO"] },
  { group: "Fintech", name: "Crypto stocks", ids: us("COIN", "MSTR", "MARA", "RIOT", "CLSK", "HOOD", "CRCL", "GLXY", "IBIT") },

  // Healthcare
  {
    group: "Healthcare",
    name: "Big pharma",
    ids: [...us("LLY", "NVO", "JNJ", "MRK", "PFE", "ABBV", "BMY"), "AZN.L", "GSK.L", "SAN.PA", "BAYN.DE", "4502.T"],
  },
  {
    group: "Healthcare",
    name: "Biotech",
    ids: [...us("AMGN", "GILD", "VRTX", "REGN", "MRNA", "BIIB", "BNTX", "ALNY", "ARGX", "INCY"), "CSL"],
  },
  {
    group: "Healthcare",
    name: "Medtech",
    ids: [...us("ISRG", "MDT", "SYK", "BSX", "ABT", "EW", "DXCM", "ZBH", "RMD"), "COH"],
  },
  { group: "Healthcare", name: "Weight-loss drugs", ids: [...us("LLY", "NVO", "AMGN", "VKTX", "HIMS", "PFE"), "AZN.L"] },
  {
    group: "Healthcare",
    name: "Health insurers",
    ids: [...us("UNH", "ELV", "CI", "CVS", "HUM", "CNC", "MOH"), "MPL", "NHF"],
  },
  {
    group: "Healthcare",
    name: "ASX healthcare",
    ids: ["CSL", "COH", "RMD", "SHL", "PME", "RHC", "FPH", "TLX", "NAN", "ANN", "EBO", "SIG"],
  },

  // Energy and resources
  {
    group: "Energy & resources",
    name: "Oil & gas",
    ids: [...us("XOM", "CVX", "COP", "OXY", "EOG", "SLB"), "SHEL.L", "BP.L", "TTE.PA", "WDS", "STO", "0883.HK"],
  },
  { group: "Energy & resources", name: "Clean energy", ids: [...us("ENPH", "FSLR", "NEE", "PLUG", "SEDG", "RUN", "BEP"), "ORG"] },
  {
    group: "Energy & resources",
    name: "Uranium & nuclear",
    ids: [...us("CCJ", "CEG", "VST", "OKLO", "SMR", "NXE", "UEC", "LEU", "BWXT"), "PDN", "BOE", "DYL", "LOT"],
  },
  {
    group: "Energy & resources",
    name: "Gold miners",
    ids: [...us("NEM", "B", "AEM", "KGC", "WPM", "FNV"), "NST", "EVN", "RRL", "PRU", "RMS", "CMM", "WGX", "GMD"],
  },
  {
    group: "Energy & resources",
    name: "Big miners",
    ids: [...us("VALE", "FCX", "SCCO"), "BHP", "RIO", "FMG", "S32", "MIN", "RIO.L", "GLEN.L", "AAL.L"],
  },
  { group: "Energy & resources", name: "Copper", ids: [...us("FCX", "SCCO", "TECK", "HBM"), "SFR", "BHP", "ANTO.L"] },
  {
    group: "Energy & resources",
    name: "Lithium",
    ids: [...us("ALB", "SQM", "LAC", "SGML"), "PLS", "MIN", "LTR", "IGO", "1772.HK"],
  },
  { group: "Energy & resources", name: "Rare earths", ids: [...us("MP", "USAR", "UUUU"), "LYC", "ILU", "ARU"] },

  // Industrials
  {
    group: "Industrials",
    name: "Construction",
    ids: us("CAT", "DE", "VMC", "MLM", "URI", "PWR", "EME", "FLR", "J", "ACM", "CRH"),
  },
  { group: "Industrials", name: "ASX construction", ids: ["JHX", "DOW", "LLC", "RWC", "VNT", "MND", "NWH", "GNP"] },
  {
    group: "Industrials",
    name: "Homebuilders",
    ids: [...us("DHI", "LEN", "PHM", "NVR", "TOL", "KBH"), "PSN.L", "BTRW.L", "TW.L"],
  },
  {
    group: "Industrials",
    name: "Defence",
    ids: [...us("LMT", "RTX", "NOC", "GD", "LHX", "PLTR"), "BA.L", "RHM.DE", "HO.PA", "SAF.PA", "EOS", "DRO", "ASB"],
  },
  {
    group: "Industrials",
    name: "Airlines",
    ids: [...us("DAL", "UAL", "AAL", "LUV"), "QAN", "IAG.L", "EZJ.L", "AF.PA", "LHA.DE", "9202.T", "0293.HK"],
  },
  {
    group: "Industrials",
    name: "Shipping & logistics",
    ids: [...us("UPS", "FDX", "ZIM", "MATX", "UNP", "CSX"), "DHL.DE", "BXB", "AZJ", "1919.HK"],
  },
  { group: "Industrials", name: "Waste & recycling", ids: [...us("WM", "RSG", "WCN"), "CWY"] },

  // Consumer
  {
    group: "Consumer",
    name: "Luxury",
    ids: [...us("EL", "TPR", "CPRI", "RL"), "MC.PA", "RMS.PA", "KER.PA", "BRBY.L", "1913.HK"],
  },
  {
    group: "Consumer",
    name: "Retail",
    ids: [...us("WMT", "COST", "TGT", "AMZN", "HD", "LOW", "TJX"), "WOW", "COL", "WES", "JBH", "HVN", "TSCO.L"],
  },
  { group: "Consumer", name: "Restaurants", ids: [...us("MCD", "SBUX", "CMG", "YUM", "DPZ", "QSR", "CAVA", "WING"), "DMP", "CKF"] },
  {
    group: "Consumer",
    name: "Beverages",
    ids: [...us("KO", "PEP", "MNST", "CELH", "BUD", "STZ"), "DGE.L", "RI.PA", "TWE"],
  },
  { group: "Consumer", name: "Streaming & media", ids: [...us("NFLX", "DIS", "SPOT", "ROKU", "CMCSA"), "NEC"] },
  { group: "Consumer", name: "Sportswear", ids: [...us("NKE", "LULU", "ONON", "DECK", "UAA"), "ADS.DE", "PUM.DE"] },
  {
    group: "Consumer",
    name: "Travel",
    ids: [...us("BKNG", "ABNB", "EXPE", "MAR", "HLT", "RCL", "CCL", "NCLH"), "FLT", "WEB"],
  },
  {
    group: "Consumer",
    name: "Casinos & betting",
    ids: [...us("LVS", "WYNN", "MGM", "DKNG", "FLUT"), "ALL", "TAH", "LNW", "SGR", "0027.HK"],
  },
  { group: "Consumer", name: "Agriculture & food", ids: [...us("ADM", "BG", "CTVA", "NTR", "MOS", "CF"), "ELD", "GNC", "A2M"] },

  // Financials
  { group: "Financials", name: "US banks", ids: us("JPM", "BAC", "WFC", "C", "GS", "MS", "USB", "PNC") },
  { group: "Financials", name: "ASX banks", ids: ["CBA", "WBC", "NAB", "ANZ", "MQG", "BOQ", "BEN"] },
  {
    group: "Financials",
    name: "UK & Europe banks",
    ids: ["HSBA.L", "BARC.L", "LLOY.L", "NWG.L", "BNP.PA", "GLE.PA", "DBK.DE", "CBK.DE", "INGA.AS"],
  },
  {
    group: "Financials",
    name: "Insurers",
    ids: [...us("BRK-B", "AIG", "CB", "PGR", "ALL", "TRV"), "QBE", "IAG", "SUN", "ALV.DE", "CS.PA"],
  },
  { group: "Financials", name: "Asset managers", ids: [...us("BLK", "BX", "KKR", "APO", "TROW"), "MQG", "NWL"] },
  {
    group: "Financials",
    name: "Stock exchanges",
    ids: [...us("ICE", "CME", "NDAQ", "CBOE"), "ASX", "LSEG.L", "DB1.DE", "0388.HK", "8697.T"],
  },

  // Property and utilities
  {
    group: "Property & utilities",
    name: "Global REITs",
    ids: [...us("PLD", "AMT", "EQIX", "O", "SPG", "PSA", "WELL", "DLR"), "GMG", "SCG"],
  },
  { group: "Property & utilities", name: "ASX property", ids: ["GMG", "SCG", "SGP", "MGR", "DXS", "CHC", "GPT", "VCX", "CLW"] },
  {
    group: "Property & utilities",
    name: "Utilities",
    ids: [...us("NEE", "DUK", "SO", "D", "AEP"), "AGL", "ORG", "APA", "NG.L", "SSE.L", "ENGI.PA", "EOAN.DE"],
  },
  {
    group: "Property & utilities",
    name: "Telecoms",
    ids: [...us("T", "VZ", "TMUS"), "TLS", "VOD.L", "BT-A.L", "DTE.DE", "ORA.PA", "9432.T", "0941.HK"],
  },

  // Markets
  {
    group: "Markets",
    name: "ASX 20",
    ids: ["BHP", "CBA", "CSL", "NAB", "WBC", "ANZ", "WES", "MQG", "GMG", "FMG", "WDS", "RIO", "TLS", "WOW", "TCL", "ALL", "REA", "COL", "STO", "XRO"],
  },
  {
    group: "Markets",
    name: "UK leaders",
    ids: ["AZN.L", "SHEL.L", "HSBA.L", "ULVR.L", "REL.L", "RIO.L", "BP.L", "GSK.L", "LSEG.L", "DGE.L", "BATS.L", "RR.L"],
  },
  {
    group: "Markets",
    name: "Europe leaders",
    ids: ["ASML.AS", "SAP.DE", "MC.PA", "SIE.DE", "AIR.PA", "TTE.PA", "ALV.DE", "OR.PA", "SU.PA", "RMS.PA", "DTE.DE"],
  },
  {
    group: "Markets",
    name: "Japan leaders",
    ids: ["7203.T", "6758.T", "9984.T", "8306.T", "6861.T", "9983.T", "7974.T", "8035.T", "6501.T", "4063.T"],
  },
  {
    group: "Markets",
    name: "Hong Kong leaders",
    ids: ["0700.HK", "9988.HK", "0005.HK", "1299.HK", "0941.HK", "3690.HK", "1810.HK", "0388.HK", "2318.HK", "0939.HK"],
  },
];

/** Group names in display order. */
export const PRESET_GROUPS = [...new Set(BOARD_PRESETS.map((p) => p.group))];
