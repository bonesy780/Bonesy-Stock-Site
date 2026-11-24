import json, requests, yfinance as yf
def show(label, obj, n=2500):
    print("=====", label); print(json.dumps(obj, default=str)[:n])
for t in ["AAPL", "RY.TO", "7203.T"]:
    try:
        r = yf.Ticker(t)._quote._fetch(modules=["earningsHistory", "insiderTransactions", "netSharePurchaseActivity"])
        show(t, r, 4000)
    except Exception as e: print(t, "ERR", e)
for t in ["SPY", "QQQ"]:
    try:
        r = yf.Ticker(t)._quote._fetch(modules=["topHoldings", "fundProfile", "summaryDetail", "defaultKeyStatistics"])
        show(t, r, 3000)
    except Exception as e: print(t, "ERR", e)
try:
    d = yf.download(["^VIX", "^TNX", "CL=F", "GC=F", "DX-Y.NYB", "BTC-USD", "ETH-USD"], period="5d", progress=False)
    print(d["Close"].tail(3))
except Exception as e: print("dl ERR", e)
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept": "application/json, text/plain, */*", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}
for d in ["2026-11-24", "2026-11-25", "2026-12-05"]:
    try:
        r = requests.get(f"https://api.nasdaq.com/api/calendar/economicevents?date={d}", headers=H, timeout=20)
        print(r.status_code); show("nasdaq econ " + d, r.json(), 3000)
    except Exception as e: print("nasdaq ERR", e)
for u in ["https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", "https://www.bankofcanada.ca/press/upcoming-events/", "https://www.bls.gov/schedule/news_release/cpi.htm", "https://www.sec.gov/cgi-bin/own-disp?action=getissuer&CIK=0000320193", "https://efts.sec.gov/LATEST/search-index?q=%22form%204%22"]:
    try:
        r = requests.get(u, headers={"User-Agent": "TopTicker site builder admin@topticker.ca"}, timeout=20)
        print("=====", u, r.status_code, len(r.text)); print(r.text[:300].replace("\n", " "))
    except Exception as e: print(u, "ERR", e)
try:
    r = requests.get("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=all_cryptocurrencies_us&count=15", headers=H, timeout=20)
    print("crypto screener", r.status_code, r.text[:1500])
except Exception as e: print("crypto ERR", e)
