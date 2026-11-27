// "Markets at a glance" strip at the top of Market News: each index's move today with its 3-month line,
// leading to the Today page's charts. Refreshes with the data every 15 minutes.
(function () {
  const box = document.getElementById("glance");
  if (!box) return;
  const { esc, pct, spark } = UI;
  async function draw() {
    let D;
    try { D = await fetch(`data.json?t=${Date.now()}`, { cache: "no-cache" }).then((r) => r.json()); } catch { return; }
    const idx = (D.indexes || []).filter((i) => i.chg1d != null);
    if (!idx.length) return;
    box.innerHTML = `<div class="glance-head"><h2>Markets at a glance</h2><a href="today.html">See all the charts →</a></div>
      <div class="glance-row">${idx.map((i) => `<a class="glance-card ${i.chg1d > 0.05 ? "up" : i.chg1d < -0.05 ? "down" : ""}" href="today.html" title="${esc(i.name)}">
        <span class="glance-name">${esc(i.name.replace(/ \(.*\)/, ""))}</span>${pct(i.chg1d, 2)}${spark((i.spark || []).slice(-63), 96, 24)}</a>`).join("")}</div>`;
    box.hidden = false;
  }
  draw();
  setInterval(draw, 15 * 60 * 1000);
})();
