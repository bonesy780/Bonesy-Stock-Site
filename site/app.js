(async function () {
  const $ = (id) => document.getElementById(id);
  let data;
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    data = await res.json();
  } catch (e) {
    $("updated").textContent = "Data could not be loaded.";
    return;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (v) => v == null ? '<span class="num">–</span>' :
    `<span class="num ${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</span>`;
  const money = (v, cur) => v == null ? "–" : new Intl.NumberFormat(undefined, {
    style: "currency", currency: cur, maximumFractionDigits: v >= 1000 || cur === "JPY" || cur === "KRW" ? 0 : 2,
  }).format(v);
  const big = (v) => {
    if (v == null) return "–";
    for (const [n, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"]]) if (v >= n) return "$" + (v / n).toFixed(v / n >= 100 ? 0 : 1) + s;
    return "$" + Math.round(v);
  };
  const divYield = (s) => s.divYield != null ? `<span class="num">${s.divYield.toFixed(2)}%</span>` : s.divFreq === "None" ? '<span class="num muted">0%</span>' : '<span class="num">–</span>';
  const divFreq = (s) => `<span class="${s.divFreq === "None" ? "muted" : ""}">${esc(s.divFreq || "–")}</span>`;
  const link = (s) => `<a href="stock.html?t=${encodeURIComponent(s.ticker)}">${esc(s.name)}</a>`;
  const pillClass = (r) => /buy/i.test(r) ? "buy" : /sell|under/i.test(r) ? "sell" : "";
  const spark = (pts, w = 96, h = 28) => {
    if (!pts || pts.length < 2) return "";
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
    const d = pts.map((p, i) => `${(i / (pts.length - 1) * w).toFixed(1)},${(h - 2 - (p - lo) / span * (h - 4)).toFixed(1)}`).join(" ");
    const color = pts[pts.length - 1] >= pts[0] ? "var(--up)" : "var(--down)";
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.6" points="${d}"/></svg>`;
  };
  const curOf = (ticker) => {
    const ix = data.indexes.find((i) => i.top.some((t) => t.ticker === ticker));
    if (ix) return ix.currency;
    const suf = { ".TO": "CAD", ".T": "JPY", ".KS": "KRW", ".TW": "TWD" };
    const m = Object.keys(suf).find((s) => ticker.endsWith(s));
    return m ? suf[m] : "USD";
  };

  const when = new Date(data.generated);
  $("updated").textContent = "Updated " + when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  // Index tabs
  // Always open on the first index (TSX)
  let current = data.indexes[0].id;
  if (!data.indexes.some((i) => i.id === current)) current = data.indexes[0].id;
  function renderTabs() {
    $("tabs").innerHTML = data.indexes.map((i) =>
      `<button class="tab" role="tab" aria-selected="${i.id === current}" data-id="${i.id}">${esc(i.name)}</button>`).join("");
  }
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    current = b.dataset.id;
    renderTabs();
    renderIndex();
  });

  function renderIndex() {
    const ix = data.indexes.find((i) => i.id === current);
    const rows = ix.top.map((s, n) => `
      <tr>
        <td class="rank num">${n + 1}</td>
        <td><div class="co"><span class="nm" title="${esc(s.name)}">${link(s)}</span><span class="tk">${esc(s.symbol)}${s.sector ? " · " + esc(s.sector) : ""}</span></div></td>
        <td class="num">${money(s.price, ix.currency)}</td>
        <td>${pct(s.chg1w)}</td>
        <td>${pct(s.chg1m)}</td>
        <td>${pct(s.chg3m)}</td>
        <td>${pct(s.ytd)}</td>
        <td><span class="pill ${pillClass(s.rating)}">${esc(s.rating)}</span>${s.analysts ? `<span class="tk num"> ${s.analysts}</span>` : ""}</td>
        <td>${pct(s.upside)}</td>
        <td class="num">${big(s.mcapUsd)}</td>
        <td>${divYield(s)}</td>
        <td>${divFreq(s)}</td>
        <td><span class="score"><span class="bar"><i style="width:${s.score}%"></i></span><span class="num">${s.score.toFixed(0)}</span></span></td>
        <td>${spark(s.spark)}</td>
      </tr>`).join("");
    const largest = ix.largest || [];
    const maxCap = Math.max(...largest.map((s) => s.mcapUsd || 0), 1);
    const bigRows = largest.map((s, n) => `
      <tr>
        <td class="rank num">${n + 1}</td>
        <td><div class="co"><span class="nm" title="${esc(s.name)}">${link(s)}</span><span class="tk">${esc(s.symbol)}</span></div></td>
        <td><span class="score"><span class="bar"><i style="width:${(s.mcapUsd || 0) / maxCap * 100}%"></i></span><span class="num">${big(s.mcapUsd)}</span></span></td>
        <td class="num">${money(s.price, ix.currency)}</td>
        <td>${pct(s.chg1d)}</td>
        <td>${pct(s.chg1w)}</td>
        <td>${pct(s.chg1m)}</td>
        <td>${pct(s.chg3m)}</td>
        <td>${pct(s.ytd)}</td>
        <td>${pct(s.fromHigh)}</td>
        <td>${divYield(s)}</td>
        <td>${divFreq(s)}</td>
        <td>${spark(s.spark)}</td>
      </tr>`).join("");
    $("index-view").innerHTML = `
      <div class="panel summary">
        <div><h2>${esc(ix.name)}</h2><div class="region">${esc(ix.region)} · ${ix.members} members · prices in ${ix.currency}</div></div>
        <div class="stats">
          <div class="stat"><div class="label">Level</div><div class="value num">${ix.level ? ix.level.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "–"}</div></div>
          <div class="stat"><div class="label">Day</div><div class="value">${pct(ix.chg1d)}</div></div>
          <div class="stat"><div class="label">Week</div><div class="value">${pct(ix.chg1w)}</div></div>
          <div class="stat"><div class="label">Month</div><div class="value">${pct(ix.chg1m)}</div></div>
          <div class="stat"><div class="label">YTD</div><div class="value">${pct(ix.ytd)}</div></div>
        </div>
        ${spark(ix.spark, 160, 40)}
      </div>
      <div class="subhead"><h3>Biggest companies</h3><p>The 10 largest by market cap: the most watched names and how they're doing.</p></div>
      <div class="panel table-wrap">
        ${largest.length ? `<table>
          <thead><tr><th>#</th><th>Company</th><th>Mkt cap (USD)</th><th>Price</th><th>Day</th><th>1W</th><th>1M</th><th>3M</th><th>YTD</th><th>From 52W high</th><th>Div yield</th><th>Pays</th><th>3M trend</th></tr></thead>
          <tbody>${bigRows}</tbody></table>` : `<div class="empty">No market cap data for this index today.</div>`}
      </div>
      <div class="subhead"><h3>Top 10 ranked</h3><p>Ranked on 3-month performance, then analyst ratings, then company size.</p></div>
      <div class="panel table-wrap">
        ${ix.top.length ? `<table>
          <thead><tr><th>#</th><th>Company</th><th>Price</th><th>1W</th><th>1M</th><th>3M</th><th>YTD</th><th>Analysts</th><th>Upside</th><th>Mkt cap</th><th>Div yield</th><th>Pays</th><th>Score</th><th>3M trend</th></tr></thead>
          <tbody>${rows}</tbody></table>` : `<div class="empty">No data for this index today.</div>`}
      </div>`;
  }

  function renderIdeas() {
    $("ideas").innerHTML = data.buyIdeas.length ? data.buyIdeas.map((s) => `
      <article class="panel card">
        <div class="card-top">
          <div><div class="nm">${link(s)}</div><div class="tk">${esc(s.ticker)} · ${esc((s.indexes || []).join(", "))}</div></div>
          <span class="pill buy">${esc(s.rating)}</span>
        </div>
        <ul>${s.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
        <div class="meta"><span class="num">${money(s.price, curOf(s.ticker))}</span><span>Target <span class="num">${money(s.target, curOf(s.ticker))}</span></span></div>
        <div class="meta">${s.divFreq === "None" ? "<span>No dividend</span>" : `<span>Dividend ${divYield(s)}</span><span>Pays ${esc((s.divFreq || "–").toLowerCase())}</span>`}</div>
      </article>`).join("") : `<div class="panel empty">No stocks pass every buy test today.</div>`;
  }

  function renderSells() {
    const list = data.sellIdeas || [];
    $("sells").innerHTML = list.length ? list.map((s) => `
      <article class="panel card">
        <div class="card-top">
          <div><div class="nm">${link(s)}</div><div class="tk">${esc(s.ticker)} · ${esc((s.indexes || []).join(", "))}</div></div>
          <span class="pill sell">${esc(s.rating)}</span>
        </div>
        <ul>${s.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
        <div class="meta"><span class="num">${money(s.price, curOf(s.ticker))}</span><span>Target <span class="num">${money(s.target, curOf(s.ticker))}</span></span></div>
        <div class="meta">${s.divFreq === "None" ? "<span>No dividend</span>" : `<span>Dividend ${divYield(s)}</span><span>Pays ${esc((s.divFreq || "–").toLowerCase())}</span>`}</div>
      </article>`).join("") : `<div class="panel empty">No stocks pass every sell test today.</div>`;
  }

  function renderWatch() {
    $("watch").innerHTML = data.watchlist.length ? data.watchlist.map((s) => `
      <div class="panel watch-row">
        <div class="co"><span class="nm">${link(s)}</span><span class="tk">${esc(s.ticker)} · ${esc((s.indexes || []).join(", "))}</span></div>
        <div class="tags">${s.why.map((w) => `<span class="tag ${/earnings/.test(w) ? "earn" : ""}">${esc(w)}</span>`).join("")}</div>
        <div>${pct(s.chg1w)} <span class="tk">1W</span></div>
      </div>`).join("") : `<div class="panel empty">Nothing stands out for the coming week.</div>`;
  }

  const st = data.settings;
  $("method").innerHTML = [
    `Each index's ${st.candidates} best performers over the last 3 months are scored. Performance counts for ${st.weights.perf * 100}%, the average analyst rating for ${st.weights.analyst * 100}% and market cap for ${st.weights.mcap * 100}%. The 10 highest scores make the list.`,
    `Buy ideas need an analyst consensus of Buy or better from at least 5 analysts, 10% or more upside to the average price target, a positive 3-month return and a price above the 50-day average.`,
    `Sell ideas are stocks down over the last 3 months and below their 50-day average, where analysts rate them Hold or worse (at least 3 analysts) or the price is above the average target.`,
    `Dividend yield is the last year of regular payments divided by today's price. Pays shows how often the company pays, based on its recent payment dates.`,
    `Taiwan 50 is approximated by the 50 largest companies on the Taiwan Stock Exchange. Member lists are refreshed from public sources when available.`,
  ].map((t) => `<li>${esc(t)}</li>`).join("");

  // Matrix-style rain of digits and tickers in the side gutters
  if (window.startRain) window.startRain(data.rainTickers || data.indexes.flatMap((i) => i.top.map((t) => t.symbol)));

  renderTabs();
  renderIndex();
  renderIdeas();
  renderSells();
  renderWatch();
})();
