(async function () {
  const { esc, money, pct, big, stockUrl, store, Watch } = UI;
  const $ = (id) => document.getElementById(id);

  let M;
  try {
    M = await UI.market();
  } catch (e) {
    $("updated").textContent = "Stock data could not be loaded.";
    $("heat").innerHTML = `<div class="empty">Stock data could not be loaded. Try again after the next data refresh.</div>`;
    return;
  }
  UI.updated(M.generated);

  const PERIODS = [["d1", "Day", 3], ["w1", "Week", 6], ["m1", "Month", 10], ["m3", "3 months", 20], ["ytd", "YTD", 30], ["cx", "Custom", 10]];
  const state = { market: "sp500", period: "d1", size: "cap", watch: false, ...store.get("heatmap", {}) };
  if (!M.indexes.some((i) => i.id === state.market)) state.market = M.indexes[0].id;
  if (!PERIODS.some((p) => p[0] === state.period)) state.period = "d1";
  if (state.size !== "equal") state.size = "cap";

  // ---- custom date range: each stock's move between the close before `from` and the close on or before `to`,
  // read from monthly files of daily closes (closes/<market>/<YYYY-MM>.json) so only a few small files load
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const isoOf = (d) => d.toISOString().slice(0, 10);
  const shiftDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
  const monthOf = (iso) => iso.slice(0, 7);
  const prevMonth = (iso) => { const d = new Date(iso.slice(0, 7) + "-01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1); return isoOf(d).slice(0, 7); };
  const nice = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const fileCache = {};
  const getJson = (f) => (fileCache[f] ||= fetch(f, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  let spans = null; // first and last saved date for each market
  const custom = { key: "", ready: false, base: null, end: null, cap: 10, err: "" };

  // Color strength grows with the length of the range, like the preset periods
  const capFor = (days) => (days <= 3 ? 3 : days <= 8 ? 6 : days <= 35 ? 10 : days <= 100 ? 20 : days <= 400 ? 30 : days <= 1100 ? 50 : 80);

  async function loadCustom() {
    const ix = state.market;
    spans ||= (await getJson("closes/index.json")) || {};
    const span = spans[ix];
    if (!span) { custom.err = "Custom dates aren't available for this market yet. They appear after the next full data refresh."; return; }
    let { from, to } = state;
    if (!ISO.test(from || "")) from = shiftDays(span.to, -30);
    if (!ISO.test(to || "")) to = span.to;
    if (from > to) [from, to] = [to, from];
    from = from < span.from ? span.from : from > span.to ? span.to : from;
    to = to > span.to ? span.to : to < span.from ? span.from : to;
    state.from = from; state.to = to;
    const key = `${ix}|${from}|${to}`;
    if (custom.key === key && custom.ready) return;
    custom.key = key; custom.ready = false; custom.err = "";
    const months = [...new Set([prevMonth(from), monthOf(from), prevMonth(to), monthOf(to)])].sort();
    const files = await Promise.all(months.map((m) => getJson(`closes/${ix}/${m}.json`)));
    if (custom.key !== key) return; // a newer choice took over
    // Every saved day across the loaded months, oldest first, as [date, {ticker: close}]
    const days = [];
    for (const f of files) {
      if (!f) continue;
      f.d.forEach((d, i) => { const row = {}; f.t.forEach((t, j) => { if (f.c[i][j] != null) row[t] = f.c[i][j]; }); days.push([d, row]); });
    }
    days.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const lastBefore = (t, lim, strict) => {
      for (let i = days.length - 1; i >= 0; i--) {
        const [d, row] = days[i];
        if ((strict ? d < lim : d <= lim) && row[t] != null) return [d, row[t]];
      }
      return null;
    };
    const firstFrom = (t, lim) => { const x = days.find(([d, row]) => d >= lim && monthOf(d) === monthOf(lim) && row[t] != null); return x ? [x[0], x[1][t]] : null; };
    // The dates most stocks were measured between, to say so under the date boxes
    const baseN = {}, endN = {};
    const most = (n) => Object.entries(n).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
    for (const s of M.stocks) {
      if (!s.ix.includes(ix)) continue;
      // At the very start of the saved history there is no earlier close, so start from the first one
      const a = lastBefore(s.t, from, true) || (from <= span.from ? firstFrom(s.t, from) : null);
      const b = lastBefore(s.t, to, false);
      s.cx = a && b && a[0] < b[0] && a[1] > 0 ? (b[1] / a[1] - 1) * 100 : null;
      if (s.cx != null) { baseN[a[0]] = (baseN[a[0]] || 0) + 1; endN[b[0]] = (endN[b[0]] || 0) + 1; }
    }
    if (!days.length) custom.err = "No saved prices for those dates.";
    custom.base = most(baseN); custom.end = most(endN);
    custom.cap = capFor((new Date(to) - new Date(from)) / 864e5 + 1);
    custom.ready = true;
  }

  function rangeBar() {
    const bar = $("range"), on = state.period === "cx";
    bar.hidden = !on;
    if (!on) return;
    const span = spans && spans[state.market];
    for (const id of ["from", "to"]) {
      const inp = $(id);
      if (span) { inp.min = span.from; inp.max = span.to; }
      if (state[id] && inp.value !== state[id]) inp.value = state[id];
    }
    $("range-note").textContent = custom.err ? custom.err
      : !custom.ready ? "Loading prices for those dates…"
      : custom.base && custom.end ? `Change from the close on ${nice(custom.base)} to the close on ${nice(custom.end)}.` : "";
  }

  async function showCustom() {
    rangeBar();
    await loadCustom();
    rangeBar();
    if (custom.ready || custom.err) render();
  }

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

  const SIZES = [["cap", "Size by company value"], ["equal", "Equal size"]];
  const SIZE_SHORT = { cap: "Company value", equal: "Equal" };
  const view = { zoom: null, find: "" }; // the sector zoomed into, and the text typed in "Find a stock"
  const onWatch = () => new Set(Watch.all().lists.flatMap((l) => l.tickers));

  let boxes = [], byTicker = {};
  function render() {
    store.set("heatmap", state);
    $("markets").innerHTML = M.indexes.map((i) => `<button class="tab" role="tab" aria-selected="${i.id === state.market}" data-id="${i.id}">${esc(i.name)}</button>`).join("");
    $("periods").innerHTML = PERIODS.map(([k, l]) => `<button role="tab" aria-selected="${k === state.period}" data-p="${k}">${l}</button>`).join("");
    $("sizes").innerHTML = SIZES.map(([k, l]) => `<button type="button" aria-pressed="${k === state.size}" aria-selected="${k === state.size}" data-size="${k}" title="${l}">${SIZE_SHORT[k]}</button>`).join("");
    $("watch").setAttribute("aria-pressed", String(!!state.watch));
    rangeBar();
    const k = state.period;
    const cap = k === "cx" ? custom.cap : PERIODS.find((p) => p[0] === k)[2];
    $("legend").innerHTML = [-cap, -cap / 2, 0, cap / 2, cap].map((v) =>
      `<span style="background:${color(v, cap)}">${v > 0 ? "+" : ""}${v}%</span>`).join("");

    const list = M.stocks.filter((s) => s.ix.includes(state.market) && s.mcapUsd > 0);
    const weight = (s) => (state.size === "equal" ? 1 : s.mcapUsd);
    // Groups of stocks with their size-weighted move and best and worst stock
    const group = (name, stocks) => {
      const capSum = stocks.reduce((a, s) => a + s.mcapUsd, 0);
      const moved = stocks.filter((s) => s[k] != null);
      const wsum = moved.reduce((a, s) => a + s.mcapUsd, 0);
      const chg = wsum ? moved.reduce((a, s) => a + s[k] * s.mcapUsd, 0) / wsum : null;
      const sorted = moved.slice().sort((a, b) => b[k] - a[k]);
      return { name, cap: capSum, w: stocks.reduce((a, s) => a + weight(s), 0), stocks: stocks.sort((a, b) => b.mcapUsd - a.mcapUsd), chg, best: sorted[0], worst: sorted[sorted.length - 1] };
    };
    const split = (stocks, key) => {
      const by = {};
      for (const s of stocks) (by[s[key] || "Other"] ||= []).push(s);
      return Object.entries(by).map(([name, st]) => group(name, st)).sort((a, b) => b.w - a.w);
    };
    const sectors = split(list, "sector");
    if (view.zoom && !sectors.some((x) => x.name === view.zoom)) view.zoom = null;
    // Zoomed into a sector: only its stocks, grouped by industry
    const zoomed = view.zoom ? sectors.find((x) => x.name === view.zoom) : null;
    const groups = zoomed ? split(zoomed.stocks, "industry") : sectors;

    $("crumb").hidden = !zoomed;
    $("crumb").innerHTML = zoomed ? `<button class="btn heat-back" type="button" data-zoom="">← All sectors</button>
      <span><strong>${esc(zoomed.name)}</strong> ${pct(zoomed.chg, 2)} <span class="tk">· ${zoomed.stocks.length} stocks · ${big(zoomed.cap)} · grouped by industry</span></span>` : "";

    // Lay out the groups, then the stocks inside each one
    const el = $("heat");
    const W = el.clientWidth, H = Math.round(Math.max(420, Math.min(760, W * 0.62)));
    el.style.height = H + "px";
    const head = 18;
    boxes = []; byTicker = {};
    let html = "";
    for (const sec of squarify(groups, 0, 0, W, H)) {
      const showHead = sec.h > 40 && sec.w > 60;
      const label = `${esc(sec.name)} ${sec.chg == null ? "" : (sec.chg >= 0 ? "+" : "") + sec.chg.toFixed(1) + "%"}`;
      // Sector names zoom in; industry names inside a zoomed sector are plain labels
      const name = !showHead ? "" : zoomed ? `<span class="heat-sec-name">${label}</span>`
        : `<button type="button" class="heat-sec-name" data-zoom="${esc(sec.name)}" title="Zoom into ${esc(sec.name)}">${label}<i aria-hidden="true"> ⤢</i></button>`;
      html += `<div class="heat-sec" style="left:${sec.x}px;top:${sec.y}px;width:${sec.w}px;height:${sec.h}px">${name}</div>`;
      const top = showHead ? head : 0;
      const inner = squarify(sec.stocks.map((s) => ({ s, w: weight(s) })), sec.x + 1, sec.y + top + 1, sec.w - 2, sec.h - top - 2);
      for (const b of inner) {
        const n = boxes.length;
        boxes.push({ ...b, sec: zoomed ? zoomed.name : sec.name });
        byTicker[b.s.t] = n;
        const v = b.s[k];
        const big = b.w > 54 && b.h > 34, small = b.w > 30 && b.h > 16;
        const fs = Math.max(10, Math.min(22, Math.sqrt(b.w * b.h) / 5));
        html += `<a class="heat-box" data-n="${n}" href="${stockUrl(b.s.t)}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${color(v, cap)};font-size:${fs.toFixed(0)}px" aria-label="${esc(b.s.n)} ${v == null ? "" : (v >= 0 ? "up " : "down ") + Math.abs(v).toFixed(1) + "%"}">${big || small ? `<span class="hb-sym">${esc(b.s.s)}</span>` : ""}${big ? `<span class="hb-chg">${v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(v && Math.abs(v) < 10 ? 2 : 1) + "%"}</span>` : ""}</a>`;
      }
    }
    el.innerHTML = list.length ? html : `<div class="empty">No company sizes for this market yet.</div>`;
    highlight();
    if (tipFor && byTicker[tipFor] == null) hideTip(true);
    else if (tipFor) { fillTip(false); markOn(); }

    UI.table($("sectors"), [
      { key: "name", label: "Sector", left: true, sm: true, val: (r) => r.name, html: (r) => `<button type="button" class="linkish heat-zoom" data-zoom="${esc(r.name)}" title="Zoom the heatmap into ${esc(r.name)}"><strong>${esc(r.name)}</strong></button>` },
      { key: "chg", label: k === "cx" ? "Custom" : PERIODS.find((p) => p[0] === k)[1], sm: true, val: (r) => r.chg, html: (r) => pct(r.chg, 2) },
      { key: "n", label: "Stocks", val: (r) => r.stocks.length, html: (r) => `<span class="num">${r.stocks.length}</span>` },
      { key: "cap", label: "Mkt cap (USD)", val: (r) => r.cap, html: (r) => `<span class="num">${big(r.cap)}</span>` },
      { key: "best", label: "Best", html: (r) => r.best ? `<a class="co-link" href="${stockUrl(r.best.t)}">${esc(r.best.s)}</a> ${pct(r.best[k])}` : "–" },
      { key: "worst", label: "Worst", html: (r) => r.worst ? `<a class="co-link" href="${stockUrl(r.worst.t)}">${esc(r.worst.s)}</a> ${pct(r.worst[k])}` : "–" },
    ], sectors, sectorSort, {});
    rotation(sectors);
  }

  // Fade every box except the ones "Find a stock" or "My watchlist" pick out
  function highlight() {
    const q = view.find.trim().toLowerCase();
    const watch = state.watch ? onWatch() : null;
    const el = $("heat");
    el.classList.toggle("filtering", !!(q || watch));
    if (!q && !watch) return;
    let hits = 0;
    for (const a of el.querySelectorAll(".heat-box")) {
      const s = boxes[+a.dataset.n].s;
      const hit = (!q || s.s.toLowerCase().startsWith(q) || s.t.toLowerCase().startsWith(q) || s.n.toLowerCase().includes(q)) && (!watch || watch.has(s.t));
      a.classList.toggle("hit", hit);
      if (hit) hits++;
    }
    $("find").setCustomValidity("");
    $("find").title = q ? `${hits} match${hits === 1 ? "" : "es"}` : "";
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
    const cols = state.period === "cx" && custom.ready ? SPANS.concat([["cx", "Custom", custom.cap]]) : SPANS;
    const rows = sectors.map((x) => ({ name: x.name, v: cols.map(([k]) => avg(x.stocks, k)) }));
    rows.sort((a, b) => (b.v[3] ?? -1e9) - (a.v[3] ?? -1e9));
    rows.push({ name: "Whole market", v: cols.map(([k]) => avg(all, k)), total: true });
    const cell = (v, cap) => `<td class="rot-cell" style="background:${color(v, cap)}">${v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%"}</td>`;
    $("rotation").innerHTML = `<table class="rot-table"><thead><tr><th class="left">Sector</th>${cols.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.total ? "total" : ""}"><td class="left">${esc(r.name)}</td>${r.v.map((v, i) => cell(v, cols[i][2])).join("")}</tr>`).join("")}</tbody></table>`;
  }
  const sectorSort = { key: "chg", dir: -1 };

  // ---- hover card: price, recent moves, a one-month chart and the stock's latest headline.
  // Mouse: shows on hover and stays put while the pointer is on the same box, so it can be moved onto
  // to click the headline. Touch: the first tap opens it, a second tap on the same box opens the stock.
  const tip = $("tip");
  let tipFor = null, tipPinned = false, hideTimer = 0, switchTimer = 0, anchor = null, lastPointer = "mouse";
  const ago = (sec) => {
    const m = Math.max(0, (Date.now() / 1000 - sec) / 60);
    return m < 60 ? `${Math.max(1, Math.round(m))}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);

  // Headlines from the saved market news (news.json lists stories about each market's biggest companies),
  // used when the live news service is off or has nothing
  let savedNews = null;
  const fromSaved = async (s) => {
    savedNews ||= UI.load("news.json").then((d) => {
      const by = {};
      for (const m of d.markets || []) for (const x of m.stories || []) if (x.related) (by[x.related] ||= []).push(x);
      return by;
    }).catch(() => ({}));
    return ((await savedNews)[s.s] || []).map((x) => ({ title: x.title, url: x.url, source: x.source, time: x.published ? Date.parse(x.published) / 1000 : null }));
  };
  const newsMemo = {};
  const headlines = (s) => (newsMemo[s.t] ||= (async () => {
    let got = window.Live && Live.on && Live.news ? await Live.news(s.t).catch(() => []) : [];
    if (!got.length) got = await fromSaved(s);
    return got.filter((x) => x && x.title && safeUrl(x.url)).slice(0, 2);
  })());

  function newsHtml(items) {
    if (!items) return `<div class="ht-news ht-loading">Loading the latest news…</div>`;
    if (!items.length) return `<div class="ht-news tk">No recent news found for this stock.</div>`;
    return `<div class="ht-news"><div class="ht-label">Latest news</div>${items.map((x, i) => `<div class="ht-item${i ? " more" : ""}"><a class="ht-story" href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a><span class="tk">${[x.source, x.time ? ago(x.time) : null].filter(Boolean).map(esc).join(" · ")}</span></div>`).join("")}</div>`;
  }

  function fillTip(withNews) {
    const n = byTicker[tipFor];
    if (n == null) return;
    const b = boxes[n], s = b.s;
    const prev = tip.querySelector(".ht-news");
    tip.innerHTML = `<div class="ht-head"><strong>${esc(s.n)}</strong> <span class="tk">${esc(s.s)}</span>${UI.star(s.t)}</div>
      <div class="tk">${esc(b.sec)}${s.industry ? " · " + esc(s.industry) : ""}</div>
      <div class="ht-price"><b>${money(s.p, s.cur)}</b> ${pct(s.d1, 2)} <span class="tk">today</span></div>
      <div class="ht-moves"><span>1W ${pct(s.w1)}</span><span>1M ${pct(s.m1)}</span><span>YTD ${pct(s.ytd)}</span>${s.y1 != null ? `<span>1Y ${pct(s.y1)}</span>` : ""}</div>
      ${state.period === "cx" && custom.ready && custom.base ? `<div><span class="tk">${nice(custom.base)} – ${nice(custom.end)}</span> ${pct(s.cx, 2)}</div>` : ""}
      ${s.spark && s.spark.length > 1 ? `<div class="ht-spark">${UI.spark(s.spark, 240, 36)}<span class="tk">Last month</span></div>` : ""}
      <div class="tk">Mkt cap ${big(s.mcapUsd)}${s.pe ? " · P/E " + s.pe.toFixed(1) : ""}</div>
      ${withNews || !prev ? newsHtml(null) : prev.outerHTML}
      <a class="btn ht-open" href="${stockUrl(s.t)}">Open ${esc(s.s)} chart →</a>`;
    if (!withNews) return;
    const t = tipFor;
    headlines(s).then((items) => {
      if (tipFor !== t || tip.hidden) return;
      const slot = tip.querySelector(".ht-news");
      if (slot) slot.outerHTML = newsHtml(items);
      place();
    });
  }

  function markOn() {
    for (const a of $("heat").querySelectorAll(".heat-box.on")) a.classList.remove("on");
    const n = byTicker[tipFor];
    if (n != null) $("heat").querySelector(`.heat-box[data-n="${n}"]`)?.classList.add("on");
  }

  // Beside the pointer (or under the box for taps and keyboard), kept on screen
  function place() {
    if (tip.hidden || !anchor) return;
    tip.style.left = "0px"; tip.style.top = "0px";
    const r = tip.getBoundingClientRect(), pad = 8;
    let x, y;
    if (anchor.box) {
      const a = anchor.box;
      x = Math.min(Math.max(pad, a.left + a.width / 2 - r.width / 2), innerWidth - r.width - pad);
      y = a.bottom + 6;
      if (y + r.height > innerHeight - pad) y = a.top - r.height - 6;
      if (y < pad) y = Math.max(pad, innerHeight - r.height - pad);
    } else {
      x = anchor.x + 14; y = anchor.y + 14;
      if (x + r.width > innerWidth - pad) x = anchor.x - r.width - 14;
      if (y + r.height > innerHeight - pad) y = anchor.y - r.height - 14;
      x = Math.max(pad, x); y = Math.max(pad, y);
    }
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }

  function showTip(n, where, pinned) {
    clearTimeout(hideTimer); clearTimeout(switchTimer);
    const t = boxes[n].s.t, same = t === tipFor && !tip.hidden;
    tipFor = t; tipPinned = pinned; anchor = where;
    tip.classList.toggle("pinned", pinned);
    if (!same) fillTip(true);
    tip.hidden = false;
    markOn();
    place();
  }
  function hideTip(now) {
    clearTimeout(hideTimer); clearTimeout(switchTimer);
    const go = () => { tip.hidden = true; tipFor = null; tipPinned = false; markOn(); };
    if (now) go(); else hideTimer = setTimeout(go, 250);
  }

  const heat = $("heat");
  heat.addEventListener("pointerdown", (e) => { lastPointer = e.pointerType || "mouse"; });
  heat.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    lastPointer = "mouse";
    const a = e.target.closest(".heat-box");
    if (!a) { if (!tipPinned) hideTip(false); return; }
    clearTimeout(hideTimer);
    const n = +a.dataset.n, t = boxes[n].s.t;
    if (t === tipFor && !tip.hidden) {
      clearTimeout(switchTimer);
      // Follow the pointer only once it wanders well away from where the card opened
      if (anchor && !anchor.box && Math.hypot(e.clientX - anchor.x, e.clientY - anchor.y) > 90) { anchor = { x: e.clientX, y: e.clientY }; place(); }
      return;
    }
    // A short pause before switching to another box, so the pointer can cross small boxes on its way to the card
    const where = { x: e.clientX, y: e.clientY };
    clearTimeout(switchTimer);
    if (tip.hidden) showTip(n, where, false);
    else switchTimer = setTimeout(() => showTip(n, where, false), 110);
  });
  heat.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !tipPinned) hideTip(false); });
  tip.addEventListener("pointerenter", () => { clearTimeout(hideTimer); clearTimeout(switchTimer); });
  tip.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !tipPinned) hideTip(false); });

  heat.addEventListener("click", (e) => {
    const z = e.target.closest("[data-zoom]");
    if (z) { zoom(z.dataset.zoom); return; }
    const a = e.target.closest(".heat-box");
    if (!a || lastPointer === "mouse") return; // a mouse click opens the stock
    // Touch and pen: the first tap shows the card, a second tap on the same box opens the stock
    const n = +a.dataset.n;
    if (tipFor === boxes[n].s.t && tipPinned && !tip.hidden) return;
    e.preventDefault();
    showTip(n, { box: a.getBoundingClientRect() }, true);
  });
  // Keyboard: the card follows the focused box
  heat.addEventListener("focusin", (e) => {
    const a = e.target.closest(".heat-box");
    if (a && lastPointer === "mouse" && a.matches(":focus-visible")) showTip(+a.dataset.n, { box: a.getBoundingClientRect() }, false);
  });
  heat.addEventListener("focusout", (e) => { if (!tip.contains(e.relatedTarget) && !tipPinned) hideTip(false); });
  document.addEventListener("click", (e) => {
    if (tip.hidden || tip.contains(e.target) || e.target.closest(".heat-box")) return;
    hideTip(true);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !tip.hidden) hideTip(true); });
  window.addEventListener("scroll", () => { if (!tip.hidden && anchor && anchor.box) hideTip(true); }, { passive: true });

  function zoom(name) {
    view.zoom = name || null;
    hideTip(true);
    render();
    const top = $("markets").getBoundingClientRect().top;
    if (top < 0) $("markets").scrollIntoView({ block: "start", behavior: "smooth" });
  }
  $("crumb").addEventListener("click", (e) => { if (e.target.closest("[data-zoom]")) zoom(""); });
  $("sectors").addEventListener("click", (e) => {
    const z = e.target.closest("[data-zoom]");
    if (!z) return;
    zoom(z.dataset.zoom);
    $("crumb").scrollIntoView({ block: "start", behavior: "smooth" });
  });
  $("sizes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-size]");
    if (!b) return;
    state.size = b.dataset.size;
    render();
  });
  $("watch").addEventListener("click", () => {
    state.watch = !state.watch;
    render();
    if (state.watch && !onWatch().size) UI.toast && UI.toast("Your watchlists are empty. Tap ☆ on a stock to add it.");
  });
  window.addEventListener("watchlists", () => { if (state.watch) highlight(); });
  $("find").addEventListener("input", (e) => { view.find = e.target.value; highlight(); });
  // Enter on "Find a stock": open the card of the biggest match
  $("find").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const a = $("heat").querySelector(".heat-box.hit");
    if (!a) return;
    e.preventDefault();
    showTip(+a.dataset.n, { box: a.getBoundingClientRect() }, true);
  });

  $("markets").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    state.market = b.dataset.id;
    view.zoom = null;
    render();
    if (state.period === "cx") showCustom();
  });
  $("periods").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.period = b.dataset.p;
    render();
    if (state.period === "cx") showCustom();
  });
  for (const id of ["from", "to"]) $(id).addEventListener("change", (e) => {
    if (!ISO.test(e.target.value)) return;
    state[id] = e.target.value;
    showCustom();
  });
  // Quick picks inside the custom range: a span ending on the latest saved day
  $("range").addEventListener("click", (e) => {
    const b = e.target.closest("[data-back]");
    const span = spans && spans[state.market];
    if (!b || !span) return;
    state.to = span.to;
    state.from = shiftDays(span.to, -+b.dataset.back);
    showCustom();
  });
  let resize;
  window.addEventListener("resize", () => { clearTimeout(resize); resize = setTimeout(render, 150); });
  render();
  if (state.period === "cx") showCustom();

  // ---- live prices: recolor the boxes from the price service every 30 seconds while the market trades.
  // The day move comes straight from the live quote; the longer periods are the saved move carried forward
  // by how far the price has gone since the last saved close. Custom ranges stay on saved closes.
  if (!(window.Live && Live.on)) return;
  const SAVED = ["p", "d1", "w1", "m1", "m3", "m6", "ytd", "y1"];
  const LONGER = ["w1", "m1", "m3", "m6", "ytd", "y1"];
  const lastLive = {}; // market id -> { at, open }
  async function refreshLive(force) {
    const ix = state.market, seen = lastLive[ix];
    // Once a market is closed its prices stop moving, so only look again every 5 minutes
    if (!force && seen && !seen.open && Date.now() - seen.at < 5 * 60e3) return;
    const list = M.stocks.filter((s) => s.ix.includes(ix) && s.mcapUsd > 0);
    if (!list.length) return;
    const q = await Live.quotes(list.map((s) => s.t));
    if (!Object.keys(q).length || state.market !== ix) return;
    for (const s of list) {
      const x = q[s.t];
      if (!x || !(x.price > 0)) continue;
      s.saved ||= Object.fromEntries(SAVED.map((k) => [k, s[k]]));
      const base = s.saved;
      // A quote older than the saved close (a stale feed) would undo the day's saved move, so skip it
      if (x.time && s.asOf && new Date(x.time * 1000).toISOString().slice(0, 10) < s.asOf) continue;
      s.p = x.price;
      if (x.chg1d != null) s.d1 = x.chg1d;
      if (base.p > 0) {
        const f = x.price / base.p;
        for (const k of LONGER) if (base[k] != null) s[k] = ((1 + base[k] / 100) * f - 1) * 100;
      }
    }
    const open = Object.values(q).some((x) => x.state === "open");
    lastLive[ix] = { at: Date.now(), open };
    $("updated").innerHTML = `<span class="live-dot ${open ? "on" : ""}" aria-hidden="true"></span>${open ? "Live" : "Market closed"} · ${Live.stamp(new Date())}`;
    if (state.period !== "cx") render();
  }
  Live.every(30000, () => refreshLive(false));
  $("markets").addEventListener("click", () => setTimeout(() => refreshLive(true), 0));
})();
