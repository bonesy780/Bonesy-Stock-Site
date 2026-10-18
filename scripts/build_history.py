"""Build price history for the stock lookup page.

Writes site/stocks.json (the searchable list) and one site/hist/<ticker>.json per
stock with 5 days of 5-minute prices and daily prices back to the listing date.
Run after build_data.py:
    python scripts/build_history.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import CONSTITUENTS, INDEXES, to_yahoo  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
HIST = SITE / "hist"
BATCH = 100


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def closes(tickers: list[str], **kw) -> dict[str, pd.Series]:
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
                s = df[t]["Close"] if isinstance(df.columns, pd.MultiIndex) else df["Close"]
            except KeyError:
                continue
            s = s.dropna()
            if len(s):
                out[t] = s
    return out


def thin(s: pd.Series) -> pd.Series:
    """Every day for the last 13 months, weekly back to 6 years, then monthly."""
    end = s.index[-1]
    recent = s[s.index >= end - pd.Timedelta(days=400)]
    mid = s[(s.index < recent.index[0]) & (s.index >= end - pd.Timedelta(days=6 * 365))]
    old = s[s.index < (mid.index[0] if len(mid) else recent.index[0])]
    return pd.concat([old.iloc[::21], mid.iloc[::5], recent])


def points(s: pd.Series) -> list:
    nd = 2 if s.abs().max() >= 100 else 4
    return [[int(ts.timestamp()), round(float(v), nd)] for ts, v in s.items()]


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
    daily = closes(tickers, period="max", interval="1d")
    intraday = closes(tickers, period="5d", interval="5m")
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
