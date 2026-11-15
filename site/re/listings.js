// Listings: real US listings from RentCast when switched on, clearly marked samples elsewhere,
// plus links out to each country's listing sites.
(async function () {
  const { esc, money, short, int, store, Saved, star, COUNTRY, FLAG, searchLinks, marketUrl } = RE;
  const list = document.getElementById("list");
  let L, D;
  try { [L, D] = await Promise.all([RE.load("listings.json"), RE.data()]); } catch {
    list.innerHTML = `<div class="panel empty">Listings haven't been built yet.</div>`; return;
  }
  const items = L.items || [];
  const real = items.filter((x) => !x.sample);
  const params = new URLSearchParams(location.search);
  const want = params.get("m") && D.byId[params.get("m")];
  let showN = 24;
  const f = { c: want ? want.c : store.get("re-l-country", "ALL"), city: "", type: "", beds: 0, max: null, sort: "new", saved: false };
  // Match a market id to a listing city
  const cityOf = (x) => `${x.city}|${x.region}`;
  if (want) {
    const hit = items.find((x) => x.market === want.id || (x.c === want.c && want.name.toLowerCase().startsWith(String(x.city).toLowerCase())));
    if (hit) f.city = cityOf(hit);
  }
  const fetched = L.fetched ? new Date(L.fetched).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
  document.getElementById("notice").innerHTML = real.length
    ? `<p><b>${real.length} active US listings</b> from RentCast, fetched ${esc(fetched)} (refreshed weekly on the free plan). Listings marked <span class="re-sample">Sample</span> fill in Canada and Mexico, where no free listing feed exists.</p>`
    : `<p><b>These are sample homes, not real listings.</b> Real listings across North America come from MLS boards, REALTOR.ca and Mexican portals, whose data is licensed and can't be copied onto this site. Each sample is priced from its market's real typical value to show how the page works; use the buttons below each city to see what is actually for sale.</p>
       <p class="muted">Real US listings switch on with a free RentCast API key: add it as the repo secret <code>RENTCAST_API_KEY</code> (see the README).</p>`;
  const seg = document.getElementById("l-country"), citySel = document.getElementById("l-city");
  const fillCities = () => {
    const cities = [...new Map(items.filter((x) => f.c === "ALL" || x.c === f.c).map((x) => [cityOf(x), x])).values()].sort((a, b) => a.city.localeCompare(b.city));
    citySel.innerHTML = `<option value="">All cities</option>` + cities.map((x) => `<option value="${esc(cityOf(x))}" ${cityOf(x) === f.city ? "selected" : ""}>${esc(x.city)}, ${esc(x.region)}</option>`).join("");
  };
  const ppsf = (x) => x.price && x.sqft ? x.price / x.sqft : null;
  const card = (x) => {
    const m = x.market && D.byId[x.market];
    const typical = m && m.v;
    const vs = typical && !x.sample && x.c !== "CA" ? (x.price / typical - 1) * 100 : null;
    const q = encodeURIComponent(`${x.addr}, ${x.city}, ${x.region}${x.zip ? " " + x.zip : ""}`);
    const out = x.sample ? "" : `<a class="btn small" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Find this listing ↗</a>`;
    return `<article class="panel re-home${x.sample ? " is-sample" : ""}">
      <div class="re-home-pic" aria-hidden="true">${houseArt(x)}</div>
      <div class="re-home-body">
        <div class="card-top"><b class="re-home-price num">${money(x.price, x.cur)}</b>${star("homes", x.id)}</div>
        <div class="re-home-facts">${x.beds != null ? `<span><b>${x.beds}</b> bd</span>` : ""}${x.baths != null ? `<span><b>${x.baths}</b> ba</span>` : ""}${x.sqft ? `<span><b>${int(x.sqft)}</b> sq ft</span>` : ""}${x.type ? `<span>${esc(x.type)}</span>` : ""}</div>
        <div class="re-home-addr">${esc(x.addr || "")}<br><span class="muted">${FLAG[x.c]} ${esc(x.city)}, ${esc(x.region)}${x.zip ? " " + esc(x.zip) : ""}</span></div>
        <div class="tags">
          ${x.sample ? `<span class="re-sample" title="Made up from this market's typical prices. Not for sale.">Sample</span>` : `<span class="tag">Active</span>`}
          ${x.dom != null ? `<span class="tag">${x.dom} day${x.dom === 1 ? "" : "s"} listed</span>` : ""}
          ${ppsf(x) ? `<span class="tag">${money(ppsf(x), x.cur)}/sq ft</span>` : ""}
          ${vs != null ? `<span class="tag" title="Against the market's typical value">${vs >= 0 ? "+" : ""}${vs.toFixed(0)}% vs typical</span>` : ""}
          ${x.year ? `<span class="tag">Built ${x.year}</span>` : ""}
        </div>
        ${x.office ? `<div class="muted re-small">Listed by ${esc(x.office)}${x.mls ? " · " + esc(x.mls) : ""}</div>` : ""}
        <div class="re-home-actions">${out}${m ? `<a class="btn small" href="${marketUrl(m.id)}">${esc(m.name)} market</a>` : ""}</div>
      </div>
    </article>`;
  };
  function draw() {
    seg.innerHTML = [["ALL", "All"], ["US", "🇺🇸 US"], ["CA", "🇨🇦 Canada"], ["MX", "🇲🇽 Mexico"]].map(([c, l]) => `<button role="tab" aria-selected="${c === f.c}" data-c="${c}">${l}</button>`).join("");
    let rows = items.filter((x) => (f.c === "ALL" || x.c === f.c) && (!f.city || cityOf(x) === f.city) && (!f.type || x.type === f.type)
      && (!f.beds || (x.beds || 0) >= f.beds) && (f.max == null || x.price <= f.max) && (!f.saved || Saved.has("homes", x.id)));
    const sorters = { new: (a, b) => (a.dom ?? 999) - (b.dom ?? 999), lo: (a, b) => a.price - b.price, hi: (a, b) => b.price - a.price, ppsf: (a, b) => (ppsf(a) ?? 1e9) - (ppsf(b) ?? 1e9) };
    rows.sort((a, b) => (a.sample - b.sample) || sorters[f.sort](a, b));
    const nReal = rows.filter((x) => !x.sample).length;
    document.getElementById("l-count").textContent = `${rows.length} home${rows.length === 1 ? "" : "s"}${nReal && nReal < rows.length ? ` (${nReal} real, ${rows.length - nReal} samples)` : nReal ? "" : " (all samples)"}`;
    list.innerHTML = rows.length ? rows.slice(0, showN).map(card).join("") : `<div class="panel empty">No homes match these filters.</div>`;
    document.getElementById("more").innerHTML = rows.length > showN ? `<button class="btn" type="button" id="more-btn">Show ${Math.min(24, rows.length - showN)} more of ${rows.length - showN}</button>` : "";
    // Links out for the cities shown
    const cities = [...new Map(rows.map((x) => [cityOf(x), x])).values()].slice(0, 12);
    const fallbacks = f.c === "ALL" ? [] : [];
    document.getElementById("links").innerHTML = (cities.length ? cities : fallbacks).map((x) => {
      const m = x.market && D.byId[x.market] || { name: x.city, region: x.region, c: x.c };
      return `<div class="panel re-link-card"><b>${FLAG[x.c]} ${esc(x.city)}, ${esc(x.region)}</b><div class="re-links">${searchLinks({ ...m, name: x.city }).map(([n, u]) => `<a class="btn small" href="${esc(u)}" target="_blank" rel="noopener">${esc(n)} ↗</a>`).join("")}</div></div>`;
    }).join("");
  }
  seg.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; f.c = b.dataset.c; f.city = ""; store.set("re-l-country", f.c); fillCities(); draw(); });
  citySel.addEventListener("change", () => { f.city = citySel.value; draw(); });
  document.getElementById("l-type").addEventListener("change", (e) => { f.type = e.target.value; draw(); });
  document.getElementById("l-beds").addEventListener("change", (e) => { f.beds = +e.target.value; draw(); });
  document.getElementById("l-max").addEventListener("input", (e) => { f.max = e.target.value ? +e.target.value : null; draw(); });
  document.getElementById("l-sort").addEventListener("change", (e) => { f.sort = e.target.value; draw(); });
  document.getElementById("l-saved").addEventListener("change", (e) => { f.saved = e.target.checked; draw(); });
  document.getElementById("more").addEventListener("click", (e) => { if (e.target.closest("#more-btn")) { showN += 24; draw(); } });
  document.querySelector(".re-filters").addEventListener("change", () => { showN = 24; }, true);
  fillCities();
  draw();

  // A simple drawn house in place of a photo (listing photos are licensed too)
  function houseArt(x) {
    let h = 0;
    for (const ch of String(x.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const hues = [210, 150, 30, 0, 260, 190, 340];
    const hue = hues[h % hues.length];
    const condo = x.type === "Condo" || x.type === "Apartment";
    const body = condo
      ? `<rect x="40" y="18" width="60" height="62" rx="2" fill="hsl(${hue} 30% 62%)"/>${[0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => `<rect x="${48 + c * 17}" y="${25 + r * 13}" width="10" height="8" rx="1" fill="hsl(${hue} 40% 92%)"/>`).join("")).join("")}`
      : `<path d="M30 46 70 18l40 28" fill="hsl(${hue} 35% 45%)"/><rect x="38" y="44" width="64" height="36" fill="hsl(${hue} 30% 66%)"/><rect x="62" y="56" width="14" height="24" rx="1" fill="hsl(${hue} 35% 35%)"/>
         <rect x="45" y="52" width="12" height="10" rx="1" fill="hsl(${hue} 40% 92%)"/><rect x="83" y="52" width="12" height="10" rx="1" fill="hsl(${hue} 40% 92%)"/>`;
    return `<svg viewBox="0 0 140 90" preserveAspectRatio="xMidYMid slice"><rect width="140" height="90" fill="hsl(${hue} 45% 88%)"/><rect y="78" width="140" height="12" fill="hsl(120 25% 70%)"/>${body}</svg>`;
  }
})();
