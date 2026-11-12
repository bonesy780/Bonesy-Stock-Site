(async function () {
  const { esc, money, pct, big, fixed, stockUrl, store } = UI;
  const $ = (id) => document.getElementById(id);
  const MAX = 5;
  const COLORS = ["--cmp-2", "--cmp-1", "--cmp-3", "--cmp-4", "--cmp-5"];

  const [stocks, M] = await Promise.all([
    UI.load("stocks.json").catch(() => []),
    UI.market().catch(() => ({ byTicker: {}, stocks: [] })),
  ]);
  const byT = Object.fromEntries(stocks.map((s) => [s.t, s]));
  if (M.generated) $("updated").textContent = "Updated " + new Date(M.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  if (window.startRain) window.startRain((M.stocks || []).filter((s) => s.cur === "USD").map((s) => s.s));

  const fromUrl = new URLSearchParams(location.search).get("t");
  let picked = (fromUrl ? fromUrl.split(",") : store.get("compare", ["AAPL", "MSFT", "^GSPC"])).filter((t) => byT[t]).slice(0, MAX);
  let range = store.get("compareRange", "1Y");
  const hist = {};

  const RANGES = [["1M", 31], ["3M", 92], ["6M", 183], ["YTD", null], ["1Y", 365], ["3Y", 1096], ["5Y", 1827], ["10Y", 3653]];
  const save = () => {
    store.set("compare", picked);
    history.replaceState(null, "", picked.length ? "?t=" + picked.map(encodeURIComponent).join(",") : location.pathname);
  };

  async function loadHist(t) {
    if (hist[t]) return;
    hist[t] = "loading";
    try { hist[t] = await (await fetch(`hist/${encodeURIComponent(t.replace("^", "_"))}.json`, { cache: "no-store" })).json(); }
    catch { hist[t] = { d: [] }; }
    render();
  }

  const info = (t) => {
    const x = { ...(byT[t] || {}), ...(M.byTicker[t] || {}) };
    // Indexes have no row in market.json: take the price from the saved history
    const h = hist[t];
    if (x.p == null && h && h.d && h.d.length) { x.p = h.d[h.d.length - 1][1]; x.cur = x.cur || "USD"; x.plain = true; }
    return x;
  };
  const nameOf = (t) => { const x = info(t); return x.index ? x.n.replace(/ \(.*\)/, "").replace(/ index$/, "") : x.s || t; };

  function renderPicked() {
    $("picked").innerHTML = picked.map((t, i) => `<span class="chip" aria-pressed="true"><i class="sw" style="--c:var(${COLORS[i]})"></i>${esc(nameOf(t))}<button class="x" data-rm="${esc(t)}" aria-label="Remove ${esc(nameOf(t))}">✕</button></span>`).join("")
      + (picked.length >= MAX ? `<span class="hint">Up to ${MAX} at a time</span>` : "");
    $("add").disabled = picked.length >= MAX;
  }

  function startOf(lastTs) {
    const [r, days] = RANGES.find((x) => x[0] === range);
    if (r === "YTD") return Date.UTC(new Date(lastTs * 1000).getUTCFullYear(), 0, 1) / 1000;
    return lastTs - days * 86400;
  }

  // % change lines on a shared time axis
  function drawChart() {
    const el = $("chart");
    const ready = picked.filter((t) => hist[t] && hist[t].d && hist[t].d.length);
    if (!picked.length) { el.innerHTML = `<div class="empty">Add a stock above to start comparing.</div>`; $("legend").innerHTML = ""; return; }
    if (!ready.length) { el.innerHTML = `<div class="empty">Loading prices…</div>`; return; }
    const last = Math.max(...ready.map((t) => hist[t].d[hist[t].d.length - 1][0]));
    const t0 = startOf(last);
    const series = ready.map((t) => {
      const d = hist[t].d;
      // Base is the last close on or before the start, so every line starts at 0%
      let i = d.findIndex((p) => p[0] >= t0);
      if (i < 0) return { t, pts: [] };
      const base = i > 0 ? d[i - 1][1] : d[i][1];
      const pts = d.slice(i).map((p) => [p[0], (p[1] / base - 1) * 100]);
      return { t, pts: [[Math.max(t0, i > 0 ? d[i - 1][0] : d[i][0]), 0], ...pts], color: COLORS[picked.indexOf(t)] };
    }).filter((s) => s.pts.length > 1);
    const W = el.clientWidth || 800, H = W < 500 ? 260 : 340, pad = { l: 8, r: 56, t: 10, b: 24 };
    const all = series.flatMap((s) => s.pts.map((p) => p[1]));
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    const span = hi - lo || 1; lo -= span * 0.06; hi += span * 0.06;
    const x0 = Math.min(...series.map((s) => s.pts[0][0]));
    const X = (ts) => pad.l + ((ts - x0) / ((last - x0) || 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const raw = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    let grid = "";
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      grid += `<line class="${Math.abs(v) < step / 1000 ? "base" : "grid"}" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${W - pad.r + 6}" y="${Y(v) + 4}">${v > 0 ? "+" : ""}${+v.toFixed(1)}%</text>`;
    }
    const days = (last - x0) / 86400;
    const fmtX = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, days > 400 ? { year: "numeric", month: "short" } : { month: "short", day: "numeric" });
    const ticks = W < 500 ? 2 : 4;
    for (let k = 0; k <= ticks; k++) {
      const ts = x0 + ((last - x0) * k) / ticks;
      grid += `<text class="axis" x="${X(ts)}" y="${H - 6}" text-anchor="${k === 0 ? "start" : k === ticks ? "end" : "middle"}">${fmtX(ts)}</text>`;
    }
    const lines = series.map((s) => `<path class="ind cmp" style="--c:var(${s.color})" d="${s.pts.map((p, n) => `${n ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("")}"/>`).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${grid}${lines}<line class="cross" id="cx" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/></svg><div class="tip" hidden></div>`;
    const ends = series.map((s) => ({ s, v: s.pts[s.pts.length - 1][1] }));
    const legend = (at) => series.map((s) => {
      let v = s.pts[s.pts.length - 1][1];
      if (at != null) { const p = s.pts.filter((q) => q[0] <= at).pop(); v = p ? p[1] : null; }
      return `<span class="leg"><i class="sw" style="--c:var(${s.color})"></i><b>${esc(nameOf(s.t))}</b> ${pct(v, 2)}</span>`;
    }).join("");
    $("legend").innerHTML = legend(null);
    const svg = el.querySelector("svg"), cx = el.querySelector("#cx");
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width);
      const ts = x0 + ((x - pad.l) / (W - pad.l - pad.r)) * (last - x0);
      if (ts < x0 || ts > last) return;
      cx.setAttribute("x1", x); cx.setAttribute("x2", x); cx.setAttribute("visibility", "visible");
      $("legend").innerHTML = `<span class="leg"><b>${new Date(ts * 1000).toLocaleDateString(undefined, { dateStyle: "medium" })}</b></span>` + legend(ts);
    });
    svg.addEventListener("pointerleave", () => { cx.setAttribute("visibility", "hidden"); $("legend").innerHTML = legend(null); });
    return ends;
  }

  // Side-by-side figures; "best" says which way is better for highlighting
  const ROWS = [
    ["Price", (x) => (x.p == null ? "–" : x.plain ? x.p.toLocaleString(undefined, { maximumFractionDigits: 2 }) : money(x.p, x.cur))],
    ["Day", (x) => pct(x.d1, 2), (x) => x.d1, 1],
    ["1 month", (x) => pct(x.m1), (x) => x.m1, 1],
    ["3 months", (x) => pct(x.m3), (x) => x.m3, 1],
    ["YTD", (x) => pct(x.ytd), (x) => x.ytd, 1],
    ["1 year", (x) => pct(x.y1), (x) => x.y1, 1],
    ["From 52W high", (x) => pct(x.fromHi), (x) => x.fromHi, 1],
    ["Market cap (USD)", (x) => big(x.mcapUsd), (x) => x.mcapUsd, 1],
    ["P/E", (x) => fixed(x.pe, 1), (x) => (x.pe > 0 ? x.pe : null), -1],
    ["Forward P/E", (x) => fixed(x.fpe, 1), (x) => (x.fpe > 0 ? x.fpe : null), -1],
    ["PEG", (x) => fixed(x.peg, 2), (x) => (x.peg > 0 ? x.peg : null), -1],
    ["Price / book", (x) => fixed(x.pb, 1), (x) => (x.pb > 0 ? x.pb : null), -1],
    ["Price / sales", (x) => fixed(x.ps, 1), (x) => x.ps, -1],
    ["Revenue growth", (x) => pct(x.revGrowth), (x) => x.revGrowth, 1],
    ["Earnings growth", (x) => pct(x.epsGrowth), (x) => x.epsGrowth, 1],
    ["Profit margin", (x) => (x.margin != null ? x.margin.toFixed(1) + "%" : "–"), (x) => x.margin, 1],
    ["Return on equity", (x) => (x.roe != null ? x.roe.toFixed(1) + "%" : "–"), (x) => x.roe, 1],
    ["Debt / equity", (x) => (x.de != null ? x.de.toFixed(0) + "%" : "–"), (x) => x.de, -1],
    ["Dividend yield", (x) => (x.divYield != null ? x.divYield.toFixed(2) + "%" : x.p != null && !x.plain ? "None" : "–"), (x) => x.divYield, 1],
    ["Payout ratio", (x) => (x.payout != null ? x.payout.toFixed(0) + "%" : "–")],
    ["Beta", (x) => fixed(x.beta, 2)],
    ["Volatility", (x) => (x.volat != null ? x.volat.toFixed(0) + "%" : "–"), (x) => x.volat, -1],
    ["RSI (14)", (x) => fixed(x.rsi, 0)],
    ["Analyst rating", (x) => (x.recMean != null ? `${x.recMean <= 1.5 ? "Strong Buy" : x.recMean <= 2.5 ? "Buy" : x.recMean <= 3.5 ? "Hold" : "Sell"} (${x.recMean.toFixed(1)})` : "–"), (x) => x.recMean, -1],
    ["Analysts", (x) => x.analysts ?? "–"],
    ["Upside to target", (x) => pct(x.upside), (x) => x.upside, 1],
    ["Next earnings", (x) => (x.earnings ? new Date(x.earnings + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "–")],
    ["Sector", (x) => esc(x.sector || "–")],
  ];
  function drawTable(chartEnds) {
    if (!picked.length) { $("table").innerHTML = ""; return; }
    const xs = picked.map(info);
    const perf = Object.fromEntries((chartEnds || []).map((e) => [e.s.t, e.v]));
    const rows = [[`Change (${range})`, (x) => pct(perf[x.t], 1), (x) => perf[x.t], 1]].concat(ROWS);
    $("table").innerHTML = `<table class="compare-table"><thead><tr><th></th>${xs.map((x, i) =>
      `<th><span class="sw" style="--c:var(${COLORS[i]})"></span> <a class="co-link" href="${stockUrl(x.t)}">${esc(nameOf(x.t))}</a><div class="tk">${esc(x.index ? "Index" : (x.n || "").slice(0, 28))}</div></th>`).join("")}</tr></thead>
      <tbody>${rows.map(([label, show, get, dir]) => {
        let best = null;
        if (get && xs.length > 1) {
          const vals = xs.map((x) => get(x)).filter((v) => v != null);
          if (vals.length > 1) best = dir > 0 ? Math.max(...vals) : Math.min(...vals);
        }
        return `<tr><th scope="row">${esc(label)}</th>${xs.map((x) => `<td class="${best != null && get(x) === best ? "best" : ""}">${show(x)}</td>`).join("")}</tr>`;
      }).join("")}</tbody></table>`;
  }

  function render() {
    renderPicked();
    $("ranges").innerHTML = RANGES.map(([r]) => `<button class="tab" role="tab" aria-selected="${r === range}" data-r="${r}">${r}</button>`).join("");
    const ends = drawChart();
    drawTable(ends);
  }

  UI.picker($("add"), (s) => {
    if (!picked.includes(s.t) && picked.length < MAX) picked.push(s.t);
    save(); loadHist(s.t); render();
  });
  $("picked").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (!b) return;
    picked = picked.filter((t) => t !== b.dataset.rm);
    save(); render();
  });
  $("ranges").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    range = b.dataset.r; store.set("compareRange", range); render();
  });
  let resize;
  window.addEventListener("resize", () => { clearTimeout(resize); resize = setTimeout(render, 150); });
  save();
  render();
  picked.forEach(loadHist);
})();
