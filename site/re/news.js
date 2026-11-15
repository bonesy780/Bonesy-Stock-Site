// Housing news by country.
(async function () {
  const { esc, store, COUNTRY, FLAG } = RE;
  const el = document.getElementById("news"), tabs = document.getElementById("tabs");
  let N;
  try { N = await RE.load("news.json"); } catch { el.innerHTML = `<div class="panel empty">No news gathered yet.</div>`; return; }
  let c = store.get("re-news", "US");
  const ago = (s) => {
    if (!s) return "";
    const h = (Date.now() - new Date(s)) / 36e5;
    return h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
  };
  function draw() {
    tabs.innerHTML = ["US", "CA", "MX"].map((k) => `<button class="tab" role="tab" aria-selected="${k === c}" data-c="${k}">${FLAG[k]} ${COUNTRY[k]}</button>`).join("");
    const items = (N.news || {})[c] || [];
    el.innerHTML = items.length ? `<div class="story-grid">${items.map((s) => `<a class="panel story" href="${esc(s.url)}" target="_blank" rel="noopener">
      <div class="story-body"><div class="story-meta"><span>${esc(s.src || "News")}</span><span>${esc(ago(s.at))}</span></div><h3>${esc(s.title)}</h3></div></a>`).join("")}</div>`
      : `<div class="panel empty">No stories this week.</div>`;
  }
  tabs.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; c = b.dataset.c; store.set("re-news", c); draw(); });
  draw();
})();
