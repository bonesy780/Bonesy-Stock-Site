// World housing markets: top 10 with toggles, price chart, momentum-vs-peak map, year-by-year heat table, full table.
(async function () {
  const { esc, pct, fixed, spark, store, table, chart, since, rebase, flag } = RE;
  let D;
  try { D = await RE.data(); } catch { D = null; }
  const W = D && D.world;
  const topEl = document.getElementById("w-top");
  if (!W || !(W.countries || []).length) {
    topEl.innerHTML = `<div class="panel empty">World house prices haven't been built yet. They appear after the next data update.</div>`;
    return;
  }
  const ALL = W.countries.filter((c) => !c.agg);
  const bench = W.countries.find((c) => c.code === "XM");
  const byCode = Object.fromEntries(W.countries.map((c) => [c.code, c]));
  document.getElementById("w-count").textContent = ALL.length;

  // ---- ranking choices: [key, label, description, value, higher is better, format]
  const pctFmt = (v, nd = 1) => pct(v, nd);
  const RANKS = [
    ["score", "Investor score", "A 0 to 100 blend of real price momentum, 10-year growth, value, falling interest rates and a firming currency.", (c) => c.score, 1, (v) => `<span class="num">${v}</span><span class="muted re-small"> / 100</span>`],
    ["r1y", "Real growth, 1 year", "House price change over the past year after inflation.", (c) => c.r1y, 1, pctFmt],
    ["n1y", "Price growth, 1 year", "House price change over the past year, before inflation.", (c) => c.n1y, 1, pctFmt],
    ["usd1y", "Return in US$, 1 year", "Price change over the past year for a US-based investor, currency moves included.", (c) => c.usd1y, 1, pctFmt],
    ["usd5y", "Return in US$, 5 years", "Price change over five years in US dollars.", (c) => c.usd5y, 1, (v) => pct(v, 0)],
    ["r5y", "Real growth, 5 years", "Price change over five years after inflation.", (c) => c.r5y, 1, (v) => pct(v, 0)],
    ["rCagr10", "Real growth a year, 10 years", "Average yearly price growth after inflation over the past ten years.", (c) => c.rCagr10, 1, pctFmt],
    ["accel", "Speeding up", "How much faster prices rose this year than the year before (change in yearly growth, percentage points).", (c) => c.accel, 1, (v) => `<span class="num ${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(1)} pts</span>`],
    ["value", "Best value", "Lowest OECD price-to-income ratio against the country's own long-run average (100 = average): homes cheapest against what people earn.", (c) => c.pti, -1, (v) => `<span class="num">${v.toFixed(0)}</span><span class="muted re-small"> price/income (avg = 100)</span>`],
    ["dip", "Biggest dip from peak", "Real prices furthest below their all-time high: possible bargains, or markets still falling.", (c) => c.rOffPeak, -1, pctFmt],
    ["rate", "Rates falling most", "Biggest drop in the central bank rate over the past year.", (c) => c.rate1y, -1, (v) => `<span class="num ${v <= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(2)} pts</span>`],
    ["cool", "Falling fastest", "Biggest real price drops over the past year: markets to avoid, or to watch for a bottom.", (c) => c.r1y, -1, pctFmt],
  ];
  const REGIONS = ["World", "Americas", "Europe", "Asia-Pacific", "Middle East & Africa"];
  const S = {
    rank: store.get("w-rank", "score"), region: store.get("w-region", "World"), n: store.get("w-n", 10), stale: store.get("w-stale", false),
    kind: store.get("w-kind", "r"), range: store.get("w-range", 10), picked: null,
  };
  if (!RANKS.find((r) => r[0] === S.rank)) S.rank = "score";
  const rankSel = document.getElementById("w-rank"), regionSeg = document.getElementById("w-region"), nSeg = document.getElementById("w-n");
  rankSel.innerHTML = RANKS.map(([k, l]) => `<option value="${k}" ${k === S.rank ? "selected" : ""}>${esc(l)}</option>`).join("");
  document.getElementById("w-stale").checked = S.stale;

  const pool = () => ALL.filter((c) => (S.stale || !c.stale) && (S.region === "World" || c.region === S.region));
  const ranked = () => {
    const [, , , val, dir] = RANKS.find((r) => r[0] === S.rank);
    return pool().filter((c) => val(c) != null).sort((a, b) => (val(b) - val(a)) * dir);
  };
  const when = (q) => q ? q.replace("-", " ") : "";

  // ---- summary strip
  function summary() {
    const live = ALL.filter((c) => !c.stale);
    const r1 = live.map((c) => c.r1y).filter((v) => v != null).sort((a, b) => a - b);
    const n1 = live.map((c) => c.n1y).filter((v) => v != null).sort((a, b) => a - b);
    const med = (a) => a.length ? a[Math.floor(a.length / 2)] : null;
    const rising = live.filter((c) => (c.n1y ?? 0) > 0).length;
    const best = live.filter((c) => c.score != null).sort((a, b) => b.score - a.score)[0];
    const hot = live.filter((c) => c.r1y != null).sort((a, b) => b.r1y - a.r1y)[0];
    const items = [
      ["Typical country, 1 year", pct(med(n1)), "Middle of all countries with current data"],
      ["After inflation", pct(med(r1)), "Middle real change"],
      ["Prices rising in", `<span class="num">${rising}</span> <span class="muted">of ${live.length}</span>`, "Countries where prices are up on a year earlier"],
      best ? ["Top investor score", `${flag(best.code)} ${esc(best.name)} <span class="num muted">${best.score}</span>`, ""] : null,
      hot ? ["Hottest market", `${flag(hot.code)} ${esc(hot.name)} ${pct(hot.r1y)}`, "Biggest real price rise over the year"] : null,
      bench && bench.n1y != null ? ["Euro area", pct(bench.n1y), "Benchmark, before inflation"] : null,
    ].filter(Boolean);
    document.getElementById("w-summary").innerHTML = `<div class="re-rate-row">${items.map(([l, v, t]) =>
      `<div class="panel re-rate" title="${esc(t)}"><span class="label">${l}</span><b>${v}</b></div>`).join("")}</div>`;
  }

  // ---- top cards
  function drawTop() {
    regionSeg.innerHTML = REGIONS.map((r) => `<button role="tab" aria-selected="${r === S.region}" data-r="${esc(r)}">${esc(r)}</button>`).join("");
    nSeg.innerHTML = [[10, "Top 10"], [20, "Top 20"], [999, "All"]].map(([v, l]) => `<button role="tab" aria-selected="${v === S.n}" data-n="${v}">${l}</button>`).join("");
    const [, label, desc, val, , fmt] = RANKS.find((r) => r[0] === S.rank);
    document.getElementById("w-rank-desc").textContent = desc;
    const rows = ranked().slice(0, S.n);
    topEl.innerHTML = rows.length ? rows.map((c, i) => `
      <article class="panel w-card" data-code="${c.code}">
        <div class="w-card-top"><span class="w-rank">${i + 1}</span><span class="w-flag" aria-hidden="true">${flag(c.code)}</span>
          <div class="w-name"><b>${esc(c.name)}</b><span class="muted re-small">${esc(c.region)} · ${esc(when(c.asof))}${c.stale ? " · old data" : ""}</span></div></div>
        <div class="w-metric-row"><div class="w-metric"><span class="muted re-small">${esc(label)}</span><span class="w-big">${fmt(val(c))}</span></div>${spark(c.spark, 90, 34)}</div>
        <div class="w-facts">
          <span title="Price change over a year">1 yr ${pct(c.n1y)}</span>
          <span title="After inflation">Real ${pct(c.r1y)}</span>
          <span title="In US dollars">US$ ${pct(c.usd1y)}</span>
          ${c.rate != null ? `<span title="Central bank rate">Rate <b class="num">${c.rate.toFixed(2)}%</b></span>` : ""}
        </div>
        ${c.score != null ? `<div class="w-score" title="Investor score"><i style="width:${c.score}%"></i></div>` : ""}
        <div class="tags">${(c.why || []).map((w) => `<span class="tag w-good">${esc(w)}</span>`).join("")}${(c.watch || []).map((w) => `<span class="tag w-bad">${esc(w)}</span>`).join("")}</div>
        <button class="btn small w-add" type="button" data-add="${c.code}">${S.picked && S.picked.includes(c.code) ? "On the chart" : "Add to chart"}</button>
      </article>`).join("") : `<div class="panel empty">No countries with this figure${S.region !== "World" ? " in " + esc(S.region) : ""}.</div>`;
    drawHeat();
  }

  // ---- chart
  const COLORS = ["var(--cmp-1)", "var(--cmp-2)", "var(--cmp-3)", "var(--cmp-4)", "var(--cmp-5)", "var(--cmp-6)", "var(--cmp-7)"];
  let H = null;
  if (!S.picked) {
    const saved = store.get("w-picked", null);
    S.picked = Array.isArray(saved) && saved.length ? saved.filter((c) => byCode[c]) : [...ALL.filter((c) => !c.stale && c.score != null).sort((a, b) => b.score - a.score).slice(0, 4).map((c) => c.code)];
    if (!saved && !S.picked.includes("US") && byCode.US) S.picked.push("US");
  }
  const kindSeg = document.getElementById("w-kind"), rangeSeg = document.getElementById("w-range"), chips = document.getElementById("w-chips");
  async function drawChart() {
    kindSeg.innerHTML = [["n", "Price"], ["r", "After inflation"], ["u", "In US dollars"]].map(([v, l]) => `<button role="tab" aria-selected="${v === S.kind}" data-k="${v}">${l}</button>`).join("");
    rangeSeg.innerHTML = [[5, "5 years"], [10, "10 years"], [20, "20 years"]].map(([v, l]) => `<button role="tab" aria-selected="${v === S.range}" data-r="${v}">${l}</button>`).join("");
    const opts = ALL.filter((c) => !S.picked.includes(c.code)).sort((a, b) => a.name.localeCompare(b.name));
    chips.innerHTML = S.picked.map((code, i) => `<span class="chip"><i class="dot" style="background:${COLORS[i % COLORS.length]}"></i>${flag(code)} ${esc((byCode[code] || {}).name || code)}<button class="x" type="button" data-rm="${code}" aria-label="Remove ${esc((byCode[code] || {}).name || code)}">✕</button></span>`).join("")
      + (S.picked.length < 7 ? `<select class="field w-add-sel" id="w-add" aria-label="Add a country"><option value="">+ Add a country</option>${opts.map((c) => `<option value="${c.code}">${esc(c.name)}</option>`).join("")}${bench && !S.picked.includes("XM") ? `<option value="XM">Euro area (benchmark)</option>` : ""}</select>` : "");
    const box = document.getElementById("w-chart");
    try { H ||= await RE.load("world_hist.json"); } catch { box.innerHTML = `<div class="empty">No history yet.</div>`; return; }
    const series = S.picked.map((code, i) => ({ name: (byCode[code] || {}).name || code, color: COLORS[i % COLORS.length], pts: rebase(since((H[code] || {})[S.kind] || [], S.range)) }));
    chart(box, series, { fmt: (v) => v.toFixed(0), base: 100, label: "House prices rebased to 100" });
  }
  function setPicked(p) { S.picked = p; store.set("w-picked", p); drawChart(); drawTop(); drawScatter(); }

  // ---- momentum vs peak map
  const REGION_COLOR = { Americas: "var(--cmp-2)", Europe: "var(--cmp-1)", "Asia-Pacific": "var(--cmp-4)", "Middle East & Africa": "var(--cmp-3)" };
  function drawScatter() {
    const el = document.getElementById("w-scatter");
    const pts = pool().filter((c) => c.r1y != null && c.rOffPeak != null);
    if (pts.length < 3) { el.innerHTML = `<div class="empty">Not enough countries with real price data here.</div>`; return; }
    const Wd = Math.max(300, Math.round(el.clientWidth || 760)), Ht = Wd < 500 ? 320 : 420, L = 44, R = 14, T = 14, B = 36;
    const xs = pts.map((c) => c.r1y), ys = pts.map((c) => c.rOffPeak);
    const x0 = Math.min(-2, ...xs) - 1, x1 = Math.max(2, ...xs) + 1, y0 = Math.min(...ys) - 3, y1 = 3;
    const x = (v) => L + (v - x0) / (x1 - x0) * (Wd - L - R), y = (v) => T + (y1 - v) / (y1 - y0) * (Ht - T - B);
    const step = (span) => span > 60 ? 20 : span > 25 ? 10 : 5;
    const xt = [], yt = [];
    for (let v = Math.ceil(x0 / step(x1 - x0)) * step(x1 - x0); v <= x1; v += step(x1 - x0)) xt.push(v);
    for (let v = Math.ceil(y0 / step(y1 - y0)) * step(y1 - y0); v <= y1; v += step(y1 - y0)) yt.push(v);
    const midY = Math.max(y0, -15);
    const placed = [];
    const q = (txt, px, py, anchor) => `<text class="w-quad" x="${px}" y="${py}" text-anchor="${anchor}">${esc(txt)}</text>`;
    el.innerHTML = `<svg viewBox="0 0 ${Wd} ${Ht}" class="w-scatter" role="img" aria-label="Real price change over a year against distance from the real peak, by country">
      <rect x="${x(0)}" y="${y(midY)}" width="${Wd - R - x(0)}" height="${Ht - B - y(midY)}" class="w-sweet"/>
      ${xt.map((v) => `<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${Ht - B}"/><text class="axis" x="${x(v)}" y="${Ht - B + 16}" text-anchor="middle">${v > 0 ? "+" : ""}${v}%</text>`).join("")}
      ${yt.map((v) => `<line class="grid" x1="${L}" x2="${Wd - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`).join("")}
      <line class="base" x1="${x(0)}" x2="${x(0)}" y1="${T}" y2="${Ht - B}"/>
      <text class="axis" x="${(L + Wd - R) / 2}" y="${Ht - 4}" text-anchor="middle">Real price change, 1 year →</text>
      ${Wd >= 560 ? q("Falling, well below peak", L + 6, Ht - B - 8, "start") + q("Rising, room to recover", Wd - R - 6, Ht - B - 8, "end") : ""}
      ${pts.slice().sort((a, b) => (S.picked.includes(b.code) - S.picked.includes(a.code)) || ((b.score ?? -1) - (a.score ?? -1))).map((c) => {
        const on = S.picked.includes(c.code);
        // Label a dot only if no label is already close by (the name is always in the tooltip)
        const lx = x(c.r1y) + 8, ly = y(c.rOffPeak) + 4;
        const free = !placed.some(([px, py]) => Math.abs(px - lx) < 24 && Math.abs(py - ly) < 11);
        if (free) placed.push([lx, ly]);
        return `<g class="w-dot${on ? " on" : ""}" data-add="${c.code}" tabindex="0" role="button" aria-label="${esc(c.name)}: ${c.r1y.toFixed(1)}% real change, ${c.rOffPeak.toFixed(0)}% from peak">
          <title>${esc(c.name)}: real price change ${c.r1y >= 0 ? "+" : ""}${c.r1y.toFixed(1)}% over a year, ${c.rOffPeak.toFixed(0)}% from its real peak${c.score != null ? `, investor score ${c.score}` : ""}</title>
          <circle cx="${x(c.r1y)}" cy="${y(c.rOffPeak)}" r="${on ? 7 : 5}" fill="${REGION_COLOR[c.region] || "var(--muted)"}"/>
          ${free ? `<text x="${lx}" y="${ly}" class="w-lab">${esc(c.code)}</text>` : ""}</g>`;
      }).join("")}
    </svg>
    <div class="legend">${Object.entries(REGION_COLOR).map(([r, col]) => `<span class="leg"><i style="background:${col}"></i>${esc(r)}</span>`).join("")}<span class="leg muted">↑ real price vs its all-time high (0% = at the peak)</span></div>`;
  }

  // ---- year-by-year heat table (countries in the current ranking)
  function drawHeat() {
    const el = document.getElementById("w-heat");
    const rows = ranked().slice(0, Math.min(S.n, 30));
    const years = [...new Set(rows.flatMap((c) => Object.keys(c.years || {})))].sort().slice(-10);
    if (!rows.length || !years.length) { el.innerHTML = `<div class="empty">No yearly figures for these countries.</div>`; return; }
    const cell = (v) => {
      if (v == null) return `<td class="w-heat-cell">–</td>`;
      const a = Math.min(1, Math.abs(v) / 15);
      const bg = `color-mix(in srgb, ${v >= 0 ? "var(--up)" : "var(--down)"} ${Math.round(12 + a * 58)}%, transparent)`;
      const r = Math.round(v);
      return `<td class="w-heat-cell num" style="background:${bg}">${r > 0 ? "+" : ""}${r === 0 ? "0" : r}</td>`;
    };
    const thisYear = years.at(-1);
    el.innerHTML = `<table class="grid-table w-heat"><thead><tr><th class="left">Country</th>${years.map((y) => `<th>${y === thisYear ? y + "*" : y}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((c) => `<tr><td class="left"><span class="w-heat-name">${flag(c.code)} ${esc(c.name)}</span>${c.yearsReal ? "" : ` <span class="muted re-small" title="No real index for this country">(price)</span>`}</td>${years.map((y) => cell((c.years || {})[y])).join("")}</tr>`).join("")}</tbody></table>
      <p class="muted re-small pad-h">% change in each calendar year (last quarter on last quarter), after inflation. *${esc(thisYear)} runs to the latest quarter published.</p>`;
  }

  // ---- full table
  const tstate = { key: "score", dir: -1 };
  const tcols = [
    { key: "name", label: "Country", left: true, sm: true, val: (c) => c.name, html: (c) => `<span class="co"><span class="nm">${flag(c.code)} ${esc(c.name)}</span><span class="tk">${esc(c.region)} · ${esc(when(c.asof))}${c.stale ? " · old data" : ""}${c.note ? ` · <span title="${esc(c.note)}">not scored ⓘ</span>` : ""}</span></span>` },
    { key: "score", label: "Score", sm: true, val: (c) => c.score, html: (c) => c.score != null ? `<span class="num">${c.score}</span>` : "–" },
    { key: "n1y", label: "1 year", sm: true, val: (c) => c.n1y, html: (c) => pct(c.n1y) },
    { key: "r1y", label: "Real 1 yr", val: (c) => c.r1y, html: (c) => pct(c.r1y) },
    { key: "usd1y", label: "US$ 1 yr", val: (c) => c.usd1y, html: (c) => pct(c.usd1y) },
    { key: "n5y", label: "5 years", val: (c) => c.n5y, html: (c) => pct(c.n5y, 0) },
    { key: "usd5y", label: "US$ 5 yrs", val: (c) => c.usd5y, html: (c) => pct(c.usd5y, 0) },
    { key: "rCagr10", label: "Real a year, 10 yrs", val: (c) => c.rCagr10, html: (c) => pct(c.rCagr10) },
    { key: "rOffPeak", label: "Real vs peak", val: (c) => c.rOffPeak, html: (c) => pct(c.rOffPeak, 0) },
    { key: "pti", label: "Price/income", title: "OECD price-to-income ratio against the country's long-run average (100 = average)", val: (c) => c.pti, html: (c) => `<span class="num">${fixed(c.pti, 0)}</span>` },
    { key: "rate", label: "Rate", val: (c) => c.rate, html: (c) => `<span class="num">${fixed(c.rate, 2, "%")}</span>` },
    { key: "fx1y", label: "Currency vs US$", val: (c) => c.fx1y, html: (c) => pct(c.fx1y) },
    { key: "spark", label: "5 years", html: (c) => spark(c.spark) },
  ];
  const q = document.getElementById("w-q");
  const drawTable = () => {
    const t = q.value.trim().toLowerCase();
    const rows = W.countries.filter((c) => !t || c.name.toLowerCase().includes(t) || c.region.toLowerCase().includes(t) || c.code.toLowerCase() === t);
    table(document.getElementById("w-table"), tcols, rows, tstate, { empty: "No countries match." });
  };
  q.addEventListener("input", drawTable);

  // ---- events
  rankSel.addEventListener("change", () => { S.rank = rankSel.value; store.set("w-rank", S.rank); drawTop(); });
  regionSeg.addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (!b) return; S.region = b.dataset.r; store.set("w-region", S.region); drawTop(); drawScatter(); });
  nSeg.addEventListener("click", (e) => { const b = e.target.closest("[data-n]"); if (!b) return; S.n = +b.dataset.n; store.set("w-n", S.n); drawTop(); });
  document.getElementById("w-stale").addEventListener("change", (e) => { S.stale = e.target.checked; store.set("w-stale", S.stale); drawTop(); drawScatter(); });
  kindSeg.addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (!b) return; S.kind = b.dataset.k; store.set("w-kind", S.kind); drawChart(); });
  rangeSeg.addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (!b) return; S.range = +b.dataset.r; store.set("w-range", S.range); drawChart(); });
  chips.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) setPicked(S.picked.filter((c) => c !== b.dataset.rm)); });
  chips.addEventListener("change", (e) => { if (e.target.id === "w-add" && e.target.value) setPicked([...S.picked, e.target.value]); });
  const toggle = (code) => setPicked(S.picked.includes(code) ? S.picked.filter((c) => c !== code) : [...S.picked, code].slice(-7));
  topEl.addEventListener("click", (e) => { const b = e.target.closest("[data-add]"); if (b) toggle(b.dataset.add); });
  const sc = document.getElementById("w-scatter");
  sc.addEventListener("click", (e) => { const g = e.target.closest("[data-add]"); if (g) toggle(g.dataset.add); });
  sc.addEventListener("keydown", (e) => { const g = e.target.closest("[data-add]"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(g.dataset.add); } });
  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { drawChart(); drawScatter(); }, 200); });

  summary();
  drawTop();
  drawChart();
  drawScatter();
  drawTable();
})();
