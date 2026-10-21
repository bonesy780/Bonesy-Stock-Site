# Market Leaders

A static website showing the top 10 stocks in the S&P 500, Nasdaq-100, Dow Jones, TSX (S&P/TSX Composite), Nikkei 225, KOSPI 200 and Taiwan 50, plus buy ideas and stocks to watch in the coming week.

- `scripts/build_data.py` pulls prices, analyst ratings and market caps from Yahoo Finance (via yfinance) and writes `site/data.json`.
- `scripts/build_news.py` gathers the top news stories for each market into `site/news.json`.
- `scripts/build_history.py` saves price history for every stock (5-minute prices for 5 days, daily back to listing) into `site/hist/` and the search list into `site/stocks.json`.
- `site/` is the website (plain HTML, CSS and JS): `index.html` for stocks, `stock.html` for the stock lookup and `news.html` for market news.
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
