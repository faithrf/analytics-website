import type { RuleVerdict } from "@/lib/momentum-rules";

/**
 * Rule cards for the two strategy families in scripts/strategy-study.ts: post-earnings drift and selling
 * options after spikes. 198 large caps, 3 years of training, the next 12 months out of sample, the last
 * 3 months (from 2026-08-07) read once. Edge = percentage points over the same trade on ordinary days in
 * the same month, market and index regime. Costs are inside every number. Write-up: docs/model-research.md.
 */
export type { RuleVerdict };

export interface StrategyRule {
  rule: string;
  setting: string;
  verdict: RuleVerdict;
  why: string;
}

export type StrategyFamily = "earnings" | "options";

/** Which rule card each preset shows. */
export const STRATEGY_FAMILY_OF: Record<string, StrategyFamily> = {
  "earn-drift-up": "earnings",
  "earn-drift-down": "earnings",
  "covered-call-spike": "options",
  "cash-put-drop": "options",
};

export const STRATEGY_RULES: Record<StrategyFamily, StrategyRule[]> = {
  earnings: [
    {
      rule: "Finding the earnings day",
      setting: "Proxy: gap of 3%+ on 2x volume, with another volume spike 1, 2 or 4 quarters earlier",
      verdict: "small",
      why: "Yahoo only returns the last four quarters of earnings (earningsHistory), so the dates are inferred. The proxy also catches non-earnings shocks; the gap direction stands in for the surprise.",
    },
    {
      rule: "Direction",
      setting: "Long after an up reaction, short after a down reaction; enter the next open",
      verdict: "none",
      why: "Longs: 20 of 25 cells had a positive training edge but only 13 held in the test year. Shorts: 1 of 25 cells qualified in training (3%+ shorts lost money, edge +0.1 to +0.3). In the test year the same cells showed edge +1.0 to +1.7 (clustered t up to 1.9), a post-hoc finding that no training rule predicted.",
    },
    {
      rule: "Size of the move",
      setting: "Bigger is better for longs: 12%+ is the only bucket with a steady edge",
      verdict: "small",
      why: "Long edge by bucket, test year, 10-20 day holds: 3-5% -1.1 to -1.3, 5-8% -0.5 to +0.7, 8-12% 0, 12%+ +5.6 to +7.0 (n only 16-17). Train n for 12%+ was 46. A lead to watch, not a rule.",
    },
    {
      rule: "Hold",
      setting: "5, 10, 20, 40, 60 days: no reliable plateau",
      verdict: "none",
      why: "Best training cell was 3-5% moves held 60 days (edge +2.3, clustered t 2.3). In the test year it fell to +1.3, clustered t 0.2. The 60-day hold is also the most exposed to the market.",
    },
    {
      rule: "Costs",
      setting: "10 bps round trip; no borrow cost on shorts",
      verdict: "none",
      why: "0, 10 and 25 bps change the long card by 0.1 point each; costs are not what kills it.",
    },
    {
      rule: "Market",
      setting: "US and ASX",
      verdict: "none",
      why: "Best long cell, test year: US +0.3, ASX +4.2 on 14 trades. No consistent difference.",
    },
    {
      rule: "Multiple testing",
      setting: "194 cells tried (50 earnings)",
      verdict: "hurts",
      why: "No cell passes false-discovery control (Benjamini-Hochberg q<0.05) on the 3-year training window. The best of 194 cells reaches t about 3.2 by luck; the best earnings cell reached 2.3.",
    },
  ],
  options: [
    {
      rule: "Trigger",
      setting: "Close up (covered call) or down (cash put) 5% or more on 1.5x volume",
      verdict: "small",
      why: "8% moves paid more premium and had a bigger training edge (+1.7 vs +0.8 for calls) but not in the test year (+0.4 vs +0.6). Fewer trades, no better.",
    },
    {
      rule: "Implied volatility",
      setting: "Unknown: historical vol x a bump (1.0, 1.3, 1.6)",
      verdict: "matters",
      why: "The whole result rides on this assumption. Test year, all strikes and expiries: covered call minus plain stock -1.7 (x1.0), -0.9 (x1.3), 0.0 (x1.6); cash put minus cash -0.4, +0.3, +1.1. Only the highest bump looks good, and it is the one we cannot check without real option quotes.",
    },
    {
      rule: "Strike",
      setting: "2-10% out of the money",
      verdict: "small",
      why: "Closer strikes collect more but get called away more: 2% OTM 45% assigned, 5% 32%, 10% 18% (30 days, x1.6). Edge over ordinary days was similar for all three.",
    },
    {
      rule: "Expiry",
      setting: "Calls 30 days; puts 14 days",
      verdict: "small",
      why: "Best on training for each side. Cash put: 10% OTM, 14 days was assigned only 7% of the time; 7-day and 30-day puts had a training clustered t near 0. Calls were best at 30 days in all six top cells.",
    },
    {
      rule: "Spread cost",
      setting: "Give up 10% of the premium on each sale",
      verdict: "matters",
      why: "Covered call return minus plain stock: +0.7 at no haircut, +0.2 at 10%, -0.7 at 25%. Most of the extra over owning the stock is eaten by a realistic spread.",
    },
    {
      rule: "Tail risk",
      setting: "Held to expiry, no stop",
      verdict: "hurts",
      why: "Worst single trade: covered call -27%, cash put -22% (the stock gaps and the premium is a few percent). A 95% hit rate on puts hides a long left tail.",
    },
    {
      rule: "Versus owning the stock",
      setting: "Covered call vs plain stock; cash put vs cash",
      verdict: "none",
      why: "The call gave up upside after spikes that kept running (assigned 45% of the time at 2% OTM). Mean return +2.4 vs plain stock +2.2 over the same days. The put beat cash by +0.7 and roughly matched buying the stock (-0.1).",
    },
    {
      rule: "Multiple testing",
      setting: "194 cells tried (144 option cells)",
      verdict: "hurts",
      why: "No cell passes Benjamini-Hochberg q<0.05 on training. Calls had t about 3.3 in training and 0.9 out of sample; puts had 1.8 and 1.7.",
    },
  ],
};

export type StrategyVerdict = "confirmed" | "unproven" | "dead";

export interface StrategyCard {
  label: string;
  rule: string;
  cellsTried: number;
  train: { n: number; hit: number; mean: number; edge: number; tClustered: number };
  oos: { n: number; hit: number; hitLo: number; hitHi: number; mean: number; edge: number; tClustered: number };
  holdout: { n: number; hit: number; hitLo: number; hitHi: number; mean: number; edge: number; tClustered: number; from: string; to: string };
  verdict: StrategyVerdict;
  note: string;
}

const HOLD = { from: "2026-08-07", to: "2026-11-06" } as const;

export const STRATEGY_STUDY: Record<string, StrategyCard> = {
  "earn-drift-up": {
    label: "Post-earnings drift, long",
    rule: "Earnings-like gap up 3-5% on 2x volume, buy next open, hold 60 days",
    cellsTried: 194,
    train: { n: 191, hit: 59, mean: 5.17, edge: 2.26, tClustered: 2.3 },
    oos: { n: 58, hit: 53, hitLo: 41, hitHi: 66, mean: 4.39, edge: 1.28, tClustered: 0.2 },
    holdout: { n: 2, hit: 50, hitLo: 9, hitHi: 91, mean: 0, edge: 0, tClustered: 0, ...HOLD },
    verdict: "unproven",
    note: "The best training cell did not hold up in the test year (clustered t 0.2). The holdout has only 2 finished 60-day trades, so it says nothing. Only lead: 12%+ gap-ups (test +4 to +7, n 12-17).",
  },
  "earn-drift-down": {
    label: "Post-earnings drift, short",
    rule: "Earnings-like gap down 12%+ on 2x volume, short next open, hold 5 days",
    cellsTried: 194,
    train: { n: 40, hit: 53, mean: 0.02, edge: 0.41, tClustered: 0.8 },
    oos: { n: 16, hit: 50, hitLo: 28, hitHi: 72, mean: -0.34, edge: 0.3, tClustered: 0.1 },
    holdout: { n: 3, hit: 67, hitLo: 21, hitHi: 94, mean: -3.11, edge: -1.99, tClustered: 0, ...HOLD },
    verdict: "unproven",
    note: "Only 1 of 25 short cells qualified in training and its test-year edge is about zero. Shorts on all 3%+ gaps showed +1 to +1.7 in the test year but not in training, and 60-day shorts lose. No rule survives; holdout n=3.",
  },
  "covered-call-spike": {
    label: "Covered call after a big up day",
    rule: "Day up 5%+ on 1.5x volume, own the stock and sell a 2% OTM 30-day call, IV 1.6x historical, hold to expiry",
    cellsTried: 194,
    train: { n: 795, hit: 79, mean: 3.55, edge: 0.79, tClustered: 3.3 },
    oos: { n: 268, hit: 71, hitLo: 66, hitHi: 76, mean: 2.36, edge: 0.58, tClustered: 0.9 },
    holdout: { n: 29, hit: 59, hitLo: 41, hitHi: 74, mean: 0.78, edge: 0.05, tClustered: -0.9, ...HOLD },
    verdict: "unproven",
    note: "A small positive edge in training and test that vanishes in the holdout. It exists only at the highest IV bump; at IV 1.0x the calls lose 1.7 points to plain stock. Needs real option quotes.",
  },
  "cash-put-drop": {
    label: "Cash-secured put after a big down day",
    rule: "Day down 5%+ on 1.5x volume, sell a 10% OTM 14-day put against cash, IV 1.6x historical, hold to expiry",
    cellsTried: 194,
    train: { n: 896, hit: 96, mean: 0.59, edge: 0.01, tClustered: 1.8 },
    oos: { n: 301, hit: 94, hitLo: 91, hitHi: 96, mean: 0.83, edge: 0.23, tClustered: 1.7 },
    holdout: { n: 71, hit: 89, hitLo: 79, hitHi: 94, mean: 0.16, edge: -0.31, tClustered: -0.6, ...HOLD },
    verdict: "dead",
    note: "Edge over ordinary days was zero in training, +0.2 in the test year (not significant) and negative in the holdout (-0.3, 21% worst-loss tail). A high hit rate of small wins with rare large losses.",
  },
};
