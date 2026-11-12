(async function () {
  const { esc, money, pct, big, fixed, spark, stockUrl, Watch, store } = UI;
  const $ = (id) => document.getElementById(id);

  let M;
  try {
    M = await UI.market();
  } catch (e) {
    $("updated").textContent = "Stock data could not be loaded.";
    $("table").innerHTML = `<div class="empty">Stock data could not be loaded. Try again after the next data refresh.</div>`;
    return;
  }
  const stocksList = await UI.load("stocks.json").catch(() => []);
  const names = Object.fromEntries(stocksList.map((s) => [s.t, s]));
  $("updated").textContent = "Updated " + new Date(M.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  if (window.startRain) window.startRain(M.stocks.filter((s) => s.cur === "USD").map((s) => s.s));

  const live = {};
  const sort = store.get("watchSort", { key: "pos", dir: 1 });

  // Your own note and target price per stock, shared by all lists
  const NKEY = "watchNotes";
  const notes = () => store.get(NKEY, {});
  const row = (t, pos) => {
    const m = M.byTicker[t] || {}, q = live[t] || {}, info = names[t] || {};
    const price = q.price ?? m.p, d1 = q.chg1d ?? m.d1;
    const n = notes()[t] || {};
    const toTarget = n.target && price ? (n.target / price - 1) * 100 : null;
    return { ...m, t, pos, s: m.s || info.s || t, name: m.n || info.n || t, cur: m.cur || info.cur || "USD", price, d1, note: n.note || "", target: n.target || null, toTarget };
  };
  const earnSoon = (d) => {
    if (!d) return "–";
    const days = Math.round((new Date(d + "T12:00:00Z") - Date.now()) / 864e5);
    const label = new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return days < -1 ? `<span class="muted">${label}</span>` : days <= 7 ? `<span class="pill">${label}</span>` : label;
  };
  const range52 = (r) => {
    if (r.hi52 == null || r.lo52 == null || r.price == null) return "–";
    const f = Math.max(0, Math.min(1, (r.price - r.lo52) / ((r.hi52 - r.lo52) || 1)));
    return `<span class="range52" title="52-week low ${money(r.lo52, r.cur)}, high ${money(r.hi52, r.cur)}"><span class="track"><i style="left:calc(${(f * 100).toFixed(0)}% - 1px)"></i></span><span class="num">${Math.round(f * 100)}%</span></span>`;
  };
  const rating = (r) => r.recMean == null ? "–" :
    `<span class="pill ${r.recMean <= 2.5 ? "buy" : r.recMean > 3.5 ? "sell" : ""}">${r.recMean <= 1.5 ? "Strong Buy" : r.recMean <= 2.5 ? "Buy" : r.recMean <= 3.5 ? "Hold" : "Sell"}</span>`;

  const cols = [
    { key: "pos", label: "#", title: "The order you added them", val: (r) => r.pos, html: (r) => `<span class="num muted">${r.pos + 1}</span>` },
    { key: "name", label: "Company", left: true, sm: true, val: (r) => r.name,
      html: (r) => `<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(r.name)}</a></span><span class="tk">${esc(r.s)}${r.sector ? " · " + esc(r.sector) : ""}</span></div>` },
    { key: "price", label: "Price", sm: true, val: (r) => r.price, html: (r) => `<span class="num">${money(r.price, r.cur)}</span>` },
    { key: "d1", label: "Day", sm: true, val: (r) => r.d1, html: (r) => pct(r.d1, 2) },
    { key: "w1", label: "1W", val: (r) => r.w1, html: (r) => pct(r.w1) },
    { key: "m1", label: "1M", val: (r) => r.m1, html: (r) => pct(r.m1) },
    { key: "ytd", label: "YTD", val: (r) => r.ytd, html: (r) => pct(r.ytd) },
    { key: "range", label: "52W range", title: "Where today's price sits between the 52-week low (0%) and high (100%)",
      val: (r) => r.hi52 != null && r.price != null ? (r.price - r.lo52) / ((r.hi52 - r.lo52) || 1) : null, html: range52 },
    { key: "relVol", label: "Volume", title: "Last session's volume compared with the 50-day average", val: (r) => r.relVol,
      html: (r) => r.vol == null ? "–" : `<span class="num" title="${(r.relVol || 0).toFixed(1)}× the 50-day average">${UI.compact(r.vol)}${r.relVol >= 1.5 ? ` <span class="up">${r.relVol.toFixed(1)}×</span>` : ""}</span>` },
    { key: "mcapUsd", label: "Mkt cap", title: "Market value in US dollars", val: (r) => r.mcapUsd, html: (r) => `<span class="num">${big(r.mcapUsd)}</span>` },
    { key: "pe", label: "P/E", title: "Price divided by the last 12 months of earnings per share", val: (r) => r.pe, html: (r) => `<span class="num">${fixed(r.pe, 1)}</span>` },
    { key: "divYield", label: "Yield", val: (r) => r.divYield ?? 0, html: (r) => `<span class="num">${r.divYield != null ? r.divYield.toFixed(2) + "%" : "–"}</span>` },
    { key: "recMean", label: "Analysts", title: "Average analyst rating", val: (r) => r.recMean, html: rating },
    { key: "earnings", label: "Earnings", title: "Next earnings report date", val: (r) => r.earnings, html: (r) => earnSoon(r.earnings) },
    { key: "trend", label: "1M trend", html: (r) => spark(r.spark, 80, 24) },
    { key: "toTarget", label: "My target", title: "Your own target price, and how far the price is from it", val: (r) => r.toTarget,
      html: (r) => r.target ? `<span class="num">${money(r.target, r.cur)}</span><div class="${Math.abs(r.toTarget) < 2 ? "pill buy" : "tk"}">${Math.abs(r.toTarget) < 2 ? "Near target" : (r.toTarget > 0 ? "+" : "") + r.toTarget.toFixed(1) + "%"}</div>` : "–" },
    { key: "note", label: "Notes", sm: true, html: (r) => `<button class="wl-note ${r.note || r.target ? "has" : ""}" data-note="${esc(r.t)}" title="${r.note ? esc(r.note) : "Add a note or target price"}" aria-label="Notes for ${esc(r.s)}">${r.note ? esc(r.note.length > 16 ? r.note.slice(0, 15) + "…" : r.note) : "✎"}</button>` },
    { key: "rm", label: "", sm: true, html: (r) => `<button class="x" data-rm="${esc(r.t)}" title="Remove ${esc(r.s)} from this list" aria-label="Remove ${esc(r.s)}">✕</button>` },
  ];
  let confirmDelete = false;
  function render() {
    const v = Watch.all();
    const list = v.lists[v.active] || v.lists[0];
    $("lists").innerHTML = v.lists.map((l, i) =>
      `<button class="tab" role="tab" aria-selected="${l === list}" data-i="${i}">${esc(l.name)}<span class="count">${l.tickers.length}</span></button>`).join("");
    $("delete").disabled = v.lists.length < 2;
    $("delete").textContent = confirmDelete ? "Tap again to delete" : "Delete list";

    const rows = list.tickers.map((t, i) => row(t, i));
    const withMove = rows.filter((r) => r.d1 != null);
    if (rows.length) {
      const avg = withMove.length ? withMove.reduce((a, r) => a + r.d1, 0) / withMove.length : null;
      const best = withMove.slice().sort((a, b) => b.d1 - a.d1)[0], worst = withMove.slice().sort((a, b) => a.d1 - b.d1)[0];
      const up = withMove.filter((r) => r.d1 > 0).length;
      const soon = rows.filter((r) => r.earnings && (new Date(r.earnings + "T12:00:00Z") - Date.now()) / 864e5 >= -1
        && (new Date(r.earnings + "T12:00:00Z") - Date.now()) / 864e5 <= 7).length;
      $("summary").hidden = false;
      $("summary").innerHTML = `
        <div class="stat"><div class="label">Stocks</div><div class="value num">${rows.length}</div></div>
        <div class="stat"><div class="label">Average day move</div><div class="value">${pct(avg, 2)}</div></div>
        <div class="stat"><div class="label">Up / down</div><div class="value num">${up} / ${withMove.length - up}</div></div>
        ${best ? `<div class="stat"><div class="label">Best today</div><div class="value"><a class="co-link" href="${stockUrl(best.t)}">${esc(best.s)}</a> ${pct(best.d1)}</div></div>` : ""}
        ${worst && worst !== best ? `<div class="stat"><div class="label">Worst today</div><div class="value"><a class="co-link" href="${stockUrl(worst.t)}">${esc(worst.s)}</a> ${pct(worst.d1)}</div></div>` : ""}
        <div class="stat"><div class="label">Earnings this week</div><div class="value num">${soon}</div></div>`;
    } else {
      $("summary").hidden = true;
    }
    UI.table($("table"), cols, rows, sort, {
      cls: "wl-table",
      empty: `This list is empty. Search above to add a stock, or tap the ☆ beside any stock on the <a href="./">Markets</a> or <a href="stock.html">Stock Lookup</a> pages.`,
      onSort: (s) => store.set("watchSort", s),
    });
    $("note").textContent = rows.length ? "Tap a column heading to sort. Tap it again to flip the order." : "";
  }

  $("lists").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    const v = Watch.all();
    v.active = +b.dataset.i;
    confirmDelete = false;
    Watch.save(v);
  });
  $("table").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (!b) return;
    const v = Watch.all(), l = v.lists[v.active] || v.lists[0];
    l.tickers = l.tickers.filter((t) => t !== b.dataset.rm);
    Watch.save(v);
  });
  UI.picker($("add"), (s) => {
    const v = Watch.all(), l = v.lists[v.active] || v.lists[0];
    if (!l.tickers.includes(s.t)) l.tickers.push(s.t);
    Watch.save(v);
    refresh();
  });

  // New and rename use a small inline box in place of a pop-up
  function ask(btn, start, done) {
    const box = document.createElement("input");
    box.className = "field";
    box.value = start;
    box.placeholder = "List name";
    box.setAttribute("aria-label", "List name");
    btn.replaceWith(box);
    box.focus(); box.select();
    let finished = false;
    const finish = (ok) => {
      if (finished) return;
      finished = true;
      box.replaceWith(btn);
      const name = box.value.trim().slice(0, 40);
      if (ok && name) done(name);
      btn.focus();
    };
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
    box.addEventListener("blur", () => finish(true));
  }
  $("new").addEventListener("click", () => ask($("new"), "", (name) => {
    const v = Watch.all();
    v.lists.push({ name, tickers: [] });
    v.active = v.lists.length - 1;
    Watch.save(v);
  }));
  $("rename").addEventListener("click", () => {
    const v = Watch.all();
    ask($("rename"), v.lists[v.active].name, (name) => { v.lists[v.active].name = name; Watch.save(v); });
  });
  $("delete").addEventListener("click", () => {
    const v = Watch.all();
    if (v.lists.length < 2) return;
    if (!confirmDelete) { confirmDelete = true; render(); return; }
    confirmDelete = false;
    v.lists.splice(v.active, 1);
    v.active = Math.max(0, v.active - 1);
    Watch.save(v);
  });
  $("delete").addEventListener("blur", () => { if (confirmDelete) { confirmDelete = false; render(); } });

  window.addEventListener("watchlists", render);
  render();

  // Live prices for the open list every 30 seconds
  async function refresh() {
    if (!(window.Live && Live.on)) return;
    const v = Watch.all(), l = v.lists[v.active] || v.lists[0];
    if (!l.tickers.length) return;
    const q = await Live.quotes(l.tickers);
    if (!Object.keys(q).length) return;
    Object.assign(live, q);
    const open = Object.values(q).some((x) => x.state === "open");
    $("updated").innerHTML = `<span class="live-dot ${open ? "on" : ""}" aria-hidden="true"></span>${open ? "Live" : "Markets closed"} · ${Live.stamp(new Date())}`;
    render();
  }
  if (window.Live && Live.on) Live.every(30000, refresh);

  // ---- notes dialog
  const dlg = $("note-dlg");
  let editing = null;
  $("table").addEventListener("click", (e) => {
    const b = e.target.closest("[data-note]");
    if (!b) return;
    editing = b.dataset.note;
    const r = row(editing, 0), n = notes()[editing] || {};
    $("note-title").textContent = `${r.s} · ${r.name}`;
    $("note-price").textContent = r.price != null ? `Price now ${money(r.price, r.cur)}` : "";
    $("note-text").value = n.note || "";
    $("note-target").value = n.target || "";
    dlg.showModal();
    $("note-text").focus();
  });
  $("note-form").addEventListener("submit", (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    const all = notes(), note = $("note-text").value.trim(), target = +$("note-target").value || null;
    if (note || target) all[editing] = { note, target }; else delete all[editing];
    store.set(NKEY, all);
    render();
  });

  // ---- download the list as CSV
  $("csv").addEventListener("click", () => {
    const v = Watch.all(), list = v.lists[v.active] || v.lists[0];
    const q = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
    const lines = [["Ticker", "Name", "Currency", "Price", "Day %", "YTD %", "P/E", "Yield %", "My target", "Notes"].join(",")]
      .concat(list.tickers.map((t) => { const r = row(t, 0); return [r.t, q(r.name), r.cur, r.price ?? "", r.d1 ?? "", r.ytd ?? "", r.pe ?? "", r.divYield ?? "", r.target ?? "", q(r.note)].join(","); }));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `${list.name.replace(/[^\w-]+/g, "-")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
})();
