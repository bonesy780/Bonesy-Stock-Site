"""Build site/market.json and site/fund/<ticker>.json: facts on every stock.

market.json holds one compact row per stock in all eight indexes (price moves,
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
from build_data import CONSTITUENTS, INDEXES, extra_listings, fx_rates, target_upside, to_yahoo  # noqa: E402
from safe_io import write_json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = SITE / "market.json"
FUND = SITE / "fund"
BATCH = 200
INFO_WORKERS = 4
INFO_BUDGET = 20 * 60   # seconds; stop asking Yahoo for company facts after this (the run has a time limit)
INFO_GIVE_UP = 40       # stocks in a row with no facts before giving up on Yahoo for this run

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
    "earningsTimestampStart", "earningsTimestampEnd", "earningsTimestamp", "isEarningsDateEstimate",
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
    # New listings outside the indexes join once they have the month of trading the figures need
    for e in extra_listings():
        out.setdefault(e["t"], {k: e[k] for k in ("t", "s", "n", "cur", "region", "ix")})
    return out


def ohlcv(tickers: list[str]) -> dict[str, pd.DataFrame]:
    """13 months of daily bars (traded prices, split adjusted only)."""
    out = {}
    for i in range(0, len(tickers), BATCH):
        batch = tickers[i:i + BATCH]
        df = None
        for attempt in range(2):
            try:
                # actions=True adds each day's dividend (in the share price's currency) at no extra cost
                df = yf.download(batch, period="13mo", interval="1d", auto_adjust=False, group_by="ticker",
                                 threads=True, progress=False, actions=True)
                if df is not None and len(df):
                    break
            except Exception as e:
                log(f"price batch {i} failed ({e}), retry {attempt + 1}")
            time.sleep(10)
        if df is None or not len(df):
            continue
        for t in batch:
            try:
                sub = df[t] if isinstance(df.columns, pd.MultiIndex) else df
                cols = [c for c in ("Open", "High", "Low", "Close", "Volume", "Dividends") if c in sub]
                f = sub[cols].dropna(subset=["Close"])
            except KeyError:
                continue
            if len(f) > 30:
                out[t] = f
    return out


def pct(a, b):
    return None if a is None or not b or b != b else (a / b - 1) * 100


def paid_last_year(f: pd.DataFrame) -> float | None:
    """Regular dividends paid over the last 12 months from the price history, leaving out one-off specials."""
    if "Dividends" not in f:
        return None
    d = f["Dividends"].fillna(0)
    d = d[d > 0]
    if d.empty:
        return 0.0
    usual = d.median()
    year = d[d.index > f.index[-1] - pd.Timedelta(days=365)]
    return float(year[year <= usual * 2.5].sum()) if len(d) > 2 else float(year.sum())


def dividend_rate(inf: dict, history: float | None) -> float | None:
    """Yearly dividend per share, in the share price's currency.

    Yahoo's forward rate is used unless it is far above what the company actually paid in the last year (it
    is badly inflated for some Korean stocks), in which case the last year's payments are used. A forward
    rate well below the last year's is kept, since that is usually a dividend cut. Yahoo's trailing rate is only a fallback when the company reports in
    the same currency its shares trade in, since it is otherwise in the reporting currency.
    """
    fwd = inf.get("dividendRate")
    if history:
        return fwd if fwd and fwd <= history * 1.5 else history
    if history == 0.0:
        return None  # nothing paid in the last 12 months
    if fwd:
        return fwd
    if inf.get("financialCurrency") in (None, inf.get("currency")):
        return inf.get("trailingAnnualDividendRate") or None
    return None


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


# When Yahoo turns the request away, yfinance can still hand back a few stray fields (often just
# trailingPegRatio) instead of failing. Count a reply as real only when it names the company or its size.
REAL_INFO = ("marketCap", "shortName", "longName", "sector", "quoteType")


def info(t: str, tries: int = 3) -> dict:
    for attempt in range(tries):
        try:
            got = yf.Ticker(t).info or {}
            if any(got.get(k) for k in REAL_INFO):
                return got
            err = "empty reply"
        except Exception as e:
            err = str(e)
        if attempt == tries - 1:
            log(f"info {t} failed ({err})")
        # Yahoo rate limits bursts; back off much longer when it says so or sends back nothing
        time.sleep((15 if "Too Many" in err or err == "empty reply" else 2) * (attempt + 1))
    return {}


# Facts that come from Yahoo's company info rather than the price history. When Yahoo sends none for a stock,
# the last build's values are kept so one bad run never leaves the heatmap, screener and tools without sizes.
FACT_KEYS = ("n", "sector", "industry", "mcap", "mcapUsd", "pe", "fpe", "peg", "pb", "ps", "evEbitda", "eps",
             "feps", "revGrowth", "epsGrowth", "margin", "roe", "de", "beta", "divRate", "divYield", "payout",
             "exDiv", "recMean", "rec", "analysts", "target", "upside", "earnings", "earnAt", "earnEst",
             "shortFloat")


def previous_rows() -> dict:
    try:
        return {r["t"]: r for r in json.loads(OUT.read_text())["stocks"]}
    except Exception:
        return {}


def carry_forward(row: dict, old: dict, rate: float) -> None:
    """Fill a row Yahoo sent no facts for from the last build, moving its size with the price."""
    for k in FACT_KEYS:
        if row.get(k) is None and old.get(k) is not None:
            row[k] = old[k]
    move = row["p"] / old["p"] if row.get("p") and old.get("p") else 1.0
    if old.get("mcap"):
        row["mcap"] = num(old["mcap"] * move, 0)
        row["mcapUsd"] = num(row["mcap"] / rate, 0)
    if old.get("pe"):
        row["pe"] = num(old["pe"] * move, 2)
    if row.get("divRate") and row.get("p"):
        row["divYield"] = num(row["divRate"] / row["p"] * 100, 2)


def write_fund(t: str, body: dict, inf: dict) -> None:
    """The company profile and financial figures the stock lookup shows, in site/fund/."""
    for k in FUND_KEYS:
        v = inf.get(k)
        if isinstance(v, (int, float)):
            v = num(v, 6)
        if v not in (None, ""):
            body[k] = v
    (FUND / f"{t.replace('^', '_')}.json").write_text(json.dumps(body, separators=(",", ":"), ensure_ascii=False))


def build():
    now = datetime.now(timezone.utc)
    stocks = members()
    tickers = sorted(stocks)
    rates = fx_rates()
    log(f"{len(tickers)} stocks; downloading 13 months of prices")
    bars = ohlcv(tickers)
    log(f"prices for {len(bars)} stocks; fetching company facts")
    before = previous_rows()
    # Yahoo refusing most price requests would leave the screener, heatmap and every tool page with a
    # handful of stocks. Keep the last good market.json instead (its date shows on each page).
    if before and len(bars) < len(before) * 0.6:
        log(f"::error::prices came back for only {len(bars)} stocks against {len(before)} last time, "
            "keeping the last good market facts")
        sys.exit(2)

    start = time.monotonic()
    # If Yahoo refuses a long run of stocks in a row it is turning everyone away; stop asking and keep the
    # last build's facts instead of spending the whole time budget on refusals.
    streak = {"n": 0}
    def facts(t):
        if time.monotonic() - start > INFO_BUDGET or streak["n"] >= INFO_GIVE_UP:
            return t, {}
        got = info(t)
        streak["n"] = 0 if got else streak["n"] + 1
        if streak["n"] == INFO_GIVE_UP:
            log(f"Yahoo refused {INFO_GIVE_UP} stocks in a row, not asking for more company facts this run")
        return t, got
    with ThreadPoolExecutor(max_workers=INFO_WORKERS) as ex:
        infos = dict(ex.map(facts, sorted(bars)))
    log(f"company facts for {sum(1 for v in infos.values() if v)} stocks")
    # Second, slower pass for the ones Yahoo turned away
    missing = [t for t, v in infos.items() if not v]
    if missing and time.monotonic() - start < INFO_BUDGET:
        streak["n"] = 0
        log(f"retrying {len(missing)} stocks more slowly")
        time.sleep(30)
        with ThreadPoolExecutor(max_workers=2) as ex:
            infos.update((t, v) for t, v in ex.map(facts, missing) if v)
        log(f"company facts for {sum(1 for v in infos.values() if v)} stocks after retrying")

    # Dividends from the price history. If the download carried none at all, something went wrong on Yahoo's
    # side, so fall back to its own dividend rates rather than show every stock as not paying.
    paid = {t: paid_last_year(f) for t, f in bars.items()}
    if sum(1 for v in paid.values() if v) < len(paid) * 0.1:
        log("price history carried almost no dividends, using Yahoo's dividend rates")
        paid = {}
    FUND.mkdir(parents=True, exist_ok=True)
    carried = 0
    rows = []
    for t in sorted(bars):
        m, f, inf = stocks[t], bars[t], infos.get(t) or {}
        st = stats(f)
        rate = rates.get(m["cur"]) or 1.0
        cap = inf.get("marketCap")
        price = st["p"]
        div_rate = dividend_rate(inf, paid.get(t))
        earn = inf.get("earningsTimestampStart") or inf.get("earningsTimestamp")
        # Targets that are missing, from no analysts or wildly off the price (bad data) are left out
        upside = target_upside(inf.get("targetMeanPrice"), price, inf.get("numberOfAnalystOpinions"))
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
            "target": sig(inf.get("targetMeanPrice")) if upside is not None else None,
            "upside": num(upside, 2),
            "earnings": day(earn),
            # Exact time of the report (seconds), and whether the date is still Yahoo's estimate
            "earnAt": int(earn) if earn else None,
            "earnEst": True if earn and (inf.get("isEarningsDateEstimate")
                                         or (inf.get("earningsTimestampEnd") or earn) != earn) else None,
            "shortFloat": num(inf.get("shortPercentOfFloat") * 100, 2) if inf.get("shortPercentOfFloat") is not None else None,
        }
        if not inf and t in before:
            carry_forward(row, before[t], rate)
            carried += 1
        rows.append({k: v for k, v in row.items() if v is not None and v != []})
        if inf:
            body = {"t": t, "asOf": now.isoformat(timespec="minutes"), "price": num(price), "cur": m["cur"]}
            write_fund(t, body, inf)

    # New listings too young for the figures above (under ~30 trading days) still get their company profile
    for e in extra_listings():
        t = e["t"]
        if t in bars:
            continue
        inf = info(t)
        if inf:
            price = inf.get("currentPrice") or inf.get("regularMarketPrice")
            write_fund(t, {"t": t, "asOf": now.isoformat(timespec="minutes"), "price": num(price), "cur": e["cur"]}, inf)
            log(f"company profile for new listing {t}")

    # Stocks whose prices didn't come back this time keep last build's row (with its own asOf date), so a
    # few refused requests don't make them vanish from the screener and heatmap
    have = {r["t"] for r in rows}
    kept = [before[t] for t in tickers if t not in have and t in before]
    if kept:
        log(f"::warning::no prices for {len(kept)} stocks this run, kept their last saved rows")
        rows += kept
    out = {"generated": now.isoformat(timespec="minutes"), "fx": rates,
           "indexes": [{"id": ix["id"], "name": ix["name"], "currency": ix["currency"]} for ix in INDEXES],
           "stocks": rows}
    write_json(OUT, out, ensure_ascii=False, allow_nan=False)
    if carried:
        log(f"::warning::Yahoo sent no company facts for {carried} stocks, kept their facts from the last build")
    sized = sum(1 for r in rows if r.get("mcapUsd"))
    log(f"wrote {len(rows)} stocks to {OUT} ({sized} with a company size)")


if __name__ == "__main__":
    build()
