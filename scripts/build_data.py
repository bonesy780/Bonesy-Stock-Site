"""Build site/data.json: top 10 stocks per index, buy ideas and a weekly watchlist.

Data comes from Yahoo Finance through yfinance. Run from the repo root:
    python scripts/build_data.py
"""
from __future__ import annotations

import io
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
CONSTITUENTS = ROOT / "data" / "constituents"
OUT = ROOT / "site" / "data.json"

# Ranking settings
PERF_WINDOW = "3m"          # performance used for ranking
CANDIDATES_PER_INDEX = 40   # best performers per index that get full analyst data
SELL_CANDIDATES_PER_INDEX = 15  # weakest performers per index checked for sell ideas
WEIGHTS = {"perf": 0.5, "analyst": 0.3, "mcap": 0.2}
MIN_PRICE_USD = 1.0         # no penny stocks (with MIN_MCAP_USD)
MIN_MCAP_USD = 300e6

UA = {"User-Agent": "Mozilla/5.0 (stocks-site data builder)"}

INDEXES = [
    {"id": "tsx", "name": "TSX (S&P/TSX Composite)", "region": "Canada", "currency": "CAD", "suffix": ".TO",
     "benchmark": "^GSPTSE", "wiki": "https://en.wikipedia.org/wiki/S%26P/TSX_Composite_Index",
     "col": "Ticker", "min_rows": 200},
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


def load_constituents(ix) -> pd.DataFrame:
    cache = CONSTITUENTS / f"{ix['id']}.csv"
    fetch = _from_wiki if "wiki" in ix else _from_nikkei if "nikkei" in ix else None
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


# ---------------------------------------------------------------- prices

def download_prices(tickers: list[str]) -> dict[str, pd.Series]:
    closes: dict[str, pd.Series] = {}
    for i in range(0, len(tickers), 200):
        batch = tickers[i:i + 200]
        df = yf.download(batch, period="13mo", interval="1d", auto_adjust=True, group_by="ticker",
                         threads=True, progress=False)
        for t in batch:
            try:
                s = df[t]["Close"].dropna() if isinstance(df.columns, pd.MultiIndex) else df["Close"].dropna()
            except KeyError:
                continue
            if len(s) > 30:
                closes[t] = s
    return closes


def pct(a, b):
    return None if not b or b != b else (a / b - 1) * 100


def price_stats(s: pd.Series) -> dict:
    last = float(s.iloc[-1])
    def back(n):
        return float(s.iloc[-n - 1]) if len(s) > n else None
    year_start = s[s.index >= pd.Timestamp(s.index[-1].year, 1, 1, tz=s.index.tz)]
    ytd_base = float(s[s.index < year_start.index[0]].iloc[-1]) if len(year_start) and len(s) > len(year_start) else None
    last_year = s[s.index >= s.index[-1] - pd.Timedelta(days=365)]
    hi, lo = float(last_year.max()), float(last_year.min())
    return {
        "price": last,
        "chg1d": pct(last, back(1)),
        "chg1w": pct(last, back(5)),
        "chg1m": pct(last, back(21)),
        "chg3m": pct(last, back(63)),
        "ytd": pct(last, ytd_base),
        "high52": hi,
        "low52": lo,
        "fromHigh": pct(last, hi),
        "aboveSma50": bool(last > s.iloc[-50:].mean()) if len(s) >= 50 else None,
        "spark": [round(float(v), 4) for v in s.iloc[-63:].tolist()],
    }


def fx_rates() -> dict[str, float]:
    rates = {"USD": 1.0}
    for cur, sym in FX.items():
        if sym:
            s = yf.download(sym, period="5d", progress=False, auto_adjust=True)["Close"].dropna()
            rates[cur] = float(s.iloc[-1].squeeze())  # units of currency per 1 USD
    return rates


def market_caps(tickers: list[str]) -> dict[str, float]:
    """Market cap in local currency for every ticker, fetched in parallel."""
    def one(t):
        for attempt in range(3):
            try:
                v = yf.Ticker(t).fast_info["marketCap"]
                return t, float(v) if v else None
            except Exception:
                time.sleep(1 + attempt)
        return t, None
    with ThreadPoolExecutor(max_workers=12) as ex:
        return {t: v for t, v in ex.map(one, tickers) if v}


# ---------------------------------------------------------------- dividends

_div: dict[str, dict] = {}
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
    paid = float(d.iloc[-per_year:].sum())
    return t, {"divFreq": label, "divYield": paid / price * 100 if price else None}


def dividends(rows: list[dict]) -> None:
    todo = {r["ticker"]: r["price"] for r in rows if r["ticker"] not in _div}
    with ThreadPoolExecutor(max_workers=12) as ex:
        _div.update(ex.map(lambda kv: dividend(*kv), todo.items()))


# ---------------------------------------------------------------- analyst data

_info_cache: dict[str, dict] = {}


def info(ticker: str) -> dict:
    if ticker in _info_cache:
        return _info_cache[ticker]
    data = {}
    for attempt in range(3):
        try:
            data = yf.Ticker(ticker).info or {}
            break
        except Exception as e:
            log(f"info {ticker} failed ({e}), retry {attempt + 1}")
            time.sleep(2 * (attempt + 1))
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
    bench = download_prices([ix["benchmark"] for ix in INDEXES])
    log(f"got prices for {len(closes)} tickers")

    caps = market_caps(sorted(closes))
    log(f"got market caps for {len(caps)} tickers")

    indexes_out, pool, weak = [], {}, {}
    for ix in INDEXES:
        rate = rates[ix["currency"]]
        names = dict(zip(members[ix["id"]]["symbol"], members[ix["id"]]["name"]))
        rows = []
        for sym, name in names.items():
            t = to_yahoo(sym, ix)
            if t not in closes:
                continue
            st = price_stats(closes[t])
            if st["price"] / rate < MIN_PRICE_USD or st["chg3m"] is None:
                continue
            cap = caps.get(t)
            rows.append({"ticker": t, "symbol": sym, "name": name, **st,
                         "mcap": cap, "mcapUsd": cap / rate if cap else None})
        largest = sorted((r for r in rows if r["mcapUsd"]), key=lambda r: r["mcapUsd"], reverse=True)[:10]
        rows.sort(key=lambda r: r["chg3m"], reverse=True)
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
            r["upside"] = pct(r["target"], r["price"]) if r["target"] else None
            ed = earnings_date(inf)
            r["earnings"] = ed.date().isoformat() if ed else None
            r["rating"] = rating_label(r["recMean"])
        cands = [r for r in cands if not r["mcapUsd"] or r["mcapUsd"] >= MIN_MCAP_USD]
        for r in losers:
            if r["mcapUsd"] and r["mcapUsd"] >= MIN_MCAP_USD:
                r["score"] = None
                weak.setdefault(r["ticker"], {**r, "indexes": []})["indexes"].append(ix["name"])

        perf = rank_pct([r["chg3m"] for r in cands])
        analyst = rank_pct([(5 - r["recMean"]) if r["recMean"] else None for r in cands])
        size = rank_pct([math.log(r["mcapUsd"]) if r["mcapUsd"] else None for r in cands])
        for r, p, a, m in zip(cands, perf, analyst, size):
            r["score"] = round(100 * (WEIGHTS["perf"] * p + WEIGHTS["analyst"] * a + WEIGHTS["mcap"] * m), 1)
            r["index"] = ix["id"]
            pool.setdefault(r["ticker"], {**r, "indexes": []})["indexes"].append(ix["name"])
            r["indexes"] = pool[r["ticker"]]["indexes"]
        cands.sort(key=lambda r: r["score"], reverse=True)

        b = bench.get(ix["benchmark"])
        bstats = price_stats(b) if b is not None else {}
        dividends(cands + largest + losers)
        indexes_out.append({
            "id": ix["id"], "name": ix["name"], "region": ix["region"], "currency": ix["currency"],
            "members": len(names), "priced": len(rows),
            "level": bstats.get("price"), "chg1d": bstats.get("chg1d"), "chg1w": bstats.get("chg1w"),
            "chg1m": bstats.get("chg1m"), "ytd": bstats.get("ytd"), "spark": bstats.get("spark", []),
            "top": cands[:10],
            "largest": largest,
        })

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
        # S&P 500 tickers for the Matrix rain background
        "rainTickers": sorted({str(t) for t in members["sp500"]["symbol"] if str(t).strip()}),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False, default=str))
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


def clean(r: dict) -> dict:
    keep = ("ticker", "symbol", "name", "sector", "price", "chg1d", "chg1w", "chg1m", "chg3m", "ytd",
            "high52", "low52", "fromHigh", "mcap", "mcapUsd", "recMean", "rating", "analysts", "target",
            "upside", "earnings", "score", "spark", "indexes", "divYield", "divFreq")
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
                and r["chg3m"] > 0 and r["aboveSma50"]):
            why = [f"up {r['chg3m']:.0f}% in 3 months",
                   f"{r['analysts']} analysts rate it {r['rating']}",
                   f"average target {r['upside']:.0f}% above today's price"]
            if r["fromHigh"] is not None and r["fromHigh"] > -3:
                why.append("trading near its 52-week high")
            ideas.append({**clean(r), "why": why,
                          "ideaScore": round(r["score"] + min(r["upside"], 50) * 0.4, 1)})
    ideas.sort(key=lambda r: r["ideaScore"], reverse=True)
    return ideas[:12]


def sell_ideas(stocks: list[dict]) -> list[dict]:
    """Falling stocks that analysts are cool on or that trade above their price target."""
    ideas, seen = [], set()
    for r in stocks:
        if r["ticker"] in seen or r["chg3m"] is None or r["chg3m"] >= 0 or r["aboveSma50"]:
            continue
        rated_low = r["recMean"] is not None and r["recMean"] >= 2.8 and (r["analysts"] or 0) >= 3
        over_target = r["upside"] is not None and r["upside"] < 0
        if not (rated_low or over_target):
            continue
        seen.add(r["ticker"])
        why = [f"down {abs(r['chg3m']):.0f}% in 3 months", "trading below its 50-day average"]
        if rated_low:
            why.append(f"{r['analysts']} analysts rate it {r['rating']}")
        if over_target:
            why.append(f"price is {abs(r['upside']):.0f}% above the average analyst target")
        weakness = -r["chg3m"] + (r["recMean"] or 2.5) * 8 + max(0, -(r["upside"] or 0))
        ideas.append({**clean(r), "why": why, "ideaScore": round(weakness, 1)})
    ideas.sort(key=lambda r: r["ideaScore"], reverse=True)
    return ideas[:12]


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
    build()
