// The Weekly Recap page, from recap.json (build_recap.py)
(async function () {
  const { esc, money, pct, stockUrl } = UI;
  const $ = (id) => document.getElementById(id);
  let R;
  try { R = await UI.load("recap.json"); }
  catch (e) {
    $("updated").textContent = "";
    $("recap").innerHTML = `<div class="panel empty">The weekly recap hasn't been built yet. It's written after each weekday's US close.</div>`;
    return;
  }
  const gen = new Date(R.generated);
  $("updated").textContent = "Updated " + gen.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const wk = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  $("lede").textContent = `The week of ${wk(R.weekOf)} in markets, and an honest check on how the site's past buy and sell ideas have done since they were picked.`;
  const out = [];
  const sec = (title, body, cls = "") => out.push(`<section class="panel recap-sec ${cls}"><h2>${title}</h2>${body}</section>`);
  const link = (s) => `<a href="${stockUrl(s.t)}" title="${esc(s.n)}"><b>${esc(s.s || s.t)}</b> <span class="muted">${esc(s.n || "")}</span></a>`;

  // ---- markets
  const ix = (R.indexes || []).filter((i) => i.w1 != null).sort((a, b) => b.w1 - a.w1);
  if (ix.length) {
    const up = ix.filter((i) => i.w1 > 0).length;
    sec("The week in markets", `<p class="brief-lead">${up === ix.length ? "Every market rose" : up === 0 ? "Every market fell" : `${up} of ${ix.length} markets rose`} this week. ${esc(ix[0].n)} did best at ${pct(ix[0].w1)}${ix.length > 1 ? `, ${esc(ix[ix.length - 1].n)} worst at ${pct(ix[ix.length - 1].w1)}` : ""}.</p>
      <div class="recap-ix">${ix.map((i) => `<div class="recap-card"><span class="muted">${esc(i.n.replace(/ \(.*\)/, ""))}</span><b class="num">${i.level != null ? i.level.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "–"}</b><span>Week ${pct(i.w1)}</span><span class="muted small">Month ${pct(i.m1)} · YTD ${pct(i.ytd)}</span></div>`).join("")}</div>`);
  }

  // ---- movers
  const mv = (rows) => `<ol class="recap-list">${rows.map((s) => `<li>${link(s)}<span>${pct(s.w1)}</span></li>`).join("")}</ol>`;
  if ((R.gainers || []).length) {
    sec("Biggest moves this week", `<p class="hint">Companies worth $2 billion or more, all eight markets together.</p>
      <div class="recap-two"><div><h3>Gainers</h3>${mv(R.gainers)}</div><div><h3>Losers</h3>${mv(R.losers || [])}</div></div>`);
  }

  // ---- sectors
  if ((R.sectors || []).length) {
    const max = Math.max(...R.sectors.map((x) => Math.abs(x.w1)), 0.1);
    sec("Sectors", `<p class="hint">Weekly move of each sector, weighted by company size.</p>
      <ul class="recap-bars">${R.sectors.map((x) => `<li><span>${esc(x.n)}</span><span class="rb"><i class="${x.w1 >= 0 ? "pos" : "neg"}" style="width:${(Math.abs(x.w1) / max * 50).toFixed(1)}%"></i></span>${pct(x.w1)}</li>`).join("")}</ul>`);
  }

  // ---- rates, commodities, crypto and earnings
  const mac = (R.macro || []).filter((m) => m.w1 != null);
  if (mac.length || (R.earnings || []).length) {
    sec("Rates, commodities and earnings", `<div class="recap-two">
      ${mac.length ? `<div><h3>Rates, commodities and crypto</h3><ul class="recap-list plain">${mac.map((m) => `<li><a href="${stockUrl(m.t)}"><b>${esc(m.n)}</b></a><span>${pct(m.w1)}</span></li>`).join("")}</ul></div>` : ""}
      ${(R.earnings || []).length ? `<div><h3>Biggest earnings reactions</h3><ul class="recap-list plain">${R.earnings.map((e) => `<li>${link(e)}<span>${e.sp != null ? `<span class="pill ${e.sp > 0 ? "buy" : "sell"}">${e.sp > 0 ? "Beat" : "Missed"}</span> ` : ""}${pct(e.mv)}</span></li>`).join("")}</ul></div>` : ""}
    </div>`);
  }

  // ---- report card on past picks
  const weeks = R.weeks || [];
  if (weeks.length) {
    const rows = weeks.map((w, n) => `<details class="recap-week"${n === 0 ? " open" : ""}>
      <summary><b>Week of ${esc(wk(w.week))}</b>
        <span>Buy ideas ${pct(w.buy)}${w.buyBench != null ? ` <span class="muted">vs market ${pct(w.buyBench)}</span>` : ""}${w.buyN ? ` <span class="muted">· ${w.buyWins} of ${w.buyN} beat their market</span>` : ""}</span>
        <span>Sell ideas ${pct(w.sell)}</span></summary>
      <div class="table-wrap"><table class="grid-table"><thead><tr><th class="left">Pick</th><th class="left">Type</th><th>Picked at</th><th>Now</th><th>Change</th><th class="hide-sm">Its market</th></tr></thead>
      <tbody>${w.picks.map((p) => `<tr><td class="left"><a href="${stockUrl(p.t)}"><b>${esc(p.s || p.t)}</b> <span class="muted">${esc(p.n || "")}</span></a></td>
        <td class="left"><span class="pill ${p.k === "buy" ? "buy" : p.k === "sell" ? "sell" : ""}">${p.k === "buy" ? "Buy idea" : p.k === "sell" ? "Sell idea" : "To watch"}</span></td>
        <td class="num">${money(p.p, p.cur || "USD")}</td><td class="num">${money(p.now, p.cur || "USD")}</td><td>${pct(p.ret)}</td><td class="hide-sm">${pct(p.bret)}</td></tr>`).join("")}</tbody></table></div>
    </details>`).join("");
    const all = weeks.flatMap((w) => w.picks.filter((p) => p.k === "buy" && p.bret != null));
    const beat = all.filter((p) => p.ret > p.bret).length;
    sec("How the picks have done", `<p class="brief-lead">${all.length ? `Across the last ${weeks.length} week${weeks.length === 1 ? "" : "s"}, <b>${beat} of ${all.length}</b> buy ideas (${Math.round(beat / all.length * 100)}%) have done better than their market since they were picked.` : "The first week's picks were just saved; their results show here from next week."}
      A sell idea "works" when it falls or lags its market.</p>${rows}`, "recap-picks");
  } else {
    sec("How the picks have done", `<p>Each week's buy and sell ideas are saved when they're published, and from next week this section tracks how they've done since.</p>`);
  }
  $("recap").innerHTML = out.join("");
})();
