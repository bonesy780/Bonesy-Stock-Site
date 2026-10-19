// Live prices from the site's price service (worker/index.js). The deploy
// workflow fills in the address; without one the site shows the saved data.
(function () {
  const API = "__LIVE_API__";
  const on = /^https:\/\//.test(API);
  const BATCH = 40;

  async function quotes(symbols) {
    const list = [...new Set(symbols.filter(Boolean))];
    const out = {};
    const batches = [];
    for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
    await Promise.all(batches.map(async (b) => {
      try {
        const res = await fetch(`${API}/quote?symbols=${b.map(encodeURIComponent).join(",")}`);
        if (res.ok) Object.assign(out, await res.json());
      } catch (e) { /* keep saved prices */ }
    }));
    return out;
  }

  async function chart(symbol, range) {
    const res = await fetch(`${API}/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`);
    if (!res.ok) throw new Error("chart " + res.status);
    return res.json();
  }

  // Run fn now and every `ms` while the tab is visible
  function every(ms, fn) {
    let timer = null;
    const tick = async () => { clearTimeout(timer); try { await fn(); } finally { if (!document.hidden) timer = setTimeout(tick, ms); } };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); else clearTimeout(timer); });
    tick();
  }

  const stamp = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

  window.Live = { on, quotes, chart, every, stamp };
})();
