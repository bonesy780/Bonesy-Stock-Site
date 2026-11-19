"""Write site/sitemap.xml: every page, plus one lookup page per stock and per housing market.

Search engines find the stock and housing-market lookups (stock.html?t=AAPL, re/market.html?id=...)
only through links, so listing them here lets each one show up for searches like "AAPL stock".
Reads site/stocks.json and site/re/data.json when the build made them; skips either if missing.
"""
import datetime as dt
import json
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape

BASE = "https://www.topticker.ca/"
SITE = Path(__file__).resolve().parent.parent / "site"

PAGES = [
    "", "news.html", "markets.html", "stock.html", "screener.html", "movers.html", "brief.html",
    "heatmap.html", "signals.html", "analysts.html", "dividends.html", "earnings.html", "calendar.html",
    "compare.html", "backtest.html", "options.html", "tools.html", "watchlist.html", "portfolio.html",
    "alerts.html", "ask.html", "daily/",
    "re/", "re/world.html", "re/markets.html", "re/market.html", "re/listings.html", "re/compare.html",
    "re/tools.html", "re/news.html",
]


def load(path):
    try:
        return json.loads((SITE / path).read_text())
    except Exception as e:  # a missing data file just leaves those pages out
        print(f"sitemap: skipping {path} ({e})")
        return None


def main():
    today = dt.date.today().isoformat()
    urls = [BASE + p for p in PAGES]
    stocks = load("stocks.json") or []
    urls += [f"{BASE}stock.html?t={quote(s['t'], safe='')}" for s in stocks if s.get("t")]
    re_data = load("re/data.json") or {}
    urls += [f"{BASE}re/market.html?id={quote(m['id'], safe='')}" for m in re_data.get("markets", []) if m.get("id")]
    seen, rows = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            rows.append(f"  <url><loc>{escape(u)}</loc><lastmod>{today}</lastmod></url>")
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(rows) + "\n</urlset>\n")
    (SITE / "sitemap.xml").write_text(xml)
    print(f"sitemap: {len(rows)} pages ({len(stocks)} stocks, {len(re_data.get('markets', []))} housing markets)")


if __name__ == "__main__":
    main()
