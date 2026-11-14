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

  // 1 = strong buy … 5 = sell, the scale Yahoo reports
  const BUCKETS = [
    ["Strong Buy", 1.5, "sb"], ["Buy", 2.5, "b"], ["Hold", 3.5, "h"], ["Underperform", 4.5, "u"], ["Sell", 9, "s"],
  ];
  const bucket = (m) => BUCKETS.find((b) => m <= b[1]);
  const MIN = 3; // fewer analysts than this is too thin to rank on

  const VIEWS = [
    { id: "top", label: "Top rated", key: "recMean", dir: 1, test: (s) => s.analysts >= 5,
      explain: "The strongest average buy ratings, among stocks covered by at least 5 analysts." },
    { id: "upside", label: "Most upside", key: "upside", dir: -1, test: (s) => s.analysts >= 5 && s.upside != null,
      explain: "The furthest below their average price target, among stocks covered by at least 5 analysts. A big gap can mean the price fell faster than analysts updated their targets." },
    { id: "above", label: "Above target", key: "upside", dir: 1, test: (s) => s.analysts >= 5 && s.upside < 0,
      explain: "Already trading above where analysts expect it to be in a year. Either the stock has run ahead of them or targets are about to rise." },
    { id: "covered", label: "Most covered", key: "analysts", dir: -1, test: (s) => s.analysts >= MIN,
      explain: "The companies the most analysts follow, usually the largest and most traded." },
    { id: "least", label: "Least liked", key: "recMean", dir: -1, test: (s) => s.analysts >= 5,
      explain: "The weakest average ratings, among stocks covered by at least 5 analysts. Sell ratings are rare, so even a Hold average says a lot." },
  ];

  const state = { market: "all", view: "top", size: "2", ...store.get("analysts", {}) };
  if (!VIEWS.some((v) => v.id === state.view)) state.view = "top";
  $("size").value = state.size;
  let sort = null, limit = 40;

  const inMarket = (s) => state.market === "all" || s.ix.includes(state.market);
  const bigEnough = (s) => (s.mcapUsd || 0) >= +state.size * 1e9;
  const pool = () => M.stocks.filter((s) => s.recMean != null && s.analysts >= MIN && inMarket(s) && bigEnough(s));

  const ratingHtml = (m) => {
    const b = bucket(m);
    return `<span class="an-rate"><span class="pill ${m <= 2.5 ? "buy" : m > 3.5 ? "sell" : ""}">${b[0]}</span><span class="an-scale" title="${m.toFixed(2)} on a 1 (strong buy) to 5 (sell) scale"><i style="left:${((m - 1) / 4 * 100).toFixed(1)}%"></i></span></span>`;
  };

  function distribution(list) {
    const counts = BUCKETS.map((b) => list.filter((s) => bucket(s.recMean) === b).length);
    const max = Math.max(1, ...counts);
    const ups = list.filter((s) => s.upside != null).map((s) => s.upside).sort((a, b) => a - b);
    const med = ups.length ? ups[Math.floor(ups.length / 2)] : null;
    $("dist").innerHTML = `<h2>How analysts rate them</h2>
      <p class="hint">${list.length} stocks with at least ${MIN} analysts. Median gap to the average price target: ${pct(med)}</p>
      <div class="an-bars">${BUCKETS.map((b, i) => `<div class="an-bar ${b[2]}"><span>${b[0]}</span><div><i style="width:${(counts[i] / max * 100).toFixed(1)}%"></i></div><b class="num">${counts[i]}</b></div>`).join("")}</div>`;
  }

  function sectors(list) {
    const by = {};
    for (const s of list) if (s.sector) (by[s.sector] ||= []).push(s);
    const rows = Object.entries(by).filter(([, l]) => l.length >= 3).map(([name, l]) => {
      const up = l.filter((s) => s.upside != null);
      return {
        name, n: l.length,
        rec: l.reduce((a, s) => a + s.recMean, 0) / l.length,
        up: up.length ? up.reduce((a, s) => a + s.upside, 0) / up.length : null,
        buy: l.filter((s) => s.recMean <= 2.5).length / l.length * 100,
      };
    }).sort((a, b) => a.rec - b.rec);
    $("sectors").innerHTML = `<h2>By sector</h2><p class="hint">Average rating and gap to target for each sector, most liked first.</p>
      ${rows.length ? `<table class="an-sec"><thead><tr><th class="left">Sector</th><th>Rating</th><th title="Share of stocks rated Buy or better">Buy+</th><th title="Average gap to the price target">To target</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="left">${esc(r.name)} <span class="muted">${r.n}</span></td><td>${ratingHtml(r.rec)}</td><td class="num">${r.buy.toFixed(0)}%</td><td>${pct(r.up)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Not enough rated stocks.</p>`}`;
  }

  const cols = [
    { key: "name", label: "Company", left: true, sm: true, val: (r) => r.n,
      html: (r) => `<div class="co-row">${UI.star(r.t)}<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.n)}</a></span><span class="tk">${esc(r.s)} · ${esc(r.region)}${r.sector ? " · " + esc(r.sector) : ""}</span></div></div>` },
    { key: "recMean", label: "Rating", sm: true, title: "Average rating, 1 = strong buy, 5 = sell", val: (r) => r.recMean, html: (r) => ratingHtml(r.recMean) },
    { key: "analysts", label: "Analysts", val: (r) => r.analysts, html: (r) => `<span class="num">${r.analysts}</span>` },
    { key: "p", label: "Price", val: (r) => r.p, html: (r) => `<span class="num">${money(r.p, r.cur)}</span>` },
    { key: "target", label: "Target", title: "Average 12-month price target", val: (r) => r.target, html: (r) => `<span class="num">${r.target != null ? money(r.target, r.cur) : "–"}</span>` },
    { key: "upside", label: "To target", sm: true, title: "How far the average target is from today's price", val: (r) => r.upside, html: (r) => pct(r.upside) },
    { key: "m1", label: "1M", val: (r) => r.m1, html: (r) => pct(r.m1) },
    { key: "fpe", label: "Fwd P/E", val: (r) => r.fpe, html: (r) => `<span class="num">${r.fpe != null ? r.fpe.toFixed(1) : "–"}</span>` },
    { key: "mcapUsd", label: "Mkt cap", val: (r) => r.mcapUsd, html: (r) => `<span class="num">${big(r.mcapUsd)}</span>` },
  ];

  function sorted(rows) {
    const c = cols.find((x) => x.key === sort.key);
    return rows.slice().sort((a, b) => {
      const x = c.val(a), y = c.val(b);
      if (x == null && y == null) return (b.mcapUsd || 0) - (a.mcapUsd || 0);
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sort.dir || (b.analysts || 0) - (a.analysts || 0);
    });
  }

  function render() {
    store.set("analysts", state);
    $("markets").innerHTML = [{ id: "all", name: "All markets" }].concat(M.indexes).map((i) =>
      `<button class="tab" role="tab" aria-selected="${i.id === state.market}" data-id="${i.id}">${esc(i.name.replace(/ \(.*\)/, ""))}</button>`).join("");
    $("views").innerHTML = VIEWS.map((v) => `<button role="tab" aria-selected="${v.id === state.view}" data-v="${v.id}">${esc(v.label)}</button>`).join("");
    const view = VIEWS.find((v) => v.id === state.view);
    if (!sort) sort = { key: view.key, dir: view.dir };
    const list = pool();
    distribution(list);
    sectors(list);
    const rows = sorted(list.filter(view.test));
    $("explain").textContent = view.explain + ` Companies worth ${$("size").selectedOptions[0].textContent.replace("Over", "over")}.`;
    const shown = rows.slice(0, limit);
    UI.table($("table"), cols, shown, sort, {
      empty: "No rated stocks match here. Try another market or a smaller company size.",
      onSort: () => { render(); return true; },
    });
    if (rows.length > shown.length) {
      $("table").insertAdjacentHTML("beforeend", `<p class="hint pad">Showing ${shown.length} of ${rows.length}. <button class="btn small" id="more">Show more</button></p>`);
      $("more").onclick = () => { limit += 40; render(); };
    }
  }

  $("markets").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) { state.market = b.dataset.id; limit = 40; render(); } });
  $("views").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { state.view = b.dataset.v; sort = null; limit = 40; render(); } });
  $("size").addEventListener("change", () => { state.size = $("size").value; limit = 40; render(); });
  render();
})();
