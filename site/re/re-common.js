// Shared by the real estate pages: menu, market search, number formats,
// a sortable table, a line chart and saved homes (kept in this browser).
(function () {
  const PAGES = [
    ["./", "Overview", ["index.html", ""]],
    ["world.html", "World"],
    ["markets.html", "All Markets"],
    ["market.html", "Market Lookup"],
    ["listings.html", "Listings"],
    ["compare.html", "Compare"],
    ["tools.html", "Mortgage Tools"],
    ["news.html", "News"],
  ];
  const COUNTRY = { US: "United States", CA: "Canada", MX: "Mexico" };
  // Full state and province names, so a search for "Hawaii" or "Ontario" finds markets listed as HI or ON
  const REGION_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
    DE: "Delaware", DC: "District of Columbia Washington DC", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
    IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
    MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
    NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
    WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico" };
  const PROVINCE_NAMES = { NL: "Newfoundland and Labrador", PE: "Prince Edward Island", NS: "Nova Scotia", NB: "New Brunswick", QC: "Quebec",
    ON: "Ontario", MB: "Manitoba", SK: "Saskatchewan", AB: "Alberta", BC: "British Columbia", YT: "Yukon", NT: "Northwest Territories", NU: "Nunavut" };
  const regionName = (m) => String(m.region || "").split("-").map((r) => (m.c === "CA" ? PROVINCE_NAMES : m.c === "US" ? REGION_NAMES : {})[r] || "").join(" ");
  const FLAG = { US: "🇺🇸", CA: "🇨🇦", MX: "🇲🇽" };
  // Any country's flag from its two-letter code; the euro area gets the EU flag
  const flag = (c) => c === "XM" ? "🇪🇺" : /^[A-Z]{2}$/.test(c || "") ? String.fromCodePoint(...[...c].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) : "🌐";
  const SYM = { USD: "$", CAD: "C$", MXN: "MX$" };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Whole-currency amounts: $412,000 or MX$4,285,135
  const money = (v, cur = "USD") => v == null ? "–" : (SYM[cur] || "") + Math.round(v).toLocaleString("en-US");
  // Short form: $412K, C$1.05M
  const short = (v, cur = "USD") => {
    if (v == null) return "–";
    const a = Math.abs(v), s = SYM[cur] || "";
    if (a >= 1e6) return s + (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
    if (a >= 1e3) return s + Math.round(v / 1e3) + "K";
    return s + Math.round(v);
  };
  const pct = (v, nd = 1) => {
    if (v == null) return '<span class="num">–</span>';
    if (Math.abs(v) < 0.5 / 10 ** nd) v = 0;
    return `<span class="num ${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(nd)}%</span>`;
  };
  const fixed = (v, nd = 1, unit = "") => v == null ? "–" : v.toFixed(nd) + unit;
  const int = (v) => v == null ? "–" : Math.round(v).toLocaleString("en-US");
  const spark = (pts, w = 96, h = 28) => {
    pts = (pts || []).filter((p) => p != null);
    if (pts.length < 2) return "";
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
    const d = pts.map((p, i) => `${(i / (pts.length - 1) * w).toFixed(1)},${(h - 2 - (p - lo) / span * (h - 4)).toFixed(1)}`).join(" ");
    const color = pts[pts.length - 1] >= pts[0] ? "var(--up)" : "var(--down)";
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.6" points="${d}"/></svg>`;
  };
  const store = {
    get(k, fallback) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const cache = {};
  const load = (file) => (cache[file] ||= fetch(file, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(file + " " + r.status);
    return r.json();
  }));
  const marketUrl = (id) => "market.html?id=" + encodeURIComponent(id);
  const place = (m) => m.c === "US" ? (m.region ? `${m.region} · United States` : "United States")
    : m.c === "CA" ? (m.region ? `${m.region} · Canada` : "Canada") : (m.id === "mx" ? "Mexico" : `State · Mexico`);

  let dataP = null;
  // data.json with a lookup by id, plus each market's price in US dollars for side-by-side comparisons
  function data() {
    return dataP ||= load("data.json").then((d) => {
      const byId = {};
      for (const m of d.markets) {
        byId[m.id] = m;
        const fx = d.fx && d.fx[m.cur];
        m.usd = m.v != null && fx ? m.v / fx : null;
        m.rentUsd = m.rent != null && fx ? m.rent / fx : null;
      }
      return { ...d, byId };
    });
  }
  // The headline price for any market: typical value (US), index (Canada new homes) or average price (Mexico)
  const headline = (m) => m.c === "CA" ? { label: "New home price index", html: `<span class="num">${fixed(m.idx, 1)}</span>`, note: "Dec 2016 = 100" }
    : m.c === "MX" ? { label: "Average home price", html: `<span class="num">${short(m.v, m.cur)}</span>` }
    : { label: "Typical home value", html: `<span class="num">${short(m.v, m.cur)}</span>` };
  const sideCls = (s) => !s ? "" : s.includes("Seller") || s.includes("seller") ? "sell" : s.includes("uyer") ? "buy" : "";

  // ---- saved markets and homes, in this browser
  const SKEY = "re-saved";
  const Saved = {
    all() { const v = store.get(SKEY, null); return v && Array.isArray(v.markets) ? v : { markets: [], homes: [] }; },
    has(kind, id) { return this.all()[kind].includes(id); },
    toggle(kind, id) {
      const v = this.all(), i = v[kind].indexOf(id);
      if (i >= 0) v[kind].splice(i, 1); else v[kind].push(id);
      store.set(SKEY, v);
      window.dispatchEvent(new CustomEvent("re-saved"));
      return i < 0;
    },
  };
  const star = (kind, id) => {
    const on = Saved.has(kind, id);
    return `<button class="star" data-save="${kind}" data-id="${esc(id)}" aria-pressed="${on}" title="${on ? "Remove from" : "Save to"} your list">${on ? "★" : "☆"}</button>`;
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-save]");
    if (!b) return;
    e.preventDefault();
    const on = Saved.toggle(b.dataset.save, b.dataset.id);
    for (const x of document.querySelectorAll(`[data-save="${b.dataset.save}"][data-id="${CSS.escape(b.dataset.id)}"]`)) {
      x.setAttribute("aria-pressed", String(on)); x.textContent = on ? "★" : "☆";
    }
  });

  // ---- market search
  const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\w ]/g, "");
  async function search(text, n = 8) {
    const t = norm(text.trim());
    if (!t) return [];
    const d = await data();
    const scored = [];
    for (const m of d.markets) {
      const nm = norm(m.name), full = norm(m.full + " " + (m.region || "") + " " + regionName(m) + " " + COUNTRY[m.c]);
      const s = nm === t ? 0 : nm.startsWith(t) ? 1 : nm.split(" ").some((w) => w.startsWith(t)) ? 2 : norm(regionName(m)).split(" ").includes(t) || norm(regionName(m)) === t ? 3 : full.includes(t) ? 4 : -1;
      if (s >= 0) scored.push([s, m.rank || 999, m]);
    }
    return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, n).map((x) => x[2]);
  }
  function picker(input, onPick) {
    const wrap = input.parentElement;
    const list = document.createElement("ul");
    list.className = "panel results";
    list.setAttribute("role", "listbox");
    list.id = input.id + "-results";
    list.hidden = true;
    wrap.appendChild(list);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "false");
    input.autocomplete = "off";
    let matches = [], active = -1, seq = 0;
    const show = () => {
      list.hidden = !matches.length;
      input.setAttribute("aria-expanded", String(matches.length > 0));
      list.innerHTML = matches.map((m, n) => `<li role="option" id="${list.id}-${n}" aria-selected="${n === active}" data-n="${n}">
        <span class="nm">${FLAG[m.c]} ${esc(m.name)}</span><span class="tk">${esc(place(m))}</span></li>`).join("");
      if (active >= 0) input.setAttribute("aria-activedescendant", `${list.id}-${active}`); else input.removeAttribute("aria-activedescendant");
    };
    const choose = (m) => { matches = []; show(); input.value = ""; onPick(m); };
    input.addEventListener("input", async () => {
      const mine = ++seq;
      const m = await search(input.value).catch(() => []);
      if (mine !== seq) return;
      matches = m; active = m.length ? 0 : -1; show();
    });
    input.addEventListener("keydown", (e) => {
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && matches.length) {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
        show();
      } else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(matches[active]); }
      else if (e.key === "Escape") { matches = []; show(); }
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li");
      if (li) { e.preventDefault(); choose(matches[+li.dataset.n]); }
    });
    input.addEventListener("blur", () => setTimeout(() => { matches = []; show(); }, 100));
  }

  // ---- sortable table (same shape as the stock pages' UI.table)
  function table(el, cols, rows, state, opts = {}) {
    const col = cols.find((c) => c.key === state.key);
    if (col && col.val) {
      rows = rows.slice().sort((a, b) => {
        const x = col.val(a), y = col.val(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "string" ? x.localeCompare(y) : x - y) * state.dir;
      });
    }
    const shown = opts.limit ? rows.slice(0, opts.limit) : rows;
    el.innerHTML = shown.length ? `<table class="grid-table ${opts.cls || ""}">
      <thead><tr>${cols.map((c) => {
        const sorted = c.key === state.key;
        const aria = sorted ? (state.dir > 0 ? "ascending" : "descending") : "none";
        return `<th class="${c.left ? "left" : ""}${c.sm ? "" : " hide-sm"}" ${c.val ? `aria-sort="${aria}"` : ""}>${c.val
          ? `<button class="sort" data-k="${c.key}" title="${esc(c.title || "Sort by " + c.label)}">${esc(c.label)}<i aria-hidden="true">${sorted ? (state.dir > 0 ? "▲" : "▼") : ""}</i></button>`
          : esc(c.label)}</th>`;
      }).join("")}</tr></thead>
      <tbody>${shown.map((r, i) => `<tr>${cols.map((c) => `<td class="${c.left ? "left" : ""}${c.sm ? "" : " hide-sm"}">${c.html(r, i)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>` : `<div class="empty">${opts.empty || "Nothing to show."}</div>`;
    el.onclick = (e) => {
      const b = e.target.closest("button.sort");
      if (!b) return;
      const c = cols.find((x) => x.key === b.dataset.k);
      if (state.key === c.key) state.dir = -state.dir;
      else { state.key = c.key; state.dir = typeof c.val(rows[0] || {}) === "string" ? 1 : -1; }
      if (opts.onSort) opts.onSort(state);
      table(el, cols, rows, state, opts);
      const again = el.querySelector(`button.sort[data-k="${c.key}"]`);
      if (again) again.focus();
    };
    return rows;
  }

  // ---- line chart: series [{ name, color, pts: [[label "YYYY-MM", value]] }]
  // opts: { height, fmt(v), pctAxis, area }
  function chart(el, series, opts = {}) {
    series = series.filter((s) => s.pts && s.pts.length > 1);
    if (!series.length) { el.innerHTML = `<div class="empty">No history to chart yet.</div>`; return; }
    // Draw at the box's real width so the axis text stays at its normal size
    const W = Math.max(300, Math.round(el.clientWidth || 760)), H = opts.height || (W < 500 ? 220 : 300), L = 8, R = 62, T = 12, B = 26;
    const labels = [...new Set(series.flatMap((s) => s.pts.map((p) => p[0])))].sort();
    const xi = Object.fromEntries(labels.map((l, i) => [l, i]));
    const vals = series.flatMap((s) => s.pts.map((p) => p[1])).filter((v) => v != null);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (opts.zero) lo = Math.min(lo, 0);
    const pad = (hi - lo) * 0.06 || 1;
    lo -= pad; hi += pad;
    const x = (i) => L + (labels.length < 2 ? 0 : i / (labels.length - 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const fmt = opts.fmt || ((v) => v.toFixed(1));
    const ticks = [];
    const step = niceStep((hi - lo) / 4);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    const years = labels.filter((l, i) => i === 0 || l.slice(0, 4) !== labels[i - 1].slice(0, 4));
    const every = Math.max(1, Math.ceil(years.length / Math.max(3, Math.floor(W / 90))));
    const xt = [];
    for (const l of years.filter((_, i) => i % every === 0)) if (!xt.length || x(xi[l]) - x(xi[xt.at(-1)]) > 44) xt.push(l);
    const path = (s) => s.pts.filter((p) => p[1] != null).map((p, i) => `${i ? "L" : "M"}${x(xi[p[0]]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    el.innerHTML = `<div class="chart re-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || "Chart")}">
      ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${W - R + 6}" y="${y(v) + 4}">${esc(fmt(v))}</text>`).join("")}
      ${opts.base != null && opts.base > lo && opts.base < hi ? `<line class="base" x1="${L}" x2="${W - R}" y1="${y(opts.base)}" y2="${y(opts.base)}"/>` : ""}
      ${xt.map((l) => `<text class="axis" x="${x(xi[l])}" y="${H - 6}" text-anchor="${xi[l] === 0 ? "start" : "middle"}">${l.slice(0, 4)}</text>`).join("")}
      ${opts.area && series.length === 1 ? `<path d="${path(series[0])}L${x(xi[series[0].pts.at(-1)[0]])},${H - B}L${x(xi[series[0].pts[0][0]])},${H - B}Z" fill="${series[0].color}" fill-opacity=".1"/>` : ""}
      ${series.map((s) => `<path d="${path(s)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="5 4"' : ""}/>`).join("")}
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
    </svg><div class="tip" hidden></div></div>
    ${series.length > 1 ? `<div class="legend">${series.map((s) => `<span class="leg"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>` : ""}`;
    const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), cross = el.querySelector(".cross");
    const maps = series.map((s) => Object.fromEntries(s.pts));
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(labels.length - 1, Math.round((px - L) / (W - L - R) * (labels.length - 1))));
      const l = labels[i];
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
      const when = new Date(l.length === 4 ? l + "-07-01" : l + "-15").toLocaleDateString(undefined, l.length === 4 ? { year: "numeric" } : { month: "short", year: "numeric" });
      tip.innerHTML = `<div class="tk">${esc(when)}</div>` + series.map((s, n) => maps[n][l] == null ? "" : `<div><i class="dot" style="background:${s.color}"></i>${series.length > 1 ? esc(s.name) + ": " : ""}<b>${esc(fmt(maps[n][l]))}</b></div>`).join("");
      tip.hidden = false;
      const left = x(i) / W * r.width;
      tip.style.left = Math.min(r.width - tip.offsetWidth - 4, Math.max(4, left + 12)) + "px";
      tip.style.top = "8px";
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
  }
  function niceStep(raw) {
    const p = 10 ** Math.floor(Math.log10(raw || 1)), f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  // Keep only points from the last n years of a [["YYYY-MM", v]] series
  const since = (pts, years) => {
    if (!years || !pts || !pts.length) return pts || [];
    const last = pts.at(-1)[0], y = +last.slice(0, 4) - years;
    const cut = `${y}${last.slice(4)}`;
    return pts.filter((p) => p[0] >= cut);
  };
  const rebase = (pts) => {
    const b = pts.find((p) => p[1] != null);
    return b ? pts.map((p) => [p[0], p[1] == null ? null : p[1] / b[1] * 100]) : pts;
  };

  // ---- growth views and statistics for [["YYYY-MM", v]] price series (quarterly or monthly)
  const mon = (l) => +l.slice(0, 4) * 12 + +l.slice(5, 7) - 1;
  const GROWTH_VIEWS = [
    ["index", "Index", "Prices rebased to 100 at the start of the period."],
    ["cum", "% change", "Total change in price since the start of the period."],
    ["yoy", "Yearly growth", "Change on the same quarter a year earlier, at each point in time."],
    ["qoq", "Each quarter", "Change on the quarter before (or month before, for monthly figures)."],
    ["dd", "Below peak", "How far prices sit below their highest level so far."],
  ];
  // Change on the point a year earlier, keyed by label
  function yoySeries(pts) {
    const at = Object.fromEntries(pts.filter((p) => p[1] != null).map((p) => [mon(p[0]), p[1]]));
    return pts.map((p) => { const b = at[mon(p[0]) - 12]; return [p[0], p[1] != null && b ? (p[1] / b - 1) * 100 : null]; });
  }
  function growthView(full, mode, years) {
    full = (full || []).filter((p) => p[1] != null);
    if (mode === "index") return rebase(since(full, years));
    if (mode === "cum") return rebase(since(full, years)).map((p) => [p[0], p[1] - 100]);
    if (mode === "yoy") return since(yoySeries(full), years).filter((p) => p[1] != null);
    if (mode === "qoq") return since(full.map((p, i) => [p[0], i ? (p[1] / full[i - 1][1] - 1) * 100 : null]), years).filter((p) => p[1] != null);
    if (mode === "dd") { let hi = -Infinity; return since(full.map((p) => { hi = Math.max(hi, p[1]); return [p[0], (p[1] / hi - 1) * 100]; }), years); }
    return full;
  }
  function growthStats(full, years) {
    full = (full || []).filter((p) => p[1] != null);
    const p = since(full, years);
    if (p.length < 3) return null;
    const a = p[0][1], b = p.at(-1)[1];
    const span = (mon(p.at(-1)[0]) - mon(p[0][0])) / 12;
    const step = mon(p.at(-1)[0]) - mon(p.at(-2)[0]) || 3;
    const chg = p.slice(1).map((x, i) => x[1] / p[i][1] - 1);
    const mean = chg.reduce((s, x) => s + x, 0) / chg.length;
    const sd = Math.sqrt(chg.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, chg.length - 1));
    const yo = since(yoySeries(full), years).filter((x) => x[1] != null);
    let best = null, worst = null;
    for (const x of yo) { if (!best || x[1] > best[1]) best = x; if (!worst || x[1] < worst[1]) worst = x; }
    let hi = -Infinity, dd = 0, ddAt = null;
    for (const x of p) { hi = Math.max(hi, x[1]); const d = (x[1] / hi - 1) * 100; if (d < dd) { dd = d; ddAt = x[0]; } }
    const peak = Math.max(...full.map((x) => x[1]));
    const yoyAll = yoySeries(full).filter((x) => x[1] != null);
    return {
      from: p[0][0], to: p.at(-1)[0], years: span,
      total: (b / a - 1) * 100,
      cagr: span > 0.9 ? ((b / a) ** (1 / span) - 1) * 100 : null,
      last1y: yoyAll.length ? yoyAll.at(-1)[1] : null,
      lastQ: chg.length ? chg.at(-1) * 100 : null,
      best, worst, maxDrop: dd, maxDropAt: ddAt,
      offPeak: (b / peak - 1) * 100,
      vol: sd * Math.sqrt(12 / step) * 100,
      up: chg.filter((x) => x > 0).length / chg.length * 100,
    };
  }
  // Labels like "2024-07" as "Q3 2024" (quarterly) or "Jul 2024"
  const periodName = (l, quarterly = true) => !l ? "" : quarterly ? `Q${Math.floor((+l.slice(5, 7) - 1) / 3) + 1} ${l.slice(0, 4)}`
    : new Date(l + "-15").toLocaleDateString(undefined, { month: "short", year: "numeric" });
  // Download rows as a CSV file
  function csv(name, rows) {
    const text = rows.map((r) => r.map((v) => v == null ? "" : typeof v === "number" ? +v.toFixed(4) : `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // Monthly mortgage payment
  function payment(principal, ratePct, years, country = "US") {
    if (principal <= 0) return 0;
    const n = years * 12;
    // Canadian fixed-rate mortgages compound twice a year
    const r = country === "CA" ? (1 + ratePct / 200) ** (1 / 6) - 1 : ratePct / 1200;
    return r === 0 ? principal / n : principal * r / (1 - (1 + r) ** -n);
  }

  // ---- header
  function header() {
    const here = location.pathname.split("/").pop();
    const menu = document.getElementById("menu");
    if (menu) {
      const isHere = ([href, , also]) => href === here || (also || []).includes(here);
      const link = (p) => `<a href="${p[0]}"${isHere(p) ? ' aria-current="page"' : ""}>${esc(p[1])}</a>`;
      const row = PAGES.map(link).join("") + `<a class="menu-switch" href="../news.html" title="Go to the stock market site">Stocks ↗</a><a class="menu-switch" href="../daily/" title="The day's headlines from about 90 outlets">Daily News ↗</a>`;
      menu.innerHTML = `<div class="menu-wide">${row}</div><div class="menu-flat">${row}</div>`;
      const on = menu.querySelector(".menu-flat [aria-current]");
      if (on && getComputedStyle(menu.querySelector(".menu-flat")).display !== "none") on.scrollIntoView({ block: "nearest", inline: "center" });
    }
    const box = document.getElementById("jump");
    if (box) {
      picker(box, (m) => { location.href = marketUrl(m.id); });
      box.placeholder = "Go to a market… (press /)";
      document.addEventListener("keydown", (e) => {
        if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable=true]")) return;
        e.preventDefault(); box.focus(); box.select();
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", header); else header();

  // "Updated" text in the header
  async function stamp() {
    const el = document.getElementById("updated");
    if (!el) return;
    try {
      const d = await data();
      el.textContent = "Data updated " + new Date(d.updated).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch { el.textContent = "Data not built yet"; }
  }
  stamp();

  // Where to look for real listings in each country (links only)
  const searchLinks = (m) => {
    const q = encodeURIComponent(m.name + (m.region && m.c !== "MX" ? " " + m.region : ""));
    if (m.c === "US") return [
      ["Zillow", `https://www.zillow.com/homes/${q}_rb/`], ["Realtor.com", `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(m.name.split("-")[0].trim().replace(/ /g, "-"))}_${m.region ? m.region.split("-")[0] : ""}`],
      ["Redfin", `https://www.redfin.com/`],
    ];
    if (m.c === "CA") return [["REALTOR.ca", `https://www.realtor.ca/`], ["Zolo", `https://www.zolo.ca/`], ["Centris (Quebec)", `https://www.centris.ca/en`]];
    return [["Inmuebles24", `https://www.inmuebles24.com/casas-en-venta-q-${q}.html`], ["Lamudi", `https://www.lamudi.com.mx/`], ["Vivanuncios", `https://www.vivanuncios.com.mx/`]];
  };

  window.RE = { esc, money, short, pct, fixed, int, spark, store, load, data, marketUrl, place, headline, sideCls, Saved, star, search, picker, table, chart, since, rebase, payment, GROWTH_VIEWS, growthView, growthStats, periodName, csv, COUNTRY, FLAG, SYM, searchLinks, PAGES, flag, REGION_NAMES, PROVINCE_NAMES };
})();
