# Momentum rules: "buy after a big up day"

Study script: `scripts/momentum-study.ts` (run `npx tsx scripts/momentum-study.ts`; add `--holdout` for the one-time holdout read). Raw output lives in `research-out/` (gitignored). Rule card in the app: `/model`, momentum preset, Rules tab (`lib/momentum-rules.ts`).

## Bottom line

The rule looked strong in 10 years of development data, then **failed the single untouched 3-month holdout**. So it is not confirmed. The momentum preset in `lib/model.ts` was **not** changed to this rule.

## Rule card (the candidate)

- **Entry trigger:** the stock closes up 8% or more on the day (close vs previous close).
- **Entry:** buy at the next day's open.
- **Filters:** none required. Optional: US large caps, index below its 200-day average (adds about 1 point of edge for 40% of the trades).
- **Exit:** sell on the close of trading day 20 after entry. No stop, no profit target, no trailing stop.
- **Sizing:** equal weight, each position 1/10 of equity, at most 10 at once, at most one open trade per stock. Round-trip costs of 10-25 bps cost about 1-2 points of CAGR.

## Method

198 large caps (146 US, 52 ASX 50 names), daily bars Nov 2016 to Nov 2026. The last 3 months (2026-08-07 to 2026-11-06) were set aside and never read during development; events within 45 days of it were dropped from development so no trade reaches into it. Edge means the trade return minus the average return of the same exit rule entered on ordinary days in the same year and market (regime-matched when a regime filter is used). Each dimension was varied with the others held at a base setting: base A is the 12-month tuner's promoted setting; base B is a plain rule (day up 6%, volume 1.5x, hold 10). Stability checks per level: first 70% vs last 30% of development, years positive, US vs ASX. p-values are t-tests on edge and are optimistic, because events cluster in time.

## Evidence per rule (edge in percentage points; plain base unless stated)

| Dimension | Result | Verdict |
| --- | --- | --- |
| Threshold | 2% -0.2, 4% +0.1, 6% +0.7, 8% +1.5, 10% +2.5 (10-day hold); a slope, no spike | Matters |
| Hold (6% rule) | 3d -0.3, 5d -0.5, 7d -0.2, 10d +0.7, 15d +1.1, 20d +1.6, 30d +1.7 | Matters: plateau 15-30 |
| Threshold x hold heatmap | Edge rises steadily with both; no isolated spike; best cells are the least-frequent (10%, 30 days: +4.9, 520 trades) | Plateau, not a spike |
| Entry | Next open +0.7; event close -0.1; pullback limit 1% +0.6, 2% +0.2, 3% +0.2 | Next open |
| Gap vs rally | Gap-up +1.1, close-to-close +0.7, intraday rally with no gap -0.8 | Matters |
| Targets | None +0.7; 3% +0.1; 6% +0.3; 10% +0.4; 15% +0.6 | Hurts |
| Stops | None +0.7; 3% -0.1; 5% +0.1; 8% +0.2; 15% +0.3 | Hurts |
| Trailing stop | 5% -0.2; 8% +0.1; 10% +0.0 | Hurts |
| Volume multiple | None +1.1 (10 of 10 years); 1x +0.9; 1.5x +0.7; 2x +0.4; 3x +0.5 | No effect (filtering removes trades) |
| Abnormal move vs index | Any cut-off from 1 to 4: +0.6 to +0.8 | No effect |
| Close location in range | Near the high (0.9+) +0.2; faded (under 0.5) +1.9 (n=284) | Odd and unexplained; ignore |
| First big day, 52-week high, likely earnings | Within noise of each other | No effect |
| Run-up (20 days before) | 10-20% run-up -0.4; 0% or less +0.9; others +0.4 to +1.0 | Small |
| Regime (regime-matched baseline) | Above 200-day +0.5; below +0.9. At 8%/20 days: +3.9 with no filter, +4.9 below the 200-day | Small |
| VIX and index drawdown | VIX 20-30 and drawdown over 10% looked best (+1.9) but the baseline is not regime-matched, so they are overstated | Not trusted |
| Market | US +0.9, ASX -0.3 (plain); at 8%/20 days US +4.4, ASX +2.2. ASX sector cells have 10-60 trades | US stronger |
| Price and liquidity | Most liquid third +1.4, least liquid third +0.2; price under 20 +1.3, over 100 +0.4 | Small |
| Sector | Not tested for US (no sector data). ASX sector cells too small | Not tested |
| Calls instead of shares | At 1.3x IV bump every strike/expiry lost on average (-7% to -30% per trade); only a 1.0x (no premium) assumption was positive | Shares |
| Excursions | Median worst dip before exit -4.4%; 10th percentile -14.5%; worst -53%. A 6% target is reached in 43% of trades, median 3 days | Tight stops get noise-hit |

## Portfolio view (development, candidate rule)

| Max positions | CAGR 0 / 10 / 25 bps | Sharpe | Max drawdown | Exposure |
| --- | --- | --- | --- | --- |
| 5 | 20.4% / 19.3% / 17.6% | 0.93 / 0.89 / 0.82 | 37% | 78% |
| 10 | 20.8% / 19.9% / 18.6% | 1.09 / 1.05 / 0.99 | 44% | 62% |
| 20 | 13.9% / 13.4% / 12.6% | 0.95 / 0.92 / 0.88 | 33% | 39% |

S&P 500 buy-and-hold over the same period: CAGR 13.4%, Sharpe 0.78, max drawdown 34%. ASX 200: 5.0%, Sharpe 0.40. The strategy is mostly long US large caps, so part of the return is market beta, and a 44% drawdown at 10 positions is bigger than the index.

## Robustness

- **Random-entry test (2,000 draws, same exit rule):** observed mean +5.23% against +2.57% for random days in the same stock and year, and +1.30% for random days anywhere in the same year and market. Fewer than 0.1% of draws matched it. The first comparison is the fairer one for survivorship (today's winners).
- **Leave-one-year-out:** edge +3.87 overall. Without 2020 (a crash and rebound, 365 of the 1,217 trades) it is +2.00 on 852 trades. Every year was positive except 2019 (-0.21).
- **Clustering:** by calendar month the edge averages +1.1 with t=1.6, and 70 of 115 months were positive. That is much weaker than the pooled t-statistic of 9.4, which treats trades as independent.
- **Multiple testing:** about 313 rows and cells were evaluated. The best of that many independent tests reaches t of about 3.4 by luck. The candidate's pooled t is above that, but the month-clustered t is not, so the evidence is thinner than the headline.
- **Walk-forward:** first 70% of development edge +4.2, last 30% +3.1.
- **Secondary check, 12 months before the holdout (2025-06 to 2026-06):** 144 trades, hit 53% (45-61), average +3.5%, edge +2.4, p=0.125. Positive, not statistically solid.

## Holdout result (read once)

2026-08-07 to 2026-11-06, the candidate rule: 15 trades, hit rate 27% (11-52), average -6.05%, median -5.50%, edge -5.57 points (p=0.037, on the wrong side). The market fell in that window (S&P 500 about -18% annualised, 3 months). Portfolio at 10 positions: CAGR -31.5%, Sharpe -3.4, max drawdown 9% over the three months (annualised figures on 3 months are noise). Only 15 trades have a 20-day exit inside the data, so this is a small sample, but it is the one clean out-of-sample read and it went the wrong way.

## When it fails

- Falling markets that keep falling: buying a big up day in a downtrend that does not turn (the holdout window).
- Quiet markets: below a 6% threshold and under 10-day holds there is no edge at all.
- When it works it works partly because crashes rebound: 2020 supplied a third of the trades and half of the edge.
- Illiquid or small stocks: the least liquid third showed about zero edge.

## What mattered and what did not

Mattered: threshold size, hold length (15-30 days), buying the next open, having no stops or targets (they cut winners), shares rather than calls.
Did not matter: volume spike, abnormal move vs index, close location, first big day vs repeated, 52-week-high breakout, earnings-like days.

## Caveats

- Survivorship: only today's large caps; winners are over-represented, which flatters any long rule.
- No fees beyond the 0-25 bps shown, no slippage on gap opens, no tax. A day-up of 8% often opens with a gap; the next-open fill is optimistic for illiquid names.
- Option prices are estimates.
- Earnings detection is inferred from volume patterns, not a calendar.
- US sector effects were not tested; ASX sector cells are tiny.
- Results are one history. A 3-month holdout with 15 trades cannot confirm or kill a rule; it says this one is unproven.

## Preset decision

Not updated. The existing momentum preset (hold 10, from the earlier 10-year study) and the tuned data file are unchanged. Two earlier-looking choices are now questioned: the tuned 12-month setting uses a 6% profit target, which this study found cuts the edge, and its bear-regime filter adds little once the baseline is regime-matched. Rerun `npm run model:train` after adding 20- and 30-day holds to the tuner's search if you want it to consider them, and treat any new holdout as the real test.
