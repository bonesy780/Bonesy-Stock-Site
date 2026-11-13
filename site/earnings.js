(async function () {
  const { esc, money, pct, big, stockUrl, store, Watch } = UI;
  const $ = (id) => document.getElementById(id);

  let M;
  try {
    M = await UI.market();
  } catch (e) {
    $("updated").textContent = "Stock data could not be loaded.";
    $("days").innerHTML = `<div class="panel empty">Stock data could not be loaded. Try again after the next data refresh.</div>`;
    return;
  }
  $("updated").textContent = "Updated " + new Date(M.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  if (window.startRain) window.startRain(M.stocks.filter((s) => s.cur === "USD").map((s) => s.s));

  const RANGES = [
    { id: "today", label: "Today", from: 0, to: 0 },
    { id: "tomorrow", label: "Tomorrow", from: 1, to: 1 },
    { id: "week", label: "7 days", from: 0, to: 6 },
    { id: "month", label: "30 days", from: 0, to: 29 },
  ];
  const state = { range: "week", market: "", size: "0", mine: false, ...store.get("earningsPage", {}) };
  if (!RANGES.some((r) => r.id === state.range)) state.range = "week";
  $("market").innerHTML += M.indexes.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
  $("market").value = state.market;
  $("size").value = state.size;
  $("mine").checked = state.mine;

  // Dates are kept as YYYY-MM-DD; "today" is the reader's own calendar day
  const now = new Date();
  const dayIso = (offset) => new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offset)).toISOString().slice(0, 10);
  const longDay = (k) => new Date(k + "T12:00:00Z").toLocaleDateString(undefined, { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  const shortDay = (k) => new Date(k + "T12:00:00Z").toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

  // Before the open, during trading or after the close, in the company's own exchange hours
  const EXCH = {
    USD: ["America/New_York", 570, 960], CAD: ["America/Toronto", 570, 960], JPY: ["Asia/Tokyo", 540, 930],
    KRW: ["Asia/Seoul", 540, 930], TWD: ["Asia/Taipei", 540, 810],
  };
  function when(s) {
    if (!s.earnAt || s.earnEst) return null;
    const ex = EXCH[s.cur];
    if (!ex) return null;
    const at = new Date(s.earnAt * 1000);
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ex[0], hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, x.value]));
    const mins = +p.hour * 60 + +p.minute;
    if (mins === 0) return null; // a date with no time given
    const local = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (mins < ex[1]) return { k: "pre", label: "Before open", local };
    if (mins >= ex[2]) return { k: "post", label: "After close", local };
    return { k: "mid", label: "During trading", local };
  }
  const whenHtml = (s) => {
    const w = when(s);
    if (w) return `<span class="er-when ${w.k}" title="Around ${esc(w.local)} your time">${w.label}</span>`;
    return s.earnEst ? `<span class="er-when est" title="Not yet confirmed by the company">Estimated</span>` : `<span class="muted">Time not given</span>`;
  };
  const rating = (v) => v == null ? "–" : `<span class="pill ${v <= 2.5 ? "buy" : v > 3.5 ? "sell" : ""}">${v <= 1.5 ? "Strong Buy" : v <= 2.5 ? "Buy" : v <= 3.5 ? "Hold" : "Sell"}</span>`;

  const cols = [
    { key: "name", label: "Company", left: true, sm: true, val: (r) => r.n,
      html: (r) => `<div class="co-row">${UI.star(r.t)}<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.n)}</a></span><span class="tk">${esc(r.s)} · ${esc(r.region)}${r.sector ? " · " + esc(r.sector) : ""}</span></div></div>` },
    { key: "when", label: "When", left: true, sm: true, title: "Report time, in the company's exchange hours", val: (r) => { const w = when(r); return w ? { pre: 1, mid: 2, post: 3 }[w.k] : 9; }, html: whenHtml },
    { key: "mcapUsd", label: "Mkt cap", val: (r) => r.mcapUsd, html: (r) => `<span class="num">${big(r.mcapUsd)}</span>` },
    { key: "p", label: "Price", val: (r) => r.p, html: (r) => `<span class="num">${money(r.p, r.cur)}</span>` },
    { key: "m1", label: "1M", sm: true, title: "Price change over the past month, going into the report", val: (r) => r.m1, html: (r) => pct(r.m1) },
    { key: "ytd", label: "YTD", val: (r) => r.ytd, html: (r) => pct(r.ytd) },
    { key: "fpe", label: "Fwd P/E", title: "Price ÷ next year's expected earnings per share", val: (r) => r.fpe, html: (r) => `<span class="num">${r.fpe != null ? r.fpe.toFixed(1) : "–"}</span>` },
    { key: "epsGrowth", label: "Last EPS growth", title: "Earnings growth in the latest reported quarter vs a year earlier", val: (r) => r.epsGrowth, html: (r) => pct(r.epsGrowth) },
    { key: "recMean", label: "Analysts", val: (r) => r.recMean, html: (r) => rating(r.recMean) },
    { key: "upside", label: "To target", title: "Gap to the average analyst price target", val: (r) => r.upside, html: (r) => pct(r.upside) },
    { key: "shortFloat", label: "Short", title: "Share of the float sold short. A high figure can mean a sharp move either way on the news", val: (r) => r.shortFloat, html: (r) => `<span class="num">${r.shortFloat != null ? r.shortFloat.toFixed(1) + "%" : "–"}</span>` },
  ];
  const sort = { key: "mcapUsd", dir: -1 };
  const PER_DAY = 25;
  const open = new Set(); // days showing every company

  function pool(r) {
    const mine = state.mine ? new Set(Watch.all().lists.flatMap((l) => l.tickers)) : null;
    const from = dayIso(r.from), to = dayIso(r.to), min = +state.size * 1e9;
    return M.stocks.filter((s) => s.earnings && s.earnings >= from && s.earnings <= to &&
      (!state.market || s.ix.includes(state.market)) && (s.mcapUsd || 0) >= min && (!mine || mine.has(s.t)));
  }

  function render() {
    store.set("earningsPage", state);
    const r = RANGES.find((x) => x.id === state.range);
    $("range").innerHTML = RANGES.map((x) => `<button role="tab" aria-selected="${x.id === r.id}" data-r="${x.id}">${x.label}</button>`).join("");
    const list = pool(r);
    const byDay = {};
    for (const s of list) (byDay[s.earnings] ||= []).push(s);
    const days = Object.keys(byDay).sort();

    // ---- summary
    const watched = new Set(Watch.all().lists.flatMap((l) => l.tickers));
    const mine = list.filter((s) => watched.has(s.t));
    const busiest = days.slice().sort((a, b) => byDay[b].length - byDay[a].length)[0];
    const confirmed = list.filter((s) => !s.earnEst).length;
    $("summary").innerHTML = `<div class="stats">
      <div class="stat"><div class="label">Reporting</div><div class="value num">${list.length}</div></div>
      <div class="stat"><div class="label">Worth $10B or more</div><div class="value num">${list.filter((s) => s.mcapUsd >= 10e9).length}</div></div>
      <div class="stat" title="Dates the companies have confirmed"><div class="label">Confirmed dates</div><div class="value num">${confirmed}</div></div>
      <div class="stat"><div class="label">On your watchlists</div><div class="value num">${mine.length}</div></div>
      ${days.length > 1 ? `<div class="stat"><div class="label">Busiest day</div><div class="value">${esc(shortDay(busiest))} <span class="muted num">(${byDay[busiest].length})</span></div></div>` : ""}
    </div>
    ${mine.length ? `<p class="er-mine">Your stocks: ${mine.sort((a, b) => a.earnings.localeCompare(b.earnings)).map((s) => `<a class="co-link" href="${stockUrl(s.t)}" title="${esc(s.n)}">${esc(s.s)}</a> <span class="muted">${esc(shortDay(s.earnings))}</span>`).join(" · ")}</p>` : ""}`;

    // ---- reports per day, for the longer ranges
    const span = [...Array(r.to - r.from + 1)].map((_, i) => dayIso(r.from + i));
    $("chart").hidden = span.length < 2 || !list.length;
    if (!$("chart").hidden) {
      const max = Math.max(1, ...span.map((k) => (byDay[k] || []).length));
      $("chart").innerHTML = `<h3>Reports per day</h3><div class="er-bars ${span.length > 10 ? "many" : ""}">${span.map((k, i) => {
        const n = (byDay[k] || []).length, d = new Date(k + "T12:00:00Z"), wkend = d.getUTCDay() % 6 === 0;
        return `<button class="er-bar ${wkend ? "wkend" : ""} ${i % 5 === 0 ? "lbl" : ""}" data-day="${k}" ${n ? "" : "disabled"} title="${esc(longDay(k))}: ${n} report${n === 1 ? "" : "s"}">
          <span class="er-n num">${n || ""}</span><i style="height:${(n / max * 100).toFixed(1)}%"></i>
          <span class="er-d">${d.toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric" })}<b>${d.toLocaleDateString(undefined, { timeZone: "UTC", weekday: "narrow" })}</b></span></button>`;
      }).join("")}</div>`;
    }

    // ---- one table per day
    if (!days.length) {
      const next = M.stocks.filter((s) => s.earnings && s.earnings > dayIso(r.to)).map((s) => s.earnings).sort()[0];
      $("days").innerHTML = `<div class="panel empty">No earnings reports ${r.id === "today" ? "today" : r.id === "tomorrow" ? "tomorrow" : "in this period"}${state.mine ? " for stocks on your watchlists" : ""}${state.market ? " in this market" : ""}${+state.size ? " at this size" : ""}.${next && !state.mine && !state.market && !+state.size ? ` The next reports are on ${esc(longDay(next))}.` : ""}</div>`;
      return;
    }
    $("days").innerHTML = days.map((k) => `<section class="er-day" id="d-${k}">
      <div class="subhead"><h3>${esc(longDay(k))}${k === dayIso(0) ? ' <span class="pill">Today</span>' : ""} <span class="muted">· ${byDay[k].length} ${byDay[k].length === 1 ? "company" : "companies"}</span></h3></div>
      <div class="panel table-wrap" data-t="${k}"></div></section>`).join("");
    for (const k of days) {
      const el = document.querySelector(`[data-t="${k}"]`);
      const rows = byDay[k].slice().sort((a, b) => (b.mcapUsd || 0) - (a.mcapUsd || 0));
      const shown = open.has(k) ? rows : rows.slice(0, r.id === "month" ? 10 : PER_DAY);
      UI.table(el, cols, shown, sort, { onSort: () => { render(); return true; } });
      if (rows.length > shown.length) {
        el.insertAdjacentHTML("beforeend", `<p class="hint pad">Showing the ${shown.length} largest of ${rows.length}. <button class="btn small" data-all="${k}">Show all</button></p>`);
      }
    }
  }

  $("range").addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (b) { state.range = b.dataset.r; render(); } });
  $("market").addEventListener("change", () => { state.market = $("market").value; render(); });
  $("size").addEventListener("change", () => { state.size = $("size").value; render(); });
  $("mine").addEventListener("change", () => { state.mine = $("mine").checked; render(); });
  $("days").addEventListener("click", (e) => { const b = e.target.closest("[data-all]"); if (b) { open.add(b.dataset.all); render(); } });
  $("chart").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    const sec = b && $("d-" + b.dataset.day);
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  window.addEventListener("watchlists", render);
  render();
})();
