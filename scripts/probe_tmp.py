import io, json, re, sys, time, zipfile
import requests
sys.path.insert(0, "scripts")
from build_realestate import xlsx_rows
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept": "*/*"}
def sec(f):
    try: f()
    except Exception as e: print("SECTION FAILED", f.__name__, repr(e)[:300])
def boc():
    for gname in ["A4_RATES_MORTGAGES", "A4_RATES_VARIABLE", "A4_RATES_EXTENDED"]:
        t = requests.get(f"https://www.bankofcanada.ca/valet/groups/{gname}/json", headers=H, timeout=30).text
        print("BOCG", gname, t[:3000].replace("\n", " "))
def bis():
    t = requests.get("https://stats.bis.org/api/v1/codelist/BIS/CL_RE_TYPE/latest", headers=H, timeout=30).text
    print("BISCL", re.sub(r"\s+", " ", t)[:3000])
def census():
    c = requests.get("https://www.census.gov/construction/c30/xlsx/privsatime.xlsx", headers=H, timeout=60).content
    for k in range(3):
        rows = xlsx_rows(c, k)
        print("CENSUS sheet", k, len(rows))
        for r in rows[:12]:
            print("  CR", [x for x in r[:20]])
        for r in rows[-3:]:
            print("  CRL", [x for x in r[:20]])
def statcan():
    coords = ["45.1.1.1.2.0.0.0.0.0", "45.57.1.1.2.0.0.0.0.0", "15.1.1.1.2.0.0.0.0.0"]
    r = requests.post("https://www150.statcan.gc.ca/t1/wds/rest/getDataFromCubePidCoordAndLatestNPeriods",
                      json=[{"productId": 34100292, "coordinate": c, "latestN": 3} for c in coords], headers=H, timeout=60)
    print("SC", r.status_code, r.text[:1500])
for f in [boc, bis, census, statcan]:
    sec(f)
