// Live price service for the site. GitHub Pages can only serve files, and
// Yahoo Finance doesn't let browsers call it directly, so this Cloudflare
// Worker fetches quotes for the page and caches them for a few seconds.
//
//   GET /quote?symbols=AAPL,SHOP.TO,^GSPC   -> { "AAPL": { price, prevClose, chg1d, time }, ... }
//   GET /chart?symbol=AAPL&range=1d          -> { t, i: [[unixSeconds, close, volume], ...], prevClose, price, post }
//     post is the after-hours trade since the last close, { price, chg, time }, or null
//     (most exchanges outside the US have no after-hours session)
//   GET /history?symbol=ANT                  -> { t, n, x, cur, type, first, hi52, lo52, d: [[day, close, volume], ...], i, post }
//     every daily close back to the listing plus the last 5 days of 5-minute prices (as /chart),
//     so the lookup page can chart a stock that isn't in the site's own lists, such as a new IPO
//   GET /search?q=anthropic                  -> [{ t, n, x, type }] stocks and funds matching a name or symbol
//   GET /news?symbol=AAPL                    -> [{ title, url, source, time }] the stock's latest headlines (newest first)
//   POST /explain, /push/*, /account/*         -> see extras.js (Explain this stock, push alerts, accounts)

import { explain, toStore, cron, Store } from "./extras.js";

export { Store };

// Yahoo serves the same data from two hosts; when one rate-limits or fails, the other usually still answers
const YAHOO_HOSTS = ["https://query1.finance.yahoo.com/v8/finance/chart/", "https://query2.finance.yahoo.com/v8/finance/chart/"];
const MAX_SYMBOLS = 40;          // free Workers allow 50 outbound fetches per request
const QUOTE_TTL = 20;            // seconds
const CHART_TTL = 60;
const HISTORY_TTL = 300;
const SEARCH_TTL = 3600;
const NEWS_TTL = 900;
const SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search";
const SYMBOL = /^[\^A-Za-z0-9.\-=]{1,20}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ---- Requests that reach Claude (Explain this stock, in extras.js): limits on use and who may call
const PER_MINUTE = 6, PER_DAY = 60; // Claude requests per visitor (per worker instance; a rough guard on cost)
// Only the site itself (and local testing) may use it, so other websites can't run up the bill
const SITE_ORIGINS = [/^https:\/\/bonesy780\.github\.io$/i, /^https:\/\/(www\.)?topticker\.ca$/i, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const seen = new Map();

function limited(ip) {
  const now = Date.now();
  const r = seen.get(ip) || { min: now, n: 0, day: now, d: 0 };
  if (now - r.min > 60000) { r.min = now; r.n = 0; }
  if (now - r.day > 86400000) { r.day = now; r.d = 0; }
  if (r.n >= PER_MINUTE || r.d >= PER_DAY) return true;
  r.n++; r.d++;
  seen.set(ip, r);
  if (seen.size > 5000) seen.delete(seen.keys().next().value);
  return false;
}

function json(body, status = 200, ttl = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
  });
}

// Only good answers are cached. Caching everything for `ttl` also kept Yahoo's refusals (429s and errors)
// for that long, so one refused request left a stock without a live price (or a search without results,
// for an hour) for every visitor.
const cacheOk = (ttl) => ({ cacheTtlByStatus: { "200-299": ttl, "404": 60, "400-599": 0 }, cacheEverything: true });

async function yahoo(symbol, range, interval, ttl, prePost = false) {
  const path = `${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=${prePost}`;
  let err = null;
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketLeaders/1.0)" },
        cf: cacheOk(ttl),
      });
      if (res.status === 404) throw Object.assign(new Error("yahoo 404"), { final: true });
      if (!res.ok) throw new Error(`yahoo ${res.status}`);
      const r = (await res.json())?.chart?.result?.[0];
      // A reply without a usable price is as good as no reply
      if (!r || !(r.meta?.regularMarketPrice > 0)) throw new Error("no data");
      return r;
    } catch (e) {
      err = e;
      if (e.final) break;
    }
  }
  throw err;
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

// Everything the lookup page needs for a symbol it has no saved file for
async function history(symbol) {
  const [daily, recent] = await Promise.all([
    // Yahoo refuses range=max for a stock in its first days of trading, so fall back to 5 days
    yahoo(symbol, "max", "1d", HISTORY_TTL).catch(() => yahoo(symbol, "5d", "1d", HISTORY_TTL)),
    chart(symbol, "5d").catch(() => null),
  ]);
  const m = daily.meta;
  return {
    t: symbol,
    n: m.longName || m.shortName || symbol,
    x: m.fullExchangeName || m.exchangeName || null,
    cur: m.currency || "USD",
    type: m.instrumentType || null,
    first: m.firstTradeDate ?? null,
    hi52: m.fiftyTwoWeekHigh ?? null,
    lo52: m.fiftyTwoWeekLow ?? null,
    d: bars(daily),
    i: recent ? recent.i : [],
    post: recent ? recent.post : null,
    price: m.regularMarketPrice ?? null,
  };
}

// Yahoo's symbol search, kept to stocks and funds
async function lookup(q) {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketLeaders/1.0)" },
    cf: cacheOk(SEARCH_TTL),
  });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const quotes = (await res.json())?.quotes || [];
  return quotes
    .filter((r) => r && SYMBOL.test(r.symbol || "") && ["EQUITY", "ETF"].includes(r.quoteType))
    .slice(0, 8)
    .map((r) => ({ t: r.symbol, n: r.longname || r.shortname || r.symbol, x: r.exchDisp || null, type: r.quoteType }));
}

// A stock's latest headlines from Yahoo's search, for the heatmap's hover cards. Stories Yahoo tags with
// the symbol come first; the search can also return general market stories, which are left out when tagged ones exist.
async function news(symbol) {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=8&listsCount=0&enableFuzzyQuery=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketLeaders/1.0)" },
    cf: cacheOk(NEWS_TTL),
  });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const items = ((await res.json())?.news || []).filter((n) => n && n.title && /^https?:\/\//.test(n.link || ""));
  const sym = symbol.toUpperCase();
  const tagged = items.filter((n) => (n.relatedTickers || []).some((r) => String(r).toUpperCase() === sym));
  return (tagged.length ? tagged : items)
    .sort((a, b) => (b.providerPublishTime || 0) - (a.providerPublishTime || 0))
    .slice(0, 3)
    .map((n) => ({ title: String(n.title).slice(0, 300), url: n.link, source: n.publisher || null, time: n.providerPublishTime || null }));
}

const fromSite = (request) => SITE_ORIGINS.some((re) => re.test(request.headers.get("Origin") || ""));
const withCors = async (res) => {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  out.headers.set("Cache-Control", "no-store");
  return out;
};

export default {
  // Every 5 minutes (wrangler.toml): check saved push alerts against prices
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cron(env));
  },

  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === "/explain" && request.method === "POST") {
      try { return await explain(request, env, ctx, { json, limited, allowed: fromSite }); }
      catch (e) { return json({ error: "Claude is unavailable right now" }, 502); }
    }
    if (url.pathname.startsWith("/push/") || url.pathname.startsWith("/account/")) {
      // Only the site may change saved alerts and accounts; the service worker's inbox read is a plain GET
      if (request.method === "POST" && !fromSite(request)) return json({ error: "not allowed" }, 403);
      try { return await withCors(await toStore(request, env)); }
      catch (e) { return json({ error: "Saved alerts and accounts are unavailable right now" }, 502); }
    }
    if (request.method !== "GET") return json({ error: "GET only" }, 405);

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

    if (url.pathname === "/history") {
      const symbol = url.searchParams.get("symbol") || "";
      if (!SYMBOL.test(symbol)) return json({ error: "bad symbol" }, 400);
      try { return json(await history(symbol), 200, CHART_TTL); }
      catch (e) { return json({ error: String(e.message || e) }, 404); }
    }

    if (url.pathname === "/search") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 40);
      if (!q) return json([]);
      try { return json(await lookup(q), 200, SEARCH_TTL); }
      catch (e) { return json({ error: String(e.message || e) }, 502); }
    }

    if (url.pathname === "/news") {
      const symbol = url.searchParams.get("symbol") || "";
      if (!SYMBOL.test(symbol)) return json({ error: "bad symbol" }, 400);
      try { return json(await news(symbol), 200, NEWS_TTL); }
      catch (e) { return json({ error: String(e.message || e) }, 502); }
    }

    return json({ ok: true, routes: ["/quote?symbols=AAPL,MSFT", "/chart?symbol=AAPL&range=1d", "/history?symbol=AAPL", "/search?q=apple", "/news?symbol=AAPL"] });
  },
};
