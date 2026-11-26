// The ETFs and Crypto page, from funds.json (build_macro.py), with live prices when the price service is on
(async function () {
  const { esc, money, pct, big, stockUrl, store, spark } = UI;
  const $ = (id) => document.getElementById(id);
  let D;
  try { D = await UI.load("funds.json"); }
  catch (e) {
    $("updated").textContent = "";
    $("table").innerHTML = `<div class="empty">ETF and crypto prices haven't been gathered yet. They refresh every 15 minutes.</div>`;
    return;
  }
  const stamp = () => { UI.updated(D.generated); };
  stamp();
  $("group").innerHTML += (D.groups || []).filter((g) => D.etfs.some((e) => e.g === g)).map((g) => `<option>${esc(g)}</option>`).join("");
  const state = { kind: "etf", group: "", ...store.get("funds", {}) };
  const asked = new URLSearchParams(location.search).get("k");
  if (asked === "crypto" || asked === "etf") state.kind = asked;
  $("group").value = state.group;
  const sorts = { etf: { key: "aum", dir: -1 }, crypto: { key: "mcap", dir: -1 } };
  let open = null;

  const name = (r, sub) => `<div class="co-row">${UI.star(r.t)}<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.n)}</a></span><span class="tk">${esc(r.t.replace(/-USD$/, ""))}${sub ? " · " + esc(sub) : ""}</span></div></div>`;
  const pc = (v, nd = 2) => (v == null ? "–" : v.toFixed(nd) + "%");

  function render() {
    store.set("funds", state);
    for (const b of $("kind").querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.k === state.kind));
    $("group-wrap").hidden = state.kind !== "etf";
    if (state.kind === "etf") {
      $("title").textContent = state.group || "Popular ETFs";
      $("help").textContent = "Fee is the yearly cost as a share of what you hold (0.10% = $1 a year per $1,000). Tap a fund for its top holdings and sectors.";
      const rows = D.etfs.filter((e) => !state.group || e.g === state.group);
      UI.table($("table"), [
        { key: "n", label: "Fund", left: true, sm: true, val: (r) => r.n, html: (r) => name(r, state.group ? r.cat : r.g) },
        { key: "p", label: "Price", sm: true, val: (r) => r.p, html: (r) => `<span class="num">${money(r.p, r.cur)}</span>` },
        { key: "d1", label: "Day", sm: true, val: (r) => r.d1, html: (r) => pct(r.d1, 2) },
        { key: "m1", label: "1M", val: (r) => r.m1, html: (r) => pct(r.m1) },
        { key: "ytd", label: "YTD", val: (r) => r.ytd, html: (r) => pct(r.ytd) },
        { key: "y1", label: "1Y", val: (r) => r.y1, html: (r) => pct(r.y1) },
        { key: "fee", label: "Fee", title: "Yearly expense ratio", val: (r) => r.fee, html: (r) => `<span class="num">${pc(r.fee)}</span>` },
        { key: "yld", label: "Yield", val: (r) => r.yld, html: (r) => `<span class="num">${pc(r.yld)}</span>` },
        { key: "aum", label: "Size", title: "Total assets in the fund", val: (r) => r.aum, html: (r) => `<span class="num">${big(r.aum)}</span>` },
        { key: "spark", label: "30 days", html: (r) => spark(r.spark) },
        { key: "x", label: "", html: (r) => r.hold || r.sectors ? `<button class="btn small" data-open="${esc(r.t)}">Details</button>` : "" },
      ], rows, sorts.etf, { empty: "No funds in this group." });
    } else {
      $("title").textContent = "The 10 biggest cryptocurrencies";
      $("help").textContent = "By market value, in US dollars, leaving out stablecoins (coins pegged to the dollar). Crypto trades around the clock, so the day's move is over the last 24 hours of daily closes.";
      UI.table($("table"), [
        { key: "n", label: "Coin", left: true, sm: true, val: (r) => r.n, html: (r) => name(r) },
        { key: "p", label: "Price", sm: true, val: (r) => r.p, html: (r) => `<span class="num">${money(r.p, "USD")}</span>` },
        { key: "d1", label: "Day", sm: true, val: (r) => r.d1, html: (r) => pct(r.d1, 2) },
        { key: "w1", label: "1W", val: (r) => r.w1, html: (r) => pct(r.w1) },
        { key: "m1", label: "1M", val: (r) => r.m1, html: (r) => pct(r.m1) },
        { key: "ytd", label: "YTD", val: (r) => r.ytd, html: (r) => pct(r.ytd) },
        { key: "y1", label: "1Y", val: (r) => r.y1, html: (r) => pct(r.y1) },
        { key: "mcap", label: "Market value", val: (r) => r.mcap, html: (r) => `<span class="num">${big(r.mcap)}</span>` },
        { key: "lo52", label: "From 52W high", val: (r) => r.hi52 ? r.p / r.hi52 : null, html: (r) => r.hi52 ? pct((r.p / r.hi52 - 1) * 100, 0) : "–" },
        { key: "spark", label: "30 days", html: (r) => spark(r.spark) },
      ], D.crypto || [], sorts.crypto, { empty: "No crypto prices yet." });
    }
    detail();
  }

  function detail() {
    const r = state.kind === "etf" && open && D.etfs.find((e) => e.t === open);
    const box = $("detail");
    if (!r) { box.hidden = true; return; }
    box.hidden = false;
    const maxW = Math.max(...(r.hold || []).map((h) => h.w), 1);
    box.innerHTML = `<div class="fd-head"><h2>${esc(r.n)} <span class="muted">${esc(r.t)}</span></h2><button class="x" id="fd-x" aria-label="Close details">✕</button></div>
      <p class="hint">${[r.fam, r.cat, r.since ? "since " + new Date(r.since + "T12:00:00Z").getFullYear() : null].filter(Boolean).map(esc).join(" · ")}${r.y3 != null ? ` · 3-year average return ${pc(r.y3, 1)} a year` : ""}${r.y5 != null ? `, 5-year ${pc(r.y5, 1)}` : ""}</p>
      <div class="fd-cols">
        ${r.hold && r.hold.length ? `<div><h3>Top holdings</h3><ul class="fd-bars">${r.hold.map((h) => `<li><a href="${h.s ? stockUrl(h.s) : "#"}">${esc(h.n)}</a><span class="fd-bar"><i style="width:${(h.w / maxW * 100).toFixed(0)}%"></i></span><b class="num">${h.w.toFixed(1)}%</b></li>`).join("")}</ul>
          <p class="hint">The ten biggest make up ${r.hold.reduce((a, h) => a + h.w, 0).toFixed(0)}% of the fund.</p></div>` : ""}
        ${r.sectors && r.sectors.length ? `<div><h3>Sectors</h3><ul class="fd-bars">${r.sectors.map(([n, w]) => `<li><span>${esc(n)}</span><span class="fd-bar"><i style="width:${w}%"></i></span><b class="num">${w.toFixed(1)}%</b></li>`).join("")}</ul></div>` : ""}
      </div>
      <p class="hint"><a href="compare.html?t=${encodeURIComponent(r.t)},^GSPC">Compare with the S&amp;P 500</a> · <a href="backtest.html">Backtest a portfolio</a></p>`;
    $("fd-x").onclick = () => { open = null; detail(); };
  }

  $("kind").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.kind = b.dataset.k; open = null; render(); } });
  $("group").addEventListener("change", () => { state.group = $("group").value; render(); });
  $("table").addEventListener("click", (e) => {
    if (e.target.closest("a, .star")) return;
    // The Details button, or anywhere else on the fund's row (phones hide the button column)
    const b = e.target.closest("[data-open]") || (e.target.closest("tr") && e.target.closest("tr").querySelector("[data-open]"));
    if (!b) return;
    open = open === b.dataset.open ? null : b.dataset.open;
    detail();
    if (open) $("detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  render();

  if (window.Live && Live.on) {
    let first = true;
    Live.every(60000, async () => {
      if (first) { first = false; return; }
      const rows = state.kind === "etf" ? D.etfs : D.crypto || [];
      const q = await Live.quotes(rows.map((r) => r.t));
      let n = 0;
      for (const r of rows) {
        const y = q[r.t];
        if (y && y.price != null) { r.p = y.price; if (y.chg1d != null) r.d1 = y.chg1d; n++; }
      }
      if (n) { $("updated").innerHTML = `<span class="live-dot on" aria-hidden="true"></span>Live · ${Live.stamp(new Date())}`; render(); }
    });
  }
})();
