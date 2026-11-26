"""Build site/ratings/<ticker>.json: who rates each stock, how its earnings came in, and insider trades.

For every stock in site/market.json this saves (from one Yahoo request per stock)
- the last 12 months of rating changes by firm (upgrades, downgrades, new coverage,
  reiterations) with their price targets,
- how many analysts said Strong Buy, Buy, Hold, Sell or Strong Sell this month
  and in each of the 3 months before,
- the last four quarters of earnings per share against what analysts expected (beat or miss),
  with the stock's move on the day the market reacted (the busiest trading day in the
  weeks after the quarter ended, from site/hist/), and
- insider buying and selling: each filed trade by an officer, director or big holder over the
  past year, and the six-month totals.

It also writes two summaries for the list pages: site/surprises.json (each stock's latest
beat or miss, for the Earnings page) and site/insiders.json (the biggest recent insider buys
and sells, for the Insiders page).

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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safe_io import write_json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = SITE / "ratings"

WORKERS = 3
COOL_DOWN = 45            # seconds to wait first: the facts step just before often leaves Yahoo rate limiting us
BUDGET = 16 * 60          # seconds; stop asking Yahoo after this and keep what we have
KEEP_DAYS = 365
MAX_ACTIONS = 60
MODULES = ["upgradeDowngradeHistory", "recommendationTrend", "earningsHistory", "insiderTransactions",
           "netSharePurchaseActivity"]
INSIDER_DAYS = 365
MAX_INSIDER = 40


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
        r0 = r[0] if r else {}
        return {"hist": (r0.get("upgradeDowngradeHistory") or {}).get("history") or [],
                "trend": (r0.get("recommendationTrend") or {}).get("trend") or [],
                "eps": (r0.get("earningsHistory") or {}).get("history") or [],
                "ins": (r0.get("insiderTransactions") or {}).get("transactions") or [],
                "net": r0.get("netSharePurchaseActivity") or {}}
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
    if isinstance(v, dict):   # Yahoo sends some numbers as {raw, fmt} even when asked for plain ones
        v = v.get("raw")
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return round(v, 4) if v == v and v > 0 else None


def val(v):
    """A number that may be negative (earnings per share), or None."""
    if isinstance(v, dict):
        v = v.get("raw")
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if v != v or v in (float("inf"), float("-inf")) else v


def ts_of(v):
    v = val(v)
    return int(v) if v else None


def history_closes(t: str) -> list:
    """[unixSeconds, close, volume] daily rows saved by build_history.py, or []."""
    try:
        h = json.loads((SITE / "hist" / f"{t.replace('^', '_')}.json").read_text())
        return [r for r in (h.get("d") or []) if isinstance(r, list) and len(r) >= 3]
    except (OSError, ValueError):
        return []


def reaction(rows: list, quarter_end: int) -> dict | None:
    """The trading day the market reacted to a quarter's report: the busiest day (volume against the
    20 days before it) between 10 and 80 days after the quarter ended, and the price move that day."""
    lo, hi = quarter_end + 10 * 86400, quarter_end + 80 * 86400
    best = None
    for i, (ts, close, vol) in enumerate(rows):
        if ts < lo or ts > hi or i < 21 or not vol or not close or not rows[i - 1][1]:
            continue
        # skip stretches of weekly rows (older thinned history): neighbours must be days apart, not weeks
        if ts - rows[i - 1][0] > 5 * 86400:
            continue
        before = [r[2] for r in rows[i - 20:i] if r[2]]
        if len(before) < 10:
            continue
        rel = vol / (sum(before) / len(before))
        if best is None or rel > best[0]:
            best = (rel, ts, (close / rows[i - 1][1] - 1) * 100)
    if not best or best[0] < 1.4:
        return None
    return {"rd": datetime.fromtimestamp(best[1], tz=timezone.utc).date().isoformat(), "mv": round(best[2], 2)}


def earnings(raw_eps: list, t: str) -> list:
    rows = history_closes(t)
    out = []
    for e in raw_eps:
        q = ts_of(e.get("quarter"))
        act, est = val(e.get("epsActual")), val(e.get("epsEstimate"))
        if not q or act is None:
            continue
        sur = val(e.get("surprisePercent"))
        if sur is None and est:
            sur = (act - est) / abs(est)
        row = {"q": datetime.fromtimestamp(q, tz=timezone.utc).date().isoformat(), "a": round(act, 4),
               "e": round(est, 4) if est is not None else None, "sp": round(sur * 100, 1) if sur is not None else None}
        r = reaction(rows, q) if rows else None
        if r:
            row.update(r)
        out.append({k: v for k, v in row.items() if v is not None})
    out.sort(key=lambda r: r["q"], reverse=True)
    return out


# What a filing's wording means: "Purchase at price 12.30 per share." is a buy on the open market
KIND = [("purchase", "buy"), ("buy back", None), ("sale", "sell"), ("option exercise", "exercise"),
        ("conversion of exercise", "exercise"), ("stock award", "award"), ("grant", "award"), ("gift", "gift")]


def insiders(raw_ins: list, net: dict, now: datetime) -> dict | None:
    since = (now - timedelta(days=INSIDER_DAYS)).timestamp()
    trades = []
    for x in raw_ins:
        text = str(x.get("transactionText") or "").strip()
        rel = str(x.get("filerRelation") or "").strip()
        when = ts_of(x.get("startDate"))
        if not text or not when or when < since or rel.lower() == "issuer":
            continue
        low = text.lower()
        kind = next((k for w, k in KIND if w in low), "other")
        if kind is None:   # a company buying back its own shares isn't an insider trade
            continue
        shares, value = val(x.get("shares")), val(x.get("value"))
        if not shares:
            continue
        row = {"d": datetime.fromtimestamp(when, tz=timezone.utc).date().isoformat(),
               "who": str(x.get("filerName") or "").strip().title(), "rel": rel, "k": kind,
               "sh": int(shares), "v": int(value) if value else None,
               "pr": round(value / shares, 4) if value and shares else None, "own": x.get("ownership") or None}
        trades.append({k: v for k, v in row.items() if v not in (None, "")})
    trades.sort(key=lambda r: r["d"], reverse=True)
    six = {}
    if net:
        for k, short in (("buyInfoCount", "bn"), ("buyInfoShares", "bs"), ("sellInfoCount", "sn"), ("sellInfoShares", "ss"),
                         ("netInfoShares", "ns"), ("totalInsiderShares", "held"), ("netPercentInsiderShares", "npct")):
            v = val(net.get(k))
            if v is not None:
                six[short] = round(v * 100, 2) if short == "npct" else int(v)
    if not trades and not any(six.get(k) for k in ("bn", "sn")):
        return None
    return {"trades": trades[:MAX_INSIDER], "six": six}


def tidy(raw: dict, now: datetime, t: str = "") -> dict | None:
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
                row[short] = int(val(p.get(k)) or 0)
            except (TypeError, ValueError):
                row[short] = 0
        if row["period"] and sum(row[k] for k in ("sb", "b", "h", "s", "ss")):
            trend.append(row)
    eps = earnings(raw.get("eps") or [], t)
    ins = insiders(raw.get("ins") or [], raw.get("net") or {}, now)
    if not acts and not trend and not eps and not ins:
        return None
    out = {"asOf": now.isoformat(timespec="minutes"), "actions": acts[:MAX_ACTIONS], "trend": trend}
    if eps:
        out["eps"] = eps
    if ins:
        out["ins"] = ins
    return out


def summaries(market: dict, now: datetime) -> None:
    """surprises.json and insiders.json, read back from every saved ratings file."""
    by = {s["t"]: s for s in market["stocks"]}
    beats, buys, sells, nets = [], [], [], []
    month = (now - timedelta(days=90)).date().isoformat()
    for f in OUT.glob("*.json"):
        try:
            r = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        t = f.stem.replace("_", "^", 1) if f.stem.startswith("_") else f.stem
        m = by.get(t)
        if not m:
            continue
        base = {"t": t, "s": m.get("s"), "n": m.get("n"), "cur": m.get("cur"), "ix": m.get("ix") or [],
                "sector": m.get("sector"), "mcapUsd": m.get("mcapUsd"), "p": m.get("p")}
        eps = r.get("eps") or []
        if eps:
            last = eps[0]
            known = [e for e in eps if e.get("sp") is not None]
            beat_n = sum(1 for e in known if e["sp"] > 0)
            beats.append({**base, **{k: last.get(k) for k in ("q", "a", "e", "sp", "rd", "mv") if last.get(k) is not None},
                          "beats": beat_n, "of": len(known)})
        ins = r.get("ins") or {}
        fx = (market.get("fx") or {}).get(m.get("cur") or "USD") or 1
        for tr in ins.get("trades") or []:
            if tr.get("d", "") < month or tr.get("k") not in ("buy", "sell") or not tr.get("v"):
                continue
            row = {**base, **tr, "vUsd": round(tr["v"] / fx)}
            (buys if tr["k"] == "buy" else sells).append(row)
        six = ins.get("six") or {}
        if six.get("bn") or six.get("sn"):
            nets.append({**base, **six})
    buys.sort(key=lambda r: -r["vUsd"])
    sells.sort(key=lambda r: -r["vUsd"])
    write_json(SITE / "surprises.json", {"generated": now.isoformat(timespec="minutes"), "stocks": beats})
    write_json(SITE / "insiders.json", {"generated": now.isoformat(timespec="minutes"),
                                         "buys": buys[:300], "sells": sells[:300], "net": nets})
    log(f"summaries: {len(beats)} earnings results, {len(buys)} insider buys and {len(sells)} sells in 90 days")


def build():
    now = datetime.now(timezone.utc)
    market = json.loads((SITE / "market.json").read_text())
    # Every stock: insider trades and earnings matter for those without analyst coverage too
    tickers = [s["t"] for s in sorted(market["stocks"], key=lambda s: -(s.get("mcapUsd") or 0))]
    log(f"{len(tickers)} stocks; fetching analyst history, earnings results and insider trades")
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
                return t, tidy(fetch(t), now, t)
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
                write_json(OUT / f"{t.replace('^', '_')}.json", body, ensure_ascii=False)
                saved += 1
    log(f"saved analyst, earnings and insider history for {saved} of {len(tickers)} stocks in {time.monotonic() - start:.0f}s "
        f"({state['refused']} refused requests retried)")
    summaries(market, now)


if __name__ == "__main__":
    build()
