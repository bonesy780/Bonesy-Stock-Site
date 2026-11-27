// The brief on the Today page, drawn as charts and tiles. It starts from market.json (every stock's facts,
// rebuilt each evening) and lays the latest prices from pulse.json and data.json over it; the workflow
// rewrites those every 15 minutes while markets trade. The page fetches them again every 15 minutes and
// redraws every chart, so it keeps up through the day without a reload.
(function () {
  const { esc, pct, stockUrl, Watch } = UI;
  const $ = (id) => document.getElementById(id);
  const EVERY = 15 * 60 * 1000;
  const get = (file) => fetch(`${file}?t=${Date.now()}`, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(file); return r.json(); });

  const name = (i) => i.name.replace(/ \(.*\)/, "");
  const sign = (v, nd = 1) => v == null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(nd)}%`;
  const tone = (v) => v == null ? "" : v > 0.05 ? "up" : v < -0.05 ? "down" : "flat";
  const day = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
  // Size-weighted average of a figure across stocks
  const cw = (stocks, k) => {
    const have = stocks.filter((s) => s[k] != null && s.mcapUsd);
    const w = have.reduce((a, s) => a + s.mcapUsd, 0);
    return w ? have.reduce((a, s) => a + s[k] * s.mcapUsd, 0) / w : null;
  };
  const card = (title, body, more, cls = "") =>
    `<section class="panel brief-sec ig ${cls}"><h2>${title}</h2>${body}${more ? `<p class="brief-more">${more}</p>` : ""}</section>`;

  // Bars that grow left (down) or right (up) from a centre line, scaled to the largest move shown
  function diverging(rows, { nd = 1, max } = {}) {
    const m = max || Math.max(0.5, ...rows.map((r) => Math.abs(r.v ?? 0)));
    return `<ul class="ig-div">${rows.map((r) => {
      const w = Math.min(50, Math.abs(r.v ?? 0) / m * 50);
      const lab = r.href ? `<a href="${r.href}">${esc(r.label)}</a>` : esc(r.label);
      return `<li title="${esc(r.title || `${r.label}: ${sign(r.v, nd)}`)}"><span class="ig-lab">${lab}</span>
        <span class="ig-track"><i class="${(r.v ?? 0) >= 0 ? "pos" : "neg"}" style="${(r.v ?? 0) >= 0 ? "left:50%" : `right:50%`};width:${w.toFixed(1)}%"></i></span>
        <span class="ig-val num ${tone(r.v)}">${sign(r.v, nd)}</span></li>`;
    }).join("")}</ul>`;
  }
  // One bar split into up and down shares
  const split = (up, down, upLabel, downLabel) => {
    const t = up + down || 1;
    return `<div class="ig-split" title="${up} ${upLabel}, ${down} ${downLabel}">
      <i class="pos" style="width:${(up / t * 100).toFixed(1)}%"></i><i class="neg" style="width:${(down / t * 100).toFixed(1)}%"></i></div>
      <div class="ig-split-key"><span><b class="num up">${up}</b> ${upLabel}</span><span><b class="num down">${down}</b> ${downLabel}</span></div>`;
  };
  // A 0 to 100 meter
  const meter = (v, label) => v == null ? "" :
    `<div class="ig-meter" title="${esc(label)}: ${Math.round(v)}%"><i style="width:${Math.max(0, Math.min(100, v)).toFixed(0)}%"></i></div>`;

  async function draw() {
    let M, D = null, P = null, mac = null, E = null;
    try {
      [M, D, P, mac, E] = await Promise.all([
        get("market.json"), get("data.json").catch(() => null), get("pulse.json").catch(() => null),
        get("macro.json").catch(() => null), get("econ.json").catch(() => null),
      ]);
    } catch (e) {
      if (!$("brief").children.length) $("brief").innerHTML = `<div class="panel empty">Stock data could not be loaded. Trying again in 15 minutes.</div>`;
      return;
    }
    // Lay the latest prices over the evening's facts
    const live = (P && P.s) || {};
    const stocks = M.stocks.map((s) => {
      const q = live[s.t];
      return q ? { ...s, p: q[0] ?? s.p, d1: q[1] ?? s.d1, w1: q[2] ?? s.w1, fromHi: q[3] ?? s.fromHi } : s;
    });
    const byT = Object.fromEntries(stocks.map((s) => [s.t, s]));
    const times = [M.generated, D && D.generated, P && P.generated].filter(Boolean).map((t) => new Date(t));
    const asOf = new Date(Math.max(...times));
    UI.updated(asOf);
    const out = [];

    // ---- markets: one card per index with its move, a 3-month line, breadth and trend
    const idx = ((D && D.indexes) || []).filter((i) => i.chg1d != null).sort((a, b) => b.chg1d - a.chg1d);
    if (idx.length) {
      const up = idx.filter((i) => i.chg1d > 0).length;
      const all = stocks.filter((s) => s.d1 != null);
      const adv = all.filter((s) => s.d1 > 0).length, dec = all.filter((s) => s.d1 < 0).length;
      const cards = idx.map((i) => {
        const st = stocks.filter((s) => s.ix.includes(i.id));
        const a = st.filter((s) => s.d1 > 0).length, d = st.filter((s) => s.d1 < 0).length;
        const a200 = st.filter((s) => s.sma200 != null && s.p != null);
        const pa = a200.length ? a200.filter((s) => s.p > s.sma200).length / a200.length * 100 : null;
        return `<a class="ig-ix ${tone(i.chg1d)}" href="markets.html" title="${esc(name(i))}: ${a} stocks up, ${d} down${pa != null ? `, ${Math.round(pa)}% above their 200-day average` : ""}">
          <span class="ig-ix-name">${esc(name(i))}</span>
          <b class="num ig-big ${tone(i.chg1d)}">${sign(i.chg1d, 2)}</b>
          <span class="num muted">${i.level != null ? i.level.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "–"}</span>
          ${UI.spark((i.spark || []).slice(-63), 120, 30)}
          <span class="ig-mini">${split(a, d, "up", "down")}</span>
          <span class="ig-row"><span class="muted">Above 200-day</span><span class="num">${pa != null ? Math.round(pa) + "%" : "–"}</span></span>${meter(pa, "Above their 200-day average")}
          <span class="ig-row"><span><span class="muted">Week</span> ${pct(i.chg1w)}</span><span><span class="muted">YTD</span> ${pct(i.ytd)}</span></span>
        </a>`;
      }).join("");
      out.push(card(`Markets <span class="ig-tag">${up} of ${idx.length} up</span>`,
        `<div class="ig-ix-grid">${cards}</div>
         <h3>All stocks on the site</h3>${split(adv, dec, "rising", "falling")}`,
        `<a href="markets.html">Top 10 in each market</a> · <a href="heatmap.html">Heatmap</a>`, "wide"));
    }

    // ---- rates, commodities and crypto as tiles
    const items = ((mac && mac.items) || []).filter((m) => m.p != null);
    if (items.length && window.Macro) {
      out.push(card("Rates, commodities and crypto",
        `<div class="ig-tiles">${items.map((m) => `<a class="ig-tile ${tone(m.d1)}" href="${stockUrl(m.t)}" title="${esc(m.why || m.n)}">
          <span class="muted">${esc(m.s || m.n)}</span><b class="num">${Macro.level(m)}</b><span>${Macro.move(m)}</span>${UI.spark(m.spark, 84, 20)}</a>`).join("")}</div>`,
        `<a href="funds.html">ETFs and crypto</a>`));
    }

    // ---- sectors: today's size-weighted move, as diverging bars
    const bySec = {};
    for (const s of stocks) if (s.sector) (bySec[s.sector] ||= []).push(s);
    const secs = Object.entries(bySec).map(([n, st]) => ({ n, d1: cw(st, "d1"), m1: cw(st, "m1") })).filter((x) => x.d1 != null).sort((a, b) => b.d1 - a.d1);
    if (secs.length > 3) {
      out.push(card("Sectors today",
        diverging(secs.map((x) => ({ label: x.n, v: x.d1, href: "heatmap.html", title: `${x.n}: ${sign(x.d1, 2)} today, ${sign(x.m1)} over a month` })), { nd: 2 }),
        `Weighted by company size, all markets together. <a href="heatmap.html">Heatmap</a>`));
    }

    // ---- biggest moves among large companies
    const large = stocks.filter((s) => (s.mcapUsd || 0) >= 10e9 && s.d1 != null);
    if (large.length) {
      const g = large.slice().sort((a, b) => b.d1 - a.d1).slice(0, 6), l = large.slice().sort((a, b) => a.d1 - b.d1).slice(0, 6);
      const max = Math.max(0.5, ...g.concat(l).map((s) => Math.abs(s.d1)));
      const rows = (arr) => diverging(arr.map((s) => ({ label: s.s, v: s.d1, href: stockUrl(s.t), title: `${s.n}: ${sign(s.d1, 2)} today` })), { nd: 1, max });
      const vol = large.filter((s) => s.relVol >= 2).sort((a, b) => b.relVol - a.relVol).slice(0, 6);
      out.push(card("Biggest moves, companies over $10B",
        `<div class="brief-two"><div><h3>Up the most</h3>${rows(g)}</div><div><h3>Down the most</h3>${rows(l)}</div></div>
         ${vol.length ? `<h3>Heavy trading</h3><div class="ig-chips">${vol.map((s) => `<a href="${stockUrl(s.t)}" title="${esc(s.n)}: ${s.relVol.toFixed(1)}× its usual volume"><b>${esc(s.s)}</b> <span class="num">${s.relVol.toFixed(1)}×</span> ${pct(s.d1)}</a>`).join("")}</div>` : ""}`,
        `<a href="screener.html?screen=Gainers">Gainers</a> · <a href="screener.html?screen=Losers">Losers</a> · <a href="screener.html?screen=Unusual%20volume">Unusual volume</a>`));
    }

    // ---- highs, lows and chart signals
    const hi = stocks.filter((s) => s.fromHi != null && s.fromHi >= -0.5), lo = stocks.filter((s) => s.fromLo != null && s.fromLo <= 0.5);
    const sig = (k) => stocks.filter((s) => (s.sig || []).includes(k)).sort((a, b) => (b.mcapUsd || 0) - (a.mcapUsd || 0));
    const SIGS = [["goldenCross", "Golden crosses", "up", "Golden cross"], ["high20", "20-day breakouts", "up", "20-day breakout"], ["volUp", "Volume surges up", "up", "Volume surge up"],
      ["deathCross", "Death crosses", "down", "Death cross"], ["low20", "20-day breakdowns", "down", "20-day breakdown"], ["volDown", "Volume surges down", "down", "Volume surge down"]];
    out.push(card("Highs, lows and chart signals",
      `<h3>Near a 52-week high or low</h3>${split(hi.length, lo.length, "near highs", "near lows")}
       <div class="ig-sigs">${SIGS.map(([k, label, t, screen]) => {
        const arr = sig(k);
        return `<a class="ig-sig ${t}" href="screener.html?screen=${encodeURIComponent(screen)}" title="${esc(arr.slice(0, 8).map((s) => s.s).join(", ") || "None today")}">
          <b class="num">${arr.length}</b><span>${label}</span><span class="muted small">${esc(arr.slice(0, 3).map((s) => s.s).join(" · "))}</span></a>`;
      }).join("")}</div>`,
      `Chart signals update with each evening's rebuild. <a href="screener.html?screen=Golden%20cross">Signals in the screener</a>`));

    // ---- your watchlist as tiles coloured by today's move
    const mine = [...new Set(Watch.all().lists.flatMap((l) => l.tickers))].map((t) => byT[t]).filter((s) => s && s.d1 != null);
    if (mine.length) {
      const avg = mine.reduce((a, s) => a + s.d1, 0) / mine.length;
      const max = Math.max(1, ...mine.map((s) => Math.abs(s.d1)));
      out.push(card(`Your watchlist <span class="ig-tag">${pct(avg, 2)} average</span>`,
        `<div class="ig-heat">${mine.sort((a, b) => b.d1 - a.d1).map((s) => {
          const a = Math.min(1, Math.abs(s.d1) / max);
          return `<a href="${stockUrl(s.t)}" class="${s.d1 >= 0 ? "pos" : "neg"}" style="--a:${(0.15 + a * 0.65).toFixed(2)}" title="${esc(s.n)}: ${sign(s.d1, 2)}"><b>${esc(s.s)}</b><span class="num">${sign(s.d1)}</span></a>`;
        }).join("")}</div>`,
        `<a href="watchlist.html">Your watchlists and alerts</a>`));
    }

    // ---- the next 7 days: earnings, economic releases and ex-dividend dates per day
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const days = [...Array(7)].map((_, n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); });
    const earn = (k) => stocks.filter((s) => s.earnings === k).sort((a, b) => (b.mcapUsd || 0) - (a.mcapUsd || 0));
    const econ = (k) => ((E && E.events) || []).filter((e) => e.key && e.d === k && ["US", "CA", "JP"].includes(e.c));
    const exd = (k) => stocks.filter((s) => s.exDiv === k && s.divYield >= 3);
    const cols = days.map((k) => ({ k, e: earn(k), c: econ(k), x: exd(k) }));
    const most = Math.max(1, ...cols.map((c) => c.e.length));
    if (cols.some((c) => c.e.length || c.c.length || c.x.length)) {
      out.push(card("Coming up this week",
        `<div class="ig-week">${cols.map((c) => `<div class="ig-day" title="${c.e.length} earnings reports, ${c.c.length} key economic releases, ${c.x.length} ex-dividend dates (3%+ yield)">
          <span class="muted">${day(c.k)}</span>
          <span class="ig-col"><i style="height:${(c.e.length / most * 100).toFixed(0)}%"></i></span>
          <b class="num">${c.e.length}</b>
          <span class="ig-names">${c.e.slice(0, 2).map((s) => `<a href="${stockUrl(s.t)}">${esc(s.s)}</a>`).join("")}</span>
          ${c.c.slice(0, 2).map((e) => `<span class="ig-econ" title="${esc(e.why || e.n)}">${e.f} ${esc(e.n)}</span>`).join("")}
          ${c.x.length ? `<span class="ig-ex">${c.x.length} ex-div</span>` : ""}
        </div>`).join("")}</div>
        <p class="hint">Bars: earnings reports each day. Below them: the biggest companies reporting, key economic releases and ex-dividend dates with yields of 3% or more.</p>`,
        `<a href="earnings.html#cal">Earnings calendar</a> · <a href="earnings.html?k=econ#cal">Economic calendar</a> · <a href="dividends.html#cal">Ex-dividend dates</a>`, "wide"));
    }

    $("brief").innerHTML = out.join("");
    const when = $("brief-when");
    if (when) when.innerHTML = `Data as of <b>${asOf.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</b>. Prices refresh every 15 minutes while markets are open, and these charts redraw on their own.`;
  }

  draw();
  setInterval(draw, EVERY);
  // A tab left in the background can miss its timer; catch up when it's looked at again
  let last = Date.now();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - last > EVERY) { last = Date.now(); draw(); } });
  setInterval(() => { last = Date.now(); }, EVERY);
})();
