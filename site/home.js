// "Your stocks" strip on the Markets page: the reader's watchlist and paper
// portfolio at a glance, from what they saved in this browser.
(async function () {
  const { esc, money, pct, stockUrl, store, Watch } = UI;
  const el = document.getElementById("mine");
  let M;
  try { M = await UI.market(); } catch { return; }
  const live = {};
  const q = (t) => ({ price: live[t]?.price ?? M.byTicker[t]?.p, d1: live[t]?.chg1d ?? M.byTicker[t]?.d1 });

  function portfolio() {
    const P = store.get("portfolios", null);
    const a = P && P.list && (P.list[P.active] || P.list[0]);
    if (!a || !a.trades || !a.trades.length) return null;
    let cash = a.start;
    const qty = {};
    for (const t of a.trades) {
      const v = t.qty * t.price / t.fx;
      cash -= (t.fee || 0) + (t.side === "buy" ? v : -v);
      qty[t.t] = (qty[t.t] || 0) + (t.side === "buy" ? t.qty : -t.qty);
    }
    let value = cash, day = 0, income = 0;
    for (const [t, n] of Object.entries(qty)) {
      if (n <= 1e-9) continue;
      const m = M.byTicker[t] || {}, fx = (M.fx && M.fx[m.cur]) || 1, { price, d1 } = q(t);
      if (price == null) continue;
      const v = n * price / fx;
      value += v;
      if (d1 != null) day += v - v / (1 + d1 / 100);
      if (m.divRate) income += n * m.divRate / fx;
    }
    return { name: a.name, value, day, ret: (value / a.start - 1) * 100, income };
  }

  function render() {
    const W = Watch.all(), list = W.lists[W.active] || W.lists[0];
    const tickers = list.tickers.filter((t) => M.byTicker[t]).slice(0, 12);
    const pf = portfolio();
    if (!tickers.length && !pf) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `
      <div class="snap-head"><h2>Your stocks</h2><a class="btn small" href="watchlist.html">Edit watchlists</a></div>
      <div class="snap-row">
        ${pf ? `<a class="panel snapcard pf-card" href="portfolio.html">
          <div class="tk">Paper trading · ${esc(pf.name)}</div>
          <div class="nm num">${money(pf.value, "USD")}</div>
          <div>${pct(pf.ret, 2)} <span class="tk">total</span></div>
          <div class="snap-foot"><span class="num ${pf.day >= 0 ? "up" : "down"}">${pf.day >= 0 ? "+" : "−"}${money(Math.abs(pf.day), "USD")} today</span></div>
          ${pf.income ? `<div class="tk">≈ ${money(pf.income, "USD")}/yr dividends</div>` : ""}
        </a>` : ""}
        ${tickers.map((t) => {
          const m = M.byTicker[t], { price, d1 } = q(t);
          return `<a class="panel snapcard" href="${stockUrl(t)}">
            <div class="tk">${esc(m.s)} · ${esc(list.name)}</div>
            <div class="nm">${esc(m.n)}</div>
            <div class="snap-chg ${d1 >= 0 ? "up" : "down"} num">${d1 == null ? "–" : (d1 >= 0 ? "+" : "") + d1.toFixed(2) + "%"}</div>
            <div class="snap-foot"><span class="num">${money(price, m.cur)}</span>${UI.spark(m.spark, 72, 24)}</div>
          </a>`;
        }).join("")}
      </div>`;
  }
  window.addEventListener("watchlists", render);
  render();
  if (window.Live && Live.on) {
    Live.every(30000, async () => {
      const W = Watch.all(), list = W.lists[W.active] || W.lists[0];
      const P = store.get("portfolios", null), a = P && P.list && (P.list[P.active] || P.list[0]);
      const ts = list.tickers.slice(0, 12).concat(a && a.trades ? a.trades.map((t) => t.t) : []);
      if (!ts.length) return;
      Object.assign(live, await Live.quotes(ts));
      render();
    });
  }
})();
