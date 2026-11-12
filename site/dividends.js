(async function () {
  const { esc, money, pct, big, stockUrl, store } = UI;
  const $ = (id) => document.getElementById(id);

  let M;
  try {
    M = await UI.market();
  } catch (e) {
    $("updated").textContent = "Stock data could not be loaded.";
    $("table").innerHTML = `<div class="empty">Stock data could not be loaded. Try again after the next data refresh.</div>`;
    return;
  }
  $("updated").textContent = "Updated " + new Date(M.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  if (window.startRain) window.startRain(M.stocks.filter((s) => s.cur === "USD").map((s) => s.s));

  const day = (d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
  const today = day(new Date());
  const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return day(d); };
  const fixed = (v, d = 1, suf = "%") => (v == null ? "–" : v.toFixed(d) + suf);
  const dateLabel = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

  // A rough check on how well each dividend is covered. Reasons are shown on hover.
  function safety(s) {
    const why = [];
    let bad = 0;
    if (s.payout != null) {
      if (s.payout > 100 || s.payout < 0) { bad += 2; why.push(s.payout < 0 ? "Paying a dividend while losing money" : `Pays out more than it earns (${s.payout.toFixed(0)}% of earnings)`); }
      else if (s.payout > 75) { bad += 1; why.push(`Pays out most of its earnings (${s.payout.toFixed(0)}%)`); }
    } else why.push("Payout ratio not available");
    if (s.de != null && s.de > 200 && s.sector !== "Financial Services" && s.sector !== "Real Estate" && s.sector !== "Utilities") { bad += 1; why.push("Carries a lot of debt"); }
    if (s.epsGrowth != null && s.epsGrowth < -20) { bad += 1; why.push(`Earnings fell ${Math.abs(s.epsGrowth).toFixed(0)}% from a year earlier`); }
    if (s.divYield > 9) { bad += 1; why.push("Yield is unusually high, which often means investors expect a cut"); }
    if (s.y1 != null && s.y1 < -30) { bad += 1; why.push(`Shares fell ${Math.abs(s.y1).toFixed(0)}% over the past year`); }
    const level = s.payout == null && !bad ? "unknown" : bad >= 2 ? "risk" : bad === 1 ? "watch" : "safe";
    if (level === "safe") why.push("Earnings cover the dividend comfortably");
    return { level, why };
  }
  const SAFETY = { safe: ["Looks safe", 3], watch: ["Watch", 2], risk: ["At risk", 1], unknown: ["Not sure", 0] };
  for (const s of M.stocks) if (s.divYield > 0) s._safe = safety(s);

  const VIEWS = [
    { id: "high", label: "High yield", key: "divYield", dir: -1, test: (s) => s.divYield >= 4,
      explain: "Stocks yielding 4% or more, highest first. Check the safety column: the highest yields are often the shakiest." },
    { id: "steady", label: "Steady payers", key: "divYield", dir: -1, test: (s) => s.divYield >= 2 && s._safe.level === "safe" && s.payout >= 20,
      explain: "Yield of 2% or more, with earnings comfortably covering the payout and no warning signs on debt, earnings or the share price." },
    { id: "soon", label: "Ex-dividend soon", key: "exDiv", dir: 1, test: (s) => s.exDiv && s.exDiv >= today && s.exDiv <= inDays(30),
      explain: "Going ex-dividend in the next 30 days. You need to own the shares before the ex-dividend date to get the next payment." },
    { id: "risk", label: "Payouts at risk", key: "divYield", dir: -1, test: (s) => s._safe.level === "risk",
      explain: "Dividends with two or more warning signs, such as paying out more than the company earns, falling earnings or heavy debt. Hover a rating to see why." },
    { id: "all", label: "All payers", key: "divYield", dir: -1, test: () => true,
      explain: "Every stock that pays a dividend." },
  ];

  const state = { market: "all", view: "high", size: "2", amount: 10000, count: "10", ...store.get("dividends", {}) };
  if (!VIEWS.some((v) => v.id === state.view)) state.view = "high";
  $("size").value = state.size;
  $("amount").value = state.amount;
  $("count").value = state.count;
  let sort = null, limit = 40;

  const inMarket = (s) => state.market === "all" || s.ix.includes(state.market);
  const bigEnough = (s) => (s.mcapUsd || 0) >= +state.size * 1e9;
  const payers = () => M.stocks.filter((s) => s.divYield > 0 && inMarket(s) && bigEnough(s));

  function summary(all, pay) {
    const ys = pay.map((s) => s.divYield).sort((a, b) => a - b);
    const med = ys.length ? ys[Math.floor(ys.length / 2)] : null;
    const pays = pay.filter((s) => s.payout != null && s.payout >= 0 && s.payout <= 150).map((s) => s.payout);
    const avgPay = pays.length ? pays.reduce((a, b) => a + b, 0) / pays.length : null;
    const week = pay.filter((s) => s.exDiv && s.exDiv >= today && s.exDiv <= inDays(7)).length;
    const risk = pay.filter((s) => s._safe.level === "risk").length;
    const share = all.length ? pay.length / all.length * 100 : 0;
    $("summary").innerHTML = `
      <div class="breadth-bar" title="${pay.length} of ${all.length} stocks pay a dividend"><span class="up-part" style="width:${share.toFixed(1)}%"></span></div>
      <div class="stats">
        <div class="stat"><div class="label">Pay a dividend</div><div class="value num">${pay.length} of ${all.length}</div></div>
        <div class="stat"><div class="label">Median yield</div><div class="value num">${fixed(med, 2)}</div></div>
        <div class="stat"><div class="label">Yield over 4%</div><div class="value num">${pay.filter((s) => s.divYield >= 4).length}</div></div>
        <div class="stat" title="Average share of earnings paid out as dividends"><div class="label">Average payout</div><div class="value num">${fixed(avgPay, 0)}</div></div>
        <div class="stat"><div class="label">Ex-dividend this week</div><div class="value num">${week}</div></div>
        <div class="stat" title="Dividends with two or more warning signs"><div class="label">At risk</div><div class="value num down">${risk}</div></div>
      </div>`;
  }

  const safeHtml = (s) => {
    const [label] = SAFETY[s._safe.level];
    return `<span class="safe ${s._safe.level}" title="${esc(s._safe.why.join(". ") + ".")}">${label}</span>`;
  };
  const cols = [
    { key: "name", label: "Company", left: true, sm: true, val: (r) => r.n,
      html: (r) => `<div class="co-row">${UI.star(r.t)}<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.n)}</a></span><span class="tk">${esc(r.s)} · ${esc(r.region)}${r.sector ? " · " + esc(r.sector) : ""}</span></div></div>` },
    { key: "divYield", label: "Yield", sm: true, val: (r) => r.divYield, html: (r) => `<span class="num strong">${fixed(r.divYield, 2)}</span>` },
    { key: "divRate", label: "Per share / yr", val: (r) => r.divRate, html: (r) => `<span class="num">${r.divRate != null ? money(r.divRate, r.cur) : "–"}</span>` },
    { key: "payout", label: "Payout", title: "Share of earnings paid out as dividends", val: (r) => r.payout, html: (r) => `<span class="num">${fixed(r.payout, 0)}</span>` },
    { key: "safe", label: "Safety", sm: true, title: "A rough check on how well the dividend is covered. Hover a rating to see why.", val: (r) => SAFETY[r._safe.level][1], html: safeHtml },
    { key: "exDiv", label: "Ex-dividend", val: (r) => r.exDiv && r.exDiv >= today ? r.exDiv : null,
      html: (r) => r.exDiv && r.exDiv >= today ? `<span class="num">${dateLabel(r.exDiv)}</span>` : `<span class="muted">–</span>` },
    { key: "p", label: "Price", val: (r) => r.p, html: (r) => `<span class="num">${money(r.p, r.cur)}</span>` },
    { key: "y1", label: "1Y", title: "Share price change over the past year, not counting dividends", val: (r) => r.y1, html: (r) => pct(r.y1) },
    { key: "mcapUsd", label: "Mkt cap", val: (r) => r.mcapUsd, html: (r) => `<span class="num">${big(r.mcapUsd)}</span>` },
  ];

  function sorted(rows) {
    const c = cols.find((x) => x.key === sort.key);
    return rows.slice().sort((a, b) => {
      const x = c.val(a), y = c.val(b);
      if (x == null && y == null) return (b.mcapUsd || 0) - (a.mcapUsd || 0);
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sort.dir || (b.mcapUsd || 0) - (a.mcapUsd || 0);
    });
  }

  function render() {
    store.set("dividends", state);
    $("markets").innerHTML = [{ id: "all", name: "All markets" }].concat(M.indexes).map((i) =>
      `<button class="tab" role="tab" aria-selected="${i.id === state.market}" data-id="${i.id}">${esc(i.name.replace(/ \(.*\)/, ""))}</button>`).join("");
    $("views").innerHTML = VIEWS.map((v) => `<button role="tab" aria-selected="${v.id === state.view}" data-v="${v.id}">${esc(v.label)}</button>`).join("");
    const view = VIEWS.find((v) => v.id === state.view);
    if (!sort) sort = { key: view.key, dir: view.dir };
    const all = M.stocks.filter((s) => inMarket(s) && bigEnough(s));
    const pay = payers();
    summary(all, pay);
    const rows = sorted(pay.filter(view.test));
    $("explain").textContent = view.explain + ` Companies worth ${$("size").selectedOptions[0].textContent.replace("Over", "over")}.`;
    const shown = rows.slice(0, limit);
    UI.table($("table"), cols, shown, sort, {
      empty: "No dividend stocks match here. Try another market or a smaller company size.",
      onSort: () => { render(); return true; },
    });
    if (rows.length > shown.length) $("table").insertAdjacentHTML("beforeend", `<p class="hint pad">Showing ${shown.length} of ${rows.length}. <button class="btn small" id="more">Show more</button></p>`);
    plan(rows);
    const more = $("more");
    if (more) more.onclick = () => { limit += 40; render(); };
  }

  function plan(rows) {
    const amount = Math.max(0, +$("amount").value || 0);
    const pick = rows.filter((s) => s.divYield > 0).slice(0, +state.count);
    if (!pick.length || !amount) {
      $("plan-out").innerHTML = `<p class="muted">${amount ? "No stocks in the list above to build a basket from." : "Enter an amount to see the income."}</p>`;
      return;
    }
    const each = amount / pick.length;
    const yearly = pick.reduce((a, s) => a + each * s.divYield / 100, 0);
    const blended = yearly / amount * 100;
    const risky = pick.filter((s) => s._safe.level === "risk").length;
    const n = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    $("plan-out").innerHTML = `
      <div class="stats div-plan-stats">
        <div class="stat"><div class="label">Income per year</div><div class="value num up">${n(yearly)}</div></div>
        <div class="stat"><div class="label">Per month</div><div class="value num">${n(yearly / 12)}</div></div>
        <div class="stat"><div class="label">Blended yield</div><div class="value num">${fixed(blended, 2)}</div></div>
        <div class="stat"><div class="label">In each stock</div><div class="value num">${n(each)}</div></div>
        ${risky ? `<div class="stat"><div class="label">Rated at risk</div><div class="value num down">${risky} of ${pick.length}</div></div>` : ""}
      </div>
      <p class="hint">Uses the top ${pick.length} stocks from the "${esc(VIEWS.find((v) => v.id === state.view).label)}" list in its current order. Income is in the same currency as the amount, before tax, and assumes today's dividends stay the same.</p>
      <div class="div-basket">${pick.map((s) => `<a href="${stockUrl(s.t)}" title="${esc(s.n)}"><b>${esc(s.s)}</b><span class="num">${fixed(s.divYield, 2)}</span><span class="num muted">${n(each * s.divYield / 100)}/yr</span></a>`).join("")}</div>`;
  }

  $("markets").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) { state.market = b.dataset.id; limit = 40; render(); } });
  $("views").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { state.view = b.dataset.v; sort = null; limit = 40; render(); } });
  $("size").addEventListener("change", () => { state.size = $("size").value; limit = 40; render(); });
  $("amount").addEventListener("input", () => { state.amount = +$("amount").value || 0; store.set("dividends", state); render(); });
  $("count").addEventListener("change", () => { state.count = $("count").value; render(); });
  render();
})();
