// One market: headline figures, price history, supply and speed, buyer/seller gauge,
// a quick own-versus-rent check, similar markets and where to find listings.
(async function () {
  const { esc, short, money, pct, fixed, int, marketUrl, place, headline, sideCls, star, chart, since, store, payment, COUNTRY, FLAG, searchLinks } = RE;
  const view = document.getElementById("view");
  let D;
  try { D = await RE.data(); } catch { view.innerHTML = `<div class="panel empty">The real estate data hasn't been built yet.</div>`; return; }
  const params = new URLSearchParams(location.search);
  const id = params.get("id") || store.get("re-last", "us");
  const m = D.byId[id];
  if (!m) {
    view.innerHTML = `<section class="hero"><h1>Market lookup</h1><p>Search for a city, metro area, state or country in the box at the top, or pick one below.</p></section>
      <div class="cards">${["us-new-york-ny", "us-los-angeles-ca", "us-dallas-tx", "us-miami-fl", "ca-toronto", "ca-vancouver", "ca-calgary", "mx-ciudad-de-mexico", "mx-jalisco", "mx-nuevo-leon"]
        .map((k) => D.byId[k]).filter(Boolean).map((x) => `<a class="panel card" href="${marketUrl(x.id)}"><span class="nm">${FLAG[x.c]} ${esc(x.name)}</span><span class="tk">${esc(place(x))}</span></a>`).join("")}</div>`;
    return;
  }
  store.set("re-last", id);
  document.title = `TopTicker Homes · ${m.name}`;
  const h = headline(m);
  const R = D.rates || {};
  const when = (s) => /^\d{4}-Q\d$/.test(s) ? s.replace("-Q", " Q") : new Date(s + "-15").toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const stat = (l, v, t = "") => v == null ? "" : `<div class="stat" ${t ? `title="${esc(t)}"` : ""}><div class="label">${l}</div><div class="value">${v}</div></div>`;

  const stats = m.c === "US" ? [
    stat("1 month", pct(m.v1m)), stat("3 months", pct(m.v3m)), stat("1 year", pct(m.v1y)), stat("5 years", pct(m.v5y, 0)), stat("10 years", pct(m.v10y, 0)),
    m.offPeak != null && m.offPeak < -0.5 ? stat("From peak", pct(m.offPeak), "Typical value against its highest month") : "",
    stat("Zillow forecast, 12 mo", m.fc != null ? pct(m.fc) : null),
  ] : m.c === "CA" ? [
    stat("1 month", pct(m.v1m)), stat("3 months", pct(m.v3m)), stat("1 year", pct(m.v1y)), stat("5 years", pct(m.v5y, 0)), stat("10 years", pct(m.v10y, 0)),
    stat("From peak", pct(m.offPeak)),
  ] : [stat("1 year", m.v1y != null ? pct(m.v1y) : null), stat("In US dollars", m.usd ? `<span class="num">${short(m.usd)}</span>` : null), stat("Rank by price", m.priceRank ? `<span class="num">${m.priceRank} of 32</span>` : null)];

  // Supply, speed and rent
  const facts = m.c === "US" ? [
    ["Typical rent", m.rent ? `<span class="num">${money(m.rent)}</span>/mo ${pct(m.rent1y)}` : null, "Zillow Observed Rent Index, change on a year ago"],
    ["Gross rent yield", m.yield != null ? `<span class="num">${m.yield.toFixed(1)}%</span>` : null, "A year's typical rent divided by the typical home value, before costs"],
    ["Homes for sale", m.inv != null ? `<span class="num">${int(m.inv)}</span> ${pct(m.inv1y, 0)}` : null, "Active listings in the month, change on a year ago"],
    ["New listings", m.newl != null ? `<span class="num">${int(m.newl)}</span> ${pct(m.newl1y, 0)}` : null, "Homes newly listed in the month"],
    ["Median list price", m.mlp ? `<span class="num">${money(m.mlp)}</span>` : null],
    ["Median sale price", m.msp ? `<span class="num">${money(m.msp)}</span>` : null],
    ["Days to pending", m.dtp != null ? `<span class="num">${int(m.dtp)}</span>${m.dtp1y != null ? ` <span class="muted">(${m.dtp1y >= 0 ? "+" : ""}${m.dtp1y} on a year ago)</span>` : ""}` : null, "Median days from listing to an accepted offer"],
    ["Listings with a price cut", m.cut != null ? `<span class="num">${m.cut.toFixed(1)}%</span>` : null],
    ["Sale-to-list ratio", m.stl != null ? `<span class="num">${(m.stl * 100).toFixed(1)}%</span>` : null, "Average sale price as a share of the final list price"],
    ["Zillow market heat", m.heat != null ? `<span class="num">${int(m.heat)}</span>` : null, "Zillow's index: 50 is neutral, higher favours sellers"],
  ] : m.c === "CA" ? [
    ["Average 2-bed rent", m.rent ? `<span class="num">${money(m.rent, "CAD")}</span>/mo ${pct(m.rent1y)}` : null, `CMHC rental market survey${m.rentYear ? ", " + m.rentYear : ""}`],
    ["New home price index", `<span class="num">${fixed(m.idx, 1)}</span>`, "December 2016 = 100. New homes only, house and land."],
    ["5-year fixed rate", R.ca5 ? `<span class="num">${R.ca5.v.toFixed(2)}%</span>` : null, "Bank of Canada conventional posted rate; most borrowers get a discount"],
  ] : [
    ["Average price", `<span class="num">${money(m.v, "MXN")}</span>`],
    ["Middle price", m.median ? `<span class="num">${money(m.median, "MXN")}</span>` : null],
    ["Lower quarter, up to", m.q1 ? `<span class="num">${money(m.q1, "MXN")}</span>` : null],
    ["Upper quarter, from", m.q3 ? `<span class="num">${money(m.q3, "MXN")}</span>` : null],
    ...(m.metroYoy ? [[esc(m.metroYoy.name) + ", 1 year", pct(m.metroYoy.yoy)]] : []),
  ];

  // Buyer/seller gauge (US)
  const gauge = m.score == null ? "" : `<section class="panel re-gauge">
    <h3>Who has the upper hand?</h3>
    <div class="re-gauge-track"><i style="left:${(m.score + 100) / 2}%"></i></div>
    <div class="re-gauge-labels"><span>Buyer's market</span><span>Balanced</span><span>Seller's market</span></div>
    <p><span class="pill ${sideCls(m.side)}">${esc(m.side)}</span> <span class="muted">Score ${m.score > 0 ? "+" : ""}${m.score} from Zillow's heat index, sale-to-list ratio, price cuts, days to pending, supply change and the 3-month price trend.</span></p>
  </section>`;

  // Own vs rent: monthly payment on the typical home with 20% down at today's rate
  const rate = m.c === "US" ? R.us30 && R.us30.v : m.c === "CA" ? R.ca5 && R.ca5.v : null;
  const price = m.c === "US" ? m.v : null;
  const own = price && rate ? payment(price * 0.8, rate, 30, "US") : null;
  const ownVsRent = own && m.rent ? `<section class="panel re-own">
    <h3>Own or rent the typical home?</h3>
    <div class="re-own-row"><div><span class="label">Mortgage payment</span><b class="num">${money(own)}</b><span class="muted">/mo, 20% down, ${rate.toFixed(2)}% 30-year fixed, before tax and insurance</span></div>
      <div><span class="label">Typical rent</span><b class="num">${money(m.rent)}</b><span class="muted">/mo</span></div></div>
    <p class="muted">${own > m.rent ? `Owning costs about <b>${money(own - m.rent)}</b> a month more than renting, before tax, insurance and upkeep, and before any rise in the home's value.` : `Owning costs about <b>${money(m.rent - own)}</b> a month less than renting, before tax, insurance and upkeep.`} <a href="tools.html?price=${Math.round(price)}&rent=${Math.round(m.rent)}&c=US#rvb">Run the full numbers</a>.</p>
  </section>` : "";

  // Similar markets: same country, closest typical value
  const peers = D.markets.filter((x) => x.c === m.c && x.id !== m.id && !["us", "ca", "mx"].includes(x.id) && (m.c === "CA" ? x.idx : x.v))
    .map((x) => [Math.abs(Math.log((m.c === "CA" ? x.idx : x.v) / (m.c === "CA" ? m.idx : m.v || 1))), x]).sort((a, b) => a[0] - b[0]).slice(0, 6).map((x) => x[1]);

  const links = ["us", "ca", "mx"].includes(m.id) ? [] : searchLinks(m);
  const isNation = ["us", "ca", "mx"].includes(m.id);

  view.innerHTML = `
    <section class="re-mhead">
      <div class="quote-head">
        <div><div class="muted">${FLAG[m.c]} ${esc(place(m))}</div><h1>${esc(m.name)} ${star("markets", m.id)}</h1></div>
        <div class="re-mhead-price"><div class="label">${esc(h.label)}${h.note ? ` (${h.note})` : ""}</div><div class="re-big">${h.html}</div><div class="muted">${esc(when(m.asof))}</div></div>
      </div>
      <div class="stats re-mstats">${stats.join("")}</div>
    </section>
    ${m.c !== "MX" ? `<section class="panel pad-h re-chart-box">
      <div class="toolbar"><div class="seg" role="tablist" aria-label="Period" id="range"></div><div class="seg" role="tablist" aria-label="Measure" id="what"></div></div>
      <div id="chart"></div>
    </section>` : `<section class="panel pad-h re-mx-range">
      <h3>Price range in ${esc(m.name)}</h3>
      ${mxRange(m)}
      <p class="muted">Sociedad Hipotecaria Federal publishes Mexican prices once a quarter by state, so there is no monthly chart. Prices are for homes valued for a mortgage.</p>
    </section>`}
    <div class="re-two">
      <section class="panel re-facts"><h3>${m.c === "US" ? "Supply, speed and rent" : "Key figures"}</h3>
        <dl>${facts.filter((f) => f[1] != null).map(([l, v, t]) => `<div ${t ? `title="${esc(t)}"` : ""}><dt>${l}</dt><dd>${v}</dd></div>`).join("")}</dl></section>
      <div class="re-side">${gauge}${ownVsRent}</div>
    </div>
    ${!isNation ? `<section>
      <div class="section-head"><h2>Homes for sale</h2><p>Listings on this site for ${esc(m.name)}, and the full listing sites.</p></div>
      <div class="re-links">${links.map(([n, u]) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">${esc(n)} ↗</a>`).join("")}<a class="btn primary" href="listings.html?m=${encodeURIComponent(m.id)}">Listings on this site</a></div>
    </section>` : ""}
    ${peers.length ? `<section><div class="section-head"><h2>Similar markets</h2><p>${COUNTRY[m.c]} markets closest in price.</p></div>
      <div class="cards">${peers.map((x) => `<a class="panel card" href="${marketUrl(x.id)}"><div class="card-top"><span class="co"><span class="nm">${esc(x.name)}</span><span class="tk">${esc(place(x))}</span></span>${RE.spark(x.spark)}</div>
        <div class="re-card-price">${headline(x).html} ${pct(x.v1y)} <span class="muted re-small">1 yr</span></div></a>`).join("")}</div>
      <p><a class="btn" href="compare.html?m=${[m.id, ...peers.slice(0, 3).map((x) => x.id)].map(encodeURIComponent).join(",")}">Compare these on one chart</a></p></section>` : ""}
    <p class="disclaimer">${m.c === "US" ? "Zillow Research figures are for the whole metro area and lag by about a month." : m.c === "CA" ? "Canada's resale prices (CREA MLS® Home Price Index) are licensed and not shown here; the New Housing Price Index tracks builders' prices for new homes." : "Prices from Sociedad Hipotecaria Federal's quarterly house price index."} Not financial advice.</p>`;

  function mxRange(x) {
    if (!x.q1 || !x.q3) return "";
    const hi = x.q3 * 1.25;
    const pos = (v) => (v / hi * 100).toFixed(1);
    return `<div class="re-range"><div class="re-range-track"><span class="lo" style="left:0;width:${pos(x.q1)}%"></span><span class="mid" style="left:${pos(x.q1)}%;width:${(pos(x.q3) - pos(x.q1)).toFixed(1)}%"></span>
      <i style="left:${pos(x.median)}%" title="Middle price"></i><b style="left:${pos(x.v)}%" title="Average price"></b></div>
      <div class="re-range-legend"><span>Lower quarter up to <b class="num">${short(x.q1, "MXN")}</b></span><span>Middle <b class="num">${short(x.median, "MXN")}</b></span><span>Average <b class="num">${short(x.v, "MXN")}</b></span><span>Upper quarter from <b class="num">${short(x.q3, "MXN")}</b></span></div></div>`;
  }

  if (m.c === "MX") return;
  let H;
  try { H = await RE.load("hist.json"); } catch { document.getElementById("chart").innerHTML = `<div class="empty">No history yet.</div>`; return; }
  const hs = (H.markets || {})[m.id] || {};
  const st = { range: 10, what: m.c === "CA" ? "idx" : "v" };
  const WHAT = m.c === "US" ? [["v", "Home value"], ["rent", "Rent"], ["inv", "For sale"], ["dtp", "Days to pending"], ["rate", "Mortgage rate"]]
    : [["idx", "Price index"], ["rent", "Rent"], ["rate", "Mortgage rate"]];
  const draw = () => {
    document.getElementById("range").innerHTML = [[1, "1Y"], [5, "5Y"], [10, "10Y"], [0, "All"]].map(([v, l]) => `<button role="tab" aria-selected="${v === st.range}" data-r="${v}">${l}</button>`).join("");
    document.getElementById("what").innerHTML = WHAT.filter(([k]) => k === "rate" || (hs[k] && hs[k].length > 1)).map(([k, l]) => `<button role="tab" aria-selected="${k === st.what}" data-w="${k}">${l}</button>`).join("");
    const pts = st.what === "rate" ? (H.rates || {})[m.c === "US" ? "us30" : "ca5"] : hs[st.what];
    const cur = m.cur;
    const fmt = st.what === "v" || (st.what === "rent" && m.c === "US") ? (v) => short(v, cur) : st.what === "rent" ? (v) => short(v, cur)
      : st.what === "rate" ? (v) => v.toFixed(2) + "%" : st.what === "idx" ? (v) => v.toFixed(1) : (v) => Math.round(v).toLocaleString();
    chart(document.getElementById("chart"), [{ name: m.name, color: "var(--accent)", pts: since(pts, st.range) }], { fmt, area: true, label: `${m.name} history` });
  };
  view.addEventListener("click", (e) => {
    const r = e.target.closest("[data-r]"), w = e.target.closest("[data-w]");
    if (r) { st.range = +r.dataset.r; draw(); }
    if (w) { st.what = w.dataset.w; draw(); }
  });
  draw();
})();
