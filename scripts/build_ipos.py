"""Add new US IPOs to the site the day they start trading.

Reads the priced deals on Nasdaq's IPO calendar (this month and last) and adds each
one to data/listings.csv, which the history, market and lookup builds already carry.
Then, so a stock can be looked up within minutes rather than after the nightly full
rebuild, it adds every listing that's missing from site/stocks.json and saves the
first days of prices for listings from the last couple of weeks into site/hist/.

Runs in every workflow run (quick ones too) and never stops the build: if Nasdaq or
Yahoo can't be reached, the site keeps what it had, and the live price service's
search still finds the stock.

    python scripts/build_ipos.py
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import LISTINGS, extra_listings  # noqa: E402
from safe_io import write_json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
HIST = SITE / "hist"
CALENDAR = "https://api.nasdaq.com/api/ipo/calendar?date={month}"
HEADERS = {
    # Nasdaq's API turns away requests that don't look like a browser
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
}
MIN_RAISE = 20e6          # skip tiny deals
KEEP_DAYS = 365           # auto-added rows drop off a year after listing (by then most have joined an index)
FRESH_DAYS = 14           # save first-days prices for listings this recent
COLUMNS = ["symbol", "name", "exchange", "currency", "region", "listed", "ipo_price", "source"]
# Blank-cheque companies list as units and aren't operating businesses
SPAC = re.compile(r"\b(acquisition|capital) corp|\bspac\b|blank check", re.I)
SYMBOL = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def money(v) -> float | None:
    try:
        return float(re.sub(r"[^0-9.]", "", str(v)) or "nan")
    except ValueError:
        return None


def exchange(v: str) -> str:
    v = (v or "").upper()
    if "NASDAQ" in v:
        return "Nasdaq"
    if "AMERICAN" in v or "AMEX" in v:
        return "NYSE American"
    if "NYSE" in v or "NEW YORK" in v:
        return "NYSE"
    return v.title() or "US"


def priced_deals(today: date) -> list[dict]:
    """IPOs that priced this month and last, newest first."""
    months = {today.strftime("%Y-%m"), (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")}
    out = []
    for m in sorted(months):
        try:
            r = requests.get(CALENDAR.format(month=m), headers=HEADERS, timeout=20)
            r.raise_for_status()
            rows = ((r.json().get("data") or {}).get("priced") or {}).get("rows") or []
        except Exception as e:  # Nasdaq down or blocking: keep the listings we have
            log(f"IPO calendar {m} unavailable ({e})")
            continue
        for row in rows:
            sym = str(row.get("proposedTickerSymbol") or "").strip().upper()
            name = str(row.get("companyName") or "").strip()
            try:
                listed = datetime.strptime(str(row.get("pricedDate") or ""), "%m/%d/%Y").date()
            except ValueError:
                continue
            raise_usd = money(row.get("dollarValueOfSharesOffered"))
            if not SYMBOL.match(sym) or not name or SPAC.search(name) or listed > today:
                continue
            if raise_usd is not None and raise_usd == raise_usd and raise_usd < MIN_RAISE:
                continue
            price = money(row.get("proposedSharePrice"))
            out.append({"symbol": sym.replace(".", "-"), "name": name, "exchange": exchange(row.get("proposedExchange")),
                        "currency": "USD", "region": "United States", "listed": listed.isoformat(),
                        "ipo_price": f"{price:.2f}" if price and price == price else "", "source": "nasdaq"})
    log(f"{len(out)} priced IPOs on the calendar")
    return out


def update_listings(today: date) -> None:
    """Add new deals to data/listings.csv and drop auto-added ones over a year old. Rows added by hand stay."""
    have = pd.read_csv(LISTINGS, dtype=str, keep_default_na=False) if LISTINGS.exists() else pd.DataFrame(columns=COLUMNS)
    for c in COLUMNS:
        if c not in have:
            have[c] = ""
    rows = have[COLUMNS].to_dict("records")
    known = {r["symbol"].upper() for r in rows}
    added = []
    for d in priced_deals(today):
        if d["symbol"] not in known:
            known.add(d["symbol"])
            added.append(d)
    rows += added
    cutoff = (today - timedelta(days=KEEP_DAYS)).isoformat()
    kept = [r for r in rows if r.get("source") != "nasdaq" or (r.get("listed") or "9999") >= cutoff]
    if added or len(kept) != len(rows):
        pd.DataFrame(kept, columns=COLUMNS).to_csv(LISTINGS, index=False)
    for d in added:
        log(f"new listing {d['symbol']} ({d['name']}, {d['exchange']}, {d['listed']})")


def first_days(today: date) -> None:
    """Search entries and first-days prices for recent listings, so they can be looked up before the full rebuild."""
    listings = extra_listings()
    if not listings:
        return
    path = SITE / "stocks.json"
    try:
        stocks = json.loads(path.read_text()) if path.exists() else []
    except ValueError:
        # Never rebuild the search list from just the new listings: that would drop every other stock
        log("stocks.json unreadable, leaving the search list for the next full run")
        return
    by = {s["t"]: s for s in stocks}
    for e in listings:
        if e["t"] in by:
            by[e["t"]].update({k: v for k, v in e.items() if k in ("x", "ipo")})
        else:
            stocks.append(e)
            by[e["t"]] = e
            log(f"added {e['t']} to the search list")
    write_json(path, stocks, ensure_ascii=False)

    recent = [e["t"] for e in listings if e.get("ipo", {}).get("d", "") >= (today - timedelta(days=FRESH_DAYS)).isoformat()]
    if not recent:
        return
    try:
        from build_history import bars, points, range52  # yfinance is only needed here
        daily = bars(recent, period="5d", interval="1d")
        intraday = bars(recent, period="5d", interval="5m")
    except Exception as e:
        log(f"first-days prices unavailable ({e})")
        return
    HIST.mkdir(parents=True, exist_ok=True)
    for t in recent:
        d = daily.get(t)
        if d is None or not len(d):
            continue
        f = HIST / f"{t.replace('^', '_')}.json"
        try:
            old = json.loads(f.read_text()) if f.exists() else None
        except ValueError:
            old = None
        # The full rebuild's history may already reach further back; only refresh today's prices then
        if old and len(old.get("d", [])) > len(d):
            body = old
        else:
            body = {"t": t, "d": points(d), "df": 0, **range52(d)}
        i = intraday.get(t)
        body["i"] = points(i) if i is not None else body.get("i", [])
        write_json(f, body)
        log(f"saved first-days prices for {t} ({len(body['d'])} days)")


def main():
    today = datetime.now(timezone.utc).date()
    try:
        update_listings(today)
    except Exception as e:
        log(f"listing update failed ({e})")
    try:
        first_days(today)
    except Exception as e:
        log(f"first-days step failed ({e})")


if __name__ == "__main__":
    main()
