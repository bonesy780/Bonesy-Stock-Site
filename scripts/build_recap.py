"""Build site/recap.json for the Weekly Recap page, and keep a weekly record of the site's picks.

Each week's buy ideas, sell ideas and stocks to watch are saved once, the first time a full run sees
that week, in data/picks/<Monday>.json (committed to the repo by the workflow, so the record survives
cache clears). The recap then checks how every saved week's picks have done since: the price when they
were picked against the latest price, and against the S&P 500 (or the pick's own market) over the same
time. It also sums up the latest week: each market's move, the biggest gainers and losers, sectors,
rates and commodities, and the biggest earnings reactions.

Run after build_data.py, build_market.py, build_ratings.py and build_macro.py:
    python scripts/build_recap.py
"""
from __future__ import annotations

import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safe_io import read_json, write_json  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
PICKS = ROOT / "data" / "picks"
WEEKS = 12          # weeks of picks shown on the recap
MOVERS = 10


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def snapshot(data: dict, now: datetime) -> None:
    """Save this week's picks once. A Sunday run counts toward the week it looks ahead to."""
    today = now.date()
    wk = monday(today + timedelta(days=1)) if today.weekday() == 6 else monday(today)
    f = PICKS / f"{wk.isoformat()}.json"
    if f.exists():
        return
    def pick(r, kind):
        return {"t": r["ticker"], "s": r.get("symbol"), "n": r.get("name"), "k": kind, "p": r.get("price"),
                "cur": r.get("currency"), "why": r.get("why"), "ix": r.get("index")}
    picks = [pick(r, "buy") for r in data.get("buyIdeas") or []] + \
            [pick(r, "sell") for r in data.get("sellIdeas") or []] + \
            [pick(r, "watch") for r in data.get("watchlist") or []]
    picks = [p for p in picks if p["t"] and p["p"]]
    if not picks:
        return
    bench = {ix["id"]: ix.get("level") for ix in data.get("indexes") or [] if ix.get("level")}
    write_json(f, {"week": wk.isoformat(), "savedAt": now.isoformat(timespec="minutes"), "bench": bench,
                   "picks": [{k: v for k, v in p.items() if v is not None} for p in picks]}, indent=1, ensure_ascii=False)
    log(f"saved this week's {len(picks)} picks to {f.relative_to(ROOT)}")


def build():
    now = datetime.now(timezone.utc)
    data = read_json(SITE / "data.json", {}) or {}
    market = read_json(SITE / "market.json", {}) or {}
    if not data.get("indexes") or not market.get("stocks"):
        log("data.json or market.json missing; no recap this run")
        return
    PICKS.mkdir(parents=True, exist_ok=True)
    snapshot(data, now)

    by = {s["t"]: s for s in market["stocks"]}
    level = {ix["id"]: ix.get("level") for ix in data["indexes"]}
    names = {ix["id"]: ix["name"] for ix in data["indexes"]}

    # ---- how past weeks' picks have done
    weeks = []
    for f in sorted(PICKS.glob("*.json"), reverse=True)[:WEEKS]:
        snap = read_json(f, {}) or {}
        rows = []
        for p in snap.get("picks") or []:
            s = by.get(p["t"])
            if not s or not s.get("p") or not p.get("p"):
                continue
            ix = p.get("ix") if p.get("ix") in level else (s.get("ix") or ["sp500"])[0]
            b0, b1 = (snap.get("bench") or {}).get(ix), level.get(ix)
            ret = (s["p"] / p["p"] - 1) * 100
            bret = (b1 / b0 - 1) * 100 if b0 and b1 else None
            rows.append({**p, "now": s["p"], "ret": round(ret, 2), "bix": ix, "bret": round(bret, 2) if bret is not None else None})
        if not rows:
            continue

        def avg(kind, key="ret"):
            v = [r[key] for r in rows if r["k"] == kind and r.get(key) is not None]
            return round(sum(v) / len(v), 2) if v else None
        weeks.append({"week": snap["week"], "picks": rows,
                      "buy": avg("buy"), "buyBench": avg("buy", "bret"), "sell": avg("sell"), "sellBench": avg("sell", "bret"),
                      "watch": avg("watch"),
                      "buyWins": sum(1 for r in rows if r["k"] == "buy" and r.get("bret") is not None and r["ret"] > r["bret"]),
                      "buyN": sum(1 for r in rows if r["k"] == "buy")})

    # ---- the latest week in markets
    stocks = [s for s in market["stocks"] if s.get("w1") is not None and (s.get("mcapUsd") or 0) >= 2e9]
    stocks.sort(key=lambda s: s["w1"])
    slim = lambda s: {k: s.get(k) for k in ("t", "s", "n", "cur", "p", "w1", "d1", "ix", "sector") if s.get(k) is not None}
    sectors = defaultdict(list)
    for s in stocks:
        if s.get("sector") and s.get("mcapUsd"):
            sectors[s["sector"]].append(s)
    sector_rows = []
    for name, ss in sectors.items():
        cap = sum(s["mcapUsd"] for s in ss)
        sector_rows.append({"n": name, "w1": round(sum(s["w1"] * s["mcapUsd"] for s in ss) / cap, 2), "count": len(ss)})
    sector_rows.sort(key=lambda r: -r["w1"])

    week_ago = (now - timedelta(days=8)).date().isoformat()
    surprises = (read_json(SITE / "surprises.json", {}) or {}).get("stocks") or []
    reacts = [r for r in surprises if r.get("rd", "") >= week_ago and r.get("mv") is not None]
    reacts.sort(key=lambda r: -abs(r["mv"]))

    macro = (read_json(SITE / "macro.json", {}) or {}).get("items") or []
    out = {
        "generated": now.isoformat(timespec="minutes"),
        "weekOf": monday(now.date() - timedelta(days=1 if now.weekday() >= 5 else 0)).isoformat(),
        "indexes": [{"id": ix["id"], "n": names[ix["id"]], "level": ix.get("level"), "w1": ix.get("chg1w"),
                     "m1": ix.get("chg1m"), "ytd": ix.get("ytd")} for ix in data["indexes"]],
        "gainers": [slim(s) for s in stocks[::-1][:MOVERS]],
        "losers": [slim(s) for s in stocks[:MOVERS]],
        "sectors": sector_rows,
        "earnings": [{k: r.get(k) for k in ("t", "s", "n", "sp", "mv", "rd", "q")} for r in reacts[:MOVERS]],
        "macro": [{k: m.get(k) for k in ("t", "s", "n", "unit", "p", "w1")} for m in macro],
        "weeks": weeks,
    }
    write_json(SITE / "recap.json", out, allow_nan=False, ensure_ascii=False)
    log(f"recap.json: {len(weeks)} weeks of picks tracked")


if __name__ == "__main__":
    build()
