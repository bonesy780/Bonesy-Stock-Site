// Shared by every page: the site menu, a quick ticker search in the header,
// number formatting helpers, and the watchlists saved in this browser.
(function () {
  // [href, label, other file names that count as this page, menu group]
  const PAGES = [
    ["./", "Markets", ["index.html", ""]],
    ["stock.html", "Stock Lookup"],
    ["watchlist.html", "Watchlists"],
    ["portfolio.html", "Paper Trading"],
    ["screener.html", "Screener"],
    ["movers.html", "Movers"],
    ["heatmap.html", "Heatmap", null, "Research"],
    ["signals.html", "Signals", null, "Research"],
    ["analysts.html", "Analysts", null, "Research"],
    ["dividends.html", "Dividends", null, "Research"],
    ["calendar.html", "Calendar", null, "Research"],
    ["compare.html", "Compare", null, "Tools"],
    ["backtest.html", "Backtest", null, "Tools"],
    ["alerts.html", "Alerts", null, "Tools"],
    ["tools.html", "Calculators", null, "Tools"],
    ["news.html", "News"],
  ];

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const digits = (v, cur) => (Math.abs(v) >= 1000 || cur === "JPY" || cur === "KRW" ? 0 : 2);
  const money = (v, cur = "USD") => v == null ? "–" : new Intl.NumberFormat(undefined, {
    style: "currency", currency: cur, maximumFractionDigits: digits(v, cur), minimumFractionDigits: digits(v, cur),
  }).format(v);
  const plain = (v, cur) => v == null ? "–" : v.toLocaleString(undefined, { maximumFractionDigits: digits(v, cur), minimumFractionDigits: digits(v, cur) });
  const pct = (v, nd = 1) => {
    if (v == null) return '<span class="num">–</span>';
    if (Math.abs(v) < 0.5 / 10 ** nd) v = 0; // no "-0.0%"
    return `<span class="num ${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(nd)}%</span>`;
  };
  const big = (v, sym = "$") => {
    if (v == null) return "–";
    const a = Math.abs(v), s = v < 0 ? "-" : "";
    for (const [n, u] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (a >= n) return s + sym + (a / n).toFixed(a / n >= 100 ? 0 : 1) + u;
    return s + sym + Math.round(a);
  };
  const compact = (v) => v == null ? "–" : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const fixed = (v, nd = 2) => v == null ? "–" : v.toFixed(nd);
  const spark = (pts, w = 96, h = 28) => {
    if (!pts || pts.length < 2) return "";
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
    const d = pts.map((p, i) => `${(i / (pts.length - 1) * w).toFixed(1)},${(h - 2 - (p - lo) / span * (h - 4)).toFixed(1)}`).join(" ");
    const color = pts[pts.length - 1] >= pts[0] ? "var(--up)" : "var(--down)";
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.6" points="${d}"/></svg>`;
  };
  const stockUrl = (t) => "stock.html?t=" + encodeURIComponent(t);
  const store = {
    get(k, fallback) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ---- data files, fetched once per page
  const cache = {};
  const load = (file) => (cache[file] ||= fetch(file, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(file + " " + r.status);
    return r.json();
  }));
  // Every stock's facts from market.json, by ticker
  let marketMap = null;
  async function market() {
    const m = await load("market.json");
    if (!marketMap) marketMap = Object.fromEntries(m.stocks.map((s) => [s.t, s]));
    return { ...m, byTicker: marketMap };
  }

  // ---- watchlists: several named lists of tickers, kept in this browser
  const WKEY = "watchlists";
  const Watch = {
    all() {
      const v = store.get(WKEY, null);
      if (v && Array.isArray(v.lists) && v.lists.length) return v;
      return { active: 0, lists: [{ name: "My watchlist", tickers: [] }] };
    },
    save(v) { store.set(WKEY, v); window.dispatchEvent(new CustomEvent("watchlists")); },
    has(t) { return this.all().lists.some((l) => l.tickers.includes(t)); },
    // Add to (or remove from) the list the reader last used
    toggle(t) {
      const v = this.all(), l = v.lists[v.active] || v.lists[0];
      const i = l.tickers.indexOf(t);
      if (i >= 0) l.tickers.splice(i, 1); else l.tickers.push(t);
      this.save(v);
      return i < 0;
    },
  };
  // Keep other open tabs in step
  window.addEventListener("storage", (e) => { if (e.key === WKEY) window.dispatchEvent(new CustomEvent("watchlists")); });

  // A star button for any stock; pages call UI.star(t) in their markup
  const star = (t, label = "") => {
    const on = Watch.has(t);
    return `<button class="star" data-star="${esc(t)}" aria-pressed="${on}" title="${on ? "Remove from" : "Add to"} your watchlist">${on ? "★" : "☆"}${label ? `<span>${esc(label)}</span>` : ""}</button>`;
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-star]");
    if (!b) return;
    e.preventDefault();
    Watch.toggle(b.dataset.star);
  });
  window.addEventListener("watchlists", () => {
    for (const b of document.querySelectorAll("[data-star]")) {
      const on = Watch.has(b.dataset.star);
      b.setAttribute("aria-pressed", String(on));
      b.title = `${on ? "Remove from" : "Add to"} your watchlist`;
      b.firstChild.textContent = on ? "★" : "☆";
    }
  });

  // ---- stock search (stocks.json), shared by the header box and the pages
  const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[^\w ]/g, "");
  async function search(text, n = 8) {
    const t = norm(text.trim()), raw = text.trim().toLowerCase();
    if (!t) return [];
    const stocks = await load("stocks.json");
    const scored = [];
    for (const s of stocks) {
      const sym = s.s.toLowerCase(), tick = s.t.toLowerCase(), name = norm(s.n);
      const score = sym === t || tick === t || tick === raw ? 0 : sym.startsWith(t) || tick.startsWith(raw) ? 1 : name.startsWith(t) ? 2
        : name.split(" ").some((w) => w.startsWith(t)) ? 3 : name.includes(t) || tick.includes(t) ? 4 : -1;
      if (score >= 0) scored.push([score, s.n.length, s]);
    }
    return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, n).map((x) => x[2]);
  }

  // A search box with a drop-down of matches; onPick gets the stocks.json entry
  function picker(input, onPick) {
    const wrap = input.parentElement;
    const list = document.createElement("ul");
    list.className = "panel results";
    list.setAttribute("role", "listbox");
    list.id = input.id + "-results";
    list.hidden = true;
    wrap.appendChild(list);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "false");
    input.autocomplete = "off";
    let matches = [], active = -1, seq = 0;
    const show = () => {
      list.hidden = !matches.length;
      input.setAttribute("aria-expanded", String(matches.length > 0));
      list.innerHTML = matches.map((s, n) => `
        <li role="option" id="${list.id}-${n}" aria-selected="${n === active}" data-n="${n}">
          <span class="nm">${esc(s.n)}</span>
          <span class="tk">${esc(s.t)} · ${esc(s.index ? s.region : s.ix.join(", "))}</span>
        </li>`).join("");
      if (active >= 0) input.setAttribute("aria-activedescendant", `${list.id}-${active}`); else input.removeAttribute("aria-activedescendant");
    };
    const choose = (s) => { matches = []; show(); input.value = ""; onPick(s); };
    input.addEventListener("input", async () => {
      const mine = ++seq;
      const m = await search(input.value).catch(() => []);
      if (mine !== seq) return;
      matches = m; active = m.length ? 0 : -1; show();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!matches.length) return;
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
        show();
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        choose(matches[active]);
      } else if (e.key === "Escape") {
        matches = []; show();
      }
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li");
      if (li) { e.preventDefault(); choose(matches[+li.dataset.n]); }
    });
    input.addEventListener("blur", () => setTimeout(() => { matches = []; show(); }, 100));
  }

  // ---- sortable table. cols: [{ key, label, title?, val(row) for sorting, html(row), left?, sm? }]
  // Columns without sm: true are hidden on phones so the table fits without sideways scrolling
  // state: { key, dir } (dir 1 = ascending, -1 = descending), kept by the caller between renders
  function table(el, cols, rows, state, opts = {}) {
    const col = cols.find((c) => c.key === state.key);
    if (col && col.val) {
      rows = rows.slice().sort((a, b) => {
        const x = col.val(a), y = col.val(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "string" ? x.localeCompare(y) : x - y) * state.dir;
      });
    }
    el.innerHTML = rows.length ? `<table class="grid-table ${opts.cls || ""}">
      <thead><tr>${cols.map((c) => {
        const sorted = c.key === state.key;
        const aria = sorted ? (state.dir > 0 ? "ascending" : "descending") : "none";
        return `<th class="${c.left ? "left" : ""}${c.sm ? "" : " hide-sm"}" ${c.val ? `aria-sort="${aria}"` : ""}>${c.val
          ? `<button class="sort" data-k="${c.key}" title="${esc(c.title || "Sort by " + c.label)}">${esc(c.label)}<i aria-hidden="true">${sorted ? (state.dir > 0 ? "▲" : "▼") : ""}</i></button>`
          : esc(c.label)}</th>`;
      }).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.left ? "left" : ""}${c.sm ? "" : " hide-sm"}">${c.html(r)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>` : `<div class="empty">${opts.empty || "Nothing to show."}</div>`;
    el.onclick = (e) => {
      const b = e.target.closest("button.sort");
      if (!b) return;
      const c = cols.find((x) => x.key === b.dataset.k);
      if (state.key === c.key) state.dir = -state.dir;
      else { state.key = c.key; state.dir = typeof c.val(rows[0] || {}) === "string" ? 1 : -1; }
      // onSort can return true when it redraws the table itself (e.g. to sort more rows than are shown)
      if (!(opts.onSort && opts.onSort(state) === true)) table(el, cols, rows, state, opts);
      const again = el.querySelector(`button.sort[data-k="${c.key}"]`);
      if (again) again.focus();
    };
    return rows;
  }

  // ---- header: menu row and quick search
  function header() {
    const here = location.pathname.split("/").pop();
    const menu = document.getElementById("menu");
    if (menu) {
      const isHere = ([href, , also]) => href === here || (also || []).includes(here);
      const link = (p) => `<a href="${p[0]}"${isHere(p) ? ' aria-current="page"' : ""}>${esc(p[1])}</a>`;
      // Wide screens: grouped, with Research and Tools as drop-downs. Narrow screens: one scrolling row.
      const seen = new Set();
      const grouped = PAGES.map((p) => {
        const g = p[3];
        if (!g) return link(p);
        if (seen.has(g)) return "";
        seen.add(g);
        const items = PAGES.filter((x) => x[3] === g);
        const on = items.some(isHere);
        return `<div class="menu-group"><button type="button" class="menu-btn${on ? " on" : ""}" aria-expanded="false" aria-haspopup="true">${esc(g)}<i aria-hidden="true">▾</i></button>
          <div class="panel menu-pop" hidden>${items.map(link).join("")}</div></div>`;
      }).join("");
      menu.innerHTML = `<div class="menu-wide">${grouped}</div><div class="menu-flat">${PAGES.map(link).join("")}</div>`;
      const close = (except) => menu.querySelectorAll(".menu-group").forEach((g) => {
        if (g === except) return;
        g.querySelector(".menu-pop").hidden = true; g.querySelector(".menu-btn").setAttribute("aria-expanded", "false");
      });
      menu.addEventListener("click", (e) => {
        const b = e.target.closest(".menu-btn");
        if (!b) return;
        const g = b.parentElement, pop = g.querySelector(".menu-pop");
        close(g);
        pop.hidden = !pop.hidden;
        b.setAttribute("aria-expanded", String(!pop.hidden));
        if (!pop.hidden) pop.querySelector("a").focus();
      });
      document.addEventListener("click", (e) => { if (!e.target.closest(".menu-group")) close(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
      const on = menu.querySelector(".menu-flat [aria-current]");
      if (on && getComputedStyle(menu.querySelector(".menu-flat")).display !== "none") on.scrollIntoView({ block: "nearest", inline: "center" });
    }
    const box = document.getElementById("jump");
    if (box) picker(box, (s) => { location.href = stockUrl(s.t); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", header); else header();

  // ---- trading hours of the seven markets (regular sessions; exchange holidays aren't known here)
  const HOURS = {
    tsx: { tz: "America/Toronto", s: [["09:30", "16:00"]], name: "Toronto" },
    sp500: { tz: "America/New_York", s: [["09:30", "16:00"]], name: "New York" },
    nasdaq100: { tz: "America/New_York", s: [["09:30", "16:00"]], name: "New York" },
    dow: { tz: "America/New_York", s: [["09:30", "16:00"]], name: "New York" },
    nikkei225: { tz: "Asia/Tokyo", s: [["09:00", "11:30"], ["12:30", "15:30"]], name: "Tokyo" },
    kospi200: { tz: "Asia/Seoul", s: [["09:00", "15:30"]], name: "Seoul" },
    twse50: { tz: "Asia/Taipei", s: [["09:00", "13:30"]], name: "Taipei" },
  };
  // { open, label, local } for a market id, e.g. { open: true, label: "Closes in 2h 10m", local: "11:20 AM" }
  function session(id, now = new Date()) {
    const h = HOURS[id];
    if (!h) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: h.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now).map((p) => [p.type, p.value]));
    const mins = +parts.hour * 60 + +parts.minute;
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
    const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
    const local = now.toLocaleTimeString(undefined, { timeZone: h.tz, hour: "numeric", minute: "2-digit" });
    const weekday = day >= 1 && day <= 5;
    if (weekday) {
      for (const [a, b] of h.s) {
        if (mins >= toMin(a) && mins < toMin(b)) return { open: true, label: `Closes in ${fmt(toMin(b) - mins)}`, local, city: h.name };
      }
      const next = h.s.find(([a]) => toMin(a) > mins);
      if (next) return { open: false, label: h.s.length > 1 && mins >= toMin(h.s[0][1]) ? `Lunch break, reopens in ${fmt(toMin(next[0]) - mins)}` : `Opens in ${fmt(toMin(next[0]) - mins)}`, local, city: h.name };
    }
    // Next weekday's open
    let add = 1;
    while (![1, 2, 3, 4, 5].includes((day + add) % 7)) add++;
    const wait = add * 1440 - mins + toMin(h.s[0][0]);
    return { open: false, label: wait < 1440 ? `Opens in ${fmt(wait)}` : `Opens ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][(day + add) % 7]} ${h.s[0][0]}`, local, city: h.name };
  }

  // ---- price alerts, kept in this browser and checked on every page while it's open
  const AKEY = "alerts";
  const KINDS = {
    above: { label: "Price rises to", unit: "price", hit: (q, v) => q.price >= v },
    below: { label: "Price falls to", unit: "price", hit: (q, v) => q.price <= v },
    up: { label: "Up today by", unit: "%", hit: (q, v) => q.chg1d != null && q.chg1d >= v },
    down: { label: "Down today by", unit: "%", hit: (q, v) => q.chg1d != null && q.chg1d <= -v },
  };
  const Alerts = {
    KINDS,
    all() { const v = store.get(AKEY, null); return v && Array.isArray(v.active) ? v : { active: [], fired: [] }; },
    save(v) { v.fired = v.fired.slice(-100); store.set(AKEY, v); window.dispatchEvent(new CustomEvent("alerts")); },
    add(a) { const v = this.all(); v.active.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), created: new Date().toISOString(), ...a }); this.save(v); },
    describe(a, cur = "USD") { const k = KINDS[a.kind]; return `${k.label} ${k.unit === "%" ? a.value + "%" : money(a.value, cur)}`; },
    // quotes: { ticker: { price, chg1d } }. Fires matching alerts and returns the ones that fired
    check(quotes) {
      const v = this.all(), fired = [];
      v.active = v.active.filter((a) => {
        const q = quotes[a.t];
        if (!q || q.price == null || !KINDS[a.kind] || !KINDS[a.kind].hit(q, a.value)) return true;
        fired.push({ ...a, firedAt: new Date().toISOString(), firedPrice: q.price, firedChg: q.chg1d });
        return false;
      });
      if (fired.length) { v.fired.push(...fired); this.save(v); fired.forEach(notify); }
      return fired;
    },
  };
  function toast(html) {
    let box = document.getElementById("toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; box.setAttribute("role", "status"); document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = html + `<button class="x" aria-label="Dismiss">✕</button>`;
    t.querySelector(".x").onclick = () => t.remove();
    box.appendChild(t);
    setTimeout(() => t.remove(), 20000);
  }
  function notify(a) {
    const text = `${a.s || a.t}: ${Alerts.describe(a, a.cur)}. Now ${money(a.firedPrice, a.cur || "USD")}${a.firedChg != null ? ` (${a.firedChg >= 0 ? "+" : ""}${a.firedChg.toFixed(2)}% today)` : ""}.`;
    toast(`<strong>🔔 Price alert</strong><br><a href="${stockUrl(a.t)}">${esc(text)}</a>${a.note ? `<br><span class="tk">${esc(a.note)}</span>` : ""}`);
    try { if ("Notification" in window && Notification.permission === "granted") new Notification("Price alert", { body: text + (a.note ? " " + a.note : ""), tag: a.id }); } catch {}
  }
  async function watchAlerts() {
    if (!Alerts.all().active.length) return;
    const ts = [...new Set(Alerts.all().active.map((a) => a.t))];
    let q = {};
    if (window.Live && Live.on) q = await Live.quotes(ts);
    // Without the live price service, fall back to the last close
    if (!Object.keys(q).length) {
      try {
        const m = await market();
        for (const t of ts) if (m.byTicker[t]) q[t] = { price: m.byTicker[t].p, chg1d: m.byTicker[t].d1 };
      } catch {}
    }
    Alerts.check(q);
  }
  window.addEventListener("load", () => {
    setTimeout(watchAlerts, 2500);
    setInterval(() => { if (!document.hidden && window.Live && Live.on) watchAlerts(); }, 60000);
  });

  window.UI = { esc, money, plain, pct, big, compact, fixed, spark, stockUrl, store, load, market, search, picker, star, Watch, table, Alerts, toast, session, PAGES };
})();
