(async function () {
  const { esc, money, store } = UI;
  const $ = (id) => document.getElementById(id);

  const M = await UI.market().catch(() => null);
  if (M) {
    $("updated").textContent = "Prices from " + new Date(M.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } else $("updated").textContent = "";

  // ---- Black-Scholes (European, no dividends)
  const ncdf = (x) => {
    // Abramowitz-Stegun 7.1.26
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  };
  const npdf = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  function bs(type, S, K, T, r, v) {
    if (type === "stock") return { price: S, delta: 1, theta: 0, vega: 0 };
    if (T <= 0 || v <= 0) {
      const intr = type === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
      return { price: intr, delta: type === "call" ? (S > K ? 1 : 0) : (S < K ? -1 : 0), theta: 0, vega: 0 };
    }
    const sq = Math.sqrt(T), d1 = (Math.log(S / K) + (r + v * v / 2) * T) / (v * sq), d2 = d1 - v * sq;
    const disc = Math.exp(-r * T);
    const price = type === "call" ? S * ncdf(d1) - K * disc * ncdf(d2) : K * disc * ncdf(-d2) - S * ncdf(-d1);
    const delta = type === "call" ? ncdf(d1) : ncdf(d1) - 1;
    const theta = (-S * npdf(d1) * v / (2 * sq) - (type === "call" ? 1 : -1) * r * K * disc * ncdf(type === "call" ? d2 : -d2)) / 365;
    const vega = S * npdf(d1) * sq / 100;
    return { price, delta, theta, vega };
  }

  // ---- state
  const saved = store.get("options", {});
  const state = { t: null, cur: "USD", spot: 100, days: 30, vol: 30, rate: 4, legs: [], preset: "bull", ...saved };
  const roundStrike = (x) => {
    const step = state.spot >= 500 ? 10 : state.spot >= 100 ? 5 : state.spot >= 25 ? 1 : state.spot >= 5 ? 0.5 : 0.1;
    return +(Math.round(x / step) * step).toFixed(2);
  };
  const est = (l) => bs(l.type, state.spot, l.strike, state.days / 365, state.rate / 100, state.vol / 100);
  const leg = (side, type, pctOff = 0, qty = 1) => {
    const l = { side, type, strike: type === "stock" ? 0 : roundStrike(state.spot * (1 + pctOff / 100)), qty };
    l.premium = +est(l).price.toFixed(2);
    return l;
  };

  const PRESETS = [
    ["call", "Long call", "Bet on a rise. Most you can lose is the premium.", () => [leg("buy", "call")]],
    ["put", "Long put", "Bet on a fall, or insure against one. Most you can lose is the premium.", () => [leg("buy", "put")]],
    ["covered", "Covered call", "Own the shares and sell a call above the price for extra income. Gives up gains above the strike.", () => [leg("buy", "stock"), leg("sell", "call", 5)]],
    ["protect", "Protective put", "Own the shares and buy a put below the price, like insurance against a big drop.", () => [leg("buy", "stock"), leg("buy", "put", -5)]],
    ["csp", "Cash-secured put", "Sell a put below the price: you're paid to wait, and buy the shares at the strike if it falls there.", () => [leg("sell", "put", -5)]],
    ["bull", "Bull call spread", "A cheaper bet on a rise: buy a call and sell a higher one. Gains and losses are both capped.", () => [leg("buy", "call"), leg("sell", "call", 5)]],
    ["bear", "Bear put spread", "A cheaper bet on a fall: buy a put and sell a lower one.", () => [leg("buy", "put"), leg("sell", "put", -5)]],
    ["straddle", "Straddle", "Buy a call and a put at the same strike: profits from a big move either way, such as after earnings.", () => [leg("buy", "call"), leg("buy", "put")]],
    ["strangle", "Strangle", "Like a straddle with strikes further out: cheaper, but needs a bigger move.", () => [leg("buy", "call", 5), leg("buy", "put", -5)]],
    ["condor", "Iron condor", "Sell a put spread and a call spread: earns the premium if the price stays in a range.", () => [leg("buy", "put", -10), leg("sell", "put", -5), leg("sell", "call", 5), leg("buy", "call", 10)]],
  ];
  if (!state.legs.length) state.legs = PRESETS.find((p) => p[0] === state.preset)[3]();

  const fill = () => { $("spot").value = state.spot; $("days").value = state.days; $("vol").value = state.vol; $("rate").value = state.rate; };
  fill();
  if (state.t) $("stock").placeholder = `Using ${state.t}`;

  if (M) {
    UI.picker($("stock"), (s) => {
      const m = M.byTicker[s.t];
      if (!m || m.p == null) return;
      state.t = m.s; state.cur = m.cur;
      state.spot = +(+m.p).toFixed(m.p >= 100 ? 2 : 4);
      if (m.volat) state.vol = Math.round(m.volat);
      $("stock").value = ""; $("stock").placeholder = `Using ${m.s} (${money(m.p, m.cur)})`;
      const p = PRESETS.find((x) => x[0] === state.preset);
      state.legs = p ? p[3]() : state.legs;
      fill(); render();
    });
  }

  // ---- payoff
  const MULT = 100;
  const value = (l, S, T) => {
    const sign = l.side === "buy" ? 1 : -1;
    if (l.type === "stock") return sign * (S - l.premium) * l.qty * MULT;
    const v = T > 0 ? bs(l.type, S, l.strike, T, state.rate / 100, state.vol / 100).price : (l.type === "call" ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S));
    return sign * (v - l.premium) * l.qty * MULT;
  };
  const total = (S, T) => state.legs.reduce((a, l) => a + value(l, S, T), 0);

  function analyze() {
    const S0 = state.spot, lo = Math.max(0.01, S0 * 0.5), hi = S0 * 1.5, N = 400;
    const pts = [], now = [];
    const T = state.days / 365;
    for (let i = 0; i <= N; i++) { const S = lo + (hi - lo) * i / N; pts.push([S, total(S, 0)]); now.push([S, total(S, T)]); }
    // Ends far beyond the chart say whether gains or losses are unlimited
    const far = total(S0 * 50, 0), farSlope = total(S0 * 51, 0) - far;
    const zero = total(0.0001, 0);
    const ys = pts.map((p) => p[1]);
    const maxP = farSlope > 1e-6 ? Infinity : Math.max(...ys, far, zero);
    const maxL = farSlope < -1e-6 ? -Infinity : Math.min(...ys, far, zero);
    const be = [];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if ((y0 < 0 && y1 >= 0) || (y0 >= 0 && y1 < 0)) be.push(x0 + (0 - y0) * (x1 - x0) / (y1 - y0));
    }
    // Chance of profit at expiry: lognormal price with the chosen volatility
    const v = state.vol / 100, r = state.rate / 100;
    let prob = 0;
    if (T > 0 && v > 0) {
      const cdf = (S) => ncdf((Math.log(S / S0) - (r - v * v / 2) * T) / (v * Math.sqrt(T)));
      const K = 2000, a = S0 * Math.exp(-6 * v * Math.sqrt(T)), b = S0 * Math.exp(6 * v * Math.sqrt(T));
      let prev = cdf(a);
      for (let i = 1; i <= K; i++) {
        const S = a * Math.pow(b / a, i / K), c = cdf(S), mid = a * Math.pow(b / a, (i - 0.5) / K);
        if (total(mid, 0) > 0) prob += c - prev;
        prev = c;
      }
    }
    const net = state.legs.reduce((a, l) => a + (l.side === "buy" ? -1 : 1) * l.premium * l.qty * MULT, 0);
    const g = state.legs.reduce((acc, l) => {
      const e = est(l), sign = (l.side === "buy" ? 1 : -1) * l.qty * MULT;
      acc.delta += e.delta * sign; acc.theta += e.theta * sign; acc.vega += e.vega * sign;
      return acc;
    }, { delta: 0, theta: 0, vega: 0 });
    return { pts, now, lo, hi, maxP, maxL, be, prob: prob * 100, net, g };
  }

  // ---- drawing
  const f2 = (v) => money(v, state.cur);
  const signed = (v) => `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : "−"}${money(Math.abs(v), state.cur)}</span>`;

  function render() {
    store.set("options", state);
    $("presets").innerHTML = PRESETS.map(([id, name]) => `<button class="chip" aria-pressed="${id === state.preset}" data-p="${id}">${esc(name)}</button>`).join("");
    const p = PRESETS.find((x) => x[0] === state.preset);
    $("preset-help").textContent = p ? p[2] : "Your own combination.";
    $("legs").innerHTML = state.legs.map((l, i) => {
      const e = est(l);
      return `<tr data-i="${i}">
        <td class="left"><select class="field" data-k="side"><option value="buy" ${l.side === "buy" ? "selected" : ""}>Buy</option><option value="sell" ${l.side === "sell" ? "selected" : ""}>Sell</option></select></td>
        <td class="left"><select class="field" data-k="type"><option value="call" ${l.type === "call" ? "selected" : ""}>Call</option><option value="put" ${l.type === "put" ? "selected" : ""}>Put</option><option value="stock" ${l.type === "stock" ? "selected" : ""}>Shares</option></select></td>
        <td>${l.type === "stock" ? `<span class="muted">–</span>` : `<input class="field num" type="number" min="0" step="any" data-k="strike" value="${l.strike}">`}</td>
        <td><input class="field num" type="number" min="1" step="1" data-k="qty" value="${l.qty}"></td>
        <td><input class="field num" type="number" min="0" step="any" data-k="premium" value="${l.premium}" title="${l.type === "stock" ? "Price paid per share" : "Price per share of the option (×100 per contract)"}"></td>
        <td class="num hide-sm">${e.price.toFixed(2)}</td>
        <td class="num hide-sm">${(e.delta * (l.side === "buy" ? 1 : -1)).toFixed(2)}</td>
        <td><button class="x" data-rm="${i}" aria-label="Remove leg">✕</button></td></tr>`;
    }).join("") || `<tr><td colspan="8" class="left muted">Add a call, put or shares, or pick a strategy above.</td></tr>`;
    if (!state.legs.length) { $("result").innerHTML = ""; $("chart").innerHTML = ""; $("legend").innerHTML = ""; return; }
    results();
  }

  function results() {
    const A = analyze();
    const fmtMax = (v) => (v === Infinity ? "Unlimited" : v === -Infinity ? "Unlimited" : money(Math.abs(v), state.cur));
    $("result").innerHTML = `<div class="stats">
      <div class="stat"><div class="label">${A.net >= 0 ? "Credit received" : "Cost to open"}</div><div class="value num">${f2(Math.abs(A.net))}</div></div>
      <div class="stat"><div class="label">Most you can make</div><div class="value num up">${fmtMax(A.maxP)}</div></div>
      <div class="stat"><div class="label">Most you can lose</div><div class="value num down">${A.maxL >= 0 ? "Nothing" : fmtMax(A.maxL)}</div></div>
      <div class="stat"><div class="label">Break-even at expiry</div><div class="value num">${A.be.length ? A.be.map((x) => f2(x)).join(" and ") : "–"}</div></div>
      <div class="stat" title="Chance the stock ends where this makes money at expiry, if it moves as the volatility says"><div class="label">Chance of profit</div><div class="value num">${A.prob.toFixed(0)}%</div></div>
      <div class="stat" title="Change in value if the stock rises $1"><div class="label">Delta</div><div class="value num">${A.g.delta >= 0 ? "+" : ""}${A.g.delta.toFixed(0)}</div></div>
      <div class="stat" title="Change in value per day from time passing"><div class="label">Theta / day</div><div class="value">${signed(A.g.theta)}</div></div>
      <div class="stat" title="Change in value if volatility rises 1 point"><div class="label">Vega</div><div class="value">${signed(A.g.vega)}</div></div>
    </div>`;
    draw(A);
  }

  function draw(A) {
    const el = $("chart");
    const W = el.clientWidth || 800, H = W < 500 ? 240 : 320, pad = { l: 8, r: 70, t: 10, b: 24 };
    const ys = A.pts.map((p) => p[1]).concat(A.now.map((p) => p[1]));
    let lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
    const span = hi - lo || 1; lo -= span * 0.08; hi += span * 0.08;
    const X = (s) => pad.l + (s - A.lo) / (A.hi - A.lo) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const raw = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const short = (v) => (v < 0 ? "−" : v > 0 ? "+" : "") + UI.big(Math.abs(v), "").replace(/^\$/, "");
    let grid = "";
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid += `<line class="${Math.abs(v) < step / 1000 ? "base" : "grid"}" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${W - pad.r + 6}" y="${Y(v) + 4}">${short(v)}</text>`;
    const ticks = W < 500 ? 3 : 6;
    for (let k = 0; k <= ticks; k++) {
      const s = A.lo + (A.hi - A.lo) * k / ticks;
      grid += `<text class="axis" x="${X(s)}" y="${H - 6}" text-anchor="${k === 0 ? "start" : k === ticks ? "end" : "middle"}">${s.toFixed(s >= 100 ? 0 : 2)}</text>`;
    }
    // Shade profit green and loss red under the expiry line
    const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    const area = `M${X(A.pts[0][0])},${Y(0)}` + A.pts.map((p) => `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("") + `L${X(A.pts[A.pts.length - 1][0])},${Y(0)}Z`;
    const z = Y(0).toFixed(1);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <defs><clipPath id="op-up"><rect x="0" y="0" width="${W}" height="${z}"/></clipPath><clipPath id="op-dn"><rect x="0" y="${z}" width="${W}" height="${H}"/></clipPath></defs>
      ${grid}
      <path d="${area}" fill="var(--up)" fill-opacity=".14" clip-path="url(#op-up)"/><path d="${area}" fill="var(--down)" fill-opacity=".14" clip-path="url(#op-dn)"/>
      <line class="op-spot" x1="${X(state.spot)}" x2="${X(state.spot)}" y1="${pad.t}" y2="${H - pad.b}"/>
      ${A.be.map((b) => `<circle cx="${X(b)}" cy="${Y(0)}" r="3.5" class="op-be"/>`).join("")}
      <path class="ind cmp dash" style="--c:var(--cmp-1)" d="${path(A.now)}"/>
      <path class="ind cmp" style="--c:var(--cmp-2)" d="${path(A.pts)}"/>
      <line class="cross" id="cx" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/></svg>`;
    const legend = (S) => {
      const at = S ?? state.spot;
      return `<span class="leg"><b>Stock at ${f2(at)}</b></span>
        <span class="leg"><i class="sw" style="--c:var(--cmp-2)"></i><b>At expiry</b> ${signed(total(at, 0))}</span>
        <span class="leg"><i class="sw dash" style="--c:var(--cmp-1)"></i><b>Today (${state.days} days left)</b> ${signed(total(at, state.days / 365))}</span>`;
    };
    $("legend").innerHTML = legend(null);
    const svg = el.querySelector("svg"), cx = el.querySelector("#cx");
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width);
      const S = A.lo + (x - pad.l) / (W - pad.l - pad.r) * (A.hi - A.lo);
      if (S < A.lo || S > A.hi) return;
      cx.setAttribute("x1", x); cx.setAttribute("x2", x); cx.setAttribute("visibility", "visible");
      $("legend").innerHTML = legend(S);
    });
    svg.addEventListener("pointerleave", () => { cx.setAttribute("visibility", "hidden"); $("legend").innerHTML = legend(null); });
  }

  // ---- events
  $("presets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]");
    if (!b) return;
    state.preset = b.dataset.p;
    state.legs = PRESETS.find((p) => p[0] === state.preset)[3]();
    render();
  });
  $("legs").addEventListener("change", (e) => {
    const k = e.target.dataset.k, tr = e.target.closest("tr");
    if (!k || !tr) return;
    const l = state.legs[+tr.dataset.i];
    l[k] = k === "side" || k === "type" ? e.target.value : Math.max(0, +e.target.value || 0);
    if (k === "qty") l.qty = Math.max(1, Math.round(l.qty));
    if (k === "type") { if (l.type === "stock") { l.strike = 0; l.premium = state.spot; } else { l.strike = roundStrike(state.spot); l.premium = +est(l).price.toFixed(2); } }
    if (k === "strike") l.premium = +est(l).price.toFixed(2);
    state.preset = null;
    render();
  });
  $("legs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (b) { state.legs.splice(+b.dataset.rm, 1); state.preset = null; render(); }
  });
  for (const [id, type] of [["add-call", "call"], ["add-put", "put"], ["add-stock", "stock"]]) {
    $(id).addEventListener("click", () => { state.legs.push(leg("buy", type)); state.preset = null; render(); });
  }
  $("reprice").addEventListener("click", () => {
    for (const l of state.legs) l.premium = l.type === "stock" ? state.spot : +est(l).price.toFixed(2);
    render();
  });
  for (const id of ["spot", "days", "vol", "rate"]) {
    $(id).addEventListener("input", () => {
      const v = +$(id).value;
      if (!(v > 0) && id !== "rate") return;
      state[id] = id === "days" ? Math.max(1, Math.round(v)) : v;
      if (id === "spot") { state.t = null; $("stock").placeholder = "Fill from a stock (optional)…"; }
      clearTimeout(render.t); render.t = setTimeout(render, 200);
    });
  }
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(results, 200); });
  render();
})();
