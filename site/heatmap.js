(async function () {
  const { esc, money, pct, big, stockUrl, store } = UI;
  const $ = (id) => document.getElementById(id);

  let M;
  try {
    M = await UI.market();
  } catch (e) {
    $("updated").textContent = "Stock data could not be loaded.";
    $("heat").innerHTML = `<div class="empty">Stock data could not be loaded. Try again after the next data refresh.</div>`;
    return;
  }
  $("updated").textContent = "Updated " + new Date(M.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  const PERIODS = [["d1", "Day", 3], ["w1", "Week", 6], ["m1", "Month", 10], ["m3", "3 months", 20], ["ytd", "YTD", 30]];
  const state = { market: "sp500", period: "d1", ...store.get("heatmap", {}) };
  if (!M.indexes.some((i) => i.id === state.market)) state.market = M.indexes[0].id;
  if (!PERIODS.some((p) => p[0] === state.period)) state.period = "d1";

  // ---- squarified treemap: lays out items (with .w weights) in the box x, y, w, h
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
        best = worst;
        row = next;
      }
      const sum = row.reduce((a, q) => a + q.a, 0);
      const thick = sum / short;
      let off = 0;
      for (const q of row) {
        const len = q.a / thick;
        if (w >= h) out.push({ ...q.it, x, y: y + off, w: thick, h: len });
        else out.push({ ...q.it, x: x + off, y, w: len, h: thick });
        off += len;
      }
      if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
      rest = rest.slice(row.length);
    }
    return out;
  }

  // Green for up, red for down, stronger with bigger moves (full strength at `cap` percent)
  const color = (v, cap) => {
    if (v == null) return "var(--surface-2)";
    const f = Math.min(1, Math.abs(v) / cap);
    const mix = Math.round(18 + f * 82);
    return `color-mix(in srgb, ${v >= 0 ? "var(--heat-up)" : "var(--heat-down)"} ${mix}%, var(--heat-flat))`;
  };

  let boxes = [];
  function render() {
    store.set("heatmap", state);
    $("markets").innerHTML = M.indexes.map((i) => `<button class="tab" role="tab" aria-selected="${i.id === state.market}" data-id="${i.id}">${esc(i.name)}</button>`).join("");
    $("periods").innerHTML = PERIODS.map(([k, l]) => `<button role="tab" aria-selected="${k === state.period}" data-p="${k}">${l}</button>`).join("");
    const [k, , cap] = PERIODS.find((p) => p[0] === state.period);
    $("legend").innerHTML = [-cap, -cap / 2, 0, cap / 2, cap].map((v) =>
      `<span style="background:${color(v, cap)}">${v > 0 ? "+" : ""}${v}%</span>`).join("");

    const list = M.stocks.filter((s) => s.ix.includes(state.market) && s.mcapUsd > 0);
    const bySector = {};
    for (const s of list) (bySector[s.sector || "Other"] ||= []).push(s);
    const sectors = Object.entries(bySector).map(([name, stocks]) => {
      const cap = stocks.reduce((a, s) => a + s.mcapUsd, 0);
      const moved = stocks.filter((s) => s[k] != null);
      const wsum = moved.reduce((a, s) => a + s.mcapUsd, 0);
      const chg = wsum ? moved.reduce((a, s) => a + s[k] * s.mcapUsd, 0) / wsum : null;
      const sorted = moved.slice().sort((a, b) => b[k] - a[k]);
      return { name, w: cap, stocks: stocks.sort((a, b) => b.mcapUsd - a.mcapUsd), chg, best: sorted[0], worst: sorted[sorted.length - 1] };
    }).sort((a, b) => b.w - a.w);

    // Lay out sectors, then the stocks inside each one
    const el = $("heat");
    const W = el.clientWidth, H = Math.round(Math.max(420, Math.min(760, W * 0.62)));
    el.style.height = H + "px";
    const head = 18;
    boxes = [];
    let html = "";
    for (const sec of squarify(sectors, 0, 0, W, H)) {
      const showHead = sec.h > 40 && sec.w > 60;
      html += `<div class="heat-sec" style="left:${sec.x}px;top:${sec.y}px;width:${sec.w}px;height:${sec.h}px">${showHead ? `<span class="heat-sec-name">${esc(sec.name)} ${sec.chg == null ? "" : (sec.chg >= 0 ? "+" : "") + sec.chg.toFixed(1) + "%"}</span>` : ""}</div>`;
      const top = showHead ? head : 0;
      const inner = squarify(sec.stocks.map((s) => ({ s, w: s.mcapUsd })), sec.x + 1, sec.y + top + 1, sec.w - 2, sec.h - top - 2);
      for (const b of inner) {
        const n = boxes.length;
        boxes.push({ ...b, sec: sec.name });
        const v = b.s[k];
        const big = b.w > 54 && b.h > 34, small = b.w > 30 && b.h > 16;
        const fs = Math.max(10, Math.min(22, Math.sqrt(b.w * b.h) / 5));
        html += `<a class="heat-box" data-n="${n}" href="${stockUrl(b.s.t)}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${color(v, cap)};font-size:${fs.toFixed(0)}px" aria-label="${esc(b.s.n)} ${v == null ? "" : (v >= 0 ? "up " : "down ") + Math.abs(v).toFixed(1) + "%"}">${big || small ? `<span class="hb-sym">${esc(b.s.s)}</span>` : ""}${big ? `<span class="hb-chg">${v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(v && Math.abs(v) < 10 ? 2 : 1) + "%"}</span>` : ""}</a>`;
      }
    }
    el.innerHTML = list.length ? html : `<div class="empty">No company sizes for this market yet.</div>`;

    UI.table($("sectors"), [
      { key: "name", label: "Sector", left: true, sm: true, val: (r) => r.name, html: (r) => `<strong>${esc(r.name)}</strong>` },
      { key: "chg", label: PERIODS.find((p) => p[0] === k)[1], sm: true, val: (r) => r.chg, html: (r) => pct(r.chg, 2) },
      { key: "n", label: "Stocks", val: (r) => r.stocks.length, html: (r) => `<span class="num">${r.stocks.length}</span>` },
      { key: "w", label: "Mkt cap (USD)", val: (r) => r.w, html: (r) => `<span class="num">${big(r.w)}</span>` },
      { key: "best", label: "Best", html: (r) => r.best ? `<a class="co-link" href="${stockUrl(r.best.t)}">${esc(r.best.s)}</a> ${pct(r.best[k])}` : "–" },
      { key: "worst", label: "Worst", html: (r) => r.worst ? `<a class="co-link" href="${stockUrl(r.worst.t)}">${esc(r.worst.s)}</a> ${pct(r.worst[k])}` : "–" },
    ], sectors, sectorSort, {});
    rotation(sectors);
  }

  // Each sector's size-weighted move over every period, to spot which ones are gaining or losing favour
  const SPANS = [["d1", "Day", 3], ["w1", "Week", 6], ["m1", "Month", 10], ["m3", "3M", 20], ["m6", "6M", 30], ["ytd", "YTD", 30], ["y1", "1Y", 40]];
  function rotation(sectors) {
    const avg = (stocks, k) => {
      const moved = stocks.filter((s) => s[k] != null);
      const w = moved.reduce((a, s) => a + s.mcapUsd, 0);
      return w ? moved.reduce((a, s) => a + s[k] * s.mcapUsd, 0) / w : null;
    };
    const all = sectors.flatMap((x) => x.stocks);
    const rows = sectors.map((x) => ({ name: x.name, v: SPANS.map(([k]) => avg(x.stocks, k)) }));
    rows.sort((a, b) => (b.v[3] ?? -1e9) - (a.v[3] ?? -1e9));
    rows.push({ name: "Whole market", v: SPANS.map(([k]) => avg(all, k)), total: true });
    const cell = (v, cap) => `<td class="rot-cell" style="background:${color(v, cap)}">${v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%"}</td>`;
    $("rotation").innerHTML = `<table class="rot-table"><thead><tr><th class="left">Sector</th>${SPANS.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.total ? "total" : ""}"><td class="left">${esc(r.name)}</td>${r.v.map((v, i) => cell(v, SPANS[i][2])).join("")}</tr>`).join("")}</tbody></table>`;
  }
  const sectorSort = { key: "chg", dir: -1 };

  // Hover details
  const tip = $("tip");
  $("heat").addEventListener("mousemove", (e) => {
    const a = e.target.closest(".heat-box");
    if (!a) { tip.hidden = true; return; }
    const b = boxes[+a.dataset.n], s = b.s;
    tip.innerHTML = `<strong>${esc(s.n)}</strong> <span class="tk">${esc(s.s)}</span><br>
      <span class="tk">${esc(b.sec)}${s.industry ? " · " + esc(s.industry) : ""}</span><br>
      ${money(s.p, s.cur)} · Day ${pct(s.d1, 2)} · 1W ${pct(s.w1)} · YTD ${pct(s.ytd)}<br>
      <span class="tk">Mkt cap ${big(s.mcapUsd)}${s.pe ? " · P/E " + s.pe.toFixed(1) : ""}</span>`;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  });
  $("heat").addEventListener("mouseleave", () => { tip.hidden = true; });

  $("markets").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) { state.market = b.dataset.id; render(); } });
  $("periods").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.period = b.dataset.p; render(); } });
  let resize;
  window.addEventListener("resize", () => { clearTimeout(resize); resize = setTimeout(render, 150); });
  render();
})();
