"""Build site/data.json: top 10 stocks per index, buy ideas and a weekly watchlist.

Data comes from Yahoo Finance through yfinance. Run from the repo root:
    python scripts/build_data.py
"""
from __future__ import annotations

import io
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safe_io import read_json, write_json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONSTITUENTS = ROOT / "data" / "constituents"
# Stocks outside the eight indexes that the stock lookup should still carry, such as new IPOs
LISTINGS = ROOT / "data" / "listings.csv"
OUT = ROOT / "site" / "data.json"
# Between full runs, the workflow refreshes prices every 15 minutes with FAST=1. A fast run reuses the member
# lists, market caps, analyst data and dividends saved by the last run here, so it asks Yahoo for prices only
# (a handful of batched calls) instead of over a thousand per-stock lookups.
FAST = os.environ.get("FAST") == "1"
SAVED = ROOT / ".data-cache" / "build_data.json"

# Ranking settings
PERF_WINDOW = "3m, 6m and 12m"  # performance used for ranking (the 12-month return leaves out the last month)
CANDIDATES_PER_INDEX = 40   # best performers per index that get full analyst data
SELL_CANDIDATES_PER_INDEX = 15  # weakest performers per index checked for sell ideas
# perf: momentum across 3, 6 and 12 months. analyst: average rating, pulled toward neutral when few analysts
# cover the stock. mcap: company size. steady: lower day-to-day swings (a smoother climb ranks higher).
WEIGHTS = {"perf": 0.4, "analyst": 0.3, "mcap": 0.15, "steady": 0.15}
# A rating from one or two analysts is weak evidence, so each average is blended with this many "neutral"
# votes before it is scored. Neutral is the typical rating in that market: analysts in Korea and Taiwan
# almost never say Sell, so a Buy there means less than a Buy on the TSX. NEUTRAL_REC (the line between
# Buy and Hold) is used when too few stocks in a market have ratings to tell.
PRIOR_VOTES = 3
NEUTRAL_REC = 2.5
IDEAS_PER_INDEX = 3         # so one market's habitually bullish analysts can't fill the buy ideas
STALE_DAYS = 7              # a stock whose last trade is this much older than its market's is halted or delisted
# An average target further than this from the price is almost always bad data (often a target quoted
# in a different currency from the share price), so it is left out.
MAX_UPSIDE, MIN_UPSIDE = 150.0, -70.0
MIN_PRICE_USD = 1.0         # no penny stocks (with MIN_MCAP_USD)
MIN_MCAP_USD = 300e6

UA = {"User-Agent": "Mozilla/5.0 (stocks-site data builder)"}

INDEXES = [
    {"id": "tsx", "name": "TSX (S&P/TSX Composite)", "region": "Canada", "currency": "CAD", "suffix": ".TO",
     "benchmark": "^GSPTSE", "wiki": "https://en.wikipedia.org/wiki/S%26P/TSX_Composite_Index",
     "col": "Ticker", "min_rows": 200},
    # The Venture exchange has no published member list, so this takes its largest companies by market cap.
    # Many are small, so the home page picks use lower price and size floors here.
    {"id": "tsxv", "name": "TSX Venture (TSXV)", "region": "Canada", "currency": "CAD", "suffix": ".V",
     "benchmark": "^SPCDNX", "yahoo_exchange": "VAN", "top": 250, "min_rows": 100,
     "min_price_usd": 0.10, "min_mcap_usd": 50e6},
    {"id": "sp500", "name": "S&P 500", "region": "United States", "currency": "USD", "suffix": "",
     "benchmark": "^GSPC", "wiki": "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
     "col": "Symbol", "min_rows": 450},
    {"id": "nasdaq100", "name": "Nasdaq-100", "region": "United States", "currency": "USD", "suffix": "",
     "benchmark": "^NDX", "wiki": "https://stockanalysis.com/list/nasdaq-100-stocks/",
     "col": "Ticker", "min_rows": 95},
    {"id": "dow", "name": "Dow Jones Industrial Average", "region": "United States", "currency": "USD", "suffix": "",
     "benchmark": "^DJI", "wiki": "https://stockanalysis.com/list/dow-jones-stocks/",
     "col": "Symbol", "min_rows": 30},
    {"id": "nikkei225", "name": "Nikkei 225", "region": "Japan", "currency": "JPY", "suffix": ".T",
     "benchmark": "^N225", "nikkei": "https://indexes.nikkei.co.jp/en/nkave/index/component?idx=nk225",
     "min_rows": 200},
    {"id": "kospi200", "name": "KOSPI 200 (KRX)", "region": "South Korea", "currency": "KRW", "suffix": ".KS",
     "benchmark": "^KS200", "wiki": "https://en.wikipedia.org/wiki/KOSPI_200",
     "col": "Code", "min_rows": 190, "pad": 6},
    {"id": "twse50", "name": "Taiwan 50 (TWSE)", "region": "Taiwan", "currency": "TWD", "suffix": ".TW",
     "benchmark": "^TWII", "min_rows": 50},
]

FX = {"USD": None, "CAD": "CAD=X", "JPY": "JPY=X", "KRW": "KRW=X", "TWD": "TWD=X"}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- constituents

def _from_wiki(ix):
    html = requests.get(ix["wiki"], headers=UA, timeout=30).text
    seen = []
    for t in pd.read_html(io.StringIO(html), keep_default_na=False):
        if isinstance(t.columns, pd.MultiIndex):
            t.columns = [str(c[-1]) for c in t.columns]
        cols = {str(c).strip(): c for c in t.columns}
        seen.append(list(cols))
        sym = next((cols[c] for c in cols if c.lower().startswith((ix["col"].lower(), "symbol", "ticker", "code"))), None)
        name = next((cols[c] for c in cols if any(w in c.lower() for w in ("security", "company", "name"))), None)
        if sym is None or name is None or len(t) < ix["min_rows"]:
            continue
        df = pd.DataFrame({"symbol": t[sym].astype(str).str.strip(), "name": t[name].astype(str).str.strip()})
        df = df[df["symbol"].ne("") & df["symbol"].ne("nan")]
        if ix.get("pad"):
            df["symbol"] = df["symbol"].str.zfill(ix["pad"])
        return df
    raise ValueError(f"no constituents table found; tables had columns {seen[:12]}")


def _from_nikkei(ix):
    html = requests.get(ix["nikkei"], headers=UA, timeout=30).text
    frames = [t for t in pd.read_html(io.StringIO(html)) if "Code" in map(str, t.columns)]
    t = pd.concat(frames)
    t = t[t["Code"].notna()]
    name_col = next(c for c in t.columns if "name" in str(c).lower())
    return pd.DataFrame({"symbol": t["Code"].astype(str).str.strip(), "name": t[name_col].astype(str).str.strip()})


def _from_yahoo_screen(ix):
    """Largest common shares listed on one exchange, from Yahoo's stock screener."""
    from yfinance import EquityQuery as Q
    query = Q("eq", ["exchange", ix["yahoo_exchange"]])
    quotes = []
    for offset in range(0, ix["top"] * 2, 250):
        r = yf.screen(query, sortField="intradaymarketcap", sortAsc=False, size=250, offset=offset)
        quotes += r.get("quotes", [])
    rows = {}
    for q in quotes:
        sym = str(q.get("symbol", ""))
        if not sym.endswith(ix["suffix"]) or not q.get("marketCap"):
            continue
        base = sym[: -len(ix["suffix"])]
        if "-" in base:  # preferred shares, units and warrants
            continue
        rows[base] = (q["marketCap"], q.get("shortName") or q.get("longName") or base)
    top = sorted(rows.items(), key=lambda kv: kv[1][0], reverse=True)[: ix["top"]]
    return pd.DataFrame({"symbol": [k for k, _ in top], "name": [v[1].strip().title() if v[1].isupper() else v[1].strip() for _, v in top]})


def load_constituents(ix) -> pd.DataFrame:
    cache = CONSTITUENTS / f"{ix['id']}.csv"
    fetch = None if FAST else (_from_wiki if "wiki" in ix else _from_nikkei if "nikkei" in ix
             else _from_yahoo_screen if "yahoo_exchange" in ix else None)
    if fetch:
        try:
            df = fetch(ix).drop_duplicates("symbol")
            if len(df) >= ix["min_rows"]:
                df.to_csv(cache, index=False)
                log(f"{ix['id']}: {len(df)} members from source")
                return df
            log(f"{ix['id']}: source returned only {len(df)} rows, using saved list")
        except Exception as e:  # network or layout change: fall back to saved list
            log(f"{ix['id']}: source failed ({e}), using saved list")
    if not cache.exists():
        log(f"{ix['id']}: no saved list, skipping this index today")
        return pd.DataFrame({"symbol": [], "name": []})
    df = pd.read_csv(cache, dtype=str, keep_default_na=False)
    log(f"{ix['id']}: {len(df)} members from saved list")
    return df


def to_yahoo(symbol: str, ix) -> str:
    return str(symbol).replace(".", "-") + ix["suffix"]


def extra_listings() -> list[dict]:
    """Stocks from data/listings.csv, in the same shape as the search list's entries.

    Each row is a Yahoo symbol (ANT, XYZ.TO), name, exchange, currency, region and,
    for an IPO, the listing date and IPO price. They belong to no index ("ix" is empty),
    so the index pages leave them out, but the lookup, search and charts carry them.
    """
    if not LISTINGS.exists():
        return []
    out = []
    for r in pd.read_csv(LISTINGS, dtype=str, keep_default_na=False).to_dict("records"):
        t = r.get("symbol", "").strip().upper()
        if not t:
            continue
        e = {"t": t, "s": t.split(".")[0], "n": r.get("name") or t, "cur": r.get("currency") or "USD",
             "region": r.get("region") or "United States", "ix": [], "x": r.get("exchange") or None}
        try:
            price = float(r.get("ipo_price") or "nan")
        except ValueError:
            price = float("nan")
        if r.get("listed"):
            e["ipo"] = {"d": r["listed"], **({"p": price} if price == price else {})}
        out.append({k: v for k, v in e.items() if v is not None})
    return out


# ---------------------------------------------------------------- prices

# Each ticker's daily intraday highs and lows, for the 52-week range
HIGH_LOW: dict[str, tuple[pd.Series, pd.Series]] = {}


def download_prices(tickers: list[str], min_days: int = 31) -> dict[str, pd.Series]:
    closes: dict[str, pd.Series] = {}
    for i in range(0, len(tickers), 200):
        batch = tickers[i:i + 200]
        # Traded prices (split adjusted only), so the 52-week high and low match what really traded.
        # One failed batch (Yahoo refusing or timing out) only loses that batch; the publish check below
        # keeps the last good prices if too much is missing.
        df = None
        for attempt in range(2):
            try:
                df = yf.download(batch, period="13mo", interval="1d", auto_adjust=False, group_by="ticker",
                                 threads=True, progress=False)
                if df is not None and len(df):
                    break
            except Exception as e:
                log(f"price batch {i} failed ({e}), retry {attempt + 1}")
            time.sleep(10)
        if df is None or not len(df):
            log(f"price batch {i}: no prices came back")
            continue
        for t in batch:
            try:
                sub = df[t] if isinstance(df.columns, pd.MultiIndex) else df
                s = sub["Close"].dropna()
            except KeyError:
                continue
            if "High" in sub and "Low" in sub:
                HIGH_LOW[t] = (sub["High"].reindex(s.index), sub["Low"].reindex(s.index))
            if len(s) >= min_days:
                closes[t] = s
    return closes


def pct(a, b):
    return None if not b or b != b else (a / b - 1) * 100


def price_stats(s: pd.Series, t: str | None = None) -> dict:
    last = float(s.iloc[-1])
    def back(n):
        return float(s.iloc[-n - 1]) if len(s) > n else None
    year_start = s[s.index >= pd.Timestamp(s.index[-1].year, 1, 1, tz=s.index.tz)]
    ytd_base = float(s[s.index < year_start.index[0]].iloc[-1]) if len(year_start) and len(s) > len(year_start) else None
    last_year = s[s.index >= s.index[-1] - pd.Timedelta(days=365)]
    hi, lo = float(last_year.max()), float(last_year.min())
    if t in HIGH_LOW:
        # Intraday high and low, as broker sites show the 52-week range
        h, l = (x[x.index >= last_year.index[0]] for x in HIGH_LOW[t])
        if h.notna().any():
            hi = max(hi, float(h.max()))
        if (l > 0).any():
            lo = min(lo, float(l[l > 0].min()))
    return {
        "price": last,
        "chg1d": pct(last, back(1)),
        "chg1w": pct(last, back(5)),
        "chg1m": pct(last, back(21)),
        "chg3m": pct(last, back(63)),
        "chg6m": pct(last, back(126)),
        # 12-month return that skips the latest month: the classic momentum measure, less prone to
        # short-term reversals than the most recent weeks
        "chg12m1": pct(back(21), back(252)) if back(252) else None,
        "ytd": pct(last, ytd_base),
        "high52": hi,
        "low52": lo,
        "fromHigh": pct(last, hi),
        "aboveSma50": bool(last > s.iloc[-50:].mean()) if len(s) >= 50 else None,
        "aboveSma200": bool(last > s.iloc[-200:].mean()) if len(s) >= 200 else None,
        # Daily moves' spread over the last 3 months, on a yearly scale
        "volat": float(s.pct_change().iloc[-63:].std() * math.sqrt(252) * 100) if len(s) > 63 else None,
        "spark": [round(float(v), 4) for v in s.iloc[-63:].tolist()],
    }


def fx_rates() -> dict[str, float]:
    """Units of each currency per 1 USD. A rate Yahoo won't give (or gives wildly off the last one) is
    taken from the last good run, so one bad answer can't stop the build or misprice a whole market."""
    saved = (read_json(SAVED, {}) or {}).get("fx") or {}
    rates = {"USD": 1.0}
    for cur, sym in FX.items():
        if not sym:
            continue
        v = None
        for attempt in range(3):
            try:
                s = yf.download(sym, period="5d", progress=False, auto_adjust=True)["Close"].dropna()
                v = float(s.iloc[-1].squeeze())
                break
            except Exception as e:
                log(f"fx {sym} failed ({e}), retry {attempt + 1}")
                time.sleep(3 * (attempt + 1))
        old = saved.get(cur)
        if v is not None and v == v and v > 0 and (not old or 0.7 < v / old < 1.3):
            rates[cur] = v
        elif old:
            log(f"::warning::exchange rate {cur} unavailable or out of range ({v}), using the last one ({old})")
            rates[cur] = old
        else:
            raise RuntimeError(f"no exchange rate for {cur}")
    return rates


def market_caps(tickers: list[str]) -> dict[str, float]:
    """Market cap in local currency for every ticker, fetched in parallel."""
    known = {t: _saved["caps"][t] for t in tickers if FAST and t in _saved["caps"]}
    todo = [t for t in tickers if t not in known]

    def one(t):
        for attempt in range(3):
            try:
                v = yf.Ticker(t).fast_info["marketCap"]
                return t, float(v) if v else None
            except Exception:
                time.sleep(1 + attempt)
        return t, None
    with ThreadPoolExecutor(max_workers=12) as ex:
        got = {t: v for t, v in ex.map(one, todo) if v}
    # Sizes Yahoo wouldn't give this time come from the last run, so the largest-company lists and the
    # size part of each score don't empty out on a bad day
    old = {t: _saved["caps"][t] for t in todo if t not in got and t in _saved["caps"]}
    if old:
        log(f"market caps: {len(old)} stocks kept from the last run")
    return {**old, **known, **got}


# ---------------------------------------------------------------- dividends

_div: dict[str, dict] = {}
_saved: dict[str, dict] = {"caps": {}, "info": {}, "div": {}}
# A fast run reuses all of it. A full run uses the saved analyst data only for stocks Yahoo won't answer
# for this time, so a bad spell on Yahoo's side doesn't wipe out the buy and sell ideas.
try:
    _saved.update(json.loads(SAVED.read_text()))
except (OSError, ValueError):
    pass
FREQS = ((45, "Monthly", 12), (130, "Quarterly", 4), (240, "Semi-annual", 2), (400, "Annual", 1))


def dividend(t: str, price: float) -> tuple[str, dict]:
    """Payout frequency from the gaps between recent payments, and yield from the last year's payments."""
    for attempt in range(3):
        try:
            d = yf.Ticker(t).dividends
            break
        except Exception:
            time.sleep(1 + attempt)
    else:
        return t, {}
    d = d[d > 0]
    if d.empty or (pd.Timestamp.now(tz=d.index.tz) - d.index[-1]).days > 400:
        return t, {"divFreq": "None", "divYield": None}
    recent = d[d.index >= d.index[-1] - pd.Timedelta(days=760)]
    gap = recent.index.to_series().diff().dt.days.dropna().median() if len(recent) > 1 else 365
    label, per_year = next(((l, n) for g, l, n in FREQS if gap <= g), ("Irregular", 1))
    # Leave out one-off special dividends (far bigger than the usual payment), which would overstate the yield
    regular = recent[recent <= recent.median() * 2.5] if len(recent) > 2 else recent
    paid = float(regular.iloc[-per_year:].sum())
    return t, {"divFreq": label, "divYield": paid / price * 100 if price else None}


def dividends(rows: list[dict]) -> None:
    if FAST:
        _div.update({r["ticker"]: _saved["div"][r["ticker"]] for r in rows if r["ticker"] in _saved["div"]})
    todo = {r["ticker"]: r["price"] for r in rows if r["ticker"] not in _div}
    with ThreadPoolExecutor(max_workers=4) as ex:
        got = dict(ex.map(lambda kv: dividend(*kv), todo.items()))
    # A stock Yahoo gave no dividend answer for keeps the last run's, rather than losing its yield
    for t, v in got.items():
        _div[t] = v if v or t not in _saved["div"] else _saved["div"][t]


# ---------------------------------------------------------------- analyst data

_info_cache: dict[str, dict] = {}
_info_fails = 0


def info(ticker: str) -> dict:
    if ticker in _info_cache:
        return _info_cache[ticker]
    if FAST and ticker in _saved["info"]:
        return _info_cache.setdefault(ticker, _saved["info"][ticker])
    global _info_fails
    data = {}
    # Once Yahoo has refused many in a row, try each stock only once, then pause a minute and test again
    tries = 1 if _info_fails >= 25 else 4
    for attempt in range(tries):
        try:
            data = yf.Ticker(ticker).info or {}
        except Exception as e:
            log(f"info {ticker} failed ({e}), retry {attempt + 1}")
            data = {}
        # Yahoo sometimes answers with an error (often "Invalid Crumb") instead of raising, leaving an almost
        # empty dict, so check that real company data came back
        if data.get("quoteType") or data.get("shortName") or data.get("marketCap"):
            break
        data = {}
        time.sleep(3 * (attempt + 1))
    if data:
        _info_fails = 0
    else:
        _info_fails += 1
        if _info_fails % 25 == 0:
            log(f"Yahoo refused {_info_fails} lookups in a row, pausing a minute")
            time.sleep(60)
        if ticker in _saved["info"]:
            log(f"info {ticker}: no answer, using the last saved analyst data")
            data = dict(_saved["info"][ticker])
    _info_cache[ticker] = data
    return data


def earnings_date(inf: dict):
    for k in ("earningsTimestampStart", "earningsTimestamp"):
        v = inf.get(k)
        if v:
            return datetime.fromtimestamp(v, tz=timezone.utc)
    return None


# ---------------------------------------------------------------- scoring

def rank_pct(values: list) -> list:
    """Percentile rank 0..1 of each value; missing values get 0.5 (neutral)."""
    present = sorted(v for v in values if v is not None)
    n = len(present)
    out = []
    for v in values:
        if v is None or n < 2:
            out.append(0.5)
        else:
            below = sum(1 for p in present if p < v)
            out.append(below / (n - 1))
    return out


def target_upside(target, price, analysts):
    """Percent from the price to the average analyst target, or None when there is no usable target."""
    if not target or not price or target <= 0 or not analysts:
        return None
    up = pct(target, price)
    return up if MIN_UPSIDE <= up <= MAX_UPSIDE else None


def momentum(rows: list[dict]) -> None:
    """Each row's momentum percentile within its index: the average rank of its 3, 6 and 12-month returns."""
    ranks = [rank_pct([r.get(k) for r in rows]) for k in ("chg3m", "chg6m", "chg12m1")]
    for i, r in enumerate(rows):
        have = [rk[i] for rk, k in zip(ranks, ("chg3m", "chg6m", "chg12m1")) if r.get(k) is not None]
        r["mom"] = sum(have) / len(have) if have else 0.5


def analyst_score(rec, n, neutral: float = NEUTRAL_REC) -> float:
    """0..1 from the average rating, pulled toward the market's typical rating when few analysts cover it.

    The market's typical rating scores 0.5, and each full step better (Hold to Buy, say) adds 0.5.
    """
    n = n or 0
    adj = (rec * n + neutral * PRIOR_VOTES) / (n + PRIOR_VOTES) if rec and n else neutral
    return min(1.0, max(0.0, 0.5 + (neutral - adj) / 2))


def median(values: list):
    v = sorted(x for x in values if x is not None)
    return None if not v else v[len(v) // 2] if len(v) % 2 else (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2


def rating_label(mean):
    if mean is None:
        return "No rating"
    return ("Strong Buy" if mean <= 1.5 else "Buy" if mean <= 2.5 else
            "Hold" if mean <= 3.5 else "Underperform" if mean <= 4.5 else "Sell")


def build():
    now = datetime.now(timezone.utc)
    rates = fx_rates()
    log("fx", rates)

    members = {ix["id"]: load_constituents(ix) for ix in INDEXES}
    all_tickers = sorted({to_yahoo(s, ix) for ix in INDEXES for s in members[ix["id"]]["symbol"]})
    log(f"downloading prices for {len(all_tickers)} tickers")
    closes = download_prices(all_tickers)
    # Yahoo sometimes has only today's bar for an index (KOSPI 200 lately); still show its level
    bench = download_prices([ix["benchmark"] for ix in INDEXES], min_days=1)
    log(f"got prices for {len(closes)} tickers")

    caps = market_caps(sorted(closes))
    log(f"got market caps for {len(caps)} tickers")

    indexes_out, pool, weak, div_rows, everyone = [], {}, {}, [], {}
    for ix in INDEXES:
        rate = rates[ix["currency"]]
        names = dict(zip(members[ix["id"]]["symbol"], members[ix["id"]]["name"]))
        ends = [closes[to_yahoo(s, ix)].index[-1] for s in names if to_yahoo(s, ix) in closes]
        newest = max(ends) if ends else None
        rows = []
        for sym, name in names.items():
            t = to_yahoo(sym, ix)
            if t not in closes:
                continue
            if (newest - closes[t].index[-1]).days > STALE_DAYS:
                log(f"{ix['id']}: {t} last traded {closes[t].index[-1].date()}, left out")
                continue
            st = price_stats(closes[t], t)
            if st["price"] / rate < ix.get("min_price_usd", MIN_PRICE_USD) or st["chg3m"] is None:
                continue
            cap = caps.get(t)
            rows.append({"ticker": t, "symbol": sym, "name": name, "currency": ix["currency"], **st,
                         "mcap": cap, "mcapUsd": cap / rate if cap else None})
        for r in rows:
            everyone.setdefault(r["ticker"], r).setdefault("markets", []).append(ix["name"])
        largest = sorted((r for r in rows if r["mcapUsd"]), key=lambda r: r["mcapUsd"], reverse=True)[:10]
        # Size and steadiness are ranked against the whole index, so the scores mean the same in every market
        momentum(rows)
        for r, m, v in zip(rows, rank_pct([math.log(r["mcapUsd"]) if r["mcapUsd"] else None for r in rows]),
                            rank_pct([-r["volat"] if r["volat"] is not None else None for r in rows])):
            r["sizeRank"], r["steadyRank"] = m, v
        rows.sort(key=lambda r: r["mom"], reverse=True)
        cands = rows[:CANDIDATES_PER_INDEX]

        losers = [r for r in rows[-SELL_CANDIDATES_PER_INDEX:] if r not in cands and r["chg3m"] < 0]
        for r in cands + losers:
            inf = info(r["ticker"])
            mcap = inf.get("marketCap") or r["mcap"]
            r["name"] = inf.get("shortName") or inf.get("longName") or r["name"]
            r["sector"] = inf.get("sector")
            r["mcap"] = mcap
            r["mcapUsd"] = mcap / rate if mcap else None
            r["recMean"] = inf.get("recommendationMean")
            r["analysts"] = inf.get("numberOfAnalystOpinions")
            r["target"] = inf.get("targetMeanPrice")
            r["upside"] = target_upside(r["target"], r["price"], r["analysts"])
            if r["upside"] is None:
                r["target"] = None
            ed = earnings_date(inf)
            r["earnings"] = ed.date().isoformat() if ed else None
            r["rating"] = rating_label(r["recMean"])
        floor = ix.get("min_mcap_usd", MIN_MCAP_USD)
        cands = [r for r in cands if not r["mcapUsd"] or r["mcapUsd"] >= floor]
        for r in losers:
            if r["mcapUsd"] and r["mcapUsd"] >= floor:
                r["score"] = None
                weak.setdefault(r["ticker"], {**r, "indexes": []})["indexes"].append(ix["name"])

        rated = [r["recMean"] for r in cands + losers if r["recMean"] and (r["analysts"] or 0) >= 3]
        neutral = median(rated) if len(rated) >= 10 else NEUTRAL_REC
        typical_up = median([r["upside"] for r in cands + losers if (r["analysts"] or 0) >= 3])
        for r in cands:
            # Gap to target compared with what's normal in this market, for ranking buy ideas
            r["upsideVsMarket"] = r["upside"] - (typical_up or 0) if r["upside"] is not None else None
            a = analyst_score(r["recMean"], r["analysts"], neutral)
            r["score"] = round(100 * (WEIGHTS["perf"] * r["mom"] + WEIGHTS["analyst"] * a
                                      + WEIGHTS["mcap"] * r["sizeRank"] + WEIGHTS["steady"] * r["steadyRank"]), 1)
            r["index"] = ix["id"]
            pool.setdefault(r["ticker"], {**r, "indexes": []})["indexes"].append(ix["name"])
            r["indexes"] = pool[r["ticker"]]["indexes"]
        cands.sort(key=lambda r: r["score"], reverse=True)

        b = bench.get(ix["benchmark"])
        bstats = price_stats(b) if b is not None else {}
        div_rows += cands + largest + losers
        indexes_out.append({
            "id": ix["id"], "name": ix["name"], "region": ix["region"], "currency": ix["currency"],
            "benchmark": ix["benchmark"], "members": len(names), "priced": len(rows),
            "level": bstats.get("price"), "chg1d": bstats.get("chg1d"), "chg1w": bstats.get("chg1w"),
            "chg1m": bstats.get("chg1m"), "ytd": bstats.get("ytd"), "spark": bstats.get("spark", []),
            "top": cands[:10],
            "largest": largest,
        })

    # After all analyst lookups, so the extra Yahoo calls can't disturb them
    dividends(div_rows)
    for ixo in indexes_out:
        ixo["top"] = [clean(r) for r in ixo["top"]]
        ixo["largest"] = [clean(r) for r in sorted(ixo["largest"], key=lambda r: r["mcapUsd"] or 0, reverse=True)]
    stocks = list(pool.values())
    out = {
        "generated": now.isoformat(timespec="minutes"),
        "settings": {"perfWindow": PERF_WINDOW, "weights": WEIGHTS, "minPriceUsd": MIN_PRICE_USD,
                     "minMcapUsd": MIN_MCAP_USD, "candidates": CANDIDATES_PER_INDEX},
        "indexes": indexes_out,
        "buyIdeas": buy_ideas(stocks),
        "sellIdeas": sell_ideas(list(weak.values()) + stocks),
        "watchlist": watchlist(stocks, now),
        "snapshots": snapshots(list(everyone.values())),
    }
    out = publish_check(out)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    write_json(OUT, out, allow_nan=False, default=str)
    # Small file for the ticker tape in every page's header: each index and its top 3 stocks
    tape = {"generated": out["generated"], "items": []}
    for ixo in indexes_out:
        tape["items"].append({"t": ixo["benchmark"], "ix": ixo["id"], "p": ixo["level"], "c": ixo["chg1d"]})
        tape["items"] += [{"t": r["ticker"], "s": r["symbol"], "p": r.get("price"), "c": r.get("chg1d")} for r in ixo["top"][:3]]
    write_json(OUT.parent / "tape.json", tape, allow_nan=False, default=str)
    for ixo in indexes_out:
        log(f"{ixo['name']}: {ixo['priced']}/{ixo['members']} priced, top: "
            + ", ".join(f"{r['symbol']} {r['chg3m']:+.0f}%" for r in ixo["top"][:3]))
    for ixo in indexes_out:
        log(f"{ixo['name']} largest: " + ", ".join(f"{r['symbol']} ${(r['mcapUsd'] or 0) / 1e9:,.0f}B" for r in ixo["largest"][:5]))
    log(f"buy ideas: {len(out['buyIdeas'])} ({', '.join(r['symbol'] for r in out['buyIdeas'][:5])})")
    log(f"sell ideas: {len(out['sellIdeas'])} ({', '.join(r['symbol'] for r in out['sellIdeas'][:5])})")
    log(f"watchlist: {len(out['watchlist'])} ({', '.join(r['symbol'] for r in out['watchlist'][:5])})")
    log(f"dividends: {sum(1 for v in _div.values() if v.get('divYield'))}/{len(_div)} payers")
    log(f"wrote {OUT}")
    # What the next fast run reuses. A fast run keeps what it was given and adds anything it had to look up.
    keep = ("shortName", "longName", "sector", "marketCap", "recommendationMean", "numberOfAnalystOpinions",
            "targetMeanPrice", "earningsTimestampStart", "earningsTimestamp")
    SAVED.parent.mkdir(exist_ok=True)
    write_json(SAVED, {
        "caps": {**_saved["caps"], **caps},
        "info": {**_saved["info"], **{t: {k: v.get(k) for k in keep} for t, v in _info_cache.items() if v}},
        "div": {**_saved["div"], **{t: v for t, v in _div.items() if v}},
        "fx": rates,
    }, default=str)


class BadData(Exception):
    """This run's data looks broken; the last good data.json stays on the site."""


def publish_check(out: dict) -> dict:
    """Compare this run with the data.json already on the site before replacing it.

    Yahoo can answer with errors or near-empty replies instead of failing outright, and the build would
    happily publish that. So: an index that lost most of its prices or its top-10 keeps its last good
    block (marked stale), and if most of the site's prices are missing the whole file is left as it was.
    """
    prev = read_json(OUT, None)
    if not prev or not prev.get("indexes"):
        if not any(ix["top"] for ix in out["indexes"]):
            raise BadData("no index has any stocks priced")
        return out
    before = {ix["id"]: ix for ix in prev["indexes"]}
    total_now = sum(ix["priced"] for ix in out["indexes"])
    total_before = sum(ix.get("priced") or 0 for ix in prev["indexes"])
    if total_before and total_now < total_before * 0.5:
        raise BadData(f"only {total_now} stocks priced against {total_before} last time")
    for i, ix in enumerate(out["indexes"]):
        old = before.get(ix["id"])
        if not old:
            continue
        thin = old.get("priced") and ix["priced"] < old["priced"] * 0.6
        if (thin or (old.get("top") and not ix["top"])) and old.get("top"):
            log(f"::warning::{ix['name']}: only {ix['priced']} of {old.get('priced')} stocks priced this run, "
                f"keeping the last good list from {old.get('stale') or prev.get('generated')}")
            out["indexes"][i] = {**old, "stale": old.get("stale") or prev.get("generated")}
        elif ix.get("level") is None and old.get("level") is not None:
            # Index level missing this time: show the last one rather than a blank
            ix.update({k: old.get(k) for k in ("level", "chg1d", "chg1w", "chg1m", "ytd", "spark")})
    for key in ("buyIdeas", "sellIdeas", "watchlist"):
        if not out[key] and prev.get(key) and total_now < total_before * 0.9:
            log(f"::warning::{key} came back empty, keeping the last ones")
            out[key] = prev[key]
    return out


def clean(r: dict) -> dict:
    keep = ("ticker", "symbol", "name", "sector", "price", "chg1d", "chg1w", "chg1m", "chg3m", "ytd",
            "high52", "low52", "fromHigh", "mcap", "mcapUsd", "recMean", "rating", "analysts", "target",
            "upside", "earnings", "score", "spark", "indexes", "divYield", "divFreq", "currency", "markets")
    r = {**_div.get(r.get("ticker"), {}), **r}
    out = {}
    for k in keep:
        v = r.get(k)
        if isinstance(v, float):
            v = None if math.isnan(v) or math.isinf(v) else round(v, 4)
        out[k] = v
    return out


def buy_ideas(stocks: list[dict]) -> list[dict]:
    """Strong momentum that analysts also like, with room to their price target."""
    ideas = []
    for r in stocks:
        if (r["recMean"] and r["recMean"] <= 2.2 and (r["analysts"] or 0) >= 5
                and r["upside"] is not None and r["upside"] >= 10
                and r["chg3m"] > 0 and r["aboveSma50"] and r["aboveSma200"] is not False):
            why = [f"up {r['chg3m']:.0f}% in 3 months",
                   f"{r['analysts']} analysts rate it {r['rating']}",
                   f"average target {r['upside']:.0f}% above today's price"]
            if r["fromHigh"] is not None and r["fromHigh"] > -3:
                why.append("trading near its 52-week high")
            soon = earnings_soon(r)
            if soon:
                why.append(f"reports earnings {soon}, which can move the price sharply")
            rel = r.get("upsideVsMarket")
            rel = r["upside"] if rel is None else rel
            ideas.append({**clean(r), "why": why, "index": r.get("index"),
                          "ideaScore": round(r["score"] + max(-20, min(rel, 40)) * 0.4, 1)})
    ideas.sort(key=lambda r: r["ideaScore"], reverse=True)
    picked, per = [], {}
    for r in ideas:
        if per.get(r["index"], 0) < IDEAS_PER_INDEX:
            per[r["index"]] = per.get(r["index"], 0) + 1
            picked.append(r)
    for r in picked:
        r.pop("index", None)
    return picked[:12]


def sell_ideas(stocks: list[dict]) -> list[dict]:
    """Falling stocks that analysts are cool on or that trade above their price target."""
    ideas, seen = [], set()
    for r in stocks:
        if r["ticker"] in seen or r["chg3m"] is None or r["chg3m"] >= 0 or r["aboveSma50"]:
            continue
        rated_low = r["recMean"] is not None and r["recMean"] >= 2.8 and (r["analysts"] or 0) >= 3
        over_target = r["upside"] is not None and r["upside"] < 0 and (r["analysts"] or 0) >= 3
        if not (rated_low or over_target):
            continue
        seen.add(r["ticker"])
        why = [f"down {abs(r['chg3m']):.0f}% in 3 months",
               "trading below its 50-day and 200-day averages" if r.get("aboveSma200") is False
               else "trading below its 50-day average"]
        if rated_low:
            why.append(f"{r['analysts']} analysts rate it {r['rating']}")
        if over_target:
            why.append(f"price is {abs(r['upside']):.0f}% above the average analyst target")
        weakness = -r["chg3m"] + (r["recMean"] or 2.5) * 8 + max(0, -(r["upside"] or 0))
        ideas.append({**clean(r), "why": why, "ideaScore": round(weakness, 1)})
    ideas.sort(key=lambda r: r["ideaScore"], reverse=True)
    return ideas[:12]


def earnings_soon(r: dict, days: int = 14) -> str | None:
    """The report date as text when the company reports within `days` days."""
    if not r.get("earnings"):
        return None
    d = datetime.fromisoformat(r["earnings"]).date()
    today = datetime.now(timezone.utc).date()
    return d.strftime("%a %b %d").replace(" 0", " ") if today <= d <= today + timedelta(days=days) else None


def snapshots(rows: list[dict]) -> dict:
    """Quick-look cards: the biggest gainers today and over the past week."""
    ok = [r for r in rows if r.get("mcapUsd") and r["mcapUsd"] >= MIN_MCAP_USD]
    def best(key):
        return [clean(r) for r in sorted((r for r in ok if r.get(key) is not None), key=lambda r: r[key], reverse=True)[:10]]
    return {"day": best("chg1d"), "week": best("chg1w")}


def watchlist(stocks: list[dict], now: datetime) -> list[dict]:
    """Stocks with a catalyst or a setup worth watching in the coming 7 days."""
    end = (now + timedelta(days=7)).date()
    items = {}
    for r in stocks:
        reasons = []
        if r["earnings"] and now.date() <= datetime.fromisoformat(r["earnings"]).date() <= end:
            reasons.append(f"reports earnings {datetime.fromisoformat(r['earnings']).strftime('%a %b %d')}")
        if r["fromHigh"] is not None and r["fromHigh"] > -2 and (r["chg1w"] or 0) > 3:
            reasons.append("breaking out near its 52-week high")
        if r["chg1w"] is not None and abs(r["chg1w"]) >= 10:
            reasons.append(f"moved {r['chg1w']:+.0f}% last week")
        if reasons:
            items[r["ticker"]] = {**clean(r), "why": reasons,
                                  "priority": len(reasons) * 50 + r["score"] + (40 if "earnings" in reasons[0] else 0)}
    out = sorted(items.values(), key=lambda r: r["priority"], reverse=True)
    return out[:15]


if __name__ == "__main__":
    try:
        build()
    except BadData as e:
        log(f"::error::Stock data looked broken, so the site keeps the last good prices: {e}")
        sys.exit(2)
