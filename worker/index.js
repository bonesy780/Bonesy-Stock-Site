// Live price service for the site. GitHub Pages can only serve files, and
// Yahoo Finance doesn't let browsers call it directly, so this Cloudflare
// Worker fetches quotes for the page and caches them for a few seconds.
//
//   GET /quote?symbols=AAPL,SHOP.TO,^GSPC   -> { "AAPL": { price, prevClose, chg1d, time }, ... }
//   GET /chart?symbol=AAPL&range=1d          -> { t, i: [[unixSeconds, close], ...], prevClose }

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

async function yahoo(symbol, range, interval, ttl) {
  const url = `${YAHOO}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
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

async function chart(symbol, range) {
  const r = await yahoo(symbol, range, "5m", CHART_TTL);
  const ts = r.timestamp || [], close = r.indicators?.quote?.[0]?.close || [];
  const nd = Math.abs(r.meta.regularMarketPrice || 0) >= 100 ? 2 : 4;
  const i = [];
  ts.forEach((t, n) => { if (close[n] != null) i.push([t, +close[n].toFixed(nd)]); });
  return { t: symbol, i, prevClose: r.meta.chartPreviousClose ?? r.meta.previousClose, price: r.meta.regularMarketPrice };
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
