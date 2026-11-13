"""Build site/news.json: top news stories for each of the eight markets.

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
    "tsxv": ("^SPCDNX", "TSX Venture Exchange stocks"),
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


# ---------------------------------------------------------------- top stories by outlet
# Each outlet's own feed where it publishes one, else Google News limited to that site.
# Paywalled outlets (WSJ, FT, Bloomberg, The Economist) still show headlines; the full story may need a subscription.
SOURCES = [
    ("wsj", "Wall Street Journal", "wsj.com", ["https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", "https://feeds.a.dj.com/rss/RSSMarketsMain.xml"]),
    ("ft", "Financial Times", "ft.com", ["https://www.ft.com/markets?format=rss"]),
    ("bloomberg", "Bloomberg", "bloomberg.com", ["https://feeds.bloomberg.com/markets/news.rss"]),
    ("reuters", "Reuters", "reuters.com", []),
    ("cnbc", "CNBC", "cnbc.com", ["https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
                                  "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"]),
    ("yahoo", "Yahoo Finance", "finance.yahoo.com", []),
    ("marketwatch", "MarketWatch", "marketwatch.com", ["https://feeds.content.dowjones.io/public/rss/mw_marketpulse", "https://feeds.content.dowjones.io/public/rss/mw_topstories"]),
    ("economist", "The Economist", "economist.com", ["https://www.economist.com/finance-and-economics/rss.xml",
                                                     "https://www.economist.com/business/rss.xml"]),
    ("forbes", "Forbes", "forbes.com", ["https://www.forbes.com/business/feed/"]),
    ("investing", "Investing.com", "investing.com", ["https://www.investing.com/rss/news_25.rss", "https://www.investing.com/rss/news_14.rss"]),
]
STORIES_PER_SOURCE = 10
SOURCE_MAX_AGE = timedelta(days=3)
MEDIA = "{http://search.yahoo.com/mrss/}"
ATOM = "{http://www.w3.org/2005/Atom}"
TAGS = re.compile(r"<[^>]+>")


def _clean(text: str) -> str:
    text = TAGS.sub(" ", text or "")
    for a, b in (("&amp;", "&"), ("&quot;", '"'), ("&#39;", "'"), ("&#039;", "'"), ("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">")):
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip()


def _when(text):
    if not text:
        return None
    try:
        d = parsedate_to_datetime(text)
    except Exception:
        try:
            d = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
        except Exception:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def feed(url: str, source: str) -> list[dict]:
    """Stories from one RSS or Atom feed."""
    try:
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) stocks-site news builder"}, timeout=30)
        r.raise_for_status()
        root = ET.fromstring(r.content)
    except Exception as e:
        log(f"feed {url} failed ({e})")
        return []
    out = []
    for it in list(root.iter("item")) + list(root.iter(ATOM + "entry")):
        title = _clean(it.findtext("title") or it.findtext(ATOM + "title"))
        link = (it.findtext("link") or "").strip()
        if not link:
            a = it.find(ATOM + "link")
            link = a.get("href") if a is not None else ""
        when = _when(it.findtext("pubDate") or it.findtext(ATOM + "updated") or it.findtext(ATOM + "published"))
        image = None
        for tag in (MEDIA + "content", MEDIA + "thumbnail", "enclosure"):
            m = it.find(tag)
            if m is not None and (m.get("url") or "").startswith("http") and "video" not in (m.get("type") or ""):
                image = m.get("url")
                break
        summary = _clean(it.findtext("description") or it.findtext(ATOM + "summary") or "")[:280]
        if title and link.startswith("http"):
            out.append({"title": title, "url": link, "source": source, "published": when,
                        "summary": summary if summary.lower() != title.lower() else "", "image": image, "related": None})
    return out


def top_stories(now: datetime) -> list[dict]:
    out = []
    for sid, name, domain, urls in SOURCES:
        got, how = [], "feed"
        for u in urls:
            got += feed(u, name)
        fresh = [s for s in got if s["published"] and now - s["published"] <= SOURCE_MAX_AGE]
        if len(fresh) < 4:  # no feed, or it failed: search Google News for that site
            how = "search"
            fresh += [{**s, "source": name} for s in google_news(f"site:{domain} markets OR economy OR stocks")
                      if s["published"] and now - s["published"] <= SOURCE_MAX_AGE]
        seen, picked = set(), []
        for s in sorted(fresh, key=lambda s: s["published"], reverse=True):
            key = s["title"].lower()[:80]
            if key in seen or NOT_NEWS.search(s["title"]):
                continue
            seen.add(key)
            picked.append({**s, "published": s["published"].isoformat(timespec="minutes")})
            if len(picked) >= STORIES_PER_SOURCE:
                break
        out.append({"id": sid, "name": name, "site": domain, "stories": picked})
        log(f"{name}: {len(picked)} stories (from {how})")
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

    sources = top_stories(now)
    OUT.write_text(json.dumps({"generated": now.isoformat(timespec="minutes"), "markets": markets, "sources": sources},
                              separators=(",", ":")))
    log(f"wrote {OUT}")


if __name__ == "__main__":
    build()
