"""Build site/aerospace.json for the Aerospace & Defence page.

What it gathers, all automatically:
- prices and moves for about 50 aerospace and defence companies around the world (US, Europe, Japan, Korea,
  Canada, Israel, India, Brazil) and the main A&D ETFs, in one batched Yahoo download (every run);
- company facts (size, valuation, dividend, analyst target and rating, next earnings date) and ETF profiles
  from Yahoo (full runs, or when missing; carried over otherwise);
- a year of daily closes for the sector-versus-S&P 500 chart;
- sector news from Yahoo and Google News, with contract awards, orders and takeovers picked out as deals;
- military spending by country from the World Bank (which republishes SIPRI's figures) (full runs);
- how many aircraft are flying right now, from the OpenSky Network (at most once an hour, its free limit).

Trade shows and other dated events are listed below (EVENTS); the page shows the ones still ahead, next to
each company's earnings date. Add the next year's shows each autumn. Run from the repo root:
    python scripts/build_aerospace.py          # prices and news, reusing saved facts
    FULL=1 python scripts/build_aerospace.py   # also refresh company facts, ETF profiles and budgets
"""
from __future__ import annotations

import math
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safe_io import read_json, write_json  # noqa: E402
from build_macro import closes, moves, quote_summary, etf_profile, raw, sig  # noqa: E402
from build_news import yahoo_news, google_news, NOT_NEWS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "aerospace.json"
FULL = os.environ.get("FULL") == "1"

# [Yahoo symbol, short name, country code, segment]
STOCKS = [
    # United States
    ["LMT", "Lockheed Martin", "US", "Defence prime"], ["RTX", "RTX", "US", "Defence prime"],
    ["NOC", "Northrop Grumman", "US", "Defence prime"], ["GD", "General Dynamics", "US", "Defence prime"],
    ["LHX", "L3Harris", "US", "Defence electronics"], ["BA", "Boeing", "US", "Aircraft maker"],
    ["GE", "GE Aerospace", "US", "Engines & parts"], ["TDG", "TransDigm", "US", "Engines & parts"],
    ["HWM", "Howmet Aerospace", "US", "Engines & parts"], ["HEI", "HEICO", "US", "Engines & parts"],
    ["HII", "Huntington Ingalls", "US", "Shipbuilding"], ["TXT", "Textron", "US", "Aircraft maker"],
    ["LDOS", "Leidos", "US", "Defence services"], ["CW", "Curtiss-Wright", "US", "Defence electronics"],
    ["WWD", "Woodward", "US", "Engines & parts"], ["BWXT", "BWX Technologies", "US", "Shipbuilding"],
    ["KTOS", "Kratos", "US", "Drones & new defence"], ["AVAV", "AeroVironment", "US", "Drones & new defence"],
    ["PLTR", "Palantir", "US", "Drones & new defence"], ["RKLB", "Rocket Lab", "US", "Space"],
    ["JOBY", "Joby Aviation", "US", "Air taxis"], ["ACHR", "Archer Aviation", "US", "Air taxis"],
    # Europe
    ["AIR.PA", "Airbus", "FR", "Aircraft maker"], ["SAF.PA", "Safran", "FR", "Engines & parts"],
    ["HO.PA", "Thales", "FR", "Defence electronics"], ["AM.PA", "Dassault Aviation", "FR", "Aircraft maker"],
    ["BA.L", "BAE Systems", "GB", "Defence prime"], ["RR.L", "Rolls-Royce", "GB", "Engines & parts"],
    ["QQ.L", "QinetiQ", "GB", "Defence services"], ["CHG.L", "Chemring", "GB", "Munitions"],
    ["RHM.DE", "Rheinmetall", "DE", "Munitions"], ["HAG.DE", "Hensoldt", "DE", "Defence electronics"],
    ["MTX.DE", "MTU Aero Engines", "DE", "Engines & parts"], ["R3NK.DE", "Renk", "DE", "Engines & parts"],
    ["LDO.MI", "Leonardo", "IT", "Defence prime"], ["SAAB-B.ST", "Saab", "SE", "Defence prime"],
    ["KOG.OL", "Kongsberg", "NO", "Defence electronics"],
    # Asia and the rest of the world
    ["7011.T", "Mitsubishi Heavy", "JP", "Defence prime"], ["7012.T", "Kawasaki Heavy", "JP", "Defence prime"],
    ["7013.T", "IHI", "JP", "Engines & parts"],
    ["012450.KS", "Hanwha Aerospace", "KR", "Defence prime"], ["047810.KS", "Korea Aerospace", "KR", "Aircraft maker"],
    ["079550.KS", "LIG Nex1", "KR", "Defence electronics"], ["064350.KS", "Hyundai Rotem", "KR", "Defence prime"],
    ["HAL.NS", "Hindustan Aeronautics", "IN", "Aircraft maker"], ["BEL.NS", "Bharat Electronics", "IN", "Defence electronics"],
    ["ESLT", "Elbit Systems", "IL", "Defence electronics"], ["ERJ", "Embraer", "BR", "Aircraft maker"],
    # Canada
    ["CAE.TO", "CAE", "CA", "Training & simulation"], ["BBD-B.TO", "Bombardier", "CA", "Aircraft maker"],
    ["MDA.TO", "MDA Space", "CA", "Space"],
]
REGION = {"US": "United States", "CA": "Canada", "FR": "Europe", "GB": "Europe", "DE": "Europe", "IT": "Europe",
          "SE": "Europe", "NO": "Europe", "JP": "Asia", "KR": "Asia", "IN": "Asia", "IL": "Middle East", "BR": "Latin America"}

# Aerospace and defence ETFs: [symbol, what it holds]
ETFS = [
    ["ITA", "US aerospace & defence, weighted by size"], ["XAR", "US aerospace & defence, equal weight"],
    ["PPA", "US defence and aerospace leaders"], ["SHLD", "Global defence technology"],
    ["EUAD", "European aerospace & defence"], ["NATO", "Defence companies of NATO countries"],
    ["UFO", "Space companies"], ["ARKX", "Space and new aviation (actively managed)"],
    ["JETS", "Airlines, the buyers of new planes"],
]
# Lines on the sector chart: [symbol, label]
CHART = [["ITA", "US aerospace & defence (ITA)"], ["EUAD", "European A&D (EUAD)"],
         ["SHLD", "Global defence tech (SHLD)"], ["SPY", "S&P 500 (SPY)"]]

# Yahoo currency code -> the FX symbol giving US dollars per unit (GBp and ILA are pence and agorot)
FX = {"EUR": "EURUSD=X", "GBP": "GBPUSD=X", "GBp": "GBPUSD=X", "JPY": "JPYUSD=X", "KRW": "KRWUSD=X",
      "CAD": "CADUSD=X", "SEK": "SEKUSD=X", "NOK": "NOKUSD=X", "INR": "INRUSD=X", "ILS": "ILSUSD=X", "ILA": "ILSUSD=X",
      "BRL": "BRLUSD=X"}
SUB_UNIT = {"GBp": 100, "ILA": 100}
SUFFIX_CUR = {".PA": "EUR", ".DE": "EUR", ".MI": "EUR", ".L": "GBp", ".ST": "SEK", ".OL": "NOK", ".T": "JPY",
              ".KS": "KRW", ".NS": "INR", ".TO": "CAD"}

# Trade shows and other dated events: [first day, last day, name, place, why it matters]
# Dates from the UK government's defence export event calendar and the organisers (checked November 2026).
EVENTS = [
    ["2026-12-01", "2026-12-03", "Exponaval", "Valparaíso, Chile", "Naval defence show for Latin American navies."],
    ["2026-12-10", "2026-12-13", "Viet Nam Defence Expo", "Hanoi, Vietnam", "Southeast Asian buyers shopping for jets, ships and air defence."],
    ["2027-01-25", "2027-01-29", "IDEX", "Abu Dhabi, UAE", "The Middle East's biggest defence show; Gulf states often sign large orders here."],
    ["2027-02-08", "2027-02-12", "Aero India", "Bengaluru, India", "India's air show; watch for fighter, engine and helicopter deals and Indian-made programmes."],
    ["2027-03-09", "2027-03-12", "DSEI Germany", "Germany", "Land and air defence show in Europe's fastest-growing defence budget."],
    ["2027-04-28", "2027-04-30", "DSEI Japan", "Chiba, Japan", "Japan is doubling defence spending; shows how foreign firms team with Japanese makers."],
    ["2027-05-03", "2027-05-06", "SOF Week", "Tampa, USA", "Special forces equipment: drones, radios, small arms."],
    ["2027-05-03", "2027-05-09", "IDEF", "Istanbul, Türkiye", "Turkey's defence show; its drone and missile makers are growing exporters."],
    ["2027-05-12", "2027-05-15", "Indo Defence", "Jakarta, Indonesia", "Southeast Asia's largest defence show."],
    ["2027-06-14", "2027-06-20", "Paris Air Show", "Le Bourget, France", "The biggest air show of the year: Airbus and Boeing order tallies move both stocks and their suppliers."],
    ["2027-08-31", "2027-09-03", "MSPO", "Kielce, Poland", "Poland spends over 4% of GDP on defence and buys from the US and Korea."],
    ["2027-11-02", "2027-11-04", "Indo Pacific", "Sydney, Australia", "Naval show; AUKUS submarine and ship news."],
    ["2027-11-11", "2027-11-14", "Airshow China", "Zhuhai, China", "Where China shows its newest military jets, drones and its C919 airliner."],
    ["2027-11-15", "2027-11-19", "Dubai Airshow", "Dubai, UAE", "Gulf airlines (Emirates, flydubai, Etihad) place some of the largest jet orders here."],
    ["2028-01-16", "2028-01-20", "World Defense Show", "Riyadh, Saudi Arabia", "Saudi Arabia's push to build weapons at home."],
    ["2028-02-15", "2028-02-20", "Singapore Airshow", "Singapore", "Asia's biggest air show; Asian airline and air force orders."],
    ["2028-05-17", "2028-05-21", "ILA Berlin", "Berlin, Germany", "Germany's air show; news on Europe's next fighter (FCAS) and drones."],
    ["2028-07-17", "2028-07-21", "Farnborough Airshow", "Farnborough, UK", "Alternates with Paris as the year's big order show for Airbus and Boeing."],
]
# Recurring dates (month, day, name, why): the page places each on its next date
RECURRING = [
    [10, 1, "US government fiscal year starts", "If Congress hasn't passed a defence budget, a stopgap freezes new programmes and can delay contracts."],
    [12, 15, "US defence bill (NDAA) usually signed", "Congress normally finishes the yearly National Defense Authorization Act in December: it sets what the Pentagon may buy."],
    [2, 1, "US President's budget request", "Usually sent to Congress in February (often later); shows which weapons the Pentagon wants more or less of."],
    [1, 10, "Boeing and Airbus yearly orders and deliveries", "Both report the past year's jet orders and deliveries in early-to-mid January."],
]

# Military spending by country (World Bank, from SIPRI): ISO3 codes
BUDGET_COUNTRIES = ["USA", "CHN", "RUS", "IND", "SAU", "GBR", "DEU", "UKR", "FRA", "JPN", "KOR", "ISR", "POL", "ITA",
                    "AUS", "CAN", "TUR", "ESP", "NLD", "BRA", "TWN", "SWE", "NOR"]
WB = "https://api.worldbank.org/v2/country/{c}/indicator/{i}"

# Headline searches (Google News adds "when:7d"); Yahoo news comes from the biggest companies and ITA
NEWS_QUERIES = ["aerospace defense stocks", "defence contract awarded", "Pentagon contract award",
                "Boeing Airbus orders deliveries", "NATO defence spending", "European defence stocks Rheinmetall",
                "fighter jet deal", "space launch satellite contract", "airline aircraft order"]
NEWS_YAHOO = ["ITA", "LMT", "RTX", "BA", "AIR.PA", "GE", "RHM.DE", "NOC", "BA.L"]
NEWS_MAX = 60
NEWS_AGE = timedelta(days=7)
DEAL = re.compile(r"\b(contract|contracts|award|awarded|awards|order|orders|ordered|deal|deals|agreement|acquire|acquires|acquisition|"
                  r"merger|merge|takeover|buyout|to buy|purchase|purchases|signs|signed|selects|selected|wins|won|tender|bid|"
                  r"memorandum|MoU|partnership|joint venture|billion)\b", re.I)
NOT_DEAL = re.compile(r"\b(stock|shares) (to buy|buy now)\b|\bbuy (rating|the dip)\b|\bshould you buy\b|\btop .* to buy\b", re.I)
TOPICS = [
    ("Space", re.compile(r"\b(space|satellite|rocket|launch|orbit|NASA|SpaceX|lunar|Starlink)\b", re.I)),
    ("Defence", re.compile(r"\b(defen[cs]e|military|army|navy|air force|missile|Pentagon|NATO|fighter|weapon|munition|drone|tank|warship|submarine|ammunition|Ukraine)\b", re.I)),
    ("Commercial", re.compile(r"\b(airlines?|airliners?|jets?|jet orders?|737|787|777|777X|777-9|A320|A321|A330|A350|A220|deliveries|delivery|airports?|passengers?|FAA|EASA|aircraft orders?|airshow|air show|widebody|narrowbody)\b", re.I)),
]

FACTS_KEYS = ("n", "cur", "mcap", "shares", "pe", "fpe", "div", "tgt", "rec", "recN", "analysts", "earn", "rev", "margin")
MOVE_KEYS = ("p", "pc", "d1", "w1", "m1", "m3", "ytd", "y1", "hi52", "lo52", "spark", "asOf")
UA = {"User-Agent": "Mozilla/5.0 (stocks-site aerospace builder)"}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def guess_cur(sym: str) -> str:
    for suf, cur in SUFFIX_CUR.items():
        if sym.endswith(suf):
            return cur
    return "USD"


def facts(sym: str) -> dict:
    """Size, valuation, dividend, analyst view and next earnings from Yahoo's quote summary."""
    r = quote_summary(sym, ["price", "summaryDetail", "financialData", "defaultKeyStatistics", "calendarEvents"])
    if not r:
        return {}
    price, sd, fd = r.get("price") or {}, r.get("summaryDetail") or {}, r.get("financialData") or {}
    ks, ce = r.get("defaultKeyStatistics") or {}, r.get("calendarEvents") or {}
    earn = None
    now = time.time()
    for d in (ce.get("earnings") or {}).get("earningsDate") or []:
        t = raw(d)
        if t and t > now - 86400:
            earn = datetime.fromtimestamp(t, tz=timezone.utc).date().isoformat()
            break
    div = raw(sd.get("dividendYield"))
    if div is None and raw(sd.get("trailingAnnualDividendYield")):
        div = raw(sd.get("trailingAnnualDividendYield"))
    out = {
        "n": price.get("longName") or price.get("shortName"),
        "cur": price.get("currency"),
        "mcap": sig(price.get("marketCap"), 4),
        "shares": sig(ks.get("sharesOutstanding") or ks.get("impliedSharesOutstanding"), 5),
        "pe": round(raw(sd.get("trailingPE")), 1) if raw(sd.get("trailingPE")) and raw(sd.get("trailingPE")) < 1000 else None,
        "fpe": round(raw(sd.get("forwardPE")), 1) if raw(sd.get("forwardPE")) and 0 < raw(sd.get("forwardPE")) < 1000 else None,
        "div": round(div * 100, 2) if div else None,
        "tgt": sig(fd.get("targetMeanPrice"), 5),
        "rec": fd.get("recommendationKey") if fd.get("recommendationKey") not in (None, "none") else None,
        "recN": round(raw(fd.get("recommendationMean")), 2) if raw(fd.get("recommendationMean")) else None,
        "analysts": int(raw(fd.get("numberOfAnalystOpinions"))) if raw(fd.get("numberOfAnalystOpinions")) else None,
        "earn": earn,
        "rev": round(raw(fd.get("revenueGrowth")) * 100, 1) if raw(fd.get("revenueGrowth")) is not None else None,
        "margin": round(raw(fd.get("profitMargins")) * 100, 1) if raw(fd.get("profitMargins")) is not None else None,
    }
    return {k: v for k, v in out.items() if v not in (None, "")}


def usd_rates(series: dict) -> dict:
    out = {"USD": 1.0}
    for cur, fx in FX.items():
        if fx in series and len(series[fx]):
            out[cur] = float(series[fx].iloc[-1]) / SUB_UNIT.get(cur, 1)
    return out


def chart_lines(series: dict) -> dict:
    """A year of daily closes for each chart line, on shared dates."""
    have = {s: series[s] for s, _ in CHART if s in series}
    if "SPY" not in have:
        return {}
    df = pd.DataFrame({s: c for s, c in have.items()})
    df.index = pd.to_datetime(df.index).tz_localize(None) if getattr(df.index, "tz", None) else pd.to_datetime(df.index)
    df = df[df.index >= df.index[-1] - pd.Timedelta(days=366)].ffill().dropna(how="all")
    return {"dates": [d.date().isoformat() for d in df.index],
            "lines": [{"t": s, "n": n, "v": [None if pd.isna(x) else sig(x, 5) for x in df[s].tolist()]}
                      for s, n in CHART if s in df]}


def budgets(old: dict) -> dict:
    """Latest military spending (US dollars and share of GDP), and five years earlier, per country."""
    rows = {}
    for ind, key in (("MS.MIL.XPND.CD", "usd"), ("MS.MIL.XPND.GD.ZS", "gdp")):
        url = WB.format(c=";".join(BUDGET_COUNTRIES), i=ind)
        try:
            r = requests.get(url, params={"format": "json", "date": f"{datetime.now().year - 9}:{datetime.now().year}", "per_page": 1000},
                             headers=UA, timeout=40)
            data = r.json()
            items = data[1] if isinstance(data, list) and len(data) > 1 and data[1] else []
        except Exception as e:
            log(f"World Bank {ind} failed ({e})")
            return old
        for it in items:
            v = it.get("value")
            if v is None:
                continue
            c = it.get("countryiso3code") or (it.get("country") or {}).get("id")
            row = rows.setdefault(c, {"c": c, "n": (it.get("country") or {}).get("value") or c})
            row.setdefault(key + "_by", {})[int(it["date"])] = v
    out = []
    for c, row in rows.items():
        u = row.get("usd_by") or {}
        g = row.get("gdp_by") or {}
        if not u:
            continue
        y = max(u)
        five = u.get(y - 5)
        out.append({"c": c, "n": row["n"], "y": y, "usd": sig(u[y], 4),
                    "gdp": round(g[y], 2) if y in g else (round(g[max(g)], 2) if g else None),
                    "g5": round((u[y] / five - 1) * 100, 1) if five else None})
    out.sort(key=lambda r: -r["usd"])
    if len(out) < 10:
        log("too few budget rows came back; keeping the saved ones")
        return old
    return {"rows": out, "source": "SIPRI via the World Bank", "updated": datetime.now(timezone.utc).date().isoformat()}


def flights(old: dict, now: datetime) -> dict:
    """How many aircraft are flying right now (OpenSky Network), at most once an hour."""
    try:
        if old and now - datetime.fromisoformat(old["at"]) < timedelta(minutes=55):
            return old
    except (KeyError, TypeError, ValueError):
        pass
    try:
        r = requests.get("https://opensky-network.org/api/states/all", headers=UA, timeout=45)
        r.raise_for_status()
        states = r.json().get("states") or []
    except Exception as e:
        log(f"OpenSky failed ({e})")
        return old
    airborne = [s for s in states if len(s) > 8 and not s[8]]
    if len(airborne) < 500:
        return old
    by = {}
    for s in airborne:
        by[s[2] or "Unknown"] = by.get(s[2] or "Unknown", 0) + 1
    top = sorted(by.items(), key=lambda x: -x[1])[:6]
    hist = [h for h in (old or {}).get("hist", []) if now - datetime.fromisoformat(h[0]) < timedelta(hours=48)]
    hist.append([now.isoformat(timespec="minutes"), len(airborne)])
    return {"at": now.isoformat(timespec="minutes"), "n": len(airborne), "top": top, "hist": hist[-48:]}


def tag_story(s: dict, names: list[tuple[str, str, re.Pattern]]) -> dict:
    text = s["title"] + " " + (s.get("summary") or "")
    s["topic"] = next((t for t, rx in TOPICS if rx.search(text)), "Industry")
    s["deal"] = bool(DEAL.search(s["title"])) and not NOT_DEAL.search(s["title"])
    s["tickers"] = [t for t, _, rx in names if rx.search(text)][:3]
    return s


def news(old: list, now: datetime) -> list:
    stories = []
    for sym in NEWS_YAHOO:
        stories += yahoo_news(sym)
    for q in NEWS_QUERIES:
        stories += google_news(q)
    # Company names to tag stories with: the first word of the name, or the whole name when that word is common
    common = {"Korea", "General", "Mitsubishi", "Kawasaki", "Hindustan", "Bharat", "Hyundai", "Rocket", "Archer", "GE", "Huntington", "MTU", "MDA", "BWX", "LIG"}
    names = []
    for sym, short, _, _ in STOCKS:
        first = short.split()[0]
        word = short if first in common else first
        names.append((sym, short, re.compile(rf"\b{re.escape(word)}\b")))
    seen, picked = set(), []
    fresh = [s for s in stories if s.get("published") and now - s["published"] <= NEWS_AGE and not NOT_NEWS.search(s["title"])]
    for s in sorted(fresh, key=lambda s: s["published"], reverse=True):
        key = re.sub(r"\W+", " ", s["title"].lower())[:70]
        if key in seen:
            continue
        seen.add(key)
        s = tag_story({k: v for k, v in s.items() if k != "related"}, names)
        s["published"] = s["published"].isoformat(timespec="minutes")
        picked.append(s)
        if len(picked) >= NEWS_MAX:
            break
    if len(picked) < 5:
        log(f"only {len(picked)} stories; keeping the saved news")
        keep = []
        for s in old or []:
            try:
                if now - datetime.fromisoformat(s["published"]) <= NEWS_AGE:
                    keep.append(s)
            except (KeyError, TypeError, ValueError):
                pass
        return keep or picked
    return picked


def build():
    now = datetime.now(timezone.utc)
    old = read_json(OUT, {}) or {}
    old_stocks = {s["t"]: s for s in old.get("stocks", []) if s.get("t")}
    old_etfs = {e["t"]: e for e in old.get("etfs", []) if e.get("t")}

    symbols = [s[0] for s in STOCKS] + [e[0] for e in ETFS] + [c[0] for c in CHART] + sorted(set(FX.values()))
    series = closes(list(dict.fromkeys(symbols)))
    log(f"prices for {len(series)} of {len(symbols)} symbols")
    fx = usd_rates(series)

    stocks = []
    for sym, short, cc, seg in STOCKS:
        prev = old_stocks.get(sym, {})
        f = {k: prev[k] for k in FACTS_KEYS if k in prev}
        # Earnings dates pass; look again when the saved one is behind us
        stale_earn = f.get("earn") and f["earn"] < now.date().isoformat()
        if FULL or not f or stale_earn:
            try:
                got = facts(sym)
                if got:
                    f = got
            except Exception as e:
                log(f"{sym}: facts failed ({e})")
            time.sleep(0.5)
        row = {"t": sym, "short": short,
               "cc": cc, "region": REGION.get(cc, "Other"), "seg": seg, **f}
        row["cur"] = row.get("cur") or guess_cur(sym)
        if sym in series:
            row.update(moves(series[sym]))
        elif prev.get("p") is not None:
            row.update({k: prev[k] for k in MOVE_KEYS if k in prev})
            row["stale"] = True
        else:
            continue
        rate = fx.get(row["cur"])
        if rate and row.get("shares") and row.get("p"):
            row["mcapUsd"] = sig(row["shares"] * row["p"] * rate, 4)
        elif rate and row.get("mcap"):
            # Yahoo gives London market values in pounds even though prices are in pence
            row["mcapUsd"] = sig(row["mcap"] * rate * SUB_UNIT.get(row["cur"], 1), 4)
        row["fx"] = sig(rate, 6) if rate else None
        stocks.append(row)

    etfs = []
    for sym, about in ETFS:
        prev = old_etfs.get(sym, {})
        prof = {k: prev[k] for k in ("n", "fee", "yld", "aum", "hold") if k in prev}
        if FULL or not prof:
            try:
                p = etf_profile(sym)
                if p:
                    prof = {k: p[k] for k in ("n", "fee", "yld", "aum", "hold") if k in p}
            except Exception as e:
                log(f"{sym}: profile failed ({e})")
            time.sleep(0.5)
        row = {"t": sym, "about": about, "n": prof.get("n") or sym, **prof}
        if sym in series:
            row.update(moves(series[sym]))
        elif prev.get("p") is not None:
            row.update({k: prev[k] for k in MOVE_KEYS if k in prev})
            row["stale"] = True
        else:
            continue
        etfs.append(row)

    chart = chart_lines(series) or old.get("chart") or {}
    bud = budgets(old.get("budgets") or {}) if FULL or not old.get("budgets") else old["budgets"]
    sky = flights(old.get("flights") or {}, now)
    stories = news(old.get("news") or [], now)

    if len(stocks) < 20:
        log(f"only {len(stocks)} stocks came back; keeping the last aerospace.json")
        return
    write_json(OUT, {"generated": now.isoformat(timespec="minutes"), "stocks": stocks, "etfs": etfs, "chart": chart,
                     "events": [{"d": a, "e": b, "n": n, "where": w, "why": y} for a, b, n, w, y in EVENTS
                                if b >= (now - timedelta(days=1)).date().isoformat()],
                     "recurring": [{"m": m, "d": d, "n": n, "why": y} for m, d, n, y in RECURRING],
                     "budgets": bud, "flights": sky, "news": stories}, allow_nan=False)
    log(f"aerospace.json: {len(stocks)} stocks, {len(etfs)} ETFs, {len(stories)} stories, "
        f"{len((bud or {}).get('rows') or [])} budgets, flights {'yes' if sky else 'no'}")


if __name__ == "__main__":
    build()
