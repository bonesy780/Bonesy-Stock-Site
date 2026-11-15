// Compare up to five markets: growth from the same start, and their figures side by side.
(async function () {
  const { esc, short, money, pct, fixed, int, marketUrl, place, chart, since, rebase, store, picker, COUNTRY, FLAG } = RE;
  let D, H;
  try { [D, H] = await Promise.all([RE.data(), RE.load("hist.json")]); } catch {
    document.getElementById("c-chart").innerHTML = `<div class="empty">The real estate data hasn't been built yet.</div>`; return;
  }
  const COLORS = ["var(--cmp-1)", "var(--cmp-2)", "var(--cmp-3)", "var(--cmp-4)", "var(--cmp-5)"];
  const fromUrl = (new URLSearchParams(location.search).get("m") || "").split(",").filter((id) => D.byId[id]);
  let ids = fromUrl.length ? fromUrl : store.get("re-compare", ["us", "us-new-york-ny", "ca-toronto", "us-austin-tx"]).filter((id) => D.byId[id]);
  if (!ids.length) ids = ["us", "ca"].filter((id) => D.byId[id]);
  const st = { range: 10 };
  const series = (m) => { const h = (H.markets || {})[m.id] || {}; return m.c === "CA" ? h.idx : h.v; };
  function draw() {
    ids = ids.slice(0, 5);
    store.set("re-compare", ids);
    history.replaceState(null, "", "?m=" + ids.map(encodeURIComponent).join(","));
    document.getElementById("picked").innerHTML = ids.map((id, i) => { const m = D.byId[id];
      return `<span class="chip" style="border-color:${COLORS[i]}"><i class="dot" style="background:${COLORS[i]}"></i>${FLAG[m.c]} ${esc(m.name)} <button class="x" data-rm="${esc(id)}" aria-label="Remove ${esc(m.name)}">✕</button></span>`; }).join("");
    document.getElementById("c-range").innerHTML = [[1, "1Y"], [5, "5Y"], [10, "10Y"], [20, "20Y"]].map(([v, l]) => `<button role="tab" aria-selected="${v === st.range}" data-r="${v}">${l}</button>`).join("");
    const ms = ids.map((id) => D.byId[id]);
    // Line everything up from the latest common start month
    const raw = ms.map((m) => since(series(m) || [], st.range));
    const start = raw.filter((p) => p.length).map((p) => p[0][0]).sort().at(-1);
    chart(document.getElementById("c-chart"), ms.map((m, i) => ({ name: m.name, color: COLORS[i], pts: rebase((raw[i] || []).filter((p) => p[0] >= start)) })),
      { fmt: (v) => (v - 100 >= 0 ? "+" : "") + (v - 100).toFixed(0) + "%", base: 100, label: "Home prices compared" });
    const rows = [
      ["Country", (m) => FLAG[m.c] + " " + COUNTRY[m.c]],
      ["Price", (m) => m.c === "CA" ? `Index ${fixed(m.idx, 1)}` : `<span class="num">${short(m.v, m.cur)}</span>`],
      ["In US$", (m) => m.usd ? `<span class="num">${short(m.usd)}</span>` : "–"],
      ["1 year", (m) => pct(m.v1y)], ["5 years", (m) => pct(m.v5y, 0)], ["10 years", (m) => pct(m.v10y, 0)],
      ["Rent", (m) => m.rent ? `<span class="num">${money(m.rent, m.cur)}</span>` : "–"],
      ["Rent yield", (m) => fixed(m.yield, 1, "%")], ["Homes for sale y/y", (m) => pct(m.inv1y, 0)],
      ["Days to pending", (m) => int(m.dtp)], ["Price cuts", (m) => fixed(m.cut, 0, "%")],
      ["Zillow forecast", (m) => pct(m.fc)], ["Market", (m) => m.side ? esc(m.side) : "–"],
    ];
    document.getElementById("c-table").innerHTML = `<table class="compare-table re-cmp"><thead><tr><th></th>${ms.map((m, i) => `<th><a href="${marketUrl(m.id)}" style="color:${COLORS[i]}">${esc(m.name)}</a><div class="tk">${esc(place(m))}</div></th>`).join("")}</tr></thead>
      <tbody>${rows.map(([l, f]) => `<tr><td>${l}</td>${ms.map((m) => `<td>${f(m)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  document.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]"), r = e.target.closest("[data-r]");
    if (rm) { ids = ids.filter((x) => x !== rm.dataset.rm); draw(); }
    if (r) { st.range = +r.dataset.r; draw(); }
  });
  picker(document.getElementById("add"), (m) => { if (!ids.includes(m.id)) { ids.push(m.id); if (ids.length > 5) ids.shift(); } draw(); });
  draw();
})();
