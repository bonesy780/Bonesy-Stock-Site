(async function () {
  const { esc, pct, money, big, stockUrl, Watch } = UI;
  const $ = (id) => document.getElementById(id);

  let M, D;
  try {
    [M, D] = await Promise.all([UI.market(), UI.load("data.json").catch(() => null)]);
  } catch (e) {
    $("updated").textContent = "Stock data could not be loaded.";
    $("brief").innerHTML = `<div class="panel empty">Stock data could not be loaded. Try again after the next data refresh.</div>`;
    return;
  }
  const when = new Date(M.generated);
  $("updated").textContent = "Updated " + when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  $("lede").textContent = `The last session across the eight markets, in plain words. Written ${when.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}.`;
  if (window.startRain) window.startRain(M.stocks.filter((s) => s.cur === "USD").map((s) => s.s));

  const name = (i) => i.name.replace(/ \(.*\)/, "");
  const link = (s) => `<a class="co-link" href="${stockUrl(s.t)}" title="${esc(s.n)}">${esc(s.s)}</a>`;
  const linkN = (s) => `<a class="co-link" href="${stockUrl(s.t)}">${esc(s.n)}</a> (${esc(s.s)})`;
  const list = (arr) => arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];
  const word = (v) => (v == null ? "was flat" : v > 0.05 ? "rose" : v < -0.05 ? "fell" : "was flat");
  const cw = (stocks, k) => {
    const have = stocks.filter((s) => s[k] != null && s.mcapUsd);
    const w = have.reduce((a, s) => a + s.mcapUsd, 0);
    return w ? have.reduce((a, s) => a + s[k] * s.mcapUsd, 0) / w : null;
  };
  const sections = [];
  const section = (title, body, more) => sections.push(`<section class="panel brief-sec"><h2>${title}</h2>${body}${more ? `<p class="brief-more">${more}</p>` : ""}</section>`);

  // ---- indexes
  const idx = (D && D.indexes) || [];
  if (idx.length) {
    const moved = idx.filter((i) => i.chg1d != null).sort((a, b) => b.chg1d - a.chg1d);
    const up = moved.filter((i) => i.chg1d > 0).length;
    const mood = up === moved.length ? "Every market rose" : up === 0 ? "Every market fell" : up >= moved.length * 0.7 ? "Most markets rose" : up <= moved.length * 0.3 ? "Most markets fell" : "Markets were mixed";
    const best = moved[0], worst = moved[moved.length - 1];
    const lines = moved.map((i) => {
      const st = M.stocks.filter((s) => s.ix.includes(i.id));
      const adv = st.filter((s) => s.d1 > 0).length, dec = st.filter((s) => s.d1 < 0).length;
      const a200 = st.filter((s) => s.sma200 != null);
      const pa = a200.length ? Math.round(a200.filter((s) => s.p > s.sma200).length / a200.length * 100) : null;
      return `<li><b>${esc(name(i))}</b> ${word(i.chg1d)} ${pct(i.chg1d, 2)} to ${i.level != null ? i.level.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "–"}.
        <span class="muted">${adv} stocks up, ${dec} down${pa != null ? `, ${pa}% above their 200-day average` : ""}. Week ${pct(i.chg1w)}, year to date ${pct(i.ytd)}.</span></li>`;
    });
    section("Markets", `<p class="brief-lead">${mood}: ${up} of ${moved.length} indexes closed higher. ${esc(name(best))} led with ${pct(best.chg1d, 2)}${worst !== best ? ` and ${esc(name(worst))} lagged with ${pct(worst.chg1d, 2)}` : ""}.</p><ul class="brief-list">${lines.join("")}</ul>`,
      `<a href="./">See the markets</a> · <a href="heatmap.html">Heatmap</a>`);
  }

  // ---- sectors (all markets together, weighted by size)
  const bySec = {};
  for (const s of M.stocks) if (s.sector) (bySec[s.sector] ||= []).push(s);
  const secs = Object.entries(bySec).map(([n, st]) => ({ n, d1: cw(st, "d1"), m1: cw(st, "m1") })).filter((x) => x.d1 != null).sort((a, b) => b.d1 - a.d1);
  if (secs.length > 3) {
    const top = secs.slice(0, 3), bot = secs.slice(-3).reverse();
    const lead = secs.slice().sort((a, b) => (b.m1 ?? -1e9) - (a.m1 ?? -1e9))[0];
    section("Sectors", `<p class="brief-lead">${list(top.map((x) => `<b>${esc(x.n)}</b> ${pct(x.d1)}`))} did best, while ${list(bot.map((x) => `<b>${esc(x.n)}</b> ${pct(x.d1)}`))} did worst.</p>
      <p>Over the past month, ${esc(lead.n)} has been the strongest sector at ${pct(lead.m1)}.</p>`,
      `<a href="heatmap.html">Sector performance over time</a>`);
  }

  // ---- movers among large companies
  const large = M.stocks.filter((s) => (s.mcapUsd || 0) >= 10e9 && s.d1 != null);
  if (large.length) {
    const g = large.slice().sort((a, b) => b.d1 - a.d1).slice(0, 5), l = large.slice().sort((a, b) => a.d1 - b.d1).slice(0, 5);
    const vol = large.filter((s) => s.relVol >= 2).sort((a, b) => b.relVol - a.relVol).slice(0, 5);
    section("Biggest moves among large companies", `
      <div class="brief-two">
        <div><h3>Up the most</h3><ul class="brief-movers">${g.map((s) => `<li>${link(s)} <span class="muted">${esc(s.n)}</span> ${pct(s.d1, 2)}</li>`).join("")}</ul></div>
        <div><h3>Down the most</h3><ul class="brief-movers">${l.map((s) => `<li>${link(s)} <span class="muted">${esc(s.n)}</span> ${pct(s.d1, 2)}</li>`).join("")}</ul></div>
      </div>
      ${vol.length ? `<p>Unusually heavy trading in ${list(vol.map((s) => `${link(s)} (${s.relVol.toFixed(1)}× normal volume, ${pct(s.d1)})`))}, often a sign of news.</p>` : ""}`,
      `Companies worth $10B or more. <a href="movers.html">All movers</a>`);
  }

  // ---- highs, lows and signals
  const hi = M.stocks.filter((s) => s.fromHi != null && s.fromHi >= -0.5), lo = M.stocks.filter((s) => s.fromLo != null && s.fromLo <= 0.5);
  const sig = (k) => M.stocks.filter((s) => (s.sig || []).includes(k)).sort((a, b) => (b.mcapUsd || 0) - (a.mcapUsd || 0));
  const gc = sig("goldenCross"), dc = sig("deathCross"), vu = sig("volUp");
  const names = (arr) => list(arr.slice(0, 4).map(link)) + (arr.length > 4 ? ` and ${arr.length - 4} more` : "");
  section("Highs, lows and chart signals", `
    <p class="brief-lead">${hi.length} stocks closed at or near a 52-week high and ${lo.length} near a 52-week low${hi.length > lo.length * 2 ? ", a sign of broad strength" : lo.length > hi.length * 2 ? ", a sign of broad weakness" : ""}.</p>
    <ul class="brief-list">
      ${hi.length ? `<li>Near highs: ${names(hi.sort((a, b) => (b.mcapUsd || 0) - (a.mcapUsd || 0)))}.</li>` : ""}
      ${gc.length ? `<li>Golden crosses (50-day average moving above the 200-day): ${names(gc)}.</li>` : ""}
      ${dc.length ? `<li>Death crosses (50-day average moving below the 200-day): ${names(dc)}.</li>` : ""}
      ${vu.length ? `<li>Rose on heavy volume: ${names(vu)}.</li>` : ""}
    </ul>`, `<a href="signals.html">All signals</a>`);

  // ---- your watchlist
  const mine = [...new Set(Watch.all().lists.flatMap((l) => l.tickers))].map((t) => M.byTicker[t]).filter((s) => s && s.d1 != null);
  if (mine.length) {
    const avg = mine.reduce((a, s) => a + s.d1, 0) / mine.length;
    const sorted = mine.slice().sort((a, b) => b.d1 - a.d1);
    const up = mine.filter((s) => s.d1 > 0).length;
    const soon = mine.filter((s) => s.earnings && (new Date(s.earnings + "T12:00:00Z") - when) / 864e5 >= -1 && (new Date(s.earnings + "T12:00:00Z") - when) / 864e5 <= 7);
    section("Your watchlist", `<p class="brief-lead">Your ${mine.length} watched stocks moved ${pct(avg, 2)} on average, with ${up} up and ${mine.length - up} down. ${sorted.length > 1 ? `Best was ${linkN(sorted[0])} ${pct(sorted[0].d1)}, worst was ${linkN(sorted[sorted.length - 1])} ${pct(sorted[sorted.length - 1].d1)}.` : ""}</p>
      ${soon.length ? `<p>Reporting earnings soon: ${list(soon.map((s) => `${link(s)} on ${new Date(s.earnings + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`))}.</p>` : ""}`,
      `<a href="watchlist.html">Open your watchlists</a>`);
  }

  // ---- coming up
  const today = new Date(Date.UTC(when.getFullYear(), when.getMonth(), when.getDate()));
  const iso = (d) => d.toISOString().slice(0, 10);
  const end = new Date(today); end.setUTCDate(end.getUTCDate() + 7);
  const earn = M.stocks.filter((s) => s.earnings && s.earnings >= iso(today) && s.earnings <= iso(end)).sort((a, b) => (b.mcapUsd || 0) - (a.mcapUsd || 0));
  const exd = M.stocks.filter((s) => s.exDiv && s.exDiv >= iso(today) && s.exDiv <= iso(end) && s.divYield >= 3).sort((a, b) => b.divYield - a.divYield);
  if (earn.length || exd.length) {
    section("Coming up this week", `
      ${earn.length ? `<p class="brief-lead">${earn.length} companies report earnings in the next 7 days, including ${list(earn.slice(0, 6).map((s) => `${link(s)} (${new Date(s.earnings + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short" })})`))}.</p>` : ""}
      ${exd.length ? `<p>Going ex-dividend with yields of 3% or more: ${list(exd.slice(0, 5).map((s) => `${link(s)} ${s.divYield.toFixed(1)}%`))}.</p>` : ""}`,
      `<a href="calendar.html">Calendar</a> · <a href="dividends.html">Dividends</a>`);
  }

  $("brief").innerHTML = sections.join("");
})();
