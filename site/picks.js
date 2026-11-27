// "How past buy ideas have done" on the Markets page, from recap.json (build_recap.py saves each week's picks
// and compares them with the latest close and with their own market over the same time).
(async function () {
  const { esc, pct, stockUrl } = UI;
  const box = document.getElementById("track");
  if (!box) return;
  let R;
  try { R = await UI.load("recap.json"); } catch { R = null; }
  const weeks = (R && R.weeks) || [];
  const buys = weeks.flatMap((w) => w.picks.filter((p) => p.k === "buy" && p.ret != null).map((p) => ({ ...p, week: w.week })));
  if (!buys.length) {
    box.innerHTML = `<div class="panel empty">Each week's buy ideas are saved when they're published. Their results show here from the week after.</div>`;
    return;
  }
  const wk = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const vs = buys.filter((p) => p.bret != null);
  const beat = vs.filter((p) => p.ret > p.bret).length;
  const avg = (a, k) => a.length ? a.reduce((s, p) => s + p[k], 0) / a.length : null;
  const sorted = buys.slice().sort((a, b) => b.ret - a.ret);
  const pick = (p) => `<a href="${stockUrl(p.t)}" title="${esc(p.n || "")}, picked the week of ${esc(wk(p.week))}"><b>${esc(p.s || p.t)}</b> ${pct(p.ret)}</a>`;
  box.innerHTML = `
    <div class="panel track">
      <div class="track-stats">
        <div><span class="muted">Beat their market</span><b class="num">${vs.length ? `${beat} of ${vs.length}` : "–"}</b><span class="muted small">${vs.length ? Math.round(beat / vs.length * 100) + "% of buy ideas" : ""}</span></div>
        <div><span class="muted">Average buy idea</span><b>${pct(avg(buys, "ret"))}</b><span class="muted small">since it was picked</span></div>
        <div><span class="muted">Their markets</span><b>${pct(avg(vs, "bret"))}</b><span class="muted small">over the same time</span></div>
        <div><span class="muted">Weeks tracked</span><b class="num">${weeks.length}</b><span class="muted small">since ${esc(wk(weeks[weeks.length - 1].week))}</span></div>
      </div>
      <div class="track-two">
        <div><h3>Best so far</h3><div class="sig-names">${sorted.slice(0, 5).map(pick).join("")}</div></div>
        <div><h3>Worst so far</h3><div class="sig-names">${sorted.slice(-5).reverse().map(pick).join("")}</div></div>
      </div>
      <ul class="track-weeks">${weeks.map((w) => `<li><span>Week of ${esc(wk(w.week))}</span><span>Buy ideas ${pct(w.buy)}${w.buyBench != null ? ` <span class="muted">vs market ${pct(w.buyBench)}</span>` : ""}</span><span class="muted">${w.buyN ? `${w.buyWins} of ${w.buyN} beat their market` : ""}</span></li>`).join("")}</ul>
      <p class="hint">Price change from the close before each week's ideas were saved to the latest close, before dividends, fees and taxes. Past results don't predict future ones. <a href="today.html#recap-sec">Every pick, week by week</a></p>
    </div>`;
})();
