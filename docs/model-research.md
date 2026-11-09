# Model research: do price shocks predict returns?

Plain summary of the backtests behind the `/model` page. Short version: almost nothing survives an honest out-of-sample test. The one exception is buying stocks after a big up day and holding about 10 days.

## Method

There is no historical news archive, so a "news event" is a price and volume shock found in daily bars. Four event types: gap up, gap down, day up, day down, with a move threshold and a volume multiple. Features computed from the bars:

- Abnormal move: stock move minus beta times the index move (S&P 500 for US stocks, ASX 200 for ASX). A big abnormal move suggests stock-specific news; a small one suggests a market-wide move.
- Volume multiple against the 20-day average.
- Run-up: return over the 20 days before the event.
- Market regime: index above or below its 200-day average.
- Close vs open on the event day (did the gap fade or hold).
- Likely earnings: inferred from volume spikes about 1, 2 or 4 quarters earlier. Yahoo only returns about 5 quarters of earnings history, so there is no real calendar. Used in the 10-year study only.

Trades: short or long stock, or a put or call (Black-Scholes estimate, historical volatility times 1.3 at entry). Trades on the same stock never overlap. "Edge" means average trade return minus the average return of the same trade on ordinary days. Statistics: Wilson 95% interval for the hit rate, t-statistic of the edge, bootstrap p-value, profit factor, max drawdown, and Benjamini-Hochberg false discovery control across grids.

Two studies:

1. **12-month walk-forward (the automatic tuner, `npm run model:train`).** 198 stocks (about 125 US liquid plus the ASX 50). For each of the last 12 months, the tuner picks the best of 400 sampled settings using the 3 years before that month, then trades that setting in the month. Reported accuracy uses only those trades. Run on 2026-11-08, test window 2025-11-06 to 2026-11-06.
2. **10-year grid (`scripts/model-research.ts`).** 83 stocks, 3,888 configurations, trained on the first 7 years and tested on the last 3.

## 12-month out-of-sample results (3 years of training before each month)

| Preset | Version | Trades | Hit rate (95% CI) | Average | Edge | p | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fade gap-ups (short) | default | 228 | 47% (41-53) | -0.46% | -0.25 | 0.50 | |
| | tuned | 12 | 33% (14-61) | -2.29% | -2.26 | 0.15 | no: only 12 trades |
| Buy puts after a spike | default | 146 | 23% (17-31) | -31.4% | +0.91 | 0.87 | |
| | tuned | 57 | 47% (35-60) | -0.03% | +0.16 | 0.79 | no: lost money |
| Buy gap-down panic | default | 149 | 52% (44-60) | +0.40% | -0.15 | 0.83 | |
| | tuned | 10 | 30% (11-60) | -3.67% | -3.96 | 0.16 | no: only 10 trades |
| Momentum: follow big up day (hold 10) | default | 223 | 53% (47-60) | +2.01% | +1.41 | 0.087 | |
| | tuned | 83 | 81% (71-88) | +3.23% | +1.82 | 0.002 | **yes** |

For contrast, the best settings chosen looking at the whole 3-year training span (in-sample, flattering): puts 63% hit and edge +2.15, panic 83% hit and edge +5.30 (n=41), fade-gap edge +1.04. None of that held out of sample. That gap is overfitting.

## 10-year study findings

- 3,888 configurations; 1,368 had enough trades to test. About 68 would pass p<0.05 by luck alone.
- In-sample winners (FDR q<0.1) mostly did not persist: only 42% kept a positive edge on the last 3 years, 9 reached p<0.05 out of sample, and 3 survived false discovery control.
- Momentum (day up 6% or more, volume 1.5x or more, buy next open) is the one robust family. Test-period edge by hold: 1-5 days nothing; 10 days +1.18 (hit 62%, p=0.03); 15 days +1.72 (p=0.014); 20 days +2.01 (p=0.018). It was positive in most calendar years, and in the test period 26 of 35 months were positive (t=2.5). It does not pass false discovery control on the full grid (q about 0.18).
- Filters on momentum: a run-up of 8% or more before the event destroyed the edge in test (train +3.4, test +0.01). Fading the day (closing back against the move) hurt. A bear-market filter looked good (test hit 75%, n=52) but is a few clustered crash-rebound months.

## What failed

- Selling the news (short after a gap up) and the put variant: no reliable edge in any window.
- Buying panic gap-downs: positive in some windows, not out of sample.
- Option trades: the baseline (a random day with the entry volatility bump crushed at exit) is about -28%, so "edge" over baseline is an artifact. Judge options by absolute average, which was negative or flat in every run.
- Every "best in-sample" setting for the three non-momentum families fell apart out of sample.

## Caveats

- Survivorship bias: only today's large caps, which flatters long trades.
- Option prices are estimates, not quotes. No fees, spreads, tax or short-borrow cost.
- Twelve months is a small sample; the tuner was blocked from promoting anything under 30 trades. Events cluster in time (crashes and rebounds), so the real number of independent observations is smaller than the trade count.
- The promoted momentum setting is "day up 4% or more, run-up 0 or less, index in a down-trend, hold 10 days, 6% target". Its 81% hit rate is helped by the 6% profit target, and the bear-regime filter selects few, clustered months. Treat it as a lead. The simple default (hold 10, no regime filter) has edge +1.41 and p=0.087 over the same 12 months.
- We tried 400 settings per family, so a lucky one always exists. Only the walk-forward row counts as accuracy.
- Multiple testing: the 10-year grid was corrected; the 12-month tuner uses a separate p<0.05 gate per family (four families), which is lenient.

## Recommended presets

- **Momentum**: hold 10 days (changed from 5 on the 10-year test-period evidence). Use the tuned version for the shown 12-month walk-forward result, with the caveats above. This is the only preset with out-of-sample support.
- **Fade gap-ups, buy puts, panic buy**: keep as hypotheses to explore, not as trade ideas. Nothing beat the baseline out of sample.
- Re-run `npm run model:train` periodically. It only replaces a preset when its out-of-sample result beats the baseline and the default, with at least 30 trades and p<0.05; otherwise it records why and keeps the defaults. The `/model` page's Auto-tune button does the same on the loaded stocks (load the 5Y period first).

## Strategy study: post-earnings drift and selling options after spikes

`npx tsx scripts/strategy-study.ts` (development) and `--holdout` (read once). Raw output in `research-out/strategy-study.txt`, `strategy-holdout.txt`. Presets: `earn-drift-up`, `earn-drift-down`, `covered-call-spike`, `cash-put-drop` (selectable in Model; rule cards on the Rules tab, `lib/strategy-rules.ts`).

Method: 198 large caps (146 US, 52 ASX), 10 years of cached bars. Train 2022-08 to 2025-08 (3 years), test 2025-08 to 2026-08-07 (12 months, the best training cell carried over unchanged, plus a monthly walk-forward that re-picks each month using only trades that had already exited), holdout from 2026-08-07 read once. Edge is measured against the same trade on ordinary days in the same calendar month, market and index-200-day regime. The t-test is month-clustered (monthly mean edges), since events bunch in time. 194 cells tried: 50 earnings (long/short x 5 size buckets x holds 5, 10, 20, 40, 60) and 144 options (call/put x trigger 5% or 8% x IV bump 1.0, 1.3, 1.6 x strike 2, 5, 10% OTM x expiry 7, 14, 30, 45 days). Costs: stock 10 bps round trip; sold options give up 10% of the premium to the spread (assumption: a 20%-wide quote on liquid large-cap options); no borrow cost, tax or early assignment.

### Post-earnings drift: unproven

- Yahoo has no earnings history (`earningsHistory` returns the last four quarters), so an earnings day is the proxy from the momentum study, now in `lib/model.ts` (`earn-up`, `earn-down`): a gap on 2x volume with another volume spike 1, 2 or 4 quarters earlier. The gap direction stands in for the surprise sign. Entry is the next open.
- Best training cell (long, gaps of 3-5%, 60 days): train n=191, edge +2.26, clustered t 2.3; test year n=58, hit 53%, mean +4.4, edge +1.3, clustered t 0.2; holdout n=2 (finished trades only). Short side: 1 of 25 cells qualified in training; test edge about 0; holdout n=3.
- Size matters for longs only at the top: 12%+ gaps had test edge +5.6 to +7.0 at 10-20 days, but n was 16-17 (train n 46-47, edge +2.4 to +3.2). Shorts on all 3%+ gaps showed +1.0 to +1.7 in the test year though training was about zero.
- Nothing passes Benjamini-Hochberg q<0.05 on training. Costs of 0, 10, 25 bps make no difference.

### Selling options after spikes: unproven (calls), dead (puts)

- Covered call after a 5%+ up day (2% OTM, 30 days, IV 1.6x): train n=795, hit 79%, edge +0.79, clustered t 3.3; test n=268, hit 71%, mean +2.4, edge +0.58, clustered t 0.9; holdout n=29, hit 59%, mean +0.8, edge +0.05. Assigned 45% of the time, premium yield 5.8%. Worst trade -27%.
- Cash-secured put after a 5%+ down day (10% OTM, 14 days, IV 1.6x): train n=896, hit 96%, edge +0.01; test n=301, hit 94%, mean +0.8, edge +0.23, clustered t 1.7; holdout n=71, hit 89%, mean +0.2, edge -0.31. Assigned 7%, premium yield 1.2%. Worst trade -22%.
- Everything depends on the assumed implied vol. Pooled over strikes and expiries in the test year, covered-call return minus plain stock was -1.7 (IV 1.0x), -0.9 (1.3x), 0.0 (1.6x); put minus cash -0.4, +0.3, +1.1. At fair pricing there is no premium to harvest; at a rich bump the sellers collect it, but the bump is the one input these data cannot check. Doubling the haircut to 25% turns the covered call's +0.7 over the stock into -0.7.
- The best cells sit at the top of the IV range, which is selection toward the assumption. Real quotes (after-spike IV) are needed to decide this.
