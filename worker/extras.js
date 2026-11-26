// Explain this stock, push alerts and accounts, for the live service in index.js.
//
//   POST /explain { t }                        -> { text, asOf } a plain-language take on a stock from Claude, written
//                                                 from the site's own saved figures (fund/ and ratings/ files). Cached
//                                                 per stock for 12 hours, so each stock costs at most two answers a day.
//   GET  /push/key                             -> { key } the public key browsers subscribe with (made on first use)
//   POST /push/sync { sub, alerts }            -> { ok, n } saves a browser's push subscription and its price alerts
//   POST /push/remove { endpoint }             -> { ok }
//   GET  /push/inbox?ep=<endpoint>             -> { fired: [...] } alerts that fired for that browser (read by sw.js)
//   POST /account/create                       -> { key } a new account key (shown once; it is the only way in)
//   POST /account/get { key }                  -> { data, at }
//   POST /account/put { key, data: { name: { v, at } } } -> { data, at } merged, newest copy of each item wins
//   POST /account/delete { key }               -> { ok }
//
// Push alerts and accounts live in one Durable Object (Store, SQLite-backed, free plan). Every 5 minutes the cron
// trigger asks it to check every saved alert against Yahoo prices and push the ones that hit. The push itself carries
// no message (so nothing needs encrypting): the browser's service worker (site/sw.js) wakes up, asks /push/inbox what
// fired and shows the notification.

const SITE = "https://www.topticker.ca";
const EXPLAIN_TTL = 12 * 3600;
const MAX_ALERTS = 60;            // per browser
const MAX_SUBS = 5000;
const MAX_ACCOUNT_BYTES = 400000;
const ACCOUNT_KEY = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/;
// Push services browsers use. Anything else is refused, so the service can't be pointed at other addresses.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/, /^[a-z0-9-]+\.push\.services\.mozilla\.com$/, /^android\.googleapis\.com$/];
const SPARK = ["https://query1.finance.yahoo.com/v8/finance/spark", "https://query2.finance.yahoo.com/v8/finance/spark"];

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = new TextEncoder();
async function sha(text) { return b64u(await crypto.subtle.digest("SHA-256", enc.encode(text))).slice(0, 32); }

// ---------------------------------------------------------------- Explain this stock

const EXPLAIN_SYSTEM = `You explain one stock to an everyday investor on "TopTicker", a free stock market website, using only the figures given to you (saved by the site from Yahoo Finance).

Write three short paragraphs, about 170 words in all, in plain words with no headings or lists:
1. What the company does and how big it is.
2. How the business and the stock are doing: growth, profit, debt, valuation, recent price trend, and what analysts and insiders are doing, as far as the figures show.
3. What to watch: the main risks the figures point to and the next earnings date if given.

Rules:
- Use only the figures provided. If something isn't there, leave it out rather than guess. Never invent numbers.
- Explain any finance term you use in a few words (for example "P/E, the price per dollar of yearly profit").
- Don't tell the reader to buy, sell or hold, and don't predict the price. Bold at most two key numbers with **double asterisks**.`;

function factsFor(t, f, r) {
  const keep = {};
  for (const [k, v] of Object.entries(f || {})) {
    if (v == null || v === "" || k === "longBusinessSummary") continue;
    keep[k] = typeof v === "number" ? +v.toPrecision(5) : v;
  }
  if (f && f.longBusinessSummary) keep.business = String(f.longBusinessSummary).slice(0, 900);
  if (r) {
    if (r.eps) keep.earningsLast4Quarters = r.eps.map((e) => ({ quarterEnded: e.q, epsActual: e.a, epsExpected: e.e, surprisePct: e.sp, moveOnReactionDayPct: e.mv }));
    if (r.ins) {
      keep.insidersLast6Months = r.ins.six;
      keep.insiderTradesLastYear = (r.ins.trades || []).filter((x) => x.k === "buy" || x.k === "sell").slice(0, 8)
        .map((x) => ({ date: x.d, role: x.rel, kind: x.k, value: x.v }));
    }
    if (r.actions) keep.analystRatingChanges = r.actions.slice(0, 6).map((a) => ({ date: a.d, firm: a.firm, action: a.act, rating: a.to, target: a.pt }));
  }
  return `Stock: ${t}\nFigures (JSON):\n${JSON.stringify(keep)}`;
}

export async function explain(request, env, ctx, { json, limited, allowed }) {
  if (!allowed(request)) return json({ error: "not allowed" }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Claude answers are not switched on" }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const t = String(body?.t || "").trim();
  if (!/^[A-Za-z0-9.\-=]{1,20}$/.test(t)) return json({ error: "bad symbol" }, 400);
  const site = env.SITE_URL || SITE;
  const now = new Date();
  const cacheKey = new Request(`${site}/__explain/${encodeURIComponent(t)}/${now.toISOString().slice(0, 10)}-${now.getUTCHours() < 12 ? "am" : "pm"}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return json(await hit.json());
  if (limited(request.headers.get("CF-Connecting-IP") || "?")) return json({ error: "Too many requests, try again in a minute" }, 429);
  const file = (p) => fetch(`${site}/${p}/${encodeURIComponent(t.replace("^", "_"))}.json`, { cf: { cacheTtl: 600 } })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [f, r] = await Promise.all([file("fund"), file("ratings")]);
  if (!f) return json({ error: "no saved figures for this stock yet" }, 404);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.ASK_MODEL || "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low" },
      fallbacks: "default",
      system: [{ type: "text", text: EXPLAIN_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: factsFor(t, f, r) }],
    }),
  });
  if (!res.ok) return json({ error: `Claude is unavailable right now (${res.status})` }, 502);
  const out = await res.json();
  const text = (out.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text || out.stop_reason === "refusal") return json({ error: "no answer" }, 502);
  const answer = { text, asOf: f.asOf || null };
  ctx.waitUntil(caches.default.put(cacheKey, new Response(JSON.stringify(answer), { headers: { "Cache-Control": `max-age=${EXPLAIN_TTL}` } })));
  return json(answer);
}

// ---------------------------------------------------------------- push alerts and accounts (Durable Object)

const KINDS = {
  above: (q, v) => q.price >= v,
  below: (q, v) => q.price <= v,
  up: (q, v) => q.chg1d != null && q.chg1d >= v,
  down: (q, v) => q.chg1d != null && q.chg1d <= -v,
};
const SYM = /^[\^A-Za-z0-9.\-=]{1,20}$/;

function cleanAlert(a) {
  if (!a || !SYM.test(String(a.t || "")) || !KINDS[a.kind] || !Number.isFinite(+a.value)) return null;
  return { id: String(a.id || "").slice(0, 24), t: a.t, s: String(a.s || a.t).slice(0, 20), kind: a.kind, value: +a.value,
    cur: /^[A-Z]{3}$/.test(a.cur || "") ? a.cur : "USD", note: String(a.note || "").slice(0, 140) };
}

// Prices for many symbols in a few requests: { SYM: { price, chg1d } }
async function prices(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 20) {
    const batch = symbols.slice(i, i + 20);
    for (const host of SPARK) {
      try {
        const res = await fetch(`${host}?symbols=${batch.map(encodeURIComponent).join(",")}&range=1d&interval=5m`, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketLeaders/1.0)" },
        });
        if (!res.ok) continue;
        const d = await res.json();
        const rows = d?.spark?.result || Object.entries(d || {}).map(([symbol, v]) => ({ symbol, response: [v] }));
        for (const r of rows) {
          const m = r?.response?.[0]?.meta || r?.response?.[0] || {};
          const price = m.regularMarketPrice, prev = m.chartPreviousClose ?? m.previousClose;
          if (r.symbol && price > 0) out[r.symbol] = { price, chg1d: prev > 0 ? (price / prev - 1) * 100 : null };
        }
        break;
      } catch { /* try the other host */ }
    }
  }
  return out;
}

function money(v, cur) {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: v >= 1000 ? 0 : 2 }).format(v); }
  catch { return String(v); }
}
function describe(a) {
  const what = { above: "rose to", below: "fell to", up: "is up", down: "is down" }[a.kind];
  return a.kind === "up" || a.kind === "down" ? `${what} ${a.value}% today` : `${what} ${money(a.value, a.cur)}`;
}

export class Store {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.s = ctx.storage; }

  async vapid() {
    let v = await this.s.get("vapid");
    if (!v) {
      const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      v = { priv: await crypto.subtle.exportKey("jwk", kp.privateKey), pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)) };
      await this.s.put("vapid", v);
    }
    return v;
  }

  async send(sub, v) {
    const url = new URL(sub.endpoint);
    const key = await crypto.subtle.importKey("jwk", v.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const claims = b64u(enc.encode(JSON.stringify({ aud: url.origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE })));
    const sig = b64u(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`)));
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: { Authorization: `vapid t=${head}.${claims}.${sig}, k=${v.pub}`, TTL: "86400", Urgency: "high", "Content-Length": "0" },
    });
    return res.status;
  }

  async check() {
    const subs = await this.s.list({ prefix: "sub:" });
    const symbols = new Set();
    for (const rec of subs.values()) for (const a of rec.alerts || []) symbols.add(a.t);
    if (!symbols.size) return { checked: 0 };
    const q = await prices([...symbols].slice(0, 400));
    const v = await this.vapid();
    let pushes = 0;
    for (const [k, rec] of subs) {
      const fired = [];
      rec.alerts = (rec.alerts || []).filter((a) => {
        const p = q[a.t];
        if (!p || !KINDS[a.kind](p, a.value)) return true;
        fired.push({ ...a, firedAt: new Date().toISOString(), firedPrice: p.price, firedChg: p.chg1d,
          text: `${a.s}: ${describe(a)}. Now ${money(p.price, a.cur)}${p.chg1d != null ? ` (${p.chg1d >= 0 ? "+" : ""}${p.chg1d.toFixed(2)}% today)` : ""}.` });
        return false;
      });
      if (!fired.length) continue;
      rec.inbox = [...fired, ...(rec.inbox || [])].slice(0, 30);
      rec.unread = (rec.unread || 0) + fired.length;
      await this.s.put(k, rec);
      if (pushes < 40) {
        pushes++;
        const status = await this.send(rec.sub, v).catch(() => 0);
        // The browser unsubscribed or the subscription expired: forget it
        if (status === 404 || status === 410) await this.s.delete(k);
      }
    }
    return { checked: symbols.size, pushes };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const ok = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });

    if (url.pathname === "/cron") return ok(await this.check());
    if (url.pathname === "/push/key") return ok({ key: (await this.vapid()).pub });

    if (url.pathname === "/push/sync") {
      const sub = body.sub;
      let host;
      try { host = new URL(sub.endpoint).hostname; } catch { return ok({ error: "bad subscription" }, 400); }
      if (!/^https:/.test(sub.endpoint) || !PUSH_HOSTS.some((re) => re.test(host))) return ok({ error: "unknown push service" }, 400);
      const k = "sub:" + await sha(sub.endpoint);
      const old = await this.s.get(k);
      if (!old && (await this.s.get("subCount") || 0) >= MAX_SUBS) return ok({ error: "full" }, 503);
      const alerts = (Array.isArray(body.alerts) ? body.alerts : []).map(cleanAlert).filter(Boolean).slice(0, MAX_ALERTS);
      await this.s.put(k, { sub: { endpoint: sub.endpoint }, alerts, inbox: old?.inbox || [], unread: old?.unread || 0, at: Date.now() });
      if (!old) await this.s.put("subCount", (await this.s.get("subCount") || 0) + 1);
      return ok({ ok: true, n: alerts.length });
    }
    if (url.pathname === "/push/remove") {
      const k = "sub:" + await sha(String(body.endpoint || ""));
      if (await this.s.get(k)) { await this.s.delete(k); await this.s.put("subCount", Math.max(0, (await this.s.get("subCount") || 1) - 1)); }
      return ok({ ok: true });
    }
    if (url.pathname === "/push/inbox") {
      const k = "sub:" + await sha(url.searchParams.get("ep") || "");
      const rec = await this.s.get(k);
      if (!rec) return ok({ fired: [], unread: 0 });
      const out = { fired: rec.inbox || [], unread: rec.unread || 0 };
      if (url.searchParams.get("read") === "1" && rec.unread) { rec.unread = 0; await this.s.put(k, rec); }
      return ok(out);
    }

    // ---- accounts: a random key is the whole login, so nothing personal is stored
    if (url.pathname === "/account/create") {
      const ip = request.headers.get("X-IP") || "?", day = new Date().toISOString().slice(0, 10);
      const lk = `made:${await sha(ip)}:${day}`;
      const n = (await this.s.get(lk)) || 0;
      if (n >= 5) return ok({ error: "Too many new accounts from here today" }, 429);
      await this.s.put(lk, n + 1);
      const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const bytes = crypto.getRandomValues(new Uint8Array(20));
      const key = [...bytes].map((b) => A[b % 32]).join("").match(/.{4}/g).join("-");
      await this.s.put("acct:" + await sha(key), { data: {}, at: Date.now(), created: Date.now() });
      return ok({ key });
    }
    if (url.pathname.startsWith("/account/")) {
      const key = String(body.key || "").toUpperCase().trim();
      if (!ACCOUNT_KEY.test(key)) return ok({ error: "That account key isn't valid" }, 400);
      const k = "acct:" + await sha(key);
      const rec = await this.s.get(k);
      if (!rec) return ok({ error: "No account has that key" }, 404);
      if (url.pathname === "/account/get") return ok({ data: rec.data, at: rec.at });
      if (url.pathname === "/account/delete") { await this.s.delete(k); return ok({ ok: true }); }
      if (url.pathname === "/account/put") {
        const incoming = body.data && typeof body.data === "object" ? body.data : {};
        for (const [name, item] of Object.entries(incoming)) {
          if (!/^[\w:.\-^=]{1,60}$/.test(name) || !item || typeof item.at !== "number") continue;
          const cur = rec.data[name];
          if (!cur || item.at > cur.at) rec.data[name] = { v: item.v ?? null, at: Math.min(item.at, Date.now() + 60000) };
        }
        if (JSON.stringify(rec.data).length > MAX_ACCOUNT_BYTES) return ok({ error: "Your saved data is too big to sync" }, 413);
        rec.at = Date.now();
        await this.s.put(k, rec);
        return ok({ data: rec.data, at: rec.at });
      }
    }
    return ok({ error: "not found" }, 404);
  }
}

// Route /push/* and /account/* to the one Store object
export async function toStore(request, env) {
  if (!env.STORE) return new Response(JSON.stringify({ error: "not set up" }), { status: 503 });
  const stub = env.STORE.get(env.STORE.idFromName("main"));
  const url = new URL(request.url);
  const init = { method: request.method, headers: { "Content-Type": "application/json", "X-IP": request.headers.get("CF-Connecting-IP") || "?" } };
  if (request.method === "POST") init.body = await request.text();
  return stub.fetch(new Request("https://store" + url.pathname + url.search, init));
}

export async function cron(env) {
  if (!env.STORE) return;
  const stub = env.STORE.get(env.STORE.idFromName("main"));
  await stub.fetch(new Request("https://store/cron"));
}
