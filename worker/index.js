// Live price service for the site. GitHub Pages can only serve files, and
// Yahoo Finance doesn't let browsers call it directly, so this Cloudflare
// Worker fetches quotes for the page and caches them for a few seconds.
//
//   GET /quote?symbols=AAPL,SHOP.TO,^GSPC   -> { "AAPL": { price, prevClose, chg1d, time }, ... }
//   GET /chart?symbol=AAPL&range=1d          -> { t, i: [[unixSeconds, close, volume], ...], prevClose, price, post }
//     post is the after-hours trade since the last close, { price, chg, time }, or null
//     (most exchanges outside the US have no after-hours session)
//   GET  /ask                                -> { ai: true|false } whether Claude answers are switched on
//   POST /ask { question, history }          -> { answer } from Claude, using the site's notes on
//     where its data comes from (ask-kb.json, copied in by the deploy workflow). Needs the
//     ANTHROPIC_API_KEY secret; without it the Ask page answers from the notes by itself.

import KB from "./ask-kb.json";

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/";
const MAX_SYMBOLS = 40;          // free Workers allow 50 outbound fetches per request
const QUOTE_TTL = 20;            // seconds
const CHART_TTL = 60;
const SYMBOL = /^[\^A-Za-z0-9.\-=]{1,20}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ---- Ask: Claude answers questions about how the site gets its data
const ASK_MODEL = "claude-opus-5-5";
const MAX_QUESTION = 600;          // characters
const MAX_HISTORY = 6;             // earlier messages sent along for follow-up questions
const PER_MINUTE = 6, PER_DAY = 60; // questions per visitor (per worker instance; a rough guard on cost)
// Only the site itself (and local testing) may use it, so other websites can't run up the bill
const ASK_ORIGINS = [/^https:\/\/bonesy780\.github\.io$/i, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const seen = new Map();

const SYSTEM = `You answer questions from visitors to "TopTicker", a free stock market website, about how the site gets and works out its data. Below are the site's own notes, written from its code. Answer from these notes.

Rules:
- Keep answers short: two to five plain sentences, no headings. Use a short list only when it really helps.
- If the notes don't cover the question, say you don't know that detail rather than guessing, and point to the closest topic you do know.
- You can explain financial terms (P/E, RSI, market cap and so on) in general, but don't give investment advice or say whether to buy or sell anything.
- You can't see live prices or a particular stock's numbers; say so if asked, and point to the page that shows them.
- Name pages by their menu name (Stock Lookup, Screener, Movers, Signals, Analysts, Dividends, Earnings, Calendar, Heatmap, Compare, Backtest, Options, Alerts, Calculators, News, Watchlists, Paper Trading, Daily Brief).

The site's notes:
${KB.map((k) => `## ${k.title}\n${k.answer}`).join("\n\n")}`;

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

async function ask(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!ASK_ORIGINS.some((re) => re.test(origin))) return json({ error: "not allowed" }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Claude answers are not switched on" }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const question = String(body?.question || "").trim().slice(0, MAX_QUESTION);
  if (!question) return json({ error: "question required" }, 400);
  if (limited(request.headers.get("CF-Connecting-IP") || "?")) return json({ error: "Too many questions, try again in a minute" }, 429);
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.text.slice(0, 2000) }));
  while (history.length && history[0].role !== "user") history.shift();
  const messages = [...history, { role: "user", content: question }];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.ASK_MODEL || ASK_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      fallbacks: "default",
      // The notes are the same for every question, so cache them
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
    }),
  });
  if (!res.ok) return json({ error: `Claude is unavailable right now (${res.status})` }, 502);
  const out = await res.json();
  if (out.stop_reason === "refusal") return json({ answer: "I can't help with that one. Try asking how a particular number on the site is worked out." });
  const answer = (out.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return answer ? json({ answer }) : json({ error: "no answer" }, 502);
}

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
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === "/ask") {
      if (request.method === "POST") {
        try { return await ask(request, env); } catch (e) { return json({ error: "Claude is unavailable right now" }, 502); }
      }
      return json({ ai: !!env.ANTHROPIC_API_KEY });
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

    return json({ ok: true, routes: ["/quote?symbols=AAPL,MSFT", "/chart?symbol=AAPL&range=1d", "/ask"] });
  },
};
