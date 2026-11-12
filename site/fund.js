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
      const up = f.targetMeanPrice && m.p ? (f.targetMeanPrice / m.p - 1) * 100 : null;
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

  async function render(t, s) {
    showing = t;
    const box = el();
    if (!box) return;
    if (s.index) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="panel fund"><div class="empty">Loading company facts…</div></div>`;
    let f = null, m = {};
    try { f = await (await fetch(`fund/${encodeURIComponent(t)}.json`, { cache: "no-store" })).json(); } catch {}
    try { m = (await UI.market()).byTicker[t] || {}; } catch {}
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
        </div>
      </div>
      <p class="fund-summary">${summary(f, m, cur)}</p>
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
      <p class="hint">Figures from Yahoo Finance as of ${new Date(f.asOf).toLocaleDateString(undefined, { dateStyle: "medium" })}. Amounts are in ${esc(cur)}. Hover a figure for what it means.</p>
    </div>`;
  }

  window.renderFund = render;
})();
