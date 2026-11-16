// Shared by every page: the site menu, a quick ticker search in the header,
// number formatting helpers, and the watchlists saved in this browser.
(function () {
  // [href, label, other file names that count as this page, menu group]
  const PAGES = [
    ["news.html", "Market News"],
    ["markets.html", "Markets"],
    ["stock.html", "Stock Lookup"],
    ["watchlist.html", "Watchlists"],
    ["portfolio.html", "Paper Trading"],
    ["screener.html", "Screener"],
    ["movers.html", "Movers"],
    ["brief.html", "Daily Brief", null, "Research"],
    ["heatmap.html", "Heatmap", null, "Research"],
    ["signals.html", "Signals", null, "Research"],
    ["analysts.html", "Analysts", null, "Research"],
    ["dividends.html", "Dividends", null, "Research"],
    ["earnings.html", "Earnings", null, "Research"],
    ["calendar.html", "Calendar", null, "Research"],
    ["compare.html", "Compare", null, "Tools"],
    ["backtest.html", "Backtest", null, "Tools"],
    ["options.html", "Options", null, "Tools"],
    ["alerts.html", "Alerts", null, "Tools"],
    ["tools.html", "Calculators", null, "Tools"],
    ["ask.html", "Ask"],
    ["daily/", "Daily News ↗"],
    ["re/", "Real Estate ↗"],
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
  const load = (file) => (cache[file] ||= fetch(file, { cache: "no-cache" }).then((r) => {
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

  // A share button: the phone's share sheet where there is one, otherwise copy the link
  const shareBtn = (label = "Share") => `<button class="star share-btn" type="button" data-share title="Share a link to this page"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(label)}</span></button>`;
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-share]");
    if (!b) return;
    e.preventDefault();
    const url = location.href, title = document.title;
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title, url }); } catch {}
      return;
    }
    const span = b.querySelector("span"), was = span.textContent;
    try { await navigator.clipboard.writeText(url); span.textContent = "Link copied ✓"; }
    catch { span.textContent = "Copy failed"; }
    setTimeout(() => { span.textContent = was; }, 2000);
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

  // ---- stocks this reader looked up lately (newest first), kept in this browser
  const Recent = {
    list() { const v = store.get("recentStocks", []); return Array.isArray(v) ? v.filter((t) => typeof t === "string") : []; },
    add(t) { store.set("recentStocks", [t, ...Recent.list().filter((x) => x !== t)].slice(0, 8)); },
    async stocks(n = 6, skip) {
      const l = Recent.list().filter((t) => t !== skip);
      if (!l.length) return [];
      const by = new Map((await load("stocks.json")).map((s) => [s.t, s]));
      return l.map((t) => by.get(t)).filter(Boolean).slice(0, n);
    },
  };

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
    let matches = [], active = -1, seq = 0, recent = false;
    const show = () => {
      list.hidden = !matches.length;
      input.setAttribute("aria-expanded", String(matches.length > 0));
      list.innerHTML = (recent && matches.length ? `<li role="presentation" class="res-head">Recently viewed</li>` : "") + matches.map((s, n) => `
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
      recent = false; matches = m; active = m.length ? 0 : -1; show();
    });
    // An empty box lists the stocks looked up lately
    input.addEventListener("focus", async () => {
      if (input.value.trim()) return;
      const mine = ++seq;
      const m = await Recent.stocks(6).catch(() => []);
      if (mine !== seq || input.value.trim() || document.activeElement !== input) return;
      recent = true; matches = m; active = -1; show();
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
      const li = e.target.closest("li[data-n]");
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
    // Press "/" anywhere to jump to the stock search
    if (box) {
      box.placeholder = "Go to a stock… (press /)";
      document.addEventListener("keydown", (e) => {
        if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t.closest && t.closest("input, textarea, select, [contenteditable=true]")) return;
        e.preventDefault();
        box.focus();
        box.select();
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", header); else header();

  // ---- trading hours of the eight markets (regular sessions), with New York, Toronto and Tokyo exchange holidays
  const HOURS = {
    tsx: { tz: "America/Toronto", s: [["09:30", "16:00"]], name: "Toronto", hol: "ca" },
    tsxv: { tz: "America/Toronto", s: [["09:30", "16:00"]], name: "Toronto", hol: "ca" },
    sp500: { tz: "America/New_York", s: [["09:30", "16:00"]], name: "New York", hol: "us" },
    nasdaq100: { tz: "America/New_York", s: [["09:30", "16:00"]], name: "New York", hol: "us" },
    dow: { tz: "America/New_York", s: [["09:30", "16:00"]], name: "New York", hol: "us" },
    nikkei225: { tz: "Asia/Tokyo", s: [["09:00", "11:30"], ["12:30", "15:30"]], name: "Tokyo", hol: "jp" },
    kospi200: { tz: "Asia/Seoul", s: [["09:00", "15:30"]], name: "Seoul" },
    twse50: { tz: "Asia/Taipei", s: [["09:00", "13:30"]], name: "Taipei" },
  };
  // Full-day closures (exchange's local date) and early closes, from the NYSE, TMX and JPX calendars.
  // Add the next year's dates each autumn; Seoul and Taipei follow the lunar calendar and aren't listed.
  const HOLIDAYS = {
    us: {
      closed: {
        "2026-01-01": "New Year's Day", "2026-01-19": "Martin Luther King Jr. Day", "2026-02-16": "Presidents' Day", "2026-04-03": "Good Friday",
        "2026-05-25": "Memorial Day", "2026-06-19": "Juneteenth", "2026-07-03": "Independence Day", "2026-09-07": "Labor Day",
        "2026-11-26": "Thanksgiving", "2026-12-25": "Christmas",
        "2027-01-01": "New Year's Day", "2027-01-18": "Martin Luther King Jr. Day", "2027-02-15": "Presidents' Day", "2027-03-26": "Good Friday",
        "2027-05-31": "Memorial Day", "2027-06-18": "Juneteenth", "2027-07-05": "Independence Day", "2027-09-06": "Labor Day",
        "2027-11-25": "Thanksgiving", "2027-12-24": "Christmas",
      },
      early: { "2026-11-27": "13:00", "2026-12-24": "13:00", "2027-11-26": "13:00" },
    },
    ca: {
      closed: {
        "2026-01-01": "New Year's Day", "2026-02-16": "Family Day", "2026-04-03": "Good Friday", "2026-05-18": "Victoria Day",
        "2026-07-01": "Canada Day", "2026-08-03": "Civic Holiday", "2026-09-07": "Labour Day", "2026-10-12": "Thanksgiving",
        "2026-12-25": "Christmas", "2026-12-28": "Boxing Day",
        "2027-01-01": "New Year's Day", "2027-02-15": "Family Day", "2027-03-26": "Good Friday", "2027-05-24": "Victoria Day",
        "2027-07-01": "Canada Day", "2027-08-02": "Civic Holiday", "2027-09-06": "Labour Day", "2027-10-11": "Thanksgiving",
        "2027-12-27": "Christmas", "2027-12-28": "Boxing Day",
      },
    },
    jp: {
      closed: {
        "2026-01-01": "New Year", "2026-01-02": "New Year", "2026-01-12": "Coming of Age Day", "2026-02-11": "National Foundation Day",
        "2026-02-23": "Emperor's Birthday", "2026-03-20": "Vernal Equinox Day", "2026-04-29": "Showa Day", "2026-05-04": "Greenery Day",
        "2026-05-05": "Children's Day", "2026-05-06": "Constitution Day (observed)", "2026-07-20": "Marine Day", "2026-08-11": "Mountain Day",
        "2026-09-21": "Respect for the Aged Day", "2026-09-22": "National holiday", "2026-09-23": "Autumnal Equinox Day", "2026-10-12": "Sports Day",
        "2026-11-03": "Culture Day", "2026-11-23": "Labor Thanksgiving Day", "2026-12-31": "Year-end holiday",
        "2027-01-01": "New Year", "2027-01-11": "Coming of Age Day", "2027-02-11": "National Foundation Day", "2027-02-23": "Emperor's Birthday",
        "2027-03-22": "Vernal Equinox Day (observed)", "2027-04-29": "Showa Day", "2027-05-03": "Constitution Day", "2027-05-04": "Greenery Day",
        "2027-05-05": "Children's Day", "2027-07-19": "Marine Day", "2027-08-11": "Mountain Day", "2027-09-20": "Respect for the Aged Day",
        "2027-09-23": "Autumnal Equinox Day", "2027-10-11": "Sports Day", "2027-11-03": "Culture Day", "2027-11-23": "Labor Thanksgiving Day",
        "2027-12-31": "Year-end holiday",
      },
    },
  };
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const toS = (t) => +t.slice(0, 2) * 3600 + +t.slice(3) * 60;
  // A market's sessions on a local calendar date (y, m, d), or [] when it's shut: weekends and listed holidays
  function sessionsOn(h, y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    const wd = dt.getUTCDay();
    if (wd === 0 || wd === 6) return [];
    const key = dt.toISOString().slice(0, 10), cal = HOLIDAYS[h.hol];
    if (cal && cal.closed[key]) return [];
    const early = cal && cal.early && cal.early[key];
    return early ? h.s.filter(([a]) => toS(a) < toS(early)).map(([a, b]) => [a, toS(b) > toS(early) ? early : b]) : h.s;
  }
  // Where a market stands now: { open, secs to the next open or close, next: "open" | "reopen" | "close",
  // day and at (the next open's weekday and time), holiday (today's holiday name), early (today's early close) }
  function clock(id, now = new Date()) {
    const h = HOURS[id];
    if (!h) return null;
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: h.tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(now).map((x) => [x.type, x.value]));
    const y = +p.year, mo = +p.month, d = +p.day;
    const secs = +p.hour * 3600 + +p.minute * 60 + +p.second;
    const key = `${p.year}-${p.month}-${p.day}`, cal = HOLIDAYS[h.hol];
    const extra = { holiday: (cal && cal.closed[key]) || null, early: (cal && cal.early && cal.early[key]) || null };
    const today = sessionsOn(h, y, mo, d);
    for (const [a, b] of today) if (secs >= toS(a) && secs < toS(b)) return { open: true, secs: toS(b) - secs, next: "close", ...extra };
    const nx = today.find(([a]) => toS(a) > secs);
    if (nx) return { open: false, secs: toS(nx[0]) - secs, next: today.length > 1 && secs >= toS(today[0][1]) ? "reopen" : "open", day: null, at: nx[0], ...extra };
    for (let add = 1; add < 15; add++) {
      const ses = sessionsOn(h, y, mo, d + add);
      if (ses.length) return { open: false, secs: add * 86400 - secs + toS(ses[0][0]), next: "open", day: DAYS[new Date(Date.UTC(y, mo - 1, d + add)).getUTCDay()], at: ses[0][0], ...extra };
    }
    return { open: false, secs: 0, next: "open", ...extra };
  }
  // { open, label, local } for a market id, e.g. { open: true, label: "Closes in 2h 10m", local: "11:20 AM" }
  function session(id, now = new Date()) {
    const h = HOURS[id], c = clock(id, now);
    if (!c) return null;
    const m = Math.round(c.secs / 60);
    const fmt = (v) => (v >= 60 ? `${Math.floor(v / 60)}h ${v % 60}m` : `${v}m`);
    const local = now.toLocaleTimeString(undefined, { timeZone: h.tz, hour: "numeric", minute: "2-digit" });
    const label = c.open ? `Closes in ${fmt(m)}${c.early ? " (early close)" : ""}`
      : c.next === "reopen" ? `Lunch break, reopens in ${fmt(m)}`
      : (c.holiday ? `${c.holiday}, ` : "") + (m < 1440 ? `${c.holiday ? "opens" : "Opens"} in ${fmt(m)}` : `${c.holiday ? "opens" : "Opens"} ${c.day} ${c.at}`);
    return { open: c.open, label, local, city: h.name, holiday: c.holiday };
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

  // Seconds until the next open or close for a market id: { open, secs, next: "close" | "open" | "reopen" }
  const countdown = (id, now = new Date()) => clock(id, now);

  // ---- market clock strip under the menu on every page, one toggle per market
  const CLOCKS = [["tsx", "TSX"], ["tsxv", "TSXV"], ["sp500", "S&P 500"], ["nasdaq100", "Nasdaq"], ["dow", "Dow"], ["nikkei225", "Nikkei"], ["kospi200", "KOSPI"], ["twse50", "Taiwan"]];
  const dur = (t) => {
    const d = Math.floor(t / 86400), hh = Math.floor(t % 86400 / 3600), mm = Math.floor(t % 3600 / 60), ss = t % 60;
    const p2 = (n) => String(n).padStart(2, "0");
    return d ? `${d}d ${hh}h ${p2(mm)}m` : `${hh}:${p2(mm)}:${p2(ss)}`;
  };
  function marketClock() {
    const menu = document.getElementById("menu");
    if (!menu || document.getElementById("mkt-clock")) return;
    const bar = document.createElement("div");
    bar.className = "mkt-clock wrap";
    bar.id = "mkt-clock";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Market open and close timers");
    menu.after(bar);
    let on = new Set(store.get("clocks", ["tsx", "sp500"]));
    const draw = () => {
      const now = new Date();
      bar.innerHTML = `<span class="mc-label" aria-hidden="true">Markets</span>` + CLOCKS.map(([id, name]) => {
        const c = countdown(id, now), h = HOURS[id];
        const shown = on.has(id);
        const what = c.next === "close" ? "Closes in" : c.next === "reopen" ? "Reopens in" : "Opens in";
        const tip = `${name}: ${c.open ? "open" : "closed"}. ${c.holiday ? `Closed today for ${c.holiday}. ` : ""}${c.early ? `Closes early today, at ${c.early}. ` : ""}${h.name} time ${now.toLocaleTimeString(undefined, { timeZone: h.tz, hour: "numeric", minute: "2-digit" })}. Regular hours${h.hol ? " and exchange holidays" : "; exchange holidays aren't included"}. Tap to ${shown ? "hide" : "show"} the timer.`;
        return `<button type="button" class="mc ${c.open ? "open" : ""} ${shown ? "on" : ""}" data-mc="${id}" aria-pressed="${shown}" title="${esc(tip)}">
          <i aria-hidden="true"></i><b>${esc(name)}</b>${shown ? `<span class="mc-t">${what} <span class="num">${dur(c.secs)}</span></span>` : ""}</button>`;
      }).join("");
    };
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mc]");
      if (!b) return;
      const id = b.dataset.mc;
      if (on.has(id)) on.delete(id); else on.add(id);
      store.set("clocks", [...on]);
      draw();
      const again = bar.querySelector(`[data-mc="${id}"]`);
      if (again) again.focus();
    });
    window.addEventListener("storage", (e) => { if (e.key === "clocks") { on = new Set(store.get("clocks", [])); draw(); } });
    draw();
    // Tick once a second, lined up with the clock, and only while the tab is visible
    const tick = () => { if (!document.hidden) draw(); setTimeout(tick, 1000 - (Date.now() % 1000) + 5); };
    setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", marketClock); else marketClock();

  // ---- ticker tape across the top of every page: each index and its top stocks.
  // Starts from tape.json (saved after the US close) and switches to live prices when the price service is on.
  function tickerTape() {
    const top = document.querySelector("header.top");
    if (!top || document.getElementById("tape")) return;
    const names = Object.fromEntries(CLOCKS);
    load("tape.json").then((d) => {
      const items = (d.items || []).filter((x) => x.p != null);
      if (!items.length) return;
      const tape = document.createElement("div");
      tape.className = "tape";
      tape.id = "tape";
      tape.setAttribute("role", "region");
      tape.setAttribute("aria-label", "Ticker tape: index levels and top stocks");
      top.prepend(tape);
      const num = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const cell = (x) => {
        const label = x.ix ? names[x.ix] || x.t : x.s || x.t;
        const c = x.c == null ? "" : `<i class="${x.c >= 0 ? "u" : "d"}">${x.c >= 0 ? "▲" : "▼"} ${Math.abs(x.c).toFixed(2)}%</i>`;
        const inner = `<b>${esc(label)}</b><span class="num">${num(x.p)}</span>${c}`;
        return x.ix ? `<span class="tk ix">${inner}</span>` : `<a class="tk" href="${stockUrl(x.t)}">${inner}</a>`;
      };
      const draw = () => {
        const row = items.map(cell).join("");
        // Two copies side by side so the loop is seamless; the second is hidden from screen readers
        tape.innerHTML = `<div class="tape-run"><div class="tape-set">${row}</div><div class="tape-set" aria-hidden="true">${row}</div></div>`;
      };
      draw();
      if (window.Live && Live.on) {
        Live.every(60000, async () => {
          const q = await Live.quotes(items.map((x) => x.t));
          let changed = false;
          for (const x of items) {
            const y = q[x.t];
            if (y && y.price != null) { x.p = y.price; if (y.chg1d != null) x.c = y.chg1d; changed = true; }
          }
          if (changed) draw();
        });
      }
    }).catch(() => { /* no tape until the data has been built */ });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tickerTape); else tickerTape();

  window.UI = { esc, money, plain, pct, big, compact, fixed, spark, stockUrl, store, load, market, search, picker, Recent, star, shareBtn, Watch, table, Alerts, toast, session, countdown, PAGES };
})();
