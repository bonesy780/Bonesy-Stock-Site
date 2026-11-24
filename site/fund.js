// The "Company and financials" section under the stock lookup chart, from
// fund/<ticker>.json (company profile and key figures) and market.json.
(function () {
  const { esc, money, pct, big, stockUrl } = UI;
  const el = () => document.getElementById("fund");
  let showing = null;

  const ratio = (v, nd = 1) => (v == null ? "–" : v.toFixed(nd));
  const pc = (v, nd = 1) => (v == null ? "–" : `${(v * 100).toFixed(nd)}%`);
  const when = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString(undefined, { dateStyle: "medium" }) : "–");
  const rating = (m) => (m == null ? null : m <= 1.5 ? "Strong Buy" : m <= 2.5 ? "Buy" : m <= 3.5 ? "Hold" : m <= 4.5 ? "Underperform" : "Sell");

  // A short plain-language read of the numbers, like a broker's stock summary
  function summary(f, m, cur) {
    const out = [];
    const name = f.longName || m.n || f.t;
    if (m.y1 != null) out.push(`${esc(name)} is ${m.y1 >= 0 ? "up" : "down"} ${Math.abs(m.y1).toFixed(0)}% over the past year${m.fromHi != null ? ` and trades ${Math.abs(m.fromHi) < 1 ? "at" : Math.abs(m.fromHi).toFixed(0) + "% below"} its 52-week high` : ""}.`);
    if (m.sma50 && m.sma200 && m.p) {
      const a50 = m.p > m.sma50, a200 = m.p > m.sma200;
      out.push(a50 && a200 ? "The price is above both its 50-day and 200-day averages, a sign of an uptrend."
        : !a50 && !a200 ? "The price is below both its 50-day and 200-day averages, a sign of a downtrend."
        : a200 ? "It's above its 200-day average but has slipped below its 50-day average, so the longer uptrend has cooled recently."
        : "It's back above its 50-day average but still under its 200-day average.");
    }
    if (m.rsi != null && (m.rsi >= 70 || m.rsi <= 30)) out.push(`Its RSI of ${m.rsi.toFixed(0)} means it has ${m.rsi >= 70 ? "risen fast lately (often called overbought)" : "fallen hard lately (often called oversold)"}.`);
    if (f.trailingPE != null && f.forwardPE != null) out.push(`It trades at ${f.trailingPE.toFixed(1)} times the last year's earnings and ${f.forwardPE.toFixed(1)} times next year's expected earnings${f.forwardPE < f.trailingPE ? ", so analysts expect profits to grow" : f.forwardPE > f.trailingPE * 1.05 ? ", so analysts expect profits to shrink" : ""}.`);
    else if (f.trailingEps != null && f.trailingEps < 0) out.push("It lost money over the last 12 months, so it has no P/E ratio.");
    if (f.revenueGrowth != null) out.push(`Revenue ${f.revenueGrowth >= 0 ? "grew" : "fell"} ${Math.abs(f.revenueGrowth * 100).toFixed(0)}% from a year earlier in the latest quarter${f.profitMargins != null ? `, and it keeps ${(f.profitMargins * 100).toFixed(0)}¢ of profit from each dollar of sales` : ""}.`);
    if (f.debtToEquity != null) out.push(f.debtToEquity > 200 ? "It carries a lot of debt compared with shareholders' equity." : f.debtToEquity < 50 ? "It has little debt compared with shareholders' equity." : "");
    if (m.divYield) out.push(`It pays a ${m.divYield.toFixed(2)}% dividend yield${f.payoutRatio != null ? `, using ${(f.payoutRatio * 100).toFixed(0)}% of its earnings` : ""}.`);
    if (f.recommendationMean != null && f.numberOfAnalystOpinions) {
      let up = f.targetMeanPrice && m.p ? (f.targetMeanPrice / m.p - 1) * 100 : null;
      if (up != null && (up > 150 || up < -70)) up = null; // a target that far off is almost always bad data
      out.push(`${f.numberOfAnalystOpinions} analysts rate it ${rating(f.recommendationMean)} on average${up != null ? `, with an average price target ${Math.abs(up).toFixed(0)}% ${up >= 0 ? "above" : "below"} today's price` : ""}.`);
    }
    return out.filter(Boolean).join(" ");
  }

  function targetBar(f, price, cur) {
    const lo = f.targetLowPrice, hi = f.targetHighPrice, mean = f.targetMeanPrice;
    if (lo == null || hi == null || mean == null || price == null) return "";
    const a = Math.min(lo, price), b = Math.max(hi, price), span = b - a || 1;
    const at = (v) => `${((v - a) / span * 100).toFixed(1)}%`;
    return `<div class="tgt">
      <div class="tgt-track"><span class="tgt-range" style="left:${at(lo)};width:calc(${at(hi)} - ${at(lo)})"></span>
        <i class="tgt-mean" style="left:${at(mean)}" title="Average target"></i><i class="tgt-now" style="left:${at(price)}" title="Price now"></i></div>
      <div class="tgt-labels"><span>Low ${money(lo, cur)}</span><span><b class="tgt-key now"></b>Now ${money(price, cur)}</span><span><b class="tgt-key mean"></b>Average ${money(mean, cur)}</span><span>High ${money(hi, cur)}</span></div>
    </div>`;
  }

  // Up to 5 companies in the same industry (or sector), closest in size first
  function peers(t, m, all) {
    if (!m.sector) return "";
    const size = (x) => Math.log10(x.mcapUsd || 1);
    const near = (k) => all.filter((x) => x.t !== m.t && x[k] && x[k] === m[k])
      .sort((a, b) => Math.abs(size(a) - size(m)) - Math.abs(size(b) - size(m)));
    let list = near("industry");
    let by = m.industry;
    if (list.length < 3) { list = near("sector"); by = m.sector; }
    list = list.slice(0, 5);
    if (!list.length) return "";
    const rows = [m, ...list];
    const cell = (v, f) => (v == null ? "–" : f(v));
    const fx = (v) => v.toFixed(1);
    return `<div class="peers">
      <div class="peers-head"><h3>Similar companies <span class="muted">${esc(by)}</span></h3>
        <a class="btn small" href="compare.html?t=${rows.slice(0, 5).map((x) => encodeURIComponent(x.t)).join(",")}">Compare these</a></div>
      <div class="table-wrap"><table class="peer-table"><thead><tr><th class="left">Company</th><th>Price</th><th>Day</th><th class="hide-sm">YTD</th><th class="hide-sm">1Y</th><th class="hide-sm">Fwd P/E</th><th class="hide-sm">Yield</th><th>Mkt cap</th></tr></thead>
      <tbody>${rows.map((x) => `<tr class="${x.t === t ? "me" : ""}"><td class="left"><a href="${UI.stockUrl(x.t)}"><b>${esc(x.s)}</b> <span class="muted">${esc(x.n)}</span></a></td>
        <td class="num">${money(x.p, x.cur)}</td><td>${pct(x.d1)}</td><td class="hide-sm">${pct(x.ytd)}</td><td class="hide-sm">${pct(x.y1)}</td>
        <td class="num hide-sm">${cell(x.fpe > 0 ? x.fpe : null, fx)}</td><td class="num hide-sm">${cell(x.divYield, (v) => v.toFixed(2) + "%")}</td><td class="num">${big(x.mcapUsd)}</td></tr>`).join("")}</tbody></table></div>
    </div>`;
  }

  // ---- which firms rate it: ratings/<ticker>.json (rating changes by firm and monthly counts)
  const ACT = { up: ["Upgrade", "up"], down: ["Downgrade", "down"], init: ["Started coverage", "init"], main: ["Maintained", ""], reit: ["Reiterated", ""] };
  const MIX = [["sb", "Strong Buy"], ["b", "Buy"], ["h", "Hold"], ["s", "Sell"], ["ss", "Strong Sell"]];
  const monthName = (period) => {
    const back = -parseInt(period, 10) || 0;
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back);
    return back === 0 ? "This month" : d.toLocaleDateString(undefined, { month: "long" });
  };
  function actions(r, cur, price) {
    const acts = r.actions || [], trend = (r.trend || []).slice().sort((a, b) => parseInt(b.period, 10) - parseInt(a.period, 10));
    const firms = new Set(acts.map((a) => a.firm));
    const count = (k) => acts.filter((a) => a.act === k).length;
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const mixBar = (p) => {
      const n = MIX.reduce((a, [k]) => a + (p[k] || 0), 0);
      return `<div class="ra-mix"><span class="ra-mlabel">${esc(monthName(p.period))}</span><div class="ra-bar" title="${MIX.map(([k, l]) => `${l}: ${p[k] || 0}`).join(", ")}">${MIX.map(([k]) => p[k] ? `<i class="ra-${k}" style="flex:${p[k]}">${p[k]}</i>` : "").join("")}</div><span class="ra-n num">${n}</span></div>`;
    };
    const rows = acts.map((a, i) => {
      const act = ACT[a.act] || [a.act || "–", ""];
      const grade = a.from && a.from !== a.to ? `${esc(a.from)} → <b>${esc(a.to)}</b>` : `<b>${esc(a.to || "–")}</b>`;
      const tgt = a.pt ? (a.ppt && a.ppt !== a.pt ? `${money(a.ppt, cur)} → <b>${money(a.pt, cur)}</b>` : `<b>${money(a.pt, cur)}</b>`) : "–";
      const vs = a.pt && price ? (a.pt / price - 1) * 100 : null;
      return `<tr${i >= 10 ? ' class="ra-more" hidden' : ""}><td class="left num">${new Date(a.d + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", ...(a.d.slice(0, 4) !== String(new Date().getFullYear()) ? { year: "2-digit" } : {}) })}</td>
        <td class="left">${esc(a.firm)}</td><td class="left hide-sm"><span class="ra-act ${act[1]}">${act[0]}</span></td><td class="left">${grade}</td>
        <td class="num">${tgt}</td><td class="hide-sm">${vs != null ? pct(vs, 0) : "–"}</td></tr>`;
    }).join("");
    return `<div class="ra">
      <h3>Who rates it</h3>
      <p class="hint">The rating above is Yahoo Finance's average of every analyst covering the stock. Yahoo doesn't name them all, but it does record each firm's rating changes, listed here.${acts.length ? ` In the past year, <b>${plural(firms.size, "firm")}</b> made ${plural(acts.length, "rating call")}: ${plural(count("up"), "upgrade")}, ${plural(count("down"), "downgrade")} and ${count("init")} new.` : ""}</p>
      ${trend.length ? `<div class="ra-trend"><div class="ra-legend">${MIX.map(([k, l]) => `<span><b class="ra-${k}"></b>${l}</span>`).join("")}</div>${trend.map(mixBar).join("")}</div>` : ""}
      ${acts.length ? `<div class="table-wrap"><table class="grid-table ra-table"><thead><tr><th class="left">Date</th><th class="left">Firm</th><th class="left hide-sm">Action</th><th class="left">Rating</th><th>Price target</th><th class="hide-sm" title="Target vs today's price">vs now</th></tr></thead><tbody>${rows}</tbody></table></div>
        ${acts.length > 10 ? `<p class="hint pad"><button class="btn small" id="ra-all">Show all ${acts.length}</button></p>` : ""}` : `<p class="muted">No rating changes by named firms in the past year.</p>`}
    </div>`;
  }
  // ---- earnings: the last four quarters' EPS against what analysts expected, and the stock's move when it reported
  const qName = (iso) => { const d = new Date(iso + "T12:00:00Z"); return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`; };
  function epsHistory(eps, cur) {
    if (!eps || !eps.length) return "";
    const rows = eps.slice().reverse();
    const known = rows.filter((e) => e.sp != null);
    const beats = known.filter((e) => e.sp > 0).length;
    const moves = rows.filter((e) => e.mv != null);
    const avgMove = moves.length ? moves.reduce((a, e) => a + Math.abs(e.mv), 0) / moves.length : null;
    const hi = Math.max(...rows.flatMap((e) => [Math.abs(e.a), Math.abs(e.e ?? 0)]), 1e-9);
    const bar = (v, cls) => `<i class="eh-bar ${cls}${v < 0 ? " neg" : ""}" style="height:${Math.max(4, Math.abs(v) / hi * 56).toFixed(0)}px" title="${cls === "act" ? "Actual" : "Expected"} ${money(v, cur)}"></i>`;
    return `<div class="eh">
      <h3>Earnings: beat or miss</h3>
      <p class="hint">Earnings per share each quarter against what analysts expected beforehand.${known.length ? ` It beat expectations in <b>${beats} of the last ${known.length}</b> quarters.` : ""}${avgMove != null ? ` On average the stock moved <b>${avgMove.toFixed(1)}%</b> (up or down) on the day the market reacted.` : ""}</p>
      <div class="eh-chart" role="img" aria-label="Actual versus expected earnings per share, last ${rows.length} quarters">${rows.map((e) => `<div class="eh-q">
        <div class="eh-bars">${e.e != null ? bar(e.e, "est") : ""}${bar(e.a, "act " + (e.sp == null ? "" : e.sp >= 0 ? "beat" : "miss"))}</div>
        <span class="eh-label">${qName(e.q)}</span>
        ${e.sp != null ? `<span class="pill ${e.sp >= 0 ? "buy" : "sell"}">${e.sp >= 0 ? "Beat" : "Missed"} ${Math.abs(e.sp).toFixed(0)}%</span>` : ""}
      </div>`).join("")}</div>
      <div class="eh-legend"><span><b class="eh-key est"></b>Expected</span><span><b class="eh-key beat"></b>Actual (beat)</span><span><b class="eh-key miss"></b>Actual (missed)</span></div>
      <div class="table-wrap"><table class="grid-table"><thead><tr><th class="left">Quarter</th><th>Expected EPS</th><th>Actual EPS</th><th>Surprise</th><th title="The busiest trading day in the weeks after the quarter ended, when the market reacted to the report">Reaction day</th><th>Move that day</th></tr></thead>
      <tbody>${eps.map((e) => `<tr><td class="left">${qName(e.q)} <span class="muted">(ended ${new Date(e.q + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })})</span></td>
        <td class="num">${e.e != null ? money(e.e, cur) : "–"}</td><td class="num"><b>${money(e.a, cur)}</b></td><td>${e.sp != null ? pct(e.sp, 1) : "–"}</td>
        <td class="num">${e.rd ? new Date(e.rd + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "–"}</td><td>${e.mv != null ? pct(e.mv, 1) : "–"}</td></tr>`).join("")}</tbody></table></div>
      <p class="hint">The reaction day is worked out from trading volume (the busiest day after the quarter closed), so it can be off for a stock with other big news around then.</p>
    </div>`;
  }

  // ---- insider trades: officers, directors and big holders buying or selling their own company's shares
  const KINDS = { buy: ["Bought", "up"], sell: ["Sold", "down"], exercise: ["Exercised options", ""], award: ["Granted shares", ""], gift: ["Gift", ""], other: ["Other", ""] };
  function insiderTrades(ins, cur) {
    if (!ins) return "";
    const tr = ins.trades || [], six = ins.six || {};
    const buys = tr.filter((x) => x.k === "buy"), sells = tr.filter((x) => x.k === "sell");
    const sum = (a) => a.reduce((n, x) => n + (x.v || 0), 0);
    const mood = six.bn || six.sn ? (six.bn > six.sn ? "more insiders bought than sold" : six.bn < six.sn ? "more insiders sold than bought" : "as many insiders bought as sold") : null;
    return `<div class="ins">
      <h3>Insider trades</h3>
      <p class="hint">Company officers, directors and big shareholders must report when they trade the stock. Buying with their own money is often read as confidence; selling is common (taxes, diversifying) and says less.${mood ? ` Over the last six months, <b>${mood}</b>: ${six.bn || 0} buys and ${six.sn || 0} sales.` : ""}${buys.length || sells.length ? ` In the past year: ${buys.length} open-market buys worth ${big(sum(buys), "")} and ${sells.length} sales worth ${big(sum(sells), "")} (${esc(cur)}).` : ""}</p>
      ${tr.length ? `<div class="table-wrap"><table class="grid-table"><thead><tr><th class="left">Date</th><th class="left">Who</th><th class="left">Trade</th><th>Shares</th><th class="hide-sm">Price</th><th>Value</th></tr></thead>
        <tbody>${tr.map((x, i) => { const k = KINDS[x.k] || KINDS.other; return `<tr${i >= 10 ? ' class="ins-more" hidden' : ""}><td class="left num">${new Date(x.d + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}</td>
          <td class="left">${esc(x.who)}<span class="tk"> ${esc(x.rel || "")}</span></td><td class="left"><span class="ra-act ${k[1]}">${k[0]}</span></td>
          <td class="num">${UI.compact(x.sh)}</td><td class="num hide-sm">${x.pr ? money(x.pr, cur) : "–"}</td><td class="num">${x.v ? big(x.v, "") : "–"}</td></tr>`; }).join("")}</tbody></table></div>
        ${tr.length > 10 ? `<p class="hint pad"><button class="btn small" id="ins-all">Show all ${tr.length}</button></p>` : ""}` : `<p class="muted">No insider trades filed in the past year.</p>`}
      <p class="hint"><a href="insiders.html">Insider buying across all markets →</a></p>
    </div>`;
  }

  async function ratings(t, cur, price, analysts) {
    let r = null;
    try { const res = await fetch(`ratings/${encodeURIComponent(t.replace("^", "_"))}.json`, { cache: "no-cache" }); if (res.ok) r = await res.json(); } catch {}
    const box = document.getElementById("rating-acts");
    if (showing !== t || !box || !r) return;
    box.innerHTML = (analysts ? actions(r, cur, price) : "") + epsHistory(r.eps, cur) + insiderTrades(r.ins, cur);
    const all = document.getElementById("ra-all");
    if (all) all.onclick = () => { box.querySelectorAll(".ra-more").forEach((x) => (x.hidden = false)); all.parentElement.remove(); };
    const ia = document.getElementById("ins-all");
    if (ia) ia.onclick = () => { box.querySelectorAll(".ins-more").forEach((x) => (x.hidden = false)); ia.parentElement.remove(); };
  }

  // ---- "Explain this stock": Claude writes a plain-language take from the site's own figures (worker /explain)
  let aiOn = null;
  const aiReady = () => aiOn ?? (aiOn = window.Live && Live.on
    ? fetch(Live.api + "/ask").then((r) => r.json()).then((d) => !!d.ai).catch(() => false) : Promise.resolve(false));
  async function explainButton(t) {
    const slot = document.getElementById("explain-slot");
    if (!slot || !(await aiReady()) || showing !== t) return;
    slot.innerHTML = `<button class="btn small explain-btn" id="explain" type="button">✨ Explain this stock</button>`;
    document.getElementById("explain").onclick = async () => {
      const out = document.getElementById("explain-out");
      out.hidden = false;
      out.innerHTML = `<p class="muted">Reading the numbers…</p>`;
      try {
        const res = await fetch(Live.api + "/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t }) });
        const d = await res.json();
        if (showing !== t) return;
        if (!res.ok || !d.text) throw new Error(d.error || "no answer");
        out.innerHTML = `<div class="explain-text">${d.text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</p>`).join("")}</div>
          <p class="hint">Written by Claude from this page's figures${d.asOf ? ` (as of ${esc(new Date(d.asOf).toLocaleDateString(undefined, { dateStyle: "medium" }))})` : ""}. It can make mistakes, and it isn't financial advice.</p>`;
      } catch (e) {
        out.innerHTML = `<p class="muted">The explanation isn't available right now (${esc(e.message || e)}). Try again in a minute.</p>`;
      }
    };
  }

  async function render(t, s) {
    showing = t;
    const box = el();
    if (!box) return;
    if (s.index) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="panel fund"><div class="empty">Loading company facts…</div></div>`;
    let f = null, m = {};
    try { f = await (await fetch(`fund/${encodeURIComponent(t)}.json`, { cache: "no-cache" })).json(); } catch {}
    let all = [];
    try { const mk = await UI.market(); m = mk.byTicker[t] || {}; all = mk.stocks; } catch {}
    if (showing !== t) return;
    if (!f) { box.innerHTML = `<div class="panel fund"><div class="empty">No company facts for this stock yet. They're gathered every weekday after the US close.</div></div>`; return; }
    const cur = f.cur || s.cur, price = m.p ?? f.price;
    const group = (title, rows) => `<div class="fgroup"><h3>${title}</h3><dl>${rows.filter((r) => r).map(([k, v, help]) =>
      `<div${help ? ` title="${esc(help)}"` : ""}><dt>${esc(k)}</dt><dd class="num">${v}</dd></div>`).join("")}</dl></div>`;
    const desc = f.longBusinessSummary || "";
    box.innerHTML = `<div class="panel fund">
      <div class="fund-head">
        <h2>Company and financials</h2>
        <div class="fund-actions">
          ${UI.star(t, "Watch")}
          <a class="btn small" href="portfolio.html?t=${encodeURIComponent(t)}">Paper trade</a>
          <a class="btn small" href="compare.html?t=${encodeURIComponent(t)},^GSPC">Compare</a>
          <a class="btn small" href="alerts.html?t=${encodeURIComponent(t)}">Set alert</a>
          <span id="explain-slot"></span>
        </div>
      </div>
      <p class="fund-summary">${summary(f, m, cur)}</p>
      <div class="explain-out" id="explain-out" hidden aria-live="polite"></div>
      <div class="fund-profile">
        <div class="tags">${[f.sector, f.industry, [f.city, f.country].filter(Boolean).join(", "), f.fullTimeEmployees ? f.fullTimeEmployees.toLocaleString() + " employees" : ""].filter(Boolean).map((x) => `<span class="tag">${esc(x)}</span>`).join("")}${f.website && /^https?:\/\//.test(f.website) ? `<a class="tag" href="${esc(f.website)}" target="_blank" rel="noopener">Website ↗</a>` : ""}</div>
        ${desc ? `<details class="fund-desc"><summary>${esc(desc.slice(0, 220))}${desc.length > 220 ? "… <span>Read more</span>" : ""}</summary>${desc.length > 220 ? `<p>${esc(desc)}</p>` : ""}</details>` : ""}
      </div>
      <div class="fgroups">
        ${group("Valuation", [
          ["Market cap", big(f.marketCap, ""), "In " + cur], ["Enterprise value", big(f.enterpriseValue, ""), "Market cap plus debt minus cash, in " + cur],
          ["P/E (last 12 months)", ratio(f.trailingPE), "Price ÷ earnings per share"], ["Forward P/E", ratio(f.forwardPE), "Price ÷ next year's expected earnings per share"],
          ["PEG", ratio(f.trailingPegRatio, 2), "P/E ÷ expected growth. Under 1 is often seen as cheap for the growth"],
          ["Price / book", ratio(f.priceToBook)], ["Price / sales", ratio(f.priceToSalesTrailing12Months)], ["EV / EBITDA", ratio(f.enterpriseToEbitda)],
        ])}
        ${group("Earnings and profit", [
          ["Revenue (12 months)", big(f.totalRevenue, "")], ["Revenue growth", f.revenueGrowth != null ? pct(f.revenueGrowth * 100) : "–", "Latest quarter vs a year earlier"],
          ["EPS (12 months)", f.trailingEps != null ? money(f.trailingEps, cur) : "–"], ["Forward EPS", f.forwardEps != null ? money(f.forwardEps, cur) : "–"],
          ["Earnings growth", f.earningsGrowth != null ? pct(f.earningsGrowth * 100) : "–", "Latest quarter vs a year earlier"],
          ["Gross margin", pc(f.grossMargins)], ["Operating margin", pc(f.operatingMargins)], ["Profit margin", pc(f.profitMargins)],
          ["Return on equity", pc(f.returnOnEquity)], ["Return on assets", pc(f.returnOnAssets)],
        ])}
        ${group("Financial health", [
          ["Cash", big(f.totalCash, "")], ["Debt", big(f.totalDebt, "")], ["Debt / equity", f.debtToEquity != null ? f.debtToEquity.toFixed(0) + "%" : "–"],
          ["Current ratio", ratio(f.currentRatio, 2), "Short-term assets ÷ short-term debts. Over 1 means it can cover bills due within a year"],
          ["Free cash flow", big(f.freeCashflow, ""), "Cash left after running the business and investing in it"],
          ["Book value / share", f.bookValue != null ? money(f.bookValue, cur) : "–"],
        ])}
        ${group("Dividends", [
          ["Yield", m.divYield != null ? m.divYield.toFixed(2) + "%" : f.dividendRate ? ((f.dividendRate / price) * 100).toFixed(2) + "%" : "None"],
          ["Per share / year", f.dividendRate != null ? money(f.dividendRate, cur) : "–"], ["Payout ratio", pc(f.payoutRatio, 0)],
          ["5-year avg yield", f.fiveYearAvgDividendYield != null ? f.fiveYearAvgDividendYield.toFixed(2) + "%" : "–"],
          ["Ex-dividend date", when(f.exDividendDate)], ["Last dividend", f.lastDividendValue != null ? money(f.lastDividendValue, cur) : "–"],
        ])}
        ${group("Trading", [
          ["Beta", ratio(f.beta, 2), "How much it moves with the market. 1 = in step, over 1 = bigger swings"],
          ["Avg volume (3 months)", UI.compact(f.averageVolume)], ["Shares outstanding", UI.compact(f.sharesOutstanding)],
          ["Held by insiders", pc(f.heldPercentInsiders)], ["Held by institutions", pc(f.heldPercentInstitutions)],
          ["Short interest", pc(f.shortPercentOfFloat), "Share of tradable shares sold short"],
          ["Next earnings", when(f.earningsTimestampStart || f.earningsTimestamp)],
        ])}
        <div class="fgroup">
          <h3>Analysts</h3>
          ${f.recommendationMean != null ? `<div class="analyst-big"><span class="pill ${f.recommendationMean <= 2.5 ? "buy" : f.recommendationMean > 3.5 ? "sell" : ""}">${rating(f.recommendationMean)}</span> <span class="tk">${f.recommendationMean.toFixed(1)} on a 1 (strong buy) to 5 (sell) scale · ${f.numberOfAnalystOpinions || 0} analysts</span></div>
            <div class="rec-scale"><i style="left:${((f.recommendationMean - 1) / 4 * 100).toFixed(1)}%"></i></div>
            <div class="rec-labels"><span>Strong Buy</span><span>Buy</span><span>Hold</span><span>Underperform</span><span>Sell</span></div>` : `<p class="muted">No analyst ratings.</p>`}
          ${targetBar(f, price, cur)}
        </div>
      </div>
      <div id="rating-acts"></div>
      ${peers(t, m, all)}
      <p class="hint">Figures from Yahoo Finance as of ${new Date(f.asOf).toLocaleDateString(undefined, { dateStyle: "medium" })}. Amounts are in ${esc(cur)}. Hover a figure for what it means.</p>
    </div>`;
    ratings(t, cur, price, f.recommendationMean != null || f.numberOfAnalystOpinions);
    explainButton(t);
  }

  window.renderFund = render;
})();
