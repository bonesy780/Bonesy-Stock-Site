// Real estate overview, investor sections: key lending rates (US, Canada, Europe), the "where investors are looking
// and spending" heat map with a country filter, property types (REIT returns and fundamentals), where money is
// being spent (construction and permits) and commercial real estate health.
(async function () {
  const { esc, pct, fixed, spark, store, flag, marketUrl } = RE;
  let I = {}, D = null;
  try { I = await RE.load("invest.json"); } catch { I = {}; }
  try { D = await RE.data(); } catch { D = null; }
  const $ = (id) => document.getElementById(id);
  const when = (s) => {
    if (!s) return "";
    if (/^\d{4}-Q\d$/.test(s)) return s.replace("-Q", " Q").replace(/^(\d{4}) (Q\d)$/, "$2 $1");
    const d = new Date(s.length === 7 ? s + "-15" : s.length === 4 ? s + "-07-01" : s);
    return isNaN(d) ? s : d.toLocaleDateString(undefined, s.length > 7 ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", year: "numeric" });
  };
  const pts = (v, nd = 2) => v == null ? "" : `<span class="num ${v <= 0 ? "up" : "down"}">${v > 0 ? "+" : ""}${v.toFixed(nd)}</span>`;
  const seg = (el, items, on, attr) => { el.innerHTML = items.map(([v, l]) => `<button role="tab" aria-selected="${v === on}" data-${attr}="${esc(v)}">${l}</button>`).join(""); };

  // ---------------------------------------------------------------- key lending rates
  const R = I.rates || {};
  const BLOCKS = [["US", "🇺🇸", "United States"], ["CA", "🇨🇦", "Canada"], ["EU", "🇪🇺", "Europe"]];
  function drawRates() {
    const el = $("lend");
    const blocks = BLOCKS.filter(([k]) => (R[k] || []).length);
    if (!blocks.length) { el.innerHTML = `<div class="panel empty">The lending rates appear after the next data update.</div>`; return; }
    el.innerHTML = `<div class="re-lend-grid">${blocks.map(([k, fl, name]) => {
      const groups = [];
      for (const r of R[k]) { let g = groups.find((x) => x.name === r.group); if (!g) groups.push(g = { name: r.group, rows: [] }); g.rows.push(r); }
      return `<div class="panel re-lend">
        <div class="re-lend-head"><span class="re-flag" aria-hidden="true">${fl}</span><h3>${esc(name)}</h3></div>
        ${groups.map((g) => `<div class="re-lend-group">${esc(g.name)}</div>${g.rows.map((r) => `
          <div class="re-lend-row" title="${esc(r.tip || "")}${r.src ? ` Source: ${esc(r.src)}.` : ""} As of ${esc(when(r.at))}.">
            <span class="re-lend-name">${esc(r.name)}${r.note ? ` <span class="muted re-small">${esc(r.note)}</span>` : ""}</span>
            <span class="re-lend-spark">${r.spark && r.spark.length > 2 ? spark(r.spark, 56, 18) : ""}</span>
            <b class="num">${r.v.toFixed(2)}%</b>
            <span class="re-lend-chg">${r.chg != null ? pts(r.chg) : ""}</span>
          </div>`).join("")}`).join("")}
      </div>`;
    }).join("")}</div>
    ${(I.euroMortgage || []).length ? euroBars() : ""}`;
  }
  function euroBars() {
    const rows = I.euroMortgage.slice().sort((a, b) => a.v - b.v);
    const max = Math.max(...rows.map((r) => r.v)) || 1;
    return `<div class="panel re-lend-eu">
      <h3>Mortgage rates across the euro area</h3>
      <p class="muted re-small">Average rate on new home loans in each country (ECB, ${esc(when(rows[0].at))}). Change on a year earlier in points.</p>
      <div class="re-bars re-bars-1">${rows.map((r) => `<div class="re-bar-row is-static"><span class="re-bar-name">${flag(r.code)} ${esc(r.name)}</span>
        <span class="re-bar-track"><i style="width:${(r.v / max * 100).toFixed(1)}%"></i></span><span class="num">${r.v.toFixed(2)}% ${r.chg != null ? `<span class="re-small">${pts(r.chg)}</span>` : ""}</span></div>`).join("")}</div>
    </div>`;
  }
  drawRates();

  // ---------------------------------------------------------------- key investment metrics
  function drawMetrics() {
    const el = $("inv-metrics");
    const W = Object.fromEntries((((D || {}).world || {}).countries || []).map((c) => [c.code, c]));
    const C = (D || {}).countries || {};
    const tiles = (I.metrics || []).slice();
    // Valuation figures already in the main data
    for (const [c, nm] of [["US", "US"], ["CA", "Canada"]]) {
      const w = W[c];
      if (w && w.pti != null) tiles.push({ name: `${nm} price-to-income`, val: `${w.pti.toFixed(0)}`, unit: "", sub: `vs its long-run average of 100 (OECD, ${when(w.ptiAt)})`, tone: w.pti > 110 ? "down" : w.pti < 95 ? "up" : "" });
    }
    for (const r of ((I.reits || {}).broad || [])) tiles.push({ name: r.name + ", 1 yr", val: (r.r1y > 0 ? "+" : "") + r.r1y.toFixed(1), unit: "%", sub: `YTD ${r.ytd > 0 ? "+" : ""}${r.ytd.toFixed(1)}%, yield ${r.yld != null ? r.yld.toFixed(1) + "%" : "–"}`, tone: r.r1y >= 0 ? "up" : "down", tip: "Price change over the past year of a fund holding listed property companies." });
    if (C.US && C.US.rentVacancy) tiles.push({ name: "US rental vacancy", val: C.US.rentVacancy.v.toFixed(1), unit: "%", sub: `Census, ${when(C.US.rentVacancy.at)}` });
    if (!tiles.length) { $("inv-metrics-sec").hidden = true; return; }
    el.innerHTML = tiles.map((t) => `<div class="panel re-metric" title="${esc(t.tip || "")}">
      <span class="label">${esc(t.name)}</span>
      <b class="num ${t.tone || ""}">${esc(t.val)}${esc(t.unit || "")}</b>
      ${t.chg ? `<span class="re-small">${t.chg}</span>` : ""}
      <span class="muted re-small">${esc(t.sub || "")}</span>
    </div>`).join("");
  }
  // Tiles worked out from the build's series
  I.metrics = (I.cre || []).map((m) => ({
    name: m.name, val: m.v.toFixed(m.nd ?? 1), unit: m.unit ?? "%", tip: m.tip,
    sub: `${m.src ? m.src + ", " : ""}${when(m.at)}`,
    chg: m.chg != null ? `${m.chg > 0 ? "+" : ""}${m.chg.toFixed(m.nd ?? 1)}${m.chgUnit ?? " pts"} on a year ago` : "",
    tone: m.good == null || m.chg == null || m.chg === 0 ? "" : (m.chg > 0) === (m.good > 0) ? "up" : "down",
  }));
  drawMetrics();

  // ---------------------------------------------------------------- heat map: where investors are looking and spending
  const WORLD = (((D || {}).world || {}).countries || []).filter((c) => !c.agg && !c.stale && !c.note);
  const CPP = Object.fromEntries((I.cpp || []).map((c) => [c.code, c]));
  const EUM = Object.fromEntries((I.euroMortgage || []).map((c) => [c.code, c]));
  const M = (D || {}).markets || [];
  const PERMITS = ((I.build || {}).CA || {}).cmas || [];
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const sgn = (v, d = 1) => v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;
  // Each column: [key, label, value fn, direction (+1: higher = more investor interest), text fn, what it means]
  const worldCols = [
    ["score", "Investor score", (c) => c.score, 1, (v) => v == null ? "–" : String(v), "The site's 0 to 100 investor score: real price momentum, long-run growth, value, interest rates and currency."],
    ["r1y", "Home prices, real 1 yr", (c) => c.r1y, 1, sgn, "Change in house prices over the past year after inflation (BIS)."],
    ["cpp", "Commercial prices 1 yr", (c) => (CPP[c.code] || {}).n1y, 1, sgn, "Change in commercial property prices over the past year (BIS commercial property price index)."],
    ["rate1y", "Rate change 1 yr", (c) => c.rate1y, -1, (v) => v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`, "Change in the central bank policy rate over the past year, in points. Falling rates draw buyers in."],
    ["pti", "Price to income", (c) => c.pti, -1, (v) => v == null ? "–" : v.toFixed(0), "OECD price-to-income ratio against the country's long-run average (100). Lower is better value."],
    ["fx1y", "Currency vs US$", (c) => c.fx1y, 1, sgn, "Change in the currency against the US dollar over the past year. A firmer currency lifts returns for foreign buyers."],
    ["rCagr10", "10-yr real growth", (c) => c.rCagr10, 1, (v) => v == null ? "–" : `${v.toFixed(1)}%/yr`, "Average yearly real price growth over ten years."],
  ];
  const euroCols = [...worldCols.slice(0, 3), ["mort", "Mortgage rate", (c) => (EUM[c.code] || {}).v, -1, (v) => v == null ? "–" : v.toFixed(2) + "%", "Average rate on new home loans (ECB). Cheaper credit supports demand."], ...worldCols.slice(3)];
  const VIEWS = {
    world: { label: "🌐 All countries", rows: () => WORLD, cols: worldCols, name: (c) => `${flag(c.code)} ${esc(c.name)}`, link: () => "world.html", note: "Every country with current BIS house price data, coloured by how strongly each figure points to investor demand." },
    europe: { label: "🇪🇺 Europe", rows: () => WORLD.filter((c) => c.region === "Europe"), cols: euroCols, name: (c) => `${flag(c.code)} ${esc(c.name)}`, link: () => "world.html", note: "European countries: house and commercial prices, mortgage rates and value." },
    asia: { label: "🌏 Asia-Pacific", rows: () => WORLD.filter((c) => c.region === "Asia-Pacific"), cols: worldCols, name: (c) => `${flag(c.code)} ${esc(c.name)}`, link: () => "world.html", note: "Asia-Pacific countries." },
    americas: { label: "🌎 Americas", rows: () => WORLD.filter((c) => c.region === "Americas"), cols: worldCols, name: (c) => `${flag(c.code)} ${esc(c.name)}`, link: () => "world.html", note: "North and South America." },
    mea: { label: "🌍 Middle East & Africa", rows: () => WORLD.filter((c) => c.region === "Middle East & Africa"), cols: worldCols, name: (c) => `${flag(c.code)} ${esc(c.name)}`, link: () => "world.html", note: "Middle East and Africa." },
    US: {
      label: "🇺🇸 United States (metro areas)", rows: () => M.filter((m) => m.c === "US" && m.id !== "us" && m.rank <= 60), name: (m) => `${esc(m.name)} <span class="muted re-small">${esc(m.region)}</span>`, link: (m) => marketUrl(m.id),
      note: "The 60 biggest US metro areas on Zillow's demand and price figures.",
      cols: [
        ["heat", "Demand (heat index)", (m) => m.heat, 1, (v) => v == null ? "–" : String(Math.round(v)), "Zillow's market heat index: how hot buyer demand is against supply. Over 70 is a strong seller's market."],
        ["v1y", "Prices 1 yr", (m) => m.v1y, 1, sgn, "Typical home value change over the past year."],
        ["rent1y", "Rents 1 yr", (m) => m.rent1y, 1, sgn, "Typical rent change over the past year."],
        ["yield", "Rent yield", (m) => m.yield, 1, (v) => v == null ? "–" : v.toFixed(1) + "%", "A year of rent as a share of the home value, before costs."],
        ["dtp", "Days to pending", (m) => m.dtp, -1, (v) => v == null ? "–" : String(Math.round(v)), "Median days from listing to an accepted offer. Fewer days means buyers are competing."],
        ["stl", "Sale to list", (m) => m.stl == null ? null : m.stl * 100, 1, (v) => v == null ? "–" : v.toFixed(1) + "%", "Sale price as a share of list price."],
        ["inv1y", "Supply change", (m) => m.inv1y, -1, (v) => sgn(v, 0), "Homes for sale against a year ago. Falling supply means demand is soaking it up."],
        ["fc", "Zillow forecast", (m) => m.fc, 1, sgn, "Zillow's forecast for the typical home value a year from now."],
      ],
    },
    CA: {
      label: "🇨🇦 Canada (cities)", rows: canadaRows, name: (m) => `${esc(m.name)} <span class="muted re-small">${esc(m.prov || m.region || "")}</span>`, link: (m) => m.id ? marketUrl(m.id) : null,
      note: "Canadian cities: building permit values by type over the past 12 months against the 12 months before (Statistics Canada), new home prices and rents. Permits show where money is going into new buildings.",
      cols: [
        ["totY", "All permits", (m) => m.totY, 1, (v) => sgn(v, 0), "Value of all building permits, past 12 months on the 12 months before."],
        ["resY", "Residential", (m) => m.resY, 1, (v) => sgn(v, 0), "Residential building permits (houses and apartments)."],
        ["comY", "Commercial", (m) => m.comY, 1, (v) => sgn(v, 0), "Commercial permits: offices, stores, hotels, warehouses."],
        ["indY", "Industrial", (m) => m.indY, 1, (v) => sgn(v, 0), "Industrial permits: plants, utilities and the like."],
        ["instY", "Institutional", (m) => m.instY, 1, (v) => sgn(v, 0), "Institutional and government permits: hospitals, schools, care homes."],
        ["tot", "Permits, 12 mo", (m) => m.tot, 1, (v) => v == null ? "–" : `C$${v >= 1000 ? (v / 1000).toFixed(1) + "B" : Math.round(v) + "M"}`, "Value of all permits in the past 12 months, in Canadian dollars."],
        ["v1y", "New home prices", (m) => m.v1y, 1, sgn, "New Housing Price Index, change on a year earlier."],
        ["rent1y", "Rents", (m) => m.rent1y, 1, sgn, "CMHC average two-bedroom rent change."],
      ],
    },
    MX: {
      label: "🇲🇽 Mexico (states)", rows: () => M.filter((m) => m.c === "MX" && m.id !== "mx"), name: (m) => esc(m.name), link: (m) => marketUrl(m.id),
      note: "Mexican states on Sociedad Hipotecaria Federal's prices. Border and Bajío states also draw factory and warehouse money from near-shoring.",
      cols: [
        ["v1y", "Prices 1 yr", (m) => m.v1y, 1, sgn, "SHF price index, change on a year earlier."],
        ["usd", "Average price (US$)", (m) => m.usd, 1, (v) => v == null ? "–" : "$" + Math.round(v / 1000) + "K", "SHF average price of homes valued for a mortgage, in US dollars."],
        ["median", "Middle price", (m) => m.median, 1, (v) => v == null ? "–" : "MX$" + (v / 1e6).toFixed(2) + "M", "SHF median price."],
      ],
    },
  };
  function canadaRows() {
    const cities = Object.fromEntries(M.filter((m) => m.c === "CA" && m.id !== "ca").map((m) => [norm(m.name.replace(/\s*\(.*\)/, "")), m]));
    const rows = PERMITS.map((p) => {
      const m = cities[norm(p.name)] || cities[norm(p.name.split(/[-–]/)[0])];
      return { ...p, id: m ? m.id : null, region: m ? m.region : p.prov, v1y: m ? m.v1y : null, rent1y: m ? m.rent1y : null };
    });
    // Cities in the price index without permit figures still show their prices
    for (const m of Object.values(cities)) if (!rows.some((r) => r.id === m.id)) rows.push({ name: m.name, id: m.id, region: m.region, v1y: m.v1y, rent1y: m.rent1y });
    return rows;
  }
  const hm = { view: store.get("re-heat-view", "world"), key: null, dir: -1, all: false, mode: store.get("re-heat-mode", "place") };
  const heatSel = $("heat-country"), heatMode = $("heat-mode");
  // Percentile rank of each value within its column, so every column uses the whole colour range
  const ranker = (vals) => {
    const s = vals.filter((v) => v != null).sort((a, b) => a - b);
    return (v) => v == null || s.length < 2 ? null : s.filter((x) => x < v).length / (s.length - 1) + (s.filter((x) => x === v).length - 1) / 2 / (s.length - 1);
  };
  const cellBg = (p) => p == null ? "" : `background:color-mix(in srgb, ${p >= 0.5 ? "var(--heat-hot)" : "var(--heat-cold)"} ${Math.round(Math.abs(p - 0.5) * 2 * 70 + 6)}%, transparent)`;
  function drawHeat() {
    const views = Object.entries(VIEWS).filter(([, v]) => v.rows().length);
    if (!views.length && !(I.reits || {}).classes) { $("heatmap").hidden = true; return; }
    seg(heatMode, [["place", "By place"], ["type", "By property type"]], hm.mode, "mode");
    heatSel.hidden = hm.mode !== "place";
    if (hm.mode === "type") return drawTypeHeat();
    if (!VIEWS[hm.view] || !VIEWS[hm.view].rows().length) hm.view = views[0][0];
    heatSel.innerHTML = `<optgroup label="Regions">${views.filter(([k]) => !["US", "CA", "MX"].includes(k)).map(([k, v]) => `<option value="${k}" ${k === hm.view ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</optgroup>
      <optgroup label="Countries, by city or state">${views.filter(([k]) => ["US", "CA", "MX"].includes(k)).map(([k, v]) => `<option value="${k}" ${k === hm.view ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</optgroup>`;
    const V = VIEWS[hm.view];
    const rows = V.rows();
    const cols = V.cols.filter((c) => rows.some((r) => c[2](r) != null));
    const rank = Object.fromEntries(cols.map((c) => [c[0], ranker(rows.map(c[2]))]));
    // Interest score: the average of each row's column percentiles, flipped where lower means more interest
    const scored = rows.map((r) => {
      const ps = cols.map((c) => { const p = rank[c[0]](c[2](r)); return p == null ? null : c[3] > 0 ? p : 1 - p; }).filter((p) => p != null);
      return { r, ps, score: ps.length >= Math.min(3, cols.length) ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length * 100) : null };
    });
    const key = hm.key && (hm.key === "_int" || cols.find((c) => c[0] === hm.key)) ? hm.key : "_int";
    const val = key === "_int" ? (x) => x.score : (x) => cols.find((c) => c[0] === key)[2](x.r);
    scored.sort((a, b) => { const x = val(a), y = val(b); return x == null ? 1 : y == null ? -1 : (x - y) * hm.dir; });
    const shown = hm.all ? scored : scored.slice(0, 25);
    const th = (k, l, t) => `<th${k === "_int" ? ' class="re-heat-score"' : ""} aria-sort="${k === key ? (hm.dir > 0 ? "ascending" : "descending") : "none"}"><button class="sort" data-k="${k}" title="${esc(t)}">${esc(l)}<i aria-hidden="true">${k === key ? (hm.dir > 0 ? "▲" : "▼") : ""}</i></button></th>`;
    $("heat-note").textContent = V.note;
    $("heat").innerHTML = `<div class="table-wrap"><table class="grid-table re-heat">
      <thead><tr><th class="left">Place</th>${th("_int", "Interest", "Investor interest, 0 to 100: the average of where this place ranks on each column, with the colour direction shown in the key.")}${cols.map((c) => th(c[0], c[1], c[5])).join("")}</tr></thead>
      <tbody>${shown.map(({ r, score }) => {
        const href = V.link(r);
        return `<tr><td class="left re-heat-name">${href ? `<a class="co" href="${href}">${V.name(r)}</a>` : V.name(r)}</td>
          <td class="re-heat-score"><span class="re-heat-pill" style="${cellBg(score == null ? null : score / 100)}">${score ?? "–"}</span></td>
          ${cols.map((c) => { const v = c[2](r), p = rank[c[0]](v); return `<td class="re-heat-cell num" style="${cellBg(p == null ? null : c[3] > 0 ? p : 1 - p)}">${c[4](v)}</td>`; }).join("")}</tr>`;
      }).join("")}</tbody></table></div>
      ${scored.length > 25 ? `<div class="re-heat-more"><button class="chip" type="button" id="heat-all">${hm.all ? "Show the top 25" : `Show all ${scored.length}`}</button></div>` : ""}`;
  }
  function drawTypeHeat() {
    const C = (I.reits || {}).classes || [];
    const regions = [["US", "🇺🇸 US"], ["CA", "🇨🇦 Canada"], ["EU", "🇪🇺 Europe"]].filter(([k]) => C.some((c) => c[k]));
    $("heat-note").textContent = "Listed property companies (REITs) by property type and region: what investors are paying up for right now. Returns are price changes; the yield is the trailing dividend yield, where a low yield means investors are paying up (so it shows hotter). Fundamentals are below.";
    const cols = [];
    for (const [k, l] of regions) for (const [f, fl] of [["r1m", "1 mo"], ["ytd", "YTD"], ["r1y", "1 yr"], ["yld", "Yield"]]) cols.push({ k, f, label: `${l} ${fl}`, region: l });
    const rank = Object.fromEntries(cols.map((c) => [c.k + c.f, ranker(C.map((x) => (x[c.k] || {})[c.f]))]));
    $("heat").innerHTML = `<div class="table-wrap"><table class="grid-table re-heat re-heat-types">
      <thead><tr><th class="left">Property type</th>${regions.map(([, l]) => `<th colspan="4" class="re-heat-group">${l}</th>`).join("")}</tr>
      <tr><th class="left"></th>${cols.map((c) => `<th>${c.f === "r1m" ? "1 mo" : c.f === "ytd" ? "YTD" : c.f === "r1y" ? "1 yr" : "Yield"}</th>`).join("")}</tr></thead>
      <tbody>${C.map((x) => `<tr><td class="left re-heat-name">${x.icon || ""} ${esc(x.name)}</td>${cols.map((c) => {
        const g = x[c.k] || {}, v = g[c.f], p0 = rank[c.k + c.f](v), p = p0 == null ? null : c.f === "yld" ? 1 - p0 : p0;
        return `<td class="re-heat-cell num" style="${cellBg(p)}" title="${esc((g.names || []).join(", "))}">${v == null ? "–" : c.f === "yld" ? v.toFixed(1) + "%" : sgn(v, 0)}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  heatSel.addEventListener("change", () => { hm.view = heatSel.value; hm.key = null; hm.dir = -1; hm.all = false; store.set("re-heat-view", hm.view); drawHeat(); });
  heatMode.addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (!b) return; hm.mode = b.dataset.mode; store.set("re-heat-mode", hm.mode); drawHeat(); });
  $("heat").addEventListener("click", (e) => {
    if (e.target.closest("#heat-all")) { hm.all = !hm.all; drawHeat(); return; }
    const b = e.target.closest("button.sort");
    if (!b) return;
    if (hm.key === b.dataset.k || (!hm.key && b.dataset.k === "_int")) hm.dir = -hm.dir; else { hm.key = b.dataset.k; hm.dir = -1; }
    drawHeat();
  });
  drawHeat();

  // ---------------------------------------------------------------- property types
  const AC = I.classes || {};
  const REITS = Object.fromEntries((((I.reits || {}).classes) || []).map((c) => [c.key, c]));
  const pt = { r: store.get("re-types-region", "US") };
  const TREND = { in: ["Capital flowing in", "buy"], steady: ["Steady", ""], out: ["Capital flowing out", "sell"] };
  function drawTypes() {
    const list = AC.classes || [];
    if (!list.length) { $("types-sec").hidden = true; return; }
    seg($("types-region"), [["US", "🇺🇸 United States"], ["CA", "🇨🇦 Canada"], ["EU", "🇪🇺 Europe"]], pt.r, "r");
    $("types").innerHTML = list.map((c) => {
      const f = c[pt.r] || {}, live = (REITS[c.key] || {})[pt.r];
      const tr = TREND[c.trend] || TREND.steady;
      return `<article class="panel card re-type">
        <div class="re-type-top"><span class="re-type-icon" aria-hidden="true">${c.icon}</span><h3>${esc(c.name)}</h3><span class="pill ${tr[1]}">${tr[0]}</span></div>
        <p class="re-type-what">${esc(c.what)}</p>
        <dl class="re-type-dl">
          <div><dt>Cap rate</dt><dd>${esc(f.cap || "–")}</dd></div>
          <div><dt>${c.key === "hotel" || c.key === "senior" || c.key === "storage" ? "Occupancy" : "Vacancy"}</dt><dd>${esc(f.vac || "–")}</dd></div>
          <div><dt>Rent growth</dt><dd>${esc(f.rent || "–")}</dd></div>
        </dl>
        ${live ? `<div class="re-type-live"><span class="muted re-small">REITs${live.n ? ` (${live.n})` : ""}</span>
          <span>1 yr ${pct(live.r1y, 0)}</span><span>YTD ${pct(live.ytd, 0)}</span>${live.yld != null ? `<span>Yield <b class="num">${live.yld.toFixed(1)}%</b></span>` : ""}
          ${live.spark ? spark(live.spark, 70, 20) : ""}</div>
          <p class="muted re-small re-type-names">${esc((live.names || []).join(", "))}</p>` : ""}
        <p class="re-small re-type-drv">${esc(c.drivers)}</p>
      </article>`;
    }).join("");
    $("types-note").innerHTML = `Cap rates, vacancy and rent growth are rounded ranges from public market reports (${(AC.sources || []).map(([n, u]) => `<a href="${esc(u)}">${esc(n.split(" (")[0])}</a>`).join(", ")}), as of <b>${esc(AC.asOf || "")}</b>, checked ${esc(when(AC.checked))}. They are typical figures for the whole market, not any one building, and are updated by hand. REIT returns are live from the market data${(I.reits || {}).at ? `, ${esc(when(I.reits.at))}` : ""}.`;
  }
  $("types-region").addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (!b) return; pt.r = b.dataset.r; store.set("re-types-region", pt.r); drawTypes(); });
  drawTypes();

  // ---------------------------------------------------------------- where the money is going: construction and permits
  function drawSpend() {
    const B = I.build || {};
    const us = B.US || [], ca = ((B.CA || {}).types) || [];
    if (!us.length && !ca.length) { $("spend-sec").hidden = true; return; }
    const bars = (rows, fmt, title, note) => {
      if (!rows.length) return "";
      const max = Math.max(...rows.map((r) => r.v)) || 1;
      return `<div class="panel re-spend"><h3>${title}</h3><p class="muted re-small">${note}</p>
        ${rows.map((r) => `<div class="re-spend-row"><span class="re-bar-name">${esc(r.name)}</span>
          <span class="re-bar-track"><i style="width:${(r.v / max * 100).toFixed(1)}%"></i></span>
          <span class="num">${fmt(r.v)}</span><span class="re-small">${pct(r.yoy, 0)}</span></div>`).join("")}</div>`;
    };
    $("spend").innerHTML = bars(us.slice().sort((a, b) => b.v - a.v), (v) => "$" + Math.round(v) + "B", "🇺🇸 US construction spending by type",
      `Private construction put in place, yearly rate, US Census Bureau, ${esc(when((us[0] || {}).at))}. Change on a year earlier.`)
      + bars(ca.slice().sort((a, b) => b.v - a.v), (v) => "C$" + (v / 1000).toFixed(1) + "B", "🇨🇦 Canada building permits by type",
      `Value of permits issued over the past 12 months, Statistics Canada, to ${esc(when((B.CA || {}).at))}. Change on the 12 months before.`);
  }
  drawSpend();

  // ---------------------------------------------------------------- commercial property prices by country
  function drawCpp() {
    const rows = (I.cpp || []).filter((c) => c.n1y != null).sort((a, b) => b.n1y - a.n1y);
    if (rows.length < 3) { $("cpp-sec").hidden = true; return; }
    const max = Math.max(...rows.map((r) => Math.abs(r.n1y))) || 1;
    $("cpp").innerHTML = `<div class="panel re-bars">${rows.map((r) => `<div class="re-bar-row is-static" title="${esc(r.name)}: ${r.n5y != null ? sgn(r.n5y, 0) + " over 5 years, " : ""}latest ${esc(when(r.asof))}">
      <span class="re-bar-name">${flag(r.code)} ${esc(r.name)}</span><span class="re-bar-track"><i class="${r.n1y >= 0 ? "pos" : "neg"}" style="width:${(Math.abs(r.n1y) / max * 100).toFixed(1)}%"></i></span>${pct(r.n1y)}</div>`).join("")}</div>`;
  }
  drawCpp();
})();
