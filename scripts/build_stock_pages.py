"""Write site/stocks/<ticker>.html: a search-friendly page for every stock, ETF and coin the site covers.

The stock lookup (stock.html?t=AAPL) builds everything in the browser, so a search engine that doesn't run
scripts sees an empty page, and all stocks share one address. Each page made here is the same lookup, with
its own address, title, description and structured data, and with the key facts already written into the
page: price and moves, valuation, dividends, the analyst view, earnings record, insider trades and what the
company does. The page's script then takes over and draws the live chart and full figures as usual.

Run after build_market.py, build_ratings.py and build_macro.py (in full runs). Reads stocks.json,
market.json, fund/, ratings/ and funds.json; a missing file just leaves those facts out.
    python scripts/build_stock_pages.py
"""
from __future__ import annotations

import html
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safe_io import read_json, write_text  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = SITE / "stocks"
BASE = "https://www.topticker.ca/"
SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,19}$")
IX = {"tsx": "TSX", "tsxv": "TSX Venture", "sp500": "S&P 500", "nasdaq100": "Nasdaq-100", "dow": "Dow",
      "nikkei225": "Nikkei 225", "kospi200": "KOSPI 200", "twse50": "Taiwan 50"}
SYM = {"USD": "$", "CAD": "C$", "JPY": "¥", "KRW": "₩", "TWD": "NT$", "EUR": "€", "GBP": "£"}

e = lambda s: html.escape(str(s if s is not None else ""), quote=True)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def money(v, cur="USD"):
    if v is None:
        return "–"
    nd = 0 if abs(v) >= 1000 or cur in ("JPY", "KRW") else 2
    return f"{'-' if v < 0 else ''}{SYM.get(cur, cur + ' ')}{abs(v):,.{nd}f}"


def pct(v, nd=1, sign=True):
    if v is None:
        return "–"
    return f"{'+' if sign and v >= 0 else ''}{v:.{nd}f}%"


def big(v, cur="USD"):
    if not v:
        return "–"
    for n, u in ((1e12, "T"), (1e9, "B"), (1e6, "M")):
        if abs(v) >= n:
            return f"{SYM.get(cur, '$')}{v / n:.{0 if abs(v) / n >= 100 else 1}f}{u}"
    return money(v, cur)


def rating(m):
    if m is None:
        return None
    return "Strong Buy" if m <= 1.5 else "Buy" if m <= 2.5 else "Hold" if m <= 3.5 else "Underperform" if m <= 4.5 else "Sell"


def cls(v):
    return "" if v is None else "up" if v >= 0 else "down"


def facts_list(rows):
    rows = [r for r in rows if r and r[1] not in (None, "–", "")]
    return "<dl class=\"seo-dl\">" + "".join(f"<div><dt>{e(k)}</dt><dd class=\"num\">{v}</dd></div>" for k, v in rows) + "</dl>"


def page_for(tpl: str, s: dict, m: dict, f: dict, r: dict, fund: dict | None, now: datetime) -> str:
    t, sym = s["t"], s.get("s") or s["t"]
    name = (f or {}).get("longName") or s.get("n") or (fund or {}).get("n") or sym
    cur = m.get("cur") or (f or {}).get("cur") or s.get("cur") or (fund or {}).get("cur") or "USD"
    p = m.get("p") if m.get("p") is not None else (fund or {}).get("p") if fund else (f or {}).get("price")
    d1, ytd, y1 = m.get("d1", (fund or {}).get("d1")), m.get("ytd", (fund or {}).get("ytd")), m.get("y1", (fund or {}).get("y1"))
    kind = "crypto" if t.endswith("-USD") else "ETF" if fund and not t.endswith("-USD") else "stock"
    where = ", ".join(IX.get(i, i) for i in (s.get("ix") or []))
    url = f"{BASE}stocks/{t}.html"
    sector = m.get("sector") or (f or {}).get("sector")
    industry = m.get("industry") or (f or {}).get("industry")
    rec = m.get("recMean") or (f or {}).get("recommendationMean")
    analysts = m.get("analysts") or (f or {}).get("numberOfAnalystOpinions")
    eps = (r or {}).get("eps") or []
    known = [x for x in eps if x.get("sp") is not None]
    beats = sum(1 for x in known if x["sp"] > 0)
    six = ((r or {}).get("ins") or {}).get("six") or {}

    # ---- title and description, with the figures people search for
    label = {"crypto": "Price", "ETF": "ETF Price", "stock": "Stock Price"}[kind]
    title = f"{sym} {label}: {name} · TopTicker" if name != sym else f"{sym} {label} · TopTicker"
    bits = [f"{name} ({sym}) {'price' if kind != 'stock' else 'stock price'} {money(p, cur)}" + (f", {pct(d1, 2)} on the day" if d1 is not None else "")]
    if y1 is not None:
        bits.append(f"{pct(y1, 0)} over a year")
    if kind == "stock":
        if rec is not None and analysts:
            bits.append(f"analysts rate it {rating(rec)}")
        if m.get("pe"):
            bits.append(f"P/E {m['pe']:.1f}")
        if m.get("divYield"):
            bits.append(f"{m['divYield']:.2f}% dividend yield")
    elif fund and fund.get("fee") is not None:
        bits.append(f"{fund['fee']:.2f}% yearly fee")
    desc = "; ".join(bits) + ". Charts from one day to all time, financials, earnings and more."

    # ---- the facts written into the page (the script replaces them with the interactive view)
    head = f"""<div class="panel quote seo-quote">
      <div class="seo-head"><h2>{e(name)} <span class="muted">{e(sym)}</span></h2>
        <p class="seo-price"><b class="num">{money(p, cur)}</b> <span class="num {cls(d1)}">{pct(d1, 2)}</span> <span class="muted">· {e(cur)}{' · ' + e(where) if where else ''}{' · as of ' + e(m.get('asOf') or (fund or {}).get('asOf') or '') if (m.get('asOf') or (fund or {}).get('asOf')) else ''}</span></p></div>
      {facts_list([
        ("1 week", f'<span class="{cls(m.get("w1", (fund or {}).get("w1")))}">{pct(m.get("w1", (fund or {}).get("w1")))}</span>'),
        ("1 month", f'<span class="{cls(m.get("m1", (fund or {}).get("m1")))}">{pct(m.get("m1", (fund or {}).get("m1")))}</span>'),
        ("Year to date", f'<span class="{cls(ytd)}">{pct(ytd)}</span>'),
        ("1 year", f'<span class="{cls(y1)}">{pct(y1)}</span>'),
        ("52-week range", f'{money(m.get("lo52") or (fund or {}).get("lo52"), cur)} – {money(m.get("hi52") or (fund or {}).get("hi52"), cur)}' if (m.get("hi52") or (fund or {}).get("hi52")) else None),
        ("Market cap", big(m.get("mcap"), cur) if m.get("mcap") else big((fund or {}).get("mcap"), "USD") if (fund or {}).get("mcap") else None),
      ])}
      <p class="hint">Loading the interactive chart…</p>
    </div>"""

    about = []
    if f and f.get("longBusinessSummary"):
        about.append(f"<p>{e(f['longBusinessSummary'][:900])}{'…' if len(f['longBusinessSummary']) > 900 else ''}</p>")
    tags = [x for x in (sector, industry, ", ".join(v for v in ((f or {}).get("city"), (f or {}).get("country")) if v)) if x]
    if fund and kind == "ETF":
        tags = [x for x in (fund.get("fam"), fund.get("cat"), fund.get("g")) if x]
    if tags:
        about.append("<p class=\"tags\">" + "".join(f'<span class="tag">{e(x)}</span>' for x in tags) + "</p>")
    rows = []
    if kind == "stock":
        rows = [
            ("P/E (last 12 months)", f"{m['pe']:.1f}" if m.get("pe") else None),
            ("Forward P/E", f"{m['fpe']:.1f}" if m.get("fpe") else None),
            ("EPS (12 months)", money(m.get("eps"), cur) if m.get("eps") is not None else None),
            ("Revenue growth", pct(m.get("revGrowth")) if m.get("revGrowth") is not None else None),
            ("Profit margin", pct(m.get("margin"), 1, False) if m.get("margin") is not None else None),
            ("Dividend yield", f"{m['divYield']:.2f}%" if m.get("divYield") else "None" if m else None),
            ("Beta", f"{m['beta']:.2f}" if m.get("beta") is not None else None),
            ("Analyst rating", f"{rating(rec)} ({analysts} analysts)" if rec is not None and analysts else None),
            ("Average price target", money(m.get("target"), cur) + (f" ({pct(m.get('upside'), 0)})" if m.get("upside") is not None else "") if m.get("target") else None),
            ("Next earnings", e(m.get("earnings")) if m.get("earnings") else None),
        ]
    elif fund and kind == "ETF":
        rows = [("Yearly fee", f"{fund['fee']:.2f}%" if fund.get("fee") is not None else None),
                ("Yield", f"{fund['yld']:.2f}%" if fund.get("yld") is not None else None),
                ("Fund size", big(fund.get("aum"), cur) if fund.get("aum") else None),
                ("3-year average return", pct(fund.get("y3")) if fund.get("y3") is not None else None)]
    lines = []
    if known:
        lines.append(f"Beat earnings expectations in {beats} of the last {len(known)} quarters"
                     + (f"; latest quarter {('beat' if known[0]['sp'] > 0 else 'missed')} by {abs(known[0]['sp']):.0f}%" if known else "") + ".")
    if six.get("bn") or six.get("sn"):
        lines.append(f"Insiders made {six.get('bn', 0)} purchases and {six.get('sn', 0)} sales over the last six months.")
    if fund and fund.get("hold"):
        lines.append("Top holdings: " + ", ".join(f"{e(h['n'])} ({h['w']:.1f}%)" for h in fund["hold"][:5]) + ".")
    body = f"""<div class="panel fund seo-fund">
      <h2>About {e(name)}</h2>
      {''.join(about)}
      {facts_list(rows) if rows else ''}
      {''.join(f'<p>{x}</p>' for x in lines)}
      <p class="hint">Figures from Yahoo Finance, updated every weekday after the US close. Not financial advice.</p>
    </div>"""

    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": url, "url": url, "name": title.replace(" · TopTicker", ""), "description": desc,
         "dateModified": now.date().isoformat(), "isPartOf": {"@type": "WebSite", "name": "TopTicker", "url": BASE}},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "TopTicker", "item": BASE},
            {"@type": "ListItem", "position": 2, "name": "Stock Lookup", "item": BASE + "stock.html"},
            {"@type": "ListItem", "position": 3, "name": f"{sym}", "item": url}]},
    ]}
    if kind == "stock":
        ld["@graph"].append({"@type": "Corporation", "name": name, "tickerSymbol": sym,
                             **({"description": f['longBusinessSummary'][:300]} if f and f.get("longBusinessSummary") else {}),
                             **({"url": f["website"]} if f and str(f.get("website", "")).startswith("http") else {})})

    out = tpl
    out = out.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="../">', 1)
    out = re.sub(r"<title>.*?</title>", f"<title>{e(title)}</title>", out, count=1)
    out = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{e(desc)}">\n<link rel="canonical" href="{e(url)}">', out, count=1)
    out = re.sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{e(title)}">', out, count=1)
    out = re.sub(r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{e(desc)}">\n<meta property="og:url" content="{e(url)}">', out, count=1)
    ld_text = json.dumps(ld, ensure_ascii=False).replace("</", "<\\/")
    out = out.replace("</head>", f'<script type="application/ld+json">{ld_text}</script>\n</head>', 1)
    out = out.replace("<body>", f'<body data-t="{e(t)}">', 1)
    out = re.sub(r"<h1>Stock lookup</h1>\s*<p>.*?</p>",
                 f"<h1>{e(name)} ({e(sym)}) {'price' if kind != 'stock' else 'stock'}</h1>\n    <p>{e(desc)}</p>", out, count=1, flags=re.S)
    out = out.replace('<section id="quote" aria-live="polite"></section>', f'<section id="quote" aria-live="polite">{head}</section>', 1)
    out = out.replace('<section id="fund"></section>', f'<section id="fund">{body}</section>', 1)
    return out


def build():
    now = datetime.now(timezone.utc)
    tpl = (SITE / "stock.html").read_text()
    stocks = read_json(SITE / "stocks.json", []) or []
    market = {s["t"]: s for s in (read_json(SITE / "market.json", {}) or {}).get("stocks", [])}
    funds = read_json(SITE / "funds.json", {}) or {}
    fund_rows = {x["t"]: x for x in (funds.get("etfs") or []) + (funds.get("crypto") or [])}
    todo = [s for s in stocks if s.get("t") and not s.get("index")]
    have = {s["t"] for s in todo}
    todo += [{"t": t, "s": t.replace("-USD", ""), "n": x.get("n"), "cur": x.get("cur") or "USD"} for t, x in fund_rows.items() if t not in have]
    OUT.mkdir(parents=True, exist_ok=True)
    made = set()
    for s in todo:
        t = s["t"]
        if not SAFE.match(t):
            continue
        key = t.replace("^", "_")
        f = read_json(SITE / "fund" / f"{key}.json", None)
        r = read_json(SITE / "ratings" / f"{key}.json", None)
        try:
            write_text(OUT / f"{t}.html", page_for(tpl, s, market.get(t, {}), f, r, fund_rows.get(t), now))
            made.add(f"{t}.html")
        except Exception as ex:  # one bad record shouldn't stop the rest
            log(f"{t}: {ex}")
    # Pages for stocks that left every list (unless this run's lists came back short)
    for old in (OUT.glob("*.html") if len(made) >= 0.8 * len(list(OUT.glob("*.html"))) else []):
        if old.name not in made:
            old.unlink()
    log(f"stock pages: wrote {len(made)} to site/stocks/")


if __name__ == "__main__":
    build()
