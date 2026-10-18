# Market Leaders

A static website showing the top 10 stocks in the S&P 500, Nasdaq-100, Dow Jones, S&P/TSX 60, Nikkei 225, KOSPI 200 and Taiwan 50, plus buy ideas and stocks to watch in the coming week.

- `scripts/build_data.py` pulls prices, analyst ratings and market caps from Yahoo Finance (via yfinance) and writes `site/data.json`.
- `site/` is the website (plain HTML, CSS and JS).
- `.github/workflows/update.yml` rebuilds the data every weekday after the US close and on Sundays, then deploys to GitHub Pages.

Ranking: 3-month performance (50%), analyst consensus (30%), market cap (20%). Stocks under $5 (USD equivalent) or under $300M market cap are excluded.

Run locally:

```
pip install -r requirements.txt
python scripts/build_data.py
python -m http.server -d site
```

Not financial advice.
