# Market Leaders

A static website showing the top 10 stocks in the S&P 500, Nasdaq-100, Dow Jones, TSX (S&P/TSX Composite), Nikkei 225, KOSPI 200 and Taiwan 50, plus buy ideas and stocks to watch in the coming week.

- `scripts/build_data.py` pulls prices, analyst ratings and market caps from Yahoo Finance (via yfinance) and writes `site/data.json`.
- `scripts/build_news.py` gathers the top news stories for each market into `site/news.json`.
- `scripts/build_history.py` saves price history for every stock (5-minute prices for 5 days, daily back to listing, thinned to weekly and monthly further back while keeping each stretch's highest and lowest close) into `site/hist/`. Prices are the actual traded closes, adjusted for splits but not dividends and the search list into `site/stocks.json`.
- `scripts/build_market.py` saves facts on every stock in the seven indexes (price moves, volume, valuation, dividends, analyst views, next earnings date) into `site/market.json`, plus a company profile and financial figures per stock in `site/fund/`. The tool pages (watchlists and the rest) read these.
- `site/` is the website (plain HTML, CSS and JS): `index.html` for stocks, `stock.html` for the stock lookup and `news.html` for market news, `watchlist.html` for watchlists (with your own notes and target price per stock, and CSV download) and `movers.html` for market movers (gainers, losers, most active, unusual volume, gaps, 52-week highs and lows, with market breadth) and `screener.html`, a stock screener with ready-made screens, 35 filters, saved screens, shareable links and CSV download, and `heatmap.html`, a treemap of each market grouped by sector and sized by market cap, and `backtest.html`, which replays a portfolio of up to five stocks or indexes from any start year with monthly additions and rebalancing, against an index, and `analysts.html`, which ranks stocks by analyst rating and gap to price target and shows the consensus by sector, and `dividends.html`, which lists high-yield and steady dividend payers, upcoming ex-dividend dates and payouts that look at risk (from payout ratio, debt, earnings and price trend), with an income planner, and the lookup lists similar companies (same industry, closest in size) with a link to compare them, and the heatmap page also has a sector performance grid across periods from a day to a year, and `compare.html`, which charts up to five stocks or indexes as % change and lines up their figures. Each market card on the home page says whether that exchange is open now and when it next opens or closes (regular hours only, no holidays). `common.js` holds the shared menu, the trading-hours table, the header's quick stock search and the watchlist store; watchlists are saved in the reader's browser (localStorage), so they stay on that device. The lookup chart can add technical indicators (SMA 20/50/200, EMA 20/50, Bollinger Bands, volume, RSI and MACD), which the browser works out from the saved closing prices and volumes. It can also overlay any of the seven market indexes, switching the chart to % change so they line up.
- `portfolio.html` is paper trading: pretend cash (several portfolios), market, limit and stop orders at the site's latest prices, or recorded past trades to track real holdings. Positions, gains, sector allocation, value over time and trade history are kept in the browser. A check-up shows the weighted beta, forward P/E, yield and volatility, the spread by region, currency and sector, and notes on concentration.
- The stock lookup page has a Company and financials section (`fund.js`): a plain-language summary of the numbers, company profile, valuation, profit, financial health, dividends, trading figures, and the analyst rating with price-target range.
- `alerts.html` sets price alerts (rises to, falls to, or moves a set % in a day). `common.js` checks them every minute on any page of the site while it is open and shows an on-page and optional browser notification.
- `signals.html` lists stocks that just triggered chart signals (golden and death crosses, crossing the 50- and 200-day averages, MACD crossovers, 20-day breakouts and breakdowns, volume surges, RSI extremes, Bollinger squeezes), worked out by `build_market.py`.
- `calendar.html` shows upcoming earnings reports and ex-dividend dates by week, filterable by market or your watchlists.
- `tools.html` holds calculators: position size from risk, profit and loss, average cost, dividend income with reinvesting, compound growth, TFSA versus RRSP, retirement savings and income, margin and margin-call price, recovering from a loss, options payoff and currency conversion.
- `.github/workflows/update.yml` rebuilds the data every weekday after the US close and on Sundays, then deploys to GitHub Pages.

## Live prices

GitHub Pages can only serve files, so live prices come from a small Cloudflare Worker in `worker/` that fetches quotes from Yahoo Finance and caches them for 20 seconds. The pages (`site/live.js`) ask it for fresh prices every 30 seconds (main page) or every minute (stock lookup) while the tab is open. Rankings, buy and sell ideas and longer price history still refresh with the daily build. Some exchanges' prices reach Yahoo up to 20 minutes late.

To turn it on (free Cloudflare plan is enough):

1. Sign up at cloudflare.com, open **Workers & Pages** once so your `workers.dev` subdomain is created, and copy your **Account ID** from that page.
2. Create an API token at **My Profile > API Tokens > Create Token** using the **Edit Cloudflare Workers** template.
3. In this repo's **Settings > Secrets and variables > Actions**, add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Run the **Update data and deploy** workflow. It deploys the worker and points the site at it.

To use a price service hosted somewhere else, set the repo variable `LIVE_API_URL` to its address instead. Without either, the site shows the saved prices from the last build.

Ranking: 3-month performance (50%), analyst consensus (30%), market cap (20%). Penny stocks (under $1 USD equivalent or under $300M market cap) are excluded. Big Asian companies often trade below $5 a share, so a $5 cutoff would drop blue chips.

Run locally:

```
pip install -r requirements.txt
python scripts/build_data.py
python -m http.server -d site
```

Not financial advice.
