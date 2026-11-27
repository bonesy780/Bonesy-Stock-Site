// About the data: the site's notes on where each figure comes from (about.json, written from the build scripts).
// This replaced the Ask page; it shows every note, with a quick filter.
(async function () {
  const { esc } = UI;
  const $ = (id) => document.getElementById(id);
  const PAGE_NAMES = {
    "markets.html": "Markets", "stock.html": "Stock Lookup", "watchlist.html": "Watchlists", "portfolio.html": "Paper Trading",
    "screener.html": "Screener", "today.html": "Today", "today.html#recap": "the weekly recap", "today.html#news": "Market news", "heatmap.html": "Heatmap",
    "analysts.html": "Analysts", "dividends.html": "Dividends", "earnings.html": "Earnings", "earnings.html#cal": "the calendar",
    "compare.html": "Compare", "backtest.html": "Backtest", "options.html": "Options", "funds.html": "ETFs & Crypto", "insiders.html": "Insiders",
    "daily/": "Daily News", "re/": "Real Estate", "re/listings.html": "Homes for sale", "re/world.html": "World housing markets",
  };
  $("updated").textContent = "";
  let KB = [];
  try { KB = await (await fetch("about.json", { cache: "no-cache" })).json(); }
  catch { $("topics").innerHTML = `<div class="panel empty">The notes could not be loaded. Try reloading the page.</div>`; return; }
  const link = (k) => {
    if (!k.page) return "";
    const href = k.page.replace("today.html#recap", "today.html#recap-sec").replace("today.html#news", "today.html#news-sec");
    return `<a class="about-go" href="${esc(href)}">Open ${esc(PAGE_NAMES[k.page] || k.page)} →</a>`;
  };
  function render() {
    const words = $("find").value.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = KB.filter((k) => words.every((w) => (k.title + " " + k.answer).toLowerCase().includes(w)));
    $("count").textContent = words.length ? `${hits.length} of ${KB.length} topics` : `${KB.length} topics`;
    $("topics").innerHTML = hits.length ? hits.map((k) => `<details class="panel about-topic" id="${esc(k.id)}"${words.length || location.hash === "#" + k.id ? " open" : ""}>
        <summary>${esc(k.title)}</summary><p>${esc(k.answer)}</p>${link(k)}</details>`).join("")
      : `<div class="panel empty">No topic mentions that. Try a shorter word.</div>`;
  }
  $("find").addEventListener("input", render);
  render();
})();
