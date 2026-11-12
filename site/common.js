// Shared by every page: the site menu, a quick ticker search in the header,
// number formatting helpers, and the watchlists saved in this browser.
(function () {
  const PAGES = [
    ["./", "Markets", ["index.html", ""]],
    ["stock.html", "Stock Lookup"],
    ["watchlist.html", "Watchlists"],
    ["movers.html", "Movers"],
    ["screener.html", "Screener"],
    ["heatmap.html", "Heatmap"],
    ["compare.html", "Compare"],
    ["news.html", "News"],
  ];

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const digits = (v, cur) => (Math.abs(v) >= 1000 || cur === "JPY" || cur === "KRW" ? 0 : 2);
  const money = (v, cur = "USD") => v == null ? "–" : new Intl.NumberFormat(undefined, {
    style: "currency", currency: cur, maximumFractionDigits: digits(v, cur), minimumFractionDigits: digits(v, cur),
  }).format(v);
  const plain = (v, cur) => v == null ? "–" : v.toLocaleString(undefined, { maximumFractionDigits: digits(v, cur), minimumFractionDigits: digits(v, cur) });
  const pct = (v, nd = 1) => v == null ? '<span class="num">–</span>' :
    `<span class="num ${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(nd)}%</span>`;
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
    const t = norm(text.trim());
    if (!t) return [];
    const stocks = await load("stocks.json");
    const scored = [];
    for (const s of stocks) {
      const sym = s.s.toLowerCase(), tick = s.t.toLowerCase(), name = norm(s.n);
      const score = sym === t || tick === t ? 0 : sym.startsWith(t) ? 1 : name.startsWith(t) ? 2
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
      menu.innerHTML = PAGES.map(([href, label, also]) => {
        const cur = href === here || (also || []).includes(here);
        return `<a href="${href}"${cur ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
      }).join("");
      const on = menu.querySelector("[aria-current]");
      if (on) on.scrollIntoView({ block: "nearest", inline: "center" });
    }
    const box = document.getElementById("jump");
    if (box) picker(box, (s) => { location.href = stockUrl(s.t); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", header); else header();

  window.UI = { esc, money, plain, pct, big, compact, fixed, spark, stockUrl, store, load, market, search, picker, star, Watch, table, PAGES };
})();
