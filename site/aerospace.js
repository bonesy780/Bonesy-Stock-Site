// The Aerospace & Defence page, from aerospace.json (build_aerospace.py), with live prices when the price service is on
(async function () {
  const { esc, money, pct, big, stockUrl, store, spark } = UI;
  const $ = (id) => document.getElementById(id);
  let D;
  try { D = await UI.load("aerospace.json"); }
  catch (e) {
    $("updated").textContent = "";
    $("kpis").innerHTML = `<div class="panel empty">Aerospace and defence prices haven't been gathered yet. They refresh every 15 minutes.</div>`;
    return;
  }
  UI.freshness(D.generated, 44);
  const stamp = () => { $("updated").textContent = "Updated " + new Date(D.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); };
  stamp();
  const state = { range: "y1", heat: "d1", region: "", seg: "", watch: "all", topic: "all", budget: "usd", ...store.get("aerospace", {}) };
  const save = () => store.set("aerospace", state);
  const FLAG = { US: "🇺🇸", CA: "🇨🇦", FR: "🇫🇷", GB: "🇬🇧", DE: "🇩🇪", IT: "🇮🇹", SE: "🇸🇪", NO: "🇳🇴", JP: "🇯🇵", KR: "🇰🇷", IN: "🇮🇳", IL: "🇮🇱", BR: "🇧🇷" };
  const S = D.stocks || [];
  const byT = Object.fromEntries(S.map((s) => [s.t, s]));
  const upside = (s) => (s.tgt && s.p ? (s.tgt / s.p - 1) * 100 : null);
  const fromHigh = (s) => (s.hi52 && s.p ? (s.p / s.hi52 - 1) * 100 : null);
  const REC = { strong_buy: "Strong buy", buy: "Buy", hold: "Hold", underperform: "Sell", sell: "Sell" };
  const dateFmt = (iso, o = { month: "short", day: "numeric" }) => new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, o);
  const today = new Date().toISOString().slice(0, 10);
  const daysTo = (iso) => Math.round((Date.parse(iso + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86400000);
  const ago = (iso) => {
    const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
    return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };
  const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? u : "#");
  const name = (r) => `<div class="co-row">${UI.star(r.t)}<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.short || r.n)}</a></span><span class="tk">${FLAG[r.cc] || ""} ${esc(r.t)} · ${esc(r.seg)}</span></div></div>`;
  const avg = (rows, k) => { const v = rows.map((r) => r[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const capAvg = (rows, k) => {
    const v = rows.filter((r) => r[k] != null && r.mcapUsd > 0), w = v.reduce((a, r) => a + r.mcapUsd, 0);
    return w ? v.reduce((a, r) => a + r[k] * r.mcapUsd, 0) / w : null;
  };

  // ---- headline numbers
  function kpis() {
    const etf = Object.fromEntries((D.etfs || []).map((e) => [e.t, e]));
    const moved = S.filter((s) => s.d1 != null).sort((a, b) => b.d1 - a.d1);
    const best = moved[0], worst = moved[moved.length - 1];
    const ups = moved.filter((s) => s.d1 > 0).length;
    const spy = (D.chart.lines || []).find((l) => l.t === "SPY");
    const spyYtd = spy && ytdOf(spy);
    const ita = etf.ITA;
    const sky = D.flights && D.flights.n;
    const tile = (label, value, sub) => `<div class="panel ad-kpi"><span class="label">${label}</span><span class="value">${value}</span><span class="sub">${sub}</span></div>`;
    $("kpis").innerHTML = [
      tile("Sector today", pct(avg(S, "d1"), 2), `${ups} of ${moved.length} stocks up · average move`),
      ita ? tile("US A&amp;D this year", pct(ita.ytd), `ITA fund${spyYtd != null ? ` · S&amp;P 500 ${pct(spyYtd)}` : ""}`) : "",
      best ? tile("Best today", `<a href="${stockUrl(best.t)}">${esc(best.short)}</a> ${pct(best.d1)}`, worst ? `Worst: <a href="${stockUrl(worst.t)}">${esc(worst.short)}</a> ${pct(worst.d1)}` : "") : "",
      sky ? tile("Planes in the sky", `<span class="num ad-big">${sky.toLocaleString()}</span>`, `tracked right now · ${ago(D.flights.at)}`) : "",
    ].join("");
  }
  function ytdOf(line) {
    const y = new Date().getFullYear() + "-01-01";
    const i = D.chart.dates.findIndex((d) => d >= y);
    const v = line.v.filter((x) => x != null);
    const a = i > 0 ? line.v[i - 1] : null;
    return a && v.length ? (v[v.length - 1] / a - 1) * 100 : null;
  }

  // ---- sector vs S&P 500 line chart
  const RANGES = [["m1", "1M", 31], ["m3", "3M", 92], ["m6", "6M", 183], ["ytd", "YTD", null], ["y1", "1Y", 366]];
  const COLORS = ["var(--cmp-2)", "var(--cmp-1)", "var(--cmp-4)", "var(--cmp-6)"];
  function chart() {
    $("chart-range").innerHTML = RANGES.map(([k, l]) => `<button role="tab" aria-selected="${k === state.range}" data-r="${k}">${l}</button>`).join("");
    const C = D.chart || {};
    if (!C.dates || !C.dates.length) { $("chart").innerHTML = `<div class="empty">No chart data yet.</div>`; $("chart-legend").innerHTML = ""; return; }
    const [, , days] = RANGES.find((r) => r[0] === state.range) || RANGES[4];
    const last = C.dates[C.dates.length - 1];
    const cut = days ? new Date(Date.parse(last) - days * 86400000).toISOString().slice(0, 10) : last.slice(0, 4) + "-01-01";
    let start = C.dates.findIndex((d) => d >= cut);
    if (state.range === "ytd" && start > 0) start -= 1; // from the last close of the old year
    if (start < 0) start = 0;
    const dates = C.dates.slice(start);
    const lines = C.lines.map((l, n) => {
      const v = l.v.slice(start);
      const base = v.find((x) => x != null);
      return { ...l, color: COLORS[n % COLORS.length], pts: v.map((x) => (x == null || !base ? null : x / base * 100)) };
    }).filter((l) => l.pts.some((x) => x != null));
    const el = $("chart");
    const W = Math.max(300, el.clientWidth), H = W < 560 ? 220 : 300, L = 6, R = 44, T = 10, B = 24;
    const all = lines.flatMap((l) => l.pts).filter((x) => x != null);
    let lo = Math.min(...all, 100), hi = Math.max(...all, 100);
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const x = (i) => L + (i / Math.max(1, dates.length - 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const step = (hi - lo) / 4;
    let grid = "";
    for (let g = 0; g <= 4; g++) {
      const v = lo + step * g;
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="ad-grid"/><text x="${W - R + 6}" y="${(y(v) + 4).toFixed(1)}" class="ad-axis">${v.toFixed(0)}</text>`;
    }
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const i = Math.round((dates.length - 1) * t / ticks);
      grid += `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="ad-axis" text-anchor="${t === 0 ? "start" : t === ticks ? "end" : "middle"}">${dateFmt(dates[i], days && days < 100 ? { month: "short", day: "numeric" } : { month: "short", year: "2-digit" })}</text>`;
    }
    const paths = lines.map((l) => {
      let d = "", pen = false;
      l.pts.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
      return `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="${l.t === "SPY" ? 1.6 : 2.2}" ${l.t === "SPY" ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round"/>`;
    }).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Aerospace and defence funds against the S&amp;P 500">
      ${grid}<line x1="${L}" x2="${W - R}" y1="${y(100).toFixed(1)}" y2="${y(100).toFixed(1)}" class="ad-base"/>${paths}
      <line id="chart-x" class="ad-cross" y1="${T}" y2="${H - B}" x1="-10" x2="-10"/></svg><div class="ad-tip" id="chart-tip" hidden></div>`;
    const lastOf = (l) => { for (let i = l.pts.length - 1; i >= 0; i--) if (l.pts[i] != null) return l.pts[i]; return null; };
    $("chart-legend").innerHTML = lines.map((l) => `<span><i style="background:${l.color}"></i>${esc(l.n)} ${pct(lastOf(l) - 100)}</span>`).join("");
    const svg = el.querySelector("svg");
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const i = Math.max(0, Math.min(dates.length - 1, Math.round((px * W / r.width - L) / (W - L - R) * (dates.length - 1))));
      const cx = $("chart-x"); cx.setAttribute("x1", x(i)); cx.setAttribute("x2", x(i));
      const tip = $("chart-tip");
      tip.hidden = false;
      tip.innerHTML = `<b>${dateFmt(dates[i], { month: "short", day: "numeric", year: "numeric" })}</b>` + lines.map((l) => `<span><i style="background:${l.color}"></i>${esc(l.t)} ${l.pts[i] == null ? "–" : pct(l.pts[i] - 100)}</span>`).join("");
      const left = x(i) / W * r.width;
      tip.style.left = Math.min(r.width - tip.offsetWidth - 4, Math.max(4, left + 12)) + "px";
    };
    svg.addEventListener("mousemove", move);
    svg.addEventListener("touchmove", move, { passive: true });
    svg.addEventListener("mouseleave", () => { $("chart-tip").hidden = true; $("chart-x").setAttribute("x1", -10); $("chart-x").setAttribute("x2", -10); });
  }
  $("chart-range").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.range = b.dataset.r; save(); chart(); } });

  // ---- heatmap (same look as the Heatmap page)
  function squarify(items, x, y, w, h) {
    const out = [];
    const total = items.reduce((a, it) => a + it.w, 0);
    if (!total || w <= 0 || h <= 0) return out;
    const scale = (w * h) / total;
    let rest = items.map((it) => ({ it, a: it.w * scale }));
    while (rest.length) {
      const short = Math.min(w, h);
      let row = [], best = Infinity;
      for (const r of rest) {
        const next = row.concat(r);
        const sum = next.reduce((a, q) => a + q.a, 0);
        const max = Math.max(...next.map((q) => q.a)), min = Math.min(...next.map((q) => q.a));
        const worst = Math.max((short * short * max) / (sum * sum), (sum * sum) / (short * short * min));
        if (worst > best) break;
        best = worst; row = next;
      }
      const sum = row.reduce((a, q) => a + q.a, 0), thick = sum / short;
      let off = 0;
      for (const q of row) {
        const len = q.a / thick;
        if (w >= h) out.push({ ...q.it, x, y: y + off, w: thick, h: len }); else out.push({ ...q.it, x: x + off, y, w: len, h: thick });
        off += len;
      }
      if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
      rest = rest.slice(row.length);
    }
    return out;
  }
  const NICK = { "7011.T": "MHI", "7012.T": "KHI", "7013.T": "IHI", "012450.KS": "Hanwha", "047810.KS": "KAI", "079550.KS": "LIG", "064350.KS": "Rotem" };
  const HEAT = [["d1", "Day", 3], ["w1", "Week", 6], ["m1", "Month", 10], ["ytd", "YTD", 40], ["y1", "1 year", 60]];
  const color = (v, cap) => {
    if (v == null) return "var(--surface-2)";
    const f = Math.min(1, Math.abs(v) / cap);
    return `color-mix(in srgb, ${v >= 0 ? "var(--heat-up)" : "var(--heat-down)"} ${Math.round(18 + f * 82)}%, var(--heat-flat))`;
  };
  function heat() {
    const [k, , cap] = HEAT.find((h) => h[0] === state.heat) || HEAT[0];
    $("heat-period").innerHTML = HEAT.map(([p, l]) => `<button role="tab" aria-selected="${p === k}" data-p="${p}">${l}</button>`).join("");
    $("heat-legend").innerHTML = [-cap, -cap / 2, 0, cap / 2, cap].map((v) => `<span style="background:${color(v, cap)}">${v > 0 ? "+" : ""}${v}%</span>`).join("");
    const by = {};
    for (const s of S) if (s.mcapUsd > 0) (by[s.region] ||= []).push(s);
    const groups = Object.entries(by).map(([n, st]) => ({ name: n, stocks: st.sort((a, b) => b.mcapUsd - a.mcapUsd), w: st.reduce((a, s) => a + s.mcapUsd, 0), chg: capAvg(st, k) })).sort((a, b) => b.w - a.w);
    const el = $("heat");
    const W = el.clientWidth, H = Math.round(Math.max(380, Math.min(620, W * 0.55)));
    el.style.height = H + "px";
    let html = "";
    for (const g of squarify(groups, 0, 0, W, H)) {
      const showHead = g.h > 40 && g.w > 60, top = showHead ? 18 : 0;
      html += `<div class="heat-sec" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px">${showHead ? `<span class="heat-sec-name">${esc(g.name)} ${g.chg == null ? "" : (g.chg >= 0 ? "+" : "") + g.chg.toFixed(1) + "%"}</span>` : ""}</div>`;
      for (const b of squarify(g.stocks.map((s) => ({ s, w: s.mcapUsd })), g.x + 1, g.y + top + 1, g.w - 2, g.h - top - 2)) {
        const v = b.s[k];
        const large = b.w > 54 && b.h > 34, small = b.w > 30 && b.h > 16;
        const fs = Math.max(10, Math.min(20, Math.sqrt(b.w * b.h) / 5));
        // Asian listings have number symbols, so they show a short name instead
        let label = /^\d/.test(b.s.t) ? (NICK[b.s.t] || b.s.short.split(" ")[0]) : b.s.t.replace(/\.[A-Z]+$/, "").replace(/-B$/, "");
        const fits = (t, size) => t.length * size * 0.62 < b.w - 6;
        if (!fits(label, fs)) label = fits(label, 10) ? label : "";
        html += `<a class="heat-box" href="${stockUrl(b.s.t)}" title="${esc(b.s.short)} · ${big(b.s.mcapUsd)} · ${v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%"}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${color(v, cap)};font-size:${fs.toFixed(0)}px">${(large || small) && label ? `<span class="hb-sym"${fits(label, fs) ? "" : ' style="font-size:10px"'}>${esc(large && fits(b.s.short, fs) ? b.s.short : label)}</span>` : ""}${large ? `<span class="hb-chg">${v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(Math.abs(v) < 10 ? 2 : 1) + "%"}</span>` : ""}</a>`;
      }
    }
    el.innerHTML = html || `<div class="empty">No company sizes yet.</div>`;
  }
  $("heat-period").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.heat = b.dataset.p; save(); heat(); } });

  // ---- the stock table
  const REGIONS = ["", ...["United States", "Europe", "Asia", "Canada", "Middle East", "Latin America"].filter((r) => S.some((s) => s.region === r))];
  const segs = [...new Set(S.map((s) => s.seg))].sort();
  $("segment").innerHTML += segs.map((g) => `<option>${esc(g)}</option>`).join("");
  $("segment").value = segs.includes(state.seg) ? state.seg : "";
  const sort = { key: "mcapUsd", dir: -1 };
  function stocks() {
    $("region").innerHTML = REGIONS.map((r) => `<button role="tab" aria-selected="${r === state.region}" data-r="${esc(r)}">${r || "World"}</button>`).join("");
    const rows = S.filter((s) => (!state.region || s.region === state.region) && (!state.seg || s.seg === state.seg));
    UI.table($("table"), [
      { key: "short", label: "Company", left: true, sm: true, val: (r) => r.short, html: name },
      { key: "p", label: "Price", sm: true, val: (r) => r.p, html: (r) => `<span class="num">${money(r.cur === "GBp" ? r.p / 100 : r.p, r.cur === "GBp" ? "GBP" : r.cur === "ILA" ? "ILS" : r.cur)}</span>` },
      { key: "d1", label: "Day", sm: true, val: (r) => r.d1, html: (r) => pct(r.d1, 2) },
      { key: "m1", label: "1M", val: (r) => r.m1, html: (r) => pct(r.m1) },
      { key: "ytd", label: "YTD", val: (r) => r.ytd, html: (r) => pct(r.ytd) },
      { key: "y1", label: "1Y", val: (r) => r.y1, html: (r) => pct(r.y1) },
      { key: "mcapUsd", label: "Value", title: "Company value in US dollars", val: (r) => r.mcapUsd, html: (r) => `<span class="num">${big(r.mcapUsd)}</span>` },
      { key: "fpe", label: "Fwd P/E", title: "Price over next year's expected earnings", val: (r) => r.fpe, html: (r) => `<span class="num">${r.fpe == null ? "–" : r.fpe.toFixed(1)}</span>` },
      { key: "div", label: "Yield", title: "Dividend yield", val: (r) => r.div, html: (r) => `<span class="num">${r.div == null ? "–" : r.div.toFixed(1) + "%"}</span>` },
      { key: "up", label: "Upside", title: "To the analysts' average price target", val: upside, html: (r) => upside(r) == null ? "–" : pct(upside(r), 0) },
      { key: "rec", label: "Analysts", title: "Consensus rating (number of analysts)", val: (r) => r.recN, html: (r) => r.rec ? `<span class="ad-rec ${r.recN <= 2 ? "up" : r.recN >= 3.5 ? "down" : ""}">${REC[r.rec] || esc(r.rec)}</span>${r.analysts ? `<span class="tk"> ${r.analysts}</span>` : ""}` : "–" },
      { key: "earn", label: "Earnings", title: "Next earnings report", val: (r) => r.earn || null, html: (r) => r.earn ? `<span class="num">${dateFmt(r.earn)}</span>` : "–" },
      { key: "spark", label: "30 days", html: (r) => spark(r.spark) },
    ], tableAll ? rows : sortRows(rows).slice(0, 15), sort, { empty: "No companies match.", onSort: () => { stocks(); return true; } });
    if (rows.length > 15) $("table").insertAdjacentHTML("beforeend", `<div class="ad-more"><button class="btn small" type="button" id="table-more">${tableAll ? "Show the top 15" : `Show all ${rows.length} companies`}</button></div>`);
  }
  // The rows in the table's current order, so the top 15 follow the column sorted on
  function sortRows(rows) {
    const val = { short: (r) => r.short, up: upside, rec: (r) => r.recN, earn: (r) => r.earn || null }[sort.key] || ((r) => r[sort.key]);
    return rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sort.dir;
    });
  }
  let tableAll = false;
  $("table").addEventListener("click", (e) => { if (e.target.id === "table-more") { tableAll = !tableAll; stocks(); } });
  $("region").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.region = b.dataset.r; save(); stocks(); } });
  $("segment").addEventListener("change", () => { state.seg = $("segment").value; save(); stocks(); });

  // ---- automatic screens
  function ideas() {
    const card = (title, help, rows, val) => `<div class="panel card"><div><div class="nm">${title}</div><div class="tk">${help}</div></div>
      <ol class="ad-rank">${rows.map((s) => `<li><a href="${stockUrl(s.t)}">${FLAG[s.cc] || ""} ${esc(s.short)}</a>${val(s)}</li>`).join("") || "<li>None right now.</li>"}</ol></div>`;
    const rated = S.filter((s) => s.recN && s.recN <= 2.5 && (s.analysts || 0) >= 5);
    const top = (rows, f, n = 5) => rows.filter((s) => f(s) != null).sort((a, b) => f(b) - f(a)).slice(0, n);
    const momentum = (s) => (s.m3 != null && s.y1 != null && s.p > 0 ? s.m3 * 0.6 + s.y1 * 0.4 : null);
    $("ideas").innerHTML = [
      card("Strongest momentum", "Best mix of 3-month and 1-year gains.", top(S, momentum), (s) => pct(s.m3) + `<span class="tk"> 3M</span>`),
      card("Most upside to targets", "Buy-rated by 5+ analysts, ranked by the gap to their average target.", top(rated, upside), (s) => pct(upside(s), 0)),
      card("Pulled back, still rated buy", "Buy-rated stocks furthest below their 52-week high.", top(rated.filter((s) => fromHigh(s) < -8), (s) => -fromHigh(s)), (s) => pct(fromHigh(s), 0) + `<span class="tk"> from high</span>`),
      card("Dividend payers", "Highest dividend yields in the sector.", top(S.filter((s) => s.div > 0), (s) => s.div), (s) => `<span class="num">${s.div.toFixed(1)}%</span>`),
    ].join("");
  }

  // ---- things to watch: earnings, shows and budget dates
  const KINDS = [["all", "Everything"], ["earn", "Earnings"], ["show", "Air shows & fairs"], ["policy", "Budgets & orders"]];
  function upcoming() {
    const out = [];
    for (const s of S) if (s.earn && s.earn >= today && daysTo(s.earn) <= 75) out.push({ d: s.earn, kind: "earn", n: `${s.short} earnings`, why: `${FLAG[s.cc] || ""} ${s.seg}${s.analysts ? ` · ${s.analysts} analysts` : ""}${upside(s) != null ? ` · target ${upside(s) >= 0 ? "+" : ""}${upside(s).toFixed(0)}% away` : ""}`, t: s.t });
    for (const e of D.events || []) if (e.e >= today) out.push({ d: e.d, e: e.e, kind: "show", n: e.n, where: e.where, why: e.why });
    const y = +today.slice(0, 4);
    for (const r of D.recurring || []) {
      for (const yy of [y, y + 1]) {
        const d = `${yy}-${String(r.m).padStart(2, "0")}-${String(r.d).padStart(2, "0")}`;
        if (d >= today) { out.push({ d, kind: "policy", n: r.n, why: r.why, approx: true }); break; }
      }
    }
    return out.sort((a, b) => a.d.localeCompare(b.d));
  }
  let watchAll = false;
  function watch() {
    $("watch-kind").innerHTML = KINDS.map(([k, l]) => `<button class="chip" data-k="${k}" aria-pressed="${k === state.watch}">${l}</button>`).join("");
    const items = upcoming().filter((i) => state.watch === "all" || i.kind === state.watch);
    const shown = watchAll ? items : items.slice(0, 12);
    const when = (i) => {
      const n = daysTo(i.d);
      return n <= 0 ? (i.e ? "On now" : "Today") : n === 1 ? "Tomorrow" : n < 60 ? `In ${n} days` : `In ${Math.round(n / 30)} months`;
    };
    const ICON = { earn: "📊", show: "✈️", policy: "🏛️" };
    $("watch").innerHTML = shown.map((i) => `<li class="ad-ev ad-${i.kind}">
        <div class="ad-date"><b>${i.approx ? dateFmt(i.d, { month: "short" }) : dateFmt(i.d, { month: "short", day: "numeric" })}</b><span>${i.approx ? "around" : when(i)}</span></div>
        <div class="ad-ev-body"><div class="nm">${ICON[i.kind]} ${i.t ? `<a href="${stockUrl(i.t)}">${esc(i.n)}</a>` : esc(i.n)}${i.where ? ` <span class="tk">· ${esc(i.where)}${i.e && i.e !== i.d ? `, until ${dateFmt(i.e)}` : ""}</span>` : ""}</div><div class="tk">${esc(i.why)}</div></div>
      </li>`).join("") + (items.length > 12 ? `<li class="ad-more"><button class="btn small" type="button" id="watch-more">${watchAll ? "Show fewer" : `Show all ${items.length}`}</button></li>` : "")
      || `<li class="empty">Nothing coming up.</li>`;
  }
  $("watch-kind").addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (b) { state.watch = b.dataset.k; watchAll = false; save(); watch(); } });
  $("watch").addEventListener("click", (e) => { if (e.target.id === "watch-more") { watchAll = !watchAll; watch(); } });

  // ---- deals and news
  const N = D.news || [];
  const arrow = (v) => v == null ? "" : `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"}${Math.abs(v).toFixed(1)}%</span>`;
  const tickerTags = (s) => (s.tickers || []).map((t) => byT[t] ? `<a class="tag" href="${stockUrl(t)}">${esc(byT[t].short)} ${arrow(byT[t].d1)}</a>` : "").join("");
  const story = (s) => `<article class="panel story ad-story">
      ${s.image ? `<img src="${esc(safeUrl(s.image))}" alt="" loading="lazy">` : ""}
      <div class="story-body">
        <div class="story-meta"><span>${esc(s.source)}</span><span>${ago(s.published)}</span><span class="tag">${esc(s.topic)}</span></div>
        <h3><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></h3>
        ${s.summary ? `<p>${esc(s.summary)}</p>` : ""}
        ${(s.tickers || []).length ? `<div class="ad-tags">${tickerTags(s)}</div>` : ""}
      </div></article>`;
  function deals() {
    const d = N.filter((s) => s.deal).slice(0, 8);
    $("deals").innerHTML = d.length ? `<ul class="panel ad-deal-list">${d.map((s) => `<li>
        <span class="ad-deal-ico" aria-hidden="true">🤝</span>
        <div><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>
        <div class="story-meta"><span>${esc(s.source)}</span><span>${ago(s.published)}</span><span class="tag">${esc(s.topic)}</span>${tickerTags(s)}</div></div></li>`).join("")}</ul>`
      : `<div class="panel empty">No deal headlines in the past week.</div>`;
  }
  let newsAll = false;
  function news() {
    const topics = ["all", ...["Defence", "Commercial", "Space", "Industry"].filter((t) => N.some((s) => s.topic === t))];
    if (!topics.includes(state.topic)) state.topic = "all";
    $("news-topic").innerHTML = topics.map((t) => `<button class="chip" data-t="${t}" aria-pressed="${t === state.topic}">${t === "all" ? "All" : t} <span class="muted">${t === "all" ? N.length : N.filter((s) => s.topic === t).length}</span></button>`).join("");
    const list = N.filter((s) => state.topic === "all" || s.topic === state.topic);
    $("news").innerHTML = (list.length ? (newsAll ? list : list.slice(0, 12)).map(story).join("") : `<div class="panel empty">No stories in the past week.</div>`)
      + (list.length > 12 ? `<div class="ad-more"><button class="btn small" type="button" id="news-more">${newsAll ? "Show fewer" : `Show all ${list.length} stories`}</button></div>` : "");
  }
  $("news-topic").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { state.topic = b.dataset.t; newsAll = false; save(); news(); } });
  $("news").addEventListener("click", (e) => { if (e.target.id === "news-more") { newsAll = !newsAll; news(); } });

  // ---- ETFs
  const etfSort = { key: "aum", dir: -1 };
  function etfs() {
    UI.table($("etfs"), [
      { key: "n", label: "Fund", left: true, sm: true, val: (r) => r.n, html: (r) => `<div class="co-row">${UI.star(r.t)}<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.t)}</a></span><span class="tk">${esc(r.about)}</span></div></div>` },
      { key: "p", label: "Price", sm: true, val: (r) => r.p, html: (r) => `<span class="num">${money(r.p)}</span>` },
      { key: "d1", label: "Day", sm: true, val: (r) => r.d1, html: (r) => pct(r.d1, 2) },
      { key: "m3", label: "3M", val: (r) => r.m3, html: (r) => pct(r.m3) },
      { key: "ytd", label: "YTD", val: (r) => r.ytd, html: (r) => pct(r.ytd) },
      { key: "y1", label: "1Y", val: (r) => r.y1, html: (r) => pct(r.y1) },
      { key: "fee", label: "Fee", val: (r) => r.fee, html: (r) => `<span class="num">${r.fee == null ? "–" : r.fee.toFixed(2) + "%"}</span>` },
      { key: "aum", label: "Size", val: (r) => r.aum, html: (r) => `<span class="num">${big(r.aum)}</span>` },
      { key: "hold", label: "Biggest holdings", html: (r) => (r.hold || []).slice(0, 3).map((h) => esc(h.s || h.n)).join(", ") || "–" },
      { key: "spark", label: "30 days", html: (r) => spark(r.spark) },
    ], D.etfs || [], etfSort, { empty: "No fund prices yet." });
  }

  // ---- defence budgets
  function budgets() {
    const B = D.budgets && D.budgets.rows;
    $("budget-mode").innerHTML = [["usd", "US dollars"], ["gdp", "Share of GDP"]].map(([k, l]) => `<button role="tab" aria-selected="${k === state.budget}" data-m="${k}">${l}</button>`).join("");
    if (!B || !B.length) { $("budgets").innerHTML = `<div class="empty">Budget figures haven't been gathered yet.</div>`; return; }
    const gdp = state.budget === "gdp";
    const rows = B.filter((r) => (gdp ? r.gdp != null : r.usd)).sort((a, b) => (gdp ? b.gdp - a.gdp : b.usd - a.usd)).slice(0, 18);
    const max = Math.max(...rows.map((r) => (gdp ? r.gdp : r.usd)), gdp ? 5 : 1);
    const year = Math.max(...B.map((r) => r.y));
    const marks = gdp ? [[2, "NATO 2%"], [3.5, "3.5% core goal"]] : [];
    $("budgets").innerHTML = `<ul class="ad-bars">${rows.map((r) => {
      const v = gdp ? r.gdp : r.usd;
      return `<li><span class="ad-bar-n">${esc(r.n)}</span><span class="ad-bar">${marks.map(([m]) => `<em style="left:${(m / max * 100).toFixed(1)}%"></em>`).join("")}<i style="width:${(v / max * 100).toFixed(1)}%"></i></span>
        <b class="num">${gdp ? v.toFixed(1) + "%" : big(v)}</b><span class="ad-bar-g">${r.g5 != null ? pct(r.g5, 0) + `<span class="tk"> 5y</span>` : ""}</span></li>`;
    }).join("")}</ul>
    <p class="hint">${gdp ? "Dashed lines: NATO's old 2% guideline and the 3.5% core-defence goal for 2035." : "Green and red: change over five years."} Latest year: ${year} (figures lag about a year). Source: ${esc(D.budgets.source || "SIPRI")}.</p>`;
  }
  $("budget-mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.budget = b.dataset.m; save(); budgets(); } });

  // ---- big programmes (background knowledge; the stocks' moves are live)
  const PROGRAMS = [
    ["F-35 Lightning II", "Stealth fighter flown by about 20 countries, the most expensive weapons programme ever (more than $1.7 trillion over its life).", ["LMT", "NOC", "BA.L", "RTX"]],
    ["Golden Dome", "The US missile-defence shield announced in 2025, with space sensors and interceptors; tens of billions in early contracts.", ["LMT", "NOC", "RTX", "LHX", "PLTR"]],
    ["B-21 Raider and Sentinel", "America's new stealth bomber and its next nuclear missile, both led by Northrop Grumman. Sentinel's cost jumped by about 80% in 2024.", ["NOC"]],
    ["F-47 sixth-generation fighter", "Boeing won the US Air Force's next fighter in March 2025, a lift for its defence arm after years of losses.", ["BA"]],
    ["GCAP (Tempest)", "Britain, Italy and Japan's next fighter, due around 2035.", ["BA.L", "LDO.MI", "7011.T", "RR.L"]],
    ["FCAS", "France, Germany and Spain's rival future fighter; the partners have argued over who leads the work.", ["AM.PA", "AIR.PA", "SAF.PA"]],
    ["AUKUS submarines", "The US and UK helping Australia build nuclear-powered submarines, a decades-long order book for shipyards.", ["GD", "HII", "BA.L", "RR.L", "BWXT"]],
    ["Ammunition rebuild", "The war in Ukraine emptied stockpiles; Europe and the US are expanding artillery shell and rocket factories.", ["RHM.DE", "GD", "012450.KS", "CHG.L", "KOG.OL"]],
    ["Airliner backlog", "Airbus and Boeing have orders for well over 14,000 jets, more than a decade of production; deliveries, not orders, drive cash.", ["AIR.PA", "BA", "SAF.PA", "GE"]],
  ];
  function programs() {
    $("programs").innerHTML = PROGRAMS.map(([n, about, ts]) => `<div class="panel card"><div class="nm">${esc(n)}</div><p class="tk ad-prog">${esc(about)}</p>
      <div class="ad-tags">${ts.filter((t) => byT[t]).map((t) => `<a class="tag" href="${stockUrl(t)}">${esc(byT[t].short)} ${arrow(byT[t].d1)}</a>`).join("")}</div></div>`).join("");
  }

  // ---- aviation corner
  const FACTS = [
    ["🛩️", "The Wright brothers' first flight on December 17, 1903 lasted 12 seconds and covered 120 feet, less than the wingspan of a Boeing 747."],
    ["⚙️", "Engine makers often sell engines at a loss and earn it back on decades of servicing. Rolls-Royce trademarked “Power by the Hour”, charging airlines per flying hour."],
    ["🔩", "A Boeing 747-8 is made of about 6 million parts, from roughly half a million suppliers' part numbers."],
    ["🚀", "SpaceX lands and reflies its Falcon 9 boosters; some have flown more than 25 times, which cut launch prices and pressured rivals."],
    ["⚡", "The SR-71 Blackbird has held the speed record for a jet aircraft since 1976: 2,193 mph, over three times the speed of sound."],
    ["🌍", "Airlines carry around 5 billion passengers a year, roughly 100,000 flights a day worldwide."],
    ["🛫", "Concorde flew London or Paris to New York in about three and a half hours, from 1976 until it retired in 2003."],
    ["🌀", "The GE9X on Boeing's 777X is the world's biggest jet engine: its fan is 134 inches (3.4 m) across."],
    ["🏆", "In 2025 the Airbus A320 family passed the Boeing 737 as the most-delivered airliner family in history."],
    ["💰", "World military spending hit a record of about $2.7 trillion in 2024, the biggest yearly rise since the Cold War ended (SIPRI)."],
    ["🛬", "Atlanta's Hartsfield-Jackson is usually the world's busiest airport by passengers."],
    ["🧳", "The Airbus A380 is the largest passenger jet ever built, certified for up to 853 passengers."],
    ["🏔️", "Airliners cruise at around 35,000 feet, higher than Mount Everest (29,032 ft)."],
    ["📈", "Aerospace makers work years ahead: a backlog lets investors see revenue coming long before it shows up in earnings."],
  ];
  let factStart = Math.floor(Math.random() * FACTS.length);
  function facts() {
    const n = matchMedia("(max-width: 640px)").matches ? 2 : 3;
    $("facts").innerHTML = Array.from({ length: n }, (_, i) => FACTS[(factStart + i) % FACTS.length])
      .map(([ico, t]) => `<div class="panel ad-fact"><span aria-hidden="true">${ico}</span><p>${esc(t)}</p></div>`).join("");
  }
  $("more-facts").addEventListener("click", () => { factStart = (factStart + 3) % FACTS.length; facts(); });
  function sky() {
    const F = D.flights;
    if (!F || !F.n) { $("sky").innerHTML = `<div class="empty">Live air traffic isn't available right now.</div>`; return; }
    const hist = (F.hist || []).map((h) => h[1]);
    const maxTop = Math.max(...F.top.map((t) => t[1]));
    $("sky").innerHTML = `<div class="label">Aircraft flying right now</div>
      <div class="ad-sky-n num">${F.n.toLocaleString()}</div>
      <div class="tk">Tracked by The OpenSky Network's receivers, ${ago(F.at)}. Coverage is best over North America and Europe.</div>
      ${hist.length > 3 ? `<div class="ad-sky-spark">${spark(hist, 220, 36)}<span class="tk">last ${Math.round((Date.now() - Date.parse(F.hist[0][0])) / 3600000)} hours</span></div>` : ""}
      <div class="label">Most planes by country of registration</div>
      <ul class="fd-bars">${F.top.map(([c, v]) => `<li><span>${esc(c)}</span><span class="fd-bar"><i style="width:${(v / maxTop * 100).toFixed(0)}%"></i></span><b class="num">${v.toLocaleString()}</b></li>`).join("")}</ul>`;
  }

  function all() { kpis(); chart(); heat(); stocks(); ideas(); watch(); deals(); news(); etfs(); budgets(); programs(); sky(); facts(); }
  all();
  let w = innerWidth;
  addEventListener("resize", () => { if (Math.abs(innerWidth - w) > 30) { w = innerWidth; chart(); heat(); } });

  if (window.Live && Live.on) {
    let first = true;
    Live.every(60000, async () => {
      if (first) { first = false; return; }
      const rows = S.concat(D.etfs || []);
      const q = await Live.quotes(rows.map((r) => r.t));
      let n = 0;
      for (const r of rows) {
        const y = q[r.t];
        if (!y || y.price == null) continue;
        r.p = y.price; if (y.chg1d != null) r.d1 = y.chg1d;
        if (r.shares && r.fx) r.mcapUsd = r.shares * r.p * r.fx;
        n++;
      }
      if (n) { $("updated").innerHTML = `<span class="live-dot on" aria-hidden="true"></span>Live · ${Live.stamp(new Date())}`; kpis(); heat(); stocks(); ideas(); etfs(); programs(); deals(); }
    });
  }
})();
