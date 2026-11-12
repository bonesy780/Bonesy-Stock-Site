(async function () {
  const { esc, money, pct, big, stockUrl, store, Watch } = UI;
  const $ = (id) => document.getElementById(id);

  let M;
  try {
    M = await UI.market();
  } catch (e) {
    $("updated").textContent = "Stock data could not be loaded.";
    $("week").innerHTML = `<div class="panel empty">Stock data could not be loaded. Try again after the next data refresh.</div>`;
    return;
  }
  $("updated").textContent = "Updated " + new Date(M.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  if (window.startRain) window.startRain(M.stocks.filter((s) => s.cur === "USD").map((s) => s.s));

  const KINDS = { earnings: "Earnings", exDiv: "Ex-dividend" };
  const state = { kind: "earnings", market: "", mine: false, ...store.get("calendar", {}) };
  if (!KINDS[state.kind]) state.kind = "earnings";
  $("market").innerHTML += M.indexes.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
  $("market").value = state.market;
  $("mine").checked = state.mine;

  const iso = (d) => d.toISOString().slice(0, 10);
  const mondayOf = (d) => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };
  const thisMonday = mondayOf(new Date());
  let monday = new Date(thisMonday);
  const todayIso = iso(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())));

  function pool() {
    const mine = state.mine ? new Set(Watch.all().lists.flatMap((l) => l.tickers)) : null;
    return M.stocks.filter((s) => s[state.kind] && (!state.market || s.ix.includes(state.market)) && (!mine || mine.has(s.t)));
  }

  function render() {
    store.set("calendar", state);
    $("kind").innerHTML = Object.entries(KINDS).map(([k, l]) => `<button role="tab" aria-selected="${k === state.kind}" data-k="${k}">${l}</button>`).join("");
    const days = [...Array(7)].map((_, i) => { const d = new Date(monday); d.setUTCDate(d.getUTCDate() + i); return d; });
    const fmt = (d, o) => d.toLocaleDateString(undefined, { timeZone: "UTC", ...o });
    $("week-label").textContent = `${fmt(days[0], { month: "short", day: "numeric" })} – ${fmt(days[6], { month: "short", day: "numeric", year: "numeric" })}`;
    $("this").setAttribute("aria-selected", String(+monday === +thisMonday));

    const list = pool();
    const byDay = {};
    for (const s of list) (byDay[s[state.kind]] ||= []).push(s);
    // Weekdays, plus the weekend only when something falls on it
    const shown = days.filter((d, i) => i < 5 || (byDay[iso(d)] || []).length);
    $("week").innerHTML = shown.map((d) => {
      const k = iso(d), items = (byDay[k] || []).sort((a, b) => (b.mcapUsd || 0) - (a.mcapUsd || 0));
      const top = items.slice(0, 14);
      return `<section class="panel cal-day ${k === todayIso ? "today" : ""} ${k < todayIso ? "past" : ""}">
        <h3>${fmt(d, { weekday: "short" })} <span>${fmt(d, { month: "short", day: "numeric" })}</span>${items.length ? `<em>${items.length}</em>` : ""}</h3>
        ${top.length ? `<ul>${top.map((s) => `<li><a href="${stockUrl(s.t)}" title="${esc(s.n)} · ${big(s.mcapUsd)}"><b>${esc(s.s)}</b><span>${esc(s.n)}</span></a>${state.kind === "exDiv" && s.divYield != null ? `<i class="num">${s.divYield.toFixed(1)}%</i>` : ""}</li>`).join("")}</ul>` : `<p class="muted">Nothing scheduled</p>`}
        ${items.length > top.length ? `<p class="hint">+${items.length - top.length} more below</p>` : ""}
      </section>`;
    }).join("");

    const weekItems = list.filter((s) => s[state.kind] >= iso(days[0]) && s[state.kind] <= iso(days[6]));
    $("list-title").textContent = `${KINDS[state.kind]} this week in detail (${weekItems.length})`;
    $("list-help").textContent = state.kind === "earnings"
      ? "How each stock has done lately and what analysts expect going in. Big companies first."
      : "Buy before the ex-dividend date to receive the next payment. The price usually drops by about the dividend on that day.";
    const cols = [
      { key: "date", label: "Date", left: true, sm: true, val: (r) => r[state.kind] + String(1e15 - (r.mcapUsd || 0)).padStart(16, "0"),
        html: (r) => `<span class="num">${new Date(r[state.kind] + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>` },
      { key: "name", label: "Company", left: true, sm: true, val: (r) => r.n,
        html: (r) => `<div class="co-row">${UI.star(r.t)}<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.n)}</a></span><span class="tk">${esc(r.s)} · ${esc(r.region)}${r.sector ? " · " + esc(r.sector) : ""}</span></div></div>` },
      { key: "p", label: "Price", val: (r) => r.p, html: (r) => `<span class="num">${money(r.p, r.cur)}</span>` },
      { key: "mcapUsd", label: "Mkt cap", val: (r) => r.mcapUsd, html: (r) => `<span class="num">${big(r.mcapUsd)}</span>` },
    ];
    if (state.kind === "earnings") {
      cols.push(
        { key: "m1", label: "1M", val: (r) => r.m1, html: (r) => pct(r.m1) },
        { key: "ytd", label: "YTD", val: (r) => r.ytd, html: (r) => pct(r.ytd) },
        { key: "fpe", label: "Fwd P/E", val: (r) => r.fpe, html: (r) => `<span class="num">${r.fpe != null ? r.fpe.toFixed(1) : "–"}</span>` },
        { key: "epsGrowth", label: "Last EPS growth", title: "Earnings growth in the latest reported quarter vs a year earlier", val: (r) => r.epsGrowth, html: (r) => pct(r.epsGrowth) },
        { key: "recMean", label: "Analysts", val: (r) => r.recMean, html: (r) => r.recMean == null ? "–" : `<span class="pill ${r.recMean <= 2.5 ? "buy" : r.recMean > 3.5 ? "sell" : ""}">${r.recMean <= 1.5 ? "Strong Buy" : r.recMean <= 2.5 ? "Buy" : r.recMean <= 3.5 ? "Hold" : "Sell"}</span>` },
        { key: "volat", label: "Volatility", title: "How much the price usually swings (yearly %, from the last 3 months)", val: (r) => r.volat, html: (r) => `<span class="num">${r.volat != null ? r.volat.toFixed(0) + "%" : "–"}</span>` },
      );
    } else {
      cols.push(
        { key: "divYield", label: "Yield", sm: true, val: (r) => r.divYield, html: (r) => `<span class="num">${r.divYield != null ? r.divYield.toFixed(2) + "%" : "–"}</span>` },
        { key: "divRate", label: "Per share / yr", val: (r) => r.divRate, html: (r) => `<span class="num">${r.divRate != null ? money(r.divRate, r.cur) : "–"}</span>` },
        { key: "payout", label: "Payout", title: "Share of earnings paid out", val: (r) => r.payout, html: (r) => `<span class="num">${r.payout != null ? r.payout.toFixed(0) + "%" : "–"}</span>` },
        { key: "ytd", label: "YTD", val: (r) => r.ytd, html: (r) => pct(r.ytd) },
      );
    }
    UI.table($("table"), cols, weekItems, sort, { empty: `No ${KINDS[state.kind].toLowerCase()} dates this week${state.mine ? " for stocks on your watchlists" : ""}${state.market ? " in this market" : ""}.` });
  }
  const sort = { key: "date", dir: 1 };

  $("kind").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.kind = b.dataset.k; render(); } });
  $("prev").addEventListener("click", () => { monday.setUTCDate(monday.getUTCDate() - 7); render(); });
  $("next").addEventListener("click", () => { monday.setUTCDate(monday.getUTCDate() + 7); render(); });
  $("this").addEventListener("click", () => { monday = new Date(thisMonday); render(); });
  $("market").addEventListener("change", () => { state.market = $("market").value; render(); });
  $("mine").addEventListener("change", () => { state.mine = $("mine").checked; render(); });
  window.addEventListener("watchlists", () => { if (state.mine) render(); });
  render();
})();
