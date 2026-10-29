# Bellwether - ASX dashboard

An open-source, no-login dashboard for the Australian Securities Exchange. It runs on one screen (built for 1600x900), has a dark theme by default with a light toggle, and keeps your watchlist in your own browser.

![Bellwether home page](docs/screenshot.png)

## Features

- **Market overview** - tiles for the ASX 200, All Ordinaries and AUD/USD with price, change, % change and an intraday sparkline.
- **Movers** - tabs for Gainers, Losers and Most active (ranked by traded value, ignoring very thinly traded lines) across a hand-maintained ASX 200 list (`data/asx200.ts`).
- **Sector heatmap** - average % change per GICS sector.
- **Stock detail** (`/stock/BHP`) - price and volume chart with 1D, 5D, 1M, 6M, YTD, 1Y and 5Y ranges; key stats (market cap, P/E, dividend yield, 52-week range, volume vs average, sector); recent news; watchlist toggle.
- **Search** - header autocomplete limited to ASX stocks and ETFs.
- **Market status** - open/closed badge computed for 10:00-16:00 `Australia/Sydney` on weekdays using `Intl` (correct across AEST/AEDT). National ASX holidays (with substitute days) show "Closed - holiday name", and Christmas Eve and New Year's Eve close early at 14:10. Quotes auto-refresh every 60 seconds, only while the market is open.
- **Watchlist** - stored in `localStorage`; nothing is sent to a server.
- Gains and losses use green and red plus arrows and +/- signs, so colour is never the only signal.

## Stack

Next.js (App Router, TypeScript), Tailwind CSS, Recharts, [`yahoo-finance2`](https://github.com/gadicc/yahoo-finance2) (server-side only, from `app/api/*` route handlers), Vitest. No database: an in-memory TTL cache (60s for quotes, 10 minutes for long-range history, 15 minutes for news and search) keeps Yahoo traffic low.

## Setup

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev        # http://localhost:3000
```

Other commands:

```bash
npm run build           # production build
npm start               # serve the production build
npm test                # unit tests (market hours, cache, aggregation helpers)
npm run lint
npm run verify-tickers  # check every ticker in data/asx200.ts resolves on Yahoo
npm run verify-tickers -- --prune   # ...and delete the ones that do not
```

No environment variables are required. `.env.example` lists optional cache-lifetime overrides.

### API routes

| Route | Purpose |
| --- | --- |
| `/api/overview` | index/FX quotes with intraday sparkline data |
| `/api/quotes?symbols=BHP.AX,CBA.AX` | batched quotes (max 60 symbols) |
| `/api/movers` | gainers, losers, most active and sector averages |
| `/api/stock/[code]` | quote, key stats and sector for one ASX code |
| `/api/chart?symbol=BHP.AX&range=1M` | price and volume history |
| `/api/news?code=BHP` | recent headlines |
| `/api/search?q=bhp` | ASX-only search |

Errors come back as JSON `{ error, message }` with an appropriate status (400, 404, 429 for upstream rate limits, 502 for upstream failures), and the UI shows a message with a Retry button instead of crashing.

## About the ASX 200 list

`data/asx200.ts` is a hand-maintained, approximate snapshot (see the as-of date in the file), not the official S&P/ASX 200 membership. Run `npm run verify-tickers` after editing it.

## Disclaimer

Market data comes from Yahoo Finance through an unofficial, undocumented API. It can be delayed by about 20 minutes, incomplete, wrong, or stop working at any time. This project is for personal and educational use only. **Nothing here is financial advice.** It is not affiliated with or endorsed by the ASX or Yahoo. Check Yahoo's terms of use before deploying it publicly.

## Licence

MIT, copyright 2026 faithrf. See [LICENSE](LICENSE).
