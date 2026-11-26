// "Recent results" on the Earnings page: who beat or missed in the last 30 days (surprises.json, from build_ratings.py)
(async function () {
  const { esc, money, pct, big, stockUrl, store } = UI;
  const $ = (id) => document.getElementById(id);
  let R;
  try { R = await UI.load("surprises.json"); } catch { return; }
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const qCut = new Date(Date.now() - 80 * 864e5).toISOString().slice(0, 10);
  // A report counts as recent from its reaction day, or (when that couldn't be found) from a quarter that just ended
  const recent = (R.stocks || []).filter((r) => r.sp != null && (r.rd ? r.rd >= cutoff : r.q >= qCut));
  if (!recent.length) return;
  $("results-sec").hidden = false;
  const KINDS = [["all", "All"], ["beat", "Beat"], ["miss", "Missed"], ["big", "Big moves"]];
  const state = { kind: "all", ...store.get("earningsResults", {}) };
  const sort = { key: "mcapUsd", dir: -1 };
  const qName = (iso) => { const d = new Date(iso + "T12:00:00Z"); return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`; };

  function render() {
    store.set("earningsResults", state);
    $("res-kind").innerHTML = KINDS.map(([k, l]) => `<button role="tab" aria-selected="${k === state.kind}" data-k="${k}">${l}</button>`).join("");
    const mkt = $("market") ? $("market").value : "", size = +($("size") ? $("size").value : 0) * 1e9;
    let rows = recent.filter((r) => (!mkt || (r.ix || []).includes(mkt)) && (r.mcapUsd || 0) >= size);
    const beats = rows.filter((r) => r.sp > 0).length;
    $("res-sum").textContent = rows.length ? `${beats} of ${rows.length} beat expectations (${Math.round(beats / rows.length * 100)}%)` : "";
    if (state.kind === "beat") rows = rows.filter((r) => r.sp > 0);
    if (state.kind === "miss") rows = rows.filter((r) => r.sp <= 0);
    if (state.kind === "big") rows = rows.filter((r) => r.mv != null && Math.abs(r.mv) >= 5);
    UI.table($("results"), [
      { key: "n", label: "Company", left: true, sm: true, val: (r) => r.n,
        html: (r) => `<div class="co-row">${UI.star(r.t)}<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.n)}</a></span><span class="tk">${esc(r.s)}${r.sector ? " · " + esc(r.sector) : ""}</span></div></div>` },
      { key: "q", label: "Quarter", val: (r) => r.q, html: (r) => `<span class="num">${qName(r.q)}</span>` },
      { key: "e", label: "Expected EPS", val: (r) => r.e, html: (r) => `<span class="num">${r.e != null ? money(r.e, r.cur) : "–"}</span>` },
      { key: "a", label: "Actual EPS", val: (r) => r.a, html: (r) => `<span class="num"><b>${money(r.a, r.cur)}</b></span>` },
      { key: "sp", label: "Surprise", sm: true, val: (r) => r.sp, html: (r) => `<span class="pill ${r.sp > 0 ? "buy" : "sell"}">${r.sp > 0 ? "Beat" : "Missed"}</span> ${pct(r.sp, 1)}` },
      { key: "mv", label: "Move", title: "The stock's move on the day the market reacted (the busiest trading day after the quarter ended)", sm: true, val: (r) => r.mv, html: (r) => r.mv != null ? pct(r.mv, 1) : "–" },
      { key: "rd", label: "Reacted", val: (r) => r.rd || "", html: (r) => `<span class="num">${r.rd ? new Date(r.rd + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "–"}</span>` },
      { key: "beats", label: "Record", title: "Quarters that beat expectations, out of the last four", val: (r) => r.of ? r.beats / r.of : null, html: (r) => r.of ? `<span class="num">${r.beats}/${r.of}</span>` : "–" },
      { key: "mcapUsd", label: "Mkt cap", val: (r) => r.mcapUsd, html: (r) => `<span class="num">${big(r.mcapUsd)}</span>` },
    ], rows.slice(), sort, { empty: "No results match." });
  }
  $("res-kind").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.kind = b.dataset.k; render(); } });
  for (const id of ["market", "size"]) if ($(id)) $(id).addEventListener("change", render);
  render();
})();
