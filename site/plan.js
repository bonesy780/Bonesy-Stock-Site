// Investment plan: pick an amount and a target yearly return (about 4%, 6% or
// 10%) and see a suggested split across kinds of investments, a projected
// range of outcomes, stress tests against 2008 and 2022, and written steps.
// Everything here is long-run estimates, worked out in the browser.
(function () {
  const { esc, money } = UI;
  const $ = (id) => document.getElementById(id);

  // Long-run expected yearly return and typical yearly swing (standard
  // deviation), both in percent; roughly how each did in 2008 and 2022 (total
  // return); and the yield each pays today, roughly.
  const ASSETS = {
    cash: { name: "Treasury bills & money market", ret: 3.5, vol: 0.8, y08: 1.6, y22: 1.5, yld: 3.5, color: "--cmp-6", ex: ["SGOV", "BIL"], lc: "Treasury bills or a money-market fund",
      role: "Almost no chance of losing money. Pays whatever short-term interest rates pay, so it earns less if rates are cut." },
    bonds: { lc: "investment-grade bonds", name: "Investment-grade bonds", ret: 4.5, vol: 6, y08: 5.2, y22: -13.0, yld: 4.2, color: "--cmp-3", ex: ["BND", "AGG"],
      role: "Steady interest income that usually holds up when stocks fall. Drops when rates jump, as in 2022." },
    div: { lc: "dividend stocks", name: "Dividend stocks", ret: 8, vol: 15, y08: -31, y22: -3.2, yld: 3.5, color: "--cmp-4", ex: ["SCHD", "VIG"],
      role: "Large, established companies that pay you cash every quarter, with some growth on top." },
    us: { lc: "a US stock index fund", name: "US stock index", ret: 9, vol: 16, y08: -37, y22: -18.1, yld: 1.2, color: "--cmp-2", ex: ["VOO", "VTI"],
      role: "The whole US market in one fund at a tiny fee. The main engine of long-run growth." },
    intl: { lc: "international stocks", name: "International stocks", ret: 8, vol: 17, y08: -43.4, y22: -16.0, yld: 3.0, color: "--cmp-5", ex: ["VXUS"],
      role: "Thousands of companies outside the US, so the plan doesn't ride on one country." },
    growth: { lc: "growth and tech stocks", name: "Growth & tech stocks", ret: 10.5, vol: 22, y08: -41.9, y22: -32.6, yld: 0.6, color: "--cmp-1", ex: ["QQQM", "VUG"],
      role: "Fast-growing companies. The highest expected return, and the biggest swings in both directions." },
  };
  const STOCKS = new Set(["div", "us", "intl", "growth"]);
  const corr = (a, b) => {
    if (a === b) return 1;
    if (a === "cash" || b === "cash") return 0;
    if (STOCKS.has(a) && STOCKS.has(b)) return (a === "div" && b === "growth") || (a === "growth" && b === "div") ? 0.75 : 0.85;
    return 0.1; // bonds with stocks
  };

  const PLANS = {
    4: { key: 4, label: "About 4%", name: "Safe income", risk: "Low", pill: "buy", alloc: { cash: 50, bonds: 40, div: 10 },
      fits: "Money you may need in the next 1 to 3 years, or money you simply can't stand to see fall. Most of the return is interest, so it's steady but barely beats inflation.",
      one: "There's no single fund that does this; two funds (a T-bill fund and a bond fund) cover 90% of it." },
    6: { key: 6, label: "About 6%", name: "Balanced", risk: "Medium", pill: "", alloc: { cash: 10, bonds: 45, div: 20, us: 20, intl: 5 },
      fits: "Money for goals 4 to 10 years out, like a house or a car fund that can wait. About half in stocks for growth and half in bonds and T-bills to soften the drops.",
      one: "A single all-in-one fund such as AOM (about 40% stocks, 60% bonds) gets you close to this mix in one purchase." },
    10: { key: 10, label: "About 10%", name: "Growth", risk: "High", pill: "sell", alloc: { us: 50, growth: 40, intl: 10 },
      fits: "Money you won't touch for 10 years or more, such as retirement savings. It's all stocks: about 10% a year is roughly what the stock market has averaged over long periods, but some years it falls 30% to 40%.",
      one: "A single total-market fund such as VTI or VOO gets you most of this. Adding QQQM tilts it toward growth." },
  };
  const AMOUNTS = [10000, 20000, 50000];

  // ---- state, kept in the address so a plan can be shared or bookmarked
  const q = new URLSearchParams(location.search);
  const saved = UI.store.get("plan", {});
  const num = (v, d) => (v != null && v !== "" && isFinite(+v) ? +v : d);
  const state = {
    amount: Math.max(100, num(q.get("a"), saved.amount ?? 10000)),
    target: PLANS[q.get("r")] ? +q.get("r") : PLANS[saved.target] ? saved.target : 6,
    years: num(q.get("y"), saved.years ?? 10),
    monthly: Math.max(0, num(q.get("m"), saved.monthly ?? 0)),
  };

  // ---- math
  function stats(plan) {
    const keys = Object.keys(plan.alloc), w = (k) => plan.alloc[k] / 100;
    const ret = keys.reduce((s, k) => s + w(k) * ASSETS[k].ret, 0);
    let v = 0;
    for (const a of keys) for (const b of keys) v += w(a) * w(b) * ASSETS[a].vol * ASSETS[b].vol * corr(a, b);
    const vol = Math.sqrt(v);
    const y08 = keys.reduce((s, k) => s + w(k) * ASSETS[k].y08, 0);
    const y22 = keys.reduce((s, k) => s + w(k) * ASSETS[k].y22, 0);
    const yld = keys.reduce((s, k) => s + w(k) * ASSETS[k].yld, 0);
    // Yearly returns treated as lognormal with this mean and spread
    const E = ret / 100, S = vol / 100;
    const s = Math.sqrt(Math.log(1 + (S * S) / ((1 + E) * (1 + E))));
    const mu = Math.log(1 + E) - (s * s) / 2;
    const lossChance = phi((Math.log(1) - mu) / s);
    return { ret, vol, y08, y22, yld, mu, s, lossChance };
  }
  function phi(z) { // normal CDF
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }
  function rng(seed) { // mulberry32, so the same inputs always draw the same paths
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Simulated paths: value at the end of each year, then the 10th, 50th and
  // 90th percentile for each year
  function project(st, amount, monthly, years, n = 3000) {
    const r = rng(12345), cols = Array.from({ length: years + 1 }, () => new Float64Array(n));
    const add = monthly * 12;
    for (let i = 0; i < n; i++) {
      let v = amount;
      cols[0][i] = v;
      for (let y = 1; y <= years; y++) {
        const z = Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
        const g = Math.exp(st.mu + st.s * z);
        v = v * g + add * Math.sqrt(g); // monthly adds go in through the year, so they get about half the year's growth
        cols[y][i] = v;
      }
    }
    return cols.map((c, y) => {
      const s = Array.from(c).sort((a, b) => a - b);
      const at = (p) => s[Math.min(n - 1, Math.floor(p * n))];
      return { y, lo: at(0.1), mid: at(0.5), hi: at(0.9), paid: amount + add * y, below: s.findIndex((x) => x >= amount + add * y) / n };
    });
  }

  // ---- drawing
  const usd = (v) => money(Math.round(v)).replace(/\.00$/, "");
  const pc = (v, nd = 1) => `${v >= 0 ? "" : "−"}${Math.abs(v).toFixed(nd)}%`;
  const sgn = (v, nd = 1) => `<span class="num ${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(nd)}%</span>`;

  function seg(el, items, cur, onPick) {
    el.innerHTML = items.map(([v, label]) => `<button type="button" role="tab" data-v="${v}" aria-selected="${v === cur}">${esc(label)}</button>`).join("");
    el.onclick = (e) => { const b = e.target.closest("button"); if (b) onPick(+b.dataset.v); };
  }

  function render() {
    const plan = PLANS[state.target], st = stats(plan);
    const { amount, monthly } = state, years = state.years;
    seg($("amounts"), AMOUNTS.map((a) => [a, "$" + a / 1000 + "k"]), amount, (v) => { state.amount = v; $("amount").value = ""; render(); });
    seg($("targets"), Object.values(PLANS).map((p) => [p.key, `${p.label} · ${p.name}`]), state.target, (v) => { state.target = v; render(); });
    if (!AMOUNTS.includes(amount)) $("amount").value = amount;

    const proj = project(st, amount, monthly, years), end = proj[years];
    const paid = end.paid;
    const income = (amount * st.yld) / 100;

    // summary
    $("summary").innerHTML = `<div class="stats pl-stats">
      <div class="stat"><div class="label">Plan</div><div class="value big-v">${esc(plan.name)} <span class="pill ${plan.pill}">${esc(plan.risk)} risk</span></div></div>
      <div class="stat"><div class="label">Expected per year</div><div class="value big-v">${pc(st.ret)}</div></div>
      <div class="stat"><div class="label">Typical after ${years} yrs</div><div class="value big-v">${usd(end.mid)}</div></div>
      <div class="stat"><div class="label">Bad case · good case</div><div class="value">${usd(end.lo)} · ${usd(end.hi)}</div></div>
      <div class="stat"><div class="label">${monthly ? "Total put in" : "Put in"}</div><div class="value">${usd(paid)}</div></div>
      <div class="stat"><div class="label">Pays out now</div><div class="value">${usd(income)}/yr <span class="hint">(${usd(income / 12)}/mo)</span></div></div>
      <div class="stat"><div class="label">Chance of a down year</div><div class="value">${Math.round(st.lossChance * 100)}%</div></div>
      <div class="stat"><div class="label">In a 2008-type year</div><div class="value">${sgn(st.y08)} <span class="hint">${usd((amount * st.y08) / 100)}</span></div></div>
    </div>`;

    // allocation
    const keys = Object.keys(plan.alloc).sort((a, b) => plan.alloc[b] - plan.alloc[a]);
    $("bar").innerHTML = keys.map((k) => `<i style="width:${plan.alloc[k]}%;--c:var(${ASSETS[k].color})" title="${esc(ASSETS[k].name)} ${plan.alloc[k]}%"></i>`).join("");
    $("alloc").innerHTML = `<table class="pl-table"><thead><tr><th class="left">Type</th><th>Share</th><th>Amount</th><th>Expected/yr</th><th class="left">Example funds</th></tr></thead><tbody>
      ${keys.map((k) => { const a = ASSETS[k]; return `<tr>
        <td class="left"><div class="pl-asset"><span><i class="pl-dot" style="--c:var(${a.color})"></i><b>${esc(a.name)}</b></span><span class="hint">${esc(a.role)}</span></div></td>
        <td class="num">${plan.alloc[k]}%</td><td class="num">${usd((amount * plan.alloc[k]) / 100)}</td><td class="num">${pc(a.ret)}</td>
        <td class="left"><span class="tags">${a.ex.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</span></td></tr>`; }).join("")}
      </tbody></table>`;

    drawChart(proj);
    $("chart-note").textContent = `The shaded band is the middle 80% of 3,000 simulated outcomes: 1 in 10 ends below it, 1 in 10 above. Chance of ending with less than you put in: ${Math.round(end.below * 100)}%.`;

    writePlan(plan, st, proj);
    compare();
    save();
  }

  function drawChart(proj) {
    const el = $("chart");
    const W = el.clientWidth || 600, H = W < 500 ? 240 : 300, pad = { l: 8, r: 64, t: 10, b: 24 };
    const n = proj.length - 1;
    const hi = Math.max(...proj.map((p) => p.hi)) * 1.05, lo = 0;
    const X = (y) => pad.l + (y / (n || 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const raw = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const short = (v) => v >= 1e6 ? "$" + +(v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "$" + +(v / 1e3).toFixed(0) + "K" : "$" + v.toFixed(0);
    let grid = "";
    for (let v = 0; v <= hi; v += step) grid += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${W - pad.r + 6}" y="${Y(v) + 4}">${short(v)}</text>`;
    const every = n <= 5 ? 1 : n <= 10 ? 2 : 5;
    for (let y = 0; y <= n; y += every) grid += `<text class="axis" x="${X(y)}" y="${H - 6}" text-anchor="${y === 0 ? "start" : y === n ? "end" : "middle"}">${y === 0 ? "Now" : "Yr " + y}</text>`;
    const line = (f) => proj.map((p, i) => `${i ? "L" : "M"}${X(p.y).toFixed(1)},${Y(f(p)).toFixed(1)}`).join("");
    const band = line((p) => p.hi) + proj.slice().reverse().map((p) => `L${X(p.y).toFixed(1)},${Y(p.lo).toFixed(1)}`).join("") + "Z";
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Projected value over ${n} years">${grid}
      <path class="pl-band" d="${band}"/>
      <path class="ind cmp" style="--c:var(--cmp-2)" d="${line((p) => p.mid)}"/>
      <path class="ind dash" style="--c:var(--muted)" d="${line((p) => p.paid)}"/>
      <line class="cross" id="cx" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/></svg>`;
    const legend = (p) => `${p.y ? `<span class="leg"><b>Year ${p.y}</b></span>` : ""}
      <span class="leg"><i class="sw" style="--c:var(--cmp-2)"></i><b>Typical</b> ${usd(p.mid)}</span>
      <span class="leg"><i class="pl-sq"></i><b>Bad–good case</b> ${usd(p.lo)} – ${usd(p.hi)}</span>
      <span class="leg"><i class="sw dash" style="--c:var(--muted)"></i><b>Put in</b> ${usd(p.paid)}</span>`;
    $("legend").innerHTML = legend(proj[n]);
    const svg = el.querySelector("svg"), cx = el.querySelector("#cx");
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width);
      const y = Math.max(0, Math.min(n, Math.round(((x - pad.l) / (W - pad.l - pad.r)) * n)));
      cx.setAttribute("x1", X(y)); cx.setAttribute("x2", X(y)); cx.setAttribute("visibility", "visible");
      $("legend").innerHTML = legend(proj[y]);
    });
    svg.addEventListener("pointerleave", () => { cx.setAttribute("visibility", "hidden"); $("legend").innerHTML = legend(proj[n]); });
  }

  function writePlan(plan, st, proj) {
    const { amount, monthly, years } = state, end = proj[years];
    const keys = Object.keys(plan.alloc).sort((a, b) => plan.alloc[b] - plan.alloc[a]);
    const small = amount < 15000, big = amount >= 40000;
    const buys = keys.map((k) => `<li><b>${usd((amount * plan.alloc[k]) / 100)}</b> (${plan.alloc[k]}%) into ${esc(ASSETS[k].lc)}, for example ${ASSETS[k].ex.map(esc).join(" or ")}.</li>`).join("");
    const steps = [];
    steps.push(`<b>Get the basics in place first.</b> Keep 3 to 6 months of expenses in a savings account that isn't part of this plan, and pay off any credit card or loan charging more than about 7%. Paying off a 22% card is a guaranteed 22% return, better than anything below.`);
    steps.push(`<b>Pick the account.</b> If this is for retirement, use a Roth or traditional IRA (or your 401(k)) first so the growth isn't taxed each year. ${big ? "An IRA only takes a few thousand dollars a year, so the rest of $" + (amount / 1000).toFixed(0) + "k goes in a regular brokerage account. " : ""}${plan.alloc.cash >= 30 ? "Interest from Treasury bills is free of state income tax, which helps in a regular account." : "Any large brokerage (Fidelity, Schwab, Vanguard and others) offers these funds with no trading fees."}`);
    steps.push(`<b>Buy the funds.</b><ul>${buys}</ul>${small ? `<span class="hint">With ${usd(amount)}, fractional shares let you buy exact dollar amounts. Simpler option: ${esc(plan.one)}</span>` : big && plan.alloc.cash ? `<span class="hint">With ${usd(amount)}, you can also hold the T-bill part as actual Treasury bills or a short ladder of bills and CDs at your broker, locking in today's rate for 3 to 12 months at a time.</span>` : `<span class="hint">Simpler option: ${esc(plan.one)}</span>`}`);
    steps.push(monthly
      ? `<b>Automate the ${usd(monthly)} a month.</b> Set up automatic investing so each deposit is split by the same percentages. Over ${years} years that's ${usd(monthly * 12 * years)} more put in, and it's the biggest lever you control.`
      : `<b>Add to it if you can.</b> Even $100 to $200 a month makes a big difference over ${years} years. Try it in "Add each month" above.`);
    steps.push(`<b>Rebalance once a year.</b> Pick a date. If any piece has drifted more than 5 points from its target share, sell some of what grew and buy what lagged. Reinvest all dividends and interest automatically.`);
    const risk = plan.key === 4
      ? `If the Fed cuts rates, T-bill and money-market yields fall with them and this plan could earn closer to 3%. In a 2022-type year, when bonds dropped sharply, it would have been about ${pc(st.y22)} (${usd((amount * st.y22) / 100)}). The bigger long-run risk is inflation eating most of the gain.`
      : plan.key === 6
        ? `In 2022 stocks and bonds fell together, and this mix would have lost about ${pc(Math.abs(st.y22))} (${usd((amount * st.y22) / 100)}). In 2008 it would have been about ${pc(st.y08)}. Both times it recovered within about 2 to 3 years for people who held on.`
        : `In a 2008-type crash this plan would fall about ${pc(Math.abs(st.y08))}, taking ${usd(amount)} to roughly ${usd(amount * (1 + st.y08 / 100))}, and it took the market about 4 to 5 years to fully recover. In 2022 it would have lost about ${pc(Math.abs(st.y22))}. Selling in a crash is how this plan fails, so only use money you can leave alone.`;
    steps.push(`<b>Know what can go wrong.</b> ${risk}`);
    steps.push(plan.key === 4
      ? `<b>When to change plans.</b> If your timeline stretches past about 4 years, the Balanced plan's extra growth is usually worth its bumpier ride.`
      : `<b>When to change plans.</b> When you're within about 3 years of needing the money, start moving it toward the ${plan.key === 10 ? "Balanced and then the " : ""}Safe income plan so a bad year can't hit right when you need to withdraw.`);
    const real = plan.key === 10
      ? `<p class="pl-note"><b>Reality check on 10%.</b> About 10% a year is roughly what US stocks have averaged over the long run, and there's no way to get it without accepting stock-market drops. Over ${years} years, outcomes in this plan range from about ${usd(end.lo)} to ${usd(end.hi)}. Anyone offering a safe or guaranteed 10% is a red flag.</p>`
      : plan.key === 4
        ? `<p class="pl-note"><b>Reality check on 4%.</b> This leans on today's interest rates. It's the most predictable plan here, but after inflation (around 2 to 3%) the money grows only slowly.</p>`
        : "";
    $("plan").innerHTML = `<h2>${esc(plan.name)} plan for ${usd(amount)}${monthly ? ` + ${usd(monthly)}/month` : ""}</h2>
      <p class="pl-fits"><b>Who it fits:</b> ${esc(plan.fits)}</p>
      ${real}
      <ol class="pl-steps">${steps.map((s) => `<li>${s}</li>`).join("")}</ol>`;
  }

  function compare() {
    const { amount, monthly, years } = state;
    const rows = Object.values(PLANS).map((p) => {
      const st = stats(p), e = project(st, amount, monthly, years)[years];
      return `<tr${p.key === state.target ? ' class="pl-on"' : ""}><td class="left"><button type="button" class="plain-link pl-pick-btn" data-v="${p.key}">${esc(p.name)}</button> <span class="hint">${esc(p.label)}</span></td>
        <td><span class="pill ${p.pill}">${esc(p.risk)}</span></td><td class="num">${pc(st.ret)}</td><td class="num">${usd(e.mid)}</td><td class="num">${usd(e.lo)}</td><td class="num">${usd(e.hi)}</td>
        <td>${sgn(st.y08)}</td><td>${sgn(st.y22)}</td></tr>`;
    }).join("");
    $("compare").innerHTML = `<table class="pl-table pl-cmp-t"><thead><tr><th class="left">Plan</th><th>Risk</th><th>Expected/yr</th><th>Typical after ${years} yrs</th><th>Bad case</th><th>Good case</th><th>2008-type year</th><th>2022-type year</th></tr></thead><tbody>${rows}</tbody></table>`;
    $("compare").onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) { state.target = +b.dataset.v; render(); window.scrollTo({ top: 0, behavior: "smooth" }); } };
  }

  function save() {
    UI.store.set("plan", state);
    const p = new URLSearchParams({ a: state.amount, r: state.target, y: state.years, m: state.monthly });
    history.replaceState(null, "", "?" + p);
  }

  // ---- inputs
  $("years").value = String(state.years);
  if (!$("years").value) { state.years = 10; $("years").value = "10"; }
  $("monthly").value = state.monthly;
  $("years").addEventListener("change", (e) => { state.years = +e.target.value; render(); });
  $("monthly").addEventListener("input", (e) => { state.monthly = Math.max(0, +e.target.value || 0); render(); });
  $("amount").addEventListener("input", (e) => { const v = +e.target.value; if (v >= 100) { state.amount = v; render(); } });
  let resizeT;
  window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(render, 200); });
  render();
})();
