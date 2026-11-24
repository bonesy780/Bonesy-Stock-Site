"""Build site/econ.json: the economic calendar for the past week and the next two weeks.

Central bank rate decisions (the Fed, Bank of Canada, Bank of Japan, ECB and others), inflation, jobs,
GDP, retail sales, factory surveys and the like, with the forecast (consensus), the previous reading and,
once out, the actual figure. From Nasdaq's public economic calendar (one request per day), kept to the
economies that move this site's markets. Events that tend to move markets most are flagged `key`.

Every run calls this, but it only asks Nasdaq again for the whole window every 3 hours; in between it
refreshes yesterday and today, which is when actual figures come out. If Nasdaq can't be reached the last
file is kept. Run from the repo root: python scripts/build_econ.py
"""
from __future__ import annotations

import html
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safe_io import read_json, write_json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "econ.json"
URL = "https://api.nasdaq.com/api/calendar/economicevents"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
           "Accept": "application/json, text/plain, */*", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}
BACK, AHEAD = 7, 14
FULL_EVERY = 3 * 3600

# Nasdaq's country names -> [code, flag]
COUNTRIES = {
    "United States": ["US", "🇺🇸"], "Canada": ["CA", "🇨🇦"], "Japan": ["JP", "🇯🇵"], "South Korea": ["KR", "🇰🇷"],
    "Taiwan": ["TW", "🇹🇼"], "Euro Zone": ["EU", "🇪🇺"], "Germany": ["DE", "🇩🇪"], "United Kingdom": ["UK", "🇬🇧"],
    "China": ["CN", "🇨🇳"],
}
# Events that tend to move markets the most
KEY = re.compile(
    r"interest rate decision|rate statement|fomc|fed chair|powell|monetary policy (statement|report)|press conference|"
    r"nonfarm payrolls|unemployment rate|employment change|jobless claims|"
    r"^(core )?cpi|consumer price index|^(core )?pce|^(core )?ppi|"
    r"gdp|retail sales|ism (manufacturing|non-manufacturing|services) pmi|jolts|michigan consumer sentiment|"
    r"cb consumer confidence|tankan|trade balance", re.I)
# Minor variants of key events that would crowd the list
MINOR = re.compile(r"\b(mom|yoy|qoq)\b.*\b(ex|excl|n\.s\.a|nsa)\b|\bindex n\.s\.a\b|\(tentative\)", re.I)
TAG = re.compile(r"<[^>]+>")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def clean(s) -> str:
    s = html.unescape(html.unescape(str(s or ""))).replace("\xa0", " ")
    return TAG.sub(" ", s).strip()


def day(d: str) -> list[dict] | None:
    for attempt in range(3):
        try:
            r = requests.get(URL, params={"date": d}, headers=HEADERS, timeout=20)
            if r.status_code == 200:
                rows = ((r.json() or {}).get("data") or {}).get("rows") or []
                return rows
            log(f"{d}: Nasdaq answered {r.status_code}")
        except Exception as e:
            log(f"{d}: {e}")
        time.sleep(3 * (attempt + 1))
    return None


def tidy(d: str, rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        c = COUNTRIES.get(clean(r.get("country")))
        name = clean(r.get("eventName"))
        if not c or not name:
            continue
        t = clean(r.get("gmt"))
        at = None
        if re.fullmatch(r"\d{1,2}:\d{2}", t):
            at = f"{d}T{int(t.split(':')[0]):02d}:{t.split(':')[1]}:00Z"
        desc = clean(r.get("description"))
        # Drop the forex-trader boilerplate ("A higher than expected reading should be taken as bullish for the EUR")
        desc = re.split(r"\s*A (higher|lower) than expected|\s*Actual Data\s*[><]", desc)[0].strip()
        key = bool(KEY.search(name)) and not MINOR.search(name)
        ev = {"d": d, "at": at, "c": c[0], "f": c[1], "n": name,
              "a": clean(r.get("actual")) or None, "fc": clean(r.get("consensus")) or None, "pv": clean(r.get("previous")) or None,
              "key": key or None, "why": desc[:280] if key and desc else None}
        out.append({k: v for k, v in ev.items() if v is not None})
    return out


def build():
    now = datetime.now(timezone.utc)
    old = read_json(OUT, {}) or {}
    last_full = old.get("fullAt")
    full = not old.get("events") or not last_full or (now - datetime.fromisoformat(last_full)).total_seconds() > FULL_EVERY
    today = now.date()
    days = [(today + timedelta(days=i)).isoformat() for i in range(-BACK, AHEAD + 1)]
    ask = days if full else [(today - timedelta(days=1)).isoformat(), today.isoformat()]
    keep = {d: [e for e in old.get("events", []) if e.get("d") == d] for d in days}
    got = 0
    for d in ask:
        rows = day(d)
        if rows is None:
            continue
        keep[d] = tidy(d, rows)
        got += 1
        time.sleep(0.4)
    if not got:
        log("::warning::Nasdaq's economic calendar couldn't be reached; keeping the last econ.json")
        return
    events = [e for d in days for e in keep.get(d, [])]
    events.sort(key=lambda e: (e["d"], e.get("at") or e["d"] + "T99"))
    body = {"generated": now.isoformat(timespec="minutes"),
            "fullAt": now.isoformat(timespec="minutes") if full and got >= len(ask) // 2 else (last_full or now.isoformat(timespec="minutes")),
            "from": days[0], "to": days[-1], "events": events}
    write_json(OUT, body, ensure_ascii=False)
    log(f"econ.json: {len(events)} events ({sum(1 for e in events if e.get('key'))} key) from {got} of {len(ask)} days asked")


if __name__ == "__main__":
    build()
