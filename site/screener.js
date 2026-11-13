(async function () {
  const { esc, money, pct, big, compact, fixed, spark, stockUrl, store } = UI;
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
  if (window.startRain) window.startRain(M.stocks.filter((s) => s.cur === "USD").map((s) => s.s));

  // Each filter works on one number. unit: "B" means billions of US dollars, "%" a percent, "x" a ratio
  const F = [
    { k: "mcapUsd", label: "Market cap", unit: "B", scale: 1e9, group: "Size", help: "Company value in billions of US dollars" },
    { k: "dollarVolUsd", label: "Dollars traded", unit: "M", scale: 1e6, group: "Size", help: "Last session's trading in millions of US dollars. Higher means easier to buy and sell" },
    { k: "pe", label: "P/E", unit: "x", group: "Valuation", help: "Price ÷ last 12 months' earnings per share. Lower can mean cheaper" },
    { k: "fpe", label: "Forward P/E", unit: "x", group: "Valuation", help: "Price ÷ expected earnings per share over the next year" },
    { k: "peg", label: "PEG", unit: "x", group: "Valuation", help: "P/E ÷ expected earnings growth. Under 1 is often seen as cheap for its growth" },
    { k: "pb", label: "Price / book", unit: "x", group: "Valuation", help: "Price ÷ the company's net assets per share" },
    { k: "ps", label: "Price / sales", unit: "x", group: "Valuation", help: "Market value ÷ the last 12 months' revenue" },
    { k: "evEbitda", label: "EV / EBITDA", unit: "x", group: "Valuation", help: "Company value including debt ÷ yearly operating profit before depreciation" },
    { k: "revGrowth", label: "Revenue growth", unit: "%", group: "Growth and profit", help: "Latest quarter's revenue vs the same quarter a year ago" },
    { k: "epsGrowth", label: "Earnings growth", unit: "%", group: "Growth and profit", help: "Latest quarter's earnings vs the same quarter a year ago" },
    { k: "margin", label: "Profit margin", unit: "%", group: "Growth and profit", help: "Share of revenue left as profit" },
    { k: "roe", label: "Return on equity", unit: "%", group: "Growth and profit", help: "Yearly profit ÷ shareholders' equity" },
    { k: "de", label: "Debt / equity", unit: "%", group: "Growth and profit", help: "Total debt as a percent of shareholders' equity. Lower is less borrowed money" },
    { k: "divYield", label: "Dividend yield", unit: "%", group: "Dividends", help: "Yearly dividend ÷ price", zero: true },
    { k: "payout", label: "Payout ratio", unit: "%", group: "Dividends", help: "Share of earnings paid out as dividends. Very high can mean the dividend is at risk" },
    { k: "d1", label: "Change today", unit: "%", group: "Performance" },
    { k: "w1", label: "Change 1 week", unit: "%", group: "Performance" },
    { k: "m1", label: "Change 1 month", unit: "%", group: "Performance" },
    { k: "m3", label: "Change 3 months", unit: "%", group: "Performance" },
    { k: "m6", label: "Change 6 months", unit: "%", group: "Performance" },
    { k: "y1", label: "Change 1 year", unit: "%", group: "Performance" },
    { k: "ytd", label: "Change YTD", unit: "%", group: "Performance" },
    { k: "fromHi", label: "From 52W high", unit: "%", group: "Technicals", help: "How far below the 52-week high, e.g. -10 means 10% below" },
    { k: "fromLo", label: "From 52W low", unit: "%", group: "Technicals", help: "How far above the 52-week low" },
    { k: "rsi", label: "RSI (14)", unit: "", group: "Technicals", help: "Momentum from 0 to 100. Over 70 is often called overbought, under 30 oversold" },
    { k: "vsSma50", label: "vs 50-day avg", unit: "%", group: "Technicals", help: "Price compared with its 50-day average", get: (s) => (s.sma50 ? (s.p / s.sma50 - 1) * 100 : null) },
    { k: "vsSma200", label: "vs 200-day avg", unit: "%", group: "Technicals", help: "Price compared with its 200-day average", get: (s) => (s.sma200 ? (s.p / s.sma200 - 1) * 100 : null) },
    { k: "relVol", label: "Relative volume", unit: "x", group: "Technicals", help: "Last session's volume ÷ the 50-day average" },
    { k: "volat", label: "Volatility", unit: "%", group: "Technicals", help: "How much the price swings, as a yearly percent from the last 3 months of daily moves" },
    { k: "beta", label: "Beta", unit: "", group: "Technicals", help: "How much the stock tends to move with the market. 1 = same as the market" },
    { k: "recMean", label: "Analyst rating", unit: "", group: "Analysts", help: "Average rating from 1 (strong buy) to 5 (sell)" },
    { k: "analysts", label: "Number of analysts", unit: "", group: "Analysts" },
    { k: "upside", label: "Upside to target", unit: "%", group: "Analysts", help: "Average analyst price target vs today's price" },
    { k: "shortFloat", label: "Short interest", unit: "%", group: "Analysts", help: "Share of tradable shares sold short (bets the price will fall)" },
  ];
  const FK = Object.fromEntries(F.map((f) => [f.k, f]));
  const val = (s, f) => {
    const v = f.get ? f.get(s) : s[f.k];
    if (v == null && f.zero) return 0;
    return v == null ? null : f.scale ? v / f.scale : v;
  };

  const PRESETS = [
    { name: "Value", help: "Cheap on earnings and book value, still profitable", f: { pe: [0, 15], pb: [null, 3], margin: [5, null], mcapUsd: [2, null] } },
    { name: "Dividend income", help: "Yield over 3% with a payout the company can afford", f: { divYield: [3, null], payout: [null, 80], mcapUsd: [2, null] } },
    { name: "Growth", help: "Revenue and earnings growing over 15% a year", f: { revGrowth: [15, null], epsGrowth: [15, null], mcapUsd: [2, null] } },
    { name: "Momentum", help: "Rising over 3 and 6 months, above the 50- and 200-day averages", f: { m3: [10, null], m6: [15, null], vsSma50: [0, null], vsSma200: [0, null] } },
    { name: "Oversold", help: "RSI under 30: sold hard lately, sometimes due a bounce", f: { rsi: [null, 30], mcapUsd: [2, null] } },
    { name: "Near 52W high", help: "Within 3% of the year's high", f: { fromHi: [-3, null], mcapUsd: [2, null] } },
    { name: "Analyst favourites", help: "Rated Buy or better by 10+ analysts with 15%+ upside", f: { recMean: [null, 2], analysts: [10, null], upside: [15, null] } },
    { name: "Quality", help: "High return on equity and margins, modest debt", f: { roe: [20, null], margin: [15, null], de: [null, 100] } },
    { name: "Low volatility", help: "Calm stocks that swing less than the market", f: { volat: [null, 20], beta: [null, 0.8], mcapUsd: [10, null] } },
    { name: "Mega caps", help: "Companies worth over $200B", f: { mcapUsd: [200, null] } },
  ];

  const VIEWS = {
    Overview: ["p", "d1", "mcapUsd", "pe", "divYield", "recMean", "spark"],
    Valuation: ["p", "pe", "fpe", "peg", "pb", "ps", "evEbitda"],
    Growth: ["revGrowth", "epsGrowth", "margin", "roe", "de"],
    Performance: ["d1", "w1", "m1", "m3", "m6", "y1", "ytd"],
    Dividends: ["p", "divYield", "divRate", "payout", "exDiv"],
    Technicals: ["p", "rsi", "vsSma50", "vsSma200", "fromHi", "relVol", "volat", "beta"],
    Analysts: ["p", "recMean", "analysts", "target", "upside", "shortFloat", "earnings"],
  };
  const fmt = (k, s) => {
    const f = FK[k], v = f ? (f.get ? f.get(s) : s[k]) : s[k];
    if (k === "p") return `<span class="num">${money(s.p, s.cur)}</span>`;
    if (k === "target") return `<span class="num">${money(s.target, s.cur)}</span>`;
    if (k === "divRate") return `<span class="num">${s.divRate != null ? money(s.divRate, s.cur) : "–"}</span>`;
    if (k === "spark") { const a = trendPts(s); return a ? `<span title="${esc(trendName())}: ${(trendChg(s) ?? 0).toFixed(1)}%">${spark(a, 80, 24)}</span>` : '<span class="num">–</span>'; }
    if (k === "mcapUsd" || k === "dollarVolUsd") return `<span class="num">${big(v)}</span>`;
    if (k === "exDiv" || k === "earnings") return v ? new Date(v + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "–";
    if (k === "recMean") return v == null ? "–" : `<span class="pill ${v <= 2.5 ? "buy" : v > 3.5 ? "sell" : ""}">${v <= 1.5 ? "Strong Buy" : v <= 2.5 ? "Buy" : v <= 3.5 ? "Hold" : "Sell"} <span class="num">${v.toFixed(1)}</span></span>`;
    if (["d1", "w1", "m1", "m3", "m6", "y1", "ytd", "upside", "vsSma50", "vsSma200", "fromHi", "fromLo", "revGrowth", "epsGrowth"].includes(k)) return pct(v);
    if (k === "divYield") return `<span class="num">${v != null ? v.toFixed(2) + "%" : "–"}</span>`;
    if (f && f.unit === "%") return `<span class="num">${v != null ? v.toFixed(1) + "%" : "–"}</span>`;
    if (f && f.unit === "x") return `<span class="num">${v != null ? v.toFixed(1) + "×" : "–"}</span>`;
    if (k === "analysts") return `<span class="num">${v ?? "–"}</span>`;
    return `<span class="num">${fixed(v, k === "beta" ? 2 : 0)}</span>`;
  };
  // The trend column can show 1 month (from market.json) or longer periods (from trends.json, loaded when asked for)
  const TRENDS = [["m1", "1M"], ["m6", "6M"], ["y1", "12M"], ["ytd", "YTD"], ["y5", "5Y"], ["y10", "10Y"], ["all", "All time"]];
  let T = null;
  const trendName = () => (TRENDS.find((x) => x[0] === S.trend) || TRENDS[0])[1] + " trend";
  const trendPts = (s) => (S.trend === "m1" ? s.spark : T && T[s.t] && T[s.t][S.trend]) || null;
  const trendChg = (s) => {
    if (S.trend === "m1" && s.m1 != null) return s.m1;
    const a = trendPts(s);
    return a && a.length > 1 && a[0] > 0 ? (a[a.length - 1] / a[0] - 1) * 100 : null;
  };
  const LABELS = { p: "Price", divRate: "Dividend / yr", exDiv: "Ex-dividend", target: "Target", earnings: "Earnings" };
  const labelOf = (k) => k === "spark" ? trendName() : LABELS[k] || (FK[k] ? FK[k].label.replace("Change ", "") : k);

  // ---- state: chosen markets, sector, filters { key: [min, max] }, column view and sort
  const empty = () => ({ markets: [], sector: "", f: {}, view: "Overview", trend: "m1", sort: { key: "mcapUsd", dir: -1 } });
  let S = empty();
  try {
    if (location.hash.length > 1) S = { ...S, trend: store.get("screen", {}).trend || "m1", ...JSON.parse(decodeURIComponent(location.hash.slice(1))) };
    else S = { ...S, ...store.get("screen", {}) };
  } catch {}
  if (!VIEWS[S.view]) S.view = "Overview";
  if (!TRENDS.some((x) => x[0] === S.trend)) S.trend = "m1";
  $("trend").innerHTML = TRENDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
  $("trend").value = S.trend;
  async function loadTrends() {
    if (T || S.trend === "m1") return;
    $("trend").disabled = true;
    try { T = await UI.load("trends.json"); } catch { T = {}; }
    $("trend").disabled = false;
    if (!Object.keys(T).length) $("count").textContent = "Longer trends are not ready yet. They appear after the next data refresh.";
  }
  const persist = () => { store.set("screen", S); history.replaceState(null, "", "#" + encodeURIComponent(JSON.stringify({ markets: S.markets, sector: S.sector, f: S.f }))); };

  // Sectors present in the data
  const sectors = [...new Set(M.stocks.map((s) => s.sector).filter(Boolean))].sort();
  $("sector").innerHTML += sectors.map((x) => `<option>${esc(x)}</option>`).join("");
  const groups = [...new Set(F.map((f) => f.group))];
  $("add").innerHTML += groups.map((g) => `<optgroup label="${esc(g)}">${F.filter((f) => f.group === g).map((f) => `<option value="${f.k}">${esc(f.label)}</option>`).join("")}</optgroup>`).join("");
  $("presets").innerHTML = PRESETS.map((p, i) => `<button class="chip" data-p="${i}" title="${esc(p.help)}">${esc(p.name)}</button>`).join("");

  function savedList() {
    const saved = store.get("savedScreens", []);
    $("saved").innerHTML = `<option value="">Saved screens (${saved.length})…</option>` + saved.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join("");
  }
  savedList();

  const unitTxt = (f) => (f.unit === "B" ? "$B" : f.unit === "M" ? "$M" : f.unit);
  function renderFilters() {
    $("markets").innerHTML = M.indexes.map((i) => `<button class="chip" aria-pressed="${S.markets.includes(i.id)}" data-m="${i.id}">${esc(i.name.replace(/ \(.*\)/, ""))}</button>`).join("");
    $("sector").value = S.sector;
    const keys = Object.keys(S.f).filter((k) => FK[k]);
    $("filters").innerHTML = keys.length ? keys.map((k) => {
      const f = FK[k], [lo, hi] = S.f[k];
      return `<div class="filter" data-k="${k}">
        <span class="f-name" title="${esc(f.help || "")}">${esc(f.label)}${f.help ? ' <i class="f-help" aria-hidden="true">?</i>' : ""}</span>
        <input class="field" type="number" step="any" inputmode="decimal" placeholder="Min" aria-label="${esc(f.label)} minimum" data-b="0" value="${lo ?? ""}">
        <span class="muted">to</span>
        <input class="field" type="number" step="any" inputmode="decimal" placeholder="Max" aria-label="${esc(f.label)} maximum" data-b="1" value="${hi ?? ""}">
        <span class="f-unit muted">${esc(unitTxt(f))}</span>
        <button class="x" data-rm="${k}" aria-label="Remove the ${esc(f.label)} filter" title="Remove filter">✕</button>
      </div>`;
    }).join("") : `<p class="hint">No filters yet. Pick a ready-made screen above or add a filter below.</p>`;
    for (const b of $("presets").querySelectorAll(".chip")) {
      const p = PRESETS[+b.dataset.p];
      b.setAttribute("aria-pressed", String(JSON.stringify(p.f) === JSON.stringify(S.f)));
    }
  }

  let limit = 50, rows = [];
  function results() {
    const active = Object.entries(S.f).filter(([k, [lo, hi]]) => FK[k] && (lo != null || hi != null));
    rows = M.stocks.filter((s) => {
      if (S.markets.length && !S.markets.some((m) => s.ix.includes(m))) return false;
      if (S.sector && s.sector !== S.sector) return false;
      for (const [k, [lo, hi]] of active) {
        const v = val(s, FK[k]);
        if (v == null || (lo != null && v < lo) || (hi != null && v > hi)) return false;
      }
      return true;
    });
    $("count").textContent = `${rows.length.toLocaleString()} of ${M.stocks.length.toLocaleString()} stocks match`;
    $("views").innerHTML = Object.keys(VIEWS).map((v) => `<button role="tab" aria-selected="${v === S.view}" data-v="${v}">${v}</button>`).join("");
    // The filtered figures join the chosen view's columns so you can see why a stock matched
    const keys = [...new Set(VIEWS[S.view].concat(active.map(([k]) => k)))];
    $("trend-wrap").hidden = !keys.includes("spark");
    const cols = [
      { key: "name", label: "Company", left: true, sm: true, val: (r) => r.n,
        html: (r) => `<div class="co-row">${UI.star(r.t)}<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.n)}</a></span><span class="tk">${esc(r.s)} · ${esc(r.region)}${r.sector ? " · " + esc(r.sector) : ""}</span></div></div>` },
      ...keys.map((k, n) => ({
        key: k, label: labelOf(k), title: FK[k] && FK[k].help ? FK[k].help : undefined, sm: n === 0 || (n === 1 && keys[0] === "p"),
        val: k === "spark" ? trendChg : k === "p" ? (r) => r.p : FK[k] ? (r) => val(r, FK[k]) : (r) => r[k],
        html: (r) => fmt(k, r),
      })),
    ];
    if (!cols.some((c) => c.key === S.sort.key)) S.sort = { key: "mcapUsd", dir: -1 };
    if (!cols.some((c) => c.key === S.sort.key)) cols.push({ key: "mcapUsd", label: "Mkt cap", val: (r) => r.mcapUsd, html: (r) => fmt("mcapUsd", r) });
    // Sort everything, then show the first `limit`
    const sortCol = cols.find((c) => c.key === S.sort.key);
    const sorted = rows.slice().sort((a, b) => {
      const x = sortCol.val(a), y = sortCol.val(b);
      if (x == null) return y == null ? 0 : 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * S.sort.dir;
    });
    rows = sorted;
    UI.table($("table"), cols, sorted.slice(0, limit), S.sort, {
      empty: "No stocks pass every filter. Try loosening one.",
      onSort: () => { persist(); results(); return true; },
    });
    $("more").hidden = sorted.length <= limit;
    $("more").textContent = `Show more (${(sorted.length - limit).toLocaleString()} left)`;
  }
  function render() { renderFilters(); results(); }

  // ---- events
  $("presets").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    S.f = JSON.parse(JSON.stringify(PRESETS[+b.dataset.p].f));
    limit = 50; persist(); render();
  });
  $("markets").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const m = b.dataset.m;
    S.markets = S.markets.includes(m) ? S.markets.filter((x) => x !== m) : S.markets.concat(m);
    limit = 50; persist(); render();
    $("markets").querySelector(`[data-m="${m}"]`).focus();
  });
  $("sector").addEventListener("change", () => { S.sector = $("sector").value; limit = 50; persist(); results(); });
  $("add").addEventListener("change", () => {
    const k = $("add").value;
    $("add").value = "";
    if (!k) return;
    if (!S.f[k]) S.f[k] = [null, null];
    persist(); render();
    const box = $("filters").querySelector(`[data-k="${k}"] input`);
    if (box) box.focus();
  });
  let typing;
  $("filters").addEventListener("input", (e) => {
    const box = e.target.closest("input");
    if (!box) return;
    const k = box.closest(".filter").dataset.k;
    const v = box.value.trim() === "" ? null : +box.value;
    S.f[k][+box.dataset.b] = Number.isFinite(v) ? v : null;
    clearTimeout(typing);
    typing = setTimeout(() => { limit = 50; persist(); results(); renderPresetsOnly(); }, 200);
  });
  const renderPresetsOnly = () => {
    for (const b of $("presets").querySelectorAll(".chip")) b.setAttribute("aria-pressed", String(JSON.stringify(PRESETS[+b.dataset.p].f) === JSON.stringify(S.f)));
  };
  $("filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (!b) return;
    delete S.f[b.dataset.rm];
    persist(); render();
  });
  $("reset").addEventListener("click", () => { S = { ...empty(), view: S.view }; limit = 50; persist(); render(); });
  $("views").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    S.view = b.dataset.v;
    persist(); results();
  });
  $("more").addEventListener("click", () => { limit += 50; results(); });
  $("trend").addEventListener("change", async () => {
    S.trend = $("trend").value;
    persist();
    await loadTrends();
    results();
  });

  $("save").addEventListener("click", () => {
    const btn = $("save");
    const box = document.createElement("input");
    box.className = "field";
    box.placeholder = "Name this screen";
    box.setAttribute("aria-label", "Name this screen");
    btn.replaceWith(box);
    box.focus();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      const name = box.value.trim().slice(0, 40);
      box.replaceWith(btn);
      if (ok && name) {
        const saved = store.get("savedScreens", []).filter((x) => x.name !== name);
        saved.push({ name, markets: S.markets, sector: S.sector, f: S.f });
        store.set("savedScreens", saved);
        savedList();
        btn.textContent = "Saved ✓";
        setTimeout(() => { btn.textContent = "Save screen"; }, 1500);
      }
    };
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
    box.addEventListener("blur", () => finish(true));
  });
  $("saved").addEventListener("change", () => {
    const x = store.get("savedScreens", [])[+$("saved").value];
    $("saved").value = "";
    if (!x) return;
    S = { ...S, markets: x.markets || [], sector: x.sector || "", f: x.f || {} };
    limit = 50; persist(); render();
  });
  $("share").addEventListener("click", async () => {
    persist();
    try { await navigator.clipboard.writeText(location.href); $("share").textContent = "Link copied ✓"; }
    catch { $("share").textContent = "Copy the address bar"; }
    setTimeout(() => { $("share").textContent = "Copy link"; }, 1800);
  });

  $("csv").addEventListener("click", () => {
    const keys = ["t", "n", "region", "sector", "industry", "cur", "p", "d1", "w1", "m1", "m3", "ytd", "y1", "mcapUsd", "pe", "fpe", "peg", "pb", "ps",
      "revGrowth", "epsGrowth", "margin", "roe", "de", "divYield", "payout", "rsi", "fromHi", "beta", "recMean", "analysts", "target", "upside", "earnings"];
    const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const text = [keys.join(",")].concat(rows.map((r) => keys.map((k) => q(r[k])).join(","))).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = "screen.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  render();
  if (S.trend !== "m1") loadTrends().then(results);
})();
