"""Temporary audit probe (removed before merge)."""
import json, sys, math
from pathlib import Path
import pandas as pd
import yfinance as yf
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import INDEXES, load_constituents, to_yahoo

def p(*a): print(*a, flush=True)

# 1. Currency check on fields we use, for a sample of tickers likely to report in another currency
SAMPLE = ["SHOP.TO","BN.TO","BAM.TO","TRI.TO","ABX.TO","WPM.TO","FNV.TO","AEM.TO","K.TO","TECK-B.TO","CNQ.TO","OVV.TO",
          "MFC.TO","RY.TO","CSU.TO","LUN.TO","FM.TO","IMO.TO","NTR.TO","CCO.TO","QSR.TO","WCN.TO","TOU.TO","CP.TO",
          "AAPL","MSFT","KO","7203.T","6758.T","9984.T","005930.KS","000660.KS","2330.TW","2317.TW"]
p("=== field currencies")
for t in SAMPLE:
    try:
        i = yf.Ticker(t).info
    except Exception as e:
        p(t, "ERR", e); continue
    pr = i.get("currentPrice") or i.get("regularMarketPrice")
    so = i.get("sharesOutstanding") or i.get("impliedSharesOutstanding")
    try:
        d = yf.Ticker(t).dividends
        last4 = float(d.iloc[-4:].sum()) if len(d) else None
        lastd = str(d.index[-1].date()) if len(d) else None
    except Exception:
        last4 = lastd = None
    p(t, "cur", i.get("currency"), "fin", i.get("financialCurrency"), "price", pr, "tgt", i.get("targetMeanPrice"),
      "tgtHi", i.get("targetHighPrice"), "tgtLo", i.get("targetLowPrice"),
      "rec", i.get("recommendationMean"), "n", i.get("numberOfAnalystOpinions"),
      "mcap", i.get("marketCap"), "px*so", (pr * so) if pr and so else None,
      "divRate", i.get("dividendRate"), "trailDiv", i.get("trailingAnnualDividendRate"), "divYld", i.get("dividendYield"),
      "trailYld", i.get("trailingAnnualDividendYield"), "last4divs", last4, lastd)

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
        p("  ", r["ticker"], r.get("rating"), r.get("analysts"), "up", r.get("upside"), "|", "; ".join(r["why"]))
