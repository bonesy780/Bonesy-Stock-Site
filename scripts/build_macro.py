"""Build site/macro.json (rates, commodities, the dollar and Bitcoin) and site/funds.json (ETFs and crypto).

macro.json feeds the strip on the Markets page, the ticker tape and the Daily Brief: the VIX, the US
10-year Treasury yield, oil, gold, the US dollar index, the Canadian dollar and Bitcoin.
funds.json feeds the ETFs and Crypto page: popular US and Canadian ETFs (price moves, fees, yield, size
and top holdings) and the ten biggest cryptocurrencies by market value (stablecoins left out).

Prices come in one batched Yahoo download, so this runs in every workflow run (quick ones included).
Fund profiles, holdings and the crypto list change slowly, so they are refreshed only in full runs
(or when missing) and otherwise carried over from the last file. Run from the repo root:
    python scripts/build_macro.py            # prices only, reusing saved profiles
    FULL=1 python scripts/build_macro.py     # also refresh ETF profiles and the crypto list
"""
from __future__ import annotations

import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safe_io import read_json, write_json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
FULL = os.environ.get("FULL") == "1"

# [symbol, short label, name, unit, what it tells you]
MACRO = [
    ["^VIX", "VIX", "Volatility index (VIX)", "pts",
     "How much the S&P 500 options market expects prices to swing over the next month. Under 15 is calm, over 30 is fear."],
    ["^TNX", "US 10Y", "US 10-year Treasury yield", "%",
     "What the US government pays to borrow for 10 years. Rising yields make borrowing dearer and tend to weigh on stock valuations."],
    ["CL=F", "Oil", "Crude oil (WTI)", "$",
     "US crude oil futures, per barrel. Drives energy stocks and feeds into inflation."],
    ["GC=F", "Gold", "Gold", "$",
     "Gold futures, per ounce. Often bought when investors are nervous or expect inflation."],
    ["DX-Y.NYB", "USD", "US dollar index", "pts",
     "The US dollar against six major currencies. A stronger dollar makes US exports dearer and foreign earnings worth less in dollars."],
    ["CAD=X", "USD/CAD", "US dollar in Canadian dollars", "C$",
     "How many Canadian dollars one US dollar buys. Higher means a weaker loonie."],
    ["BTC-USD", "Bitcoin", "Bitcoin", "$",
     "The biggest cryptocurrency, in US dollars. Trades around the clock, every day."],
]

# Popular ETFs: [symbol, group]
ETFS = [
    ["SPY", "US broad market"], ["VOO", "US broad market"], ["IVV", "US broad market"], ["VTI", "US broad market"],
    ["QQQ", "US broad market"], ["DIA", "US broad market"], ["IWM", "US broad market"], ["RSP", "US broad market"],
    ["SCHD", "Dividends"], ["VIG", "Dividends"], ["VYM", "Dividends"],
    ["XLK", "US sectors"], ["XLF", "US sectors"], ["XLE", "US sectors"], ["XLV", "US sectors"], ["XLY", "US sectors"],
    ["XLP", "US sectors"], ["XLI", "US sectors"], ["XLU", "US sectors"], ["XLB", "US sectors"], ["XLRE", "US sectors"],
    ["XLC", "US sectors"], ["SMH", "US sectors"], ["VNQ", "US sectors"],
    ["VEA", "International"], ["VWO", "International"], ["EFA", "International"], ["EWJ", "International"],
    ["AGG", "Bonds"], ["BND", "Bonds"], ["TLT", "Bonds"], ["SHY", "Bonds"], ["LQD", "Bonds"], ["HYG", "Bonds"],
    ["GLD", "Gold and commodities"], ["SLV", "Gold and commodities"], ["USO", "Gold and commodities"],
    ["IBIT", "Crypto funds"], ["ETHA", "Crypto funds"], ["ARKK", "Thematic"],
    ["XIU.TO", "Canada"], ["XIC.TO", "Canada"], ["VFV.TO", "Canada"], ["ZSP.TO", "Canada"], ["XEQT.TO", "Canada"],
    ["VEQT.TO", "Canada"], ["VGRO.TO", "Canada"], ["XEI.TO", "Canada"], ["ZEB.TO", "Canada"], ["ZAG.TO", "Canada"],
]
GROUPS = ["US broad market", "Canada", "Dividends", "US sectors", "International", "Bonds", "Gold and commodities", "Crypto funds", "Thematic"]

# Used when Yahoo's crypto list can't be reached
CRYPTO_FALLBACK = ["BTC-USD", "ETH-USD", "XRP-USD", "BNB-USD", "SOL-USD", "DOGE-USD", "TRX-USD", "ADA-USD", "LINK-USD", "AVAX-USD"]
STABLE = ("USDT", "USDC", "DAI", "USDE", "FDUSD", "TUSD", "USDS", "PYUSD", "USD1", "BUSD", "USDD", "RLUSD", "USDF")
CRYPTO_N = 10

QS = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept": "application/json, text/plain, */*"}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def raw(v):
    """Yahoo sends some numbers as {raw, fmt} even when asked for plain ones."""
    if isinstance(v, dict):
        v = v.get("raw")
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) or math.isinf(v) else v


def rnd(v, nd=4):
    v = raw(v)
    return None if v is None else round(v, nd)


def sig(v, n=5):
    v = raw(v)
    if not v:
        return v
    return round(v, max(0, n - 1 - math.floor(math.log10(abs(v)))))


def closes(symbols: list[str]) -> dict[str, pd.Series]:
    """A year of daily closes per symbol, from one batched download (retried once)."""
    for attempt in range(2):
        try:
            df = yf.download(symbols, period="13mo", interval="1d", auto_adjust=False, progress=False,
                             group_by="column", threads=True)
            c = df["Close"] if "Close" in df else None
            if c is not None and len(c):
                if isinstance(c, pd.Series):
                    c = c.to_frame(symbols[0])
                return {s: c[s].dropna() for s in c.columns if s in symbols and c[s].dropna().size >= 2}
        except Exception as e:
            log(f"download failed ({e}); {'retrying' if attempt == 0 else 'giving up'}")
        time.sleep(10)
    return {}


def moves(c: pd.Series) -> dict:
    last = float(c.iloc[-1])
    ts = c.index

    def at(days):
        """Close on or before `days` calendar days ago."""
        cut = ts[-1] - pd.Timedelta(days=days)
        prior = c[ts <= cut]
        return float(prior.iloc[-1]) if len(prior) else None

    def pct(a, b):
        return round((a / b - 1) * 100, 2) if a is not None and b else None

    y0 = c[ts < pd.Timestamp(year=ts[-1].year, month=1, day=1, tz=ts.tz)]
    year = c[ts >= ts[-1] - pd.Timedelta(days=365)]
    return {
        "p": sig(last, 6), "pc": sig(c.iloc[-2], 6), "d1": pct(last, float(c.iloc[-2])),
        "w1": pct(last, at(7)), "m1": pct(last, at(30)), "m3": pct(last, at(91)),
        "ytd": pct(last, float(y0.iloc[-1]) if len(y0) else None), "y1": pct(last, at(365)),
        "hi52": sig(year.max(), 6), "lo52": sig(year.min(), 6),
        "spark": [sig(x, 5) for x in c.iloc[-30:].tolist()],
        "asOf": ts[-1].date().isoformat(),
    }


def quote_summary(sym: str, modules: list[str]) -> dict:
    tk = yf.Ticker(sym)
    data = getattr(tk, "_data", None)
    params = {"modules": ",".join(modules), "formatted": "false", "corsDomain": "finance.yahoo.com", "symbol": sym}
    if data is not None and hasattr(data, "get_raw_json"):
        res = data.get_raw_json(QS + sym, params=params)
    else:
        res = requests.get(QS + sym, params=params, headers=UA, timeout=20).json()
    r = ((res or {}).get("quoteSummary") or {}).get("result") or []
    return r[0] if r else {}


def etf_profile(sym: str) -> dict:
    r = quote_summary(sym, ["price", "summaryDetail", "fundProfile", "topHoldings", "defaultKeyStatistics"])
    if not r:
        return {}
    price, sd, fp = r.get("price") or {}, r.get("summaryDetail") or {}, r.get("fundProfile") or {}
    th, ks = r.get("topHoldings") or {}, r.get("defaultKeyStatistics") or {}
    fee = (fp.get("feesExpensesInvestment") or {}).get("annualReportExpenseRatio")
    holds = []
    for h in (th.get("holdings") or [])[:10]:
        w = raw(h.get("holdingPercent"))
        if w:
            holds.append({"s": h.get("symbol") or "", "n": h.get("holdingName") or h.get("symbol") or "", "w": round(w * 100, 2)})
    sectors = []
    for row in th.get("sectorWeightings") or []:
        for k, v in row.items():
            w = raw(v)
            if w and w >= 0.005:
                sectors.append([k.replace("_", " ").title().replace("Realestate", "Real estate"), round(w * 100, 1)])
    sectors.sort(key=lambda x: -x[1])
    out = {
        "n": price.get("longName") or price.get("shortName") or sym,
        "cur": price.get("currency") or ("CAD" if sym.endswith(".TO") else "USD"),
        "fee": rnd(raw(fee) * 100, 3) if raw(fee) is not None else None,
        "yld": rnd(raw(sd.get("yield")) * 100, 2) if raw(sd.get("yield")) is not None else None,
        "aum": sig(sd.get("totalAssets") or ks.get("totalAssets"), 4),
        "cat": ks.get("category") or fp.get("categoryName"),
        "fam": ks.get("fundFamily") or fp.get("family"),
        "since": datetime.fromtimestamp(raw(ks.get("fundInceptionDate")), tz=timezone.utc).date().isoformat()
        if raw(ks.get("fundInceptionDate")) else None,
        "y3": rnd(raw(ks.get("threeYearAverageReturn")) * 100, 2) if raw(ks.get("threeYearAverageReturn")) is not None else None,
        "y5": rnd(raw(ks.get("fiveYearAverageReturn")) * 100, 2) if raw(ks.get("fiveYearAverageReturn")) is not None else None,
        "hold": holds, "sectors": sectors[:11],
    }
    return {k: v for k, v in out.items() if v not in (None, "", [])}


def crypto_list() -> list[dict]:
    """The biggest coins by market value from Yahoo's crypto screener, stablecoins left out."""
    url = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved"
    for attempt in range(2):
        try:
            r = requests.get(url, params={"scrIds": "all_cryptocurrencies_us", "count": 40}, headers=UA, timeout=20)
            quotes = ((r.json().get("finance") or {}).get("result") or [{}])[0].get("quotes") or []
            out = []
            for q in quotes:
                sym = q.get("symbol") or ""
                base = sym.split("-")[0].upper()
                if not sym.endswith("-USD") or base in STABLE or "USD" in base:
                    continue
                out.append({"t": sym, "n": (q.get("shortName") or q.get("longName") or base).replace(" USD", ""),
                            "mcap": sig(q.get("marketCap"), 4), "vol24": sig(q.get("volume24Hr") or q.get("regularMarketVolume"), 4),
                            "supply": sig(q.get("circulatingSupply"), 4)})
                if len(out) >= CRYPTO_N:
                    break
            if len(out) >= 5:
                return out
        except Exception as e:
            log(f"crypto list failed ({e})")
        time.sleep(5)
    return []


def build():
    now = datetime.now(timezone.utc)
    old_funds = read_json(SITE / "funds.json", {}) or {}
    old_etf = {e["t"]: e for e in old_funds.get("etfs", []) if e.get("t")}
    old_crypto = old_funds.get("crypto") or []

    coins = crypto_list() if FULL or not old_crypto else []
    if not coins:
        coins = [{k: v for k, v in c.items() if k in ("t", "n", "mcap", "vol24", "supply")} for c in old_crypto] \
            or [{"t": s, "n": s.split("-")[0]} for s in CRYPTO_FALLBACK]

    symbols = [m[0] for m in MACRO] + [e[0] for e in ETFS] + [c["t"] for c in coins]
    symbols = list(dict.fromkeys(symbols))
    series = closes(symbols)
    log(f"prices for {len(series)} of {len(symbols)} symbols")

    # ---- macro strip
    old_macro = {m["t"]: m for m in (read_json(SITE / "macro.json", {}) or {}).get("items", [])}
    items = []
    for sym, short, name, unit, why in MACRO:
        base = {"t": sym, "s": short, "n": name, "unit": unit, "why": why}
        if sym in series:
            items.append({**base, **moves(series[sym])})
        elif sym in old_macro:
            items.append({**old_macro[sym], **base, "stale": True})
    if len(items) >= 3:
        write_json(SITE / "macro.json", {"generated": now.isoformat(timespec="minutes"), "items": items}, allow_nan=False)
        log(f"macro.json: {len(items)} items")
    else:
        log("too few macro prices came back; keeping the last macro.json")

    # ---- ETFs
    etfs = []
    for sym, group in ETFS:
        prev = old_etf.get(sym, {})
        prof = {k: v for k, v in prev.items() if k in ("n", "cur", "fee", "yld", "aum", "cat", "fam", "since", "y3", "y5", "hold", "sectors")}
        if FULL or not prof:
            try:
                fresh = etf_profile(sym)
                if fresh:
                    prof = fresh
            except Exception as e:
                log(f"{sym}: profile failed ({e})")
            time.sleep(0.6)
        row = {"t": sym, "g": group, "n": prof.get("n") or sym, "cur": prof.get("cur") or ("CAD" if sym.endswith(".TO") else "USD"), **prof}
        if sym in series:
            row.update(moves(series[sym]))
        elif prev.get("p") is not None:
            row.update({k: prev[k] for k in ("p", "pc", "d1", "w1", "m1", "m3", "ytd", "y1", "hi52", "lo52", "spark", "asOf") if k in prev})
            row["stale"] = True
        else:
            continue
        etfs.append(row)

    # ---- crypto
    crypto = []
    for c in coins:
        if c["t"] not in series:
            prev = next((o for o in old_crypto if o.get("t") == c["t"]), None)
            if prev:
                crypto.append({**prev, "stale": True})
            continue
        crypto.append({**c, **moves(series[c["t"]])})

    if len(etfs) >= 10 or len(crypto) >= 5:
        write_json(SITE / "funds.json", {"generated": now.isoformat(timespec="minutes"), "groups": GROUPS,
                                         "etfs": etfs or old_funds.get("etfs", []), "crypto": crypto or old_crypto}, allow_nan=False)
        log(f"funds.json: {len(etfs)} ETFs, {len(crypto)} coins")
    else:
        log("too few fund prices came back; keeping the last funds.json")


if __name__ == "__main__":
    build()
