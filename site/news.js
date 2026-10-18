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

  let current = (() => { try { return localStorage.getItem("newsTab"); } catch { return null; } })() || data.markets[0].id;
  if (!data.markets.some((m) => m.id === current)) current = data.markets[0].id;

  function render() {
    $("tabs").innerHTML = data.markets.map((m) =>
      `<button class="tab" role="tab" aria-selected="${m.id === current}" data-id="${m.id}">${esc(m.name)}</button>`).join("");
    const m = data.markets.find((x) => x.id === current);
    const [lead, ...rest] = m.stories;
    const card = (s, big) => `
      <a class="panel story${big ? " lead" : ""}" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">
        ${s.image ? `<img src="${esc(safeUrl(s.image))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
        <div class="story-body">
          <div class="story-meta"><span>${esc(s.source)}</span><span>${ago(s.published)}</span>${s.related ? `<span class="tag">${esc(s.related)}</span>` : ""}</div>
          <h3>${esc(s.title)}</h3>
          ${s.summary ? `<p>${esc(s.summary)}</p>` : ""}
        </div>
      </a>`;
    $("news").innerHTML = `
      <div class="news-head"><h2>${esc(m.name)}</h2><span class="region">${esc(m.region)}</span> ${pct(m.chg1d)}<span class="region"> today</span></div>
      ${lead ? card(lead, true) + `<div class="story-grid">${rest.map((s) => card(s, false)).join("")}</div>`
             : `<div class="panel empty">No stories for this market in the past week.</div>`}`;
  }

  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    current = b.dataset.id;
    try { localStorage.setItem("newsTab", current); } catch {}
    render();
  });

  if (window.startRain) window.startRain(data.markets.flatMap((m) => m.stories.map((s) => s.related).filter(Boolean)));
  render();
})();
