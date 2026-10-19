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
    // The last 5-minute bar can lag the latest trade, so end the line on the live price
    if (live.price != null) live.i[live.i.length - 1] = [live.i[live.i.length - 1][0], live.price];
    const [ts, price] = live.i[live.i.length - 1];
    const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
    const d = hist.d;
    if (!d.length || day(d[d.length - 1][0]) < day(ts)) d.push([ts, price]);
    else d[d.length - 1] = [d[d.length - 1][0], price];
    const open = Date.now() / 1000 - ts < 30 * 60;
    $("updated").innerHTML = `<span class="live-dot ${open ? "on" : ""}" aria-hidden="true"></span>${open ? "Live" : "Market closed"} · ${Live.stamp(new Date())}`;
    // Keep the hover tooltip steady: only redraw when no one is pointing at the chart
    if (!document.querySelector("#chart .tip:not([hidden])")) renderQuote();
  }
  if (window.Live && Live.on) {
    let first = true;
    Live.every(60000, () => { if (first) { first = false; return; } return current && hist && goLive(current); });
  }

  function series() {
    const d = hist.d, intra = hist.i;
    if (!d.length) return { pts: [], base: null };
    const lastDay = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
    if (range === "1D" || range === "5D") {
      if (intra.length) {
        const days = [...new Set(intra.map((p) => lastDay(p[0])))];
        const keep = days.slice(range === "1D" ? -1 : -5);
        const pts = intra.filter((p) => keep.includes(lastDay(p[0])));
        const before = d.filter((p) => lastDay(p[0]) < keep[0]);
        return { pts, base: before.length ? before[before.length - 1][1] : pts[0][1], intraday: true };
      }
      const pts = d.slice(range === "1D" ? -2 : -6);
      return { pts, base: pts[0][1] };
    }
    const end = d[d.length - 1][0];
    const r = RANGES.find((x) => x[0] === range)[1];
    let from = 0;
    if (r === "ytd") from = Date.UTC(new Date(end * 1000).getUTCFullYear(), 0, 1) / 1000;
    else if (r) from = end - r * 86400;
    const idx = d.findIndex((p) => p[0] >= from);
    // start from the last close before the window so the change matches the usual definition
    const pts = d.slice(Math.max(0, idx - (idx > 0 ? 1 : 0)));
    return { pts, base: pts[0][1] };
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
    const { pts, base, intraday } = series();
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
        <div class="chart" id="chart"></div>
        <div class="stats quote-stats">${stats.map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value num">${v}</div></div>`).join("")}</div>
      </div>`;
    $("qp").innerHTML = `<div class="value num big">${s.index ? plain(last, s.cur) : money(last, s.cur)}</div><div>${pct(chg)} <span class="tk">${range === "All" ? "all time" : range}</span></div>`;
    $("quote").querySelector(".ranges").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      range = b.dataset.r;
      try { localStorage.setItem("lookupRange", range); } catch {}
      renderQuote();
    });
    drawChart($("chart"), pts, base, chg, intraday, s.cur);
  }

  function drawChart(el, pts, base, chg, intraday, cur) {
    const W = el.clientWidth || 800, H = W < 500 ? 240 : 320;
    const pad = { l: 8, r: 64, t: 12, b: 28 };
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    let lo = Math.min(...ys, intraday ? base : Infinity), hi = Math.max(...ys, intraday ? base : -Infinity);
    if (hi === lo) { hi += 1; lo -= 1; }
    const span = hi - lo; lo -= span * 0.06; hi += span * 0.06;
    // Even spacing by point index, so nights and weekends don't leave gaps
    const X = (n) => pad.l + (n / Math.max(1, pts.length - 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const color = chg == null || chg >= 0 ? "var(--up)" : "var(--down)";
    const line = pts.map((p, n) => `${X(n).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");

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

    el.innerHTML = `
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price chart, ${range}">
        <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${color}" stop-opacity=".18"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
        </linearGradient></defs>
        ${grid.map((v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/>
          <text class="axis" x="${W - pad.r + 8}" y="${Y(v) + 4}">${plain(v, cur)}</text>`).join("")}
        ${intraday ? `<line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(base)}" y2="${Y(base)}"/>` : ""}
        <polygon fill="url(#fill)" points="${X(0)},${H - pad.b} ${line} ${X(pts.length - 1)},${H - pad.b}"/>
        <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${line}"/>
        ${xl.map((n, k) => `<text class="axis" x="${X(n)}" y="${H - 8}" text-anchor="${k === 0 ? "start" : k === xl.length - 1 ? "end" : "middle"}">${fmtX(pts[n][0])}</text>`).join("")}
        <g class="hover" visibility="hidden">
          <line class="cross" y1="${pad.t}" y2="${H - pad.b}"/>
          <circle r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="2"/>
        </g>
      </svg>
      <div class="tip" hidden></div>`;

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
      tip.innerHTML = `<div class="tk">${when}</div><div class="num">${current.index ? plain(v, current.cur) : money(v, current.cur)}</div><div>${pct(base ? (v / base - 1) * 100 : null)}</div>`;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(Math.max(0, x - tw / 2), W - tw) + "px";
      tip.style.top = Math.max(0, y - tip.offsetHeight - 14) + "px";
    };
    const hide = () => { g.setAttribute("visibility", "hidden"); tip.hidden = true; };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointerleave", hide);
  }

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => current && hist && renderQuote(), 150); });

  const start = new URLSearchParams(location.search).get("t");
  pick(stocks.some((s) => s.t === start) ? start : (stocks.find((s) => s.t === "^GSPTSE") || stocks[0]).t, false);
})();
