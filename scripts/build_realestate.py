"""Build the real estate section's data: site/re/data.json, site/re/hist.json, site/re/hist/,
site/re/listings.json and site/re/news.json.

Every source is free to use with credit:
  - Zillow Research CSVs (US metros): typical home value (ZHVI), rent (ZORI),
    for-sale inventory, new listings, list and sale prices, days to pending,
    price cuts, sale-to-list ratio, market heat index and the 12-month forecast.
  - FRED (St. Louis Fed): US mortgage rates, Case-Shiller, median sale price,
    housing starts, vacancy, the BIS house price index for the US, Canada and
    Mexico, and USD/CAD and USD/MXN exchange rates.
  - Statistics Canada open data: New Housing Price Index by city (table
    18-10-0205) and CMHC average rents by city (table 34-10-0133).
  - Bank of Canada Valet API: 5-year conventional mortgage rate, policy rate.
  - Sociedad Hipotecaria Federal (Mexico): state house prices, kept by hand in
    data/realestate/mexico_shf.csv because SHF publishes PDF and Excel only.
  - BIS data portal: residential property prices (nominal and real) for every
    country it covers, central bank policy rates and US dollar exchange rates;
    OECD house price database: price-to-income and price-to-rent ratios.
    Zillow state files: typical home value and rent by US state.
  - RentCast API (optional, US only): real active for-sale listings, when the
    RENTCAST_API_KEY secret is set. Its free plan allows 50 requests a month, so
    listings are fetched once a week and saved in data/realestate/listings.json.

Each source is optional: if one fails the rest still build.
    python scripts/build_realestate.py
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import os
import random
import re
import sys
import time
import xml.etree.ElementTree as ET
import zipfile
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote_plus

import requests

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "realestate"
OUT = ROOT / "site" / "re"
UA = {"User-Agent": "Mozilla/5.0 (real-estate-site data builder)"}
NOW = datetime.now(timezone.utc)

US_MARKETS = 150          # Zillow metros kept, by size
HIST_YEARS = 20           # monthly history kept for charts
DEADLINE = time.time() + 20 * 60   # stop fetching after this; whatever is in by then gets built


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(url: str, tries: int = 3, timeout: int = 60, **kw) -> requests.Response | None:
    """GET with retries and a hard cap on total download time (a slow server can't stall the build)."""
    headers = {**UA, **kw.pop("headers", {})}
    for i in range(tries):
        if time.time() > DEADLINE:
            log(f"  skipped {url}: out of time")
            return None
        t0 = time.time()
        try:
            with requests.get(url, headers=headers, timeout=(15, 30), stream=True, **kw) as r:
                if r.status_code in (403, 404, 410):
                    log(f"  {r.status_code} {url}")
                    return None
                if r.status_code != 200:
                    raise requests.RequestException(f"HTTP {r.status_code}")
                buf = bytearray()
                for chunk in r.iter_content(1 << 16):
                    buf += chunk
                    if time.time() - t0 > timeout:
                        raise requests.RequestException(f"took over {timeout}s")
                r._content = bytes(buf)
                r._content_consumed = True
                log(f"  got {url} ({len(buf) // 1024} KB, {time.time() - t0:.1f}s)")
                return r
        except requests.RequestException as e:
            log(f"  retry {i + 1} {url}: {e}")
        time.sleep(2 * (i + 1))
    return None


def num(s):
    try:
        v = float(s)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def pct(a, b):
    return None if a is None or b in (None, 0) else (a / b - 1) * 100


def rnd(v, nd=2):
    return None if v is None else round(v, nd)


def at(series, months_back: int):
    """Value roughly months_back months before the last point of a monthly [(date, v)] series."""
    if not series:
        return None
    last = series[-1][0]
    target = (last.year * 12 + last.month - 1) - months_back
    for d, v in reversed(series):
        if d.year * 12 + d.month - 1 <= target:
            return v
    return None


def parse_date(s: str) -> date | None:
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


# ---------------------------------------------------------------- FRED
BROWSER = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
           "Accept": "text/csv,application/json,text/plain,*/*"}
_fred_down = False


def fred(series_id: str) -> list[tuple[date, float]]:
    """A FRED series. Uses the FRED API when FRED_API_KEY is set (free key); otherwise the public CSV link,
    which sometimes stalls for cloud servers, so after one failure the rest are skipped."""
    global _fred_down
    key = os.environ.get("FRED_API_KEY", "").strip()
    out = []
    if key:
        r = get(f"https://api.stlouisfed.org/fred/series/observations?series_id={series_id}&api_key={key}&file_type=json",
                tries=2, timeout=40)
        for o in (r.json().get("observations", []) if r else []):
            d, v = parse_date(o.get("date", "")), num(o.get("value"))
            if d and v is not None:
                out.append((d, v))
        if out:
            return out
    if _fred_down:
        return []
    r = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}", tries=1, timeout=40, headers=BROWSER)
    if not r:
        log("  FRED not answering; skipping its other series this run")
        _fred_down = True
        return []
    for row in list(csv.reader(io.StringIO(r.text)))[1:]:
        if len(row) >= 2:
            d, v = parse_date(row[0]), num(row[1])
            if d and v is not None:
                out.append((d, v))
    return out


def bis_api(key: str) -> list[tuple[date, float]]:
    """A BIS selected residential property price series straight from the BIS data portal."""
    r = get(f"https://stats.bis.org/api/v1/data/WS_SPP/{key}/all?detail=dataonly&format=csv", tries=1, timeout=40, headers=BROWSER)
    if not r:
        return []
    out = []
    for row in csv.DictReader(io.StringIO(r.text)):
        p, v = row.get("TIME_PERIOD") or "", num(row.get("OBS_VALUE"))
        m = re.match(r"(\d{4})-Q(\d)", p)
        if m and v is not None:
            out.append((date(int(m.group(1)), int(m.group(2)) * 3 - 2, 1), v))
    return sorted(out)


def dbnomics(code: str) -> list[tuple[date, float]]:
    """A series from DBnomics (free mirror of BIS and other agencies), e.g. BIS/WS_SPP/Q.US.N.628."""
    r = get(f"https://api.db.nomics.world/v22/series/{code}?observations=1&format=json", tries=2, timeout=40)
    if not r:
        return []
    docs = ((r.json().get("series") or {}).get("docs")) or []
    if not docs:
        return []
    doc = docs[0]
    days = doc.get("period_start_day") or doc.get("period") or []
    out = []
    for d, v in zip(days, doc.get("value") or []):
        d, v = parse_date(str(d)[:10]), num(v)
        if d and v is not None:
            out.append((d, v))
    return out


def xlsx_rows(content: bytes, which: int = 0) -> list[list]:
    """Rows of one sheet of an .xlsx file, without extra packages: strings and numbers by column."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")))
        sheets = sorted((n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n)), key=lambda n: int(re.findall(r"\d+", n)[-1]))
        if which >= len(sheets):
            return []
        sheet = sheets[which]
        rows = []
        for row in ET.fromstring(z.read(sheet)).iter(f"{{{ns['m']}}}row"):
            out = {}
            for c in row.findall("m:c", ns):
                col = re.match(r"[A-Z]+", c.get("r", "A")).group(0)
                v = c.find("m:v", ns)
                if v is None or v.text is None:
                    t = c.find("m:is/m:t", ns)
                    val = t.text if t is not None else None
                elif c.get("t") == "s":
                    val = shared[int(v.text)]
                else:
                    val = num(v.text) if c.get("t") != "str" else v.text
                out[col] = val
            if out:
                width = max(sum((ord(ch) - 64) * 26 ** i for i, ch in enumerate(reversed(k))) for k in out)
                rows.append([out.get(colname(i)) for i in range(width)])
        return rows


def colname(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def freddie_mac() -> tuple[list, list]:
    """Weekly 30- and 15-year fixed mortgage rates from Freddie Mac's survey (the source FRED copies).
    The workbook's layout has changed over the years, so the sheet with the latest dates is used, and the
    rate columns are told apart by their values: the 30-year is the highest rate, the 15-year the next."""
    r = get("https://www.freddiemac.com/pmms/docs/historicalweeklydata.xlsx", tries=2, timeout=60, headers=BROWSER)
    if not r:
        return [], []
    best = None
    for k in range(8):
        rows = xlsx_rows(r.content, k)
        if not rows and k:
            break
        dated = []
        for row in rows:
            d = row[0] if row else None
            if isinstance(d, float) and 20000 < d < 80000:   # Excel day number
                d = date(1899, 12, 30) + timedelta(days=int(d))
            elif isinstance(d, str):
                d = next((datetime.strptime(d.strip(), f).date() for f in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d") if _ok(d, f)), None)
            else:
                d = None
            if d:
                dated.append((d, row))
        if dated and (best is None or max(dated)[0] > max(best)[0]):
            best = dated
    if not best:
        return [], []
    best.sort(key=lambda x: x[0])
    recent = best[-52:]
    width = max(len(row) for _, row in recent)
    def avg(i):
        v = [row[i] for _, row in recent if i < len(row) and isinstance(row[i], float) and 1.5 < row[i] < 25]
        return sum(v) / len(v) if len(v) > len(recent) / 2 else None
    cols = sorted((i for i in range(1, width) if avg(i) is not None), key=lambda i: -avg(i))
    if not cols:
        return [], []
    pick = lambda i: [(d, row[i]) for d, row in best if i < len(row) and isinstance(row[i], float) and 0 < row[i] < 25]
    s30 = pick(cols[0])
    s15 = pick(cols[1]) if len(cols) > 1 else []
    log(f"  Freddie Mac: {len(s30)} weeks, latest {s30[-1] if s30 else None}")
    return s30, s15


def _ok(s, f):
    try:
        datetime.strptime(s.strip(), f)
        return True
    except ValueError:
        return False


def weekly_to_monthly(series):
    """Keep the last value of each month."""
    by = {}
    for d, v in series:
        by[(d.year, d.month)] = (date(d.year, d.month, 1), v)
    return [by[k] for k in sorted(by)]


# ---------------------------------------------------------------- Zillow
ZILLOW = "https://files.zillowstatic.com/research/public_csvs/"
ZMETRICS = {
    # key: candidate file paths (Zillow sometimes renames them)
    "zhvi": ["zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"],
    "zori": ["zori/Metro_zori_uc_sfrcondomfr_sm_month.csv", "zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv"],
    "inv": ["invt_fs/Metro_invt_fs_uc_sfrcondo_sm_month.csv", "invt_fs/Metro_invt_fs_uc_sfrcondo_month.csv"],
    "newl": ["new_listings/Metro_new_listings_uc_sfrcondo_sm_month.csv", "new_listings/Metro_new_listings_uc_sfrcondo_month.csv"],
    "mlp": ["mlp/Metro_mlp_uc_sfrcondo_sm_month.csv", "mlp/Metro_mlp_uc_sfrcondo_month.csv"],
    "msp": ["median_sale_price/Metro_median_sale_price_uc_sfrcondo_sm_sa_month.csv", "median_sale_price/Metro_median_sale_price_uc_sfrcondo_sm_month.csv",
            "median_sale_price/Metro_median_sale_price_uc_sfrcondo_month.csv"],
    "dtp": ["med_doz_pending/Metro_med_doz_pending_uc_sfrcondo_sm_month.csv", "med_doz_pending/Metro_med_doz_pending_uc_sfrcondo_month.csv"],
    "cut": ["perc_listings_price_cut/Metro_perc_listings_price_cut_uc_sfrcondo_sm_month.csv", "perc_listings_price_cut/Metro_perc_listings_price_cut_uc_sfrcondo_month.csv"],
    "stl": ["mean_sale_to_list/Metro_mean_sale_to_list_uc_sfrcondo_sm_month.csv", "mean_sale_to_list/Metro_mean_sale_to_list_uc_sfrcondo_month.csv"],
    "heat": ["market_temp_index/Metro_market_temp_index_uc_sfrcondo_month.csv", "market_temp_index/Metro_market_temp_index_uc_sfrcondo_sm_month.csv"],
    "fc": ["zhvf_growth/Metro_zhvf_growth_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"],
    # State level, for the by-state chart
    "st_zhvi": ["zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"],
    "st_zori": ["zori/State_zori_uc_sfrcondomfr_sm_month.csv", "zori/State_zori_uc_sfrcondomfr_sm_sa_month.csv"],
}
_discovered: list[str] | None = None


def discover_zillow() -> list[str]:
    """CSV links listed on Zillow's research data page, used when a known path moves."""
    global _discovered
    if _discovered is None:
        r = get("https://www.zillow.com/research/data/", tries=1)
        _discovered = sorted(set(re.findall(r"https://files\.zillowstatic\.com/research/public_csvs/[^\"'\s<>]+\.csv", r.text))) if r else []
        log(f"  found {len(_discovered)} CSV links on Zillow's data page")
    return _discovered


def zillow(key: str):
    """{RegionID: {name, type, state, rank, series: [(date, v)], cols}} for one metric."""
    paths = ZMETRICS[key]
    urls = [ZILLOW + p for p in paths]
    folder, fname = paths[0].split("/")
    level = fname.split("_")[0]  # Metro or State
    r = None
    for u in urls:
        r = get(u, tries=1, timeout=90)
        if r:
            break
    if not r:
        for u in discover_zillow():
            if f"/{folder}/{level}_" in u and "_uc_sfrcondo" in u:
                r = get(u, tries=1, timeout=90)
                if r:
                    break
    if not r:
        log("  Zillow failed", key)
        return {}
    rd = csv.reader(io.StringIO(r.content.decode("utf-8-sig")))
    head = next(rd)
    idx = {h: i for i, h in enumerate(head)}
    dates = [(i, parse_date(h)) for i, h in enumerate(head)]
    dates = [(i, d) for i, d in dates if d]
    out = {}
    for row in rd:
        if len(row) < len(head):
            continue
        s = [(d, num(row[i])) for i, d in dates]
        s = [(d, v) for d, v in s if v is not None]
        out[row[idx["RegionID"]]] = {
            "name": row[idx["RegionName"]], "type": row[idx.get("RegionType", 3)].lower(),
            "state": row[idx["StateName"]] if "StateName" in idx else "",
            "rank": int(num(row[idx["SizeRank"]]) or 9999), "series": s,
            "base": row[idx["BaseDate"]] if "BaseDate" in idx else None,
        }
    log(f"  Zillow {key}: {len(out)} regions")
    return out


def ascii_slug(*parts):
    import unicodedata
    s = unicodedata.normalize("NFKD", " ".join(parts)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def thin(series, years=HIST_YEARS):
    cut = date(NOW.year - years, NOW.month, 1)
    return [[d.strftime("%Y-%m"), rnd(v, 4 if v < 10 else 0)] for d, v in series if d >= cut]


def build_us():
    Z = {k: zillow(k) for k in ZMETRICS if not k.startswith("st_")}
    zhvi = Z.get("zhvi") or {}
    markets, hist = [], {}
    nation = None
    rows = sorted(zhvi.items(), key=lambda kv: kv[1]["rank"])
    for rid, z in rows:
        if z["type"] not in ("msa", "country"):
            continue
        is_us = z["type"] == "country"
        # The biggest US_MARKETS metros, plus the biggest metro of any state they leave out (so every state can be looked up)
        if not is_us and len([m for m in markets if m["id"] != "us"]) >= US_MARKETS and z["state"] in {m["region"] for m in markets}:
            continue
        s = z["series"]
        if len(s) < 13:
            continue
        get_last = lambda k: (Z.get(k, {}).get(rid) or {}).get("series") or []
        zori, inv, newl, mlp, msp = get_last("zori"), get_last("inv"), get_last("newl"), get_last("mlp"), get_last("msp")
        dtp, cut, stl, heat = get_last("dtp"), get_last("cut"), get_last("stl"), get_last("heat")
        fcrow = Z.get("fc", {}).get(rid)
        v = s[-1][1]
        rent = zori[-1][1] if zori else None
        name = "United States" if is_us else z["name"]
        city = name.rsplit(",", 1)[0]
        mid = "us" if is_us else "us-" + ascii_slug(name)
        last = lambda ser: ser[-1][1] if ser else None
        m = {
            "id": mid, "c": "US", "name": city, "full": name, "region": z["state"] if not is_us else "",
            "rank": z["rank"], "cur": "USD",
            "asof": s[-1][0].strftime("%Y-%m"),
            "v": rnd(v, 0), "v1m": rnd(pct(v, at(s, 1))), "v3m": rnd(pct(v, at(s, 3))), "v1y": rnd(pct(v, at(s, 12))),
            "v5y": rnd(pct(v, at(s, 60))), "v10y": rnd(pct(v, at(s, 120))),
            "peak": rnd(max(x for _, x in s), 0),
            "rent": rnd(rent, 0), "rent1y": rnd(pct(rent, at(zori, 12))) if zori else None,
            "yield": rnd(rent * 12 / v * 100) if rent and v else None,
            "inv": rnd(last(inv), 0), "inv1y": rnd(pct(last(inv), at(inv, 12))) if inv else None,
            "newl": rnd(last(newl), 0), "newl1y": rnd(pct(last(newl), at(newl, 12))) if newl else None,
            "mlp": rnd(last(mlp), 0), "msp": rnd(last(msp), 0),
            "dtp": rnd(last(dtp), 0), "dtp1y": rnd(last(dtp) - at(dtp, 12), 0) if dtp and at(dtp, 12) is not None else None,
            "cut": rnd(last(cut) * 100 if last(cut) is not None and last(cut) <= 1 else last(cut), 1),
            "stl": rnd(last(stl), 4),
            "heat": rnd(last(heat), 0),
            "fc": rnd(fcrow["series"][-1][1], 1) if fcrow and fcrow["series"] else None,
            "spark": [rnd(x, 0) for _, x in s[-24:]],
        }
        if m["peak"] and v:
            m["offPeak"] = rnd(pct(v, m["peak"]))
        markets.append(m)
        hist[mid] = {"v": thin(s), "rent": thin(zori), "inv": thin(inv), "dtp": thin(dtp)}
        if is_us:
            nation = m
    log(f"US markets: {len(markets)}")
    return markets, hist, nation


# ---------------------------------------------------------------- Canada
PROVINCES = {"Newfoundland and Labrador": "NL", "Prince Edward Island": "PE", "Nova Scotia": "NS", "New Brunswick": "NB",
             "Quebec": "QC", "Ontario": "ON", "Manitoba": "MB", "Saskatchewan": "SK", "Alberta": "AB",
             "British Columbia": "BC", "Yukon": "YT", "Northwest Territories": "NT", "Nunavut": "NU"}
ATLANTIC = "Atlantic Region"
PRAIRIE = "Prairie Region"


def statcan_table(pid: str):
    r = get(f"https://www150.statcan.gc.ca/n1/tbl/csv/{pid}-eng.zip", timeout=180)
    if not r:
        log("  StatCan failed", pid)
        return []
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        name = next(n for n in z.namelist() if n.endswith(".csv") and "MetaData" not in n)
        with z.open(name) as f:
            return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


def geo_key(g: str) -> str:
    g = re.sub(r"\((CMA|CA)\)", "", g)
    return re.sub(r"\s+", " ", g.split(",")[0]).strip().lower()


def province_of(g: str) -> str:
    """Province code for a StatCan place name; the first one named wins (Ottawa-Gatineau, Ontario part)."""
    hits = [(g.find(p), code) for p, code in PROVINCES.items() if p in g.split(",", 1)[-1]]
    return min(hits)[1] if hits else ""


def bank_of_canada(series: str):
    r = get(f"https://www.bankofcanada.ca/valet/observations/{series}/json?start_date={NOW.year - HIST_YEARS}-01-01")
    if not r:
        log("  Bank of Canada failed", series)
        return []
    out = []
    for o in r.json().get("observations", []):
        d, v = parse_date(o.get("d", "")), num((o.get(series) or {}).get("v"))
        if d and v is not None:
            out.append((d, v))
    return out


PROVINCE_ROWS: list[dict] = []


def build_canada():
    markets, hist = [], {}
    nhpi = statcan_table("18100205")
    by = {}
    for row in nhpi:
        kind = row.get("New housing price indexes", "")
        if not kind.startswith("Total"):
            continue
        d, v = parse_date(row["REF_DATE"]), num(row["VALUE"])
        if d and v is not None:
            by.setdefault(row["GEO"], []).append((d, v))
    rents = {}
    try:
        rent_rows = statcan_table("34100133")
    except Exception as e:  # noqa: BLE001
        log("  CMHC rents failed", e)
        rent_rows = []
    for row in rent_rows:
        unit = row.get("Type of unit", "")
        struct = row.get("Type of structure", "")
        if "Two bedroom" not in unit or ("Row and apartment" not in struct and struct):
            continue
        d, v = parse_date(row["REF_DATE"]), num(row["VALUE"])
        if d and v is not None:
            rents.setdefault(geo_key(row["GEO"]), []).append((d, v))
    national = None
    for geo, s in by.items():
        s.sort()
        if len(s) < 13:
            continue
        is_ca = geo == "Canada"
        if not is_ca and (geo in PROVINCES or geo in (ATLANTIC, PRAIRIE)):
            if geo in PROVINCES:  # kept for the by-province chart
                v = s[-1][1]
                rs = sorted(rents.get(geo_key(geo), []))
                PROVINCE_ROWS.append({
                    "code": PROVINCES[geo], "name": geo, "asof": s[-1][0].strftime("%Y-%m"), "idx": rnd(v, 1),
                    "v1y": rnd(pct(v, at(s, 12))), "v5y": rnd(pct(v, at(s, 60))), "offPeak": rnd(pct(v, max(x for _, x in s))),
                    "rent": rnd(rs[-1][1], 0) if rs else None,
                    "rent1y": rnd(pct(rs[-1][1], rs[-2][1])) if len(rs) >= 2 else None,
                })
            continue
        v = s[-1][1]
        city = "Canada" if is_ca else re.sub(r"\s*\(.*\)", "", geo.split(",")[0]).strip()
        rs = sorted(rents.get(geo_key(geo), []))
        mid = "ca" if is_ca else "ca-" + ascii_slug(city)
        if " part" in geo:  # Ottawa-Gatineau is split into its Ontario and Quebec parts
            part = geo.split(",")[1].strip()
            city, mid = f"{city} ({part})", mid + "-" + province_of(geo).lower()
        m = {
            "id": mid, "c": "CA", "name": city, "full": geo, "region": "" if is_ca else province_of(geo), "cur": "CAD",
            "asof": s[-1][0].strftime("%Y-%m"),
            "idx": rnd(v, 1), "v1m": rnd(pct(v, at(s, 1))), "v3m": rnd(pct(v, at(s, 3))), "v1y": rnd(pct(v, at(s, 12))),
            "v5y": rnd(pct(v, at(s, 60))), "v10y": rnd(pct(v, at(s, 120))),
            "peak": rnd(max(x for _, x in s), 1),
            "rent": rnd(rs[-1][1], 0) if rs else None,
            "rent1y": rnd(pct(rs[-1][1], rs[-2][1])) if len(rs) >= 2 else None,
            "rentYear": rs[-1][0].year if rs else None,
            "spark": [rnd(x, 1) for _, x in s[-24:]],
        }
        m["offPeak"] = rnd(pct(v, m["peak"]))
        markets.append(m)
        hist[mid] = {"idx": thin(s), "rent": [[str(d.year), rnd(x, 0)] for d, x in rs]}
        if is_ca:
            national = m
    log(f"Canada markets: {len(markets)}")
    return markets, hist, national


# ---------------------------------------------------------------- Mexico
def build_mexico():
    meta = json.loads((SRC / "mexico_shf_meta.json").read_text(encoding="utf-8"))
    markets = []
    with open(SRC / "mexico_shf.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            m = {
                "id": "mx-" + ascii_slug(row["state"]), "c": "MX", "name": row["state"], "full": row["state"] + ", Mexico",
                "region": row["code"], "cur": "MXN", "asof": meta["period"],
                "v": num(row["avg_price"]), "q1": num(row["q1"]), "median": num(row["median"]), "q3": num(row["q3"]),
                "priceRank": int(row["price_rank"]), "v1y": num(row["yoy"]),
            }
            markets.append(m)
    nat = {"id": "mx", "c": "MX", "name": "Mexico", "full": "Mexico", "region": "", "cur": "MXN", "asof": meta["period"],
           "v": meta["national"]["avg_price"], "median": meta["national"]["median"], "q1": meta["national"]["q1"],
           "q3": meta["national"]["q3"], "v1y": meta["national"]["yoy"]}
    for z in meta.get("metros", []):
        for m in markets:
            if m["region"] == z["state"]:
                m["metroYoy"] = {"name": z["name"], "yoy": z["yoy"]}
    log(f"Mexico markets: {len(markets)}")
    return [nat] + markets, meta


# ---------------------------------------------------------------- US states (for the by-state chart)
US_STATES = {"Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
             "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI",
             "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
             "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
             "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ",
             "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
             "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
             "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
             "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"}


def build_states():
    """Typical home value and rent for every US state, from Zillow's state files."""
    zh, zr = zillow("st_zhvi"), zillow("st_zori")
    rent_by = {z["name"]: z["series"] for z in zr.values()}
    out = []
    for z in zh.values():
        code = US_STATES.get(z["name"])
        s = z["series"]
        if not code or len(s) < 13:
            continue
        v = s[-1][1]
        rs = rent_by.get(z["name"]) or []
        rent = rs[-1][1] if rs else None
        out.append({
            "code": code, "name": z["name"], "asof": s[-1][0].strftime("%Y-%m"), "v": rnd(v, 0),
            "v1y": rnd(pct(v, at(s, 12))), "v5y": rnd(pct(v, at(s, 60))), "v10y": rnd(pct(v, at(s, 120))),
            "offPeak": rnd(pct(v, max(x for _, x in s))),
            "rent": rnd(rent, 0), "rent1y": rnd(pct(rent, at(rs, 12))) if rs else None,
            "yield": rnd(rent * 12 / v * 100) if rent and v else None,
            "spark": [rnd(x, 0) for _, x in s[-24:]],
        })
    log(f"US states: {len(out)}")
    return sorted(out, key=lambda x: x["name"])


# ---------------------------------------------------------------- world house prices (BIS, with OECD valuations)
# ISO code: (name, region, ISO3). Aggregates are kept as benchmarks only.
WORLD = {
    "US": ("United States", "Americas", "USA"), "CA": ("Canada", "Americas", "CAN"), "MX": ("Mexico", "Americas", "MEX"),
    "BR": ("Brazil", "Americas", "BRA"), "CL": ("Chile", "Americas", "CHL"), "CO": ("Colombia", "Americas", "COL"),
    "PE": ("Peru", "Americas", "PER"), "AR": ("Argentina", "Americas", "ARG"),
    "GB": ("United Kingdom", "Europe", "GBR"), "IE": ("Ireland", "Europe", "IRL"), "FR": ("France", "Europe", "FRA"),
    "DE": ("Germany", "Europe", "DEU"), "NL": ("Netherlands", "Europe", "NLD"), "BE": ("Belgium", "Europe", "BEL"),
    "LU": ("Luxembourg", "Europe", "LUX"), "CH": ("Switzerland", "Europe", "CHE"), "AT": ("Austria", "Europe", "AUT"),
    "IT": ("Italy", "Europe", "ITA"), "ES": ("Spain", "Europe", "ESP"), "PT": ("Portugal", "Europe", "PRT"),
    "GR": ("Greece", "Europe", "GRC"), "MT": ("Malta", "Europe", "MLT"), "CY": ("Cyprus", "Europe", "CYP"),
    "DK": ("Denmark", "Europe", "DNK"), "SE": ("Sweden", "Europe", "SWE"), "NO": ("Norway", "Europe", "NOR"),
    "FI": ("Finland", "Europe", "FIN"), "IS": ("Iceland", "Europe", "ISL"), "EE": ("Estonia", "Europe", "EST"),
    "LV": ("Latvia", "Europe", "LVA"), "LT": ("Lithuania", "Europe", "LTU"), "PL": ("Poland", "Europe", "POL"),
    "CZ": ("Czechia", "Europe", "CZE"), "SK": ("Slovakia", "Europe", "SVK"), "SI": ("Slovenia", "Europe", "SVN"),
    "HU": ("Hungary", "Europe", "HUN"), "HR": ("Croatia", "Europe", "HRV"), "RO": ("Romania", "Europe", "ROU"),
    "BG": ("Bulgaria", "Europe", "BGR"), "RS": ("Serbia", "Europe", "SRB"), "MK": ("North Macedonia", "Europe", "MKD"),
    "RU": ("Russia", "Europe", "RUS"), "TR": ("Türkiye", "Europe", "TUR"),
    "JP": ("Japan", "Asia-Pacific", "JPN"), "KR": ("South Korea", "Asia-Pacific", "KOR"), "CN": ("China", "Asia-Pacific", "CHN"),
    "HK": ("Hong Kong", "Asia-Pacific", "HKG"), "TW": ("Taiwan", "Asia-Pacific", "TWN"), "SG": ("Singapore", "Asia-Pacific", "SGP"),
    "MY": ("Malaysia", "Asia-Pacific", "MYS"), "TH": ("Thailand", "Asia-Pacific", "THA"), "ID": ("Indonesia", "Asia-Pacific", "IDN"),
    "PH": ("Philippines", "Asia-Pacific", "PHL"), "IN": ("India", "Asia-Pacific", "IND"), "AU": ("Australia", "Asia-Pacific", "AUS"),
    "NZ": ("New Zealand", "Asia-Pacific", "NZL"),
    "IL": ("Israel", "Middle East & Africa", "ISR"), "AE": ("United Arab Emirates", "Middle East & Africa", "ARE"),
    "SA": ("Saudi Arabia", "Middle East & Africa", "SAU"), "ZA": ("South Africa", "Middle East & Africa", "ZAF"),
    "MA": ("Morocco", "Middle East & Africa", "MAR"),
    "XM": ("Euro area", "Benchmark", None),
}
ISO3 = {v[2]: k for k, v in WORLD.items() if v[2]}
# Shown in the tables but left out of the investor score
NOT_INVESTABLE = {"RU": "Under international sanctions: most foreign investors can't buy or move money out"}


def sdmx_csv(url: str, timeout=120) -> list[dict]:
    r = get(url, tries=2, timeout=timeout, headers=BROWSER)
    if not r:
        return []
    rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    log(f"  {len(rows)} rows, columns {list(rows[0].keys())[:12] if rows else []}")
    return rows


def qdate(p: str) -> date | None:
    m = re.match(r"(\d{4})-Q(\d)$", p or "")
    if m:
        return date(int(m.group(1)), int(m.group(2)) * 3 - 2, 1)
    m = re.match(r"(\d{4})-(\d{2})", p or "")
    return date(int(m.group(1)), int(m.group(2)), 1) if m else None


def bis_bulk(flow: str, key: str, start: str, dims: list[str]) -> dict[tuple, list]:
    """{(dim values...): [(date, v)]} for a whole BIS dataflow in one request, DBnomics as a backup."""
    out: dict[tuple, list] = {}
    rows = sdmx_csv(f"https://stats.bis.org/api/v1/data/{flow}/{key}/all?detail=dataonly&format=csv&startPeriod={start}")
    for row in rows:
        k = tuple(row.get(d, "") for d in dims)
        d, v = qdate(row.get("TIME_PERIOD", "")), num(row.get("OBS_VALUE"))
        if d and v is not None and all(k):
            out.setdefault(k, []).append((d, v))
    if not out:
        log(f"  BIS {flow} empty, trying DBnomics")
        offset = 0
        while offset < 5000 and time.time() < DEADLINE:
            r = get(f"https://api.db.nomics.world/v22/series/BIS/{flow}?observations=1&format=json&limit=500&offset={offset}", tries=2, timeout=120)
            docs = (((r.json() if r else {}).get("series") or {}).get("docs")) or []
            for doc in docs:
                code = doc.get("series_code", "")
                parts = code.split(".")
                want = key.split(".")
                if len(parts) != len(want) or any(w and p not in w.split("+") for p, w in zip(parts, want)):
                    continue
                k = tuple(parts[1:1 + len(dims) - 1]) if False else tuple(dict(zip(["FREQ"] + dims[1:], parts)).get(d, "") for d in dims)
                for p, v in zip(doc.get("period") or [], doc.get("value") or []):
                    d, v = qdate(str(p)), num(v)
                    if d and v is not None and str(p) >= start[:4]:
                        out.setdefault(k, []).append((d, v))
            if len(docs) < 500:
                break
            offset += 500
    for k in out:
        out[k].sort()
    log(f"  BIS {flow}: {len(out)} series")
    return out


def oecd_valuation() -> dict[str, dict]:
    """Price-to-income and price-to-rent ratios against each country's long-run average (100 = average),
    from the OECD's analytical house price database."""
    rows = sdmx_csv("https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,1.0/all"
                    "?startPeriod=2018-Q1&dimensionAtObservation=AllDimensions&format=csvfilewithlabels", timeout=150)
    seen, out = {}, {}
    for row in rows:
        meas = row.get("MEASURE", "")
        seen[meas] = row.get("Measure", "")
        c = ISO3.get(row.get("REF_AREA", ""))
        d, v = qdate(row.get("TIME_PERIOD", "")), num(row.get("OBS_VALUE"))
        if not c or not d or v is None or (row.get("FREQ") and row.get("FREQ") != "Q"):
            continue
        # The standardised ratios compare today with each country's own long-run average (= 100)
        key = "pti" if meas == "HPI_YDH_AVG" else "ptr" if meas == "HPI_RPI_AVG" else None
        if key:
            out.setdefault(c, {}).setdefault(key, []).append((d, v))
    log(f"  OECD measures: {seen}")
    res = {}
    for c, m in out.items():
        res[c] = {}
        for k, s in m.items():
            s.sort()
            res[c][k] = rnd(s[-1][1], 1)
            res[c][k + "At"] = f"{s[-1][0].year}-Q{(s[-1][0].month - 1) // 3 + 1}"
    log(f"  OECD valuations for {len(res)} countries")
    return res


def qat(s, quarters_back):
    """Value quarters_back quarters before the last point of a quarterly series."""
    return at(s, quarters_back * 3)


def cagr(a, b, years):
    return None if a is None or not b or a <= 0 or b <= 0 else ((a / b) ** (1 / years) - 1) * 100


def build_world():
    """Every country in the BIS residential property price database, with real prices, prices in US dollars,
    central bank rates and (where the OECD has them) valuation ratios, plus an investor score."""
    spp = bis_bulk("WS_SPP", "Q..N+R.628", "1990-Q1", ["FREQ", "REF_AREA", "VALUE", "UNIT_MEASURE"])
    if not spp:
        return None, {}
    pol = bis_bulk("WS_CBPOL", "M.", "2012-01", ["FREQ", "REF_AREA"]) if time.time() < DEADLINE else {}
    xru = bis_bulk("WS_XRU", "M...A", "1999-01", ["FREQ", "REF_AREA", "CURRENCY", "COLLECTION"]) if time.time() < DEADLINE else {}
    val = safe_call(oecd_valuation, {}) if time.time() < DEADLINE else {}
    # Policy rates: euro area members use the ECB rate
    # A policy rate series that stopped updating (Croatia's after it joined the euro) is dropped
    rate = {k[1]: s for k, s in pol.items() if s and (NOW.date() - s[-1][0]).days < 200}
    euro = {"AT", "BE", "BG", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"}
    # Exchange rates (national currency per US dollar): the series with the latest data for each country
    fx = {}
    for (f, c, cur, coll), s in xru.items():
        if s and (c not in fx or s[-1][0] > fx[c][-1][0] or (s[-1][0] == fx[c][-1][0] and len(s) > len(fx[c]))):
            fx[c] = s
    countries, hist = [], {}
    for (f, c, kind, unit), s in spp.items():
        if kind != "N" or c not in WORLD:
            continue
        name, region, _ = WORLD[c]
        sr = spp.get((f, c, "R", unit), [])
        if len(s) < 9:
            continue
        v, vr = s[-1][1], (sr[-1][1] if sr else None)
        last = s[-1][0]
        # Prices in US dollars: the nominal index divided by the quarter's average exchange rate
        usd = []
        if c == "US":
            usd = list(s)
        elif c in fx or (c in euro and "XM" in fx):
            fxq = {}
            for d, x in fx.get(c) or fx.get("XM"):
                fxq.setdefault(date(d.year, (d.month - 1) // 3 * 3 + 1, 1), []).append(x)
            usd = [(d, x / (sum(fxq[d]) / len(fxq[d]))) for d, x in s if fxq.get(d)]
        pr = (rate.get("XM") if c in euro else None) or rate.get(c) or []
        stale = (NOW.date() - last).days > 550
        row = {
            "code": c, "name": name, "region": region, "asof": f"{last.year}-Q{(last.month - 1) // 3 + 1}", "stale": stale,
            "note": NOT_INVESTABLE.get(c),
            "agg": region == "Benchmark",
            "n1y": rnd(pct(v, qat(s, 4))), "n5y": rnd(pct(v, qat(s, 20))), "n10y": rnd(pct(v, qat(s, 40))),
            "r1y": rnd(pct(vr, qat(sr, 4))) if sr else None, "r5y": rnd(pct(vr, qat(sr, 20))) if sr else None,
            "r10y": rnd(pct(vr, qat(sr, 40))) if sr else None,
            "rCagr10": rnd(cagr(vr, qat(sr, 40), 10)) if sr else None,
            "rOffPeak": rnd(pct(vr, max(x for _, x in sr))) if sr else None,
            "nOffPeak": rnd(pct(v, max(x for _, x in s))),
            "usd1y": rnd(pct(usd[-1][1], qat(usd, 4))) if len(usd) > 5 else None,
            "usd5y": rnd(pct(usd[-1][1], qat(usd, 20))) if len(usd) > 21 else None,
            "accel": rnd((pct(v, qat(s, 4)) or 0) - (pct(qat(s, 4), qat(s, 8)) or 0)) if qat(s, 8) else None,
            "rate": rnd(pr[-1][1], 2) if pr else None, "rate1y": rnd(pr[-1][1] - (at(pr, 12) or pr[-1][1]), 2) if pr else None,
            "fx1y": rnd(-pct(fx[c][-1][1], at(fx[c], 12))) if c in fx and at(fx[c], 12) else (0.0 if c == "US" else None),
            "spark": [rnd(x, 1) for _, x in (sr or s)[-20:]],
            **(val.get(c) or {}),
        }
        # Calendar-year real (or nominal) change for the heat table: last quarter of each year on the year before
        yrs = {}
        base = sr or s
        by_year = {}
        for d, x in base:
            by_year[d.year] = x  # last quarter seen in each year
        for y in range(last.year - 10, last.year + 1):
            if y in by_year and y - 1 in by_year:
                yrs[str(y)] = rnd(pct(by_year[y], by_year[y - 1]), 1)
        row["years"] = yrs
        row["yearsReal"] = bool(sr)
        countries.append(row)
        cut = date(2000, 1, 1)
        hist[c] = {"n": [[d.strftime("%Y-%m"), rnd(x, 2)] for d, x in s if d >= cut],
                   "r": [[d.strftime("%Y-%m"), rnd(x, 2)] for d, x in sr if d >= cut],
                   "u": [[d.strftime("%Y-%m"), rnd(x, 4)] for d, x in usd if d >= cut]}
    score_world(countries)
    log(f"World: {len(countries)} countries")
    return {"countries": sorted(countries, key=lambda x: -(x.get("score") or -1)), "updated": NOW.isoformat(timespec="seconds")}, hist


def safe_call(fn, fallback):
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        log(f"  {fn.__name__} failed: {e!r}")
        return fallback


def score_world(rows):
    """Investor score, 0 to 100: where each country ranks on momentum, long-run growth, value, rates and currency,
    against the other countries with current data. Missing parts are left out and the rest reweighted."""
    live = [r for r in rows if not r["stale"] and not r["agg"] and not r.get("note")]
    parts = [
        ("momentum", 0.30, lambda r: r.get("r1y"), 1, "Real prices rising"),
        ("growth", 0.20, lambda r: r.get("rCagr10"), 1, "Strong 10-year real growth"),
        ("value", 0.25, lambda r: r.get("pti") if r.get("pti") is not None else r.get("rOffPeak"), 0, "Good value"),
        ("rates", 0.15, lambda r: r.get("rate1y"), -1, "Interest rates falling"),
        ("currency", 0.10, lambda r: r.get("fx1y"), 1, "Currency firming vs US$"),
    ]
    for key, w, fn, sign, why in parts:
        if key == "value":
            # Low price-to-income is good value; with no OECD ratio, prices well below their real peak count as value.
            pti = sorted(r["pti"] for r in live if r.get("pti") is not None)
            off = sorted(r["rOffPeak"] for r in live if r.get("rOffPeak") is not None)
            for r in live:
                if r.get("pti") is not None and len(pti) > 3:
                    r.setdefault("_p", {})[key] = 1 - pti.index(r["pti"]) / (len(pti) - 1)
                elif r.get("rOffPeak") is not None and len(off) > 3:
                    r.setdefault("_p", {})[key] = 1 - off.index(r["rOffPeak"]) / (len(off) - 1)
            continue
        vals = sorted(fn(r) * sign for r in live if fn(r) is not None)
        for r in live:
            x = fn(r)
            if x is not None and len(vals) > 3:
                r.setdefault("_p", {})[key] = vals.index(x * sign) / (len(vals) - 1)
    labels = {k: why for k, _, _, _, why in parts}
    weights = {k: w for k, w, _, _, _ in parts}
    for r in live:
        p = r.pop("_p", {})
        if len(p) < 2:
            continue
        tw = sum(weights[k] for k in p)
        r["score"] = round(sum(weights[k] * v for k, v in p.items()) / tw * 100)
        r["parts"] = {k: round(v * 100) for k, v in p.items()}
        r["why"] = [labels[k] for k, v in sorted(p.items(), key=lambda kv: -kv[1]) if v >= 0.7][:3]
        r["watch"] = [{"momentum": "Real prices falling", "growth": "Weak long-run growth", "value": "Expensive",
                       "rates": "Rates rising", "currency": "Currency weakening vs US$"}[k]
                      for k, v in sorted(p.items(), key=lambda kv: kv[1]) if v <= 0.25][:2]


# ---------------------------------------------------------------- scores and picks
def clamp(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


def us_signals(m):
    """Who has the upper hand, from -100 (strong buyer's market) to +100 (strong seller's market)."""
    parts = []
    if m.get("heat") is not None:
        parts.append(clamp((m["heat"] - 50) / 30))         # Zillow's own heat index, 50 = neutral
    if m.get("stl") is not None:
        parts.append(clamp((m["stl"] - 0.99) / 0.02))      # selling above list = seller's market
    if m.get("cut") is not None:
        parts.append(clamp((22 - m["cut"]) / 12))          # many price cuts = buyer's market
    if m.get("dtp") is not None:
        parts.append(clamp((35 - m["dtp"]) / 25))          # quick sales = seller's market
    if m.get("inv1y") is not None:
        parts.append(clamp(-m["inv1y"] / 25))              # rising supply favours buyers
    if m.get("v3m") is not None:
        parts.append(clamp(m["v3m"] / 2))
    if not parts:
        return None
    return round(sum(parts) / len(parts) * 100)


def label(score):
    if score is None:
        return None
    if score >= 35:
        return "Seller's market"
    if score >= 10:
        return "Leans seller's"
    if score > -10:
        return "Balanced"
    if score > -35:
        return "Leans buyer's"
    return "Buyer's market"


def picks(us, ca, mx):
    """Rules-based ideas, the real estate version of the stock site's buy ideas. Not advice."""
    metros = [m for m in us if m["id"] != "us"]
    for m in metros:
        m["score"] = us_signals(m)
        m["side"] = label(m["score"])
    # Value for buyers: buyer's market, prices off peak, good rent cover
    def buy_score(m):
        s = 0
        if m.get("score") is not None:
            s += -m["score"] / 100 * 40
        if m.get("yield") is not None:
            s += clamp((m["yield"] - 6) / 3) * 30
        if m.get("fc") is not None:
            s += clamp(m["fc"] / 3) * 20
        if m.get("offPeak") is not None:
            s += clamp(-m["offPeak"] / 10) * 10
        return s
    for m in metros:
        m["buy"] = round(buy_score(m), 1)
    reasons = lambda m: [r for r in [
        m.get("side") and f"{m['side']} (score {m['score']:+d})",
        m.get("yield") is not None and f"gross rent yield {m['yield']:.1f}%",
        m.get("cut") is not None and f"{m['cut']:.0f}% of listings cut their price",
        m.get("dtp") is not None and f"{m['dtp']:.0f} days to pending",
        m.get("fc") is not None and f"Zillow forecasts {m['fc']:+.1f}% over 12 months",
        m.get("offPeak") is not None and m["offPeak"] < -1 and f"{-m['offPeak']:.1f}% below its peak",
    ] if r]
    big = [m for m in metros if m["rank"] <= 100]
    buy = sorted(big, key=lambda m: -m["buy"])[:10]
    # Watch: biggest turn in the last 3 months against the last year, or supply jumps
    def turn(m):
        if m.get("v3m") is None or m.get("v1y") is None:
            return 0
        return abs(m["v3m"] * 4 - m["v1y"])
    watch = sorted(big, key=lambda m: -(turn(m) + abs(m.get("inv1y") or 0) / 5))[:10]
    def watch_why(m):
        w = []
        if m.get("v3m") is not None and m.get("v1y") is not None:
            ann = m["v3m"] * 4
            if ann > m["v1y"] + 1:
                w.append(f"prices firming: {m['v3m']:+.1f}% in 3 months vs {m['v1y']:+.1f}% over the year")
            elif ann < m["v1y"] - 1:
                w.append(f"prices cooling: {m['v3m']:+.1f}% in 3 months vs {m['v1y']:+.1f}% over the year")
        if m.get("inv1y") is not None and abs(m["inv1y"]) >= 10:
            w.append(f"homes for sale {m['inv1y']:+.0f}% on a year ago")
        if m.get("dtp1y") is not None and abs(m["dtp1y"]) >= 5:
            w.append(f"days to pending {m['dtp1y']:+.0f} on a year ago")
        return w
    out = {
        "buy": [{"id": m["id"], "why": reasons(m)[:4]} for m in buy],
        "watch": [{"id": m["id"], "why": watch_why(m)} for m in watch],
    }
    # Canada: fastest and slowest new-home prices
    cmas = [m for m in ca if m["id"] != "ca" and m.get("v1y") is not None]
    out["caUp"] = [m["id"] for m in sorted(cmas, key=lambda m: -m["v1y"])[:5]]
    out["caDown"] = [m["id"] for m in sorted(cmas, key=lambda m: m["v1y"])[:5]]
    return out


# ---------------------------------------------------------------- listings
LISTING_CITIES = [  # one RentCast request each, once a week
    ("New York", "NY"), ("Los Angeles", "CA"), ("Chicago", "IL"), ("Dallas", "TX"), ("Houston", "TX"),
    ("Miami", "FL"), ("Atlanta", "GA"), ("Phoenix", "AZ"), ("Seattle", "WA"), ("Denver", "CO"),
]
SAMPLE_CITIES = [
    # (market id, city, region, country, currency, typical price, link-out search sites)
    ("us-new-york-ny", "New York", "NY", "US", "USD", 690000), ("us-los-angeles-ca", "Los Angeles", "CA", "US", "USD", 960000),
    ("us-dallas-tx", "Dallas", "TX", "US", "USD", 370000), ("us-miami-fl", "Miami", "FL", "US", "USD", 480000),
    ("us-phoenix-az", "Phoenix", "AZ", "US", "USD", 450000), ("us-seattle-wa", "Seattle", "WA", "US", "USD", 760000),
    ("ca-toronto", "Toronto", "ON", "CA", "CAD", 1050000), ("ca-vancouver", "Vancouver", "BC", "CA", "CAD", 1180000),
    ("ca-calgary", "Calgary", "AB", "CA", "CAD", 590000), ("ca-montreal", "Montréal", "QC", "CA", "CAD", 560000),
    ("ca-ottawa-gatineau-on", "Ottawa", "ON", "CA", "CAD", 650000),
    ("mx-ciudad-de-mexico", "Mexico City", "CDMX", "MX", "MXN", 4285135), ("mx-jalisco", "Guadalajara", "JAL", "MX", "MXN", 2107232),
    ("mx-nuevo-leon", "Monterrey", "NL", "MX", "MXN", 2042664), ("mx-quintana-roo", "Cancún", "QROO", "MX", "MXN", 1991230),
    ("mx-queretaro", "Querétaro", "QRO", "MX", "MXN", 2381522),
]
TYPES = ["Single Family", "Condo", "Townhouse"]
STREETS = ["Maple", "Oak", "Cedar", "Lakeview", "Park", "Hillside", "River", "Sunset", "Willow", "Birch", "Elm", "Harbour"]


RENTCAST_CAP = 40         # requests in any 31 days; the free plan allows 50 per billing month, so this never bills
RENTCAST_WINDOW = timedelta(days=31)


def rentcast():
    """Real US listings from RentCast, at most once a week and never more than RENTCAST_CAP requests in any
    31 days (a rolling window, so it holds whatever day RentCast's billing month starts). Every request is
    logged in rentcast_usage.json before it is sent, whether it succeeds or not; the workflow refreshes that
    file from main before this runs and commits it back after, so the log survives between runs."""
    key = os.environ.get("RENTCAST_API_KEY", "").strip()
    saved = SRC / "listings.json"
    old = json.loads(saved.read_text()) if saved.exists() else None
    if not key:
        return old
    ledger_file = SRC / "rentcast_usage.json"
    try:
        ledger = json.loads(ledger_file.read_text())
    except (OSError, ValueError):
        ledger = {}
    reqs = list(ledger.get("requests") or [])
    if not reqs and ledger.get("used"):  # older format: a count for the month and the last fetch time
        reqs = [ledger.get("last_try") or NOW.isoformat(timespec="seconds")] * int(ledger.get("used"))
    reqs = [t for t in reqs if NOW - datetime.fromisoformat(t) < RENTCAST_WINDOW]
    ledger = {"requests": reqs, "cap": RENTCAST_CAP, "window_days": RENTCAST_WINDOW.days}
    last = max(reqs) if reqs else (old or {}).get("fetched")
    if last and NOW - datetime.fromisoformat(last) < timedelta(days=6, hours=12):
        log(f"  RentCast: last fetched {last}; waiting a week between fetches ({len(reqs)}/{RENTCAST_CAP} in the last 31 days)")
        ledger_file.write_text(json.dumps(ledger))
        return old
    if len(reqs) + len(LISTING_CITIES) > RENTCAST_CAP:
        log(f"  RentCast: {len(reqs)} requests in the last 31 days; skipping to stay under {RENTCAST_CAP}")
        ledger_file.write_text(json.dumps(ledger))
        return old
    items = []
    for n, (city, st) in enumerate(LISTING_CITIES):
        ledger["requests"].append(NOW.isoformat(timespec="seconds"))
        ledger_file.write_text(json.dumps(ledger))
        r = get(f"https://api.rentcast.io/v1/listings/sale?city={quote_plus(city)}&state={st}&status=Active&limit=40",
                tries=1, headers={"X-Api-Key": key, "Accept": "application/json"})
        if not r:
            log("  RentCast failed", city)
            if n == 0:
                log("  RentCast: first request failed (bad key or service down); not trying the other cities")
                break
            continue
        for x in r.json():
            if not x.get("price"):
                continue
            items.append({
                "id": x.get("id"), "city": x.get("city") or city, "region": x.get("state") or st, "c": "US", "cur": "USD",
                "addr": x.get("formattedAddress") or x.get("addressLine1"), "zip": x.get("zipCode"),
                "price": x.get("price"), "beds": x.get("bedrooms"), "baths": x.get("bathrooms"),
                "sqft": x.get("squareFootage"), "lot": x.get("lotSize"), "year": x.get("yearBuilt"),
                "type": x.get("propertyType"), "listed": (x.get("listedDate") or "")[:10], "dom": x.get("daysOnMarket"),
                "lat": x.get("latitude"), "lon": x.get("longitude"),
                "office": (x.get("listingOffice") or {}).get("name"), "mls": x.get("mlsName"), "sample": False,
            })
    log(f"  RentCast: {len(ledger['requests'])}/{RENTCAST_CAP} requests in the last 31 days")
    if not items:
        return old
    data = {"fetched": NOW.isoformat(timespec="seconds"), "source": "RentCast", "items": items}
    saved.write_text(json.dumps(data, separators=(",", ":")))
    log(f"  RentCast: {len(items)} listings")
    return data


def samples(have_real_us: bool, values: dict):
    """Clearly marked sample listings for markets without a free listings feed, priced near each market's typical value."""
    out = []
    for mid, city, region, c, cur, typical in SAMPLE_CITIES:
        if c == "US" and have_real_us:
            continue
        typical = values.get(mid) or typical
        rng = random.Random(hashlib.md5(f"{mid}{NOW.isocalendar()[1]}".encode()).hexdigest())
        for i in range(6):
            kind = rng.choice(TYPES if c != "MX" else ["Single Family", "Condo"])
            beds = rng.choice([1, 2, 2, 3, 3, 4]) if kind == "Condo" else rng.choice([2, 3, 3, 4, 4, 5])
            mult = (0.6 if kind == "Condo" else 1.0) * (0.75 + beds * 0.12) * rng.uniform(0.8, 1.25)
            price = round(typical * mult / (10000 if cur == "MXN" else 5000)) * (10000 if cur == "MXN" else 5000)
            sq = round((550 + beds * 260) * rng.uniform(0.85, 1.25) * (0.8 if kind == "Condo" else 1), -1)
            out.append({
                "id": f"sample-{mid}-{i}", "city": city, "region": region, "c": c, "cur": cur, "market": mid,
                "addr": f"{rng.randint(10, 990)} {rng.choice(STREETS)} {'St' if c != 'MX' else ''}".strip() if c != "MX" else f"Calle {rng.choice(STREETS)} {rng.randint(10, 990)}",
                "price": price, "beds": beds, "baths": max(1, beds - rng.choice([0, 1, 1])) + rng.choice([0, 0.5]),
                "sqft": sq, "year": rng.randint(1965, 2025), "type": kind,
                "dom": rng.randint(1, 75), "sample": True,
            })
    return out


# ---------------------------------------------------------------- news
NEWS = {
    "US": [('"housing market" OR "home prices" OR "home sales"', "en-US", "US", "US:en"), ('"mortgage rates"', "en-US", "US", "US:en")],
    "CA": [('"housing market" OR "home prices" OR "home sales" Canada', "en-CA", "CA", "CA:en"), ("CREA OR CMHC housing", "en-CA", "CA", "CA:en")],
    "MX": [('Mexico "real estate" OR "housing market" OR "home prices"', "en-US", "US", "US:en"),
           ('"mercado inmobiliario" OR "precios de vivienda" OR "crédito hipotecario" México', "es-419", "MX", "MX:es-419")],
}
# A headline must mention housing to be kept (search results drift off topic)
ON_TOPIC = re.compile(r"\bhousing\b|\bhomes?\b|home ?(buyer|owner|sale|price|value|builder)|mortgage|real estate|realtor|\brent(s|al|ers?)?\b|"
                      r"\bcondos?\b|propert(y|ies)|apartment|landlord|listings?\b|CMHC|CREA|"
                      r"vivienda|inmobiliari|hipotec|\bcasas?\b|departamento|\brentas?\b|bienes ra", re.I)


def news():
    out = {}
    for c, queries in NEWS.items():
        seen, items = set(), []
        for q, hl, gl, ceid in queries:
            r = get(f"https://news.google.com/rss/search?q={quote_plus(q + ' when:7d')}&hl={hl}&gl={gl}&ceid={ceid}", tries=2)
            if not r:
                continue
            try:
                root = ET.fromstring(r.content)
            except ET.ParseError:
                continue
            for it in root.iter("item"):
                title = (it.findtext("title") or "").strip()
                src = it.find("source")
                pub = src.text.strip() if src is not None and src.text else ""
                if pub and title.endswith(" - " + pub):
                    title = title[: -len(pub) - 3]
                key = re.sub(r"\W+", "", title.lower())[:60]
                if not title or key in seen or not ON_TOPIC.search(title) or (c == "MX" and "New Mexico" in title):
                    continue
                seen.add(key)
                try:
                    when = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc).isoformat()
                except Exception:  # noqa: BLE001
                    when = None
                items.append({"title": title, "url": it.findtext("link"), "src": pub, "at": when})
        items.sort(key=lambda x: x["at"] or "", reverse=True)
        out[c] = items[:15]
        log(f"  news {c}: {len(out[c])}")
    return out


# ---------------------------------------------------------------- main
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []

    def safe(name, fn, fallback):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            log(f"{name} failed: {e!r}")
            errors.append(name)
            return fallback

    us, us_hist, us_nat = safe("US", build_us, ([], {}, None))
    ca, ca_hist, ca_nat = safe("Canada", build_canada, ([], {}, None))
    mx, mx_meta = safe("Mexico", build_mexico, ([], {}))

    log("Rates and national series")
    rates = {}
    def series(fn, *a, monthly=False):
        s = safe("series " + str(a[0]), lambda: fn(*a), [])
        return weekly_to_monthly(s) if monthly else s
    # US mortgage rates straight from Freddie Mac's survey, FRED as a backup
    fm30, fm15 = safe("Freddie Mac", freddie_mac, ([], []))
    us30 = weekly_to_monthly(fm30) if fm30 else series(fred, "MORTGAGE30US", monthly=True)
    us15 = weekly_to_monthly(fm15) if fm15 else series(fred, "MORTGAGE15US", monthly=True)
    ca5, capol = series(bank_of_canada, "V80691335", monthly=True), series(bank_of_canada, "V39079", monthly=True)
    mxpol = series(fred, "IRSTCI01MXM156N")
    # Exchange rates from the Bank of Canada (USD/CAD, and MXN through CAD)
    usdcad, mxncad = series(bank_of_canada, "FXUSDCAD", monthly=True), series(bank_of_canada, "FXMXNCAD", monthly=True)
    cad = usdcad
    mxc = dict(mxncad)
    mxn = [(d, v / mxc[d]) for d, v in usdcad if mxc.get(d)]
    # BIS house price indexes: DBnomics first (fast), FRED as a backup
    def bis_series(c, kind):
        s = series(bis_api, f"Q.{c}.{kind}.628") or series(dbnomics, f"BIS/WS_SPP/Q.{c}.{kind}.628")
        return s or series(fred, f"Q{c}{kind}628BIS")
    bis = {c: bis_series(c, "N") for c in ("US", "CA", "MX")}
    bisr = {c: bis_series(c, "R") for c in ("US", "CA", "MX")}
    cs, mspus, houst = series(fred, "CSUSHPINSA"), series(fred, "MSPUS"), series(fred, "HOUST")
    rvac, own = series(fred, "RRVRUSQ156N"), series(fred, "RHORUSQ156N")

    def latest(s, nd=2, yoy=None):
        if not s:
            return None
        o = {"v": rnd(s[-1][1], nd), "at": s[-1][0].isoformat()}
        if yoy:
            o["chg"] = rnd(s[-1][1] - (at(s, yoy) or s[-1][1]), 2)
        return o
    rates = {
        "us30": latest(us30, yoy=12), "us15": latest(us15, yoy=12),
        "ca5": latest(ca5, yoy=12), "caPolicy": latest(capol, yoy=12), "mxRate": latest(mxpol, yoy=12),
        "cad": latest(cad, 4), "mxn": latest(mxn, 4),
    }
    countries = {}
    for c in ("US", "CA", "MX"):
        s, sr = bis[c], bisr[c]
        countries[c] = {
            "bis": rnd(pct(s[-1][1], at(s, 12))) if len(s) > 5 else None,
            "bisReal": rnd(pct(sr[-1][1], at(sr, 12))) if len(sr) > 5 else None,
            "bis5y": rnd(pct(s[-1][1], at(s, 60))) if len(s) > 21 else None,
            "bisAt": s[-1][0].isoformat() if s else None,
        }
    countries["US"].update({
        "caseShiller1y": rnd(pct(cs[-1][1], at(cs, 12))) if cs else None,
        "medianSale": latest(mspus, 0), "starts": latest(houst, 0), "rentVacancy": latest(rvac, 1), "ownRate": latest(own, 1),
        "nation": us_nat,
    })
    countries["CA"]["nation"] = ca_nat
    countries["MX"]["nation"] = mx[0] if mx else None
    countries["MX"]["shf"] = mx_meta

    idea = safe("picks", lambda: picks(us, ca, mx), {})
    log("US states and world markets")
    states = safe("US states", build_states, [])
    world, world_hist = safe("World", build_world, (None, {}))

    # Listings: real US ones when RentCast is set up, clearly marked samples otherwise
    rc = safe("RentCast", rentcast, None)
    real = (rc or {}).get("items") or []
    values = {m["id"]: m.get("v") for m in us + mx if m.get("v")}
    listings = {
        "fetched": (rc or {}).get("fetched"), "source": (rc or {}).get("source"),
        "items": real + samples(bool(real), values),
    }

    # Rough USD conversion for comparing markets side by side
    fx = {"USD": 1, "CAD": rates["cad"]["v"] if rates.get("cad") else None, "MXN": rates["mxn"]["v"] if rates.get("mxn") else None}

    data = {
        "updated": NOW.isoformat(timespec="seconds"),
        "countries": countries, "rates": rates, "fx": fx, "picks": idea,
        "markets": us + ca + mx, "errors": errors,
        "regions": {"US": states, "CA": PROVINCE_ROWS}, "world": world,
    }
    (OUT / "data.json").write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    # History: national series in hist.json, and one small file per market in hist/ (loaded only when charted)
    hist = {
        "rates": {"us30": thin(us30), "us15": thin(us15), "ca5": thin(ca5), "caPolicy": thin(capol), "mxRate": thin(mxpol)},
        "bis": {c: thin(s) for c, s in bis.items()}, "bisReal": {c: thin(s) for c, s in bisr.items()},
    }
    (OUT / "hist.json").write_text(json.dumps(hist, separators=(",", ":")))
    hdir = OUT / "hist"
    hdir.mkdir(exist_ok=True)
    for old in hdir.glob("*.json"):
        old.unlink()
    for mid, h in {**us_hist, **ca_hist}.items():
        (hdir / f"{mid}.json").write_text(json.dumps(h, separators=(",", ":")))
    (OUT / "world_hist.json").write_text(json.dumps(world_hist, separators=(",", ":")))
    (OUT / "listings.json").write_text(json.dumps(listings, separators=(",", ":"), ensure_ascii=False))
    (OUT / "news.json").write_text(json.dumps({"updated": NOW.isoformat(timespec="seconds"), "news": safe("news", news, {})},
                                              separators=(",", ":"), ensure_ascii=False))
    log(f"Wrote {len(data['markets'])} markets, {len(listings['items'])} listings; failed parts: {errors or 'none'}")


if __name__ == "__main__":
    main()
