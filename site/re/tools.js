// Mortgage tools: payment and amortization, affordability, and rent versus buy.
(async function () {
  const { esc, money, short, store, payment, COUNTRY, FLAG } = RE;
  const D = await RE.data().catch(() => null);
  const R = (D && D.rates) || {};
  const params = new URLSearchParams(location.search);
  let c = params.get("c") || store.get("re-tools-country", "US");
  // Country presets: currency, typical rate and term, down payment, tax rate on the home
  const PRESET = {
    US: { cur: "USD", rate: R.us30 ? +R.us30.v.toFixed(2) : 6.5, years: 30, down: 20, tax: 1.1, ins: 0.35, price: (D && D.byId.us && D.byId.us.v) || 360000, rent: (D && D.byId.us && D.byId.us.rent) || 2000,
      rateNote: R.us30 ? `Freddie Mac 30-year average, ${R.us30.at}` : "", dti: 36 },
    CA: { cur: "CAD", rate: R.ca5 ? +R.ca5.v.toFixed(2) : 5.5, years: 25, down: 20, tax: 0.8, ins: 0.25, price: 700000, rent: (D && D.byId.ca && D.byId.ca.rent) || 1700,
      rateNote: R.ca5 ? `Bank of Canada 5-year posted rate, ${R.ca5.at}; most lenders discount it` : "", dti: 39 },
    MX: { cur: "MXN", rate: 11, years: 20, down: 20, tax: 0.1, ins: 0.3, price: (D && D.byId.mx && D.byId.mx.v) || 1900000, rent: 14000,
      rateNote: "Typical bank mortgage rate in Mexico; check current offers", dti: 30 },
  };
  const seg = document.getElementById("t-country");
  const out = (label, value, extra = "", cls = "") => `<div class="calc-out ${extra}"><span>${esc(label)}</span><strong class="num ${cls}">${value}</strong></div>`;
  const field = (id, label, v, step = "any", suffix = "") => `<label>${esc(label)}${suffix ? ` <span class="muted">(${suffix})</span>` : ""}<input class="field" id="${id}" type="number" step="${step}" value="${v}"></label>`;
  const val = (id) => { const x = parseFloat(document.getElementById(id).value); return Number.isFinite(x) ? x : 0; };

  function render() {
    const p = PRESET[c];
    store.set("re-tools-country", c);
    seg.innerHTML = ["US", "CA", "MX"].map((k) => `<button role="tab" aria-selected="${k === c}" data-c="${k}">${FLAG[k]} ${COUNTRY[k]}</button>`).join("");
    const price = +params.get("price") || Math.round(p.price / 1000) * 1000;
    const rent = +params.get("rent") || Math.round(p.rent / 10) * 10;
    document.getElementById("pay").innerHTML = `<h2>Mortgage payment</h2>
      <div class="calc-in">${field("p-price", "Home price", price, 1000, p.cur)}${field("p-down", "Down payment", p.down, 1, "%")}
        ${field("p-rate", "Interest rate", p.rate, 0.05, "%")}${field("p-years", "Amortization", p.years, 1, "years")}
        ${field("p-tax", "Property tax", p.tax, 0.05, "% a year")}${field("p-ins", "Home insurance", p.ins, 0.05, "% a year")}</div>
      ${p.rateNote ? `<p class="hint">${esc(p.rateNote)}.</p>` : ""}
      <div class="calc-res" id="p-out"></div>`;
    document.getElementById("afford").innerHTML = `<h2>How much home can I afford?</h2>
      <div class="calc-in">${field("a-income", "Household income", c === "MX" ? 600000 : c === "CA" ? 130000 : 110000, 1000, p.cur + " a year")}${field("a-debts", "Other debt payments", c === "MX" ? 3000 : 400, 50, "a month")}
        ${field("a-down", "Savings for the down payment", c === "MX" ? 400000 : 80000, 1000, p.cur)}${field("a-rate", "Interest rate", p.rate, 0.05, "%")}
        ${field("a-dti", "Max share of income on housing and debts", p.dti, 1, "%")}${field("a-years", "Amortization", p.years, 1, "years")}</div>
      <div class="calc-res" id="a-out"></div>`;
    document.getElementById("rvb").innerHTML = `<h2>Rent or buy?</h2>
      <p class="hint">Compares what you'd have after some years if you bought, against renting and investing the down payment and any monthly savings instead.</p>
      <div class="calc-in re-calc-3">${field("r-price", "Home price", price, 1000, p.cur)}${field("r-rent", "Monthly rent", rent, 10, p.cur)}${field("r-years", "Years you'd stay", 7, 1)}
        ${field("r-down", "Down payment", p.down, 1, "%")}${field("r-rate", "Mortgage rate", p.rate, 0.05, "%")}${field("r-grow", "Home price growth", 3, 0.5, "% a year")}
        ${field("r-rentup", "Rent increase", 3, 0.5, "% a year")}${field("r-invest", "Investment return", 6, 0.5, "% a year")}${field("r-own", "Tax, insurance and upkeep", c === "MX" ? 1 : 2.5, 0.1, "% of price a year")}
        ${field("r-buy", "Buying costs", c === "MX" ? 6 : 3, 0.5, "% of price")}${field("r-sell", "Selling costs", c === "MX" ? 4 : 6, 0.5, "% of price")}</div>
      <div class="calc-res" id="r-out"></div>`;
    calc();
  }
  function calc() {
    const p = PRESET[c], cur = p.cur;
    // Payment
    const price = val("p-price"), down = price * val("p-down") / 100, loan = price - down, rate = val("p-rate"), years = val("p-years") || 25;
    const pm = payment(loan, rate, years, c);
    const tax = price * val("p-tax") / 1200, ins = price * val("p-ins") / 1200;
    const total = pm * years * 12;
    // Mortgage default insurance in Canada below 20% down (CMHC premium, simplified)
    const cmhc = c === "CA" && val("p-down") < 20 && val("p-down") >= 5 ? loan * (val("p-down") < 10 ? 0.04 : val("p-down") < 15 ? 0.031 : 0.028) : 0;
    const bal = [], r = c === "CA" ? (1 + rate / 200) ** (1 / 6) - 1 : rate / 1200;
    let b = loan + cmhc, paidInt = 0;
    const pm2 = payment(loan + cmhc, rate, years, c);
    for (let i = 0; i <= years * 12; i++) {
      if (i % 12 === 0) bal.push([i / 12, b]);
      const int = b * r; paidInt += int; b = Math.max(0, b + int - pm2);
    }
    document.getElementById("p-out").innerHTML = [
      out("Monthly payment", money(pm2 + tax + ins, cur), "lead"),
      out("Principal and interest", money(pm2, cur)), out("Property tax", money(tax, cur)), out("Insurance", money(ins, cur)),
      cmhc ? out("Mortgage default insurance added to the loan", money(cmhc, cur)) : "",
      out("Loan", money(loan + cmhc, cur)), out("Total interest over the loan", money(paidInt, cur)),
      lineChart(bal, (v) => short(v, cur), (x) => `Year ${x}`),
      `<p class="hint">Loan balance over time. ${c === "US" && val("p-down") < 20 ? "Under 20% down, US lenders usually add mortgage insurance (PMI), not included here." : ""}</p>`,
    ].join("");
    // Affordability
    const inc = val("a-income") / 12, debts = val("a-debts"), saved = val("a-down"), ar = val("a-rate"), ay = val("a-years") || 25;
    const room = Math.max(0, inc * val("a-dti") / 100 - debts);
    // Taxes and insurance take a share of the room; solve price so payment + costs fit
    const costShare = (p.tax + p.ins) / 1200;
    let lo = 0, hi = 1e9;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2, l = Math.max(0, mid - saved);
      (payment(l, ar, ay, c) + mid * costShare <= room ? (lo = mid) : (hi = mid));
    }
    const maxPrice = lo;
    const typical = D ? D.markets.filter((m) => m.c === c && m.v && !["us", "ca", "mx"].includes(m.id)) : [];
    const within = typical.filter((m) => m.v <= maxPrice).sort((a, b) => b.v - a.v).slice(0, 6);
    document.getElementById("a-out").innerHTML = [
      out("Home price you could carry", money(maxPrice, cur), "lead"),
      out("Monthly budget for housing", money(room, cur)), out("Loan", money(Math.max(0, maxPrice - saved), cur)),
      out("Down payment share", maxPrice ? (saved / maxPrice * 100).toFixed(1) + "%" : "–"),
      c === "CA" ? `<p class="hint">Canadian lenders also test you at the higher of 5.25% or your rate plus 2 points (the stress test), which lowers this.</p>` : "",
      within.length ? `<p class="hint">Markets where the typical home fits: ${within.map((m) => `<a href="${RE.marketUrl(m.id)}">${esc(m.name)}</a> (${short(m.v, cur)})`).join(", ")}.</p>` : "",
    ].join("");
    // Rent vs buy
    const P = val("r-price"), yrs = Math.max(1, Math.round(val("r-years"))), dp = P * val("r-down") / 100, mr = val("r-rate");
    const g = val("r-grow") / 100, ru = val("r-rentup") / 100, inv = val("r-invest") / 100, own = val("r-own") / 100;
    const loan2 = P - dp, pay = payment(loan2, mr, p.years, c), rr = c === "CA" ? (1 + mr / 200) ** (1 / 6) - 1 : mr / 1200;
    let balance = loan2, home = P, rent = val("r-rent"), invested = dp + P * val("r-buy") / 100, buyCash = 0;
    const lines = [[0, 0]];
    for (let m = 1; m <= yrs * 12; m++) {
      balance = Math.max(0, balance + balance * rr - pay);
      home *= (1 + g) ** (1 / 12);
      const ownCost = pay + home * own / 12;
      // Renter invests the gap when renting is cheaper; buyer invests it when owning is cheaper
      const gap = ownCost - rent;
      invested = invested * (1 + inv) ** (1 / 12) + Math.max(0, gap);
      buyCash = buyCash * (1 + inv) ** (1 / 12) + Math.max(0, -gap);
      if (m % 12 === 0) rent *= 1 + ru;
      if (m % 12 === 0) lines.push([m / 12, (home * (1 - val("r-sell") / 100) - balance + buyCash) - invested]);
    }
    const buyWorth = home * (1 - val("r-sell") / 100) - balance + buyCash;
    const diff = buyWorth - invested;
    document.getElementById("r-out").innerHTML = [
      out(diff >= 0 ? `Buying comes out ahead after ${yrs} years by` : `Renting comes out ahead after ${yrs} years by`, money(Math.abs(diff), cur), "lead", diff >= 0 ? "up" : "down"),
      out("If you buy: home equity after selling costs, plus savings", money(buyWorth, cur)),
      out("If you rent: invested down payment and savings", money(invested, cur)),
      out("Mortgage payment", money(pay, cur) + "/mo"),
      lineChart(lines, (v) => (v >= 0 ? "+" : "") + short(v, cur), (x) => `Year ${x}`, true),
      `<p class="hint">Above the line, buying is ahead by that much; below it, renting is.</p>`,
    ].join("");
  }
  function lineChart(pts, fmtY, fmtX, zero = false) {
    if (pts.length < 2) return "";
    const W = 460, H = 170, pad = { l: 4, r: 70, t: 8, b: 20 };
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    let lo = Math.min(...ys, zero ? 0 : Infinity), hi = Math.max(...ys, zero ? 0 : -Infinity);
    if (hi === lo) { hi += 1; lo -= 1; }
    const X = (x) => pad.l + (x - xs[0]) / ((xs.at(-1) - xs[0]) || 1) * (W - pad.l - pad.r);
    const Y = (y) => pad.t + (1 - (y - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    return `<svg class="calc-chart" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      ${zero ? `<line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0)}" y2="${Y(0)}"/>` : `<path d="${d}L${X(xs.at(-1))},${H - pad.b}L${X(xs[0])},${H - pad.b}Z" fill="var(--accent)" fill-opacity=".1"/>`}
      <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>
      <text class="axis" x="${W - pad.r + 6}" y="${Y(hi) + 8}">${esc(fmtY(hi))}</text><text class="axis" x="${W - pad.r + 6}" y="${Y(lo)}">${esc(fmtY(lo))}</text>
      <text class="axis" x="${pad.l}" y="${H - 4}">${esc(fmtX(xs[0]))}</text><text class="axis" x="${W - pad.r}" y="${H - 4}" text-anchor="end">${esc(fmtX(xs.at(-1)))}</text></svg>`;
  }
  seg.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; c = b.dataset.c; params.delete("price"); params.delete("rent"); render(); });
  document.addEventListener("input", (e) => { if (e.target.closest(".calc")) calc(); });
  render();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();
