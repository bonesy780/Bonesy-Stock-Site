// Live price service for the site. GitHub Pages can only serve files, and
// Yahoo Finance doesn't let browsers call it directly, so this Cloudflare
// Worker fetches quotes for the page and caches them for a few seconds.
//
//   GET /quote?symbols=AAPL,SHOP.TO,^GSPC   -> { "AAPL": { price, prevClose, chg1d, time }, ... }
//   GET /chart?symbol=AAPL&range=1d          -> { t, i: [[unixSeconds, close, volume], ...], prevClose, price, post }
//     post is the after-hours trade since the last close, { price, chg, time }, or null
//     (most exchanges outside the US have no after-hours session)

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/";
const MAX_SYMBOLS = 40;          // free Workers allow 50 outbound fetches per request
const QUOTE_TTL = 20;            // seconds
const CHART_TTL = 60;
const SYMBOL = /^[\^A-Za-z0-9.\-=]{1,20}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body, status = 200, ttl = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
  });
}

async function yahoo(symbol, range, interval, ttl, prePost = false) {
  const url = `${YAHOO}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=${prePost}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketLeaders/1.0)" },
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const r = (await res.json())?.chart?.result?.[0];
  if (!r) throw new Error("no data");
  return r;
}

async function quote(symbol) {
  const r = await yahoo(symbol, "1d", "5m", QUOTE_TTL);
  const m = r.meta;
  const price = m.regularMarketPrice;
  const prev = m.chartPreviousClose ?? m.previousClose;
  return {
    price,
    prevClose: prev,
    chg1d: price != null && prev ? (price / prev - 1) * 100 : null,
    time: m.regularMarketTime,
    state: m.currentTradingPeriod?.regular
      && Date.now() / 1000 >= m.currentTradingPeriod.regular.start
      && Date.now() / 1000 < m.currentTradingPeriod.regular.end ? "open" : "closed",
  };
}

// Trading sessions from the chart's meta: tradingPeriods holds one list per day
// (or a flat list) for each of pre, regular and post
function periods(m, kind) {
  const tp = m.tradingPeriods;
  const list = tp && !Array.isArray(tp) ? tp[kind] : kind === "regular" ? tp : null;
  const flat = (Array.isArray(list) ? list.flat() : []).filter((p) => p && p.start != null && p.end != null);
  if (!flat.length && m.currentTradingPeriod?.[kind]) flat.push(m.currentTradingPeriod[kind]);
  return flat.sort((a, b) => a.start - b.start);
}

function bars(r) {
  const q = r.indicators?.quote?.[0] || {};
  const ts = r.timestamp || [], close = q.close || [], volume = q.volume || [];
  const nd = Math.abs(r.meta.regularMarketPrice || 0) >= 100 ? 2 : 4;
  const out = [];
  ts.forEach((t, n) => { if (close[n] != null) out.push([t, +close[n].toFixed(nd), volume[n] ?? null]); });
  return out;
}

async function chart(symbol, range) {
  // Ask for extended hours too, then keep the regular session for the chart
  // and pull out the after-hours trades that follow the last close
  const r = await yahoo(symbol, range, "5m", CHART_TTL, true);
  const m = r.meta;
  const reg = periods(m, "regular");
  let i = bars(r), post = null;
  if (reg.length) {
    const inReg = (t) => reg.some((p) => t >= p.start && t < p.end);
    const close = reg.filter((p) => p.start <= Date.now() / 1000).pop();
    const posts = periods(m, "post");
    const after = close ? i.filter((p) => p[0] >= close.end && posts.some((q) => p[0] >= q.start && p[0] < q.end)) : [];
    i = i.filter((p) => inReg(p[0]));
    const last = after[after.length - 1];
    if (last && m.regularMarketPrice) {
      post = { price: last[1], chg: (last[1] / m.regularMarketPrice - 1) * 100, time: last[0] };
    }
  } else {
    // Sessions unknown: fall back to the regular-hours chart and skip after hours
    i = bars(await yahoo(symbol, range, "5m", CHART_TTL));
  }
  return { t: symbol, i, prevClose: m.chartPreviousClose ?? m.previousClose, price: m.regularMarketPrice, post };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return json({ error: "GET only" }, 405);
    const url = new URL(request.url);

    if (url.pathname === "/quote") {
      const symbols = [...new Set((url.searchParams.get("symbols") || "").split(",").map((s) => s.trim()).filter((s) => SYMBOL.test(s)))];
      if (!symbols.length) return json({ error: "symbols required" }, 400);
      if (symbols.length > MAX_SYMBOLS) return json({ error: `at most ${MAX_SYMBOLS} symbols` }, 400);
      const out = {};
      await Promise.all(symbols.map(async (s) => {
        try { out[s] = await quote(s); } catch { /* leave it out; the page keeps its saved price */ }
      }));
      return json(out, 200, QUOTE_TTL);
    }

    if (url.pathname === "/chart") {
      const symbol = url.searchParams.get("symbol") || "";
      const range = url.searchParams.get("range") === "5d" ? "5d" : "1d";
      if (!SYMBOL.test(symbol)) return json({ error: "bad symbol" }, 400);
      try { return json(await chart(symbol, range), 200, CHART_TTL); }
      catch (e) { return json({ error: String(e.message || e) }, 502); }
    }

    return json({ ok: true, routes: ["/quote?symbols=AAPL,MSFT", "/chart?symbol=AAPL&range=1d"] });
  },
};
