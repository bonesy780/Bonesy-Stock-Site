(async function () {
  const { esc, money, store } = UI;
  const $ = (id) => document.getElementById(id);
  const M = await UI.market().catch(() => null);
  if (M) {
    $("updated").textContent = "Prices from " + new Date(M.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } else {
    $("updated").textContent = "";
  }

  const n = (v) => (Number.isFinite(v) ? v : null);
  const f2 = (v, cur = "USD") => (v == null ? "–" : money(v, cur));
  const p2 = (v) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
  const cls = (v) => (v == null ? "" : v >= 0 ? "up" : "down");
  const out = (label, value, extra = "", c = "") => `<div class="calc-out ${extra}"><span>${esc(label)}</span><strong class="num ${c}">${value}</strong></div>`;

  // A little line chart for the growth and options calculators
  function lineChart(pts, { W = 460, H = 180, zero = false, fmtY = (v) => v.toFixed(0), fmtX = (x) => x, fill = true } = {}) {
    if (pts.length < 2) return "";
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    let lo = Math.min(...ys, zero ? 0 : Infinity), hi = Math.max(...ys, zero ? 0 : -Infinity);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = { l: 4, r: 64, t: 8, b: 20 };
    const X = (x) => pad.l + (x - xs[0]) / ((xs[xs.length - 1] - xs[0]) || 1) * (W - pad.l - pad.r);
    const Y = (y) => pad.t + (1 - (y - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    const z = zero ? `<line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0)}" y2="${Y(0)}"/>` : "";
    return `<svg class="calc-chart" viewBox="0 0 ${W} ${H}" aria-hidden="true">${z}
      ${fill && !zero ? `<path d="${d}L${X(xs[xs.length - 1])},${H - pad.b}L${X(xs[0])},${H - pad.b}Z" fill="var(--accent)" fill-opacity=".1"/>` : ""}
      <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>
      <text class="axis" x="${W - pad.r + 6}" y="${Y(hi) + 8}">${fmtY(hi)}</text>
      <text class="axis" x="${W - pad.r + 6}" y="${Y(lo)}">${fmtY(lo)}</text>
      <text class="axis" x="${pad.l}" y="${H - 4}">${fmtX(xs[0])}</text>
      <text class="axis" x="${W - pad.r}" y="${H - 4}" text-anchor="end">${fmtX(xs[xs.length - 1])}</text></svg>`;
  }

  // Each calculator: inputs [id, label, default, opts] and a calc(values) returning the result HTML.
  // A "stock" input lets the reader pick a stock to fill `fills` from its latest data.
  const CALCS = [
    {
      id: "size", title: "Position size",
      intro: "How many shares to buy so that, if the price falls to your stop, you lose only the share of your account you chose.",
      stock: { p: "entry" },
      inputs: [["account", "Account size ($)", 25000], ["risk", "Risk per trade (%)", 1], ["entry", "Entry price", 50], ["stop", "Stop-loss price", 47], ["target", "Target price (optional)", 56]],
      calc: (v) => {
        const riskAmt = v.account * v.risk / 100, per = Math.abs(v.entry - v.stop);
        if (!per) return `<p class="hint">Entry and stop can't be the same price.</p>`;
        const shares = Math.floor(riskAmt / per), pos = shares * v.entry;
        const short = v.stop > v.entry;
        const rr = v.target ? Math.abs(v.target - v.entry) / per : null;
        return out("Shares to buy", shares.toLocaleString(), "lead")
          + out("Position value", f2(pos)) + out("Share of account", p2(pos / v.account * 100).replace("+", ""))
          + out("Money at risk", f2(shares * per)) + out("Risk per share", f2(per))
          + (rr ? out("Reward : risk", `${rr.toFixed(2)} : 1`, "", rr >= 2 ? "up" : rr < 1 ? "down" : "") + out("Profit at target", f2(shares * Math.abs(v.target - v.entry))) : "")
          + (short ? `<p class="hint">Your stop is above your entry, so this is sized as a short sale.</p>` : "")
          + (pos > v.account ? `<p class="hint down">This position is bigger than your account. You'd need margin, or a wider stop and fewer shares.</p>` : "");
      },
    },
    {
      id: "pl", title: "Profit and loss",
      intro: "What a trade made or lost after commissions, and the price you need to break even.",
      stock: { p: "sell" },
      inputs: [["shares", "Shares", 100], ["buy", "Buy price", 50], ["sell", "Sell price (or price now)", 57.5], ["fee", "Commission per trade ($)", 0], ["days", "Days held (optional)", 0]],
      calc: (v) => {
        const cost = v.shares * v.buy + v.fee, proceeds = v.shares * v.sell - v.fee, gain = proceeds - cost;
        const r = cost ? gain / cost * 100 : null;
        const be = v.shares ? (cost + v.fee) / v.shares : null;
        const yearly = v.days > 0 && r != null && r > -100 ? ((1 + r / 100) ** (365 / v.days) - 1) * 100 : null;
        return out("Profit / loss", `${gain >= 0 ? "+" : "−"}${f2(Math.abs(gain))}`, "lead", cls(gain))
          + out("Return", p2(r), "", cls(r)) + out("Total cost", f2(cost)) + out("Total proceeds", f2(proceeds))
          + out("Break-even sell price", f2(be))
          + (yearly != null ? out("Yearly rate (annualized)", p2(yearly), "", cls(yearly)) : "");
      },
    },
    {
      id: "avg", title: "Average cost",
      intro: "Your new average price per share after buying more (averaging down or up).",
      stock: { p: "price" },
      inputs: [["have", "Shares you own", 100], ["avg", "Your average cost", 60], ["add", "Shares to buy", 50], ["price", "Price of new shares", 45]],
      calc: (v) => {
        const total = v.have + v.add, cost = v.have * v.avg + v.add * v.price;
        const na = total ? cost / total : null;
        return out("New average cost", f2(na), "lead") + out("Total shares", total.toLocaleString()) + out("Total invested", f2(cost))
          + out("Change in average", p2(v.avg ? (na / v.avg - 1) * 100 : null), "", cls(-(na - v.avg)))
          + out("Rise needed to break even", p2(v.price ? (na / v.price - 1) * 100 : null).replace("+", ""));
      },
    },
    {
      id: "div", title: "Dividend income",
      intro: "Yearly and monthly income from a dividend stock, and what reinvesting the dividends (DRIP) could grow to.",
      stock: { p: "price", divYield: "yield" },
      inputs: [["amount", "Amount invested ($)", 10000], ["price", "Share price", 40], ["yield", "Dividend yield (%)", 4], ["growth", "Dividend growth per year (%)", 5], ["priceGrowth", "Share price growth per year (%)", 3], ["years", "Years", 20], ["drip", "Reinvest dividends", 1, { type: "check" }]],
      calc: (v) => {
        const shares0 = v.price ? v.amount / v.price : 0;
        const income = v.amount * v.yield / 100;
        let shares = shares0, price = v.price, dps = v.price * v.yield / 100, total = 0;
        const pts = [[0, v.amount]];
        for (let y = 1; y <= Math.min(60, Math.max(0, Math.round(v.years))); y++) {
          const paid = shares * dps;
          total += paid;
          price *= 1 + v.priceGrowth / 100;
          if (v.drip) shares += paid / price;
          dps *= 1 + v.growth / 100;
          pts.push([y, shares * price]);
        }
        const finalIncome = shares * dps / (1 + v.growth / 100);
        return out("Yearly income now", f2(income), "lead") + out("Monthly", f2(income / 12)) + out("Quarterly", f2(income / 4))
          + out("Shares bought", shares0.toLocaleString(undefined, { maximumFractionDigits: 2 }))
          + out(`Value after ${Math.round(v.years)} years`, f2(pts[pts.length - 1][1])) + out(`Yearly income in year ${Math.round(v.years)}`, f2(finalIncome))
          + out("Total dividends received", f2(total))
          + lineChart(pts, { fmtY: (y) => UI.big(y), fmtX: (x) => `Year ${x}` });
      },
    },
    {
      id: "grow", title: "Compound growth",
      intro: "How regular investing grows over time with compounding, for example in a TFSA, RRSP or 401(k).",
      inputs: [["start", "Starting amount ($)", 5000], ["monthly", "Added each month ($)", 500], ["rate", "Yearly return (%)", 7], ["years", "Years", 25], ["inflation", "Inflation (%) for today's dollars", 2.5]],
      calc: (v) => {
        const months = Math.min(720, Math.max(0, Math.round(v.years * 12))), r = (1 + v.rate / 100) ** (1 / 12) - 1;
        let bal = v.start;
        const pts = [[0, bal]];
        for (let m = 1; m <= months; m++) { bal = bal * (1 + r) + v.monthly; if (m % 12 === 0) pts.push([m / 12, bal]); }
        const put = v.start + v.monthly * months;
        const real = bal / (1 + v.inflation / 100) ** (months / 12);
        return out(`Value after ${months / 12} years`, f2(bal), "lead") + out("You put in", f2(put)) + out("Growth from returns", f2(bal - put), "", "up")
          + out("In today's dollars", f2(real))
          + out("Years to double (rule of 72)", v.rate > 0 ? (72 / v.rate).toFixed(1) : "–")
          + lineChart(pts, { fmtY: (y) => UI.big(y), fmtX: (x) => `Year ${x}` });
      },
    },
    {
      id: "tfsa", title: "TFSA or RRSP",
      intro: "Which Canadian account leaves you with more after tax. An RRSP gives a tax refund now and is taxed when you take money out; a TFSA uses after-tax money and is never taxed again. It comes down to your tax rate now versus in retirement.",
      inputs: [["gross", "Pre-tax income to save ($)", 7000], ["now", "Tax rate now (%)", 30], ["later", "Tax rate when withdrawn (%)", 20], ["rate", "Yearly return (%)", 6], ["years", "Years until withdrawal", 25]],
      calc: (v) => {
        const grow = (1 + v.rate / 100) ** Math.max(0, v.years);
        // RRSP: the whole pre-tax amount goes in (refund included), taxed on the way out
        const rrspGross = v.gross * grow, rrsp = rrspGross * (1 - v.later / 100);
        // TFSA: only what's left after tax goes in, tax-free after that
        const tfsaIn = v.gross * (1 - v.now / 100), tfsa = tfsaIn * grow;
        const win = Math.abs(rrsp - tfsa) < 0.5 ? null : rrsp > tfsa ? "RRSP" : "TFSA";
        return out("Better choice", win || "About the same", "lead", win ? "up" : "")
          + out("RRSP, after tax on withdrawal", f2(rrsp)) + out("TFSA, tax-free", f2(tfsa))
          + out("Difference", f2(Math.abs(rrsp - tfsa)))
          + out("RRSP tax refund now", f2(v.gross * v.now / 100))
          + `<p class="hint">Assumes the RRSP refund goes into the RRSP too, so both start from the same pre-tax income. If you'd spend the refund instead, the TFSA does better. Withdrawals from an RRSP can also reduce income-tested benefits like OAS and GIS. Check your contribution room with the CRA.</p>`;
      },
    },
    {
      id: "retire", title: "Retirement savings",
      intro: "What your savings could grow to by retirement and the yearly income they could pay, in today's dollars.",
      inputs: [["age", "Age now", 35], ["retire", "Retirement age", 65], ["saved", "Saved so far ($)", 50000], ["monthly", "Saving each month ($)", 800], ["rate", "Yearly return (%)", 6], ["inflation", "Inflation (%)", 2.5], ["draw", "Yearly withdrawal (%)", 4]],
      calc: (v) => {
        const years = Math.max(0, Math.min(70, Math.round(v.retire - v.age)));
        if (!years) return `<p class="hint">Retirement age needs to be after your age now.</p>`;
        const r = (1 + v.rate / 100) ** (1 / 12) - 1;
        let bal = v.saved;
        const pts = [[v.age, bal]];
        for (let m = 1; m <= years * 12; m++) { bal = bal * (1 + r) + v.monthly; if (m % 12 === 0) pts.push([v.age + m / 12, bal]); }
        const real = bal / (1 + v.inflation / 100) ** years;
        const income = real * v.draw / 100;
        // How long the money lasts drawing that income, growing with inflation, at the same return
        let left = real, last = 0;
        const realRate = (1 + v.rate / 100) / (1 + v.inflation / 100) - 1;
        while (left > 0 && last < 60) { left = left * (1 + realRate) - income; last++; }
        return out(`Savings at ${v.retire}`, f2(bal), "lead") + out("In today's dollars", f2(real))
          + out("Yearly income (today's dollars)", f2(income), "", "up") + out("Per month", f2(income / 12))
          + out("Money lasts", last >= 60 ? "60+ years" : `about ${last} years`)
          + lineChart(pts, { fmtY: (y) => UI.big(y), fmtX: (x) => `Age ${x}` })
          + `<p class="hint">Before tax. Add government pensions such as CPP/QPP and OAS, or Social Security, on top. A 4% yearly withdrawal has historically lasted about 30 years in most markets.</p>`;
      },
    },
    {
      id: "margin", title: "Margin and margin calls",
      intro: "How much you can borrow to buy a stock and how far it can fall before your broker asks for more money (a margin call).",
      stock: { p: "price" },
      inputs: [["cash", "Your cash ($)", 10000], ["price", "Share price", 50], ["shares", "Shares to buy", 300], ["init", "Margin required to buy (%)", 30], ["maint", "Margin to keep (%)", 30], ["rate", "Margin interest (% a year)", 7]],
      calc: (v) => {
        const cost = v.shares * v.price, loan = Math.max(0, cost - v.cash);
        const power = v.init > 0 ? v.cash / (v.init / 100) : Infinity;
        const eqPct = cost ? (cost - loan) / cost * 100 : 0;
        // Call when (value - loan) / value < maint  =>  price < loan / (shares * (1 - maint))
        const callPx = loan && v.shares && v.maint < 100 ? loan / (v.shares * (1 - v.maint / 100)) : null;
        const over = cost > power;
        return out("Buying power", Number.isFinite(power) ? f2(power) : "–", "lead")
          + out("Position cost", f2(cost)) + out("Borrowed", f2(loan)) + out("Your equity", `${eqPct.toFixed(0)}%`)
          + out("Margin call below", callPx ? f2(callPx) : "No loan", "", callPx ? "down" : "")
          + (callPx ? out("Fall to margin call", p2((callPx / v.price - 1) * 100), "", "down") : "")
          + out("Interest per year", f2(loan * v.rate / 100))
          + (over ? `<p class="hint down">This is more than your buying power. You'd need ${f2(cost * v.init / 100 - v.cash)} more cash.</p>` : "")
          + `<p class="hint">Requirements differ by broker and stock. In Canada many stocks need 30% or more; in the US the starting rule is 50% and the minimum to keep is 25%. Losses on margin can be bigger than your cash.</p>`;
      },
    },
    {
      id: "recover", title: "Recover a loss",
      intro: "The gain you need to get back to even after a loss, and how long that takes at a steady return. Losses hurt more than equal gains help.",
      inputs: [["loss", "Loss (%)", 30], ["rate", "Yearly return after (%)", 8]],
      calc: (v) => {
        const l = Math.min(99.99, Math.max(0, v.loss)) / 100;
        const need = (1 / (1 - l) - 1) * 100;
        const yrs = v.rate > 0 ? Math.log(1 / (1 - l)) / Math.log(1 + v.rate / 100) : null;
        const rows = [10, 20, 30, 50, 75].map((x) => `<span class="num">-${x}% → +${((1 / (1 - x / 100) - 1) * 100).toFixed(0)}%</span>`).join(" · ");
        return out("Gain needed to break even", `+${need.toFixed(1)}%`, "lead", "up")
          + out("Years at that return", yrs != null ? yrs.toFixed(1) : "–")
          + `<p class="hint">${rows}</p>`;
      },
    },
    {
      id: "opt", title: "Options payoff",
      intro: "Profit or loss at expiry for a single call or put, and the stock price where it breaks even. One contract is usually 100 shares.",
      stock: { p: "strike" },
      inputs: [["kind", "Type", "call", { type: "select", options: [["call", "Call (bet the price rises)"], ["put", "Put (bet the price falls)"]] }],
        ["side", "Position", "buy", { type: "select", options: [["buy", "Buy (long)"], ["sell", "Sell / write (short)"]] }],
        ["strike", "Strike price", 100], ["premium", "Premium per share", 4], ["contracts", "Contracts", 1]],
      calc: (v) => {
        const mult = v.contracts * 100, sign = v.side === "buy" ? 1 : -1;
        const pay = (S) => sign * ((v.kind === "call" ? Math.max(0, S - v.strike) : Math.max(0, v.strike - S)) - v.premium) * mult;
        const be = v.kind === "call" ? v.strike + v.premium : v.strike - v.premium;
        const lo = Math.max(0, v.strike * 0.6), hi = v.strike * 1.4;
        const pts = [];
        for (let i = 0; i <= 80; i++) { const S = lo + (hi - lo) * i / 80; pts.push([S, pay(S)]); }
        const cost = v.premium * mult;
        const maxProfit = v.side === "buy" ? (v.kind === "call" ? "Unlimited" : f2((v.strike - v.premium) * mult)) : f2(cost);
        const maxLoss = v.side === "buy" ? f2(cost) : (v.kind === "call" ? "Unlimited" : f2((v.strike - v.premium) * mult));
        return out("Break-even stock price", f2(be), "lead") + out(v.side === "buy" ? "Cost (premium paid)" : "Premium received", f2(cost))
          + out("Most you can make", maxProfit, "", "up") + out("Most you can lose", maxLoss, "", "down")
          + lineChart(pts, { zero: true, fmtY: (y) => (y >= 0 ? "+" : "−") + UI.big(Math.abs(y)), fmtX: (x) => "$" + x.toFixed(0) })
          + `<p class="hint">Chart: profit or loss at expiry (up and down) for stock prices from ${f2(lo)} to ${f2(hi)}. Before expiry the option also has time value, so it's worth more than this.</p>`;
      },
    },
    {
      id: "fx", title: "Currency converter",
      intro: "Convert between the currencies of the markets on this site at the last daily exchange rate, for example to compare a Canadian and a US stock.",
      inputs: [["amount", "Amount", 1000], ["from", "From", "USD", { type: "select", options: [] }], ["to", "To", "CAD", { type: "select", options: [] }]],
      calc: (v) => {
        const fx = (M && M.fx) || null;
        if (!fx) return `<p class="hint">Exchange rates appear after the next data refresh.</p>`;
        const usd = v.amount / (fx[v.from] || 1), res = usd * (fx[v.to] || 1);
        const rate = (fx[v.to] || 1) / (fx[v.from] || 1);
        return out(`${money(v.amount, v.from)} is`, money(res, v.to), "lead") + out(`1 ${v.from}`, `${rate.toLocaleString(undefined, { maximumSignificantDigits: 5 })} ${v.to}`)
          + out(`1 ${v.to}`, `${(1 / rate).toLocaleString(undefined, { maximumSignificantDigits: 5 })} ${v.from}`);
      },
    },
  ];
  const CURS = M && M.fx ? Object.keys(M.fx) : ["USD", "CAD", "JPY", "KRW", "TWD"];
  for (const i of CALCS.find((c) => c.id === "fx").inputs.slice(1)) i[3].options = CURS.map((c) => [c, c]);

  const saved = store.get("calcs", {});
  const values = (c) => {
    const v = {};
    for (const [k, , d, o] of c.inputs) {
      const x = saved[c.id]?.[k] ?? d;
      v[k] = o && (o.type === "select") ? x : o && o.type === "check" ? (x ? 1 : 0) : n(+x) ?? 0;
    }
    return v;
  };

  const field = (c, [k, label, , o], v) => {
    const id = `${c.id}-${k}`;
    if (o && o.type === "select") return `<label for="${id}">${esc(label)}<select class="field" id="${id}" data-k="${k}">${o.options.map(([val, t]) => `<option value="${esc(val)}" ${val === v[k] ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
    if (o && o.type === "check") return `<label class="check" for="${id}"><input type="checkbox" id="${id}" data-k="${k}" ${v[k] ? "checked" : ""}> ${esc(label)}</label>`;
    return `<label for="${id}">${esc(label)}<input class="field" id="${id}" data-k="${k}" type="number" step="any" inputmode="decimal" value="${v[k]}"></label>`;
  };

  let only = store.get("calcTab", "all");
  function render() {
    $("calc-tabs").innerHTML = [["all", "All"]].concat(CALCS.map((c) => [c.id, c.title])).map(([id, t]) =>
      `<button class="tab" role="tab" aria-selected="${id === only}" data-id="${id}">${esc(t)}</button>`).join("");
    $("calcs").innerHTML = CALCS.filter((c) => only === "all" || c.id === only).map((c) => {
      const v = values(c);
      return `<section class="panel calc" id="calc-${c.id}" data-c="${c.id}">
        <h2>${esc(c.title)}</h2>
        <p class="hint">${esc(c.intro)}</p>
        ${c.stock && M ? `<div class="lookup calc-stock"><input id="${c.id}-stock" type="search" placeholder="Fill from a stock (optional)…" aria-label="Fill ${esc(c.title)} from a stock" spellcheck="false"></div>` : ""}
        <div class="calc-in">${c.inputs.map((i) => field(c, i, v)).join("")}</div>
        <div class="calc-res" aria-live="polite">${c.calc(v)}</div>
      </section>`;
    }).join("");
    for (const c of CALCS) {
      const box = document.getElementById(`${c.id}-stock`);
      if (!box) continue;
      UI.picker(box, (s) => {
        const m = M.byTicker[s.t];
        if (!m) return;
        saved[c.id] = { ...values(c) };
        for (const [from, to] of Object.entries(c.stock)) if (m[from] != null) saved[c.id][to] = +(+m[from]).toFixed(m[from] >= 100 ? 2 : 4);
        store.set("calcs", saved);
        render();
        const again = document.getElementById(`${c.id}-stock`);
        again.placeholder = `Filled from ${m.s} (${money(m.p, m.cur)})`;
      });
    }
  }
  $("calcs").addEventListener("input", (e) => {
    const el = e.target.closest("[data-k]");
    if (!el) return;
    const sec = el.closest(".calc"), c = CALCS.find((x) => x.id === sec.dataset.c);
    saved[c.id] = { ...values(c), [el.dataset.k]: el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value : el.value === "" ? 0 : +el.value };
    store.set("calcs", saved);
    sec.querySelector(".calc-res").innerHTML = c.calc(values(c));
  });
  $("calc-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    only = b.dataset.id; store.set("calcTab", only); render();
  });
  render();
})();
