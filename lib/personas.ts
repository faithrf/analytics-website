import type { BoardsState } from "@/lib/boards";

/**
 * Obviously fictional test users for exercising a customer engagement platform.
 * Nothing here is real: emails use the reserved .test domain. Persona logins are
 * password-less and only reachable through admin impersonation.
 */
export type Plan = "free" | "pro" | "team";
export type Risk = "conservative" | "balanced" | "aggressive";
export type Stage = "new" | "active" | "lapsed" | "churned";

export interface Persona {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  country: string;
  signupDate: string; // YYYY-MM-DD
  interests: string[];
  risk: Risk;
  stage: Stage;
  boards: BoardsState;
  /** Leaders names or tickers this persona follows. */
  follows: string[];
}

const board = (id: string, name: string, ids: string[]) => ({ id, name, ids });
const state = (...boards: { id: string; name: string; ids: string[] }[]): BoardsState => ({ boards, active: boards[0].id });

export const PERSONAS: readonly Persona[] = [
  {
    id: "daytrader", name: "Test Persona - Day Trader", email: "daytrader@example.test", plan: "pro", country: "US",
    signupDate: "2025-02-11", interests: ["momentum", "options", "earnings"], risk: "aggressive", stage: "active",
    boards: state(board("watchlist", "Watchlist", ["NVDA.US", "TSLA.US", "AMD.US", "SMCI.US"]), board("earnings", "Earnings", ["AAPL.US", "MSFT.US"])),
    follows: ["NVDA", "TSLA"],
  },
  {
    id: "retiree", name: "Test Persona - Retiree", email: "retiree@example.test", plan: "free", country: "AU",
    signupDate: "2024-08-03", interests: ["dividends", "banks", "income"], risk: "conservative", stage: "active",
    boards: state(board("watchlist", "Watchlist", ["CBA", "WBC", "TLS", "WES"]), board("income", "Income", ["APA", "ANZ"])),
    follows: ["WBC"],
  },
  {
    id: "newbie", name: "Test Persona - First Timer", email: "newbie@example.test", plan: "free", country: "AU",
    signupDate: "2026-10-28", interests: ["etfs", "learning"], risk: "balanced", stage: "new",
    boards: state(board("watchlist", "Watchlist", ["VAS", "NDQ"])),
    follows: [],
  },
  {
    id: "insiderwatcher", name: "Test Persona - Insider Watcher", email: "insiderwatcher@example.test", plan: "pro", country: "US",
    signupDate: "2025-05-20", interests: ["insider buying", "small caps"], risk: "aggressive", stage: "active",
    boards: state(board("watchlist", "Watchlist", ["PLTR.US", "SOFI.US"]), board("insiders", "Insider buys", ["RIVN.US", "LCID.US", "HOOD.US"])),
    follows: ["PLTR", "SOFI", "HOOD"],
  },
  {
    id: "congressfan", name: "Test Persona - Capitol Follower", email: "congressfan@example.test", plan: "pro", country: "US",
    signupDate: "2025-11-02", interests: ["congress trades", "policy", "defence"], risk: "balanced", stage: "active",
    boards: state(board("watchlist", "Watchlist", ["LMT.US", "RTX.US", "GOOGL.US"])),
    follows: ["Nancy Pelosi", "NVDA"],
  },
  {
    id: "miner", name: "Test Persona - Resources Investor", email: "miner@example.test", plan: "team", country: "AU",
    signupDate: "2024-03-14", interests: ["mining", "lithium", "commodities"], risk: "aggressive", stage: "active",
    boards: state(board("watchlist", "Watchlist", ["BHP", "RIO", "FMG", "PLS"]), board("lithium", "Lithium", ["LTR", "IGO", "LYC"])),
    follows: ["BHP"],
  },
  {
    id: "lapsed1", name: "Test Persona - Lapsed Saver", email: "lapsedsaver@example.test", plan: "free", country: "GB",
    signupDate: "2024-06-30", interests: ["isa", "index funds"], risk: "conservative", stage: "lapsed",
    boards: state(board("watchlist", "Watchlist", ["SHEL.L", "HSBA.L"])),
    follows: [],
  },
  {
    id: "churned1", name: "Test Persona - Churned Pro", email: "churnedpro@example.test", plan: "pro", country: "DE",
    signupDate: "2024-01-09", interests: ["dax", "autos"], risk: "balanced", stage: "churned",
    boards: state(board("watchlist", "Watchlist", ["SAP.DE", "VOW3.DE"])),
    follows: [],
  },
  {
    id: "techgrowth", name: "Test Persona - Tech Growth", email: "techgrowth@example.test", plan: "pro", country: "SG",
    signupDate: "2025-09-15", interests: ["ai", "semiconductors", "growth"], risk: "aggressive", stage: "active",
    boards: state(board("watchlist", "Watchlist", ["NVDA.US", "TSM.US", "ASML.AS"]), board("ai", "AI", ["MSFT.US", "GOOGL.US", "META.US"])),
    follows: ["NVDA", "Jensen Huang"],
  },
  {
    id: "asiaspec", name: "Test Persona - Asia Speculator", email: "asiaspec@example.test", plan: "free", country: "HK",
    signupDate: "2026-07-22", interests: ["hang seng", "tech", "japan"], risk: "aggressive", stage: "lapsed",
    boards: state(board("watchlist", "Watchlist", ["0700.HK", "9988.HK", "7203.T"])),
    follows: [],
  },
  {
    id: "teamlead", name: "Test Persona - Team Admin", email: "teamlead@example.test", plan: "team", country: "AU",
    signupDate: "2025-01-06", interests: ["portfolio reviews", "reporting"], risk: "balanced", stage: "active",
    boards: state(board("watchlist", "Watchlist", ["CSL", "CBA", "BHP", "XRO"]), board("clients", "Client picks", ["WOW", "TLS"])),
    follows: ["CSL"],
  },
  {
    id: "dormant", name: "Test Persona - Dormant Account", email: "dormant@example.test", plan: "free", country: "CA",
    signupDate: "2023-12-01", interests: ["energy"], risk: "conservative", stage: "churned",
    boards: state(board("watchlist", "Watchlist", [])),
    follows: [],
  },
];

export const PERSONA_IDS: readonly string[] = PERSONAS.map((p) => p.id);
export const personaById = (id: string): Persona | undefined => PERSONAS.find((p) => p.id === id);
