"""Temporary audit probe (removed before merge)."""
import json, sys, math
from pathlib import Path
import pandas as pd
import yfinance as yf
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import INDEXES, load_constituents, to_yahoo

def p(*a): print(*a, flush=True)

# 1. Dividend yields as the screener will now compute them
from build_market import ohlcv, paid_last_year, dividend_rate
T = ["BN.TO","CSU.TO","TRI.TO","RY.TO","AAPL","KO","7203.T","005930.KS","000660.KS","2330.TW","2317.TW","2891.TW","AP-UN.TO","T.TO","ENB.TO"]
bars = ohlcv(T)
for t in T:
    i = yf.Ticker(t).info
    h = paid_last_year(bars[t]) if t in bars else None
    r = dividend_rate(i, h)
    px = float(bars[t]["Close"].iloc[-1]) if t in bars else None
    p(t, "fwd", i.get("dividendRate"), "trail", i.get("trailingAnnualDividendRate"), "hist", h, "used", r,
      "yield", round(r / px * 100, 2) if r and px else None, "old", round((i.get("dividendRate") or i.get("trailingAnnualDividendRate") or 0) / px * 100, 2) if px else None)

# 2. What the site built
p("=== built data.json")
d = json.loads(Path("site/data.json").read_text())
for ix in d["indexes"]:
    p(ix["id"], ix["priced"], "/", ix["members"])
    for r in ix["top"]:
        p("  ", r["ticker"], r["score"], "3m", r["chg3m"], "rec", r["recMean"], "n", r["analysts"], "up", r["upside"],
          "cap$B", round((r["mcapUsd"] or 0) / 1e9, 1), "yld", r["divYield"], r["divFreq"])
for k in ("buyIdeas", "sellIdeas", "watchlist"):
    p("==", k)
    for r in d[k]:
        p("  ", r["ticker"], r.get("rating"), r.get("analysts"), "up", r.get("upside"), "score", r.get("score"), "idea", r.get("ideaScore"), "|", "; ".join(r["why"]))
