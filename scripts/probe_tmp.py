import csv, io, json, re, time, traceback
import requests
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept": "*/*"}
def g(u, t=40, **kw):
    t0 = time.time()
    r = requests.get(u, headers=H, timeout=(10, t), **kw)
    print("  t", round(time.time() - t0, 1), r.status_code, u[:100])
    return r
def sec(f):
    try: f()
    except Exception as e: print("SECTION FAILED", f.__name__, repr(e)[:300])
def bis_codes():
    for cl in ["CL_RE_TYPE", "CL_COVERED_AREA", "CL_PRICED_UNIT", "CL_COMPILING_ORG"]:
        r = g(f"https://stats.bis.org/api/v1/codelist/BIS/{cl}/latest")
        if r.status_code != 200:
            r = g(f"https://stats.bis.org/api/v2/structure/codelist/BIS/{cl}/latest")
        for m in re.finditer(r'<str:Code id="([^"]+)"[^>]*>\s*<com:Name[^>]*>([^<]+)', r.text):
            print("BISCODE", cl, m.group(1), m.group(2))
def boc_groups():
    for gname in ["A4_RATES_MORTGAGES", "A4_RATES_VARIABLE", "A4_RATES_EXTENDED", "A4_RATES_MONTHLY"]:
        r = g(f"https://www.bankofcanada.ca/valet/groups/{gname}/json")
        gs = (r.json().get("groupDetails") or {}).get("groupSeries") or {}
        for k, v in gs.items():
            print("BOCG", gname, k, "::", v.get("label"), "|", (v.get("description") or "")[:120])
    r = g("https://www.bankofcanada.ca/valet/observations/BROKER_AVERAGE_5YR_VRM/json?recent=3")
    print("VRM", r.text[:400])
def statcan_meta():
    r = requests.post("https://www150.statcan.gc.ca/t1/wds/rest/getCubeMetadata", json=[{"productId": 34100292}], headers=H, timeout=60)
    j = r.json()[0]["object"]
    for d in j["dimension"]:
        mem = d["member"]
        print("SCDIM", d["dimensionPositionId"], d["dimensionNameEn"], len(mem))
        for m in mem[:400]:
            print("  SCMEM", d["dimensionPositionId"], m["memberId"], m.get("parentMemberId"), m["memberNameEn"])
def statcan_try():
    # GEO 1? try Toronto-like coordinate guesses after metadata; print one real series via latest N periods
    pass
def boe():
    for u in ["https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/2025&Dateto=now&SeriesCodes=IUMABEDR,IUMBV34,IUMBV37,IUMBV42,IUMTLMV&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N",
              "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/2025&Dateto=now&SeriesCodes=IUMABEDR,IUMBV34&CSVF=TT&UsingCodes=Y&VPD=Y&VFD=N"]:
        r = g(u)
        print("BOE", r.text[:700].replace("\n", " | "))
def census():
    for u in ["https://www.census.gov/construction/c30/xlsx/privsatime.xlsx", "https://www.census.gov/construction/c30/xls/privsatime.xls",
              "https://www.census.gov/construction/c30/csv/privsa.csv", "https://www.census.gov/econ/currentdata/export/csv?programCode=VIP&timeSlotType=12&startYear=2024&endYear=2026&categories[]=A00&dataType=T&geoLevel=US&adjusted=1&notAdjusted=0&errorData=0"]:
        r = g(u)
        print("CENSUS", u[-40:], r.headers.get("content-type"), len(r.content), r.content[:200] if b"html" not in r.content[:300].lower() else "html")
    r = g("https://www.census.gov/econ/currentdata/export/csv?programCode=VIP&timeSlotType=12&startYear=2025&endYear=2026&categories[]=AXXXX&dataType=T&geoLevel=US&adjusted=1&notAdjusted=0&errorData=0")
    print("CENSUS2", r.text[:1500])
for f in [bis_codes, boc_groups, boe, census, statcan_meta]:
    sec(f)
