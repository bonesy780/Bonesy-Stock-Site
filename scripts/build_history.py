"""Build price history for the stock lookup page.

Writes site/stocks.json (the searchable list) and one site/hist/<ticker>.json per
stock with 5 days of 5-minute prices and daily prices back to the listing date,
each as [time, close, volume], for the chart and its technical indicators.

Prices are the actual closes people saw (adjusted for splits only, not for
dividends), so old highs and lows match what the stock really traded at.
Also writes site/closes/<index>/<YYYY-MM>.json: every member's daily close for
each month of the last CLOSES_YEARS years, so the heatmap can color stocks by
their move between any two dates while loading only the months it needs.

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
from build_data import CONSTITUENTS, INDEXES, extra_listings, to_yahoo  # noqa: E402
from safe_io import read_json, write_json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
HIST = SITE / "hist"
BATCH = 100
DAILY_DAYS = 800
CLOSES = SITE / "closes"
CLOSES_YEARS = 10


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def bars(tickers: list[str], **kw) -> dict[str, pd.DataFrame]:
    """Closing price ("c") and volume ("v") for each ticker."""
    out = {}
    for i in range(0, len(tickers), BATCH):
        batch = tickers[i:i + BATCH]
        try:
            # auto_adjust=False keeps "Close" as the traded close (split adjusted only).
            # Dividend-adjusted closes pull every past price down, by a lot for
            # high-dividend stocks, so old peaks never showed at their real level.
            df = yf.download(batch, auto_adjust=False, group_by="ticker", threads=True, progress=False, **kw)
        except Exception as e:
            log(f"download failed for batch {i} ({e})")
            continue
        for t in batch:
            try:
                sub = df[t] if isinstance(df.columns, pd.MultiIndex) else df
                f = pd.DataFrame({"c": sub["Close"], "v": sub["Volume"] if "Volume" in sub else float("nan"),
                                  "h": sub["High"] if "High" in sub else float("nan"),
                                  "l": sub["Low"] if "Low" in sub else float("nan")})
            except KeyError:
                continue
            f = f.dropna(subset=["c"])
            if len(f):
                out[t] = f
    return out


def range52(d: pd.DataFrame) -> dict:
    """The 52-week high and low from each day's intraday high and low, as broker
    sites show them (closing prices alone can miss a sharp dip that recovered the
    same day). Falls back to closes where Yahoo has no high or low."""
    y = d[d.index >= d.index[-1] - pd.Timedelta(days=365)]
    hi = pd.concat([y["h"], y["c"]]).max()
    lo = pd.concat([y["l"].where(y["l"] > 0), y["c"]]).min()
    nd = 2 if y["c"].abs().max() >= 100 else 4
    return {"hi52": round(float(hi), nd), "lo52": round(float(lo), nd)} if hi == hi and lo == lo else {}


def every(f: pd.DataFrame, n: int) -> pd.DataFrame:
    """Thin to groups of n trading days, keeping each group's highest close,
    lowest close and last close (in date order) so peaks and troughs survive.

    The group's total volume goes on its last day; the other kept days get none.
    """
    if not len(f):
        return f
    g = np.arange(len(f)) // n
    rows = []
    for _, grp in f.groupby(g):
        last = len(grp) - 1
        keep = sorted({int(np.nanargmax(grp["c"].values)), int(np.nanargmin(grp["c"].values)), last})
        vol = grp["v"].sum(min_count=1)
        for k in keep:
            rows.append((grp.index[k], grp["c"].iloc[k], vol if k == last else float("nan")))
    return pd.DataFrame([(c, v) for _, c, v in rows], columns=["c", "v"],
                        index=pd.DatetimeIndex([ts for ts, _, _ in rows]))


def thin(f: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Every day for the last DAILY_DAYS, weekly back to 6 years, then monthly.

    The daily stretch is long enough that a 200-day average is already warmed
    up at the start of the 1-year chart. Also returns how many rows at the end
    are the unthinned daily stretch.
    """
    end = f.index[-1]
    recent = f[f.index >= end - pd.Timedelta(days=DAILY_DAYS)]
    mid = f[(f.index < recent.index[0]) & (f.index >= end - pd.Timedelta(days=6 * 365))]
    old = f[f.index < (mid.index[0] if len(mid) else recent.index[0])]
    return pd.concat([every(old, 21), every(mid, 5), recent]), len(recent)


def points(f: pd.DataFrame) -> list:
    """[unixSeconds, close, volume] rows; volume is null when Yahoo has none."""
    nd = 2 if f["c"].abs().max() >= 100 else 4
    return [[int(pd.Timestamp(ts).timestamp()), round(float(c), nd), None if pd.isna(v) else int(v)]
            for ts, c, v in zip(f.index, f["c"], f["v"])]


# Longer trend lines for the screener's trend column: [key, days back] (None = year to date, 0 = all)
TRENDS = [("m6", 182), ("y1", 365), ("ytd", None), ("y5", 1826), ("y10", 3652), ("all", 0)]
TREND_POINTS = 30


def trends(f: pd.DataFrame) -> dict:
    """TREND_POINTS evenly spaced closes for each period the history covers."""
    out = {}
    idx = f.index.values.astype("datetime64[s]").astype(np.int64)
    c = f["c"].values
    end, first = idx[-1], idx[0]
    year_start = int(pd.Timestamp(f.index[-1].year, 1, 1).timestamp())
    for key, days in TRENDS:
        start = first if days == 0 else year_start if days is None else end - days * 86400
        # Skip periods longer than the stock's history (allow a week of slack)
        if start < first - 7 * 86400:
            continue
        start = max(start, first)
        ts = np.linspace(start, end, TREND_POINTS)
        pos = np.clip(np.searchsorted(idx, ts, side="right") - 1, 0, len(c) - 1)
        out[key] = [float(f"{x:.4g}") for x in c[pos]]
    return out


def month_closes(daily: dict[str, pd.DataFrame]) -> None:
    """One file per index and month: {"t": [tickers], "d": [dates], "c": [[close per ticker] per date]}.

    Closes are rounded to 5 significant figures (well under 0.01% off), null where
    a stock has no close that day. The heatmap's custom date range reads these.
    """
    cutoff = pd.Timestamp.now() - pd.DateOffset(years=CLOSES_YEARS)
    months = {}
    for ix in INDEXES:
        cache = CONSTITUENTS / f"{ix['id']}.csv"
        if not cache.exists():
            continue
        syms = pd.read_csv(cache, dtype=str, keep_default_na=False)["symbol"]
        cols = {}
        for t in sorted({to_yahoo(s, ix) for s in syms}):
            d = daily.get(t)
            if d is None or not len(d):
                continue
            c = d["c"].copy()
            c.index = pd.DatetimeIndex(c.index).tz_localize(None).normalize()
            c = c[c.index >= cutoff]
            if len(c):
                cols[t] = c[~c.index.duplicated(keep="last")]
        if not cols:
            continue
        frame = pd.DataFrame(cols).sort_index()
        out = CLOSES / ix["id"]
        out.mkdir(parents=True, exist_ok=True)
        keep = set()
        for key, grp in frame.groupby(frame.index.strftime("%Y-%m")):
            grp = grp.dropna(how="all")
            if not len(grp):
                continue
            rows = [[None if v != v else float(f"{v:.5g}") for v in row] for row in grp.to_numpy(dtype=float)]
            body = {"t": list(grp.columns), "d": [ts.strftime("%Y-%m-%d") for ts in grp.index], "c": rows}
            write_json(out / f"{key}.json", body, allow_nan=False)
            keep.add(key)
        for old in out.glob("*.json"):
            if old.stem not in keep:
                old.unlink()
        months[ix["id"]] = sorted(keep)
    # Which months exist for each index, so the page knows the earliest and latest dates
    first_last = {}
    for k, ms in months.items():
        last = json.loads((CLOSES / k / f"{ms[-1]}.json").read_text())["d"][-1]
        first = json.loads((CLOSES / k / f"{ms[0]}.json").read_text())["d"][0]
        first_last[k] = {"from": first, "to": last}
    write_json(CLOSES / "index.json", first_last)
    log(f"wrote monthly closes for {len(months)} indexes")


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
    # New listings (data/listings.csv) that aren't in an index yet
    for e in extra_listings():
        if e["t"] in stocks:
            stocks[e["t"]].update({k: v for k, v in e.items() if k in ("x", "ipo")})
        else:
            stocks[e["t"]] = e

    tickers = sorted(stocks)
    log(f"downloading history for {len(tickers)} tickers")
    daily = bars(tickers, period="max", interval="1d")
    # Yahoo refuses period="max" for a stock in its first days of trading (only 1d or 5d
    # are allowed), so ask again for the short period for any ticker that came back empty
    missing = [t for t in tickers if t not in daily]
    if missing:
        daily.update(bars(missing, period="5d", interval="1d"))
        log(f"retried {len(missing)} tickers with a 5-day period, {sum(t in daily for t in missing)} came back")
    intraday = bars(tickers, period="5d", interval="5m")
    log(f"daily: {len(daily)}, intraday: {len(intraday)}")
    # Yahoo can turn away most of a run's requests without an error. Then rewriting the search list, the
    # trend lines and the heatmap's monthly closes from what little came back would drop most stocks from
    # the site, so those keep the last good build and only the stocks that did come back are refreshed.
    partial = len(daily) < len(tickers) * 0.8
    if partial:
        log(f"::warning::price history came back for only {len(daily)} of {len(tickers)} stocks; "
            "keeping the last saved search list, trend lines and heatmap closes for the rest")

    HIST.mkdir(parents=True, exist_ok=True)
    listed = []
    lines = {}
    for t in tickers:
        d = daily.get(t)
        # A stock on its first day of trading has a single daily bar; keep it
        if d is None or not len(d):
            continue
        i = intraday.get(t)
        rows, daily_n = thin(d)
        f = HIST / f"{t.replace('^', '_')}.json"
        if i is None:  # keep the last 5-day chart rather than blank it when only the intraday call failed
            i_pts = (read_json(f, {}) or {}).get("i") or []
        else:
            i_pts = points(i)
        # "df": index in "d" where the every-day stretch begins
        body = {"t": t, "d": points(rows), "df": len(rows) - daily_n, "i": i_pts, **range52(d)}
        write_json(f, body)
        listed.append(stocks[t])
        try:
            lines[t] = trends(d)
        except Exception as e:  # a bad series shouldn't stop the build
            log(f"trend failed for {t} ({e})")
    if partial:
        old_list = read_json(SITE / "stocks.json", []) or []
        have = {e["t"] for e in listed}
        listed += [e for e in old_list if e.get("t") in stocks and e["t"] not in have]
        lines = {**(read_json(SITE / "trends.json", {}) or {}), **lines}
    else:
        try:
            month_closes(daily)
        except Exception as e:  # the heatmap's custom range is a bonus; keep the rest of the build
            log(f"monthly closes failed ({e})")
    if not listed:
        log("::error::no price history came back at all, keeping the saved files")
        sys.exit(2)
    write_json(SITE / "trends.json", lines)
    write_json(SITE / "stocks.json", listed, ensure_ascii=False)
    log(f"wrote {len(listed)} histories to {HIST}")


if __name__ == "__main__":
    build()
