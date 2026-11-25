// Real estate overview: country cards, rates, world teaser, top 10 lists, buy ideas, markets to watch, BIS chart, states and provinces.
(async function () {
  const { esc, short, money, pct, fixed, int, spark, marketUrl, place, headline, sideCls, star, table, chart, since, rebase, store, COUNTRY, FLAG } = RE;
  let D, H = null;
  try { D = await RE.data(); } catch {
    document.getElementById("countries").innerHTML = `<div class="panel empty">The real estate data hasn't been built yet. It appears after the next data update.</div>`;
    return;
  }
  const M = D.markets, by = D.byId, C = D.countries || {}, R = D.rates || {};
  const count = document.getElementById("count");
  if (count) count.textContent = M.filter((m) => !["us", "ca", "mx"].includes(m.id)).length;
  const when = (s) => {
    if (!s) return "";
    if (/^\d{4}-Q\d$/.test(s)) return s.replace("-Q", " Q");
    const d = new Date(s.length === 7 ? s + "-15" : s);
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  };
  const rateChg = (r) => r && r.chg != null ? ` <span class="num ${r.chg <= 0 ? "up" : "down"}" title="Change on a year ago">${r.chg >= 0 ? "+" : ""}${r.chg.toFixed(2)} pts</span>` : "";

  // ---- country cards
  const nat = { US: by.us, CA: by.ca, MX: by.mx };
  const cards = ["US", "CA", "MX"].map((c) => {
    const n = nat[c], k = C[c] || {};
    if (!n && k.bis == null) return "";
    const h = n ? headline(n) : null;
    const rate = c === "US" ? ["30-year fixed", R.us30] : c === "CA" ? ["5-year fixed (posted)", R.ca5] : ["Interbank rate", R.mxRate];
    const stats = [];
    if (n && n.v1y != null) stats.push(["Prices, 1 year", pct(n.v1y)]);
    if (c === "US" && n) {
      if (n.rent) stats.push(["Typical rent", `<span class="num">${money(n.rent)}</span>/mo`]);
      if (n.inv1y != null) stats.push(["Homes for sale", pct(n.inv1y, 0) + " <span class='muted'>y/y</span>"]);
      if (n.dtp != null) stats.push(["Days to pending", `<span class="num">${int(n.dtp)}</span>`]);
    }
    if (c === "CA" && n && n.rent) stats.push(["2-bed rent (CMHC)", `<span class="num">${money(n.rent, "CAD")}</span>/mo`]);
    if (c === "MX" && n && n.median) stats.push(["Middle price", `<span class="num">${short(n.median, "MXN")}</span>`]);
    if (k.bis != null) stats.push(["BIS index, 1 year", pct(k.bis)]);
    if (rate[1]) stats.push([rate[0], `<span class="num">${rate[1].v.toFixed(2)}%</span>${rateChg(rate[1])}`]);
    return `<a class="panel re-country" href="${n ? marketUrl(n.id) : "#"}">
      <div class="re-country-top"><span class="re-flag" aria-hidden="true">${FLAG[c]}</span><div><h2>${COUNTRY[c]}</h2><span class="muted">${n ? esc(h.label) + " · " + when(n.asof) : ""}</span></div>
        ${n && n.spark ? spark(n.spark, 110, 34) : ""}</div>
      ${n ? `<div class="re-big">${h.html}${h.note ? ` <span class="muted re-small">${h.note}</span>` : ""}</div>` : ""}
      <div class="stats">${stats.map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("")}</div>
    </a>`;
  });
  document.getElementById("countries").innerHTML = `<div class="re-country-grid">${cards.join("")}</div>`;

  // ---- rates strip
  // US, Canadian and European rates are in the "Key lending rates" section below (invest.js); this strip keeps Mexico and currencies
  const rates = [
    ["Mexico interbank rate", R.mxRate, "Overnight interbank rate (OECD, via FRED); mortgage rates sit well above it"],
  ].filter((r) => r[1]);
  const fxs = [["US$1 in Canadian dollars", R.cad, "CAD"], ["US$1 in Mexican pesos", R.mxn, "MXN"]].filter((r) => r[1]);
  document.getElementById("rates").innerHTML = rates.length || fxs.length ? `<div class="re-rate-row">${rates.map(([l, r, t]) =>
    `<div class="panel re-rate" title="${esc(t)}. As of ${esc(r.at)}."><span class="label">${l}</span><b class="num">${r.v.toFixed(2)}%</b>${rateChg(r)}</div>`).join("")}
    ${fxs.map(([l, r]) => `<div class="panel re-rate" title="As of ${esc(r.at)}"><span class="label">${l}</span><b class="num">${r.v.toFixed(2)}</b></div>`).join("")}
    <a class="panel re-rate re-rate-link" href="#lending"><span class="label">US, Canada, Europe</span><b>Lending rates ↓</b></a>
    <a class="panel re-rate re-rate-link" href="tools.html"><span class="label">What does it cost?</span><b>Mortgage tools →</b></a></div>` : "";

  // ---- top 10 lists
  const big = (m) => m.c === "US" ? m.id !== "us" && m.rank <= 100 : m.c === "CA" ? m.id !== "ca" : m.id !== "mx";
  const LISTS = {
    US: [
      ["hot", "Fastest rising prices", "Typical home value change over the past year.", (m) => m.v1y, -1],
      ["cool", "Falling prices", "Biggest price drops over the past year.", (m) => m.v1y, 1],
      ["afford", "Most affordable", "Lowest typical home value.", (m) => m.v, 1],
      ["yield", "Best rent yield", "A year's typical rent as a share of the typical home value, before costs.", (m) => m.yield, -1],
      ["fast", "Selling fastest", "Fewest median days from listing to an accepted offer.", (m) => m.dtp, 1],
      ["cuts", "Most price cuts", "Share of homes for sale that cut their price in the month.", (m) => m.cut, -1],
      ["supply", "Supply rising most", "Homes for sale compared with a year ago.", (m) => m.inv1y, -1],
      ["fc", "Best 12-month outlook", "Zillow's forecast for the typical home value a year from now.", (m) => m.fc, -1],
    ],
    CA: [
      ["hot", "Fastest rising new home prices", "New Housing Price Index change over the past year.", (m) => m.v1y, -1],
      ["cool", "Falling new home prices", "Biggest drops over the past year.", (m) => m.v1y, 1],
      ["long", "Most growth since 2016", "Index level (December 2016 = 100).", (m) => m.idx, -1],
      ["rent", "Highest rents", "CMHC average rent for a two-bedroom apartment.", (m) => m.rent, -1],
      ["rentup", "Rents rising fastest", "CMHC two-bedroom rent change on the year before.", (m) => m.rent1y, -1],
    ],
    MX: [
      ["dear", "Most expensive states", "SHF average price of homes valued for a mortgage.", (m) => m.v, -1],
      ["afford", "Most affordable states", "Lowest SHF average price.", (m) => m.v, 1],
      ["mid", "Highest middle price", "SHF median price, less skewed by luxury homes.", (m) => m.median, -1],
    ],
  };
  const top = { c: store.get("re-top-country", "US"), list: null };
  const countrySeg = document.getElementById("top-country");
  const tabs = document.getElementById("top-tabs");
  const cols = {
    US: [
      { key: "rank", label: "#", html: (m, i) => `<span class="rank">${i + 1}</span>`, sm: true },
      { key: "name", label: "Market", left: true, sm: true, html: (m) => `<a class="co" href="${marketUrl(m.id)}"><span class="nm">${esc(m.name)}</span><span class="tk">${esc(place(m))}</span></a>` },
      { key: "v", label: "Typical value", html: (m) => `<span class="num">${short(m.v)}</span>`, sm: true },
      { key: "v1y", label: "1 year", html: (m) => pct(m.v1y), sm: true },
      { key: "v5y", label: "5 years", html: (m) => pct(m.v5y, 0) },
      { key: "rent", label: "Rent", html: (m) => `<span class="num">${m.rent ? money(m.rent) : "–"}</span>` },
      { key: "yield", label: "Yield", html: (m) => `<span class="num">${fixed(m.yield, 1, "%")}</span>` },
      { key: "dtp", label: "Days to pending", html: (m) => `<span class="num">${int(m.dtp)}</span>` },
      { key: "cut", label: "Price cuts", html: (m) => `<span class="num">${fixed(m.cut, 0, "%")}</span>` },
      { key: "side", label: "Market", html: (m) => m.side ? `<span class="pill ${sideCls(m.side)}">${esc(m.side)}</span>` : "–" },
      { key: "spark", label: "2 years", html: (m) => spark(m.spark) },
    ],
    CA: [
      { key: "rank", label: "#", html: (m, i) => `<span class="rank">${i + 1}</span>`, sm: true },
      { key: "name", label: "City", left: true, sm: true, html: (m) => `<a class="co" href="${marketUrl(m.id)}"><span class="nm">${esc(m.name)}</span><span class="tk">${esc(place(m))}</span></a>` },
      { key: "idx", label: "Index", html: (m) => `<span class="num">${fixed(m.idx, 1)}</span>`, sm: true },
      { key: "v1y", label: "1 year", html: (m) => pct(m.v1y), sm: true },
      { key: "v5y", label: "5 years", html: (m) => pct(m.v5y, 0) },
      { key: "offPeak", label: "From peak", html: (m) => pct(m.offPeak) },
      { key: "rent", label: "2-bed rent", html: (m) => `<span class="num">${m.rent ? money(m.rent, "CAD") : "–"}</span>` },
      { key: "rent1y", label: "Rent change", html: (m) => pct(m.rent1y) },
      { key: "spark", label: "2 years", html: (m) => spark(m.spark) },
    ],
    MX: [
      { key: "rank", label: "#", html: (m, i) => `<span class="rank">${i + 1}</span>`, sm: true },
      { key: "name", label: "State", left: true, sm: true, html: (m) => `<a class="co" href="${marketUrl(m.id)}"><span class="nm">${esc(m.name)}</span><span class="tk">${esc(m.region)}</span></a>` },
      { key: "v", label: "Average", html: (m) => `<span class="num">${short(m.v, "MXN")}</span>`, sm: true },
      { key: "usd", label: "In US$", html: (m) => `<span class="num">${short(m.usd)}</span>` },
      { key: "median", label: "Middle", html: (m) => `<span class="num">${short(m.median, "MXN")}</span>`, sm: true },
      { key: "q1", label: "Lower quarter up to", html: (m) => `<span class="num">${short(m.q1, "MXN")}</span>` },
      { key: "q3", label: "Upper quarter from", html: (m) => `<span class="num">${short(m.q3, "MXN")}</span>` },
      { key: "v1y", label: "1 year", html: (m) => pct(m.v1y) },
    ],
  };
  function drawTop() {
    const lists = LISTS[top.c];
    if (!lists.find((l) => l[0] === top.list)) top.list = lists[0][0];
    countrySeg.innerHTML = ["US", "CA", "MX"].map((c) => `<button role="tab" aria-selected="${c === top.c}" data-c="${c}">${FLAG[c]} ${COUNTRY[c]}</button>`).join("");
    tabs.innerHTML = lists.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${k === top.list}" data-l="${k}">${esc(l)}</button>`).join("");
    const [, , desc, val, dir] = lists.find((l) => l[0] === top.list);
    document.getElementById("top-desc").textContent = desc;
    const rows = M.filter((m) => m.c === top.c && big(m) && val(m) != null).sort((a, b) => (val(a) - val(b)) * dir).slice(0, 10);
    table(document.getElementById("top"), cols[top.c], rows, { key: null, dir: 1 }, { empty: "No figures for this list yet." });
  }
  countrySeg.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; top.c = b.dataset.c; top.list = null; store.set("re-top-country", top.c); drawTop(); });
  tabs.addEventListener("click", (e) => { const b = e.target.closest("[data-l]"); if (!b) return; top.list = b.dataset.l; drawTop(); });
  drawTop();

  // ---- buy ideas and markets to watch
  const P = D.picks || {};
  const ideas = (P.buy || []).map((p) => ({ m: by[p.id], why: p.why })).filter((x) => x.m);
  document.getElementById("ideas").innerHTML = ideas.length ? ideas.map(({ m, why }) => `
    <article class="panel card">
      <div class="card-top"><a class="co" href="${marketUrl(m.id)}"><span class="nm">${esc(m.name)}</span><span class="tk">${esc(place(m))}</span></a>${star("markets", m.id)}</div>
      <div class="re-card-price"><span class="num">${short(m.v)}</span> ${pct(m.v1y)} <span class="muted re-small">1 yr</span></div>
      <ul>${why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
      <div class="card-tags">${m.side ? `<span class="pill ${sideCls(m.side)}">${esc(m.side)}</span>` : ""}${m.yield ? `<span class="tag">Yield ${m.yield.toFixed(1)}%</span>` : ""}</div>
    </article>`).join("") : `<div class="panel empty">No buy ideas until the US market data is in.</div>`;
  const watch = (P.watch || []).map((p) => ({ m: by[p.id], why: p.why })).filter((x) => x.m && x.why.length);
  document.getElementById("watch").innerHTML = watch.length ? watch.map(({ m, why }) => `
    <div class="panel watch-row">
      <a class="co" href="${marketUrl(m.id)}"><span class="nm">${esc(m.name)}</span><span class="tk">${esc(place(m))} · ${short(m.v)}</span></a>
      <div class="tags">${why.map((w) => `<span class="tag">${esc(w)}</span>`).join("")}</div>
      <div>${spark(m.spark)}</div>
    </div>`).join("") : `<div class="panel empty">Nothing stands out this month.</div>`;

  // ---- BIS chart
  const COLORS = { US: "var(--cmp-2)", CA: "var(--cmp-1)", MX: "var(--cmp-4)" };
  const bis = { range: 10, kind: "bis" };
  const rangeSeg = document.getElementById("bis-range"), kindSeg = document.getElementById("bis-kind");
  async function drawBis() {
    rangeSeg.innerHTML = [[5, "5 years"], [10, "10 years"], [20, "20 years"]].map(([v, l]) => `<button role="tab" aria-selected="${v === bis.range}" data-r="${v}">${l}</button>`).join("");
    kindSeg.innerHTML = [["bis", "Nominal"], ["bisReal", "After inflation"]].map(([v, l]) => `<button role="tab" aria-selected="${v === bis.kind}" data-k="${v}">${l}</button>`).join("");
    try { H ||= await RE.load("hist.json"); } catch { document.getElementById("bis").innerHTML = `<div class="empty">No history yet.</div>`; return; }
    const S = H[bis.kind] || {};
    chart(document.getElementById("bis"), ["US", "CA", "MX"].map((c) => ({ name: COUNTRY[c], color: COLORS[c], pts: rebase(since(S[c], bis.range)) })),
      { fmt: (v) => v.toFixed(0), base: 100, label: "House prices in the US, Canada and Mexico, rebased to 100" });
  }
  rangeSeg.addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (b) { bis.range = +b.dataset.r; drawBis(); } });
  kindSeg.addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (b) { bis.kind = b.dataset.k; drawBis(); } });
  drawBis();

  // ---- by state and province, for all three countries
  const shf = (C.MX || {}).shf;
  const RG = D.regions || {};
  const REG = {
    US: { rows: (RG.US || []).map((r) => ({ ...r, link: `markets.html?c=US&region=${r.code}` })), metrics: [
      ["v", "Typical value", (v) => short(v), false], ["v1y", "1 year", (v) => pct(v), true], ["v5y", "5 years", (v) => pct(v, 0), true],
      ["rent", "Rent", (v) => `<span class="num">${money(v)}</span>`, false], ["yield", "Rent yield", (v) => `<span class="num">${v.toFixed(1)}%</span>`, false]],
      note: () => "Zillow's typical home value (middle third of homes) for each state. Tap a state to see its metro areas." },
    CA: { rows: (RG.CA || []).map((r) => ({ ...r, link: `markets.html?c=CA&region=${r.code}` })), metrics: [
      ["v1y", "New home prices, 1 year", (v) => pct(v), true], ["v5y", "5 years", (v) => pct(v, 0), true], ["offPeak", "From peak", (v) => pct(v), true],
      ["rent", "2-bed rent", (v) => `<span class="num">${money(v, "CAD")}</span>`, false], ["rent1y", "Rent change", (v) => pct(v), true]],
      note: () => "Statistics Canada's New Housing Price Index (new homes only; resale prices are licensed) and CMHC's average two-bedroom rent for each province." },
    MX: { rows: M.filter((m) => m.c === "MX" && m.id !== "mx").map((m) => ({ ...m, link: marketUrl(m.id) })), metrics: [
      ["v", "Average price", (v) => short(v, "MXN"), false], ["median", "Middle price", (v) => short(v, "MXN"), false], ["usd", "In US$", (v) => short(v), false],
      ["v1y", "1 year", (v) => pct(v), true]],
      note: () => shf ? `Average price of homes valued for a mortgage in ${esc(when(shf.period))}, from Sociedad Hipotecaria Federal${shf.national ? `. National average <b>${short(shf.national.avg_price, "MXN")}</b>, up ${shf.national.yoy}% on a year earlier` : ""}. <a href="${esc(shf.source_url)}">Source</a>.` : "Sociedad Hipotecaria Federal's average prices by state." },
  };
  const reg = { c: store.get("re-reg-country", "US"), m: {} };
  const regCountry = document.getElementById("reg-country"), regMetric = document.getElementById("reg-metric");
  function drawRegions() {
    const have = ["US", "CA", "MX"].filter((c) => REG[c].rows.length);
    if (!have.length) { document.getElementById("regions").hidden = true; return; }
    if (!have.includes(reg.c)) reg.c = have[0];
    const R0 = REG[reg.c];
    const metrics = R0.metrics.filter(([k]) => R0.rows.some((r) => r[k] != null));
    let key = reg.m[reg.c];
    if (!metrics.find((x) => x[0] === key)) key = metrics[0][0];
    const [, label, fmt, signed] = metrics.find((x) => x[0] === key);
    regCountry.innerHTML = have.map((c) => `<button role="tab" aria-selected="${c === reg.c}" data-c="${c}">${FLAG[c]} ${COUNTRY[c]}</button>`).join("");
    regMetric.innerHTML = metrics.map(([k, l]) => `<button role="tab" aria-selected="${k === key}" data-m="${k}">${esc(l)}</button>`).join("");
    document.getElementById("reg-note").innerHTML = R0.note();
    const rows = R0.rows.filter((r) => r[key] != null).sort((a, b) => b[key] - a[key]);
    const max = Math.max(...rows.map((r) => Math.abs(r[key]))) || 1;
    const bar = (r) => {
      const v = r[key];
      return `<a class="re-bar-row" href="${r.link}"><span class="re-bar-name" title="${esc(r.name)}">${esc(r.name)}</span>
        <span class="re-bar-track"><i class="${signed ? (v >= 0 ? "pos" : "neg") : ""}" style="width:${(Math.abs(v) / max * 100).toFixed(1)}%"></i></span><span class="num">${fmt(v)}</span></a>`;
    };
    const ch = R0.rows.filter((r) => r.v1y != null).sort((a, b) => b.v1y - a.v1y);
    const nm = (r) => esc(r.name);
    let side = "";
    if (reg.c === "MX" && shf && shf.municipalities) {
      side = `<div class="panel re-mx-side"><h3>Fastest rising towns</h3><ol>${shf.municipalities.map((x) => `<li><span>${esc(x.name)}</span>${pct(x.yoy)}</li>`).join("")}</ol>
      ${shf.metros ? `<h3>Big metro areas</h3><ul>${shf.metros.map((x) => `<li><span>${esc(x.name)}</span>${pct(x.yoy)}</li>`).join("")}</ul>` : ""}<p class="muted re-small">Change in the SHF price index on a year earlier.</p></div>`;
    } else if (ch.length > 6) {
      const what = reg.c === "CA" ? "New home prices" : "Typical home value";
      side = `<div class="panel re-mx-side"><h3>Rising fastest</h3><ol>${ch.slice(0, 5).map((r) => `<li><span>${nm(r)}</span>${pct(r.v1y)}</li>`).join("")}</ol>
        <h3>Weakest</h3><ol>${ch.slice(-5).reverse().map((r) => `<li><span>${nm(r)}</span>${pct(r.v1y)}</li>`).join("")}</ol>
        <p class="muted re-small">${what}, change on a year earlier${R0.rows[0] && R0.rows[0].asof ? `, to ${esc(when(R0.rows[0].asof))}` : ""}.</p></div>`;
    }
    document.getElementById("reg").innerHTML = `<div class="panel re-bars" aria-label="${esc(label)}">${rows.map(bar).join("")}</div>${side}`;
  }
  regCountry.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; reg.c = b.dataset.c; store.set("re-reg-country", reg.c); drawRegions(); });
  regMetric.addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b) return; reg.m[reg.c] = b.dataset.m; drawRegions(); });
  drawRegions();

  // ---- top world markets teaser
  const WW = ((D.world || {}).countries || []).filter((c) => !c.agg && !c.stale && c.score != null).sort((a, b) => b.score - a.score).slice(0, 5);
  if (WW.length) {
    document.getElementById("world-mini").innerHTML = WW.map((c, i) => `<a class="panel" href="world.html">
      <span class="w-flag" aria-hidden="true">${RE.flag(c.code)}</span><b>${i + 1}. ${esc(c.name)}</b>
      <span class="re-small">Score <b class="num">${c.score}</b> · real ${pct(c.r1y)}</span>${spark(c.spark, 120, 28)}</a>`).join("");
  } else document.getElementById("world-teaser").hidden = true;
})();
