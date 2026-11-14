(async function () {
  const { esc, money, pct, big, compact, spark, stockUrl, store } = UI;
  const $ = (id) => document.getElementById(id);

  let M;
  try {
    M = await UI.market();
  } catch (e) {
    $("updated").textContent = "Stock data could not be loaded.";
    $("table").innerHTML = `<div class="empty">Stock data could not be loaded. Try again after the next data refresh.</div>`;
    return;
  }
  $("updated").textContent = "Updated " + new Date(M.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  const PERIODS = { d1: "today", w1: "this week", m1: "this month", m3: "over 3 months", ytd: "this year" };
  const VIEWS = [
    { id: "gainers", label: "Gainers", period: true, sort: (k) => [(s) => s[k], -1], keep: (s, k) => s[k] > 0,
      explain: (k) => `Stocks up the most ${PERIODS[k]}.` },
    { id: "losers", label: "Losers", period: true, sort: (k) => [(s) => s[k], 1], keep: (s, k) => s[k] < 0,
      explain: (k) => `Stocks down the most ${PERIODS[k]}.` },
    { id: "active", label: "Most active", sort: () => [(s) => s.dollarVolUsd, -1], keep: (s) => s.dollarVolUsd,
      explain: () => "The most money traded in the last session (shares traded × price, in US dollars)." },
    { id: "volume", label: "Unusual volume", sort: () => [(s) => s.relVol, -1], keep: (s) => s.relVol >= 1.5,
      explain: () => "Shares traded in the last session compared with the 50-day average. Heavy volume often comes with news, earnings or a big trader buying or selling." },
    { id: "gaps", label: "Gaps", sort: () => [(s) => Math.abs(gap(s)), -1], keep: (s) => gap(s) != null && Math.abs(gap(s)) >= 1,
      explain: () => "The biggest jumps between the previous close and the next open, up or down. Gaps usually follow overnight news." },
    { id: "highs", label: "52W highs", sort: () => [(s) => s.fromHi, -1], keep: (s) => s.fromHi != null && s.fromHi >= -1,
      explain: () => "Within 1% of their highest price of the past year. Stocks making new highs often keep going for a while (momentum)." },
    { id: "lows", label: "52W lows", sort: () => [(s) => s.fromLo, 1], keep: (s) => s.fromLo != null && s.fromLo <= 1,
      explain: () => "Within 1% of their lowest price of the past year." },
    { id: "shorted", label: "Most shorted", sort: () => [(s) => s.shortFloat, -1], keep: (s) => s.shortFloat >= 5,
      explain: () => "The largest share of tradable stock sold short, meaning traders are betting the price will fall. Heavily shorted stocks can jump sharply if short sellers rush to buy back (a short squeeze). Mostly US stocks; short data is updated twice a month." },
    { id: "oversold", label: "Oversold", sort: () => [(s) => s.rsi, 1], keep: (s) => s.rsi != null && s.rsi < 30,
      explain: () => "RSI under 30: the stock fell fast enough that some traders expect a bounce. Falling stocks can keep falling, so this isn't a buy signal on its own." },
    { id: "overbought", label: "Overbought", sort: () => [(s) => s.rsi, -1], keep: (s) => s.rsi != null && s.rsi > 70,
      explain: () => "RSI over 70: the stock rose fast enough that some traders expect a pause or pullback. Strong stocks can stay overbought for a long time." },
  ];
  const gap = (s) => (s.o != null && s.pc ? (s.o / s.pc - 1) * 100 : null);

  const state = { market: "all", view: "gainers", period: "d1", size: "2", ...store.get("movers", {}) };
  if (!VIEWS.some((v) => v.id === state.view)) state.view = "gainers";
  const save = () => store.set("movers", state);
  $("period").value = state.period;
  $("size").value = state.size;

  const inMarket = (s) => state.market === "all" || s.ix.includes(state.market);
  const bigEnough = (s) => (s.mcapUsd || 0) >= +state.size * 1e9;

  // Market breadth: how many stocks rose and fell, and how many sit above their averages
  function breadth() {
    const list = M.stocks.filter(inMarket);
    const up = list.filter((s) => s.d1 > 0).length, down = list.filter((s) => s.d1 < 0).length;
    const share = (f) => { const n = list.filter((s) => f(s) != null); return n.length ? n.filter((s) => f(s)).length / n.length * 100 : null; };
    const a50 = share((s) => (s.sma50 == null ? null : s.p > s.sma50));
    const a200 = share((s) => (s.sma200 == null ? null : s.p > s.sma200));
    const highs = list.filter((s) => s.fromHi >= -1).length, lows = list.filter((s) => s.fromLo <= 1).length;
    const avg = list.filter((s) => s.d1 != null);
    const mean = avg.length ? avg.reduce((a, s) => a + s.d1, 0) / avg.length : null;
    const bar = up + down ? up / (up + down) * 100 : 50;
    $("breadth").innerHTML = `
      <div class="breadth-bar" title="${up} stocks rose and ${down} fell"><span class="up-part" style="width:${bar.toFixed(1)}%"></span></div>
      <div class="stats">
        <div class="stat"><div class="label">Advancing</div><div class="value num up">${up}</div></div>
        <div class="stat"><div class="label">Declining</div><div class="value num down">${down}</div></div>
        <div class="stat"><div class="label">Average move</div><div class="value">${pct(mean, 2)}</div></div>
        <div class="stat" title="Share of stocks trading above their 50-day average price"><div class="label">Above 50-day avg</div><div class="value num">${a50 == null ? "–" : a50.toFixed(0) + "%"}</div></div>
        <div class="stat" title="Share of stocks trading above their 200-day average price"><div class="label">Above 200-day avg</div><div class="value num">${a200 == null ? "–" : a200.toFixed(0) + "%"}</div></div>
        <div class="stat"><div class="label">52W highs / lows</div><div class="value num">${highs} / ${lows}</div></div>
      </div>`;
  }

  function render() {
    $("markets").innerHTML = [{ id: "all", name: "All markets" }].concat(M.indexes).map((i) =>
      `<button class="tab" role="tab" aria-selected="${i.id === state.market}" data-id="${i.id}">${esc(i.name)}</button>`).join("");
    $("views").innerHTML = VIEWS.map((v) => `<button role="tab" aria-selected="${v.id === state.view}" data-v="${v.id}">${esc(v.label)}</button>`).join("");
    const view = VIEWS.find((v) => v.id === state.view);
    $("period-wrap").hidden = !view.period;
    const k = view.period ? state.period : "d1";
    $("explain").textContent = view.explain(k) + ` Companies worth ${$("size").selectedOptions[0].textContent.replace("Over", "over")}.`;
    breadth();

    const [by, dir] = view.sort(k);
    const rows = M.stocks.filter((s) => inMarket(s) && bigEnough(s) && view.keep(s, k))
      .sort((a, b) => ((by(a) ?? -Infinity) - (by(b) ?? -Infinity)) * dir).slice(0, 30)
      .map((s, n) => ({ ...s, rank: n + 1 }));
    const label = { d1: "Day", w1: "1W", m1: "1M", m3: "3M", ytd: "YTD" }[k];
    const cols = [
      { key: "rank", label: "#", html: (r) => `<span class="num muted">${r.rank}</span>` },
      { key: "name", label: "Company", left: true, sm: true,
        html: (r) => `<div class="co-row">${UI.star(r.t)}<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.n)}</a></span><span class="tk">${esc(r.s)} · ${esc(r.region)}${r.sector ? " · " + esc(r.sector) : ""}</span></div></div>` },
      { key: "p", label: "Price", sm: true, html: (r) => `<span class="num">${money(r.p, r.cur)}</span>` },
      { key: "chg", label: view.period ? label : "Day", sm: true, html: (r) => pct(r[k], view.period && k !== "d1" ? 1 : 2) },
    ];
    if (view.id === "gaps") cols.push({ key: "gap", label: "Gap", sm: true, html: (r) => pct(gap(r), 2) });
    if (view.id === "shorted") cols.push({ key: "short", label: "Short % of float", sm: true, html: (r) => `<span class="num">${r.shortFloat.toFixed(1)}%</span>` });
    if (view.id === "highs" || view.id === "lows") cols.push({ key: "rng", label: view.id === "highs" ? "52W high" : "52W low", html: (r) => `<span class="num">${money(view.id === "highs" ? r.hi52 : r.lo52, r.cur)}</span>` });
    cols.push(
      { key: "vol", label: "Volume", sm: view.id === "volume", html: (r) => `<span class="num">${compact(r.vol)}</span>${r.relVol >= 1.5 ? ` <span class="num up">${r.relVol.toFixed(1)}×</span>` : ""}` },
      { key: "dv", label: "Traded (USD)", sm: view.id === "active", html: (r) => `<span class="num">${big(r.dollarVolUsd)}</span>` },
      { key: "w1", label: "1W", html: (r) => pct(r.w1) },
      { key: "ytd", label: "YTD", html: (r) => pct(r.ytd) },
      { key: "mcap", label: "Mkt cap", html: (r) => `<span class="num">${big(r.mcapUsd)}</span>` },
      { key: "rsi", label: "RSI", title: "14-day RSI: over 70 is often called overbought, under 30 oversold",
        html: (r) => r.rsi == null ? "–" : `<span class="num ${r.rsi >= 70 ? "down" : r.rsi <= 30 ? "up" : ""}" title="14-day RSI">${r.rsi.toFixed(0)}</span>` },
      { key: "spark", label: "1M trend", html: (r) => spark(r.spark, 80, 24) },
    );
    UI.table($("table"), cols, rows, { key: null, dir: 1 }, { empty: "No stocks fit this list right now. Try another market or a smaller company size." });
  }

  const asof = M.stocks.map((s) => s.asOf).filter(Boolean).sort().pop();
  if (asof) $("asof").textContent = `Based on the last close (${new Date(asof + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}).`;

  $("markets").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) { state.market = b.dataset.id; save(); render(); } });
  $("views").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.view = b.dataset.v; save(); render(); } });
  $("period").addEventListener("change", () => { state.period = $("period").value; save(); render(); });
  $("size").addEventListener("change", () => { state.size = $("size").value; save(); render(); });
  render();
})();
