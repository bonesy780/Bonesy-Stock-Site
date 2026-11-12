(async function () {
  const { esc, pct, store } = UI;
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

  const benches = stocks.filter((s) => s.index);
  const label = (t) => { const x = byT[t] || {}; return x.index ? x.n.replace(/ \(.*\)/, "").replace(/ index$/, "") : x.s || t; };

  // ---- state, from the link first, then this browser
  const q = new URLSearchParams(location.search);
  const saved = store.get("backtest", {});
  const state = {
    hold: [["AAPL", 40], ["MSFT", 30], ["SHOP.TO", 30]],
    start: new Date().getFullYear() - 10, amount: 10000, monthly: 0, rebal: "year", bench: "^GSPC",
    ...saved,
  };
  if (q.get("h")) state.hold = q.get("h").split(",").map((x) => { const [t, w] = x.split(":"); return [t, +w || 0]; });
  for (const k of ["start", "amount", "monthly"]) if (q.get(k) != null) state[k] = +q.get(k) || 0;
  if (q.get("rebal")) state.rebal = q.get("rebal");
  if (q.get("bench")) state.bench = q.get("bench");
  state.hold = state.hold.filter(([t]) => byT[t]).slice(0, MAX);
  if (state.bench && !byT[state.bench]) state.bench = benches[0] ? benches[0].t : "";

  const save = () => {
    store.set("backtest", state);
    const h = state.hold.map(([t, w]) => `${encodeURIComponent(t)}:${w}`).join(",");
    history.replaceState(null, "", `?h=${h}&start=${state.start}&amount=${state.amount}&monthly=${state.monthly}&rebal=${state.rebal}&bench=${encodeURIComponent(state.bench)}`);
  };

  // ---- prices
  const hist = {};
  async function loadHist(t) {
    if (!hist[t]) {
      hist[t] = fetch(`hist/${encodeURIComponent(t.replace("^", "_"))}.json`, { cache: "no-store" })
        .then((r) => r.json()).then((j) => j.d || []).catch(() => []);
    }
    return hist[t];
  }
  // Last close at or before ts (binary search)
  const priceAt = (d, ts) => {
    let lo = 0, hi = d.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (d[mid][0] <= ts) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans < 0 ? null : d[ans][1];
  };

  // ---- form
  const thisYear = new Date().getFullYear();
  $("start").innerHTML = Array.from({ length: thisYear - 1985 }, (_, i) => thisYear - i).map((y) => `<option>${y}</option>`).join("");
  $("bench").innerHTML = benches.map((b) => `<option value="${esc(b.t)}">${esc(label(b.t))}</option>`).join("") + `<option value="">Nothing</option>`;
  const fill = () => {
    $("start").value = state.start; $("amount").value = state.amount; $("monthly").value = state.monthly;
    $("rebal").value = state.rebal; $("bench").value = state.bench;
  };
  fill();

  function sumText() {
    const sum = state.hold.reduce((a, [, w]) => a + w, 0);
    $("wsum").textContent = state.hold.length ? (Math.abs(sum - 100) < 0.01 ? "Adds up to 100%" : `Adds up to ${+sum.toFixed(1)}%. Shares are scaled to 100%.`) : "";
    $("wsum").classList.toggle("warn", state.hold.length > 0 && Math.abs(sum - 100) >= 0.01);
  }
  function renderHoldings() {
    $("holdings").innerHTML = state.hold.length ? state.hold.map(([t, w], i) => `<div class="bt-row">
        <i class="sw" style="--c:var(${COLORS[i]})"></i>
        <span class="bt-name"><b>${esc(label(t))}</b><span class="tk">${esc((byT[t] || {}).n || "")}</span></span>
        <label class="bt-w"><input class="field num" type="number" min="0" max="100" step="5" value="${w}" data-w="${i}" aria-label="Share of ${esc(label(t))}">%</label>
        <button class="x" data-rm="${i}" aria-label="Remove ${esc(label(t))}">✕</button>
      </div>`).join("") : `<p class="muted">Add a stock or index to start.</p>`;
    sumText();
    $("add").disabled = state.hold.length >= MAX;
    $("add").placeholder = state.hold.length >= MAX ? `Up to ${MAX} holdings` : "Add a stock or index…";
  }

  UI.picker($("add"), (s) => {
    if (state.hold.some(([t]) => t === s.t) || state.hold.length >= MAX) return;
    state.hold.push([s.t, 0]);
    const even = Math.floor(100 / state.hold.length);
    state.hold.forEach((h, i) => { h[1] = i === 0 ? 100 - even * (state.hold.length - 1) : even; });
    $("add").value = "";
    update();
  });
  $("holdings").addEventListener("input", (e) => {
    const i = e.target.dataset.w;
    if (i == null) return;
    state.hold[+i][1] = Math.max(0, +e.target.value || 0);
    clearTimeout(update.t); update.t = setTimeout(() => update(true), 350);
  });
  $("holdings").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (b) { state.hold.splice(+b.dataset.rm, 1); update(); }
  });
  $("equal").addEventListener("click", () => {
    const n = state.hold.length; if (!n) return;
    const even = Math.floor(100 / n);
    state.hold.forEach((h, i) => { h[1] = i === 0 ? 100 - even * (n - 1) : even; });
    update();
  });
  for (const id of ["start", "amount", "monthly", "rebal", "bench"]) {
    $(id).addEventListener(id === "amount" || id === "monthly" ? "input" : "change", () => {
      const v = $(id).value;
      state[id] = id === "rebal" || id === "bench" ? v : Math.max(0, +v || 0);
      clearTimeout(update.t); update.t = setTimeout(() => update(true), 250);
    });
  }

  // ---- simulation, one step per month end
  function simulate(series, weights, t0, last) {
    const steps = [];
    const d0 = new Date(t0 * 1000);
    for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth(); ; m++) {
      const ts = Date.UTC(y, m + 1, 1) / 1000 - 1; // last second of the month
      if (ts >= last) { steps.push(last); break; }
      if (ts > t0) steps.push(ts);
    }
    const p0 = series.map((d) => priceAt(d, t0));
    let units = weights.map((w, i) => state.amount * w / p0[i]);
    let paid = state.amount, prev = state.amount, index = 1;
    const out = [{ ts: t0, value: state.amount, paid, index }];
    for (const ts of steps) {
      const px = series.map((d) => priceAt(d, ts));
      let value = units.reduce((a, u, i) => a + u * px[i], 0);
      // Time-weighted growth: this month's change before new money goes in
      index *= prev ? value / prev : 1;
      const dt = new Date(ts * 1000), month = dt.getUTCMonth();
      const atEnd = ts === last;
      if (!atEnd && state.monthly) {
        units = units.map((u, i) => u + state.monthly * weights[i] / px[i]);
        value += state.monthly; paid += state.monthly;
      }
      const rebal = !atEnd && (state.rebal === "year" ? month === 11 : state.rebal === "quarter" ? month % 3 === 2 : false);
      if (rebal) units = weights.map((w, i) => value * w / px[i]);
      prev = value;
      out.push({ ts, value, paid, index, px });
    }
    return { out, p0 };
  }

  function stats(out) {
    const first = out[0], end = out[out.length - 1];
    const years = (end.ts - first.ts) / (365.25 * 86400);
    const cagr = years > 0.5 ? (Math.pow(end.index, 1 / years) - 1) * 100 : null;
    let peak = 0, dd = 0;
    for (const p of out) { peak = Math.max(peak, p.index); dd = Math.min(dd, p.index / peak - 1); }
    const rets = out.slice(1).map((p, i) => p.index / out[i].index - 1);
    const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
    const vol = rets.length > 2 ? Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(12) * 100 : null;
    const byYear = {};
    for (const p of out) byYear[new Date(p.ts * 1000).getUTCFullYear()] = p.index;
    return { end, years, cagr, dd: dd * 100, vol, total: (end.index - 1) * 100, byYear };
  }

  let seq = 0;
  async function update(fromInput) {
    if (fromInput) sumText(); else renderHoldings();
    save();
    const my = ++seq;
    const hold = state.hold.filter(([, w]) => w > 0);
    if (!hold.length) { $("result").innerHTML = `<p class="muted pad">Add at least one holding with a share above 0%.</p>`; $("chart").innerHTML = ""; $("legend").innerHTML = ""; $("years").innerHTML = ""; $("each").innerHTML = ""; return; }
    if (!fromInput) $("result").innerHTML = `<p class="muted pad">Loading prices…</p>`;
    const tick = hold.map(([t]) => t);
    const series = await Promise.all(tick.map(loadHist));
    const benchD = state.bench ? await loadHist(state.bench) : [];
    if (my !== seq) return;
    const missing = tick.filter((t, i) => series[i].length < 2);
    if (missing.length) { $("result").innerHTML = `<p class="muted pad">No price history for ${missing.map(label).join(", ")}.</p>`; return; }

    const sum = hold.reduce((a, [, w]) => a + w, 0);
    const weights = hold.map(([, w]) => w / sum);
    const wanted = Date.UTC(state.start, 0, 1) / 1000;
    const firstOk = Math.max(...series.map((d) => d[0][0]));
    const t0 = Math.max(wanted, firstOk);
    const last = Math.min(...series.map((d) => d[d.length - 1][0]));
    if (t0 >= last) { $("result").innerHTML = `<p class="muted pad">Not enough history to run this test.</p>`; return; }
    const late = firstOk > wanted ? tick[series.findIndex((d) => d[0][0] === firstOk)] : null;

    const { out, p0 } = simulate(series, weights, t0, last);
    const S = stats(out);
    const hasBench = benchD.length > 1 && benchD[0][0] <= t0;
    const B = hasBench ? stats(simulate([benchD], [1], t0, last).out) : null;
    const benchOut = hasBench ? simulate([benchD], [1], t0, last).out : null;
    const n = (v) => Math.round(v).toLocaleString();
    const startLabel = new Date(t0 * 1000).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });

    $("result").innerHTML = `
      <p class="hint pad-t">From ${startLabel} to ${new Date(last * 1000).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" })}${late ? ` (the earliest ${esc(label(late))} has prices for)` : ""}.</p>
      <div class="stats">
        <div class="stat"><div class="label">Worth today</div><div class="value num big-v">${n(S.end.value)}</div></div>
        <div class="stat"><div class="label">You put in</div><div class="value num">${n(S.end.paid)}</div></div>
        <div class="stat"><div class="label">Gain</div><div class="value num ${S.end.value >= S.end.paid ? "up" : "down"}">${S.end.value >= S.end.paid ? "+" : "−"}${n(Math.abs(S.end.value - S.end.paid))}</div></div>
        <div class="stat" title="Growth per year, not counting the timing of monthly additions"><div class="label">Per year</div><div class="value">${pct(S.cagr)}</div></div>
        <div class="stat" title="Biggest fall from a high point to a later low"><div class="label">Worst drop</div><div class="value">${pct(S.dd)}</div></div>
        <div class="stat" title="How much monthly returns swing, as a yearly figure"><div class="label">Volatility</div><div class="value num">${S.vol != null ? S.vol.toFixed(1) + "%" : "–"}</div></div>
        ${B ? `<div class="stat" title="${esc(label(state.bench))} with the same money going in"><div class="label">${esc(label(state.bench))} instead</div><div class="value num">${n(B.end.value)} <span class="${S.end.value >= B.end.value ? "up" : "down"}">(${S.end.value >= B.end.value ? "you beat it" : "it won"})</span></div></div>` : ""}
      </div>`;

    drawChart(out, benchOut);

    // Year by year (time-weighted, so new money doesn't count as gains)
    const yrs = Object.keys(S.byYear).map(Number).sort((a, b) => a - b);
    const yr = (st, y) => { const prev = st.byYear[y - 1] ?? 1; return st.byYear[y] != null ? (st.byYear[y] / prev - 1) * 100 : null; };
    const yRows = yrs.map((y) => ({ y, p: yr(S, y), b: B ? yr(B, y) : null, v: out.filter((o) => new Date(o.ts * 1000).getUTCFullYear() === y).pop().value })).reverse();
    $("years").innerHTML = `<table class="bt-table"><thead><tr><th class="left">Year</th><th>Portfolio</th>${B ? `<th>${esc(label(state.bench))}</th>` : ""}<th>Worth at year end</th></tr></thead>
      <tbody>${yRows.map((r) => `<tr><td class="left num">${r.y}${r.y === yrs[yrs.length - 1] ? " so far" : r.y === yrs[0] && t0 > Date.UTC(r.y, 0, 5) / 1000 ? " part" : ""}</td><td>${pct(r.p)}</td>${B ? `<td>${pct(r.b)}</td>` : ""}<td class="num">${n(r.v)}</td></tr>`).join("")}</tbody></table>`;

    // Each holding, priced in its own currency
    const end = out[out.length - 1].px;
    $("each").innerHTML = `<table class="bt-table"><thead><tr><th class="left">Holding</th><th>Share</th><th>Start price</th><th>Last price</th><th>Change</th></tr></thead>
      <tbody>${hold.map(([t], i) => `<tr><td class="left"><i class="sw" style="--c:var(${COLORS[state.hold.findIndex((h) => h[0] === t)]})"></i> <a class="plain-link" href="${UI.stockUrl(t)}">${esc(label(t))}</a></td><td class="num">${(weights[i] * 100).toFixed(0)}%</td><td class="num">${p0[i].toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td class="num">${end[i].toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td>${pct((end[i] / p0[i] - 1) * 100)}</td></tr>`).join("")}</tbody></table>`;
  }

  function drawChart(out, bench) {
    const el = $("chart");
    const W = el.clientWidth || 800, H = W < 500 ? 240 : 320, pad = { l: 8, r: 64, t: 10, b: 24 };
    const lines = [
      { name: "Your portfolio", pts: out.map((p) => [p.ts, p.value]), color: "--cmp-2", cls: "" },
      ...(bench ? [{ name: label(state.bench), pts: bench.map((p) => [p.ts, p.value]), color: "--cmp-6", cls: "" }] : []),
      { name: "Money put in", pts: out.map((p) => [p.ts, p.paid]), color: "--muted", cls: "dash" },
    ];
    const all = lines.flatMap((l) => l.pts.map((p) => p[1]));
    let lo = Math.min(0, ...all), hi = Math.max(...all) * 1.05 || 1;
    const x0 = out[0].ts, x1 = out[out.length - 1].ts;
    const X = (ts) => pad.l + ((ts - x0) / ((x1 - x0) || 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const raw = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const short = (v) => v >= 1e6 ? +(v / 1e6).toFixed(1) + "M" : v >= 1e3 ? +(v / 1e3).toFixed(1) + "K" : String(+v.toFixed(0));
    let grid = "";
    for (let v = 0; v <= hi; v += step) grid += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${W - pad.r + 6}" y="${Y(v) + 4}">${short(v)}</text>`;
    const ticks = W < 500 ? 2 : 4;
    for (let k = 0; k <= ticks; k++) {
      const ts = x0 + ((x1 - x0) * k) / ticks;
      grid += `<text class="axis" x="${X(ts)}" y="${H - 6}" text-anchor="${k === 0 ? "start" : k === ticks ? "end" : "middle"}">${new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", timeZone: "UTC" })}</text>`;
    }
    const paths = lines.map((l) => `<path class="ind cmp ${l.cls}" style="--c:var(${l.color})" d="${l.pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("")}"/>`).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${grid}${paths}<line class="cross" id="cx" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/></svg>`;
    const n = (v) => Math.round(v).toLocaleString();
    const legend = (at) => lines.map((l) => {
      const p = at == null ? l.pts[l.pts.length - 1] : l.pts.filter((q) => q[0] <= at).pop();
      return `<span class="leg"><i class="sw ${l.cls}" style="--c:var(${l.color})"></i><b>${esc(l.name)}</b> ${p ? n(p[1]) : "–"}</span>`;
    }).join("");
    $("legend").innerHTML = legend(null);
    const svg = el.querySelector("svg"), cx = el.querySelector("#cx");
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width);
      const ts = x0 + ((x - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
      if (ts < x0 || ts > x1) return;
      cx.setAttribute("x1", x); cx.setAttribute("x2", x); cx.setAttribute("visibility", "visible");
      $("legend").innerHTML = `<span class="leg"><b>${new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", timeZone: "UTC" })}</b></span>` + legend(ts);
    });
    svg.addEventListener("pointerleave", () => { cx.setAttribute("visibility", "hidden"); $("legend").innerHTML = legend(null); });
  }

  let resizeT;
  window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => update(true), 200); });
  update();
})();
