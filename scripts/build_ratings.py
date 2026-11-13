"""Build site/ratings/<ticker>.json: which analyst firms rate each stock.

For every stock in site/market.json that analysts cover, this saves
- the last 12 months of rating changes by firm (upgrades, downgrades, new coverage,
  reiterations) with their price targets, and
- how many analysts said Strong Buy, Buy, Hold, Sell or Strong Sell this month
  and in each of the 3 months before.

Yahoo's consensus (the average rating on the rest of the site) does not name the firms;
these lists are the closest public record of who is behind it. Run after build_market.py.
"""
from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = SITE / "ratings"

WORKERS = 3
COOL_DOWN = 45            # seconds to wait first: the facts step just before often leaves Yahoo rate limiting us
BUDGET = 20 * 60          # seconds; stop asking Yahoo after this and keep what we have
KEEP_DAYS = 365
MAX_ACTIONS = 60
MODULES = ["upgradeDowngradeHistory", "recommendationTrend"]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


class Refused(Exception):
    """Yahoo gave no answer (rate limit or a stale session), as opposed to an answer with no data."""


def fetch(t: str) -> dict:
    """Both lists in one request where yfinance allows it, else one request each."""
    tk = yf.Ticker(t)
    quote = getattr(tk, "_quote", None)
    if quote is not None and hasattr(quote, "_fetch"):
        res = quote._fetch(modules=MODULES)  # one call for both modules
        if not res or "quoteSummary" not in res:
            raise Refused(t)
        r = (res.get("quoteSummary") or {}).get("result") or []
        return {"hist": (r[0].get("upgradeDowngradeHistory") or {}).get("history") or [] if r else [],
                "trend": (r[0].get("recommendationTrend") or {}).get("trend") or [] if r else []}
    hist, trend = [], []
    try:
        df = tk.upgrades_downgrades
        if df is not None and len(df):
            for ts, row in df.iterrows():
                hist.append({"epochGradeDate": int(ts.timestamp()), "firm": row.get("Firm"), "toGrade": row.get("ToGrade"),
                             "fromGrade": row.get("FromGrade"), "action": row.get("Action"),
                             "priceTargetAction": row.get("priceTargetAction"),
                             "currentPriceTarget": row.get("currentPriceTarget"), "priorPriceTarget": row.get("priorPriceTarget")})
    except Exception:
        pass
    try:
        df = tk.recommendations
        if df is not None and len(df):
            trend = df.to_dict("records")
    except Exception:
        pass
    return {"hist": hist, "trend": trend}


def num(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return round(v, 4) if v == v and v > 0 else None


def tidy(raw: dict, now: datetime) -> dict | None:
    since = (now - timedelta(days=KEEP_DAYS)).timestamp()
    acts = []
    for h in raw["hist"]:
        ts = h.get("epochGradeDate")
        firm = str(h.get("firm") or "").strip()
        if not ts or ts < since or not firm:
            continue
        a = {"d": datetime.fromtimestamp(int(ts), tz=timezone.utc).date().isoformat(), "firm": firm,
             "act": h.get("action") or "", "to": h.get("toGrade") or "", "from": h.get("fromGrade") or "",
             "pt": num(h.get("currentPriceTarget")), "ppt": num(h.get("priorPriceTarget")),
             "pta": h.get("priceTargetAction") or ""}
        acts.append({k: v for k, v in a.items() if v not in (None, "")})
    acts.sort(key=lambda a: a["d"], reverse=True)
    trend = []
    for p in raw["trend"]:
        row = {"period": p.get("period")}
        for k, short in (("strongBuy", "sb"), ("buy", "b"), ("hold", "h"), ("sell", "s"), ("strongSell", "ss")):
            try:
                row[short] = int(p.get(k) or 0)
            except (TypeError, ValueError):
                row[short] = 0
        if row["period"] and sum(row[k] for k in ("sb", "b", "h", "s", "ss")):
            trend.append(row)
    if not acts and not trend:
        return None
    return {"asOf": now.isoformat(timespec="minutes"), "actions": acts[:MAX_ACTIONS], "trend": trend}


def build():
    now = datetime.now(timezone.utc)
    market = json.loads((SITE / "market.json").read_text())
    tickers = [s["t"] for s in sorted(market["stocks"], key=lambda s: -(s.get("mcapUsd") or 0))
               if (s.get("analysts") or 0) >= 1]
    log(f"{len(tickers)} stocks with analyst coverage; fetching rating history")
    OUT.mkdir(parents=True, exist_ok=True)
    log(f"waiting {COOL_DOWN}s for Yahoo's rate limit to reset")
    time.sleep(COOL_DOWN)
    start = time.monotonic()
    state = {"pause_until": 0.0, "refused": 0}

    def one(t):
        for attempt in range(4):
            wait = state["pause_until"] - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            if time.monotonic() - start > BUDGET:
                return t, None
            try:
                return t, tidy(fetch(t), now)
            except Exception as e:
                # Refused or rate limited: every worker pauses, longer each time
                state["refused"] += 1
                state["pause_until"] = max(state["pause_until"], time.monotonic() + 20 * (attempt + 1))
                if attempt == 3:
                    log(f"{t}: gave up ({e or type(e).__name__})")
        return t, None

    saved = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for t, body in ex.map(one, tickers):
            if body:
                (OUT / f"{t.replace('^', '_')}.json").write_text(json.dumps(body, separators=(",", ":"), ensure_ascii=False))
                saved += 1
    log(f"saved analyst history for {saved} of {len(tickers)} stocks in {time.monotonic() - start:.0f}s "
        f"({state['refused']} refused requests retried)")


if __name__ == "__main__":
    build()
