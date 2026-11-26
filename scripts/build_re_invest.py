"""Build site/re/invest.json: the investor sections of the real estate overview.

  - Key lending rates for the United States, Canada and Europe:
      US: federal funds target range and SOFR (New York Fed), prime (top of the Fed range + 3, the rule US
          banks follow), Freddie Mac 30- and 15-year fixed mortgages, 5- and 10-year Treasury yields (US Treasury).
      Canada: Bank of Canada policy rate and CORRA, posted 1-, 3- and 5-year mortgage rates, the Bank's
          estimated variable mortgage rate, average rates banks charged on new mortgages (variable and 5-year
          fixed), new non-residential (commercial) mortgages and business loans, prime, and 5- and 10-year bonds.
      Europe: ECB deposit and main refinancing rates, €STR, 3-month Euribor, euro area mortgage rates by how
          long the rate is fixed, loans to companies, the 10-year AAA euro yield (all from the ECB data portal),
          mortgage rates in each euro country, and the Bank of England's Bank Rate and UK mortgage rates.
  - REIT returns and dividend yields by property type in the US, Canada and Europe (Yahoo Finance).
  - US construction spending by type (Census Bureau) and Canadian building permits by type, nationally and
    for every census metropolitan area (Statistics Canada).
  - Commercial property prices by country (BIS).
  - Hand-kept fundamentals by property type (cap rates, vacancy, rent growth) from data/realestate/asset_classes.json,
    which carries its own sources and date.

Every source is optional: a part that fails keeps what the last build had.
With FRED_API_KEY set, a few extra US series are added (jumbo and FHA mortgage rates, commercial real estate
loan delinquency and bank lending standards). Run from the repo root:
    python scripts/build_re_invest.py
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safe_io import read_json, write_json  # noqa: E402
import build_realestate as RE  # noqa: E402  (shared helpers: get, bank_of_canada, xlsx_rows, freddie_mac, fred...)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "re" / "invest.json"
SRC = ROOT / "data" / "realestate" / "asset_classes.json"
NOW = datetime.now(timezone.utc)
TODAY = NOW.date()
RE.DEADLINE = time.time() + 12 * 60
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "text/csv,application/json,text/plain,*/*"}
log = RE.log
num, rnd = RE.num, RE.rnd


# ---------------------------------------------------------------- series helpers: [(date, value)] sorted
def asof(s, d):
    """Last value on or before date d."""
    v = None
    for x, y in s:
        if x > d:
            break
        v = y
    return v


def monthly(s, n=13):
    """Month-end values for the last n months (for the small trend lines)."""
    by = {}
    for d, v in s:
        by[(d.year, d.month)] = v
    keys = sorted(by)[-n:]
    return [rnd(by[k], 3) for k in keys]


def row(name, s, group, src, tip="", note=None, nd=2):
    """A rate for the page: latest value, change on a year ago (points) and a 13-month trend line."""
    s = sorted((d, v) for d, v in s if v is not None)
    if not s:
        return None
    last_d, last = s[-1]
    if (TODAY - last_d).days > 200:   # a series that stopped updating isn't shown as current
        return None
    yr = asof(s, last_d - timedelta(days=365))
    out = {"name": name, "group": group, "v": rnd(last, nd), "at": last_d.isoformat(), "src": src, "tip": tip,
           "chg": rnd(last - yr, 2) if yr is not None and s[0][0] <= last_d - timedelta(days=330) else None,
           "spark": monthly(s)}
    if note:
        out["note"] = note
    return out


def http(url, timeout=40, **kw):
    r = RE.get(url, tries=2, timeout=timeout, headers=UA, **kw)
    return r


# ---------------------------------------------------------------- United States
def nyfed(path):
    r = http(f"https://markets.newyorkfed.org/api/rates/{path}/last/400.json")
    rows = (r.json().get("refRates") or []) if r else []
    return sorted((RE.parse_date(x["effectiveDate"]), x) for x in rows if RE.parse_date(x.get("effectiveDate", "")))


def treasury():
    """Daily Treasury par yields for this year and last: {"5 Yr": [(date, v)], "10 Yr": ...}."""
    out = {}
    for y in (TODAY.year - 1, TODAY.year):
        r = http(f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{y}/all"
                 f"?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv")
        if not r:
            continue
        for rw in csv.DictReader(io.StringIO(r.text)):
            try:
                d = datetime.strptime(rw.get("Date", ""), "%m/%d/%Y").date()
            except ValueError:
                continue
            for k in ("2 Yr", "5 Yr", "10 Yr"):
                v = num(rw.get(k))
                if v is not None:
                    out.setdefault(k, []).append((d, v))
    return {k: sorted(v) for k, v in out.items()}


def fred_key():
    return bool(os.environ.get("FRED_API_KEY", "").strip())


def us_rates(series):
    rows = []
    effr = nyfed("unsecured/effr")
    sofr = nyfed("secured/sofr")
    top = [(d, num(x.get("targetRateTo"))) for d, x in effr if num(x.get("targetRateTo")) is not None]
    if effr:
        lo, hi = num(effr[-1][1].get("targetRateFrom")), num(effr[-1][1].get("targetRateTo"))
        rows.append(row("Fed funds target", top, "Central bank", "Federal Reserve, via the New York Fed",
                        "The Federal Reserve's policy rate. Shown is the top of its target range; banks' prime rate and most floating loans move with it.",
                        note=f"range {lo:.2f}–{hi:.2f}%" if lo is not None and hi is not None else None))
    rows.append(row("SOFR", [(d, num(x.get("percentRate"))) for d, x in sofr], "Central bank", "New York Fed",
                    "Secured Overnight Financing Rate: the overnight benchmark that most US floating-rate commercial real estate loans are priced over."))
    fm30, fm15 = RE.safe_call(RE.freddie_mac, ([], []))
    rows.append(row("30-year fixed", fm30, "Home loans", "Freddie Mac weekly survey", "Average 30-year fixed mortgage rate for a conforming loan, from Freddie Mac's weekly survey of lenders."))
    rows.append(row("15-year fixed", fm15, "Home loans", "Freddie Mac weekly survey", "Average 15-year fixed mortgage rate, Freddie Mac."))
    if fred_key():
        for sid, nm, tip in (("OBMMIJUMBO30YF", "30-year jumbo", "30-year fixed rate on loans above the conforming limit (Optimal Blue, via FRED)."),
                             ("OBMMIFHA30YF", "30-year FHA", "30-year fixed rate on FHA-insured loans (Optimal Blue, via FRED).")):
            rows.append(row(nm, RE.safe_call(lambda: RE.fred(sid), []), "Home loans", "Optimal Blue via FRED", tip))
    rows.append(row("Prime rate", [(d, v + 3) for d, v in top], "Commercial benchmarks", "Top of the Fed range + 3 points",
                    "The prime rate US banks charge their best borrowers, set by convention 3 points above the top of the Fed's range. Construction loans and many small business property loans float over it."))
    T = RE.safe_call(treasury, {})
    rows.append(row("5-year Treasury", T.get("5 Yr", []), "Commercial benchmarks", "US Treasury",
                    "Five-year government bond yield: the base rate for 5-year fixed commercial mortgages."))
    rows.append(row("10-year Treasury", T.get("10 Yr", []), "Commercial benchmarks", "US Treasury",
                    "Ten-year government bond yield: the base for 10-year commercial mortgages, which typically price 1.5 to 2.5 points above it, and the yardstick cap rates are compared with."))
    if fred_key():
        rows.append(row("Baa corporate bonds", RE.safe_call(lambda: RE.fred("DBAA"), []), "Commercial benchmarks", "Moody's via FRED",
                        "Yield on medium-grade corporate bonds: a guide to what lower-rated borrowers pay."))
    series.update({"us30": fm30, "us10": T.get("10 Yr", []), "us5": T.get("5 Yr", [])})
    return [r for r in rows if r]


# ---------------------------------------------------------------- Canada
def boc_group(name):
    r = http(f"https://www.bankofcanada.ca/valet/groups/{name}/json")
    return list((((r.json() if r else {}).get("groupDetail") or {}).get("groupSeries") or {}).items())


def boc(sid):
    return RE.safe_call(lambda: RE.bank_of_canada(sid), [])


def ca_rates(series):
    rows = [
        row("Bank of Canada policy rate", boc("V39079"), "Central bank", "Bank of Canada", "The Bank of Canada's target for the overnight rate. Variable mortgages and prime move with it."),
        row("CORRA", boc("AVG.INTWO"), "Central bank", "Bank of Canada", "Canadian Overnight Repo Rate Average: the overnight benchmark floating commercial loans are increasingly priced over."),
    ]
    # Average rates banks actually charged on new mortgages last month (uninsured, which most investors need)
    mort = boc_group("A4_RATES_MORTGAGES")
    block, picks = "", {}
    for sid, meta in mort:
        lab = (meta.get("label") or "").replace("&lt;", "<")
        if "Total" in lab and "insured" in lab:
            block = "uninsured" if "uninsured" in lab else "insured"
            continue
        if block == "uninsured" and "funds advanced" in (meta.get("description") or "").lower():
            if lab == "Variable rate":
                picks.setdefault("var", sid)
            elif lab.startswith("Fixed rate, 5 years"):
                picks.setdefault("fix5", sid)
    var = boc(picks["var"]) if picks.get("var") else []
    fix5 = boc(picks["fix5"]) if picks.get("fix5") else []
    post5 = boc("V80691335")
    rows += [
        row("5-year fixed, new loans", fix5, "Home loans", "Bank of Canada, chartered bank lending", "Average rate banks charged on new uninsured mortgages fixed for 5 years or more, last month.", note="average charged"),
        row("Variable, new loans", var, "Home loans", "Bank of Canada, chartered bank lending", "Average rate banks charged on new uninsured variable-rate mortgages, last month.", note="average charged"),
        row("5-year variable (estimate)", boc("BROKER_AVERAGE_5YR_VRM"), "Home loans", "Bank of Canada", "The Bank of Canada's weekly estimate of the typical 5-year variable mortgage rate on offer."),
        row("5-year fixed, posted", post5, "Home loans", "Bank of Canada", "The big banks' posted 5-year conventional rate. Few borrowers pay it, but it sets the mortgage stress test benchmark and prepayment penalties."),
        row("3-year fixed, posted", boc("V80691334"), "Home loans", "Bank of Canada", "Posted 3-year conventional mortgage rate."),
        row("1-year fixed, posted", boc("V80691333"), "Home loans", "Bank of Canada", "Posted 1-year conventional mortgage rate."),
    ]
    ext = boc_group("A4_RATES_EXTENDED")
    nonres = next((sid for sid, m in ext if (m.get("label") or "") == "Non-residential mortgages" and "Funds advanced" in (m.get("description") or "")), None)
    biz = next((sid for sid, m in ext if (m.get("label") or "") == "Business loans, Total" and "Funds advanced" in (m.get("description") or "")), None)
    rows += [
        row("Prime rate", boc("V80691311"), "Commercial benchmarks", "Bank of Canada", "The big banks' prime rate: variable mortgages, lines of credit and construction loans are priced from it."),
        row("Commercial mortgages, new", boc(nonres) if nonres else [], "Commercial benchmarks", "Bank of Canada, chartered bank lending", "Average rate banks charged on new non-residential (commercial) mortgages to businesses, last month.", note="average charged"),
        row("Business loans, new", boc(biz) if biz else [], "Commercial benchmarks", "Bank of Canada, chartered bank lending", "Average rate on new business loans from the chartered banks, last month.", note="average charged"),
        row("5-year Canada bond", boc("BD.CDN.5YR.DQ.YLD"), "Commercial benchmarks", "Bank of Canada", "Five-year Government of Canada bond yield: fixed mortgage and commercial mortgage rates are priced over it."),
        row("10-year Canada bond", boc("BD.CDN.10YR.DQ.YLD"), "Commercial benchmarks", "Bank of Canada", "Ten-year Government of Canada bond yield."),
    ]
    series.update({"ca5fix": fix5, "ca5bond": boc("BD.CDN.5YR.DQ.YLD")})
    return [r for r in rows if r]


# ---------------------------------------------------------------- Europe
def ecb(flow, key, start=None):
    """{series key: [(date, v)]} from the ECB data portal."""
    start = start or f"{TODAY.year - 2}-01"
    r = http(f"https://data-api.ecb.europa.eu/service/data/{flow}/{key}?startPeriod={start}&format=csvdata", timeout=60)
    out = {}
    for rw in csv.DictReader(io.StringIO(r.text)) if r else []:
        p, v = rw.get("TIME_PERIOD", ""), num(rw.get("OBS_VALUE"))
        d = RE.parse_date(p) if len(p) != 7 else RE.parse_date(p + "-01")
        if d and v is not None:
            out.setdefault(rw.get("KEY", ""), []).append((d, v))
    return {k: sorted(v) for k, v in out.items()}


def ecb1(flow, key, start=None):
    s = ecb(flow, key, start)
    return next(iter(s.values()), [])


def step(s):
    """A rate published only on the dates it changed (ECB policy rates), filled forward to today monthly."""
    if not s:
        return s
    out, d = list(s), s[-1][0]
    while True:
        d = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
        if d > TODAY:
            break
        out.append((d, s[-1][1]))
    out.append((TODAY, s[-1][1]))
    return sorted(set(out))


EURO = {"AT": "Austria", "BE": "Belgium", "CY": "Cyprus", "DE": "Germany", "EE": "Estonia", "ES": "Spain", "FI": "Finland",
        "FR": "France", "GR": "Greece", "HR": "Croatia", "IE": "Ireland", "IT": "Italy", "LT": "Lithuania", "LU": "Luxembourg",
        "LV": "Latvia", "MT": "Malta", "NL": "Netherlands", "PT": "Portugal", "SI": "Slovenia", "SK": "Slovakia", "BG": "Bulgaria"}


def boe():
    """Bank of England Bank Rate and UK mortgage rates (monthly averages)."""
    start = (TODAY - timedelta(days=800)).strftime("%d/%b/%Y")
    r = http("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes"
             f"&Datefrom={start}&Dateto=now&SeriesCodes=IUMABEDR,IUMBV34,IUMBV42,IUMTLMV&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N")
    out = {}
    for rw in csv.DictReader(io.StringIO(r.text)) if r else []:
        try:
            d = datetime.strptime(rw.get("DATE", ""), "%d %b %Y").date()
        except ValueError:
            continue
        for k, v in rw.items():
            if k != "DATE" and num(v) is not None:
                out.setdefault(k, []).append((d, num(v)))
    return out


def eu_rates(series, extra):
    mir = lambda k: ecb1("MIR", k)
    rows = [
        row("ECB deposit rate", step(ecb1("FM", "B.U2.EUR.4F.KR.DFR.LEV", f"{TODAY.year - 4}-01-01")), "Central bank", "European Central Bank",
            "The ECB's main policy rate since 2024: what banks earn on money left with the central bank."),
        row("ECB main refinancing rate", step(ecb1("FM", "B.U2.EUR.4F.KR.MRR_FR.LEV", f"{TODAY.year - 4}-01-01")), "Central bank", "European Central Bank",
            "The rate on the ECB's weekly loans to banks."),
        row("€STR", ecb1("EST", "B.EU000A2X2A25.WT"), "Central bank", "European Central Bank", "Euro short-term rate: the overnight benchmark for the euro."),
        row("Mortgages, all new loans", mir("M.U2.B.A2C.AM.R.A.2250.EUR.N"), "Home loans (euro area)", "ECB interest rate statistics",
            "Cost of borrowing for households buying a home across the euro area, new loans, monthly."),
        row("Variable or fixed up to 1 yr", mir("M.U2.B.A2C.F.R.A.2250.EUR.N"), "Home loans (euro area)", "ECB interest rate statistics",
            "New home loans with a floating rate or one fixed for up to a year. Most common in Spain, Portugal and the Baltics."),
        row("Fixed 5 to 10 years", mir("M.U2.B.A2C.P.R.A.2250.EUR.N"), "Home loans (euro area)", "ECB interest rate statistics", "New home loans with the rate fixed for 5 to 10 years."),
        row("Fixed over 10 years", mir("M.U2.B.A2C.O.R.A.2250.EUR.N"), "Home loans (euro area)", "ECB interest rate statistics",
            "New home loans fixed for more than 10 years. The norm in Germany, France and the Netherlands."),
        row("3-month Euribor", ecb1("FM", "M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA"), "Commercial benchmarks", "European Central Bank",
            "The interbank rate most European floating-rate commercial property loans are priced over (monthly average)."),
        row("Business loans over €1M", mir("M.U2.B.A2A.A.R.1.2240.EUR.N"), "Commercial benchmarks", "ECB interest rate statistics",
            "Average rate on new loans of over €1 million to companies: the size of most property investment loans."),
        row("10-year AAA euro yield", ecb1("YC", "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y"), "Commercial benchmarks", "European Central Bank",
            "Ten-year yield on top-rated euro government bonds, the base for long fixed-rate commercial loans."),
    ]
    uk = RE.safe_call(boe, {})
    rows += [
        row("UK Bank Rate", uk.get("IUMABEDR", []), "United Kingdom", "Bank of England", "The Bank of England's policy rate (monthly average)."),
        row("UK 2-year fixed (75% LTV)", uk.get("IUMBV34", []), "United Kingdom", "Bank of England", "Average quoted 2-year fixed mortgage rate at 75% loan-to-value."),
        row("UK 5-year fixed (75% LTV)", uk.get("IUMBV42", []), "United Kingdom", "Bank of England", "Average quoted 5-year fixed mortgage rate at 75% loan-to-value."),
        row("UK standard variable rate", uk.get("IUMTLMV", []), "United Kingdom", "Bank of England", "Average standard variable rate, what borrowers move to when a fixed deal ends."),
    ]
    # Home loan rates in each euro country
    by = ecb("MIR", f"M.{'+'.join(EURO)}.B.A2C.AM.R.A.2250.EUR.N")
    cty = []
    for k, s in by.items():
        c = k.split(".")[2] if k.count(".") > 3 else ""
        if c in EURO and s and (TODAY - s[-1][0]).days < 200:
            yr = asof(s, s[-1][0] - timedelta(days=365))
            cty.append({"code": c, "name": EURO[c], "v": rnd(s[-1][1], 2), "at": s[-1][0].strftime("%Y-%m"),
                        "chg": rnd(s[-1][1] - yr, 2) if yr is not None else None})
    extra["euroMortgage"] = sorted(cty, key=lambda x: x["v"])
    return [r for r in rows if r]


# ---------------------------------------------------------------- REITs by property type
REITS = {
    # key: {region: [symbols]}
    "resi": {"US": ["INVH", "AMH"]},
    "multi": {"US": ["MAA", "CPT", "ESS", "UDR", "AVB", "EQR"], "CA": ["CAR-UN.TO", "IIP-UN.TO", "KMP-UN.TO", "BEI-UN.TO"],
              "EU": ["VNA.DE", "LEG.DE", "TEG.DE", "UTG.L"]},
    "office": {"US": ["BXP", "VNO", "SLG", "KRC", "CUZ", "HIW"], "CA": ["AP-UN.TO", "D-UN.TO"], "EU": ["GFC.PA", "COL.MC", "LAND.L", "BLND.L"]},
    "ind": {"US": ["PLD", "REXR", "EGP", "FR", "STAG"], "CA": ["GRT-UN.TO", "DIR-UN.TO"], "EU": ["SGRO.L", "BBOX.L", "WDP.BR", "MONT.BR"]},
    "retail": {"US": ["SPG", "FRT", "KIM", "REG", "MAC"], "CA": ["REI-UN.TO", "CHP-UN.TO", "SRU-UN.TO", "FCR-UN.TO", "CRT-UN.TO"], "EU": ["URW.PA", "LI.PA"]},
    "dc": {"US": ["EQIX", "DLR"]},
    "hotel": {"US": ["HST", "PK", "RHP", "APLE"]},
    "senior": {"US": ["WELL", "VTR", "OHI"], "CA": ["CSH-UN.TO", "SIA.TO", "NWH-UN.TO"], "EU": ["AED.BR", "COFB.BR", "PHP.L"]},
    "storage": {"US": ["PSA", "EXR", "CUBE"], "EU": ["BYG.L", "SAFE.L", "SHUR.AS"]},
    "infra": {"US": ["AMT", "CCI", "SBAC"], "EU": ["CLNX.MC", "INW.MI"]},
    "lease": {"US": ["O", "NNN", "ADC", "VICI"]},
}
BROAD = [["VNQ", "US REITs (Vanguard VNQ)"], ["XRE.TO", "Canadian REITs (iShares XRE)"], ["IPRP.AS", "European property (iShares IPRP)"], ["REET", "Global REITs (iShares REET)"]]


def reits(classes):
    import pandas as pd
    import yfinance as yf
    syms = sorted({s for g in REITS.values() for v in g.values() for s in v} | {b[0] for b in BROAD})
    df = None
    for attempt in range(2):
        try:
            df = yf.download(syms, period="2y", interval="1d", auto_adjust=False, actions=True, progress=False, group_by="column", threads=True)
            if df is not None and len(df):
                break
        except Exception as e:  # noqa: BLE001
            log(f"  REIT download failed ({e!r})")
        time.sleep(10)
    if df is None or not len(df):
        return None
    close, divs = df["Close"], df["Dividends"] if "Dividends" in df else None
    names = {}

    def stats(sym):
        if sym not in close:
            return None
        c = close[sym].dropna()
        if len(c) < 200:
            return None
        last, at = float(c.iloc[-1]), c.index[-1]
        def back(days):
            s = c[c.index <= at - pd.Timedelta(days=days)]
            return float(s.iloc[-1]) if len(s) else None
        ystart = c[c.index < pd.Timestamp(at.year, 1, 1, tz=at.tz)]
        p = lambda b: None if not b else (last / b - 1) * 100
        dv = 0.0
        if divs is not None and sym in divs:
            d = divs[sym].fillna(0)
            dv = float(d[d.index > at - pd.Timedelta(days=365)].sum())
        wk = c.resample("W").last().dropna().iloc[-53:]
        return {"r1m": p(back(30)), "ytd": p(float(ystart.iloc[-1]) if len(ystart) else None), "r1y": p(back(365)),
                "yld": dv / last * 100 if dv and last else None, "wk": (wk / wk.iloc[0]).tolist(), "at": at.date().isoformat()}

    info = {s: stats(s) for s in syms}
    try:  # short names for the tooltips
        for s in syms:
            if info.get(s):
                names[s] = s.replace("-UN.TO", ".UN").replace(".TO", "")
    except Exception:  # noqa: BLE001
        pass
    mean = lambda xs: None if not xs else sum(xs) / len(xs)
    out, latest = [], None
    meta = {c["key"]: c for c in classes}
    for key, regions in REITS.items():
        row = {"key": key, "name": meta.get(key, {}).get("name", key), "icon": meta.get(key, {}).get("icon", "")}
        for reg, members in regions.items():
            have = [s for s in members if info.get(s)]
            if not have:
                continue
            g = {f: rnd(mean([info[s][f] for s in have if info[s][f] is not None]), 1) for f in ("r1m", "ytd", "r1y", "yld")}
            n = min(len(info[s]["wk"]) for s in have)
            idx = [sum(info[s]["wk"][-n:][i] for s in have) / len(have) for i in range(n)]
            g.update({"n": len(have), "names": [names.get(s, s) for s in have], "spark": [rnd(x * 100, 1) for x in idx[::2]]})
            row[reg] = g
            latest = max(latest or "", *(info[s]["at"] for s in have))
        out.append(row)
    broad = []
    for s, nm in BROAD:
        if info.get(s):
            broad.append({"sym": s, "name": nm, **{f: rnd(info[s][f], 1) for f in ("r1m", "ytd", "r1y", "yld")}})
    log(f"  REITs: {sum(1 for v in info.values() if v)} of {len(syms)} symbols")
    return {"classes": out, "broad": broad, "at": latest}


# ---------------------------------------------------------------- US construction spending (Census)
CENSUS_TYPES = [  # column heading starts with: label shown
    ("New single family", "Single-family homes"), ("New multifamily", "Multifamily (apartments)"), ("Data center", "Data centers"),
    ("Office", "Offices, incl. data centers"), ("Warehouse", "Warehouses"), ("Multi-retail", "Shopping centres"),
    ("Lodging", "Hotels"), ("Health care", "Health care"), ("Manufacturing", "Factories"), ("Educational", "Schools and colleges"),
    ("Amusement and recreation", "Recreation"), ("Power", "Power and energy"),
]


def census():
    r = http("https://www.census.gov/construction/c30/xlsx/privsatime.xlsx", timeout=60)
    if not r:
        return []
    rows = RE.xlsx_rows(r.content, 0)
    head = next((rw for rw in rows if rw and rw[0] == "Date"), None)
    if not head:
        return []
    hi = rows.index(head)
    cols = [re.sub(r"\s+", " ", str(h or "")).strip() for h in head]
    data = []
    for rw in rows[hi + 1:]:
        if not rw or not isinstance(rw[0], str):
            continue
        m = re.match(r"([A-Z][a-z]{2})-(\d{2})", rw[0])
        if not m:
            continue
        yy = int(m.group(2))
        d = datetime.strptime(f"{m.group(1)} {2000 + yy if 2000 + yy <= TODAY.year else 1900 + yy}", "%b %Y").date()
        data.append((d, rw))
    data.sort(key=lambda x: x[0])
    if len(data) < 13:
        return []
    last_d, last = data[-1]
    prev = dict(data).get(date(last_d.year - 1, last_d.month, 1))
    out = []
    for start, label in CENSUS_TYPES:
        i = next((k for k, c in enumerate(cols) if c.startswith(start)), None)
        if i is None or i >= len(last) or not isinstance(last[i], float):
            continue
        v = last[i] / 1000  # millions -> billions, at a yearly rate
        p = prev[i] / 1000 if prev and i < len(prev) and isinstance(prev[i], float) else None
        out.append({"name": label, "v": rnd(v, 1), "yoy": rnd(RE.pct(v, p), 1), "at": last_d.strftime("%Y-%m"),
                    "spark": [rnd(rw[i] / 1000, 1) for _, rw in data[-24:] if i < len(rw) and isinstance(rw[i], float)]})
    log(f"  Census construction: {len(out)} types to {last_d}")
    return out


# ---------------------------------------------------------------- Canadian building permits (StatCan 34-10-0292)
PERMIT_TYPES = {  # member id in "Type of building": key, label
    1: ("tot", "All permits"), 4: ("res", "Residential"), 24: ("apt", "Apartments"), 7: ("single", "Single-family homes"),
    36: ("ind", "Industrial"), 49: ("com", "Commercial"), 59: ("off", "Offices"), 57: ("wh", "Warehouses"),
    52: ("ret", "Stores and services"), 66: ("hotel", "Hotels and restaurants"), 72: ("lab", "Laboratories"),
    73: ("inst", "Institutional"), 82: ("med", "Hospitals and clinics"), 85: ("care", "Care homes"),
}
CMA_TYPES = [1, 4, 49, 36, 73]


def statcan_post(path, body, timeout=90):
    for i in range(3):
        try:
            r = requests.post(f"https://www150.statcan.gc.ca/t1/wds/rest/{path}", json=body, headers=UA, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            log(f"  StatCan {path}: HTTP {r.status_code}")
        except requests.RequestException as e:
            log(f"  StatCan {path} retry {i + 1}: {e!r}")
        time.sleep(5 * (i + 1))
    return None


def permits():
    meta = statcan_post("getCubeMetadata", [{"productId": 34100292}])
    if not meta:
        return None
    dims = meta[0]["object"]["dimension"]
    geo = dims[0]["member"]
    # Census metropolitan areas: children of a province's "total census metropolitan area" member
    totals = {m["memberId"] for m in geo if "total census metropolitan area" in m["memberNameEn"]}
    canada = next((m["memberId"] for m in geo if m["memberNameEn"].startswith("Canada")), 1)
    cmas = [m for m in geo if m.get("parentMemberId") in totals and "total" not in m["memberNameEn"]]
    # value of permits (1), unadjusted current dollars (1), all types of work (1); 24 months to sum two 12-month spans
    coord = lambda g, t: f"{g}.{t}.1.1.1.0.0.0.0.0"
    want = [(canada, t) for t in PERMIT_TYPES] + [(m["memberId"], t) for m in cmas for t in CMA_TYPES]
    got = {}
    for i in range(0, len(want), 100):
        res = statcan_post("getDataFromCubePidCoordAndLatestNPeriods",
                           [{"productId": 34100292, "coordinate": coord(g, t), "latestN": 24} for g, t in want[i:i + 100]]) or []
        for x in res:
            o = x.get("object") or {}
            pts = [(p["refPer"][:7], num(p.get("value"))) for p in o.get("vectorDataPoint") or []]
            g, t = map(int, o.get("coordinate", "0.0").split(".")[:2])
            got[(g, t)] = [p for p in pts if p[1] is not None]
    if not got:
        return None
    last = max((p[-1][0] for p in got.values() if p), default=None)

    def sums(pts):
        pts = [p for p in pts if p[0] <= last]
        if len(pts) < 24 or pts[-1][0] != last:
            return None, None
        a, b = sum(v for _, v in pts[-12:]) / 1000, sum(v for _, v in pts[-24:-12]) / 1000  # thousands -> millions
        return a, b

    types = []
    for t, (k, label) in PERMIT_TYPES.items():
        a, b = sums(got.get((canada, t), []))
        if a is not None:
            types.append({"key": k, "name": label, "v": rnd(a, 0), "yoy": rnd(RE.pct(a, b), 1)})
    rows = []
    for m in cmas:
        nm, _, prov = m["memberNameEn"].partition(", ")
        r = {"name": nm.split(" (")[0].strip(), "prov": RE.PROVINCES.get(prov.split(" part")[0].split(" (")[0].strip(), "")}
        for t in CMA_TYPES:
            k = PERMIT_TYPES[t][0]
            a, b = sums(got.get((m["memberId"], t), []))
            r[k] = rnd(a, 1)
            r[k + "Y"] = rnd(RE.pct(a, b), 1) if a is not None and b and b > 5 else None
        if r.get("tot"):
            rows.append(r)
    log(f"  StatCan permits: {len(types)} national types, {len(rows)} cities, to {last}")
    return {"at": last, "types": [t for t in types if t["key"] != "tot"], "total": next((t for t in types if t["key"] == "tot"), None),
            "cmas": sorted(rows, key=lambda r: -(r.get("tot") or 0))}


# ---------------------------------------------------------------- commercial property prices (BIS)
CPP_TYPES = {"A": "All commercial", "D": "Office and retail", "B": "Offices", "C": "Retail", "G": "Industrial", "O": "Commercial (other)"}


def cpp():
    rows = RE.sdmx_csv(f"https://stats.bis.org/api/v1/data/WS_CPP/Q..../all?detail=dataonly&format=csv&startPeriod={TODAY.year - 7}-Q1")
    by = {}
    for rw in rows:
        c, area, typ = rw.get("REF_AREA", ""), rw.get("COVERED_AREA", ""), rw.get("RE_TYPE", "")
        d, v = RE.qdate(rw.get("TIME_PERIOD", "")), num(rw.get("OBS_VALUE"))
        if d and v is not None and typ in CPP_TYPES:
            k = tuple(rw.get(x, "") for x in ("REF_AREA", "COVERED_AREA", "RE_TYPE", "RE_VINTAGE", "COMPILING_ORG", "PRICED_UNIT", "ADJUST_CODED"))
            by.setdefault(k, []).append((d, v))
    best = {}
    order = list(CPP_TYPES)
    for k, s in by.items():
        s.sort()
        c, area, typ = k[0], k[1], k[2]
        if len(s) < 6 or (TODAY - s[-1][0]).days > 550:
            continue
        rank = (area != "0", order.index(typ), -s[-1][0].toordinal(), -len(s))
        if c not in best or rank < best[c][0]:
            best[c] = (rank, k, s)
    out = []
    for c, (_, k, s) in best.items():
        name = (RE.WORLD.get(c) or (c,))[0]
        v = s[-1][1]
        out.append({"code": c, "name": name, "type": CPP_TYPES[k[2]], "whole": k[1] == "0",
                    "asof": f"{s[-1][0].year}-Q{(s[-1][0].month - 1) // 3 + 1}",
                    "n1y": rnd(RE.pct(v, RE.qat(s, 4)), 1), "n5y": rnd(RE.pct(v, RE.qat(s, 20)), 1) if len(s) > 20 else None,
                    "offPeak": rnd(RE.pct(v, max(x for _, x in s)), 1)})
    log(f"  BIS commercial property prices: {len(out)} countries")
    return sorted(out, key=lambda x: x["name"])


# ---------------------------------------------------------------- health check tiles
def spread(a, b):
    """Monthly a − b."""
    ma, mb = dict((date(d.year, d.month, 1), v) for d, v in a), dict((date(d.year, d.month, 1), v) for d, v in b)
    return sorted((d, ma[d] - mb[d]) for d in ma if d in mb)


def tiles(series, cpp_rows):
    out = []
    def tile(name, s, src, tip, nd=2, unit=" pts", good=None, chg_unit=" pts"):
        s = sorted(s)
        if not s:
            return
        last_d, last = s[-1]
        yr = asof(s, last_d - timedelta(days=365))
        out.append({"name": name, "v": rnd(last, nd), "nd": nd, "unit": unit, "at": last_d.isoformat(), "src": src, "tip": tip,
                    "chg": rnd(last - yr, nd) if yr is not None else None, "chgUnit": chg_unit, "good": good})
    tile("US mortgage spread", spread(series.get("us30", []), series.get("us10", [])), "Freddie Mac and US Treasury",
         "The 30-year mortgage rate minus the 10-year Treasury yield. Normal is about 1.7 points; a wider spread means mortgages are dear for the bond market's level.", good=-1)
    tile("Canada mortgage spread", spread(series.get("ca5fix", []), series.get("ca5bond", [])), "Bank of Canada",
         "Average new 5-year fixed mortgage rate minus the 5-year Government of Canada bond yield.", good=-1)
    for c, nm in (("US", "US"), ("XM", "Euro area"), ("CA", "Canada")):
        r = next((x for x in cpp_rows if x["code"] == c), None)
        if r and r.get("n1y") is not None:
            out.append({"name": f"{nm} commercial property prices, 1 yr", "v": r["n1y"], "nd": 1, "unit": "%", "at": r["asof"], "src": "BIS",
                        "tip": "Change in the commercial property price index over the past year." + (f" {r['offPeak']:+.0f}% from its peak." if r.get("offPeak") is not None else ""),
                        "chg": None, "label": "1 yr"})
    if fred_key():
        tile("US CRE loan delinquency", RE.safe_call(lambda: RE.fred("DRCRELEXFACBS"), []), "Federal Reserve via FRED",
             "Share of commercial real estate loans (excluding farmland) at US banks that are 30+ days late.", unit="%", good=-1)
        tile("Banks tightening CRE loans", RE.safe_call(lambda: RE.fred("SUBLPDRCSN"), []), "Fed senior loan officer survey via FRED",
             "Net share of banks tightening standards on loans for nonfarm, nonresidential property. Above zero means credit is getting harder to get.", nd=1, unit="%", good=-1)
    return out


# ---------------------------------------------------------------- main
def main():
    last = read_json(OUT, {}) or {}
    classes = read_json(SRC, {}) or {}
    errors, series, extra = [], {}, {}

    def safe(name, fn, fallback):
        try:
            v = fn()
            if v:
                return v
            log(f"{name}: nothing came back")
        except Exception as e:  # noqa: BLE001
            log(f"{name} failed: {e!r}")
        errors.append(name)
        return fallback

    log("Lending rates")
    rates = {
        "US": safe("US rates", lambda: us_rates(series), (last.get("rates") or {}).get("US") or []),
        "CA": safe("Canada rates", lambda: ca_rates(series), (last.get("rates") or {}).get("CA") or []),
        "EU": safe("Europe rates", lambda: eu_rates(series, extra), (last.get("rates") or {}).get("EU") or []),
    }
    log("REITs")
    reit = safe("REITs", lambda: reits(classes.get("classes") or []), last.get("reits"))
    log("Construction and permits")
    us_build = safe("Census construction", census, ((last.get("build") or {}).get("US")) or [])
    ca_build = safe("StatCan permits", permits, ((last.get("build") or {}).get("CA")) or None)
    log("Commercial property prices")
    cp = safe("BIS commercial prices", cpp, last.get("cpp") or [])
    cre = safe("health check", lambda: tiles(series, cp), last.get("cre") or [])
    data = {
        "updated": NOW.isoformat(timespec="seconds"), "errors": errors,
        "rates": rates, "euroMortgage": extra.get("euroMortgage") or last.get("euroMortgage") or [],
        "reits": reit, "build": {"US": us_build, "CA": ca_build}, "cpp": cp, "cre": cre,
        "classes": {k: v for k, v in classes.items() if not k.startswith("_")},
    }
    if not any(rates.values()) and not reit and last:
        log("::error::nothing came back at all; keeping the last invest.json")
        sys.exit(2)
    write_json(OUT, data, ensure_ascii=False)
    log(f"Wrote {OUT.relative_to(ROOT)}: {sum(len(v) for v in rates.values())} rates; failed parts: {errors or 'none'}")


if __name__ == "__main__":
    main()
