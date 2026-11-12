(async function () {
  const { esc, money, pct, big, stockUrl, store } = UI;
  const $ = (id) => document.getElementById(id);
  const usd = (v) => money(v, "USD");
  const signUsd = (v) => v == null ? "–" : Math.abs(v) < 0.005 ? `<span class="num">$0.00</span>` : `<span class="num ${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : "−"}${money(Math.abs(v), "USD")}</span>`;

  let M;
  try {
    M = await UI.market();
  } catch (e) {
    $("updated").textContent = "Stock data could not be loaded.";
    $("positions").innerHTML = `<div class="empty">Stock data could not be loaded, so prices aren't available. Try again after the next data refresh.</div>`;
    return;
  }
  const stocks = await UI.load("stocks.json").catch(() => []);
  const byT = Object.fromEntries(stocks.map((s) => [s.t, s]));
  $("updated").textContent = "Prices from " + new Date(M.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  if (window.startRain) window.startRain(M.stocks.filter((s) => s.cur === "USD").map((s) => s.s));

  // S&P 500 level, to compare each portfolio with the market since it started
  let benchNow = null;
  try {
    const h = await (await fetch("hist/_GSPC.json", { cache: "no-store" })).json();
    benchNow = h.d[h.d.length - 1][1];
  } catch {}

  // ---- prices: live quote when we have one, else the last close
  const live = {};
  const priceOf = (t) => live[t]?.price ?? M.byTicker[t]?.p ?? null;
  const dayOf = (t) => live[t]?.chg1d ?? M.byTicker[t]?.d1 ?? null;
  const curOf = (t) => M.byTicker[t]?.cur || byT[t]?.cur || "USD";
  const fxOf = (cur) => (M.fx && M.fx[cur]) || 1; // units of currency per US dollar
  const nameOf = (t) => M.byTicker[t]?.n || byT[t]?.n || t;
  const symOf = (t) => M.byTicker[t]?.s || byT[t]?.s || t;

  // ---- saved portfolios
  const KEY = "portfolios";
  const fresh = (name = "Practice account", start = 100000) => ({
    name, start, created: new Date().toISOString(), bench: benchNow, trades: [], orders: [], snaps: {},
  });
  let P = store.get(KEY, null);
  if (!P || !Array.isArray(P.list) || !P.list.length) P = { active: 0, fee: 0, list: [fresh()] };
  const save = () => store.set(KEY, P);
  const acct = () => P.list[P.active] || P.list[0];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Replay the trades: cash, positions at average cost, realized gains
  function book(a) {
    let cash = a.start, realized = 0, fees = 0;
    const pos = {};
    for (const tr of a.trades) {
      const p = pos[tr.t] ||= { t: tr.t, qty: 0, cost: 0, costLocal: 0 };
      const value = tr.qty * tr.price / tr.fx;
      fees += tr.fee || 0;
      cash -= tr.fee || 0;
      if (tr.side === "buy") {
        cash -= value;
        p.qty += tr.qty; p.cost += value; p.costLocal += tr.qty * tr.price;
      } else {
        const avg = p.qty ? p.cost / p.qty : 0, avgL = p.qty ? p.costLocal / p.qty : 0;
        cash += value;
        realized += value - avg * tr.qty;
        p.qty -= tr.qty; p.cost -= avg * tr.qty; p.costLocal -= avgL * tr.qty;
        if (p.qty < 1e-9) { p.qty = 0; p.cost = 0; p.costLocal = 0; }
      }
    }
    const held = Object.values(pos).filter((p) => p.qty > 0).map((p) => {
      const cur = curOf(p.t), price = priceOf(p.t), fx = fxOf(cur);
      const value = price != null ? p.qty * price / fx : p.cost;
      const d1 = dayOf(p.t);
      const dayUsd = d1 != null ? value - value / (1 + d1 / 100) : 0;
      return { ...p, cur, price, value, avgLocal: p.costLocal / p.qty, gain: value - p.cost, gainPct: p.cost ? (value / p.cost - 1) * 100 : null, d1, dayUsd };
    });
    const invested = held.reduce((s, p) => s + p.value, 0);
    held.forEach((p) => { p.weight = invested + cash ? p.value / (invested + cash) * 100 : 0; });
    return { cash, held, invested, total: cash + invested, realized, fees, day: held.reduce((s, p) => s + p.dayUsd, 0) };
  }

  // ---- order ticket
  const T = { t: null, side: "buy" };
  const today = () => new Date().toISOString().slice(0, 10);
  $("date").value = today();
  $("date").max = today();
  $("fee").value = P.fee || 0;

  function ticket() {
    const type = $("otype").value;
    $("price-wrap").hidden = type === "market";
    $("date-wrap").hidden = type !== "record";
    $("price-label").textContent = type === "limit" ? "Limit price" : type === "stop" ? "Stop price" : "Price paid per share";
    for (const b of document.querySelectorAll(".side button")) b.setAttribute("aria-checked", String(b.dataset.side === T.side));
    $("ticket").classList.toggle("selling", T.side === "sell");
    if (!T.t) { $("est").innerHTML = ""; $("place").disabled = true; return; }
    const cur = curOf(T.t), price = priceOf(T.t), m = M.byTicker[T.t] || {};
    const held = book(acct()).held.find((p) => p.t === T.t);
    $("tstock").innerHTML = `<div class="co"><span class="nm"><a href="${stockUrl(T.t)}">${esc(nameOf(T.t))}</a></span><span class="tk">${esc(T.t)} · ${esc(cur)}${held ? ` · you own ${held.qty.toLocaleString()}` : ""}</span></div>
      <div class="ticket-px"><span class="num">${money(price, cur)}</span> ${pct(dayOf(T.t), 2)}</div>
      ${m.lo52 != null ? `<div class="tk">Day range ${money(m.l, cur)} – ${money(m.h, cur)} · 52W ${money(m.lo52, cur)} – ${money(m.hi52, cur)}</div>` : ""}`;
    const qty = +$("qty").value || 0;
    const px = type === "market" ? price : +$("price").value || price;
    const fx = fxOf(cur), fee = +P.fee || 0;
    const cost = qty * px / fx;
    const a = book(acct());
    let warn = "";
    if (qty > 0 && T.side === "buy" && type !== "record" && cost + fee > a.cash + 1e-6) warn = `Not enough cash: you have ${usd(a.cash)}.`;
    if (qty > 0 && T.side === "sell" && (!held || qty > held.qty + 1e-9)) warn = `You can sell up to ${held ? held.qty.toLocaleString() : 0} shares.`;
    const maxBuy = px ? Math.floor(Math.max(0, a.cash - fee) * fx / px) : 0;
    $("est").innerHTML = `
      <div><span class="muted">Estimated ${T.side === "buy" ? "cost" : "proceeds"}</span> <strong class="num">${money(qty * px, cur)}</strong>${cur !== "USD" ? ` <span class="tk">≈ ${usd(cost)}</span>` : ""}</div>
      ${fee ? `<div class="tk">Plus ${usd(fee)} commission</div>` : ""}
      ${T.side === "buy" && type !== "record" ? `<div class="tk">Cash ${usd(a.cash)} · up to <button type="button" class="linkish" id="max">${maxBuy.toLocaleString()} shares</button></div>` : held && T.side === "sell" ? `<div class="tk"><button type="button" class="linkish" id="max">Sell all ${held.qty.toLocaleString()}</button></div>` : ""}
      ${warn ? `<div class="down">${esc(warn)}</div>` : ""}`;
    const mx = $("max");
    if (mx) mx.onclick = () => { $("qty").value = T.side === "buy" ? maxBuy : held.qty; ticket(); };
    $("place").disabled = !(qty > 0) || !!warn || px == null;
    $("place").textContent = type === "market" ? `${T.side === "buy" ? "Buy" : "Sell"} ${qty || ""} ${symOf(T.t)} now`
      : type === "record" ? "Record trade" : `Place ${type} order`;
  }

  UI.picker($("sym"), (s) => {
    if (!M.byTicker[s.t]) { $("msg").textContent = "No price for that one yet. Market indexes can't be traded directly."; return; }
    T.t = s.t; $("msg").textContent = ""; $("price").value = priceOf(s.t) ?? ""; ticket(); $("qty").focus(); refresh();
  });
  document.querySelector(".side").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { T.side = b.dataset.side; ticket(); } });
  for (const id of ["otype", "qty", "price", "date"]) $(id).addEventListener("input", ticket);
  $("fee").addEventListener("change", () => { P.fee = Math.max(0, +$("fee").value || 0); save(); render(); });

  function fill(a, o, price, when) {
    const cur = curOf(o.t);
    a.trades.push({ id: uid(), time: when || new Date().toISOString(), t: o.t, side: o.side, qty: o.qty, price, cur, fx: fxOf(cur), fee: +P.fee || 0, type: o.type });
    a.trades.sort((x, y) => x.time.localeCompare(y.time));
  }

  $("ticket").addEventListener("submit", (e) => {
    e.preventDefault();
    if ($("place").disabled) return;
    const a = acct(), type = $("otype").value, qty = +$("qty").value;
    const o = { id: uid(), t: T.t, side: T.side, qty, type, created: new Date().toISOString() };
    if (type === "market") {
      fill(a, o, priceOf(T.t));
      $("msg").textContent = `Filled: ${T.side === "buy" ? "bought" : "sold"} ${qty} ${symOf(T.t)} at ${money(priceOf(T.t), curOf(T.t))}.`;
    } else if (type === "record") {
      fill(a, o, +$("price").value, new Date(($("date").value || today()) + "T16:00:00").toISOString());
      $("msg").textContent = `Recorded: ${T.side === "buy" ? "bought" : "sold"} ${qty} ${symOf(T.t)} at ${money(+$("price").value, curOf(T.t))}.`;
    } else {
      o.price = +$("price").value;
      a.orders.push(o);
      $("msg").textContent = `Order placed: ${o.side} ${qty} ${symOf(T.t)} ${type} ${money(o.price, curOf(T.t))}.`;
      checkOrders();
    }
    $("qty").value = "";
    save(); render();
  });

  // Limit buy: price at or below the limit. Limit sell: at or above. Stops are the reverse.
  function checkOrders() {
    for (const a of P.list) {
      a.orders = a.orders.filter((o) => {
        const p = priceOf(o.t);
        if (p == null) return true;
        const hit = o.type === "limit" ? (o.side === "buy" ? p <= o.price : p >= o.price) : (o.side === "buy" ? p >= o.price : p <= o.price);
        if (!hit) return true;
        const held = book(a).held.find((x) => x.t === o.t);
        if (o.side === "sell" && (!held || held.qty < o.qty - 1e-9)) { o.note = "Not enough shares"; return true; }
        if (o.side === "buy" && o.qty * p / fxOf(curOf(o.t)) > book(a).cash + 1e-6) { o.note = "Not enough cash"; return true; }
        fill(a, o, p);
        return false;
      });
    }
    save();
  }

  // ---- drawing
  function render() {
    const a = acct(), b = book(a);
    // One value snapshot per day for the chart
    a.snaps = a.snaps || {};
    a.snaps[today()] = Math.round(b.total * 100) / 100;
    save();
    $("accounts").innerHTML = P.list.map((x, i) => `<button class="tab" role="tab" aria-selected="${x === a}" data-i="${i}">${esc(x.name)}</button>`).join("");
    const ret = (b.total / a.start - 1) * 100;
    const bench = a.bench && benchNow ? (benchNow / a.bench - 1) * 100 : null;
    $("summary").innerHTML = `
      <div class="stat big-stat"><div class="label">Account value</div><div class="value num">${usd(b.total)}</div></div>
      <div class="stat"><div class="label">Today</div><div class="value">${signUsd(b.day)} ${pct(b.total - b.day ? b.day / (b.total - b.day) * 100 : 0, 2)}</div></div>
      <div class="stat"><div class="label">Total return</div><div class="value">${signUsd(b.total - a.start)} ${pct(ret, 2)}</div></div>
      <div class="stat" title="The S&P 500's move since you started this portfolio"><div class="label">S&P 500 since start</div><div class="value">${pct(bench, 2)}</div></div>
      <div class="stat"><div class="label">Cash</div><div class="value num">${usd(b.cash)}</div></div>
      <div class="stat"><div class="label">Invested</div><div class="value num">${usd(b.invested)}</div></div>
      <div class="stat"><div class="label">Realized gains</div><div class="value">${signUsd(b.realized)}</div></div>
      <div class="stat"><div class="label">Started</div><div class="value num">${new Date(a.created).toLocaleDateString(undefined, { dateStyle: "medium" })} · ${usd(a.start)}</div></div>`;

    UI.table($("positions"), [
      { key: "name", label: "Stock", left: true, sm: true, val: (r) => nameOf(r.t),
        html: (r) => `<div class="co"><span class="nm"><a href="${stockUrl(r.t)}">${esc(nameOf(r.t))}</a></span><span class="tk">${esc(r.t)}</span></div>` },
      { key: "qty", label: "Shares", val: (r) => r.qty, html: (r) => `<span class="num">${r.qty.toLocaleString()}</span>` },
      { key: "avg", label: "Avg cost", val: (r) => r.avgLocal, html: (r) => `<span class="num">${money(r.avgLocal, r.cur)}</span>` },
      { key: "price", label: "Price", val: (r) => r.price, html: (r) => `<span class="num">${money(r.price, r.cur)}</span>` },
      { key: "d1", label: "Day", val: (r) => r.d1, html: (r) => pct(r.d1, 2) },
      { key: "value", label: "Value (USD)", sm: true, val: (r) => r.value, html: (r) => `<span class="num">${usd(r.value)}</span>` },
      { key: "gain", label: "Gain", sm: true, val: (r) => r.gain, html: (r) => `${signUsd(r.gain)}<div>${pct(r.gainPct)}</div>` },
      { key: "weight", label: "Weight", val: (r) => r.weight, html: (r) => `<span class="num">${r.weight.toFixed(1)}%</span>` },
      { key: "act", label: "", sm: true, html: (r) => `<button class="btn small" data-trade="${esc(r.t)}">Trade</button>` },
    ], b.held, posSort, { empty: "No positions yet. Use the order ticket to buy your first stock." });

    // Allocation by sector
    const bySec = {};
    for (const p of b.held) { const s = M.byTicker[p.t]?.sector || "Other"; bySec[s] = (bySec[s] || 0) + p.value; }
    const parts = Object.entries(bySec).sort((x, y) => y[1] - x[1]);
    if (b.cash > 0.005) parts.push(["Cash", b.cash]);
    const tot = parts.reduce((s, x) => s + x[1], 0) || 1;
    let acc = 0;
    const R = 54, C = 2 * Math.PI * R;
    const arcs = parts.map(([n, v], i) => {
      const len = v / tot * C, off = acc; acc += len;
      return `<circle r="${R}" cx="70" cy="70" fill="none" stroke="var(${n === "Cash" ? "--border" : `--cmp-${(i % 7) + 1}`})" stroke-width="22" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(n)} ${(v / tot * 100).toFixed(1)}%</title></circle>`;
    }).join("");
    $("alloc").innerHTML = `<svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">${arcs}</svg>
      <ul class="alloc-list">${parts.map(([n, v], i) => `<li><i class="sw" style="--c:var(${n === "Cash" ? "--border" : `--cmp-${(i % 7) + 1}`})"></i>${esc(n)}<span class="num">${(v / tot * 100).toFixed(1)}%</span></li>`).join("")}</ul>`;

    // Value over time
    const days = Object.entries(a.snaps).sort((x, y) => x[0].localeCompare(y[0]));
    if (days.length < 2) {
      $("history").innerHTML = `<div class="empty">The chart fills in as you come back on other days. Each visit saves that day's account value.</div>`;
    } else {
      const W = $("history").clientWidth - 40 || 400, H = 160, vals = days.map((d) => d[1]);
      const lo = Math.min(...vals, a.start), hi = Math.max(...vals, a.start), span = hi - lo || 1;
      const X = (i) => (i / (days.length - 1)) * (W - 70), Y = (v) => 8 + (1 - (v - lo) / span) * (H - 30);
      const up = vals[vals.length - 1] >= a.start;
      $("history").innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        <line class="base" x1="0" x2="${W - 70}" y1="${Y(a.start)}" y2="${Y(a.start)}"/>
        <text class="axis" x="${W - 64}" y="${Y(a.start) + 4}">Start</text>
        <text class="axis" x="${W - 64}" y="${Y(hi) + 8}">${big(hi)}</text>
        <text class="axis" x="${W - 64}" y="${Y(lo)}">${big(lo)}</text>
        <polyline fill="none" stroke="var(${up ? "--up" : "--down"})" stroke-width="2" points="${vals.map((v, i) => `${X(i)},${Y(v)}`).join(" ")}"/>
        <text class="axis" x="0" y="${H - 4}">${esc(days[0][0])}</text><text class="axis" x="${W - 70}" y="${H - 4}" text-anchor="end">${esc(days[days.length - 1][0])}</text>
      </svg></div>`;
    }

    UI.table($("orders"), [
      { key: "t", label: "Stock", left: true, sm: true, html: (o) => `<a class="co-link" href="${stockUrl(o.t)}">${esc(symOf(o.t))}</a>` },
      { key: "side", label: "Order", sm: true, html: (o) => `<span class="pill ${o.side === "buy" ? "buy" : "sell"}">${o.side} ${o.type}</span>` },
      { key: "qty", label: "Shares", html: (o) => `<span class="num">${o.qty.toLocaleString()}</span>` },
      { key: "price", label: "At", sm: true, html: (o) => `<span class="num">${money(o.price, curOf(o.t))}</span>` },
      { key: "now", label: "Price now", html: (o) => `<span class="num">${money(priceOf(o.t), curOf(o.t))}</span>` },
      { key: "note", label: "", html: (o) => o.note ? `<span class="down">${esc(o.note)}</span>` : `<span class="tk">${new Date(o.created).toLocaleDateString()}</span>` },
      { key: "x", label: "", sm: true, html: (o) => `<button class="x" data-cancel="${o.id}" aria-label="Cancel order" title="Cancel order">✕</button>` },
    ], a.orders, { key: null, dir: 1 }, { empty: "No open orders." });

    UI.table($("activity"), [
      { key: "time", label: "Date", left: true, sm: true, html: (r) => `<span class="num">${new Date(r.time).toLocaleDateString()}</span>` },
      { key: "t", label: "Stock", left: true, sm: true, html: (r) => `<a class="co-link" href="${stockUrl(r.t)}">${esc(symOf(r.t))}</a>` },
      { key: "side", label: "Action", html: (r) => `<span class="pill ${r.side === "buy" ? "buy" : "sell"}">${r.side === "buy" ? "Bought" : "Sold"}</span>${r.type === "record" ? ' <span class="tk">recorded</span>' : ""}` },
      { key: "qty", label: "Shares", sm: true, html: (r) => `<span class="num">${r.qty.toLocaleString()}</span>` },
      { key: "price", label: "Price", html: (r) => `<span class="num">${money(r.price, r.cur)}</span>` },
      { key: "usd", label: "Total (USD)", html: (r) => `<span class="num">${usd(r.qty * r.price / r.fx)}</span>` },
      { key: "x", label: "", html: (r) => `<button class="x" data-undo="${r.id}" aria-label="Delete this trade" title="Delete this trade">✕</button>` },
    ], a.trades.slice().reverse(), { key: null, dir: 1 }, { empty: "No trades yet." });
    ticket();
  }
  const posSort = { key: "value", dir: -1 };

  $("positions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-trade]");
    if (!b) return;
    T.t = b.dataset.trade; T.side = "sell"; $("otype").value = "market"; $("price").value = priceOf(T.t) ?? "";
    ticket();
    $("ticket").scrollIntoView({ behavior: "smooth", block: "start" });
    $("qty").focus({ preventScroll: true });
  });
  $("orders").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cancel]");
    if (!b) return;
    acct().orders = acct().orders.filter((o) => o.id !== b.dataset.cancel);
    save(); render();
  });
  let undoArmed = null;
  $("activity").addEventListener("click", (e) => {
    const b = e.target.closest("[data-undo]");
    if (!b) return;
    // Two taps to delete a trade, so a stray tap can't rewrite history
    if (undoArmed !== b.dataset.undo) { undoArmed = b.dataset.undo; b.textContent = "Delete?"; b.classList.add("armed"); return; }
    acct().trades = acct().trades.filter((t) => t.id !== b.dataset.undo);
    undoArmed = null;
    save(); render();
  });
  $("accounts").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    P.active = +b.dataset.i; save(); render(); refresh();
  });

  function ask(btn, fields, done) {
    const form = document.createElement("span");
    form.className = "inline-ask";
    form.innerHTML = fields.map((f) => `<input class="field" placeholder="${esc(f.ph)}" aria-label="${esc(f.ph)}" ${f.type ? `type="${f.type}"` : ""} value="${esc(f.value || "")}" style="width:${f.w || 160}px">`).join("") + `<button class="btn primary" type="button">OK</button><button class="btn" type="button">Cancel</button>`;
    btn.replaceWith(form);
    const ins = form.querySelectorAll("input"), [ok, cancel] = form.querySelectorAll("button");
    ins[0].focus();
    const close = (go) => { form.replaceWith(btn); if (go) done([...ins].map((i) => i.value.trim())); btn.focus(); };
    ok.onclick = () => close(true); cancel.onclick = () => close(false);
    form.addEventListener("keydown", (e) => { if (e.key === "Enter") close(true); if (e.key === "Escape") close(false); });
  }
  $("newacct").addEventListener("click", () => ask($("newacct"), [{ ph: "Name", value: "Portfolio " + (P.list.length + 1) }, { ph: "Starting cash (USD)", type: "number", value: "100000", w: 150 }], ([name, cash]) => {
    P.list.push(fresh(name.slice(0, 40) || "Portfolio", Math.max(0, +cash || 100000)));
    P.active = P.list.length - 1; save(); render();
  }));
  $("reset").addEventListener("click", () => ask($("reset"), [{ ph: "Type RESET to clear this portfolio", w: 230 }, { ph: "Starting cash", type: "number", value: String(acct().start), w: 130 }], ([word, cash]) => {
    if (word.toUpperCase() !== "RESET") return;
    const a = acct();
    P.list[P.active] = fresh(a.name, Math.max(0, +cash || a.start));
    save(); render();
  }));
  $("csv").addEventListener("click", () => {
    const a = acct();
    const rows = [["date", "ticker", "side", "shares", "price", "currency", "fx_per_usd", "total_usd", "commission_usd", "type"]].concat(
      a.trades.map((r) => [r.time, r.t, r.side, r.qty, r.price, r.cur, r.fx, (r.qty * r.price / r.fx).toFixed(2), r.fee || 0, r.type]));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }));
    link.download = `${a.name.replace(/[^\w-]+/g, "_")}-trades.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  window.addEventListener("storage", (e) => { if (e.key === KEY) { P = store.get(KEY, P); render(); } });

  // ?t=XYZ opens the ticket on that stock (from a Trade link elsewhere on the site)
  const want = new URLSearchParams(location.search).get("t");
  if (want && M.byTicker[want]) { T.t = want; $("price").value = priceOf(want) ?? ""; }

  async function refresh() {
    if (!(window.Live && Live.on)) return;
    const a = acct();
    const ts = [...new Set(a.trades.map((t) => t.t).concat(a.orders.map((o) => o.t), T.t ? [T.t] : [], P.list.flatMap((x) => x.orders.map((o) => o.t))))];
    const q = await Live.quotes(ts.concat("^GSPC"));
    if (!Object.keys(q).length) return;
    Object.assign(live, q);
    if (q["^GSPC"]?.price) benchNow = q["^GSPC"].price;
    const open = Object.values(q).some((x) => x.state === "open");
    $("updated").innerHTML = `<span class="live-dot ${open ? "on" : ""}" aria-hidden="true"></span>${open ? "Live" : "Markets closed"} · ${Live.stamp(new Date())}`;
    checkOrders();
    render();
  }
  if (!acct().bench && benchNow) { acct().bench = benchNow; save(); }
  checkOrders();
  render();
  if (window.Live && Live.on) Live.every(30000, refresh);
})();
