"""Build site/market.json and site/fund/<ticker>.json: facts on every stock.

market.json holds one compact row per stock in all seven indexes (price moves,
volume, valuation, dividends, analyst views, next earnings date). It feeds the
screener, market movers, sector heatmap, watchlists, compare page and calendar.

fund/<ticker>.json holds the longer company profile and financial figures for
the Financials tab on the stock lookup page.

Data comes from Yahoo Finance through yfinance. Run from the repo root after
build_data.py (any order works; it does not read build_data's output):
    python scripts/build_market.py
"""
from __future__ import annotations

import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import CONSTITUENTS, INDEXES, fx_rates, to_yahoo  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = SITE / "market.json"
FUND = SITE / "fund"
BATCH = 200
INFO_WORKERS = 4
INFO_BUDGET = 40 * 60   # seconds; stop asking Yahoo for company facts after this

# Company facts kept for the Financials tab (Yahoo's .info names)
FUND_KEYS = (
    "longName", "sector", "industry", "country", "city", "website", "fullTimeEmployees", "longBusinessSummary",
    "marketCap", "enterpriseValue", "sharesOutstanding", "floatShares", "heldPercentInsiders",
    "heldPercentInstitutions", "shortPercentOfFloat", "shortRatio",
    "trailingPE", "forwardPE", "trailingPegRatio", "priceToBook", "priceToSalesTrailing12Months",
    "enterpriseToEbitda", "enterpriseToRevenue",
    "totalRevenue", "revenueGrowth", "grossMargins", "operatingMargins", "profitMargins", "ebitda",
    "netIncomeToCommon", "earningsGrowth", "earningsQuarterlyGrowth", "trailingEps", "forwardEps",
    "returnOnEquity", "returnOnAssets", "totalCash", "totalDebt", "debtToEquity", "currentRatio",
    "quickRatio", "freeCashflow", "operatingCashflow", "bookValue",
    "dividendRate", "trailingAnnualDividendRate", "payoutRatio", "fiveYearAvgDividendYield",
    "exDividendDate", "lastDividendValue", "lastDividendDate",
    "beta", "averageVolume", "averageVolume10days",
    "recommendationMean", "recommendationKey", "numberOfAnalystOpinions",
    "targetMeanPrice", "targetHighPrice", "targetLowPrice", "targetMedianPrice",
    "earningsTimestampStart", "earningsTimestampEnd", "earningsTimestamp",
)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def num(v, nd=4):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) or math.isinf(v) else round(v, nd)


def sig(v, n=5):
    """Round to n significant digits (prices) to keep market.json small."""
    v = num(v, 12)
    if not v:
        return v
    return round(v, max(0, n - 1 - math.floor(math.log10(abs(v)))))


PRICE_KEYS = {"p", "o", "h", "l", "pc", "hi52", "lo52", "sma50", "sma200"}


def day(ts):
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).date().isoformat() if ts else None
    except (TypeError, ValueError, OSError):
        return None


def members() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for ix in INDEXES:
        cache = CONSTITUENTS / f"{ix['id']}.csv"
        if not cache.exists():
            continue
        df = pd.read_csv(cache, dtype=str, keep_default_na=False)
        for sym, name in zip(df["symbol"], df["name"]):
            t = to_yahoo(sym, ix)
            e = out.setdefault(t, {"t": t, "s": sym, "n": name, "cur": ix["currency"],
                                   "region": ix["region"], "ix": []})
            e["ix"].append(ix["id"])
    return out


def ohlcv(tickers: list[str]) -> dict[str, pd.DataFrame]:
    """13 months of daily bars (traded prices, split adjusted only)."""
    out = {}
    for i in range(0, len(tickers), BATCH):
        batch = tickers[i:i + BATCH]
        try:
            df = yf.download(batch, period="13mo", interval="1d", auto_adjust=False, group_by="ticker",
                             threads=True, progress=False)
        except Exception as e:
            log(f"price batch {i} failed ({e})")
            continue
        for t in batch:
            try:
                sub = df[t] if isinstance(df.columns, pd.MultiIndex) else df
                f = sub[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
            except KeyError:
                continue
            if len(f) > 30:
                out[t] = f
    return out


def pct(a, b):
    return None if a is None or not b or b != b else (a / b - 1) * 100


def stats(f: pd.DataFrame) -> dict:
    c, v = f["Close"], f["Volume"].fillna(0)
    last = float(c.iloc[-1])
    back = lambda n: float(c.iloc[-n - 1]) if len(c) > n else None  # noqa: E731
    year = f[f.index >= f.index[-1] - pd.Timedelta(days=365)]
    ys = c[c.index >= pd.Timestamp(c.index[-1].year, 1, 1, tz=c.index.tz)]
    ytd_base = float(c[c.index < ys.index[0]].iloc[-1]) if len(ys) and len(c) > len(ys) else None
    hi, lo = float(year["High"].max()), float(year["Low"].min())
    sma = lambda n: float(c.iloc[-n:].mean()) if len(c) >= n else None  # noqa: E731
    # 14-day RSI (Wilder) so the screener can find overbought and oversold names
    d = c.diff().dropna()
    gain = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean().iloc[-1]
    loss = (-d.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean().iloc[-1]
    rsi = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    avg_vol = float(v.iloc[-51:-1].mean()) if len(v) > 51 else float(v.mean())
    # Daily moves' spread over the last 3 months, yearly scale, as a rough risk gauge
    vol3m = float(c.pct_change().iloc[-63:].std() * math.sqrt(252) * 100)
    return {
        "p": last, "o": float(f["Open"].iloc[-1]), "h": float(f["High"].iloc[-1]), "l": float(f["Low"].iloc[-1]),
        "pc": back(1),
        "d1": pct(last, back(1)), "w1": pct(last, back(5)), "m1": pct(last, back(21)),
        "m3": pct(last, back(63)), "m6": pct(last, back(126)), "y1": pct(last, back(250)),
        "ytd": pct(last, ytd_base),
        "hi52": hi, "lo52": lo, "fromHi": pct(last, hi), "fromLo": pct(last, lo),
        "sma50": sma(50), "sma200": sma(200), "rsi": rsi,
        "vol": float(v.iloc[-1]), "avgVol": avg_vol, "relVol": float(v.iloc[-1]) / avg_vol if avg_vol else None,
        "volat": vol3m,
        "spark": [round(float(x), 4) for x in c.iloc[-22:].tolist()],
        "asOf": c.index[-1].date().isoformat(),
        "sig": signals(f),
    }


def crossed(a: pd.Series, b: pd.Series, days: int) -> int:
    """+1 if a crossed above b within the last `days` sessions, -1 if below, else 0."""
    d = (a - b).dropna()
    if len(d) < days + 1:
        return 0
    side = (d > 0).astype(int)
    recent = side.iloc[-days - 1:]
    if recent.iloc[-1] == recent.iloc[0]:
        return 0
    return 1 if recent.iloc[-1] == 1 else -1


def signals(f: pd.DataFrame) -> list[str]:
    """Technical events in the last few sessions, for the signals page."""
    c, v = f["Close"], f["Volume"].fillna(0)
    out = []
    if len(c) < 60:
        return out
    sma50, sma200 = c.rolling(50).mean(), c.rolling(200).mean()
    if len(c) >= 210:
        x = crossed(sma50, sma200, 10)
        if x > 0:
            out.append("goldenCross")
        elif x < 0:
            out.append("deathCross")
    x = crossed(c, sma50, 3)
    if x > 0:
        out.append("above50")
    elif x < 0:
        out.append("below50")
    if len(c) >= 205:
        x = crossed(c, sma200, 3)
        if x > 0:
            out.append("above200")
        elif x < 0:
            out.append("below200")
    ema = lambda n: c.ewm(span=n, adjust=False).mean()  # noqa: E731
    macd = ema(12) - ema(26)
    x = crossed(macd, macd.ewm(span=9, adjust=False).mean(), 3)
    if x > 0:
        out.append("macdBull")
    elif x < 0:
        out.append("macdBear")
    # 20-day breakout: today's close above every close of the 20 sessions before it
    if c.iloc[-1] > c.iloc[-21:-1].max():
        out.append("high20")
    elif c.iloc[-1] < c.iloc[-21:-1].min():
        out.append("low20")
    # Volume surge with a big move
    avg = v.iloc[-51:-1].mean()
    move = (c.iloc[-1] / c.iloc[-2] - 1) * 100
    if avg and v.iloc[-1] > 2 * avg and abs(move) >= 2:
        out.append("volUp" if move > 0 else "volDown")
    # Bollinger squeeze: band width at its narrowest in 6 months
    mid, sd = c.rolling(20).mean(), c.rolling(20).std()
    width = (4 * sd / mid).dropna()
    if len(width) >= 120 and width.iloc[-1] <= width.iloc[-126:].min() * 1.02:
        out.append("squeeze")
    d = c.diff().dropna()
    gain = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-d.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    rsi = 100 - 100 / (1 + gain / loss.replace(0, float("nan")))
    rsi = rsi.fillna(100)
    if rsi.iloc[-1] < 30:
        out.append("oversold")
    elif rsi.iloc[-1] > 70:
        out.append("overbought")
    elif rsi.iloc[-2] < 30 <= rsi.iloc[-1]:
        out.append("rsiRebound")
    return out


def info(t: str, tries: int = 3) -> dict:
    for attempt in range(tries):
        try:
            return yf.Ticker(t).info or {}
        except Exception as e:
            if attempt == tries - 1:
                log(f"info {t} failed ({e})")
            # Yahoo rate limits bursts; back off much longer when it says so
            time.sleep((15 if "Too Many" in str(e) else 2) * (attempt + 1))
    return {}


def build():
    now = datetime.now(timezone.utc)
    stocks = members()
    tickers = sorted(stocks)
    rates = fx_rates()
    log(f"{len(tickers)} stocks; downloading 13 months of prices")
    bars = ohlcv(tickers)
    log(f"prices for {len(bars)} stocks; fetching company facts")

    start = time.monotonic()
    def facts(t):
        if time.monotonic() - start > INFO_BUDGET:
            return t, {}
        return t, info(t)
    with ThreadPoolExecutor(max_workers=INFO_WORKERS) as ex:
        infos = dict(ex.map(facts, sorted(bars)))
    log(f"company facts for {sum(1 for v in infos.values() if v)} stocks")
    # Second, slower pass for the ones Yahoo turned away
    missing = [t for t, v in infos.items() if not v]
    if missing and time.monotonic() - start < INFO_BUDGET:
        log(f"retrying {len(missing)} stocks more slowly")
        time.sleep(30)
        with ThreadPoolExecutor(max_workers=2) as ex:
            infos.update((t, v) for t, v in ex.map(facts, missing) if v)
        log(f"company facts for {sum(1 for v in infos.values() if v)} stocks after retrying")

    FUND.mkdir(parents=True, exist_ok=True)
    rows = []
    for t in sorted(bars):
        m, f, inf = stocks[t], bars[t], infos.get(t) or {}
        st = stats(f)
        rate = rates.get(m["cur"]) or 1.0
        cap = inf.get("marketCap")
        price = st["p"]
        div_rate = inf.get("dividendRate") or inf.get("trailingAnnualDividendRate")
        earn = inf.get("earningsTimestampStart") or inf.get("earningsTimestamp")
        row = {
            "t": t, "s": m["s"], "n": inf.get("shortName") or m["n"], "cur": m["cur"], "region": m["region"],
            "ix": m["ix"], "sector": inf.get("sector"), "industry": inf.get("industry"),
            **{k: sig(v) if k in PRICE_KEYS else num(v, 2) for k, v in st.items() if k not in ("spark", "asOf", "vol", "avgVol", "sig")},
            "sig": st["sig"],
            "vol": num(st["vol"], 0), "avgVol": num(st["avgVol"], 0),
            "spark": [sig(x, 4) for x in st["spark"]], "asOf": st["asOf"],
            "dollarVolUsd": num(st["vol"] * price / rate, 0),
            "mcap": num(cap, 0), "mcapUsd": num(cap / rate, 0) if cap else None,
            "pe": num(inf.get("trailingPE"), 2), "fpe": num(inf.get("forwardPE"), 2),
            "peg": num(inf.get("trailingPegRatio"), 2), "pb": num(inf.get("priceToBook"), 2),
            "ps": num(inf.get("priceToSalesTrailing12Months"), 2), "evEbitda": num(inf.get("enterpriseToEbitda"), 2),
            "eps": sig(inf.get("trailingEps"), 4), "feps": sig(inf.get("forwardEps"), 4),
            "revGrowth": num((inf.get("revenueGrowth") or 0) * 100, 2) if inf.get("revenueGrowth") is not None else None,
            "epsGrowth": num((inf.get("earningsGrowth") or 0) * 100, 2) if inf.get("earningsGrowth") is not None else None,
            "margin": num(inf.get("profitMargins") * 100, 2) if inf.get("profitMargins") is not None else None,
            "roe": num(inf.get("returnOnEquity") * 100, 2) if inf.get("returnOnEquity") is not None else None,
            "de": num(inf.get("debtToEquity"), 2), "beta": num(inf.get("beta"), 2),
            # Yield from the yearly dividend and today's price, in percent
            "divRate": sig(div_rate, 4), "divYield": num(div_rate / price * 100, 2) if div_rate and price else None,
            "payout": num(inf.get("payoutRatio") * 100, 2) if inf.get("payoutRatio") is not None else None,
            "exDiv": day(inf.get("exDividendDate")),
            "recMean": num(inf.get("recommendationMean"), 2), "rec": inf.get("recommendationKey"),
            "analysts": inf.get("numberOfAnalystOpinions"),
            "target": sig(inf.get("targetMeanPrice")),
            "upside": num(pct(inf.get("targetMeanPrice"), price), 2) if inf.get("targetMeanPrice") else None,
            "earnings": day(earn),
            "shortFloat": num(inf.get("shortPercentOfFloat") * 100, 2) if inf.get("shortPercentOfFloat") is not None else None,
        }
        rows.append({k: v for k, v in row.items() if v is not None and v != []})
        if inf:
            body = {"t": t, "asOf": now.isoformat(timespec="minutes"), "price": num(price), "cur": m["cur"]}
            for k in FUND_KEYS:
                v = inf.get(k)
                if isinstance(v, (int, float)):
                    v = num(v, 6)
                if v not in (None, ""):
                    body[k] = v
            (FUND / f"{t.replace('^', '_')}.json").write_text(json.dumps(body, separators=(",", ":"), ensure_ascii=False))

    out = {"generated": now.isoformat(timespec="minutes"), "fx": rates,
           "indexes": [{"id": ix["id"], "name": ix["name"], "currency": ix["currency"]} for ix in INDEXES],
           "stocks": rows}
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False, allow_nan=False))
    log(f"wrote {len(rows)} stocks to {OUT}")


if __name__ == "__main__":
    build()
