(async function () {
  const $ = (id) => document.getElementById(id);
  let data;
  try {
    const res = await fetch("news.json", { cache: "no-store" });
    data = await res.json();
  } catch (e) {
    $("updated").textContent = "News could not be loaded.";
    return;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => /^https?:\/\//i.test(u || "") ? u : "#";
  const ago = (iso) => {
    const mins = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
    if (mins < 60) return mins + "m ago";
    const h = Math.round(mins / 60);
    if (h < 24) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  };
  const pct = (v) => v == null ? "" :
    `<span class="num ${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</span>`;

  $("updated").textContent = "Updated " + new Date(data.generated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  // "Top stories" from the big financial outlets comes first, then one tab per market
  const sources = (data.sources || []).filter((x) => x.stories.length);
  const PAYWALL = new Set(["wsj", "ft", "bloomberg", "economist"]);
  // "All markets" merges every market's stories, newest first, each labelled with its market
  const seenAll = new Set();
  const allMarkets = {
    id: "all", name: "All markets", region: "Every market on the site", chg1d: null,
    stories: data.markets.flatMap((m) => m.stories.map((st) => ({ ...st, market: m.name.replace(/ \(.*\)/, "") })))
      .sort((a, b) => new Date(b.published) - new Date(a.published))
      .filter((st) => { const k = st.title.toLowerCase().slice(0, 80); if (seenAll.has(k)) return false; seenAll.add(k); return true; })
      .slice(0, 48),
  };
  const markets = [allMarkets].concat(data.markets);
  const tabs = (sources.length ? [{ id: "top", name: "Top stories" }] : []).concat(markets);
  let current = (() => { try { return localStorage.getItem("newsTab"); } catch { return null; } })() || tabs[0].id;
  if (!tabs.some((m) => m.id === current)) current = tabs[0].id;
  let outlet = (() => { try { return localStorage.getItem("newsOutlet"); } catch { return null; } })() || "all";
  if (outlet !== "all" && !sources.some((x) => x.id === outlet)) outlet = "all";

  function render() {
    $("tabs").innerHTML = tabs.map((m) =>
      `<button class="tab" role="tab" aria-selected="${m.id === current}" data-id="${m.id}">${esc(m.name)}</button>`).join("");
    const card = (s, big) => `
      <a class="panel story${big ? " lead" : ""}" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">
        ${s.image ? `<img src="${esc(safeUrl(s.image))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
        <div class="story-body">
          <div class="story-meta"><span>${esc(s.source)}</span>${s.paywall ? `<span class="tag" title="The full story may need a subscription">Subscription</span>` : ""}<span>${ago(s.published)}</span>${s.market && current === "all" ? `<span class="tag">${esc(s.market)}</span>` : ""}${s.related ? `<span class="tag">${esc(s.related)}</span>` : ""}</div>
          <h3>${esc(s.title)}</h3>
          ${s.summary ? `<p>${esc(s.summary)}</p>` : ""}
        </div>
      </a>`;
    if (current === "top") {
      const tagged = sources.flatMap((x) => x.stories.map((st) => ({ ...st, source: x.name, paywall: PAYWALL.has(x.id), from: x.id })));
      const list = (outlet === "all" ? tagged : tagged.filter((st) => st.from === outlet)).sort((a, b) => new Date(b.published) - new Date(a.published)).slice(0, 36);
      const [lead, ...rest] = list;
      $("news").innerHTML = `
        <div class="news-head"><h2>Top stories</h2><span class="region">The latest markets and business news from ${sources.length} outlets</span></div>
        <div class="panel chips news-outlets" id="outlets">${[{ id: "all", name: "All outlets", stories: tagged }].concat(sources).map((x) =>
          `<button class="chip" data-o="${x.id}" aria-pressed="${x.id === outlet}">${esc(x.name)} <span class="muted">${x.stories.length}</span></button>`).join("")}</div>
        ${lead ? card(lead, true) + `<div class="story-grid">${rest.map((st) => card(st, false)).join("")}</div>` : `<div class="panel empty">No stories from this outlet in the past few days.</div>`}`;
      return;
    }
    const m = markets.find((x) => x.id === current);
    const [lead, ...rest] = m.stories;
    $("news").innerHTML = `
      <div class="news-head"><h2>${esc(m.name)}</h2><span class="region">${esc(m.region)}</span> ${m.chg1d != null ? `${pct(m.chg1d)}<span class="region"> today</span>` : ""}</div>
      ${lead ? card(lead, true) + `<div class="story-grid">${rest.map((s) => card(s, false)).join("")}</div>`
             : `<div class="panel empty">No stories for this market in the past week.</div>`}`;
  }

  $("news").addEventListener("click", (e) => {
    const b = e.target.closest("[data-o]");
    if (!b) return;
    outlet = b.dataset.o;
    try { localStorage.setItem("newsOutlet", outlet); } catch {}
    render();
  });
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    current = b.dataset.id;
    try { localStorage.setItem("newsTab", current); } catch {}
    render();
  });
  render();
})();
