(async function () {
  const { esc, money, pct, big, stockUrl, store } = UI;
  const $ = (id) => document.getElementById(id);

  let M;
  try {
    M = await UI.market();
  } catch (e) {
    $("updated").textContent = "Stock data could not be loaded.";
    $("cards").innerHTML = `<div class="panel empty">Stock data could not be loaded. Try again after the next data refresh.</div>`;
    return;
  }
  $("updated").textContent = "Updated " + new Date(M.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  // tone: up = bullish, down = bearish, flat = watch either way
  const SIGNALS = [
    ["goldenCross", "Golden cross", "up", "The 50-day average crossed above the 200-day average in the last 2 weeks. Seen as the start of a longer uptrend."],
    ["above200", "Back above 200-day", "up", "The price closed back above its 200-day average in the last 3 days, often read as the long-term trend turning up."],
    ["above50", "Back above 50-day", "up", "The price closed back above its 50-day average in the last 3 days, a sign the medium-term trend is improving."],
    ["macdBull", "MACD bullish cross", "up", "The MACD line crossed above its signal line in the last 3 days, meaning upward momentum is building."],
    ["high20", "20-day breakout", "up", "Closed above every close of the previous 20 sessions. Breakouts to new highs often keep going for a while."],
    ["volUp", "Volume surge up", "up", "Rose 2% or more on more than twice the usual volume, a sign of strong buying, often on news."],
    ["rsiRebound", "RSI rebound", "up", "RSI climbed back above 30 after being oversold, which some traders read as selling pressure easing."],
    ["oversold", "Oversold (RSI under 30)", "flat", "Fell fast enough that RSI is under 30. Oversold stocks sometimes bounce, but a falling stock can keep falling."],
    ["squeeze", "Bollinger squeeze", "flat", "The Bollinger Bands are the narrowest in 6 months. Quiet stretches like this often come before a big move, in either direction."],
    ["overbought", "Overbought (RSI over 70)", "flat", "Rose fast enough that RSI is over 70. Strong stocks can stay overbought, but pullbacks are common."],
    ["deathCross", "Death cross", "down", "The 50-day average crossed below the 200-day average in the last 2 weeks. Seen as the start of a longer downtrend."],
    ["below200", "Broke below 200-day", "down", "The price closed below its 200-day average in the last 3 days, often read as the long-term trend turning down."],
    ["below50", "Broke below 50-day", "down", "The price closed below its 50-day average in the last 3 days."],
    ["macdBear", "MACD bearish cross", "down", "The MACD line crossed below its signal line in the last 3 days, meaning momentum is fading."],
    ["low20", "20-day breakdown", "down", "Closed below every close of the previous 20 sessions."],
    ["volDown", "Volume surge down", "down", "Fell 2% or more on more than twice the usual volume, a sign of heavy selling."],
  ];

  const state = { market: "all", size: "2", open: null, ...store.get("signals", {}) };
  $("size").value = state.size;
  const list = () => M.stocks.filter((s) => (state.market === "all" || s.ix.includes(state.market)) && (s.mcapUsd || 0) >= +state.size * 1e9 && s.sig);

  function render() {
    store.set("signals", state);
    $("markets").innerHTML = [{ id: "all", name: "All markets" }].concat(M.indexes).map((i) =>
      `<button class="tab" role="tab" aria-selected="${i.id === state.market}" data-id="${i.id}">${esc(i.name.replace(/ \(.*\)/, ""))}</button>`).join("");
    const pool = list();
    $("cards").innerHTML = SIGNALS.map(([id, title, tone, help]) => {
      const hits = pool.filter((s) => s.sig.includes(id)).sort((a, b) => (b.mcapUsd || 0) - (a.mcapUsd || 0));
      return `<section class="panel sig-card ${tone} ${state.open === id ? "on" : ""}">
        <div class="sig-top"><h3>${esc(title)}</h3><span class="sig-count">${hits.length}</span></div>
        <p class="hint">${esc(help)}</p>
        ${hits.length ? `<div class="sig-names">${hits.slice(0, 8).map((s) => `<a href="${stockUrl(s.t)}" title="${esc(s.n)}">${esc(s.s)} ${pct(s.d1)}</a>`).join("")}</div>` : `<p class="muted">No stocks today.</p>`}
        ${hits.length ? `<button class="btn small" data-open="${id}">${state.open === id ? "Showing below" : `See all ${hits.length}`}</button>` : ""}
      </section>`;
    }).join("");
    detail(pool);
  }

  function detail(pool) {
    const sig = SIGNALS.find((x) => x[0] === state.open);
    if (!sig) { $("table").hidden = true; $("detail-head").innerHTML = ""; return; }
    const rows = pool.filter((s) => s.sig.includes(sig[0]));
    $("detail-head").innerHTML = `<h3>${esc(sig[1])}: ${rows.length} stocks</h3><p>${esc(sig[3])}</p>`;
    $("table").hidden = false;
    const names = Object.fromEntries(SIGNALS.map((x) => [x[0], x]));
    UI.table($("table"), [
      { key: "name", label: "Company", left: true, sm: true, val: (r) => r.n,
        html: (r) => `<div class="co-row">${UI.star(r.t)}<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.n)}</a></span><span class="tk">${esc(r.s)} · ${esc(r.region)}${r.sector ? " · " + esc(r.sector) : ""}</span></div></div>` },
      { key: "p", label: "Price", sm: true, val: (r) => r.p, html: (r) => `<span class="num">${money(r.p, r.cur)}</span>` },
      { key: "d1", label: "Day", sm: true, val: (r) => r.d1, html: (r) => pct(r.d1, 2) },
      { key: "m1", label: "1M", val: (r) => r.m1, html: (r) => pct(r.m1) },
      { key: "rsi", label: "RSI", val: (r) => r.rsi, html: (r) => `<span class="num">${r.rsi != null ? r.rsi.toFixed(0) : "–"}</span>` },
      { key: "relVol", label: "Rel. volume", val: (r) => r.relVol, html: (r) => `<span class="num">${r.relVol != null ? r.relVol.toFixed(1) + "×" : "–"}</span>` },
      { key: "mcapUsd", label: "Mkt cap", val: (r) => r.mcapUsd, html: (r) => `<span class="num">${big(r.mcapUsd)}</span>` },
      { key: "other", label: "Other signals", left: true, html: (r) => r.sig.filter((x) => x !== sig[0]).map((x) => names[x] ? `<span class="tag sig-${names[x][2]}">${esc(names[x][1])}</span>` : "").join(" ") || "–" },
      { key: "spark", label: "1M trend", html: (r) => UI.spark(r.spark, 80, 24) },
    ], rows, sort, {});
  }
  const sort = { key: "mcapUsd", dir: -1 };

  $("markets").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) { state.market = b.dataset.id; render(); } });
  $("size").addEventListener("change", () => { state.size = $("size").value; render(); });
  $("cards").addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (!b) return;
    state.open = b.dataset.open; render();
    $("detail-head").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  render();
})();
