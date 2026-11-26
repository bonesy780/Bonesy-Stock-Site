// Home page: pick stocks, real estate or the daily news, with live figures from each side,
// a scrolling ticker tape and headlines that rotate on the news card.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const chg = (v) => v == null ? "" : `<i class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(2)}%</i>`;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const get = (f) => fetch(f, { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (still) document.querySelectorAll("animate, animateMotion").forEach((a) => a.remove());
  if (still) document.querySelectorAll(".nw-sat").forEach((a) => a.remove());

  // Remember the reader's side if they ask
  const remember = $("remember");
  for (const a of document.querySelectorAll("[data-pick]")) {
    a.addEventListener("click", () => {
      try { if (remember.checked) localStorage.setItem("home-pick", a.dataset.pick); else localStorage.removeItem("home-pick"); } catch {}
    });
  }
  try { remember.checked = !!localStorage.getItem("home-pick"); } catch {}
  remember.addEventListener("change", () => { if (!remember.checked) try { localStorage.removeItem("home-pick"); } catch {} });

  // Reader's clock in the live pill
  const tick = () => { $("hm-clock").textContent = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };
  tick(); setInterval(tick, 30000);

  // ---- stocks: ticker tape and the card's figures
  const NAMES = { sp500: "S&P 500", nasdaq100: "Nasdaq", dow: "Dow", tsx: "TSX", tsxv: "TSX Venture", nikkei225: "Nikkei", kospi200: "KOSPI", twse50: "Taiwan" };
  const num = (v, d = 2) => v == null ? "–" : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: v >= 1000 ? 0 : d });
  get("tape.json").then((d) => {
    const items = ((d && d.items) || []).filter((x) => x.p != null);
    if (!items.length) { $("tape").innerHTML = ""; return; }
    const one = items.map((x) => x.ix
      ? `<span class="hm-tape-item ix"><b>${esc(NAMES[x.ix] || x.t)}</b><span class="num">${num(x.p, 0)}</span>${chg(x.c)}</span>`
      : `<a class="hm-tape-item" href="stock.html?t=${encodeURIComponent(x.t)}" style="color:inherit;text-decoration:none"><b>${esc(x.s || x.t)}</b><span class="num">${num(x.p)}</span>${chg(x.c)}</a>`).join("");
    const track = $("tape");
    // Two copies side by side so the loop is seamless; about 4 seconds per item
    track.innerHTML = one + one;
    track.style.setProperty("--dur", Math.max(40, items.length * 4) + "s");
    if (!still) track.classList.add("run");

    const ix = items.filter((x) => x.ix && NAMES[x.ix]);
    const card = ix.filter((x) => ["sp500", "nasdaq100", "dow", "tsx"].includes(x.ix));
    if (card.length) $("live-stocks").innerHTML = card.map((x) => `<span><b>${esc(NAMES[x.ix])}</b> <span class="num">${num(x.p, 0)}</span> ${chg(x.c)}</span>`).join("");
    const best = ix.slice().sort((a, b) => (b.c ?? -99) - (a.c ?? -99)).slice(0, 2);
    if (best.length) $("st-chips").innerHTML = best.map((x) => `<span class="hm-chip">${esc(NAMES[x.ix])} <span class="${x.c >= 0 ? "up" : "down"}">${x.c >= 0 ? "+" : ""}${(x.c ?? 0).toFixed(2)}%</span></span>`).join("");
  });

  // ---- real estate
  get("re/data.json").then((d) => {
    if (!d) return;
    const us = (d.markets || []).find((m) => m.id === "us"), R = d.rates || {};
    const bits = [];
    if (us && us.v) bits.push(`<span><b>U.S. home</b> <span class="num">$${Math.round(us.v / 1000)}K</span> ${chg(us.v1y)}</span>`);
    if (R.us30) bits.push(`<span><b>U.S. 30-yr</b> <span class="num">${R.us30.v.toFixed(2)}%</span></span>`);
    if (R.ca5) bits.push(`<span><b>Canada 5-yr</b> <span class="num">${R.ca5.v.toFixed(2)}%</span></span>`);
    $("live-re").innerHTML = bits.join("");
    const chips = [];
    if (us && us.v1y != null) chips.push(`🏠 U.S. prices <span class="${us.v1y >= 0 ? "up" : "down"}">${us.v1y >= 0 ? "+" : ""}${us.v1y.toFixed(1)}%</span>`);
    if (R.us30) chips.push(`📉 30-yr ${R.us30.v.toFixed(2)}%`);
    if (chips.length) $("re-chips").innerHTML = chips.map((c) => `<span class="hm-chip">${c}</span>`).join("");
  });

  // ---- news: rotate the stories everyone is covering
  get("daily/news.json").then((d) => {
    if (!d || !d.stories) return;
    const outlets = (d.outlets || []).filter((o) => o.n).length;
    $("nw-count").textContent = `${d.stories.length.toLocaleString()} stories · ${outlets} outlets`;
    const heads = (d.big || []).map((g) => d.stories[g[0]]).filter(Boolean).slice(0, 6);
    if (!heads.length) heads.push(...d.stories.slice(0, 5));
    const el = $("live-daily");
    let i = 0;
    const show = () => { el.innerHTML = `<span>🔥 ${esc(heads[i % heads.length].t)}</span>`; };
    show();
    if (still || heads.length < 2) return;
    setInterval(() => {
      const s = el.firstElementChild;
      if (s) s.classList.add("out");
      setTimeout(() => { i++; show(); }, 350);
    }, 4500);
  });
})();
