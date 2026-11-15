# TopTicker

The home page (`site/index.html`) asks whether you want the **stock market** or **real estate**, and can remember the choice (the logo link always shows the choice again).

The stock side is a static website showing the top 10 stocks in the S&P 500, Nasdaq-100, Dow Jones, TSX (S&P/TSX Composite), TSX Venture (the 250 largest Venture companies, from the Yahoo screener), Nikkei 225, KOSPI 200 and Taiwan 50, plus buy ideas and stocks to watch in the coming week.

- `scripts/build_data.py` pulls prices, analyst ratings and market caps from Yahoo Finance (via yfinance) and writes `site/data.json`.
- `scripts/build_news.py` gathers the top news stories for each market into `site/news.json`, plus top stories from the Wall Street Journal, Financial Times, Bloomberg, Reuters, CNBC, Yahoo Finance, MarketWatch, The Economist, Forbes and Investing.com (each outlet's own RSS feed where it has one, otherwise Google News results limited to that site). The news page shows them under "Top stories" with a filter by outlet, and an "All markets" tab merges every market's stories.
- `scripts/build_history.py` saves price history for every stock (5-minute prices for 5 days, daily back to listing, thinned to weekly and monthly further back while keeping each stretch's highest and lowest close) into `site/hist/`, plus `site/trends.json` with a 30-point closing-price line per stock for each longer screener trend period. Prices are the actual traded closes, adjusted for splits but not dividends and the search list into `site/stocks.json`.
- `scripts/build_market.py` saves facts on every stock in the eight indexes (price moves, volume, valuation, dividends, analyst views, next earnings date) into `site/market.json`, plus a company profile and financial figures per stock in `site/fund/`. The tool pages (watchlists and the rest) read these.
- `scripts/build_ratings.py` saves, for each stock analysts cover, the past year of rating changes by firm (upgrades, downgrades, new coverage, with price targets) and the monthly count of Strong Buy to Strong Sell ratings into `site/ratings/`, shown as "Who rates it" on the stock lookup.
- `site/` is the website (plain HTML, CSS and JS): `index.html`, the stocks-or-real-estate choice, `news.html` for market news, `markets.html` for the top stocks, `stock.html` for the stock lookup, `watchlist.html` for watchlists (with your own notes and target price per stock, and CSV download) and `movers.html` for market movers (gainers, losers, most active, unusual volume, gaps, 52-week highs and lows, most shorted, oversold and overbought, with market breadth) and `screener.html`, a stock screener with ready-made screens, 35 filters, saved screens, shareable links and CSV download (its trend column can show 1 month, 6 months, 12 months, year to date, 5 years, 10 years or all time), and `brief.html`, a daily brief written from the data (markets, breadth, sectors, big moves, highs, lows and signals, your watchlist and the week ahead), and `heatmap.html`, a treemap of each market grouped by sector and sized by market cap, and `backtest.html`, which replays a portfolio of up to five stocks or indexes from any start year with monthly additions and rebalancing, against an index, and `options.html`, an options strategy builder (calls, puts and shares, ten ready-made strategies, Black-Scholes premium estimates, payoff at expiry and today, break-evens, chance of profit and Greeks), and `analysts.html`, which ranks stocks by analyst rating and gap to price target and shows the consensus by sector, and `dividends.html`, which lists high-yield and steady dividend payers, upcoming ex-dividend dates and payouts that look at risk (from payout ratio, debt, earnings and price trend), with an income planner, and the lookup shows returns from 1 month to 10 years (with the yearly rate for 3 years and longer) and lists similar companies (same industry, closest in size) with a link to compare them, and the heatmap page also has a sector performance grid across periods from a day to a year, and `earnings.html`, which lists who reports earnings today, tomorrow, over the next 7 days and over the next 30 days (report time before the open or after the close, confirmed or estimated date, how the stock has done going in and what analysts expect, with a reports-per-day chart), and `compare.html`, which charts up to five stocks or indexes as % change and lines up their figures. Each market card on the Markets page says whether that exchange is open now and when it next opens or closes (regular hours only, no holidays). Every page has a market clock strip under the menu: one toggle per market (TSX, TSX Venture, S&P 500, Nasdaq, Dow, Nikkei, KOSPI, Taiwan), and each one switched on shows a live countdown to that exchange's next open or close. The choice is saved in the browser. `common.js` holds the shared menu, the trading-hours table, the header's quick stock search and the watchlist store; watchlists are saved in the reader's browser (localStorage), so they stay on that device. The lookup chart can add technical indicators (SMA 20/50/200, EMA 20/50, Bollinger Bands, volume, RSI and MACD), which the browser works out from the saved closing prices and volumes. It can also overlay any of the eight market indexes, switching the chart to % change so they line up. Besides the preset ranges (1D to All), a Custom range charts any start and end date the reader picks, remembered in the browser.
- `portfolio.html` is paper trading: pretend cash (several portfolios), market, limit and stop orders at the site's latest prices, or recorded past trades to track real holdings. Positions, gains, sector allocation, value over time and trade history are kept in the browser. A check-up shows the weighted beta, forward P/E, yield and volatility, the spread by region, currency and sector, and notes on concentration.
- The stock lookup page has a Company and financials section (`fund.js`): a plain-language summary of the numbers, company profile, valuation, profit, financial health, dividends, trading figures, and the analyst rating with price-target range.
- `alerts.html` sets price alerts (rises to, falls to, or moves a set % in a day). `common.js` checks them every minute on any page of the site while it is open and shows an on-page and optional browser notification.
- `signals.html` lists stocks that just triggered chart signals (golden and death crosses, crossing the 50- and 200-day averages, MACD crossovers, 20-day breakouts and breakdowns, volume surges, RSI extremes, Bollinger squeezes), worked out by `build_market.py`.
- `calendar.html` shows upcoming earnings reports and ex-dividend dates by week, filterable by market or your watchlists.
- `tools.html` holds calculators: position size from risk, profit and loss, average cost, dividend income with reinvesting, compound growth, TFSA versus RRSP, retirement savings and income, margin and margin-call price, recovering from a loss, options payoff and currency conversion.
- `ask.html` ("Ask me") answers questions about how the site gets its data. Its notes are in `site/ask-kb.json`, one entry per topic, written from the build scripts; update them when a data source or formula changes. Without an Anthropic API key the page matches the question to the closest note. With one, the live price service's `/ask` route passes the question and the notes to Claude, which answers in its own words (see below).
- `.github/workflows/update.yml` rebuilds the data every weekday after the US close and on Sundays, then deploys to GitHub Pages.

## Real estate

`site/re/` is the real estate side, covering the United States, Canada and Mexico. `scripts/build_realestate.py` builds its data into `site/re/` (`data.json`, `hist.json`, `listings.json`, `news.json`) from free public sources, each optional so one failing source doesn't stop the rest:

- **US metro areas (150 biggest):** Zillow Research CSVs: typical home value (ZHVI), rent (ZORI), homes for sale, new listings, list and sale prices, days to pending, price cuts, sale-to-list ratio, market heat index and Zillow's 12-month forecast. If Zillow moves a file, the script looks for it on Zillow's data page.
- **Canada:** Statistics Canada's New Housing Price Index by city (table 18-10-0205) and CMHC average two-bedroom rents (table 34-10-0133), plus the Bank of Canada's 5-year mortgage and policy rates (Valet API). Canada's resale figures (CREA MLS® HPI) are licensed, so they are not used.
- **Mexico:** Sociedad Hipotecaria Federal's quarterly prices by state, kept by hand in `data/realestate/mexico_shf.csv` and `mexico_shf_meta.json` because SHF only publishes PDF and Excel. Update both after each quarterly release.
- **All three:** the BIS house price index for each country (through DBnomics, with FRED as a backup), exchange rates from the Bank of Canada, and FRED for US mortgage rates, Case-Shiller and other US series. FRED's public download sometimes stalls for GitHub's servers; a free FRED API key (fred.stlouisfed.org, *My Account > API Keys*) added as the repo secret `FRED_API_KEY` makes it reliable.
- **News:** Google News searches on each country's housing market.

Pages: `re/index.html` (overview: country cards, rates, top 10 lists, buy ideas, markets to watch, a three-country price chart and Mexico by state), `re/markets.html` (every market in a filterable table with CSV download), `re/market.html` (one market: history chart, supply and speed, a buyer's-or-seller's gauge, own-versus-rent, similar markets and links to the listing sites), `re/listings.html`, `re/compare.html`, `re/tools.html` (mortgage payment, affordability and rent-versus-buy for each country) and `re/news.html`. `re/re-common.js` holds the shared menu, market search, table and chart.

**Listings.** MLS, REALTOR.ca and Mexican portal listings are licensed and can't be copied onto the site, so the listings page links out to them. For real US listings, sign up for a free [RentCast](https://www.rentcast.io/api) API key and add it as the repo secret `RENTCAST_API_KEY`. The free plan allows 50 requests a month, so the build fetches 10 big US cities once a week and saves them in `data/realestate/listings.json`; check RentCast's terms before making the site public with them. Without a key, and for Canada and Mexico, the page shows homes clearly marked **Sample**, priced from each market's real typical value.

## Live prices

GitHub Pages can only serve files, so live prices come from a small Cloudflare Worker in `worker/` that fetches quotes from Yahoo Finance and caches them for 20 seconds. The pages (`site/live.js`) ask it for fresh prices every 30 seconds (main page) or every minute (stock lookup) while the tab is open. Rankings, buy and sell ideas and longer price history still refresh with the daily build. Some exchanges' prices reach Yahoo up to 20 minutes late.

To turn it on (free Cloudflare plan is enough):

1. Sign up at cloudflare.com, open **Workers & Pages** once so your `workers.dev` subdomain is created, and copy your **Account ID** from that page.
2. Create an API token at **My Profile > API Tokens > Create Token** using the **Edit Cloudflare Workers** template.
3. In this repo's **Settings > Secrets and variables > Actions**, add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Run the **Update data and deploy** workflow. It deploys the worker and points the site at it.

To use a price service hosted somewhere else, set the repo variable `LIVE_API_URL` to its address instead. Without either, the site shows the saved prices from the last build.

## Claude answers on the Ask page

To have Claude answer questions on the Ask page (instead of the built-in notes alone), set up the live price service above, create an API key at console.anthropic.com, and add it as the repo secret `ANTHROPIC_API_KEY`. The next run of the workflow stores it in the Cloudflare Worker. Each question is billed to that key; the worker only accepts questions from the site itself, caps each visitor at 6 questions a minute and 60 a day, and asks for short answers. Delete the secret (and the Worker's `ANTHROPIC_API_KEY` secret in Cloudflare) to switch it off.

Ranking: 3-month performance (50%), analyst consensus (30%), market cap (20%). Penny stocks (under $1 USD equivalent or under $300M market cap) are excluded. Big Asian companies often trade below $5 a share, so a $5 cutoff would drop blue chips.

Run locally:

```
pip install -r requirements.txt
python scripts/build_data.py
python -m http.server -d site
```

Not financial advice.
