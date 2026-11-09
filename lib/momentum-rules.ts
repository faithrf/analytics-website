/**
 * Rule card for "buy after a big up day", from scripts/momentum-study.ts (10 years, 198 large caps,
 * last 3 months held out). Numbers are edge in percentage points over the same trade on ordinary days.
 * Full write-up: docs/momentum-rules.md.
 */
export type RuleVerdict = "matters" | "small" | "none" | "hurts";

export interface MomentumRule {
  rule: string;
  setting: string;
  verdict: RuleVerdict;
  why: string;
}

export const MOMENTUM_RULES: MomentumRule[] = [
  {
    rule: "Trigger",
    setting: "Close up 8% or more on the day",
    verdict: "matters",
    why: "Edge grows with the threshold: 4% +0.1, 6% +0.7, 8% +1.5, 10% +2.5 (10-day hold). No spike, a slope.",
  },
  {
    rule: "Gap vs rally",
    setting: "Close-to-close or a gap-up; avoid an intraday-only rally",
    verdict: "matters",
    why: "Gap-up +1.1, close-to-close +0.7, intraday rally with no gap -0.8.",
  },
  {
    rule: "Entry",
    setting: "Buy the next open",
    verdict: "matters",
    why: "Next open +0.7 vs event close -0.1. A 1-3% pullback limit adds nothing and skips trades.",
  },
  {
    rule: "Hold",
    setting: "20 trading days",
    verdict: "matters",
    why: "3-7 days lose (-0.2 to -0.5); 10 +0.7; 15 +1.1; 20 +1.6; 30 +1.7. Plateau from 15 to 30.",
  },
  {
    rule: "Exit",
    setting: "Time exit only: no stop, no target, no trailing stop",
    verdict: "hurts",
    why: "Every target cut winners (3% target +0.1 vs +0.7 none). Stops of 3-15% and trailing stops did worse than none. Median worst dip before exit is -4.4%, so tight stops get hit by noise.",
  },
  {
    rule: "Volume spike",
    setting: "Not needed",
    verdict: "none",
    why: "No volume filter +1.1 (10 of 10 years positive); 1.5x +0.7; 2x +0.4. Filtering only removes trades.",
  },
  {
    rule: "Abnormal move vs index",
    setting: "Not needed",
    verdict: "none",
    why: "Stock-specific vs market-wide made no difference (+0.6 to +0.8 for any cut-off).",
  },
  {
    rule: "Close location, first day, 52-week high, earnings",
    setting: "Not needed",
    verdict: "none",
    why: "No reliable difference. Faded closes looked better (+1.9, n=284) but that is the reverse of the usual story; treat as noise.",
  },
  {
    rule: "Run-up before the event",
    setting: "Optional: skip a 10-20% run-up",
    verdict: "small",
    why: "10-20% prior run-up -0.4; 20-day return of 0% or less +0.9. Small and uneven.",
  },
  {
    rule: "Market regime",
    setting: "Optional: index below its 200-day average",
    verdict: "small",
    why: "With a regime-matched baseline the extra is about +1 point (T8, 20 days: +3.9 any, +4.9 index below 200-day) for 40% of the trades.",
  },
  {
    rule: "Market and liquidity",
    setting: "US large caps; most liquid third",
    verdict: "small",
    why: "US +4.4 vs ASX +2.2 (T8, 20 days). Top liquidity third +1.4 vs bottom third +0.2.",
  },
  {
    rule: "Expression",
    setting: "Shares, not calls",
    verdict: "hurts",
    why: "Estimated calls lose on average (-7% to -30% per trade at 1.3x IV); they only win if you assume no IV premium.",
  },
];

export const MOMENTUM_STUDY = {
  rule: "Day up 8%+, buy next open, hold 20 days, no stop or target",
  dev: { n: 1217, hit: 66, hitLo: 63, hitHi: 69, mean: 5.23, edge: 3.87 },
  exTwentyTwenty: { n: 852, edge: 2.0 },
  holdout: {
    n: 15,
    hit: 27,
    hitLo: 11,
    hitHi: 52,
    mean: -6.05,
    edge: -5.57,
    from: "2026-08-07",
    to: "2026-11-06",
  },
  verdict:
    "Strong in 10 years of development data, but it failed the single untouched 3-month holdout (15 trades, falling market). Not confirmed, so the preset was not changed.",
} as const;
