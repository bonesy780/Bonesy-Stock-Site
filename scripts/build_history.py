"""Build price history for the stock lookup page.

Writes site/stocks.json (the searchable list) and one site/hist/<ticker>.json per
stock with 5 days of 5-minute prices and daily prices back to the listing date,
each as [time, close, volume], for the chart and its technical indicators.
Run after build_data.py:
    python scripts/build_history.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import CONSTITUENTS, INDEXES, to_yahoo  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
HIST = SITE / "hist"
BATCH = 100
DAILY_DAYS = 800


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def bars(tickers: list[str], **kw) -> dict[str, pd.DataFrame]:
    """Closing price ("c") and volume ("v") for each ticker."""
    out = {}
    for i in range(0, len(tickers), BATCH):
        batch = tickers[i:i + BATCH]
        try:
            df = yf.download(batch, auto_adjust=True, group_by="ticker", threads=True, progress=False, **kw)
        except Exception as e:
            log(f"download failed for batch {i} ({e})")
            continue
        for t in batch:
            try:
                sub = df[t] if isinstance(df.columns, pd.MultiIndex) else df
                f = pd.DataFrame({"c": sub["Close"], "v": sub["Volume"] if "Volume" in sub else float("nan")})
            except KeyError:
                continue
            f = f.dropna(subset=["c"])
            if len(f):
                out[t] = f
    return out


def every(f: pd.DataFrame, n: int) -> pd.DataFrame:
    """One row per n trading days: the last close and the total volume of each group."""
    if not len(f):
        return f
    g = np.arange(len(f)) // n
    out = f.groupby(g).agg(c=("c", "last"), v=("v", lambda v: v.sum(min_count=1)))
    out.index = pd.DatetimeIndex(f.index.to_series().groupby(g).last().tolist())
    return out


def thin(f: pd.DataFrame) -> pd.DataFrame:
    """Every day for the last DAILY_DAYS, weekly back to 6 years, then monthly.

    The daily stretch is long enough that a 200-day average is already warmed
    up at the start of the 1-year chart.
    """
    end = f.index[-1]
    recent = f[f.index >= end - pd.Timedelta(days=DAILY_DAYS)]
    mid = f[(f.index < recent.index[0]) & (f.index >= end - pd.Timedelta(days=6 * 365))]
    old = f[f.index < (mid.index[0] if len(mid) else recent.index[0])]
    return pd.concat([every(old, 21), every(mid, 5), recent])


def points(f: pd.DataFrame) -> list:
    """[unixSeconds, close, volume] rows; volume is null when Yahoo has none."""
    nd = 2 if f["c"].abs().max() >= 100 else 4
    return [[int(pd.Timestamp(ts).timestamp()), round(float(c), nd), None if pd.isna(v) else int(v)]
            for ts, c, v in zip(f.index, f["c"], f["v"])]


def build():
    stocks: dict[str, dict] = {}
    for ix in INDEXES:
        cache = CONSTITUENTS / f"{ix['id']}.csv"
        if not cache.exists():
            continue
        df = pd.read_csv(cache, dtype=str, keep_default_na=False)
        for sym, name in zip(df["symbol"], df["name"]):
            t = to_yahoo(sym, ix)
            e = stocks.setdefault(t, {"t": t, "s": sym, "n": name, "cur": ix["currency"],
                                      "region": ix["region"], "ix": []})
            e["ix"].append(ix["name"])
        stocks[ix["benchmark"]] = {"t": ix["benchmark"], "s": ix["benchmark"], "n": ix["name"] + " index",
                                   "cur": ix["currency"], "region": ix["region"], "ix": [], "index": True}

    tickers = sorted(stocks)
    log(f"downloading history for {len(tickers)} tickers")
    daily = bars(tickers, period="max", interval="1d")
    intraday = bars(tickers, period="5d", interval="5m")
    log(f"daily: {len(daily)}, intraday: {len(intraday)}")

    HIST.mkdir(parents=True, exist_ok=True)
    listed = []
    for t in tickers:
        d = daily.get(t)
        if d is None or len(d) < 2:
            continue
        i = intraday.get(t)
        body = {"t": t, "d": points(thin(d)), "i": points(i) if i is not None else []}
        (HIST / f"{t.replace('^', '_')}.json").write_text(json.dumps(body, separators=(",", ":")))
        listed.append(stocks[t])
    (SITE / "stocks.json").write_text(json.dumps(listed, separators=(",", ":"), ensure_ascii=False))
    log(f"wrote {len(listed)} histories to {HIST}")


if __name__ == "__main__":
    build()
