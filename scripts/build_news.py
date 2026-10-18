"""Build site/news.json: top news stories for each of the seven markets.

Headlines come from Yahoo Finance (via yfinance) for each index and its biggest
companies, topped up with Google News search results. Run after build_data.py:
    python scripts/build_news.py
"""
from __future__ import annotations

import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote_plus

import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data.json"
OUT = ROOT / "site" / "news.json"

STORIES_PER_MARKET = 12
MAX_AGE = timedelta(days=7)
# Quote and price pages show up in search feeds but are not news stories
NOT_NEWS = re.compile(r"\b(stock price|price & quote|price and quote|quote & history|historical prices|stock quote|share price & news)\b", re.I)
UA = {"User-Agent": "Mozilla/5.0 (stocks-site news builder)"}

# Index id -> Yahoo index symbol and a Google News search for that market
MARKETS = {
    "sp500": ("^GSPC", "S&P 500 stocks"),
    "nasdaq100": ("^NDX", "Nasdaq 100 stocks"),
    "dow": ("^DJI", "Dow Jones stocks"),
    "tsx": ("^GSPTSE", "TSX Toronto stock market"),
    "nikkei225": ("^N225", "Nikkei 225 Japan stocks"),
    "kospi200": ("^KS200", "KOSPI Korea stocks"),
    "twse50": ("^TWII", "Taiwan stock market TAIEX"),
}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def _yahoo_item(raw: dict, related: str | None):
    """Normalise one yfinance news item (newer nested and older flat layouts)."""
    c = raw.get("content") or raw
    title = c.get("title")
    url = ((c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url")
           or c.get("link"))
    if not title or not url:
        return None
    when = None
    if c.get("pubDate"):
        when = datetime.fromisoformat(c["pubDate"].replace("Z", "+00:00"))
    elif c.get("providerPublishTime"):
        when = datetime.fromtimestamp(c["providerPublishTime"], tz=timezone.utc)
    source = (c.get("provider") or {}).get("displayName") or c.get("publisher") or "Yahoo Finance"
    thumb = None
    res = ((c.get("thumbnail") or {}).get("resolutions") or [])
    if res:
        thumb = min(res, key=lambda r: abs((r.get("width") or 0) - 320)).get("url")
    return {"title": title.strip(), "url": url, "source": source, "published": when,
            "summary": (c.get("summary") or "").strip()[:280], "image": thumb, "related": related}


def yahoo_news(symbol: str, related: str | None = None) -> list[dict]:
    for attempt in range(3):
        try:
            items = yf.Ticker(symbol).news or []
            return [i for i in (_yahoo_item(r, related) for r in items) if i]
        except Exception as e:
            log(f"news {symbol} failed ({e}), retry {attempt + 1}")
            time.sleep(2 * (attempt + 1))
    return []


def google_news(query: str) -> list[dict]:
    url = f"https://news.google.com/rss/search?q={quote_plus(query + ' when:7d')}&hl=en-US&gl=US&ceid=US:en"
    try:
        root = ET.fromstring(requests.get(url, headers=UA, timeout=30).content)
    except Exception as e:
        log(f"google news '{query}' failed ({e})")
        return []
    out = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        source = (it.findtext("source") or "").strip()
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        try:
            when = parsedate_to_datetime(it.findtext("pubDate"))
        except Exception:
            when = None
        if title and it.findtext("link"):
            out.append({"title": title, "url": it.findtext("link"), "source": source or "Google News",
                        "published": when, "summary": "", "image": None, "related": None})
    return out


def build():
    now = datetime.now(timezone.utc)
    data = json.loads(DATA.read_text())
    markets = []
    for ix in data["indexes"]:
        symbol, query = MARKETS.get(ix["id"], (None, ix["name"] + " stocks"))
        stories = yahoo_news(symbol) if symbol else []
        for s in (ix.get("largest") or [])[:5]:
            stories += yahoo_news(s["ticker"], s["symbol"])
        if len(stories) < STORIES_PER_MARKET:
            stories += google_news(query)

        seen, picked = set(), []
        fresh = [s for s in stories if s["published"] and now - s["published"] <= MAX_AGE
                 and not NOT_NEWS.search(s["title"])]
        for s in sorted(fresh, key=lambda s: s["published"], reverse=True):
            key = s["title"].lower()[:80]
            if key in seen:
                continue
            seen.add(key)
            picked.append({**s, "published": s["published"].isoformat(timespec="minutes")})
            if len(picked) >= STORIES_PER_MARKET:
                break
        markets.append({"id": ix["id"], "name": ix["name"], "region": ix["region"],
                        "chg1d": ix.get("chg1d"), "stories": picked})
        log(f"{ix['name']}: {len(picked)} stories ({len(stories)} found)")

    OUT.write_text(json.dumps({"generated": now.isoformat(timespec="minutes"), "markets": markets},
                              separators=(",", ":")))
    log(f"wrote {OUT}")


if __name__ == "__main__":
    build()
