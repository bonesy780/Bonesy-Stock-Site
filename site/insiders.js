// The Insiders page, from insiders.json (build_ratings.py): recent open-market buys and sales by company insiders
(async function () {
  const { esc, money, pct, big, stockUrl, store } = UI;
  const $ = (id) => document.getElementById(id);
  let D, M;
  try { [D, M] = await Promise.all([UI.load("insiders.json"), UI.market().catch(() => null)]); }
  catch (e) {
    $("updated").textContent = "";
    $("table").innerHTML = `<div class="empty">Insider trades haven't been gathered yet. They're collected every weekday after the US close.</div>`;
    return;
  }
  UI.updated(D.generated);
  if (M) $("market").innerHTML += M.indexes.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
  const now = (t) => (M && M.byTicker[t] ? M.byTicker[t].p : null);

  const KINDS = {
    cluster: ["Cluster buys", "Stocks where two or more insiders bought shares on the open market in the last 90 days. The biggest total first."],
    buys: ["Biggest buys", "Single open-market purchases by insiders in the last 90 days, largest first."],
    sells: ["Biggest sales", "Single sales by insiders in the last 90 days, largest first. Planned sales (10b5-1 plans) and tax sales are common and say less than buys."],
    net: ["6-month tally", "Each company's insider buys and sales over the last six months, as counted by Yahoo Finance. More buyers than sellers is the rarer, stronger sign."],
  };
  const state = { kind: "cluster", market: "", size: "0", ...store.get("insiders", {}) };
  if (!KINDS[state.kind]) state.kind = "cluster";
  $("market").value = state.market; $("size").value = state.size;
  const sorts = { cluster: { key: "total", dir: -1 }, buys: { key: "vUsd", dir: -1 }, sells: { key: "vUsd", dir: -1 }, net: { key: "bn", dir: -1 } };

  const keep = (r) => (!state.market || (r.ix || []).includes(state.market)) && (r.mcapUsd || 0) >= +state.size * 1e9;
  const co = (r) => `<div class="co-row">${UI.star(r.t)}<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.n)}</a></span><span class="tk">${esc(r.s)}${r.sector ? " · " + esc(r.sector) : ""}</span></div></div>`;
  const since = (r) => { const p = now(r.t); return p && r.pr ? (p / r.pr - 1) * 100 : null; };
  const day = (d) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" });

  function clusters() {
    const by = {};
    for (const b of D.buys || []) {
      const c = (by[b.t] ||= { ...b, who: new Set(), total: 0, n: b.n, last: b.d, trades: 0 });
      c.who.add(b.who); c.total += b.vUsd || 0; c.trades++; if (b.d > c.last) c.last = b.d;
    }
    return Object.values(by).filter((c) => c.who.size >= 2).map((c) => ({ ...c, people: c.who.size, names: [...c.who] }));
  }

  function render() {
    store.set("insiders", state);
    $("kind").innerHTML = Object.entries(KINDS).map(([k, [l]]) => `<button role="tab" aria-selected="${k === state.kind}" data-k="${k}">${l}</button>`).join("");
    $("title").textContent = KINDS[state.kind][0];
    $("help").textContent = KINDS[state.kind][1];
    const trade = [
      { key: "d", label: "Date", left: true, sm: true, val: (r) => r.d, html: (r) => `<span class="num">${day(r.d)}</span>` },
      { key: "n", label: "Company", left: true, sm: true, val: (r) => r.n, html: co },
      { key: "who", label: "Insider", left: true, val: (r) => r.who, html: (r) => `${esc(r.who)}<div class="tk">${esc(r.rel || "")}</div>` },
      { key: "sh", label: "Shares", val: (r) => r.sh, html: (r) => `<span class="num">${UI.compact(r.sh)}</span>` },
      { key: "pr", label: "Price", val: (r) => r.pr, html: (r) => `<span class="num">${r.pr ? money(r.pr, r.cur) : "–"}</span>` },
      { key: "vUsd", label: "Value (USD)", sm: true, val: (r) => r.vUsd, html: (r) => `<span class="num"><b>${big(r.vUsd)}</b></span>` },
      { key: "since", label: "Stock since", title: "The stock's move from the trade price to the latest close", val: since, html: (r) => { const v = since(r); return v == null ? "–" : pct(v, 1); } },
    ];
    if (state.kind === "buys" || state.kind === "sells") {
      UI.table($("table"), trade, (state.kind === "buys" ? D.buys : D.sells || []).filter(keep), sorts[state.kind], { empty: "No insider trades match." });
    } else if (state.kind === "cluster") {
      UI.table($("table"), [
        { key: "n", label: "Company", left: true, sm: true, val: (r) => r.n, html: co },
        { key: "people", label: "Insiders", sm: true, val: (r) => r.people, html: (r) => `<span class="num"><b>${r.people}</b></span><div class="tk" title="${esc(r.names.join(", "))}">${esc(r.names.slice(0, 3).join(", "))}${r.names.length > 3 ? "…" : ""}</div>` },
        { key: "trades", label: "Buys", val: (r) => r.trades, html: (r) => `<span class="num">${r.trades}</span>` },
        { key: "total", label: "Total (USD)", sm: true, val: (r) => r.total, html: (r) => `<span class="num"><b>${big(r.total)}</b></span>` },
        { key: "last", label: "Latest", val: (r) => r.last, html: (r) => `<span class="num">${day(r.last)}</span>` },
        { key: "mcapUsd", label: "Mkt cap", val: (r) => r.mcapUsd, html: (r) => `<span class="num">${big(r.mcapUsd)}</span>` },
      ], clusters().filter(keep), sorts.cluster, { empty: "No cluster buys in the last 90 days for this selection." });
    } else {
      UI.table($("table"), [
        { key: "n", label: "Company", left: true, sm: true, val: (r) => r.n, html: co },
        { key: "bn", label: "Buys", sm: true, val: (r) => r.bn || 0, html: (r) => `<span class="num up">${r.bn || 0}</span>` },
        { key: "sn", label: "Sales", sm: true, val: (r) => r.sn || 0, html: (r) => `<span class="num down">${r.sn || 0}</span>` },
        { key: "ns", label: "Net shares", title: "Shares bought minus shares sold (including shares received from awards and options)", val: (r) => r.ns, html: (r) => `<span class="num ${r.ns >= 0 ? "up" : "down"}">${r.ns != null ? (r.ns >= 0 ? "+" : "") + UI.compact(r.ns) : "–"}</span>` },
        { key: "npct", label: "Net % of insider shares", val: (r) => r.npct, html: (r) => r.npct != null ? pct(r.npct, 1) : "–" },
        { key: "mcapUsd", label: "Mkt cap", val: (r) => r.mcapUsd, html: (r) => `<span class="num">${big(r.mcapUsd)}</span>` },
      ], (D.net || []).filter(keep), sorts.net, { empty: "No insider activity for this selection." });
    }
  }
  $("kind").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.kind = b.dataset.k; render(); } });
  $("market").addEventListener("change", () => { state.market = $("market").value; render(); });
  $("size").addEventListener("change", () => { state.size = $("size").value; render(); });
  render();
})();
