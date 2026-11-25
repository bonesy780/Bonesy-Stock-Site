import csv, io, json, os, re, sys, zipfile, time
import requests
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept": "*/*"}
def g(u, t=30):
    try:
        t0 = time.time(); r = requests.get(u, headers=H, timeout=(10, t)); print("  t", round(time.time() - t0, 1), u[:90])
        return r
    except Exception as e:
        print("ERR", u, e); return None
key = os.environ.get("FRED_API_KEY", "")
print("FRED key set:", bool(key))
FRED = "DFEDTARU DFEDTARL DPRIME SOFR DGS5 DGS10 DBAA BAA MORTGAGE30US MORTGAGE15US OBMMIJUMBO30YF OBMMIC30YF OBMMIFHA30YF DRCRELEXFACBS SUBLPDRCSN SUBLPDRCSM SUBLPDRCSC COMREPUSQ159N TLRESCONS TLNRESCONS TLCOMCONS TLOFCONS TLLODGCONS TLMFGCONS TLHLTHCONS PRRESCONS PNRESCONS RRVRUSQ156N RHVRUSQ156N CUSR0000SEHA HOUST5F PERMIT5 DRSFRMACBS CREACBW027SBOG".split()
for s in FRED[:0]:
    if key:
        r = g(f"https://api.stlouisfed.org/fred/series/observations?series_id={s}&api_key={key}&file_type=json&sort_order=desc&limit=2")
        try:
            o = r.json().get("observations", [])
            print("FRED", s, r.status_code, [(x["date"], x["value"]) for x in o])
        except Exception as e:
            print("FRED", s, r.status_code if r else None, r.text[:200] if r else e)
    else:
        r = g(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={s}")
        print("FRED", s, r.status_code if r else None, (r.text.strip().splitlines()[-1] if r else ""))
for u in ["https://markets.newyorkfed.org/api/rates/unsecured/effr/last/2.json", "https://markets.newyorkfed.org/api/rates/secured/sofr/last/2.json",
          "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv",
          "https://api.db.nomics.world/v22/series/FED/H15/RIFSPFF_N.M?observations=1",
          "https://www.federalreserve.gov/datadownload/Output.aspx?rel=H15&series=c5025f4bbbed155a6f17c587772ed69e&lastobs=3&from=&to=&filetype=csv&label=include&layout=seriescolumn"]:
    r = g(u)
    print("URL", u[:80], r.status_code if r is not None else None, (r.text[:500].replace("\n", " | ") if r is not None else ""))
# Census EITS construction spending
r = g("https://api.census.gov/data/timeseries/eits/vip?get=cell_value,data_type_code,category_code,time_slot_id,seasonally_adj&time=2025-06")
print("CENSUS", r.status_code if r else None)
if r and r.status_code == 200:
    rows = r.json()
    cats = sorted({(x[2], x[1]) for x in rows[1:]})
    print("CENSUS cats", cats)
    print(rows[:3])
# Bank of Canada series list
r = g("https://www.bankofcanada.ca/valet/lists/series/json", 120)
print("BOC list", r.status_code if r else None)
if r and r.status_code == 200:
    ser = r.json().get("series", {})
    for k, v in ser.items():
        lab = (v.get("label", "") + " | " + v.get("description", ""))
        if re.search(r"mortgage|variable|prime|CORRA|business loan|non-financial|commercial", lab, re.I) and len([1 for _ in [0]]):
            print("BOC", k, "::", lab[:200])
r = g("https://www.bankofcanada.ca/valet/lists/groups/json", 60)
if r and r.status_code == 200:
    for k, v in r.json().get("groups", {}).items():
        lab = v.get("label", "") + " | " + v.get("description", "")
        if re.search(r"mortgage|lending|loan|rate", lab, re.I):
            print("BOCGROUP", k, "::", lab[:200])
for s in ["V39079", "V80691311", "V80691335", "V80691333", "V80691334", "BD.CDN.5YR.DQ.YLD", "BD.CDN.10YR.DQ.YLD", "AVG.INTWO", "V122667783", "V122667784"]:
    r = g(f"https://www.bankofcanada.ca/valet/observations/{s}/json?recent=2")
    try:
        print("BOCOBS", s, r.status_code, [(o["d"], o.get(s)) for o in r.json().get("observations", [])])
    except Exception as e:
        print("BOCOBS", s, r.status_code if r else None, e)
# ECB
ECB = ["FM/B.U2.EUR.4F.KR.DFR.LEV", "FM/B.U2.EUR.4F.KR.MRR_FR.LEV", "EST/B.EU000A2X2A25.WT", "FM/M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA",
       "MIR/M.U2.B.A2C.AM.R.A.2250.EUR.N", "MIR/M.U2.B.A2C.F.R.A.2250.EUR.N", "MIR/M.U2.B.A2C.I.R.A.2250.EUR.N", "MIR/M.U2.B.A2C.P.R.A.2250.EUR.N",
       "MIR/M.U2.B.A2C.O.R.A.2250.EUR.N", "MIR/M.U2.B.A2I.AM.R.A.2240.EUR.N", "MIR/M.U2.B.A2A.A.R.1.2240.EUR.N", "MIR/M.U2.B.A2A.F.R.1.2240.EUR.N",
       "MIR/M.DE+FR+IT+ES+NL+IE+PT+BE+AT+FI+GR.B.A2C.AM.R.A.2250.EUR.N", "MIR/M.DE+FR+IT+ES+NL.B.A2C.F.R.A.2250.EUR.N",
       "YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y", "RESR/Q.U2._T.N._TR.TVAL.4F0.TH.N.IX", "RESC/Q.U2._T.N._TC.TVAL.4F0.TH.N.IX"]
for k in ECB:
    f, s = k.split("/")
    r = g(f"https://data-api.ecb.europa.eu/service/data/{f}/{s}?lastNObservations=1&format=csvdata")
    if r is None: continue
    rows = list(csv.DictReader(io.StringIO(r.text))) if r.status_code == 200 else []
    print("ECB", k, r.status_code, [(x.get("KEY"), x.get("TIME_PERIOD"), x.get("OBS_VALUE"), (x.get("TITLE") or "")[:80]) for x in rows][:12] or r.text[:150])
# ECB commercial property dataflows
r = g("https://data-api.ecb.europa.eu/service/dataflow/ECB")
if r is not None and r.status_code == 200:
    for m in re.finditer(r'id="([A-Z_]+)"[^>]*>\s*<com:Name xml:lang="en">([^<]+)', r.text):
        if re.search(r"propert|real estate|house|lending|interest", m.group(2), re.I):
            print("ECBFLOW", m.group(1), m.group(2))
# BoE
r = g("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jun/2026&Dateto=now&SeriesCodes=IUMABEDR,IUMBV34,IUMBV37,IUMBV42,IUMTLMV,IUMBX67,IUMZICQ&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N")
print("BOE", r.status_code if r else None, r.text[:800] if r else "")
# BIS commercial property
r = g("https://stats.bis.org/api/v1/data/WS_CPP/Q..../all?detail=dataonly&format=csv&startPeriod=2024-Q1", 120)
print("BISCPP", r.status_code if r else None)
if r is not None and r.status_code == 200:
    rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    print("BISCPP cols", list(rows[0].keys()) if rows else None, len(rows))
    keys = {}
    for x in rows:
        k = tuple(v for c, v in x.items() if c not in ("TIME_PERIOD", "OBS_VALUE"))
        keys[k] = (x["TIME_PERIOD"], x["OBS_VALUE"])
    for k, v in sorted(keys.items()):
        print("BISCPP", k, v)
r = g("https://stats.bis.org/api/v1/dataflow/BIS/WS_CPP/1.0?references=all&detail=full", 60)
if r is not None and r.status_code == 200:
    for m in re.finditer(r'<str:Code id="([^"]+)"[^>]*>\s*<com:Name xml:lang="en">([^<]+)', r.text):
        print("BISCPPCODE", m.group(1), m.group(2))
# Eurostat building permits
r = g("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_cobp_q?format=JSON&lang=EN&sinceTimePeriod=2025-Q1&geo=DE")
print("ESTAT", r.status_code if r else None)
if r is not None and r.status_code == 200:
    j = r.json()
    for d, v in j.get("dimension", {}).items():
        print("ESTATDIM", d, list(v.get("category", {}).get("label", {}).items())[:30])
# StatCan building permits
for pid in ["34100292"]:
    r = g(f"https://www150.statcan.gc.ca/n1/tbl/csv/{pid}-eng.zip", 120)
    print("STATCAN", pid, r.status_code if r else None, len(r.content) // 1024 if r else 0, "KB")
    if r is not None and r.status_code == 200:
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            name = next(n for n in z.namelist() if n.endswith(".csv") and "MetaData" not in n)
            with z.open(name) as f:
                rd = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                cols = rd.fieldnames
                print("STATCAN cols", cols)
                uniq = {c: set() for c in cols}
                last = ""
                n = 0
                for row in rd:
                    n += 1
                    for c in cols:
                        if c not in ("VALUE", "COORDINATE", "VECTOR", "DECIMALS", "STATUS", "SYMBOL", "TERMINATED", "DGUID") and len(uniq[c]) < 60:
                            uniq[c].add(row[c])
                    last = max(last, row["REF_DATE"])
                print("STATCAN rows", n, "last", last)
                for c, u in uniq.items():
                    if u: print("STATCAN", c, sorted(u)[:60])
# Yahoo REITs
import yfinance as yf
T = "VNQ REZ INDS SRVR XLRE REET IYR AVB EQR MAA INVH AMH PLD REXR EGP BXP VNO SLG KRC SPG O FRT KIM REG EQIX DLR IRM HST PK RHP WELL VTR PSA EXR CUBE AMT CCI SBAC VICI NNN ADC XRE.TO CAR-UN.TO IIP-UN.TO GRT-UN.TO DIR-UN.TO REI-UN.TO CHP-UN.TO AP-UN.TO D-UN.TO HR-UN.TO NWH-UN.TO SRU-UN.TO FCR-UN.TO VNA.DE LEG.DE SGRO.L URW.PA GFC.PA LAND.L BLND.L MRL.MC LI.PA BYG.L SAFE.L BBOX.L UTG.L AED.BR COV.PA IPRP.L IPRP.AS EPRA.PA TEG.DE DEA.TO".split()
try:
    df = yf.download(T, period="1mo", interval="1d", group_by="ticker", progress=False, threads=True, auto_adjust=False)
    for t in T:
        try:
            c = df[t]["Close"].dropna()
            print("YF", t, len(c), round(float(c.iloc[-1]), 2) if len(c) else None)
        except Exception as e:
            print("YF", t, "ERR", e)
except Exception as e:
    print("YF ERR", e)
