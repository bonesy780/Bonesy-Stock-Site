// All markets: one sortable, filterable table with CSV download.
(async function () {
  const { esc, short, money, pct, fixed, int, spark, marketUrl, place, sideCls, star, table, store, Saved, COUNTRY, FLAG } = RE;
  const el = document.getElementById("all");
  let D;
  try { D = await RE.data(); } catch { el.innerHTML = `<div class="empty">The real estate data hasn't been built yet.</div>`; return; }
  const params = new URLSearchParams(location.search);
  const f = { c: params.get("c") || store.get("re-all-country", "US"), region: params.get("region") || "", max: null, yld: null, side: "", saved: false };
  const state = store.get("re-all-sort", { key: "rank", dir: 1 });
  const rows = D.markets.filter((m) => !["us", "ca", "mx"].includes(m.id));
  const seg = document.getElementById("f-country");
  const colsFor = (c) => {
    const base = [
      { key: "save", label: "", html: (m) => star("markets", m.id), sm: true },
      { key: "name", label: c === "MX" ? "State" : c === "CA" ? "City" : "Market", left: true, sm: true, val: (m) => m.name,
        html: (m) => `<a class="co" href="${marketUrl(m.id)}"><span class="nm">${esc(m.name)}</span><span class="tk">${esc(c === "ALL" ? FLAG[m.c] + " " + place(m) : place(m))}</span></a>` },
    ];
    if (c === "US") return [...base,
      { key: "rank", label: "Size", title: "Rank by population", val: (m) => m.rank, html: (m) => `<span class="num">${m.rank}</span>` },
      { key: "v", label: "Typical value", val: (m) => m.v, html: (m) => `<span class="num">${short(m.v)}</span>`, sm: true },
      { key: "v1y", label: "1 yr", val: (m) => m.v1y, html: (m) => pct(m.v1y), sm: true },
      { key: "v5y", label: "5 yr", val: (m) => m.v5y, html: (m) => pct(m.v5y, 0) },
      { key: "rent", label: "Rent", val: (m) => m.rent, html: (m) => `<span class="num">${m.rent ? money(m.rent) : "–"}</span>` },
      { key: "yield", label: "Yield", val: (m) => m.yield, html: (m) => `<span class="num">${fixed(m.yield, 1, "%")}</span>` },
      { key: "inv1y", label: "For sale y/y", val: (m) => m.inv1y, html: (m) => pct(m.inv1y, 0) },
      { key: "dtp", label: "Days to pending", val: (m) => m.dtp, html: (m) => `<span class="num">${int(m.dtp)}</span>` },
      { key: "cut", label: "Price cuts", val: (m) => m.cut, html: (m) => `<span class="num">${fixed(m.cut, 0, "%")}</span>` },
      { key: "fc", label: "Forecast", title: "Zillow 12-month forecast", val: (m) => m.fc, html: (m) => pct(m.fc) },
      { key: "score", label: "Market", title: "−100 buyer's market to +100 seller's market", val: (m) => m.score, html: (m) => m.side ? `<span class="pill ${sideCls(m.side)}">${esc(m.side)}</span>` : "–" },
      { key: "spark", label: "2 years", html: (m) => spark(m.spark) },
    ];
    if (c === "CA") return [...base,
      { key: "region", label: "Province", val: (m) => m.region, html: (m) => esc(m.region) },
      { key: "idx", label: "Index", val: (m) => m.idx, html: (m) => `<span class="num">${fixed(m.idx, 1)}</span>`, sm: true },
      { key: "v1y", label: "1 yr", val: (m) => m.v1y, html: (m) => pct(m.v1y), sm: true },
      { key: "v5y", label: "5 yr", val: (m) => m.v5y, html: (m) => pct(m.v5y, 0) },
      { key: "offPeak", label: "From peak", val: (m) => m.offPeak, html: (m) => pct(m.offPeak) },
      { key: "rent", label: "2-bed rent", val: (m) => m.rent, html: (m) => `<span class="num">${m.rent ? money(m.rent, "CAD") : "–"}</span>` },
      { key: "rent1y", label: "Rent y/y", val: (m) => m.rent1y, html: (m) => pct(m.rent1y) },
      { key: "spark", label: "2 years", html: (m) => spark(m.spark) },
    ];
    if (c === "MX") return [...base,
      { key: "v", label: "Average", val: (m) => m.v, html: (m) => `<span class="num">${short(m.v, "MXN")}</span>`, sm: true },
      { key: "usd", label: "In US$", val: (m) => m.usd, html: (m) => `<span class="num">${short(m.usd)}</span>` },
      { key: "median", label: "Middle", val: (m) => m.median, html: (m) => `<span class="num">${short(m.median, "MXN")}</span>`, sm: true },
      { key: "q1", label: "Lower quarter", val: (m) => m.q1, html: (m) => `<span class="num">${short(m.q1, "MXN")}</span>` },
      { key: "q3", label: "Upper quarter", val: (m) => m.q3, html: (m) => `<span class="num">${short(m.q3, "MXN")}</span>` },
      { key: "v1y", label: "1 yr", val: (m) => m.v1y, html: (m) => pct(m.v1y) },
    ];
    return [...base,
      { key: "c", label: "Country", val: (m) => m.c, html: (m) => FLAG[m.c] + " " + m.c },
      { key: "usd", label: "Price in US$", title: "Typical (US) or average (Mexico) price in US dollars. Canada's figure is an index, so it has none.", val: (m) => m.usd, html: (m) => `<span class="num">${short(m.usd)}</span>`, sm: true },
      { key: "v1y", label: "1 yr", val: (m) => m.v1y, html: (m) => pct(m.v1y), sm: true },
      { key: "v5y", label: "5 yr", val: (m) => m.v5y, html: (m) => pct(m.v5y, 0) },
      { key: "rentUsd", label: "Rent in US$", val: (m) => m.rentUsd, html: (m) => `<span class="num">${m.rentUsd ? money(m.rentUsd) : "–"}</span>` },
    ];
  };
  const regionSel = document.getElementById("f-region");
  const fillRegions = () => {
    const regs = [...new Set(rows.filter((m) => f.c === "ALL" || m.c === f.c).map((m) => m.c === "US" ? (m.region || "").split("-")[0] : m.c === "CA" ? m.region : m.name))].filter(Boolean).sort();
    regionSel.innerHTML = `<option value="">All</option>` + regs.map((r) => `<option ${r === f.region ? "selected" : ""}>${esc(r)}</option>`).join("");
    regionSel.parentElement.firstChild.textContent = f.c === "CA" ? "Province " : f.c === "MX" ? "State " : "State or province ";
  };
  const shown = () => rows.filter((m) => (f.c === "ALL" || m.c === f.c)
    && (!f.region || (m.c === "US" ? (m.region || "").split("-").includes(f.region) : m.c === "CA" ? m.region === f.region : m.name === f.region))
    && (f.max == null || (m.usd != null && m.usd <= f.max))
    && (f.yld == null || (m.yield != null && m.yield >= f.yld))
    && (!f.side || m.side === f.side)
    && (!f.saved || Saved.has("markets", m.id)));
  function draw() {
    seg.innerHTML = [["US", "🇺🇸 US"], ["CA", "🇨🇦 Canada"], ["MX", "🇲🇽 Mexico"], ["ALL", "All"]].map(([c, l]) => `<button role="tab" aria-selected="${c === f.c}" data-c="${c}">${l}</button>`).join("");
    document.getElementById("f-yield").parentElement.hidden = f.c !== "US";
    document.getElementById("f-side").parentElement.hidden = f.c !== "US";
    const cols = colsFor(f.c);
    if (!cols.find((c) => c.key === state.key && c.val)) { state.key = cols.find((c) => c.key === "rank" || c.key === "v" || c.key === "idx").key; state.dir = state.key === "rank" ? 1 : -1; }
    const list = shown();
    document.getElementById("count").textContent = `${list.length} market${list.length === 1 ? "" : "s"}`;
    table(el, cols, list, state, { empty: "No markets match these filters.", onSort: (s) => store.set("re-all-sort", s) });
  }
  seg.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; f.c = b.dataset.c; f.region = ""; store.set("re-all-country", f.c); fillRegions(); draw(); });
  regionSel.addEventListener("change", () => { f.region = regionSel.value; draw(); });
  document.getElementById("f-max").addEventListener("input", (e) => { f.max = e.target.value ? +e.target.value : null; draw(); });
  document.getElementById("f-yield").addEventListener("input", (e) => { f.yld = e.target.value ? +e.target.value : null; draw(); });
  document.getElementById("f-side").addEventListener("change", (e) => { f.side = e.target.value; draw(); });
  document.getElementById("f-saved").addEventListener("change", (e) => { f.saved = e.target.checked; draw(); });
  document.getElementById("csv").addEventListener("click", () => {
    const keys = ["id", "c", "name", "region", "cur", "asof", "v", "idx", "usd", "v1m", "v3m", "v1y", "v5y", "v10y", "rent", "rent1y", "yield", "inv", "inv1y", "newl", "mlp", "msp", "dtp", "cut", "stl", "heat", "fc", "score", "side", "median", "q1", "q3"];
    const q = (v) => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const csv = [keys.join(","), ...shown().map((m) => keys.map((k) => q(typeof m[k] === "number" ? +m[k].toFixed(4) : m[k])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `housing-markets-${f.c.toLowerCase()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  fillRegions();
  draw();
})();
