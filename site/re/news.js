// Housing news for every market: region, market, topic and search toggles over one merged feed.
(async function () {
  const { esc, store, flag, marketUrl } = RE;
  const el = document.getElementById("news");
  let N;
  try { N = await RE.load("news.json"); } catch { el.innerHTML = `<div class="panel empty">No news gathered yet.</div>`; return; }
  const items = N.news || {};
  // Older builds had only the three countries and no market list
  const MK = (N.markets && N.markets.length ? N.markets : ["US", "CA", "MX"].map((c) => ({ key: c, name: RE.COUNTRY[c], kind: "country", region: "Americas", flag: c })))
    .filter((m) => (items[m.key] || []).length);
  const byKey = Object.fromEntries(MK.map((m) => [m.key, m]));
  const REGIONS = [["all", "All markets"], ["na", "North America"], ["Americas", "Americas"], ["Europe", "Europe"], ["Asia-Pacific", "Asia-Pacific"],
    ["Middle East & Africa", "Middle East & Africa"], ["cities", "Cities"]];
  const TOPICS = [["prices", "Prices"], ["sales", "Sales & buyers"], ["rates", "Mortgages & rates"], ["rent", "Rent"], ["build", "Building & supply"], ["policy", "Policy & tax"]];
  const NA = new Set(["US", "CA", "MX"]);
  const inRegion = (m, r) => r === "all" || (r === "na" ? NA.has(m.key) || m.kind === "city" : r === "cities" ? m.kind === "city" : m.kind === "country" && m.region === r);
  // Old saved choice (one country code) still works
  const old = store.get("re-news", null);
  const S = {
    region: store.get("re-news-region", "all"), market: store.get("re-news-market", typeof old === "string" && byKey[old] ? old : ""),
    topics: new Set(store.get("re-news-topics", [])), q: "", sort: store.get("re-news-sort", "new"), n: 30,
  };
  if (!REGIONS.find((r) => r[0] === S.region)) S.region = "all";
  if (S.market && !byKey[S.market]) S.market = "";
  document.getElementById("n-count").textContent = `${MK.length} markets`;

  const ago = (s) => {
    if (!s) return "";
    const h = (Date.now() - new Date(s)) / 36e5;
    return h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
  };
  const regionSeg = document.getElementById("n-region"), marketSel = document.getElementById("n-market"),
    topicsEl = document.getElementById("n-topics"), chipsEl = document.getElementById("n-chips"), sortSel = document.getElementById("n-sort");
  sortSel.value = S.sort;
  const markets = () => MK.filter((m) => inRegion(m, S.region));
  const matches = (s) => (!S.topics.size || (s.t || []).some((t) => S.topics.has(t))) && (!S.q || s.title.toLowerCase().includes(S.q) || (s.src || "").toLowerCase().includes(S.q));
  const save = () => { store.set("re-news-region", S.region); store.set("re-news-market", S.market); store.set("re-news-topics", [...S.topics]); store.set("re-news-sort", S.sort); };

  function draw() {
    regionSeg.innerHTML = REGIONS.filter(([k]) => k === "all" || MK.some((m) => inRegion(m, k)))
      .map(([k, l]) => `<button role="tab" aria-selected="${k === S.region}" data-r="${esc(k)}">${esc(l)}</button>`).join("");
    const ms = markets();
    if (S.market && !ms.find((m) => m.key === S.market)) S.market = "";
    marketSel.innerHTML = `<option value="">All ${ms.length} markets</option>` + ms.slice().sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "country" ? -1 : 1) || a.name.localeCompare(b.name))
      .map((m) => `<option value="${esc(m.key)}" ${m.key === S.market ? "selected" : ""}>${m.kind === "city" ? "City: " : ""}${esc(m.name)}</option>`).join("");
    topicsEl.innerHTML = `<span class="muted re-small">Topics</span>` + TOPICS.map(([k, l]) => `<button class="chip" type="button" aria-pressed="${S.topics.has(k)}" data-t="${k}">${esc(l)}</button>`).join("")
      + (S.topics.size ? `<button class="chip n-clear" type="button" data-t="">Clear</button>` : "");
    // Market chips with story counts (tap to pick one)
    const pool = S.market ? ms.filter((m) => m.key === S.market) : ms;
    const rows = pool.flatMap((m) => (items[m.key] || []).filter(matches).map((s) => ({ ...s, m })));
    const count = Object.fromEntries(ms.map((m) => [m.key, (items[m.key] || []).filter(matches).length]));
    chipsEl.innerHTML = ms.length > 1 ? ms.filter((m) => count[m.key]).sort((a, b) => count[b.key] - count[a.key]).slice(0, 40)
      .map((m) => `<button class="chip" type="button" aria-pressed="${m.key === S.market}" data-m="${esc(m.key)}">${flag(m.flag)} ${esc(m.name)} <span class="muted">${count[m.key]}</span></button>`).join("") : "";
    if (S.sort === "market") rows.sort((a, b) => a.m.name.localeCompare(b.m.name) || (b.at || "").localeCompare(a.at || ""));
    else rows.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    // Drop the same story found under two markets
    const seen = new Set();
    const uniq = rows.filter((s) => { const k = s.title.toLowerCase().replace(/\W+/g, "").slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; });
    document.getElementById("n-count-line").textContent = `${uniq.length} ${uniq.length === 1 ? "story" : "stories"}${S.market ? " for " + byKey[S.market].name : ` across ${pool.filter((m) => count[m.key]).length} markets`}${S.topics.size ? " on the chosen topics" : ""}, past 7 days.`;
    const tname = Object.fromEntries(TOPICS);
    let lastM = null;
    el.innerHTML = uniq.length ? `<div class="story-grid">${uniq.slice(0, S.n).map((s) => {
      const head = S.sort === "market" && s.m.key !== lastM ? `<h2 class="n-group">${flag(s.m.flag)} ${esc(s.m.name)}</h2>` : "";
      lastM = s.m.key;
      return `${head}<article class="panel story n-story">
        <a class="story-body" href="${esc(s.url)}" target="_blank" rel="noopener"><div class="story-meta"><span>${esc(s.src || "News")}</span><span>${esc(ago(s.at))}</span></div><h3>${esc(s.title)}</h3></a>
        <div class="n-tags">${s.m.market || ["US", "CA", "MX"].includes(s.m.key) ? `<a class="tag" href="${s.m.market ? marketUrl(s.m.market) : marketUrl(s.m.key.toLowerCase())}">${flag(s.m.flag)} ${esc(s.m.name)}</a>` : `<a class="tag" href="world.html">${flag(s.m.flag)} ${esc(s.m.name)}</a>`}${(s.t || []).slice(0, 3).map((t) => `<span class="tag n-topic">${esc(tname[t] || t)}</span>`).join("")}</div>
      </article>`;
    }).join("")}</div>` : `<div class="panel empty">No stories match. Try another topic or clear the search.</div>`;
    document.getElementById("n-more").innerHTML = uniq.length > S.n ? `<button class="btn" type="button" id="n-more-btn">Show ${Math.min(30, uniq.length - S.n)} more of ${uniq.length - S.n}</button>` : "";
  }
  regionSeg.addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (!b) return; S.region = b.dataset.r; S.market = ""; S.n = 30; save(); draw(); });
  marketSel.addEventListener("change", () => { S.market = marketSel.value; S.n = 30; save(); draw(); });
  chipsEl.addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b) return; S.market = S.market === b.dataset.m ? "" : b.dataset.m; S.n = 30; save(); draw(); });
  topicsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    const t = b.dataset.t;
    if (!t) S.topics.clear(); else if (S.topics.has(t)) S.topics.delete(t); else S.topics.add(t);
    S.n = 30; save(); draw();
  });
  let qt;
  document.getElementById("n-q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); S.n = 30; draw(); }, 150); });
  sortSel.addEventListener("change", () => { S.sort = sortSel.value; save(); draw(); });
  document.getElementById("n-more").addEventListener("click", (e) => { if (e.target.closest("#n-more-btn")) { S.n += 30; draw(); } });
  draw();
})();
