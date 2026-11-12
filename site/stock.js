(async function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (v, cur) => v == null ? "–" : new Intl.NumberFormat(undefined, {
    style: "currency", currency: cur, maximumFractionDigits: v >= 1000 || cur === "JPY" || cur === "KRW" ? 0 : 2,
  }).format(v);
  const plain = (v, cur) => v == null ? "–" : v.toLocaleString(undefined, { maximumFractionDigits: v >= 1000 || cur === "JPY" || cur === "KRW" ? 0 : 2 });
  const pct = (v) => v == null ? '<span class="num">–</span>' :
    `<span class="num ${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(2)}%</span>`;
  const big = (v) => {
    if (v == null) return "–";
    for (const [n, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"]]) if (v >= n) return "$" + (v / n).toFixed(v / n >= 100 ? 0 : 1) + s;
    return "$" + Math.round(v);
  };

  let stocks, details = {};
  try {
    stocks = await (await fetch("stocks.json", { cache: "no-store" })).json();
  } catch (e) {
    $("updated").textContent = "Stock list could not be loaded.";
    return;
  }
  // Extra facts (market cap, analysts, dividends) for stocks the main page covers
  fetch("data.json", { cache: "no-store" }).then((r) => r.json()).then((d) => {
    if (!$("updated").querySelector(".live-dot")) $("updated").textContent = "Updated " + new Date(d.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const all = d.indexes.flatMap((i) => i.top.concat(i.largest || [])).concat(d.buyIdeas, d.sellIdeas || [], d.watchlist);
    for (const s of all) details[s.ticker] = { ...details[s.ticker], ...s };
    if (window.startRain) window.startRain(d.rainTickers || []);
    if (current) renderQuote();
  }).catch(() => { $("updated").textContent = ""; });

  // ---- search
  const q = $("q"), list = $("results");
  let matches = [], active = -1;
  const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[^\w ]/g, "");
  function search(text) {
    const t = norm(text.trim());
    if (!t) return [];
    const scored = [];
    for (const s of stocks) {
      const sym = s.s.toLowerCase(), tick = s.t.toLowerCase(), name = norm(s.n);
      let score = sym === t || tick === t ? 0 : sym.startsWith(t) ? 1 : name.startsWith(t) ? 2
        : name.split(" ").some((w) => w.startsWith(t)) ? 3 : name.includes(t) || tick.includes(t) ? 4 : -1;
      if (score >= 0) scored.push([score, s.n.length, s]);
    }
    return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 8).map((x) => x[2]);
  }
  function showResults() {
    list.hidden = !matches.length;
    q.setAttribute("aria-expanded", String(matches.length > 0));
    list.innerHTML = matches.map((s, n) => `
      <li role="option" id="opt${n}" aria-selected="${n === active}" data-t="${esc(s.t)}">
        <span class="nm">${esc(s.n)}</span>
        <span class="tk">${esc(s.s)} · ${esc(s.index ? s.region : s.ix.join(", "))}</span>
      </li>`).join("");
    if (active >= 0) q.setAttribute("aria-activedescendant", "opt" + active); else q.removeAttribute("aria-activedescendant");
  }
  q.addEventListener("input", () => { matches = search(q.value); active = matches.length ? 0 : -1; showResults(); });
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!matches.length) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      showResults();
    } else if (e.key === "Enter" && matches[active]) {
      e.preventDefault();
      pick(matches[active].t);
    } else if (e.key === "Escape") {
      matches = []; showResults();
    }
  });
  list.addEventListener("pointerdown", (e) => {
    const li = e.target.closest("li");
    if (li) { e.preventDefault(); pick(li.dataset.t); }
  });
  q.addEventListener("blur", () => { matches = []; showResults(); });

  // ---- quote and chart
  const RANGES = [["1D", 1], ["5D", 5], ["1M", 30], ["3M", 91], ["6M", 182], ["YTD", "ytd"], ["1Y", 365], ["5Y", 1826], ["All", 0]];
  let current = null, hist = null;
  let range = (() => { try { return localStorage.getItem("lookupRange"); } catch { return null; } })() || "1Y";

  // ---- technical indicators, worked out in the browser from the closing prices
  function sma(c, n) {
    const out = Array(c.length).fill(null);
    let sum = 0;
    for (let i = 0; i < c.length; i++) {
      sum += c[i];
      if (i >= n) sum -= c[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }
  // Exponential average, seeded with the plain average of the first n values; skips leading gaps
  function ema(c, n) {
    const out = Array(c.length).fill(null);
    const f = c.findIndex((v) => v != null);
    if (f < 0 || c.length - f < n) return out;
    const k = 2 / (n + 1);
    let e = 0;
    for (let i = f; i < f + n; i++) e += c[i] / n;
    out[f + n - 1] = e;
    for (let i = f + n; i < c.length; i++) out[i] = e = c[i] * k + e * (1 - k);
    return out;
  }
  function bollinger(c, n = 20, w = 2) {
    const mid = sma(c, n), up = Array(c.length).fill(null), lo = Array(c.length).fill(null);
    for (let i = n - 1; i < c.length; i++) {
      let v = 0;
      for (let j = i - n + 1; j <= i; j++) v += (c[j] - mid[i]) ** 2;
      const sd = Math.sqrt(v / n);
      up[i] = mid[i] + w * sd; lo[i] = mid[i] - w * sd;
    }
    return { mid, up, lo };
  }
  // Wilder's relative strength index
  function rsi(c, n = 14) {
    const out = Array(c.length).fill(null);
    let g = 0, l = 0;
    const val = () => (g === 0 && l === 0 ? 50 : l === 0 ? 100 : 100 - 100 / (1 + g / l));
    for (let i = 1; i < c.length; i++) {
      const ch = c[i] - c[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
      if (i <= n) {
        g += up / n; l += dn / n;
        if (i === n) out[i] = val();
      } else {
        g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;
        out[i] = val();
      }
    }
    return out;
  }
  function macd(c, fast = 12, slow = 26, sig = 9) {
    const a = ema(c, fast), b = ema(c, slow);
    const line = c.map((_, i) => (a[i] != null && b[i] != null ? a[i] - b[i] : null));
    const signal = ema(line, sig);
    const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
    return { line, signal, hist };
  }

  // Overlays share the price scale; panels get their own strip under the chart.
  // The same period keeps the same color, solid for simple and dashed for exponential averages.
  const INDICATORS = [
    { id: "sma20", label: "SMA 20", color: "--ind-a", calc: (c) => sma(c, 20), help: "Simple moving average: the average close over the last 20 bars" },
    { id: "sma50", label: "SMA 50", color: "--ind-b", calc: (c) => sma(c, 50), help: "Simple moving average: the average close over the last 50 bars" },
    { id: "sma200", label: "SMA 200", color: "--ind-c", calc: (c) => sma(c, 200), help: "Simple moving average over 200 bars, the usual long-term trend line" },
    { id: "ema20", label: "EMA 20", color: "--ind-a", dash: true, calc: (c) => ema(c, 20), help: "Exponential moving average over 20 bars, weighted toward recent prices" },
    { id: "ema50", label: "EMA 50", color: "--ind-b", dash: true, calc: (c) => ema(c, 50), help: "Exponential moving average over 50 bars, weighted toward recent prices" },
    { id: "bb", label: "Bollinger", color: "--ind-band", help: "Bollinger Bands: a 20-bar average with bands two standard deviations above and below" },
    { id: "vol", label: "Volume", color: "--muted", panel: true, help: "Shares traded in each bar, green when the price closed up and red when it closed down" },
    { id: "rsi", label: "RSI 14", color: "--ind-b", panel: true, help: "Relative Strength Index over 14 bars: above 70 is often read as overbought, below 30 as oversold" },
    { id: "macd", label: "MACD", color: "--accent", panel: true, help: "MACD (12, 26, 9): the gap between 12- and 26-bar exponential averages, its 9-bar signal line, and the difference as bars" },
  ];
  const shown = new Set((() => {
    try { const v = JSON.parse(localStorage.getItem("lookupInd")); if (Array.isArray(v)) return v; } catch {}
    return ["vol"];
  })().filter((id) => INDICATORS.some((m) => m.id === id)));

  async function pick(t, push = true) {
    const s = stocks.find((x) => x.t === t);
    if (!s) return;
    matches = []; showResults();
    q.value = ""; q.blur();
    current = s; hist = null;
    if (push) history.replaceState(null, "", "?t=" + encodeURIComponent(t));
    document.title = `${s.s} · Stock Lookup · Market Leaders`;
    renderQuote();
    try {
      hist = await (await fetch(`hist/${encodeURIComponent(t.replace("^", "_"))}.json`, { cache: "no-store" })).json();
    } catch (e) {
      hist = { d: [], i: [] };
    }
    if (current === s) renderQuote();
    if (current === s) await goLive(s);
  }

  // Swap in today's live prices from the price service, keeping the saved history for longer ranges
  async function goLive(s) {
    if (!(window.Live && Live.on) || !hist) return;
    let live;
    try { live = await Live.chart(s.t, "5d"); } catch (e) { return; }
    if (current !== s || !live.i || !live.i.length) return;
    hist.i = live.i;
    hist.post = live.post || null;
    // The last 5-minute bar can lag the latest trade, so end the line on the live price
    const lastBar = live.i[live.i.length - 1];
    if (live.price != null) live.i[live.i.length - 1] = [lastBar[0], live.price, lastBar[2]];
    const [ts, price] = live.i[live.i.length - 1];
    const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
    // Today's volume so far, from the 5-minute bars, for the daily volume bar
    const today = live.i.filter((p) => day(p[0]) === day(ts) && p[2] != null);
    const vol = today.length ? today.reduce((a, p) => a + p[2], 0) : null;
    const d = hist.d;
    if (!d.length || day(d[d.length - 1][0]) < day(ts)) d.push([ts, price, vol]);
    else d[d.length - 1] = [d[d.length - 1][0], price, vol ?? d[d.length - 1][2]];
    const open = Date.now() / 1000 - ts < 30 * 60;
    $("updated").innerHTML = `<span class="live-dot ${open ? "on" : ""}" aria-hidden="true"></span>${open ? "Live" : "Market closed"} · ${Live.stamp(new Date())}`;
    // Keep the hover tooltip steady: only redraw when no one is pointing at the chart
    if (!document.querySelector("#chart .tip:not([hidden])")) renderQuote();
  }
  if (window.Live && Live.on) {
    let first = true;
    Live.every(60000, () => { if (first) { first = false; return; } return current && hist && goLive(current); });
  }

  // The bars behind the chart. `all` runs at one steady pace (5-minute, daily,
  // weekly or monthly) and starts before the visible window when it can, so
  // moving averages are already warmed up at the left edge. `start` is where
  // the visible window begins.
  const DAY = 86400;
  const dayOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
  // The saved history is daily for the last couple of years and thinner before that
  // (newer builds say where the daily stretch starts; older ones are worked out from the gaps)
  function dailyFrom(d) {
    if (Number.isInteger(hist.df) && hist.df >= 0 && hist.df < d.length) return hist.df;
    let k = d.length - 1;
    while (k > 0 && d[k][0] - d[k - 1][0] < 6.5 * DAY) k--;
    return k;
  }
  const addVol = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));
  // One bar per week or month: [time, last close, volume, extremes], where extremes
  // holds the highest and lowest closes inside the bar as [time, close] (in date
  // order, leaving out the last close itself) so the line still reaches the real peaks.
  function bucket(d, key) {
    const out = [];
    let last, hi, lo;
    const finish = () => {
      const b = out[out.length - 1];
      if (b) b[3] = [hi, lo].filter((p, n, a) => p[0] !== b[0] && a.indexOf(p) === n).sort((x, y) => x[0] - y[0]);
    };
    for (const p of d) {
      const k = key(p[0]);
      if (out.length && k === last) {
        const prev = out[out.length - 1];
        out[out.length - 1] = [p[0], p[1], addVol(prev[2], p[2])];
        if (p[1] > hi[1]) hi = [p[0], p[1]];
        if (p[1] < lo[1]) lo = [p[0], p[1]];
      } else {
        finish();
        out.push([p[0], p[1], p[2] ?? null]);
        last = k; hi = lo = [p[0], p[1]];
      }
    }
    finish();
    return out;
  }
  const weekOf = (ts) => Math.floor((ts / DAY + 3) / 7);
  const monthOf = (ts) => { const t = new Date(ts * 1000); return t.getUTCFullYear() * 12 + t.getUTCMonth(); };

  function series() {
    const d = hist.d, intra = hist.i;
    if (!d.length) return { pts: [], all: [], start: 0, base: null };
    const done = (all, start, base, more) => ({ all, start, pts: all.slice(start), base: base ?? all[start][1], ...more });
    if (range === "1D" || range === "5D") {
      if (intra.length) {
        const days = [...new Set(intra.map((p) => dayOf(p[0])))];
        const keep = days.slice(range === "1D" ? -1 : -5);
        const start = intra.findIndex((p) => dayOf(p[0]) >= keep[0]);
        const before = d.filter((p) => dayOf(p[0]) < keep[0]);
        return done(intra, start, before.length ? before[before.length - 1][1] : intra[start][1], { intraday: true, unit: "5-minute" });
      }
      const all = d.slice(dailyFrom(d));
      return done(all, Math.max(0, all.length - (range === "1D" ? 2 : 6)), null, { unit: "daily" });
    }
    const end = d[d.length - 1][0];
    const r = RANGES.find((x) => x[0] === range)[1];
    let from = 0;
    if (r === "ytd") from = Date.UTC(new Date(end * 1000).getUTCFullYear(), 0, 1) / 1000;
    else if (r) from = end - r * DAY;
    const df = dailyFrom(d);
    let all, unit;
    if (df === 0 || from >= d[df][0] - 5 * DAY) { all = d.slice(df); unit = "daily"; }
    else if (end - Math.max(from, d[0][0]) <= 6.5 * 365 * DAY) { all = bucket(d, weekOf); unit = "weekly"; }
    else { all = bucket(d, monthOf); unit = "monthly"; }
    const idx = all.findIndex((p) => p[0] >= from);
    // start from the last close before the window so the change matches the usual definition
    return done(all, idx > 0 ? idx - 1 : 0, null, { unit });
  }

  function renderQuote() {
    const s = current, x = details[s.t] || {};
    const head = `
      <div class="quote-head">
        <div>
          <h2>${esc(x.name || s.n)}</h2>
          <div class="region">${esc(s.s)} · ${esc(s.index ? s.region + " market index" : s.ix.join(", "))} · ${esc(s.cur)}</div>
        </div>
        <div class="quote-price" id="qp"></div>
      </div>`;
    if (!hist) {
      $("quote").innerHTML = `<div class="panel quote">${head}<div class="empty">Loading prices…</div></div>`;
      return;
    }
    if (!hist.d.length) {
      $("quote").innerHTML = `<div class="panel quote">${head}<div class="empty">No price history for this stock yet.</div></div>`;
      return;
    }
    const S = series(), { pts, base } = S;
    const last = pts[pts.length - 1][1];
    const chg = base ? (last / base - 1) * 100 : null;
    const year = hist.d.filter((p) => p[0] >= hist.d[hist.d.length - 1][0] - 365 * 86400).map((p) => p[1]);
    const stats = [
      ["52W high", plain(Math.max(...year), s.cur)],
      ["52W low", plain(Math.min(...year), s.cur)],
      ["Mkt cap (USD)", big(x.mcapUsd)],
      ["Analysts", x.rating ? esc(x.rating) + (x.analysts ? ` (${x.analysts})` : "") : "–"],
      ["Target", x.target ? plain(x.target, s.cur) : "–"],
      ["Div yield", x.divYield != null ? x.divYield.toFixed(2) + "%" : x.divFreq === "None" ? "None" : "–"],
      ["Pays", x.divFreq && x.divFreq !== "None" ? esc(x.divFreq) : "–"],
    ];
    $("quote").innerHTML = `
      <div class="panel quote">
        ${head}
        <div class="ranges" role="tablist" aria-label="Chart range">${RANGES.map(([r]) =>
          `<button class="tab" role="tab" aria-selected="${r === range}" data-r="${r}">${r}</button>`).join("")}</div>
        <div class="ind-bar" role="group" aria-label="Technical indicators">
          ${INDICATORS.map((m, k) => `${k === 0 || m.panel !== INDICATORS[k - 1].panel ? `<span class="ind-group">${m.panel ? "Panels" : "Overlays"}</span>` : ""}
            <button class="chip" aria-pressed="${shown.has(m.id)}" data-i="${m.id}" title="${esc(m.help)}"><i class="sw ${m.dash ? "dash" : ""}" style="--c:var(${m.color})"></i>${esc(m.label)}</button>`).join("")}
        </div>
        <div class="legend" id="legend"></div>
        <div class="chart" id="chart"></div>
        <div class="ind-note">Indicator periods count ${S.unit} bars.</div>
        <div class="stats quote-stats">${stats.map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value num">${v}</div></div>`).join("")}</div>
      </div>`;
    $("qp").innerHTML = `<div class="value num big">${s.index ? plain(last, s.cur) : money(last, s.cur)}</div><div>${pct(chg)} <span class="tk">${range === "All" ? "all time" : range}</span></div>${afterHours(s)}`;
    $("quote").querySelector(".ranges").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      range = b.dataset.r;
      try { localStorage.setItem("lookupRange", range); } catch {}
      renderQuote();
    });
    $("quote").querySelector(".ind-bar").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const id = b.dataset.i;
      if (shown.has(id)) shown.delete(id); else shown.add(id);
      try { localStorage.setItem("lookupInd", JSON.stringify([...shown])); } catch {}
      renderQuote();
      $("quote").querySelector(`.chip[data-i="${id}"]`).focus();
    });
    drawChart($("chart"), S, chg, s.cur);
  }

  // After-hours trade since the close, from the price service (US listings only;
  // other exchanges have no after-hours session, so nothing shows)
  function afterHours(s) {
    const p = hist && hist.post;
    if (s.index || !p || p.price == null) return "";
    const at = new Date(p.time * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `<div class="after-hours"><span class="tk">After hours</span> <span class="num">${money(p.price, s.cur)}</span> ${pct(p.chg)} <span class="tk">${at}</span></div>`;
  }

  const compact = (v) => v == null ? "–" : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const small = (v) => v == null ? "–" : v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 2 : 3);

  function drawChart(el, S, chg, cur) {
    const { pts, base, intraday } = S;
    const W = el.clientWidth || 800, narrow = W < 500;
    const pad = { l: 8, r: 64, t: 12, b: 28 };
    const mainB = (narrow ? 240 : 320) - pad.b;
    const closes = S.all.map((p) => p[1]);
    const cut = (a) => a.slice(S.start);
    const on = (id) => shown.has(id);

    // Work out what to draw before sizing anything
    const lines = INDICATORS.filter((m) => m.calc && on(m.id)).map((m) => ({ ...m, v: cut(m.calc(closes)) }));
    const bb = on("bb") ? (() => { const b = bollinger(closes); return { mid: cut(b.mid), up: cut(b.up), lo: cut(b.lo) }; })() : null;
    const vols = cut(S.all.map((p) => p[2] ?? null));
    const hasVol = vols.some((v) => v > 0);
    const rs = on("rsi") ? cut(rsi(closes)) : null;
    const md = on("macd") ? (() => { const m = macd(closes); return { line: cut(m.line), signal: cut(m.signal), hist: cut(m.hist) }; })() : null;

    const PH = narrow ? 64 : 80, LBL = 22;
    const panels = [];
    let y0 = mainB;
    for (const id of ["vol", "rsi", "macd"]) {
      if (!on(id)) continue;
      panels.push({ id, top: y0 + LBL, bot: y0 + LBL + PH });
      y0 += LBL + PH;
    }
    const H = y0 + pad.b;

    const ys = pts.flatMap((p) => [p[1], ...(p[3] || []).map((e) => e[1])]);
    for (const l of lines) ys.push(...l.v);
    if (bb) ys.push(...bb.up, ...bb.lo);
    const fin = ys.filter((v) => v != null && isFinite(v));
    let lo = Math.min(...fin, intraday ? base : Infinity), hi = Math.max(...fin, intraday ? base : -Infinity);
    if (hi === lo) { hi += 1; lo -= 1; }
    const span = hi - lo; lo -= span * 0.06; hi += span * 0.06;
    // Even spacing by point index, so nights and weekends don't leave gaps
    const X = (n) => pad.l + (n / Math.max(1, pts.length - 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (mainB - pad.t);
    const color = chg == null || chg >= 0 ? "var(--up)" : "var(--down)";
    // Weekly and monthly bars also pass through their highest and lowest closes,
    // placed between the bar and the one before it by date
    const prevT = (n) => (n > 0 ? pts[n - 1][0] : S.start > 0 ? S.all[S.start - 1][0] : null);
    const line = pts.flatMap((p, n) => {
      const out = [];
      const t0 = prevT(n);
      for (const [t, v] of p[3] || []) {
        if (t0 == null && n === 0) continue; // nothing to the left of the first bar
        const f = Math.min(1, Math.max(0, (t - t0) / Math.max(1, p[0] - t0)));
        out.push(`${X(n - 1 + f).toFixed(1)},${Y(v).toFixed(1)}`);
      }
      out.push(`${X(n).toFixed(1)},${Y(p[1]).toFixed(1)}`);
      return out;
    }).join(" ");
    // A path that breaks wherever the values have a gap (indicators still warming up)
    const path = (vals, yf) => {
      let dd = "", pen = false;
      vals.forEach((v, n) => {
        if (v == null || !isFinite(v)) { pen = false; return; }
        dd += `${pen ? "L" : "M"}${X(n).toFixed(1)},${yf(v).toFixed(1)}`;
        pen = true;
      });
      return dd;
    };
    const barW = Math.max(1, ((W - pad.l - pad.r) / Math.max(1, pts.length)) * 0.7);

    // y gridlines at round numbers
    const step = (() => {
      const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw));
      return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    })();
    const grid = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid.push(v);

    // x labels: about one per 120px
    const fmtX = (ts) => {
      const dt = new Date(ts * 1000);
      if (range === "1D") return dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      if (range === "5D") return dt.toLocaleDateString(undefined, { weekday: "short" });
      if (["1M", "3M", "6M", "YTD", "1Y"].includes(range)) return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    };
    const nLabels = Math.min(pts.length, Math.max(2, Math.floor((W - pad.r) / 120)));
    const xl = [...new Set(Array.from({ length: nLabels }, (_, k) => Math.round((k / (nLabels - 1)) * (pts.length - 1))))];

    // Bollinger band shading: the upper edge forwards, then the lower edge back
    let band = "";
    if (bb) {
      const idx = bb.up.map((v, n) => (v == null ? null : n)).filter((n) => n != null);
      if (idx.length > 1) band = `<polygon class="bb-fill" points="${idx.map((n) => `${X(n).toFixed(1)},${Y(bb.up[n]).toFixed(1)}`).join(" ")} ${idx.slice().reverse().map((n) => `${X(n).toFixed(1)},${Y(bb.lo[n]).toFixed(1)}`).join(" ")}"/>`;
    }

    const panelSvg = panels.map((P) => {
      const h = P.bot - P.top;
      let body = "";
      if (P.id === "vol") {
        if (!hasVol) {
          body = `<text class="axis" x="${(W - pad.r) / 2}" y="${P.top + h / 2 + 4}" text-anchor="middle">No volume data for this range yet</text>`;
        } else {
          const max = Math.max(...vols.filter((v) => v != null));
          const V = (v) => P.bot - (v / max) * h;
          body = vols.map((v, n) => {
            if (!v) return "";
            const prev = n > 0 ? pts[n - 1][1] : S.start > 0 ? S.all[S.start - 1][1] : pts[n][1];
            return `<rect class="vbar ${pts[n][1] >= prev ? "up" : "down"}" x="${(X(n) - barW / 2).toFixed(1)}" y="${V(v).toFixed(1)}" width="${barW.toFixed(1)}" height="${(P.bot - V(v)).toFixed(1)}"/>`;
          }).join("") + `<text class="axis" x="${W - pad.r + 8}" y="${P.top + 8}">${compact(max)}</text>`;
        }
      } else if (P.id === "rsi") {
        const R = (v) => P.top + (1 - v / 100) * h;
        body = `<rect class="rsi-zone" x="${pad.l}" width="${W - pad.l - pad.r}" y="${R(70)}" height="${R(30) - R(70)}"/>
          ${[70, 30].map((v) => `<line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${R(v)}" y2="${R(v)}"/><text class="axis" x="${W - pad.r + 8}" y="${R(v) + 4}">${v}</text>`).join("")}
          <path class="ind" style="--c:var(--ind-b)" d="${path(rs, R)}"/>`;
      } else {
        const all = [...md.line, ...md.signal, ...md.hist].filter((v) => v != null);
        const m = Math.max(1e-9, ...all.map(Math.abs)) * 1.1;
        const M = (v) => P.top + (1 - (v + m) / (2 * m)) * h;
        body = `<line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${M(0)}" y2="${M(0)}"/><text class="axis" x="${W - pad.r + 8}" y="${M(0) + 4}">0</text>
          ${md.hist.map((v, n) => v == null ? "" : `<rect class="vbar ${v >= 0 ? "up" : "down"}" x="${(X(n) - barW / 2).toFixed(1)}" y="${Math.min(M(v), M(0)).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.abs(M(v) - M(0)).toFixed(1)}"/>`).join("")}
          <path class="ind" style="--c:var(--accent)" d="${path(md.line, M)}"/>
          <path class="ind" style="--c:var(--ind-a)" d="${path(md.signal, M)}"/>`;
      }
      return `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${P.top - LBL + 4}" y2="${P.top - LBL + 4}"/>
        <text class="plabel" x="${pad.l}" y="${P.top - 5}" data-p="${P.id}"></text>${body}`;
    }).join("");

    el.innerHTML = `
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price chart, ${range}${shown.size ? ", with " + INDICATORS.filter((m) => on(m.id)).map((m) => m.label).join(", ") : ""}">
        <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${color}" stop-opacity=".18"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
        </linearGradient></defs>
        ${grid.map((v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/>
          <text class="axis" x="${W - pad.r + 8}" y="${Y(v) + 4}">${plain(v, cur)}</text>`).join("")}
        ${intraday ? `<line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(base)}" y2="${Y(base)}"/>` : ""}
        ${band}
        <polygon fill="url(#fill)" points="${X(0)},${mainB} ${line} ${X(pts.length - 1)},${mainB}"/>
        <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${line}"/>
        ${bb ? ["up", "mid", "lo"].map((k) => `<path class="ind bb ${k}" d="${path(bb[k], Y)}"/>`).join("") : ""}
        ${lines.map((l) => `<path class="ind ${l.dash ? "dash" : ""}" style="--c:var(${l.color})" d="${path(l.v, Y)}"/>`).join("")}
        ${panelSvg}
        ${xl.map((n, k) => `<text class="axis" x="${X(n)}" y="${H - 8}" text-anchor="${k === 0 ? "start" : k === xl.length - 1 ? "end" : "middle"}">${fmtX(pts[n][0])}</text>`).join("")}
        <g class="hover" visibility="hidden">
          <line class="cross" y1="${pad.t}" y2="${H - pad.b}"/>
          <circle r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="2"/>
        </g>
      </svg>
      <div class="tip" hidden></div>`;

    // Legend over the chart and labels on each panel show the values at the hovered bar, or the latest one
    const fmtP = (v) => (v == null ? "–" : plain(v, cur));
    const legend = $("legend");
    const items = [
      ...lines.map((l) => ({ html: `<i class="sw ${l.dash ? "dash" : ""}" style="--c:var(${l.color})"></i>${l.label}`, val: (n) => fmtP(l.v[n]) })),
      ...(bb ? [{ html: `<i class="sw" style="--c:var(--ind-band)"></i>Bollinger 20, 2`, val: (n) => `${fmtP(bb.lo[n])} – ${fmtP(bb.up[n])}` }] : []),
    ];
    legend.innerHTML = items.map((it) => `<span class="leg">${it.html} <b class="num"></b></span>`).join("");
    legend.hidden = !items.length;
    const legVals = [...legend.querySelectorAll("b")];
    const plabels = {
      vol: (n) => `Volume  ${hasVol ? compact(vols[n]) : ""}`,
      rsi: (n) => `RSI 14  ${rs && rs[n] != null ? rs[n].toFixed(1) : "–"}`,
      macd: (n) => md ? `MACD 12, 26, 9  ${small(md.line[n])}  signal ${small(md.signal[n])}  hist ${small(md.hist[n])}` : "",
    };
    const show = (n) => {
      items.forEach((it, k) => { legVals[k].textContent = it.val(n); });
      el.querySelectorAll(".plabel").forEach((t) => { t.textContent = plabels[t.dataset.p](n); });
    };
    show(pts.length - 1);

    const svg = el.querySelector("svg"), g = svg.querySelector(".hover"), tip = el.querySelector(".tip");
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const n = Math.round(((e.clientX - r.left - pad.l) / (W - pad.l - pad.r)) * (pts.length - 1));
      if (n < 0 || n >= pts.length) return hide();
      const [ts, v] = pts[n], x = X(n), y = Y(v);
      g.setAttribute("visibility", "visible");
      g.querySelector("line").setAttribute("x1", x); g.querySelector("line").setAttribute("x2", x);
      g.querySelector("circle").setAttribute("cx", x); g.querySelector("circle").setAttribute("cy", y);
      const dt = new Date(ts * 1000);
      const when = intraday ? dt.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
        : dt.toLocaleDateString(undefined, { dateStyle: "medium" });
      const fmtV = (x) => (current.index ? plain(x, current.cur) : money(x, current.cur));
      const ex = pts[n][3] && pts[n][3].length ? [v, ...pts[n][3].map((e) => e[1])] : null;
      tip.innerHTML = `<div class="tk">${when}</div><div class="num">${fmtV(v)}</div><div>${pct(base ? (v / base - 1) * 100 : null)}</div>${ex ? `<div class="tk">Range ${fmtV(Math.min(...ex))} – ${fmtV(Math.max(...ex))}</div>` : ""}`;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(0, x - tw / 2), W - tw) + "px";
      tip.style.top = Math.max(0, y - tip.offsetHeight - 14) + "px";
      show(n);
    };
    const hide = () => { g.setAttribute("visibility", "hidden"); tip.hidden = true; show(pts.length - 1); };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointerleave", hide);
  }

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => current && hist && renderQuote(), 150); });

  const start = new URLSearchParams(location.search).get("t");
  pick(stocks.some((s) => s.t === start) ? start : (stocks.find((s) => s.t === "^GSPTSE") || stocks[0]).t, false);
})();
