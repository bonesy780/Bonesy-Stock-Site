// Price alerts, a section of the Watchlists page (<section id="alerts">, with every id inside starting "al-").
// The 🔔 on a watchlist row sends an "alert-for" event with the stock, which picks it here.
(async function () {
  const { esc, money, pct, stockUrl, Alerts } = UI;
  if (!document.getElementById("alerts")) return;
  const $ = (id) => document.getElementById("al-" + id);
  const M = await UI.market().catch(() => null);
  const stocks = await UI.load("stocks.json").catch(() => []);
  const byT = Object.fromEntries(stocks.map((s) => [s.t, s]));
  const live = {};
  const quote = (t) => live[t] || (M && M.byTicker[t] ? { price: M.byTicker[t].p, chg1d: M.byTicker[t].d1 } : {});
  const curOf = (t) => (M && M.byTicker[t]?.cur) || byT[t]?.cur || "USD";
  const symOf = (t) => (M && M.byTicker[t]?.s) || byT[t]?.s || t;
  const nameOf = (t) => (M && M.byTicker[t]?.n) || byT[t]?.n || t;

  $("kind").innerHTML = Object.entries(Alerts.KINDS).map(([k, x]) => `<option value="${k}">${esc(x.label)}${x.unit === "%" ? " (%)" : ""}</option>`).join("");
  let pick = null;

  function showNow() {
    const k = $("kind").value, unit = Alerts.KINDS[k].unit;
    $("value").placeholder = unit === "%" ? "e.g. 5" : "Price";
    if (!pick) { $("now").innerHTML = `<span class="hint">Pick a stock to see its price.</span>`; return; }
    const q = quote(pick), cur = curOf(pick);
    const quick = q.price != null && unit !== "%" ? [-10, -5, 5, 10].map((d) => {
      const v = +(q.price * (1 + d / 100)).toPrecision(5);
      return `<button type="button" class="chip" data-v="${v}" data-k="${d < 0 ? "below" : "above"}">${d > 0 ? "+" : ""}${d}% · ${money(v, cur)}</button>`;
    }).join("") : "";
    $("now").innerHTML = `<span><a href="${stockUrl(pick)}"><strong>${esc(nameOf(pick))}</strong></a> <span class="tk">${esc(pick)}</span> <span class="num">${money(q.price, cur)}</span> ${pct(q.chg1d, 2)}</span>${quick ? `<span class="quick">${quick}</span>` : ""}`;
  }
  UI.picker($("sym"), (s) => { pick = s.t; $("sym").placeholder = `${s.s} · ${s.n}`; showNow(); $("value").focus(); refresh(); });
  $("kind").addEventListener("change", showNow);
  $("now").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    $("kind").value = b.dataset.k; $("value").value = b.dataset.v; showNow();
  });
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = +$("value").value;
    if (!pick) { $("sym").focus(); return; }
    if (!(v > 0)) { $("value").focus(); return; }
    const a = { t: pick, s: symOf(pick), cur: curOf(pick), kind: $("kind").value, value: v, note: $("note").value.trim() };
    Alerts.add(a);
    $("value").value = ""; $("note").value = "";
    // Already true? Say so: it will go off on the next check
    const q = quote(pick);
    if (q.price != null && Alerts.KINDS[a.kind].hit(q, v)) UI.toast(`That alert is already true at today's price, so it goes off right away.`);
    Alerts.check({ [pick]: q });
  });

  function render() {
    const v = Alerts.all();
    UI.table($("active"), [
      { key: "t", label: "Stock", left: true, sm: true, html: (a) => `<div class="co"><span class="nm"><a href="${stockUrl(a.t)}">${esc(nameOf(a.t))}</a></span><span class="tk">${esc(a.t)}</span></div>` },
      { key: "kind", label: "Alert when", left: true, sm: true, html: (a) => esc(Alerts.describe(a, a.cur)) + (a.note ? `<div class="tk">${esc(a.note)}</div>` : "") },
      { key: "now", label: "Now", html: (a) => { const q = quote(a.t); return `<span class="num">${money(q.price, a.cur)}</span> ${pct(q.chg1d, 2)}`; } },
      { key: "away", label: "To go", title: "How far the price still has to move", html: (a) => {
        const q = quote(a.t);
        if (q.price == null) return "–";
        if (Alerts.KINDS[a.kind].unit === "%") return q.chg1d == null ? "–" : `<span class="num">${Math.max(0, a.value - Math.abs(q.chg1d)).toFixed(1)} pts</span>`;
        return `<span class="num">${Math.abs((a.value / q.price - 1) * 100).toFixed(1)}%</span>`;
      } },
      { key: "created", label: "Set", html: (a) => `<span class="tk">${new Date(a.created).toLocaleDateString()}</span>` },
      { key: "x", label: "", sm: true, html: (a) => `<button class="x" data-del="${a.id}" aria-label="Delete alert" title="Delete alert">✕</button>` },
    ], v.active, { key: null, dir: 1 }, { empty: "No alerts yet. Pick a stock above to set one." });
    const fired = v.fired.slice().reverse();
    UI.table($("fired"), [
      { key: "when", label: "Went off", left: true, sm: true, html: (a) => `<span class="num">${new Date(a.firedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</span>` },
      { key: "t", label: "Stock", left: true, sm: true, html: (a) => `<a class="co-link" href="${stockUrl(a.t)}">${esc(a.s || a.t)}</a>` },
      { key: "kind", label: "Alert", html: (a) => esc(Alerts.describe(a, a.cur)) + (a.note ? `<div class="tk">${esc(a.note)}</div>` : "") },
      { key: "px", label: "Price then", sm: true, html: (a) => `<span class="num">${money(a.firedPrice, a.cur)}</span>` },
      { key: "again", label: "", html: (a) => `<button class="btn small" data-again="${a.id}">Set again</button>` },
    ], fired, { key: null, dir: 1 }, { empty: "None yet." });
    $("clear").hidden = !fired.length;
    perm();
  }
  $("active").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    const v = Alerts.all();
    v.active = v.active.filter((a) => a.id !== b.dataset.del);
    Alerts.save(v);
  });
  $("fired").addEventListener("click", (e) => {
    const b = e.target.closest("[data-again]");
    if (!b) return;
    const a = Alerts.all().fired.find((x) => x.id === b.dataset.again);
    if (a) Alerts.add({ t: a.t, s: a.s, cur: a.cur, kind: a.kind, value: a.value, note: a.note });
  });
  $("clear").addEventListener("click", () => { const v = Alerts.all(); v.fired = []; Alerts.save(v); });

  function perm() {
    const has = "Notification" in window;
    const p = has ? Notification.permission : "unsupported";
    $("notify").hidden = !has || p !== "default";
    $("perm").textContent = p === "granted" ? "Pop-up notifications are on." : p === "denied" ? "Pop-up notifications are blocked in your browser settings, so alerts show on the page only."
      : p === "unsupported" ? "This browser can't show pop-up notifications, so alerts show on the page only." : "Alerts show on the page. Turn on pop-ups to see them while you're in another tab.";
  }
  $("notify").addEventListener("click", async () => { try { await Notification.requestPermission(); } catch {} perm(); });

  // ---- push alerts (checked on the live service every 5 minutes, delivered with the site closed)
  const Push = UI.Push;
  function pushView() {
    const box = $("push-box");
    const ios = /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone;
    if (!(window.Live && Live.on)) { box.hidden = true; return; }
    box.hidden = false;
    if (!Push.supported()) {
      $("push-btn").hidden = true;
      $("push-text").textContent = ios
        ? "To get alerts with the site closed on an iPhone or iPad, first add TopTicker to your home screen (Share, then Add to Home Screen), open it from there and come back to this page."
        : "This browser can't receive push notifications, so alerts only run while a page of the site is open.";
      return;
    }
    $("push-btn").hidden = false;
    $("push-btn").textContent = Push.on() ? "Turn off push alerts" : "Turn on push alerts";
    $("push-btn").classList.toggle("primary", !Push.on());
    $("push-text").innerHTML = Push.on()
      ? "<b>Push alerts are on.</b> TopTicker checks your active alerts every 5 minutes on its own server and notifies this device when one goes off, even with the site closed."
      : "Turn on push alerts and TopTicker checks your alerts every 5 minutes on its own server, then sends a notification to this device even when no page of the site is open. Only your alerts and this browser's push address are stored, nothing else about you.";
  }
  $("push-btn").addEventListener("click", async () => {
    $("push-btn").disabled = true;
    try {
      if (Push.on()) { await Push.disable(); UI.toast("Push alerts are off for this device."); }
      else { await Push.enable(); UI.toast("Push alerts are on. You'll be notified even with the site closed."); }
    } catch (e) { UI.toast(esc(e.message || "Push alerts couldn't be turned on.")); }
    $("push-btn").disabled = false;
    pushView(); perm();
  });
  pushView();

  window.addEventListener("alerts", render);
  const choose = (t) => {
    pick = t;
    $("sym").placeholder = `${symOf(t)} · ${nameOf(t)}`;
    showNow(); refresh();
  };
  // ?alert=AAPL (from a stock page, or the old Alerts page's ?t=) picks that stock
  const want = new URLSearchParams(location.search).get("alert");
  if (want && (byT[want] || (M && M.byTicker[want]))) { choose(want); setTimeout(() => document.getElementById("alerts").scrollIntoView(), 300); }
  window.addEventListener("alert-for", (e) => {
    choose(e.detail);
    document.getElementById("alerts").scrollIntoView({ behavior: "smooth", block: "start" });
    $("value").focus({ preventScroll: true });
  });
  showNow();
  render();

  async function refresh() {
    if (!(window.Live && Live.on)) return;
    const ts = [...new Set(Alerts.all().active.map((a) => a.t).concat(pick ? [pick] : []))];
    if (!ts.length) return;
    Object.assign(live, await Live.quotes(ts));
    render(); showNow();
  }
  if (window.Live && Live.on) Live.every(60000, refresh);
})();
